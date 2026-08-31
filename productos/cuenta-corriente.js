import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { initProveedorPicker } from "/js/proveedor-picker.js";
import { obtenerProveedor } from "/js/catalogo.js";
import { listarComprasPorProveedor } from "/js/compras.js";
import { listarPagosPorProveedor } from "/js/pagos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "cuenta-corriente", titulo: "Cuenta corriente", usuario });

content.innerHTML = `
  <div class="card" style="padding:20px; margin-bottom:16px; max-width:420px">
    <label>Proveedor</label>
    <div id="proveedor-picker"></div>
  </div>
  <div id="sin-proveedor" class="card empty-state">Elegí un proveedor para ver su cuenta corriente.</div>
  <div id="resultado" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center">
      <span class="section-title" style="border:none; margin:0; padding:0">Saldo adeudado</span>
      <span id="saldo-total" style="font-size:20px; font-weight:600"></span>
    </div>
    <div class="card">
      <div class="table-scroll">
        <table>
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
      <div id="empty-state" class="empty-state" style="display:none">Este proveedor todavía no tiene compras ni pagos registrados.</div>
    </div>
  </div>
`;

const sinProveedor = document.getElementById("sin-proveedor");
const resultado = document.getElementById("resultado");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
const saldoTotalEl = document.getElementById("saldo-total");

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

function fechaOrden(fecha) {
  if (!fecha) return 0;
  return fecha.toDate ? fecha.toDate().getTime() : new Date(fecha).getTime();
}

async function cargarCuenta(proveedor) {
  sinProveedor.style.display = "none";
  resultado.style.display = "block";
  tablaBody.innerHTML = `<tr><td colspan="5" class="hint">Cargando…</td></tr>`;

  const [compras, pagos] = await Promise.all([
    listarComprasPorProveedor(proveedor.id),
    listarPagosPorProveedor(proveedor.id),
  ]);

  const movimientos = [
    ...compras.map((c) => ({
      fecha: c.fecha,
      detalle: `Compra — ${c.tipoComprobante || ""} ${c.numeroFactura || ""}`,
      debe: c.total || 0,
      haber: 0,
    })),
    ...pagos.map((p) => ({
      fecha: p.fecha,
      detalle: `Pago (${p.medioPago || "-"}) — factura ${p.compraNumero || ""}`,
      debe: 0,
      haber: p.monto || 0,
    })),
  ].sort((a, b) => fechaOrden(a.fecha) - fechaOrden(b.fecha));

  tablaBody.innerHTML = "";
  emptyState.style.display = movimientos.length === 0 ? "block" : "none";

  let saldo = 0;
  movimientos.forEach((m) => {
    saldo += m.debe - m.haber;
    const tr = document.createElement("tr");
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

const proveedorPicker = initProveedorPicker(document.getElementById("proveedor-picker"), {
  onSelect: (proveedor) => {
    if (proveedor) cargarCuenta(proveedor);
  },
});

const proveedorIdInicial = new URLSearchParams(location.search).get("proveedorId");
if (proveedorIdInicial) {
  const proveedor = await obtenerProveedor(proveedorIdInicial);
  if (proveedor) proveedorPicker.seleccionarDirecto(proveedor);
}
