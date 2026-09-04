// Utilidades compartidas por los tests de integración contra PostgreSQL local.
// Requiere: npm run db:up  (Postgres en 127.0.0.1:5432)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const MIGRACIONES = join(RAIZ, "backend", "db", "migrations");

export const CONN =
  process.env.DATABASE_URL_TEST ||
  "postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test";

export async function nuevoPool() {
  const pool = new pg.Pool({ connectionString: CONN, max: 6 });
  return pool;
}

/** Recrea el esquema desde cero aplicando todas las migraciones en orden. */
export async function recrearEsquema(pool) {
  await pool.query("drop schema public cascade; create schema public;");
  for (const archivo of readdirSync(MIGRACIONES).sort()) {
    if (!archivo.endsWith(".sql")) continue;
    await pool.query(readFileSync(join(MIGRACIONES, archivo), "utf8"));
  }
}

/** Datos mínimos, inventados. Stock preparado para las invariantes. */
export async function seed(pool) {
  await pool.query(`
    insert into depositos(id,nombre) values (1,'Principal');
    insert into clientes(id,razon_social,cuit) values (1,'Cliente Prueba','20111111112');
    insert into productos(id,sku,descripcion,costo_referencia,precio_venta) values
      (1,'DEV-001','Heladera',600000,850000),
      (2,'DEV-002','Lavarropas',430000,620000);
    insert into stock(producto_id,deposito_id,fisico,reservado) values (1,1,5,0),(2,1,1,0);
    insert into medios_pago(id,nombre) values (1,'Efectivo'),(2,'Transferencia');
    insert into cuentas_contables(codigo,nombre,tipo) values
      ('1.1.1','Caja','activo'),('1.1.2','Deudores por Ventas','activo'),
      ('1.1.3','Bienes de Cambio','activo'),('4.1','Ventas','ingreso'),('5.1','CMV','egreso');
  `);
}

export async function stockDe(pool, productoId = 1, depositoId = 1) {
  const { rows } = await pool.query(
    "select fisico::float, reservado::float, disponible::float from stock where producto_id=$1 and deposito_id=$2",
    [productoId, depositoId]
  );
  return rows[0];
}

/** Cuenta filas de todas las tablas que una venta debería tocar. */
export async function conteos(pool) {
  const { rows } = await pool.query(`
    select
      (select count(*) from ventas)             as ventas,
      (select count(*) from venta_items)        as items,
      (select count(*) from venta_pagos)        as pagos,
      (select count(*) from asientos)           as asientos,
      (select count(*) from asiento_movimientos) as mov_contables,
      (select count(*) from movimientos_stock)  as mov_stock,
      (select count(*) from reservas)           as reservas,
      (select ultimo from contadores where nombre='ventas') as contador_ventas
  `);
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

export async function crearVenta(cliente, ejecutor, opciones = {}) {
  const {
    items = [{ producto_id: 1, deposito_id: 1, cantidad: 1, precio_unitario: 850000, costo_unitario: 600000 }],
    pagos = [{ medio_id: 1, monto: 850000 }],
    entrega = "inmediata",
    idem = `k-${Math.random().toString(36).slice(2)}`,
    fallarEn = null,
    fecha = "2026-09-03",
  } = opciones;
  const { rows } = await ejecutor.query(
    "select crear_venta($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) as venta_id",
    [cliente, "u-test", fecha, JSON.stringify(items), JSON.stringify(pagos), entrega, idem, fallarEn]
  );
  return Number(rows[0].venta_id);
}

/** Invariante RESERVAS_CONSISTENTES: devuelve las filas desincronizadas (vacío = OK). */
export async function reservasInconsistentes(pool) {
  const { rows } = await pool.query("select * from verificar_reservas_consistentes()");
  return rows;
}

/** Invariante CONTABILIDAD: devuelve los asientos desbalanceados (vacío = OK). */
export async function asientosDesbalanceados(pool) {
  const { rows } = await pool.query(`
    select asiento_id, sum(debe)::float as debe, sum(haber)::float as haber
    from asiento_movimientos group by asiento_id having sum(debe) <> sum(haber)
  `);
  return rows;
}
