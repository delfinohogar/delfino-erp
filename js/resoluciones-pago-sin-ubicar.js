// Marca cuándo y cómo se resolvió a mano un pago que Tesorería no pudo ubicar solo (ver
// tieneSinUbicar en ventas.js/cobros.js). La venta/cobro original es inmutable (allow update: if
// false, es el registro de lo que pasó al momento de cobrar) — la resolución vive en una colección
// aparte, mismo criterio que se va a usar para entregas (Prioridad 1.7), para no romper esa regla.
// Un doc por origen (id = "venta_<id>" o "cobro_<id>"): resolver de nuevo simplemente lo reemplaza.
import { db, doc, setDoc, getDoc, getDocs, collection, serverTimestamp } from "./firebase.js";

function idResolucion(origenTipo, origenId) {
  return `${origenTipo}_${origenId}`;
}

export async function marcarPagoSinUbicarResuelto({ origenTipo, origenId, nota }, usuario) {
  await setDoc(doc(db, "resolucionesPagoSinUbicar", idResolucion(origenTipo, origenId)), {
    origenTipo,
    origenId,
    nota: nota || "",
    resueltoPor: usuario.uid,
    resueltoPorNombre: usuario.nombre || usuario.email,
    resueltoEn: serverTimestamp(),
  });
}

export async function obtenerResolucionPagoSinUbicar(origenTipo, origenId) {
  const snap = await getDoc(doc(db, "resolucionesPagoSinUbicar", idResolucion(origenTipo, origenId)));
  return snap.exists() ? snap.data() : null;
}

// Todas las resoluciones, como Map por "tipo_id" — para pintar la lista completa sin una consulta
// por fila.
export async function mapaResolucionesPagoSinUbicar() {
  const snap = await getDocs(collection(db, "resolucionesPagoSinUbicar"));
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}
