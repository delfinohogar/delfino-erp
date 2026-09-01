// Bancos y cuentas bancarias. El saldo de una cuenta, igual que una caja, se deriva siempre de sus
// movimientos (ver saldoCuenta) — nunca se guarda un número suelto que se pueda desincronizar.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, serverTimestamp } from "./firebase.js";

export async function crearBanco(nombre) {
  const ref = await addDoc(collection(db, "bancos"), { nombre: nombre.trim(), activo: true, creadoEn: serverTimestamp() });
  return { id: ref.id };
}

export async function listarBancos() {
  const snap = await getDocs(query(collection(db, "bancos"), orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function actualizarBanco(id, { nombre, activo }) {
  const cambios = {};
  if (nombre !== undefined) cambios.nombre = nombre.trim();
  if (activo !== undefined) cambios.activo = activo;
  await updateDoc(doc(db, "bancos", id), cambios);
}

// datos: { bancoId, bancoNombre, nombre, alias, cbu, numeroCuenta, moneda, sucursalId, sucursalNombre }
export async function crearCuentaBancaria(datos) {
  const ref = await addDoc(collection(db, "cuentasBancarias"), {
    bancoId: datos.bancoId,
    bancoNombre: datos.bancoNombre,
    nombre: datos.nombre.trim(),
    alias: datos.alias?.trim() || null,
    cbu: datos.cbu?.trim() || null,
    numeroCuenta: datos.numeroCuenta?.trim() || null,
    moneda: datos.moneda || "ARS",
    sucursalId: datos.sucursalId || null,
    sucursalNombre: datos.sucursalNombre || null,
    activa: true,
    creadoEn: serverTimestamp(),
  });
  return { id: ref.id };
}

export async function actualizarCuentaBancaria(id, datos) {
  await updateDoc(doc(db, "cuentasBancarias", id), datos);
}

export async function listarCuentasBancarias() {
  const snap = await getDocs(query(collection(db, "cuentasBancarias"), orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCuentasBancariasActivas() {
  const todas = await listarCuentasBancarias();
  return todas.filter((c) => c.activa !== false);
}

export async function obtenerCuentaBancaria(id) {
  const snap = await getDoc(doc(db, "cuentasBancarias", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- Movimientos bancarios -----------------------------------------------------------------------

// datos: { cuentaId, tipo: "ingreso"|"egreso", concepto, importe, referencia?, ventaId?, clienteId?,
//          clienteNombre?, origen?: { tipo, id } }
export async function registrarMovimientoBancario(datos, usuario) {
  if (!(datos.importe > 0)) throw new Error("El importe tiene que ser mayor a cero.");
  const ref = await addDoc(collection(db, "movimientosBancarios"), {
    cuentaId: datos.cuentaId,
    fecha: datos.fecha || new Date().toISOString().slice(0, 10),
    tipo: datos.tipo,
    concepto: datos.concepto,
    importe: Math.round(datos.importe * 100) / 100,
    referencia: datos.referencia || "",
    ventaId: datos.ventaId || null,
    clienteId: datos.clienteId || null,
    clienteNombre: datos.clienteNombre || null,
    origen: datos.origen || null,
    estado: "pendiente", // pendiente de conciliar — nunca "conciliado" al crearse, eso es un paso aparte
    conciliadoPor: null,
    conciliadoPorNombre: null,
    fechaConciliacion: null,
    usuario: usuario.uid,
    usuarioNombre: usuario.nombre || usuario.email,
    creadoEn: serverTimestamp(),
  });
  return { id: ref.id };
}

export async function listarMovimientosPorCuenta(cuentaId) {
  const snap = await getDocs(query(collection(db, "movimientosBancarios"), where("cuentaId", "==", cuentaId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

export async function listarMovimientosBancariosPendientes() {
  const snap = await getDocs(query(collection(db, "movimientosBancarios"), where("estado", "==", "pendiente")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function saldoCuenta(movimientos) {
  const ingresos = movimientos.filter((m) => m.tipo === "ingreso" && m.estado !== "anulado").reduce((acc, m) => acc + m.importe, 0);
  const egresos = movimientos.filter((m) => m.tipo === "egreso" && m.estado !== "anulado").reduce((acc, m) => acc + m.importe, 0);
  return Math.round((ingresos - egresos) * 100) / 100;
}

export async function saldoActualCuenta(cuentaId) {
  const movimientos = await listarMovimientosPorCuenta(cuentaId);
  return saldoCuenta(movimientos);
}

// Conciliación manual: marca un movimiento como conciliado, opcionalmente asociado a otro registro
// del ERP (venta, gasto, transferencia) — nunca automática, porque no hay una integración real de
// extracto bancario todavía (ver limitaciones documentadas en el módulo de Tesorería).
export async function conciliarMovimientoBancario(id, usuario, movimientoRelacionado = null) {
  await updateDoc(doc(db, "movimientosBancarios", id), {
    estado: "conciliado",
    conciliadoPor: usuario.uid,
    conciliadoPorNombre: usuario.nombre || usuario.email,
    fechaConciliacion: serverTimestamp(),
    movimientoRelacionado: movimientoRelacionado || null,
  });
}
