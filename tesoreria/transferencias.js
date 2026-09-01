import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { crearTransferenciaInterna, listarTransferenciasInternas } from "/js/transferencias.js";
import { listarCajas, sesionAbiertaDeCaja } from "/js/cajas.js";
import { listarCuentasBancariasActivas } from "/js/bancos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-transferencias", titulo: "Transferencias internas", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}

async function opcionesDestino() {
  const [cajas, cuentas] = await Promise.all([listarCajas(), listarCuentasBancariasActivas()]);
  const cajasConSesion = await Promise.all(
    cajas.filter((c) => c.activa !== false).map(async (c) => ({ caja: c, sesion: await sesionAbiertaDeCaja(c.id) }))
  );
  const cajasAbiertas = cajasConSesion.filter((c) => c.sesion);
  return { cajasAbiertas, cuentas };
}

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
    <button type="button" id="btn-nueva" class="primary">+ Transferir</button>
  </div>
  <div class="hint" style="margin-bottom:12px; max-width:64ch">
    Mover plata entre cajas/bancos del propio negocio — no es venta ni gasto, no impacta la
    facturación ni los ingresos (queda marcado como transferencia interna en ambos lados).
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Concepto</th><th style="text-align:right">Importe</th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no se registró ninguna transferencia interna.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const transferencias = await listarTransferenciasInternas();
  emptyState.style.display = transferencias.length === 0 ? "block" : "none";
  tbody.innerHTML = transferencias
    .map(
      (t) => `
    <tr>
      <td>${formatFecha(t.fecha)}</td>
      <td>${t.origen.tipo === "caja" ? "🧾" : "🏦"} ${t.origen.nombre}</td>
      <td>${t.destino.tipo === "caja" ? "🧾" : "🏦"} ${t.destino.nombre}</td>
      <td>${t.concepto}</td>
      <td style="text-align:right">${formatMonto(t.importe)}</td>
    </tr>
  `
    )
    .join("");
}

document.getElementById("btn-nueva").addEventListener("click", async () => {
  const { cajasAbiertas, cuentas } = await opcionesDestino();
  const opciones = [
    ...cajasAbiertas.map((c) => ({ value: `caja:${c.caja.id}:${c.sesion.id}`, nombre: `🧾 ${c.caja.nombre} (${c.caja.sucursalNombre})`, tipo: "caja", id: c.caja.id, sesionId: c.sesion.id }))
    ,
    ...cuentas.map((c) => ({ value: `banco:${c.id}`, nombre: `🏦 ${c.bancoNombre} — ${c.nombre}`, tipo: "banco", id: c.id })),
  ];
  if (opciones.length < 2) {
    alert("Necesitás al menos dos cajas/cuentas disponibles (con la caja abierta) para transferir entre ellas.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Transferir dinero</div>
      <form id="form-transf">
        <div class="field">
          <label for="t-origen">Origen</label>
          <select id="t-origen">${opciones.map((o) => `<option value="${o.value}">${o.nombre}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="t-destino">Destino</label>
          <select id="t-destino">${opciones.map((o, i) => `<option value="${o.value}" ${i === 1 ? "selected" : ""}>${o.nombre}</option>`).join("")}</select>
        </div>
        <div class="field-row">
          <div class="field"><label for="t-importe">Importe</label><input type="number" id="t-importe" min="0.01" step="0.01" required /></div>
          <div class="field"><label for="t-fecha">Fecha</label><input type="date" id="t-fecha" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        </div>
        <div class="field">
          <label for="t-concepto">Concepto (opcional)</label>
          <input type="text" id="t-concepto" />
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Transferir</button>
          <button type="button" id="t-cancelar">Cancelar</button>
        </div>
        <div class="error-text" id="t-error" style="display:none"></div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#t-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-transf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector("#t-error");
    errorEl.style.display = "none";
    const origenVal = overlay.querySelector("#t-origen").value;
    const destinoVal = overlay.querySelector("#t-destino").value;
    const origenOpt = opciones.find((o) => o.value === origenVal);
    const destinoOpt = opciones.find((o) => o.value === destinoVal);
    try {
      await crearTransferenciaInterna(
        {
          fecha: overlay.querySelector("#t-fecha").value,
          origen: { tipo: origenOpt.tipo, id: origenOpt.id, nombre: origenOpt.nombre.replace(/^[^\s]+\s/, ""), sesionId: origenOpt.sesionId },
          destino: { tipo: destinoOpt.tipo, id: destinoOpt.id, nombre: destinoOpt.nombre.replace(/^[^\s]+\s/, ""), sesionId: destinoOpt.sesionId },
          importe: parseFloat(overlay.querySelector("#t-importe").value),
          concepto: overlay.querySelector("#t-concepto").value,
        },
        usuario
      );
      overlay.remove();
      cargar();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo hacer la transferencia.";
      errorEl.style.display = "block";
    }
  });
});

cargar();
