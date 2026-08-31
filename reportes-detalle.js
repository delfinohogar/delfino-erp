import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { PERIODOS, rangoPeriodo } from "/js/dashboard.js";
import {
  CATEGORIAS_REPORTES,
  reporteVentasPorDia,
  reporteVentasPorMedioPago,
  reporteProductosMasVendidos,
  reporteResumenVentas,
  reporteMejoresClientes,
  reporteVentasPorVendedor,
  reporteValorizacionStock,
  reportePosicionIva,
} from "/js/reportes.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const tipo = new URLSearchParams(location.search).get("tipo");
const todosLosReportes = CATEGORIAS_REPORTES.flatMap((g) => g.reportes);
const reporte = todosLosReportes.find((r) => r.id === tipo);

const content = renderShell({ active: "reportes", titulo: reporte?.titulo || "Reporte", usuario });

if (!reporte) {
  content.innerHTML = `<div class="empty-state">No se encontró ese reporte. <a href="/reportes.html">Volver a Reportes</a></div>`;
  throw new Error("tipo de reporte inválido");
}

const SIN_PERIODO = tipo === "valorizacion-stock";

content.innerHTML = `
  <div class="toolbar">
    <a href="/reportes.html" class="link-btn">← Reportes</a>
    ${SIN_PERIODO ? "" : `<select id="periodo-select">${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}</select>`}
  </div>
  <div id="reporte-contenido"></div>
`;

const contenedor = document.getElementById("reporte-contenido");
const ACCENT = "#e23e3a";
const ACCENT_SUAVE = "rgba(226, 62, 58, 0.12)";
const BORDE = "#e4e4e7";
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.color = "#71717a";

let charts = [];
function destruirCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function formatMonto(valor) {
  return `$${Math.round(valor).toLocaleString("es-AR")}`;
}

function variacion(actual, anterior) {
  if (!anterior) return "";
  const pct = ((actual - anterior) / anterior) * 100;
  const signo = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "success" : "danger";
  return `<div class="hint" style="color:var(--${color})">${signo}${pct.toFixed(1)}% vs. período anterior</div>`;
}

function kpiCard(titulo, valor, comparacionHtml = "") {
  return `
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">${titulo}</div>
      <div class="dashboard-card-valor">${valor}</div>
      ${comparacionHtml}
    </div>
  `;
}

function barChart(canvasId, labels, valores, formatoMoneda = true) {
  charts.push(
    new Chart(document.getElementById(canvasId), {
      type: "bar",
      data: { labels, datasets: [{ data: valores, backgroundColor: ACCENT, borderRadius: 4 }] },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: BORDE }, ticks: formatoMoneda ? { callback: (v) => `$${v.toLocaleString("es-AR")}` } : { precision: 0 } },
          y: { grid: { display: false } },
        },
      },
    })
  );
}

function formatFechaCorta(fechaStr) {
  const [, mes, dia] = fechaStr.split("-");
  return `${dia}/${mes}`;
}

