import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import {
  buscarProductos,
  listarProductos,
  actualizarCategoriaMasivo,
  actualizarMarcaMasivo,
  aumentarPrecioMasivo,
} from "/js/productos.js";
import { listarCategoriasPorNivel } from "/js/catalogo.js";
import { abrirSelectorCategoria } from "/js/categoria-tree-modal.js";
import { pedirMarcaModal } from "/js/marca-picker-modal.js";
import { pedirAumentoPrecio } from "/js/aumento-precio-modal.js";
import { formatMoneda } from "/js/formato.js";
import { miniaturaProductoHtml } from "/js/producto-imagenes.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const esAdmin = usuario.rol === "administrador";
// Quién puede abrir la ficha completa de un producto (expone costo/margen) — mismo criterio que
// puedeEditarCatalogo() en firestore.rules: administrador y administrativo, no vendedor.
const puedeEditarCatalogo = usuario.rol !== "vendedor";

const content = renderShell({ active: "productos", titulo: "Productos", usuario });

content.innerHTML = `
  <div class="toolbar">
    <input type="text" id="search-input" placeholder="Buscar por SKU, código, descripción o marca…" style="min-width:280px" />
    <select id="filtro-estado">
      <option value="">Estado: todos</option>
      <option value="activo">Activo</option>
      <option value="inactivo">Inactivo</option>
    </select>
    <select id="filtro-categoria">
      <option value="">Categoría: todas</option>
    </select>
    <a href="/productos/venta-nueva.html"><button>Registrar venta</button></a>
    ${puedeEditarCatalogo ? '<a href="/productos/form.html"><button class="primary">+ Nuevo producto</button></a>' : ""}
  </div>
  ${
    esAdmin
      ? `<div class="toolbar" id="barra-masiva" style="display:none">
          <span class="hint" id="cantidad-seleccionados" style="font-size:13px"></span>
          <button type="button" id="btn-masivo-categoria">Cambiar categoría</button>
          <button type="button" id="btn-masivo-marca">Cambiar marca</button>
          <button type="button" id="btn-masivo-precio">Aumentar precio %</button>
        </div>`
      : ""
  }
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            ${esAdmin ? '<th style="width:1%"><input type="checkbox" id="check-todos" /></th>' : ""}
            <th></th>
            <th>SKU</th>
            <th>Descripción</th>
            <th>Stock</th>
            ${esAdmin ? "<th>Costo s/IVA</th>" : ""}
            <th>Precio de venta</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No se encontraron productos.</div>
  </div>
`;

const searchInput = document.getElementById("search-input");
const filtroEstado = document.getElementById("filtro-estado");
const filtroCategoria = document.getElementById("filtro-categoria");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
const checkTodos = document.getElementById("check-todos");
const barraMasiva = document.getElementById("barra-masiva");

listarCategoriasPorNivel("categoria").then((categorias) => {
  categorias.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nombre;
    filtroCategoria.appendChild(opt);
  });
});

function miniatura(p) {
  return miniaturaProductoHtml(p);
}

function estadoBadge(estado) {
  return estado === "activo"
    ? '<span class="badge success">Activo</span>'
    : '<span class="badge muted">Inactivo</span>';
}

let ultimosResultados = [];
let filtrados = [];
const seleccionados = new Map(); // id -> producto

function aplicarFiltrosYPintar() {
  const estado = filtroEstado.value;
  const categoriaId = filtroCategoria.value;
  filtrados = ultimosResultados.filter((p) => {
    if (estado && p.estado !== estado) return false;
    if (categoriaId && p.categoriaId !== categoriaId) return false;
    return true;
  });
  seleccionados.clear();
  pintarProductos(filtrados);
  actualizarBarraMasiva();
}

