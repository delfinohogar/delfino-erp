// TASK-004 — NUMERACION_CORTE: contadores del corte (P7) contra PostgreSQL local.
//
// Qué se verifica acá, contra los criterios de aceptación de TASK-004 y la fila
// NUMERACION_CORTE de migration/TEST_MATRIX.md:
//
//   1. Un contador POR PUNTO DE VENTA Y TIPO, con la forma `comprobantes_{pv}_{tipo}`.
//      Es LA propiedad fiscal: dos puntos de venta no comparten secuencia, nunca. Se prueba
//      además con mutación (R20): si el nombre se resolviera ignorando el punto de venta, o si
//      siguiente_numero() colapsara los nombres, los asserts de acá se ponen rojos.
//   2. `ventas` y `asientos` arrancan en 0, de modo que la PRIMERA operación obtiene el 1.
//   3. Correlatividad bajo concurrencia (dos sesiones estrenando el mismo contador dan 1 y 2,
//      la segunda bloquea hasta el commit) y bajo error (un ROLLBACK DEVUELVE el número: es
//      justo lo que distingue este diseño del de Firestore, donde la venta fallida lo quema).
//   4. Las tres ramas del corte: (a) idempotente, (b) YA_FIJADO salvo p_corregir,
//      (c) EN_USO siempre, y el flag NO alcanza para saltearla.
//   5. La constancia es CONSULTABLE y append-only: quién, cuándo, de cuánto a cuánto, si fue
//      corrección y por qué.
//
// Requiere: npm run db:up  (Postgres local, base delfino_test vía DATABASE_URL_TEST).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { nuevoPool, recrearEsquema, seed, crearVenta, CONN } from "./_helpers.mjs";

