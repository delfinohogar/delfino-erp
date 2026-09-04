// Integración de Mercado Pago Point (pagos presenciales, con terminal) — SOLO entorno de pruebas
// por ahora. Se usa la Orders API (no Checkout API): el flujo real de Delfino Hogar es "el cliente
// acerca la tarjeta al lector", no tipear un número de tarjeta.
//
// Documentación oficial consultada para esta implementación (nada inventado):
//   - Credenciales de prueba: your-integrations/test/accounts, mp-point/integration-test
//     (prefijo "TEST-" para access token; "APP_USR-" es producción)
//   - Crear orden (Point): POST https://api.mercadopago.com/v1/orders
//     body: { type:"point", external_reference, transactions:{payments:[{amount}]},
//             config:{point:{terminal_id}}, expiration_time }
//   - Consultar orden: GET https://api.mercadopago.com/v1/orders/{id}
//   - Cancelar orden: POST https://api.mercadopago.com/v1/orders/{id}/cancel
//   - Reembolsar orden: POST https://api.mercadopago.com/v1/orders/{id}/refund
//     (sin body = total; { transactions: [{ id: transactionId, amount }] } = parcial, donde
//     transactionId es transactions.payments[0].id de la orden, NO el orderId — la doc pública
//     muestra "amount" suelto en el body pero la API vigente lo rechaza, confirmado a mano)
//     LIMITACIÓN CONFIRMADA (dos pruebas separadas, 02/09/2026): un pago generado por /events
//     (simulación) NO se puede reembolsar de verdad — MP devuelve 412
//     "refund_not_possible_simulation_payment". Además, la propia documentación de MP dice que se
//     puede simular el estado "refunded" de una orden ya "processed" mandando POST /events con
//     {status:"refunded"} — probado dos veces (con log de diagnóstico del body crudo del webhook
//     incluido) y el resultado real fue: la API responde 204 igual que con processed/failed/
//     canceled, pero la orden NUNCA cambia de estado (GET /v1/orders/{id} sigue devolviendo
//     "processed"/"accredited" incluso 5+ segundos después) y NO llega ningún webhook con
//     action:"order.refunded" (solo se vieron los de "order.processed" del paso anterior). O sea:
//     ni el circuito de "Order → refunded → webhook" documentado por MP funciona hoy en esta
//     cuenta de prueba — no es solo la devolución financiera real la que está bloqueada. El
//     código de nuestro lado (docDesdeOrden, mpConsultarPago, el webhook) SÍ está listo para
//     reflejar "refunded" correctamente en cuanto MP lo entregue — no se pudo ejercitar ese
//     camino end-to-end porque el disparador de MP nunca llega, no por un bug de Delfino.
//   - Simular evento de orden (SOLO sandbox): POST https://api.mercadopago.com/v1/orders/{id}/events
//     body: { status: "processed"|"failed"|"refunded"|"canceled", ... } — esto reemplaza al terminal
//     físico reportando el resultado, y dispara el webhook real como si fuera un pago real.
//   - Listar terminales: GET https://api.mercadopago.com/terminals/v1/list
//     (el dispositivo virtual de prueba SBX0000001 aparece acá con un id tipo "MODELO__SBX0000001")
//   - Medios de pago (usado para "probar conexión"): GET https://api.mercadopago.com/v1/payment_methods
//   - Webhooks: your-integrations/notifications/webhooks — validación x-signature con HMAC-SHA256
//     sobre el manifest "id:{data.id};request-id:{x-request-id};ts:{ts};"
//
// Limitación documentada por Mercado Pago: "No es posible procesar pagos reales en el terminal
// físico usando credenciales de prueba" — el dispositivo virtual no sirve para medir calidad de
// integración, solo para probar el circuito. Un cobro real end-to-end en un Point físico solo se
// puede validar con credenciales de producción y el dispositivo vinculado de verdad.
//
// Requiere los secrets (nunca en el repo, nunca en el frontend):
//   MP_ACCESS_TOKEN_TEST    (empieza con TEST-)
//   MP_WEBHOOK_SECRET_TEST  (clave secreta de la sección Webhooks de la aplicación)
//
// Producción queda deliberadamente sin implementar todavía — "modo: produccion" corta con un error
// claro. Cuando se decida pasar a producción: defineSecret("MP_ACCESS_TOKEN_PROD") + el mismo
// chequeo de prefijo (APP_USR-) que ya tiene el modo test, más vincular el terminal físico real.
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const mpAccessTokenTest = defineSecret("MP_ACCESS_TOKEN_TEST");
const mpWebhookSecretTest = defineSecret("MP_WEBHOOK_SECRET_TEST");

