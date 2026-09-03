// Consulta global: todos los cheques emitidos pendientes (a fecha futura, todavía no efectivizados),
// con el saldo proyectado de cada cuenta bancaria involucrada. El saldo real de Bancos nunca se toca
// acá — esto es "lo que va a pasar si no hago nada más", no un movimiento registrado.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarChequesPendientes, efectivizarCheque, saldoProyectado } from "/js/cheques.js";
import { saldoActualCuenta } from "/js/bancos.js";
import { formatMoneda as formatMonto, formatFecha } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-cheques-futuro", titulo: "Cheques a futuro", usuario });

function diasHasta(fecha) {
  const hoy = new Date().toISOString().slice(0, 10);
  const dias = Math.round((new Date(fecha) - new Date(hoy)) / 86400000);
  if (dias < 0) return `<span class="badge danger">Vencido</span>`;
  if (dias === 0) return `<span class="badge warning">Hoy</span>`;
  return `<span class="hint">en ${dias} día${dias === 1 ? "" : "s"}</span>`;
}

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/bancos.html" class="link-btn">← Bancos</a>
  </div>
  <div id="resumen" class="dashboard-grid" style="margin-bottom:16px"></div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead><tr><th>Fecha de pago</th><th></th><th>Cuenta</th><th>N°</th><th>Beneficiario</th><th>Concepto</th><th class="num">Importe</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No hay cheques pendientes a futuro.</div>
  </div>
`;

const resumenEl = document.getElementById("resumen");
const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const pendientes = await listarChequesPendientes();
  emptyState.style.display = pendientes.length === 0 ? "block" : "none";

  const cuentaIds = [...new Set(pendientes.map((c) => c.cuentaBancariaId))];
  const saldosPorCuenta = {};
  await Promise.all(
    cuentaIds.map(async (id) => {
      const saldoActual = await saldoActualCuenta(id);
      const pendientesCuenta = pendientes.filter((c) => c.cuentaBancariaId === id);
      saldosPorCuenta[id] = { saldoActual, saldoProy: saldoProyectado(saldoActual, pendientesCuenta) };
    })
  );

  resumenEl.innerHTML = cuentaIds
    .map((id) => {
      const cuenta = pendientes.find((c) => c.cuentaBancariaId === id);
      const s = saldosPorCuenta[id];
      return `<div class="card dashboard-card">
        <div class="hint mt-0">${cuenta.bancoNombre} — ${cuenta.cuentaBancariaNombre}</div>
        <div class="dashboard-card-valor">${formatMonto(s.saldoProy)}</div>
        <div class="hint">Saldo actual: ${formatMonto(s.saldoActual)}</div>
      </div>`;
    })
    .join("");

  tbody.innerHTML = pendientes
    .map(
      (c) => `
    <tr>
      <td>${formatFecha(c.fechaPago)}</td>
      <td>${diasHasta(c.fechaPago)}</td>
      <td>${c.bancoNombre} — ${c.cuentaBancariaNombre}</td>
      <td>${c.numeroCheque}</td>
      <td>${c.beneficiario}</td>
      <td>${c.concepto || "-"}</td>
      <td class="num">${formatMonto(c.importe)}</td>
      <td><button type="button" data-efectivizar="${c.id}">✅ Efectivizar</button></td>
    </tr>
  `
    )
    .join("");

  tbody.querySelectorAll("[data-efectivizar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Confirmás que el banco ya debitó este cheque? Se va a registrar el movimiento bancario real.")) return;
      try {
        await efectivizarCheque(btn.dataset.efectivizar, usuario);
        cargar();
      } catch (err) {
        alert(err?.message || "No se pudo efectivizar el cheque.");
      }
    });
  });
}

cargar();
