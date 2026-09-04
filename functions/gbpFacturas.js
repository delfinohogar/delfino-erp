// Importa el historial de facturas emitidas en GBP a Delfino ERP — SOLO LECTURA/HISTORIAL: no
// factura nada del lado de Delfino, no cruza con Cuenta Corriente ni con ninguna otra pantalla.
// Las dos consultas que trae este sync viven en GBP bajo Configuración > Exportación Personalizada:
//   - "Delfino - Facturas Encabezado" (id 4): un renglón por comprobante, solo "Fc A"/"Fc B"
//     (nunca remitos/notas), últimos 90 días — ventana fija calculada en la propia SQL con
//     DATEADD/GETDATE (wsExportDataById no puede recibir fechas por parámetro, ver gbp.js).
//   - "Delfino - Facturas Líneas" (id 5): un renglón por artículo facturado, mismo filtro.
// Si algún día hace falta correr un backfill más largo que 90 días, se edita el WHERE de esas dos
// consultas directo en GBP (no hace falta tocar este código) y se corre la sincronización de nuevo.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const gbp = require("./gbp");

const EXPGR_ID_ENCABEZADO = 4;
const EXPGR_ID_LINEAS = 5;

// "2026-08-27T00:00:00-03:00" -> "2026-08-27" (convención de fecha-como-string de todo el ERP).
function soloFecha(valor) {
  return typeof valor === "string" && valor.length >= 10 ? valor.slice(0, 10) : null;
}

function numero(valor) {
  const n = parseFloat(valor);
  return Number.isFinite(n) ? n : 0;
}

function esVerdadero(valor) {
  return valor === true || valor === "true" || valor === "1" || valor === 1;
}

// "01.Fc B Elect. 04" -> "B"
function letraDesdeTipoComprobante(texto) {
  const match = String(texto || "").match(/Fc\s+([A-E])/i);
  return match ? match[1].toUpperCase() : null;
}

// item_id ausente = línea "fantasma": GBP no mandó a qué artículo corresponde, así que no hay forma
// de saber qué se vendió — se descarta antes de guardarla (ver el loop de líneas más abajo).
// Evaluado sobre el valor CRUDO, antes de convertirlo a string — String(undefined) da el string
// "undefined", que se vería como "un valor" si se chequeara después de la conversión. Un item_id
// real que simplemente no matchea el catálogo de Delfino NO entra acá — esa es una venta real de
// algo todavía no catalogado en Delfino, se guarda igual (ver productoPorIdExterno).
function itemIdFaltante(itemId) {
  return itemId === undefined || itemId === null || String(itemId).trim() === "";
}

