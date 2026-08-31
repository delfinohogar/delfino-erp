import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { pedirCamposModal } from "/js/modal.js";
import { listarMarcas, crearMarca, renombrarMarca } from "/js/catalogo.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "config-marcas", titulo: "Marcas", usuario });

content.innerHTML = `
  <div class="toolbar">
    <button type="button" id="btn-nueva-marca" class="primary">+ Nueva marca</button>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Nombre</th><th></th></tr></thead>
      <tbody id="tabla-marcas"></tbody>
    </table>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay marcas cargadas.</div>
  </div>
`;

const tbody = document.getElementById("tabla-marcas");
const emptyState = document.getElementById("empty-state");

async function cargarMarcas() {
  const marcas = await listarMarcas();
  tbody.innerHTML = "";
  emptyState.style.display = marcas.length === 0 ? "block" : "none";
  marcas.forEach((m) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${m.nombre}</td><td style="width:1%"><button type="button" data-editar-marca="${m.id}" data-nombre="${m.nombre}">✎ Renombrar</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("[data-editar-marca]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const datos = await pedirCamposModal("Renombrar marca", [
        { name: "nombre", label: "Nombre", value: btn.dataset.nombre, required: true },
      ]);
      if (!datos) return;
      await renombrarMarca(btn.dataset.editarMarca, datos.nombre);
      cargarMarcas();
    });
  });
}

document.getElementById("btn-nueva-marca").addEventListener("click", async () => {
  const datos = await pedirCamposModal("Nueva marca", [{ name: "nombre", label: "Nombre", required: true }]);
  if (!datos) return;
  await crearMarca(datos.nombre);
  cargarMarcas();
});

cargarMarcas();
