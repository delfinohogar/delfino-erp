import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { pedirClienteModal } from "/js/cliente-modal.js";
import { listarClientesTodos, crearCliente } from "/js/clientes.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "config-clientes", titulo: "Clientes", usuario });

content.innerHTML = `
  <div class="toolbar">
    <input type="text" id="buscador" placeholder="Buscar por nombre o CUIT…" style="min-width:280px" />
    <button type="button" id="btn-nuevo" class="primary">+ Nuevo cliente</button>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Nombre / Razón social</th>
            <th>CUIT</th>
            <th>Condición IVA</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no tenés ningún cliente cargado.</div>
  </div>
`;

const buscador = document.getElementById("buscador");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
let clientes = [];

function origenBadge(fuente) {
  if (fuente === "arca") return '<span class="badge success">ARCA</span>';
  if (fuente === "gbp") return '<span class="badge warning">GBP</span>';
  return '<span class="badge muted">Manual</span>';
}

function pintar(lista) {
  tablaBody.innerHTML = "";
  emptyState.style.display = lista.length === 0 ? "block" : "none";
  lista.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.razonSocial || "")}</td>
      <td>${escapeHtml(c.cuit || "-")}</td>
      <td>${escapeHtml(c.condicionIva || "-")}</td>
      <td>${origenBadge(c.fuenteDatos)}</td>
    `;
    tr.addEventListener("click", () => {
      location.href = `/configuracion/cliente-ficha.html?id=${c.id}`;
    });
    tablaBody.appendChild(tr);
  });
}

async function cargar() {
  clientes = await listarClientesTodos();
  pintar(clientes);
}

buscador.addEventListener("input", () => {
  const t = buscador.value.trim().toLowerCase();
  if (!t) {
    pintar(clientes);
    return;
  }
  pintar(clientes.filter((c) => (c.razonSocialLower || "").includes(t) || (c.cuit || "").includes(t)));
});

document.getElementById("btn-nuevo").addEventListener("click", async () => {
  const datos = await pedirClienteModal("");
  if (!datos) return;
  await crearCliente(datos.razonSocial, datos.cuit, datos.datosArca, datos.datosContacto);
  await cargar();
});

cargar();
