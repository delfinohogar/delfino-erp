// Carga datos minimos en los EMULADORES para poder usar el ERP en local.
// Todos los datos son inventados. Nunca toca produccion: si las variables de emulador
// no estan puestas, aborta antes de hacer nada.
//
//   Terminal 1:  npm run emulators
//   Terminal 2:  npm run seed
//   Terminal 3:  npm run build  y despues  python dev-server.py 8090
//   Login:       admin@delfino.local / delfino-dev
//
// Modos (uno solo por corrida):
//   (sin argumentos)         siembra en el proyecto que usa el ERP local
//   --reporte-demo           informa que quedo en el namespace basura `demo-delfino`, sin borrar nada
//   --limpiar-demo-delfino   informa y despues BORRA `demo-delfino`. Nunca se dispara solo (R16)
//
// R16: el emulador acepta cualquier projectId y crea el namespace al vuelo, asi que sembrar en el
// proyecto equivocado no da ningun error: el ERP simplemente no ve nada. No hay API que diga "el
// proyecto del emulador es X", asi que el proyecto esperado se lee de UNA sola fuente,
// `js/firebase-config.js`, que es lo que el ERP realmente usa. Si ese archivo cambia, el seed lo
// sigue; si deja de declarar projectId, el seed aborta en vez de adivinar.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "firebase-admin";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");

// ---------------------------------------------------------------- argumentos
const MODOS_VALIDOS = ["--reporte-demo", "--limpiar-demo-delfino", "--ayuda"];
const argumentos = process.argv.slice(2);

function abortar(mensaje) {
  console.error(`\n${mensaje}\n`);
  process.exit(1);
}

if (argumentos.length > 1) {
  abortar(
    `ABORTADO: se paso mas de un modo (${argumentos.join(" ")}).\n` +
      `Modos validos, de a uno: ${MODOS_VALIDOS.join(", ")} o ningun argumento para sembrar.`
  );
}
const modo = argumentos[0] ?? "";
if (modo && !MODOS_VALIDOS.includes(modo)) {
  // Un argumento mal tipeado NUNCA puede caer en el modo que escribe datos.
  abortar(
    `ABORTADO: argumento desconocido "${modo}".\n` +
      `Modos validos: ${MODOS_VALIDOS.join(", ")}\n` +
      `Sin argumentos: siembra el emulador.`
  );
}
if (modo === "--ayuda") {
  console.log(`
Uso: node scripts/seed-emulator.mjs [modo]

  (sin argumentos)        siembra datos minimos en el proyecto que usa el ERP local
  --reporte-demo          informa que hay en el namespace basura "demo-delfino" (no borra nada)
  --limpiar-demo-delfino  informa y despues borra "demo-delfino" del emulador
  --ayuda                 esto

Los tres modos exigen FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST apuntando a local.
`);
  process.exit(0);
}

// ------------------------------------------------- barrera de emulador local
// Esta barrera NO se toca: sin ella, cualquiera de los tres modos podria alcanzar produccion.
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;

if (!AUTH || !FIRESTORE) {
  abortar("ABORTADO: faltan FIREBASE_AUTH_EMULATOR_HOST y/o FIRESTORE_EMULATOR_HOST.");
}
for (const [nombre, valor] of [["auth", AUTH], ["firestore", FIRESTORE]]) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(valor.replace(/^https?:\/\//, ""))) {
    abortar(`ABORTADO: el emulador de ${nombre} apunta a "${valor}", que no es local.`);
  }
}

function urlBase(host) {
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}
const BASE_FIRESTORE = urlBase(FIRESTORE);
const BASE_AUTH = urlBase(AUTH);

