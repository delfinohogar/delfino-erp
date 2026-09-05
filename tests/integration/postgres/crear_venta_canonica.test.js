// TASK-018 — crear_venta() tiene UNA sola copia canonica: backend/db/repetibles/crear_venta.sql.
//
// Por que existe este archivo. Hasta el corte de la migracion 0006, crear_venta() se copiaba
// entera en cada migracion numerada que la tocaba (0002:46, 0003:112, 0004:241). Desde 0006 la
// definicion VIGENTE es la repetible, y las copias numeradas quedan como historia ya aplicada.
//
// El riesgo concreto que cubre esto es del lado de los TESTS, no del backend: recrearEsquema()
// aplicaba SOLO backend/db/migrations/*.sql, asi que la suite entera corria contra la copia de
// 0004 y no contra la canonica. Hoy las dos son identicas caracter por caracter, o sea que la
// suite NO mentia todavia — mentiria el dia que alguien edite repetibles/crear_venta.sql, y
// seguiria verde probando la version vieja. Lo detectaron el auditor de TASK-003 y el
// implementador de TASK-018.
//
// Metodo: se verifica contra la BASE con pg_get_functiondef()/prosrc, no razonando sobre el
// codigo. Y con un control que le da poder discriminante: aplicar solo las numeradas deja un
// cuerpo distinto del que deja la ruta completa, y una repetible marcada demuestra que el orden
// numeradas -> repetibles hace ganar a la repetible.
//
// Aislamiento: el control usa una base temporal propia (delfino_test_mig_*); el test principal
// usa delfino_test, que es la base de la suite y se recrea entera.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizarFinDeLinea } from "../../../backend/src/db/migrar.js";
import { CONN, DIR_REPETIBLES, nuevoPool, recrearEsquema } from "./_helpers.mjs";
import {
  ADMIN_URL,
  baseDeUrl,
  borrarBase,
  clienteDe,
  crearBaseTemporal,
  RAIZ,
} from "./_migrador_helpers.mjs";

const ARCHIVO_REPETIBLE = join(DIR_REPETIBLES, "crear_venta.sql");
const ARCHIVO_0004 = join(RAIZ, "backend", "db", "migrations", "0004_precios_y_costos.sql");
const MIGRACIONES = join(RAIZ, "backend", "db", "migrations");

/**
 * Aisla el cuerpo $$...$$ de la ULTIMA declaracion de crear_venta() de un .sql. Es exactamente
 * lo que PostgreSQL guarda en pg_proc.prosrc, asi que se puede comparar byte a byte.
 */
function cuerpoCrearVenta(texto) {
  const desde = texto.lastIndexOf("create or replace function crear_venta(");
  if (desde === -1) throw new Error("el archivo no declara crear_venta()");
  const partes = texto.slice(desde).split("$$");
  if (partes.length < 3) throw new Error("no se pudo aislar el cuerpo $$...$$ de crear_venta()");
  return partes[1];
}

const TEXTO_REPETIBLE = readFileSync(ARCHIVO_REPETIBLE, "utf8");
// Normalizado a LF: es lo que despliegan tanto migrar.js (aplicarRepetibles) como recrearEsquema.
const CUERPO_CANONICO = cuerpoCrearVenta(normalizarFinDeLinea(TEXTO_REPETIBLE));
// Crudo, sin normalizar: es lo que deja una migracion numerada, que el migrador manda tal cual.
const CUERPO_0004_CRUDO = cuerpoCrearVenta(readFileSync(ARCHIVO_0004, "utf8"));

async function prosrcCrearVenta(ejecutor) {
  const { rows } = await ejecutor.query(
    "select prosrc from pg_proc where proname = 'crear_venta'"
  );
  expect(rows.length, "deberia haber exactamente una crear_venta() en la base").toBe(1);
  return rows[0].prosrc;
}

async function definicionCrearVenta(ejecutor) {
  const { rows } = await ejecutor.query(
    "select pg_get_functiondef('crear_venta'::regproc) as def"
  );
  return rows[0].def;
}

/** Aplica SOLO las migraciones numeradas, crudas: es lo que hacia recrearEsquema() antes. */
async function aplicarSoloNumeradas(cliente) {
  for (const archivo of readdirSync(MIGRACIONES).sort()) {
    if (!archivo.endsWith(".sql")) continue;
    await cliente.query(readFileSync(join(MIGRACIONES, archivo), "utf8"));
  }
}

let pool;
const basesCreadas = new Set();

