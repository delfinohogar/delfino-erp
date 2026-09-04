// Autorización fiscal de comprobantes vía ARCA (WSFEv1) — el ArcaFiscalProvider de js/facturacion.js
// llama a esta Cloud Function cuando configuracion/facturacion.arcaActivo es true. Mientras sea
// false (siempre, en esta etapa), ESTA FUNCIÓN NUNCA SE LLAMA — ver evaluarProveedorFiscal() en
// js/facturacion.js, que ni siquiera importa este módulo del lado del cliente.
//
// TODAVÍA NO PROBADO CONTRA ARCA — no hay certificado de homologación cargado (ver sección 13/14
// del pedido). El código está armado según la documentación oficial y queda documentado abajo,
// campo por campo, qué se pudo verificar y qué no.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const arcaWsfe = require("./arcaWsfe");

// Producción: mismos secrets que ya usa el padrón (consultarPadronArca en index.js) — nunca se
// duplican. Homologación: secrets NUEVOS, todavía con valor placeholder (ver informe final) hasta
// que se cargue el certificado real sacado por WSASS.
const afipCert = defineSecret("AFIP_CERT");
const afipKey = defineSecret("AFIP_KEY");
const afipCuit = defineSecret("AFIP_CUIT");
const afipCertHomo = defineSecret("AFIP_CERT_HOMO");
const afipKeyHomo = defineSecret("AFIP_KEY_HOMO");
const afipCuitHomo = defineSecret("AFIP_CUIT_HOMO");

function credencialesParaAmbiente(ambiente) {
  if (ambiente === "produccion") {
    return { cert: afipCert.value(), key: afipKey.value(), cuit: limpiarCuit(afipCuit.value()) };
  }
  const cert = afipCertHomo.value();
  const key = afipKeyHomo.value();
  const cuit = limpiarCuit(afipCuitHomo.value());
  // El secret existe (hace falta que exista para poder desplegar esta función — ver informe final)
  // pero todavía tiene el valor placeholder que se le cargó al crearlo. Se detecta acá para no
  // intentar firmar un CMS con un "certificado" que en realidad es un string cualquiera.
  if (!cert || !cert.includes("BEGIN CERTIFICATE")) {
    throw new HttpsError(
      "failed-precondition",
      "Todavía no se cargó el certificado de homologación real (AFIP_CERT_HOMO/AFIP_KEY_HOMO/AFIP_CUIT_HOMO tienen un valor de relleno). Hace falta sacarlo por WSASS con tu CUIT y clave fiscal antes de poder probar esto contra ARCA."
    );
  }
  return { cert, key, cuit };
}

function limpiarCuit(cuit) {
  return (cuit || "").toString().replace(/\D/g, "");
}

async function registrarLog(db, { tipoOperacion, resultado, ptoVta = null, cbteTipo = null, mensajeError = null, ambiente }) {
  await db.collection("logIntegracionArca").add({
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    tipoOperacion,
    resultado,
    ptoVta,
    cbteTipo,
    mensajeError,
    ambiente,
  });
}

// --- Determinación de condición fiscal (A/B/C) --------------------------------------------------

// Los únicos condicionIva que Delfino puede reconocer HOY con confianza son los que produce su
// propia consulta al padrón de ARCA (ver condicionIvaDesdePersonaA5 en functions/index.js):
// "Responsable Inscripto" o "Monotributista..." (con o sin categoría). Cualquier otra cosa —
// "IVA dado de baja", "No inscripto en IVA", null (nunca consultado / carga manual sin este dato),
// o un string que no matchea ninguno de los dos patrones — se trata como NO CATEGORIZADO. Nunca se
// asume "debe ser Consumidor Final" ni "debe ser Responsable Inscripto" a partir de un dato
// ambiguo: eso sería inventar un default fiscal en silencio.
function normalizarCondicionFiscal(condicionIva) {
  if (!condicionIva) return null;
  const texto = condicionIva.trim();
  if (texto === "Responsable Inscripto") return "RESPONSABLE_INSCRIPTO";
  if (texto.startsWith("Monotributista")) return "MONOTRIBUTO";
  return null; // incluye "IVA dado de baja", "No inscripto en IVA", y cualquier texto no reconocido
}