function actualizarBarraMasiva() {
  if (!esAdmin) return;
  const n = seleccionados.size;
  barraMasiva.style.display = n > 0 ? "flex" : "none";
  document.getElementById("cantidad-seleccionados").textContent = `${n} seleccionado${n === 1 ? "" : "s"}`;
  checkTodos.checked = n > 0 && n === filtrados.length;
  checkTodos.indeterminate = n > 0 && n < filtrados.length;
}

function pintarProductos(productos) {
  tablaBody.innerHTML = "";
  emptyState.style.display = productos.length === 0 ? "block" : "none";
  productos.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      ${esAdmin ? `<td><input type="checkbox" data-check="${p.id}" /></td>` : ""}
      <td>${miniatura(p)}</td>
      <td>${p.sku || ""}</td>
      <td>${p.descripcion || ""}</td>
      <td>${p.stockTotal ?? 0}</td>
      ${esAdmin ? `<td>${p.costoReferencia != null ? formatMoneda(p.costoReferencia, { decimales: 2 }) : "-"}</td>` : ""}
      <td>${p.precioVenta != null ? formatMoneda(p.precioVenta) : "-"}</td>
      <td>${estadoBadge(p.estado)}</td>
    `;
    if (puedeEditarCatalogo) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", (e) => {
        if (e.target.closest("[data-check]")) return;
        location.href = `/productos/form.html?id=${p.id}`;
      });
    }
    if (esAdmin) {
      tr.querySelector("[data-check]").addEventListener("click", (e) => {
        e.stopPropagation();
        if (e.target.checked) seleccionados.set(p.id, p);
        else seleccionados.delete(p.id);
        actualizarBarraMasiva();
      });
    }
    tablaBody.appendChild(tr);
  });
}

async function cargarInicial() {
  ultimosResultados = await listarProductos(50);
  aplicarFiltrosYPintar();
}

let debounceTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const texto = searchInput.value.trim();
  debounceTimer = setTimeout(async () => {
    ultimosResultados = texto ? await buscarProductos(texto) : await listarProductos(50);
    aplicarFiltrosYPintar();
  }, 250);
});

filtroEstado.addEventListener("change", aplicarFiltrosYPintar);
filtroCategoria.addEventListener("change", aplicarFiltrosYPintar);

if (esAdmin) {
  checkTodos.addEventListener("change", () => {
    if (checkTodos.checked) {
      filtrados.forEach((p) => seleccionados.set(p.id, p));
    } else {
      seleccionados.clear();
    }
    tablaBody.querySelectorAll("[data-check]").forEach((chk) => {
      chk.checked = seleccionados.has(chk.dataset.check);
    });
    actualizarBarraMasiva();
  });

  document.getElementById("btn-masivo-categoria").addEventListener("click", async () => {
    const resultado = await abrirSelectorCategoria(null);
    if (!resultado) return;
    const lista = Array.from(seleccionados.values());
    await actualizarCategoriaMasivo(lista, resultado.categoriaId, resultado.subcategoriaId, usuario);
    alert(`Categoría actualizada en ${lista.length} producto(s).`);
    cargarInicial();
  });

  document.getElementById("btn-masivo-marca").addEventListener("click", async () => {
    const marca = await pedirMarcaModal(seleccionados.size);
    if (!marca) return;
    const lista = Array.from(seleccionados.values());
    await actualizarMarcaMasivo(lista, marca.id, marca.nombre, usuario);
    alert(`Marca actualizada en ${lista.length} producto(s).`);
    cargarInicial();
  });

  document.getElementById("btn-masivo-precio").addEventListener("click", async () => {
    const datos = await pedirAumentoPrecio(seleccionados.size);
    if (!datos) return;
    const lista = Array.from(seleccionados.values());
    const { omitidos } = await aumentarPrecioMasivo(lista, datos.porcentaje, datos.modo, usuario);
    let mensaje = `Precio actualizado en ${lista.length - omitidos} producto(s).`;
    if (omitidos > 0) mensaje += ` ${omitidos} se salteó(aron) por estar en modo manual.`;
    alert(mensaje);
    cargarInicial();
  });
}

cargarInicial();