async function baseLimpia(sufijo) {
  const { nombre, url } = await crearBaseTemporal(sufijo);
  basesCreadas.add(nombre);
  return { nombre, url };
}

beforeAll(async () => {
  expect(baseDeUrl(CONN)).not.toBe("delfino_dev");
  expect(baseDeUrl(ADMIN_URL)).not.toBe("delfino_dev");
  pool = await nuevoPool();
  await recrearEsquema(pool);
});

afterAll(async () => {
  for (const nombre of basesCreadas) await borrarBase(nombre).catch(() => {});
  await pool?.end();
});

describe("CREAR_VENTA_CANONICA", () => {
  it("lo que corre en los tests es el cuerpo de repetibles/crear_venta.sql, normalizado a LF", async () => {
    const prosrc = await prosrcCrearVenta(pool);
    // Byte a byte contra el archivo canonico. Si alguien edita repetibles/crear_venta.sql y la
    // suite siguiera aplicando solo las numeradas, esto se pone rojo en el acto.
    expect(prosrc).toBe(CUERPO_CANONICO);

    // Y lo mismo visto por donde lo pide el criterio de aceptacion: pg_get_functiondef().
    const def = await definicionCrearVenta(pool);
    expect(def).toContain(CUERPO_CANONICO);
    expect(def).toMatch(/^CREATE OR REPLACE FUNCTION public\.crear_venta\(/);
    // R33: lo desplegado no depende del checkout. Ni un solo \r adentro.
    expect(/\r/.test(def)).toBe(false);
  });

  it("la constancia del corte quedo en la base: el COMMENT de 0006 apunta a repetibles/", async () => {
    const { rows } = await pool.query(
      "select obj_description('crear_venta'::regproc, 'pg_proc') as nota"
    );
    expect(rows[0].nota).toMatch(/repetibles\/crear_venta\.sql/);
  });

  it("CONTROL: aplicar solo las numeradas deja la copia de 0004, que NO es la que corre en los tests", async () => {
    const { nombre, url } = await baseLimpia("canon_solo_numeradas");
    const c = await clienteDe(url);
    try {
      await aplicarSoloNumeradas(c);
      const prosrcViejo = await prosrcCrearVenta(c);
      // Lo que deja la ruta vieja es, byte a byte, la copia historica de 0004.
      expect(prosrcViejo).toBe(CUERPO_0004_CRUDO);

      // Poder discriminante: en este checkout 0004 esta en CRLF (git ls-files --eol da
      // `i/lf w/crlf`) y la repetible se despliega normalizada a LF, asi que las dos rutas
      // dejan cuerpos DISTINTOS y la comparacion del primer test discrimina de verdad.
      // Si algun dia los dos archivos estuvieran en LF, esta diferencia desapareceria; por eso
      // el test de la MUTACION de abajo cubre lo mismo sin depender del checkout.
      if (CUERPO_0004_CRUDO !== CUERPO_CANONICO) {
        expect(prosrcViejo).not.toBe(await prosrcCrearVenta(pool));
      }
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("MUTACION: con las repetibles aplicadas despues, gana la repetible y no la copia de 0004", async () => {
    const { nombre, url } = await baseLimpia("canon_gana_repetible");
    const c = await clienteDe(url);
    const MARCA = "-- MARCA_DEL_TESTER_TASK_018";
    // Misma repetible, con una marca adentro del cuerpo. Solo existe en memoria: el tester no
    // escribe en backend/. Sirve para distinguir las dos copias sin depender de los finales de
    // linea, que es lo unico que hoy las diferencia en disco.
    const repetibleMarcada = normalizarFinDeLinea(TEXTO_REPETIBLE).replace(
      "\ndeclare\n",
      `\ndeclare\n  ${MARCA}\n`
    );
    expect(repetibleMarcada, "la marca no se inserto: la mutacion no muta nada").toContain(MARCA);
    try {
      await aplicarSoloNumeradas(c);
      expect(await prosrcCrearVenta(c)).not.toContain(MARCA);

      // El mismo paso que agrega recrearEsquema(): las repetibles, DESPUES de las numeradas.
      await c.query(repetibleMarcada);
      const prosrc = await prosrcCrearVenta(c);
      expect(prosrc).toContain(MARCA);
      expect(prosrc).not.toBe(CUERPO_0004_CRUDO);
      // Y lo desplegado sigue siendo el cuerpo del archivo repetible, no una mezcla.
      expect(prosrc).toBe(cuerpoCrearVenta(repetibleMarcada));
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });
});