// emisorCondicionIva: la de configuracion/empresa (Delfino Hogar). receptor: { cuit, condicionIva }
// tal como vienen en el comprobante (ver datosClienteDesde en js/facturacion.js).
//
// Regla estándar de ARCA (sin excepciones ni casos especiales en el modelo actual de Delfino):
//   Emisor Responsable Inscripto + receptor Responsable Inscripto (con CUIT) → Factura A
//   Emisor Responsable Inscripto + cualquier otro receptor                  → Factura B
//   Emisor Monotributista (cualquier receptor)                              → Factura C
// Un emisor "Exento" no está contemplado porque Delfino nunca lo produce como resultado de
// normalizarCondicionFiscal (ver nota arriba) — si algún día existe, hace falta agregarlo acá
// explícitamente, no asumir que se comporta como Monotributo.
function determinarTipoComprobante({ emisorCondicionIva, receptorCuit, receptorCondicionIva }) {
  const emisor = normalizarCondicionFiscal(emisorCondicionIva);
  if (!emisor) {
    throw new HttpsError(
      "failed-precondition",
      `No se puede determinar el tipo de comprobante: la condición frente al IVA del emisor (Delfino Hogar) no está cargada o no se reconoce ("${emisorCondicionIva || "sin dato"}"). Consultá el padrón de ARCA para Delfino Hogar en Configuración → Empresa.`
    );
  }

  if (emisor === "MONOTRIBUTO") {
    return { cbteTipo: arcaWsfe.CBTE_TIPO.FACTURA_C, letra: "C", esFacturaC: true };
  }

  // Emisor Responsable Inscripto de acá en más.
  const receptor = normalizarCondicionFiscal(receptorCondicionIva);
  const receptorTieneCuitValido = limpiarCuit(receptorCuit).length === 11;

  if (receptor === "RESPONSABLE_INSCRIPTO" && receptorTieneCuitValido) {
    return { cbteTipo: arcaWsfe.CBTE_TIPO.FACTURA_A, letra: "A", esFacturaC: false };
  }
  // Monotributo, no categorizado, Consumidor Final, o RI sin CUIT cargado (dato inconsistente,
  // pero no bloqueante — cae a B como cualquier receptor no-RI, que es lo que ARCA espera igual).
  return { cbteTipo: arcaWsfe.CBTE_TIPO.FACTURA_B, letra: "B", esFacturaC: false };
}

// docTipo/docNro del receptor. Delfino guarda un solo campo "cuit" para CUIT o DNI indistintamente
// (ver comentario en datosClienteDesde, js/facturacion.js: "el ERP no distingue DNI de CUIT hoy")
// — se infiere por longitud, ÚNICA señal disponible hoy: 11 dígitos = CUIT, si no = DNI. Esto es
// una inferencia, no una garantía (documentado en el informe final como dato que falta modelar).
function determinarDocumentoReceptor(cuit, letra) {
  const limpio = limpiarCuit(cuit);
  if (limpio.length === 11) return { docTipo: arcaWsfe.DOC_TIPO.CUIT, docNro: limpio };
  if (letra === "A") {
    // Factura A SIEMPRE exige un CUIT válido de un Responsable Inscripto — si llegamos hasta acá
    // sin uno, es una inconsistencia real (determinarTipoComprobante ya debería haber elegido B en
    // este caso) — se corta acá en vez de mandarle a ARCA un DocTipo que sabemos que va a rechazar.
    throw new HttpsError("failed-precondition", "Factura A requiere un CUIT válido del receptor (11 dígitos) y no se encontró uno.");
  }
  if (limpio.length > 0) return { docTipo: arcaWsfe.DOC_TIPO.DNI, docNro: limpio };
  return { docTipo: arcaWsfe.DOC_TIPO.CONSUMIDOR_FINAL, docNro: "0" };
}

// --- Importes / IVA por alícuota ------------------------------------------------------------------

