import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { PERIODOS, rangoPeriodo } from "/js/dashboard.js";
import { reporteVentasPorDia, reporteVentasPorMedioPago, reporteProductosMasVendidos } from "/js/reportes.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "reportes", titulo: "Reportes", usuario });

content.innerHTML = `
  <div class="toolbar">
    <select id="periodo-select">
      ${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}
    </select>
  </div>
  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">Ventas por día</div>
    <div style="height:260px"><canvas id="chart-ventas-dia"></canvas></div>
  </div>
  <div class="dashboard-grid">
    <div class="card" style="padding:20px">
      <div class="section-title">Ventas por medio de pago</div>
      <div id="empty-medio" class="hint" style="display:none">Sin ventas en este período.</div>
      <div style="height:220px"><canvas id="chart-medio-pago"></canvas></div>
    </div>
    <div class="card" style="padding:20px">
      <div class="section-title">Productos más vendidos</div>
      <div id="empty-productos" class="hint" style="display:none">Sin ventas en este período.</div>
      <div style="height:220px"><canvas id="chart-productos"></canvas></div>
    </div>
  </div>
`;

const ACCENT = "#e23e3a";
const ACCENT_SUAVE = "rgba(226, 62, 58, 0.12)";
const BORDE = "#e4e4e7";
const MUTED = "#71717a";

Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.color = MUTED;

let chartVentasDia, chartMedioPago, chartProductos;

function formatFechaCorta(fechaStr) {
  const [, mes, dia] = fechaStr.split("-");
  return `${dia}/${mes}`;
}

async function cargar() {
  const { desde, hasta } = rangoPeriodo(document.getElementById("periodo-select").value);
  const [porDia, porMedio, masVendidos] = await Promise.all([
    reporteVentasPorDia(desde, hasta),
    reporteVentasPorMedioPago(desde, hasta),
    reporteProductosMasVendidos(desde, hasta),
  ]);

  chartVentasDia?.destroy();
  chartVentasDia = new Chart(document.getElementById("chart-ventas-dia"), {
    type: "line",
    data: {
      labels: porDia.map((d) => formatFechaCorta(d.fecha)),
      datasets: [
        {
          label: "Ventas",
          data: porDia.map((d) => d.total),
          borderColor: ACCENT,
          backgroundColor: ACCENT_SUAVE,
          fill: true,
          tension: 0.3,
          pointRadius: porDia.length > 20 ? 0 : 3,
          pointBackgroundColor: ACCENT,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: BORDE }, ticks: { callback: (v) => `$${v.toLocaleString("es-AR")}` } },
      },
    },
  });

  document.getElementById("empty-medio").style.display = porMedio.length === 0 ? "block" : "none";
  chartMedioPago?.destroy();
  chartMedioPago = new Chart(document.getElementById("chart-medio-pago"), {
    type: "bar",
    data: {
      labels: porMedio.map((m) => m.medio),
      datasets: [{ data: porMedio.map((m) => m.monto), backgroundColor: ACCENT, borderRadius: 4 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: BORDE }, ticks: { callback: (v) => `$${v.toLocaleString("es-AR")}` } },
        y: { grid: { display: false } },
      },
    },
  });

  document.getElementById("empty-productos").style.display = masVendidos.length === 0 ? "block" : "none";
  chartProductos?.destroy();
  chartProductos = new Chart(document.getElementById("chart-productos"), {
    type: "bar",
    data: {
      labels: masVendidos.map((p) => p.productoDescripcion),
      datasets: [{ data: masVendidos.map((p) => p.cantidad), backgroundColor: ACCENT, borderRadius: 4 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: BORDE }, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  });
}

document.getElementById("periodo-select").addEventListener("change", cargar);
cargar();
