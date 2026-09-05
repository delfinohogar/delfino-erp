// TASK-013 — Las tres barreras de aborto de `scripts/seed-emulator.mjs` y la fuente unica del
// projectId. Invariantes SEED_PROYECTO_UNICO, SEED_PROYECTO_COINCIDE y SEED_BARRERA_EMULADOR.
//
// COMO SE PRUEBA. El seed se corre como proceso hijo con el entorno armado a mano (ver
// tests/herramientas/seed-proceso.mjs) y, cuando hace falta un emulador, contra el emulador FALSO
// de tests/herramientas/emulador-falso.mjs: un servidor HTTP en 127.0.0.1 que anota cada pedido.
// El emulador de verdad NO se toca en este archivo, ni de lectura.
//
// POR QUE ESO ALCANZA PARA "LA BARRERA CORRE ANTES DE TOCAR NADA". No se afirma leyendo el orden
// de las lineas del script: se mide. Los hosts de emulador apuntan al emulador falso, que lleva la
// cuenta de los pedidos que recibio; si la barrera corriera despues, habria pedidos anotados. Cero
// pedidos = no toco nada.
//
// ESTA SESION TIENE GCLOUD_PROJECT=demo-delfino FORZADA por .claude/settings.json, a proposito.
// correrSeed() borra esa y las otras tres variables del entorno del hijo antes de aplicar las que
// pide cada test, asi que ningun test pasa ni falla por herencia silenciosa.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { correrSeed, crearCopia, RAIZ_REPO, RUTA_CONFIG } from "../herramientas/seed-proceso.mjs";
import { levantarEmuladorFalso } from "../herramientas/emulador-falso.mjs";
import {
  PROYECTO_PROTEGIDO,
  NAMESPACE_BASURA,
  codigoContraEmuladorFalso,
  verificarAbortaPorProyectoForzado,
  verificarAbortaSinVariablesDeEmulador,
  verificarAbortaPorEmuladorNoLocal,
  verificarAbortaPorConfigAmbigua,
  verificarProyectoLeidoDelArchivo,
  verificarReporte,
} from "../herramientas/seed-verificaciones.mjs";

let falso;
let env;

beforeAll(async () => {
  falso = await levantarEmuladorFalso({
    [NAMESPACE_BASURA]: {
      colecciones: {
        usuarios: [{ id: "uid-basura", fields: { email: { stringValue: "admin@delfino.local" }, rol: { stringValue: "administrador" } } }],
        productos: [{ id: "DEV-001" }, { id: "DEV-002" }],
      },
      usuarios: [{ localId: "uid-basura", email: "admin@delfino.local" }],
    },
  });
  env = { FIRESTORE_EMULATOR_HOST: falso.host, FIREBASE_AUTH_EMULATOR_HOST: falso.host };
});

afterAll(async () => {
  await falso?.cerrar();
});

beforeEach(() => {
  falso.peticiones.length = 0;
});

