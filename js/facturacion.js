// Facturación — comprobantes INTERNOS (sin validez fiscal, sin conexión a ARCA todavía).
//
// ARQUITECTURA (corregida): la venta es la que genera el comprobante — no existe una "carga
// manual" como flujo principal. Ver productos/venta-nueva.js (sección Comprobante) para el punto
// de entrada real; este módulo es el servicio que usa esa pantalla (y, para casos sueltos sin
// venta, también facturacion/nuevo.js).
//
// Capas (mismo patrón que contabilidad.js: varias responsabilidades relacionadas en un archivo,
// no una carpeta services/ nueva — este proyecto no usa esa convención en ningún otro módulo):
//   - Numeración interna, POR punto de venta + tipo de comprobante (contadores/comprobantes_*)
//   - Cálculos (subtotal/descuento/IVA/total)
//   - CRUD de comprobantes (crear desde venta, crear manual, listar, obtener)
//   - Notas de crédito (el mecanismo correcto para revertir un comprobante — no un simple "anular")
//   - FiscalService: el punto exacto donde se conecta ARCA el día de mañana (ver abajo)
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
import { listarSucursalesActivas } from "./sucursales.js";

export const ESTADOS_COMPROBANTE = ["BORRADOR", "EMITIDA", "ANULADA"];
// Preparados para cuando exista ARCA — no se usan todavía (ver FiscalService más abajo).
export const ESTADOS_ARCA_FUTUROS = ["PENDING_ARCA", "AUTHORIZED", "REJECTED", "ERROR"];

export const FORMAS_PAGO_COMPROBANTE = ["Efectivo", "Débito", "Transferencia", "Tarjeta de crédito", "GoCuotas", "Otra"];

// Catálogo de tipos de comprobante. Los que tienen requiereArca:true existen en la estructura
// (Configuración → Facturación → Tipos de comprobante los va a mostrar) pero NO son seleccionables
// todavía — no hay forma de emitir una Factura A/B/C real sin ARCA, y no se va a fingir que sí.
export const TIPOS_COMPROBANTE = [
  { codigo: "COMPROBANTE_INTERNO", nombre: "Comprobante Interno", letra: "X", esNotaCredito: false, requiereArca: false },
  { codigo: "NOTA_CREDITO_INTERNA", nombre: "Nota de Crédito Interna", letra: "X", esNotaCredito: true, requiereArca: false },
  { codigo: "FACTURA_A", nombre: "Factura A", letra: "A", esNotaCredito: false, requiereArca: true },
  { codigo: "FACTURA_B", nombre: "Factura B", letra: "B", esNotaCredito: false, requiereArca: true },
  { codigo: "FACTURA_C", nombre: "Factura C", letra: "C", esNotaCredito: false, requiereArca: true },
  { codigo: "NOTA_CREDITO_A", nombre: "Nota de Crédito A", letra: "A", esNotaCredito: true, requiereArca: true },
  { codigo: "NOTA_CREDITO_B", nombre: "Nota de Crédito B", letra: "B", esNotaCredito: true, requiereArca: true },
  { codigo: "NOTA_CREDITO_C", nombre: "Nota de Crédito C", letra: "C", esNotaCredito: true, requiereArca: true },
];

export function tipoComprobantePorCodigo(codigo) {
  return TIPOS_COMPROBANTE.find((t) => t.codigo === codigo) || TIPOS_COMPROBANTE[0];
}

// Los únicos elegibles hoy (mientras arcaActivo sea false) — ver FiscalService.
export function tiposComprobanteDisponibles() {
  return TIPOS_COMPROBANTE.filter((t) => !t.requiereArca && !t.esNotaCredito);
}

const SUCURSAL_POR_DEFECTO = { puntoVenta: "0001", nombre: "Casa Central" };

export async function sucursalParaFacturar() {
  const activas = await listarSucursalesActivas();
  return activas[0] || SUCURSAL_POR_DEFECTO;
}

export function formatearNumeroComprobante(puntoVenta, numero) {
  return `${puntoVenta}-${String(numero).padStart(8, "0")}`;
}

