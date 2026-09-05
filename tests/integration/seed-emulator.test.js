// TASK-013 — Lo que solo se puede probar contra el emulador de VERDAD: que sembrar deja el
// usuario donde el ERP lo ve, que correrlo dos veces deja el mismo estado, y que la limpieza de
// `demo-delfino` borra de verdad. Invariantes SEED_USUARIO_VISIBLE, SEED_IDEMPOTENTE,
// SEED_LIMPIEZA_REAL y SEED_ERP_INTACTO.
//
// REGLA DE ORO DE ESTE ARCHIVO: `delfino-hogar-erp` es el entorno de trabajo de Gaston y tiene que
// quedar EXACTAMENTE como estaba. Por eso:
//   - el seed NO se corre nunca sobre `delfino-hogar-erp`. Se corre sobre una COPIA del arbol
//     (fuera del repo) cuyo js/firebase-config.js declara un namespace efimero propio,
//     `tester-task013-<uuid>`, que este archivo crea y borra.
//   - `delfino-hogar-erp` solo se LEE, y se lee dos veces: al principio y al final. Las dos huellas
//     se comparan enteras, campo por campo, incluidos createTime y updateTime de cada documento.
//     Con los tiempos adentro, "no lo toqué" no se puede confundir con "lo reescribí igual".
//   - la limpieza real de `demo-delfino` solo se ejecuta si ese namespace esta vacio o contiene
//     unicamente los marcadores que puso este archivo. Si hay algo ajeno, el test falla como
//     problema de entorno y NO borra nada.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import admin from "firebase-admin";
import { correrSeed, crearCopia } from "../herramientas/seed-proceso.mjs";
import { inventarioNamespace, huella, urlBase, ordenarProfundo, CAMPOS_AUTH_VOLATILES } from "../herramientas/emulador-rest.mjs";
import { PROYECTO_PROTEGIDO, NAMESPACE_BASURA, SALIDA_ABORTO_LIBUV } from "../herramientas/seed-verificaciones.mjs";

const LOCAL = /^(127\.0\.0\.1|localhost):\d+$/;
const CABECERAS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

const CORRIDA = randomUUID().slice(0, 8);
const NS_PROPIO = `tester-task013-${CORRIDA}`;
const PATRON_NS_PROPIO = /^tester-task013-[0-9a-f]{8}$/;
const COLECCION_MARCADOR = "task013Marcadores";
const EMAIL_MARCADOR = `task013-${CORRIDA}@test.local`;

let F, A;
let huellaBuenoAntes;
let copia;
let appDemo;
let marcadoresPuestos = false;
let codigoReporte;
let codigoLimpieza;

function exigirEntorno(condicion, mensaje) {
  if (!condicion) throw new Error(`\n[INFRAESTRUCTURA] ${mensaje}\n`);
}

