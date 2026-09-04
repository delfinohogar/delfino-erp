// Cliente PostgreSQL del backend de Delfino ERP.
//
// Es el unico punto de acceso a la base. No abre puertos, no escucha HTTP, no importa
// Firebase y no tiene efectos al importarse: el pool se crea recien cuando alguien lo pide.
//
// Variables de entorno:
//   DATABASE_URL       base de trabajo (delfino_dev). Es la que se usa fuera de los tests.
//   DATABASE_URL_TEST  base de tests (delfino_test). Solo se usa en entorno de tests.
import pg from "pg";

const VAR_PRINCIPAL = "DATABASE_URL";
const VAR_TESTS = "DATABASE_URL_TEST";

// La PoC corre contra el Postgres local de backend/docker-compose.yml. Un host que no sea
// loopback es, casi seguro, un error de configuracion: se corta antes de conectar.
const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);
const VAR_PERMITIR_REMOTO = "DELFINO_DB_REMOTO_OK";

/** Vitest define VITEST y NODE_ENV=test. Cualquiera de los dos alcanza. */
export function enEntornoDeTests(env = process.env) {
  return env.NODE_ENV === "test" || Boolean(env.VITEST) || Boolean(env.VITEST_WORKER_ID);
}

function leer(env, nombre) {
  return String(env[nombre] || "").trim();
}

function mensajeSinUrl(env) {
  if (enEntornoDeTests(env)) {
    return [
      "Falta la URL de conexion a PostgreSQL.",
      `En tests se lee ${VAR_TESTS} y, si no esta definida, ${VAR_PRINCIPAL}. No hay ninguna de las dos.`,
      "Levanta la base con: npm run db:up",
      `Ejemplo: ${VAR_TESTS}=postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test`,
    ].join("\n");
  }
  const hayTest = Boolean(leer(env, VAR_TESTS));
  return [
    "Falta la URL de conexion a PostgreSQL.",
    `Fuera de los tests se lee ${VAR_PRINCIPAL}, que no esta definida.`,
    hayTest
      ? `${VAR_TESTS} si esta definida, pero solo se usa en entorno de tests (NODE_ENV=test o VITEST): no se toma por error.`
      : "",
    "Levanta la base con: npm run db:up y defini, por ejemplo:",
    `${VAR_PRINCIPAL}=postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_dev`,
    "El archivo backend/.env.example tiene los valores de desarrollo.",
  ]
    .filter(Boolean)
    .join("\n");
}

function verificarQueEsLocal(url, env) {
  if (leer(env, VAR_PERMITIR_REMOTO) === "1") return;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return; // URL rara: que falle pg con su propio mensaje, no este chequeo.
  }
  if (!host || HOSTS_LOCALES.has(host)) return;
  throw new Error(
    [
      `La URL de PostgreSQL apunta a "${host}", que no es local.`,
      "La PoC corre SIEMPRE contra el Postgres local (127.0.0.1, npm run db:up).",
      `Si de verdad hace falta otro host, exportar ${VAR_PERMITIR_REMOTO}=1 y hacerse cargo.`,
    ].join("\n")
  );
}

/**
 * URL de conexion segun el entorno. Lanza con mensaje explicito si no hay ninguna.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function urlConexion(env = process.env) {
  const url = enEntornoDeTests(env)
    ? leer(env, VAR_TESTS) || leer(env, VAR_PRINCIPAL)
    : leer(env, VAR_PRINCIPAL);
  if (!url) throw new Error(mensajeSinUrl(env));
  verificarQueEsLocal(url, env);
  return url;
}

/** Crea un pool nuevo e independiente. El llamador es responsable de cerrarlo. */
export function crearPool(opciones = {}) {
  const { env = process.env, ...resto } = opciones;
  const pool = new pg.Pool({ connectionString: urlConexion(env), max: 10, ...resto });
  // Sin este handler, un error en una conexion ociosa tumba el proceso entero.
  pool.on("error", (err) => {
    console.error("[db] error en una conexion ociosa del pool:", err.message);
  });
  return pool;
}

let poolCompartido = null;

/** Pool compartido del proceso. Se crea la primera vez que se lo pide. */
export function obtenerPool(opciones) {
  if (!poolCompartido) poolCompartido = crearPool(opciones);
  return poolCompartido;
}

export async function cerrarPool() {
  if (!poolCompartido) return;
  const pool = poolCompartido;
  poolCompartido = null;
  await pool.end();
}

/**
 * Corre `fn` dentro de una transaccion. Si `fn` lanza, hace ROLLBACK y relanza:
 * nunca queda media operacion escrita.
 */
export async function conTransaccion(fn, pool = obtenerPool()) {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    const resultado = await fn(cliente);
    await cliente.query("commit");
    return resultado;
  } catch (err) {
    await cliente.query("rollback").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}
