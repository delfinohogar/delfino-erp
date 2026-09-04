// Chequeo sintactico de todos los modulos del frontend, sin ejecutarlos.
// Es el "errores basicos" de CI, antes de introducir un linter completo.
// Solo valida que cada archivo sea JavaScript de modulo valido: no valida logica ni imports.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execFileSync } from "node:child_process";

const RAIZ = process.cwd();
// dist/ y publicar/ son salida de build.js (bundles de esbuild): no son codigo fuente.
const IGNORAR = new Set(["node_modules", ".git", "emulator-data", "functions", ".claude",
  "coverage", "backend", "dist", "publicar", "tests", "scripts"]);

function archivosJs(dir, acc = []) {
  for (const nombre of readdirSync(dir)) {
    if (IGNORAR.has(nombre) || nombre.startsWith(".")) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosJs(ruta, acc);
    else if ([".js", ".mjs"].includes(extname(ruta))) acc.push(ruta);
  }
  return acc;
}

const archivos = archivosJs(RAIZ);
const errores = [];

for (const archivo of archivos) {
  try {
    execFileSync(process.execPath, ["--input-type=module", "--check", "-"], {
      input: readFileSync(archivo, "utf8"),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    errores.push({
      archivo: relative(RAIZ, archivo),
      mensaje: String(err.stderr || err.message).split("\n").slice(0, 4).join("\n"),
    });
  }
}

if (errores.length) {
  console.error(`\n${errores.length} archivo(s) con error de sintaxis:\n`);
  for (const e of errores) console.error(`  ${e.archivo}\n${e.mensaje}\n`);
  process.exit(1);
}
console.log(`OK: ${archivos.length} archivos sin errores de sintaxis.`);
