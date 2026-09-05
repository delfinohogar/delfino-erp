// Migrador de esquema de Delfino ERP.
//
//   node backend/src/db/migrar.js              aplica las migraciones pendientes
//   node backend/src/db/migrar.js --estado     solo informa que hay aplicado y que falta
//   node backend/src/db/migrar.js --marcar-aplicadas
//                                              marca las pendientes como aplicadas SIN correrlas
//                                              (baseline explicito; ver backend/README.md)
//
// Dos clases de migracion:
//   - NUMERADAS, backend/db/migrations/*.sql: se aplican UNA vez, en orden alfabetico, y quedan
//     registradas en schema_migrations. Una vez aplicadas no se editan nunca.
//   - REPETIBLES, backend/db/functions/*.sql: definiciones que se reemplazan enteras
//     (CREATE OR REPLACE FUNCTION y companina). Se aplican SIEMPRE DESPUES de las numeradas y
//     se REAPLICAN solo cuando cambia el hash del archivo. Se registran en schema_repetibles.
//     Es el patron que Flyway llama R__; cierra R28 (tres copias de crear_venta() a mano).
//
// Garantias:
//   - orden alfabetico de los archivos .sql, en las dos clases;
//   - cada migracion corre dentro de su propia transaccion, y el registro (INSERT en
//     schema_migrations, UPSERT en schema_repetibles) va en ESA MISMA transaccion: si la
//     migracion falla, se revierte entera y NO queda marcada como aplicada. Vale igual para
//     las repetibles: una repetible que falla no se registra y el reintento la vuelve a intentar;
//   - un pg_advisory_lock de sesion serializa dos corridas simultaneas —numeradas y repetibles
//     corren bajo el MISMO lock—, asi que la misma migracion no se aplica dos veces;
//   - es idempotente: correrlo de nuevo no reaplica nada y sale con codigo 0;
//   - los argumentos se validan antes de conectarse a la base: un flag desconocido o mal
//     tipeado aborta con exit != 0 y NO aplica nada (R14);
//   - --marcar-aplicadas MIRA LA BASE antes de baselinear repetibles, y FALLA si lo que
//     declara un archivo no esta desplegado. Ver el bloque de abajo (R37).
//
// --- POR QUE --marcar-aplicadas MIRA LA BASE (R37) ---------------------------------------
// schema_repetibles DECLARA el estado de la base; no lo OBSERVA. Con esa sola tabla, dos
// caminos distintos llegan al mismo estado incoherente —fila al dia, funcion ausente, y el
// migrador informando "Repetibles: sin cambios"—: un --marcar-aplicadas sobre una base donde
// la funcion no esta, y un DROP FUNCTION a mano despues de haberla aplicado.
// Con una migracion numerada un baseline mal hecho revienta enseguida: la tabla no esta y todo
// falla. Con una repetible NO revienta nada: la base se queda con crear_venta() vieja, o sin
// ella, y nadie se entera. Gaston lo cerro asi, textual: "un crear_venta() equivocado corriendo
// en silencio no aparece en un test, aparece en una venta". Por eso --marcar-aplicadas no
// avisa: FALLA, con exit != 0 y sin escribir NADA —ni numeradas ni repetibles—.
// El chequeo consulta pg_proc, o sea la base, y recorre TODAS las repetibles en disco, no solo
// las pendientes: asi el DROP FUNCTION a mano —que deja la fila al dia y por lo tanto no
// pendiente— queda cubierto por el mismo control.
//
// Requisito de las migraciones: tienen que poder correr dentro de una transaccion
// (nada de CREATE INDEX CONCURRENTLY ni VACUUM).
//
// --- QUE SE HASHEA, Y POR QUE (R32/R33) --------------------------------------------------
// El hash de una repetible se calcula sobre el contenido NORMALIZADO A LF, no sobre el byte
// crudo del archivo. Y lo que se le manda a PostgreSQL es ese mismo texto normalizado.
// El motivo es concreto y ya nos mordio: el repositorio no tiene .gitattributes y en Windows
// core.autocrlf deja los .sql del arbol de trabajo en CRLF (`git ls-files --eol` da
// `i/lf w/crlf`). Si hasheáramos el byte crudo, un `git checkout` o un clon en otra plataforma
// —que no cambian una sola letra del SQL— cambiarian el hash de TODAS las funciones y
// dispararian una reaplicacion espuria. Con LF, el hash depende del contenido y de nada mas.
// Normalizar tambien lo que se ejecuta cierra la otra mitad (R33): pg_get_functiondef()
// devuelve el cuerpo tal cual se lo mandaron, asi que si desplegaramos CRLF, lo que corre en
// la base dependeria del checkout de quien migro, y comparar base contra archivo daria false.
// Desplegando LF, los dos lados hablan el mismo idioma.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { crearPool } from "./pool.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
export const DIR_MIGRACIONES = join(AQUI, "..", "..", "db", "migrations");
export const DIR_REPETIBLES = join(AQUI, "..", "..", "db", "functions");

