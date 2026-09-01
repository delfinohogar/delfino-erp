import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCuentasPorCobrar, registrarCobroCuentaPorCobrar, MEDIOS_CUENTA_POR_COBRAR, estaVencida } from "/js/cuentas-por-cobrar.js";
import { listarCajas, sesionAbiertaDeCaja } from "/js/cajas.js";
import { listarCuentasBancariasActivas } from "/js/bancos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-cxc", titulo: "Cuentas por cobrar", usuario });

function formatMonto(v) {
  return v == null ? "No disponible" : `$${Math.round(v).toLocaleString("es-AR")}`;
}
function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}
function badgeEstado(c) {
  if (c.estado === "cobrado") return '<span class="badge success">Cobrado</span>';
  if (c.estado === "parcial") return '<span class="badge warning">Parcial</span>';
  if (estaVencida(c)) return '<span class="badge danger">Vencido</span>';
  return '<span class="badge muted">Pendiente</span>';
}

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
  </div>
  <div id="resumen" class="dashboard-grid" style="margin-bottom:16px"></div>
  <div class="card mb-16">
    <div class="field">
      <label for="f-medio">Medio</label>
      <select id="f-medio">
        <option value="">Todos</option>
        ${MEDIOS_CUENTA_POR_COBRAR.map((m) => `<option>${m}</option>`).join("")}
      </select>
    </div>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>Medio</th><th>Fecha</th><th>Cliente</th><th class="num">Bruto</th><th class="num">Comisión</th><th class="num">Neto</th><th>Prevista</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No hay cuentas por cobrar para este filtro.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
const resumenEl = document.getElementById("resumen");

async function pintarResumen() {
  const todas = await listarCuentasPorCobrar();
  const pendientes = todas.filter((c) => c.estado !== "cobrado");
  resumenEl.innerHTML = MEDIOS_CUENTA_POR_COBRAR.map((m) => {
    const total = pendientes.filter((c) => c.medio === m).reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);
    return `<div class="card dashboard-card"><div class="hint mt-0">${m}</div><div class="dashboard-card-valor">${formatMonto(total)}</div></div>`;
  }).join("");
}

async function cargar() {
  const medio = document.getElementById("f-medio").value;
  const cuentas = await listarCuentasPorCobrar(medio ? { medio } : {});
  emptyState.style.display = cuentas.length === 0 ? "block" : "none";
  tbody.innerHTML = cuentas
    .map(
      (c) => `
    <tr>
      <td>${c.medio}</td>
      <td>${formatFecha(c.fecha)}</td>
      <td>${c.clienteNombre}${c.ventaId ? ` · <a href="/productos/venta-ficha.html?id=${c.ventaId}">Ver venta</a>` : ""}</td>
      <td class="num">${formatMonto(c.importeBruto)}</td>
      <td class="num">${c.comision != null ? formatMonto(c.comision) : '<span class="hint">No disponible</span>'}</td>
      <td class="num">${c.importeNeto != null ? formatMonto(c.importeNeto) : `${formatMonto(c.importeBruto)} (sin comisión conocida)`}</td>
      <td>${c.fechaPrevista ? formatFecha(c.fechaPrevista) : '<span class="hint">No disponible</span>'}</td>
      <td>${badgeEstado(c)}</td>
      <td>${c.estado !== "cobrado" ? `<button type="button" data-cobrar="${c.id}">💰 Registrar cobro</button>` : ""}</td>
    </tr>
  `
    )
    .join("");
  tbody.querySelectorAll("[data-cobrar]").forEach((btn) => btn.addEventListener("click", () => abrirModalCobro(btn.dataset.cobrar, cuentas.find((c) => c.id === btn.dataset.cobrar))));
}

