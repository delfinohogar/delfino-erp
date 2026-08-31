// Perfiles de usuario (usuarios/{uid}). La cuenta de acceso (email/contraseña) se crea a mano en
// Firebase Console — acá solo se administra el perfil (nombre, rol) asociado a ese UID.
import { db, doc, getDoc, setDoc, getDocs, collection, updateDoc, query, orderBy } from "./firebase.js";

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
export async function crearPerfilUsuario({ uid, nombre, email, rol }) {
  await setDoc(doc(db, "usuarios", uid), { nombre: nombre.trim(), email: email.trim(), rol });
}

export async function actualizarPerfilUsuario(uid, { nombre, email, rol }) {
  await updateDoc(doc(db, "usuarios", uid), { nombre: nombre.trim(), email: email.trim(), rol });
}

// Qué tarjetas del Dashboard eligió ver cada usuario (y en qué orden) — viaja con la cuenta, no con
// el navegador, para que sea la misma personalización sin importar desde qué PC entre.
export async function guardarDashboardCards(uid, cardIds) {
  await updateDoc(doc(db, "usuarios", uid), { dashboardCards: cardIds });
}
