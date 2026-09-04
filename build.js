// Empaqueta el JS propio de cada pantalla en un solo archivo por página (dist/<misma-ruta>.js), en
// vez de dejar que el navegador resuelva la cadena de imports sueltos (~40 pedidos de red por
// pantalla, ver productos/venta-nueva.js) — en wifi no se nota, pero en una conexión celular con
// mala señal cada pedido suma su propio ida-y-vuelta y el total se vuelve muy lento.
//
// El SDK de Firebase se deja afuera a propósito (external): ya viene de un CDN aparte
// (gstatic.com, bien cacheado entre visitas) y bundlearlo requeriría reescribir js/firebase.js para
// usar el paquete de npm en vez de las URLs actuales — cambio más grande, no necesario para el
// problema real (los ~40 archivos PROPIOS son los que más pesan en cantidad de pedidos).
//
// No se empaquetan los dos <script type="module"> inline (index.html, productos/inventario.html):
// son casos chicos (1-2 imports) y bundlear un script sin archivo propio requeriría separarlo primero
// — no vale la complejidad para el ahorro que dan.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

function listarHtml(dir, out = []) {
  for (const nombre of fs.readdirSync(dir)) {
    if (nombre === "node_modules" || nombre === "dist" || nombre === ".git" || nombre === "functions") continue;
    const p = path.join(dir, nombre);
    const st = fs.statSync(p);
    if (st.isDirectory()) listarHtml(p, out);
    else if (nombre.endsWith(".html")) out.push(p);
  }
  return out;
}

function encontrarEntryPoints() {
  const entries = new Set();
  for (const html of listarHtml(".")) {
    const contenido = fs.readFileSync(html, "utf8");
    for (const m of contenido.matchAll(/<script type="module" src="\/([^"]+\.js)"/g)) {
      // El .html ya apunta a /dist/... (build anterior) — el entry point real es la ruta original,
      // sin ese prefijo. Sin esto, correr el build dos veces anida dist/dist/...
      entries.add(m[1].startsWith("dist/") ? m[1].slice("dist/".length) : m[1]);
    }
  }
  return Array.from(entries);
}

// Todos los imports del proyecto son "absolutos de sitio" (ej. "/js/auth.js", como los resuelve el
// navegador desde la raíz del dominio) — el resolver de esbuild por default los toma como rutas de
// filesystem, no como raíz del proyecto. Este plugin los hace apuntar a la raíz del repo.
const raizProyectoPlugin = {
  name: "raiz-proyecto",
  setup(build) {
    build.onResolve({ filter: /^\// }, (args) => ({
      path: path.join(__dirname, args.path),
    }));
  },
};

async function main() {
  const entryPoints = encontrarEntryPoints();
  console.log(`Empaquetando ${entryPoints.length} pantallas...`);

  await esbuild.build({
    entryPoints,
    bundle: true,
    outdir: "dist",
    outbase: ".",
    format: "esm",
    minify: true,
    target: "esnext",
    external: ["https://*"],
    plugins: [raizProyectoPlugin],
    logLevel: "info",
  });

  console.log("Listo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