// ------------------------------------------- proyecto: una sola fuente de verdad
// Se lee `js/firebase-config.js` como texto porque ese modulo es ESM y el repo no declara
// "type": "module", asi que Node no lo puede importar desde este script. Misma tecnica que
// leerPlanDeCuentas(): el archivo del ERP manda, y si cambia de forma, esto rompe ruidosamente.
function leerProyectoDelErp() {
  const ruta = join(RAIZ, "js", "firebase-config.js");
  let fuente;
  try {
    fuente = readFileSync(ruta, "utf8");
  } catch (err) {
    abortar(`ABORTADO: no se pudo leer js/firebase-config.js (${err.message}).\nEs la unica fuente del projectId que usa el ERP.`);
  }
  const hallazgos = [...fuente.matchAll(/projectId\s*:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  const unicos = [...new Set(hallazgos)];
  if (unicos.length !== 1) {
    abortar(
      `ABORTADO: js/firebase-config.js declara ${unicos.length} projectId distintos (${unicos.join(", ") || "ninguno"}).\n` +
        `El seed necesita exactamente uno para saber a que namespace del emulador mira el ERP.\n` +
        `Corregi js/firebase-config.js (solo Gaston lo modifica) y volve a correr el seed.`
    );
  }
  return unicos[0];
}

const PROYECTO_ERP = leerProyectoDelErp();

// Namespace basura de R16. Va FIJO en el codigo y validado contra una lista de permitidos de un
// solo elemento: no se toma de argumentos ni de variables de entorno, para que el borrado no
// pueda alcanzar ningun otro proyecto por mas que alguien se equivoque al invocarlo.
const NAMESPACES_BORRABLES = Object.freeze(["demo-delfino"]);
const NAMESPACE_BASURA = "demo-delfino";

const EMAIL = "admin@delfino.local";
const PASSWORD = "delfino-dev";

// ------------------------------------------------------------- REST al emulador
// Canal independiente del Admin SDK: el proyecto viaja en la URL, asi que lo que se lee y lo que
// se borra queda acotado al namespace nombrado y no depende de ninguna variable de entorno.
const CABECERAS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

async function pedir(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { ...CABECERAS, ...(opciones.headers || {}) } });
  if (!r.ok) throw new Error(`${opciones.method || "GET"} ${url} -> ${r.status} ${await r.text()}`);
  const texto = await r.text();
  return texto ? JSON.parse(texto) : {};
}

async function inventario(proyecto) {
  const { collectionIds = [] } = await pedir(
    `${BASE_FIRESTORE}/v1/projects/${proyecto}/databases/(default)/documents:listCollectionIds`,
    { method: "POST", body: "{}" }
  );
  const colecciones = [];
  for (const nombre of [...collectionIds].sort()) {
    const { documents = [] } = await pedir(
      `${BASE_FIRESTORE}/v1/projects/${proyecto}/databases/(default)/documents/${encodeURIComponent(nombre)}?pageSize=500`
    );
    colecciones.push({
      nombre,
      docs: documents.map((d) => ({ id: d.name.split("/").pop(), campos: d.fields || {} })),
    });
  }
  const { users = [] } = await pedir(
    `${BASE_AUTH}/identitytoolkit.googleapis.com/v1/projects/${proyecto}/accounts:batchGet?maxResults=1000`
  );
  return {
    proyecto,
    usuariosAuth: users.map((u) => ({ email: u.email || "(sin email)", uid: u.localId })),
    colecciones,
    totalDocs: colecciones.reduce((n, c) => n + c.docs.length, 0),
  };
}

