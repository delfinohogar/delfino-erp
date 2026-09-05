// TASK-003 — lista de precios en la venta e historial de costos, contra PostgreSQL.
// Invariantes: LISTA_PRECIO_OPCIONAL (P3), HISTORIAL_COSTOS_INMUTABLE (P5),
//              COSTO_MAESTRO_NO_AUTOMATICO (P5), HISTORICO_INMUTABLE (P4).
// Requiere: npm run db:up
//
// Reglas que gobiernan este archivo:
//
//  1. La divergencia con `js/compras.js` se prueba por COMPORTAMIENTO OBSERVABLE, no por
//     ausencia de mecanismo. "No hay trigger que pise el costo" es fácil de fingir y fácil de
//     romper sin que nadie se entere. Lo que se fija acá es: registro un costo de compra y
//     `productos.costo_referencia` SIGUE VALIENDO LO MISMO, con los dos números en el assert.
//  2. R20: cada propiedad viene con su MUTACIÓN. El assert que decide está factorizado en una
//     función, y la mutación demuestra que ESA MISMA función se pone roja. Si el test no
//     distingue "el maestro no se movió" de "el maestro se movió", no sirve.
//  3. Las mutaciones se aplican SOLO a la base de test; `recrearEsquema` las borra en el
//     beforeEach siguiente y el afterAll deja el esquema limpio pase lo que pase. Nunca se
//     toca el archivo de la migración: los tests no arreglan código de aplicación.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nuevoPool, recrearEsquema, seed, crearVenta, asientosDesbalanceados } from "./_helpers.mjs";
import { ivaCentavos, ivaTotalSumaDeRedondeados, aPesos } from "../../_aritmetica_iva.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const DIR_MIGRACIONES = join(RAIZ, "backend", "db", "migrations");
const ARCHIVOS = readdirSync(DIR_MIGRACIONES).filter((n) => n.toLowerCase().endsWith(".sql")).sort();
const sqlDe = (n) => readFileSync(join(DIR_MIGRACIONES, n), "utf8");
const SQL_0003 = sqlDe("0003_iva_y_destino_pago.sql");
const SQL_0004 = sqlDe("0004_precios_y_costos.sql");

let pool;
beforeAll(async () => { pool = await nuevoPool(); });
afterAll(async () => {
  await recrearEsquema(pool).catch(() => {});
  await pool?.end();
});
beforeEach(async () => {
  await recrearEsquema(pool);
  await seed(pool);
  // Producto 3 al 10,5 % (caso testigo de IVA de TASK-002) y producto 5 en modo promedio
  // (para el costeo). El seed compartido solo trae dos productos al 21 % en modo 'ultimo'.
  await pool.query(`
    insert into productos(id,sku,descripcion,costo_referencia,precio_venta,iva) values
      (3,'DEV-003','Libro 10,5%',0,5000.02,10.5);
    insert into productos(id,sku,descripcion,costo_referencia,precio_venta,costo_modo) values
      (5,'DEV-005','Aire acondicionado',900000,1300000,'promedio');
    insert into stock(producto_id,deposito_id,fisico,reservado) values (3,1,1000,0),(5,1,4,0);
    insert into medios_pago(id,nombre) values (3,'Tarjeta');
  `);
});

// --- utilidades del archivo -------------------------------------------------------------

const filas = async (sql, params = []) => (await pool.query(sql, params)).rows;
const una = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

/** Costo maestro del producto, leído crudo. Es el número que decide la tarea. */
const costoMaestro = async (id = 1) =>
  Number((await una("select costo_referencia::float as c from productos where id=$1", [id])).c);

/** Llama a registrar_costo() con los parámetros de la migración. */
async function registrarCosto({ producto = 1, costo, usuario = "u-compras", origen = "factura_compra",
                                motivo = "Factura A 0001-00012345", compra = null, fecha = null } = {}) {
  const { rows } = await pool.query(
    "select registrar_costo($1,$2,$3,$4,$5,$6,$7) as id",
    [producto, costo, usuario, origen, motivo, compra, fecha]);
  return Number(rows[0].id);
}

const historialDe = (producto = 1) => filas(
  `select id::int, producto_id::int, costo_anterior::float, costo_nuevo::float,
          fecha_operacion::text, usuario_uid, origen, compra_id::int, metodo_costeo, motivo
     from historial_costos where producto_id=$1 order by id`, [producto]);

/** Aplica las migraciones hasta `tope` inclusive, sobre un esquema recién creado. */
async function esquemaHasta(tope) {
  await pool.query("drop schema public cascade; create schema public;");
  for (const a of ARCHIVOS) {
    if (a > tope) break;
    await pool.query(sqlDe(a));
  }
}

/** Devuelve el error de PostgreSQL, con su SQLSTATE: sirve para probar que el rechazo viene
 *  de la BASE y no de una convención del llamador. */
async function errorDe(promesa) {
  try { await promesa; } catch (e) { return e; }
  throw new Error("se esperaba un error de PostgreSQL y la sentencia pasó");
}

/** Texto de una función tal como está escrito en una migración. */
function cuerpoDe(sql, nombre) {
  const desde = sql.indexOf(`create or replace function ${nombre}(`);
  expect(desde, `no encuentro ${nombre}`).toBeGreaterThan(-1);
  const hasta = sql.indexOf("language plpgsql;", desde);
  return sql.slice(desde, hasta + "language plpgsql;".length);
}