let pool;
beforeAll(async () => {
  // Barrera: nunca contra la base de trabajo.
  expect(new URL(CONN).pathname.replace(/^\//, "")).not.toBe("delfino_dev");
  pool = await nuevoPool();
});
afterAll(async () => { await pool?.end(); });
beforeEach(async () => { await recrearEsquema(pool); await seed(pool); });

// --- utilidades -------------------------------------------------------------

const filas = async (sql, params = []) => (await pool.query(sql, params)).rows;
const una = async (sql, params = []) => (await filas(sql, params))[0];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nombre canónico resuelto POR LA BASE. Que pase por acá es lo que hace mordible la mutación
 *  del punto 1: si nombre_contador_comprobante() ignorara el punto de venta, los tests que
 *  usan esta función colapsarían las dos secuencias y se pondrían rojos. */
const nombreDe = async (pv, tipo) =>
  (await una("select nombre_contador_comprobante($1,$2) as n", [pv, tipo])).n;

/** Emite el próximo número de un comprobante, resolviendo el nombre por la vía canónica. */
const emitir = async (pv, tipo, ejecutor = pool) =>
  Number((await ejecutor.query("select siguiente_numero(nombre_contador_comprobante($1,$2)) as n", [pv, tipo])).rows[0].n);

const emitirN = async (pv, tipo, veces) => {
  const salida = [];
  for (let i = 0; i < veces; i++) salida.push(await emitir(pv, tipo));
  return salida;
};

const contador = async (nombre) => {
  const r = await una("select ultimo from contadores where nombre=$1", [nombre]);
  return r ? Number(r.ultimo) : null;
};

const fijar = (pv, tipo, valor, usuario, motivo = null, corregir = false, ejecutor = pool) =>
  ejecutor.query("select fijar_contador_comprobante($1,$2,$3,$4,$5,$6) as id",
    [pv, tipo, valor, usuario, motivo, corregir]).then((r) => Number(r.rows[0].id));

const constancias = async (nombre = null) =>
  filas(
    `select id::int, contador, punto_venta, tipo_comprobante, ultimo_anterior::int as ultimo_anterior,
            ultimo_fijado::int as ultimo_fijado, correccion, usuario_uid, motivo, fijado_en
       from contadores_corte ${nombre ? "where contador=$1" : ""} order by id`,
    nombre ? [nombre] : []);

/** Cliente propio, para las pruebas que necesitan transacciones explícitas. */
async function cliente() {
  const c = new pg.Client({ connectionString: CONN });
  await c.connect();
  return c;
}

// ===========================================================================
// 1. Un contador por punto de venta y tipo. La propiedad fiscal.
// ===========================================================================
describe("NUMERACION_CORTE · un contador por punto de venta y tipo", () => {
  it("la forma del nombre es comprobantes_{pv}_{tipo} y la arma la base, no el llamador", async () => {
    expect(await nombreDe("0001", "COMPROBANTE_INTERNO")).toBe("comprobantes_0001_COMPROBANTE_INTERNO");
    expect(await nombreDe("0002", "NOTA_CREDITO_INTERNA")).toBe("comprobantes_0002_NOTA_CREDITO_INTERNA");
    expect(await nombreDe("1", "FACTURA_A")).toBe("comprobantes_1_FACTURA_A");
    expect(await nombreDe("99999", "FACTURA_B")).toBe("comprobantes_99999_FACTURA_B");
  });

  it("dos puntos de venta y dos tipos llevan TRES secuencias independientes: 1,2,3 · 1,2 · 1", async () => {
    expect(await emitirN("0001", "COMPROBANTE_INTERNO", 3)).toEqual([1, 2, 3]);
    expect(await emitirN("0002", "COMPROBANTE_INTERNO", 2)).toEqual([1, 2]);
    expect(await emitirN("0001", "NOTA_CREDITO_INTERNA", 1)).toEqual([1]);

    // Y el estado de la base lo confirma fila por fila: tres contadores distintos.
    expect(await filas(`select nombre, ultimo::int as ultimo from contadores
                         where nombre like 'comprobantes~_%' escape '~' order by nombre`)).toEqual([
      { nombre: "comprobantes_0001_COMPROBANTE_INTERNO", ultimo: 3 },
      { nombre: "comprobantes_0001_NOTA_CREDITO_INTERNA", ultimo: 1 },
      { nombre: "comprobantes_0002_COMPROBANTE_INTERNO", ultimo: 2 },
    ]);
  });

  it("intercalar puntos de venta no mezcla las secuencias: cada una sigue su propia cuenta", async () => {
    // Peor caso para una secuencia compartida: se alternan los dos puntos de venta.
    const obtenidos = [];
    for (let i = 0; i < 4; i++) {
      obtenidos.push(["0001", await emitir("0001", "FACTURA_B")]);
      obtenidos.push(["0002", await emitir("0002", "FACTURA_B")]);
    }
    expect(obtenidos).toEqual([
      ["0001", 1], ["0002", 1], ["0001", 2], ["0002", 2],
      ["0001", 3], ["0002", 3], ["0001", 4], ["0002", 4],
    ]);
  });

  it("un corte en un punto de venta NO mueve la numeración del otro", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte Firestore");
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1501);
    // 0002 nunca se fijó: sigue estrenando en 1.
    expect(await emitir("0002", "COMPROBANTE_INTERNO")).toBe(1);
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1501);
    expect(await contador("comprobantes_0002_COMPROBANTE_INTERNO")).toBe(1);
  });

  it('el punto de venta se conserva tal cual: "0001" y "1" son contadores DISTINTOS', async () => {
    // Decisión del implementador, y es la correcta: en Firestore son documentos distintos.
    // Normalizarlos acá fusionaría dos numeraciones que allá están separadas.
    expect(await emitirN("0001", "FACTURA_A", 2)).toEqual([1, 2]);
    expect(await emitirN("1", "FACTURA_A", 1)).toEqual([1]);
    expect(await contador("comprobantes_0001_FACTURA_A")).toBe(2);
    expect(await contador("comprobantes_1_FACTURA_A")).toBe(1);
  });

  it("MUTACIÓN R20 · si el nombre se resolviera ignorando el punto de venta, el assert se pone rojo", async () => {
    // Se planta la falla más silenciosa posible: nombre_contador_comprobante() devuelve siempre
    // el mismo punto de venta. Los llamadores no cambian y no hay error en ningún lado.
    await pool.query(`
      create or replace function nombre_contador_comprobante(p_punto_venta text, p_tipo_comprobante text)
      returns text as $mut$ begin
        return 'comprobantes_0001_' || p_tipo_comprobante;
      end $mut$ language plpgsql immutable;`);

    expect(await emitirN("0001", "COMPROBANTE_INTERNO", 3)).toEqual([1, 2, 3]);
    // Bajo la mutación, 0002 NO estrena en 1: continúa la secuencia de 0001. Ese es exactamente
    // el resultado que el test "tres secuencias independientes" declara rojo.
    const bajoMutacion = await emitirN("0002", "COMPROBANTE_INTERNO", 2);
    expect(bajoMutacion).toEqual([4, 5]);
    expect(bajoMutacion).not.toEqual([1, 2]);
    // Y solo queda UN contador donde deberían quedar dos.
    expect(await filas(`select nombre from contadores where nombre like 'comprobantes~_%' escape '~'`))
      .toEqual([{ nombre: "comprobantes_0001_COMPROBANTE_INTERNO" }]);
  });

  it("MUTACIÓN R20 · si siguiente_numero() colapsara el punto de venta, el assert se pone rojo", async () => {
    // Segunda vía para el mismo daño, esta vez aguas abajo del nombre: el contador se resuelve
    // por un nombre del que se borró el punto de venta.
    await pool.query(`
      create or replace function siguiente_numero(p_nombre text) returns bigint as $mut$
      declare n bigint; nom text;
      begin
        nom := regexp_replace(p_nombre, '^comprobantes_[0-9]{1,5}_', 'comprobantes_');
        insert into contadores(nombre, ultimo) values (nom, 1)
          on conflict (nombre) do update set ultimo = contadores.ultimo + 1
          returning ultimo into n;
        return n;
      end $mut$ language plpgsql;`);

    expect(await emitirN("0001", "COMPROBANTE_INTERNO", 3)).toEqual([1, 2, 3]);
    expect(await emitirN("0002", "COMPROBANTE_INTERNO", 2)).toEqual([4, 5]);
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(null);
  });

  it("MUTACIÓN R20 · si el corte de un punto de venta pisara el del otro, el assert se pone rojo", async () => {
    await pool.query(`
      create or replace function nombre_contador_comprobante(p_punto_venta text, p_tipo_comprobante text)
      returns text as $mut$ begin
        return 'comprobantes_0001_' || p_tipo_comprobante;
      end $mut$ language plpgsql immutable;`);
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston");
    // Bajo la mutación, 0002 hereda el corte de 0001 en vez de estrenar en 1.
    expect(await emitir("0002", "COMPROBANTE_INTERNO")).toBe(1501);
  });

  it("un punto de venta o un tipo mal formados dan ERROR, no un contador nuevo silencioso", async () => {
    // Es el motivo de que el nombre lo arme una función: un typo tiene que hacer ruido, porque
    // el nombre es la clave primaria y un typo sin error sería una numeración paralela.
    for (const pv of ["abc", "", "123456", "00-1", "0001 "]) {
      await expect(pool.query("select nombre_contador_comprobante($1,'FACTURA_A')", [pv]))
        .rejects.toThrow(/NUMERACION_CORTE: punto de venta invalido/);
    }
    await expect(pool.query("select nombre_contador_comprobante(null,'FACTURA_A')"))
      .rejects.toThrow(/punto de venta invalido \(<null>\)/);

    for (const tipo of ["factura_a", "1FACTURA", "FACTURA-A", "", "FACTURA A"]) {
      await expect(pool.query("select nombre_contador_comprobante('0001',$1)", [tipo]))
        .rejects.toThrow(/NUMERACION_CORTE: tipo de comprobante invalido/);
    }
    await expect(pool.query("select nombre_contador_comprobante('0001',null)"))
      .rejects.toThrow(/tipo de comprobante invalido \(<null>\)/);
  });

  it("siguiente_numero() crea solo los contadores de comprobantes; cualquier otro nombre falla", async () => {
    // La creación automática está acotada a propósito: es la única familia donde una fila nueva
    // significa algo. En el resto, un nombre desconocido es un bug y tiene que hacer ruido.
    for (const nombre of ["inexistente", "comprobantes", "comprobante_0001_X", "comprobantes_0001_minus",
                          "comprobantes_abcd_FACTURA_A", "comprobantes_0001_"]) {
      await expect(pool.query("select siguiente_numero($1)", [nombre]))
        .rejects.toThrow(/No existe el contador/);
    }
    expect(await filas("select nombre from contadores where nombre like '%inexistente%'")).toEqual([]);
  });

  it("R41 · siguiente_numero() sigue teniendo UNA sola definición: 0007 no dejó una sobrecarga", async () => {
    expect(await filas(`select p.proname, count(*)::int as n from pg_proc p
                          join pg_namespace ns on ns.oid = p.pronamespace
                         where ns.nspname='public'
                           and p.proname in ('siguiente_numero','crear_venta','fijar_contador_comprobante',
                                             'nombre_contador_comprobante')
                         group by 1 order by 1`)).toEqual([
      { proname: "crear_venta", n: 1 },
      { proname: "fijar_contador_comprobante", n: 1 },
      { proname: "nombre_contador_comprobante", n: 1 },
      { proname: "siguiente_numero", n: 1 },
    ]);
  });
});