async function cargar() {
  destruirCharts();
  contenedor.innerHTML = `<div class="hint" style="padding:24px">Cargando…</div>`;

  const { desde, hasta, desdeAnterior, hastaAnterior } = SIN_PERIODO
    ? {}
    : rangoPeriodo(document.getElementById("periodo-select").value);

  if (tipo === "resumen-ventas") {
    const [actual, anterior, porDia, porMedio, porVendedor] = await Promise.all([
      reporteResumenVentas(desde, hasta),
      reporteResumenVentas(desdeAnterior, hastaAnterior),
      reporteVentasPorDia(desde, hasta),
      reporteVentasPorMedioPago(desde, hasta),
      reporteVentasPorVendedor(desde, hasta),
    ]);
    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Total ventas", formatMonto(actual.total), variacion(actual.total, anterior.total))}
        ${kpiCard("Cantidad de ventas", String(actual.cantidad), variacion(actual.cantidad, anterior.cantidad))}
        ${kpiCard("Ticket promedio", formatMonto(actual.ticketPromedio), variacion(actual.ticketPromedio, anterior.ticketPromedio))}
        ${kpiCard("Unidades vendidas", String(actual.unidades), variacion(actual.unidades, anterior.unidades))}
        ${kpiCard("Margen bruto", formatMonto(actual.margenBruto), variacion(actual.margenBruto, anterior.margenBruto))}
      </div>
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div class="section-title">Ventas por día</div>
        <div style="height:240px"><canvas id="chart-dia"></canvas></div>
      </div>
      <div class="dashboard-grid">
        <div class="card" style="padding:20px">
          <div class="section-title">Por vendedor</div>
          <div style="height:200px"><canvas id="chart-vendedor"></canvas></div>
        </div>
        <div class="card" style="padding:20px">
          <div class="section-title">Por medio de pago</div>
          <div style="height:200px"><canvas id="chart-medio"></canvas></div>
        </div>
      </div>
    `;
    charts.push(
      new Chart(document.getElementById("chart-dia"), {
        type: "line",
        data: {
          labels: porDia.map((d) => formatFechaCorta(d.fecha)),
          datasets: [
            {
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
          scales: { x: { grid: { display: false } }, y: { grid: { color: BORDE }, ticks: { callback: (v) => `$${v.toLocaleString("es-AR")}` } } },
        },
      })
    );
    barChart("chart-vendedor", porVendedor.map((v) => v.vendedorNombre), porVendedor.map((v) => v.total));
    barChart("chart-medio", porMedio.map((m) => m.medio), porMedio.map((m) => m.monto));
    return;
  }

  if (tipo === "productos-mas-vendidos") {
    const productos = await reporteProductosMasVendidos(desde, hasta, 15);
    contenedor.innerHTML = `
      <div class="card" style="padding:20px">
        <div id="empty" class="hint" style="display:${productos.length ? "none" : "block"}">Sin ventas en este período.</div>
        <div style="height:${Math.max(productos.length * 34, 120)}px"><canvas id="chart-productos"></canvas></div>
      </div>
    `;
    barChart("chart-productos", productos.map((p) => p.productoDescripcion), productos.map((p) => p.cantidad), false);
    return;
  }

  if (tipo === "mejores-clientes") {
    const clientes = await reporteMejoresClientes(desde, hasta, 15);
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div id="empty" class="hint" style="display:${clientes.length ? "none" : "block"}">Sin ventas en este período.</div>
        <div style="height:${Math.max(clientes.length * 34, 120)}px"><canvas id="chart-clientes"></canvas></div>
      </div>
      <div class="card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Cliente</th><th>Cantidad de ventas</th><th>Total</th></tr></thead>
            <tbody>
              ${clientes.map((c) => `<tr><td>${c.clienteNombre}</td><td>${c.cantidad}</td><td>${formatMonto(c.total)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    barChart("chart-clientes", clientes.map((c) => c.clienteNombre), clientes.map((c) => c.total));
    return;
  }

  if (tipo === "rentabilidad") {
    const [actual, anterior] = await Promise.all([reporteResumenVentas(desde, hasta), reporteResumenVentas(desdeAnterior, hastaAnterior)]);
    const costoTotal = actual.total - actual.margenBruto;
    const margenPct = actual.total > 0 ? (actual.margenBruto / actual.total) * 100 : 0;
    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Ventas", formatMonto(actual.total), variacion(actual.total, anterior.total))}
        ${kpiCard("Costo", formatMonto(costoTotal))}
        ${kpiCard("Margen bruto", formatMonto(actual.margenBruto), variacion(actual.margenBruto, anterior.margenBruto))}
        ${kpiCard("Margen sobre ventas", `${margenPct.toFixed(1)}%`)}
      </div>
      <div class="hint">Margen = precio de venta menos el costo del producto al momento exacto de venderse (no el costo actual) — así el número no se corre si el costo cambió después.</div>
    `;
    return;
  }

  if (tipo === "posicion-iva") {
    const pos = await reportePosicionIva(desde, hasta);
    const filaHtml = (titulo, monto) => `
      <tr>
        <td>${titulo}</td>
        <td style="text-align:right; color:var(--${monto >= 0 ? "success" : "foreground"})">${monto >= 0 ? "+" : ""}${formatMonto(monto)}</td>
      </tr>
    `;
    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Débito fiscal ventas", formatMonto(pos.debitoFiscalVentas))}
        ${kpiCard("Crédito fiscal compras", `+${formatMonto(pos.creditoFiscalCompras)}`)}
        ${kpiCard("Saldo a favor estimado", `${pos.saldoAFavorEstimado >= 0 ? "+" : ""}${formatMonto(pos.saldoAFavorEstimado)}`)}
      </div>
      <div class="card" style="padding:20px; max-width:520px">
        <div class="section-title">Determinación del período</div>
        <div class="table-scroll">
          <table>
            <tbody>
              ${filaHtml("IVA débito fiscal", pos.debitoFiscalVentas)}
              ${filaHtml("IVA crédito fiscal", pos.creditoFiscalCompras)}
              ${filaHtml("Saldo técnico a favor", pos.saldoTecnico)}
              ${filaHtml("Retenciones IVA sufridas", pos.retencionesSufridas)}
              ${filaHtml("Percepciones sufridas (compras)", pos.percepcionesSufridas)}
              ${filaHtml("Saldo a favor estimado", pos.saldoAFavorEstimado)}
            </tbody>
          </table>
        </div>
      </div>
      <div class="hint" style="margin-top:12px">
        El sistema todavía no discrimina IVA en las ventas (no factura fiscalmente) — por eso el débito
        fiscal da $0. Las retenciones tampoco se registran en ningún lado todavía. Esto se completa
        cuando se conecte la facturación electrónica ARCA.
      </div>
    `;
    return;
  }

  if (tipo === "valorizacion-stock") {
    const { total, principales } = await reporteValorizacionStock(15);
    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Capital inmovilizado en stock", formatMonto(total))}
      </div>
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div class="section-title">Productos con mayor valorización</div>
        <div id="empty" class="hint" style="display:${principales.length ? "none" : "block"}">Sin stock valorizado todavía.</div>
        <div style="height:${Math.max(principales.length * 34, 120)}px"><canvas id="chart-valorizacion"></canvas></div>
      </div>
      <div class="card">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Producto</th><th>Stock</th><th>Costo unitario</th><th>Valorizado</th></tr></thead>
            <tbody>
              ${principales
                .map(
                  (p) =>
                    `<tr><td>${p.productoDescripcion}</td><td>${p.stockTotal}</td><td>${formatMonto(p.costoReferencia)}</td><td>${formatMonto(p.valorizado)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    barChart("chart-valorizacion", principales.map((p) => p.productoDescripcion), principales.map((p) => p.valorizado));
    return;
  }
}

if (!SIN_PERIODO) document.getElementById("periodo-select").addEventListener("change", cargar);
cargar();
