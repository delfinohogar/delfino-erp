import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { initClientePicker } from "/js/cliente-picker.js";
import { listarVentasPorCliente } from "/js/ventas.js";
import { listarCobrosPorCliente } from "/js/cobros.js";
import { listarFacturasGbpPorCliente } from "/js/gbp-facturas.js";
import { descargarPdfFacturaGbp } from "/js/facturas-gbp-pdf.js";
import { mostrarDetalleFacturaGbp } from "/js/factura-gbp-detalle-modal.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { formatMoneda } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "cuenta-corriente-clientes", titulo: "Cuenta corriente de clientes", usuario });

content.innerHTML = `
  <div class="card" style="padding:20px; margin-bottom:16px; max-width:420px">
    <label>Cliente</label>
    <div id="cliente-picker"></div>
  </div>
  <div id="sin-cliente" class="card empty-state">Elegí un cliente para ver su cuenta corriente.</div>
  <div id="resultado" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center">
      <span class="section-title" style="border:none; margin:0; padding:0">Saldo a cobrar</span>
      <span id="saldo-total" style="font-size:20px; font-weight:600"></span>
    </div>
    <div class="card mb-16">
      <div class="table-scroll">
        <table class="table-clickable">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Movimiento</th>
              <th>Debe</th>
              <th>Haber</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
      <div id="empty-state" class="empty-state" style="display:none">Este cliente todavía no tiene ventas ni cobros registrados.</div>
    </div>

    <div id="card-gbp" class="card" style="display:none">
      <div class="section-title">Historial de compras — GBP</div>
      <div class="hint" style="margin-bottom:12px; max-width:64ch">
        Facturas emitidas en GBP, ya cobradas — es solo referencia histórica, no suma al saldo de arriba.
      </div>
      <div class="table-scroll">
        <table class="table-clickable">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Comprobante</th>
              <th>Total</th>
              <th>CAE</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tabla-gbp-body"></tbody>
        </table>
      </div>
    </div>
  </div>
`;

const sinCliente = document.getElementById("sin-cliente");
const resultado = document.getElementById("resultado");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
const saldoTotalEl = document.getElementById("saldo-total");
const cardGbp = document.getElementById("card-gbp");
const tablaGbpBody = document.getElementById("tabla-gbp-body");
const configEmpresa = await obtenerConfigEmpresa();

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

function fechaOrden(fecha) {
  if (!fecha) return 0;
  return fecha.toDate ? fecha.toDate().getTime() : new Date(fecha).getTime();
}

async function cargarCuenta(cliente) {
  sinCliente.style.display = "none";
  resultado.style.display = "block";
  tablaBody.innerHTML = `<tr><td colspan="5" class="hint">Cargando…</td></tr>`;

  const [ventas, cobros] = await Promise.all([listarVentasPorCliente(cliente.id), listarCobrosPorCliente(cliente.id)]);

  const movimientos = [
    ...ventas.map((v) => ({
      fecha: v.fecha,
      detalle: `Venta #${v.numeroVenta ?? ""}`,
      debe: v.total || 0,
      haber: 0,
      ventaId: v.id,
    })),
    ...cobros.map((c) => ({
      fecha: c.fecha,
      detalle: `Cobro (${c.medioPago || "-"}) — venta #${c.numeroVenta ?? ""}`,
      debe: 0,
      haber: c.monto || 0,
      ventaId: c.ventaId,
    })),
  ].sort((a, b) => fechaOrden(a.fecha) - fechaOrden(b.fecha));

  tablaBody.innerHTML = "";
  emptyState.style.display = movimientos.length === 0 ? "block" : "none";

  let saldo = 0;
  movimientos.forEach((m) => {
    saldo += m.debe - m.haber;
    const tr = document.createElement("tr");
    if (m.ventaId) {
      tr.title = "Ver ficha de la venta";
      tr.addEventListener("click", () => (location.href = `/productos/venta-ficha.html?id=${m.ventaId}`));
    }
    tr.innerHTML = `
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.detalle}</td>
      <td>${m.debe ? m.debe.toLocaleString("es-AR") : ""}</td>
      <td>${m.haber ? m.haber.toLocaleString("es-AR") : ""}</td>
      <td>${saldo.toLocaleString("es-AR")}</td>
    `;
    tablaBody.appendChild(tr);
  });

  saldoTotalEl.textContent = `$${saldo.toLocaleString("es-AR")}`;
  saldoTotalEl.style.color = saldo > 0 ? "var(--danger)" : "var(--success)";
}

function comprobanteTexto(f) {
  const numeroFmt = String(f.numero ?? "").padStart(8, "0");
  return `${f.letra || ""} ${String(f.puntoVenta ?? "").padStart(4, "0")}-${numeroFmt}`.trim();
}

async function cargarHistorialGbp(cliente) {
  const facturas = await listarFacturasGbpPorCliente(cliente.id);
  cardGbp.style.display = facturas.length === 0 ? "none" : "block";
  if (facturas.length === 0) return;

  tablaGbpBody.innerHTML = "";
  facturas.forEach((f) => {
    const tr = document.createElement("tr");
    tr.title = "Ver qué artículos incluye";
    tr.innerHTML = `
      <td>${formatFecha(f.fecha)}</td>
      <td>${comprobanteTexto(f)}${f.anulada ? ' <span class="hint" style="color:var(--danger)">Anulada</span>' : ""}</td>
      <td>${formatMoneda(f.total)}</td>
      <td>${f.cae || "-"}</td>
      <td><button type="button" data-role="pdf">📄 PDF</button></td>
    `;
    tr.addEventListener("click", () => mostrarDetalleFacturaGbp(f, configEmpresa, cliente));
    tr.querySelector("[data-role=pdf]").addEventListener("click", (e) => {
      e.stopPropagation();
      descargarPdfFacturaGbp(f, configEmpresa, cliente);
    });
    tablaGbpBody.appendChild(tr);
  });
}

initClientePicker(document.getElementById("cliente-picker"), {
  onSelect: (cliente) => {
    if (!cliente) return;
    cargarCuenta(cliente);
    cardGbp.style.display = "none";
    cargarHistorialGbp(cliente);
  },
});
