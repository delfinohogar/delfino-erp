import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { initProveedorPicker } from "/js/proveedor-picker.js";
import { listarComprasPorProveedor } from "/js/compras.js";
import { listarPagosPorProveedor, crearPago, MEDIOS_PAGO } from "/js/pagos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "pagos", titulo: "Registrar pago", usuario });

content.innerHTML = `
  <form id="form-pago">
    <div class="card" style="padding:20px; margin-bottom:16px; max-width:420px">
      <label>Proveedor *</label>
      <div id="proveedor-picker"></div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Facturas</div>
      <div id="sin-proveedor" class="hint">Elegí un proveedor para ver sus facturas.</div>
      <div class="table-scroll">
        <table id="tabla-facturas" style="display:none">
          <thead>
            <tr>
              <th></th>
              <th>Fecha</th>
              <th>Comprobante</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Estado</th>
              <th>Monto a pagar</th>
            </tr>
          </thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
      <div class="section-title">Datos del pago</div>
      <div class="hint" style="margin-bottom:8px">Se aplican a todas las facturas que marques arriba.</div>
      <div class="field-row">
        <div class="field">
          <label for="medio-pago">Medio de pago</label>
          <select id="medio-pago">
            ${MEDIOS_PAGO.map((m) => `<option>${m}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="fecha-pago">Fecha *</label>
          <input type="date" id="fecha-pago" required />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="referencia">Referencia</label>
          <input type="text" id="referencia" placeholder="Ej. N° de operación" />
        </div>
        <div class="field">
          <label for="notas">Notas</label>
          <input type="text" id="notas" />
        </div>
      </div>
      <div class="hint" id="total-hint" style="font-size:14px; font-weight:600; color:var(--foreground)"></div>
    </div>

    <div class="toolbar">
      <button type="submit" class="primary" id="submit-btn">Registrar pago</button>
      <a href="/productos/pagos.html"><button type="button">Cancelar</button></a>
      <span class="error-text" id="form-error" style="display:none"></span>
    </div>
  </form>
`;

document.getElementById("fecha-pago").value = new Date().toISOString().slice(0, 10);

const sinProveedor = document.getElementById("sin-proveedor");
const tablaFacturas = document.getElementById("tabla-facturas");
const tablaBody = document.getElementById("tabla-body");
const totalHint = document.getElementById("total-hint");

let proveedorSeleccionado = null;
let facturas = [];

function estadoBadge(saldo, total) {
  if (saldo <= 0.01) return '<span class="badge success">Pagada</span>';
  if (saldo < total - 0.01) return '<span class="badge warning">Parcial</span>';
  return '<span class="badge muted">Pendiente</span>';
}

function recalcularTotal() {
  let total = 0;
  tablaBody.querySelectorAll("tr").forEach((tr) => {
    const check = tr.querySelector("[data-role=check]");
    const monto = parseFloat(tr.querySelector("[data-role=monto]").value) || 0;
    if (check.checked) total += monto;
  });
  totalHint.textContent = `Total a pagar: $${total.toLocaleString("es-AR")}`;
}

function pintarFacturas() {
  tablaBody.innerHTML = "";
  facturas.forEach((f) => {
    const tr = document.createElement("tr");
    const sinSaldo = f.saldo <= 0.01;
    tr.innerHTML = `
      <td><input type="checkbox" data-role="check" ${sinSaldo ? "disabled" : ""} /></td>
      <td>${f.fecha?.toDate ? f.fecha.toDate().toLocaleDateString("es-AR") : "-"}</td>
      <td>${f.tipoComprobante || ""} ${f.numeroFactura || ""}</td>
      <td>${f.total.toLocaleString("es-AR")}</td>
      <td>${f.pagado.toLocaleString("es-AR")}</td>
      <td>${f.saldo.toLocaleString("es-AR")}</td>
      <td>${estadoBadge(f.saldo, f.total)}</td>
      <td><input type="number" data-role="monto" step="0.01" min="0" max="${f.saldo}" value="${f.saldo}" style="max-width:120px" disabled /></td>
    `;
    const check = tr.querySelector("[data-role=check]");
    const monto = tr.querySelector("[data-role=monto]");
    check.addEventListener("change", () => {
      monto.disabled = !check.checked;
      if (check.checked) monto.value = f.saldo;
      recalcularTotal();
    });
    monto.addEventListener("input", recalcularTotal);
    tablaBody.appendChild(tr);
  });
  recalcularTotal();
}

async function cargarFacturas(proveedor) {
  sinProveedor.style.display = "none";
  tablaFacturas.style.display = "table";
  tablaBody.innerHTML = `<tr><td colspan="8" class="hint">Cargando…</td></tr>`;

  const [compras, pagos] = await Promise.all([
    listarComprasPorProveedor(proveedor.id),
    listarPagosPorProveedor(proveedor.id),
  ]);

  facturas = compras
    .map((c) => {
      const pagado = pagos.filter((p) => p.compraId === c.id).reduce((acc, p) => acc + (p.monto || 0), 0);
      return { ...c, pagado, saldo: Math.round(((c.total || 0) - pagado) * 100) / 100 };
    })
    .sort((a, b) => (a.fecha?.toDate?.() || 0) - (b.fecha?.toDate?.() || 0));

  pintarFacturas();
}

initProveedorPicker(document.getElementById("proveedor-picker"), {
  onSelect: (proveedor) => {
    proveedorSeleccionado = proveedor;
    if (proveedor) cargarFacturas(proveedor);
  },
});

document.getElementById("form-pago").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  errorEl.style.display = "none";

  if (!proveedorSeleccionado) {
    errorEl.textContent = "Elegí un proveedor.";
    errorEl.style.display = "block";
    return;
  }

  const seleccionadas = [];
  const filas = tablaBody.querySelectorAll("tr");
  for (let i = 0; i < filas.length; i++) {
    const tr = filas[i];
    const check = tr.querySelector("[data-role=check]");
    if (!check || !check.checked) continue;
    const monto = parseFloat(tr.querySelector("[data-role=monto]").value) || 0;
    const factura = facturas[i];
    if (monto <= 0) continue;
    if (monto > factura.saldo + 0.01) {
      errorEl.textContent = `El monto de ${factura.tipoComprobante || ""} ${factura.numeroFactura || ""} no puede superar el saldo (${factura.saldo.toLocaleString("es-AR")}).`;
      errorEl.style.display = "block";
      return;
    }
    seleccionadas.push({ factura, monto });
  }

  if (seleccionadas.length === 0) {
    errorEl.textContent = "Marcá al menos una factura con un monto mayor a cero.";
    errorEl.style.display = "block";
    return;
  }

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;

  const datosComunes = {
    fecha: new Date(document.getElementById("fecha-pago").value),
    medioPago: document.getElementById("medio-pago").value,
    referencia: document.getElementById("referencia").value.trim(),
    notas: document.getElementById("notas").value.trim(),
  };

  try {
    for (const { factura, monto } of seleccionadas) {
      await crearPago(
        {
          ...datosComunes,
          proveedorId: proveedorSeleccionado.id,
          proveedorNombre: proveedorSeleccionado.razonSocial,
          compraId: factura.id,
          compraNumero: `${factura.tipoComprobante || ""} ${factura.numeroFactura || ""}`.trim(),
          monto,
        },
        usuario
      );
    }
    location.href = "/productos/pagos.html";
  } catch (err) {
    errorEl.textContent = "Ocurrió un error al guardar. " + (err?.message || "");
    errorEl.style.display = "block";
    submitBtn.disabled = false;
  }
});