/** Sin comentarios y sin espacios de más: compara CÓDIGO, no formato ni prosa. */
const normalizar = (t) =>
  t.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").trim();

/** Sustituciones que fallan ruidosamente si el texto no está: una sustitución que no se aplicó
 *  daría un falso verde. Mismo criterio que el archivo de TASK-002. */
function reemplazar(sql, pares) {
  let out = sql;
  for (const [de, a] of pares) {
    expect(out.includes(de), `no está el texto ${JSON.stringify(de)}`).toBe(true);
    out = out.split(de).join(a);
  }
  return out;
}

const SNAPSHOT = {
  ventas: `select numero::int, fecha_operacion::text, cliente_id::int, vendedor_uid,
                  subtotal::float, descuento_global::float, iva_total::float, total::float,
                  monto_pendiente::float, tipo_entrega, idempotency_key
             from ventas order by numero`,
  items: `select venta_id::int, producto_id::int, cantidad::float, precio_unitario::float,
                 costo_unitario::float, descuento_pct::float, iva_pct::float, iva_monto::float,
                 subtotal::float from venta_items order by id`,
  pagos: `select venta_id::int, medio_id::int, monto::float, destino_contable
            from venta_pagos order by id`,
  asientos: `select numero::int, fecha_operacion::text, descripcion, origen_tipo, origen_id::int,
                    usuario_uid from asientos order by numero`,
  movimientos: `select a.numero::int as asiento, m.cuenta, m.debe::float, m.haber::float
                  from asiento_movimientos m join asientos a on a.id=m.asiento_id
                 order by m.id`,
  movStock: `select producto_id::int, deposito_id::int, delta::float, motivo, origen_tipo,
                    usuario_uid from movimientos_stock order by id`,
  reservas: `select producto_id::int, deposito_id::int, cantidad::float, cantidad_consumida::float,
                    cantidad_liberada::float, cantidad_pendiente::float, origen_tipo, venta_id::int
               from reservas order by id`,
  stock: `select producto_id::int, deposito_id::int, fisico::float, reservado::float,
                 disponible::float from stock order by producto_id, deposito_id`,
  contadores: `select nombre, ultimo::int from contadores order by nombre`,
  idem: `select clave, operacion, resultado from idempotency_keys order by clave`,
};

/** Todo lo observable que dejan atrás las ventas. Sin ids internos ni timestamps: lo que se
 *  compara es el RESULTADO, no el instante en que corrió. */
async function snapshotVentas() {
  const out = {};
  for (const [k, sql] of Object.entries(SNAPSHOT)) out[k] = (await pool.query(sql)).rows;
  return out;
}

/** Tres ventas que cubren las dos entregas, el saldo pendiente y los tres destinos de pago.
 *  NINGUNA lleva lista de precios: es el comportamiento de P3 que no puede cambiar. */
async function ventasDeReferenciaSinLista() {
  await crearVenta(1, pool, {
    items: [{ producto_id: 1, deposito_id: 1, cantidad: 2, precio_unitario: 850000, costo_unitario: 600000 }],
    pagos: [{ medio_id: 1, monto: 1700000, destino_contable: "caja" }],
    entrega: "inmediata", idem: "p3-ref-1", fecha: "2026-09-03",
  });
  await crearVenta(1, pool, {
    items: [{ producto_id: 2, deposito_id: 1, cantidad: 1, precio_unitario: 620000, costo_unitario: 430000 }],
    pagos: [{ medio_id: 2, monto: 100000, destino_contable: "banco" }],
    entrega: "domicilio", idem: "p3-ref-2", fecha: "2026-09-03",
  });
  await crearVenta(1, pool, {
    items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1000.01, costo_unitario: 0 }],
    // medio 2 y no 3: esta fixture también corre sobre el esquema 0001-0003 sembrado solo con
    // `seed()`, que trae dos medios de pago. El destino contable es lo que interesa acá.
    pagos: [{ medio_id: 2, monto: 1000.01, destino_contable: "cuentaPorCobrar" }],
    entrega: "inmediata", idem: "p3-ref-3", fecha: "2026-09-03",
  });
}

