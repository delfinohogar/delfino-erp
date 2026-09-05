// TASK-012 — validacion de flags (R14) y migraciones repetibles (R28) del migrador.
//
// Que se verifica aca, y por que importa: TASK-018 muda `crear_venta()` a este mecanismo, asi
// que a partir de esa tarea TODA la logica de dominio se despliega por aca. Si una repetible
// que falla quedara registrada, la base se quedaria con una funcion vieja mientras el migrador
// jura que esta al dia; si el hash dependiera del final de linea, un `git checkout` en otra
// maquina reaplicaria todo el dominio sin que cambie una letra del SQL.
//
// Criterios cubiertos (TASK-012 accept):
//   - repetibles: se aplican DESPUES de las numeradas y solo se reaplican si cambia el hash;
//   - una repetible que falla NO queda registrada, NO deja efectos y se reintenta;
//   - dos corridas seguidas sin cambios no reaplican nada;
//   - cambiar un byte reaplica SOLO ese archivo;
//   - mismo pg_advisory_lock que las numeradas: en paralelo se aplican una sola vez;
//   - db/repetibles/ puede no existir o estar vacio;
//   - un argumento desconocido aborta con exit != 0, lista los validos y no crea NI UNA tabla;
//   - --estado crea las dos tablas de control vacias y nada mas (lo que dice el README).
//
// Metodo (R20): las dos propiedades centrales —la transaccional y la del hash/CRLF— se
// verifican POR MUTACION. Cada una tiene un test gemelo que corre el mismo escenario contra una
// copia del migrador con el mecanismo roto y exige que el resultado sea distinto. Un test que no
// puede fallar no prueba nada.
//
// Aislamiento: base temporal propia por test (delfino_test_mig_*), destruida al final;
// delfino_test se usa solo como base administrativa. El migrador bajo prueba es una COPIA
// desechable en tests/.tmp-migrador/ (ver _repetibles_helpers.mjs): el tester no escribe en
// backend/, y las repetibles de estos tests son SQL inventado, no el dominio.
//
// Actualizado en TASK-018 por dos cambios deliberados, ninguno un bug del implementador:
//   1) el directorio de repetibles pasa de backend/db/functions/ a backend/db/repetibles/
//      (decision de Gaston, 2026-09-05; ver R39). La copia del migrador lo DERIVA de
//      DIR_REPETIBLES en vez de escribirlo a mano, asi un proximo renombre no deja estos tests
//      probando en silencio el caso "no hay repetibles";
//   2) --marcar-aplicadas ahora FALLA si lo que baselinea no esta desplegado (R37). El test de
//      MIGRADOR_REPETIBLES_CONVENCIONES afirmaba la convencion CONTRARIA —baseline en silencio,
//      funcion ausente, "Repetibles: sin cambios"—; esa convencion ya no rige y el test pasa a
//      afirmar lo nuevo, con el mutante que demuestra que discrimina.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { basename } from "node:path";

import {
  DIR_REPETIBLES,
  leerRepetible,
  normalizarFinDeLinea,
} from "../../../backend/src/db/migrar.js";
import {
  ADMIN_URL,
  baseDeUrl,
  borrarBase,
  borrarBasesTemporalesHuerfanas,
  clienteDe,
  correrMigrador,
  crearBaseTemporal,
  entorno,
  existeRelacion,
} from "./_migrador_helpers.mjs";
import {
  correrCopia,
  crearCopiaBackend,
  estadoRepetibles,
  existeFuncion,
  filasSchemaRepetibles,
  lanzarCopia,
  limpiarDirTrabajo,
  NOMBRE_DIR_REPETIBLES,
  prosrcDe,
  relacionesPublic,
} from "./_repetibles_helpers.mjs";

// --- Fixtures SQL ------------------------------------------------------------------------

const MIG_BASE = [["0001_base.sql", "create table repet_base (id int primary key, nota text);"]];

// Cuerpo multilinea a proposito: si el migrador desplegara CRLF, prosrc lo mostraria.
const SALUDO = (texto) => `create or replace function repet_saludo() returns text
language sql
as $fn$
  select '${texto}'::text
$fn$;
`;

const FUNCION = (nombre, valor) => `create or replace function ${nombre}() returns int
language sql
as $fn$
  select ${valor}
$fn$;
`;

// Primera sentencia valida, segunda invalida. El cuerpo no lleva ";" adentro a proposito: el
// mutante "sin transaccion" parte el archivo por ";" y tiene que quedar con SQL valido, para que
// el rojo venga de la falta de transaccion y no de un split que rompe el archivo.
const REPETIBLE_ROTA = `create or replace function repet_parcial() returns int
language sql
as $fn$
  select 1
$fn$;
select 1/0;
`;
const REPETIBLE_ARREGLADA = `create or replace function repet_parcial() returns int
language sql
as $fn$
  select 1
$fn$;
`;

// --- Mutaciones (R20) --------------------------------------------------------------------

const BLOQUE_TRANSACCIONAL = `      await cliente.query("begin");
      await cliente.query(sql);
      await cliente.query(
        \`insert into schema_repetibles(nombre, hash) values ($1, $2)
         on conflict (nombre) do update set hash = excluded.hash, aplicada_en = now()\`,
        [archivo, hash]
      );
      await cliente.query("commit");`;

/** MUTANTE 1: el UPSERT sale de la transaccion y se hace ANTES, en autocommit. */
const MUT_UPSERT_FUERA = [
  BLOQUE_TRANSACCIONAL,
  `      await cliente.query(
        \`insert into schema_repetibles(nombre, hash) values ($1, $2)
         on conflict (nombre) do update set hash = excluded.hash, aplicada_en = now()\`,
        [archivo, hash]
      );
      await cliente.query("begin");
      await cliente.query(sql);
      await cliente.query("commit");`,
];

