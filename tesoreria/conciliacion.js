// Conciliación bancaria: no hay una integración real de extracto bancario (ningún banco argentino
// expone eso vía API pública abierta para una pyme) — así que esto es conciliación MANUAL, como pide
// el punto 14 del pedido: se revisa cada movimiento pendiente y se marca conciliado a mano, opcionalmente
// dejando una referencia de con qué se asoció. Nada de "matching automático" inventado.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCuentasBancarias, listarMovimientosPorCuenta, conciliarMovimientoBancario } from "/js/bancos.js";
import { formatMoneda as formatMonto } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-conciliacion", titulo: "Conciliación bancaria", usuario });

function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}

const cuentas = await listarCuentasBancarias();

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
  </div>
  <div class="hint" style="margin-bottom:12px; max-width:70ch">
    Sin un extracto bancario importado no hay con qué comparar automáticamente — esta pantalla lista
    los movimientos que el propio ERP generó (ventas, gastos, transferencias) y todavía no se marcaron
    como conciliados contra el resumen real del banco.
  </div>
  ${
    cuentas.length === 0
      ? `<div class="empty-state">Todavía no hay cuentas bancarias cargadas. <a href="/tesoreria/bancos.html">Crear una</a></div>`
      : `
    <div class="card mb-16">
      <div class="field">
        <label for="f-cuenta">Cuenta</label>
        <select id="f-cuenta">${cuentas.map((c) => `<option value="${c.id}">${c.bancoNombre} — ${c.nombre}</option>`).join("")}</select>
      </div>
    </div>
    <div class="card">
      <div class="table-scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th class="num">Importe</th><th>Estado</th><th></th></tr></thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
      <div id="empty-state" class="empty-state" style="display:none">Esta cuenta no tiene movimientos pendientes de conciliar.</div>
    </div>
  `
  }
`;

if (cuentas.length === 0) throw new Error("sin cuentas bancarias");

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const cuentaId = document.getElementById("f-cuenta").value;
  const movimientos = (await listarMovimientosPorCuenta(cuentaId)).filter((m) => m.estado !== "anulado");
  const pendientes = movimientos.filter((m) => m.estado === "pendiente");
  emptyState.style.display = pendientes.length === 0 ? "block" : "none";
  tbody.innerHTML = pendientes
    .map(
      (m) => `
    <tr>
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.tipo === "ingreso" ? "🟢" : "🔴"} ${m.concepto}</td>
      <td><input type="text" data-ref="${m.id}" placeholder="Ej. N° de operación del banco" style="width:160px" /></td>
      <td class="num">${formatMonto(m.importe)}</td>
      <td>🟡 Pendiente</td>
      <td><button type="button" data-conciliar="${m.id}">🟢 Marcar conciliado</button></td>
    </tr>
  `
    )
    .join("");
  tbody.querySelectorAll("[data-conciliar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ref = tbody.querySelector(`[data-ref="${btn.dataset.conciliar}"]`).value.trim();
      await conciliarMovimientoBancario(btn.dataset.conciliar, usuario, ref || null);
      cargar();
    });
  });
}

document.getElementById("f-cuenta").addEventListener("change", cargar);
cargar();
