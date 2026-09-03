// Sincronización de catálogo con GBP: previsualiza qué cambió (precio/stock/descripción/IVA) antes
// de aplicar nada — mismo criterio que toda integración con GBP en este proyecto. No crea productos
// nuevos (ver functions/gbpArticulos.js) — los artículos de GBP sin correlato en Delfino quedan
// listados aparte, para cargar el costo a mano.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { previewArticulosGbp, aplicarArticulosGbp } from "/js/gbp-articulos.js";
import { formatMoneda as formatMonto } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "gbp-articulos-sync", titulo: "Sincronizar catálogo — GBP", usuario });

content.innerHTML = `<div class="hint">Comparando contra GBP (trae ~1400 artículos, puede tardar unos segundos)…</div>`;

function filaCambio(sku, descripcion, campo, cambio) {
  const formato = campo === "precioVenta" || campo === "stockTotal" ? (v) => (campo === "precioVenta" ? formatMonto(v) : v) : (v) => v;
  return `<tr>
    <td><input type="checkbox" data-role="chk" checked /></td>
    <td>${sku}</td>
    <td>${descripcion}</td>
    <td>${campo}</td>
    <td>${formato(cambio.anterior)}</td>
    <td>${formato(cambio.nuevo)}</td>
  </tr>`;
}

async function cargar() {
  let datos;
  try {
    datos = await previewArticulosGbp();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">No se pudo comparar con GBP: ${err?.message || err}</div>`;
    return;
  }

  // Una fila por CAMBIO (no por producto) — un producto con precio Y stock distintos aparece dos
  // veces, cada cambio con su propio checkbox, para poder aplicar solo lo que se quiera.
  const filas = [];
  datos.actualizados.forEach((p) => {
    Object.entries(p.cambios).forEach(([campo, cambio]) => {
      filas.push({ productoId: p.productoId, sku: p.sku, descripcion: p.descripcion, marcaNombre: p.marcaNombre, campo, cambio });
    });
  });

  content.innerHTML = `
    <div class="toolbar">
      <a href="/productos/index.html" class="link-btn">← Productos</a>
    </div>
    <div class="dashboard-grid" style="margin-bottom:16px">
      <div class="card dashboard-card"><div class="hint mt-0">Artículos en GBP</div><div class="dashboard-card-valor">${datos.totalGbp}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Sin cambios</div><div class="dashboard-card-valor">${datos.sinCambios}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Con cambios</div><div class="dashboard-card-valor">${datos.actualizados.length}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Nuevos en GBP (sin cargar)</div><div class="dashboard-card-valor">${datos.nuevos.length}</div></div>
    </div>

    <div class="card mb-16">
      <div class="toolbar" style="margin-bottom:8px">
        <label style="display:flex; align-items:center; gap:6px; font-size:14px">
          <input type="checkbox" id="chk-todos" ${filas.length > 0 ? "checked" : ""} /> Seleccionar todos (${filas.length})
        </label>
        <button type="button" id="btn-aplicar" class="primary" ${filas.length === 0 ? "disabled" : ""}>Aplicar cambios seleccionados</button>
        <span class="hint" id="estado-aplicar" style="margin:0"></span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th></th><th>SKU</th><th>Descripción</th><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
          <tbody id="tabla-body">${filas.length === 0 ? `<tr><td colspan="6" class="hint" style="text-align:center; padding:20px">Nada para actualizar — el catálogo ya está al día 🟢</td></tr>` : filas.map((f) => filaCambio(f.sku, f.descripcion, f.campo, f.cambio)).join("")}</tbody>
        </table>
      </div>
    </div>

    ${
      datos.nuevos.length > 0
        ? `<div class="card">
            <div class="section-title">Artículos nuevos en GBP (${datos.nuevos.length}) — no se cargan automáticamente</div>
            <div class="hint" style="margin-bottom:8px; max-width:70ch">GBP no informa el costo de estos artículos por esta vía (solo % de markup) — hay que cargarlos a mano con el costo real, desde Productos → Nuevo o el importador de Excel.</div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>SKU</th><th>Descripción</th><th>Marca</th><th>Categoría</th><th class="num">Precio (Lista Contado)</th><th class="num">Stock</th></tr></thead>
                <tbody>
                  ${datos.nuevos.map((a) => `<tr><td>${a.sku}</td><td>${a.descripcion}</td><td>${a.marcaNombre || "-"}</td><td>${a.categoriaNombre || "-"}</td><td class="num">${a.precioVenta != null ? formatMonto(a.precioVenta) : "-"}</td><td class="num">${a.stockTotal}</td></tr>`).join("")}
                </tbody>
              </table>
            </div>
          </div>`
        : ""
    }
  `;

  const tbody = document.getElementById("tabla-body");
  document.getElementById("chk-todos")?.addEventListener("change", (e) => {
    tbody.querySelectorAll("[data-role=chk]").forEach((chk) => (chk.checked = e.target.checked));
  });

  document.getElementById("btn-aplicar")?.addEventListener("click", async () => {
    const seleccionadas = [];
    tbody.querySelectorAll("tr").forEach((tr, i) => {
      const chk = tr.querySelector("[data-role=chk]");
      if (chk?.checked) seleccionadas.push(filas[i]);
    });
    if (seleccionadas.length === 0) {
      alert("No marcaste ningún cambio para aplicar.");
      return;
    }

    // Un mismo producto puede tener varios cambios seleccionados (precio y stock, por ejemplo) — se
    // agrupan en un solo item por producto antes de mandarlos, que es la forma que espera la función.
    const porProducto = new Map();
    for (const f of seleccionadas) {
      if (!porProducto.has(f.productoId)) porProducto.set(f.productoId, { productoId: f.productoId, sku: f.sku, marcaNombre: f.marcaNombre, cambios: {} });
      porProducto.get(f.productoId).cambios[f.campo] = f.cambio;
    }

    const btn = document.getElementById("btn-aplicar");
    const estado = document.getElementById("estado-aplicar");
    btn.disabled = true;
    estado.textContent = "Aplicando…";
    try {
      const resultado = await aplicarArticulosGbp(Array.from(porProducto.values()));
      estado.textContent = `Listo — ${resultado.aplicados} producto(s) actualizado(s).`;
      cargar();
    } catch (err) {
      estado.textContent = err?.message || "No se pudo aplicar.";
      estado.className = "hint error-text";
      btn.disabled = false;
    }
  });
}

cargar();
