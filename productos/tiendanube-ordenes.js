// Órdenes recibidas de Tienda Nube — solo lectura del pedido en sí (llega por webhook, ver
// functions/tiendanube.js). "Procesar" (generar la venta/factura en Delfino) todavía no está
// conectado a propósito — ver docs/tiendanube-integracion.md.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarOrdenesTiendaNube } from "/js/tiendanube-sync.js";
import { formatMoneda, formatFechaHora } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tiendanube-ordenes", titulo: "Órdenes — Tienda Nube", usuario });

const BADGE_ESTADO_PAGO = {
  aprobado: '<span class="badge success">Pagado</span>',
  pendiente: '<span class="badge warning">Pendiente</span>',
  rechazado: '<span class="badge danger">Rechazado</span>',
  reembolsado: '<span class="badge muted">Reembolsado</span>',
};

const BADGE_ESTADO = {
  recibida: '<span class="badge warning">Recibida</span>',
  procesada: '<span class="badge success">Procesada</span>',
  error: '<span class="badge danger">Error</span>',
};

content.innerHTML = `<div class="hint">Cargando…</div>`;

async function cargar() {
  const ordenes = await listarOrdenesTiendaNube(100);

  content.innerHTML = `
    <div class="hint" style="margin-bottom:16px; max-width:64ch">
      Pedidos de <a href="https://www.tiendadelfino.com.ar" target="_blank" rel="noopener">tiendadelfino.com.ar</a>
      recibidos automáticamente por webhook. Todavía no generan la venta/factura en Delfino solos —
      eso es un paso siguiente, a propósito (ver Configuración → Integraciones).
    </div>
    <div class="card">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Orden</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Ítems</th>
              <th>Total</th>
              <th>Pago</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
      <div id="empty-state" class="empty-state" style="display:${ordenes.length === 0 ? "block" : "none"}">
        Todavía no llegó ninguna orden.
      </div>
    </div>
  `;

  const tablaBody = document.getElementById("tabla-body");
  ordenes.forEach((orden) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>#${orden.numeroOrden ?? orden.idExterno}</td>
      <td>${formatFechaHora(orden.fecha)}</td>
      <td>${orden.cliente?.nombre || "-"}<div class="hint">${orden.cliente?.email || ""}</div></td>
      <td>${(orden.items || []).map((i) => `${i.cantidad}× ${i.nombre || i.sku}`).join("<br>")}</td>
      <td>${formatMoneda(orden.total)}</td>
      <td>${BADGE_ESTADO_PAGO[orden.estadoPago] || orden.estadoPago}</td>
      <td>${BADGE_ESTADO[orden.estado] || orden.estado}${orden.error ? `<div class="hint" style="color:var(--danger)">${orden.error}</div>` : ""}</td>
    `;
    tablaBody.appendChild(tr);
  });
}

cargar();
