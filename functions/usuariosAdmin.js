// Alta de usuario completa (login + perfil) en un solo paso — antes había que crear la cuenta a mano
// en Firebase Console → Authentication, copiar el UID, y recién ahí cargar el perfil en el ERP. Un
// negocio con rotación de cajeros no puede depender de eso. Mismo criterio que guardarSecretoAdmin.js:
// solo administrador, usa el Admin SDK (que puede crear usuarios de Auth, algo que el SDK de cliente
// no permite hacer para OTRA persona sin desloguearse a sí mismo).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const ROLES_VALIDOS = ["administrador", "administrativo", "vendedor"];

exports.crearUsuarioCompleto = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");

  const perfilSnap = await admin.firestore().collection("usuarios").doc(request.auth.uid).get();
  if (perfilSnap.data()?.rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo un administrador puede crear usuarios.");
  }

  const { nombre, email, password, rol, sucursalId, sucursalNombre } = request.data || {};
  if (!nombre?.trim()) throw new HttpsError("invalid-argument", "Falta el nombre.");
  if (!email?.trim()) throw new HttpsError("invalid-argument", "Falta el email.");
  if (!password || password.length < 6) throw new HttpsError("invalid-argument", "La contraseña tiene que tener al menos 6 caracteres.");
  if (!ROLES_VALIDOS.includes(rol)) throw new HttpsError("invalid-argument", "Rol inválido.");

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email: email.trim(),
      password,
      displayName: nombre.trim(),
    });
  } catch (err) {
    // auth/email-already-exists es el caso real más probable (alguien ya cargado con ese mail) —
    // se traduce a español en vez de dejar pasar el código crudo de Firebase.
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Ya existe una cuenta con ese email.");
    }
    throw new HttpsError("internal", "No se pudo crear el usuario: " + (err.message || "error desconocido"));
  }

  // Si esto falla después de crear el login, queda un usuario de Auth sin perfil — recuperable a
  // mano desde Configuración → Usuarios (ya soporta pegar un UID existente), no se revierte la
  // creación del login para no complicar el manejo de errores de una operación de dos pasos.
  await admin
    .firestore()
    .collection("usuarios")
    .doc(userRecord.uid)
    .set({
      nombre: nombre.trim(),
      email: email.trim(),
      rol,
      sucursalId: sucursalId || null,
      sucursalNombre: sucursalNombre || null,
    });

  return { uid: userRecord.uid };
});
