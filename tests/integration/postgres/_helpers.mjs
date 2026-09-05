// Utilidades compartidas por los tests de integración contra PostgreSQL local.
// Requiere: npm run db:up  (Postgres en 127.0.0.1:5432)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// La ruta de las repetibles NO se escribe a mano: se toma de migrar.js, que es quien la resuelve
// de verdad. Si el directorio se vuelve a renombrar —paso de `functions/` a `repetibles/` en
// TASK-018—, esto lo sigue solo en vez de dejar la suite probando el esquema equivocado.
import {
  DIR_REPETIBLES,
  normalizarFinDeLinea,
  repetiblesEnDisco,
} from "../../../backend/src/db/migrar.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const MIGRACIONES = join(RAIZ, "backend", "db", "migrations");

export { DIR_REPETIBLES };

export const CONN =
  process.env.DATABASE_URL_TEST ||
  "postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test";

export async function nuevoPool() {
  const pool = new pg.Pool({ connectionString: CONN, max: 6 });
  return pool;
}

/**
 * Recrea el esquema desde cero: primero las migraciones NUMERADAS en orden alfabetico y
 * despues las REPETIBLES, exactamente en el mismo orden y con el mismo tratamiento del texto
 * que backend/src/db/migrar.js. No registra nada en schema_migrations ni en schema_repetibles:
 * esto carga un esquema para probar, no hace de migrador.
 *
 * Por que las repetibles TAMBIEN, y no es un detalle (TASK-018): desde el corte de la migracion
 * 0006 la definicion vigente de crear_venta() es backend/db/repetibles/crear_venta.sql, y las
 * numeradas solo dejan la ultima version HISTORICA (la copia que quedo en 0004). Si aca se
 * aplicaran solo las numeradas, toda la suite estaria probando la copia vieja de 0004 mientras
 * el ERP corre la de repetibles/. Hoy las dos son identicas caracter por caracter, asi que el
 * test no mentiria todavia: mentiria el dia que alguien edite repetibles/crear_venta.sql, y
 * seguiria verde. Lo detectaron el auditor de TASK-003 y el implementador de TASK-018.
 *
 * Tratamiento del texto (R32/R33): las repetibles se normalizan a LF antes de mandarlas, igual
 * que aplicarRepetibles() en migrar.js, para que lo desplegado no dependa del checkout (en
 * Windows core.autocrlf deja los .sql en CRLF). Las numeradas van crudas, tambien igual que el
 * migrador: si aca se normalizaran y alla no, el esquema de los tests dejaria de ser el que
 * produce el migrador.
 */
export async function recrearEsquema(pool) {
  await pool.query("drop schema public cascade; create schema public;");
  for (const archivo of readdirSync(MIGRACIONES).sort()) {
    if (!archivo.endsWith(".sql")) continue;
    await pool.query(readFileSync(join(MIGRACIONES, archivo), "utf8"));
  }
  for (const archivo of repetiblesEnDisco(DIR_REPETIBLES)) {
    const sql = normalizarFinDeLinea(readFileSync(join(DIR_REPETIBLES, archivo), "utf8"));
    await pool.query(sql);
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
