import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { pedirProveedorModal } from "/js/proveedor-modal.js";
import { listarProveedoresTodos, crearProveedor } from "/js/catalogo.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "config-proveedores", titulo: "Proveedores", usuario });

content.innerHTML = `
  <div class="toolbar">
    <input type="text" id="buscador" placeholder="Buscar por razón social o CUIT…" style="min-width:280px" />
    <button type="button" id="btn-nuevo" class="primary">+ Nuevo proveedor</button>
  </div>
  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Razón social</th>
          <th>CUIT</th>
          <th>Condición IVA</th>
          <th>Origen</th>
        </tr>
      </thead>
      <tbody id="tabla-body"></tbody>
    </table>
    <div id="empty-state" class="empty-state" style="display:none">No hay proveedores cargados todavía.</div>
  </div>
`;

const buscador = document.getElementById("buscador");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
let proveedores = [];

function origenBadge(fuente) {
  return fuente === "arca" ? '<span class="badge success">ARCA</span>' : '<span class="badge muted">Manual</span>';
}

function pintar(lista) {
  tablaBody.innerHTML = "";
  emptyState.style.display = lista.length === 0 ? "block" : "none";
  lista.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.razonSocial || ""}</td>
      <td>${p.cuit || "-"}</td>
      <td>${p.condicionIva || "-"}</td>
      <td>${origenBadge(p.fuenteDatos)}</td>
    `;
    tr.addEventListener("click", () => {
      location.href = `/configuracion/proveedor-ficha.html?id=${p.id}`;
    });
    tablaBody.appendChild(tr);
  });
}

async function cargar() {
  proveedores = await listarProveedoresTodos();
  pintar(proveedores);
}

buscador.addEventListener("input", () => {
  const t = buscador.value.trim().toLowerCase();
  if (!t) {
    pintar(proveedores);
    return;
  }
  pintar(proveedores.filter((p) => (p.razonSocialLower || "").includes(t) || (p.cuit || "").includes(t)));
});

document.getElementById("btn-nuevo").addEventListener("click", async () => {
  const datos = await pedirProveedorModal("");
  if (!datos) return;
  await crearProveedor(datos.razonSocial, datos.cuit, datos.datosArca);
  await cargar();
});

cargar();
