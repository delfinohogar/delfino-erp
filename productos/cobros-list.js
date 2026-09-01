import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCobros } from "/js/cobros.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "cobros", titulo: "Cobros a clientes", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/productos/cobros-nueva.html"><button class="primary">+ Registrar cobro</button></a>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Venta</th>
            <th>Medio de pago</th>
            <th>Referencia</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no registraste ningún cobro.</div>
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
  const cobros = await listarCobros();
  emptyState.style.display = cobros.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";
  cobros.forEach((c) => {
    const tr = document.createElement("tr");
    if (c.ventaId) {
      tr.title = "Ver comprobante / venta asociada";
      tr.addEventListener("click", () => (location.href = `/productos/venta-ficha.html?id=${c.ventaId}`));
    }
    tr.innerHTML = `
      <td>${formatFecha(c.fecha)}</td>
      <td>${c.clienteNombre || ""}</td>
      <td>Venta #${c.numeroVenta ?? ""}</td>
      <td>${c.medioPago || ""}</td>
      <td>${c.referencia || "-"}</td>
      <td>${(c.monto ?? 0).toLocaleString("es-AR")}</td>
    `;
    tablaBody.appendChild(tr);
  });
}

cargar();
