// Órdenes de compra: pedidos/intenciones de compra a proveedor que todavía no llegaron.
// A diferencia de una Compra, NO tocan stock ni costo de referencia — solo quedan registradas
// hasta que la mercadería llega y se carga como Compra real (o se cancela el pedido).
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, orderBy, limit, serverTimestamp } from "./firebase.js";

// datos: { proveedorId, proveedorNombre, fecha, fechaEstimadaEntrega, referencia, items }
// items: [{ productoId, productoSku, productoDescripcion, cantidad, precioFinal }]
export async function crearOrdenCompra(datos, usuario) {
  const total = datos.items.reduce((acc, it) => acc + it.cantidad * it.precioFinal, 0);
  const ref = await addDoc(collection(db, "ordenesCompra"), {
    proveedorId: datos.proveedorId,
    proveedorNombre: datos.proveedorNombre,
    fecha: datos.fecha,
    fechaEstimadaEntrega: datos.fechaEstimadaEntrega || null,
    referencia: datos.referencia || "",
    items: datos.items,
    total,
    estado: "pendiente",
    usuario: usuario.uid,
    creadoEn: serverTimestamp(),
  });
  return ref.id;
}

export async function obtenerOrdenCompra(id) {
  const snap = await getDoc(doc(db, "ordenesCompra", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listarOrdenesCompra(maxResultados = 100) {
  const snap = await getDocs(query(collection(db, "ordenesCompra"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function actualizarEstadoOrden(id, estado) {
  await updateDoc(doc(db, "ordenesCompra", id), { estado });
}

// Al recibir la mercadería, la orden queda marcada "recibida" y vinculada a la Compra real que
// se generó a partir de ella (esa Compra es la que efectivamente suma stock y actualiza costo).
export async function marcarOrdenRecibida(id, compraId) {
  await updateDoc(doc(db, "ordenesCompra", id), { estado: "recibida", compraId });
}
