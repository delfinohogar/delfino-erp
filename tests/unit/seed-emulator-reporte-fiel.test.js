// TASK-013 — SEED_REPORTE_FIEL: ante un namespace ESPEJADO, el reporte advierte en vez de
// reclamar los documentos como propios de `demo-delfino`.
//
// POR QUE ESTE TEST ESTA APUNTADO ACA (y no a que el emulador aisle los namespaces).
// La version anterior de esta invariante exigia que leer un namespace virgen del emulador
// devolviera vacio. Eso es una propiedad DEL EMULADOR —`"singleProjectMode": true` en
// firebase.json le hace servir los documentos del proyecto principal a cualquier projectId al que
// todavia no se le haya escrito— y ningun cambio en `scripts/seed-emulator.mjs`, que es el archivo
// bajo prueba, puede hacerla pasar ni fallar. Un test asi no mide la unidad que dice medir.
// El comportamiento del emulador quedo registrado aparte como riesgo (R35) y la decision de si se
// cambia `firebase.json` es de Gaston, no de un test.
//
// Lo que el seed SI controla es que no mienta sobre lo que leyo. Eso es lo que se prueba aca:
// dado un namespace que devuelve los documentos del ERP y CERO usuarios de Auth —exactamente lo
// que ve el script cuando el emulador espeja—, la salida tiene que avisar que esos documentos no
// se pueden dar por propios, nombrar la causa y senalar la firma del espejo, y no puede reclamar
// el conteo como propio de `demo-delfino` ni invitar a borrarlo sin el aviso.
//
// COMO SE FABRICA EL ESPEJO. Con el emulador FALSO de tests/herramientas/, declarando el estado de
// `demo-delfino` igual al del ERP y sin usuarios de Auth. Por REST eso es INDISTINGUIBLE de un
// espejo de verdad —el emulador reescribe el campo `name` de cada documento con el projectId que
// se pidio—, asi que el seed recibe exactamente la misma entrada que en la maquina de Gaston, y
// ademas de forma determinista: no depende de si alguien escribio antes en ese namespace.
//
// Y COMO SE DEMUESTRA QUE PUEDE FALLAR (R20). El segundo test corre la MISMA verificacion contra
// un MUTANTE: una copia del seed, fuera del repo, con la advertencia sacada. Con la advertencia
// puesta la verificacion pasa; sacada, tiene que tirar error. Un test que pasa en los dos casos no
// prueba nada. El mutante se corre contra el emulador falso, nunca contra uno real, y `scripts/`
// no se toca en ningun momento.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { correrSeed, crearCopia } from "../herramientas/seed-proceso.mjs";
import { levantarEmuladorFalso } from "../herramientas/emulador-falso.mjs";
import {
  PROYECTO_PROTEGIDO,
  NAMESPACE_BASURA,
  verificarReporteHonestoAnteEspejo,
  verificarQueNoBorroNada,
  codigoContraEmuladorFalso,
} from "../herramientas/seed-verificaciones.mjs";

/** Las colecciones del ERP sembrado, con su forma real: 10 colecciones, 35 documentos. */
const COLECCIONES_DEL_ERP = {
  categorias: [{ id: "cat-1" }, { id: "cat-2" }],
  clientes: [{ id: "cli-1" }, { id: "cli-2" }],
  contadores: [{ id: "asientos" }, { id: "comprobantes" }, { id: "ventas" }],
  cuentasContables: Array.from({ length: 19 }, (_, i) => ({ id: `cta-${i + 1}` })),
  depositos: [{ id: "dep-1" }],
  listasPrecios: [{ id: "lp-1" }],
  marcas: [{ id: "mar-1" }, { id: "mar-2" }],
  productos: [{ id: "DEV-001" }, { id: "DEV-002" }, { id: "DEV-003" }],
  sucursales: [{ id: "solano" }],
  usuarios: [{ id: "uid-admin-del-erp", fields: { email: { stringValue: "admin@delfino.local" }, rol: { stringValue: "administrador" } } }],
};

const CANTIDAD_COLECCIONES = Object.keys(COLECCIONES_DEL_ERP).length;
const TOTAL_DOCS = Object.values(COLECCIONES_DEL_ERP).reduce((n, docs) => n + docs.length, 0);

/**
 * El estado que ve el seed cuando el emulador espeja: `demo-delfino` devuelve los documentos del
 * ERP y NINGUN usuario de Auth (Auth no espeja; esa asimetria es justamente la firma).
 */