// ===========================================================================
// 2. ventas y asientos arrancan en 0: la primera operación obtiene el 1 (P7).
// ===========================================================================
describe("NUMERACION_CORTE · ventas y asientos arrancan en 0", () => {
  it("las filas existen y valen 0 apenas aplicadas las migraciones", async () => {
    expect(await filas(`select nombre, ultimo::int as ultimo from contadores
                         where nombre in ('ventas','asientos') order by nombre`)).toEqual([
      { nombre: "asientos", ultimo: 0 },
      { nombre: "ventas", ultimo: 0 },
    ]);
  });

  it("la PRIMERA llamada a siguiente_numero() devuelve 1, no 0 ni 2", async () => {
    expect(Number((await una("select siguiente_numero('ventas') as n")).n)).toBe(1);
    expect(Number((await una("select siguiente_numero('asientos') as n")).n)).toBe(1);
  });

  it("end to end: la primera venta lleva número 1 y su asiento también", async () => {
    await crearVenta(1, pool, { idem: "p7-primera" });
    expect(await una("select numero::int as numero from ventas")).toEqual({ numero: 1 });
    expect(await una("select numero::int as numero from asientos")).toEqual({ numero: 1 });
    await crearVenta(1, pool, { idem: "p7-segunda" });
    expect(await filas("select numero::int as numero from ventas order by numero"))
      .toEqual([{ numero: 1 }, { numero: 2 }]);
  });

  it("un contador nunca puede quedar en negativo, tampoco por SQL directo", async () => {
    await expect(pool.query("update contadores set ultimo = -1 where nombre='ventas'"))
      .rejects.toThrow(/contadores_ultimo_no_negativo/);
    expect(await contador("ventas")).toBe(0);
  });

  it("fijar_contador_comprobante() NO puede tocar ventas ni asientos", async () => {
    // Inalcanzables por construcción: el único nombre que arma la función pasa por
    // nombre_contador_comprobante(), que siempre devuelve 'comprobantes_…'.
    for (const pv of ["ventas", "asientos"]) {
      await expect(fijar(pv, "FACTURA_A", 500, "u-gaston"))
        .rejects.toThrow(/punto de venta invalido/);
    }
    expect(await contador("ventas")).toBe(0);
    expect(await contador("asientos")).toBe(0);
    expect(await constancias()).toEqual([]);
  });
});