// =========================================================================================
describe("LISTA_PRECIO_OPCIONAL", () => {
  it("listas_precios tiene nombre único, regla_margen, regla_redondeo y activa", async () => {
    const cols = await filas(`
      select column_name, data_type, is_nullable, column_default
        from information_schema.columns where table_name='listas_precios'
       order by column_name`);
    const porNombre = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(Object.keys(porNombre)).toEqual(
      expect.arrayContaining(["nombre", "regla_margen", "regla_redondeo", "activa"]));
    expect(porNombre.nombre.data_type).toBe("text");
    expect(porNombre.nombre.is_nullable).toBe("NO");
    expect(porNombre.regla_margen.data_type).toBe("numeric");
    expect(porNombre.regla_redondeo.data_type).toBe("text");
    expect(porNombre.activa.data_type).toBe("boolean");
    expect(porNombre.activa.is_nullable).toBe("NO");
    expect(porNombre.activa.column_default).toMatch(/true/);

    // El único de `nombre`, probado por comportamiento y no por catálogo.
    await pool.query("insert into listas_precios(nombre) values ('Mayorista')");
    const e = await errorDe(pool.query("insert into listas_precios(nombre) values ('Mayorista')"));
    expect(e.code).toBe("23505"); // unique_violation, de la base
    // `activa` arranca en true y las reglas quedan nulas hasta que Gastón las defina.
    const l = await una("select activa, regla_margen, regla_redondeo from listas_precios");
    expect(l).toEqual({ activa: true, regla_margen: null, regla_redondeo: null });
  });

  it("venta_items.lista_precio_id es nullable, bigint y FK a listas_precios(id)", async () => {
    const c = await una(`
      select data_type, is_nullable, column_default from information_schema.columns
       where table_name='venta_items' and column_name='lista_precio_id'`);
    expect(c.data_type).toBe("bigint");
    expect(c.is_nullable).toBe("YES");
    expect(c.column_default).toBe(null); // sin default: nadie inventa una lista "general"

    const fk = await filas(`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid='venta_items'::regclass and contype='f'
         and confrelid='listas_precios'::regclass`);
    expect(fk).toHaveLength(1);
    expect(fk[0].def).toMatch(/FOREIGN KEY \(lista_precio_id\) REFERENCES listas_precios\(id\)/);

    // Y la FK se cumple en la base: una lista inexistente se rechaza.
    await crearVenta(1, pool, { idem: "fk-1" });
    const e = await errorDe(pool.query("update venta_items set lista_precio_id = 999999"));
    expect(e.code).toBe("23503"); // foreign_key_violation
  });

  it("P3 · una venta SIN lista da exactamente el mismo resultado que antes de 0004", async () => {
    // Regresión de verdad: se corren las MISMAS tres ventas contra el esquema 0001-0003 (el
    // de antes de esta migración) y contra el esquema completo, y se comparan los dos
    // resultados observables campo por campo. Si 0004 cambió algo del camino de la venta sin
    // lista, este assert lo muestra.
    await esquemaHasta("0003_iva_y_destino_pago.sql");
    await seed(pool);
    await ventasDeReferenciaSinLista();
    const antesDe0004 = await snapshotVentas();

    await recrearEsquema(pool);
    await seed(pool);
    await ventasDeReferenciaSinLista();
    const conLa0004 = await snapshotVentas();

    expect(conLa0004).toEqual(antesDe0004);
    // Control de que el snapshot mira algo: tres ventas, tres asientos, stock movido.
    expect(conLa0004.ventas).toHaveLength(3);
    expect(conLa0004.asientos).toHaveLength(3);
    expect(conLa0004.stock).toContainEqual(
      { producto_id: 1, deposito_id: 1, fisico: 2, reservado: 0, disponible: 2 });
    expect(conLa0004.stock).toContainEqual(
      { producto_id: 2, deposito_id: 1, fisico: 1, reservado: 1, disponible: 0 });
    // Y la columna nueva quedó nula en todas las líneas.
    const li = await filas("select lista_precio_id from venta_items");
    expect(li).toHaveLength(3);
    expect(li.every((r) => r.lista_precio_id === null)).toBe(true);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("P3 · una venta CON lista guarda la referencia y NO deriva el precio de la lista", async () => {
    // Lista con una regla absurda a propósito: si algo del esquema calculara precios a partir
    // de la lista, el precio no sería 1234,56 y este test lo mostraría. P3 dice que nada lo
    // calcula: el precio sigue saliendo de lo que manda el llamador.
    const { id } = await una(
      `insert into listas_precios(nombre,regla_margen,regla_redondeo)
       values ('Mayorista', 500.0000, 'terminacion_9') returning id::int as id`);
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1234.56,
                costo_unitario: 600000, lista_precio_id: id }],
      pagos: [{ medio_id: 1, monto: 1234.56, destino_contable: "caja" }],
      idem: "con-lista",
    });
    const it0 = await una(
      `select lista_precio_id::int as lista, precio_unitario::float as p, subtotal::float as s,
              iva_pct::float as iva_pct, iva_monto::float as iva from venta_items`);
    expect(it0.lista).toBe(id);
    expect(it0.p).toBe(1234.56);   // el precio es el del llamador, no el de la regla
    expect(it0.s).toBe(1234.56);
    expect(it0.iva).toBe(aPesos(ivaCentavos(123456, 21)));
    const v = await una("select total::float as t from ventas");
    expect(v.t).toBe(1234.56);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("P3 · la lista es POR LÍNEA: dos líneas de la misma venta pueden traer listas distintas o ninguna", async () => {
    const a = (await una("insert into listas_precios(nombre) values ('Mostrador') returning id::int as id")).id;
    const b = (await una("insert into listas_precios(nombre) values ('Promo') returning id::int as id")).id;
    await crearVenta(1, pool, {
      items: [
        { producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0, lista_precio_id: a },
        { producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 200, costo_unitario: 0, lista_precio_id: b },
        { producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 300, costo_unitario: 0 },
      ],
      pagos: [{ medio_id: 1, monto: 600, destino_contable: "caja" }],
      idem: "tres-lineas",
    });
    const li = await filas(
      "select producto_id::int as p, lista_precio_id::int as lista from venta_items order by id");
    expect(li).toEqual([
      { p: 1, lista: a }, { p: 3, lista: b }, { p: 3, lista: null },
    ]);
  });

  it("P3 · una lista inactiva no bloquea la venta, y una lista usada no se puede borrar", async () => {
    const id = (await una(
      "insert into listas_precios(nombre,activa) values ('Vieja',false) returning id::int as id")).id;
    // Nada en el esquema valida `activa`: P3 no reimplementa listas de precios. Se documenta.
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 100,
                costo_unitario: 0, lista_precio_id: id }],
      pagos: [{ medio_id: 1, monto: 100, destino_contable: "caja" }],
      idem: "lista-inactiva",
    });
    expect((await una("select lista_precio_id::int as l from venta_items")).l).toBe(id);
    // La FK sin ON DELETE protege el histórico: la lista referenciada no se borra.
    const e = await errorDe(pool.query("delete from listas_precios where id=$1", [id]));
    expect(e.code).toBe("23503");
    expect((await una("select count(*)::int as n from listas_precios")).n).toBe(1);
  });

  it("MUTACIÓN R20 · con lista_precio_id NOT NULL la venta sin lista falla y el test de P3 se pone rojo", async () => {
    // Es exactamente la forma en que P3 se rompería sin que nadie lo note: alguien decide que
    // toda línea "debería" tener lista. Con la columna en NOT NULL, la venta de siempre deja
    // de poder registrarse.
    await pool.query("alter table venta_items alter column lista_precio_id set not null");
    const e = await errorDe(ventasDeReferenciaSinLista());
    expect(e.code).toBe("23502"); // not_null_violation
    expect((await una("select count(*)::int as n from ventas")).n).toBe(0);
    // Y con lista sí anda: la mutación afecta al caso de P3, no a todo.
    const id = (await una("insert into listas_precios(nombre) values ('X') returning id::int as id")).id;
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 100,
                costo_unitario: 0, lista_precio_id: id }],
      pagos: [{ medio_id: 1, monto: 100 }], idem: "mut-notnull",
    });
    expect((await una("select count(*)::int as n from ventas")).n).toBe(1);
  });
});

