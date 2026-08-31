// Pagos a proveedor, siempre atados a una factura de compra puntual (permite saber qué facturas
// están pagas/parciales/pendientes, y armar la cuenta corriente por proveedor).
import { db, collection, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";

export const MEDIOS_PAGO = ["Efectivo", "Transferencia", "Cheque", "Otro"];

// datos: { proveedorId, proveedorNombre, compraId, compraNumero, monto, fecha, medioPago, referencia, notas }
export async function crearPago(datos, usuario) {
  const ref = await addDoc(collection(db, "pagosProveedores"), {
    proveedorId: datos.proveedorId,
    proveedorNombre: datos.proveedorNombre,
    compraId: datos.compraId,
    compraNumero: datos.compraNumero,
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

export async function listarPagos(maxResultados = 200) {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarPagosPorProveedor(proveedorId) {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), where("proveedorId", "==", proveedorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarPagosPorCompra(compraId) {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), where("compraId", "==", compraId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
