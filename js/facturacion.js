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
import { obtenerConfigFacturacion } from "./facturacion-config.js";
import { obtenerConfigEmpresa } from "./configuracion-empresa.js";
import { autorizarComprobanteArca } from "./arca-facturacion.js";
import { discriminarIva } from "./contabilidad.js";

// PROCESANDO_ARCA y RECHAZADA solo se usan del lado de ARCA (ver ArcaFiscalProvider) — un
// comprobante interno nunca pasa por ninguno de los dos, nace directo en EMITIDA como siempre.
export const ESTADOS_COMPROBANTE = ["BORRADOR", "EMITIDA", "PROCESANDO_ARCA", "RECHAZADA", "ANULADA"];
// arcaEstado (campo aparte, dentro de datosFiscales) — no confundir con comprobante.estado de
// arriba: arcaEstado describe el resultado puntual de LA AUTORIZACIÓN, estado describe el
// comprobante completo (que además puede después pasar a ANULADA vía nota de crédito).
export const ESTADOS_ARCA = ["PENDING_ARCA", "AUTHORIZED", "REJECTED"];

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

// El precio de cada línea (precioUnitario) ya incluye IVA, como el resto del sistema — subtotal es
// el NETO (sin IVA), total sigue siendo el bruto que paga el cliente (idéntico en $ al de antes de
// discriminar; lo único que cambia es que ahora se sabe cuánto de eso es IVA). Cada item necesita
// `iva` (la alícuota del producto, ver productos.js) para discriminarse correctamente — si falta
// (comprobantes viejos, o un ítem sin producto vinculado) se asume 21%, la alícuota general.
export function calcularTotales(items, descuentoGlobalPct = 0) {
  const subtotalBruto = items.reduce((acc, it) => acc + subtotalItem(it), 0);
  const descuento = Math.round(subtotalBruto * ((descuentoGlobalPct || 0) / 100) * 100) / 100;
  const factor = subtotalBruto > 0 ? (subtotalBruto - descuento) / subtotalBruto : 1;
  const total = Math.round((subtotalBruto - descuento) * 100) / 100;

  // iva se suma línea por línea (cada una puede tener su propia alícuota); subtotal sale de restarle
  // ese iva al total ya redondeado, en vez de sumar los netos de cada línea por separado — así
  // subtotal + iva da EXACTO el total siempre, sin quedar a un centavo de diferencia por acumular
  // redondeos de cada línea (puede pasar con 3+ ítems de alícuotas distintas).
  let iva = 0;
  for (const it of items) {
    const brutoItem = subtotalItem(it) * factor;
    iva += discriminarIva(brutoItem, it.iva).iva;
  }
  iva = Math.round(iva * 100) / 100;
  const subtotal = Math.round((total - iva) * 100) / 100;
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

// ArcaFiscalProvider — implementado en functions/arcaFacturacion.js (Cloud Function), acá solo el
// wrapper que respeta la misma interfaz que InternalProvider. autorizar(comprobante) espera
// { comprobanteId, ptoVta, items, receptor, ambiente } — ver crearComprobante más abajo, que arma
// exactamente eso y guarda el comprobante ANTES de llamar a ARCA (para que comprobanteId exista y
// sirva de clave de idempotencia: dos llamadas con el mismo comprobanteId nunca piden un segundo
// CAE — ver el chequeo al principio de arcaAutorizarComprobante).
//
// TODAVÍA NO PROBADO CONTRA ARCA (no hay certificado de homologación cargado) — ver informe final.
const ArcaFiscalProvider = {
  nombre: "arca",
  async autorizar({ comprobanteId, ptoVta, items, receptor, ambiente }) {
    return autorizarComprobanteArca({ comprobanteId, ptoVta, items, receptor, ambiente });
  },
};

// Único punto de decisión de toda la integración: mientras arcaActivo sea false (siempre, en esta
// etapa — no hay forma de ponerlo en true desde la UI todavía), SIEMPRE devuelve InternalProvider,
// así que ArcaFiscalProvider.autorizar() nunca se llega a ejecutar y la facturación interna actual
// sigue funcionando exactamente igual que antes de esta integración.
async function evaluarProveedorFiscal() {
  const config = await obtenerConfigFacturacion();
  return config.arcaActivo ? ArcaFiscalProvider : InternalProvider;
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
// items: [{ productoId?, productoSku?, productoDescripcion, cantidad, precioUnitario, descuentoPct, iva? }]
export async function crearComprobante(datos, usuario) {
  if (!datos.items || datos.items.length === 0) throw new Error("El comprobante necesita al menos un producto.");
  for (const it of datos.items) {
    if (!(it.cantidad > 0)) throw new Error(`Cantidad inválida para "${it.productoDescripcion}".`);
    if (!(it.precioUnitario >= 0)) throw new Error(`Precio inválido para "${it.productoDescripcion}".`);
  }
  if (!datos.formaPago) throw new Error("Falta la forma de pago.");

  const tipo = tipoComprobantePorCodigo(datos.tipoComprobanteCodigo || "COMPROBANTE_INTERNO");
  const configFiscal = tipo.requiereArca ? await obtenerConfigFacturacion() : null;
  // Mismo mensaje, misma condición de bloqueo que antes de esta integración — la única diferencia
  // es que ahora depende de arcaActivo en vez de ser un bloqueo incondicional. Como arcaActivo es
  // false siempre en esta etapa, el comportamiento observable es IDÉNTICO al de antes.
  if (tipo.requiereArca && !configFiscal.arcaActivo) {
    throw new Error(`${tipo.nombre} todavía no se puede emitir — requiere conexión con ARCA.`);
  }

  const items = datos.items.map((it) => ({ ...it, subtotal: subtotalItem(it) }));
  const { subtotal, descuento, iva, total } = calcularTotales(items, datos.descuentoGlobalPct || 0);

  const estadoDeseado = datos.guardarComoBorrador ? "BORRADOR" : "EMITIDA";
  const ahora = serverTimestamp();
  const sucursal = await sucursalParaFacturar();

  let numero = null;
  let numeroCompleto = null;
  let estado = estadoDeseado;
  let datosFiscales = {};

  if (estadoDeseado === "EMITIDA" && !tipo.requiereArca) {
    // Comprobante interno: exactamente el mismo camino de siempre, sin cambios.
    numero = await siguienteNumeroComprobante(sucursal.puntoVenta, tipo.codigo);
    numeroCompleto = `${tipo.letra} ${formatearNumeroComprobante(sucursal.puntoVenta, numero)}`;
    datosFiscales = await InternalProvider.autorizar({ items, total });
  } else if (estadoDeseado === "EMITIDA" && tipo.requiereArca) {
    // Fiscal: el número lo da ARCA (FECompUltimoAutorizado + 1 del lado de la Cloud Function), no
    // el contador interno — acá arranca en PROCESANDO_ARCA/PENDING_ARCA, sin numero todavía; se
    // completa después de llamar a ArcaFiscalProvider (ver más abajo, necesita el ID del documento
    // ya creado como clave de idempotencia).
    estado = "PROCESANDO_ARCA";
    datosFiscales = { arcaEstado: "PENDING_ARCA", cae: null, caeVencimiento: null, qr: null, numeroFiscal: null, tipoComprobanteFiscal: null, fechaAutorizacion: null, arcaErrorCodigo: null, arcaErrorDescripcion: null };
  }

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

  if (estadoDeseado === "EMITIDA" && tipo.requiereArca) {
    // Recién acá se llama a ARCA — comprobanteId (ref.id) ya existe, así que un doble click o un
    // reintento después de un timeout del cliente que vuelva a pasar por acá con el MISMO ref.id
    // nunca pide un segundo CAE (ver el chequeo de idempotencia en arcaAutorizarComprobante). Un
    // reintento del usuario que arranca todo de nuevo desde Nueva Venta sí genera un comprobanteId
    // distinto — eso es intencional: cada intento de facturar es un comprobante propio, como en el
    // camino interno de siempre.
    const resultadoArca = await ArcaFiscalProvider.autorizar({
      comprobanteId: ref.id,
      ptoVta: sucursal.puntoVenta,
      items,
      receptor: { cuit: comprobante.clienteCuit, condicionIva: comprobante.clienteCondicionIva },
      ambiente: configFiscal.arcaAmbiente,
    });

    const aprobado = resultadoArca.arcaEstado === "AUTHORIZED";
    estado = aprobado ? "EMITIDA" : "RECHAZADA";
    numero = resultadoArca.numeroFiscal;
    numeroCompleto = numero ? `${resultadoArca.tipoComprobanteFiscal} ${formatearNumeroComprobante(sucursal.puntoVenta, numero)}` : null;
    datosFiscales = resultadoArca;

    await updateDoc(ref, { estado, numero, numeroCompleto, ...datosFiscales, actualizadoEn: serverTimestamp() });
    return { id: ref.id, ...comprobante, estado, numero, numeroCompleto, ...datosFiscales };
  }

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
      iva: it.iva,
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

// Para la cuenta corriente del cliente: TODOS sus comprobantes, incluidas las notas de crédito
// (que no tienen ventaId propio — se relacionan por comprobanteRelacionadoId, no por venta).
export async function listarComprobantesPorCliente(clienteId) {
  const snap = await getDocs(query(collection(db, "comprobantes"), where("clienteId", "==", clienteId)));
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

  // Mapeo Factura → Nota de Crédito de la misma letra fiscal (antes de esta corrección, un comprobante
  // fiscal (FACTURA_A/B/C) generaba una "nota de crédito" con el código de la FACTURA original — un
  // bug real pero inofensivo hasta ahora porque tipo.requiereArca bloqueaba cualquier Factura A/B/C
  // antes de que pudiera existir una para anular).
  const MAPA_TIPO_A_NOTA_CREDITO = {
    COMPROBANTE_INTERNO: "NOTA_CREDITO_INTERNA",
    FACTURA_A: "NOTA_CREDITO_A",
    FACTURA_B: "NOTA_CREDITO_B",
    FACTURA_C: "NOTA_CREDITO_C",
  };
  const tipoNC = MAPA_TIPO_A_NOTA_CREDITO[original.tipoComprobanteCodigo];
  if (!tipoNC) throw new Error(`No se puede generar una nota de crédito para el tipo de comprobante "${original.tipoComprobante}".`);

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
