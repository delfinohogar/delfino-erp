// Reconciliación de catálogo Delfino <-> Tiendanube: siempre previsualiza antes de aplicar nada.
// Ninguna acción de esta pantalla escribe en Tiendanube — todo lo que se aplica es hacia Delfino.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import {
  reconciliarCatalogoTiendaNube,
  vincularProductosTiendaNube,
  actualizarStockDesdeTiendaNube,
  importarProductosDesdeTiendaNube,
  importarImagenesDesdeTiendaNube,
} from "/js/tiendanube-catalogo.js";
import { formatMoneda } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "tiendanube-catalogo", titulo: "Catálogo — Tienda Nube", usuario });

content.innerHTML = `<div class="hint">Comparando catálogos (puede tardar unos segundos — trae ~1100 productos de Tienda Nube)…</div>`;

let datos = null;

function filaConCheckbox(id, celdas, marcadoPorDefecto = true) {
  return `<tr><td><input type="checkbox" data-role="chk" data-id="${id}" ${marcadoPorDefecto ? "checked" : ""} /></td>${celdas.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

function armarSeccion({ tabId, titulo, explicacion, items, columnas, filaFn, botonTexto, extraControles = "", todosMarcadosPorDefecto = true }) {
  if (items.length === 0) {
    return `<div id="tab-${tabId}" class="tab-panel" style="display:none">
      <div class="card"><div class="empty-state">Nada acá — 🟢</div></div>
    </div>`;
  }
  return `
    <div id="tab-${tabId}" class="tab-panel" style="display:none">
      <div class="hint" style="margin-bottom:12px; max-width:70ch">${explicacion}</div>
      ${extraControles}
      <div class="toolbar" style="margin-bottom:8px">
        <label style="display:flex; align-items:center; gap:6px; font-size:14px">
          <input type="checkbox" data-role="chk-todos" data-tab="${tabId}" ${todosMarcadosPorDefecto ? "checked" : ""} /> Seleccionar todos (${items.length})
        </label>
        <button type="button" data-role="aplicar" data-tab="${tabId}" class="primary">${botonTexto}</button>
        <span class="hint" data-role="estado-${tabId}" style="margin:0"></span>
      </div>
      <div class="card">
        <div class="table-scroll">
          <table>
            <thead><tr><th></th>${columnas.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
            <tbody>${items.map(filaFn).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function pintar() {
  const { totales, vinculables, soloEnDelfino, diffsStock, preciosAnomalos, sinImagen } = datos;
  // Sin stock = agotado en Tiendanube, no algo "nuevo" para vender — se muestran igual (por si
  // interesa cargarlos para más adelante) pero NO se marcan por defecto, para que "seleccionar
  // todos" no importe de una 333 fantasmas sin querer (ver conversación: la mayoría del catálogo
  // "solo en Tiendanube" resultó ser esto, no productos realmente nuevos).
  const soloEnTiendaNube = [...datos.soloEnTiendaNube].sort((a, b) => b.stock - a.stock);

  content.innerHTML = `
    <div class="dashboard-grid" style="margin-bottom:16px">
      <div class="card dashboard-card"><div class="hint mt-0">Productos en Delfino</div><div class="dashboard-card-valor">${totales.delfino}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Variantes en Tienda Nube</div><div class="dashboard-card-valor">${totales.tiendaNube}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Coinciden por SKU</div><div class="dashboard-card-valor">${totales.coincidentes}</div></div>
    </div>

    <div class="tabs">
      <button type="button" class="tab-btn active" data-tab="vincular">Vincular (${vinculables.length})</button>
      <button type="button" class="tab-btn" data-tab="importar">Importar nuevos (${soloEnTiendaNube.length})</button>
      <button type="button" class="tab-btn" data-tab="stock">Stock desincronizado (${diffsStock.length})</button>
      <button type="button" class="tab-btn" data-tab="precios">Precios anómalos (${preciosAnomalos.length})</button>
      <button type="button" class="tab-btn" data-tab="imagenes">Sin imagen (${sinImagen.length})</button>
      <button type="button" class="tab-btn" data-tab="solodelfino">Solo en Delfino (${soloEnDelfino.length})</button>
    </div>

    ${armarSeccion({
      tabId: "vincular",
      titulo: "Vincular",
      explicacion:
        "Productos que ya existen en los dos lados con el mismo SKU pero todavía no tienen guardada la relación en Delfino. Solo guarda el ID de Tienda Nube en el producto — no toca precio ni stock.",
      items: vinculables,
      columnas: ["SKU", "Producto"],
      filaFn: (it) => filaConCheckbox(it.productoId, [it.sku, it.nombre]),
      botonTexto: "Vincular seleccionados",
    })}

    ${armarSeccion({
      tabId: "importar",
      titulo: "Importar",
      explicacion: `Productos publicados en Tienda Nube que no existen en Delfino. ${
        soloEnTiendaNube.length - soloEnTiendaNube.filter((x) => x.stock > 0).length
      } de ${soloEnTiendaNube.length} tienen stock 0 (agotados — probablemente no hace falta importarlos, quedan destildados por defecto). El precio que trae es el de LISTA de Tienda Nube (sin descuento por efectivo) — revisalo antes de vender. El costo queda vacío, no lo tiene Tienda Nube.`,
      items: soloEnTiendaNube,
      columnas: ["SKU", "Producto", "Precio (lista TN)", "Stock TN"],
      filaFn: (it) =>
        filaConCheckbox(it.idExternoVariante, [it.sku, it.nombre, formatMoneda(it.precio), it.stock === 0 ? '<span class="hint">0</span>' : it.stock], it.stock > 0),
      botonTexto: "Importar seleccionados",
      todosMarcadosPorDefecto: false,
      extraControles: `
        <div class="field" style="max-width:220px; margin-bottom:12px">
          <label for="sel-iva-importar">IVA (%) para los nuevos</label>
          <select id="sel-iva-importar">
            <option value="21" selected>21%</option>
            <option value="10.5">10,5%</option>
            <option value="27">27%</option>
            <option value="0">0%</option>
          </select>
        </div>`,
    })}

    ${armarSeccion({
      tabId: "stock",
      titulo: "Stock",
      explicacion:
        "SKU que existen en los dos lados pero con stock distinto. Actualizar acá pisa el stock de Delfino con el valor de Tienda Nube — nunca al revés (Tienda Nube no se toca desde esta pantalla).",
      items: diffsStock,
      columnas: ["SKU", "Producto", "Stock Delfino", "Stock Tienda Nube"],
      filaFn: (it) => filaConCheckbox(it.productoId, [it.sku, it.nombre, it.stockDelfino, `<strong>${it.stockTiendaNube}</strong>`]),
      botonTexto: "Actualizar stock seleccionado en Delfino",
    })}

    ${armarSeccion({
      tabId: "imagenes",
      titulo: "Sin imagen",
      explicacion:
        "Productos que existen en los dos lados por SKU pero no tienen ninguna foto cargada en Delfino. Trae la portada actual de Tienda Nube (la de menor posición) — nunca pisa una imagen manual: si alguien ya cargó una entre esta lista y aplicar, ese producto se salta solo.",
      items: sinImagen,
      columnas: ["", "SKU", "Producto"],
      filaFn: (it) =>
        filaConCheckbox(it.productoId, [
          `<img src="${it.imagenUrl}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" />`,
          it.sku,
          it.nombre,
        ]),
      botonTexto: "Importar imágenes seleccionadas",
    })}

    <div id="tab-precios" class="tab-panel" style="display:none">
      <div class="hint" style="margin-bottom:12px; max-width:70ch">
        Solo diagnóstico — no hay botón de aplicar. La mayoría de las diferencias de precio son
        normales (Tienda Nube muestra precio de lista, Delfino el de contado con descuento) — estas
        NO siguen ese patrón, así que vale la pena mirarlas a mano.
      </div>
      <div class="card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>SKU</th><th>Producto</th><th>Delfino</th><th>Tienda Nube</th></tr></thead>
            <tbody>${preciosAnomalos
              .map((it) => `<tr><td>${it.sku}</td><td>${it.nombre}</td><td>${formatMoneda(it.precioDelfino)}</td><td>${formatMoneda(it.precioTiendaNube)}</td></tr>`)
              .join("")}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="tab-solodelfino" class="tab-panel" style="display:none">
      <div class="hint" style="margin-bottom:12px; max-width:70ch">Productos de Delfino que no están publicados en Tienda Nube — normal, no todo el catálogo tiene que estar online. Solo informativo.</div>
      <div class="card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>SKU</th><th>Producto</th></tr></thead>
            <tbody>${soloEnDelfino.map((it) => `<tr><td>${it.sku}</td><td>${it.nombre}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const primerPanel = document.querySelector(".tab-panel");
  if (primerPanel) primerPanel.style.display = "block";

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";
    });
  });

  document.querySelectorAll("[data-role=chk-todos]").forEach((chkTodos) => {
    chkTodos.addEventListener("change", () => {
      const panel = document.getElementById(`tab-${chkTodos.dataset.tab}`);
      panel.querySelectorAll("[data-role=chk]").forEach((c) => (c.checked = chkTodos.checked));
    });
  });

  document.querySelector('[data-role=aplicar][data-tab="vincular"]')?.addEventListener("click", async (e) => {
    const ids = seleccionados("vincular");
    const items = vinculables.filter((it) => ids.has(it.productoId));
    await ejecutar(e.target, "vincular", () => vincularProductosTiendaNube(items), `Vinculados: ${items.length}.`);
  });

  document.querySelector('[data-role=aplicar][data-tab="stock"]')?.addEventListener("click", async (e) => {
    const ids = seleccionados("stock");
    const items = diffsStock.filter((it) => ids.has(it.productoId)).map((it) => ({ productoId: it.productoId, stockNuevo: it.stockTiendaNube }));
    await ejecutar(e.target, "stock", () => actualizarStockDesdeTiendaNube(items), `Actualizados: ${items.length}.`);
  });

  document.querySelector('[data-role=aplicar][data-tab="imagenes"]')?.addEventListener("click", async (e) => {
    const ids = seleccionados("imagenes");
    const items = sinImagen.filter((it) => ids.has(it.productoId)).map((it) => ({ productoId: it.productoId, imagenUrl: it.imagenUrl, imagenIdExterno: it.imagenIdExterno }));
    await ejecutar(e.target, "imagenes", () => importarImagenesDesdeTiendaNube(items), (res) => {
      if (res.omitidos.length) console.log("Imágenes omitidas:", res.omitidos);
      return `Importadas: ${res.importadas}.${res.omitidos.length ? ` Omitidas: ${res.omitidos.length} (detalle en la consola del navegador).` : ""}`;
    });
  });

  document.querySelector('[data-role=aplicar][data-tab="importar"]')?.addEventListener("click", async (e) => {
    const ids = seleccionados("importar");
    const items = soloEnTiendaNube.filter((it) => ids.has(it.idExternoVariante));
    const ivaPorDefecto = document.getElementById("sel-iva-importar").value;
    await ejecutar(
      e.target,
      "importar",
      () => importarProductosDesdeTiendaNube(items, ivaPorDefecto),
      (res) => `Creados: ${res.creados}.${res.omitidosPorSkuExistente.length ? ` Omitidos por SKU ya existente: ${res.omitidosPorSkuExistente.join(", ")}.` : ""}`
    );
  });
}

function seleccionados(tabId) {
  const panel = document.getElementById(`tab-${tabId}`);
  return new Set(Array.from(panel.querySelectorAll("[data-role=chk]:checked")).map((c) => c.dataset.id));
}

async function ejecutar(boton, tabId, accion, mensajeOk) {
  const estadoEl = document.querySelector(`[data-role=estado-${tabId}]`);
  boton.disabled = true;
  estadoEl.textContent = "Aplicando…";
  try {
    const res = await accion();
    estadoEl.textContent = typeof mensajeOk === "function" ? mensajeOk(res) : mensajeOk;
    setTimeout(cargar, 1500); // recarga para reflejar el nuevo estado real, no confiar en lo optimista
  } catch (err) {
    estadoEl.textContent = "Error: " + (err?.message || "desconocido");
    estadoEl.className = "hint error-text";
    boton.disabled = false;
  }
}

async function cargar() {
  content.innerHTML = `<div class="hint">Comparando catálogos (puede tardar unos segundos — trae ~1100 productos de Tienda Nube)…</div>`;
  try {
    datos = await reconciliarCatalogoTiendaNube();
    pintar();
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="error-text">No se pudo comparar los catálogos: ${err?.message || "error desconocido"}</div></div>`;
  }
}

cargar();
