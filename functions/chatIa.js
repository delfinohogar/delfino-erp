// Botón de chat del ERP: le hace preguntas a Claude sobre los datos reales del sistema.
// Claude decide qué herramientas de solo-lectura llamar (nunca puede escribir nada) y arma la
// respuesta con lo que esas herramientas le devuelven — no inventa números.
//
// Requiere el secret:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// Campos que un rol "vendedor" no debería ver (mismo criterio que se aplica en la UI del ERP).
const CAMPOS_SENSIBLES = ["costoReferencia", "costoModo", "margenObjetivo", "margenMinimo"];

function filtrarPorRol(producto, rol) {
  if (rol !== "vendedor") return producto;
  const copia = { ...producto };
  CAMPOS_SENSIBLES.forEach((c) => delete copia[c]);
  return copia;
}

function resumenProducto(p) {
  return {
    id: p.id,
    sku: p.sku,
    descripcion: p.descripcion,
    marca: p.marcaNombre,
    estado: p.estado,
    stockTotal: p.stockTotal,
    stockMinimo: p.stockMinimo,
    precioVenta: p.precioVenta,
    costoReferencia: p.costoReferencia,
    costoModo: p.costoModo,
    margenObjetivo: p.margenObjetivo,
    margenMinimo: p.margenMinimo,
  };
}

// Fecha de hoy en zona horaria Argentina, como "YYYY-MM-DD" — mismo formato en que se guardan
// fecha/fechaVencimiento de las compras, para poder comparar por string sin parsear.
function fechaHoyArgentina() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

// Saldo pendiente de una factura de compra: su total menos la suma de pagos atados a esa compra.
function resumenFactura(compra, pagos) {
  const pagado = pagos
    .filter((p) => p.compraId === compra.id)
    .reduce((acc, p) => acc + (p.monto || 0), 0);
  return {
    compraId: compra.id,
    proveedorNombre: compra.proveedorNombre,
    tipoComprobante: compra.tipoComprobante,
    numeroFactura: compra.numeroFactura,
    fecha: compra.fecha,
    fechaVencimiento: compra.fechaVencimiento || null,
    total: compra.total || 0,
    pagado: Math.round(pagado * 100) / 100,
    saldoPendiente: Math.round(((compra.total || 0) - pagado) * 100) / 100,
  };
}

async function buscarProveedorPorTexto(db, texto) {
  const snap = await db.collection("proveedores").limit(200).get();
  const t = texto.toLowerCase();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .find((p) => (p.razonSocialLower || "").includes(t) || (p.cuit || "").includes(texto));
}

const HERRAMIENTAS = [
  {
    name: "buscar_productos",
    description: "Busca productos por texto (SKU, código de barras, descripción o marca), opcionalmente filtrando por estado.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Palabra a buscar (ej. una marca, un modelo, una categoría)" },
        estado: { type: "string", enum: ["activo", "inactivo"] },
      },
    },
  },
  {
    name: "stock_bajo_minimo",
    description:
      "Devuelve los productos activos cuyo stock total está en o por debajo de su stock mínimo de alerta, con una " +
      "cantidad sugerida de compra (stock mínimo menos stock actual). Usar para '¿qué tiene poco stock?' o " +
      "'¿qué productos debería comprar?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "obtener_producto",
    description: "Trae el detalle completo de un producto puntual, por su SKU o por su ID de documento.",
    input_schema: {
      type: "object",
      properties: { skuOId: { type: "string" } },
      required: ["skuOId"],
    },
  },
  {
    name: "historial_producto",
    description: "Trae el historial de cambios y de costos de un producto. Requiere el ID de documento (usar obtener_producto primero si solo se tiene el SKU).",
    input_schema: {
      type: "object",
      properties: { productoId: { type: "string" } },
      required: ["productoId"],
    },
  },
  {
    name: "datos_proveedor",
    description: "Busca un proveedor por razón social o CUIT.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
    },
  },
  {
    name: "cuenta_corriente_proveedor",
    description:
      "Trae la cuenta corriente de un proveedor puntual: saldo total adeudado y el detalle de sus facturas de " +
      "compra con saldo pendiente (impagas o pagadas parcialmente). Usar para '¿cuánto le debemos a este " +
      "proveedor?' o '¿qué facturas de tal proveedor tenemos pendientes?'. Buscar por razón social o CUIT.",
    input_schema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
    },
  },
  {
    name: "facturas_por_vencer",
    description:
      "Lista, de todos los proveedores, las facturas de compra con saldo pendiente de pago (impagas o parciales), " +
      "ordenadas por fecha de vencimiento (las sin fecha de vencimiento cargada quedan al final). Incluye las ya " +
      "vencidas. Usar para 'facturas de proveedores', '¿qué hay que pagar?' o '¿qué vence esta semana/este mes?' " +
      "— para acotar a un rango desde hoy, pasar diasHaciaAdelante.",
    input_schema: {
      type: "object",
      properties: {
        diasHaciaAdelante: {
          type: "number",
          description: "Solo facturas que vencen dentro de estos días desde hoy. Omitir para traer todas las pendientes.",
        },
      },
    },
  },
];

