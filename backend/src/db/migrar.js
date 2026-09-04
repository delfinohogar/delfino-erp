// Migrador de esquema de Delfino ERP.
//
//   node backend/src/db/migrar.js              aplica las migraciones pendientes
//   node backend/src/db/migrar.js --estado     solo informa que hay aplicado y que falta
//   node backend/src/db/migrar.js --marcar-aplicadas
//                                              marca las pendientes como aplicadas SIN correrlas
//                                              (baseline explicito; ver backend/README.md)
//
// Garantias:
//   - orden alfabetico de los archivos .sql de backend/db/migrations/;
//   - cada migracion corre dentro de su propia transaccion, y el INSERT en schema_migrations
//     va en ESA MISMA transaccion: si la migracion falla, no queda marcada como aplicada;
//   - un pg_advisory_lock de sesion serializa dos corridas simultaneas, asi que la misma
//     migracion no se aplica dos veces;
//   - es idempotente: correrlo de nuevo no reaplica nada y sale con codigo 0.
//
// Requisito de las migraciones: tienen que poder correr dentro de una transaccion
// (nada de CREATE INDEX CONCURRENTLY ni VACUUM).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { crearPool } from "./pool.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const DIR_MIGRACIONES = join(AQUI, "..", "..", "db", "migrations");

// Clave arbitraria pero fija del lock de sesion. Cualquier proceso que migre esta base usa
// esta misma clave; nadie mas la usa.
const CLAVE_LOCK = 5150419;

const SQL_TABLA = `
  create table if not exists schema_migrations (
    nombre      text primary key,
    aplicada_en timestamptz not null default now()
  )
`;

/** Nombres de los archivos .sql en disco, en orden alfabetico. */
export function migracionesEnDisco(dir = DIR_MIGRACIONES) {
  return readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".sql"))
    .sort();
}

/** Nombres ya registrados en schema_migrations. */
export async function migracionesAplicadas(cliente) {
  const { rows } = await cliente.query("select nombre from schema_migrations order by nombre");
  return rows.map((r) => r.nombre);
}

function detallarError(err, archivo) {
  const partes = [`La migracion ${archivo} fallo y se revirtio (ROLLBACK).`, `  ${err.message}`];
  if (err.detail) partes.push(`  detalle: ${err.detail}`);
  if (err.hint) partes.push(`  sugerencia: ${err.hint}`);
  if (err.position) partes.push(`  posicion en el archivo SQL: ${err.position}`);
  if (err.code === "42P07" || err.code === "42710") {
    partes.push(
      "  Parece que la base ya tiene el esquema aplicado por otra via (por ejemplo",
      "  tests/integration/postgres/_helpers.mjs, que corre los .sql a mano y no registra nada).",
      "  Opciones, las dos explicitas: vaciar la base y volver a migrar, o marcar el estado",
      "  actual como baseline con --marcar-aplicadas. Ver backend/README.md.",
    );
  }
  const error = new Error(partes.join("\n"));
  error.cause = err;
  return error;
}

/**
 * Aplica las migraciones pendientes sobre un cliente ya conectado y con el lock tomado.
 * @returns {Promise<string[]>} nombres de las migraciones aplicadas en esta corrida
 */
export async function aplicarPendientes(cliente, { dir = DIR_MIGRACIONES, log = () => {} } = {}) {
  await cliente.query(SQL_TABLA);
  const aplicadas = new Set(await migracionesAplicadas(cliente));
  const pendientes = migracionesEnDisco(dir).filter((n) => !aplicadas.has(n));

  const hechas = [];
  for (const archivo of pendientes) {
    const sql = readFileSync(join(dir, archivo), "utf8");
    try {
      await cliente.query("begin");
      await cliente.query(sql);
      await cliente.query("insert into schema_migrations(nombre) values ($1)", [archivo]);
      await cliente.query("commit");
    } catch (err) {
      await cliente.query("rollback").catch(() => {});
      throw detallarError(err, archivo);
    }
    hechas.push(archivo);
    log(`  aplicada  ${archivo}`);
  }
  return hechas;
}

/** Baseline explicito: registra las pendientes SIN ejecutarlas. Nunca se hace solo. */
export async function marcarPendientesComoAplicadas(cliente, { dir = DIR_MIGRACIONES, log = () => {} } = {}) {
  await cliente.query(SQL_TABLA);
  const aplicadas = new Set(await migracionesAplicadas(cliente));
  const pendientes = migracionesEnDisco(dir).filter((n) => !aplicadas.has(n));
  if (!pendientes.length) return [];
  try {
    await cliente.query("begin");
    for (const archivo of pendientes) {
      await cliente.query("insert into schema_migrations(nombre) values ($1)", [archivo]);
      log(`  marcada SIN correr  ${archivo}`);
    }
    await cliente.query("commit");
  } catch (err) {
    await cliente.query("rollback").catch(() => {});
    throw err;
  }
  return pendientes;
}

async function conLock(cliente, fn, log) {
  const { rows } = await cliente.query("select pg_try_advisory_lock($1::bigint) as tomado", [CLAVE_LOCK]);
  if (!rows[0].tomado) {
    log("Otra corrida del migrador tiene el lock. Esperando...");
    await cliente.query("select pg_advisory_lock($1::bigint)", [CLAVE_LOCK]);
  }
  try {
    return await fn();
  } finally {
    await cliente.query("select pg_advisory_unlock($1::bigint)", [CLAVE_LOCK]).catch(() => {});
  }
}

export async function principal(argv = process.argv.slice(2), log = console.log) {
  const soloEstado = argv.includes("--estado");
  const baseline = argv.includes("--marcar-aplicadas");
  const pool = crearPool({ max: 1 });
  const cliente = await pool.connect();
  try {
    await conLock(
      cliente,
      async () => {
        if (soloEstado) {
          await cliente.query(SQL_TABLA);
          const aplicadas = new Set(await migracionesAplicadas(cliente));
          for (const archivo of migracionesEnDisco()) {
            log(`  ${aplicadas.has(archivo) ? "aplicada " : "PENDIENTE"}  ${archivo}`);
          }
          const sobrantes = [...aplicadas].filter((n) => !migracionesEnDisco().includes(n));
          for (const archivo of sobrantes) log(`  registrada pero NO esta en disco: ${archivo}`);
          return;
        }
        if (baseline) {
          log("BASELINE EXPLICITO: se marcan como aplicadas sin ejecutarlas.");
          const marcadas = await marcarPendientesComoAplicadas(cliente, { log });
          log(marcadas.length ? `Marcadas ${marcadas.length}.` : "No habia pendientes.");
          return;
        }
        const hechas = await aplicarPendientes(cliente, { log });
        log(hechas.length ? `Listo: ${hechas.length} migracion(es) aplicada(s).` : "Sin migraciones pendientes.");
      },
      log
    );
  } finally {
    cliente.release();
    await pool.end();
  }
}

const ejecutadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirecto) {
  principal().catch((err) => {
    console.error(`\n${err.message}\n`);
    process.exitCode = 1;
  });
}
