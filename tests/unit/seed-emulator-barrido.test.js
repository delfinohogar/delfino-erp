// TASK-013 — Invariante SEED_BARRIDO_ACOTADO.
//
// LA PREGUNTA DE ESTE ARCHIVO: ¿existe alguna forma de que `--limpiar-demo-delfino` termine
// borrando `delfino-hogar-erp`, el namespace que el ERP mira de verdad? Borrado de datos: una
// sola forma que exista es un ROJO.
//
// COMO SE CONTESTA SIN PONER EN RIESGO NINGUN DATO. El seed le habla al emulador por REST y el
// proyecto viaja en la RUTA de cada llamada. Entonces la lista de URLs que el seed emitio ES el
// alcance de lo que puede tocar, sin interpretacion posible. Se lo corre contra el emulador FALSO,
// que anota cada pedido y ademas mantiene estado de los DOS namespaces: si algo alcanzara al
// protegido, se ve en las URLs y ademas se ve porque su estado quedaria vacio.
//
// Los intentos de romperlo estan abajo en una tabla y son deliberadamente hostiles: el nombre del
// namespace bueno como argumento, con mayusculas, con espacios, con sufijos, con separador `=`,
// pegado a la ruta, por variable de entorno, y hasta un homoglifo cirilico. Cada uno se corre y se
// verifica con la MISMA funcion (verificarBarridoAcotado) que verifica el caso feliz.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { correrSeed, crearCopia } from "../herramientas/seed-proceso.mjs";
import { levantarEmuladorFalso } from "../herramientas/emulador-falso.mjs";
import {
  PROYECTO_PROTEGIDO,
  NAMESPACE_BASURA,
  codigoContraEmuladorFalso,
  verificarBarridoAcotado,
  verificarQueNoBorroNada,
} from "../herramientas/seed-verificaciones.mjs";

/** Estado inicial: los DOS namespaces con datos, para que un barrido de mas se note. */
function estadoInicial() {
  return {
    [NAMESPACE_BASURA]: {
      colecciones: {
        usuarios: [{ id: "uid-basura", fields: { email: { stringValue: "admin@delfino.local" } } }],
        productos: [{ id: "DEV-001" }, { id: "DEV-002" }],
      },
      usuarios: [{ localId: "uid-basura", email: "admin@delfino.local" }],
    },
    [PROYECTO_PROTEGIDO]: {
      colecciones: {
        usuarios: [{ id: "uid-real", fields: { email: { stringValue: "admin@delfino.local" } } }],
        cuentasContables: [{ id: "1.1.1" }, { id: "4.1" }],
        ventas: [{ id: "V-0001" }],
      },
      usuarios: [{ localId: "uid-real", email: "admin@delfino.local" }],
    },
  };
}

let falso;
let env;
let protegidoAntes;

beforeAll(async () => {
  falso = await levantarEmuladorFalso(estadoInicial());
  env = { FIRESTORE_EMULATOR_HOST: falso.host, FIREBASE_AUTH_EMULATOR_HOST: falso.host };
});

afterAll(async () => {
  await falso?.cerrar();
});

beforeEach(() => {
  // Estado fresco por test: si un test borra demo-delfino, el siguiente vuelve a tener con que.
  Object.assign(falso.estado, estadoInicial());
  falso.peticiones.length = 0;
  protegidoAntes = structuredClone(falso.estado[PROYECTO_PROTEGIDO]);
});