// =========================================================================================
describe("HISTORIAL_COSTOS_INMUTABLE", () => {
  /** El assert que decide la inmutabilidad, factorizado para poder demostrar que se pone
   *  rojo cuando el trigger no está. Prueba por SQL DIRECTO: nunca a través de una función
   *  que podría estar filtrando. */
  async function assertUpdateRechazado() {
    const antes = await historialDe(1);
    expect(antes.length, "hace falta al menos una fila para probar el UPDATE").toBeGreaterThan(0);
    const e = await errorDe(pool.query("update historial_costos set costo_nuevo = 1 where id=$1", [antes[0].id]));
    expect(e.message).toMatch(/HISTORIAL_COSTOS_INMUTABLE/);
    expect(e.code).toBe("23001"); // restrict_violation: el rechazo es de la base
    expect(await historialDe(1), "la fila tiene que seguir igual").toEqual(antes);
  }

  async function assertDeleteRechazado() {
    const antes = await historialDe(1);
    expect(antes.length).toBeGreaterThan(0);
    const e = await errorDe(pool.query("delete from historial_costos where id=$1", [antes[0].id]));
    expect(e.message).toMatch(/HISTORIAL_COSTOS_INMUTABLE/);
    expect(e.code).toBe("23001");
    expect(await historialDe(1)).toEqual(antes);
  }

  async function assertTruncateRechazado() {
    const antes = await historialDe(1);
    expect(antes.length).toBeGreaterThan(0);
    const e = await errorDe(pool.query("truncate table historial_costos"));
    expect(e.message).toMatch(/HISTORIAL_COSTOS_INMUTABLE/);
    expect(e.code).toBe("23001");
    expect(await historialDe(1)).toEqual(antes);
  }

  it("la tabla tiene los campos que pide P5, con el CHECK de origen", async () => {
    const cols = Object.fromEntries((await filas(`
      select column_name, data_type, is_nullable from information_schema.columns
       where table_name='historial_costos'`)).map((c) => [c.column_name, c]));
    for (const c of ["producto_id", "costo_anterior", "costo_nuevo", "usuario_uid",
                     "origen", "compra_id", "metodo_costeo", "motivo"]) {
      expect(Object.keys(cols), `falta la columna ${c}`).toContain(c);
    }
    expect(cols.producto_id.is_nullable).toBe("NO");
    expect(cols.costo_anterior.data_type).toBe("numeric");
    expect(cols.costo_nuevo.data_type).toBe("numeric");
    expect(cols.usuario_uid.is_nullable).toBe("NO");
    expect(cols.motivo.is_nullable).toBe("NO");
    expect(cols.metodo_costeo.is_nullable).toBe("NO");
    expect(cols.compra_id.is_nullable, "la compra relacionada es nullable").toBe("YES");
    // Fecha: hay una fecha de operación (date) y el instante real de auditoría.
    expect(Object.keys(cols)).toContain("fecha_operacion");
    expect(cols.fecha_operacion.data_type).toBe("date");
    // producto: FK real a productos.
    const fk = await filas(`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid='historial_costos'::regclass and contype='f'`);
    expect(fk.map((f) => f.def).join(" ")).toMatch(/FOREIGN KEY \(producto_id\) REFERENCES productos\(id\)/);
  });

  it("origen solo admite manual y factura_compra, y lo hace cumplir la base", async () => {
    const chk = (await filas(`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid='historial_costos'::regclass and contype='c'`)).map((r) => r.def).join(" | ");
    expect(chk).toContain("manual");
    expect(chk).toContain("factura_compra");

    await registrarCosto({ costo: 700000, origen: "manual", compra: null });
    const e = await errorDe(pool.query(`
      insert into historial_costos(producto_id,costo_anterior,costo_nuevo,usuario_uid,origen,metodo_costeo,motivo)
      values (1,1,2,'u','ajuste_masivo','ultimo','probando')`));
    expect(e.code).toBe("23514"); // check_violation
    // Y un cambio manual no puede colgar de una factura de compra.
    const e2 = await errorDe(registrarCosto({ costo: 700000, origen: "manual", compra: 77 }));
    expect(e2.code).toBe("23514");
    expect(e2.message).toMatch(/compra_solo_si_viene_de_factura/);
  });

  it("un UPDATE por SQL directo se rechaza y la fila sigue existiendo igual", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    await assertUpdateRechazado();
  });

  it("un UPDATE que no cambia nada también se rechaza: el trigger es BEFORE, no compara valores", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    const antes = await historialDe(1);
    const e = await errorDe(pool.query("update historial_costos set motivo = motivo"));
    expect(e.code).toBe("23001");
    expect(await historialDe(1)).toEqual(antes);
  });

  it("un UPDATE masivo sin WHERE se rechaza y las tres filas quedan intactas", async () => {
    await registrarCosto({ costo: 700000, compra: 1 });
    await registrarCosto({ costo: 710000, compra: 2 });
    await registrarCosto({ costo: 720000, compra: 3 });
    const antes = await historialDe(1);
    expect(antes).toHaveLength(3);
    const e = await errorDe(pool.query("update historial_costos set costo_nuevo = costo_nuevo + 1"));
    expect(e.code).toBe("23001");
    expect(await historialDe(1)).toEqual(antes);
  });

  it("un DELETE por SQL directo se rechaza, con y sin WHERE, y no borra nada", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    await registrarCosto({ costo: 716000, compra: 78 });
    await assertDeleteRechazado();
    const antes = await historialDe(1);
    const e = await errorDe(pool.query("delete from historial_costos"));
    expect(e.code).toBe("23001");
    expect(await historialDe(1)).toEqual(antes);
    expect(antes).toHaveLength(2);
  });

  it("un TRUNCATE se rechaza y la tabla conserva sus filas", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    await assertTruncateRechazado();
  });

  it("el rechazo aborta la transacción entera: no queda ni lo que se había escrito antes", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    const antes = await historialDe(1);
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query("select registrar_costo(1,800000,'u','factura_compra','otra',99,null)");
      const e = await errorDe(cli.query("update historial_costos set costo_nuevo=0 where id=$1", [antes[0].id]));
      expect(e.code).toBe("23001");
      await cli.query("rollback");
    } finally { cli.release(); }
    // La fila nueva de la transacción abortada tampoco quedó.
    expect(await historialDe(1)).toEqual(antes);
  });

  it("MUTACIÓN R20 · sin el trigger de UPDATE la fila se puede pisar y assertUpdateRechazado se pone rojo", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    await pool.query("drop trigger historial_costos_sin_update on historial_costos");
    // El mismo assert que decide el test real, ahora rojo.
    await expect(assertUpdateRechazado()).rejects.toThrow();
    // Y se ve el daño: el costo histórico quedó reescrito.
    expect((await historialDe(1))[0].costo_nuevo).toBe(1);
  });

  it("MUTACIÓN R20 · sin los triggers de DELETE y TRUNCATE el historial se borra y los asserts se ponen rojos", async () => {
    await registrarCosto({ costo: 715000, compra: 77 });
    await pool.query("drop trigger historial_costos_sin_delete on historial_costos");
    await expect(assertDeleteRechazado()).rejects.toThrow();
    expect(await historialDe(1)).toHaveLength(0);

    await registrarCosto({ costo: 716000, compra: 78 });
    await pool.query("drop trigger historial_costos_sin_truncate on historial_costos");
    await expect(assertTruncateRechazado()).rejects.toThrow();
    expect(await historialDe(1)).toHaveLength(0);
  });
});