exports.gbpSincronizarFacturas = onCall(
  { region: "southamerica-east1", secrets: gbp.GBP_SECRETS, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
    const db = admin.firestore();
    const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
    if (perfil.data()?.rol !== "administrador") {
      throw new HttpsError("permission-denied", "Solo un administrador puede sincronizar facturas de GBP.");
    }

    const token = await gbp.authenticate();
    const [encabezados, lineas] = await Promise.all([
      gbp.exportarDatosPorId(token, EXPGR_ID_ENCABEZADO),
      gbp.exportarDatosPorId(token, EXPGR_ID_LINEAS),
    ]);

    // Para mostrar SKU/descripción en cada línea sin llamar al webservice artículo por artículo —
    // identificadorExterno ya guarda el ID de GBP desde que se importó el catálogo (ver
    // js/importar-globalbluepoint.js). Si un item_id no matchea ningún producto (SKU distinto,
    // producto dado de baja, etc.) la línea queda igual, solo sin sku/descripcion resueltos.
    const productosSnap = await db.collection("productos").where("identificadorExterno", "!=", null).get();
    const productoPorIdExterno = new Map();
    productosSnap.forEach((doc) => {
      const p = doc.data();
      if (p.identificadorExterno) {
        productoPorIdExterno.set(String(p.identificadorExterno), { id: doc.id, sku: p.sku, descripcion: p.descripcion });
      }
    });

    // Mismo cruce que arriba pero para clientes — lo carga gbpVincularClientes (ver gbpClientes.js).
    // Si un cliente todavía no fue vinculado, la factura queda igual, solo sin clienteId.
    const clientesSnap = await db.collection("clientes").where("identificadorExterno", "!=", null).get();
    const clienteIdPorIdExterno = new Map();
    clientesSnap.forEach((doc) => {
      const idExt = doc.data().identificadorExterno;
      if (idExt) clienteIdPorIdExterno.set(String(idExt), doc.id);
    });

    // Comprobante legible por transacción, solo para identificar a qué factura pertenece cada línea
    // descartada en el warning de abajo — mismo armado de texto que ya se usa al guardar encabezados.
    const comprobantePorTransaccion = new Map(
      encabezados.map((e) => [
        String(e.ct_transaction),
        `${letraDesdeTipoComprobante(e.tipoComprobante) || ""} ${String(e.ct_pointOfSale ?? "").padStart(4, "0")}-${String(
          e.ct_docNumber ?? ""
        ).padStart(8, "0")}`.trim(),
      ])
    );

    const lineasPorTransaccion = new Map();
    const descartadasPorTransaccion = new Map();
    for (const l of lineas) {
      const key = String(l.ct_transaction);
      if (itemIdFaltante(l.item_id)) {
        const entrada = descartadasPorTransaccion.get(key) || { cantidad: 0, valoresCrudos: [] };
        entrada.cantidad += 1;
        entrada.valoresCrudos.push(l.item_id);
        descartadasPorTransaccion.set(key, entrada);
        continue;
      }
      if (!lineasPorTransaccion.has(key)) lineasPorTransaccion.set(key, []);
      const producto = productoPorIdExterno.get(String(l.item_id));
      lineasPorTransaccion.get(key).push({
        itemIdExterno: String(l.item_id),
        productoId: producto?.id || null,
        sku: producto?.sku || null,
        descripcion: producto?.descripcion || null,
        cantidad: numero(l.it_qty),
        precioUnitario: numero(l.it_price),
        costoUnitario: numero(l.it_priceOfCost),
      });
    }
    // Rastro en los logs de cada línea descartada, con el valor crudo que mandó GBP — así si el
    // patrón cambia (por ejemplo, GBP empieza a mandar un item_id con otra forma "vacía") queda
    // visible en vez de fallar en silencio.
    for (const [key, { cantidad, valoresCrudos }] of descartadasPorTransaccion) {
      const comprobante = comprobantePorTransaccion.get(key) || key;
      console.warn(
        `gbpSincronizarFacturas: comprobante ${comprobante} — ${cantidad} línea(s) descartada(s) sin item_id (valores crudos: ${JSON.stringify(
          valoresCrudos
        )}).`
      );
    }

    // Firestore no acepta más de 500 escrituras por batch — se junta en tandas de 400 por si algún
    // día el resultado crece (ver mismo patrón en functions/tiendanubeCatalogo.js).
    const TAMANO_TANDA = 400;
    for (let i = 0; i < encabezados.length; i += TAMANO_TANDA) {
      const batch = db.batch();
      for (const e of encabezados.slice(i, i + TAMANO_TANDA)) {
        const idExterno = String(e.ct_transaction);
        batch.set(
          db.collection("facturasGbp").doc(idExterno),
          {
            idExterno,
            puntoVenta: numero(e.ct_pointOfSale),
            numero: numero(e.ct_docNumber),
            tipoComprobante: e.tipoComprobante || null,
            letra: letraDesdeTipoComprobante(e.tipoComprobante),
            fecha: soloFecha(e.ct_date),
            fechaFiscal: soloFecha(e.ct_taxDate),
            clienteIdExterno: e.cust_id != null ? String(e.cust_id) : null,
            clienteId: clienteIdPorIdExterno.get(String(e.cust_id)) || null,
            subtotal: numero(e.ct_subtotal),
            iva: numero(e.ct_taxes),
            total: numero(e.ct_total),
            cae: e.ct_CAI != null ? String(e.ct_CAI) : null,
            caeVencimiento: soloFecha(e.ct_CAIDate),
            anulada: esVerdadero(e.ct_isCancelled),
            lineas: lineasPorTransaccion.get(idExterno) || [],
            sincronizadoEn: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }

    return { totalFacturas: encabezados.length, totalLineas: lineas.length };
  }
);