const API_BASE = "https://api.mercadopago.com";

// --- Helpers ------------------------------------------------------------------------------

function tokenParaModo(modo) {
  if (modo === "produccion") {
    throw new HttpsError("failed-precondition", "Producción todavía no está habilitada en este ERP — solo modo prueba.");
  }
  const token = mpAccessTokenTest.value();
  if (!token) throw new HttpsError("failed-precondition", "Todavía no hay credenciales de prueba configuradas (MP_ACCESS_TOKEN_TEST).");
  // Para Point, el Access Token de prueba NO siempre empieza con "TEST-" (la documentación oficial
  // lo confirma: "el prefijo del Access Token de prueba puede variar dependiendo de la solución que
  // estés integrando") — puede ser APP_USR- igual que producción. La única garantía real de que esto
  // es prueba es que se copió de la sección "Credenciales de prueba" del panel, no un formato de
  // prefijo. Como acá no existe ningún secret ni código de producción todavía, no hay riesgo de que
  // esto le pegue a producción por error — solo se valida que tenga forma de credencial de MP.
  if (!/^(TEST-|APP_USR-)/.test(token)) {
    const pista = `${token.length} caracteres, empieza con "${token.slice(0, 6)}"`;
    throw new HttpsError(
      "failed-precondition",
      `La credencial cargada no tiene forma de Access Token de Mercado Pago. Lo que se guardó: ${pista}. Revisá que hayas pegado solo el valor del Access Token, sin texto adicional.`
    );
  }
  return token;
}

