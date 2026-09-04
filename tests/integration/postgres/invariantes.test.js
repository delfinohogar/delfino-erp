// Invariantes del dominio contra PostgreSQL local.
// Portado de la validación empírica contra PostgreSQL 16.15 del 2026-09-03.
// Requiere: npm run db:up
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  nuevoPool, recrearEsquema, seed, stockDe, conteos, crearVenta,
  reservasInconsistentes, asientosDesbalanceados, CONN,
} from "./_helpers.mjs";
import pg from "pg";

let pool;
beforeAll(async () => { pool = await nuevoPool(); });
afterAll(async () => { await pool?.end(); });
beforeEach(async () => { await recrearEsquema(pool); await seed(pool); });

describe("VENTA_NORMAL", () => {
  it("stock 5, venta 2: deja stock 3 y crea venta, ítems, pago, asiento y movimiento", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 2, precio_unitario: 850000, costo_unitario: 600000 }],
      pagos: [{ medio_id: 1, monto: 1700000 }],
    });
    expect(await stockDe(pool)).toEqual({ fisico: 3, reservado: 0, disponible: 3 });
    const c = await conteos(pool);
    expect(c).toMatchObject({ ventas: 1, items: 1, pagos: 1, asientos: 1, mov_stock: 1, reservas: 0 });
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });
});

describe("STOCK_INSUFICIENTE", () => {
  it("stock 1, venta 2: rechaza y no deja rastro", async () => {
    await expect(crearVenta(1, pool, {
      items: [{ producto_id: 2, deposito_id: 1, cantidad: 2, precio_unitario: 620000, costo_unitario: 430000 }],
      pagos: [{ medio_id: 1, monto: 1240000 }],
    })).rejects.toThrow(/STOCK_INSUFICIENTE/);
    expect(await stockDe(pool, 2)).toEqual({ fisico: 1, reservado: 0, disponible: 1 });
    expect(await conteos(pool)).toMatchObject({ ventas: 0, items: 0, pagos: 0, asientos: 0, mov_stock: 0 });
  });
});

describe("FALLO_INTERMEDIO", () => {
  // Estos dos casos son los que la implementación actual sobre Firestore NO puede pasar:
  // js/ventas.js hace seis escrituras sin transacción común (ver RISKS.md R1).
  it("falla al generar el asiento: rollback total, no queda stock descontado ni venta", async () => {
    const antes = await conteos(pool);
    await expect(crearVenta(1, pool, { fallarEn: "asiento" })).rejects.toThrow(/FALLO_FORZADO/);
    expect(await stockDe(pool)).toEqual({ fisico: 5, reservado: 0, disponible: 5 });
    expect(await conteos(pool)).toEqual(antes);
  });

  it("falla al registrar los pagos: rollback total", async () => {
    const antes = await conteos(pool);
    await expect(crearVenta(1, pool, { fallarEn: "pagos" })).rejects.toThrow(/FALLO_FORZADO/);
    expect(await stockDe(pool)).toEqual({ fisico: 5, reservado: 0, disponible: 5 });
    expect(await conteos(pool)).toEqual(antes);
  });

  it("el contador de ventas también hace rollback: la numeración no queda con huecos", async () => {
    await crearVenta(1, pool, { idem: "k-ok-1" });
    await expect(crearVenta(1, pool, { idem: "k-falla", fallarEn: "asiento" })).rejects.toThrow();
    await crearVenta(1, pool, { idem: "k-ok-2" });
    const { rows } = await pool.query("select numero::int from ventas order by numero");
    expect(rows.map((r) => r.numero)).toEqual([1, 2]);
  });
});

describe("DOBLE_ENVIO", () => {
  it("la misma idempotency key dos veces devuelve la misma venta y no duplica nada", async () => {
    const primera = await crearVenta(1, pool, { idem: "k-doble" });
    const despues = await conteos(pool);
    const segunda = await crearVenta(1, pool, { idem: "k-doble" });
    expect(segunda).toBe(primera);
    expect(await conteos(pool)).toEqual(despues);
  });
});

