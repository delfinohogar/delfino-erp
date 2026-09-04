// Utilidades del test del migrador (TASK-001).
//
// Cada test trabaja sobre una BASE TEMPORAL propia (delfino_test_mig_*), creada y destruida
// por el propio test. Nunca toca delfino_dev y deja delfino_test como la encontro, asi la
// suite se puede correr dos veces seguidas.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import pg from "pg";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, "..", "..", "..");
export const MIGRAR_JS = join(RAIZ, "backend", "src", "db", "migrar.js");

export const ADMIN_URL =
  process.env.DATABASE_URL_TEST ||
  "postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test";

export const PREFIJO = "delfino_test_mig_";

export function nombreBase(sufijo) {
  return `${PREFIJO}${sufijo}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60);
}

export function urlDeBase(nombre) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${nombre}`;
  return u.toString();
}

export function baseDeUrl(url) {
  return new URL(url).pathname.replace(/^\//, "");
}

async function conAdmin(fn) {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

export async function crearBaseTemporal(sufijo) {
  const nombre = nombreBase(sufijo);
  await conAdmin(async (c) => {
    await c.query(`drop database if exists "${nombre}" with (force)`);
    await c.query(`create database "${nombre}"`);
  });
  return { nombre, url: urlDeBase(nombre) };
}

export async function borrarBase(nombre) {
  await conAdmin((c) => c.query(`drop database if exists "${nombre}" with (force)`));
}

export async function borrarBasesTemporalesHuerfanas() {
  await conAdmin(async (c) => {
    const { rows } = await c.query("select datname from pg_database where datname like $1", [
      `${PREFIJO}%`,
    ]);
    for (const { datname } of rows) {
      await c.query(`drop database if exists "${datname}" with (force)`).catch(() => {});
    }
    return rows.length;
  });
}

/** Cliente conectado a una base temporal. El llamador lo cierra. */
export async function clienteDe(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Entorno para el proceso hijo: base explicita, sin arrastrar las variables del padre. */
export function entorno({ testUrl, devUrl, enTests = true } = {}) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_TEST;
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.NODE_ENV;
  if (testUrl) env.DATABASE_URL_TEST = testUrl;
  if (devUrl) env.DATABASE_URL = devUrl;
  if (enTests) env.NODE_ENV = "test";
  return env;
}

/** Corre `node backend/src/db/migrar.js` de verdad, como proceso aparte. */
export function correrMigrador(args = [], env = entorno()) {
  const r = spawnSync(process.execPath, [MIGRAR_JS, ...args], {
    env,
    encoding: "utf8",
    timeout: 60000,
    cwd: RAIZ,
  });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    salida: `${r.stdout || ""}${r.stderr || ""}`,
    error: r.error || null,
  };
}

/** Version asincronica, para las pruebas de concurrencia. */
export function lanzarMigrador(args = [], env = entorno()) {
  const hijo = spawn(process.execPath, [MIGRAR_JS, ...args], { env, cwd: RAIZ });
  let stdout = "";
  let stderr = "";
  hijo.stdout.on("data", (d) => (stdout += d));
  hijo.stderr.on("data", (d) => (stderr += d));
  const terminado = new Promise((resolve) => {
    hijo.on("close", (status) => resolve({ status, stdout, stderr, salida: stdout + stderr }));
  });
  return { hijo, terminado };
}

/** Directorio temporal con migraciones inventadas. Devuelve { dir, limpiar }. */
export function dirDeMigraciones(archivos) {
  const dir = mkdtempSync(join(tmpdir(), "delfino-mig-"));
  for (const [nombre, sql] of archivos) writeFileSync(join(dir, nombre), sql, "utf8");
  return { dir, limpiar: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function filasSchemaMigrations(cliente) {
  const { rows } = await cliente.query(
    "select nombre, aplicada_en from schema_migrations order by aplicada_en asc, nombre asc"
  );
  return rows;
}

export async function existeRelacion(cliente, nombre) {
  const { rows } = await cliente.query("select to_regclass($1) as r", [nombre]);
  return rows[0].r !== null;
}