// Clave arbitraria pero fija del lock de sesion. Cualquier proceso que migre esta base usa
// esta misma clave; nadie mas la usa.
const CLAVE_LOCK = 5150419;

const SQL_TABLA = `
  create table if not exists schema_migrations (
    nombre      text primary key,
    aplicada_en timestamptz not null default now()
  )
`;

// Tabla propia, y no una marca dentro de schema_migrations, por dos razones: schema_migrations
// es historia de lo aplicado una sola vez y no pierde ni gana filas por esto, y las repetibles
// necesitan una columna (hash) que las numeradas no tienen.
const SQL_TABLA_REPETIBLES = `
  create table if not exists schema_repetibles (
    nombre      text primary key,
    hash        text not null,
    aplicada_en timestamptz not null default now()
  )
`;

/** Los flags que el migrador acepta. Cualquier otra cosa aborta: ver interpretarArgumentos. */
export const FLAGS_VALIDOS = ["--estado", "--marcar-aplicadas"];

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

/**
 * Nombres de los archivos .sql de repetibles, en orden alfabetico.
 * El directorio puede no existir o estar vacio: eso no es un error, es el estado de hoy.
 */
export function repetiblesEnDisco(dir = DIR_REPETIBLES) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".sql"))
    .sort();
}

/** Contenido a LF. Ver el bloque "QUE SE HASHEA" del encabezado (R32/R33). */
export function normalizarFinDeLinea(texto) {
  return texto.replace(/\r\n/g, "\n");
}

/** Lee una repetible ya normalizada, con su hash. El hash es del texto normalizado. */
export function leerRepetible(dir, archivo) {
  const sql = normalizarFinDeLinea(readFileSync(join(dir, archivo), "utf8"));
  return { sql, hash: createHash("sha256").update(sql, "utf8").digest("hex") };
}

/** Lo registrado en schema_repetibles, como Map nombre -> hash. */
export async function repetiblesAplicadas(cliente) {
  const { rows } = await cliente.query("select nombre, hash from schema_repetibles");
  return new Map(rows.map((r) => [r.nombre, r.hash]));
}

/**
 * Repetibles que hay que (re)aplicar: las que no estan registradas y las que cambiaron de hash.
 * @returns {Array<{archivo: string, sql: string, hash: string, motivo: "nueva"|"cambiada"}>}
 */
export function repetiblesPendientes(registradas, dir = DIR_REPETIBLES) {
  const pendientes = [];
  for (const archivo of repetiblesEnDisco(dir)) {
    const { sql, hash } = leerRepetible(dir, archivo);
    const anterior = registradas.get(archivo);
    if (anterior === hash) continue;
    pendientes.push({ archivo, sql, hash, motivo: anterior === undefined ? "nueva" : "cambiada" });
  }
  return pendientes;
}

// --- Observar la base, no la tabla de control (R37) ---------------------------------------

/**
 * Busca donde cierra el parentesis abierto en `desde`, salteando lo que este entre comillas
 * simples (un DEFAULT puede traer un parentesis adentro de un literal).
 */
function cierreDeParentesis(sql, desde) {
  let nivel = 1;
  let enLiteral = false;
  for (let i = desde; i < sql.length; i++) {
    const ch = sql[i];
    if (enLiteral) {
      if (ch === "'") {
        if (sql[i + 1] === "'") i++;
        else enLiteral = false;
      }
      continue;
    }
    if (ch === "'") enLiteral = true;
    else if (ch === "(") nivel++;
    else if (ch === ")" && --nivel === 0) return i;
  }
  return -1;
}

