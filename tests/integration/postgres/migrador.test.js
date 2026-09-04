// TASK-001 — migrador de esquema (backend/src/db/migrar.js) contra PostgreSQL local.
//
// Criterios de aceptacion verificados aca:
//   - aplica en orden alfabetico las migraciones de backend/db/migrations/ y registra
//     cada una en schema_migrations con nombre y fecha;
//   - correrlo dos veces seguidas no reaplica nada y termina con exito;
//   - el pool lee DATABASE_URL y, en tests, DATABASE_URL_TEST (verificado end-to-end);
//   - atomicidad del registro: una migracion que falla no queda registrada ni deja efecto;
//   - concurrencia: dos migradores en paralelo no aplican la misma migracion dos veces;
//   - --marcar-aplicadas marca sin ejecutar y no se dispara solo.
//
// Aislamiento: cada test usa una base temporal propia (delfino_test_mig_*). delfino_test se
// usa solo como base administrativa para CREATE/DROP DATABASE y queda intacta.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";

import { aplicarPendientes, DIR_MIGRACIONES } from "../../../backend/src/db/migrar.js";
import {
  ADMIN_URL,
  baseDeUrl,
  borrarBase,
  borrarBasesTemporalesHuerfanas,
  clienteDe,
  correrMigrador,
  crearBaseTemporal,
  dirDeMigraciones,
  entorno,
  existeRelacion,
  filasSchemaMigrations,
  lanzarMigrador,
} from "./_migrador_helpers.mjs";

const MIGRACIONES_REALES = readdirSync(DIR_MIGRACIONES)
  .filter((n) => n.toLowerCase().endsWith(".sql"))
  .sort();

const basesCreadas = new Set();

async function baseLimpia(sufijo) {
  const { nombre, url } = await crearBaseTemporal(sufijo);
  basesCreadas.add(nombre);
  return { nombre, url };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // Barrera: nunca contra la base de trabajo.
  expect(baseDeUrl(ADMIN_URL)).not.toBe("delfino_dev");
  await borrarBasesTemporalesHuerfanas();
});

afterAll(async () => {
  for (const nombre of basesCreadas) await borrarBase(nombre).catch(() => {});
  await borrarBasesTemporalesHuerfanas().catch(() => {});
});