describe("CONTABILIDAD", () => {
  it("una venta con pago parcial genera Caja + Deudores contra Ventas, y CMV contra Bienes de Cambio", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 850000, costo_unitario: 600000 }],
      pagos: [{ medio_id: 1, monto: 300000 }],
    });
    const { rows } = await pool.query(
      "select cuenta, debe::float, haber::float from asiento_movimientos order by id"
    );
    expect(rows).toEqual([
      { cuenta: "1.1.1", debe: 300000, haber: 0 },
      { cuenta: "1.1.2", debe: 550000, haber: 0 },
      { cuenta: "4.1", debe: 0, haber: 850000 },
      { cuenta: "5.1", debe: 600000, haber: 0 },
      { cuenta: "1.1.3", debe: 0, haber: 600000 },
    ]);
    expect(await asientosDesbalanceados(pool)).toEqual([]);
  });

  it("no se puede confirmar un asiento desbalanceado, ni armándolo en varias sentencias", async () => {
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query(`insert into asientos(id,numero,fecha_operacion,descripcion,origen_tipo,usuario_uid)
                       values (900,900,'2026-09-03','roto','test','u1')`);
      await cli.query("insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (900,'1.1.1',100,0)");
      await cli.query("insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (900,'4.1',0,90)");
      await expect(cli.query("commit")).rejects.toThrow(/no balanceado/i);
    } finally { await cli.query("rollback").catch(() => {}); cli.release(); }
  });

  it("un UPDATE posterior no puede desbalancear un asiento ya confirmado", async () => {
    await crearVenta(1, pool);
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query("update asiento_movimientos set debe=999999 where cuenta='1.1.1'");
      await expect(cli.query("commit")).rejects.toThrow(/no balanceado/i);
    } finally { await cli.query("rollback").catch(() => {}); cli.release(); }
  });

  it("un DELETE posterior no puede desbalancear un asiento ya confirmado", async () => {
    await crearVenta(1, pool);
    const cli = await pool.connect();
    try {
      await cli.query("begin");
      await cli.query("delete from asiento_movimientos where cuenta='4.1'");
      await expect(cli.query("commit")).rejects.toThrow(/no balanceado/i);
    } finally { await cli.query("rollback").catch(() => {}); cli.release(); }
  });
});

describe("PAGOS_VENTA y PENDIENTE_CON_CLIENTE", () => {
  it("pagos reales + monto pendiente = total", async () => {
    await crearVenta(1, pool, { pagos: [{ medio_id: 1, monto: 300000 }] });
    const { rows } = await pool.query(`
      select v.total::float as total, v.monto_pendiente::float as pendiente,
             coalesce((select sum(monto) from venta_pagos p where p.venta_id=v.id),0)::float as pagado
      from ventas v`);
    const v = rows[0];
    expect(v.pagado + v.pendiente).toBe(v.total);
  });

  it("P2: no se puede dejar saldo pendiente sin cliente", async () => {
    await expect(crearVenta(null, pool, { pagos: [{ medio_id: 1, monto: 300000 }] }))
      .rejects.toThrow(/pendiente_exige_cliente/);
    expect(await conteos(pool)).toMatchObject({ ventas: 0 });
  });

  it("los pagos no pueden superar el total", async () => {
    await expect(crearVenta(1, pool, { pagos: [{ medio_id: 1, monto: 999999999 }] }))
      .rejects.toThrow(/PAGOS_VENTA/);
  });
});

describe("RESERVAS", () => {
  it("venta pendiente de entrega: crea reserva y NO descuenta el físico", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 2, precio_unitario: 850000, costo_unitario: 600000 }],
      pagos: [{ medio_id: 1, monto: 1700000 }],
      entrega: "pendiente",
    });
    expect(await stockDe(pool)).toEqual({ fisico: 5, reservado: 2, disponible: 3 });
    const { rows } = await pool.query(
      "select cantidad::float, cantidad_pendiente::float, origen_tipo from reservas"
    );
    expect(rows).toEqual([{ cantidad: 2, cantidad_pendiente: 2, origen_tipo: "venta" }]);
  });

  it("RESERVAS_CONSISTENTES: stock.reservado coincide con la suma de reservas pendientes", async () => {
    await crearVenta(1, pool, { entrega: "pendiente", idem: "r1" });
    await crearVenta(1, pool, { entrega: "pendiente", idem: "r2" });
    expect(await reservasInconsistentes(pool)).toEqual([]);
  });

  it("RESERVAS_CONSISTENTES se mantiene tras un fallo intermedio", async () => {
    await crearVenta(1, pool, { entrega: "pendiente", idem: "r1" });
    await expect(crearVenta(1, pool, { entrega: "pendiente", idem: "r-falla", fallarEn: "asiento" })).rejects.toThrow();
    expect(await reservasInconsistentes(pool)).toEqual([]);
    expect(await stockDe(pool)).toEqual({ fisico: 5, reservado: 1, disponible: 4 });
  });

  it("no se puede vender una unidad que ya está reservada", async () => {
    // producto 2: físico 1. Se reserva la única unidad.
    await crearVenta(1, pool, {
      items: [{ producto_id: 2, deposito_id: 1, cantidad: 1, precio_unitario: 620000, costo_unitario: 430000 }],
      pagos: [{ medio_id: 1, monto: 620000 }], entrega: "pendiente", idem: "res-1",
    });
    expect(await stockDe(pool, 2)).toEqual({ fisico: 1, reservado: 1, disponible: 0 });
    await expect(crearVenta(1, pool, {
      items: [{ producto_id: 2, deposito_id: 1, cantidad: 1, precio_unitario: 620000, costo_unitario: 430000 }],
      pagos: [{ medio_id: 1, monto: 620000 }], idem: "res-2",
    })).rejects.toThrow(/STOCK_INSUFICIENTE/);
  });

  it("no se puede consumir más de lo reservado ni liberar lo ya consumido", async () => {
    await crearVenta(1, pool, {
      items: [{ producto_id: 1, deposito_id: 1, cantidad: 5, precio_unitario: 850000, costo_unitario: 600000 }],
      pagos: [{ medio_id: 1, monto: 4250000 }], entrega: "pendiente",
    });
    const { rows } = await pool.query("select id from reservas");
    const id = rows[0].id;
    await expect(pool.query("update reservas set cantidad_consumida=6, cerrado_en=now() where id=$1", [id]))
      .rejects.toThrow();
    // consumo parcial legítimo (entrega parcial)
    await pool.query("update reservas set cantidad_consumida=2 where id=$1", [id]);
    const p = await pool.query("select cantidad_pendiente::float from reservas where id=$1", [id]);
    expect(p.rows[0].cantidad_pendiente).toBe(3);
    // consumir el resto y cerrar
    await pool.query("update reservas set cantidad_consumida=5, cerrado_en=now() where id=$1", [id]);
    // ya consumida: no se puede liberar
    await expect(pool.query("update reservas set cantidad_liberada=1 where id=$1", [id])).rejects.toThrow();
  });
});

