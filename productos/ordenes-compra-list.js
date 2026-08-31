import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarOrdenesCompra, actualizarEstadoOrden } from "/js/ordenes-compra.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "ordenes-compra", titulo: "Órdenes de compra", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/productos/ordenes-compra-nueva.html"><button class="primary">+ Nueva orden de compra</button></a>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Proveedor</th>
            <th>Referencia</th>
            <th>Ítems</th>
            <th>Total</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no cargaste ninguna orden de compra.</div>
  </div>
`;

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

const ESTADO_BADGE = {
  pendiente: '<span class="badge muted">Pendiente</span>',
  recibida: '<span class="badge success">Recibida</span>',
  cancelada: '<span class="badge danger">Cancelada</span>',
};

async function cargar() {
  const ordenes = await listarOrdenesCompra();
  emptyState.style.display = ordenes.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";
  ordenes.forEach((o) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatFecha(o.fecha)}</td>
      <td>${o.proveedorNombre || ""}</td>
      <td>${o.referencia || "-"}</td>
      <td>${(o.items || []).length}</td>
      <td>${(o.total ?? 0).toLocaleString("es-AR")}</td>
      <td>${ESTADO_BADGE[o.estado] || o.estado}</td>
      <td></td>
    `;
    if (o.estado === "pendiente") {
      const celdaAcciones = tr.lastElementChild;
      const btnRecibida = document.createElement("button");
      btnRecibida.type = "button";
      btnRecibida.textContent = "Marcar recibida";
      btnRecibida.addEventListener("click", (e) => {
        e.stopPropagation();
        location.href = `/productos/compras-nueva.html?ordenId=${o.id}`;
      });
      const btnCancelar = document.createElement("button");
      btnCancelar.type = "button";
      btnCancelar.textContent = "Cancelar";
      btnCancelar.style.marginLeft = "6px";
      btnCancelar.addEventListener("click", async (e) => {
        e.stopPropagation();
        await actualizarEstadoOrden(o.id, "cancelada");
        cargar();
      });
      celdaAcciones.appendChild(btnRecibida);
      celdaAcciones.appendChild(btnCancelar);
    }
    tablaBody.appendChild(tr);
  });
}

cargar();