describe("MIGRADOR_IDEMPOTENCIA", () => {
  it("contra base limpia aplica las migraciones, sale 0 y las registra con nombre y fecha", async () => {
    const { nombre, url } = await baseLimpia("idem1");
    const primera = correrMigrador([], entorno({ testUrl: url }));
    expect(primera.error).toBe(null);
    expect(primera.status, primera.salida).toBe(0);

    const c = await clienteDe(url);
    try {
      const filas = await filasSchemaMigrations(c);
      expect(filas.map((f) => f.nombre)).toEqual(MIGRACIONES_REALES);
      expect(filas.length).toBe(MIGRACIONES_REALES.length);
      expect(filas.length).toBe(2); // hoy son 0001 y 0002; si aparece una tercera, revisar
      for (const f of filas) {
        expect(typeof f.nombre).toBe("string");
        expect(f.aplicada_en).toBeInstanceOf(Date);
        expect(Number.isNaN(f.aplicada_en.getTime())).toBe(false);
      }
      // Y de verdad ejecuto el SQL, no solo lo anoto.
      expect(await existeRelacion(c, "clientes")).toBe(true);
      expect(await existeRelacion(c, "ventas")).toBe(true);
      const { rows } = await c.query("select proname from pg_proc where proname='crear_venta'");
      expect(rows.length).toBe(1);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("la segunda corrida no reaplica nada, sale 0 y no toca las fechas ya registradas", async () => {
    const { nombre, url } = await baseLimpia("idem2");
    const env = entorno({ testUrl: url });
    const primera = correrMigrador([], env);
    expect(primera.status, primera.salida).toBe(0);

    const c = await clienteDe(url);
    try {
      const antes = await filasSchemaMigrations(c);
      await esperar(20);
      const segunda = correrMigrador([], env);
      expect(segunda.error).toBe(null);
      expect(segunda.status, segunda.salida).toBe(0);
      expect(segunda.salida).toContain("Sin migraciones pendientes");
      expect(segunda.salida).not.toMatch(/^\s*aplicada\s/m);

      const despues = await filasSchemaMigrations(c);
      expect(despues.map((f) => f.nombre)).toEqual(antes.map((f) => f.nombre));
      expect(despues.map((f) => f.aplicada_en.getTime())).toEqual(
        antes.map((f) => f.aplicada_en.getTime())
      );
      // Una tercera corrida tampoco.
      const tercera = correrMigrador([], env);
      expect(tercera.status, tercera.salida).toBe(0);
      const { rows } = await c.query("select count(*)::int as n from schema_migrations");
      expect(rows[0].n).toBe(MIGRACIONES_REALES.length);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("schema_migrations tiene nombre como clave primaria: no admite el mismo nombre dos veces", async () => {
    const { nombre, url } = await baseLimpia("idem3");
    expect(correrMigrador([], entorno({ testUrl: url })).status).toBe(0);
    const c = await clienteDe(url);
    try {
      await expect(
        c.query("insert into schema_migrations(nombre) values ($1)", [MIGRACIONES_REALES[0]])
      ).rejects.toThrow();
      const { rows } = await c.query(`
        select a.attname
        from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
        where i.indrelid='schema_migrations'::regclass and i.indisprimary
      `);
      expect(rows.map((r) => r.attname)).toEqual(["nombre"]);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });
});

describe("MIGRADOR_ORDEN_ALFABETICO", () => {
  it("las migraciones reales quedan registradas en orden alfabetico segun aplicada_en", async () => {
    const { nombre, url } = await baseLimpia("orden1");
    expect(correrMigrador([], entorno({ testUrl: url })).status).toBe(0);
    const c = await clienteDe(url);
    try {
      // Evidencia en la tabla, no en la consola.
      const { rows } = await c.query(
        "select nombre from schema_migrations order by aplicada_en asc, ctid asc"
      );
      expect(rows.map((r) => r.nombre)).toEqual(MIGRACIONES_REALES);
      const { rows: cmp } = await c.query(
        `select (select aplicada_en from schema_migrations where nombre=$1)
             <= (select aplicada_en from schema_migrations where nombre=$2) as ordenado`,
        [MIGRACIONES_REALES[0], MIGRACIONES_REALES[1]]
      );
      expect(cmp[0].ordenado).toBe(true);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("aplica 0001 antes que 0002 aunque el archivo 0002 sea mas viejo en disco", async () => {
    // 0002 depende de una tabla que crea 0001: si el orden fuera por fecha de archivo o
    // por el orden crudo de readdir, 0002 fallaria.
    const { dir, limpiar } = dirDeMigraciones([
      ["0002_segunda.sql", "alter table orden_t add column b int;"],
      ["0001_primera.sql", "create table orden_t (a int);"],
    ]);
    const { nombre, url } = await baseLimpia("orden2");
    const c = await clienteDe(url);
    try {
      const hechas = await aplicarPendientes(c, { dir });
      expect(hechas).toEqual(["0001_primera.sql", "0002_segunda.sql"]);
      const { rows } = await c.query(
        "select nombre from schema_migrations order by aplicada_en asc, ctid asc"
      );
      expect(rows.map((r) => r.nombre)).toEqual(["0001_primera.sql", "0002_segunda.sql"]);
      const { rows: cols } = await c.query(
        "select column_name from information_schema.columns where table_name='orden_t' order by ordinal_position"
      );
      expect(cols.map((r) => r.column_name)).toEqual(["a", "b"]);
    } finally {
      limpiar();
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("el orden es alfabetico puro y solo toma archivos .sql", async () => {
    const { dir, limpiar } = dirDeMigraciones([
      ["0010_c.sql", "create table t_c (x int);"],
      ["0002_b.sql", "create table t_b (x int);"],
      ["0001_a.sql", "create table t_a (x int);"],
      ["notas.txt", "esto no es una migracion"],
    ]);
    const { nombre, url } = await baseLimpia("orden3");
    const c = await clienteDe(url);
    try {
      const hechas = await aplicarPendientes(c, { dir });
      expect(hechas).toEqual(["0001_a.sql", "0002_b.sql", "0010_c.sql"]);
      const { rows } = await c.query(
        "select nombre from schema_migrations order by aplicada_en asc, ctid asc"
      );
      expect(rows.map((r) => r.nombre)).toEqual(["0001_a.sql", "0002_b.sql", "0010_c.sql"]);
      expect(rows.some((r) => r.nombre === "notas.txt")).toBe(false);
    } finally {
      limpiar();
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });
});

describe("MIGRADOR_ATOMICIDAD", () => {
  it("una migracion que falla a mitad no queda registrada y su efecto no persiste", async () => {
    const { dir, limpiar } = dirDeMigraciones([
      ["0001_ok.sql", "create table atomica_ok (x int);"],
      [
        "0002_rompe.sql",
        // Primera sentencia valida, segunda invalida: el efecto parcial debe revertirse.
        "create table atomica_parcial (x int);\ninsert into atomica_parcial values (1);\nselect 1/0;",
      ],
      ["0003_posterior.sql", "create table atomica_posterior (x int);"],
    ]);
    const { nombre, url } = await baseLimpia("atom1");
    const c = await clienteDe(url);
    try {
      await expect(aplicarPendientes(c, { dir })).rejects.toThrow(/0002_rompe\.sql/);

      // 1) la migracion que fallo NO figura como aplicada
      const filas = await filasSchemaMigrations(c);
      expect(filas.map((f) => f.nombre)).toEqual(["0001_ok.sql"]);

      // 2) su efecto parcial NO persiste
      expect(await existeRelacion(c, "atomica_parcial")).toBe(false);

      // 3) la anterior si quedo aplicada y con efecto
      expect(await existeRelacion(c, "atomica_ok")).toBe(true);

      // 4) la posterior no se aplico ni se registro
      expect(await existeRelacion(c, "atomica_posterior")).toBe(false);
    } finally {
      limpiar();
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("tras el fallo la conexion queda usable y, corregida la migracion, se aplica en el reintento", async () => {
    const rota = dirDeMigraciones([
      ["0001_ok.sql", "create table reintento_ok (x int);"],
      ["0002_rompe.sql", "create table reintento_dos (x int); select no_existe_esta_funcion();"],
    ]);
    const sana = dirDeMigraciones([
      ["0001_ok.sql", "create table reintento_ok (x int);"],
      ["0002_rompe.sql", "create table reintento_dos (x int);"],
    ]);
    const { nombre, url } = await baseLimpia("atom2");
    const c = await clienteDe(url);
    try {
      await expect(aplicarPendientes(c, { dir: rota.dir })).rejects.toThrow();
      expect((await filasSchemaMigrations(c)).map((f) => f.nombre)).toEqual(["0001_ok.sql"]);

      const hechas = await aplicarPendientes(c, { dir: sana.dir });
      expect(hechas).toEqual(["0002_rompe.sql"]);
      expect((await filasSchemaMigrations(c)).map((f) => f.nombre)).toEqual([
        "0001_ok.sql",
        "0002_rompe.sql",
      ]);
      expect(await existeRelacion(c, "reintento_dos")).toBe(true);
    } finally {
      rota.limpiar();
      sana.limpiar();
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("si el esquema ya existe por otra via, el CLI falla y NO marca nada como aplicado", async () => {
    // Es el caso real de tests/integration/postgres/_helpers.mjs, que corre los .sql a mano.
    const { nombre, url } = await baseLimpia("atom3");
    const c = await clienteDe(url);
    try {
      await c.query("create table clientes (id int)"); // choca con 0001
      const r = correrMigrador([], entorno({ testUrl: url }));
      expect(r.status, r.salida).not.toBe(0);
      expect(r.salida).toMatch(/already exists|ya existe/i);
      expect(r.salida).toMatch(/ROLLBACK|revirtio/i);
      // Nada de baseline silencioso.
      const { rows } = await c.query("select count(*)::int as n from schema_migrations");
      expect(rows[0].n).toBe(0);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });
});

describe("MIGRADOR_CONCURRENCIA", () => {
  it("cuatro migradores en paralelo aplican cada migracion exactamente una vez", async () => {
    const { nombre, url } = await baseLimpia("conc1");
    const env = entorno({ testUrl: url });
    const corridas = await Promise.all([0, 1, 2, 3].map(() => lanzarMigrador([], env).terminado));
    const c = await clienteDe(url);
    try {
      for (const r of corridas) expect(r.status, r.salida).toBe(0);

      // Estado final: cada migracion registrada UNA sola vez.
      const filas = await filasSchemaMigrations(c);
      expect(filas.map((f) => f.nombre)).toEqual(MIGRACIONES_REALES);
      const { rows } = await c.query(
        "select nombre, count(*)::int as n from schema_migrations group by nombre having count(*) > 1"
      );
      expect(rows).toEqual([]);

      // Y el esquema quedo aplicado una sola vez.
      expect(await existeRelacion(c, "clientes")).toBe(true);
      const { rows: rel } = await c.query(
        "select count(*)::int as n from pg_class where relname='clientes' and relkind='r'"
      );
      expect(rel[0].n).toBe(1);

      // En total, entre las cuatro corridas, se aplicaron exactamente 2 migraciones.
      const aplicadasReportadas = corridas
        .flatMap((r) => r.salida.split(/\r?\n/))
        .filter((l) => /^\s*aplicada\s+\S+\.sql\s*$/.test(l));
      expect(aplicadasReportadas.length).toBe(MIGRACIONES_REALES.length);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  }, 60000);

  it("usa pg_advisory_lock: con el lock tomado por otro, espera y no escribe nada", async () => {
    const CLAVE_LOCK = 5150419; // la del migrador
    const { nombre, url } = await baseLimpia("conc2");
    const c = await clienteDe(url);
    const observador = await clienteDe(url);
    try {
      await c.query("select pg_advisory_lock($1::bigint)", [CLAVE_LOCK]);
      const { terminado } = lanzarMigrador([], entorno({ testUrl: url }));
      await esperar(2500);

      // Bloqueado: no creo la tabla de control ni aplico nada.
      expect(await existeRelacion(observador, "schema_migrations")).toBe(false);
      expect(await existeRelacion(observador, "clientes")).toBe(false);
      const { rows: esperando } = await observador.query(
        "select count(*)::int as n from pg_locks where locktype='advisory' and not granted"
      );
      expect(esperando[0].n).toBeGreaterThanOrEqual(1);

      await c.query("select pg_advisory_unlock($1::bigint)", [CLAVE_LOCK]);
      const r = await terminado;
      expect(r.status, r.salida).toBe(0);
      const filas = await filasSchemaMigrations(observador);
      expect(filas.map((f) => f.nombre)).toEqual(MIGRACIONES_REALES);
    } finally {
      await c.end().catch(() => {});
      await observador.end().catch(() => {});
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  }, 60000);
});

describe("MIGRADOR_VARIABLES_ENTORNO", () => {
  it("sin DATABASE_URL ni DATABASE_URL_TEST falla con mensaje claro y exit != 0", () => {
    const r = correrMigrador([], entorno({ enTests: false }));
    expect(r.status).not.toBe(0);
    expect(r.status).toBe(1);
    expect(r.salida).toMatch(/DATABASE_URL/);
    expect(r.salida.toLowerCase()).toMatch(/falta|no esta definida/);
    expect(r.salida).toMatch(/db:up|npm run/);
    // Mensaje, no stack trace pelado.
    expect(r.salida).not.toMatch(/TypeError|undefined is not/);
  });

  it("fuera de entorno de tests NO usa DATABASE_URL_TEST: falla y deja la base intacta", async () => {
    const { nombre, url } = await baseLimpia("env1");
    const r = correrMigrador([], entorno({ testUrl: url, enTests: false }));
    expect(r.status, r.salida).not.toBe(0);
    expect(r.salida).toMatch(/DATABASE_URL/);
    const c = await clienteDe(url);
    try {
      expect(await existeRelacion(c, "schema_migrations")).toBe(false);
      expect(await existeRelacion(c, "clientes")).toBe(false);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("en entorno de tests migra la base de DATABASE_URL_TEST y no la de DATABASE_URL", async () => {
    const test = await baseLimpia("env2_test");
    const dev = await baseLimpia("env2_dev");
    const r = correrMigrador([], entorno({ testUrl: test.url, devUrl: dev.url, enTests: true }));
    expect(r.status, r.salida).toBe(0);
    const cTest = await clienteDe(test.url);
    const cDev = await clienteDe(dev.url);
    try {
      expect((await filasSchemaMigrations(cTest)).map((f) => f.nombre)).toEqual(MIGRACIONES_REALES);
      expect(await existeRelacion(cDev, "schema_migrations")).toBe(false);
      expect(await existeRelacion(cDev, "clientes")).toBe(false);
    } finally {
      await cTest.end();
      await cDev.end();
      await borrarBase(test.nombre);
      await borrarBase(dev.nombre);
      basesCreadas.delete(test.nombre);
      basesCreadas.delete(dev.nombre);
    }
  });

  it("fuera de entorno de tests usa DATABASE_URL", async () => {
    const { nombre, url } = await baseLimpia("env3");
    const r = correrMigrador([], entorno({ devUrl: url, enTests: false }));
    expect(r.status, r.salida).toBe(0);
    const c = await clienteDe(url);
    try {
      expect((await filasSchemaMigrations(c)).map((f) => f.nombre)).toEqual(MIGRACIONES_REALES);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });
});

describe("MIGRADOR_BASELINE", () => {
  it("--marcar-aplicadas registra sin ejecutar", async () => {
    const { nombre, url } = await baseLimpia("base1");
    const r = correrMigrador(["--marcar-aplicadas"], entorno({ testUrl: url }));
    expect(r.status, r.salida).toBe(0);
    expect(r.salida).toMatch(/BASELINE/i);
    const c = await clienteDe(url);
    try {
      expect((await filasSchemaMigrations(c)).map((f) => f.nombre)).toEqual(MIGRACIONES_REALES);
      // No ejecuto una linea de SQL de las migraciones.
      expect(await existeRelacion(c, "clientes")).toBe(false);
      expect(await existeRelacion(c, "ventas")).toBe(false);
      const { rows } = await c.query("select proname from pg_proc where proname='crear_venta'");
      expect(rows.length).toBe(0);
      // Y despues no vuelve a intentar aplicarlas.
      const segunda = correrMigrador([], entorno({ testUrl: url }));
      expect(segunda.status, segunda.salida).toBe(0);
      expect(segunda.salida).toContain("Sin migraciones pendientes");
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("el baseline NO se dispara solo: la corrida normal ejecuta el SQL de verdad", async () => {
    const { nombre, url } = await baseLimpia("base2");
    const r = correrMigrador([], entorno({ testUrl: url }));
    expect(r.status, r.salida).toBe(0);
    expect(r.salida).not.toMatch(/BASELINE/i);
    expect(r.salida).not.toMatch(/marcada SIN correr/i);
    const c = await clienteDe(url);
    try {
      expect(await existeRelacion(c, "clientes")).toBe(true);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });

  it("--estado informa las pendientes y no aplica ni marca nada", async () => {
    const { nombre, url } = await baseLimpia("base3");
    const r = correrMigrador(["--estado"], entorno({ testUrl: url }));
    expect(r.status, r.salida).toBe(0);
    expect(r.salida).toMatch(/PENDIENTE/);
    for (const m of MIGRACIONES_REALES) expect(r.salida).toContain(m);
    const c = await clienteDe(url);
    try {
      const { rows } = await c.query("select count(*)::int as n from schema_migrations");
      expect(rows[0].n).toBe(0);
      expect(await existeRelacion(c, "clientes")).toBe(false);
    } finally {
      await c.end();
      await borrarBase(nombre);
      basesCreadas.delete(nombre);
    }
  });
});