// ---------------------------------------------------------------------------------------------
describe("SEED_BARRIDO_ACOTADO — el caso feliz solo alcanza demo-delfino", () => {
  it("--limpiar-demo-delfino borra demo-delfino entero y ni nombra delfino-hogar-erp", async () => {
    const r = await correrSeed({ args: ["--limpiar-demo-delfino"], env });
    expect(codigoContraEmuladorFalso(r)).toBe(0);
    expect(() =>
      verificarBarridoAcotado({
        peticiones: falso.peticiones,
        estadoProtegidoAntes: protegidoAntes,
        estadoProtegidoDespues: falso.estado[PROYECTO_PROTEGIDO],
      })
    ).not.toThrow();
    expect(falso.estado[NAMESPACE_BASURA]).toEqual({ colecciones: {}, usuarios: [] });
  });

  it("informa que se va a borrar ANTES de borrar, y verifica que quedo vacio despues", async () => {
    const r = await correrSeed({ args: ["--limpiar-demo-delfino"], env });
    const iSeVa = r.salida.indexOf("SE VA A BORRAR ESTO");
    const iDespues = r.salida.indexOf("=== DESPUES ===");
    expect(iSeVa).toBeGreaterThanOrEqual(0);
    expect(iDespues).toBeGreaterThan(iSeVa);
    expect(r.salida).toContain("quedo vacio");
  });

  it("sobre un demo-delfino ya vacio no borra nada y lo dice", async () => {
    falso.estado[NAMESPACE_BASURA] = { colecciones: {}, usuarios: [] };
    falso.peticiones.length = 0;
    const r = await correrSeed({ args: ["--limpiar-demo-delfino"], env });
    expect(codigoContraEmuladorFalso(r)).toBe(0);
    expect(r.salida).toContain("Nada que borrar");
    expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
describe("SEED_BARRIDO_ACOTADO — la limpieza nunca es automatica", () => {
  it("sembrar (sin argumentos) no emite ni un borrado", async () => {
    const r = await correrSeed({ env: { ...env, GCLOUD_PROJECT: PROYECTO_PROTEGIDO }, timeoutMs: 15000 });
    expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
    expect(falso.estado[NAMESPACE_BASURA].usuarios).toHaveLength(1);
    expect(r.todo).not.toContain("SE VA A BORRAR");
  }, 25000);

  it("--reporte-demo no emite ni un borrado y deja demo-delfino como estaba", async () => {
    const r = await correrSeed({ args: ["--reporte-demo"], env });
    expect(codigoContraEmuladorFalso(r)).toBe(0);
    expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
    expect(falso.estado[NAMESPACE_BASURA].usuarios).toHaveLength(1);
    expect(Object.keys(falso.estado[NAMESPACE_BASURA].colecciones).sort()).toEqual(["productos", "usuarios"]);
  });
});

// ---------------------------------------------------------------------------------------------
// EL PUNTO 1 DE LA CONSIGNA: intentos activos de hacer que el barrido alcance el namespace bueno.
//
// `entorno` se suma al entorno base del test. `args` son los argumentos crudos, tal cual llegarian
// por la linea de comandos. `seEsperaBorrado` dice si ese intento deberia llegar a borrar algo
// (solo el de las variables de entorno: ahi el barrido corre normal y tiene que ignorarlas).
const INTENTOS = [
  { nombre: "el namespace bueno como segundo argumento", args: ["--limpiar-demo-delfino", PROYECTO_PROTEGIDO] },
  { nombre: "el namespace bueno pegado con =", args: [`--limpiar-demo-delfino=${PROYECTO_PROTEGIDO}`] },
  { nombre: "el namespace bueno pegado con :", args: [`--limpiar-demo-delfino:${PROYECTO_PROTEGIDO}`] },
  { nombre: "el namespace bueno solo", args: [PROYECTO_PROTEGIDO] },
  { nombre: "--limpiar con el namespace bueno", args: ["--limpiar", PROYECTO_PROTEGIDO] },
  { nombre: "--limpiar-delfino-hogar-erp", args: ["--limpiar-delfino-hogar-erp"] },
  { nombre: "una bandera --proyecto extra", args: ["--limpiar-demo-delfino", "--proyecto", PROYECTO_PROTEGIDO] },
  { nombre: "todo en mayusculas", args: ["--LIMPIAR-DEMO-DELFINO"] },
  { nombre: "capitalizado", args: ["--Limpiar-Demo-Delfino"] },
  { nombre: "con espacio adelante", args: [" --limpiar-demo-delfino"] },
  { nombre: "con espacio atras", args: ["--limpiar-demo-delfino "] },
  { nombre: "con espacio adentro", args: ["--limpiar demo-delfino"] },
  { nombre: "con salto de linea", args: ["--limpiar-demo-delfino\n"] },
  { nombre: "con sufijo -x", args: ["--limpiar-demo-delfino-x"] },
  { nombre: "con sufijo -hogar-erp", args: ["--limpiar-demo-delfino-hogar-erp"] },
  { nombre: "demo-delfino-x como argumento", args: ["demo-delfino-x"] },
  { nombre: "travesia de rutas", args: [`--limpiar-demo-delfino/../${PROYECTO_PROTEGIDO}`] },
  { nombre: "homoglifo cirilico en delfino", args: ["--limpiar-demo-delfіno"] },
  { nombre: "con --reporte-demo y el namespace bueno", args: ["--reporte-demo", PROYECTO_PROTEGIDO] },
  // Sembrar SI le habla a delfino-hogar-erp: es lo que tiene que hacer. Lo que no puede es borrar.
  // Por eso este caso se verifica distinto, con `modoSembrado`.
  { nombre: "sin ningun argumento (modo sembrar)", args: [], entorno: { GCLOUD_PROJECT: PROYECTO_PROTEGIDO }, tiempo: 15000, modoSembrado: true },
  {
    nombre: "GCLOUD_PROJECT apuntando al namespace bueno",
    args: ["--limpiar-demo-delfino"],
    entorno: { GCLOUD_PROJECT: PROYECTO_PROTEGIDO },
    seEsperaBorrado: true,
  },
  {
    nombre: "GOOGLE_CLOUD_PROJECT apuntando al namespace bueno",
    args: ["--limpiar-demo-delfino"],
    entorno: { GOOGLE_CLOUD_PROJECT: PROYECTO_PROTEGIDO },
    seEsperaBorrado: true,
  },
  {
    nombre: "variables inventadas que suenan a configuracion",
    args: ["--limpiar-demo-delfino"],
    entorno: {
      NAMESPACE_BASURA: PROYECTO_PROTEGIDO,
      NAMESPACES_BORRABLES: PROYECTO_PROTEGIDO,
      SEED_PROYECTO: PROYECTO_PROTEGIDO,
      PROJECT_ID: PROYECTO_PROTEGIDO,
      FIREBASE_PROJECT: PROYECTO_PROTEGIDO,
    },
    seEsperaBorrado: true,
  },
];

describe("SEED_BARRIDO_ACOTADO — ningun intento de apuntar el barrido al namespace bueno lo consigue", () => {
  for (const intento of INTENTOS) {
    it(`no alcanza delfino-hogar-erp: ${intento.nombre}`, async () => {
      const r = await correrSeed({
        args: intento.args,
        env: { ...env, ...(intento.entorno ?? {}) },
        timeoutMs: intento.tiempo ?? 20000,
      });

      // 1. Alcance. En modo sembrado el seed SI le habla al namespace del ERP —para eso existe—,
      //    asi que ahi la propiedad es "no borra nada". En cualquier otro modo, la propiedad es
      //    mas fuerte: ni siquiera lo nombra.
      if (intento.modoSembrado) {
        expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
      } else {
        expect(() =>
          verificarBarridoAcotado({
            peticiones: falso.peticiones,
            estadoProtegidoAntes: protegidoAntes,
            estadoProtegidoDespues: falso.estado[PROYECTO_PROTEGIDO],
            seEsperaBorrado: intento.seEsperaBorrado ?? false,
          })
        ).not.toThrow();
      }

      // 2. El namespace protegido sigue teniendo sus datos: no quedo vacio por otro camino.
      expect(falso.estado[PROYECTO_PROTEGIDO].usuarios).toHaveLength(1);
      expect(Object.keys(falso.estado[PROYECTO_PROTEGIDO].colecciones).sort()).toEqual(["cuentasContables", "usuarios", "ventas"]);

      // 3. Y el mensaje, si abortó, no es un error confuso: dice por que. (En modo sembrado el
      //    seed muere por otro motivo —el emulador falso no habla gRPC—, que no es lo que se mide.)
      if (!intento.modoSembrado && r.codigo === 1) expect(r.error).toContain("ABORTADO");
      expect(r.expiro, "el seed se colgó en vez de resolver el intento").toBe(false);
    }, 30000);
  }
});

// ---------------------------------------------------------------------------------------------
describe("SEED_BARRIDO_ACOTADO — candados internos del barrido", () => {
  it("si js/firebase-config.js dijera demo-delfino, la limpieza aborta en vez de borrar lo que el ERP mira", async () => {
    // El escenario que convertiria el barrido en destructivo: que el namespace basura y el del
    // ERP pasen a ser el mismo. El seed tiene que negarse, no borrar.
    const copia = crearCopia({ projectId: NAMESPACE_BASURA });
    try {
      const r = await correrSeed({ raiz: copia.raiz, args: ["--limpiar-demo-delfino"], env });
      expect(r.codigo).toBe(1);
      expect(r.error).toContain("ABORTADO");
      expect(r.error).toContain("es el mismo que usa el ERP");
      expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
      expect(falso.estado[NAMESPACE_BASURA].usuarios).toHaveLength(1);
    } finally {
      copia.destruir();
    }
  });

  it("el barrido exige las variables de emulador tanto como el sembrado", async () => {
    const sinNada = await correrSeed({ args: ["--limpiar-demo-delfino"], env: {} });
    expect(sinNada.codigo).toBe(1);
    expect(sinNada.error).toContain("ABORTADO: faltan");

    const noLocal = await correrSeed({
      args: ["--limpiar-demo-delfino"],
      env: { FIRESTORE_EMULATOR_HOST: "192.0.2.10:8080", FIREBASE_AUTH_EMULATOR_HOST: "192.0.2.10:8080" },
    });
    expect(noLocal.codigo).toBe(1);
    expect(noLocal.error).toContain("no es local");
    expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
  });

  it("si el emulador no vacia el namespace, el seed lo denuncia en vez de decir que salio bien", async () => {
    // El seed re-inventaria despues de borrar. Se simula un emulador que ignora los DELETE.
    const terco = await levantarEmuladorFalso(estadoInicial());
    const original = terco.estado[NAMESPACE_BASURA];
    const vigilante = setInterval(() => {
      // repone lo borrado, como si el DELETE no hubiera hecho efecto
      if (!Object.keys(terco.estado[NAMESPACE_BASURA].colecciones).length) {
        terco.estado[NAMESPACE_BASURA] = structuredClone(original);
      }
    }, 5);
    try {
      const r = await correrSeed({
        args: ["--limpiar-demo-delfino"],
        env: { FIRESTORE_EMULATOR_HOST: terco.host, FIREBASE_AUTH_EMULATOR_HOST: terco.host },
      });
      // Acá NO se mira el código de salida: este camino aborta DESPUES de haber hecho fetch, y en
      // esta maquina (Node 24.19 / Windows) `process.exit()` despues de fetch contra el emulador
      // falso revienta con la asercion de libuv y se lleva puesto el codigo. Ver
      // SALIDA_ABORTO_LIBUV en seed-verificaciones.mjs. Lo que se verifica es el comportamiento:
      // denuncia el problema y NO declara exito.
      expect(r.error).toContain("ABORTADO");
      expect(r.error).toContain("no quedo vacio");
      expect(r.salida).not.toContain("Listo:");
    } finally {
      clearInterval(vigilante);
      await terco.cerrar();
    }
  });
});
