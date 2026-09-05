// TASK-002 — IVA discriminado, destino contable del pago y fecha local, contra PostgreSQL.
// Invariantes: IVA_DISCRIMINADO, IMPUTACION_PAGOS, FECHA_OPERACION_LOCAL, CONTABILIDAD.
// Requiere: npm run db:up
//
// Regla que gobierna este archivo (R20, DECISIONS 2026-09-04): un test verde que no
// discrimina es peor que no tener test. Por eso:
//   - los montos esperados se calculan en JS con aritmética entera exacta
//     (tests/_aritmetica_iva.mjs), NO se leen de venta_items ni de verificar_iva_imputado():
//     eso sería verificar la implementación contra sí misma;
//   - cada propiedad viene con su MUTACIÓN: se rompe a propósito y se muestra el rojo. Las
//     mutaciones se aplican SOLO a la base de test (recrearEsquema las borra en el
//     beforeEach siguiente); nunca al archivo de la migración.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nuevoPool, recrearEsquema, seed, crearVenta, asientosDesbalanceados,
} from "./_helpers.mjs";
import {
  ivaCentavos, subtotalCentavos, ivaTotalSumaDeRedondeados, ivaTotalRedondeoAlFinal, aPesos,
} from "../../_aritmetica_iva.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const SQL_0003 = readFileSync(
  join(RAIZ, "backend", "db", "migrations", "0003_iva_y_destino_pago.sql"), "utf8");

let pool;
beforeAll(async () => { pool = await nuevoPool(); });
afterAll(async () => {
  // Sin residuos: este archivo instala versiones MUTADAS de crear_venta() y fecha_local() en
  // delfino_test. Se deja el esquema limpio pase lo que pase, sin depender de que otro
  // archivo corra después.
  await recrearEsquema(pool).catch(() => {});
  await pool?.end();
});
beforeEach(async () => {
  await recrearEsquema(pool);
  await seed(pool);
  // Producto 3 al 10,5 % y producto 4 exento, con stock de sobra. El seed compartido solo
  // trae dos productos al 21 % (default de la columna) y poco stock.
  await pool.query(`
    insert into productos(id,sku,descripcion,costo_referencia,precio_venta,iva) values
      (3,'DEV-003','Libro 10,5%',0,5000.02,10.5),
      (4,'DEV-004','Exento',0,100,0);
    insert into stock(producto_id,deposito_id,fisico,reservado) values (3,1,1000,0),(4,1,1000,0);
    insert into medios_pago(id,nombre) values (3,'Tarjeta');
    update stock set fisico = 1000 where producto_id = 1;
  `);
});

// --- utilidades del archivo -------------------------------------------------------------

const movimientos = async (ejecutor = pool) =>
  (await ejecutor.query("select cuenta, debe::float, haber::float from asiento_movimientos order by id")).rows;

/** Monto imputado a una cuenta, por el haber o por el debe. Vía independiente del cálculo. */
async function imputado(cuenta, lado = "haber") {
  const { rows } = await pool.query(
    `select coalesce(sum(${lado}),0)::float as m from asiento_movimientos where cuenta=$1`, [cuenta]);
  return rows[0].m;
}

/** Extrae el texto de crear_venta() de la migración, le aplica sustituciones y lo instala
 *  en la base de TEST. Si alguna sustitución no encuentra su texto, falla: una mutación que
 *  no se aplicó daría un falso verde. */
async function mutarCrearVenta(reemplazos) {
  const desde = SQL_0003.indexOf("create or replace function crear_venta(");
  const hasta = SQL_0003.indexOf("language plpgsql;", desde);
  expect(desde, "no encuentro crear_venta en 0003").toBeGreaterThan(-1);
  let sql = SQL_0003.slice(desde, hasta + "language plpgsql;".length);
  for (const [de, a] of reemplazos) {
    expect(sql.includes(de), `la mutación no aplica: no está el texto ${JSON.stringify(de)}`).toBe(true);
    sql = sql.split(de).join(a);
  }
  await pool.query(sql);
}

/** Fecha del día en Argentina, calculada por Node, sin pasar por PostgreSQL. */
const fechaArgentina = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);

