// Snapshot rápido del cliente durante una venta: saldo y últimas compras sin cortar el flujo para
// ir a Configuración → Clientes. Mismo cálculo que la ficha completa (ver js/cuenta-corriente.js),
// mismo patrón de overlay que cliente-modal.js.
import { calcularCuentaCorriente } from "./cuenta-corriente.js";
import { formatMoneda as formatMonto } from "./formato.js";

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

export async function mostrarDetalleCliente(cliente) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:480px">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px">
        <div>
          <div style="font-size:17px; font-weight:600">${cliente.razonSocial}</div>
          <div class="hint mt-0">${cliente.cuit ? `CUIT/DNI ${cliente.cuit}` : "Sin CUIT/DNI cargado"}</div>
        </div>
        <a href="/configuracion/cliente-ficha.html?id=${cliente.id}" target="_blank" rel="noopener" class="link-btn">Ficha completa ↗</a>
      </div>
      <div id="cd-stats" class="dashboard-grid mb-16"><div class="hint">Cargando…</div></div>
      <div id="cd-ventas"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const { movimientos, totalFacturado, saldoPendiente, cantidadPedidos } = await calcularCuentaCorriente(cliente.id);

  document.getElementById("cd-stats").innerHTML = `
    <div><div class="hint mt-0">Pedidos</div><div style="font-weight:600">${cantidadPedidos}</div></div>
    <div><div class="hint mt-0">Ventas totales</div><div style="font-weight:600">${formatMonto(totalFacturado)}</div></div>
    <div><div class="hint mt-0">Saldo pendiente</div><div style="font-weight:700; color:${saldoPendiente > 0.01 ? "var(--danger)" : "var(--success)"}">${formatMonto(saldoPendiente)}</div></div>
  `;

  const ventasRecientes = movimientos
    .filter((m) => m.tipo === "Factura")
    .slice(-5)
    .reverse();

  document.getElementById("cd-ventas").innerHTML =
    ventasRecientes.length === 0
      ? `<div class="hint">Todavía no le vendiste nada a este cliente.</div>`
      : `
    <div class="section-title" style="border:none; padding:0; margin-bottom:8px">Últimas ventas</div>
    ${ventasRecientes
      .map(
        (v) => `
      <a href="/productos/venta-ficha.html?id=${v.ventaId}" target="_blank" rel="noopener" class="stack-row" style="justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border); text-decoration:none; color:inherit">
        <span class="hint mt-0">${formatFecha(v.fecha)} · Venta #${v.numeroVenta ?? ""}${v.items?.[0] ? ` — ${v.items[0].productoDescripcion}${v.items.length > 1 ? ` +${v.items.length - 1}` : ""}` : ""}</span>
        <strong>${formatMonto(v.debe)}</strong>
      </a>
    `
      )
      .join("")}
  `;

  // "Ficha completa" abre en pestaña nueva (target=_blank) — no hace falta cerrar el modal para eso.
  return new Promise((resolve) => {
    function cerrar() {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve();
    }
    function onKeydown(e) {
      if (e.key === "Escape") cerrar();
    }
    overlay.addEventListener("click", (e) => e.target === overlay && cerrar());
    document.addEventListener("keydown", onKeydown);
  });
}