// =========================================================================================
describe("COSTO_MAESTRO_NO_AUTOMATICO", () => {
  // Los tres números del caso: el maestro vigente, el de la factura y el promedio ponderado
  // que `js/compras.js` habría dejado. Calculados acá, no leídos de la base.
  const MAESTRO = 600000;      // productos.costo_referencia del seed, producto 1
  const DE_FACTURA = 715000;   // el costo que trae la factura de compra
  const STOCK_ANTERIOR = 5;    // stock del seed
  const CANTIDAD_COMPRADA = 3;
  // js/compras.js:103-119, modo promedio:
  const PROMEDIO_DEL_ERP =
    (STOCK_ANTERIOR * MAESTRO + CANTIDAD_COMPRADA * DE_FACTURA) / (STOCK_ANTERIOR + CANTIDAD_COMPRADA);

  /** EL ASSERT QUE DECIDE LA TAREA. Registra una compra con un costo distinto y exige que el
   *  costo maestro siga valiendo exactamente lo mismo, con los dos números explícitos.
   *  Está factorizado para que las mutaciones puedan demostrar que se pone rojo. */
  async function assertCompraNoPisaElMaestro() {
    const antes = await costoMaestro(1);
    expect(antes, "el punto de partida del caso").toBe(MAESTRO);

    const id = await registrarCosto({
      producto: 1, costo: DE_FACTURA, origen: "factura_compra", compra: 77,
      motivo: "Factura A 0001-00012345", usuario: "u-compras",
    });
    expect(id).toBeGreaterThan(0);

    const despues = await costoMaestro(1);
    expect(despues, "productos.costo_referencia NO se mueve por una compra (P5)").toBe(MAESTRO);
    expect(despues).not.toBe(DE_FACTURA);          // lo que haría js/compras.js en modo 'ultimo'
    expect(despues).not.toBe(PROMEDIO_DEL_ERP);    // lo que haría js/compras.js en modo promedio
    expect(despues).toBe(antes);

    // Y la constancia quedó: la compra no se pierde, se registra.
    const h = await historialDe(1);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      producto_id: 1, costo_anterior: MAESTRO, costo_nuevo: DE_FACTURA,
      usuario_uid: "u-compras", origen: "factura_compra", compra_id: 77,
      metodo_costeo: "ultimo", motivo: "Factura A 0001-00012345",
    });
    return h[0];
  }

  it("DIVERGENCIA CON EL ERP · una compra a 715000 registra la fila y deja el maestro en 600000", async () => {
    const fila = await assertCompraNoPisaElMaestro();
    // Los tres números, dichos entero: el ERP habría dejado uno de los dos últimos.
    expect(await costoMaestro(1)).toBe(600000);
    expect(fila.costo_nuevo).toBe(715000);
    expect(PROMEDIO_DEL_ERP).toBe(643125);
    expect(await costoMaestro(1)).not.toBe(643125);
  });

  it("tres compras seguidas: el maestro sigue en 600000 y ninguna fila encadena con la anterior", async () => {
    await registrarCosto({ costo: 700000, compra: 1 });
    await registrarCosto({ costo: 715000, compra: 2 });
    await registrarCosto({ costo: 690000, compra: 3 });
    expect(await costoMaestro(1)).toBe(MAESTRO);
    const h = await historialDe(1);
    expect(h.map((f) => f.costo_anterior)).toEqual([600000, 600000, 600000]);
    expect(h.map((f) => f.costo_nuevo)).toEqual([700000, 715000, 690000]);
  });

  it("en modo promedio tampoco pondera nada: guarda el método y deja el maestro quieto", async () => {
    expect((await una("select costo_modo from productos where id=5")).costo_modo).toBe("promedio");
    await registrarCosto({ producto: 5, costo: 1000000, compra: 5 });
    expect(await costoMaestro(5)).toBe(900000);
    const h = await historialDe(5);
    expect(h[0]).toMatchObject({ costo_anterior: 900000, costo_nuevo: 1000000, metodo_costeo: "promedio" });
    // El promedio ponderado que el ERP habría escrito (stock 4 + compra) no aparece en ningún lado.
    expect(await costoMaestro(5)).not.toBe((4 * 900000 + 1 * 1000000) / 5);
  });

  it("un cambio de origen manual tampoco mueve el maestro por sí solo", async () => {
    await registrarCosto({ costo: 650000, origen: "manual", motivo: "Revisión de lista de proveedor" });
    expect(await costoMaestro(1)).toBe(MAESTRO);
    expect((await historialDe(1))[0]).toMatchObject({ origen: "manual", compra_id: null, costo_nuevo: 650000 });
  });

  it("registrar_costo() no toca stock, ni ventas, ni asientos: solo escribe el historial", async () => {
    await crearVenta(1, pool, { idem: "antes-del-costo" });
    const antes = await snapshotVentas();
    await registrarCosto({ costo: DE_FACTURA, compra: 77 });
    expect(await snapshotVentas()).toEqual(antes);
  });

  it("HISTORICO_INMUTABLE · registrar un costo después de vender no cambia la línea ya vendida", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 850000, costo_unitario: 600000 }],
      pagos: [{ medio_id: 1, monto: 850000 }], idem: "hist-1",
    });
    const linea = await una("select costo_unitario::float as c, subtotal::float as s from venta_items");
    await registrarCosto({ costo: DE_FACTURA, compra: 77 });
    expect(await una("select costo_unitario::float as c, subtotal::float as s from venta_items")).toEqual(linea);
    expect(linea.c).toBe(600000);
  });

  it("el catálogo confirma que no hay ningún mecanismo automático sobre productos", async () => {
    // Verificación propia, independiente de verificar_sin_recalculo_de_costo(): se listan TODOS
    // los triggers no internos del esquema público y se comparan contra la lista esperada. Un
    // trigger nuevo en cualquier tabla aparece acá y obliga a revisarlo.
    const trg = await filas(`
      select c.relname as tabla, t.tgname as trigger from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and not t.tgisinternal order by 1,2`);
    expect(trg).toEqual([
      { tabla: "asiento_movimientos", trigger: "asiento_balanceado_trg" },
      { tabla: "historial_costos", trigger: "historial_costos_sin_delete" },
      { tabla: "historial_costos", trigger: "historial_costos_sin_truncate" },
      { tabla: "historial_costos", trigger: "historial_costos_sin_update" },
      { tabla: "pedido_items", trigger: "pedido_items_editable" },
    ]);
    // Ninguna función del esquema escribe el costo maestro.
    const escriben = await filas(`
      select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.prosrc ~* 'costo_referencia'
         and p.prosrc ~* 'update[[:space:]]+productos'`);
    expect(escriben).toEqual([]);
    // Control secundario: la función de verificación de la migración dice lo mismo.
    expect(await filas("select * from verificar_sin_recalculo_de_costo()")).toEqual([]);
  });

  it("MUTACIÓN R20 · un trigger que pisa el maestro al registrar el costo pone rojo el assert que decide", async () => {
    // Esta es la mutación del punto 2: se planta el comportamiento de js/compras.js como
    // trigger AFTER INSERT sobre el historial. Es la forma más silenciosa de reintroducirlo.
    await pool.query(`
      create or replace function mut_pisar_costo() returns trigger as $mut$
      begin
        update productos set costo_referencia = new.costo_nuevo where id = new.producto_id;
        return null;
      end $mut$ language plpgsql;
      create trigger mut_pisar_costo_trg after insert on historial_costos
        for each row execute function mut_pisar_costo();`);

    await expect(assertCompraNoPisaElMaestro()).rejects.toThrow();
    // El daño, con los dos números: el maestro se movió a lo que dijo la factura.
    expect(await costoMaestro(1)).toBe(715000);
    expect(await costoMaestro(1)).not.toBe(600000);
    // Las dos verificaciones de catálogo también se ponen rojas.
    const trg = await filas(`
      select t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
       where c.relname='historial_costos' and not t.tgisinternal and t.tgname='mut_pisar_costo_trg'`);
    expect(trg).toHaveLength(1);
    expect(await filas("select * from verificar_sin_recalculo_de_costo()"))
      .toContainEqual({ objeto: "mut_pisar_costo", tipo: "funcion" });
  });

  it("MUTACIÓN R20 · registrar_costo() con el UPDATE de js/compras.js adentro también se caza", async () => {
    // La otra vía: el recálculo vuelve dentro de la propia función, como está hoy en el ERP.
    await pool.query(reemplazar(cuerpoDe(SQL_0004, "registrar_costo"), [
      ["  -- P5: el costo maestro queda como estaba. Acá NO va un UPDATE de productos.\n  return v_id;",
       "  update productos set costo_referencia = round(p_costo_nuevo,2) where id = p_producto_id;\n  return v_id;"],
    ]));
    await expect(assertCompraNoPisaElMaestro()).rejects.toThrow();
    expect(await costoMaestro(1)).toBe(715000);
    expect(await filas("select * from verificar_sin_recalculo_de_costo()"))
      .toContainEqual({ objeto: "registrar_costo", tipo: "funcion" });
  });

  it("MUTACIÓN R20 · un centavo de más en el maestro también se caza: el assert es exacto", async () => {
    await pool.query(`
      create or replace function mut_centavo() returns trigger as $mut$
      begin
        update productos set costo_referencia = costo_referencia + 0.01 where id = new.producto_id;
        return null;
      end $mut$ language plpgsql;
      create trigger mut_centavo_trg after insert on historial_costos
        for each row execute function mut_centavo();`);
    await expect(assertCompraNoPisaElMaestro()).rejects.toThrow();
    expect(await costoMaestro(1)).toBe(600000.01);
  });
});

