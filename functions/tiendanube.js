// Integración con Tienda Nube — SOLO lectura de pedidos por ahora (app separada de la que usa GBP
// para stock/precio, con scope read_orders — nunca toca stock ni precios de Tiendanube). Ver
// docs/tiendanube-integracion.md para el diseño completo.
//
// Flujo: Tienda Nube manda un webhook con {store_id, event, id} (el id de la orden, NADA más — hay
// que pedir el pedido completo aparte) → se valida la firma → se trae el pedido completo → se
// registra en ordenesTiendaNube (idempotente por id externo, igual que ya hacía la versión cliente
// de esta función) → si el pago está confirmado, queda listo para procesarse (ver
// js/tiendanube-sync.js: procesarOrdenTiendaNube, todavía sin conectar automáticamente — un admin lo
// dispara a mano desde la pantalla de órdenes, a propósito, para no crear ventas sin supervisión en
// esta primera etapa).
//
// Documentación oficial consultada el 02/09/2026 (tiendanube.github.io/api-documentation):
//   - Auth: header "Authentication: bearer {token}" (NO "Authorization: Bearer", ese es el estándar
//     genérico — Tiendanube usa su propio nombre de header, confirmado con una llamada real).
//   - Webhook: header "x-linkedstore-hmac-sha256" = HMAC-SHA256(body crudo, client_secret).
//   - GET /{store_id}/orders/{id} — pedido completo. Confirmado con una llamada real que la forma de
//     cliente es CAMPOS PLANOS (contact_name, contact_email, contact_phone, billing_*), NO un objeto
//     "customer" anidado como sugiere la documentación genérica.
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const accessToken = defineSecret("TIENDANUBE_ACCESS_TOKEN");
const clientSecret = defineSecret("TIENDANUBE_CLIENT_SECRET");

const STORE_ID = "4363883";
const API_BASE = `https://api.tiendanube.com/2025-03/${STORE_ID}`;
const USER_AGENT = "Delfino ERP (gasti.delfino@gmail.com)";

async function tnFetch(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authentication: `bearer ${token}`, "User-Agent": USER_AGENT },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = data ? JSON.stringify(data) : `HTTP ${res.status}`;
    throw new Error(`Tienda Nube (${path}) respondió ${res.status}: ${detalle}`);
  }
  return data;
}

async function registrarLog(db, { tipoOperacion, resultado, idExterno = null, mensajeError = null }) {
  await db.collection("logIntegracionTiendaNube").add({
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    tipoOperacion,
    resultado,
    idExterno,
    mensajeError,
  });
}

// El pedido completo de Tiendanube tiene ~50 campos (ver comentario de cabecera) — se mapea acá a la
// forma que ya espera Firestore (ordenesTiendaNube), sin guardar el pedido crudo entero (no hace
// falta, y evita depender de un formato que Tiendanube puede cambiar sin avisar en campos que no
// usamos). billing_customer_type/state_registration/document_type están para el día que factures
// vía ARCA una venta que ya tiene datos fiscales cargados desde Tiendanube — hoy no se usan.
function mapearOrden(pedido) {
  const primerFulfillment = pedido.fulfillments?.[0];
  const esRetiro = primerFulfillment?.shipping?.type === "pickup";
  return {
    idExterno: String(pedido.id),
    numeroOrden: pedido.number || null,
    fecha: pedido.created_at || null,
    cliente: {
      nombre: pedido.contact_name || pedido.billing_name || null,
      email: pedido.contact_email || null,
      telefono: pedido.contact_phone || null,
      identificacion: pedido.contact_identification || null,
      domicilio: [pedido.billing_address, pedido.billing_number].filter(Boolean).join(" ") || null,
      localidad: pedido.billing_locality || pedido.billing_city || null,
    },
    items: (pedido.products || []).map((p) => ({
      sku: p.sku || null,
      productoIdExterno: String(p.product_id),
      nombre: p.name || null,
      cantidad: Number(p.quantity) || 1,
      precioUnitario: Number(p.price) || 0,
    })),
    total: Number(pedido.total) || 0,
    moneda: pedido.currency || "ARS",
    medioPago: pedido.gateway_name || pedido.gateway || null,
    tipoEntrega: esRetiro ? "Retira ahora" : "Envío a domicilio",
    domicilioEntrega: esRetiro
      ? null
      : [pedido.shipping_address?.address, pedido.shipping_address?.number, pedido.shipping_address?.city].filter(Boolean).join(", ") || null,
    estado: pedido.status || null, // open | closed | cancelled (de Tiendanube, no confundir con el estado interno de ordenesTiendaNube)
    estadoPago: mapearEstadoPago(pedido.payment_status),
  };
}