/** Crea una venta SIN fecha explícita con la sesión en la zona horaria indicada. */
async function fechaDeVentaEnZona(zona, idem) {
  const cli = await pool.connect();
  try {
    await cli.query(`set time zone '${zona}'`);
    const id = await crearVenta(1, cli, {
      items: [{ producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
      pagos: [{ medio_id: 1, monto: 100 }], fecha: null, idem,
    });
    const { rows } = await cli.query("select fecha_operacion::text as f from ventas where id=$1", [id]);
    return rows[0].f;
  } finally { await cli.query("reset time zone").catch(() => {}); cli.release(); }
}

/** Zonas extremas: +14 y −12 están 26 horas separadas, así que NUNCA comparten fecha. Sea
 *  cual sea la hora en que corra la suite, la fecha argentina difiere de al menos una de las
 *  dos. Eso es lo que hace que la mutación a current_date se cace a cualquier hora. */
const ZONAS = ["UTC", "Pacific/Kiritimati", "Etc/GMT+12", "America/Argentina/Buenos_Aires"];

/** Evalúa el CUERPO DESPLEGADO de fecha_local() sobre un instante fijo, leyéndolo del
 *  catálogo (pg_get_functiondef), no del archivo: es el código que la base está corriendo. */
async function fechaDelCuerpoDesplegado(ejecutor, instante) {
  const { rows } = await ejecutor.query("select pg_get_functiondef('fecha_local'::regproc) as def");
  const cuerpo = rows[0].def.match(/AS \$function\$([\s\S]*?)\$function\$/)[1].trim().replace(/;\s*$/, "");
  // La fecha tiene que salir de un INSTANTE absoluto proyectado a Argentina. Si el cuerpo no
  // usa now(), es porque usa la fecha de la sesión (current_date / localtimestamp): eso es
  // exactamente el bug, y acá se corta.
  expect(cuerpo, "fecha_local() no parte de un instante: no aparece now()").toMatch(/now\(\)/);
  const expr = cuerpo.replace(/^\s*select\s+/i, "").replace(/now\(\)/g, `timestamptz '${instante}'`);
  const r = await ejecutor.query(`select (${expr})::text as f`);
  return r.rows[0].f;
}

// =========================================================================================
describe("IVA_DISCRIMINADO", () => {
  // Caso testigo de la tarea: 1000,01 al 21 % + 5000,02 al 10,5 %.
  const MIXTA = {
    items: [
      { producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1000.01, costo_unitario: 0 },
      { producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 5000.02, costo_unitario: 0 },
    ],
    pagos: [{ medio_id: 1, monto: 6000.03, destino_contable: "caja" }],
  };

  it("productos.iva es numeric, default 21 y CHECK >= 0", async () => {
    const { rows } = await pool.query(`
      select data_type, column_default, is_nullable from information_schema.columns
      where table_name='productos' and column_name='iva'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("numeric");
    expect(rows[0].column_default).toMatch(/^21/);
    await pool.query("insert into productos(id,sku,descripcion) values (9,'D-9','Sin iva explicito')");
    const { rows: r2 } = await pool.query("select iva::float from productos where id=9");
    expect(r2[0].iva).toBe(21);
    await expect(pool.query("insert into productos(id,sku,descripcion,iva) values (10,'D-10','Neg',-0.01)"))
      .rejects.toThrow(/iva_no_negativo/);
  });

  it("cada línea guarda iva_pct e iva_monto reales, no cero", async () => {
    await crearVenta(1, pool, MIXTA);
    const { rows } = await pool.query(
      "select producto_id::int, iva_pct::float, iva_monto::float, subtotal::float from venta_items order by id");
    expect(rows).toEqual([
      { producto_id: 1, iva_pct: 21, iva_monto: 173.56, subtotal: 1000.01 },
      { producto_id: 3, iva_pct: 10.5, iva_monto: 475.12, subtotal: 5000.02 },
    ]);
    // Los mismos valores, calculados aparte con enteros exactos.
    expect(aPesos(ivaCentavos(100001, 21))).toBe(173.56);
    expect(aPesos(ivaCentavos(500002, 10.5))).toBe(475.12);
  });

  it("ventas.iva_total = 648,68 (suma de redondeados), NO 648,67 (redondeo al final)", async () => {
    await crearVenta(1, pool, MIXTA);
    const { rows } = await pool.query("select iva_total::float, total::float, subtotal::float from ventas");
    const lineas = [
      { cantidad: 1, precio_unitario: 1000.01, alicuota: 21 },
      { cantidad: 1, precio_unitario: 5000.02, alicuota: 10.5 },
    ];
    expect(aPesos(ivaTotalSumaDeRedondeados(lineas))).toBe(648.68); // criterio aprobado
    expect(aPesos(ivaTotalRedondeoAlFinal(lineas))).toBe(648.67); // criterio rechazado
    expect(rows[0].iva_total).toBe(648.68);
    expect(rows[0].iva_total).not.toBe(648.67);
    expect(rows[0].total).toBe(6000.03);
  });

  it("el asiento imputa el neto a 4.1 y el IVA a 2.1.2, y cierra Debe = Haber", async () => {
    await crearVenta(1, pool, MIXTA);
    expect(await movimientos()).toEqual([
      { cuenta: "1.1.1", debe: 6000.03, haber: 0 },
      { cuenta: "4.1", debe: 0, haber: 5351.35 },
      { cuenta: "2.1.2", debe: 0, haber: 648.68 },
    ]);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
    // El neto es el RESIDUO total − iva, no una suma de netos por línea.
    expect(await imputado("4.1")).toBe(Math.round((6000.03 - 648.68) * 100) / 100);
  });

  it("MUTACIÓN R20 · un centavo movido de 2.1.2 a 4.1: Debe = Haber SIGUE cerrando y el test lo caza", async () => {
    await crearVenta(1, pool, MIXTA);
    // Las dos patas van en la MISMA transacción: el trigger de asiento balanceado es
    // deferrable y controla al COMMIT, así que un asiento que sigue cerrando lo atraviesa
    // sin quejarse. Ese es justamente el punto del test.
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query("update asiento_movimientos set haber = haber - 0.01 where cuenta='2.1.2'");
      await cli.query("update asiento_movimientos set haber = haber + 0.01 where cuenta='4.1'");
      await cli.query("commit"); // pasa: Debe = Haber sigue siendo cierto
    } finally { await cli.query("rollback").catch(() => {}); cli.release(); }

    // 1) La verificación clásica NO detecta nada: el asiento cierra igual.
    expect(await asientosDesbalanceados(pool)).toEqual([]);
    // 2) La verificación que sí discrimina: el monto imputado a 2.1.2 contra el cálculo por línea.
    const esperado = aPesos(ivaTotalSumaDeRedondeados([
      { cantidad: 1, precio_unitario: 1000.01, alicuota: 21 },
      { cantidad: 1, precio_unitario: 5000.02, alicuota: 10.5 },
    ]));
    expect(esperado).toBe(648.68);
    expect(await imputado("2.1.2")).toBe(648.67); // el peso mal imputado, visible
    expect(await imputado("2.1.2")).not.toBe(esperado); // ⇦ este assert es el que decide la tarea
    expect(await imputado("4.1")).toBe(5351.36);
  });

  it("MUTACIÓN R20 · si crear_venta sumara sin redondear por línea, el IVA daría 648,67 y el test se pone rojo", async () => {
    // Se cambia SOLO el orden de las operaciones: el IVA de cada línea deja de redondearse a
    // 2 decimales y el redondeo pasa al final. Es la variante "más prolija" que un refactor
    // podría introducir sin que Debe = Haber se entere.
    await mutarCrearVenta([
      ["sub numeric(14,2); ali numeric(5,2); iva_l numeric(14,2);",
       "sub numeric(14,2); ali numeric(5,2); iva_l numeric(20,8);"],
      ["v_iva_total numeric(14,2) := 0;", "v_iva_total numeric(20,8) := 0;"],
      ["iva_l := discriminar_iva(sub, ali);",
       "iva_l := case when ali > 0 then sub - sub / (1 + ali / 100) else 0 end;"],
    ]);
    await crearVenta(1, pool, MIXTA);
    const { rows } = await pool.query("select iva_total::float from ventas");
    expect(rows[0].iva_total).toBe(648.67); // un centavo menos en la cuenta fiscal
    expect(await imputado("2.1.2")).toBe(648.67);
    expect(await asientosDesbalanceados(pool)).toEqual([]); // y el asiento cierra igual: no alcanza
    // El assert del test real —2.1.2 == 648,68— habría fallado acá:
    expect(await imputado("2.1.2")).not.toBe(648.68);
  });

  it("lote de ventas variadas: 2.1.2 coincide siempre con la suma de IVA por línea calculada aparte", async () => {
    const casos = [
      [{ producto_id: 1, precio_unitario: 0.01, cantidad: 1, alicuota: 21 }],
      [{ producto_id: 3, precio_unitario: 0.03, cantidad: 1, alicuota: 10.5 }],
      [{ producto_id: 1, precio_unitario: 1000.01, cantidad: 1, alicuota: 21 },
       { producto_id: 3, precio_unitario: 5000.02, cantidad: 1, alicuota: 10.5 }],
      [{ producto_id: 1, precio_unitario: 999.99, cantidad: 3, alicuota: 21, descuento_pct: 10 }],
      [{ producto_id: 3, precio_unitario: 123.45, cantidad: 2, alicuota: 10.5 },
       { producto_id: 1, precio_unitario: 67.89, cantidad: 1, alicuota: 21 },
       { producto_id: 4, precio_unitario: 100, cantidad: 1, alicuota: 0 }],
      [{ producto_id: 1, precio_unitario: 850000, cantidad: 1, alicuota: 21 }],
    ];
    for (const [n, lineas] of casos.entries()) {
      const total = lineas.reduce((a, l) => a + Number(subtotalCentavos(l)), 0);
      const ivaEsperado = ivaTotalSumaDeRedondeados(lineas);
      const id = await crearVenta(1, pool, {
        items: lineas.map((l) => ({
          producto_id: l.producto_id, deposito_id: 1, cantidad: l.cantidad,
          precio_unitario: l.precio_unitario, costo_unitario: 0,
          descuento_pct: l.descuento_pct ?? 0,
        })),
        pagos: [{ medio_id: 1, monto: total / 100, destino_contable: "caja" }],
        idem: `lote-${n}`,
      });
      const { rows } = await pool.query(`
        select v.iva_total::float as iva, v.total::float as total,
          (select coalesce(sum(haber),0) from asiento_movimientos m join asientos a on a.id=m.asiento_id
             where a.origen_id=v.id and m.cuenta='2.1.2')::float as c2_1_2,
          (select coalesce(sum(haber),0) from asiento_movimientos m join asientos a on a.id=m.asiento_id
             where a.origen_id=v.id and m.cuenta='4.1')::float as c4_1
        from ventas v where v.id=$1`, [id]);
      const v = rows[0];
      expect(v.total, `caso ${n}`).toBe(total / 100);
      expect(v.iva, `caso ${n}`).toBe(aPesos(ivaEsperado));
      expect(v.c2_1_2, `caso ${n} · IVA imputado a 2.1.2`).toBe(aPesos(ivaEsperado));
      expect(v.c4_1, `caso ${n} · neto residual en 4.1`).toBe(Math.round((total - Number(ivaEsperado))) / 100);
    }
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("alícuota 0: IVA 0, sin movimiento a 2.1.2, y 4.1 lleva el total", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 4, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
      pagos: [{ medio_id: 1, monto: 100 }],
    });
    const { rows } = await pool.query("select iva_pct::float, iva_monto::float from venta_items");
    expect(rows).toEqual([{ iva_pct: 0, iva_monto: 0 }]);
    expect(await imputado("2.1.2")).toBe(0);
    expect(await imputado("4.1")).toBe(100);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("la alícuota del ítem pisa la del producto y queda congelada en la línea", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1000.01,
                costo_unitario: 0, iva_pct: 10.5 }],
      pagos: [{ medio_id: 1, monto: 1000.01 }],
    });
    const antes = await movimientos();
    const { rows } = await pool.query("select iva_pct::float, iva_monto::float from venta_items");
    expect(rows[0]).toEqual({ iva_pct: 10.5, iva_monto: aPesos(ivaCentavos(100001, 10.5)) });
    // HISTORICO_INMUTABLE: cambiar el producto después no toca la venta ya registrada.
    await pool.query("update productos set iva = 27 where id = 1");
    const { rows: despues } = await pool.query("select iva_pct::float, iva_monto::float from venta_items");
    expect(despues[0]).toEqual(rows[0]);
    expect(await movimientos()).toEqual(antes);
  });

  it("sin iva_pct en el ítem se usa productos.iva, no un 21 fijo", async () => {
    await pool.query("update productos set iva = 27 where id = 1");
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1000.01, costo_unitario: 0 }],
      pagos: [{ medio_id: 1, monto: 1000.01 }],
    });
    const { rows } = await pool.query("select iva_pct::float, iva_monto::float from venta_items");
    expect(rows[0]).toEqual({ iva_pct: 27, iva_monto: aPesos(ivaCentavos(100001, 27)) });
  });
});

// =========================================================================================
describe("IMPUTACION_PAGOS", () => {
  // Venta de 6000,03 cobrada en tres destinos y con saldo pendiente.
  const REPARTIDA = {
    items: [
      { producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 1000.01, costo_unitario: 0 },
      { producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 5000.02, costo_unitario: 0 },
    ],
    pagos: [
      { medio_id: 1, monto: 1000, destino_contable: "caja" },
      { medio_id: 2, monto: 2000, destino_contable: "banco" },
      { medio_id: 3, monto: 1500, destino_contable: "cuentaPorCobrar" },
    ],
  };

  it("venta_pagos.destino_contable existe, es text y tiene el CHECK de los tres destinos", async () => {
    const { rows } = await pool.query(`
      select data_type, is_nullable, column_default from information_schema.columns
      where table_name='venta_pagos' and column_name='destino_contable'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("text");
    const { rows: chk } = await pool.query(`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid='venta_pagos'::regclass and conname='destino_contable_valido'`);
    expect(chk).toHaveLength(1);
    for (const destino of ["caja", "banco", "cuentaPorCobrar"]) expect(chk[0].def).toContain(destino);
  });

  it("caja y banco → 1.1.1; cuentaPorCobrar → 1.1.5; el pendiente → 1.1.2; y el asiento cierra", async () => {
    await crearVenta(1, pool, REPARTIDA);
    expect(await movimientos()).toEqual([
      { cuenta: "1.1.1", debe: 3000, haber: 0 }, // 1000 caja + 2000 banco
      { cuenta: "1.1.5", debe: 1500, haber: 0 }, // tarjeta: todavía no está disponible
      { cuenta: "1.1.2", debe: 1500.03, haber: 0 }, // saldo en cuenta corriente
      { cuenta: "4.1", debe: 0, haber: 5351.35 },
      { cuenta: "2.1.2", debe: 0, haber: 648.68 },
    ]);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("cada pago conserva su destino contable en venta_pagos", async () => {
    await crearVenta(1, pool, REPARTIDA);
    const { rows } = await pool.query(
      "select medio_id::int, monto::float, destino_contable from venta_pagos order by id");
    expect(rows).toEqual([
      { medio_id: 1, monto: 1000, destino_contable: "caja" },
      { medio_id: 2, monto: 2000, destino_contable: "banco" },
      { medio_id: 3, monto: 1500, destino_contable: "cuentaPorCobrar" },
    ]);
  });

  it("un destino desconocido se rechaza y no deja venta", async () => {
    await expect(crearVenta(1, pool, {
      items: [{ producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
      pagos: [{ medio_id: 1, monto: 100, destino_contable: "mercadopago" }],
    })).rejects.toThrow(/DESTINO_PAGO/);
    const { rows } = await pool.query("select count(*)::int as n from ventas");
    expect(rows[0].n).toBe(0);
  });

  it("el CHECK de la columna rechaza un destino inventado también en un INSERT directo", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
      pagos: [{ medio_id: 1, monto: 100 }],
    });
    await expect(pool.query(`insert into venta_pagos(venta_id,medio_id,monto,destino_contable)
                             select id,1,1,'billetera' from ventas limit 1`))
      .rejects.toThrow(/destino_contable_valido/);
    await expect(pool.query(`insert into venta_pagos(venta_id,medio_id,monto,destino_contable)
                             select id,1,1,null from ventas limit 1`))
      .rejects.toThrow(/null/i);
  });

  it("OBSERVACIÓN · un pago sin destino explícito cae en 'caja' e imputa a 1.1.1 (default de 0003)", async () => {
    // Documenta el comportamiento vigente, no lo aprueba: js/contabilidad.js devuelve null
    // para un destino desconocido y js/ventas.js manda esa plata a 1.1.2 Deudores por Ventas,
    // justamente para no asumir Caja. Reportado al director en TEST_RESULTS.md.
    await crearVenta(1, pool, {
      items: [{ producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
      pagos: [{ medio_id: 3, monto: 100 }],
    });
    const { rows } = await pool.query("select destino_contable from venta_pagos");
    expect(rows[0].destino_contable).toBe("caja");
    expect(await imputado("1.1.1", "debe")).toBe(100);
  });

  it("MUTACIÓN R20 · si lo cobrado con tarjeta fuera a 1.1.1, el asiento cerraría igual y el test lo caza", async () => {
    await mutarCrearVenta([["values (a_id,'1.1.5',v_debe_tarjetas,0)", "values (a_id,'1.1.1',v_debe_tarjetas,0)"]]);
    await crearVenta(1, pool, REPARTIDA);
    expect(await asientosDesbalanceados(pool)).toEqual([]); // cierra igual: Debe = Haber no sirve acá
    expect(await imputado("1.1.5", "debe")).toBe(0); // ⇦ el assert que decide
    expect(await imputado("1.1.1", "debe")).toBe(4500); // 3000 + 1500 que no correspondían
  });

  it("las cuentas 1.1.5 y 2.1.2 existen en el plan, imputables, con el nombre de js/contabilidad.js", async () => {
    const { rows } = await pool.query(
      "select codigo,nombre,tipo,imputable from cuentas_contables where codigo in ('1.1.5','2.1.2') order by codigo");
    expect(rows).toEqual([
      { codigo: "1.1.5", nombre: "Deudores por Tarjetas y Acreditaciones", tipo: "activo", imputable: true },
      { codigo: "2.1.2", nombre: "IVA Débito Fiscal", tipo: "pasivo", imputable: true },
    ]);
  });
});

// =========================================================================================
describe("FECHA_OPERACION_LOCAL", () => {
  it("ventas.fecha_operacion es date y su default es fecha_local()", async () => {
    const { rows } = await pool.query(`
      select data_type, column_default from information_schema.columns
      where table_name='ventas' and column_name='fecha_operacion'`);
    expect(rows[0].data_type).toBe("date");
    expect(rows[0].column_default).toMatch(/fecha_local\(\)/);
  });

  it("21:00 en Argentina queda fechado ESE día, no el siguiente, con la sesión en cualquier zona", async () => {
    // Se evalúa el cuerpo desplegado de fecha_local() sobre un instante fijo: las 21:00 del
    // 15/06/2019 en Argentina, que en UTC ya son las 00:00 del 16. Fecha vieja a propósito,
    // para que "hoy" no pueda dar el resultado correcto por casualidad.
    for (const zona of ["UTC", "Asia/Tokyo", "America/Argentina/Buenos_Aires"]) {
      const cli = await pool.connect();
      try {
        await cli.query(`set time zone '${zona}'`);
        expect(await fechaDelCuerpoDesplegado(cli, "2019-06-15 21:00:00-03"), `zona ${zona}`)
          .toBe("2019-06-15");
        // control: a las 21:00 el instante YA es del día siguiente en UTC.
        const { rows } = await cli.query(
          "select (timestamptz '2019-06-15 21:00:00-03' at time zone 'UTC')::date::text as f");
        expect(rows[0].f).toBe("2019-06-16");
      } finally { await cli.query("reset time zone").catch(() => {}); cli.release(); }
    }
  });

  it("una venta sin fecha explícita se fecha con el día argentino, cualquiera sea el TimeZone de la sesión", async () => {
    const antes = fechaArgentina();
    const obtenidas = {};
    for (const zona of ZONAS) obtenidas[zona] = await fechaDeVentaEnZona(zona, `tz-${zona}`);
    const despues = fechaArgentina();
    for (const zona of ZONAS) {
      // [antes, después] cubre el caso de que la corrida cruce la medianoche argentina.
      expect([antes, despues], `zona ${zona}`).toContain(obtenidas[zona]);
    }
    expect(new Set(Object.values(obtenidas)).size, "la fecha no puede depender de la sesión").toBe(1);
  });

  it("el default de la columna también usa la fecha local, con la sesión en UTC", async () => {
    const antes = fechaArgentina();
    const cli = await pool.connect();
    try {
      await cli.query("set time zone 'UTC'");
      await cli.query(`insert into ventas(numero,cliente_id,vendedor_uid,subtotal,total,idempotency_key)
                       values (9001,1,'u-test',100,100,'default-fecha')`);
      const { rows } = await cli.query("select fecha_operacion::text as f from ventas where numero=9001");
      expect([antes, fechaArgentina()]).toContain(rows[0].f);
    } finally { await cli.query("reset time zone").catch(() => {}); cli.release(); }
  });

  it("creado_en conserva el instante real (timestamptz), no la fecha", async () => {
    const t0 = Date.now();
    await crearVenta(1, pool, {
      items: [{ producto_id: 3, deposito_id: 1, cantidad: 1, precio_unitario: 100, costo_unitario: 0 }],
      pagos: [{ medio_id: 1, monto: 100 }], fecha: null,
    });
    const { rows } = await pool.query("select creado_en from ventas");
    const { rows: tipo } = await pool.query(`
      select data_type from information_schema.columns
      where table_name='ventas' and column_name='creado_en'`);
    expect(tipo[0].data_type).toBe("timestamp with time zone");
    expect(Math.abs(rows[0].creado_en.getTime() - t0)).toBeLessThan(60000);
  });

  it("MUTACIÓN R20 · con current_date en lugar de fecha_local() el test se pone rojo", async () => {
    await pool.query("create or replace function fecha_local() returns date as $$ select current_date $$ language sql stable;");
    const obtenidas = {};
    for (const zona of ZONAS) obtenidas[zona] = await fechaDeVentaEnZona(zona, `mut-cd-${zona}`);
    // Kiritimati (+14) y Etc/GMT+12 (−12) están 26 h separadas: nunca comparten fecha, así que
    // esto falla a cualquier hora del día, no solo a las 21:00.
    expect(obtenidas["Pacific/Kiritimati"]).not.toBe(obtenidas["Etc/GMT+12"]);
    expect(new Set(Object.values(obtenidas)).size).toBeGreaterThan(1);
    const hoyArg = fechaArgentina();
    expect(Object.values(obtenidas).some((f) => f !== hoyArg)).toBe(true);
    // Y la verificación sobre el cuerpo desplegado también se pone roja: ya no hay instante.
    await expect(fechaDelCuerpoDesplegado(pool, "2019-06-15 21:00:00-03")).rejects.toThrow(/now\(\)/);
  });

  it("MUTACIÓN R20 · con now()::date tampoco pasa: el cast usa el TimeZone de la sesión", async () => {
    await pool.query("create or replace function fecha_local() returns date as $$ select now()::date $$ language sql stable;");
    const obtenidas = {};
    for (const zona of ZONAS) obtenidas[zona] = await fechaDeVentaEnZona(zona, `mut-now-${zona}`);
    expect(obtenidas["Pacific/Kiritimati"]).not.toBe(obtenidas["Etc/GMT+12"]);
    expect(Object.values(obtenidas).some((f) => f !== fechaArgentina())).toBe(true);
    // El cuerpo mutado sí tiene now(), pero fechado sobre las 21:00 argentinas da el día
    // siguiente en cuanto la sesión no es Argentina.
    const cli = await pool.connect();
    try {
      await cli.query("set time zone 'UTC'");
      expect(await fechaDelCuerpoDesplegado(cli, "2019-06-15 21:00:00-03")).toBe("2019-06-16");
    } finally { await cli.query("reset time zone").catch(() => {}); cli.release(); }
  });
});
