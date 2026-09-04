// TASK-001 — higiene del backend minimo.
//
// Criterio de aceptacion verificado:
//   "no abre puertos, no escucha HTTP, no importa firebase"
// mas la propiedad implicita de la que depende todo lo demas:
//   importar pool.js o migrar.js NO conecta a la base ni ejecuta nada.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import net from "node:net";
import http from "node:http";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const SRC = join(RAIZ, "backend", "src");
const POOL = join(SRC, "db", "pool.js");
const MIGRAR = join(SRC, "db", "migrar.js");

function archivosJs(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosJs(ruta));
    else if (entrada.endsWith(".js") || entrada.endsWith(".mjs")) salida.push(ruta);
  }
  return salida;
}

const FUENTES = archivosJs(SRC);

describe("TASK-001 higiene: no importa firebase", () => {
  it("hay fuentes que revisar", () => {
    expect(FUENTES.length).toBeGreaterThan(0);
  });

  it.each(FUENTES.map((f) => [f]))("%s no menciona firebase ni firestore", (ruta) => {
    const texto = readFileSync(ruta, "utf8").toLowerCase();
    expect(texto).not.toMatch(/from\s+["'][^"']*firebase/);
    expect(texto).not.toMatch(/require\(\s*["'][^"']*firebase/);
    expect(texto).not.toMatch(/gstatic\.com\/firebasejs/);
    expect(texto).not.toMatch(/firebase-admin/);
  });

  it("backend/package.json no declara ninguna dependencia de firebase", () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ, "backend", "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => d.includes("firebase"))).toEqual([]);
  });
});

describe("TASK-001 higiene: no abre puertos ni escucha HTTP", () => {
  it.each(FUENTES.map((f) => [f]))("%s no crea servidores ni escucha", (ruta) => {
    const texto = readFileSync(ruta, "utf8");
    expect(texto).not.toMatch(/createServer\s*\(/);
    expect(texto).not.toMatch(/\.listen\s*\(/);
    expect(texto).not.toMatch(/from\s+["']express["']/);
    expect(texto).not.toMatch(/from\s+["']node:http["']/);
    expect(texto).not.toMatch(/from\s+["']node:net["']/);
  });

  it("importar pool.js y migrar.js no llama a listen() de net ni de http", async () => {
    const listenNet = net.Server.prototype.listen;
    const listenHttp = http.Server.prototype.listen;
    let llamadas = 0;
    net.Server.prototype.listen = function (...args) {
      llamadas += 1;
      return listenNet.apply(this, args);
    };
    http.Server.prototype.listen = function (...args) {
      llamadas += 1;
      return listenHttp.apply(this, args);
    };
    try {
      // Primer import de estos modulos en este archivo: el cuerpo se ejecuta aca,
      // con el parche ya puesto.
      await import("../../backend/src/db/pool.js");
      await import("../../backend/src/db/migrar.js");
    } finally {
      net.Server.prototype.listen = listenNet;
      http.Server.prototype.listen = listenHttp;
    }
    expect(llamadas).toBe(0);
  });
});

describe("TASK-001 higiene: importar no tiene efectos secundarios", () => {
  // Si al importarse abrieran una conexion, un pool o un puerto, el proceso hijo
  // no podria terminar solo: el event loop quedaria con handles vivos.
  // Ademas el hijo corre SIN DATABASE_URL ni DATABASE_URL_TEST: si el modulo
  // intentara conectar al importarse, fallaria por falta de URL.
  function importarEnProcesoLimpio(rutaModulo) {
    const url = pathToFileURL(rutaModulo).href;
    const codigo = `await import(${JSON.stringify(url)}); console.log("IMPORTADO_SIN_EFECTOS");`;
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_TEST;
    delete env.VITEST;
    delete env.VITEST_WORKER_ID;
    delete env.NODE_ENV;
    return spawnSync(process.execPath, ["--input-type=module", "-e", codigo], {
      env,
      encoding: "utf8",
      timeout: 20000,
    });
  }

  it("importar pool.js termina solo y sin conectar", () => {
    const r = importarEnProcesoLimpio(POOL);
    expect(r.error ?? null).toBe(null); // un timeout aparece aca: el proceso no termino
    expect(r.stdout).toContain("IMPORTADO_SIN_EFECTOS");
    expect(r.status).toBe(0);
  });

  it("importar migrar.js termina solo, sin conectar y sin migrar nada", () => {
    const r = importarEnProcesoLimpio(MIGRAR);
    expect(r.error ?? null).toBe(null);
    expect(r.stdout).toContain("IMPORTADO_SIN_EFECTOS");
    expect(r.stdout).not.toMatch(/aplicada|Sin migraciones pendientes/);
    expect(r.status).toBe(0);
  });
});

describe("TASK-001 higiene: migracionesEnDisco lee el directorio real", () => {
  it("devuelve los .sql de backend/db/migrations en orden alfabetico", async () => {
    const { migracionesEnDisco, DIR_MIGRACIONES } = await import("../../backend/src/db/migrar.js");
    const enDisco = migracionesEnDisco();
    const esperado = readdirSync(DIR_MIGRACIONES)
      .filter((n) => n.toLowerCase().endsWith(".sql"))
      .sort();
    expect(enDisco).toEqual(esperado);
    expect(enDisco.length).toBeGreaterThanOrEqual(2);
    expect([...enDisco]).toEqual([...enDisco].sort());
  });
});
