// Integración con Tienda Nube — PREPARADA, NO CONECTADA. No hay credenciales/API todavía, así que
// nada de acá llama a la API real de Tienda Nube; lo que sí hace es dejar el modelo de datos, la cola
// de sincronización y los puntos de enganche listos para cuando esa conexión exista, sin tener que
// rediseñar Productos/Stock/Ventas/Precios en ese momento (ver docs/tiendanube-integracion.md para
// el diseño completo — quién es dueño de qué dato, en qué dirección viaja, cómo se evita duplicar).
//
// Regla de oro de todo este archivo: el ERP tiene que poder seguir vendiendo aunque Tienda Nube esté
// caída, mal configurada, o no exista todavía. Por eso encolarSincronizacion() nunca tira una
// excepción que pueda cortar una venta/compra/edición de producto — un fallo acá se guarda como
// error en la cola, no se propaga.
import { db, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";

// --- Cola de sincronización (ERP -> Tienda Nube) ------------------------------------------------
// Un doc por cambio real de stock/precio/imagen que HABRÍA que mandar. Se llena siempre (es gratis,
// es solo Firestore) aunque no haya ninguna función procesándola todavía — así el día que se conecte
// la API real, ya hay un historial de qué cambió y cuándo, no arranca de cero.
//
// datos: { tipo: "stock"|"precio"|"imagen", productoId, sku, valorAnterior, valorNuevo, motivo }
export async function encolarSincronizacion(datos, usuario) {
  try {
    await addDoc(collection(db, "colaSincronizacionTiendaNube"), {
      tipo: datos.tipo,
      productoId: datos.productoId,
      sku: datos.sku || null,
      valorAnterior: datos.valorAnterior ?? null,
      valorNuevo: datos.valorNuevo ?? null,
      motivo: datos.motivo || null,
      estado: "pendiente", // pendiente | enviado | confirmado | error
      intentos: 0,
      ultimoError: null,
      usuario: usuario?.uid || null,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
  } catch (err) {
    // Encolar es best-effort a propósito: si esto fallara, la venta/compra/edición que lo disparó
    // tiene que poder seguir su curso igual. Se deja constancia en consola, nada más.
    console.warn("No se pudo encolar sincronización a Tienda Nube:", err?.message || err);
  }
}

export async function listarColaSincronizacion({ estado, maxResultados = 100 } = {}) {
  const clausulas = [orderBy("creadoEn", "desc"), limit(maxResultados)];
  if (estado) clausulas.unshift(where("estado", "==", estado));
  const snap = await getDocs(query(collection(db, "colaSincronizacionTiendaNube"), ...clausulas));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Vínculo producto <-> Tienda Nube, por SKU --------------------------------------------------
// El ERP es el maestro de stock/costo/precio/margen (ver punto 12 del pedido) — el vínculo se guarda
// en el producto mismo (tiendaNube: { vinculado, idExterno, ultimaSincronizacionStock, ... }) para
// no tener que hacer una consulta aparte solo para saber si un producto ya está vinculado.
export async function marcarProductoVinculado(productoId, idExternoTiendaNube, usuario) {
  await updateDoc(doc(db, "productos", productoId), {
    tiendaNube: {
      vinculado: true,
      idExterno: idExternoTiendaNube,
      vinculadoEn: serverTimestamp(),
      vinculadoPor: usuario.uid,
    },
  });
}

// --- STUBS: acá va la llamada real a la API de Tienda Nube el día que haya credenciales ----------
// Deliberadamente NO implementadas — no hay token/tienda para probar contra nada real, e inventar
// una respuesta sería peor que no tener la función. Cada una documenta la forma que va a tener.

// Manda el stock actual de un producto a Tienda Nube. Debería: tomar el producto por SKU, resolver
// su variant_id en Tienda Nube (vía tiendaNube.idExterno), hacer PUT al endpoint de stock, y marcar
// el registro de la cola correspondiente como "confirmado" o "error" con el detalle real.
export async function sincronizarStock(_productoId) {
  throw new Error("Integración con Tienda Nube no conectada todavía — falta configurar credenciales/API (ver Configuración → Integraciones).");
}

// Mismo criterio que sincronizarStock pero para precio de lista.
export async function sincronizarPrecio(_productoId) {
  throw new Error("Integración con Tienda Nube no conectada todavía — falta configurar credenciales/API (ver Configuración → Integraciones).");
}

// Trae la imagen principal de un producto desde Tienda Nube por SKU, para usarla como origen
// "tienda_nube" en js/producto-imagenes.js cuando no haya una imagen manual cargada.
export async function buscarImagenTiendaNube(_sku) {
  throw new Error("Integración con Tienda Nube no conectada todavía.");
}

// --- Órdenes (Tienda Nube -> ERP) -----------------------------------------------------------------
// Ver docs/tiendanube-integracion.md sección "Idempotencia": el id del documento ES el id externo de
// la orden en Tienda Nube (setDoc con ese id, nunca addDoc) — así, si el webhook de Tienda Nube
// reintenta la misma notificación (timeout, reintento automático, doble entrega), escribir de nuevo
// el mismo id es un no-op idempotente en vez de crear una orden — y por lo tanto una venta — duplicada.
//
// datosOrden: { idExterno, numeroOrden, fecha, cliente: {nombre, email, telefono}, items: [{sku,
//              cantidad, precioUnitario}], estado, estadoPago, estadoPreparacion, envio, descuentos,
//              total }
export async function registrarOrdenTiendaNube(datosOrden) {
  const ref = doc(db, "ordenesTiendaNube", String(datosOrden.idExterno));
  const existente = await getDoc(ref);
  if (existente.exists()) {
    // Ya la teníamos — no se pisa ni se vuelve a procesar. Esto es lo que evita el "no quiero que una
    // orden online termine generando dos ventas" del pedido.
    return { yaExistia: true, orden: existente.data() };
  }

  await setDoc(ref, {
    idExterno: String(datosOrden.idExterno),
    numeroOrden: datosOrden.numeroOrden || null,
    fecha: datosOrden.fecha || null,
    cliente: datosOrden.cliente || null,
    items: datosOrden.items || [],
    total: datosOrden.total ?? null,
    estado: datosOrden.estado || "recibida", // recibida | procesada | error
    estadoPago: datosOrden.estadoPago || "pendiente", // pendiente | aprobado | rechazado | reembolsado
    estadoPreparacion: datosOrden.estadoPreparacion || null,
    // Se completan recién cuando se procesa: no se inventa una venta/factura antes de tiempo.
    ventaId: null,
    facturaId: null,
    procesadoEn: null,
    error: null,
    recibidaEn: serverTimestamp(),
  });
  return { yaExistia: false };
}

// Procesa una orden ya registrada (recibida) → crea la venta + factura en el ERP, SOLO si el pago
// está confirmado (ver punto 19 del pedido: no asumir cobrado solo porque la orden existe). Queda
// como stub porque crearVenta/crearComprobante ya existen y funcionan (js/ventas.js, js/facturacion.js)
// — conectar esto de verdad es "llamarlas con los datos de la orden", no un desarrollo nuevo, así
// que no tiene sentido escribirlo a ciegas sin una orden real de Tienda Nube contra la cual probarlo.
export async function procesarOrdenTiendaNube(_idExterno, _usuario) {
  throw new Error("Procesamiento de órdenes de Tienda Nube no implementado todavía — ver docs/tiendanube-integracion.md.");
}

export async function listarOrdenesTiendaNube(maxResultados = 100) {
  const snap = await getDocs(query(collection(db, "ordenesTiendaNube"), orderBy("recibidaEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Datos para el panel de Configuración → Integraciones ----------------------------------------
export async function resumenIntegracionTiendaNube() {
  const [pendientes, errores, ordenes] = await Promise.all([
    listarColaSincronizacion({ estado: "pendiente", maxResultados: 500 }),
    listarColaSincronizacion({ estado: "error", maxResultados: 500 }),
    listarOrdenesTiendaNube(50),
  ]);
  return {
    pendientes: pendientes.length,
    errores: errores.length,
    ordenesRecibidas: ordenes.length,
    ultimaOrden: ordenes[0] || null,
  };
}