// Re-consulta cada producto por su propio ID para sacar la alícuota de IVA (producto.iva, %) — este
// dato YA EXISTE en el catálogo (se usa para el cálculo de margen, ver productos-form.js) pero se
// pierde en el camino: ni venta.items ni comprobante.items lo llevan (ver informe final, punto J).
// Reconsultarlo acá evita tener que tocar venta-nueva.js/ventas.js/facturacion.js para esto —
// la integración fiscal queda contenida en su propio módulo, como se pidió.
//
// Limitación documentada: si el producto cambia de alícuota DESPUÉS de la venta pero ANTES de que
// se autorice el comprobante fiscal, se usa la alícuota ACTUAL, no la vigente al momento de vender.
// En esta arquitectura la autorización ocurre sincrónicamente al crear el comprobante, así que la
// ventana es prácticamente nula — pero queda anotado, no oculto.
//
// items: [{ productoId, cantidad, precioUnitario, descuentoPct }] — precioUnitario es SIEMPRE precio
// final con IVA incluido (confirmado: productos-form.js arma precioVenta como margen sobre
// costoConIva, nunca al revés). Devuelve { importeNeto, importeIva, importeTotal, ivaPorAlicuota }.
async function calcularImportesFiscales(db, items) {
  const ivaPorAlicuota = new Map(); // alicuota (%) -> { baseImponible, importeIva }
  let importeTotal = 0;

  for (const item of items) {
    if (!item.productoId) {
      throw new HttpsError(
        "failed-precondition",
        `El ítem "${item.productoDescripcion || item.productoSku || "sin descripción"}" no tiene productoId — no se puede saber su alícuota de IVA (esto pasa con comprobantes cargados sueltos, sin producto de catálogo; hoy no se pueden autorizar fiscalmente).`
      );
    }
    const snap = await db.collection("productos").doc(item.productoId).get();
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", `Producto ${item.productoId} no encontrado — no se puede determinar su alícuota de IVA.`);
    }
    const alicuota = snap.data().iva;
    if (alicuota == null) {
      throw new HttpsError("failed-precondition", `El producto "${snap.data().descripcion || item.productoId}" no tiene cargado el campo IVA (%).`);
    }

    const totalItemConIva = Math.round(item.cantidad * item.precioUnitario * (1 - (item.descuentoPct || 0) / 100) * 100) / 100;
    const neto = Math.round((totalItemConIva / (1 + alicuota / 100)) * 100) / 100;
    const ivaItem = Math.round((totalItemConIva - neto) * 100) / 100;

    importeTotal += totalItemConIva;
    const acumulado = ivaPorAlicuota.get(alicuota) || { baseImponible: 0, importeIva: 0 };
    acumulado.baseImponible += neto;
    acumulado.importeIva += ivaItem;
    ivaPorAlicuota.set(alicuota, acumulado);
  }

  const redondear = (v) => Math.round(v * 100) / 100;
  const ivaPorAlicuotaArray = Array.from(ivaPorAlicuota, ([alicuotaIva, v]) => ({
    alicuotaIva,
    baseImponible: redondear(v.baseImponible),
    importeIva: redondear(v.importeIva),
  }));
  const importeIva = redondear(ivaPorAlicuotaArray.reduce((acc, l) => acc + l.importeIva, 0));
  const importeNeto = redondear(importeTotal - importeIva);

  return { importeTotal: redondear(importeTotal), importeNeto, importeIva, ivaPorAlicuota: ivaPorAlicuotaArray };
}

// --- Concurrencia: lock por punto de venta + tipo de comprobante ---------------------------------

// FECompUltimoAutorizado + FECAESolicitar juntos NO son atómicos — dos cajas pidiendo un comprobante
// del mismo ptoVta+cbteTipo al mismo tiempo podrían leer el mismo "último" y competir por el mismo
// "siguiente". Se serializa con un lock corto en Firestore (transacción — fuerte consistencia real,
// no una convención) ANTES de tocar ARCA. Vencimiento de 30s: si algo se cuelga (función caída a
// mitad de camino), no deja el punto de venta bloqueado para siempre.
//
// Esto alcanza para esta etapa (una sola caja/comercio probando). Para producción con varias cajas
// simultáneas facturando fiscal en volumen, la recomendación estándar es directamente serializar
// TODA la facturación fiscal por una sola Cloud Function con concurrencia 1 (o una cola), no
// múltiples instancias compitiendo por el mismo lock — documentado como pendiente de 2da etapa.
//
// IMPORTANTE — por qué 30s es seguro y no una carrera disfrazada: este valor está IGUALADO A
// PROPÓSITO con el timeoutSeconds:30 de arcaAutorizarComprobante (ver el onCall más abajo). Si
// FECompUltimoAutorizado + FECAESolicitar tardan más de 30s, Cloud Functions mata la ejecución por
// timeout ANTES de que el lock pueda considerarse "vencido" por nadie más — nunca hay una ventana
// real donde la operación original sigue viva Y una segunda solicitud ya la trata como abandonada.
// Si algún día se cambia timeoutSeconds, este valor tiene que cambiar junto — no son casualidad.
const VENCIMIENTO_LOCK_MS = 30_000;