function estadoEspejado() {
  return {
    [NAMESPACE_BASURA]: { colecciones: structuredClone(COLECCIONES_DEL_ERP), usuarios: [] },
    [PROYECTO_PROTEGIDO]: {
      colecciones: structuredClone(COLECCIONES_DEL_ERP),
      usuarios: [{ localId: "uid-admin-del-erp", email: "admin@delfino.local" }],
    },
  };
}

/**
 * Saca la advertencia del reporte, que es la propiedad que este test protege: la llamada que la
 * imprime y la rama que, ante la firma del espejo, avisa que puede no haber nada propio que
 * borrar. Sin fin de linea en los fragmentos: el archivo esta en CRLF y un `\n` no matchearia.
 */
const SIN_ADVERTENCIA_DE_ESPEJO = [
  { de: "  advertirSiPuedeSerEspejo(inv);", a: "  /* mutante R20: sin advertencia de espejo */" },
  { de: "  if (inv.totalDocs > 0 && inv.usuariosAuth.length === 0) {", a: "  if (false) {" },
];

let falso;
let env;

beforeAll(async () => {
  falso = await levantarEmuladorFalso(estadoEspejado());
  env = { FIRESTORE_EMULATOR_HOST: falso.host, FIREBASE_AUTH_EMULATOR_HOST: falso.host };
});

afterAll(async () => {
  await falso?.cerrar();
});

beforeEach(() => {
  falso.peticiones.length = 0;
});

describe("SEED_REPORTE_FIEL — ante un namespace espejado, el reporte advierte y no reclama los documentos como propios", () => {
  it("--reporte-demo avisa que los documentos no son suyos, nombra singleProjectMode y la firma del espejo, y no borra nada", async () => {
    const r = await correrSeed({ args: ["--reporte-demo"], env, timeoutMs: 20000 });

    expect(r.expiro).toBe(false);
    expect(() => verificarReporteHonestoAnteEspejo(r, { totalDocs: TOTAL_DOCS, colecciones: CANTIDAD_COLECCIONES })).not.toThrow();

    // Un reporte no toca nada, ni siquiera el namespace del que informa.
    expect(() => verificarQueNoBorroNada(falso.peticiones)).not.toThrow();
    // Y solo leyo "demo-delfino": el aviso sale de razonar sobre lo que ve, no de espiar otro
    // namespace (eso violaria SEED_BARRIDO_ACOTADO).
    expect(falso.proyectosTocados()).toEqual([NAMESPACE_BASURA]);
  }, 30000);

  it("R20: si al reporte se le saca la advertencia, esta misma verificacion se pone en rojo", async () => {
    const argumentos = { args: ["--reporte-demo"], env, timeoutMs: 20000 };
    const esperado = { totalDocs: TOTAL_DOCS, colecciones: CANTIDAD_COLECCIONES };

    // (a) copia SIN mutar: la verificacion pasa. Descarta que el rojo de (b) venga del mecanismo
    // de copia y no de la mutacion.
    const sana = crearCopia({});
    try {
      const r = await correrSeed({ raiz: sana.raiz, ...argumentos });
      expect(() => verificarReporteHonestoAnteEspejo(r, esperado)).not.toThrow();
    } finally {
      sana.destruir();
    }

    // (b) MUTANTE sin advertencia: la MISMA verificacion tiene que fallar.
    const mutante = crearCopia({ mutaciones: SIN_ADVERTENCIA_DE_ESPEJO });
    try {
      const r = await correrSeed({ raiz: mutante.raiz, ...argumentos });
      expect(() => verificarReporteHonestoAnteEspejo(r, esperado)).toThrow(/no se pueden dar por propios/i);

      // Y la prueba de que el mutante sigue siendo un reporte que funciona: el rojo viene de que
      // falta el aviso, no de que el script se haya roto. Informa el mismo inventario, sale con 0
      // y encima invita a borrar lo que puede no ser suyo.
      expect(codigoContraEmuladorFalso(r)).toBe(0);
      expect(r.salida).toMatch(new RegExp(`Colecciones: ${CANTIDAD_COLECCIONES}, documentos: ${TOTAL_DOCS}\\b`));
      expect(r.salida).not.toMatch(/singleProjectMode/);
      expect(r.salida).not.toMatch(/no se pueden dar por propios/i);
      expect(r.salida).toMatch(/--limpiar-demo-delfino/);
    } finally {
      mutante.destruir();
    }
  }, 60000);
});