async function mpFetch(path, { method = "GET", token, body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = data ? JSON.stringify(data) : "(sin cuerpo)";
    const mensaje = `HTTP ${res.status} — ${data?.message || data?.error || detalle}`;
    const err = new Error(mensaje);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function registrarLog(db, { endpoint, tipoOperacion, resultado, paymentId = null, mensajeError = null, modo }) {
  await db.collection("logIntegracionMercadoPago").add({
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    endpoint,
    tipoOperacion,
    resultado,
    paymentId,
    mensajeError,
    modo,
  });
}

// Nunca se guarda nada de tarjeta más allá de lo que MP ya no considera sensible.
function sanitizarRespuestaOrden(order) {
  const pagos = (order?.transactions?.payments || []).map((p) => {
    const { card, ...resto } = p;
    return { ...resto, card: card ? { last_four_digits: card.last_four_digits, first_six_digits: card.first_six_digits } : null };
  });
  return { ...order, transactions: order?.transactions ? { ...order.transactions, payments: pagos } : null };
}

function comisionDesdeOrden(order) {
  const pago = order?.transactions?.payments?.[0];
  const feeDetails = pago?.fee_details || [];
  if (feeDetails.length === 0) return { comisionDisponible: false, comision: null, neto: null };
  const comision = feeDetails.reduce((acc, f) => acc + (f.amount || 0), 0);
  return { comisionDisponible: true, comision, neto: pago?.net_received_amount ?? null };
}

function docDesdeOrden(order, { modo, ventaId, terminalId, creadoPor }) {
  const pago = order.transactions?.payments?.[0];
  const { comisionDisponible, comision, neto } = comisionDesdeOrden(order);
  return {
    modo,
    orderId: String(order.id),
    paymentId: pago?.id ? String(pago.id) : null,
    externalReference: order.external_reference || null,
    ventaId: ventaId ?? null,
    importe: pago?.amount != null ? Number(pago.amount) : null,
    moneda: "ARS",
    estado: order.status,
    estadoDetalle: order.status_detail || pago?.status_detail || null,
    medioPago: pago?.payment_method?.id || pago?.payment_method_id || null,
    tipoMedioPago: pago?.payment_method?.type || pago?.payment_method_type || null,
    cuotas: pago?.installments ?? null,
    terminalId: order.config?.point?.terminal_id || terminalId || null,
    // "aprobado/processed" en Point implica que el terminal ya cobró — a diferencia de medios
    // offline, para Point no hay un paso de acreditación separado documentado, pero igual se guarda
    // el status_detail tal cual lo manda MP en vez de asumir nada.
    acreditado: order.status === "processed" && (order.status_detail === "accredited" || pago?.status_detail === "accredited"),
    comisionDisponible,
    comision,
    neto,
    fechaCreada: order.date_created || null,
    fechaActualizada: order.last_updated_date || null,
    respuestaApi: sanitizarRespuestaOrden(order),
    creadoPor: creadoPor ?? admin.firestore.FieldValue.delete(),
    actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// --- Callable: probar conexión -------------------------------------------------------------
exports.mpProbarConexion = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const modo = request.data?.modo === "produccion" ? "produccion" : "test";

  try {
    const token = tokenParaModo(modo);
    const metodos = await mpFetch("/v1/payment_methods", { token });
    await registrarLog(db, { endpoint: "/v1/payment_methods", tipoOperacion: "probar_conexion", resultado: "ok", modo });
    await db
      .collection("configuracion")
      .doc("mercadoPago")
      .set({ ultimaConexionOk: true, ultimaConexionFecha: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, cantidadMediosPago: Array.isArray(metodos) ? metodos.length : 0 };
  } catch (err) {
    await registrarLog(db, { endpoint: "/v1/payment_methods", tipoOperacion: "probar_conexion", resultado: "error", mensajeError: err.message, modo });
    await db
      .collection("configuracion")
      .doc("mercadoPago")
      .set({ ultimaConexionOk: false, ultimaConexionFecha: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("unavailable", "No se pudo conectar con Mercado Pago: " + err.message);
  }
});

// --- Callable: listar terminales -------------------------------------------------------------
// Incluye el dispositivo virtual de prueba (SBX0000001) además de cualquier Point físico vinculado.
exports.mpListarTerminales = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const modo = "test";
  const token = tokenParaModo(modo);

  try {
    const data = await mpFetch("/terminals/v1/list", { token });
    await registrarLog(db, { endpoint: "/terminals/v1/list", tipoOperacion: "listar_terminales", resultado: "ok", modo });
    return { terminales: data?.data?.terminals || [] };
  } catch (err) {
    await registrarLog(db, { endpoint: "/terminals/v1/list", tipoOperacion: "listar_terminales", resultado: "error", mensajeError: err.message, modo });
    throw new HttpsError("unknown", "No se pudo listar terminales: " + err.message);
  }
});

// --- Callable: configurar tienda + caja (+ intento de modo PDV) en la terminal -----------------
// Documentación oficial (crear tienda / crear caja / activar terminal), consultada 02/09/2026:
//   - POST /users/{user_id}/stores — { name, external_id, location: { street_number, street_name,
//     city_name, state_name, latitude, longitude, reference } }. IMPORTANTE: location.city_name +
//     location.state_name se validan como PAR contra el listado interno de MP — no alcanza con que
//     cada campo sea válido por separado. Confirmado a mano: para Argentina/CABA el par que
//     funciona es city_name a nivel BARRIO (ej. "Palermo") + state_name = "Capital Federal" (NO
//     "CABA" ni "Ciudad Autónoma de Buenos Aires" ni el código "AR-C" que devuelve /users/me).
//   - POST /pos — { name, store_id, external_id, fixed_amount }. external_id acá debe ser
//     ALFANUMÉRICO (sin guiones), a diferencia del de /stores que sí los acepta.
//   - PATCH /terminals/v1/setup — { terminals: [{ id: terminal_id, operating_mode: "PDV" }] } (NO
//     acepta pos_id/store_id/terminal_id sueltos, error "unsupported_properties" si se mandan).
// Sin tienda + caja, crear una orden con el dispositivo virtual de prueba (SBX0000001) devuelve
// 403 "Unauthorized request" (código 1100). Confirmado a mano que el paso de activar PDV NO hace
// falta para el dispositivo virtual (nunca aparece en /terminals/v1/list, PATCH da 404) — alcanza
// con que existan tienda y caja para que la orden se cree bien.
// Idempotente: si ya existe una tienda/caja de prueba (por external_id fijo), las reutiliza en vez
// de crear duplicados cada vez que se llama.
const EXTERNAL_STORE_ID = "DELFINO-HOGAR-PRUEBA";

exports.mpConfigurarPuntoDeVenta = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { terminalId } = request.data || {};
  if (!terminalId) throw new HttpsError("invalid-argument", "Falta terminalId.");

  const db = admin.firestore();
  const modo = "test";
  const token = tokenParaModo(modo);
  const pasos = [];

  try {
    const me = await mpFetch("/users/me", { token });
    pasos.push({ paso: "users/me", ok: true, userId: me.id });

    // Tienda: se busca por external_id primero (idempotente) — GET /stores no existe como tal,
    // el listado real es /stores/search (endpoint separado del POST de creación).
    const storesRes = await mpFetch(`/users/${me.id}/stores/search`, { token });
    const storesList = Array.isArray(storesRes) ? storesRes : storesRes?.results || [];
    let store = storesList.find((s) => s.external_id === EXTERNAL_STORE_ID);
    if (!store) {
      store = await mpFetch(`/users/${me.id}/stores`, {
        method: "POST",
        token,
        idempotencyKey: crypto.randomUUID(),
        body: {
          name: "Delfino Hogar — Casa Central (prueba)",
          external_id: EXTERNAL_STORE_ID,
          location: {
            street_number: "4464",
            street_name: "Av. Directorio",
            city_name: "Palermo",
            state_name: "Capital Federal",
            latitude: -34.6345,
            longitude: -58.4489,
            reference: "Tienda de prueba — sandbox, no operativa",
          },
        },
      });
      pasos.push({ paso: "crear_tienda", ok: true, storeId: store.id });
    } else {
      pasos.push({ paso: "tienda_ya_existia", ok: true, storeId: store.id });
    }

    // Caja (POS): asociada a la tienda de arriba, buscada por external_id propio.
    const EXTERNAL_POS_ID = "DELFINOHOGARPRUEBACAJA";
    const posListRes = await mpFetch(`/pos?store_id=${store.id}`, { token });
    const posList = Array.isArray(posListRes) ? posListRes : posListRes?.results || [];
    let pos = posList.find((p) => p.external_id === EXTERNAL_POS_ID);
    if (!pos) {
      pos = await mpFetch("/pos", {
        method: "POST",
        token,
        idempotencyKey: crypto.randomUUID(),
        body: {
          name: "Caja Point — prueba",
          store_id: store.id,
          external_id: EXTERNAL_POS_ID,
          fixed_amount: false,
        },
      });
      pasos.push({ paso: "crear_caja", ok: true, posId: pos.id });
    } else {
      pasos.push({ paso: "caja_ya_existia", ok: true, posId: pos.id });
    }

    // Activar modo PDV en la terminal — para el dispositivo virtual de sandbox (SBX0000001) esto
    // da 404 "Not found" porque nunca aparece en /terminals/v1/list (no requiere el pareo por QR
    // que sí necesita un Point físico), y confirmado a mano que NO hace falta: crear una orden con
    // este terminal_id ya funciona una vez que existen tienda + caja, sin este paso. Por eso no es
    // bloqueante: si falla, se deja constancia y se sigue (para un Point físico real si hiciera
    // falta, el error va a quedar registrado en el log igual).
    try {
      await mpFetch("/terminals/v1/setup", {
        method: "PATCH",
        token,
        idempotencyKey: crypto.randomUUID(),
        body: { terminals: [{ id: terminalId, operating_mode: "PDV" }] },
      });
      pasos.push({ paso: "activar_pdv", ok: true });
      await registrarLog(db, { endpoint: "/terminals/v1/setup", tipoOperacion: "configurar_pdv", resultado: "ok", modo });
    } catch (err) {
      pasos.push({ paso: "activar_pdv", ok: false, mensajeError: err.message });
      await registrarLog(db, { endpoint: "/terminals/v1/setup", tipoOperacion: "configurar_pdv", resultado: "error", mensajeError: err.message, modo });
    }

    await db.collection("configuracion").doc("mercadoPago").set({ storeId: String(store.id), posId: String(pos.id), terminalId }, { merge: true });
    return { ok: true, storeId: store.id, posId: pos.id, pasos };
  } catch (err) {
    await registrarLog(db, { endpoint: "/terminals/v1/setup", tipoOperacion: "configurar_pdv", resultado: "error", mensajeError: err.message, modo });
    throw new HttpsError("unknown", `No se pudo configurar el punto de venta (paso ${pasos.length + 1}): ${err.message}`);
  }
});

// --- Interno: crear una orden Point, compartido por el Centro de pruebas y Nueva Venta --------
// externalReference identifica el INTENTO DE COBRO, nunca una venta — para el cobro real
// (mpCrearOrdenVenta) la venta todavía no existe en este momento (el cobro se hace ANTES de
// crearVenta, y puede rechazarse/cancelarse sin que ninguna venta llegue a crearse). El vínculo
// con la venta real, cuando existe, se hace después vía mpVincularVenta — nunca acá.
async function crearOrdenInterna(db, { terminalId, monto, externalReference, creadoPor, tipoOperacionLog }) {
  const modo = "test";
  const token = tokenParaModo(modo);
  const body = {
    type: "point",
    external_reference: externalReference,
    transactions: { payments: [{ amount: monto.toFixed(2) }] },
    config: { point: { terminal_id: terminalId } },
    expiration_time: "PT16M",
  };

  try {
    const order = await mpFetch("/v1/orders", { method: "POST", token, body, idempotencyKey: crypto.randomUUID() });
    await db
      .collection("pagosMercadoPago")
      .doc(String(order.id))
      .set(
        { ...docDesdeOrden(order, { modo, ventaId: null, terminalId, creadoPor }), creadoEn: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    await registrarLog(db, { endpoint: "/v1/orders", tipoOperacion: tipoOperacionLog, resultado: "ok", paymentId: String(order.id), modo });
    return { orderId: String(order.id), status: order.status };
  } catch (err) {
    await registrarLog(db, { endpoint: "/v1/orders", tipoOperacion: tipoOperacionLog, resultado: "error", mensajeError: err.message, modo });
    throw new HttpsError("unknown", "Mercado Pago rechazó la creación de la orden: " + err.message);
  }
}

// --- Callable: crear orden de prueba ($1.000, Centro de pruebas) -------------------------------
exports.mpCrearOrdenPrueba = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { terminalId } = request.data || {};
  if (!terminalId) throw new HttpsError("invalid-argument", "Falta el terminal (usá el dispositivo virtual de prueba).");

  const db = admin.firestore();
  return crearOrdenInterna(db, {
    terminalId,
    monto: 1000,
    externalReference: `PRUEBA-${Date.now()}`,
    creadoPor: request.auth.uid,
    tipoOperacionLog: "crear_orden",
  });
});

// --- Callable: crear orden para el cobro real de una venta (Nueva Venta) -----------------------
// Se llama ANTES de crearVenta (js/ventas.js) — el cobro tiene que estar aprobado por la terminal
// antes de registrar la venta, nunca al revés. externalReference es "MP-<uuid>" (un identificador
// del intento de cobro, no de la venta) — ver nota en crearOrdenInterna.
exports.mpCrearOrdenVenta = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { terminalId, monto } = request.data || {};
  if (!terminalId) throw new HttpsError("invalid-argument", "Falta el terminal — configuralo en Configuración → Mercado Pago.");
  if (!(Number(monto) > 0)) throw new HttpsError("invalid-argument", "Falta el monto a cobrar.");

  const db = admin.firestore();
  return crearOrdenInterna(db, {
    terminalId,
    monto: Number(monto),
    externalReference: `MP-${crypto.randomUUID()}`,
    creadoPor: request.auth.uid,
    tipoOperacionLog: "crear_orden_venta",
  });
});

