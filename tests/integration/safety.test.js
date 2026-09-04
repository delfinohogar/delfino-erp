// SAFETY CHECK (FASE -1, punto 9).
// Verifica que una escritura hecha desde el entorno de desarrollo va al emulador
// y no puede llegar a Firestore de produccion. Si alguien rompe el aislamiento,
// este test falla en la maquina de desarrollo Y en CI.
//
// La escritura se hace COMO LA HACE EL ERP REAL: con el SDK cliente, autenticado contra el
// emulador de Auth y pasando por firestore.rules. Va a /clientes, que es la coleccion que un
// vendedor logueado escribe en el alta de cliente de Nueva Venta (allow write: if puedeVender())
// y que ademas permite delete, asi el test se limpia solo. No se inventa ninguna coleccion nueva
// ni se toca firestore.rules: agregar una regla a produccion para que pase un test es la salida
// equivocada (decision 2026-09-04).
//
// USUARIO PROPIO Y EFIMERO (decision de Gaston 2026-09-04; cierra R17 y R18 de RISKS.md).
// El test NO toca la cuenta de desarrollo compartida (la que documenta CLAUDE.md): ni la lee, ni
// le pisa la password, ni le borra el perfil. No la nombra en ninguna parte, a proposito.
// Crea su propio usuario `safety-<uuid>@test.local` con password aleatoria por corrida y perfil
// de rol MINIMO (`vendedor`, que es lo que puedeVender() exige), lo usa y lo borra. Sin estado
// previo prestado no hay restauracion, y una restauracion que no existe no puede fallar a la
// mitad. El perfil efimero NO escribe el campo `nombre` a proposito: js/usuarios.js:9 lista
// /usuarios con orderBy("nombre") y Firestore excluye del orderBy los documentos sin ese campo,
// asi que un huerfano —si el proceso muriera sin afterAll— es invisible en la pantalla de
// usuarios del ERP local. Mismo criterio que ya se usa para el documento de /clientes.
//
// El test es autosuficiente: no depende de `npm run seed` ni del projectId que haya usado el seed
// (el seed inicializa el Admin SDK con GCLOUD_PROJECT || "demo-delfino", que puede ser un
// namespace DISTINTO del que ve el ERP, que es firebaseConfig.projectId — ver R16). El Admin SDK
// —que bypasea las reglas— solo prepara usuario y perfil; la escritura que se evalua la hace
// siempre el SDK cliente autenticado.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, setDoc, getDoc, deleteDoc, doc } from "firebase/firestore";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from "firebase/auth";
import admin from "firebase-admin";
import { firebaseConfig } from "../../js/firebase-config.js";

const LOCAL = /^(127\.0\.0\.1|localhost):\d+$/;

// Identidad efimera de ESTA corrida. Password aleatoria: no es una constante y no coincide con
// ninguna password documentada del entorno.
const UUID_CORRIDA = randomUUID();
const EMAIL_EFIMERO = `safety-${UUID_CORRIDA}@test.local`;
const PASSWORD_EFIMERA = randomBytes(24).toString("hex");
const ROL_EFIMERO = "vendedor"; // rol minimo suficiente para puedeVender() en /clientes

// Patrones EXACTOS para el barrido de huerfanos. Solo pueden matchear lo que crea este test:
// cualquier cuenta que no sea `safety-<uuid v4>@test.local` —la de desarrollo compartida
// incluida— queda fuera por construccion.
const PATRON_EMAIL_EFIMERO = /^safety-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@test\.local$/;
const PATRON_ID_PRUEBA = /^safety-check-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// La coleccion y el id de la escritura de prueba. Id propio e irrepetible: no pisa ningun
// cliente real del emulador y se borra en afterAll().
const COLECCION = "clientes";
const ID_PRUEBA = `safety-check-${UUID_CORRIDA}`;

let app, db, auth;
let appAdmin, dbAdmin, authAdmin;

// UNICA fuente de verdad para la limpieza: se setea DESPUES de que createUser() devolvio y vale
// el uid que devolvio ESA llamada. Si sigue en null, afterAll no borra ningun usuario ni perfil.
// No existe ninguna otra rama que borre un uid: es imposible que el test borre una cuenta ajena.
let uidCreadoPorEstaCorrida = null;

/** Falla con un mensaje que distingue "rojo por infraestructura" de "rojo por logica". */
function exigirEntorno(condicion, mensaje) {
  if (!condicion) throw new Error(`\n[INFRAESTRUCTURA] ${mensaje}\n`);
}

const esEmailEfimero = (email) => typeof email === "string" && PATRON_EMAIL_EFIMERO.test(email);

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

/**
 * Borra un usuario efimero y su perfil. Antes de tocar nada re-verifica contra el emulador que el
 * email de esa cuenta siga el patron `safety-<uuid>@test.local`: si no lo sigue, no toca nada.
 * Doble red para que ningun uid ajeno pueda ser alcanzado.
 */
async function borrarUsuarioEfimero(uid) {
  if (!uid) return;
  let email;
  try {
    email = (await authAdmin.getUser(uid)).email ?? null;
  } catch {
    email = null; // ya no existe en Auth; puede quedar el perfil suelto
  }
  if (email !== null && !esEmailEfimero(email)) return; // no es nuestro: se deja intacto
  try { await dbAdmin.collection("usuarios").doc(uid).delete(); } catch { /* ya no estaba */ }
  if (email !== null) { try { await authAdmin.deleteUser(uid); } catch { /* ya no estaba */ } }
}

