import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarVentas } from "/js/ventas.js";
import { listarCobrosPorVentas } from "/js/cobros.js";
import { listarComprobantes } from "/js/facturacion.js";
import { listarEntregas } from "/js/entregas.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "ventas", titulo: "Ventas", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/productos/venta-nueva.html"><button class="primary">+ Nueva venta</button></a>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
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
            <th></th>
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

// El estado real de la entrega sale de /entregas (ver js/entregas.js), no de la venta — es lo único
// de esta fila que sigue cambiando después de vender.
function entregaBadge(venta, entregasPorVenta) {
  const tipo = venta.tipoEntrega || "Retira ahora";
  if (tipo === "Retira ahora") return tipo;
  const pendiente = entregasPorVenta.get(venta.id)?.estado !== "entregado";
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
  // se sabe "Cobrada" sin consultar nada más. Antes esto era "los últimos 500 cobros del sistema"
  // (listarCobros(500)): una venta vieja con saldo pendiente cuyo cobro real ya no entraba en esos
  // 500 se mostraba "Pendiente" aunque estuviera saldada. Ahora se piden los cobros de esas ventas
  // puntuales, sin límite fijo.
  const ventasConPendiente = ventas.filter((v) => (v.montoPendiente || 0) > 0.01);
  const cobros = ventasConPendiente.length > 0 ? await listarCobrosPorVentas(ventasConPendiente.map((v) => v.id)) : [];
  // Desde que la venta genera el comprobante automáticamente casi todas lo van a tener — esto solo
  // hace falta para ofrecer "Generar" en ventas viejas, de antes de ese cambio.
  const comprobantes = await listarComprobantes({ maxResultados: 500 });
  const comprobantePorVenta = new Map(comprobantes.filter((c) => c.ventaId).map((c) => [c.ventaId, c]));
  const entregasPorVenta = new Map((await listarEntregas()).map((e) => [e.ventaId, e]));

  ventas.forEach((v) => {
    const cobrado = cobros.filter((c) => c.ventaId === v.id).reduce((acc, c) => acc + (c.monto || 0), 0);
    const saldo = (v.montoPendiente || 0) > 0.01 ? Math.round(((v.total || 0) - cobrado) * 100) / 100 : 0;
    const tr = document.createElement("tr");
    tr.title = "Ver ficha de la venta";
    tr.innerHTML = `
      <td>${v.numeroVenta ?? ""}</td>
      <td>${formatFecha(v.fecha)}</td>
      <td>${escapeHtml(v.clienteNombre || "Consumidor final")}</td>
      <td>${escapeHtml(v.vendedorNombre || "")}</td>
      <td>${medioResumen(v.pagos)}</td>
      <td>${entregaBadge(v, entregasPorVenta)}</td>
      <td>$${(v.total ?? 0).toLocaleString("es-AR")}</td>
      <td>${estadoBadge(saldo, v.total || 0)}</td>
      <td>${
        comprobantePorVenta.has(v.id)
          ? `<a href="/facturacion/ficha.html?id=${comprobantePorVenta.get(v.id).id}"><button type="button" title="Ver comprobante">🧾 Ver</button></a>`
          : `<a href="/facturacion/nuevo.html?ventaId=${v.id}"><button type="button" title="Generar comprobante">🧾 Generar</button></a>`
      }</td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      location.href = `/productos/venta-ficha.html?id=${v.id}`;
    });
    tablaBody.appendChild(tr);
  });
}

cargar();
