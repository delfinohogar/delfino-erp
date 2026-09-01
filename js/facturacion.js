// Facturación — comprobantes INTERNOS (sin validez fiscal, sin conexión a ARCA todavía).
//
// Capas (mismo patrón que contabilidad.js: varias responsabilidades relacionadas en un archivo,
// no una carpeta services/ nueva — este proyecto no usa esa convención en ningún otro módulo):
//   - Numeración interna (contadores/comprobantes, mismo patrón que contadores/ventas)
//   - Cálculos (subtotal/descuento/IVA/total)
//   - CRUD de comprobantes (crear desde venta, crear manual, listar, obtener, anular)
//   - fiscalProvider: el punto exacto donde se conecta ARCA el día de mañana (ver abajo)
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
} from "./firebase.js";

export const ESTADOS_COMPROBANTE = ["BORRADOR", "EMITIDA", "ANULADA"];
// Preparados para cuando exista ARCA — no se usan todavía (ver fiscalProvider más abajo).
export const ESTADOS_ARCA_FUTUROS = ["PENDIENTE_ARCA", "AUTORIZADA", "RECHAZADA"];

export const FORMAS_PAGO_COMPROBANTE = ["Efectivo", "Débito", "Transferencia", "Tarjeta de crédito", "GoCuotas", "Otra"];

const PUNTO_VENTA_INTERNO = "0001";

export function formatearNumeroComprobante(puntoVenta, numero) {
  return `${puntoVenta}-${String(numero).padStart(8, "0")}`;
}

async function siguienteNumeroComprobante() {
  const contadorRef = doc(db, "contadores", "comprobantes");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(contadorRef);
    const ultimo = snap.exists() ? snap.data().ultimo || 0 : 0;
    const siguiente = ultimo + 1;
    tx.set(contadorRef, { ultimo: siguiente });
    return siguiente;
  });
}

// --- Cálculos ---------------------------------------------------------------------------------

export function subtotalItem(item) {
  return Math.round(item.cantidad * item.precioUnitario * (1 - (item.descuentoPct || 0) / 100) * 100) / 100;
}

// IVA queda preparado (campo real, calculado en $0) pero no hay lógica fiscal todavía — el sistema
// no discrimina IVA en ventas (no factura fiscalmente), mismo criterio que reportePosicionIva.
export function calcularTotales(items, descuentoGlobalPct = 0) {
  const subtotalBruto = items.reduce((acc, it) => acc + subtotalItem(it), 0);
  const descuento = Math.round(subtotalBruto * ((descuentoGlobalPct || 0) / 100) * 100) / 100;
  const subtotal = Math.round((subtotalBruto - descuento) * 100) / 100;
  const iva = 0;
  const total = Math.round((subtotal + iva) * 100) / 100;
  return { subtotal, descuento, iva, total };
}

// --- fiscalProvider -----------------------------------------------------------------------------
// PUNTO DE INTEGRACIÓN ARCA: acá es donde en el futuro se enchufa la conexión fiscal real, sin
// tocar el resto del módulo (pantallas, PDF, WhatsApp, email). La interfaz que va a tener que
// implementar ArcaProvider es exactamente la de InternalProvider.autorizar().
const InternalProvider = {
  nombre: "interno",
  // Hoy no llama a nada externo — el comprobante interno "nace autorizado" (no necesita CAE para
  // existir). Devuelve siempre los campos fiscales en null: nunca se inventa un CAE ni un QR.
  async autorizar(_comprobante) {
    return {
      arcaEstado: null,
      cae: null,
      caeVencimiento: null,
      qr: null,
      numeroFiscal: null,
      tipoComprobanteFiscal: null,
      fechaAutorizacion: null,
      arcaErrorCodigo: null,
      arcaErrorDescripcion: null,
    };
  },
};

// TODO (futuro, no implementar todavía): ArcaProvider — misma interfaz que InternalProvider.
// async autorizar(comprobante) debería:
//   1. Determinar el tipo de comprobante fiscal según condición de IVA del emisor/receptor.
//   2. Armar el request WSFEv1 con los datos del comprobante.
//   3. Autenticar contra WSAA (certificado + clave privada, como ya hace arcaWsaa.js para el padrón).
//   4. Enviar y recibir CAE + vencimiento + resultado.
//   5. Devolver los mismos 8 campos que InternalProvider, con los valores reales de ARCA.
// El resto del módulo (crearComprobante, el PDF, WhatsApp, email) NO debería necesitar cambios —
// solo evaluarProveedorFiscal() de acá abajo, reemplazando InternalProvider por ArcaProvider.
function evaluarProveedorFiscal() {
  return InternalProvider; // cambiar acá cuando exista ArcaProvider
}

// --- CRUD de comprobantes -----------------------------------------------------------------------

