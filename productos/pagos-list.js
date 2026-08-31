import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarPagos } from "/js/pagos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "pagos", titulo: "Pagos a proveedores", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/productos/pagos-nueva.html"><button class="primary">+ Registrar pago</button></a>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Proveedor</th>
            <th>Factura</th>
            <th>Medio de pago</th>
            <th>Referencia</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no registraste ningún pago.</div>
  </div>
`;

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

async function cargar() {
  const pagos = await listarPagos();
  emptyState.style.display = pagos.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";
  pagos.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatFecha(p.fecha)}</td>
      <td>${p.proveedorNombre || ""}</td>
      <td>${p.compraNumero || ""}</td>
      <td>${p.medioPago || ""}</td>
      <td>${p.referencia || "-"}</td>
      <td>${(p.monto ?? 0).toLocaleString("es-AR")}</td>
    `;
    tablaBody.appendChild(tr);
  });
}

cargar();
