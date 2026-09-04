// SAFETY CHECK (FASE -1, punto 9).
// Verifica que una escritura hecha desde el entorno de desarrollo va al emulador
// y no puede llegar a Firestore de produccion. Si alguien rompe el aislamiento,
// este test falla en la maquina de desarrollo Y en CI.
//
// La escritura se hace COMO LA HACE EL ERP REAL: con el SDK cliente, autenticado contra el
// emulador de Auth con admin@delfino.local, y pasando por firestore.rules. Por eso va a
// /clientes, que es la coleccion que un vendedor logueado escribe en el alta de cliente de
// Nueva Venta (allow write: if puedeVender()) y que ademas permite delete, asi el test se
// limpia solo. No se inventa ninguna coleccion nueva ni se toca firestore.rules: agregar una
// regla a produccion para que pase un test es la salida equivocada (decision 2026-09-04).
//
// El test es autosuficiente: no depende de `npm run seed` ni del projectId que haya usado el
// seed (el seed inicializa el Admin SDK con GCLOUD_PROJECT || "demo-delfino", que puede ser un
// namespace DISTINTO del que ve el ERP, que es firebaseConfig.projectId). Con el Admin SDK
// —que bypasea las reglas— se asegura el usuario y su perfil /usuarios/{uid} con
// rol administrador en el namespace de firebaseConfig.projectId, y al terminar se deja todo
// como estaba.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, setDoc, getDoc, deleteDoc, doc } from "firebase/firestore";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from "firebase/auth";
import admin from "firebase-admin";
import { firebaseConfig } from "../../js/firebase-config.js";

const EMAIL = "admin@delfino.local";
const PASSWORD = "delfino-dev";
const ROLES_QUE_PUEDEN_VENDER = ["administrador", "administrativo", "vendedor"];
const LOCAL = /^(127\.0\.0\.1|localhost):\d+$/;

// La coleccion y el id de la escritura de prueba. Id propio e irrepetible: no pisa ningun
// cliente real del emulador y se borra en afterAll().
const COLECCION = "clientes";
const ID_PRUEBA = `safety-check-${randomUUID()}`;

let app, db, auth, uid;
let appAdmin, dbAdmin, authAdmin;
let perfilPrevio = null;       // null = no existia; se restaura tal cual estaba
let existiaPerfil = false;
let creamosElUsuario = false;

/** Falla con un mensaje que distingue "rojo por infraestructura" de "rojo por logica". */
function exigirEntorno(condicion, mensaje) {
  if (!condicion) throw new Error(`\n[INFRAESTRUCTURA] ${mensaje}\n`);
}

/**
 * Lee un documento directo del emulador con el token "owner", que SOLO el emulador acepta
 * (bypasea las reglas). Es el canal independiente que prueba que el dato quedo fisicamente
 * dentro del emulador local y no en otro Firestore: Firestore de produccion jamas responde a
 * un "Bearer owner" ni escucha en 127.0.0.1.
 */
async function leerDelEmulador(coleccion, id) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const url = `http://${host}/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${coleccion}/${id}`;
  const respuesta = await fetch(url, { headers: { Authorization: "Bearer owner" } });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new Error(`El emulador respondio ${respuesta.status} al leer ${coleccion}/${id}`);
  return respuesta.json();
}

