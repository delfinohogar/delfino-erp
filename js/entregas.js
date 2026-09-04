// Estado de entrega de una venta con "Envío a domicilio" u "Otro". La venta es inmutable (ver
// firestore.rules) y quedaba con estadoEntrega:"pendiente" congelado para siempre — acá vive el
// estado real, en un doc propio por venta (id = ventaId, así "ya existe" es un simple getDoc).
import { db, doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, serverTimestamp } from "./firebase.js";

export async function crearEntrega(
  { ventaId, numeroVenta, clienteId, clienteNombre, sucursalId, sucursalNombre, tipoEntrega, domicilioEntrega, notaEntrega },
  usuario
) {
  await setDoc(doc(db, "entregas", ventaId), {
    ventaId,
    numeroVenta,
    clienteId: clienteId || null,
    clienteNombre: clienteNombre || null,
    sucursalId: sucursalId || null,
    sucursalNombre: sucursalNombre || null,
    tipoEntrega,
    domicilioEntrega: domicilioEntrega || null,
    notaEntrega: notaEntrega || null,
    estado: "pendiente",
    creadoPor: usuario.uid,
    creadoEn: serverTimestamp(),
    entregadoPor: null,
    entregadoPorNombre: null,
    entregadoEn: null,
  });
}

export async function obtenerEntrega(ventaId) {
  const snap = await getDoc(doc(db, "entregas", ventaId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listarEntregas() {
  const snap = await getDocs(collection(db, "entregas"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarEntregasPendientes() {
  const snap = await getDocs(query(collection(db, "entregas"), where("estado", "==", "pendiente")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function marcarEntregado(ventaId, usuario) {
  await updateDoc(doc(db, "entregas", ventaId), {
    estado: "entregado",
    entregadoPor: usuario.uid,
    entregadoPorNombre: usuario.nombre || usuario.email,
    entregadoEn: serverTimestamp(),
  });
}