// ------------------------------------- singleProjectMode: por que el conteo no se puede afirmar
// El emulador corre con `singleProjectMode` (firebase.json) y en ese modo le sirve los documentos
// del proyecto principal a CUALQUIER projectId al que todavia no se le haya escrito. O sea: un
// `demo-delfino` virgen "devuelve" los 35 documentos del ERP como si fueran suyos, y un reporte
// que los cuente como propios dice exactamente lo contrario de la verdad, justo arriba de un
// borrado. Medido en TASK-013 contra el emulador de verdad.
//
// No hay forma de distinguirlo por API desde este script. Se probaron las dos que habria:
//   - el campo `name` de cada documento viene REESCRITO con el projectId que uno pidio, asi que
//     un documento espejado no se delata (verificado: pedir /projects/sonda-xxx devuelve
//     "projects/sonda-xxx/.../sucursales/solano");
//   - comparar contra un namespace de control exigiria pedirle al emulador un proyecto distinto
//     de `demo-delfino`, que es justo lo que este script tiene PROHIBIDO hacer: el alcance del
//     barrido se demuestra con que ninguna URL nombre otro namespace (SEED_BARRIDO_ACOTADO).
//
// Entonces el reporte no afirma un conteo propio: avisa. Prefiere ser honesto y menos preciso
// antes que preciso y falso.
//
// Lo unico que si se puede afirmar: Auth NO espeja (un namespace virgen devuelve cero usuarios),
// asi que el conteo de usuarios de Auth es real. Y como el seed nunca deja documentos sin dejar
// tambien el usuario admin en Auth, "documentos > 0 con CERO usuarios de Auth" es la firma tipica
// del espejo y se remarca aparte.
function advertirSiPuedeSerEspejo(inv) {
  if (inv.totalDocs === 0) return;
  const firma = inv.usuariosAuth.length === 0;
  console.log(
    `\n  !! Los ${inv.totalDocs} documentos de arriba NO se pueden dar por propios de "${inv.proyecto}".\n` +
      `     El emulador corre con "singleProjectMode": en ese modo le sirve los documentos del\n` +
      `     proyecto principal a cualquier namespace al que todavia no se le haya escrito, y desde\n` +
      `     aca no hay forma de distinguir unos de otros (el emulador reescribe el projectId de\n` +
      `     cada documento con el que uno pidio, y este script no tiene permitido consultar otro\n` +
      `     namespace para comparar).\n` +
      (firma
        ? `     Y se da la firma tipica del espejo: ${inv.totalDocs} documentos con CERO usuarios de Auth,\n` +
          `     cuando el seed nunca deja lo uno sin lo otro. Lo mas probable es que NINGUNO de estos\n` +
          `     documentos sea de "${inv.proyecto}".\n`
        : `     El conteo de usuarios de Auth de arriba si es de "${inv.proyecto}": Auth no espeja.\n`) +
      `     Para confirmarlo a ojo: abri http://127.0.0.1:4000/firestore y fijate si los mismos\n` +
      `     documentos aparecen bajo el proyecto principal.`
  );
}

function imprimirInventario(inv) {
  const texto = (campo) => campo?.stringValue ?? campo?.booleanValue ?? "";
  console.log(`\nNamespace "${inv.proyecto}" del emulador (medido por REST, no por lo que sembro este script)`);
  console.log(`\n  Usuarios de Auth: ${inv.usuariosAuth.length}`);
  for (const u of inv.usuariosAuth) console.log(`    ${u.email}  uid ${u.uid}`);
  if (!inv.usuariosAuth.length) console.log("    (ninguno)");

  const perfiles = inv.colecciones.find((c) => c.nombre === "usuarios")?.docs ?? [];
  console.log(`\n  Perfiles en /usuarios: ${perfiles.length}`);
  for (const p of perfiles) {
    const uidsAuth = new Set(inv.usuariosAuth.map((u) => u.uid));
    const huerfano = uidsAuth.has(p.id) ? "" : "  <- sin usuario de Auth en este namespace";
    console.log(`    ${p.id}  ${texto(p.campos.email)} rol=${texto(p.campos.rol)}${huerfano}`);
  }
  if (!perfiles.length) console.log("    (ninguno)");

  console.log(`\n  Colecciones: ${inv.colecciones.length}, documentos: ${inv.totalDocs}`);
  for (const c of inv.colecciones) console.log(`    ${c.nombre.padEnd(20)} ${String(c.docs.length).padStart(3)} docs`);
  if (!inv.colecciones.length) console.log("    (ninguna)");
  advertirSiPuedeSerEspejo(inv);
  console.log("");
}

// --------------------------------------------------------------------- modos
async function modoReporte() {
  const inv = await inventario(NAMESPACE_BASURA);
  imprimirInventario(inv);

  // El contexto de R16 se explica siempre; lo que NO se afirma es que lo listado arriba SEA el
  // resto de ese bug, porque con `singleProjectMode` puede ser el espejo del proyecto principal.
  console.log(
    `Contexto (R16): el seed sembraba en "${NAMESPACE_BASURA}" mientras el ERP\n` +
      `y los tests miran "${PROYECTO_ERP}".\n`
  );

  if (inv.totalDocs === 0 && inv.usuariosAuth.length === 0) {
    console.log(`No hay nada que informar: "${NAMESPACE_BASURA}" esta vacio. No hace falta limpiar nada.\n`);
    return;
  }
  if (inv.totalDocs > 0 && inv.usuariosAuth.length === 0) {
    console.log(
      `Antes de limpiar, mira la advertencia de arriba: lo listado tiene la firma del espejo de\n` +
        `"singleProjectMode", asi que puede no haber NADA propio de "${NAMESPACE_BASURA}" que borrar.\n` +
        `Si aun asi queres correr la limpieza (no toca el proyecto del ERP: el namespace va fijo en\n` +
        `la URL de cada llamada):\n` +
        `  node scripts/seed-emulator.mjs --limpiar-demo-delfino\n`
    );
    return;
  }
  console.log(`Para borrar lo que sea propio de "${NAMESPACE_BASURA}":\n  node scripts/seed-emulator.mjs --limpiar-demo-delfino\n`);
}

