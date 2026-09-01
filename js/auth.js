import { auth, db, doc, getDoc, onAuthStateChanged, signOut } from "./firebase.js";

// Resuelve cuando Firebase confirma el estado de auth (evita parpadeo / redirects prematuros).
function waitForAuthState() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

// Usar al inicio de cada página protegida. Redirige a login si no hay sesión.
// Devuelve { uid, email, nombre, rol }.
export async function requireAuth() {
  const user = await waitForAuthState();
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
    return null;
  }

  const perfilRef = doc(db, "usuarios", user.uid);
  const perfilSnap = await getDoc(perfilRef);
  if (!perfilSnap.exists()) {
    // Usuario autenticado pero sin perfil en /usuarios — no tiene rol asignado.
    location.href = "/login.html?error=sin-perfil";
    return null;
  }

  const perfil = perfilSnap.data();
  return {
    uid: user.uid,
    email: user.email,
    nombre: perfil.nombre,
    rol: perfil.rol,
    sucursalId: perfil.sucursalId || null,
    sucursalNombre: perfil.sucursalNombre || null,
  };
}

export async function cerrarSesion() {
  await signOut(auth);
  location.href = "/login.html";
}