describe("CONCURRENCIA", () => {
  it("dos vendedores por la última unidad: exactamente uno confirma", async () => {
    const vender = async (etiqueta) => {
      const cli = new pg.Client({ connectionString: CONN });
      await cli.connect();
      try {
        await cli.query("begin");
        const id = await crearVenta(1, cli, {
          items: [{ producto_id: 2, deposito_id: 1, cantidad: 1, precio_unitario: 620000, costo_unitario: 430000 }],
          pagos: [{ medio_id: 1, monto: 620000 }], idem: `conc-${etiqueta}`,
        });
        await cli.query("commit");
        return { ok: true, id };
      } catch (err) {
        await cli.query("rollback").catch(() => {});
        return { ok: false, error: err.message };
      } finally { await cli.end(); }
    };
    const [a, b] = await Promise.all([vender("A"), vender("B")]);
    const exitos = [a, b].filter((r) => r.ok);
    expect(exitos).toHaveLength(1);
    const fallo = [a, b].find((r) => !r.ok);
    expect(fallo.error).toMatch(/STOCK_INSUFICIENTE/);
    expect(await stockDe(pool, 2)).toEqual({ fisico: 0, reservado: 0, disponible: 0 });
  });

  it("el orden de bloqueo ascendente por producto evita deadlocks", async () => {
    // Ambas transacciones tocan los productos 1 y 2. crear_venta bloquea siempre
    // ordenado por (producto_id, deposito_id), así que no pueden deadlockear.
    const venderAmbos = async (etiqueta) => {
      const cli = new pg.Client({ connectionString: CONN });
      await cli.connect();
      try {
        await cli.query("begin");
        await crearVenta(1, cli, {
          items: [
            { producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 850000, costo_unitario: 600000 },
            { producto_id: 2, deposito_id: 1, cantidad: 0.5, precio_unitario: 620000, costo_unitario: 430000 },
          ],
          pagos: [{ medio_id: 1, monto: 1160000 }], idem: `dl-${etiqueta}`,
        });
        await cli.query("commit");
        return { ok: true };
      } catch (err) {
        await cli.query("rollback").catch(() => {});
        return { ok: false, error: err.message };
      } finally { await cli.end(); }
    };
    const res = await Promise.all([venderAmbos("A"), venderAmbos("B")]);
    for (const r of res) expect(r.error ?? "").not.toMatch(/deadlock/i);
  });
});

describe("INTEGRIDAD GLOBAL", () => {
  it("después de varias operaciones no quedan huérfanos ni desbalances", async () => {
    await crearVenta(1, pool, { idem: "g1" });
    await crearVenta(1, pool, { idem: "g2", entrega: "pendiente" });
    await crearVenta(1, pool, { idem: "g3", pagos: [{ medio_id: 1, monto: 100000 }] });
    await expect(crearVenta(1, pool, { idem: "g4", fallarEn: "asiento" })).rejects.toThrow();

    const { rows } = await pool.query(`
      select
        (select count(*) from asientos a where not exists
           (select 1 from asiento_movimientos m where m.asiento_id=a.id)) as asientos_huerfanos,
        (select count(*) from ventas v where not exists
           (select 1 from venta_items i where i.venta_id=v.id)) as ventas_sin_items,
        (select count(*) from ventas v where not exists
           (select 1 from asientos a where a.origen_tipo='venta' and a.origen_id=v.id)) as ventas_sin_asiento
    `);
    expect(rows[0]).toEqual({ asientos_huerfanos: "0", ventas_sin_items: "0", ventas_sin_asiento: "0" });
    expect(await asientosDesbalanceados(pool)).toEqual([]);
    expect(await reservasInconsistentes(pool)).toEqual([]);
  });
});
