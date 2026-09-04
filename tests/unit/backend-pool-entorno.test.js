// TASK-001 — pool.js: resolucion de la URL de conexion segun el entorno.
// Unitario puro: no abre conexiones, no toca la base, no usa red.
//
// Criterio de aceptacion verificado:
//   "el pool lee DATABASE_URL y, en tests, DATABASE_URL_TEST; falla con mensaje claro
//    si no hay ninguna"
import { describe, it, expect } from "vitest";
import { urlConexion, enEntornoDeTests } from "../../backend/src/db/pool.js";

const DEV = "postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_dev";
const TEST = "postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test";

/** Entorno de test explicito (lo que hace vitest). */
const envTest = (extra = {}) => ({ NODE_ENV: "test", VITEST: "true", ...extra });
/** Entorno de produccion/desarrollo: ni NODE_ENV=test ni VITEST. */
const envNoTest = (extra = {}) => ({ NODE_ENV: "development", ...extra });

describe("TASK-001 pool: deteccion de entorno de tests", () => {
  it("NODE_ENV=test es entorno de tests", () => {
    expect(enEntornoDeTests({ NODE_ENV: "test" })).toBe(true);
  });
  it("VITEST definido es entorno de tests", () => {
    expect(enEntornoDeTests({ VITEST: "true" })).toBe(true);
  });
  it("sin ninguna de las dos, NO es entorno de tests", () => {
    expect(enEntornoDeTests({ NODE_ENV: "development" })).toBe(false);
    expect(enEntornoDeTests({})).toBe(false);
  });
});

describe("TASK-001 pool: DATABASE_URL fuera de tests", () => {
  it("fuera de tests usa DATABASE_URL", () => {
    expect(urlConexion(envNoTest({ DATABASE_URL: DEV }))).toBe(DEV);
  });

  it("fuera de tests NO cae en la base de tests aunque DATABASE_URL_TEST exista", () => {
    // Esta es la garantia importante: nada de conectarse a delfino_test por accidente.
    expect(() => urlConexion(envNoTest({ DATABASE_URL_TEST: TEST }))).toThrow();
    let mensaje = "";
    try {
      urlConexion(envNoTest({ DATABASE_URL_TEST: TEST }));
    } catch (err) {
      mensaje = err.message;
    }
    expect(mensaje).toContain("DATABASE_URL");
    expect(mensaje).toContain("DATABASE_URL_TEST");
    // No devuelve la URL de tests bajo ningun concepto.
    expect(mensaje).not.toBe(TEST);
  });

  it("fuera de tests, con las dos definidas, gana DATABASE_URL", () => {
    expect(urlConexion(envNoTest({ DATABASE_URL: DEV, DATABASE_URL_TEST: TEST }))).toBe(DEV);
  });
});

describe("TASK-001 pool: DATABASE_URL_TEST en tests", () => {
  it("en tests prefiere DATABASE_URL_TEST sobre DATABASE_URL", () => {
    expect(urlConexion(envTest({ DATABASE_URL: DEV, DATABASE_URL_TEST: TEST }))).toBe(TEST);
  });

  it("en tests, sin DATABASE_URL_TEST, cae a DATABASE_URL", () => {
    expect(urlConexion(envTest({ DATABASE_URL: DEV }))).toBe(DEV);
  });
});

describe("TASK-001 pool: falla con mensaje claro si no hay ninguna URL", () => {
  it("sin ninguna variable, fuera de tests, lanza y nombra la variable que falta", () => {
    let err = null;
    try {
      urlConexion(envNoTest());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("DATABASE_URL");
    // "Mensaje claro" = dice que falta y como resolverlo, no un TypeError opaco.
    expect(err.message.toLowerCase()).toMatch(/falta|no esta definida/);
    expect(err.message).toMatch(/db:up|npm run/);
  });

  it("sin ninguna variable, en tests, lanza nombrando las dos variables", () => {
    let err = null;
    try {
      urlConexion(envTest());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("DATABASE_URL_TEST");
    expect(err.message).toContain("DATABASE_URL");
    expect(err.message).toMatch(/db:up|npm run/);
  });

  it("una variable con solo espacios en blanco cuenta como ausente", () => {
    expect(() => urlConexion(envNoTest({ DATABASE_URL: "   " }))).toThrow(/DATABASE_URL/);
  });
});

describe("TASK-001 pool: barrera de host no local", () => {
  it("acepta 127.0.0.1 y localhost", () => {
    expect(urlConexion(envNoTest({ DATABASE_URL: DEV }))).toBe(DEV);
    const local = "postgres://u:p@localhost:5432/delfino_dev";
    expect(urlConexion(envNoTest({ DATABASE_URL: local }))).toBe(local);
  });

  it("rechaza un host remoto", () => {
    const remoto = "postgres://u:p@db.produccion.example.com:5432/delfino";
    expect(() => urlConexion(envNoTest({ DATABASE_URL: remoto }))).toThrow(/no es local/i);
  });
});
