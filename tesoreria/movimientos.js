import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarMovimientosTesoreria } from "/js/tesoreria.js";
import { listarCajas } from "/js/cajas.js";
import { listarCuentasBancarias } from "/js/bancos.js";
import { obtenerComprobantePorVenta } from "/js/facturacion.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-movimientos", titulo: "Movimientos", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}
function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

const HOY = new Date().toISOString().slice(0, 10);
const INICIO_MES = HOY.slice(0, 8) + "01";

const [cajas, cuentas] = await Promise.all([listarCajas(), listarCuentasBancarias()]);
const nombreCaja = new Map(cajas.map((c) => [c.id, `${c.nombre} (${c.sucursalNombre})`]));
const nombreCuenta = new Map(cuentas.map((c) => [c.id, `${c.bancoNombre} — ${c.nombre}`]));

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
    <button type="button" id="btn-csv">⬇️ Exportar CSV</button>
  </div>
  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="field-row">
      <div class="field"><label for="f-desde">Desde</label><input type="date" id="f-desde" value="${INICIO_MES}" /></div>
      <div class="field"><label for="f-hasta">Hasta</label><input type="date" id="f-hasta" value="${HOY}" /></div>
      <div class="field">
        <label for="f-origen">Origen</label>
        <select id="f-origen"><option value="">Todos</option><option value="caja">Caja</option><option value="banco">Banco</option></select>
      </div>
      <div class="field">
        <label for="f-tipo">Tipo</label>
        <select id="f-tipo"><option value="">Todos</option><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead><tr><th></th><th>Fecha</th><th>Lugar</th><th>Tipo</th><th>Concepto</th><th>Medio</th><th style="text-align:right">Importe</th><th>Estado</th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No hay movimientos para este filtro.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");
let movimientosActuales = [];

function lugarDe(m) {
  return m.origenTipo === "caja" ? nombreCaja.get(m.cajaId) || "Caja" : nombreCuenta.get(m.cuentaId) || "Cuenta bancaria";
}

async function detalleHtml(m) {
  const partes = [];
  if (m.ventaId) {
    partes.push(`<a href="/productos/venta-ficha.html?id=${m.ventaId}">Ver venta</a>`);
    const comp = await obtenerComprobantePorVenta(m.ventaId).catch(() => null);
    if (comp) partes.push(`<a href="/facturacion/ficha.html?id=${comp.id}">Ver factura</a>`);
  }
  if (m.origen?.tipo === "gasto") partes.push(`Origen: gasto`);
  if (m.origen?.tipo === "transferencia") partes.push(`Origen: transferencia interna`);
  if (m.origen?.tipo === "cuentaPorCobrar") partes.push(`<a href="/tesoreria/cuentas-por-cobrar.html">Ver cuenta por cobrar</a>`);
  return `
    <div style="padding:10px 14px">
      <div class="hint">Registrado por ${m.usuarioNombre} el ${formatFechaHora(m.creadoEn)}${m.referencia ? ` · Referencia: ${m.referencia}` : ""}</div>
      ${partes.length ? `<div style="margin-top:6px">${partes.join(" · ")}</div>` : `<div class="hint" style="margin-top:6px">Sin trazabilidad adicional — movimiento manual.</div>`}
    </div>
  `;
}

async function cargar() {
  const desde = document.getElementById("f-desde").value;
  const hasta = document.getElementById("f-hasta").value;
  const origen = document.getElementById("f-origen").value;
  const tipo = document.getElementById("f-tipo").value;

  let movimientos = await listarMovimientosTesoreria({ desde, hasta });
  if (origen) movimientos = movimientos.filter((m) => m.origenTipo === origen);
  if (tipo) movimientos = movimientos.filter((m) => m.tipo === tipo);
  movimientosActuales = movimientos;

  emptyState.style.display = movimientos.length === 0 ? "block" : "none";
  tbody.innerHTML = movimientos
    .map(
      (m, i) => `
    <tr style="cursor:pointer; ${m.estado === "anulado" ? "opacity:0.5; text-decoration:line-through" : ""}" data-idx="${i}">
      <td>▸</td>
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.origenTipo === "caja" ? "🧾" : "🏦"} ${lugarDe(m)}</td>
      <td>${m.tipo === "ingreso" ? "🟢 Ingreso" : "🔴 Egreso"}</td>
      <td>${m.concepto}</td>
      <td>${m.medio || "-"}</td>
      <td style="text-align:right">${formatMonto(m.importe)}</td>
      <td>${m.estado === "conciliado" ? '<span class="badge success">Conciliado</span>' : m.estado === "anulado" ? '<span class="badge danger">Anulado</span>' : m.origenTipo === "banco" ? '<span class="badge warning">Pendiente</span>' : '<span class="badge muted">Registrado</span>'}</td>
    </tr>
    <tr class="detalle-row" data-detalle="${i}" style="display:none"><td></td><td colspan="7" id="detalle-${i}"></td></tr>
  `
    )
    .join("");

  tbody.querySelectorAll("tr[data-idx]").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const idx = tr.dataset.idx;
      const fila = tbody.querySelector(`[data-detalle="${idx}"]`);
      const abierta = fila.style.display !== "none";
      tbody.querySelectorAll(".detalle-row").forEach((f) => (f.style.display = "none"));
      if (!abierta) {
        fila.style.display = "table-row";
        document.getElementById(`detalle-${idx}`).innerHTML = `<div class="hint">Cargando…</div>`;
        document.getElementById(`detalle-${idx}`).innerHTML = await detalleHtml(movimientos[idx]);
      }
    });
  });
}

document.getElementById("f-desde").addEventListener("change", cargar);
document.getElementById("f-hasta").addEventListener("change", cargar);
document.getElementById("f-origen").addEventListener("change", cargar);
document.getElementById("f-tipo").addEventListener("change", cargar);

document.getElementById("btn-csv").addEventListener("click", () => {
  const filas = [["Fecha", "Lugar", "Tipo", "Concepto", "Medio", "Importe", "Estado"]];
  movimientosActuales.forEach((m) => filas.push([formatFecha(m.fecha), lugarDe(m), m.tipo, m.concepto, m.medio || "", m.importe, m.estado]));
  const csv = filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `movimientos-tesoreria_${HOY}.csv`;
  a.click();
});

cargar();