/**
 * Barrido de huerfanos de corridas anteriores (proceso muerto sin afterAll: Ctrl-C, crash).
 * Acota el residuo a una corrida. Con cero coincidencias no lanza y no hace nada.
 * `emulators:exec` no exporta al salir, pero `npm run emulators` corre con --export-on-exit,
 * asi que contra un emulador de larga vida el residuo si persistiria sin este barrido.
 */
async function barrerHuerfanos() {
  const encontrados = { usuarios: [], perfiles: [], clientes: [] };

  // 1) Cuentas de Auth con el patron exacto.
  let pageToken;
  do {
    const pagina = await authAdmin.listUsers(1000, pageToken);
    for (const u of pagina.users) {
      if (!esEmailEfimero(u.email)) continue; // ninguna cuenta ajena puede matchear
      encontrados.usuarios.push(u.email);
      await borrarUsuarioEfimero(u.uid);
    }
    pageToken = pagina.pageToken;
  } while (pageToken);

  // 2) Perfiles /usuarios sueltos cuyo email sigue el patron (la cuenta de Auth ya no esta).
  const perfiles = await dbAdmin.collection("usuarios").get();
  for (const d of perfiles.docs) {
    if (!esEmailEfimero(d.data()?.email)) continue;
    encontrados.perfiles.push(d.id);
    try { await d.ref.delete(); } catch { /* ya no estaba */ }
  }

  // 3) Documentos de prueba en /clientes con el id exacto de este test.
  const clientes = await dbAdmin.collection(COLECCION).get();
  for (const d of clientes.docs) {
    if (!PATRON_ID_PRUEBA.test(d.id)) continue;
    encontrados.clientes.push(d.id);
    try { await d.ref.delete(); } catch { /* ya no estaba */ }
  }

  const total = encontrados.usuarios.length + encontrados.perfiles.length + encontrados.clientes.length;
  if (total > 0) console.log(`[safety] barrido de huerfanos: ${JSON.stringify(encontrados)}`);
  return encontrados;
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

  await barrerHuerfanos();

  // Usuario propio de esta corrida. El flag de limpieza se setea DESPUES de que createUser
  // devolvio, con el uid que devolvio esa misma llamada.
  const usuario = await authAdmin.createUser({ email: EMAIL_EFIMERO, password: PASSWORD_EFIMERA });
  uidCreadoPorEstaCorrida = usuario.uid;

  // Un usuario autenticado SIN documento de perfil no pasa puedeVender(): las reglas leen
  // /usuarios/{uid}.rol. Sin `nombre`, para que un huerfano no aparezca en el listado del ERP.
  await dbAdmin.collection("usuarios").doc(uidCreadoPorEstaCorrida).set({
    email: EMAIL_EFIMERO,
    rol: ROL_EFIMERO,
    activo: true,
    creadoPor: "tests/integration/safety.test.js (usuario efimero - borrar si aparece)",
  });

  // --- SDK cliente: lo mismo que corre en el navegador, y lo unico que se evalua ---
  app = initializeApp(firebaseConfig, `safety-${Date.now()}`);
  db = getFirestore(app);
  const [host, puerto] = firestoreHost.split(":");
  connectFirestoreEmulator(db, host, Number(puerto));
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, EMAIL_EFIMERO, PASSWORD_EFIMERA);
});

afterAll(async () => {
  // El dato de prueba no queda: se borra con el SDK cliente (las reglas lo permiten) y, si eso
  // fallara, con el Admin SDK como red de seguridad. Correr la suite dos veces seguidas tiene
  // que dar lo mismo.
  try { await deleteDoc(doc(db, COLECCION, ID_PRUEBA)); } catch { /* lo limpia el Admin SDK */ }
  try { await dbAdmin?.collection(COLECCION).doc(ID_PRUEBA).delete(); } catch { /* ya no estaba */ }

  // Se borra EXCLUSIVAMENTE el usuario que creo esta corrida. Si createUser no llego a devolver,
  // uidCreadoPorEstaCorrida sigue en null y aca no se borra nada.
  try { await borrarUsuarioEfimero(uidCreadoPorEstaCorrida); } catch { /* el emulador es efimero */ }

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
    // tuviera perfil con rol, firestore.rules rechazaria con PERMISSION_DENIED.
    expect(auth.currentUser?.email).toBe(EMAIL_EFIMERO);

    const marca = `safety-${Date.now()}`;
    const ref = doc(db, COLECCION, ID_PRUEBA);
    await setDoc(ref, {
      marca,
      entorno: "desarrollo",
      razonSocial: "SAFETY CHECK - borrar si aparece",
      creadoPor: uidCreadoPorEstaCorrida,
    });

    // 1) Se lee de vuelta por el mismo camino del ERP (SDK cliente, pasando por las reglas).
    const leido = await getDoc(ref);
    expect(leido.exists()).toBe(true);
    expect(leido.data().marca).toBe(marca);

    // 2) Y —esto es lo que prueba el aislamiento— el documento esta FISICAMENTE dentro del
    //    emulador local: se lo lee por un canal independiente del SDK cliente, contra
    //    127.0.0.1 y con el token "owner", que solo existe en el emulador. Si la escritura
    //    hubiera ido a cualquier otro Firestore (produccion incluida), aca no habria nada.
    //    (R20: el getDoc de arriba pasa igual contra otro Firestore; el que discrimina es este.)
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