async function ejecutarHerramienta(nombre, input, rol) {
  const db = admin.firestore();

  switch (nombre) {
    case "buscar_productos": {
      let productos;
      if (input.texto) {
        const primeraPalabra = input.texto.toLowerCase().trim().split(/\s+/)[0];
        const snap = await db.collection("productos").where("searchKeywords", "array-contains", primeraPalabra).limit(30).get();
        productos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } else {
        const snap = await db.collection("productos").limit(30).get();
        productos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      if (input.estado) productos = productos.filter((p) => p.estado === input.estado);
      return productos.slice(0, 15).map((p) => filtrarPorRol(resumenProducto(p), rol));
    }

    case "stock_bajo_minimo": {
      const snap = await db.collection("productos").where("estado", "==", "activo").get();
      const bajos = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => (p.stockTotal ?? 0) <= (p.stockMinimo ?? 0))
        .map((p) => ({
          ...filtrarPorRol(resumenProducto(p), rol),
          cantidadSugerida: Math.max((p.stockMinimo ?? 0) - (p.stockTotal ?? 0), 0),
        }))
        .sort((a, b) => b.cantidadSugerida - a.cantidadSugerida);
      return bajos.slice(0, 30);
    }

    case "obtener_producto": {
      let doc = await db.collection("productos").doc(input.skuOId).get();
      if (!doc.exists) {
        const snap = await db.collection("productos").where("sku", "==", input.skuOId).limit(1).get();
        doc = snap.docs[0];
      }
      if (!doc || !doc.exists) return { error: "No se encontró el producto." };
      return filtrarPorRol(resumenProducto({ id: doc.id, ...doc.data() }), rol);
    }

    case "historial_producto": {
      const productoRef = db.collection("productos").doc(input.productoId);
      const [logSnap, costoSnap] = await Promise.all([
        productoRef.collection("logAuditoria").orderBy("fecha", "desc").limit(20).get(),
        productoRef.collection("historialCostos").orderBy("fecha", "desc").limit(20).get(),
      ]);
      return {
        cambios: logSnap.docs.map((d) => d.data()),
        costos: rol === "vendedor" ? "No disponible para tu rol." : costoSnap.docs.map((d) => d.data()),
      };
    }

    case "datos_proveedor": {
      const snap = await db.collection("proveedores").limit(100).get();
      const t = input.texto.toLowerCase();
      const encontrados = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => (p.razonSocialLower || "").includes(t) || (p.cuit || "").includes(input.texto));
      return encontrados.slice(0, 5);
    }

    case "cuenta_corriente_proveedor": {
      const proveedor = await buscarProveedorPorTexto(db, input.texto);
      if (!proveedor) return { error: "No se encontró ese proveedor." };

      const [comprasSnap, pagosSnap] = await Promise.all([
        db.collection("compras").where("proveedorId", "==", proveedor.id).get(),
        db.collection("pagosProveedores").where("proveedorId", "==", proveedor.id).get(),
      ]);
      const compras = comprasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const pagos = pagosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const totalCompras = compras.reduce((acc, c) => acc + (c.total || 0), 0);
      const totalPagos = pagos.reduce((acc, p) => acc + (p.monto || 0), 0);
      const facturasPendientes = compras
        .map((c) => resumenFactura(c, pagos))
        .filter((f) => f.saldoPendiente > 0.01)
        .sort((a, b) => (a.fechaVencimiento || "9999").localeCompare(b.fechaVencimiento || "9999"));

      return {
        proveedor: proveedor.razonSocial,
        saldoAdeudado: Math.round((totalCompras - totalPagos) * 100) / 100,
        facturasPendientes,
      };
    }

    case "facturas_por_vencer": {
      const [comprasSnap, pagosSnap] = await Promise.all([
        db.collection("compras").get(),
        db.collection("pagosProveedores").get(),
      ]);
      const compras = comprasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const pagos = pagosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      let facturas = compras.map((c) => resumenFactura(c, pagos)).filter((f) => f.saldoPendiente > 0.01);

      if (typeof input.diasHaciaAdelante === "number") {
        const limite = new Date();
        limite.setDate(limite.getDate() + input.diasHaciaAdelante);
        const limiteStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(limite);
        facturas = facturas.filter((f) => f.fechaVencimiento && f.fechaVencimiento <= limiteStr);
      }

      facturas.sort((a, b) => (a.fechaVencimiento || "9999").localeCompare(b.fechaVencimiento || "9999"));
      return facturas.slice(0, 50);
    }

    default:
      return { error: "Herramienta desconocida: " + nombre };
  }
}