// ===========================================================================
// 3. Correlatividad bajo concurrencia y bajo error.
// ===========================================================================
describe("NUMERACION_CORTE · correlatividad bajo concurrencia", () => {
  it("dos sesiones ESTRENANDO el mismo contador obtienen 1 y 2: la segunda bloquea hasta el commit", async () => {
    const a = await cliente();
    const b = await cliente();
    try {
      await a.query("begin");
      await b.query("begin");
      const na = await emitir("0001", "COMPROBANTE_INTERNO", a);
      expect(na).toBe(1);

      let bResuelto = false;
      const pb = emitir("0001", "COMPROBANTE_INTERNO", b).then((n) => { bResuelto = true; return n; });
      await dormir(600);
      // La afirmación fuerte: B NO pudo resolver antes de que A commiteara. Si las dos pudieran
      // avanzar, las dos se llevarían el 1 y habría dos comprobantes con el mismo número.
      expect(bResuelto).toBe(false);

      await a.query("commit");
      expect(await pb).toBe(2);
      await b.query("commit");
      expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(2);
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  it("dos sesiones sobre un contador YA fijado obtienen 1501 y 1502, sin repetir ni saltear", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte");
    const a = await cliente();
    const b = await cliente();
    try {
      await a.query("begin");
      await b.query("begin");
      expect(await emitir("0001", "COMPROBANTE_INTERNO", a)).toBe(1501);
      let bResuelto = false;
      const pb = emitir("0001", "COMPROBANTE_INTERNO", b).then((n) => { bResuelto = true; return n; });
      await dormir(600);
      expect(bResuelto).toBe(false);
      await a.query("commit");
      expect(await pb).toBe(1502);
      await b.query("commit");
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  it("dos puntos de venta en paralelo NO se bloquean entre sí y cada uno se lleva su 1", async () => {
    const a = await cliente();
    const b = await cliente();
    try {
      await a.query("begin");
      await b.query("begin");
      expect(await emitir("0001", "COMPROBANTE_INTERNO", a)).toBe(1);
      // Contadores distintos: B resuelve sin esperar el commit de A, y también obtiene el 1.
      expect(await emitir("0002", "COMPROBANTE_INTERNO", b)).toBe(1);
      await a.query("commit");
      await b.query("commit");
      expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1);
      expect(await contador("comprobantes_0002_COMPROBANTE_INTERNO")).toBe(1);
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });

  it("diez emisiones concurrentes del mismo contador dan 1..10 exactos, sin repetidos ni huecos", async () => {
    const clientes = await Promise.all(Array.from({ length: 10 }, () => cliente()));
    try {
      const numeros = await Promise.all(
        clientes.map(async (c) => {
          await c.query("begin");
          const n = await emitir("0001", "FACTURA_B", c);
          await c.query("commit");
          return n;
        }));
      expect([...numeros].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(new Set(numeros).size).toBe(10);
      expect(await contador("comprobantes_0001_FACTURA_B")).toBe(10);
    } finally {
      await Promise.all(clientes.map((c) => c.end().catch(() => {})));
    }
  });
});

describe("NUMERACION_CORTE · el ROLLBACK devuelve el número (R10)", () => {
  // Ésta es la diferencia con Firestore, donde el contador se incrementa en transacción propia
  // y una venta fallida QUEMA el número. Acá el contador vive dentro de la transacción de la
  // operación: si la operación se cae, el número vuelve.

  it("estreno abortado: el contador no queda creado y el próximo comprobante sigue siendo el 1", async () => {
    const c = await cliente();
    try {
      await c.query("begin");
      expect(await emitir("0001", "FACTURA_A", c)).toBe(1);
      await c.query("rollback");
      expect(await contador("comprobantes_0001_FACTURA_A")).toBe(null);
      expect(await emitir("0001", "FACTURA_A")).toBe(1);
    } finally { await c.end().catch(() => {}); }
  });

  it("sobre un contador ya fijado: el número vuelve y no queda hueco en la correlatividad", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte");
    const c = await cliente();
    try {
      await c.query("begin");
      expect(await emitir("0001", "COMPROBANTE_INTERNO", c)).toBe(1501);
      await c.query("rollback");
      expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1500);
      // El 1501 se vuelve a entregar: no se quemó.
      expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1501);
      expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1502);
    } finally { await c.end().catch(() => {}); }
  });

  it("una tanda con un aborto en el medio deja 1,2,3 correlativos, no 1,3,4", async () => {
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1);
    const c = await cliente();
    try {
      await c.query("begin");
      await emitir("0001", "COMPROBANTE_INTERNO", c);
      await c.query("rollback");
    } finally { await c.end().catch(() => {}); }
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(2);
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(3);
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(3);
  });

  it("un error en el medio de la transacción también devuelve el número", async () => {
    // No hace falta un ROLLBACK explícito: cualquier excepción que aborte la transacción sirve.
    const c = await cliente();
    try {
      await c.query("begin");
      expect(await emitir("0001", "FACTURA_B", c)).toBe(1);
      await expect(c.query("select 1/0")).rejects.toThrow();
      await c.query("rollback");
    } finally { await c.end().catch(() => {}); }
    expect(await emitir("0001", "FACTURA_B")).toBe(1);
  });

  it("una venta fallida tampoco quema el número de venta ni el de asiento", async () => {
    await crearVenta(1, pool, { idem: "r10-ok-1" });
    await expect(crearVenta(1, pool, { idem: "r10-falla", fallarEn: "asiento" })).rejects.toThrow();
    await crearVenta(1, pool, { idem: "r10-ok-2" });
    expect(await filas("select numero::int as numero from ventas order by numero"))
      .toEqual([{ numero: 1 }, { numero: 2 }]);
    expect(await filas("select numero::int as numero from asientos order by numero"))
      .toEqual([{ numero: 1 }, { numero: 2 }]);
  });

  it("el corte también hace rollback: ni el contador ni la constancia sobreviven", async () => {
    const c = await cliente();
    try {
      await c.query("begin");
      await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte", false, c);
      expect(Number((await c.query("select ultimo from contadores where nombre='comprobantes_0001_COMPROBANTE_INTERNO'")).rows[0].ultimo)).toBe(1500);
      await c.query("rollback");
    } finally { await c.end().catch(() => {}); }
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(null);
    expect(await constancias()).toEqual([]);
  });
});

// ===========================================================================
// 4. Las tres ramas del corte.
// ===========================================================================
describe("NUMERACION_CORTE · el corte continúa la numeración de Firestore", () => {
  it("fijado en 1500, el siguiente comprobante es el 1501 y la secuencia sigue de ahí", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte de Firestore 2026-09-05");
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1500);
    expect(await emitirN("0001", "COMPROBANTE_INTERNO", 3)).toEqual([1501, 1502, 1503]);
  });

  it("fijar en 0 es una declaración válida: significa 'nunca se emitió ninguno, empezá en 1'", async () => {
    const id = await fijar("0003", "FACTURA_A", 0, "u-gaston", "punto de venta nuevo");
    expect(id).toBeGreaterThan(0);
    expect(await contador("comprobantes_0003_FACTURA_A")).toBe(0);
    expect(await emitir("0003", "FACTURA_A")).toBe(1);
  });

  it("(a) MISMO VALOR sin usar · idempotente: mismo id, UNA sola constancia, contador quieto", async () => {
    const id1 = await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte");
    const id2 = await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-otro", "reintento del script");
    const id3 = await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", null);
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
    const c = await constancias();
    expect(c.length).toBe(1);
    expect(c[0]).toMatchObject({
      id: id1, ultimo_anterior: 0, ultimo_fijado: 1500, correccion: false,
      usuario_uid: "u-gaston", motivo: "corte",
    });
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1500);
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1501);
  });

  it("(b) VALOR DISTINTO sin usar · rechaza con NUMERACION_CORTE_YA_FIJADO y no cambia nada", async () => {
    const id1 = await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte");
    await expect(fijar("0001", "COMPROBANTE_INTERNO", 1600, "u-gaston", "me equivoqué"))
      .rejects.toThrow(/NUMERACION_CORTE_YA_FIJADO/);
    // El mensaje sirve para operar: dice en cuánto está, quién lo fijó y qué hacer.
    await expect(fijar("0001", "COMPROBANTE_INTERNO", 1600, "u-gaston"))
      .rejects.toThrow(/ya fue fijado en 1500 por u-gaston/);
    await expect(fijar("0001", "COMPROBANTE_INTERNO", 1600, "u-gaston"))
      .rejects.toThrow(/p_corregir := true/);
    // Y el rechazo no deja rastro: mismo contador, misma única constancia.
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1500);
    expect((await constancias()).map((x) => x.id)).toEqual([id1]);
  });

  it("(b) con p_corregir := true · se aplica y deja una SEGUNDA constancia con correccion = true", async () => {
    const id1 = await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte");
    const id2 = await fijar("0001", "COMPROBANTE_INTERNO", 1600, "u-gaston", "typo en el corte", true);
    expect(id2).not.toBe(id1);
    const c = await constancias();
    expect(c.length).toBe(2);
    expect(c[0]).toMatchObject({ ultimo_anterior: 0, ultimo_fijado: 1500, correccion: false, motivo: "corte" });
    // La corrección NO pisa la fila anterior: se agrega, y guarda de cuánto venía.
    expect(c[1]).toMatchObject({
      id: id2, ultimo_anterior: 1500, ultimo_fijado: 1600, correccion: true,
      usuario_uid: "u-gaston", motivo: "typo en el corte",
    });
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1600);
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1601);
  });

  it("(b) corregir hacia ABAJO también se puede mientras no se haya emitido nada", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 9999, "u-gaston", "dedo pesado");
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "el valor real", true);
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1500);
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1501);
    expect((await constancias()).map((x) => [x.ultimo_anterior, x.ultimo_fijado, x.correccion]))
      .toEqual([[0, 9999, false], [9999, 1500, true]]);
  });

  it("(b) tras corregir, repetir el valor corregido vuelve a ser idempotente", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston");
    const id2 = await fijar("0001", "COMPROBANTE_INTERNO", 1600, "u-gaston", null, true);
    expect(await fijar("0001", "COMPROBANTE_INTERNO", 1600, "u-gaston")).toBe(id2);
    expect((await constancias()).length).toBe(2);
  });

  it("(c) CONTADOR YA AVANZADO sin corte previo · rechaza con NUMERACION_CORTE_EN_USO", async () => {
    // Alguien emitió antes de hacer el corte: el contador se creó en 1.
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1);
    await expect(fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte tardío"))
      .rejects.toThrow(/NUMERACION_CORTE_EN_USO/);
    await expect(fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston"))
      .rejects.toThrow(/ya entrego numeros \(ultimo = 1\)/);
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1);
    expect(await constancias()).toEqual([]);
  });

  it("(c) EL FLAG NO ALCANZA · con p_corregir := true sigue siendo NUMERACION_CORTE_EN_USO", async () => {
    // Ésta es LA barrera que protege la correlatividad. P7 prohíbe las dos salidas: bajarlo
    // reusa números ya entregados, subirlo abre un salto. Como las dos están prohibidas, la
    // función se niega en vez de elegir.
    await emitir("0001", "COMPROBANTE_INTERNO");
    for (const valor of [0, 1, 2, 1500]) {
      await expect(fijar("0001", "COMPROBANTE_INTERNO", valor, "u-gaston", "insisto", true))
        .rejects.toThrow(/NUMERACION_CORTE_EN_USO/);
    }
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1);
    expect(await constancias()).toEqual([]);
    // Y la numeración sigue donde estaba: el rechazo no dejó ningún efecto lateral.
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(2);
  });

  it("(c) CON corte previo y ya emitido · rechaza con y sin flag, y tampoco acepta el mismo valor", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston", "corte");
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1501);
    for (const [valor, corregir] of [[1500, false], [1500, true], [1600, false], [1600, true],
                                     [1501, false], [1501, true]]) {
      await expect(fijar("0001", "COMPROBANTE_INTERNO", valor, "u-gaston", "reintento", corregir))
        .rejects.toThrow(/NUMERACION_CORTE_EN_USO/);
    }
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(1501);
    expect((await constancias()).length).toBe(1);
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1502);
  });

  it("(c) el rechazo es POR CONTADOR: el punto de venta que sí está limpio se puede fijar igual", async () => {
    await emitir("0001", "COMPROBANTE_INTERNO");
    await expect(fijar("0001", "COMPROBANTE_INTERNO", 1500, "u-gaston")).rejects.toThrow(/EN_USO/);
    const id = await fijar("0002", "COMPROBANTE_INTERNO", 900, "u-gaston", "corte 0002");
    expect(id).toBeGreaterThan(0);
    expect(await emitir("0002", "COMPROBANTE_INTERNO")).toBe(901);
  });

  it("MUTACIÓN R20 · si p_corregir salteara la rama (c), el corte pisaría números ya entregados", async () => {
    // Se planta la variante que el implementador consideró y descartó: que el flag también sirva
    // para forzar (c). Bajo la mutación la llamada tiene ÉXITO y el contador vuelve a 0, así que
    // el próximo comprobante repite el número 1 que ya se entregó: dos papeles con el mismo
    // número, exactamente lo que P7 prohíbe. El assert de arriba es el que lo impide.
    await pool.query(`
      create or replace function fijar_contador_comprobante(
        p_punto_venta text, p_tipo_comprobante text, p_ultimo_emitido bigint,
        p_usuario_uid text, p_motivo text default null, p_corregir boolean default false
      ) returns bigint as $mut$
      declare v_nombre text; v_actual bigint; v_id bigint;
      begin
        v_nombre := nombre_contador_comprobante(p_punto_venta, p_tipo_comprobante);
        select ultimo into v_actual from contadores where nombre = v_nombre for update;
        insert into contadores(nombre, ultimo) values (v_nombre, p_ultimo_emitido)
          on conflict (nombre) do update set ultimo = excluded.ultimo;
        insert into contadores_corte(contador, punto_venta, tipo_comprobante, ultimo_anterior,
                                     ultimo_fijado, correccion, usuario_uid, motivo)
          values (v_nombre, p_punto_venta, p_tipo_comprobante, coalesce(v_actual,0),
                  p_ultimo_emitido, p_corregir, p_usuario_uid, p_motivo)
          returning id into v_id;
        return v_id;
      end $mut$ language plpgsql;`);

    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1);
    // Bajo la mutación NO lanza: el assert `rejects.toThrow(/EN_USO/)` se pondría rojo.
    const id = await fijar("0001", "COMPROBANTE_INTERNO", 0, "u-gaston", "forzado", true);
    expect(id).toBeGreaterThan(0);
    expect(await contador("comprobantes_0001_COMPROBANTE_INTERNO")).toBe(0);
    // Y acá está el daño: el número 1 se entrega DOS VECES.
    expect(await emitir("0001", "COMPROBANTE_INTERNO")).toBe(1);
  });

  it("rechaza argumentos inválidos antes de tocar nada", async () => {
    await expect(fijar("0001", "FACTURA_A", -1, "u-gaston"))
      .rejects.toThrow(/el ultimo numero emitido tiene que ser >= 0/);
    await expect(fijar("0001", "FACTURA_A", null, "u-gaston"))
      .rejects.toThrow(/el ultimo numero emitido tiene que ser >= 0 \(llego <null>\)/);
    for (const usuario of [null, "", "   "]) {
      await expect(fijar("0001", "FACTURA_A", 100, usuario))
        .rejects.toThrow(/falta el usuario que hace el corte/);
    }
    expect(await filas("select nombre from contadores where nombre like 'comprobantes%'")).toEqual([]);
    expect(await constancias()).toEqual([]);
  });
});