/** MUTANTE 2: no hay transaccion propia; cada sentencia va suelta y el upsert despues. */
const MUT_SIN_TRANSACCION = [
  BLOQUE_TRANSACCIONAL,
  `      for (const sentencia of sql.split(";")) {
        if (sentencia.trim()) await cliente.query(sentencia);
      }
      await cliente.query(
        \`insert into schema_repetibles(nombre, hash) values ($1, $2)
         on conflict (nombre) do update set hash = excluded.hash, aplicada_en = now()\`,
        [archivo, hash]
      );`,
];

/** MUTANTE 3: el hash y lo desplegado usan el byte crudo, sin normalizar a LF. */
const MUT_SIN_NORMALIZAR = [
  `export function normalizarFinDeLinea(texto) {
  return texto.replace(/\\r\\n/g, "\\n");
}`,
  `export function normalizarFinDeLinea(texto) {
  return texto;
}`,
];

/**
 * MUTANTE 4 (R37): al chequeo previo de --marcar-aplicadas se le saca la consulta a pg_proc y
 * pasa a creerle a la tabla de control. Es exactamente la convencion VIEJA, la que este mutante
 * existe para demostrar que ya no rige: sin mirar la base, el baseline no tiene como saber que
 * la funcion no esta desplegada y la marca igual.
 */
const MUT_R37_SIN_MIRAR_LA_BASE = [
  `      const { rows } = await cliente.query(
        \`select coalesce(bool_or(p.pronargs = $2), false) as esta,
                count(*)::int                             as candidatas
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where p.proname = $1 and n.nspname not in ('pg_catalog', 'information_schema')\`,
        [nombre, argumentos]
      );`,
  `      const rows = [{ esta: true, candidatas: 1 }];`,
];

// --- Andamiaje ---------------------------------------------------------------------------

const basesCreadas = new Set();
const copiasCreadas = new Set();

async function baseLimpia(sufijo) {
  const { nombre, url } = await crearBaseTemporal(sufijo);
  basesCreadas.add(nombre);
  return { nombre, url };
}

function copia(opciones) {
  const c = crearCopiaBackend(opciones);
  copiasCreadas.add(c);
  return c;
}

