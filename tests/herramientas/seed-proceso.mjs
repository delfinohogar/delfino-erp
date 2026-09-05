// Herramientas para probar `scripts/seed-emulator.mjs` DESDE AFUERA: se lo corre como proceso
// hijo, con el entorno controlado al detalle, y se mira lo unico que un usuario ve (codigo de
// salida, stdout, stderr) mas los pedidos que le llegaron al emulador falso.
//
// Nada de esto importa el seed como modulo: el seed hace efectos en el import (lee archivos,
// valida el entorno y llama process.exit), asi que la unica forma honesta de probarlo es
// ejecutarlo.
//
// Las COPIAS existen por una razon de alcance: para probar que el projectId sale de
// `js/firebase-config.js` hay que variar ese archivo, y ese archivo es de Gaston. Entonces se
// arma un arbol minimo en el temporal del sistema —FUERA del repo— con una copia del seed, una
// copia de `js/contabilidad.js` y el `js/firebase-config.js` que haga falta. El repo no se toca.
import { spawn } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const RAIZ_REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RUTA_SEED = join(RAIZ_REPO, "scripts", "seed-emulator.mjs");
export const RUTA_CONFIG = join(RAIZ_REPO, "js", "firebase-config.js");

/** Variables que deciden el comportamiento del seed. Se limpian siempre y se ponen a mano. */
const VARIABLES_DEL_SEED = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "FIREBASE_CONFIG",
];

/**
 * Corre el seed como proceso hijo.
 *
 * El entorno arranca SIN ninguna de las variables de VARIABLES_DEL_SEED, aunque la sesion las
 * tenga puestas (esta sesion tiene GCLOUD_PROJECT=demo-delfino forzada a proposito por
 * .claude/settings.json). Cada test declara explicitamente lo que quiere; no hay herencia
 * silenciosa que pueda hacer pasar o fallar un test por accidente.
 *
 * @param {{args?: string[], env?: Record<string,string>, raiz?: string, timeoutMs?: number}} opciones
 * @returns {Promise<{codigo: number|null, senal: string|null, salida: string, error: string, todo: string, expiro: boolean}>}
 */
export function correrSeed({ args = [], env = {}, raiz = RAIZ_REPO, timeoutMs = 20000 } = {}) {
  const entorno = { ...process.env };
  for (const v of VARIABLES_DEL_SEED) delete entorno[v];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null) delete entorno[k];
    else entorno[k] = v;
  }

  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, [join(raiz, "scripts", "seed-emulator.mjs"), ...args], {
      cwd: raiz,
      env: entorno,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let salida = "";
    let error = "";
    let expiro = false;
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (error += d));
    const reloj = setTimeout(() => {
      expiro = true;
      hijo.kill("SIGKILL");
    }, timeoutMs);
    hijo.on("error", (e) => {
      clearTimeout(reloj);
      rechazar(e);
    });
    hijo.on("close", (codigo, senal) => {
      clearTimeout(reloj);
      resolver({ codigo, senal, salida, error, todo: `${salida}\n${error}`, expiro });
    });
  });
}

/**
 * Aplica mutaciones de texto y EXIGE que cada una haya matcheado exactamente una vez.
 *
 * Es la parte que hace que R20 valga: un mutante que no muta nada deja el test en verde y da la
 * falsa impresion de que el test discrimina. Si el texto original cambia y una mutacion deja de
 * aplicar, esto revienta en vez de mentir.
 */
export function mutar(fuente, mutaciones) {
  let salida = fuente;
  for (const { de, a } of mutaciones) {
    const ocurrencias = salida.split(de).length - 1;
    if (ocurrencias !== 1) {
      throw new Error(
        `[MUTACION INVALIDA] el fragmento a mutar aparece ${ocurrencias} veces (tiene que aparecer 1):\n${de}\n` +
          `Si scripts/seed-emulator.mjs cambio, hay que actualizar la mutacion: un mutante que no muta no prueba nada (R20).`
      );
    }
    salida = salida.replace(de, a);
  }
  return salida;
}

/**
 * Arma un arbol minimo fuera del repo con una copia del seed.
 *
 * @param {{configFuente?: string, projectId?: string, omitirConfig?: boolean, mutaciones?: Array<{de: string, a: string}>}} opciones
 *   configFuente: texto completo de js/firebase-config.js. Si no se pasa, se usa el del repo,
 *                 con el projectId reemplazado por `projectId` si se lo indica.
 *   omitirConfig: no escribe js/firebase-config.js, para probar que el seed aborta si no lo puede leer.
 * @returns {{raiz: string, destruir: () => void}}
 */
export function crearCopia({ configFuente, projectId, omitirConfig = false, mutaciones = [] } = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "task013-copia-"));
  mkdirSync(join(raiz, "scripts"));
  mkdirSync(join(raiz, "js"));

  // node_modules por junction: el seed importa firebase-admin y Node resuelve subiendo directorios.
  // Junction y no copia: copiar node_modules seria lento y no aporta nada.
  symlinkSync(join(RAIZ_REPO, "node_modules"), join(raiz, "node_modules"), "junction");

  const seed = readFileSync(RUTA_SEED, "utf8");
  writeFileSync(join(raiz, "scripts", "seed-emulator.mjs"), mutaciones.length ? mutar(seed, mutaciones) : seed, "utf8");

  copyFileSync(join(RAIZ_REPO, "js", "contabilidad.js"), join(raiz, "js", "contabilidad.js"));

  if (omitirConfig) return { raiz, destruir: () => destruirCopia(raiz) };

  let config = configFuente;
  if (config === undefined) {
    config = readFileSync(RUTA_CONFIG, "utf8");
    if (projectId !== undefined) {
      const antes = config;
      config = config.replace(/projectId\s*:\s*["'`][^"'`]+["'`]/, `projectId: "${projectId}"`);
      if (config === antes) throw new Error("[COPIA INVALIDA] no se encontro projectId en js/firebase-config.js para reemplazar");
    }
  }
  writeFileSync(join(raiz, "js", "firebase-config.js"), config, "utf8");

  return { raiz, destruir: () => destruirCopia(raiz) };
}

/**
 * Borra el arbol temporal. Dos candados: la ruta tiene que estar dentro del temporal del sistema,
 * y el junction a node_modules se saca ANTES con rmdirSync, que quita el enlace y no su destino.
 * Sin ese orden, un rm recursivo distraido podria seguir el enlace hasta el node_modules real.
 */
export function destruirCopia(raiz) {
  if (!raiz.startsWith(tmpdir())) throw new Error(`[SEGURIDAD] me pidieron borrar "${raiz}", que no esta en el temporal del sistema. No se borra nada.`);
  const enlace = join(raiz, "node_modules");
  try {
    if (lstatSync(enlace).isSymbolicLink()) rmdirSync(enlace);
  } catch { /* no estaba */ }
  rmSync(raiz, { recursive: true, force: true });
}