// ===========================================================================
// 5. La constancia es consultable y no se edita.
// ===========================================================================
describe("NUMERACION_CORTE · la constancia del corte es consultable", () => {
  it("responde quién, cuándo, de cuánto a cuánto, si fue corrección y por qué", async () => {
    const antes = new Date();
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "uid-gaston", "corte de Firestore, doc contadores/comprobantes_0001_COMPROBANTE_INTERNO");
    await fijar("0002", "COMPROBANTE_INTERNO", 320, "uid-gaston", "corte sucursal 2");
    await fijar("0001", "NOTA_CREDITO_INTERNA", 44, "uid-empleado", "corte NC");
    const despues = new Date();

    const c = await constancias();
    expect(c.length).toBe(3);
    expect(c.map((x) => [x.contador, x.punto_venta, x.tipo_comprobante, x.ultimo_anterior, x.ultimo_fijado, x.correccion, x.usuario_uid])).toEqual([
      ["comprobantes_0001_COMPROBANTE_INTERNO", "0001", "COMPROBANTE_INTERNO", 0, 1500, false, "uid-gaston"],
      ["comprobantes_0002_COMPROBANTE_INTERNO", "0002", "COMPROBANTE_INTERNO", 0, 320, false, "uid-gaston"],
      ["comprobantes_0001_NOTA_CREDITO_INTERNA", "0001", "NOTA_CREDITO_INTERNA", 0, 44, false, "uid-empleado"],
    ]);
    // El "cuándo" es un instante real, no un default vacío.
    for (const fila of c) {
      expect(fila.fijado_en).toBeInstanceOf(Date);
      expect(fila.fijado_en.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
      expect(fila.fijado_en.getTime()).toBeLessThanOrEqual(despues.getTime() + 1000);
    }
    expect(c[0].motivo).toMatch(/corte de Firestore/);
  });

  it("se puede consultar meses después POR CONTADOR: la fila que rige y toda la historia", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "uid-gaston", "corte");
    await fijar("0001", "COMPROBANTE_INTERNO", 1501, "uid-gaston", "faltaba uno", true);
    await fijar("0002", "COMPROBANTE_INTERNO", 320, "uid-otro", "corte 0002");

    const historia = await constancias("comprobantes_0001_COMPROBANTE_INTERNO");
    expect(historia.map((x) => [x.ultimo_fijado, x.correccion, x.usuario_uid, x.motivo])).toEqual([
      [1500, false, "uid-gaston", "corte"],
      [1501, true, "uid-gaston", "faltaba uno"],
    ]);
    // La que rige es la última, y coincide con el contador vivo.
    const rige = historia[historia.length - 1];
    expect(rige.ultimo_fijado).toBe(await contador("comprobantes_0001_COMPROBANTE_INTERNO"));
    // Y la de 0002 no se mezcló.
    expect((await constancias("comprobantes_0002_COMPROBANTE_INTERNO")).length).toBe(1);
  });

  it("la constancia es append-only en la BASE: no se actualiza, no se borra, no se trunca", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "uid-gaston", "corte");
    const antes = await constancias();

    await expect(pool.query("update contadores_corte set ultimo_fijado = 99"))
      .rejects.toThrow(/NUMERACION_CORTE_INMUTABLE/);
    await expect(pool.query("update contadores_corte set usuario_uid = 'otro'"))
      .rejects.toThrow(/NUMERACION_CORTE_INMUTABLE/);
    // También el UPDATE que no cambia ningún valor: el trigger es BEFORE y no compara.
    await expect(pool.query("update contadores_corte set ultimo_fijado = ultimo_fijado"))
      .rejects.toThrow(/NUMERACION_CORTE_INMUTABLE/);
    await expect(pool.query("delete from contadores_corte"))
      .rejects.toThrow(/NUMERACION_CORTE_INMUTABLE/);
    await expect(pool.query("truncate contadores_corte"))
      .rejects.toThrow(/NUMERACION_CORTE_INMUTABLE|no se trunca/);

    expect(await constancias()).toEqual(antes);
  });

  it("la constancia apunta a un contador que existe de verdad (FK), no a un nombre suelto", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "uid-gaston");
    expect(await filas(`select cc.contador from contadores_corte cc
                          left join contadores c on c.nombre = cc.contador
                         where c.nombre is null`)).toEqual([]);
    await expect(pool.query(
      `insert into contadores_corte(contador, punto_venta, tipo_comprobante, ultimo_anterior,
                                    ultimo_fijado, usuario_uid)
       values ('comprobantes_9999_INVENTADO','9999','INVENTADO',0,1,'u')`))
      .rejects.toThrow(/foreign key|contadores_corte_contador_fkey/i);
  });

  it("la constancia exige usuario no vacío también por SQL directo", async () => {
    await fijar("0001", "COMPROBANTE_INTERNO", 1500, "uid-gaston");
    await expect(pool.query(
      `insert into contadores_corte(contador, punto_venta, tipo_comprobante, ultimo_anterior,
                                    ultimo_fijado, usuario_uid)
       values ('comprobantes_0001_COMPROBANTE_INTERNO','0001','COMPROBANTE_INTERNO',0,1,'   ')`))
      .rejects.toThrow(/usuario_uid/);
  });
});

