// Sucursales — cada una tiene su propio punto de venta interno, que es lo que separa la
// numeración de comprobantes de una sucursal de otra (ver js/facturacion.js). Mismo patrón simple
// que marcas/categorías: una colección plana, solo administrador la edita.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, orderBy } from "./firebase.js";

export async function listarSucursales() {
  const snap = await getDocs(query(collection(db, "sucursales"), orderBy("puntoVenta")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarSucursalesActivas() {
  const todas = await listarSucursales();
  return todas.filter((s) => s.activa !== false);
}

export async function obtenerSucursal(id) {
  const snap = await getDoc(doc(db, "sucursales", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function formatearPuntoVenta(numero) {
  return String(numero).padStart(4, "0");
}

export async function crearSucursal({ nombre, puntoVenta }) {
  const datos = {
    nombre: nombre.trim(),
    puntoVenta: formatearPuntoVenta(puntoVenta),
    activa: true,
  };
  const ref = await addDoc(collection(db, "sucursales"), datos);
  return { id: ref.id, ...datos };
}

export async function actualizarSucursal(id, { nombre, puntoVenta, activa }) {
  await updateDoc(doc(db, "sucursales", id), {
    nombre: nombre.trim(),
    puntoVenta: formatearPuntoVenta(puntoVenta),
    activa: activa !== false,
  });
}

// La primera sucursal activa (por punto de venta) — para cuando todavía no se eligió ninguna en un
// formulario (ej. Nueva venta, si algún día se agrega selector de sucursal ahí).
export async function sucursalPorDefecto() {
  const activas = await listarSucursalesActivas();
  return activas[0] || null;
}

// A qué sucursal pertenece la plata que mueve este usuario (venta o cobro manual): la asignada en su
// perfil (Configuración → Usuarios) si tiene una activa; si no, la primera sucursal activa como venía
// siendo antes — pero devolviendo asumida:true para que la pantalla pueda avisar, porque con 2+
// sucursales ese fallback puede mandar la plata al lugar equivocado sin que nadie lo note.
export async function resolverSucursalUsuario(usuario) {
  if (usuario.sucursalId) {
    const sucursal = await obtenerSucursal(usuario.sucursalId);
    if (sucursal && sucursal.activa !== false) return { sucursal, asumida: false };
  }
  const sucursal = await sucursalPorDefecto();
  return { sucursal, asumida: true };
}