function datosClienteDesde(cliente) {
  if (!cliente) {
    return { clienteId: null, clienteNombre: "Consumidor final", clienteDni: null, clienteCuit: null, clienteDireccion: null, clienteCondicionIva: null };
  }
  return {
    clienteId: cliente.id,
    clienteNombre: cliente.razonSocial,
    clienteDni: null, // el ERP no distingue DNI de CUIT hoy — ver cliente.cuit
    clienteCuit: cliente.cuit || null,
    clienteDireccion: cliente.domicilioEntrega || cliente.domicilioFiscal || null,
    clienteCondicionIva: cliente.condicionIva || null,
  };
}

// datos: { items, descuentoGlobalPct, cliente, formaPago, observaciones, ventaId, guardarComoBorrador }
// items: [{ productoId?, productoSku?, productoDescripcion, cantidad, precioUnitario, descuentoPct }]
export async function crearComprobante(datos, usuario) {
  if (!datos.items || datos.items.length === 0) throw new Error("El comprobante necesita al menos un producto.");
  for (const it of datos.items) {
    if (!(it.cantidad > 0)) throw new Error(`Cantidad inválida para "${it.productoDescripcion}".`);
    if (!(it.precioUnitario >= 0)) throw new Error(`Precio inválido para "${it.productoDescripcion}".`);
  }
  if (!datos.formaPago) throw new Error("Falta la forma de pago.");

  const items = datos.items.map((it) => ({ ...it, subtotal: subtotalItem(it) }));
  const { subtotal, descuento, iva, total } = calcularTotales(items, datos.descuentoGlobalPct || 0);

  const estado = datos.guardarComoBorrador ? "BORRADOR" : "EMITIDA";
  const ahora = serverTimestamp();

  let numero = null;
  let numeroCompleto = null;
  if (estado === "EMITIDA") {
    numero = await siguienteNumeroComprobante();
    numeroCompleto = formatearNumeroComprobante(PUNTO_VENTA_INTERNO, numero);
  }

  const fiscalProvider = evaluarProveedorFiscal();
  const datosFiscales = estado === "EMITIDA" ? await fiscalProvider.autorizar({ items, total }) : {};

  const comprobante = {
    tipoComprobante: "Comprobante interno",
    estado,
    puntoVenta: PUNTO_VENTA_INTERNO,
    numero,
    numeroCompleto,
    fechaEmision: new Date().toISOString().slice(0, 10),

    ventaId: datos.ventaId || null,

    ...datosClienteDesde(datos.cliente),

    items,
    subtotal,
    descuento,
    iva,
    total,

    formaPago: datos.formaPago,
    observaciones: datos.observaciones?.trim() || null,

    pdfGenerado: false,

    ...datosFiscales,

    motivoAnulacion: null,
    fechaAnulacion: null,
    anuladoPor: null,
    anuladoPorNombre: null,

    creadoPor: usuario.uid,
    creadoPorNombre: usuario.nombre || usuario.email,
    creadoEn: ahora,
    actualizadoEn: ahora,
  };

  const ref = await addDoc(collection(db, "comprobantes"), comprobante);
  return { id: ref.id, ...comprobante };
}

// Arma los items/cliente/forma de pago automáticamente a partir de una venta ya cargada — el
// usuario no vuelve a tipear nada (punto 6 del pedido).
export function comprobanteDesdeVenta(venta, clienteCompleto) {
  return {
    ventaId: venta.id,
    items: (venta.items || []).map((it) => ({
      productoId: it.productoId,
      productoSku: it.productoSku,
      productoDescripcion: it.productoDescripcion,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario,
      descuentoPct: it.descuentoPct || 0,
    })),
    descuentoGlobalPct: 0, // el descuento de la venta ya está prorrateado en cada ítem (venta.descuentoGlobal era $, no %)
    cliente: clienteCompleto || null,
    formaPago: (venta.pagos || []).length > 1 ? "Varios medios" : venta.pagos?.[0]?.medio || "Efectivo",
    observaciones: `Generado desde la venta #${venta.numeroVenta}.`,
  };
}

export async function obtenerComprobante(id) {
  const snap = await getDoc(doc(db, "comprobantes", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listarComprobantes({ desde, hasta, maxResultados = 200 } = {}) {
  let clausulas = [orderBy("fechaEmision", "desc"), limit(maxResultados)];
  if (desde) clausulas.unshift(where("fechaEmision", ">=", desde));
  if (hasta) clausulas.unshift(where("fechaEmision", "<=", hasta));
  const snap = await getDocs(query(collection(db, "comprobantes"), ...clausulas));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function marcarPdfGenerado(id) {
  await updateDoc(doc(db, "comprobantes", id), { pdfGenerado: true, actualizadoEn: serverTimestamp() });
}

// Nunca borra — cambia de estado y deja motivo/fecha/quién. El número anulado no se reutiliza
// jamás (el contador nunca retrocede).
export async function anularComprobante(id, motivo, usuario) {
  if (!motivo?.trim()) throw new Error("Ingresá un motivo de anulación.");
  await updateDoc(doc(db, "comprobantes", id), {
    estado: "ANULADA",
    motivoAnulacion: motivo.trim(),
    fechaAnulacion: serverTimestamp(),
    anuladoPor: usuario.uid,
    anuladoPorNombre: usuario.nombre || usuario.email,
    actualizadoEn: serverTimestamp(),
  });
}
