// Cajas de Tesorería: cada caja (Principal, Chica, o una caja de venta más) pertenece a una
// sucursal y funciona por SESIONES (apertura → movimientos → cierre). El saldo nunca se guarda
// suelto — siempre se deriva de saldoInicial + ingresos - egresos de la sesión (ver saldoSesion),
// mismo criterio que el resto del ERP (contadores aparte, todo lo demás sale de sumar movimientos).
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";

export const TIPOS_CAJA = ["Principal", "Chica", "Caja"];

export async function crearCaja({ nombre, sucursalId, sucursalNombre, tipo }) {
  const ref = await addDoc(collection(db, "cajas"), {
    nombre: nombre.trim(),
    sucursalId,
    sucursalNombre,
    tipo: tipo || "Caja",
    activa: true,
    creadoEn: serverTimestamp(),
  });
  return { id: ref.id };
}

export async function actualizarCaja(id, { nombre, tipo, activa }) {
  const cambios = {};
  if (nombre !== undefined) cambios.nombre = nombre.trim();
  if (tipo !== undefined) cambios.tipo = tipo;
  if (activa !== undefined) cambios.activa = activa;
  await updateDoc(doc(db, "cajas", id), cambios);
}

export async function listarCajas() {
  const snap = await getDocs(query(collection(db, "cajas"), orderBy("sucursalNombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCajasPorSucursal(sucursalId) {
  const snap = await getDocs(query(collection(db, "cajas"), where("sucursalId", "==", sucursalId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerCaja(id) {
  const snap = await getDoc(doc(db, "cajas", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- Sesiones (apertura/cierre) ---------------------------------------------------------------

export async function sesionAbiertaDeCaja(cajaId) {
  const snap = await getDocs(query(collection(db, "sesionesCaja"), where("cajaId", "==", cajaId), where("estado", "==", "abierta"), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function abrirCaja(caja, saldoInicial, usuario) {
  const existente = await sesionAbiertaDeCaja(caja.id);
  if (existente) throw new Error(`${caja.nombre} ya está abierta desde ${existente.fechaApertura?.toDate?.().toLocaleString("es-AR") || "antes"}.`);
  const ref = await addDoc(collection(db, "sesionesCaja"), {
    cajaId: caja.id,
    cajaNombre: caja.nombre,
    sucursalId: caja.sucursalId,
    sucursalNombre: caja.sucursalNombre,
    estado: "abierta",
    saldoInicial: saldoInicial || 0,
    fechaApertura: serverTimestamp(),
    aperturaPor: usuario.uid,
    aperturaPorNombre: usuario.nombre || usuario.email,
    fechaCierre: null,
    cierrePor: null,
    cierrePorNombre: null,
    saldoTeorico: null,
    dineroContado: null,
    diferencia: null,
    arqueo: null,
  });
  return { id: ref.id };
}

export async function listarMovimientosPorSesion(sesionId) {
  const snap = await getDocs(query(collection(db, "movimientosCaja"), where("sesionId", "==", sesionId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function saldoSesion(sesion, movimientos) {
  const ingresos = movimientos.filter((m) => m.tipo === "ingreso" && m.estado !== "anulado").reduce((acc, m) => acc + m.importe, 0);
  const egresos = movimientos.filter((m) => m.tipo === "egreso" && m.estado !== "anulado").reduce((acc, m) => acc + m.importe, 0);
  return Math.round((sesion.saldoInicial + ingresos - egresos) * 100) / 100;
}

// Cierra la sesión: calcula el saldo teórico a partir de los movimientos reales (nunca se le pide
// al usuario que lo tipee) y compara contra lo contado físicamente — la diferencia queda registrada,
// nunca se oculta ni se "ajusta" el teórico para que cierre.
export async function cerrarCaja(sesion, dineroContado, arqueo, usuario) {
  const movimientos = await listarMovimientosPorSesion(sesion.id);
  const saldoTeorico = saldoSesion(sesion, movimientos);
  const diferencia = Math.round((dineroContado - saldoTeorico) * 100) / 100;
  await updateDoc(doc(db, "sesionesCaja", sesion.id), {
    estado: "cerrada",
    fechaCierre: serverTimestamp(),
    cierrePor: usuario.uid,
    cierrePorNombre: usuario.nombre || usuario.email,
    saldoTeorico,
    dineroContado,
    diferencia,
    arqueo: arqueo || null,
  });
  return { saldoTeorico, dineroContado, diferencia };
}

export async function listarSesionesPorCaja(cajaId, maxResultados = 50) {
  const snap = await getDocs(query(collection(db, "sesionesCaja"), where("cajaId", "==", cajaId), orderBy("fechaApertura", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Para "Cajas sin cerrar" del Centro de Pendientes — todas las sesiones abiertas de todo el negocio.
export async function listarSesionesAbiertas() {
  const snap = await getDocs(query(collection(db, "sesionesCaja"), where("estado", "==", "abierta")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerSesion(id) {
  const snap = await getDoc(doc(db, "sesionesCaja", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- Movimientos ---------------------------------------------------------------------------------

// datos: { cajaId, sesionId, sucursalId, tipo: "ingreso"|"egreso", concepto, importe, medio,
//          referencia?, ventaId?, clienteId?, clienteNombre?, origen?: { tipo, id } }
export async function registrarMovimientoCaja(datos, usuario) {
  if (!(datos.importe > 0)) throw new Error("El importe tiene que ser mayor a cero.");
  const ref = await addDoc(collection(db, "movimientosCaja"), {
    cajaId: datos.cajaId,
    sesionId: datos.sesionId,
    sucursalId: datos.sucursalId || null,
    fecha: new Date().toISOString().slice(0, 10),
    tipo: datos.tipo,
    concepto: datos.concepto,
    importe: Math.round(datos.importe * 100) / 100,
    medio: datos.medio || "Efectivo",
    referencia: datos.referencia || "",
    ventaId: datos.ventaId || null,
    clienteId: datos.clienteId || null,
    clienteNombre: datos.clienteNombre || null,
    origen: datos.origen || null,
    estado: "registrado",
    usuario: usuario.uid,
    usuarioNombre: usuario.nombre || usuario.email,
    creadoEn: serverTimestamp(),
  });
  return { id: ref.id };
}

// Saldo actual "de la caja" (no de una sesión puntual): si está abierta, lo que lleva movido esta
// sesión; si está cerrada, lo último contado al cerrar (el efectivo físico se queda guardado hasta
// la próxima apertura). Nunca inventa un saldo cuando la caja nunca se abrió.
export async function saldoActualCaja(caja) {
  const abierta = await sesionAbiertaDeCaja(caja.id);
  if (abierta) {
    const movimientos = await listarMovimientosPorSesion(abierta.id);
    return { saldo: saldoSesion(abierta, movimientos), sesion: abierta };
  }
  const sesiones = await listarSesionesPorCaja(caja.id, 1);
  if (sesiones.length === 0) return { saldo: 0, sesion: null };
  return { saldo: sesiones[0].dineroContado ?? 0, sesion: sesiones[0] };
}