async function abrirModalCobro(cuentaId, cuenta) {
  const [cajas, cuentasBancarias] = await Promise.all([listarCajas(), listarCuentasBancariasActivas()]);
  const cajasConSesion = await Promise.all(cajas.filter((c) => c.activa !== false).map(async (c) => ({ caja: c, sesion: await sesionAbiertaDeCaja(c.id) })));
  const cajasAbiertas = cajasConSesion.filter((c) => c.sesion);
  const destinos = [
    ...cajasAbiertas.map((c) => ({ value: `caja:${c.caja.id}`, nombre: `🧾 ${c.caja.nombre} (${c.caja.sucursalNombre})`, tipo: "caja", id: c.caja.id, sesionId: c.sesion.id })),
    ...cuentasBancarias.map((c) => ({ value: `banco:${c.id}`, nombre: `🏦 ${c.bancoNombre} — ${c.nombre}`, tipo: "banco", id: c.id })),
  ];
  if (destinos.length === 0) {
    alert("Abrí una caja o cargá una cuenta bancaria antes de registrar dónde entró esta plata.");
    return;
  }

  const esperado = cuenta.importeNeto ?? cuenta.importeBruto;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Registrar acreditación — ${cuenta.medio}</div>
      <div class="hint" style="margin-bottom:10px">Esperado: <strong style="color:var(--foreground)">${formatMonto(esperado)}</strong> · Ya cobrado: <strong style="color:var(--foreground)">${formatMonto(cuenta.totalCobrado)}</strong> · Pendiente: <strong style="color:var(--foreground)">${formatMonto(cuenta.saldoPendiente)}</strong></div>
      <form id="form-cobro">
        <div class="field-row">
          <div class="field"><label for="cc-importe">Importe recibido</label><input type="number" id="cc-importe" min="0.01" step="0.01" value="${cuenta.saldoPendiente}" required /></div>
          <div class="field"><label for="cc-fecha">Fecha</label><input type="date" id="cc-fecha" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        </div>
        <div class="field">
          <label for="cc-destino">Destino</label>
          <select id="cc-destino">${destinos.map((d) => `<option value="${d.value}">${d.nombre}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="cc-referencia">Referencia (opcional)</label>
          <input type="text" id="cc-referencia" />
        </div>
        <div class="field">
          <label for="cc-motivo">Si el importe no coincide con lo esperado, ¿por qué? (opcional)</label>
          <input type="text" id="cc-motivo" placeholder="Ej. comisión, retención, ajuste…" />
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Registrar</button>
          <button type="button" id="cc-cancelar">Cancelar</button>
        </div>
        <div class="error-text" id="cc-error" style="display:none"></div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#cc-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-cobro").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector("#cc-error");
    errorEl.style.display = "none";
    const destinoOpt = destinos.find((d) => d.value === overlay.querySelector("#cc-destino").value);
    try {
      const resultado = await registrarCobroCuentaPorCobrar(
        cuentaId,
        {
          importeRecibido: parseFloat(overlay.querySelector("#cc-importe").value),
          fecha: overlay.querySelector("#cc-fecha").value,
          destino: { tipo: destinoOpt.tipo, id: destinoOpt.id, nombre: destinoOpt.nombre.replace(/^[^\s]+\s/, "") },
          referencia: overlay.querySelector("#cc-referencia").value,
          motivoDiferencia: overlay.querySelector("#cc-motivo").value,
        },
        usuario
      );
      // El cobro de la cuenta por cobrar también tiene que quedar como ingreso real en la
      // caja/cuenta elegida — mismo mecanismo que usan ventas.js/cobros.js.
      const { registrarMovimientoCaja } = await import("/js/cajas.js");
      const { registrarMovimientoBancario } = await import("/js/bancos.js");
      if (destinoOpt.tipo === "caja") {
        await registrarMovimientoCaja(
          { cajaId: destinoOpt.id, sesionId: destinoOpt.sesionId, tipo: "ingreso", concepto: `Acreditación ${cuenta.medio} — ${cuenta.clienteNombre}`, importe: resultado.pago.importe, medio: cuenta.medio, clienteId: cuenta.clienteId, clienteNombre: cuenta.clienteNombre, origen: { tipo: "cuentaPorCobrar", id: cuentaId } },
          usuario
        );
      } else {
        await registrarMovimientoBancario(
          { cuentaId: destinoOpt.id, fecha: overlay.querySelector("#cc-fecha").value, tipo: "ingreso", concepto: `Acreditación ${cuenta.medio} — ${cuenta.clienteNombre}`, importe: resultado.pago.importe, clienteId: cuenta.clienteId, clienteNombre: cuenta.clienteNombre, origen: { tipo: "cuentaPorCobrar", id: cuentaId } },
          usuario
        );
      }
      overlay.remove();
      if (Math.abs(resultado.diferencia) > 0.5) alert(`Se registró con una diferencia de ${formatMonto(Math.abs(resultado.diferencia))} respecto de lo esperado.`);
      cargar();
      pintarResumen();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo registrar el cobro.";
      errorEl.style.display = "block";
    }
  });
}

document.getElementById("f-medio").addEventListener("change", cargar);

pintarResumen();
cargar();
