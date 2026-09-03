import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCompras } from "/js/compras.js";
import { listarPagos } from "/js/pagos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "compras", titulo: "Compras", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/productos/compras-nueva.html"><button class="primary">+ Nueva compra</button></a>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Proveedor</th>
            <th>Comprobante</th>
            <th>Ítems</th>
            <th>Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no cargaste ninguna compra.</div>
  </div>
`;

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

function estadoBadge(total, pagado) {
  if (pagado >= total - 0.01) return '<span class="badge success">Pagada</span>';
  if (pagado > 0) return '<span class="badge warning">Parcial</span>';
  return '<span class="badge muted">Pendiente</span>';
}

async function cargar() {
  const [compras, pagos] = await Promise.all([listarCompras(), listarPagos()]);
  emptyState.style.display = compras.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";
  compras.forEach((c) => {
    const pagado = pagos.filter((p) => p.compraId === c.id).reduce((acc, p) => acc + (p.monto || 0), 0);
    // El estado se compara contra lo que realmente hay que pagarle al proveedor (total menos
    // retenciones) — contra el bruto, una compra con retenciones nunca llegaba a "Pagada".
    const netoAPagar = c.netoAPagarProveedor ?? c.total ?? 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatFecha(c.fecha)}</td>
      <td>${c.proveedorNombre || ""}</td>
      <td>${c.tipoComprobante || ""} ${c.numeroFactura || ""}</td>
      <td>${(c.items || []).length}</td>
      <td>${(c.total ?? 0).toLocaleString("es-AR")}${c.montoRetenciones ? ` <span class="hint">(neto ${netoAPagar.toLocaleString("es-AR")})</span>` : ""}</td>
      <td>${estadoBadge(netoAPagar, pagado)}</td>
    `;
    tablaBody.appendChild(tr);
  });
}

cargar();