// --- Callable: cancelar una orden (botón "Cancelar cobro" de Nueva Venta) ----------------------
// La fuente de verdad es SIEMPRE el estado que Mercado Pago devuelve después de intentar cancelar,
// nunca la intención del cajero: si el pago ya se había aprobado un instante antes de tocar
// "Cancelar", esta función va a devolver estado:"processed" igual — quien llama tiene que respetar
// eso (ver la máquina de estados en js/mercado-pago.js) y NUNCA interpretarlo como cancelado.
exports.mpCancelarOrden = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { orderId } = request.data || {};
  if (!orderId) throw new HttpsError("invalid-argument", "Falta el orderId.");

  const db = admin.firestore();
  const modo = "test";
  const token = tokenParaModo(modo);

  try {
    try {
      await mpFetch(`/v1/orders/${orderId}/cancel`, { method: "POST", token, idempotencyKey: crypto.randomUUID() });
    } catch (errCancelar) {
      // Si MP rechaza el cancel (ej. porque ya está processed), no es un error nuestro — se sigue
      // igual a re-consultar la orden para devolver el estado real, que es lo que importa acá.
    }
    // Un solo GET no alcanza: probado a mano que hay una ventana real de lag de propagación en MP
    // — si el cajero cancela justo en el instante en que se aprobó el pago, un GET inmediato puede
    // devolver todavía "created" aunque la orden ya haya quedado "processed" un segundo después.
    // Se reintenta una vez más tras una pausa antes de dar el estado por definitivo — más vale
    // tardar un segundo de más en "Cancelar cobro" que arriesgarse a reportar cancelado un pago que
    // en realidad ya se cobró.
    let order = await mpFetch(`/v1/orders/${orderId}`, { token });
    if (order.status !== "processed") {
      await new Promise((r) => setTimeout(r, 1500));
      order = await mpFetch(`/v1/orders/${orderId}`, { token });
    }
    const previo = await db.collection("pagosMercadoPago").doc(String(order.id)).get();
    const docNuevo = docDesdeOrden(order, { modo, ventaId: previo.data()?.ventaId, terminalId: previo.data()?.terminalId, creadoPor: previo.data()?.creadoPor });
    await db.collection("pagosMercadoPago").doc(String(order.id)).set(docNuevo, { merge: true });
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}/cancel`, tipoOperacion: "cancelar_orden", resultado: "ok", paymentId: String(orderId), modo });
    return { estado: order.status, estadoDetalle: order.status_detail || null };
  } catch (err) {
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}/cancel`, tipoOperacion: "cancelar_orden", resultado: "error", paymentId: String(orderId), mensajeError: err.message, modo });
    throw new HttpsError("unknown", "No se pudo cancelar la orden: " + err.message);
  }
});