async function conLockNumeracion(db, ptoVta, cbteTipo, fn) {
  const lockRef = db.collection("arcaNumeracionLocks").doc(`${ptoVta}_${cbteTipo}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.exists ? snap.data() : null;
    const tomadoHaceMs = data?.tomadoEn ? Date.now() - data.tomadoEn.toMillis() : Infinity;
    if (data && tomadoHaceMs < VENCIMIENTO_LOCK_MS) {
      throw new HttpsError("aborted", "Ya hay una autorización de ARCA en curso para este punto de venta y tipo de comprobante — probá de nuevo en unos segundos.");
    }
    tx.set(lockRef, { tomadoEn: admin.firestore.FieldValue.serverTimestamp() });
  });
  try {
    return await fn();
  } finally {
    await lockRef.delete().catch(() => {});
  }
}

// --- Callable: autorizar comprobante --------------------------------------------------------------

// data: { comprobanteId, ptoVta, items, receptor: { cuit, condicionIva }, ambiente }
// (comprobanteId es la clave de idempotencia: ver el chequeo al principio)
const arcaAutorizarComprobante = onCall(
  // timeoutSeconds igualado a VENCIMIENTO_LOCK_MS (conLockNumeracion, arriba) a propósito — no
  // cambiar uno sin el otro, ver el comentario ahí.
  { region: "southamerica-east1", secrets: [afipCert, afipKey, afipCuit, afipCertHomo, afipKeyHomo, afipCuitHomo], timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
    const { comprobanteId, ptoVta, items, receptor, ambiente } = request.data || {};
    if (!comprobanteId) throw new HttpsError("invalid-argument", "Falta comprobanteId.");
    if (!ptoVta) throw new HttpsError("invalid-argument", "Falta ptoVta.");
    if (!Array.isArray(items) || items.length === 0) throw new HttpsError("invalid-argument", "Faltan items.");
    if (ambiente !== "testing" && ambiente !== "produccion") throw new HttpsError("invalid-argument", 'ambiente debe ser "testing" o "produccion".');

    const db = admin.firestore();

    // Idempotencia: si este comprobante YA tiene un resultado fiscal terminal (AUTHORIZED o
    // REJECTED), se devuelve ese resultado tal cual — nunca se vuelve a llamar a ARCA para el mismo
    // comprobanteId. Cubre doble click, timeout del cliente con reintento, y "el usuario vuelve a
    // intentar" (puntos 11 del pedido) sin arriesgar un segundo CAE para la misma operación.
    const comprobanteRef = db.collection("comprobantes").doc(comprobanteId);
    const comprobanteSnap = await comprobanteRef.get();
    if (!comprobanteSnap.exists) throw new HttpsError("not-found", "No se encontró el comprobante.");
    const comprobanteActual = comprobanteSnap.data();
    if (comprobanteActual.arcaEstado === "AUTHORIZED" || comprobanteActual.arcaEstado === "REJECTED") {
      return extraerResultadoFiscal(comprobanteActual);
    }

    const { cert, key, cuit } = credencialesParaAmbiente(ambiente);
    // Si ARCA ya respondió con un CAE real pero algo después falla (ej. comprobanteRef.update),
    // ese CAE NO puede perderse sin dejar rastro — quedaría autorizado del lado de ARCA y
    // "PENDING_ARCA" para siempre del lado de Delfino, sin ninguna forma de recuperarlo. Por eso
    // queda en una variable de este scope: el catch de abajo, si ve que ya se llegó a tener un
    // datosFiscales armado, lo deja registrado en el log aunque el resto de la operación haya
    // fallado (no soluciona el problema de fondo — sigue siendo una limitación de esta etapa, ver
    // informe — pero evita que la información se pierda del todo).
    let datosFiscales = null;

    try {
      const empresaSnap = await db.collection("configuracion").doc("empresa").get();
      const emisorCondicionIva = empresaSnap.data()?.condicionIva;

      const { cbteTipo, letra, esFacturaC } = determinarTipoComprobante({
        emisorCondicionIva,
        receptorCuit: receptor?.cuit,
        receptorCondicionIva: receptor?.condicionIva,
      });
      const { docTipo, docNro } = determinarDocumentoReceptor(receptor?.cuit, letra);
      const { importeTotal, importeNeto, importeIva, ivaPorAlicuota } = await calcularImportesFiscales(db, items);

      const resultado = await conLockNumeracion(db, ptoVta, cbteTipo, async () => {
        const ultimo = await arcaWsfe.obtenerUltimoAutorizado({ ptoVta, cbteTipo, cuit, cert, key, ambiente });
        await registrarLog(db, { tipoOperacion: "consultar_ultimo_autorizado", resultado: "ok", ptoVta, cbteTipo, ambiente });
        const cbteNro = ultimo + 1;

        const respuesta = await arcaWsfe.solicitarCae({
          ptoVta,
          cbteTipo,
          docTipo,
          docNro,
          cbteNro,
          importeTotal,
          importeNeto,
          importeIva,
          ivaPorAlicuota,
          esFacturaC,
          cuit,
          cert,
          key,
          ambiente,
        });
        return { ...respuesta, cbteNro };
      });

      const aprobado = resultado.resultadoDetalle === "A";
      await registrarLog(db, {
        tipoOperacion: "fecae_solicitar",
        resultado: aprobado ? "ok" : "error",
        ptoVta,
        cbteTipo,
        ambiente,
        mensajeError: aprobado ? null : resultado.observaciones.map((o) => `[${o.codigo}] ${o.mensaje}`).join("; ") || "Rechazado sin observaciones",
      });

      datosFiscales = {
        arcaEstado: aprobado ? "AUTHORIZED" : "REJECTED",
        cae: aprobado ? resultado.cae : null,
        caeVencimiento: aprobado ? resultado.caeFchVto : null,
        qr: null, // QR fiscal: no implementado todavía (ver informe final)
        numeroFiscal: aprobado ? resultado.cbteNro : null,
        tipoComprobanteFiscal: letra,
        fechaAutorizacion: aprobado ? admin.firestore.FieldValue.serverTimestamp() : null,
        arcaErrorCodigo: resultado.observaciones[0]?.codigo || resultado.erroresGenerales[0]?.codigo || null,
        arcaErrorDescripcion:
          resultado.observaciones.map((o) => o.mensaje).concat(resultado.erroresGenerales.map((e) => e.mensaje)).join("; ") || null,
      };

      await comprobanteRef.update({ ...datosFiscales, actualizadoEn: admin.firestore.FieldValue.serverTimestamp() });
      return extraerResultadoFiscal(datosFiscales);
    } catch (err) {
      // Si ya teníamos un resultado de ARCA (incluido un CAE real) cuando esto explotó, el mensaje
      // de log lo incluye explícitamente — es la única forma de recuperarlo a mano después, dado
      // que el comprobante en Firestore se quedó en PENDING_ARCA (ver comentario arriba).
      const mensajeError = datosFiscales?.cae
        ? `CAE YA EMITIDO POR ARCA (${datosFiscales.cae}, comprobante ${datosFiscales.numeroFiscal}) pero falló un paso posterior — revisar manualmente. Error: ${err.message}`
        : err.message;
      await registrarLog(db, { tipoOperacion: "fecae_solicitar", resultado: "error", ptoVta, ambiente, mensajeError });
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("unknown", "No se pudo autorizar el comprobante con ARCA: " + err.message);
    }
  }
);

function extraerResultadoFiscal(doc) {
  return {
    arcaEstado: doc.arcaEstado,
    cae: doc.cae,
    caeVencimiento: doc.caeVencimiento,
    qr: doc.qr,
    numeroFiscal: doc.numeroFiscal,
    tipoComprobanteFiscal: doc.tipoComprobanteFiscal,
    fechaAutorizacion: doc.fechaAutorizacion,
    arcaErrorCodigo: doc.arcaErrorCodigo,
    arcaErrorDescripcion: doc.arcaErrorDescripcion,
  };
}

module.exports = {
  arcaAutorizarComprobante,
  // Exportados solo para poder testear la lógica pura sin desplegar (ver script de pruebas) — no
  // son parte de la superficie pública de la integración.
  __testing: { normalizarCondicionFiscal, determinarTipoComprobante, determinarDocumentoReceptor, calcularImportesFiscales },
};