// Tiendanube: pending | authorized | paid | partially_paid | abandoned | refunded |
// partially_refunded | voided. Delfino solo necesita distinguir 4 categorías (ver
// docs/tiendanube-integracion.md, "no asumir cobrado solo porque la orden existe") — "authorized" NO
// es lo mismo que pagado (una autorización puede caerse), así que NO cuenta como aprobado acá.
function mapearEstadoPago(estadoTn) {
  if (estadoTn === "paid") return "aprobado";
  if (estadoTn === "refunded" || estadoTn === "partially_refunded") return "reembolsado";
  if (estadoTn === "voided" || estadoTn === "abandoned") return "rechazado";
  return "pendiente"; // pending, authorized, partially_paid, o cualquier valor nuevo no contemplado
}

// Idempotente por diseño: el id del documento ES el id externo de la orden — un reintento de webhook
// (timeout, doble entrega) escribe el mismo id, que es un no-op si ya existía. Ver
// docs/tiendanube-integracion.md sección "Idempotencia".
async function registrarOrdenTiendaNube(db, datosOrden) {
  const ref = db.collection("ordenesTiendaNube").doc(datosOrden.idExterno);
  const existente = await ref.get();
  if (existente.exists) return { yaExistia: true };

  await ref.set({
    ...datosOrden,
    estado: "recibida", // recibida | procesada | error — distinto del "status" propio de Tiendanube
    ventaId: null,
    facturaId: null,
    procesadoEn: null,
    error: null,
    recibidaEn: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { yaExistia: false };
}

// --- Webhook ---------------------------------------------------------------------------------
// Tiendanube manda SOLO {store_id, event, id} — nunca el pedido completo. Por eso el primer paso
// siempre es pedir el detalle a la API antes de poder registrar nada útil.
const tnWebhook = onRequest({ region: "southamerica-east1", secrets: [accessToken, clientSecret] }, async (req, res) => {
  const db = admin.firestore();

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // rawBody: Cloud Functions v2 lo expone tal cual llegó, necesario porque el HMAC se calcula sobre
  // el body CRUDO — si se recalcula desde req.body (ya parseado a objeto) el JSON.stringify podría
  // no coincidir byte a byte con lo que Tiendanube firmó (orden de claves, espacios).
  const firmaRecibida = req.headers["x-linkedstore-hmac-sha256"];
  const firmaCalculada = crypto.createHmac("sha256", clientSecret.value()).update(req.rawBody).digest("hex");
  if (!firmaRecibida || firmaRecibida !== firmaCalculada) {
    await registrarLog(db, { tipoOperacion: "webhook", resultado: "error", mensajeError: "Firma inválida" });
    res.status(401).send("Invalid signature");
    return;
  }

  const { event, id } = req.body || {};
  if (!id || !event) {
    res.status(200).send("ok"); // notificación sin id/event no tiene nada que procesar, pero no es un error de Tiendanube
    return;
  }
  if (!event.startsWith("order/")) {
    res.status(200).send("ok"); // solo nos importan eventos de orden — cualquier otro se ignora en silencio
    return;
  }

  try {
    const pedido = await tnFetch(`/orders/${id}`, accessToken.value());
    const datosOrden = mapearOrden(pedido);
    const resultado = await registrarOrdenTiendaNube(db, datosOrden);
    await registrarLog(db, { tipoOperacion: `webhook_${event}`, resultado: "ok", idExterno: datosOrden.idExterno, mensajeError: resultado.yaExistia ? "ya existía (idempotente)" : null });
    res.status(200).send("ok");
  } catch (err) {
    await registrarLog(db, { tipoOperacion: `webhook_${event}`, resultado: "error", idExterno: String(id), mensajeError: err.message });
    // 200 igual: si el error es nuestro, que Tiendanube reintente cada 5/10/15min no lo arregla solo
    // (mismo criterio que mpWebhook) — queda en el log para revisar a mano.
    res.status(200).send("logged");
  }
});

module.exports = { tnWebhook, mapearOrden, mapearEstadoPago };