/** Cuenta los argumentos de una lista de parametros: comas de nivel 0, fuera de literales. */
function contarArgumentos(lista) {
  const texto = lista.trim();
  if (!texto) return 0;
  let cantidad = 1;
  let nivel = 0;
  let enLiteral = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (enLiteral) {
      if (ch === "'") {
        if (texto[i + 1] === "'") i++;
        else enLiteral = false;
      }
      continue;
    }
    if (ch === "'") enLiteral = true;
    else if (ch === "(" || ch === "[") nivel++;
    else if (ch === ")" || ch === "]") nivel--;
    else if (ch === "," && nivel === 0) cantidad++;
  }
  return cantidad;
}

// Solo se reconocen declaraciones que EMPIEZAN una linea: asi una mencion dentro de un
// comentario `--` o de una linea de texto no cuenta como declaracion.
const RE_DECLARACION = /^[ \t]*create\s+(?:or\s+replace\s+)?function\s+(?:"?[\w$]+"?\s*\.\s*)?"?([\w$]+)"?\s*\(/gim;

/**
 * Funciones que DECLARA una repetible: nombre y cantidad de argumentos de entrada.
 * No se interpretan los tipos a proposito —"double precision", arrays, typmods— porque
 * equivocarse ahi daria un falso positivo; el nombre y la aridad alcanzan para detectar las
 * dos formas de ausencia que describe R37.
 * Limitacion conocida y aceptada: una funcion con parametros OUT cuenta distinto que
 * pg_proc.pronargs. Ninguna funcion del dominio los usa; si alguna los usara, el chequeo daria
 * un error explicito y legible, no un silencio.
 * @returns {Array<{nombre: string, argumentos: number}>}
 */
export function funcionesDeclaradas(sql) {
  const encontradas = [];
  RE_DECLARACION.lastIndex = 0;
  let m;
  while ((m = RE_DECLARACION.exec(sql)) !== null) {
    const abre = m.index + m[0].length;
    const cierra = cierreDeParentesis(sql, abre);
    if (cierra === -1) continue;
    encontradas.push({
      nombre: m[1].toLowerCase(),
      argumentos: contarArgumentos(sql.slice(abre, cierra)),
    });
  }
  return encontradas;
}

/**
 * Lo que los archivos de repetibles declaran y la BASE no tiene. Consulta pg_proc: es la
 * unica fuente que dice lo que realmente esta desplegado.
 * Recorre TODAS las repetibles en disco, no solo las pendientes (ver R37 en el encabezado).
 * @returns {Promise<Array<{archivo: string, nombre: string, argumentos: number, candidatas: number}>>}
 */
export async function repetiblesNoDesplegadas(cliente, { dir = DIR_REPETIBLES } = {}) {
  const faltantes = [];
  for (const archivo of repetiblesEnDisco(dir)) {
    const { sql } = leerRepetible(dir, archivo);
    for (const { nombre, argumentos } of funcionesDeclaradas(sql)) {
      const { rows } = await cliente.query(
        `select coalesce(bool_or(p.pronargs = $2), false) as esta,
                count(*)::int                             as candidatas
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where p.proname = $1 and n.nspname not in ('pg_catalog', 'information_schema')`,
        [nombre, argumentos]
      );
      if (!rows[0].esta) {
        faltantes.push({ archivo, nombre, argumentos, candidatas: rows[0].candidatas });
      }
    }
  }
  return faltantes;
}

/**
 * Corta el baseline si alguna repetible declara algo que la base no tiene. Se llama ANTES de
 * escribir una sola fila, para que el aborto no deje nada marcado a medias.
 */
export async function verificarRepetiblesDesplegadas(cliente, { dir = DIR_REPETIBLES } = {}) {
  const faltantes = await repetiblesNoDesplegadas(cliente, { dir });
  if (!faltantes.length) return;
  const detalle = faltantes.map(({ archivo, nombre, argumentos, candidatas }) =>
    candidatas === 0
      ? `  ${archivo} declara ${nombre}(${argumentos} argumento(s)) y en la base NO existe.`
      : `  ${archivo} declara ${nombre}(${argumentos} argumento(s)); la base tiene ${candidatas} funcion(es) con ese nombre, ninguna con esa cantidad de argumentos.`
  );
  throw new Error(
    [
      "--marcar-aplicadas ABORTADO: hay repetibles que NO estan desplegadas en la base.",
      "No se marco NADA: ni migraciones numeradas ni repetibles.",
      "",
      ...detalle,
      "",
      "--marcar-aplicadas afirma que la base YA esta en el estado de los archivos. Si eso no",
      "es cierto para una funcion, la base se queda con la version vieja —o sin la funcion—",
      "mientras el migrador jura estar al dia, y nada vuelve a avisar (R37).",
      "Que hacer: correr el migrador SIN flags para desplegarlas de verdad, y recien despues",
      "baselinear si todavia hace falta.",
    ].join("\n")
  );
}

function detallarError(err, archivo, clase = "migracion") {
  const partes = [`La ${clase} ${archivo} fallo y se revirtio (ROLLBACK).`, `  ${err.message}`];
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

/**
 * Aplica las repetibles cuyo hash cambio (o que nunca se aplicaron), SIEMPRE despues de las
 * numeradas y sobre el mismo cliente, es decir bajo el mismo pg_advisory_lock.
 *
 * Cada archivo va en su propia transaccion junto con su UPSERT en schema_repetibles: si el SQL
 * falla, el UPSERT se va con el ROLLBACK, no queda registrado y no deja efectos. La corrida
 * siguiente lo vuelve a intentar, porque el hash sigue sin coincidir.
 *
 * @returns {Promise<string[]>} nombres de las repetibles aplicadas en esta corrida
 */
export async function aplicarRepetibles(cliente, { dir = DIR_REPETIBLES, log = () => {} } = {}) {
  await cliente.query(SQL_TABLA_REPETIBLES);
  const pendientes = repetiblesPendientes(await repetiblesAplicadas(cliente), dir);

  const hechas = [];
  for (const { archivo, sql, hash, motivo } of pendientes) {
    try {
      await cliente.query("begin");
      await cliente.query(sql);
      await cliente.query(
        `insert into schema_repetibles(nombre, hash) values ($1, $2)
         on conflict (nombre) do update set hash = excluded.hash, aplicada_en = now()`,
        [archivo, hash]
      );
      await cliente.query("commit");
    } catch (err) {
      await cliente.query("rollback").catch(() => {});
      throw detallarError(err, archivo, "repetible");
    }
    hechas.push(archivo);
    log(`  repetible ${motivo === "nueva" ? "aplicada" : "reaplicada"}  ${archivo}`);
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

/**
 * Baseline explicito de las repetibles: registra nombre y hash SIN ejecutar el SQL.
 * Va junto con el de las numeradas, por coherencia: si el operador declara que la base ya esta
 * en el estado de los archivos, tambien lo esta el de las funciones.
 *
 * OJO: esta funcion no verifica nada; solo escribe. El control de R37 —que lo declarado este
 * de verdad desplegado— lo hace verificarRepetiblesDesplegadas(), que principal() llama ANTES
 * de marcar cualquier cosa, para que un aborto no deje el baseline hecho a medias.
 */
export async function marcarRepetiblesComoAplicadas(cliente, { dir = DIR_REPETIBLES, log = () => {} } = {}) {
  await cliente.query(SQL_TABLA_REPETIBLES);
  const pendientes = repetiblesPendientes(await repetiblesAplicadas(cliente), dir);
  if (!pendientes.length) return [];
  try {
    await cliente.query("begin");
    for (const { archivo, hash } of pendientes) {
      await cliente.query(
        `insert into schema_repetibles(nombre, hash) values ($1, $2)
         on conflict (nombre) do update set hash = excluded.hash, aplicada_en = now()`,
        [archivo, hash]
      );
      log(`  repetible marcada SIN correr  ${archivo}`);
    }
    await cliente.query("commit");
  } catch (err) {
    await cliente.query("rollback").catch(() => {});
    throw err;
  }
  return pendientes.map((p) => p.archivo);
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

const AYUDA = [
  "Flags validos (el string exacto, sin abreviaturas):",
  "  (sin flags)          aplica las migraciones pendientes y las repetibles que cambiaron",
  "  --estado             solo informa que hay aplicado y que falta",
  "  --marcar-aplicadas   baseline explicito: registra las pendientes SIN ejecutarlas.",
  "                       Falla si una repetible declara algo que la base no tiene (R37).",
];

/**
 * Valida los argumentos ANTES de tocar la base. Un flag desconocido o mal tipeado
 * —`--estad`, `--marcar-aplicada`— aborta: nunca cae en el modo que aplica migraciones (R14).
 * @returns {{soloEstado: boolean, baseline: boolean}}
 */
export function interpretarArgumentos(argv = []) {
  const desconocidos = argv.filter((a) => !FLAGS_VALIDOS.includes(a));
  if (desconocidos.length) {
    throw new Error(
      [
        `Argumento${desconocidos.length > 1 ? "s" : ""} desconocido${desconocidos.length > 1 ? "s" : ""}: ${desconocidos.join(" ")}`,
        "No se aplico ninguna migracion: el migrador aborta antes de conectarse a la base.",
        ...AYUDA,
      ].join("\n")
    );
  }
  const soloEstado = argv.includes("--estado");
  const baseline = argv.includes("--marcar-aplicadas");
  if (soloEstado && baseline) {
    throw new Error(
      [
        "--estado y --marcar-aplicadas son incompatibles: uno solo informa y el otro escribe.",
        "No se aplico ninguna migracion.",
        ...AYUDA,
      ].join("\n")
    );
  }
  return { soloEstado, baseline };
}

export async function principal(argv = process.argv.slice(2), log = console.log) {
  const { soloEstado, baseline } = interpretarArgumentos(argv);
  const pool = crearPool({ max: 1 });
  const cliente = await pool.connect();
  try {
    await conLock(
      cliente,
      async () => {
        if (soloEstado) {
          // Crea las dos tablas de control si no existen, y nada mas: no ejecuta ninguna
          // migracion. Es lo que backend/README.md declara, textualmente.
          await cliente.query(SQL_TABLA);
          await cliente.query(SQL_TABLA_REPETIBLES);
          const aplicadas = new Set(await migracionesAplicadas(cliente));
          for (const archivo of migracionesEnDisco()) {
            log(`  ${aplicadas.has(archivo) ? "aplicada " : "PENDIENTE"}  ${archivo}`);
          }
          const sobrantes = [...aplicadas].filter((n) => !migracionesEnDisco().includes(n));
          for (const archivo of sobrantes) log(`  registrada pero NO esta en disco: ${archivo}`);

          const registradas = await repetiblesAplicadas(cliente);
          for (const archivo of repetiblesEnDisco()) {
            const { hash } = leerRepetible(DIR_REPETIBLES, archivo);
            const anterior = registradas.get(archivo);
            const estado =
              anterior === hash ? "al dia   " : anterior === undefined ? "PENDIENTE" : "CAMBIADA ";
            log(`  repetible ${estado}  ${archivo}`);
          }
          const repSobrantes = [...registradas.keys()].filter(
            (n) => !repetiblesEnDisco().includes(n)
          );
          for (const archivo of repSobrantes) {
            log(`  repetible registrada pero NO esta en disco: ${archivo}`);
          }
          return;
        }
        if (baseline) {
          log("BASELINE EXPLICITO: se marcan como aplicadas sin ejecutarlas.");
          // Primero se MIRA la base (R37). Si algo de lo que se va a declarar como aplicado no
          // esta desplegado, esto lanza y la corrida termina con exit != 0 sin escribir nada.
          await verificarRepetiblesDesplegadas(cliente);
          const marcadas = await marcarPendientesComoAplicadas(cliente, { log });
          log(marcadas.length ? `Marcadas ${marcadas.length}.` : "No habia pendientes.");
          const marcadasRep = await marcarRepetiblesComoAplicadas(cliente, { log });
          log(
            marcadasRep.length
              ? `Repetibles marcadas SIN correr: ${marcadasRep.length}.`
              : "Repetibles: sin cambios."
          );
          return;
        }
        const hechas = await aplicarPendientes(cliente, { log });
        log(hechas.length ? `Listo: ${hechas.length} migracion(es) aplicada(s).` : "Sin migraciones pendientes.");
        // Siempre DESPUES de las numeradas, y sobre el mismo cliente: mismo advisory lock.
        const repetidas = await aplicarRepetibles(cliente, { log });
        log(
          repetidas.length
            ? `Repetibles: ${repetidas.length} aplicada(s).`
            : "Repetibles: sin cambios."
        );
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
