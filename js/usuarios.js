// Perfiles de usuario (usuarios/{uid}). crearUsuarioCompleto() da de alta el login Y el perfil en un
// solo paso (Cloud Function con Admin SDK) — crearPerfilUsuario() sigue existiendo para el caso de
// vincular un login que ya se creó por fuera (o de una migración vieja), pegando el UID a mano.
import { db, doc, getDoc, setDoc, getDocs, collection, updateDoc, query, orderBy, functions, httpsCallable } from "./firebase.js";

export const ROLES = ["administrador", "administrativo", "vendedor"];

export async function listarUsuarios() {
  const snap = await getDocs(query(collection(db, "usuarios"), orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerUsuario(uid) {
  const snap = await getDoc(doc(db, "usuarios", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// uid: el UID de Firebase Auth (lo copiás de Authentication en Firebase Console después de crear el usuario ahí).
// sucursalId/sucursalNombre: a qué sucursal pertenece — de acá sale a qué caja va el efectivo que
// cobra este usuario (ver js/ventas.js routearPagoATesoreria). Opcional: sin asignar, se cae al
// comportamiento anterior (primera sucursal activa), avisando en la pantalla de venta.
export async function crearPerfilUsuario({ uid, nombre, email, rol, sucursalId, sucursalNombre }) {
  await setDoc(doc(db, "usuarios", uid), { nombre: nombre.trim(), email: email.trim(), rol, sucursalId: sucursalId || null, sucursalNombre: sucursalNombre || null });
}

// Crea el login de Firebase Auth Y el perfil en un solo paso — reemplaza el flujo de "creá la cuenta
// a mano en Firebase Console y pegá el UID acá". Devuelve el uid del usuario creado.
export async function crearUsuarioCompleto({ nombre, email, password, rol, sucursalId, sucursalNombre }) {
  const fn = httpsCallable(functions, "crearUsuarioCompleto");
  const res = await fn({ nombre, email, password, rol, sucursalId, sucursalNombre });
  return res.data.uid;
}

export async function actualizarPerfilUsuario(uid, { nombre, email, rol, sucursalId, sucursalNombre }) {
  await updateDoc(doc(db, "usuarios", uid), { nombre: nombre.trim(), email: email.trim(), rol, sucursalId: sucursalId || null, sucursalNombre: sucursalNombre || null });
}

// Qué tarjetas del Dashboard eligió ver cada usuario (y en qué orden) — viaja con la cuenta, no con
// el navegador, para que sea la misma personalización sin importar desde qué PC entre.
export async function guardarDashboardCards(uid, cardIds) {
  await updateDoc(doc(db, "usuarios", uid), { dashboardCards: cardIds });
}
