// TASK-013 — R20: la demostracion de que los tests de este cambio PUEDEN fallar.
//
// Un test que pasa con la proteccion puesta y tambien con la proteccion sacada no prueba nada.
// Acá, por cada propiedad de TASK-013 se arma un MUTANTE —una copia de `scripts/seed-emulator.mjs`
// con esa proteccion rota, en el temporal del sistema, FUERA del repo— y se lo evalua con
// EXACTAMENTE la misma funcion de verificacion que usa el test real (las de
// tests/herramientas/seed-verificaciones.mjs). El test real espera `.not.toThrow()`; el de acá
// espera `.toThrow()`.
//
// Cada test corre las dos cosas: la copia SIN mutar (tiene que pasar) y la mutada (tiene que
// fallar). Asi queda descartado que el rojo venga del mecanismo de copia y no de la mutacion.
//
// `mutar()` exige que cada fragmento aparezca exactamente una vez: un mutante que no muta nada
// seria un R20 falso, y revienta en vez de mentir.
//
// SEGURIDAD DE LOS MUTANTES. Un mutante con la barrera de emulador rota es, por definicion, un
// script sin barreras. Por eso NINGUN mutante se corre con un host que pueda salir a internet:
// solo `http://undefined` (falla en el DNS) y `127.0.0.2:1` (loopback sin nadie escuchando).
// Tampoco se corre ningun mutante en modo sembrado sin variables de emulador, que es el unico
// camino en el que el Admin SDK podria intentar hablar con Google. Y `scripts/` nunca se toca.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { correrSeed, crearCopia, mutar } from "../herramientas/seed-proceso.mjs";
import { levantarEmuladorFalso } from "../herramientas/emulador-falso.mjs";
import {
  PROYECTO_PROTEGIDO,
  NAMESPACE_BASURA,
  verificarAbortaPorProyectoForzado,
  verificarAbortaSinVariablesDeEmulador,
  verificarAbortaPorEmuladorNoLocal,
  verificarAbortaPorConfigAmbigua,
  verificarProyectoLeidoDelArchivo,
  verificarBarridoAcotado,
} from "../herramientas/seed-verificaciones.mjs";

// --- las mutaciones, cada una rompiendo UNA proteccion ---------------------------------------
const SIN_CHEQUEO_DE_PROYECTO = [
  { de: "const distintas = forzadas.filter(([, v]) => v !== PROYECTO_ERP);", a: "const distintas = [];" },
];
const SIN_BARRERA_DE_VARIABLES = [{ de: "if (!AUTH || !FIRESTORE) {", a: "if (false) {" }];
const SIN_BARRERA_DE_LOCAL = [
  { de: 'if (!/^(127\\.0\\.0\\.1|localhost):\\d+$/.test(valor.replace(/^https?:\\/\\//, ""))) {', a: "if (false) {" },
];
const NAMESPACE_POR_ENTORNO = [
  { de: 'const NAMESPACES_BORRABLES = Object.freeze(["demo-delfino"]);', a: 'const NAMESPACES_BORRABLES = Object.freeze([process.env.NS_BASURA ?? "demo-delfino"]);' },
  { de: 'const NAMESPACE_BASURA = "demo-delfino";', a: 'const NAMESPACE_BASURA = process.env.NS_BASURA ?? "demo-delfino";' },
];
const PROYECTO_HARDCODEADO = [{ de: "  return unicos[0];", a: '  return "demo-delfino";' }];
const SIN_CHEQUEO_DE_AMBIGUEDAD = [{ de: "if (unicos.length !== 1) {", a: "if (false) {" }];

let falso;
let env;

beforeAll(async () => {
  falso = await levantarEmuladorFalso({
    [NAMESPACE_BASURA]: { colecciones: { usuarios: [{ id: "u1" }] }, usuarios: [{ localId: "u1", email: "a@delfino.local" }] },
    [PROYECTO_PROTEGIDO]: { colecciones: { ventas: [{ id: "V-1" }] }, usuarios: [{ localId: "r1", email: "admin@delfino.local" }] },
  });
  env = { FIRESTORE_EMULATOR_HOST: falso.host, FIREBASE_AUTH_EMULATOR_HOST: falso.host };
});

