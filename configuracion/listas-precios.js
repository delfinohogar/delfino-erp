import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarListasPrecios, crearListaPrecio, actualizarListaPrecio } from "/js/catalogo.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "config-precios", titulo: "Listas de Precios", usuario });

content.innerHTML = `
  <div class="toolbar">
    <button type="button" id="btn-nueva" class="primary">+ Nueva lista de precios</button>
  </div>

  <div class="card" id="form-card" style="display:none; padding:20px; margin-bottom:16px">
    <div class="section-title" id="form-titulo">Nueva lista de precios</div>
    <form id="form-lista">
      <div class="field-row">
        <div class="field">
          <label for="f-nombre">Nombre</label>
          <input type="text" id="f-nombre" placeholder="Ej. Venta presencial, Mayorista, Tiendanube" required />
        </div>
        <div class="field">
          <label for="f-margen">Margen (%) sobre costo final</label>
          <input type="number" id="f-margen" step="0.01" min="0" value="30" required />
          <div class="hint">Se aplica sobre el costo con IVA incluido, no sobre el costo de referencia.</div>
        </div>
        <div class="field">
          <label for="f-redondeo">Redondeo</label>
          <select id="f-redondeo">
            <option value="sin_redondeo">Sin redondeo</option>
            <option value="entero">Al entero más cercano</option>
            <option value="multiplo_10">Al múltiplo de 10</option>
            <option value="multiplo_100">Al múltiplo de 100</option>
          </select>
        </div>
        <div class="field">
          <label for="f-activa">Estado</label>
          <select id="f-activa">
            <option value="true">Activa</option>
            <option value="false">Inactiva</option>
          </select>
        </div>
      </div>
      <div class="toolbar">
        <button type="submit" class="primary">Guardar</button>
        <button type="button" id="btn-cancelar">Cancelar</button>
      </div>
    </form>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Margen</th>
          <th>Redondeo</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody id="tabla-body"></tbody>
    </table>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay listas de precios creadas.</div>
  </div>
`;

const REDONDEO_LABEL = {
  sin_redondeo: "Sin redondeo",
  entero: "Al entero",
  multiplo_10: "Múltiplo de 10",
  multiplo_100: "Múltiplo de 100",
};

const formCard = document.getElementById("form-card");
const formTitulo = document.getElementById("form-titulo");
const form = document.getElementById("form-lista");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

let editandoId = null;

function abrirFormulario(lista) {
  editandoId = lista?.id || null;
  formTitulo.textContent = lista ? "Editar lista de precios" : "Nueva lista de precios";
  document.getElementById("f-nombre").value = lista?.nombre || "";
  document.getElementById("f-margen").value = lista?.reglaMargen ?? 30;
  document.getElementById("f-redondeo").value = lista?.reglaRedondeo || "sin_redondeo";
  document.getElementById("f-activa").value = String(lista?.activa ?? true);
  formCard.style.display = "block";
  document.getElementById("f-nombre").focus();
}

function cerrarFormulario() {
  formCard.style.display = "none";
  editandoId = null;
  form.reset();
}

function pintar(listas) {
  tablaBody.innerHTML = "";
  emptyState.style.display = listas.length === 0 ? "block" : "none";
  listas.forEach((l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.nombre}</td>
      <td>${l.reglaMargen}%</td>
      <td>${REDONDEO_LABEL[l.reglaRedondeo] || l.reglaRedondeo}</td>
      <td>${l.activa ? '<span class="badge success">Activa</span>' : '<span class="badge muted">Inactiva</span>'}</td>
    `;
    tr.addEventListener("click", () => abrirFormulario(l));
    tablaBody.appendChild(tr);
  });
}

async function cargar() {
  const listas = await listarListasPrecios();
  pintar(listas);
}

document.getElementById("btn-nueva").addEventListener("click", () => abrirFormulario(null));
document.getElementById("btn-cancelar").addEventListener("click", cerrarFormulario);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const datos = {
    nombre: document.getElementById("f-nombre").value.trim(),
    reglaMargen: parseFloat(document.getElementById("f-margen").value) || 0,
    reglaRedondeo: document.getElementById("f-redondeo").value,
    activa: document.getElementById("f-activa").value === "true",
  };
  if (editandoId) {
    await actualizarListaPrecio(editandoId, datos);
  } else {
    await crearListaPrecio(datos);
  }
  cerrarFormulario();
  cargar();
});

cargar();