// =========================================================================================
// crear_venta() está redeclarada en 0004. Es la tercera copia de la función en el repositorio
// (0002, 0003, 0004) y un riesgo de divergencia: si alguien arregla un bug en una copia y no
// en las otras, el resultado contable cambia según qué migración corrió última. Este bloque
// fija que la de 0004 sigue cumpliendo TODO lo de TASK-002.
describe("CREAR_VENTA_0004 · TASK-002 sigue en pie sobre la redeclaración", () => {
  // Los tres agregados de 0004 sobre el texto de 0003, escritos una sola vez.
  const AGREGADOS_0004 = [
    [",\n      'lista_precio_id', (it->>'lista_precio_id')::bigint);   -- 0004: NULL si no vino",
     ");"],
    ["descuento_pct,iva_pct,iva_monto,subtotal,lista_precio_id)",
     "descuento_pct,iva_pct,iva_monto,subtotal)"],
    ["(it->>'iva_monto')::numeric,(it->>'subtotal')::numeric,\n              (it->>'lista_precio_id')::bigint)                 -- 0004",
     "(it->>'iva_monto')::numeric,(it->>'subtotal')::numeric)"],
  ];

  it("la de 0004 es idéntica a la de 0003 salvo los tres agregados de la lista de precios", async () => {
    const c0003 = normalizar(cuerpoDe(SQL_0003, "crear_venta"));
    const c0004 = cuerpoDe(SQL_0004, "crear_venta");
    expect(normalizar(c0004), "las dos copias no pueden ser ya iguales").not.toBe(c0003);
    // reemplazar() falla si algún texto no está: si el implementador cambió otra cosa además
    // de las tres líneas, o si movió una, este test lo muestra.
    const revertida = normalizar(reemplazar(c0004, AGREGADOS_0004));
    expect(revertida, "0004 diverge de 0003 en algo más que la lista de precios").toBe(c0003);
  });

  it("lo que corre en la BASE es la definición de 0004, y también coincide con 0003 al revertir", async () => {
    // No alcanza con comparar archivos: lo que decide es el cuerpo desplegado.
    const { def } = await una("select pg_get_functiondef('crear_venta'::regproc) as def");
    expect(def).toContain("lista_precio_id");
    const cuerpo = def.slice(def.indexOf("AS $function$") + "AS $function$".length,
                             def.lastIndexOf("$function$"));
    const decl0004 = cuerpoDe(SQL_0004, "crear_venta");
    const soloCuerpo0004 = decl0004.slice(decl0004.indexOf("$$") + 2, decl0004.lastIndexOf("$$"));
    expect(normalizar(cuerpo)).toBe(normalizar(soloCuerpo0004));
  });

  const MIXTA = {
    items: [
      { producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1000.01, costo_unitario: 0 },
      { producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 5000.02, costo_unitario: 0 },
    ],
    pagos: [{ medio_id: 1, monto: 6000.03, destino_contable: "caja" }],
  };
  const imputado = async (cuenta, lado = "haber") => Number((await una(
    `select coalesce(sum(${lado}),0)::float as m from asiento_movimientos where cuenta=$1`, [cuenta])).m);

  it("IVA_DISCRIMINADO · el mismo centavo a 2.1.2 que en TASK-002 (648,68, no 648,67)", async () => {
    await crearVenta(1, pool, MIXTA);
    const esperado = aPesos(ivaTotalSumaDeRedondeados([
      { cantidad: 1, precio_unitario: 1000.01, alicuota: 21 },
      { cantidad: 1, precio_unitario: 5000.02, alicuota: 10.5 },
    ]));
    expect(esperado).toBe(648.68);
    const v = await una("select iva_total::float as iva, total::float as t from ventas");
    expect(v.iva).toBe(648.68);
    expect(v.t).toBe(6000.03);
    expect(await imputado("2.1.2")).toBe(648.68);
    expect(await imputado("2.1.2")).not.toBe(648.67);
    expect(await imputado("4.1")).toBe(Math.round((6000.03 - 648.68) * 100) / 100);
    expect(await imputado("4.1")).toBe(5351.35);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
    const li = await filas("select iva_pct::float as p, iva_monto::float as m from venta_items order by id");
    expect(li).toEqual([
      { p: 21, m: aPesos(ivaCentavos(100001, 21)) },
      { p: 10.5, m: aPesos(ivaCentavos(500002, 10.5)) },
    ]);
  });

  it("IMPUTACION_PAGOS · caja y banco a 1.1.1, cuentaPorCobrar a 1.1.5, el pendiente a 1.1.2", async () => {
    await crearVenta(1, pool, {
      items: MIXTA.items,
      pagos: [
        { medio_id: 1, monto: 1000, destino_contable: "caja" },
        { medio_id: 2, monto: 2000, destino_contable: "banco" },
        { medio_id: 3, monto: 1500, destino_contable: "cuentaPorCobrar" },
      ],
      idem: "0004-repartida",
    });
    expect(await filas("select cuenta, debe::float, haber::float from asiento_movimientos order by id"))
      .toEqual([
        { cuenta: "1.1.1", debe: 3000, haber: 0 },
        { cuenta: "1.1.5", debe: 1500, haber: 0 },
        { cuenta: "1.1.2", debe: 1500.03, haber: 0 },
        { cuenta: "4.1", debe: 0, haber: 5351.35 },
        { cuenta: "2.1.2", debe: 0, haber: 648.68 },
      ]);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("FECHA_OPERACION_LOCAL · la fecha no depende del TimeZone de la sesión", async () => {
    const fechaArgentina = () => new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const antes = fechaArgentina();
    const obtenidas = {};
    // +14 y −12 están 26 horas separadas: nunca comparten fecha. Si la fecha saliera de la
    // sesión, estas dos darían distinto a cualquier hora del día.
    for (const zona of ["UTC", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      const cli = await pool.connect();
      try {
        await cli.query(`set time zone '${zona}'`);
        const id = await crearVenta(1, cli, {
          items: [{ producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
          pagos: [{ medio_id: 1, monto: 100 }], fecha: null, idem: `0004-tz-${zona}`,
        });
        obtenidas[zona] = (await (await cli.query(
          "select fecha_operacion::text as f from ventas where id=$1", [id]))).rows[0].f;
      } finally { await cli.query("reset time zone").catch(() => {}); cli.release(); }
    }
    expect(new Set(Object.values(obtenidas)).size, "la fecha no puede depender de la sesión").toBe(1);
    expect([antes, fechaArgentina()]).toContain(Object.values(obtenidas)[0]);
  });

  it("la lista de precios no altera la contabilidad: con lista, el asiento es el mismo", async () => {
    const id = (await una("insert into listas_precios(nombre) values ('Mostrador') returning id::int as id")).id;
    await crearVenta(1, pool, MIXTA);
    const sinLista = await filas("select cuenta, debe::float, haber::float from asiento_movimientos order by id");
    await recrearEsquema(pool); await seed(pool);
    await pool.query(`insert into productos(id,sku,descripcion,costo_referencia,precio_venta,iva)
                      values (3,'DEV-003','Libro 10,5%',0,5000.02,10.5);
                      insert into stock(producto_id,deposito_id,fisico,reservado) values (3,1,1000,0);
                      insert into listas_precios(id,nombre) values (${id},'Mostrador');`);
    await crearVenta(1, pool, {
      items: MIXTA.items.map((i) => ({ ...i, lista_precio_id: id })),
      pagos: MIXTA.pagos, idem: "0004-con-lista",
    });
    expect(await filas("select cuenta, debe::float, haber::float from asiento_movimientos order by id"))
      .toEqual(sinLista);
    expect(await filas("select lista_precio_id::int as l from venta_items order by id"))
      .toEqual([{ l: id }, { l: id }]);
  });
});
