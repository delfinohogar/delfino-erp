// Permite cargar un secret de Firebase (Secret Manager) desde una pantalla del ERP en vez de la
// terminal — para usuarios que no tienen el CLI de Firebase a mano. El valor pegado viaja por HTTPS
// (como cualquier formulario) directo a Secret Manager: nunca se guarda en Firestore, nunca se
// loguea, nunca se devuelve — ni siquiera a este mismo usuario. Solo administradores pueden usarlo,
// y solo para los nombres de secret de esta lista (no cualquier secret del proyecto).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const admin = require("firebase-admin");

const SECRETOS_PERMITIDOS = ["MP_ACCESS_TOKEN_TEST", "MP_WEBHOOK_SECRET_TEST"];
const client = new SecretManagerServiceClient();

exports.guardarSecretoAdmin = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");

  const perfilSnap = await admin.firestore().collection("usuarios").doc(request.auth.uid).get();
  if (perfilSnap.data()?.rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo un administrador puede cargar credenciales.");
  }

  const { nombre, valor } = request.data || {};
  if (!SECRETOS_PERMITIDOS.includes(nombre)) {
    throw new HttpsError("invalid-argument", "Ese nombre de credencial no está permitido acá.");
  }
  if (!valor || typeof valor !== "string" || valor.trim().length < 8) {
    throw new HttpsError("invalid-argument", "El valor pegado parece incompleto.");
  }

  const projectId = process.env.GCLOUD_PROJECT || (await client.getProjectId());
  const secretPath = `projects/${projectId}/secrets/${nombre}`;

  try {
    await client.getSecret({ name: secretPath });
  } catch (err) {
    if (err.code === 5 /* NOT_FOUND */) {
      await client.createSecret({
        parent: `projects/${projectId}`,
        secretId: nombre,
        secret: { replication: { automatic: {} } },
      });
    } else {
      throw err;
    }
  }

  await client.addSecretVersion({
    parent: secretPath,
    payload: { data: Buffer.from(valor.trim(), "utf8") },
  });

  // Se registra QUE se cargó una credencial nueva — nunca el valor ni siquiera un fragmento de él.
  await admin.firestore().collection("logIntegracionMercadoPago").add({
    fecha: admin.firestore.FieldValue.serverTimestamp(),
    endpoint: "secretManager",
    tipoOperacion: "cargar_credencial",
    resultado: "ok",
    paymentId: null,
    mensajeError: `Se actualizó el secret ${nombre}`,
    modo: "test",
  });

  return { ok: true };
});