async function pedir(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { ...CABECERAS, ...(opciones.headers || {}) } });
  if (!r.ok) throw new Error(`${opciones.method || "GET"} ${url} -> ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}

/**
 * Vacia un namespace del emulador. Un solo candado, pero infranqueable: el nombre tiene que
 * coincidir con el patron de los namespaces que crea ESTA corrida. Cualquier otro nombre
 * —`delfino-hogar-erp` y `demo-delfino` incluidos— tira error y no borra nada.
 */
async function borrarNamespacePropio(ns) {
  if (!PATRON_NS_PROPIO.test(ns)) throw new Error(`[SEGURIDAD] "${ns}" no es un namespace de esta corrida. No se borra.`);
  await pedir(`${F}/emulator/v1/projects/${ns}/databases/(default)/documents`, { method: "DELETE" });
  await pedir(`${A}/emulator/v1/projects/${ns}/accounts`, { method: "DELETE" });
}

/** Quita de un inventario lo que cambia solo por volver a correr el seed. */
function normalizarParaIdempotencia(inv) {
  return ordenarProfundo({
    proyecto: inv.proyecto,
    usuariosAuth: inv.usuariosAuth.map((u) => {
      const copia = { ...u };
      for (const campo of CAMPOS_AUTH_VOLATILES) delete copia[campo];
      return copia;
    }),
    colecciones: inv.colecciones.map((c) => ({
      nombre: c.nombre,
      docs: c.docs.map((d) => {
        const campos = { ...d.fields };
        // `creadoEn` es un serverTimestamp: cambia en cada corrida por definicion. Se lo saca de la
        // comparacion pero se verifica aparte que siga estando.
        delete campos.creadoEn;
        return { id: d.id, fields: campos };
      }),
    })),
  });
}

beforeAll(async () => {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST || "";
  const auth = (process.env.FIREBASE_AUTH_EMULATOR_HOST || "").replace(/^https?:\/\//, "");
  exigirEntorno(LOCAL.test(firestore), `FIRESTORE_EMULATOR_HOST es "${firestore}" y tiene que ser local. Levantá el emulador con: npm run emulators`);
  exigirEntorno(LOCAL.test(auth), `FIREBASE_AUTH_EMULATOR_HOST es "${auth}" y tiene que ser local. Levantá el emulador con: npm run emulators`);
  F = urlBase(firestore);
  A = urlBase(auth);

  huellaBuenoAntes = huella(await inventarioNamespace(F, A, PROYECTO_PROTEGIDO));

  // `demo-delfino` tiene que estar vacio para que la limpieza real de mas abajo solo pueda borrar
  // lo que ponga este archivo. Si tiene algo, no se pone nada y el test destructivo falla como
  // problema de entorno.
  const demo = await inventarioNamespace(F, A, NAMESPACE_BASURA);
  if (demo.totalDocs === 0 && demo.usuariosAuth.length === 0) {
    appDemo = admin.initializeApp({ projectId: NAMESPACE_BASURA }, `task013-demo-${CORRIDA}`);
    await appDemo.auth().createUser({ email: EMAIL_MARCADOR, password: randomUUID() });
    await appDemo.firestore().collection(COLECCION_MARCADOR).doc(CORRIDA).set({
      deQuien: "tests/integration/seed-emulator.test.js (marcador efimero de TASK-013 - borrar si aparece)",
      corrida: CORRIDA,
    });
    marcadoresPuestos = true;
  }

  // El namespace propio se vacia ANTES de sembrar. No es paranoia: el emulador de Firestore, con
  // `singleProjectMode`, devuelve los documentos del dataset importado para cualquier projectId al
  // que todavia no se le haya escrito. Sin este vaciado, `tester-task013-xxxx` arrancaria "viendo"
  // los 35 documentos de delfino-hogar-erp y el test mediria una mezcla. Medido en esta tarea.
  await borrarNamespacePropio(NS_PROPIO);

  copia = crearCopia({ projectId: NS_PROPIO });
}, 60000);

afterAll(async () => {
  try { await borrarNamespacePropio(NS_PROPIO); } catch { /* el emulador es efimero */ }
  try { copia?.destruir(); } catch { /* nada */ }
  try { await appDemo?.delete(); } catch { /* nada */ }
}, 60000);

// ---------------------------------------------------------------------------------------------
describe("SEED_USUARIO_VISIBLE — sembrar deja el admin donde el ERP lo mira", () => {
  let inv1;

  it("siembra en el namespace que declara js/firebase-config.js, sale 0 y no falla", async () => {
    const r = await correrSeed({
      raiz: copia.raiz,
      env: {
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      },
      timeoutMs: 60000,
    });
    expect(r.error, "el seed falló contra el emulador de verdad").toBe("");
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(NS_PROPIO);

    inv1 = await inventarioNamespace(F, A, NS_PROPIO);
    expect(inv1.totalDocs, "el seed dijo que sembró pero el namespace del config quedó vacío").toBeGreaterThan(0);
  }, 90000);

  it("deja admin@delfino.local en Auth y su perfil en /usuarios/{uid}, con el mismo uid", () => {
    const usuario = inv1.usuariosAuth.find((u) => u.email === "admin@delfino.local");
    expect(usuario, "no quedó el usuario admin@delfino.local en Auth").toBeTruthy();

    const perfiles = inv1.colecciones.find((c) => c.nombre === "usuarios")?.docs ?? [];
    const perfil = perfiles.find((d) => d.id === usuario.localId);
    expect(perfil, `no quedó /usuarios/${usuario.localId}: el ERP no vería el rol del admin`).toBeTruthy();
    expect(perfil.fields.email.stringValue).toBe("admin@delfino.local");
    expect(perfil.fields.rol.stringValue).toBe("administrador");
    expect(perfil.fields.activo.booleanValue).toBe(true);
  });

  it("deja tambien el plan de cuentas, los maestros y los contadores que el ERP necesita", () => {
    const porNombre = Object.fromEntries(inv1.colecciones.map((c) => [c.nombre, c.docs]));
    expect(Object.keys(porNombre).sort()).toEqual(
      ["categorias", "clientes", "contadores", "cuentasContables", "depositos", "listasPrecios", "marcas", "productos", "sucursales", "usuarios"]
    );
    expect(porNombre.cuentasContables.length).toBeGreaterThan(10);
    expect(porNombre.productos.map((d) => d.id).sort()).toEqual(["DEV-001", "DEV-002", "DEV-003"]);
    expect(porNombre.contadores.map((d) => d.id).sort()).toEqual(["asientos", "comprobantes", "ventas"]);
    for (const c of porNombre.contadores) expect(Number(c.fields.ultimo.integerValue)).toBe(0);
  });

  it("el emulador de Gaston ya tiene el admin sembrado en delfino-hogar-erp (sintoma que originó R16)", async () => {
    // SOLO LECTURA. Si esto falla es, casi seguro, que nadie corrió `npm run seed` contra este
    // emulador: es un rojo de entorno, no de logica. Se deja porque es la evidencia directa de
    // que R16 quedó mitigado en la maquina donde se rompió.
    const inv = await inventarioNamespace(F, A, PROYECTO_PROTEGIDO);
    const usuario = inv.usuariosAuth.find((u) => u.email === "admin@delfino.local");
    exigirEntorno(usuario, `no hay usuario admin@delfino.local en "${PROYECTO_PROTEGIDO}". Corré: npm run seed (lo corre Gastón, no un agente)`);
    const perfiles = inv.colecciones.find((c) => c.nombre === "usuarios")?.docs ?? [];
    expect(perfiles.map((d) => d.id)).toContain(usuario.localId);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
describe("SEED_IDEMPOTENTE — dos corridas seguidas dejan el mismo estado", () => {
  let inv1, inv2;

  it("la segunda corrida sale 0 y deja el mismo estado que la primera", async () => {
    inv1 = await inventarioNamespace(F, A, NS_PROPIO);
    const r = await correrSeed({
      raiz: copia.raiz,
      env: {
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      },
      timeoutMs: 60000,
    });
    expect(r.error).toBe("");
    expect(r.codigo).toBe(0);
    inv2 = await inventarioNamespace(F, A, NS_PROPIO);

    expect(huella(normalizarParaIdempotencia(inv2))).toBe(huella(normalizarParaIdempotencia(inv1)));
  }, 90000);

  it("no duplica el usuario ni el perfil: el uid es el mismo de la primera corrida", () => {
    expect(inv2.usuariosAuth.map((u) => u.email)).toEqual(inv1.usuariosAuth.map((u) => u.email));
    expect(inv2.usuariosAuth.map((u) => u.localId)).toEqual(inv1.usuariosAuth.map((u) => u.localId));
    const perfiles1 = inv1.colecciones.find((c) => c.nombre === "usuarios").docs.map((d) => d.id);
    const perfiles2 = inv2.colecciones.find((c) => c.nombre === "usuarios").docs.map((d) => d.id);
    expect(perfiles2).toEqual(perfiles1);
    expect(perfiles2).toHaveLength(1);
  });

  it("mismo total de documentos y mismas colecciones, sin sobrantes", () => {
    expect(inv2.totalDocs).toBe(inv1.totalDocs);
    expect(inv2.colecciones.map((c) => `${c.nombre}=${c.docs.length}`)).toEqual(inv1.colecciones.map((c) => `${c.nombre}=${c.docs.length}`));
  });

  it("los maestros conservan creadoEn (se reescribe, y eso es lo unico que cambia entre corridas)", () => {
    // Lo unico que difiere entre las dos corridas es el serverTimestamp `creadoEn`, que el seed
    // vuelve a escribir. Se verifica que siga estando y que efectivamente sea lo que cambio: si
    // cambiara algo mas, el assert de arriba ya habria fallado.
    const producto1 = inv1.colecciones.find((c) => c.nombre === "productos").docs.find((d) => d.id === "DEV-001");
    const producto2 = inv2.colecciones.find((c) => c.nombre === "productos").docs.find((d) => d.id === "DEV-001");
    expect(producto1.fields.creadoEn).toBeTruthy();
    expect(producto2.fields.creadoEn).toBeTruthy();
    expect(producto2.updateTime).not.toBe(producto1.updateTime);
  });

  it("OBSERVACION: re-sembrar pisa los contadores y los vuelve a 0", async () => {
    // No es una violacion de idempotencia —f(f(x)) sigue siendo f(x)— pero SI es un riesgo de uso:
    // correr `npm run seed` sobre un emulador con datos de trabajo reinicia ventas, asientos y
    // comprobantes. Queda documentado como comportamiento medido, no como veredicto.
    await pedir(`${F}/v1/projects/${NS_PROPIO}/databases/(default)/documents/contadores/ventas?updateMask.fieldPaths=ultimo`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { ultimo: { integerValue: "7" } } }),
    });
    const r = await correrSeed({
      raiz: copia.raiz,
      env: {
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      },
      timeoutMs: 60000,
    });
    expect(r.codigo).toBe(0);
    const inv = await inventarioNamespace(F, A, NS_PROPIO);
    const ventas = inv.colecciones.find((c) => c.nombre === "contadores").docs.find((d) => d.id === "ventas");
    expect(Number(ventas.fields.ultimo.integerValue)).toBe(0);
  }, 90000);
});

// ---------------------------------------------------------------------------------------------
describe("SEED_LIMPIEZA_REAL — la limpieza borra demo-delfino de verdad y nada mas", () => {
  it("sembrar no barrio demo-delfino: los marcadores siguen ahi", async () => {
    exigirEntorno(marcadoresPuestos, `"${NAMESPACE_BASURA}" no estaba vacío al empezar, así que este archivo no puso marcadores y no va a borrar nada ajeno. Revisalo a mano con: node scripts/seed-emulator.mjs --reporte-demo`);
    const demo = await inventarioNamespace(F, A, NAMESPACE_BASURA);
    expect(demo.usuariosAuth.map((u) => u.email)).toEqual([EMAIL_MARCADOR]);
    expect(demo.colecciones.map((c) => c.nombre)).toEqual([COLECCION_MARCADOR]);
  }, 60000);

  it("el reporte del script ve exactamente esos marcadores", async () => {
    const r = await correrSeed({
      args: ["--reporte-demo"],
      env: {
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      },
    });
    codigoReporte = r.codigo;
    expect(r.salida).toContain(EMAIL_MARCADOR);
    expect(r.salida).toContain(COLECCION_MARCADOR);
    expect(r.salida).toContain(`los tests miran "${PROYECTO_PROTEGIDO}"`);
    expect(r.salida).toMatch(/Usuarios de Auth: 1\b/);
    expect(r.salida).toMatch(/Colecciones: 1, documentos: 1\b/);
  }, 60000);

  it("--limpiar-demo-delfino vacia demo-delfino y deja delfino-hogar-erp intacto", async () => {
    // Ultimo chequeo antes de borrar: adentro de demo-delfino tiene que haber SOLO lo que puso
    // este archivo. Si no, no se ejecuta.
    const antes = await inventarioNamespace(F, A, NAMESPACE_BASURA);
    exigirEntorno(
      antes.usuariosAuth.every((u) => u.email === EMAIL_MARCADOR) && antes.colecciones.every((c) => c.nombre === COLECCION_MARCADOR),
      `"${NAMESPACE_BASURA}" tiene datos que no puso este test. No se ejecuta la limpieza.`
    );
    const huellaBuenoJusto = huella(await inventarioNamespace(F, A, PROYECTO_PROTEGIDO));

    const r = await correrSeed({
      args: ["--limpiar-demo-delfino"],
      env: {
        FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
        FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      },
      timeoutMs: 60000,
    });
    codigoLimpieza = r.codigo;
    expect(r.salida).toContain("quedo vacio");

    const despues = await inventarioNamespace(F, A, NAMESPACE_BASURA);
    expect(despues.totalDocs).toBe(0);
    expect(despues.usuariosAuth).toHaveLength(0);

    expect(huella(await inventarioNamespace(F, A, PROYECTO_PROTEGIDO))).toBe(huellaBuenoJusto);
  }, 90000);

  it("y el namespace propio de esta corrida sobrevivio: el barrido no toco nada que no fuera demo-delfino", async () => {
    const mio = await inventarioNamespace(F, A, NS_PROPIO);
    expect(mio.totalDocs).toBeGreaterThan(0);
    expect(mio.usuariosAuth.map((u) => u.email)).toContain("admin@delfino.local");
  }, 60000);
});

// SEED_REPORTE_FIEL vive ahora en tests/unit/seed-emulator-reporte-fiel.test.js.
//
// Estaba aca y apuntaba a que un namespace virgen del emulador devolviera vacio. Eso es una
// propiedad del EMULADOR —`"singleProjectMode": true` en firebase.json— y no del archivo bajo
// prueba: ningun cambio en `scripts/seed-emulator.mjs` podia hacerlo pasar ni fallar. El
// comportamiento del emulador quedo registrado como riesgo (R35); la invariante se reapunto a lo
// que el seed si controla —que ante un namespace espejado el reporte ADVIERTA en vez de reclamar
// los documentos como propios— y alli se prueba de forma determinista, con el espejo fabricado
// sobre el emulador falso, sin depender de si alguien escribio antes en ese namespace.
//
// Lo que sigue midiendose aca contra el emulador de verdad es que el reporte ve EXACTAMENTE los
// marcadores de esta corrida (SEED_LIMPIEZA_REAL, mas arriba).

// ---------------------------------------------------------------------------------------------
describe("SEED_SALIDA_LIMPIA — una corrida exitosa tiene que salir con 0", () => {
  it("--reporte-demo sale 0 cuando demo-delfino tiene contenido", () => {
    expect(
      codigoReporte,
      "el reporte hizo su trabajo (la salida es correcta) pero el proceso termina con un codigo " +
        "distinto de 0, asi que `npm run seed -- --reporte-demo` se ve como una falla. Medido: 12 de 12 " +
        "corridas fuera de vitest, contra el emulador de verdad, con contenido en demo-delfino. " +
        "El codigo 3221226505 (0xC0000409) viene de la asercion de libuv " +
        "'!(handle->flags & UV_HANDLE_CLOSING)' que dispara `process.exit()` con sockets de fetch " +
        "todavia cerrandose (Node 24.19, Windows). Con demo-delfino vacio no aparece: 15 de 15 en 0."
    ).toBe(0);
  });

  it("--limpiar-demo-delfino: el codigo de salida es inestable por la misma causa (medido: 5 de 8 corridas)", () => {
    // A diferencia del reporte, este camino NO es determinista: 3 de 8 corridas salieron 0 y 5 de 8
    // salieron 3221226505, con el borrado hecho correctamente en las 8. Un test que exigiera 0 acá
    // parpadearia, y un test que parpadea es peor que no tenerlo: el rojo de este defecto lo lleva
    // el test de --reporte-demo, que si es determinista (12 de 12). Este queda como constancia
    // medida de que el mismo problema alcanza al modo de limpieza.
    expect([0, SALIDA_ABORTO_LIBUV]).toContain(codigoLimpieza);
  });
});

// ---------------------------------------------------------------------------------------------
describe("SEED_ERP_INTACTO — delfino-hogar-erp quedo como lo encontramos", () => {
  it("la huella completa de delfino-hogar-erp es identica a la del arranque del archivo", async () => {
    const ahora = huella(await inventarioNamespace(F, A, PROYECTO_PROTEGIDO));
    expect(ahora, "los tests de TASK-013 modificaron el namespace del ERP").toBe(huellaBuenoAntes);
  }, 60000);
});