async function siguienteNumeroComprobante(puntoVenta, tipoCodigo) {
  // Un contador por combinación punto de venta + tipo — NO una numeración global única (punto 7
  // del pedido). Ej.: Sucursal 1/Comprobante Interno y Sucursal 2/Comprobante Interno llevan cada
  // una su propia correlatividad, igual que exige después la numeración fiscal de ARCA.
  const contadorId = `comprobantes_${puntoVenta}_${tipoCodigo}`;
  const contadorRef = doc(db, "contadores", contadorId);
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

// --- FiscalService --------------------------------------------------------------------------
// PUNTO DE INTEGRACIÓN ARCA: acá es donde en el futuro se enchufa la conexión fiscal real, sin
// tocar el resto del módulo (Nueva Venta, PDF, WhatsApp, email, historial). La interfaz que va a
// tener que implementar ArcaFiscalProvider es exactamente la de InternalProvider.autorizar().
//
//   VENTA → FiscalService → { InternalProvider (hoy) | ArcaFiscalProvider (futuro) } → ARCA
//
// Mientras configuracion/facturacion.arcaActivo sea false (siempre, por ahora — no hay forma de
// activarlo desde la UI todavía), FiscalService.autorizar() siempre usa InternalProvider.
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

// TODO (futuro, NO implementar todavía): ArcaFiscalProvider — misma interfaz que InternalProvider.
// Antes de escribir una sola línea de esto hay que investigar contra la documentación oficial
// vigente de ARCA (no inventar endpoints/campos), como mínimo:
//   - ArcaAuthService: WSAA — autenticación con certificado digital X.509 (TEST y PRODUCCIÓN son
//     certificados y entornos DISTINTOS, nunca se mezclan) → Ticket de Acceso (token + sign, vida
//     limitada) que después usa el Web Service de negocio.
//   - WSFEv1 (o el que corresponda vigente) para Factura A/B/C/M: qué método exacto autoriza cada
//     tipo, con qué estructura de request/response, qué código de comprobante fiscal usa cada uno.
//   - Qué correlatividad exige ARCA por punto de venta + tipo (ya preparado acá, ver arriba).
//   - Especificación oficial del QR fiscal (no se inventa el contenido).
// autorizar(comprobante) debería:
//   1. Determinar tipo de comprobante fiscal según condición de IVA emisor/receptor.
//   2. Armar el request del Web Service correspondiente.
//   3. Autenticarse vía WSAA (certificado + clave privada, como ya hace arcaWsaa.js para el padrón).
//   4. Enviar y recibir CAE + vencimiento + resultado (o el motivo de rechazo, sin inventar nada).
//   5. Devolver los mismos 8 campos que InternalProvider, con los valores reales de ARCA.
// El resto del módulo NO debería necesitar cambios — solo evaluarProveedorFiscal() de acá abajo.
function evaluarProveedorFiscal() {
  return InternalProvider; // cambiar acá cuando exista ArcaFiscalProvider y arcaActivo sea true
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

// datos: { items, descuentoGlobalPct, cliente, formaPago, pagos?, observaciones, ventaId,
//          tipoComprobanteCodigo, guardarComoBorrador }
// items: [{ productoId?, productoSku?, productoDescripcion, cantidad, precioUnitario, descuentoPct }]
export async function crearComprobante(datos, usuario) {
  if (!datos.items || datos.items.length === 0) throw new Error("El comprobante necesita al menos un producto.");
  for (const it of datos.items) {
    if (!(it.cantidad > 0)) throw new Error(`Cantidad inválida para "${it.productoDescripcion}".`);
    if (!(it.precioUnitario >= 0)) throw new Error(`Precio inválido para "${it.productoDescripcion}".`);
  }
  if (!datos.formaPago) throw new Error("Falta la forma de pago.");

  const tipo = tipoComprobantePorCodigo(datos.tipoComprobanteCodigo || "COMPROBANTE_INTERNO");
  if (tipo.requiereArca) throw new Error(`${tipo.nombre} todavía no se puede emitir — requiere conexión con ARCA.`);

  const items = datos.items.map((it) => ({ ...it, subtotal: subtotalItem(it) }));
  const { subtotal, descuento, iva, total } = calcularTotales(items, datos.descuentoGlobalPct || 0);

  const estado = datos.guardarComoBorrador ? "BORRADOR" : "EMITIDA";
  const ahora = serverTimestamp();
  const sucursal = await sucursalParaFacturar();

  let numero = null;
  let numeroCompleto = null;
  if (estado === "EMITIDA") {
    numero = await siguienteNumeroComprobante(sucursal.puntoVenta, tipo.codigo);
    numeroCompleto = `${tipo.letra} ${formatearNumeroComprobante(sucursal.puntoVenta, numero)}`;
  }

  const fiscalProvider = evaluarProveedorFiscal();
  const datosFiscales = estado === "EMITIDA" ? await fiscalProvider.autorizar({ items, total }) : {};

  const comprobante = {
    tipoComprobante: tipo.nombre,
    tipoComprobanteCodigo: tipo.codigo,
    letra: tipo.letra,
    estado,
    puntoVenta: sucursal.puntoVenta,
    sucursalNombre: sucursal.nombre,
    numero,
    numeroCompleto,
    fechaEmision: new Date().toISOString().slice(0, 10),

    ventaId: datos.ventaId || null,
    comprobanteRelacionadoId: datos.comprobanteRelacionadoId || null, // solo para notas de crédito

    ...datosClienteDesde(datos.cliente),

    items,
    subtotal,
    descuento,
    iva,
    total,

    formaPago: datos.formaPago,
    pagos: datos.pagos || null, // detalle por medio, cuando la venta lo trae (varios medios)
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
// usuario no vuelve a tipear nada (esto es lo que llama productos/venta-nueva.js al confirmar).
export function comprobanteDesdeVenta(venta, clienteCompleto, tipoComprobanteCodigo = "COMPROBANTE_INTERNO") {
  return {
    ventaId: venta.id,
    tipoComprobanteCodigo,
    items: (venta.items || []).map((it) => ({
      productoId: it.productoId,
      productoSku: it.productoSku,
      productoDescripcion: it.productoDescripcion,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario,
      descuentoPct: it.descuentoPct || 0,
    })),
    descuentoGlobalPct: 0, // el descuento de la venta ya está prorrateado en cada ítem
    cliente: clienteCompleto || null,
    formaPago: (venta.pagos || []).length > 1 ? "Varios medios" : venta.pagos?.[0]?.medio || "Efectivo",
    pagos: venta.pagos || null,
  };
}

export async function obtenerComprobante(id) {
  const snap = await getDoc(doc(db, "comprobantes", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function obtenerComprobantePorVenta(ventaId) {
  const snap = await getDocs(query(collection(db, "comprobantes"), where("ventaId", "==", ventaId), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function listarComprobantesPorVenta(ventaId) {
  const snap = await getDocs(query(collection(db, "comprobantes"), where("ventaId", "==", ventaId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

// --- Notas de crédito -----------------------------------------------------------------------
// El mecanismo correcto para revertir un comprobante ya emitido — nunca se borra ni se "desemite"
// el original (punto 13/17 del pedido). Hoy, sin ARCA, la Nota de Crédito también es interna
// (letra X) — el día que haya comprobantes fiscales reales, este mismo camino emite una NC con la
// letra fiscal que corresponda (A/B/C), asociada igual que acá.
export async function crearNotaCredito(comprobanteOriginalId, motivo, usuario) {
  if (!motivo?.trim()) throw new Error("Ingresá un motivo para la nota de crédito.");
  const original = await obtenerComprobante(comprobanteOriginalId);
  if (!original) throw new Error("No se encontró el comprobante original.");
  if (original.estado !== "EMITIDA") throw new Error("Solo se puede generar una nota de crédito de un comprobante emitido.");

  const tipoNC = original.tipoComprobanteCodigo === "COMPROBANTE_INTERNO" ? "NOTA_CREDITO_INTERNA" : original.tipoComprobanteCodigo;

  const notaCredito = await crearComprobante(
    {
      items: original.items,
      descuentoGlobalPct: 0,
      cliente: original.clienteId ? { id: original.clienteId, razonSocial: original.clienteNombre, cuit: original.clienteCuit, domicilioEntrega: original.clienteDireccion, condicionIva: original.clienteCondicionIva } : null,
      formaPago: original.formaPago,
      observaciones: `Nota de crédito por ${original.numeroCompleto}. Motivo: ${motivo.trim()}`,
      tipoComprobanteCodigo: tipoNC,
      comprobanteRelacionadoId: original.id,
    },
    usuario
  );

  // El original NUNCA se borra ni pierde sus datos — solo queda marcado con la referencia a la
  // nota de crédito que lo canceló, para que la ficha y el PDF lo puedan mostrar.
  await updateDoc(doc(db, "comprobantes", original.id), {
    estado: "ANULADA",
    motivoAnulacion: motivo.trim(),
    fechaAnulacion: serverTimestamp(),
    anuladoPor: usuario.uid,
    anuladoPorNombre: usuario.nombre || usuario.email,
    actualizadoEn: serverTimestamp(),
  });

  return notaCredito;
}
