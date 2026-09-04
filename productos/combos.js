// Combos: crear/listar productos compuestos por otros productos. Precio, costo y stock se calculan
// solos a partir de los componentes (ver js/combos.js) — acá solo se arma la lista de componentes y
// se previsualiza el resultado antes de guardar.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarProductosActivos, filtrarProductosLocal } from "/js/productos.js";
import { calcularDerivadosCombo, crearCombo, listarCombos } from "/js/combos.js";
import { formatMoneda } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "combos", titulo: "Combos", usuario });

const catalogo = (await listarProductosActivos()).filter((p) => p.tipoProducto !== "combo"); // un combo no puede tener otro combo como componente

content.innerHTML = `
  <div class="card mb-16" style="padding:20px; max-width:640px">
    <div class="section-title">Nuevo combo</div>
    <div class="hint" style="margin-bottom:14px; max-width:60ch">
      El precio, el costo y el stock se calculan solos a partir de los componentes — el stock es el
      mínimo entre (stock de cada componente ÷ cantidad que necesita). Nunca se cargan a mano.
    </div>
    <div class="field-row">
      <div class="field">
        <label for="f-sku">SKU del combo</label>
        <input type="text" id="f-sku" placeholder="ej. 1000200" />
      </div>
      <div class="field" style="flex:2">
        <label for="f-descripcion">Descripción</label>
        <input type="text" id="f-descripcion" placeholder="ej. Combo Colchón + Sommier 2 Plazas" />
      </div>
    </div>

    <div class="field">
      <label for="f-buscar-componente">Agregar componente</label>
      <input type="text" id="f-buscar-componente" placeholder="Buscar por SKU o descripción…" autocomplete="off" />
      <div id="resultados-componente" class="pos-resultados" style="max-height:200px"></div>
    </div>

    <div id="lista-componentes" style="margin:12px 0"></div>

    <div id="preview-combo" class="card" style="padding:12px 16px; background:var(--muted-bg); display:none; margin-bottom:14px">
      <div class="dashboard-grid">
        <div><div class="hint mt-0">Precio (calculado)</div><div id="preview-precio" style="font-weight:600"></div></div>
        <div><div class="hint mt-0">Stock (calculado)</div><div id="preview-stock" style="font-weight:600"></div></div>
      </div>
    </div>
    <div class="error-text" id="form-error" style="display:none"></div>

    <div class="toolbar">
      <button type="button" id="btn-guardar" class="primary">Crear combo</button>
    </div>
  </div>

  <div class="card" style="padding:20px">
    <div class="section-title">Combos existentes</div>
    <div id="lista-combos"></div>
  </div>
`;

let componentesElegidos = []; // { productoId, sku, descripcion, cantidad, stockDisponible }

function pintarComponentes() {
  const el = document.getElementById("lista-componentes");
  if (componentesElegidos.length === 0) {
    el.innerHTML = `<div class="hint">Todavía no agregaste ningún componente.</div>`;
  } else {
    el.innerHTML = `
      <table>
        <thead><tr><th>SKU</th><th>Producto</th><th>Cantidad</th><th>Stock disponible</th><th></th></tr></thead>
        <tbody>
          ${componentesElegidos
            .map(
              (c, i) => `
            <tr>
              <td>${c.sku}</td>
              <td>${c.descripcion}</td>
              <td><input type="number" min="1" step="1" value="${c.cantidad}" data-role="cantidad" data-i="${i}" style="width:70px" /></td>
              <td>${c.stockDisponible}</td>
              <td><button type="button" data-role="quitar" data-i="${i}">✕</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
    el.querySelectorAll("[data-role=cantidad]").forEach((inp) =>
      inp.addEventListener("input", (e) => {
        componentesElegidos[Number(e.target.dataset.i)].cantidad = Math.max(1, parseInt(e.target.value) || 1);
        actualizarPreview();
      })
    );
    el.querySelectorAll("[data-role=quitar]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        componentesElegidos.splice(Number(e.target.dataset.i), 1);
        pintarComponentes();
        actualizarPreview();
      })
    );
  }
}

