// Corre una vez antes de todos los tests de integracion.
// Su unico trabajo es fallar rapido y con un mensaje entendible si el entorno no esta listo,
// en vez de dejar que 20 tests fallen con "ECONNREFUSED".
import { Client } from "pg";

const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PG = process.env.DATABASE_URL_TEST || "postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test";

function abortar(mensaje) {
  throw new Error(`\n\n=== ENTORNO DE INTEGRACION NO LISTO ===\n${mensaje}\n`);
}

export async function setup() {
  if (!FIRESTORE) {
    abortar(
      "Falta FIRESTORE_EMULATOR_HOST.\n" +
        "Estos tests NUNCA deben correr contra produccion.\n" +
        "Usa: npm run test:integration (que levanta el emulador solo)."
    );
  }
  if (!FIRESTORE.startsWith("127.0.0.1") && !FIRESTORE.startsWith("localhost")) {
    abortar(`FIRESTORE_EMULATOR_HOST apunta a "${FIRESTORE}", que no es local. Abortado por seguridad.`);
  }
  if (!AUTH) abortar("Falta FIREBASE_AUTH_EMULATOR_HOST.");

  const respuesta = await fetch(`http://${FIRESTORE}/`).catch(() => null);
  if (!respuesta) abortar(`El emulador de Firestore no responde en ${FIRESTORE}.\nLevantalo con: npm run emulators`);

  const cliente = new Client({ connectionString: PG });
  try {
    await cliente.connect();
    await cliente.query("select 1");
  } catch (err) {
    abortar(`Postgres local no responde (${PG}).\nLevantalo con: npm run db:up\nDetalle: ${err.message}`);
  } finally {
    await cliente.end().catch(() => {});
  }

  console.log(`[integracion] Firestore emulador: ${FIRESTORE} · Postgres: ok`);
}