async function modoLimpieza() {
  // Tres candados independientes antes de tocar nada. Si alguno no se cumple, no se borra.
  if (!NAMESPACES_BORRABLES.includes(NAMESPACE_BASURA)) {
    abortar(`ABORTADO: "${NAMESPACE_BASURA}" no esta en la lista de namespaces borrables.`);
  }
  if (NAMESPACE_BASURA === PROYECTO_ERP) {
    abortar(
      `ABORTADO: el namespace a borrar ("${NAMESPACE_BASURA}") es el mismo que usa el ERP segun\n` +
        `js/firebase-config.js ("${PROYECTO_ERP}"). La limpieza no borra datos que el ERP mira.`
    );
  }
  if (NAMESPACES_BORRABLES.includes(PROYECTO_ERP)) {
    abortar(
      `ABORTADO: el proyecto del ERP ("${PROYECTO_ERP}") figura en la lista de namespaces borrables.\n` +
        `Revisa js/firebase-config.js antes de limpiar nada.`
    );
  }

  console.log(`\n=== SE VA A BORRAR ESTO, y solo esto ===`);
  const antes = await inventario(NAMESPACE_BASURA);
  imprimirInventario(antes);

  if (!antes.usuariosAuth.length && !antes.totalDocs) {
    console.log(`Nada que borrar: "${NAMESPACE_BASURA}" ya esta vacio.\n`);
    return;
  }

  // El listado de arriba puede incluir documentos espejados del proyecto principal (ver la
  // advertencia de singleProjectMode). Eso NO los pone en riesgo: el DELETE va contra
  // /emulator/v1/projects/demo-delfino/..., el namespace viaja en la URL y el espejo es de
  // lectura. Medido en TASK-013 sobre un emulador descartable: despues de este borrado, el
  // proyecto del ERP seguia con sus 35 documentos y su usuario de Auth intactos.
  if (antes.totalDocs > 0) {
    console.log(
      `Aclaracion sobre el listado de arriba: el borrado va SOLO contra el namespace\n` +
        `"${NAMESPACE_BASURA}" (viaja en la URL de cada llamada). Los documentos que aparezcan ahi\n` +
        `por el espejo de "singleProjectMode" son del proyecto principal y NO se borran: ese espejo\n` +
        `es de lectura. Lo que se borra es unicamente lo que "${NAMESPACE_BASURA}" tenga de propio.\n`
    );
  }

  // Endpoints /emulator/v1/: solo existen en los emuladores, no en Firestore ni en Identity
  // Toolkit reales. El proyecto va en la ruta, asi que el alcance del borrado es el namespace
  // nombrado y ningun otro.
  await pedir(`${BASE_FIRESTORE}/emulator/v1/projects/${NAMESPACE_BASURA}/databases/(default)/documents`, { method: "DELETE" });
  await pedir(`${BASE_AUTH}/emulator/v1/projects/${NAMESPACE_BASURA}/accounts`, { method: "DELETE" });

  const despues = await inventario(NAMESPACE_BASURA);
  console.log(`=== DESPUES ===`);
  imprimirInventario(despues);
  if (despues.usuariosAuth.length || despues.totalDocs) {
    // No se usa abortar(): este punto es DESPUES de haber hecho fetch, y ahi `process.exit()`
    // revienta con la asercion de libuv de Node en Windows y se lleva puesto el codigo de salida.
    // Se fija `exitCode` y se vuelve: los sockets de undici estan unref, asi que el proceso
    // termina solo, enseguida y con el 1 que corresponde.
    console.error(`\nABORTADO: "${NAMESPACE_BASURA}" no quedo vacio. Revisalo a mano.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Listo: "${NAMESPACE_BASURA}" quedo vacio. "${PROYECTO_ERP}" no se toco en ningun momento\n` +
      `(el proyecto viaja en la URL de cada llamada y esta fijo en el codigo).\n` +
      `Nota: el emulador exporta su estado al salir; si se levanto con --import de un export viejo,\n` +
      `el namespace vuelve a aparecer hasta que se re-exporte.\n`
  );
}

// ------------------------------------------------------------ modo seed (default)
// El plan de cuentas se toma del codigo real para que no se desincronice del ERP. No se puede
// importar js/contabilidad.js directo: ese modulo importa Firebase desde una URL de gstatic y
// Node no resuelve URLs en un import (solo el navegador, o vitest via alias). Asi que se lee el
// archivo como texto y se extrae el array literal.
function leerPlanDeCuentas() {
  const fuente = readFileSync(join(RAIZ, "js", "contabilidad.js"), "utf8");
  const inicio = fuente.indexOf("export const PLAN_DE_CUENTAS");
  if (inicio === -1) throw new Error("No se encontro PLAN_DE_CUENTAS en js/contabilidad.js");
  const desdeCorchete = fuente.indexOf("[", inicio);
  let nivel = 0, fin = -1;
  for (let i = desdeCorchete; i < fuente.length; i++) {
    if (fuente[i] === "[") nivel++;
    else if (fuente[i] === "]") { nivel--; if (nivel === 0) { fin = i + 1; break; } }
  }
  if (fin === -1) throw new Error("No se pudo delimitar el array PLAN_DE_CUENTAS");
  return new Function(`return ${fuente.slice(desdeCorchete, fin)};`)();
}

async function usuarioAdmin(db, auth) {
  let user;
  try {
    user = await auth.getUserByEmail(EMAIL);
  } catch {
    user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: "Admin de desarrollo" });
  }
  await db.collection("usuarios").doc(user.uid).set(
    { nombre: "Admin de desarrollo", email: EMAIL, rol: "administrador", activo: true },
    { merge: true }
  );
  return user.uid;
}