async function cerrar(cliente, nombre) {
  await cliente.end().catch(() => {});
  await borrarBase(nombre).catch(() => {});
  basesCreadas.delete(nombre);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Las propiedades bajo prueba, como funciones ------------------------------------------
// Se escriben una sola vez y las usan EL TEST REAL y EL MUTANTE. Asi el rojo del mutante es
// exactamente el mismo chequeo que el verde del original, y no uno parecido escrito a mano.
// Devuelven la lista de violaciones: vacia = propiedad cumplida.

/** TASK-012: una repetible que falla no queda registrada y no deja efectos. */
async function violacionesAtomicidad(cli, corrida) {
  const problemas = [];
  if (corrida.status === 0) problemas.push("el migrador salio 0 pese a que la repetible fallo");
  const filas = await filasSchemaRepetibles(cli);
  if (filas.some((f) => f.nombre === "b_rompe.sql")) {
    problemas.push("b_rompe.sql quedo REGISTRADA en schema_repetibles pese a fallar");
  }
  if (await existeFuncion(cli, "repet_parcial")) {
    problemas.push("repet_parcial() quedo CREADA: la repetible que fallo dejo efectos");
  }
  return problemas;
}

/** TASK-012: el reintento la vuelve a intentar, no la da por buena. */
function violacionesReintento(corrida) {
  const problemas = [];
  if (corrida.status === 0) {
    problemas.push("el reintento salio 0: dio por aplicada una repetible que nunca corrio");
  }
  if (corrida.salida.includes("Repetibles: sin cambios")) {
    problemas.push("el reintento informo 'Repetibles: sin cambios': no la volvio a intentar");
  }
  return problemas;
}

/** R32/R33: cambiar LF por CRLF (o al reves) no reaplica, y lo desplegado no lleva \r. */
async function violacionesCrlf(cli, { antes, despues, salida }) {
  const problemas = [];
  if (despues.get("saludo.sql").hash !== antes.get("saludo.sql").hash) {
    problemas.push("el hash cambio sin que cambiara una letra del SQL: reaplicacion espuria");
  }
  if (despues.get("saludo.sql").en !== antes.get("saludo.sql").en) {
    problemas.push("aplicada_en se reescribio: la repetible se reaplico");
  }
  if (lineasReaplicada(salida).length > 0) {
    problemas.push("el migrador informo una reaplicacion");
  }
  if (/\r/.test(await prosrcDe(cli, "repet_saludo"))) {
    problemas.push("lo desplegado en prosrc tiene \\r: la base depende del checkout");
  }
  return problemas;
}
/**
 * R37 (TASK-018): --marcar-aplicadas MIRA la base antes de escribir y FALLA si una repetible
 * declara algo que no esta desplegado. Falla: no avisa. Y no escribe NADA, ni numeradas ni
 * repetibles, para que el aborto no deje un baseline hecho a medias.
 */
async function violacionesR37(cli, corrida) {
  const problemas = [];
  if (corrida.status === 0) {
    problemas.push("--marcar-aplicadas salio 0 pese a que repet_a() no esta desplegada");
  }
  if (!/ABORTADO/i.test(corrida.salida)) {
    problemas.push("la salida no dice que el baseline se aborto");
  }
  for (const tabla of ["schema_migrations", "schema_repetibles"]) {
    if (!(await existeRelacion(cli, tabla))) continue;
    const { rows } = await cli.query(`select count(*)::int as n from ${tabla}`);
    if (rows[0].n > 0) problemas.push(`${tabla} quedo con ${rows[0].n} fila(s): el baseline escribio`);
  }
  return problemas;
}

/**
 * El estado incoherente que R37 vino a impedir: fila al dia en schema_repetibles, funcion
 * ausente en la base, y la corrida siguiente informando "Repetibles: sin cambios".
 */
async function llegoAlEstadoIncoherente(cli, segunda) {
  const registradas = (await filasSchemaRepetibles(cli)).map((f) => f.nombre);
  return (
    registradas.includes("a.sql") &&
    !(await existeFuncion(cli, "repet_a")) &&
    segunda.salida.includes("Repetibles: sin cambios")
  );
}

const lineasAplicada = (salida) =>
  salida.split(/\r?\n/).filter((l) => /^\s*repetible aplicada\s+\S+\.sql\s*$/.test(l));
const lineasReaplicada = (salida) =>
  salida.split(/\r?\n/).filter((l) => /^\s*repetible reaplicada\s+\S+\.sql\s*$/.test(l));

beforeAll(async () => {
  expect(baseDeUrl(ADMIN_URL)).not.toBe("delfino_dev");
  limpiarDirTrabajo();
  await borrarBasesTemporalesHuerfanas();
});

afterAll(async () => {
  for (const nombre of basesCreadas) await borrarBase(nombre).catch(() => {});
  await borrarBasesTemporalesHuerfanas().catch(() => {});
  for (const c of copiasCreadas) c.limpiar();
  limpiarDirTrabajo();
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_ATOMICIDAD", () => {
  it("una repetible que falla no se registra, no deja efectos y las posteriores no se aplican", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["a_ok.sql", FUNCION("repet_ok", 1)],
        ["b_rompe.sql", REPETIBLE_ROTA],
        ["c_posterior.sql", FUNCION("repet_posterior", 3)],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_atom1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], env);
      expect(r.status, r.salida).not.toBe(0);
      expect(r.salida).toContain("b_rompe.sql");
      expect(r.salida).toMatch(/ROLLBACK|revirtio/i);
      expect(r.salida).toMatch(/repetible/i);

      // 1 y 2) NO queda registrada y NO deja efectos. Mismo chequeo que usan los mutantes.
      expect(await violacionesAtomicidad(cli, r)).toEqual([]);
      const filas = await filasSchemaRepetibles(cli);
      expect(filas.map((f) => f.nombre)).toEqual(["a_ok.sql"]);

      // 3) la anterior si quedo aplicada, con efecto
      expect(await existeFuncion(cli, "repet_ok")).toBe(true);

      // 4) la posterior no se aplico ni se registro
      expect(await existeFuncion(cli, "repet_posterior")).toBe(false);

      // 5) las numeradas si quedaron: las repetibles corren despues y su fallo no las toca
      expect(await existeRelacion(cli, "repet_base")).toBe(true);
      const { rows: num } = await cli.query("select nombre from schema_migrations");
      expect(num.map((f) => f.nombre)).toEqual(["0001_base.sql"]);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("el reintento la vuelve a intentar: falla igual sin cambiarla, y se aplica al corregirla", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["a_ok.sql", FUNCION("repet_ok", 1)],
        ["b_rompe.sql", REPETIBLE_ROTA],
        ["c_posterior.sql", FUNCION("repet_posterior", 3)],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_atom2");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).not.toBe(0);
      const antes = await estadoRepetibles(cli);
      await esperar(20);

      // Segunda corrida con el MISMO archivo roto: la vuelve a intentar y vuelve a fallar.
      // Es la prueba de que no quedo marcada como aplicada: si lo estuviera, saldria 0.
      const segunda = correrCopia(c, [], env);
      expect(violacionesReintento(segunda)).toEqual([]);
      expect(segunda.salida).toContain("b_rompe.sql");
      expect((await filasSchemaRepetibles(cli)).map((f) => f.nombre)).toEqual(["a_ok.sql"]);
      // Y a_ok, que ya estaba al dia, no se reaplico.
      expect((await estadoRepetibles(cli)).get("a_ok.sql").en).toBe(antes.get("a_ok.sql").en);

      // Corregida, la corrida siguiente la aplica junto con la posterior.
      c.escribirRepetible("b_rompe.sql", REPETIBLE_ARREGLADA);
      const tercera = correrCopia(c, [], env);
      expect(tercera.status, tercera.salida).toBe(0);
      expect((await filasSchemaRepetibles(cli)).map((f) => f.nombre)).toEqual([
        "a_ok.sql",
        "b_rompe.sql",
        "c_posterior.sql",
      ]);
      expect(await existeFuncion(cli, "repet_parcial")).toBe(true);
      expect(await existeFuncion(cli, "repet_posterior")).toBe(true);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("MUTACION R20: con el upsert FUERA de la transaccion, la repetible rota queda registrada y no se reintenta", async () => {
    // Mutante: el UPSERT se hace antes, en autocommit. El SQL sigue en su transaccion, asi que
    // el efecto se revierte igual; lo que se pierde es la ATOMICIDAD DEL REGISTRO.
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [["b_rompe.sql", REPETIBLE_ROTA]],
      mutaciones: [MUT_UPSERT_FUERA],
    });
    const { nombre, url } = await baseLimpia("rep_mut1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const primera = correrCopia(c, [], env);
      expect(primera.status, primera.salida).not.toBe(0);

      // EL MISMO chequeo que el test real exige vacio, aca da rojo:
      expect(await violacionesAtomicidad(cli, primera)).toEqual([
        "b_rompe.sql quedo REGISTRADA en schema_repetibles pese a fallar",
      ]);

      // Y el reintento la da por buena: sale 0 diciendo que no hay nada que hacer, con la
      // funcion sin desplegar. Es exactamente el escenario que el test real prohibe.
      const segunda = correrCopia(c, [], env);
      expect(violacionesReintento(segunda)).toEqual([
        "el reintento salio 0: dio por aplicada una repetible que nunca corrio",
        "el reintento informo 'Repetibles: sin cambios': no la volvio a intentar",
      ]);
      expect(await existeFuncion(cli, "repet_parcial")).toBe(false);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("MUTACION R20: sin transaccion propia, la repetible rota deja su efecto parcial en la base", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [["b_rompe.sql", REPETIBLE_ROTA]],
      mutaciones: [MUT_SIN_TRANSACCION],
    });
    const { nombre, url } = await baseLimpia("rep_mut2");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], env);
      expect(r.status, r.salida).not.toBe(0);
      // EL MISMO chequeo que el test real exige vacio, aca da rojo:
      expect(await violacionesAtomicidad(cli, r)).toEqual([
        "repet_parcial() quedo CREADA: la repetible que fallo dejo efectos",
      ]);
      // (y no quedo registrada, porque el upsert nunca se alcanzo: base incoherente)
      expect(await filasSchemaRepetibles(cli)).toEqual([]);
    } finally {
      await cerrar(cli, nombre);
    }
  });
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_HASH_CRLF", () => {
  it("el hash es del contenido normalizado a LF: LF y CRLF del mismo texto dan el mismo hash", () => {
    // Propiedad pura, sin base: es la que sostiene los dos tests siguientes.
    const c = copia({ migraciones: [], repetibles: [] });
    const texto = SALUDO("hola");
    c.escribirRepetible("saludo.sql", texto, { crlf: false });
    const lf = leerRepetible(c.dirRepetibles, "saludo.sql");
    c.escribirRepetible("saludo.sql", texto, { crlf: true });
    const crlf = leerRepetible(c.dirRepetibles, "saludo.sql");

    expect(c.bytesRepetible("saludo.sql").includes(0x0d)).toBe(true); // el archivo SI tiene CR
    expect(crlf.hash).toBe(lf.hash);
    expect(crlf.sql).toBe(lf.sql);
    expect(crlf.sql).not.toMatch(/\r/);
    expect(normalizarFinDeLinea("a\r\nb")).toBe("a\nb");
  });

  it("pasar una repetible de LF a CRLF NO la reaplica, y lo desplegado no tiene \\r", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["saludo.sql", SALUDO("hola")]] });
    const { nombre, url } = await baseLimpia("rep_crlf1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const primera = correrCopia(c, [], env);
      expect(primera.status, primera.salida).toBe(0);
      expect(lineasAplicada(primera.salida).length).toBe(1);
      const antes = await estadoRepetibles(cli);
      const prosrcAntes = await prosrcDe(cli, "repet_saludo");
      expect(prosrcAntes).not.toMatch(/\r/);

      await esperar(20);
      // Mismo texto, otro final de linea: es lo que hace un checkout en Windows.
      c.escribirRepetible("saludo.sql", SALUDO("hola"), { crlf: true });
      expect(c.bytesRepetible("saludo.sql").includes(0x0d)).toBe(true);

      const segunda = correrCopia(c, [], env);
      expect(segunda.status, segunda.salida).toBe(0);
      const despues = await estadoRepetibles(cli);
      // Mismo chequeo que usa el mutante MUT_SIN_NORMALIZAR:
      expect(
        await violacionesCrlf(cli, { antes, despues, salida: segunda.salida })
      ).toEqual([]);
      expect(segunda.salida).toContain("Repetibles: sin cambios");
      expect(lineasAplicada(segunda.salida).length).toBe(0);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("y al reves: de CRLF a LF tampoco reaplica, y lo desplegado sigue sin \\r", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [] });
    c.escribirRepetible("saludo.sql", SALUDO("hola"), { crlf: true });
    const { nombre, url } = await baseLimpia("rep_crlf2");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const primera = correrCopia(c, [], env);
      expect(primera.status, primera.salida).toBe(0);
      const antes = await estadoRepetibles(cli);
      // R33: aunque el archivo estaba en CRLF, lo que se desplego esta en LF.
      const prosrc = await prosrcDe(cli, "repet_saludo");
      expect(prosrc).not.toMatch(/\r/);
      expect(prosrc).toMatch(/select 'hola'::text/);
      const { rows: def } = await cli.query(
        "select pg_get_functiondef('repet_saludo'::regproc) as d"
      );
      expect(def[0].d).not.toMatch(/\r/);

      await esperar(20);
      c.escribirRepetible("saludo.sql", SALUDO("hola"), { crlf: false });
      expect(c.bytesRepetible("saludo.sql").includes(0x0d)).toBe(false);

      const segunda = correrCopia(c, [], env);
      expect(segunda.status, segunda.salida).toBe(0);
      expect(segunda.salida).toContain("Repetibles: sin cambios");
      const despues = await estadoRepetibles(cli);
      expect(
        await violacionesCrlf(cli, { antes, despues, salida: segunda.salida })
      ).toEqual([]);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("el hash sigue discriminando contenido: cambiar una letra si reaplica", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["saludo.sql", SALUDO("hola")]] });
    const { nombre, url } = await baseLimpia("rep_crlf3");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      const antes = await estadoRepetibles(cli);
      await esperar(20);
      // Cambio real, y encima en CRLF: tiene que reaplicar por CONTENIDO, no por final de linea.
      c.escribirRepetible("saludo.sql", SALUDO("chau"), { crlf: true });
      const r = correrCopia(c, [], env);
      expect(r.status, r.salida).toBe(0);
      expect(lineasReaplicada(r.salida).length).toBe(1);
      const despues = await estadoRepetibles(cli);
      expect(despues.get("saludo.sql").hash).not.toBe(antes.get("saludo.sql").hash);
      expect(despues.get("saludo.sql").en).toBeGreaterThan(antes.get("saludo.sql").en);
      const { rows } = await cli.query("select repet_saludo() as v");
      expect(rows[0].v).toBe("chau");
      expect(await prosrcDe(cli, "repet_saludo")).not.toMatch(/\r/);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("MUTACION R32/R33: sin normalizar, pasar de LF a CRLF reaplica y despliega \\r", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [["saludo.sql", SALUDO("hola")]],
      mutaciones: [MUT_SIN_NORMALIZAR],
    });
    const { nombre, url } = await baseLimpia("rep_mut3");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      const antes = await estadoRepetibles(cli);
      expect(await prosrcDe(cli, "repet_saludo")).not.toMatch(/\r/); // en LF todavia no se nota

      await esperar(20);
      c.escribirRepetible("saludo.sql", SALUDO("hola"), { crlf: true });
      const segunda = correrCopia(c, [], env);
      expect(segunda.status, segunda.salida).toBe(0);
      const despues = await estadoRepetibles(cli);

      // EL MISMO chequeo que el test real exige vacio, aca da rojo por los cuatro motivos:
      // reaplicacion espuria (hash, fecha y linea de log) y \r desplegado en la base.
      expect(await violacionesCrlf(cli, { antes, despues, salida: segunda.salida })).toEqual([
        "el hash cambio sin que cambiara una letra del SQL: reaplicacion espuria",
        "aplicada_en se reescribio: la repetible se reaplico",
        "el migrador informo una reaplicacion",
        "lo desplegado en prosrc tiene \\r: la base depende del checkout",
      ]);
    } finally {
      await cerrar(cli, nombre);
    }
  });
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_REAPLICACION", () => {
  it("dos corridas seguidas sin cambios no reaplican ninguna repetible", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["a.sql", FUNCION("repet_a", 1)],
        ["b.sql", FUNCION("repet_b", 2)],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_idem1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const primera = correrCopia(c, [], env);
      expect(primera.status, primera.salida).toBe(0);
      expect(primera.salida).toContain("Repetibles: 2 aplicada(s).");
      const antes = await estadoRepetibles(cli);
      await esperar(20);

      for (const vuelta of [2, 3]) {
        const r = correrCopia(c, [], env);
        expect(r.status, `vuelta ${vuelta}: ${r.salida}`).toBe(0);
        expect(r.salida).toContain("Repetibles: sin cambios");
        expect(lineasAplicada(r.salida).length).toBe(0);
        expect(lineasReaplicada(r.salida).length).toBe(0);
      }
      const despues = await estadoRepetibles(cli);
      expect([...despues.keys()].sort()).toEqual(["a.sql", "b.sql"]);
      for (const k of despues.keys()) {
        expect(despues.get(k).en).toBe(antes.get(k).en);
        expect(despues.get(k).hash).toBe(antes.get(k).hash);
      }
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("cambiar un byte de una repetible reaplica SOLO esa; las demas conservan su aplicada_en", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["a.sql", FUNCION("repet_a", 1)],
        ["b.sql", FUNCION("repet_b", 2)],
        ["c.sql", FUNCION("repet_c", 3)],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_sel1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      const antes = await estadoRepetibles(cli);
      await esperar(20);

      // Un byte: el 2 del cuerpo pasa a 9.
      c.escribirRepetible("b.sql", FUNCION("repet_b", 9));
      const r = correrCopia(c, [], env);
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toContain("Repetibles: 1 aplicada(s).");
      expect(lineasReaplicada(r.salida)).toEqual(["  repetible reaplicada  b.sql"]);

      const despues = await estadoRepetibles(cli);
      expect(despues.get("a.sql")).toEqual(antes.get("a.sql"));
      expect(despues.get("c.sql")).toEqual(antes.get("c.sql"));
      expect(despues.get("b.sql").hash).not.toBe(antes.get("b.sql").hash);
      expect(despues.get("b.sql").en).toBeGreaterThan(antes.get("b.sql").en);

      const { rows } = await cli.query("select repet_a() a, repet_b() b, repet_c() c");
      expect(rows[0]).toEqual({ a: 1, b: 9, c: 3 });
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("una repetible nueva se aplica como nueva y no toca las que ya estaban al dia", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("rep_sel2");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      const antes = await estadoRepetibles(cli);
      await esperar(20);

      c.escribirRepetible("d.sql", FUNCION("repet_d", 4));
      const r = correrCopia(c, [], env);
      expect(r.status, r.salida).toBe(0);
      expect(lineasAplicada(r.salida)).toEqual(["  repetible aplicada  d.sql"]);
      expect(lineasReaplicada(r.salida).length).toBe(0);

      const despues = await estadoRepetibles(cli);
      expect(despues.get("a.sql")).toEqual(antes.get("a.sql"));
      expect(await existeFuncion(cli, "repet_d")).toBe(true);
    } finally {
      await cerrar(cli, nombre);
    }
  });
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_ORDEN", () => {
  it("las repetibles corren DESPUES de las numeradas: pueden apoyarse en el esquema recien creado", async () => {
    // La repetible consulta una tabla que crea la ultima numerada. Si el migrador las corriera
    // antes —o intercaladas— fallaria con "relation does not exist".
    const c = copia({
      migraciones: [
        ...MIG_BASE,
        ["0002_tarde.sql", "create table repet_tarde (id int primary key, v int);"],
      ],
      repetibles: [
        [
          "usa_tabla.sql",
          `create or replace function repet_usa() returns bigint
language sql
as $fn$
  select count(*) from repet_tarde
$fn$;
`,
        ],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_orden1");
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], entorno({ testUrl: url }));
      expect(r.status, r.salida).toBe(0);
      // Y en la salida, las numeradas aparecen antes que las repetibles.
      expect(r.salida.indexOf("0002_tarde.sql")).toBeLessThan(r.salida.indexOf("usa_tabla.sql"));
      const { rows } = await cli.query("select repet_usa() as n");
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("orden alfabetico entre repetibles y solo archivos .sql", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["0010_c.sql", FUNCION("repet_c10", 10)],
        ["0002_b.sql", FUNCION("repet_b2", 2)],
        ["0001_a.sql", FUNCION("repet_a1", 1)],
        ["notas.txt", "esto no es una repetible"],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_orden2");
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], entorno({ testUrl: url }));
      expect(r.status, r.salida).toBe(0);
      expect(lineasAplicada(r.salida)).toEqual([
        "  repetible aplicada  0001_a.sql",
        "  repetible aplicada  0002_b.sql",
        "  repetible aplicada  0010_c.sql",
      ]);
      const filas = await filasSchemaRepetibles(cli);
      expect(filas.map((f) => f.nombre)).toEqual(["0001_a.sql", "0002_b.sql", "0010_c.sql"]);
      expect(filas.some((f) => f.nombre === "notas.txt")).toBe(false);
    } finally {
      await cerrar(cli, nombre);
    }
  });
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_DIRECTORIO", () => {
  it("db/repetibles/ inexistente no es un error", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: null });
    const { nombre, url } = await baseLimpia("rep_dir1");
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], entorno({ testUrl: url }));
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toContain("Repetibles: sin cambios");
      expect(await existeRelacion(cli, "schema_repetibles")).toBe(true);
      expect(await filasSchemaRepetibles(cli)).toEqual([]);
      expect(await existeRelacion(cli, "repet_base")).toBe(true);
      // Y --estado tampoco explota sin el directorio.
      const est = correrCopia(c, ["--estado"], entorno({ testUrl: url }));
      expect(est.status, est.salida).toBe(0);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("db/repetibles/ vacio tampoco es un error", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [] });
    const { nombre, url } = await baseLimpia("rep_dir2");
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], entorno({ testUrl: url }));
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toContain("Repetibles: sin cambios");
      expect(await filasSchemaRepetibles(cli)).toEqual([]);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  // CONTROL de los dos de arriba, y no es paranoia: los dos dan verde tambien si la copia deja
  // las repetibles en un directorio que el migrador NO mira. Eso paso de verdad en TASK-018
  // —el renombre de functions/ a repetibles/ dejo 21 tests rojos y estos dos verdes por el
  // motivo equivocado—. Aca se exige que el directorio que la copia escribe sea el mismo que
  // migrar.js resuelve, y que una repetible puesta ahi se despliegue.
  it("el directorio que usa la copia es el que resuelve migrar.js, y una repetible puesta ahi se aplica", async () => {
    expect(basename(DIR_REPETIBLES)).toBe(NOMBRE_DIR_REPETIBLES);
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    expect(basename(c.dirRepetibles)).toBe(basename(DIR_REPETIBLES));
    const { nombre, url } = await baseLimpia("rep_dir3");
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, [], entorno({ testUrl: url }));
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toMatch(/repetible aplicada\s+a\.sql/);
      expect(await existeFuncion(cli, "repet_a")).toBe(true);
    } finally {
      await cerrar(cli, nombre);
    }
  });
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_CONCURRENCIA", () => {
  it("cuatro migradores en paralelo aplican cada repetible exactamente una vez", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["a.sql", FUNCION("repet_a", 1)],
        ["b.sql", FUNCION("repet_b", 2)],
        ["c.sql", FUNCION("repet_c", 3)],
      ],
    });
    const { nombre, url } = await baseLimpia("rep_conc1");
    const env = entorno({ testUrl: url });
    const corridas = await Promise.all(
      [0, 1, 2, 3].map(() => lanzarCopia(c, [], env).terminado)
    );
    const cli = await clienteDe(url);
    try {
      for (const r of corridas) expect(r.status, r.salida).toBe(0);

      // Estado final de schema_repetibles: una fila por archivo, ni una de mas.
      const filas = await filasSchemaRepetibles(cli);
      expect(filas.map((f) => f.nombre)).toEqual(["a.sql", "b.sql", "c.sql"]);
      const { rows: dup } = await cli.query(
        "select nombre, count(*)::int n from schema_repetibles group by nombre having count(*) > 1"
      );
      expect(dup).toEqual([]);

      // Entre las cuatro corridas se aplico cada repetible una sola vez: 3 lineas en total,
      // y ninguna reaplicacion.
      const todas = corridas.map((r) => r.salida).join("\n");
      expect(lineasAplicada(todas).length).toBe(3);
      expect(lineasReaplicada(todas).length).toBe(0);

      // Y las funciones existen una sola vez cada una.
      for (const f of ["repet_a", "repet_b", "repet_c"]) {
        const { rows } = await cli.query(
          "select count(*)::int n from pg_proc where proname = $1",
          [f]
        );
        expect(rows[0].n, f).toBe(1);
      }
      const { rows: v } = await cli.query("select repet_a() a, repet_b() b, repet_c() c");
      expect(v[0]).toEqual({ a: 1, b: 2, c: 3 });
    } finally {
      await cerrar(cli, nombre);
    }
  }, 60000);

  it("con el advisory lock tomado por otro, el migrador espera y no escribe ni repetibles", async () => {
    const CLAVE_LOCK = 5150419;
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("rep_conc2");
    const tenedor = await clienteDe(url);
    const observador = await clienteDe(url);
    try {
      await tenedor.query("select pg_advisory_lock($1::bigint)", [CLAVE_LOCK]);
      const { terminado } = lanzarCopia(c, [], entorno({ testUrl: url }));
      await esperar(2500);
      expect(await existeRelacion(observador, "schema_repetibles")).toBe(false);
      expect(await existeFuncion(observador, "repet_a")).toBe(false);

      await tenedor.query("select pg_advisory_unlock($1::bigint)", [CLAVE_LOCK]);
      const r = await terminado;
      expect(r.status, r.salida).toBe(0);
      expect((await filasSchemaRepetibles(observador)).map((f) => f.nombre)).toEqual(["a.sql"]);
    } finally {
      await tenedor.end().catch(() => {});
      await cerrar(observador, nombre);
    }
  }, 60000);
});