// --- Callable: vincular una orden ya aprobada con la venta real que generó -----------------------
// pagosMercadoPago tiene allow write:if false desde el cliente (firestore.rules) — este es el único
// camino para completar ventaId, que arranca en null en crearOrdenInterna porque en ese momento la
// venta todavía no existe. Se llama después de que crearVenta (js/ventas.js) ya terminó con éxito.
exports.mpVincularVenta = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { orderId, ventaId } = request.data || {};
  if (!orderId || !ventaId) throw new HttpsError("invalid-argument", "Falta orderId o ventaId.");

  const db = admin.firestore();
  await db.collection("pagosMercadoPago").doc(String(orderId)).set({ ventaId: String(ventaId) }, { merge: true });
  return { ok: true };
});

// --- Callable: simular evento de orden (SOLO sandbox) ------------------------------------------
// Reemplaza al terminal físico reportando "cobré" / "no pude cobrar" — dispara el webhook real.
const DETALLE_POR_ESTADO = {
  processed: { payment_method_type: "credit_card", installments: 1, payment_method_id: "visa", status_detail: "accredited" },
  failed: { payment_method_type: "credit_card", installments: 1, payment_method_id: "visa", status_detail: "insufficient_amount" },
  refunded: {},
  canceled: {},
};

exports.mpSimularEventoOrden = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { orderId, estado } = request.data || {};
  if (!orderId || !DETALLE_POR_ESTADO[estado]) {
    throw new HttpsError("invalid-argument", "Falta orderId o el estado a simular no es válido.");
  }

  const db = admin.firestore();
  const modo = "test";
  const token = tokenParaModo(modo);
  const body = { status: estado, ...DETALLE_POR_ESTADO[estado] };

  try {
    await mpFetch(`/v1/orders/${orderId}/events`, { method: "POST", token, body, idempotencyKey: crypto.randomUUID() });
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}/events`, tipoOperacion: "simular_evento", resultado: "ok", paymentId: String(orderId), modo });
    return { ok: true };
  } catch (err) {
    await registrarLog(db, {
      endpoint: `/v1/orders/${orderId}/events`,
      tipoOperacion: "simular_evento",
      resultado: "error",
      paymentId: String(orderId),
      mensajeError: err.message,
      modo,
    });
    throw new HttpsError("unknown", "No se pudo simular el evento: " + err.message);
  }
});

// --- Callable: consultar orden ---------------------------------------------------------------
exports.mpConsultarPago = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { orderId } = request.data || {};
  if (!orderId) throw new HttpsError("invalid-argument", "Falta el orderId.");

  const db = admin.firestore();
  const modo = "test";
  const token = tokenParaModo(modo);

  try {
    const order = await mpFetch(`/v1/orders/${orderId}`, { token });
    const previo = await db.collection("pagosMercadoPago").doc(String(order.id)).get();
    const docNuevo = docDesdeOrden(order, { modo, ventaId: previo.data()?.ventaId, terminalId: previo.data()?.terminalId, creadoPor: previo.data()?.creadoPor });
    await db.collection("pagosMercadoPago").doc(String(order.id)).set(docNuevo, { merge: true });
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}`, tipoOperacion: "consultar_orden", resultado: "ok", paymentId: String(order.id), modo });
    return docNuevo;
  } catch (err) {
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}`, tipoOperacion: "consultar_orden", resultado: "error", paymentId: String(orderId), mensajeError: err.message, modo });
    throw new HttpsError("unknown", "No se pudo consultar la orden: " + err.message);
  }
});

// --- Callable: crear devolución ---------------------------------------------------------------
exports.mpCrearDevolucion = onCall({ region: "southamerica-east1", secrets: [mpAccessTokenTest] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const { orderId, monto } = request.data || {};
  if (!orderId) throw new HttpsError("invalid-argument", "Falta el orderId.");

  const db = admin.firestore();
  const modo = "test";
  const token = tokenParaModo(modo);

  const perfilSnap = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfilSnap.data()?.rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo un administrador puede generar devoluciones.");
  }

  try {
    // Cuerpo real de /refund (confirmado 02/09/2026, la doc pública muestra {amount} suelto pero
    // la API vigente lo rechaza con "unsupported_properties"): reembolso total = sin body;
    // reembolso parcial = { transactions: [{ id: transactionId, amount }] }, donde transactionId
    // es transactions.payments[0].id de la propia orden (no el orderId).
    let body;
    if (monto) {
      const ordenPrevia = await mpFetch(`/v1/orders/${orderId}`, { token });
      const transactionId = ordenPrevia?.transactions?.payments?.[0]?.id;
      if (!transactionId) throw new Error("No se encontró el pago de la orden para hacer la devolución parcial.");
      body = { transactions: [{ id: transactionId, amount: String(monto) }] };
    }
    await mpFetch(`/v1/orders/${orderId}/refund`, { method: "POST", token, body, idempotencyKey: crypto.randomUUID() });
    // La orden original NUNCA se borra — solo se re-consulta para reflejar el nuevo estado (refunded).
    const order = await mpFetch(`/v1/orders/${orderId}`, { token });
    const previo = await db.collection("pagosMercadoPago").doc(String(order.id)).get();
    const docNuevo = docDesdeOrden(order, { modo, ventaId: previo.data()?.ventaId, terminalId: previo.data()?.terminalId, creadoPor: previo.data()?.creadoPor });
    await db.collection("pagosMercadoPago").doc(String(order.id)).set(docNuevo, { merge: true });
    await db
      .collection("devolucionesMercadoPago")
      .doc(crypto.randomUUID())
      .set({
        modo,
        orderId: String(orderId),
        monto: monto || docNuevo.importe,
        estado: order.status,
        fecha: admin.firestore.FieldValue.serverTimestamp(),
        creadoPor: request.auth.uid,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}/refund`, tipoOperacion: "devolucion", resultado: "ok", paymentId: String(orderId), modo });
    return { estado: order.status };
  } catch (err) {
    await registrarLog(db, { endpoint: `/v1/orders/${orderId}/refund`, tipoOperacion: "devolucion", resultado: "error", paymentId: String(orderId), mensajeError: err.message, modo });
    throw new HttpsError("unknown", "No se pudo generar la devolución: " + err.message);
  }
});