async function planDeCuentas(db) {
  const cuentas = leerPlanDeCuentas();
  const batch = db.batch();
  for (const cuenta of cuentas) batch.set(db.collection("cuentasContables").doc(cuenta.codigo), cuenta);
  await batch.commit();
  return cuentas.length;
}

async function maestros(db, uid) {
  const ahora = admin.firestore.FieldValue.serverTimestamp();
  const base = { creadoPor: uid, creadoEn: ahora };

  await db.collection("sucursales").doc("solano").set({ nombre: "Solano", direccion: "Av. Juan Domingo Perón 4464", ...base });
  await db.collection("depositos").doc("principal").set({ nombre: "Depósito principal", sucursalId: "solano", ...base });
  await db.collection("listasPrecios").doc("presencial").set({ nombre: "Venta presencial", porDefecto: true, ...base });
  await db.collection("marcas").doc("generica").set({ nombre: "Genérica", nombreLower: "genérica", ...base });
  await db.collection("categorias").doc("electro").set({ nombre: "Electrodomésticos", nombreLower: "electrodomésticos", nivel: 1, parentId: null, ...base });

  const productos = [
    { sku: "DEV-001", descripcion: "Heladera de prueba", precioVenta: 850000, costoReferencia: 600000, stockTotal: 5 },
    { sku: "DEV-002", descripcion: "Lavarropas de prueba", precioVenta: 620000, costoReferencia: 430000, stockTotal: 1 },
    { sku: "DEV-003", descripcion: "Microondas de prueba", precioVenta: 190000, costoReferencia: 130000, stockTotal: 0 },
  ];
  for (const p of productos) {
    await db.collection("productos").doc(p.sku).set({
      ...p,
      descripcionLower: p.descripcion.toLowerCase(),
      marcaNombre: "Genérica",
      categoriaId: "electro",
      estado: "activo",
      ...base,
    });
  }

  await db.collection("clientes").doc("cliente-dev").set(
    { razonSocial: "Cliente de prueba", razonSocialLower: "cliente de prueba", cuit: "20111111112", email: "cliente@delfino.local", activo: true, ...base }
  );

  await db.collection("contadores").doc("ventas").set({ ultimo: 0 });
  await db.collection("contadores").doc("asientos").set({ ultimo: 0 });
  await db.collection("contadores").doc("comprobantes").set({ ultimo: 0 });

  return productos.length;
}