afterAll(async () => {
  await falso?.cerrar();
});

beforeEach(() => {
  falso.peticiones.length = 0;
});

async function conCopia(opciones, usar) {
  const copia = crearCopia(opciones);
  try {
    return await usar(copia);
  } finally {
    copia.destruir();
  }
}

describe("R20 — mutar el seed pone en rojo el test que protege esa propiedad", () => {
  it("la herramienta de mutacion se niega a mutar un fragmento que no aparece exactamente una vez", () => {
    expect(() => mutar("a b c", [{ de: "z", a: "y" }])).toThrow(/MUTACION INVALIDA/);
    expect(() => mutar("a a", [{ de: "a", a: "b" }])).toThrow(/MUTACION INVALIDA/);
    expect(mutar("a b", [{ de: "a", a: "z" }])).toBe("z b");
  });

  it("SEED_PROYECTO_COINCIDE: sin el chequeo de proyecto forzado, el test se pone rojo", async () => {
    const argumentos = { env: { ...env, GCLOUD_PROJECT: NAMESPACE_BASURA }, timeoutMs: 12000 };
    const esperado = {
      proyectoErp: PROYECTO_PROTEGIDO,
      proyectoForzado: NAMESPACE_BASURA,
      variable: "GCLOUD_PROJECT",
    };

    // (a) copia sin mutar: la verificacion pasa, igual que contra el repo.
    await conCopia({}, async (copia) => {
      falso.peticiones.length = 0;
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaPorProyectoForzado(r, { ...esperado, peticiones: falso.peticiones })).not.toThrow();
    });

    // (b) mutante sin el chequeo: la MISMA verificacion tiene que fallar.
    await conCopia({ mutaciones: SIN_CHEQUEO_DE_PROYECTO }, async (copia) => {
      falso.peticiones.length = 0;
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaPorProyectoForzado(r, { ...esperado, peticiones: falso.peticiones })).toThrow();
      // Y la prueba de que la proteccion realmente se fue: el mutante NO aborta y sigue de largo
      // hasta hablarle al emulador con el proyecto equivocado.
      expect(r.error).not.toMatch(/sembraria en un proyecto que el ERP local no mira/);
      expect(falso.peticiones.length, "el mutante tenía que seguir de largo hasta el emulador").toBeGreaterThan(0);
    });
  }, 40000);

  it("SEED_BARRERA_EMULADOR: sin la barrera de variables, el test se pone rojo", async () => {
    // Modo reporte a proposito: es puro REST y, sin variables, la URL queda en "http://undefined",
    // que muere en el DNS. Un mutante en modo sembrado y sin variables seria el unico camino que
    // podria intentar hablar con Google, y por eso no se corre.
    const argumentos = { args: ["--reporte-demo"], env: {}, timeoutMs: 12000 };

    await conCopia({}, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaSinVariablesDeEmulador(r)).not.toThrow();
    });

    await conCopia({ mutaciones: SIN_BARRERA_DE_VARIABLES }, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaSinVariablesDeEmulador(r)).toThrow();
      expect(r.error).not.toMatch(/ABORTADO: faltan/);
    });
  }, 40000);

  it("SEED_BARRERA_EMULADOR: sin la barrera de 'tiene que ser local', el test se pone rojo", async () => {
    // 127.0.0.2:1 es loopback y no hay nadie escuchando: el mutante se estrella contra un
    // ECONNREFUSED en vez de salir a la red. Nunca se usa un host ruteable con un mutante.
    const HOST = "127.0.0.2:1";
    const argumentos = {
      args: ["--reporte-demo"],
      env: { FIRESTORE_EMULATOR_HOST: HOST, FIREBASE_AUTH_EMULATOR_HOST: HOST },
      timeoutMs: 12000,
    };

    await conCopia({}, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaPorEmuladorNoLocal(r, { valor: HOST })).not.toThrow();
    });

    await conCopia({ mutaciones: SIN_BARRERA_DE_LOCAL }, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaPorEmuladorNoLocal(r, { valor: HOST })).toThrow();
      expect(r.error).not.toMatch(/no es local/);
    });
  }, 40000);

  it("SEED_BARRIDO_ACOTADO: si el namespace a borrar sale del entorno, el test se pone rojo", async () => {
    // Este es EL mutante que importa: convierte el barrido en apuntable desde afuera. Se lo apunta
    // a un nombre que contiene al del ERP para que ademas atraviese los candados internos del
    // script (no es igual a PROYECTO_ERP ni figura en la lista original de borrables).
    const OBJETIVO = `${PROYECTO_PROTEGIDO}-copia`;

    await conCopia({}, async (copia) => {
      falso.peticiones.length = 0;
      const antes = structuredClone(falso.estado[PROYECTO_PROTEGIDO]);
      const r = await correrSeed({ raiz: copia.raiz, args: ["--limpiar-demo-delfino"], env: { ...env, NS_BASURA: OBJETIVO } });
      expect(r.expiro).toBe(false);
      expect(() =>
        verificarBarridoAcotado({
          peticiones: falso.peticiones,
          estadoProtegidoAntes: antes,
          estadoProtegidoDespues: falso.estado[PROYECTO_PROTEGIDO],
        })
      ).not.toThrow();
    });

    await conCopia({ mutaciones: NAMESPACE_POR_ENTORNO }, async (copia) => {
      falso.peticiones.length = 0;
      // Con datos adentro, para que el mutante llegue a emitir los DELETE y no se corte con un
      // "nada que borrar" que dejaria la demostracion a medias.
      falso.estado[OBJETIVO] = { colecciones: { ventas: [{ id: "V-9" }] }, usuarios: [{ localId: "x", email: "x@delfino.local" }] };
      const antes = structuredClone(falso.estado[PROYECTO_PROTEGIDO]);
      const r = await correrSeed({ raiz: copia.raiz, args: ["--limpiar-demo-delfino"], env: { ...env, NS_BASURA: OBJETIVO } });
      expect(r.expiro).toBe(false);
      expect(() =>
        verificarBarridoAcotado({
          peticiones: falso.peticiones,
          estadoProtegidoAntes: antes,
          estadoProtegidoDespues: falso.estado[PROYECTO_PROTEGIDO],
        })
      ).toThrow(/ALCANCE ROTO/);
      // Confirmacion directa: el mutante le pidio al emulador borrar OTRO namespace.
      expect(falso.borrados().some((p) => p.url.includes(OBJETIVO))).toBe(true);
    });
  }, 40000);

  it("SEED_PROYECTO_UNICO: con el projectId hardcodeado, el test se pone rojo", async () => {
    const argumentos = { env: { ...env, GCLOUD_PROJECT: "otro-distinto" }, timeoutMs: 12000 };

    await conCopia({ projectId: "proyecto-inventado-xyz" }, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarProyectoLeidoDelArchivo(r, "proyecto-inventado-xyz")).not.toThrow();
    });

    await conCopia({ projectId: "proyecto-inventado-xyz", mutaciones: PROYECTO_HARDCODEADO }, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarProyectoLeidoDelArchivo(r, "proyecto-inventado-xyz")).toThrow();
      expect(r.error).toMatch(/proyecto del ERP\s+demo-delfino/);
    });
  }, 40000);

  it("SEED_PROYECTO_UNICO: sin el chequeo de ambiguedad, el test se pone rojo", async () => {
    const CONFIG_AMBIGUA = 'export const firebaseConfig = { projectId: "uno-x" };\nexport const otro = { projectId: "dos-y" };\n';
    const argumentos = { env: { ...env, GCLOUD_PROJECT: "otro-distinto" }, timeoutMs: 12000 };

    await conCopia({ configFuente: CONFIG_AMBIGUA }, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaPorConfigAmbigua(r, { cantidad: 2 })).not.toThrow();
    });

    await conCopia({ configFuente: CONFIG_AMBIGUA, mutaciones: SIN_CHEQUEO_DE_AMBIGUEDAD }, async (copia) => {
      const r = await correrSeed({ raiz: copia.raiz, ...argumentos });
      expect(() => verificarAbortaPorConfigAmbigua(r, { cantidad: 2 })).toThrow();
      // El mutante adivina: se queda con el primero y sigue como si nada.
      expect(r.error).toMatch(/proyecto del ERP\s+uno-x/);
    });
  }, 40000);
});