// ---------------------------------------------------------------------------------------------
describe("SEED_PROYECTO_UNICO — el projectId sale de js/firebase-config.js y de ningun otro lado", () => {
  it("js/firebase-config.js declara exactamente un projectId y es delfino-hogar-erp", () => {
    const fuente = readFileSync(RUTA_CONFIG, "utf8");
    const declarados = [...new Set([...fuente.matchAll(/projectId\s*:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]))];
    expect(declarados).toEqual([PROYECTO_PROTEGIDO]);
  });

  it("npm run emulators y npm run test:integration usan ese mismo proyecto", () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ_REPO, "package.json"), "utf8"));
    expect(pkg.scripts.emulators).toContain(`--project ${PROYECTO_PROTEGIDO}`);
    expect(pkg.scripts["test:integration"]).toContain(`--project ${PROYECTO_PROTEGIDO}`);
  });

  it("el default del seed es delfino-hogar-erp, ya no demo-delfino", async () => {
    // Sin ninguna variable que fuerce el proyecto: lo que el seed diga que mira el ERP ES el
    // default. El modo reporte lo imprime al final del informe.
    const r = await correrSeed({ args: ["--reporte-demo"], env });
    expect(codigoContraEmuladorFalso(r)).toBe(0);
    expect(r.salida).toMatch(new RegExp(`los tests miran "${PROYECTO_PROTEGIDO}"`));
    expect(r.salida).not.toMatch(/los tests miran "demo-delfino"/);
  });

  it("sigue el archivo: con un projectId inventado en la copia, el seed nombra ese", async () => {
    const copia = crearCopia({ projectId: "proyecto-inventado-xyz" });
    try {
      const r = await correrSeed({ raiz: copia.raiz, env: { ...env, GCLOUD_PROJECT: "otro-distinto" } });
      expect(() => verificarProyectoLeidoDelArchivo(r, "proyecto-inventado-xyz")).not.toThrow();
      expect(r.error).not.toContain(PROYECTO_PROTEGIDO);
    } finally {
      copia.destruir();
    }
  });

  it("si js/firebase-config.js no declara ningun projectId, aborta en vez de adivinar", async () => {
    const copia = crearCopia({ configFuente: "export const firebaseConfig = { apiKey: \"x\", appId: \"y\" };\n" });
    try {
      const r = await correrSeed({ raiz: copia.raiz, env });
      expect(() => verificarAbortaPorConfigAmbigua(r, { cantidad: 0, peticiones: falso.peticiones })).not.toThrow();
    } finally {
      copia.destruir();
    }
  });

  it("si declara dos projectId distintos, aborta en vez de elegir uno", async () => {
    const copia = crearCopia({
      configFuente: 'export const firebaseConfig = { projectId: "uno-x" };\nexport const otro = { projectId: "dos-y" };\n',
    });
    try {
      const r = await correrSeed({ raiz: copia.raiz, env });
      expect(() => verificarAbortaPorConfigAmbigua(r, { cantidad: 2, peticiones: falso.peticiones })).not.toThrow();
      expect(r.error).toContain("uno-x");
      expect(r.error).toContain("dos-y");
    } finally {
      copia.destruir();
    }
  });

  it("si el mismo projectId aparece dos veces, no es ambiguedad: lo toma", async () => {
    const copia = crearCopia({
      configFuente: 'export const a = { projectId: "repetido-z" };\nexport const b = { projectId: "repetido-z" };\n',
    });
    try {
      const r = await correrSeed({ raiz: copia.raiz, env: { ...env, GCLOUD_PROJECT: "otro-distinto" } });
      expect(() => verificarProyectoLeidoDelArchivo(r, "repetido-z")).not.toThrow();
    } finally {
      copia.destruir();
    }
  });

  it("si js/firebase-config.js no se puede leer, aborta nombrando el archivo", async () => {
    const copia = crearCopia({ omitirConfig: true });
    try {
      const r = await correrSeed({ raiz: copia.raiz, env });
      expect(r.codigo).toBe(1);
      expect(r.error).toContain("ABORTADO");
      expect(r.error).toContain("js/firebase-config.js");
      expect(falso.peticiones).toHaveLength(0);
    } finally {
      copia.destruir();
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("SEED_PROYECTO_COINCIDE — si el entorno fuerza otro proyecto, aborta nombrando los dos", () => {
  it("GCLOUD_PROJECT=demo-delfino: aborta, nombra los dos valores y no toca el emulador", async () => {
    const r = await correrSeed({ env: { ...env, GCLOUD_PROJECT: NAMESPACE_BASURA } });
    expect(() =>
      verificarAbortaPorProyectoForzado(r, {
        proyectoErp: PROYECTO_PROTEGIDO,
        proyectoForzado: NAMESPACE_BASURA,
        variable: "GCLOUD_PROJECT",
        peticiones: falso.peticiones,
      })
    ).not.toThrow();
  });

  it("GOOGLE_CLOUD_PROJECT=demo-delfino: lo mismo, y nombra esa variable", async () => {
    const r = await correrSeed({ env: { ...env, GOOGLE_CLOUD_PROJECT: NAMESPACE_BASURA } });
    expect(() =>
      verificarAbortaPorProyectoForzado(r, {
        proyectoErp: PROYECTO_PROTEGIDO,
        proyectoForzado: NAMESPACE_BASURA,
        variable: "GOOGLE_CLOUD_PROJECT",
        peticiones: falso.peticiones,
      })
    ).not.toThrow();
  });

  it("con las dos variables forzadas, el mensaje nombra las dos", async () => {
    const r = await correrSeed({ env: { ...env, GCLOUD_PROJECT: "uno-x", GOOGLE_CLOUD_PROJECT: "dos-y" } });
    expect(r.codigo).toBe(1);
    expect(r.error).toMatch(/proyecto forzado\s+uno-x\b/);
    expect(r.error).toMatch(/proyecto forzado\s+dos-y\b/);
    expect(r.error).toContain("GCLOUD_PROJECT");
    expect(r.error).toContain("GOOGLE_CLOUD_PROJECT");
    expect(falso.peticiones).toHaveLength(0);
  });

  it("el mensaje explica que hacer, no solo que fallo", async () => {
    const r = await correrSeed({ env: { ...env, GCLOUD_PROJECT: NAMESPACE_BASURA } });
    expect(r.error).toContain("Que hacer");
    expect(r.error).toContain(`GCLOUD_PROJECT=${PROYECTO_PROTEGIDO}`);
    expect(r.error).toContain("js/firebase-config.js");
  });

  it("si el proyecto forzado COINCIDE, no aborta por proyecto (el chequeo no es un no-a-todo)", async () => {
    // Contra el emulador falso el seed va a fracasar mas adelante —el Admin SDK de Firestore habla
    // gRPC y este servidor no—, pero eso es despues del chequeo. Lo que se mide es que NO aborte
    // por proyecto y que los pedidos que alcance a hacer vayan al proyecto del ERP.
    const r = await correrSeed({ env: { ...env, GCLOUD_PROJECT: PROYECTO_PROTEGIDO }, timeoutMs: 15000 });
    expect(r.error).not.toMatch(/sembraria en un proyecto que el ERP local no mira/);
    const proyectos = [...new Set(falso.peticiones.map((p) => p.url.match(/\/projects\/([^/?]+)/)?.[1]).filter(Boolean))];
    expect(proyectos.every((p) => p === PROYECTO_PROTEGIDO)).toBe(true);
  }, 25000);
});

// ---------------------------------------------------------------------------------------------
describe("SEED_BARRERA_EMULADOR — sin variables de emulador, o no locales, aborta en los tres modos", () => {
  const MODOS = [
    ["sembrar", []],
    ["--reporte-demo", ["--reporte-demo"]],
    ["--limpiar-demo-delfino", ["--limpiar-demo-delfino"]],
  ];

  for (const [nombre, args] of MODOS) {
    it(`${nombre}: sin ninguna variable de emulador, aborta y no toca nada`, async () => {
      const r = await correrSeed({ args, env: {} });
      expect(() => verificarAbortaSinVariablesDeEmulador(r, { peticiones: falso.peticiones })).not.toThrow();
    });

    it(`${nombre}: con solo FIRESTORE_EMULATOR_HOST, aborta`, async () => {
      const r = await correrSeed({ args, env: { FIRESTORE_EMULATOR_HOST: falso.host } });
      expect(() => verificarAbortaSinVariablesDeEmulador(r, { peticiones: falso.peticiones })).not.toThrow();
    });

    it(`${nombre}: con solo FIREBASE_AUTH_EMULATOR_HOST, aborta`, async () => {
      const r = await correrSeed({ args, env: { FIREBASE_AUTH_EMULATOR_HOST: falso.host } });
      expect(() => verificarAbortaSinVariablesDeEmulador(r, { peticiones: falso.peticiones })).not.toThrow();
    });
  }

  // Ninguno de estos hosts se llega a contactar: el seed aborta antes. Se eligieron igual sin
  // riesgo — 192.0.2.x es TEST-NET-1 (reservada, no ruteable) y 10.x es privada — salvo el de
  // googleapis, que esta justamente para probar que el caso peligroso se rechaza sin salir a la red.
  const NO_LOCALES = [
    "firestore.googleapis.com:443",
    "https://firestore.googleapis.com:443",
    "192.0.2.10:8080",
    "10.0.0.5:8080",
    "127.0.0.2:8080",
    "0.0.0.0:8080",
    "localhost.evil.example:8080",
    "127.0.0.1",
    "127.0.0.1:",
    "127.0.0.1:8080 ",
    "[::1]:8080",
    "127.0.0.1:8080/../otro",
    "127.0.0.1:8080@192.0.2.10:8080",
  ];

  for (const host of NO_LOCALES) {
    it(`rechaza FIRESTORE_EMULATOR_HOST="${host}" por no ser local, sin hablar con nadie`, async () => {
      const r = await correrSeed({
        args: ["--reporte-demo"],
        env: { FIRESTORE_EMULATOR_HOST: host, FIREBASE_AUTH_EMULATOR_HOST: falso.host },
      });
      expect(() => verificarAbortaPorEmuladorNoLocal(r, { valor: host, peticiones: falso.peticiones })).not.toThrow();
    });

    it(`rechaza FIREBASE_AUTH_EMULATOR_HOST="${host}" por no ser local, sin hablar con nadie`, async () => {
      const r = await correrSeed({
        args: ["--limpiar-demo-delfino"],
        env: { FIRESTORE_EMULATOR_HOST: falso.host, FIREBASE_AUTH_EMULATOR_HOST: host },
      });
      expect(() => verificarAbortaPorEmuladorNoLocal(r, { valor: host, peticiones: falso.peticiones })).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------------------------
describe("SEED_BARRERA_EMULADOR — orden: primero los argumentos, despues el emulador, despues el proyecto", () => {
  it("un argumento desconocido aborta antes que la barrera de emulador", async () => {
    const r = await correrSeed({ args: ["--limpiar-todo"], env: {} });
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('argumento desconocido "--limpiar-todo"');
    expect(r.error).not.toContain("FIRESTORE_EMULATOR_HOST");
  });

  it("la barrera de emulador aborta antes que el chequeo de proyecto forzado", async () => {
    const r = await correrSeed({ env: { GCLOUD_PROJECT: NAMESPACE_BASURA } });
    expect(() => verificarAbortaSinVariablesDeEmulador(r)).not.toThrow();
    expect(r.error).not.toMatch(/proyecto forzado/);
  });

  it("un host no local aborta antes que el chequeo de proyecto forzado", async () => {
    const r = await correrSeed({
      env: { FIRESTORE_EMULATOR_HOST: "192.0.2.10:8080", FIREBASE_AUTH_EMULATOR_HOST: falso.host, GCLOUD_PROJECT: NAMESPACE_BASURA },
    });
    expect(() => verificarAbortaPorEmuladorNoLocal(r, { valor: "192.0.2.10:8080", peticiones: falso.peticiones })).not.toThrow();
    expect(r.error).not.toMatch(/proyecto forzado/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("SEED_ARGUMENTOS — un argumento mal tipeado nunca cae en un modo que escribe o borra", () => {
  const BASURA = [
    "--reporte",
    "--reportedemo",
    "--Reporte-Demo",
    "--limpiar",
    "--limpiar-demo",
    "--limpiar-demo-delfino-x",
    "--LIMPIAR-DEMO-DELFINO",
    "-limpiar-demo-delfino",
    "---limpiar-demo-delfino",
    " --limpiar-demo-delfino",
    "--limpiar-demo-delfino ",
    "--limpiar-demo-delfino=si",
    "demo-delfino",
    "--seed",
    "--force",
    "-f",
  ];

  for (const arg of BASURA) {
    it(`aborta con "${arg}" y no lo interpreta como ningun modo`, async () => {
      const r = await correrSeed({ args: [arg], env });
      expect(r.codigo).toBe(1);
      expect(r.error).toContain("ABORTADO: argumento desconocido");
      expect(falso.peticiones).toHaveLength(0);
    });
  }

  it("aborta si se pasa mas de un modo", async () => {
    const r = await correrSeed({ args: ["--reporte-demo", "--limpiar-demo-delfino"], env });
    expect(r.codigo).toBe(1);
    expect(r.error).toContain("se paso mas de un modo");
    expect(falso.peticiones).toHaveLength(0);
  });

  it("--ayuda sale con 0 y explica los tres modos, sin emulador", async () => {
    const r = await correrSeed({ args: ["--ayuda"], env: {} });
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("--reporte-demo");
    expect(r.salida).toContain("--limpiar-demo-delfino");
    expect(r.salida).toContain("FIRESTORE_EMULATOR_HOST");
  });
});

// ---------------------------------------------------------------------------------------------
describe("SEED_REPORTE_DEMO — informa que quedo sembrado en demo-delfino", () => {
  it("lista usuarios de Auth, perfiles de /usuarios y colecciones con su conteo", async () => {
    const r = await correrSeed({ args: ["--reporte-demo"], env });
    expect(codigoContraEmuladorFalso(r)).toBe(0);
    expect(() =>
      verificarReporte(r, {
        usuariosAuth: 1,
        perfiles: 1,
        colecciones: 2,
        docsPorColeccion: { usuarios: 1, productos: 2 },
      })
    ).not.toThrow();
    expect(r.salida).toContain("admin@delfino.local");
    expect(r.salida).toContain("uid-basura");
  });

  it("marca los perfiles huerfanos, que es el sintoma de R16", async () => {
    const falso2 = await levantarEmuladorFalso({
      [NAMESPACE_BASURA]: {
        colecciones: { usuarios: [{ id: "uid-sin-auth", fields: { email: { stringValue: "fantasma@delfino.local" } } }] },
        usuarios: [],
      },
    });
    try {
      const r = await correrSeed({
        args: ["--reporte-demo"],
        env: { FIRESTORE_EMULATOR_HOST: falso2.host, FIREBASE_AUTH_EMULATOR_HOST: falso2.host },
      });
      expect(codigoContraEmuladorFalso(r)).toBe(0);
      expect(r.salida).toContain("sin usuario de Auth en este namespace");
    } finally {
      await falso2.cerrar();
    }
  });
});
