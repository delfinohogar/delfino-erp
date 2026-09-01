import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import {
  obtenerCaja,
  sesionAbiertaDeCaja,
  abrirCaja,
  cerrarCaja,
  listarMovimientosPorSesion,
  saldoSesion,
  registrarMovimientoCaja,
  listarSesionesPorCaja,
} from "/js/cajas.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const cajaId = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "tesoreria-cajas", titulo: "Caja", usuario });

if (!cajaId) {
  content.innerHTML = `<div class="empty-state">Falta la caja.</div>`;
  throw new Error("falta id de caja");
}

const caja = await obtenerCaja(cajaId);
if (!caja) {
  content.innerHTML = `<div class="empty-state">No se encontró esa caja. <a href="/tesoreria/cajas.html">Volver a Cajas</a></div>`;
  throw new Error("caja no encontrada");
}

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

async function pintar() {
  const sesion = await sesionAbiertaDeCaja(cajaId);
  const movimientos = sesion ? await listarMovimientosPorSesion(sesion.id) : [];
  const saldo = sesion ? saldoSesion(sesion, movimientos) : 0;
  const historial = await listarSesionesPorCaja(cajaId, 10);

  content.innerHTML = `
    <div class="toolbar">
      <a href="/tesoreria/cajas.html" class="link-btn">← Cajas</a>
    </div>

    <div class="card mb-16">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px">
        <div>
          <div style="font-size:20px; font-weight:700">${caja.nombre}</div>
          <div class="hint">${caja.sucursalNombre} · ${caja.tipo}</div>
        </div>
        ${sesion ? '<span class="badge success">Abierta</span>' : '<span class="badge muted">Cerrada</span>'}
      </div>
      ${
        sesion
          ? `
        <div style="font-size:26px; font-weight:700; margin-top:12px">${formatMonto(saldo)}</div>
        <div class="hint">Saldo inicial ${formatMonto(sesion.saldoInicial)} · Abierta ${formatFechaHora(sesion.fechaApertura)} por ${sesion.aperturaPorNombre}</div>
        <div class="toolbar" style="margin-top:12px">
          <button type="button" id="btn-movimiento">+ Registrar movimiento</button>
          <button type="button" id="btn-cerrar" style="color:var(--danger); border-color:var(--danger)">Cerrar caja</button>
        </div>
      `
          : `
        <div class="hint" style="margin:12px 0">La caja está cerrada. Abrila para empezar a registrar movimientos.</div>
        <button type="button" class="primary" id="btn-abrir">Abrir caja</button>
      `
      }
    </div>

    ${
      sesion
        ? `
      <div class="card mb-16">
        <div class="section-title">Movimientos de esta sesión</div>
        ${
          movimientos.length === 0
            ? `<div class="hint">Sin movimientos todavía.</div>`
            : `<div class="table-scroll"><table>
            <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Medio</th><th class="num">Importe</th></tr></thead>
            <tbody>
              ${movimientos
                .sort((a, b) => (b.creadoEn?.toMillis?.() || 0) - (a.creadoEn?.toMillis?.() || 0))
                .map(
                  (m) => `
                <tr style="${m.estado === "anulado" ? "opacity:0.5; text-decoration:line-through" : ""}">
                  <td>${formatFechaHora(m.creadoEn)}</td>
                  <td>${m.tipo === "ingreso" ? "🟢 Ingreso" : "🔴 Egreso"}</td>
                  <td>${m.concepto}${m.ventaId ? ` · <a href="/productos/venta-ficha.html?id=${m.ventaId}">Ver venta</a>` : ""}</td>
                  <td>${m.medio}</td>
                  <td class="num">${formatMonto(m.importe)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table></div>`
        }
      </div>
    `
        : ""
    }

    <div class="card" style="padding:20px">
      <div class="section-title">Historial de sesiones</div>
      ${
        historial.length === 0
          ? `<div class="hint">Sin sesiones anteriores.</div>`
          : `<div class="table-scroll"><table>
          <thead><tr><th>Apertura</th><th>Cierre</th><th class="num">Saldo inicial</th><th class="num">Teórico</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead>
          <tbody>
            ${historial
              .map(
                (s) => `
              <tr>
                <td>${formatFechaHora(s.fechaApertura)}</td>
                <td>${s.estado === "abierta" ? '<span class="badge success">Abierta</span>' : formatFechaHora(s.fechaCierre)}</td>
                <td class="num">${formatMonto(s.saldoInicial)}</td>
                <td class="num">${s.saldoTeorico != null ? formatMonto(s.saldoTeorico) : "-"}</td>
                <td class="num">${s.dineroContado != null ? formatMonto(s.dineroContado) : "-"}</td>
                <td style="text-align:right; color:${!s.diferencia ? "inherit" : s.diferencia < 0 ? "var(--danger)" : "var(--warning)"}">${s.diferencia != null ? (s.diferencia === 0 ? "🟢 Sin diferencia" : s.diferencia < 0 ? `🔴 Faltante ${formatMonto(-s.diferencia)}` : `🟡 Sobrante ${formatMonto(s.diferencia)}`) : "-"}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table></div>`
      }
    </div>
  `;

  document.getElementById("btn-abrir")?.addEventListener("click", async () => {
    const valor = prompt("Saldo inicial (efectivo con el que arranca la caja):", "0");
    if (valor === null) return;
    const saldoInicial = parseFloat(valor) || 0;
    try {
      await abrirCaja(caja, saldoInicial, usuario);
      pintar();
    } catch (err) {
      alert(err?.message || "No se pudo abrir la caja.");
    }
  });

  document.getElementById("btn-movimiento")?.addEventListener("click", () => abrirModalMovimiento(sesion));
  document.getElementById("btn-cerrar")?.addEventListener("click", () => abrirModalCierre(sesion, saldo));
}

function abrirModalMovimiento(sesion) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Registrar movimiento</div>
      <form id="form-mov">
        <div class="field">
          <label for="m-tipo">Tipo</label>
          <select id="m-tipo"><option value="ingreso">🟢 Ingreso</option><option value="egreso">🔴 Egreso</option></select>
        </div>
        <div class="field">
          <label for="m-concepto">Concepto</label>
          <input type="text" id="m-concepto" placeholder="Ej. Reintegro, retiro, ingreso varios…" required />
        </div>
        <div class="field">
          <label for="m-importe">Importe</label>
          <input type="number" id="m-importe" min="0.01" step="0.01" required />
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
      await registrarMovimientoCaja(
        {
          cajaId,
          sesionId: sesion.id,
          sucursalId: caja.sucursalId,
          tipo: overlay.querySelector("#m-tipo").value,
          concepto: overlay.querySelector("#m-concepto").value.trim(),
          importe: parseFloat(overlay.querySelector("#m-importe").value),
          medio: "Efectivo",
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

function abrirModalCierre(sesion, saldoTeoricoEstimado) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Cerrar caja</div>
      <div class="hint" style="margin-bottom:10px">Saldo teórico (según los movimientos): <strong style="color:var(--foreground)">${formatMonto(saldoTeoricoEstimado)}</strong></div>
      <form id="form-cierre">
        <div class="section-title" style="font-size:13px; border:none; padding:0">Arqueo (opcional)</div>
        <div class="field-row">
          <div class="field"><label for="a-billetes">Billetes</label><input type="number" id="a-billetes" min="0" step="0.01" value="0" /></div>
          <div class="field"><label for="a-monedas">Monedas</label><input type="number" id="a-monedas" min="0" step="0.01" value="0" /></div>
          <div class="field"><label for="a-otros">Otros valores</label><input type="number" id="a-otros" min="0" step="0.01" value="0" /></div>
        </div>
        <div class="field">
          <label for="c-contado">Dinero contado (total)</label>
          <input type="number" id="c-contado" min="0" step="0.01" value="${saldoTeoricoEstimado}" required />
          <div class="hint">Se completa solo sumando el arqueo si lo cargás — podés editarlo directamente.</div>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Cerrar caja</button>
          <button type="button" id="c-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#c-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());

  function actualizarContado() {
    const b = parseFloat(overlay.querySelector("#a-billetes").value) || 0;
    const m = parseFloat(overlay.querySelector("#a-monedas").value) || 0;
    const o = parseFloat(overlay.querySelector("#a-otros").value) || 0;
    if (b || m || o) overlay.querySelector("#c-contado").value = b + m + o;
  }
  ["#a-billetes", "#a-monedas", "#a-otros"].forEach((sel) => overlay.querySelector(sel).addEventListener("input", actualizarContado));

  overlay.querySelector("#form-cierre").addEventListener("submit", async (e) => {
    e.preventDefault();
    const billetes = parseFloat(overlay.querySelector("#a-billetes").value) || 0;
    const monedas = parseFloat(overlay.querySelector("#a-monedas").value) || 0;
    const otros = parseFloat(overlay.querySelector("#a-otros").value) || 0;
    const dineroContado = parseFloat(overlay.querySelector("#c-contado").value);
    const arqueo = billetes || monedas || otros ? { billetes, monedas, otros, total: billetes + monedas + otros } : null;
    try {
      const resultado = await cerrarCaja(sesion, dineroContado, arqueo, usuario);
      overlay.remove();
      const msg =
        resultado.diferencia === 0
          ? "🟢 Caja cerrada sin diferencia."
          : resultado.diferencia < 0
          ? `🔴 Caja cerrada con faltante de ${formatMonto(-resultado.diferencia)}.`
          : `🟡 Caja cerrada con sobrante de ${formatMonto(resultado.diferencia)}.`;
      alert(msg);
      pintar();
    } catch (err) {
      alert(err?.message || "No se pudo cerrar la caja.");
    }
  });
}

pintar();
