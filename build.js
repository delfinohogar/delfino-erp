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
// Ninguna pantalla queda afuera del bundling — antes index.html/login.html/productos/inventario.html
// se dejaban con su script inline sin empaquetar ("casos chicos, no vale la complejidad"), pero esa
// premisa asumía que js/ se seguía publicando igual. Desde que existe CARPETA_PUBLICABLE (más abajo)
// js/ ya NO se publica (salvo el vendoreado xlsx.full.min.js) — un script inline con imports directos
// a js/ se rompe en producción sin aviso. Por eso ahora las tres tienen su .js propio
// (index.js, login.js, productos/inventario.js) y pasan por acá igual que cualquier otra pantalla.
//
// Además arma CARPETA_PUBLICABLE ("publicar/") — lo único que Netlify debe subir. netlify.toml
// apunta publish ahí en vez de la raíz del repo: con publish="." (como era antes) se sube TODO,
// código fuente incluido — .netlifyignore parecía resolver esto pero no es un mecanismo real de
// Netlify (verificado contra la documentación oficial: no existe, nunca filtró nada), así que
// functions/ (Cloud Functions), firestore.rules, firebase.json, js/ propio y build.js quedaban
// públicos. Lista de PERMITIDOS, no de bloqueados a propósito (ver armarCarpetaPublicable): si mañana
// se agrega una carpeta nueva al repo, queda afuera de lo publicado por default, no adentro.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const CARPETA_PUBLICABLE = "publicar";

function listarHtml(dir, out = []) {
  for (const nombre of fs.readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "functions", CARPETA_PUBLICABLE].includes(nombre)) continue;
    const p = path.join(dir, nombre);
    const st = fs.statSync(p);
    if (st.isDirectory()) listarHtml(p, out);
    else if (nombre.endsWith(".html")) out.push(p);
  }
  return out;
}

function encontrarEntryPoints(htmls) {
  const entries = new Set();
  for (const html of htmls) {
    const contenido = fs.readFileSync(html, "utf8");
    for (const m of contenido.matchAll(/<script type="module" src="\/([^"]+\.js)"/g)) {
      // El .html ya apunta a /dist/... (build anterior) — el entry point real es la ruta original,
      // sin ese prefijo. Sin esto, correr el build dos veces anida dist/dist/...
      entries.add(m[1].startsWith("dist/") ? m[1].slice("dist/".length) : m[1]);
    }
  }
  return Array.from(entries);
}

function limpiarCarpeta(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copiarArchivo(origen, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origen, destino);
}

function copiarDirectorio(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const nombre of fs.readdirSync(origen)) {
    const origenItem = path.join(origen, nombre);
    const destinoItem = path.join(destino, nombre);
    if (fs.statSync(origenItem).isDirectory()) copiarDirectorio(origenItem, destinoItem);
    else copiarArchivo(origenItem, destinoItem);
  }
}

// Todo lo que va a publicarse, copiado explícitamente uno por uno — nunca "copiar todo y sacar lo
// que no va". dist/ no está acá porque esbuild ya escribe directo ahí (ver outdir en main()).
function armarCarpetaPublicable(htmls) {
  for (const html of htmls) copiarArchivo(html, path.join(CARPETA_PUBLICABLE, html));
  copiarDirectorio("css", path.join(CARPETA_PUBLICABLE, "css"));
  // Única dependencia de js/ que hace falta en producción: SheetJS, cargado con <script src> plano
  // (no <script type="module">, así que el bundler de arriba nunca lo toca) en las 3 pantallas de
  // importación Excel — ver productos/importar.html, gbp-clientes-importar.html,
  // gbp-proveedores-importar.html. El resto de js/ (todo lo demás) ya está adentro de dist/.
  copiarArchivo("js/vendor/xlsx.full.min.js", path.join(CARPETA_PUBLICABLE, "js/vendor/xlsx.full.min.js"));
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
  limpiarCarpeta(CARPETA_PUBLICABLE); // no arrastrar archivos de un build anterior

  const htmls = listarHtml(".");
  const entryPoints = encontrarEntryPoints(htmls);
  console.log(`Empaquetando ${entryPoints.length} pantallas...`);

  await esbuild.build({
    entryPoints,
    bundle: true,
    outdir: path.join(CARPETA_PUBLICABLE, "dist"),
    outbase: ".",
    format: "esm",
    minify: true,
    target: "esnext",
    external: ["https://*"],
    plugins: [raizProyectoPlugin],
    logLevel: "info",
  });

  armarCarpetaPublicable(htmls);

  console.log(`Listo. "${CARPETA_PUBLICABLE}/" lista para publicar.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