async function modoSeed() {
  // El Admin SDK obedece GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT. Si alguna apunta a otro
  // namespace, sembrar seria invisible para el ERP: se aborta nombrando los dos valores.
  const forzadas = [
    ["GCLOUD_PROJECT", process.env.GCLOUD_PROJECT],
    ["GOOGLE_CLOUD_PROJECT", process.env.GOOGLE_CLOUD_PROJECT],
  ].filter(([, v]) => v);
  const distintas = forzadas.filter(([, v]) => v !== PROYECTO_ERP);

  if (distintas.length) {
    abortar(
      `ABORTADO: el seed sembraria en un proyecto que el ERP local no mira.\n\n` +
        `  proyecto del ERP        ${PROYECTO_ERP}   (js/firebase-config.js, y --project de npm run emulators)\n` +
        distintas.map(([k, v]) => `  proyecto forzado        ${v}   (variable de entorno ${k})\n`).join("") +
        `\nEl emulador acepta cualquier projectId y crea el namespace al vuelo, asi que sembrar ahi\n` +
        `terminaria "con exito" y el ERP no veria ni el usuario ni los datos (riesgo R16).\n\n` +
        `Que hacer, segun el caso:\n` +
        `  - Si queres sembrar para usar el ERP en local: corre el seed con\n` +
        `    GCLOUD_PROJECT=${PROYECTO_ERP} GOOGLE_CLOUD_PROJECT=${PROYECTO_ERP} npm run seed\n` +
        `    o simplemente sin esas variables puestas.\n` +
        `  - Si sos un agente: esto es lo esperado. .claude/settings.json fija a proposito\n` +
        `    GCLOUD_PROJECT=demo-delfino para que los agentes NO siembren el namespace real.\n` +
        `    No lo saltees: pedile a Gaston que corra el seed.\n` +
        `  - Si ${PROYECTO_ERP} dejo de ser el proyecto correcto, se cambia en js/firebase-config.js\n` +
        `    (solo Gaston), no aca.`
    );
  }

  admin.initializeApp({ projectId: PROYECTO_ERP });
  const db = admin.firestore();
  const auth = admin.auth();

  const uid = await usuarioAdmin(db, auth);
  const cuentas = await planDeCuentas(db);
  const cantProductos = await maestros(db, uid);

  console.log(`
Emulador cargado.
  proyecto    ${PROYECTO_ERP}  (leido de js/firebase-config.js: el mismo que miran el ERP y los tests)
  usuario     ${EMAIL} / ${PASSWORD}  (rol administrador, uid ${uid})
  cuentas     ${cuentas} del plan de cuentas real
  maestros    1 sucursal, 1 depósito, 1 lista de precios, 1 marca, 1 categoría, ${cantProductos} productos, 1 cliente
  contadores  ventas, asientos y comprobantes en 0

  Stock preparado para probar invariantes:
    DEV-001 stock 5  -> VENTA_NORMAL
    DEV-002 stock 1  -> CONCURRENCIA / STOCK_INSUFICIENTE
    DEV-003 stock 0  -> STOCK_INSUFICIENTE

  UI del emulador: http://127.0.0.1:4000
`);
}

// Codigo de salida: los modos que hablan por `fetch` NO llaman `process.exit()`.
//
// En Node 24 / Windows, `process.exit()` con sockets de fetch todavia cerrandose dispara la
// asercion de libuv `!(handle->flags & UV_HANDLE_CLOSING)` y una corrida perfectamente exitosa
// termina con 3221226505 (0xC0000409). Un modo de solo lectura tiene que salir 0.
// Dejar que el proceso termine solo no cuesta nada: los sockets de undici estan unref y el
// proceso sale igual de rapido (medido: 1 ms de diferencia sobre 12 pedidos al emulador).
// El modo sembrado es el unico que sigue con `process.exit()`: el Admin SDK deja canales gRPC
// abiertos y sin eso no terminaria nunca. Ese camino no usa fetch, asi que no corre el riesgo.
const MODO_POR_FETCH = modo === "--reporte-demo" || modo === "--limpiar-demo-delfino";

try {
  if (modo === "--reporte-demo") await modoReporte();
  else if (modo === "--limpiar-demo-delfino") await modoLimpieza();
  else {
    await modoSeed();
    process.exit(0);
  }
} catch (err) {
  console.error("\nFALLO EL SEED:", err?.message || err);
  console.error(err?.stack || "");
  if (MODO_POR_FETCH) process.exitCode = 1;
  else process.exit(1);
}