beforeAll(async () => {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
  const authHost = (process.env.FIREBASE_AUTH_EMULATOR_HOST || "").replace(/^https?:\/\//, "");
  exigirEntorno(LOCAL.test(firestoreHost), `FIRESTORE_EMULATOR_HOST es "${firestoreHost}" y tiene que ser local. Levanta el emulador con: npm run emulators`);
  exigirEntorno(LOCAL.test(authHost), `FIREBASE_AUTH_EMULATOR_HOST es "${authHost}" y tiene que ser local. Levanta el emulador con: npm run emulators`);

  // --- Preparacion con el Admin SDK (bypasea reglas; solo prepara, no es lo que se evalua) ---
  appAdmin = admin.initializeApp({ projectId: firebaseConfig.projectId }, `safety-admin-${Date.now()}`);
  dbAdmin = appAdmin.firestore();
  authAdmin = appAdmin.auth();

  let usuario;
  try {
    usuario = await authAdmin.getUserByEmail(EMAIL);
    // El usuario puede venir de un seed viejo con otra password: se normaliza para que el
    // login del test sea el mismo que documenta el README de desarrollo.
    await authAdmin.updateUser(usuario.uid, { password: PASSWORD });
  } catch {
    usuario = await authAdmin.createUser({ email: EMAIL, password: PASSWORD, displayName: "Admin de desarrollo" });
    creamosElUsuario = true;
  }
  uid = usuario.uid;

  // Un usuario autenticado SIN documento de perfil no pasa puedeVender(): las reglas leen
  // /usuarios/{uid}.rol. El seed puede haber dejado ese perfil en OTRO projectId, asi que el
  // test se lo garantiza a si mismo en el namespace que realmente usa el ERP.
  const refPerfil = dbAdmin.collection("usuarios").doc(uid);
  const snapPerfil = await refPerfil.get();
  existiaPerfil = snapPerfil.exists;
  perfilPrevio = existiaPerfil ? snapPerfil.data() : null;
  if (!existiaPerfil || !ROLES_QUE_PUEDEN_VENDER.includes(perfilPrevio?.rol)) {
    await refPerfil.set({ nombre: "Admin de desarrollo", email: EMAIL, rol: "administrador", activo: true }, { merge: true });
  }

  // --- SDK cliente: lo mismo que corre en el navegador, y lo unico que se evalua ---
  app = initializeApp(firebaseConfig, `safety-${Date.now()}`);
  db = getFirestore(app);
  const [host, puerto] = firestoreHost.split(":");
  connectFirestoreEmulator(db, host, Number(puerto));
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
});

afterAll(async () => {
  // El dato de prueba no queda: se borra con el SDK cliente (las reglas lo permiten) y, si eso
  // fallara, con el Admin SDK como red de seguridad. Correr la suite dos veces seguidas tiene
  // que dar lo mismo.
  try { await deleteDoc(doc(db, COLECCION, ID_PRUEBA)); } catch { /* lo limpia el Admin SDK */ }
  try { await dbAdmin?.collection(COLECCION).doc(ID_PRUEBA).delete(); } catch { /* ya no estaba */ }

  // El perfil y el usuario quedan como estaban antes del test.
  try {
    if (uid && dbAdmin) {
      if (existiaPerfil) await dbAdmin.collection("usuarios").doc(uid).set(perfilPrevio);
      else await dbAdmin.collection("usuarios").doc(uid).delete();
    }
    if (creamosElUsuario && uid) await authAdmin.deleteUser(uid);
  } catch { /* el emulador es efimero; no vale la pena romper el test por la limpieza */ }

  try { await signOut(auth); } catch { /* nada */ }
  try { await deleteApp(app); } catch { /* nada */ }
  try { await appAdmin?.delete(); } catch { /* nada */ }
});

describe("aislamiento del entorno de desarrollo", () => {
  it("FIRESTORE_EMULATOR_HOST esta definido y es local", () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST || "";
    expect(host).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
  });

  it("la instancia de Firestore apunta al emulador, no a firestore.googleapis.com", () => {
    const host = db._settings?.host ?? db.toJSON?.().settings?.host ?? "";
    expect(String(host)).not.toContain("googleapis.com");
    expect(String(host)).toMatch(/127\.0\.0\.1|localhost/);
  });

  it("una escritura autenticada va al emulador y no puede llegar a produccion", async () => {
    // Se escribe autenticado, igual que el ERP real: si el usuario no estuviera logueado o no
    // tuviera perfil, firestore.rules rechazaria con PERMISSION_DENIED.
    expect(auth.currentUser?.email).toBe(EMAIL);

    const marca = `safety-${Date.now()}`;
    const ref = doc(db, COLECCION, ID_PRUEBA);
    await setDoc(ref, {
      marca,
      entorno: "desarrollo",
      razonSocial: "SAFETY CHECK - borrar si aparece",
      creadoPor: uid,
    });

    // 1) Se lee de vuelta por el mismo camino del ERP (SDK cliente, pasando por las reglas).
    const leido = await getDoc(ref);
    expect(leido.exists()).toBe(true);
    expect(leido.data().marca).toBe(marca);

    // 2) Y —esto es lo que prueba el aislamiento— el documento esta FISICAMENTE dentro del
    //    emulador local: se lo lee por un canal independiente del SDK cliente, contra
    //    127.0.0.1 y con el token "owner", que solo existe en el emulador. Si la escritura
    //    hubiera ido a cualquier otro Firestore (produccion incluida), aca no habria nada.
    const enEmulador = await leerDelEmulador(COLECCION, ID_PRUEBA);
    expect(
      enEmulador,
      `AISLAMIENTO ROTO: ${COLECCION}/${ID_PRUEBA} no esta en el emulador de ${process.env.FIRESTORE_EMULATOR_HOST}. ` +
        `La escritura fue a parar a otro Firestore.`
    ).not.toBeNull();
    expect(enEmulador.fields.marca.stringValue).toBe(marca);
    expect(enEmulador.name).toContain(`projects/${firebaseConfig.projectId}/databases/(default)`);
  });

  it("js/firebase-config.js sigue apuntando al proyecto real (el aislamiento no depende de cambiarlo)", () => {
    expect(firebaseConfig.projectId).toBe("delfino-hogar-erp");
  });
});
