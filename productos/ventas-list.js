import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarVentas } from "/js/ventas.js";
import { listarCobros } from "/js/cobros.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "ventas", titulo: "Ventas", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/productos/venta-nueva.html"><button class="primary">+ Nueva venta</button></a>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Nº</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Vendedor</th>
            <th>Medio de pago</th>
            <th>Entrega</th>
            <th>Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no registraste ninguna venta.</div>
  </div>
`;

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

function medioResumen(pagos) {
  if (!pagos || pagos.length === 0) return "-";
  if (pagos.length === 1) return pagos[0].medio;
  return "Varios medios";
}

// El estado se recalcula con los cobros reales (no con venta.montoPendiente, que queda congelado
// al momento de la venta y no se entera de los cobros que se registren después).
function entregaBadge(venta) {
  const tipo = venta.tipoEntrega || "Retira ahora";
  if (tipo === "Retira ahora") return tipo;
  const pendiente = venta.estadoEntrega !== "entregado";
  return `${tipo} ${pendiente ? '<span class="badge warning">Pendiente</span>' : '<span class="badge success">Entregado</span>'}`;
}

function estadoBadge(saldo, total) {
  if (saldo <= 0.01) return '<span class="badge success">Cobrada</span>';
  if (saldo < total - 0.01) return '<span class="badge warning">Parcial</span>';
  return '<span class="badge muted">Pendiente</span>';
}

async function cargar() {
  const ventas = await listarVentas();
  emptyState.style.display = ventas.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";

  // Solo hace falta traer cobros para las ventas que arrancaron con algo pendiente — el resto ya
  // se sabe "Cobrada" sin consultar nada más.
  const cobros = ventas.some((v) => (v.montoPendiente || 0) > 0.01) ? await listarCobros(500) : [];

  ventas.forEach((v) => {
    const cobrado = cobros.filter((c) => c.ventaId === v.id).reduce((acc, c) => acc + (c.monto || 0), 0);
    const saldo = (v.montoPendiente || 0) > 0.01 ? Math.round(((v.total || 0) - cobrado) * 100) / 100 : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.numeroVenta ?? ""}</td>
      <td>${formatFecha(v.fecha)}</td>
      <td>${v.clienteNombre || "Consumidor final"}</td>
      <td>${v.vendedorNombre || ""}</td>
      <td>${medioResumen(v.pagos)}</td>
      <td>${entregaBadge(v)}</td>
      <td>$${(v.total ?? 0).toLocaleString("es-AR")}</td>
      <td>${estadoBadge(saldo, v.total || 0)}</td>
    `;
    tablaBody.appendChild(tr);
  });
}

cargar();
