// Utilidades del test de migraciones repetibles (TASK-012).
//
// Por que hace falta una COPIA de backend/ en vez de usar el arbol del repo:
// el migrador resuelve `db/migrations/` y `db/repetibles/` como rutas fijas relativas a
// `backend/src/db/migrar.js`, y no acepta overrides por CLI ni por entorno. Para probar el CLI
// de verdad (exit code, salida, concurrencia entre procesos) hace falta poder poner archivos en
// esos dos directorios, y con contenido inventado: los tests de aca no dependen del dominio.
// El tester NO escribe en backend/, asi que cada test arma su propia copia desechable del
// migrador bajo tests/.tmp-migrador/ y la borra al terminar.
//
// El directorio se llama `repetibles/`, NO `functions/`: TASK-018 lo renombro (decision de
// Gaston, 2026-09-05) porque dentro de un directorio de base de datos "functions" es ambiguo
// entre funciones de PostgreSQL y las Cloud Functions de functions/, y esa ambiguedad costo un
// bloqueo real (R39). Este nombre TIENE que coincidir con DIR_REPETIBLES de migrar.js: si no
// coincide, la copia del migrador no ve ninguna repetible y los tests pasan a probar el caso
// "no hay repetibles" sin decirlo.
//
// La copia normaliza migrar.js y pool.js a LF. No es una modificacion: el arbol de trabajo esta
// en CRLF por core.autocrlf, pero el indice de git tiene LF (`git ls-files --eol` da `i/lf
// w/crlf`), asi que la copia es byte a byte lo que esta commiteado. Los finales de linea de un
// fuente JS no tienen ningun efecto semantico.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { DIR_REPETIBLES } from "../../../backend/src/db/migrar.js";
import { RAIZ } from "./_migrador_helpers.mjs";

export const DIR_TRABAJO = join(RAIZ, "tests", ".tmp-migrador");

// Se DERIVA de migrar.js en vez de escribirse a mano: si alguien vuelve a renombrar el
// directorio, la copia lo sigue sola y ningun test se queda probando el caso vacio en silencio.
export const NOMBRE_DIR_REPETIBLES = basename(DIR_REPETIBLES);

const FUENTE_MIGRAR = join(RAIZ, "backend", "src", "db", "migrar.js");
const FUENTE_POOL = join(RAIZ, "backend", "src", "db", "pool.js");

const aLf = (t) => t.replace(/\r\n/g, "\n");

/** Borra restos de corridas anteriores. Se llama en beforeAll y afterAll. */
export function limpiarDirTrabajo() {
  rmSync(DIR_TRABAJO, { recursive: true, force: true });
}

/**
 * Aplica una mutacion textual al fuente del migrador, exigiendo que el fragmento aparezca
 * EXACTAMENTE UNA VEZ. Si el implementador cambia el codigo, el test revienta en vez de mentir
 * (una mutacion que no muta nada da un "mutante" identico al original y siempre verde).
 */
export function mutar(texto, [buscar, reemplazo]) {
  const veces = texto.split(buscar).length - 1;
  if (veces !== 1) {
    throw new Error(
      `[MUTACION INVALIDA] el fragmento aparece ${veces} veces en migrar.js, se esperaba 1:\n${buscar}`
    );
  }
  return texto.replace(buscar, reemplazo);
}

/**
 * Copia desechable del migrador con sus dos directorios de migraciones bajo control.
 *
 * @param {object} opciones
 * @param {Array<[string,string]>} [opciones.migraciones] numeradas: [nombre, sql]
 * @param {Array<[string,string]>|null} [opciones.repetibles] repetibles: [nombre, sql].
 *        `null` = NO se crea el directorio db/repetibles (caso "no existe").
 *        `[]`   = se crea vacio.
 * @param {Array<[string,string]>} [opciones.mutaciones] pares [buscar, reemplazar] sobre migrar.js
 */
