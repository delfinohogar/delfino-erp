import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarComprobantes, ESTADOS_COMPROBANTE, FORMAS_PAGO_COMPROBANTE, TIPOS_COMPROBANTE } from "/js/facturacion.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "facturacion-dashboard", titulo: "Facturación", usuario });

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}
const HOY = fechaISO(new Date());
const INICIO_MES = HOY.slice(0, 8) + "01";

content.innerHTML = `
  <div class="dashboard-grid" style="margin-bottom:16px">
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Comprobantes este mes</div>
      <div class="dashboard-card-valor" id="kpi-cantidad-mes">—</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Comprobantes hoy</div>
      <div class="dashboard-card-valor" id="kpi-cantidad-hoy">—</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Facturado hoy</div>
      <div class="dashboard-card-valor" id="kpi-total-hoy">—</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Facturado este mes</div>
      <div class="dashboard-card-valor" id="kpi-total-mes">—</div>
    </div>
  </div>

  <div class="toolbar">
    <a href="/facturacion/nuevo.html"><button type="button" class="primary">+ Nuevo comprobante</button></a>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">Filtros</div>
    <div class="field-row">
      <div class="field">
        <label for="f-desde">Fecha desde</label>
        <input type="date" id="f-desde" value="${INICIO_MES}" />
      </div>
      <div class="field">
        <label for="f-hasta">Fecha hasta</label>
        <input type="date" id="f-hasta" value="${HOY}" />
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="f-texto">Cliente, DNI/CUIT o número</label>
        <input type="text" id="f-texto" placeholder="Buscar…" />
      </div>
      <div class="field">
        <label for="f-tipo">Tipo</label>
        <select id="f-tipo">
          <option value="">Todos</option>
          ${TIPOS_COMPROBANTE.filter((t) => !t.requiereArca).map((t) => `<option value="${t.codigo}">${t.nombre}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="f-estado">Estado</label>
        <select id="f-estado">
          <option value="">Todos</option>
          ${ESTADOS_COMPROBANTE.map((e) => `<option value="${e}">${e}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="f-forma-pago">Forma de pago</label>
        <select id="f-forma-pago">
          <option value="">Todas</option>
          ${FORMAS_PAGO_COMPROBANTE.map((f) => `<option>${f}</option>`).join("")}
        </select>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Número</th>
            <th>Tipo</th>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Venta</th>
            <th>Forma de pago</th>
            <th style="text-align:right">Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No hay comprobantes para estos filtros.</div>
  </div>
`;

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFecha(fechaStr) {
  if (!fechaStr) return "-";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
}
function badgeEstado(estado) {
  if (estado === "EMITIDA") return '<span class="badge success">Emitida</span>';
  if (estado === "ANULADA") return '<span class="badge danger">Anulada</span>';
  if (estado === "BORRADOR") return '<span class="badge muted">Borrador</span>';
  return `<span class="badge warning">${estado}</span>`;
}

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

let comprobantesDelRango = [];
let comprobantesDelMes = []; // para los KPI — siempre el mes calendario, sin importar el filtro de la tabla

function aplicarFiltrosYPintar() {
  const texto = document.getElementById("f-texto").value.trim().toLowerCase();
  const estado = document.getElementById("f-estado").value;
  const formaPago = document.getElementById("f-forma-pago").value;
  const tipo = document.getElementById("f-tipo").value;

  const filtrados = comprobantesDelRango.filter((c) => {
    if (estado && c.estado !== estado) return false;
    if (formaPago && c.formaPago !== formaPago) return false;
    if (tipo && c.tipoComprobanteCodigo !== tipo) return false;
    if (texto) {
      const enTexto = [c.numeroCompleto, c.clienteNombre, c.clienteCuit, c.clienteDni].filter(Boolean).join(" ").toLowerCase();
      if (!enTexto.includes(texto)) return false;
    }
    return true;
  });

  emptyState.style.display = filtrados.length === 0 ? "block" : "none";
  tablaBody.innerHTML = filtrados
    .map(
      (c) => `
    <tr style="cursor:pointer" onclick="location.href='/facturacion/ficha.html?id=${c.id}'">
      <td>${c.numeroCompleto || "-"}</td>
      <td>${c.tipoComprobante || "-"}</td>
      <td>${formatFecha(c.fechaEmision)}</td>
      <td>${c.clienteNombre || "Consumidor final"}</td>
      <td>${c.ventaId ? '<span class="badge muted">Venta</span>' : "-"}</td>
      <td>${c.formaPago || "-"}</td>
      <td style="text-align:right">${formatMonto(c.total)}</td>
      <td>${badgeEstado(c.estado)}</td>
    </tr>
  `
    )
    .join("");
}

function pintarKpis() {
  const delMes = comprobantesDelMes.filter((c) => c.estado !== "ANULADA");
  const deHoy = delMes.filter((c) => c.fechaEmision === HOY);
  document.getElementById("kpi-cantidad-mes").textContent = String(delMes.length);
  document.getElementById("kpi-cantidad-hoy").textContent = String(deHoy.length);
  document.getElementById("kpi-total-hoy").textContent = formatMonto(deHoy.reduce((acc, c) => acc + (c.total || 0), 0));
  document.getElementById("kpi-total-mes").textContent = formatMonto(delMes.reduce((acc, c) => acc + (c.total || 0), 0));
}

async function cargarKpis() {
  comprobantesDelMes = await listarComprobantes({ desde: INICIO_MES, hasta: HOY });
  pintarKpis();
}

async function cargar() {
  const desde = document.getElementById("f-desde").value;
  const hasta = document.getElementById("f-hasta").value;
  comprobantesDelRango = await listarComprobantes({ desde, hasta });
  aplicarFiltrosYPintar();
}

cargarKpis();

document.getElementById("f-desde").addEventListener("change", cargar);
document.getElementById("f-hasta").addEventListener("change", cargar);
document.getElementById("f-texto").addEventListener("input", aplicarFiltrosYPintar);
document.getElementById("f-estado").addEventListener("change", aplicarFiltrosYPintar);
document.getElementById("f-forma-pago").addEventListener("change", aplicarFiltrosYPintar);
document.getElementById("f-tipo").addEventListener("change", aplicarFiltrosYPintar);

cargar();
