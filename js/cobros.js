// Cobros a cliente: la contraparte de pagosProveedores. La mayoría se generan solos al confirmar una
// venta (ver ventas.js) — este módulo también permite registrar un cobro después, contra una venta
// que quedó total o parcialmente "Pendiente de pago".
import { db, collection, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";

export const MEDIOS_COBRO = ["Efectivo", "Tarjeta", "Transferencia", "Otro"];

// datos: { clienteId, clienteNombre, ventaId, numeroVenta, monto, fecha, medioPago, referencia, notas }
export async function crearCobro(datos, usuario) {
  const ref = await addDoc(collection(db, "cobros"), {
    clienteId: datos.clienteId,
    clienteNombre: datos.clienteNombre,
    ventaId: datos.ventaId,
    numeroVenta: datos.numeroVenta,
    monto: datos.monto,
    fecha: datos.fecha,
    medioPago: datos.medioPago,
    referencia: datos.referencia || "",
    notas: datos.notas || "",
    usuario: usuario.uid,
    creadoEn: serverTimestamp(),
  });
  return ref.id;
}

export async function listarCobros(maxResultados = 200) {
  const snap = await getDocs(query(collection(db, "cobros"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCobrosPorCliente(clienteId) {
  const snap = await getDocs(query(collection(db, "cobros"), where("clienteId", "==", clienteId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCobrosPorVenta(ventaId) {
  const snap = await getDocs(query(collection(db, "cobros"), where("ventaId", "==", ventaId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