let previewTimeout = null;
function actualizarPreview() {
  const previewEl = document.getElementById("preview-combo");
  clearTimeout(previewTimeout);
  if (componentesElegidos.length === 0) {
    previewEl.style.display = "none";
    return;
  }
  // Debounce chico: si el usuario está tipeando la cantidad, no hace falta recalcular en cada tecla.
  previewTimeout = setTimeout(async () => {
    try {
      const derivados = await calcularDerivadosCombo(componentesElegidos.map((c) => ({ productoId: c.productoId, cantidad: c.cantidad })));
      document.getElementById("preview-precio").textContent = formatMoneda(derivados.precioVenta);
      document.getElementById("preview-stock").textContent = derivados.stockTotal;
      previewEl.style.display = "block";
    } catch (err) {
      previewEl.style.display = "none";
    }
  }, 200);
}

const buscarInput = document.getElementById("f-buscar-componente");
const resultadosEl = document.getElementById("resultados-componente");
buscarInput.addEventListener("input", () => {
  const texto = buscarInput.value.trim();
  if (!texto) {
    resultadosEl.innerHTML = "";
    return;
  }
  const encontrados = filtrarProductosLocal(catalogo, texto, 8).filter((p) => !componentesElegidos.some((c) => c.productoId === p.id));
  resultadosEl.innerHTML = encontrados
    .map(
      (p) => `
    <div class="pos-result-item" data-id="${p.id}">
      <div style="flex:1; min-width:0"><div>${p.descripcion}</div><div class="hint">${p.sku} · Stock: ${p.stockTotal ?? 0}</div></div>
    </div>`
    )
    .join("");
  resultadosEl.querySelectorAll("[data-id]").forEach((elFila) => {
    elFila.addEventListener("click", () => {
      const p = encontrados.find((x) => x.id === elFila.dataset.id);
      componentesElegidos.push({ productoId: p.id, sku: p.sku, descripcion: p.descripcion, cantidad: 1, stockDisponible: p.stockTotal ?? 0 });
      buscarInput.value = "";
      resultadosEl.innerHTML = "";
      pintarComponentes();
      actualizarPreview();
    });
  });
});

document.getElementById("btn-guardar").addEventListener("click", async () => {
  const errorEl = document.getElementById("form-error");
  errorEl.style.display = "none";
  const btn = document.getElementById("btn-guardar");
  btn.disabled = true;
  try {
    await crearCombo(
      {
        sku: document.getElementById("f-sku").value,
        descripcion: document.getElementById("f-descripcion").value,
        componentes: componentesElegidos.map((c) => ({ productoId: c.productoId, cantidad: c.cantidad })),
      },
      usuario
    );
    document.getElementById("f-sku").value = "";
    document.getElementById("f-descripcion").value = "";
    componentesElegidos = [];
    pintarComponentes();
    actualizarPreview();
    await cargarCombos();
  } catch (err) {
    errorEl.textContent = err?.message || "No se pudo crear el combo.";
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

async function cargarCombos() {
  const combos = await listarCombos();
  const el = document.getElementById("lista-combos");
  if (combos.length === 0) {
    el.innerHTML = `<div class="empty-state">Todavía no hay combos cargados.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>SKU</th><th>Descripción</th><th>Componentes</th><th>Precio</th><th>Stock</th></tr></thead>
        <tbody>
          ${combos
            .map(
              (c) => `
            <tr>
              <td>${c.sku}</td>
              <td>${c.descripcion}</td>
              <td>${(c.componentes || []).map((comp) => `${comp.cantidad}× ${comp.sku}`).join(", ")}</td>
              <td>${formatMoneda(c.precioVenta)}</td>
              <td>${c.stockTotal ?? 0}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

pintarComponentes();
await cargarCombos();