exports.chatConsulta = onCall({ region: "southamerica-east1", secrets: [anthropicApiKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Hay que estar logueado para usar el chat.");
  }

  const mensaje = (request.data?.mensaje || "").toString().trim();
  if (!mensaje) {
    throw new HttpsError("invalid-argument", "Falta el mensaje.");
  }

  const perfilSnap = await admin.firestore().collection("usuarios").doc(request.auth.uid).get();
  const rol = perfilSnap.exists ? perfilSnap.data().rol : "vendedor";

  const anthropic = new Anthropic({ apiKey: anthropicApiKey.value().trim() });

  const historialPrevio = Array.isArray(request.data?.historial) ? request.data.historial : [];
  const mensajes = [...historialPrevio, { role: "user", content: mensaje }];

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const respuesta = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system:
        "Sos el asistente de datos del ERP de Delfino Hogar (retail de electrodomésticos). Respondé en español " +
        "rioplatense, corto y concreto, basándote solo en los datos que te devuelven las herramientas — nunca " +
        "inventes números. Si no encontrás algo con las herramientas, decilo directamente en vez de suponer. " +
        `Hoy es ${fechaHoyArgentina()} (America/Argentina/Buenos_Aires) — usá esa fecha como referencia para ` +
        "preguntas relativas (\"esta semana\", \"este mes\", \"vencidas\").",
      tools: HERRAMIENTAS,
      messages: mensajes,
    });

    if (respuesta.stop_reason !== "tool_use") {
      const texto = respuesta.content.find((b) => b.type === "text")?.text || "";
      return { respuesta: texto, historial: [...mensajes, { role: "assistant", content: respuesta.content }] };
    }

    mensajes.push({ role: "assistant", content: respuesta.content });

    const resultadosHerramientas = [];
    for (const bloque of respuesta.content) {
      if (bloque.type !== "tool_use") continue;
      let resultado;
      try {
        resultado = await ejecutarHerramienta(bloque.name, bloque.input || {}, rol);
      } catch (err) {
        resultado = { error: err.message };
      }
      resultadosHerramientas.push({
        type: "tool_result",
        tool_use_id: bloque.id,
        content: JSON.stringify(resultado),
      });
    }
    mensajes.push({ role: "user", content: resultadosHerramientas });
  }

  throw new HttpsError("internal", "La consulta se volvió demasiado larga — probá con una pregunta más puntual.");
});