export function crearCopiaBackend({ migraciones = [], repetibles = null, mutaciones = [] } = {}) {
  mkdirSync(DIR_TRABAJO, { recursive: true });
  const raiz = join(DIR_TRABAJO, randomUUID().slice(0, 8));
  const dirDb = join(raiz, "backend", "src", "db");
  const dirMigraciones = join(raiz, "backend", "db", "migrations");
  const dirRepetibles = join(raiz, "backend", "db", NOMBRE_DIR_REPETIBLES);
  mkdirSync(dirDb, { recursive: true });
  mkdirSync(dirMigraciones, { recursive: true });

  let fuente = aLf(readFileSync(FUENTE_MIGRAR, "utf8"));
  for (const m of mutaciones) fuente = mutar(fuente, m);
  writeFileSync(join(dirDb, "migrar.js"), fuente, "utf8");
  writeFileSync(join(dirDb, "pool.js"), aLf(readFileSync(FUENTE_POOL, "utf8")), "utf8");

  const api = {
    raiz,
    migrarJs: join(dirDb, "migrar.js"),
    dirMigraciones,
    dirRepetibles,
    /** Escribe un .sql tal cual, sin traducir finales de linea (Node no los toca). */
    escribirRepetible(nombre, sql, { crlf = false } = {}) {
      mkdirSync(dirRepetibles, { recursive: true });
      const texto = crlf ? aLf(sql).replace(/\n/g, "\r\n") : aLf(sql);
      writeFileSync(join(dirRepetibles, nombre), texto, "utf8");
      return texto;
    },
    borrarRepetible(nombre) {
      rmSync(join(dirRepetibles, nombre), { force: true });
    },
    escribirMigracion(nombre, sql) {
      writeFileSync(join(dirMigraciones, nombre), aLf(sql), "utf8");
    },
    bytesRepetible(nombre) {
      return readFileSync(join(dirRepetibles, nombre));
    },
    limpiar() {
      rmSync(raiz, { recursive: true, force: true });
    },
  };

  for (const [nombre, sql] of migraciones) api.escribirMigracion(nombre, sql);
  if (repetibles !== null) {
    mkdirSync(dirRepetibles, { recursive: true });
    for (const [nombre, sql] of repetibles) api.escribirRepetible(nombre, sql);
  }
  if (existsSync(dirRepetibles) && repetibles === null) {
    throw new Error(`no deberia existir db/${NOMBRE_DIR_REPETIBLES} cuando repetibles es null`);
  }
  return api;
}

/** Corre una copia del migrador como proceso aparte. */
export function correrCopia(copia, args = [], env) {
  const r = spawnSync(process.execPath, [copia.migrarJs, ...args], {
    env,
    encoding: "utf8",
    timeout: 60000,
    cwd: copia.raiz,
  });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    salida: `${r.stdout || ""}${r.stderr || ""}`,
    error: r.error || null,
  };
}

/** Version asincronica de correrCopia, para concurrencia. */
export function lanzarCopia(copia, args = [], env) {
  const hijo = spawn(process.execPath, [copia.migrarJs, ...args], { env, cwd: copia.raiz });
  let stdout = "";
  let stderr = "";
  hijo.stdout.on("data", (d) => (stdout += d));
  hijo.stderr.on("data", (d) => (stderr += d));
  const terminado = new Promise((resolve) => {
    hijo.on("close", (status) => resolve({ status, stdout, stderr, salida: stdout + stderr }));
  });
  return { hijo, terminado };
}

export async function filasSchemaRepetibles(cliente) {
  const { rows } = await cliente.query(
    "select nombre, hash, aplicada_en from schema_repetibles order by nombre"
  );
  return rows;
}

/** Mapa nombre -> {hash, aplicada_en} para comparar corridas. */
export async function estadoRepetibles(cliente) {
  const filas = await filasSchemaRepetibles(cliente);
  return new Map(filas.map((f) => [f.nombre, { hash: f.hash, en: f.aplicada_en.getTime() }]));
}

/** Cuerpo desplegado en la base, tal como lo guardo PostgreSQL. */
export async function prosrcDe(cliente, nombreFuncion) {
  const { rows } = await cliente.query("select prosrc from pg_proc where proname = $1", [
    nombreFuncion,
  ]);
  return rows.length ? rows[0].prosrc : null;
}

export async function existeFuncion(cliente, nombreFuncion) {
  const { rows } = await cliente.query("select count(*)::int as n from pg_proc where proname = $1", [
    nombreFuncion,
  ]);
  return rows[0].n > 0;
}

/** Todas las relaciones del esquema public (tablas, vistas, secuencias). */
export async function relacionesPublic(cliente) {
  const { rows } = await cliente.query(`
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m','S','p')
    order by c.relname
  `);
  return rows.map((r) => r.relname);
}

export { cpSync };