// =========================================================================================
describe("MIGRADOR_FLAGS", () => {
  const INVALIDOS = [
    ["--estad", "typo del caso concreto de la tarea"],
    ["--marcar-aplicada", "abreviatura: falta la s"],
    ["--estado=1", "con valor pegado"],
    ["-e", "abreviatura de una letra"],
    ["--ayuda", "flag inventado"],
    ["migrar", "posicional suelto"],
    ["--Estado", "distinta capitalizacion"],
    ["", "argumento vacio"],
  ];

  it("cada argumento invalido aborta con exit != 0, lista los validos y NO crea ni una tabla", async () => {
    const { nombre, url } = await baseLimpia("flags1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      for (const [arg, por] of INVALIDOS) {
        const r = correrMigrador([arg], env);
        const ctx = `${JSON.stringify(arg)} (${por}): ${r.salida}`;
        expect(r.status, ctx).not.toBe(0);
        expect(r.status, ctx).toBe(1);
        // Lista los validos, exactos.
        expect(r.salida, ctx).toContain("--estado");
        expect(r.salida, ctx).toContain("--marcar-aplicadas");
        expect(r.salida, ctx).toMatch(/desconocido/i);
        expect(r.salida, ctx).toMatch(/no se aplico ninguna migracion/i);
        // Ni stack trace pelado ni caida silenciosa en el modo que aplica.
        expect(r.salida, ctx).not.toMatch(/Sin migraciones pendientes/);
        // El banner del modo baseline, no la linea de la ayuda que nombra el flag.
        expect(r.salida, ctx).not.toContain("BASELINE EXPLICITO: se marcan");
        expect(r.salida, ctx).not.toMatch(/marcada SIN correr/i);
        expect(r.salida, ctx).not.toMatch(/Repetibles:/);
        expect(r.salida, ctx).not.toMatch(/TypeError|undefined is not/);

        // Y la base quedo virgen: ni schema_migrations, ni schema_repetibles, ni nada.
        expect(await relacionesPublic(cli), ctx).toEqual([]);
      }
    } finally {
      await cerrar(cli, nombre);
    }
  }, 60000);

  it("--estado junto con --marcar-aplicadas aborta sin escribir", async () => {
    const { nombre, url } = await baseLimpia("flags2");
    const cli = await clienteDe(url);
    try {
      const r = correrMigrador(["--estado", "--marcar-aplicadas"], entorno({ testUrl: url }));
      expect(r.status, r.salida).not.toBe(0);
      expect(r.salida).toMatch(/incompatibles/i);
      expect(await relacionesPublic(cli)).toEqual([]);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("un flag valido acompanado de uno invalido tambien aborta", async () => {
    const { nombre, url } = await baseLimpia("flags3");
    const cli = await clienteDe(url);
    try {
      const r = correrMigrador(["--estado", "--turbo"], entorno({ testUrl: url }));
      expect(r.status, r.salida).not.toBe(0);
      expect(r.salida).toContain("--turbo");
      expect(await relacionesPublic(cli)).toEqual([]);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("--estado crea SOLO las dos tablas de control, vacias: es lo que dice el README", async () => {
    // El README (backend/README.md, "Que escribe cada modo") dice textualmente que --estado
    // no ejecuta migraciones y que lo unico que escribe son las dos tablas de control, vacias.
    // Esto verifica que el codigo y la documentacion coincidan, que es el criterio de la tarea.
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("flags4");
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, ["--estado"], entorno({ testUrl: url }));
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toMatch(/PENDIENTE\s+0001_base\.sql/);
      expect(r.salida).toMatch(/repetible PENDIENTE\s+a\.sql/);

      expect(await relacionesPublic(cli)).toEqual(["schema_migrations", "schema_repetibles"]);
      const { rows: n } = await cli.query("select count(*)::int n from schema_migrations");
      expect(n[0].n).toBe(0);
      expect(await filasSchemaRepetibles(cli)).toEqual([]);
      expect(await existeFuncion(cli, "repet_a")).toBe(false);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("--estado sobre una base al dia informa 'al dia' y no reaplica nada", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("flags5");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      const antes = await estadoRepetibles(cli);
      await esperar(20);
      const r = correrCopia(c, ["--estado"], env);
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toMatch(/repetible al dia\s+a\.sql/);
      expect(await estadoRepetibles(cli)).toEqual(antes);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("--estado marca CAMBIADA la repetible cuyo hash difiere, sin aplicarla", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("flags6");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      c.escribirRepetible("a.sql", FUNCION("repet_a", 7));
      const r = correrCopia(c, ["--estado"], env);
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toMatch(/repetible CAMBIADA\s+a\.sql/);
      const { rows } = await cli.query("select repet_a() as v");
      expect(rows[0].v).toBe(1); // no la aplico
    } finally {
      await cerrar(cli, nombre);
    }
  });
});

// =========================================================================================
describe("MIGRADOR_REPETIBLES_CONVENCIONES", () => {
  // ESTE TEST AFIRMABA LO CONTRARIO hasta TASK-018, y no porque estuviera mal escrito: afirmaba
  // la convencion vigente hasta ese momento —--marcar-aplicadas baselineaba las repetibles en
  // silencio, aunque la funcion no estuviera desplegada, y la corrida siguiente informaba
  // "Repetibles: sin cambios"—. El agujero lo encontro el tester en TASK-012 y quedo como R37.
  // Gaston lo cerro el 2026-09-05 con la salida dura, textual: "un crear_venta() equivocado
  // corriendo en silencio no aparece en un test, aparece en una venta". Documentarlo quedo
  // descartado: el flag FALLA. Asi que el test invierte su afirmacion. La convencion vieja no
  // desaparece de la suite: queda como MUTANTE, abajo, que es donde se puede ver que el chequeo
  // discrimina de verdad.
  it("--marcar-aplicadas FALLA si una repetible declara algo que la base no tiene, y no marca NADA (R37)", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("conv1");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, ["--marcar-aplicadas"], env);
      expect(await violacionesR37(cli, r)).toEqual([]);

      // El mensaje nombra el archivo y la funcion: un error que no dice cual no sirve de nada.
      expect(r.salida).toContain("a.sql");
      expect(r.salida).toContain("repet_a");
      expect(r.salida).toMatch(/No se marco NADA/i);
      // Y no ejecuto nada, ni numeradas ni repetibles.
      expect(await existeFuncion(cli, "repet_a")).toBe(false);
      expect(await existeRelacion(cli, "repet_base")).toBe(false);

      // La salida que propone el propio error, y que ahora es la unica: correr sin flags.
      const normal = correrCopia(c, [], env);
      expect(normal.status, normal.salida).toBe(0);
      expect(await existeFuncion(cli, "repet_a")).toBe(true);
      // Y recien ahi el baseline es cierto y no tiene nada que hacer.
      const despues = correrCopia(c, ["--marcar-aplicadas"], env);
      expect(despues.status, despues.salida).toBe(0);
      expect(despues.salida).toContain("Repetibles: sin cambios");
      const filas = await filasSchemaRepetibles(cli);
      expect(filas.map((f) => f.nombre)).toEqual(["a.sql"]);
      expect(filas[0].hash).toBe(leerRepetible(c.dirRepetibles, "a.sql").hash);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("MUTACION R20: sin la consulta a pg_proc, --marcar-aplicadas baselinea una funcion ausente y nadie avisa", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [["a.sql", FUNCION("repet_a", 1)]],
      mutaciones: [MUT_R37_SIN_MIRAR_LA_BASE],
    });
    const { nombre, url } = await baseLimpia("conv1_mut");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      const r = correrCopia(c, ["--marcar-aplicadas"], env);
      // El mutante NO cumple la propiedad: sale 0 y escribe. Si esta lista viniera vacia, el
      // test de arriba estaria verde por casualidad y no probaria nada.
      const violaciones = await violacionesR37(cli, r);
      expect(violaciones.length, "el mutante cumplio la propiedad: el test no discrimina").toBeGreaterThan(0);
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toMatch(/repetible marcada SIN correr\s+a\.sql/);

      // Y llega exactamente al estado incoherente que R37 impide: fila al dia, funcion ausente,
      // migrador diciendo "sin cambios". Esta era la convencion vieja, tal cual.
      const filas = await filasSchemaRepetibles(cli);
      expect(filas.map((f) => f.nombre)).toEqual(["a.sql"]);
      expect(filas[0].hash).toBe(leerRepetible(c.dirRepetibles, "a.sql").hash);
      const segunda = correrCopia(c, [], env);
      expect(segunda.status, segunda.salida).toBe(0);
      expect(await llegoAlEstadoIncoherente(cli, segunda)).toBe(true);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("el chequeo de R37 recorre TODAS las repetibles, no solo las pendientes: un DROP FUNCTION a mano tambien lo dispara", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("conv1_drop");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      expect(await existeFuncion(cli, "repet_a")).toBe(true);

      // Camino distinto, mismo estado incoherente: la fila queda al dia (o sea, la repetible NO
      // esta pendiente) y la funcion desaparece. El chequeo tiene que verlo igual.
      await cli.query("drop function repet_a()");
      const r = correrCopia(c, ["--marcar-aplicadas"], env);
      expect(r.status, r.salida).not.toBe(0);
      expect(r.salida).toMatch(/ABORTADO/i);
      expect(r.salida).toContain("repet_a");
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("una repetible borrada del disco deja fila huerfana, --estado la reporta y el migrador no falla", async () => {
    const c = copia({
      migraciones: MIG_BASE,
      repetibles: [
        ["a.sql", FUNCION("repet_a", 1)],
        ["b.sql", FUNCION("repet_b", 2)],
      ],
    });
    const { nombre, url } = await baseLimpia("conv2");
    const env = entorno({ testUrl: url });
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], env).status).toBe(0);
      c.borrarRepetible("b.sql");

      const est = correrCopia(c, ["--estado"], env);
      expect(est.status, est.salida).toBe(0);
      expect(est.salida).toMatch(/repetible registrada pero NO esta en disco: b\.sql/);

      const r = correrCopia(c, [], env);
      expect(r.status, r.salida).toBe(0);
      expect(r.salida).toContain("Repetibles: sin cambios");

      // La fila queda, y la funcion sigue viva en la base: el migrador no borra funciones.
      // La convencion es que el DROP FUNCTION va en una migracion numerada.
      expect((await filasSchemaRepetibles(cli)).map((f) => f.nombre)).toEqual(["a.sql", "b.sql"]);
      expect(await existeFuncion(cli, "repet_b")).toBe(true);
    } finally {
      await cerrar(cli, nombre);
    }
  });

  it("schema_repetibles tiene nombre como clave primaria y una sola fila por archivo", async () => {
    const c = copia({ migraciones: MIG_BASE, repetibles: [["a.sql", FUNCION("repet_a", 1)]] });
    const { nombre, url } = await baseLimpia("conv3");
    const cli = await clienteDe(url);
    try {
      expect(correrCopia(c, [], entorno({ testUrl: url })).status).toBe(0);
      await expect(
        cli.query("insert into schema_repetibles(nombre, hash) values ('a.sql','x')")
      ).rejects.toThrow();
      const { rows } = await cli.query(`
        select a.attname
        from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
        where i.indrelid='schema_repetibles'::regclass and i.indisprimary
      `);
      expect(rows.map((r) => r.attname)).toEqual(["nombre"]);
      // Y schema_migrations no gano ni perdio filas por las repetibles: sigue siendo la
      // historia de las numeradas, tal como asumen los tests de TASK-001.
      const { rows: num } = await cli.query("select nombre from schema_migrations");
      expect(num.map((f) => f.nombre)).toEqual(["0001_base.sql"]);
    } finally {
      await cerrar(cli, nombre);
    }
  });
});
