// PRUEBA DE ULTIMA BARRERA (FASE -1, punto 9) — la corre GASTON A MANO, una sola vez.
// NO esta en los scripts de npm y NO corre en CI, a proposito.
//
// Que hace: intenta escribir en Firestore de PRODUCCION, sin emulador y sin usuario logueado.
// Que tiene que pasar: FirebaseError "Missing or insufficient permissions".
// Por que sirve: demuestra que aunque fallaran TODAS las barreras anteriores (wiring de
// emulador, permisos de Claude Code, hooks de git), un proceso sin un usuario real del ERP
// no puede escribir nada, porque firestore.rules exige estaLogueado() en toda escritura.
//
//   node scripts/safety-prod-denied.mjs
//
// Despues, verificá en Firebase Console que la coleccion _safety_probe NO existe.
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import { firebaseConfig } from "../js/firebase-config.js";

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("\nABORTADO: hay FIRESTORE_EMULATOR_HOST puesto. Esta prueba va contra produccion a proposito.");
  console.error("Correla en una terminal limpia, sin las variables de emulador.\n");
  process.exit(1);
}

console.log(`\nIntentando escribir en el proyecto de PRODUCCION "${firebaseConfig.projectId}", sin autenticar...`);

const app = initializeApp(firebaseConfig, "safety-prod-denied");
const db = getFirestore(app);

try {
  await addDoc(collection(db, "_safety_probe"), { origen: "safety-prod-denied", ts: new Date().toISOString() });
  console.error(`
=========================================================
FALLO GRAVE: la escritura fue ACEPTADA por produccion.

Las Firestore Security Rules estan permitiendo escrituras
sin usuario autenticado. Esto es un problema del ERP, no de
la migracion, y hay que resolverlo antes de seguir.

Revisá firestore.rules y borrá la coleccion _safety_probe
desde Firebase Console.
=========================================================
`);
  process.exit(1);
} catch (err) {
  const esperado = /permission|insufficient|PERMISSION_DENIED|unauthenticated/i.test(String(err?.code || err?.message));
  if (esperado) {
    console.log(`
OK. Produccion rechazo la escritura, como debe ser.
  codigo: ${err.code || "(sin codigo)"}
  detalle: ${err.message}

Ultima barrera verificada: sin un usuario real del ERP, nada escribe en produccion.
Verificá igualmente en Firebase Console que _safety_probe no existe.
`);
    process.exit(0);
  }
  console.error(`
Resultado INESPERADO (no es un rechazo de permisos):
  ${err?.code || ""} ${err?.message || err}

Puede ser falta de red o la API key restringida por dominio. Revisalo antes de seguir.
`);
  process.exit(2);
}