// ===========================================================================
// 6. Hallazgo del auditor de tests: la barrera del corte no es a prueba de carrera
//    cuando el contador todavía NO tiene fila.
// ===========================================================================
describe("NUMERACION_CORTE · HALLAZGO abierto (known-failing, ver TEST_RESULTS.md)", () => {
  // fijar_contador_comprobante() hace `select ... from contadores where nombre = v_nombre
  // for update` para serializar. Si la fila TODAVÍA NO EXISTE ese SELECT no bloquea nada: las
  // ramas (b) y (c) se evalúan sobre v_actual = null y el `insert ... on conflict do update
  // set ultimo = excluded.ultimo` de más abajo pisa lo que haya quedado.
  //
  // Consecuencia: una emisión concurrente al corte, sobre un contador sin fila, termina con el
  // contador reseteado al valor del corte y el número ya entregado se vuelve a entregar. Es la
  // rama (c) esquivada por una carrera, no por el flag.
  //
  // Ventana real: el corte se hace una vez, antes de emitir. Pero (c) existe justamente para NO
  // asumir eso. Se deja como `it.fails` para que la suite quede verde HOY y se ponga roja el día
  // en que se arregle, obligando a actualizar este archivo. Decisión de si se arregla: del
  // director. El auditor de tests no toca backend/.

  it.fails("una emisión concurrente al corte NO debería poder reusar un número ya entregado", async () => {
    const emisor = await cliente();
    const cortador = await cliente();
    try {
      await emisor.query("begin");
      await cortador.query("begin");

      // El emisor estrena el contador y se lleva el 1, todavía sin commitear.
      expect(await emitir("0004", "FACTURA_B", emisor)).toBe(1);

      // El corte arranca sin ver la fila: su SELECT ... FOR UPDATE no encuentra nada y no bloquea.
      const pCorte = fijar("0004", "FACTURA_B", 0, "u-gaston", "corte", false, cortador)
        .then(() => "aplicado").catch((e) => "rechazado: " + e.message.slice(0, 40));
      await dormir(400);
      await emisor.query("commit");
      const resultado = await pCorte;
      await cortador.query("commit").catch(() => {});

      // LO QUE SE ESPERA: el corte se rechaza (rama c) o, como mínimo, el número 1 no se repite.
      expect(resultado).toMatch(/^rechazado/);
      expect(await emitir("0004", "FACTURA_B")).toBe(2);
    } finally {
      await emisor.end().catch(() => {});
      await cortador.end().catch(() => {});
    }
  });

  // Segundo hallazgo, menor y no fiscal: el guard del "quién" usa btrim(), que en PostgreSQL
  // recorta SOLO espacios. Un usuario_uid de una tabulación pasa el guard de la función Y el
  // CHECK de la tabla —que usa el mismo btrim()— y queda como constancia de un "quién" vacío.
  // null, "" y "   " sí se rechazan (probado arriba). Se deja como it.fails por lo mismo.
  it.fails("un usuario_uid de solo tabulaciones NO debería contar como 'quién'", async () => {
    await expect(fijar("0001", "FACTURA_A", 100, "\t"))
      .rejects.toThrow(/falta el usuario que hace el corte/);
  });

  it.fails("dos cortes primerizos simultáneos con valores distintos NO deberían aplicarse los dos", async () => {
    const a = await cliente();
    const b = await cliente();
    try {
      await a.query("begin");
      await b.query("begin");
      await fijar("0009", "FACTURA_C", 1000, "u-a", "corte", false, a);
      const pb = fijar("0009", "FACTURA_C", 7777, "u-b", "corte", false, b)
        .then(() => "aplicado").catch((e) => "rechazado: " + e.message.slice(0, 40));
      await dormir(400);
      await a.query("commit");
      const rb = await pb;
      await b.query("commit").catch(() => {});
      // LO QUE SE ESPERA: el segundo, con valor distinto, cae por NUMERACION_CORTE_YA_FIJADO.
      expect(rb).toMatch(/^rechazado/);
      expect(await contador("comprobantes_0009_FACTURA_C")).toBe(1000);
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
    }
  });
});
