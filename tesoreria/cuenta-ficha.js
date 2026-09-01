import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerCuentaBancaria, listarMovimientosPorCuenta, saldoCuenta, registrarMovimientoBancario, conciliarMovimientoBancario } from "/js/bancos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const cuentaId = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "tesoreria-bancos", titulo: "Cuenta bancaria", usuario });

if (!cuentaId) {
  content.innerHTML = `<div class="empty-state">Falta la cuenta.</div>`;
  throw new Error("falta id de cuenta");
}
const cuenta = await obtenerCuentaBancaria(cuentaId);
if (!cuenta) {
  content.innerHTML = `<div class="empty-state">No se encontró esa cuenta. <a href="/tesoreria/bancos.html">Volver a Bancos</a></div>`;
  throw new Error("cuenta no encontrada");
}

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}

async function pintar() {
  const movimientos = await listarMovimientosPorCuenta(cuentaId);
  const saldo = saldoCuenta(movimientos);
  const pendientes = movimientos.filter((m) => m.estado === "pendiente").length;

  content.innerHTML = `
    <div class="toolbar">
      <a href="/tesoreria/bancos.html" class="link-btn">← Bancos</a>
      <button type="button" id="btn-movimiento">+ Registrar movimiento</button>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px">
      <div style="font-size:20px; font-weight:700">${cuenta.bancoNombre} — ${cuenta.nombre}</div>
      <div class="hint">${cuenta.alias || ""} ${cuenta.cbu ? `· CBU ${cuenta.cbu}` : ""} ${cuenta.sucursalNombre ? `· ${cuenta.sucursalNombre}` : ""}</div>
      <div style="font-size:26px; font-weight:700; margin-top:12px">${formatMonto(saldo)}</div>
      ${pendientes > 0 ? `<div class="hint" style="color:var(--warning)">${pendientes} movimiento(s) sin conciliar</div>` : ""}
    </div>

    <div class="card">
      <div class="table-scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th style="text-align:right">Importe</th><th>Estado</th><th></th></tr></thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
      <div id="empty-state" class="empty-state" style="display:none">Todavía no hay movimientos.</div>
    </div>
  `;

  const tbody = document.getElementById("tabla-body");
  document.getElementById("empty-state").style.display = movimientos.length === 0 ? "block" : "none";
  tbody.innerHTML = movimientos
    .slice()
    .reverse()
    .map(
      (m) => `
    <tr style="${m.estado === "anulado" ? "opacity:0.5; text-decoration:line-through" : ""}">
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.tipo === "ingreso" ? "🟢" : "🔴"} ${m.concepto}${m.ventaId ? ` · <a href="/productos/venta-ficha.html?id=${m.ventaId}">Ver venta</a>` : ""}</td>
      <td>${m.referencia || "-"}</td>
      <td style="text-align:right">${m.tipo === "ingreso" ? "" : "-"}${formatMonto(m.importe)}</td>
      <td>${m.estado === "conciliado" ? '<span class="badge success">Conciliado</span>' : m.estado === "anulado" ? '<span class="badge danger">Anulado</span>' : '<span class="badge warning">Pendiente</span>'}</td>
      <td>${m.estado === "pendiente" ? `<button type="button" data-conciliar="${m.id}">✅ Conciliar</button>` : ""}</td>
    </tr>
  `
    )
    .join("");

  tbody.querySelectorAll("[data-conciliar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await conciliarMovimientoBancario(btn.dataset.conciliar, usuario);
      pintar();
    });
  });

  document.getElementById("btn-movimiento").addEventListener("click", () => abrirModalMovimiento());
}

function abrirModalMovimiento() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Registrar movimiento bancario</div>
      <form id="form-mov">
        <div class="field">
          <label for="m-tipo">Tipo</label>
          <select id="m-tipo"><option value="ingreso">🟢 Ingreso</option><option value="egreso">🔴 Egreso</option></select>
        </div>
        <div class="field">
          <label for="m-concepto">Concepto</label>
          <input type="text" id="m-concepto" placeholder="Ej. Depósito, comisión, débito automático…" required />
        </div>
        <div class="field-row">
          <div class="field"><label for="m-importe">Importe</label><input type="number" id="m-importe" min="0.01" step="0.01" required /></div>
          <div class="field"><label for="m-fecha">Fecha</label><input type="date" id="m-fecha" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        </div>
        <div class="field">
          <label for="m-referencia">Referencia (opcional)</label>
          <input type="text" id="m-referencia" />
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Registrar</button>
          <button type="button" id="m-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#m-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-mov").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimientoBancario(
        {
          cuentaId,
          tipo: overlay.querySelector("#m-tipo").value,
          concepto: overlay.querySelector("#m-concepto").value.trim(),
          importe: parseFloat(overlay.querySelector("#m-importe").value),
          fecha: overlay.querySelector("#m-fecha").value,
          referencia: overlay.querySelector("#m-referencia").value.trim(),
        },
        usuario
      );
      overlay.remove();
      pintar();
    } catch (err) {
      alert(err?.message || "No se pudo registrar el movimiento.");
    }
  });
}

pintar();
