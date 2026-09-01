import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { abrirSelectorCategoria } from "/js/categoria-tree-modal.js";
import { listarCategoriasPorNivel } from "/js/catalogo.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "configuracion", titulo: "Categorías", usuario });

content.innerHTML = `
  <div class="card" style="padding:20px">
    <div class="section-title" style="display:flex; align-items:center; justify-content:space-between; border-bottom:none; margin-bottom:8px">
      <span>Categorías</span>
      <button type="button" id="btn-categorias" class="primary">Gestionar árbol</button>
    </div>
    <div class="hint" style="margin-bottom:12px">Crear, elegir y renombrar categorías y subcategorías se hace desde el mismo árbol que usa la ficha de producto.</div>
    <table>
      <thead><tr><th>Nombre</th><th>Nivel</th></tr></thead>
      <tbody id="tabla-categorias"></tbody>
    </table>
  </div>
`;

async function cargarCategorias() {
  const [categorias, subcategorias] = await Promise.all([
    listarCategoriasPorNivel("categoria"),
    listarCategoriasPorNivel("subcategoria"),
  ]);
  const tbody = document.getElementById("tabla-categorias");
  tbody.innerHTML = "";
  categorias.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.nombre}</td><td><span class="badge muted">Categoría</span></td>`;
    tbody.appendChild(tr);
    subcategorias
      .filter((s) => s.parentId === c.id)
      .forEach((s) => {
        const trSub = document.createElement("tr");
        trSub.innerHTML = `<td style="padding-left:32px">${s.nombre}</td><td><span class="badge muted">Subcategoría</span></td>`;
        tbody.appendChild(trSub);
      });
  });
  if (categorias.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="hint">Todavía no hay categorías cargadas.</td></tr>`;
  }
}

document.getElementById("btn-categorias").addEventListener("click", async () => {
  await abrirSelectorCategoria(null);
  cargarCategorias();
});

cargarCategorias();