// --- Webhook -------------------------------------------------------------------------------
// Endpoint público — la seguridad depende enteramente de validar x-signature con el secret de la
// aplicación. Idempotente: cada notificación se registra por (data.id + action + x-request-id)
// antes de procesarla; si ya existía se corta ahí, así reintentos de MP nunca duplican nada.
// LIMITACIÓN CONOCIDA (documentada acá a propósito, no borrada): para notificaciones de tipo
// "order" (Point/Orders API) se probaron ~25 variantes del manifest documentado oficialmente para
// notificaciones de tipo "payment" — con/sin request-id, con el id en minúscula o tal cual, con
// distinto orden de campos, con y sin ";" final, contra el body crudo completo (hex y base64) — y
// ninguna coincidió con la firma que realmente manda Mercado Pago para este tipo de evento. La
// notificación SÍ llega (se confirmó con el body real: type:"order", action:"order.processed",
// data.id con el ID de la orden) — lo que falla es específicamente la validación criptográfica.
// La documentación pública de Mercado Pago no cubre el formato de firma para notificaciones de
// Órdenes, a diferencia de las de Pagos (donde sí está documentado y probablemente funcione igual).
// Mientras tanto, el estado de la orden se sincroniza de forma confiable por polling (mpConsultarPago
// / botón "Actualizar estado" en el Centro de pruebas), que sí es 100% real y ya verificado. Antes
// de depender del webhook en producción, hay que confirmar el formato exacto con soporte de
// Mercado Pago Developers.
function validarFirmaWebhook(req, secret) {
  const xSignature = req.headers["x-signature"];
  const xRequestId = req.headers["x-request-id"];
  const diagnostico = {
    xSignatureCruda: xSignature || "(ninguna)",
    xRequestIdCruda: xRequestId || "(ninguno)",
  };
  if (!xSignature || !secret) return { variante: null, diagnostico };

  const partes = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v?.trim()];
    })
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  diagnostico.ts = ts || "(ninguno)";
  diagnostico.v1 = v1 || "(ninguno)";
  if (!ts || !v1) return { variante: null, diagnostico };

  const dataIdCruda = (req.query["data.id"] || req.body?.data?.id || "").toString();
  diagnostico.dataIdCruda = dataIdCruda || "(ninguno)";

  // Fórmula oficialmente documentada (para notificaciones de tipo "payment" — se usa igual acá a
  // falta de una fórmula específica para "order" confirmada por Mercado Pago).
  const manifest = `id:${dataIdCruda.toLowerCase()};request-id:${xRequestId || ""};ts:${ts};`;
  const hmacBuf = crypto.createHmac("sha256", secret).update(manifest).digest();
  const v1Buf = Buffer.from(v1, "hex");
  if (hmacBuf.length === v1Buf.length && crypto.timingSafeEqual(hmacBuf, v1Buf)) {
    return { variante: "formula_oficial_payment", diagnostico };
  }

  return { variante: null, diagnostico };
}

