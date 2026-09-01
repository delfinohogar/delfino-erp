import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { initClientePicker } from "/js/cliente-picker.js";
import { listarVentasPorCliente } from "/js/ventas.js";
import { listarCobrosPorCliente, crearCobro, mediosCobroDisponibles } from "/js/cobros.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const MEDIOS_COBRO = await mediosCobroDisponibles();

const content = renderShell({ active: "cobros", titulo: "Registrar cobro", usuario });

content.innerHTML = `
  <form id="form-cobro">
    <div class="card" style="padding:20px; margin-bottom:16px; max-width:420px">
      <label>Cliente *</label>
      <div id="cliente-picker"></div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Ventas</div>
      <div id="sin-cliente" class="hint">Elegí un cliente para ver sus ventas.</div>
      <div class="table-scroll">
        <table id="tabla-ventas" style="display:none">
          <thead>
            <tr>
              <th></th>
              <th>Fecha</th>
              <th>Venta</th>
              <th>Total</th>
              <th>Cobrado</th>
              <th>Saldo</th>
              <th>Estado</th>
              <th>Monto a cobrar</th>
            </tr>
          </thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
      <div class="section-title">Datos del cobro</div>
      <div class="hint" style="margin-bottom:8px">Se aplican a todas las ventas que marques arriba.</div>
      <div class="field-row">
        <div class="field">
          <label for="medio-cobro">Medio de pago</label>
          <select id="medio-cobro">
            ${MEDIOS_COBRO.map((m) => `<option>${m}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="fecha-cobro">Fecha *</label>
          <input type="date" id="fecha-cobro" required />
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
      <button type="submit" class="primary" id="submit-btn">Registrar cobro</button>
      <a href="/productos/cobros.html"><button type="button">Cancelar</button></a>
      <span class="error-text" id="form-error" style="display:none"></span>
    </div>
  </form>
`;

document.getElementById("fecha-cobro").value = new Date().toISOString().slice(0, 10);

const sinCliente = document.getElementById("sin-cliente");
const tablaVentas = document.getElementById("tabla-ventas");
const tablaBody = document.getElementById("tabla-body");
const totalHint = document.getElementById("total-hint");

let clienteSeleccionado = null;
let ventasConSaldo = [];

function estadoBadge(saldo, total) {
  if (saldo <= 0.01) return '<span class="badge success">Cobrada</span>';
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
  totalHint.textContent = `Total a cobrar: $${total.toLocaleString("es-AR")}`;
}

function pintarVentas() {
  tablaBody.innerHTML = "";
  ventasConSaldo.forEach((v) => {
    const tr = document.createElement("tr");
    const sinSaldo = v.saldo <= 0.01;
    tr.innerHTML = `
      <td><input type="checkbox" data-role="check" ${sinSaldo ? "disabled" : ""} /></td>
      <td>${v.fecha ? new Date(v.fecha).toLocaleDateString("es-AR") : "-"}</td>
      <td>Venta #${v.numeroVenta ?? ""}</td>
      <td>${v.total.toLocaleString("es-AR")}</td>
      <td>${v.cobrado.toLocaleString("es-AR")}</td>
      <td>${v.saldo.toLocaleString("es-AR")}</td>
      <td>${estadoBadge(v.saldo, v.total)}</td>
      <td><input type="number" data-role="monto" step="0.01" min="0" max="${v.saldo}" value="${v.saldo}" style="max-width:120px" disabled /></td>
    `;
    const check = tr.querySelector("[data-role=check]");
    const monto = tr.querySelector("[data-role=monto]");
    check.addEventListener("change", () => {
      monto.disabled = !check.checked;
      if (check.checked) monto.value = v.saldo;
      recalcularTotal();
    });
    monto.addEventListener("input", recalcularTotal);
    tablaBody.appendChild(tr);
  });
  recalcularTotal();
}

async function cargarVentas(cliente) {
  sinCliente.style.display = "none";
  tablaVentas.style.display = "table";
  tablaBody.innerHTML = `<tr><td colspan="8" class="hint">Cargando…</td></tr>`;

  const [ventas, cobros] = await Promise.all([listarVentasPorCliente(cliente.id), listarCobrosPorCliente(cliente.id)]);

  ventasConSaldo = ventas
    .map((v) => {
      const cobrado = cobros.filter((c) => c.ventaId === v.id).reduce((acc, c) => acc + (c.monto || 0), 0);
      return { ...v, cobrado, saldo: Math.round(((v.total || 0) - cobrado) * 100) / 100 };
    })
    .filter((v) => v.saldo > 0.01)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  pintarVentas();
}

initClientePicker(document.getElementById("cliente-picker"), {
  onSelect: (cliente) => {
    clienteSeleccionado = cliente;
    if (cliente) cargarVentas(cliente);
  },
});

document.getElementById("form-cobro").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  errorEl.style.display = "none";

  if (!clienteSeleccionado) {
    errorEl.textContent = "Elegí un cliente.";
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
    const venta = ventasConSaldo[i];
    if (monto <= 0) continue;
    if (monto > venta.saldo + 0.01) {
      errorEl.textContent = `El monto de la Venta #${venta.numeroVenta} no puede superar el saldo (${venta.saldo.toLocaleString("es-AR")}).`;
      errorEl.style.display = "block";
      return;
    }
    seleccionadas.push({ venta, monto });
  }

  if (seleccionadas.length === 0) {
    errorEl.textContent = "Marcá al menos una venta con un monto mayor a cero.";
    errorEl.style.display = "block";
    return;
  }

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;

  const datosComunes = {
    // String "YYYY-MM-DD" tal cual lo da el input date — mismo formato que usan ventas y compras.
    // Mandar un Date acá dejaba el movimiento fuera de los filtros por fecha de Tesorería.
    fecha: document.getElementById("fecha-cobro").value,
    medioPago: document.getElementById("medio-cobro").value,
    referencia: document.getElementById("referencia").value.trim(),
    notas: document.getElementById("notas").value.trim(),
  };

  try {
    const sinUbicar = [];
    for (const { venta, monto } of seleccionadas) {
      const resultado = await crearCobro(
        {
          ...datosComunes,
          clienteId: clienteSeleccionado.id,
          clienteNombre: clienteSeleccionado.razonSocial,
          ventaId: venta.id,
          numeroVenta: venta.numeroVenta,
          monto,
        },
        usuario
      );
      if (!resultado.routeoTesoreria?.ruteado) {
        sinUbicar.push(`Venta #${venta.numeroVenta}: ${resultado.routeoTesoreria?.motivo || "sin motivo"}`);
      }
    }
    // El cobro se registró igual, pero si Tesorería no pudo ubicar la plata hay que decirlo antes de
    // salir de la pantalla — si no, el aviso se pierde (mismo criterio que en Nueva Venta).
    if (sinUbicar.length > 0) {
      alert(`El cobro se registró, pero Tesorería no pudo ubicar la plata:\n\n${sinUbicar.join("\n")}`);
    }
    location.href = "/productos/cobros.html";
  } catch (err) {
    errorEl.textContent = "Ocurrió un error al guardar. " + (err?.message || "");
    errorEl.style.display = "block";
    submitBtn.disabled = false;
  }
});