exports.mpWebhook = onRequest({ region: "southamerica-east1", secrets: [mpWebhookSecretTest, mpAccessTokenTest] }, async (req, res) => {
  const db = admin.firestore();
  const modo = "test";

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const secret = mpWebhookSecretTest.value();
  const { variante, diagnostico } = validarFirmaWebhook(req, secret);
  if (!variante) {
    await registrarLog(db, { endpoint: "/mpWebhook", tipoOperacion: "webhook", resultado: "error", mensajeError: `Firma inválida — ${JSON.stringify(diagnostico)}`, modo });
    res.status(401).send("Invalid signature");
    return;
  }
  // Diagnóstico temporal: qué variante de manifest coincidió, para dejar el código final con SOLO
  // esa fórmula (nunca se expone el secret ni el hash, solo el nombre de la variante).
  await registrarLog(db, { endpoint: "/mpWebhook", tipoOperacion: "webhook", resultado: "ok", mensajeError: `Firma válida — variante: ${variante}`, modo });

  const { type, action, data } = req.body || {};
  const dataId = data?.id;
  if (!dataId) {
    res.status(200).send("ok");
    return;
  }

  const dedupeKey = `${type || "order"}_${action || "sin_action"}_${dataId}_${req.headers["x-request-id"] || ""}`;
  const dedupeRef = db.collection("webhooksMercadoPagoProcesados").doc(dedupeKey);

  const yaProcesado = await db.runTransaction(async (tx) => {
    const snap = await tx.get(dedupeRef);
    if (snap.exists) return true;
    tx.set(dedupeRef, { fecha: admin.firestore.FieldValue.serverTimestamp(), type, action, dataId: String(dataId) });
    return false;
  });

  if (yaProcesado) {
    await registrarLog(db, { endpoint: "/mpWebhook", tipoOperacion: "webhook", resultado: "ok", paymentId: String(dataId), mensajeError: "duplicado (ignorado)", modo });
    res.status(200).send("ok (duplicate)");
    return;
  }

  try {
    const token = tokenParaModo(modo);
    const order = await mpFetch(`/v1/orders/${dataId}`, { token });
    const previo = await db.collection("pagosMercadoPago").doc(String(order.id)).get();
    const docNuevo = docDesdeOrden(order, { modo, ventaId: previo.data()?.ventaId, terminalId: previo.data()?.terminalId, creadoPor: previo.data()?.creadoPor });
    await db.collection("pagosMercadoPago").doc(String(order.id)).set(docNuevo, { merge: true });
    await registrarLog(db, { endpoint: "/mpWebhook", tipoOperacion: "webhook", resultado: "ok", paymentId: String(dataId), modo });
    res.status(200).send("ok");
  } catch (err) {
    await registrarLog(db, { endpoint: "/mpWebhook", tipoOperacion: "webhook", resultado: "error", paymentId: String(dataId), mensajeError: err.message, modo });
    // Igual se responde 200: si el error es nuestro, reintentar cada 15 minutos no lo arregla solo
    // — queda en el log para revisar a mano.
    res.status(200).send("logged");
  }
});
