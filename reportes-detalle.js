import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { PERIODOS, rangoPeriodo } from "/js/dashboard.js";
import {
  CATEGORIAS_REPORTES,
  reporteVentasPorDia,
  reporteVentasPorMedioPago,
  reporteVentasDetalle,
  reporteProductosMasVendidos,
  reporteResumenVentas,
  reporteMejoresClientes,
  reporteVentasPorVendedor,
  reporteValorizacionStock,
  reporteStockCritico,
  reporteFacturasPorVencer,
  reportePosicionIva,
  reporteFormasDePago,
  reporteVentasPorCategoria,
  reporteRentabilidadPorProducto,
  reporteClientesDetalle,
  reporteFletes,
} from "/js/reportes.js";
import { renderizarTabla, renderizarComparacion, renderizarExportar, renderizarSinDatos } from "/js/report-engine.js";

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

const SIN_PERIODO = ["valorizacion-stock", "stock-critico", "facturas-vencer", "fletes"].includes(tipo);

content.innerHTML = `
  <div class="toolbar">
    <a href="/reportes.html" class="link-btn">← Reportes</a>
    ${
      SIN_PERIODO
        ? ""
        : `
      <select id="periodo-select">${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}</select>
      <input type="date" id="fecha-desde" style="display:none" />
      <span id="fecha-hasta-label" style="display:none">a</span>
      <input type="date" id="fecha-hasta" style="display:none" />
    `
    }
  </div>
  <div id="reporte-exportar-top"></div>
  <div id="reporte-contenido"></div>
`;

const contenedor = document.getElementById("reporte-contenido");
const exportarTop = document.getElementById("reporte-exportar-top");
// Se leen de las variables CSS (no valores fijos) para que los gráficos seas legibles tanto en tema
// claro como oscuro — --accent es la marca y no cambia, el resto sí.
const estilos = getComputedStyle(document.documentElement);
const ACCENT = estilos.getPropertyValue("--accent").trim() || "#e23e3a";
const ACCENT_SUAVE = "rgba(226, 62, 58, 0.12)";
const BORDE = estilos.getPropertyValue("--border").trim() || "#e4e4e7";
const PALETA = [ACCENT, "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#64748b", "#14b8a6"];
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.color = estilos.getPropertyValue("--muted").trim() || "#71717a";

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

function pieChart(canvasId, labels, valores) {
  charts.push(
    new Chart(document.getElementById(canvasId), {
      type: "doughnut",
      data: { labels, datasets: [{ data: valores, backgroundColor: PALETA }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "right", labels: { boxWidth: 12 } } },
      },
    })
  );
}

function formatFechaCorta(fechaStr) {
  const [, mes, dia] = fechaStr.split("-");
  return `${dia}/${mes}`;
}

function formatFechaLarga(fechaStr) {
  if (!fechaStr) return "";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
}

function tituloPeriodo(desde, hasta) {
  return desde === hasta ? formatFechaLarga(desde) : `${formatFechaLarga(desde)} al ${formatFechaLarga(hasta)}`;
}

function nombreArchivoDe(desde, hasta) {
  const slug = reporte.titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_");
  return `Reporte_${slug}${desde ? `_${desde}_a_${hasta}` : ""}`;
}

// Sección "Comparar con período anterior" — colapsable, se arma igual para cualquier reporte que
// tenga rango de fechas (no se repite el armado del <details> en cada branch).
function seccionComparacion() {
  return `
    <details class="card" style="padding:16px; margin-bottom:16px">
      <summary style="cursor:pointer; font-weight:600">Comparar con período anterior</summary>
      <div id="comparacion-tabla" style="margin-top:12px"></div>
    </details>
  `;
}

function montarComparacion(indicadores) {
  const el = document.getElementById("comparacion-tabla");
  if (el) renderizarComparacion(el, indicadores);
}

async function cargar() {
  destruirCharts();
  contenedor.innerHTML = `<div class="hint" style="padding:24px">Cargando…</div>`;
  exportarTop.innerHTML = "";

  const { desde, hasta, desdeAnterior, hastaAnterior } = SIN_PERIODO ? {} : obtenerRango();
  const periodoTexto = desde ? tituloPeriodo(desde, hasta) : "";
  const nombreArchivo = nombreArchivoDe(desde, hasta);

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
      ${seccionComparacion()}
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
    montarComparacion([
      { titulo: "Ventas totales", actual: actual.total, anterior: anterior.total, formato: "moneda" },
      { titulo: "Cantidad de ventas", actual: actual.cantidad, anterior: anterior.cantidad, formato: "numero" },
      { titulo: "Unidades vendidas", actual: actual.unidades, anterior: anterior.unidades, formato: "numero" },
      { titulo: "Ticket promedio", actual: actual.ticketPromedio, anterior: anterior.ticketPromedio, formato: "moneda" },
      { titulo: "Margen bruto", actual: actual.margenBruto, anterior: anterior.margenBruto, formato: "moneda" },
    ]);
    renderizarExportar(exportarTop, {
      nombreArchivo,
      tituloReporte: reporte.titulo,
      periodoTexto,
      resumen: [
        { titulo: "Total ventas", valor: formatMonto(actual.total) },
        { titulo: "Cantidad de ventas", valor: String(actual.cantidad) },
        { titulo: "Ticket promedio", valor: formatMonto(actual.ticketPromedio) },
        { titulo: "Unidades vendidas", valor: String(actual.unidades) },
        { titulo: "Margen bruto", valor: formatMonto(actual.margenBruto) },
      ],
      columnas: [
        { clave: "fecha", titulo: "Fecha", formato: "fecha" },
        { clave: "total", titulo: "Total", formato: "moneda", align: "right" },
      ],
      filas: porDia.map((d) => ({ fecha: d.fecha, total: d.total })),
    });
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

  if (tipo === "ventas-detalle") {
    const [actual, anterior, filas] = await Promise.all([
      reporteResumenVentas(desde, hasta),
      reporteResumenVentas(desdeAnterior, hastaAnterior),
      reporteVentasDetalle(desde, hasta),
    ]);
    const costoMercaderia = Math.round((actual.total - actual.margenBruto) * 100) / 100;
    const margenPromedioPct = actual.total > 0 ? (actual.margenBruto / actual.total) * 100 : 0;

    if (filas.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }

    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Ventas totales", formatMonto(actual.total), variacion(actual.total, anterior.total))}
        ${kpiCard("Cantidad de operaciones", String(actual.cantidad), variacion(actual.cantidad, anterior.cantidad))}
        ${kpiCard("Unidades vendidas", String(actual.unidades), variacion(actual.unidades, anterior.unidades))}
        ${kpiCard("Ticket promedio", formatMonto(actual.ticketPromedio), variacion(actual.ticketPromedio, anterior.ticketPromedio))}
        ${kpiCard("Margen promedio", `${margenPromedioPct.toFixed(1)}%`)}
        ${kpiCard("Costo de mercadería", formatMonto(costoMercaderia))}
        ${kpiCard("Ganancia bruta", formatMonto(actual.margenBruto), variacion(actual.margenBruto, anterior.margenBruto))}
      </div>
      ${seccionComparacion()}
      <div id="tabla-ventas" class="card" style="padding:20px"></div>
    `;
    montarComparacion([
      { titulo: "Ventas totales", actual: actual.total, anterior: anterior.total, formato: "moneda" },
      { titulo: "Operaciones", actual: actual.cantidad, anterior: anterior.cantidad, formato: "numero" },
      { titulo: "Unidades", actual: actual.unidades, anterior: anterior.unidades, formato: "numero" },
      { titulo: "Ticket promedio", actual: actual.ticketPromedio, anterior: anterior.ticketPromedio, formato: "moneda" },
      { titulo: "Ganancia bruta", actual: actual.margenBruto, anterior: anterior.margenBruto, formato: "moneda" },
    ]);
    const columnas = [
      { clave: "fecha", titulo: "Fecha", formato: "fecha" },
      { clave: "numeroVenta", titulo: "Venta", formato: "numero" },
      { clave: "clienteNombre", titulo: "Cliente" },
      { clave: "productos", titulo: "Productos" },
      { clave: "total", titulo: "Total", formato: "moneda", align: "right" },
      { clave: "costo", titulo: "Costo", formato: "moneda", align: "right" },
      { clave: "margen", titulo: "Margen", formato: "moneda", align: "right" },
      { clave: "formaPago", titulo: "Forma de pago" },
    ];
    renderizarTabla(document.getElementById("tabla-ventas"), {
      columnas,
      filas,
      totales: (f) => ({
        clienteNombre: "Total",
        total: formatMonto(f.reduce((a, r) => a + r.total, 0)),
        costo: formatMonto(f.reduce((a, r) => a + r.costo, 0)),
        margen: formatMonto(f.reduce((a, r) => a + r.margen, 0)),
      }),
    });
    renderizarExportar(exportarTop, {
      nombreArchivo,
      tituloReporte: reporte.titulo,
      periodoTexto,
      resumen: [
        { titulo: "Ventas totales", valor: formatMonto(actual.total) },
        { titulo: "Cantidad de operaciones", valor: String(actual.cantidad) },
        { titulo: "Unidades vendidas", valor: String(actual.unidades) },
        { titulo: "Ticket promedio", valor: formatMonto(actual.ticketPromedio) },
        { titulo: "Margen promedio", valor: `${margenPromedioPct.toFixed(1)}%` },
        { titulo: "Costo de mercadería", valor: formatMonto(costoMercaderia) },
        { titulo: "Ganancia bruta", valor: formatMonto(actual.margenBruto) },
      ],
      columnas,
      filas,
    });
    return;
  }

  if (tipo === "productos-mas-vendidos") {
    const productos = await reporteProductosMasVendidos(desde, hasta, 50);
    if (productos.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div style="height:${Math.max(Math.min(productos.length, 15) * 34, 120)}px"><canvas id="chart-productos"></canvas></div>
      </div>
      <div id="tabla-productos" class="card" style="padding:20px"></div>
    `;
    barChart("chart-productos", productos.slice(0, 15).map((p) => p.productoDescripcion), productos.slice(0, 15).map((p) => p.cantidad), false);
    const columnas = [
      { clave: "productoDescripcion", titulo: "Producto" },
      { clave: "cantidad", titulo: "Unidades vendidas", formato: "numero", align: "right" },
      { clave: "total", titulo: "Facturación", formato: "moneda", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-productos"), { columnas, filas: productos });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: productos });
    return;
  }

  if (tipo === "mejores-clientes") {
    const clientes = await reporteMejoresClientes(desde, hasta, 50);
    if (clientes.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div style="height:${Math.max(Math.min(clientes.length, 15) * 34, 120)}px"><canvas id="chart-clientes"></canvas></div>
      </div>
      <div id="tabla-clientes" class="card" style="padding:20px"></div>
    `;
    barChart("chart-clientes", clientes.slice(0, 15).map((c) => c.clienteNombre), clientes.slice(0, 15).map((c) => c.total));
    const columnas = [
      { clave: "clienteNombre", titulo: "Cliente" },
      { clave: "cantidad", titulo: "Cantidad de ventas", formato: "numero", align: "right" },
      { clave: "total", titulo: "Total", formato: "moneda", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-clientes"), { columnas, filas: clientes });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: clientes });
    return;
  }

  if (tipo === "clientes-detalle") {
    const clientes = await reporteClientesDetalle(desde, hasta);
    if (clientes.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Clientes con compras", String(clientes.length))}
        ${kpiCard("Total comprado", formatMonto(clientes.reduce((a, c) => a + c.totalComprado, 0)))}
      </div>
      <div id="tabla-clientes-detalle" class="card" style="padding:20px"></div>
    `;
    const columnas = [
      { clave: "clienteNombre", titulo: "Cliente" },
      { clave: "cantidadCompras", titulo: "Cantidad de compras", formato: "numero", align: "right" },
      { clave: "totalComprado", titulo: "Total comprado", formato: "moneda", align: "right" },
      { clave: "ticketPromedio", titulo: "Ticket promedio", formato: "moneda", align: "right" },
      { clave: "ultimaCompra", titulo: "Última compra", formato: "fecha" },
    ];
    renderizarTabla(document.getElementById("tabla-clientes-detalle"), { columnas, filas: clientes });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: clientes });
    return;
  }

  if (tipo === "formas-pago") {
    const medios = await reporteFormasDePago(desde, hasta);
    if (medios.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div class="section-title">Distribución por medio de pago</div>
        <div style="height:260px"><canvas id="chart-formas"></canvas></div>
      </div>
      <div id="tabla-formas" class="card" style="padding:20px"></div>
    `;
    pieChart("chart-formas", medios.map((m) => m.medio), medios.map((m) => m.importe));
    const columnas = [
      { clave: "medio", titulo: "Forma de pago" },
      { clave: "cantidad", titulo: "Cantidad de operaciones", formato: "numero", align: "right" },
      { clave: "importe", titulo: "Importe", formato: "moneda", align: "right" },
      { clave: "porcentaje", titulo: "% sobre ventas", formato: "porcentaje", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-formas"), {
      columnas,
      filas: medios,
      buscar: false,
      totales: (f) => ({
        medio: "Total",
        cantidad: f.reduce((a, r) => a + r.cantidad, 0),
        importe: formatMonto(f.reduce((a, r) => a + r.importe, 0)),
        porcentaje: `${f.reduce((a, r) => a + r.porcentaje, 0).toFixed(1)}%`,
      }),
    });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: medios });
    return;
  }

  if (tipo === "ventas-por-categoria") {
    const categorias = await reporteVentasPorCategoria(desde, hasta);
    if (categorias.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div style="height:${Math.max(categorias.length * 34, 120)}px"><canvas id="chart-categorias"></canvas></div>
      </div>
      <div id="tabla-categorias" class="card" style="padding:20px"></div>
    `;
    barChart("chart-categorias", categorias.map((c) => c.categoriaNombre), categorias.map((c) => c.ventas));
    const columnas = [
      { clave: "categoriaNombre", titulo: "Categoría" },
      { clave: "unidades", titulo: "Unidades", formato: "numero", align: "right" },
      { clave: "ventas", titulo: "Facturación", formato: "moneda", align: "right" },
      { clave: "costo", titulo: "Costo", formato: "moneda", align: "right" },
      { clave: "ganancia", titulo: "Ganancia", formato: "moneda", align: "right" },
      { clave: "margenPct", titulo: "Margen", formato: "porcentaje", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-categorias"), { columnas, filas: categorias });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: categorias });
    return;
  }

  if (tipo === "rentabilidad-categorias") {
    const categorias = await reporteVentasPorCategoria(desde, hasta);
    if (categorias.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div class="section-title">Ganancia por categoría</div>
        <div style="height:${Math.max(categorias.length * 34, 120)}px"><canvas id="chart-rent-cat"></canvas></div>
      </div>
      <div id="tabla-rent-cat" class="card" style="padding:20px"></div>
    `;
    barChart(
      "chart-rent-cat",
      [...categorias].sort((a, b) => b.ganancia - a.ganancia).map((c) => c.categoriaNombre),
      [...categorias].sort((a, b) => b.ganancia - a.ganancia).map((c) => c.ganancia)
    );
    const columnas = [
      { clave: "categoriaNombre", titulo: "Categoría" },
      { clave: "ventas", titulo: "Ventas", formato: "moneda", align: "right" },
      { clave: "costo", titulo: "Costo", formato: "moneda", align: "right" },
      { clave: "ganancia", titulo: "Ganancia", formato: "moneda", align: "right" },
      { clave: "margenPct", titulo: "Margen", formato: "porcentaje", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-rent-cat"), { columnas, filas: categorias });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: categorias });
    return;
  }

  if (tipo === "rentabilidad-productos") {
    const productos = await reporteRentabilidadPorProducto(desde, hasta, 100);
    if (productos.length === 0) {
      renderizarSinDatos(contenedor, "No hay ventas registradas en el período elegido.");
      return;
    }
    contenedor.innerHTML = `
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div class="section-title">Productos con mayor ganancia</div>
        <div style="height:${Math.max(Math.min(productos.length, 15) * 34, 120)}px"><canvas id="chart-rent-prod"></canvas></div>
      </div>
      <div id="tabla-rent-prod" class="card" style="padding:20px"></div>
    `;
    barChart("chart-rent-prod", productos.slice(0, 15).map((p) => p.productoDescripcion), productos.slice(0, 15).map((p) => p.ganancia));
    const columnas = [
      { clave: "productoDescripcion", titulo: "Producto" },
      { clave: "ventas", titulo: "Ventas", formato: "moneda", align: "right" },
      { clave: "costo", titulo: "Costo", formato: "moneda", align: "right" },
      { clave: "ganancia", titulo: "Ganancia", formato: "moneda", align: "right" },
      { clave: "margenPct", titulo: "Margen", formato: "porcentaje", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-rent-prod"), { columnas, filas: productos });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto, columnas, filas: productos });
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
      ${seccionComparacion()}
      <div class="hint">Margen = precio de venta menos el costo del producto al momento exacto de venderse (no el costo actual) — así el número no se corre si el costo cambió después. Para el detalle por producto o categoría, ver "Rentabilidad por producto" y "Rentabilidad por categoría".</div>
    `;
    montarComparacion([
      { titulo: "Ventas", actual: actual.total, anterior: anterior.total, formato: "moneda" },
      { titulo: "Costo", actual: costoTotal, anterior: anterior.total - anterior.margenBruto, formato: "moneda" },
      { titulo: "Margen bruto", actual: actual.margenBruto, anterior: anterior.margenBruto, formato: "moneda" },
    ]);
    renderizarExportar(exportarTop, {
      nombreArchivo,
      tituloReporte: reporte.titulo,
      periodoTexto,
      resumen: [
        { titulo: "Ventas", valor: formatMonto(actual.total) },
        { titulo: "Costo", valor: formatMonto(costoTotal) },
        { titulo: "Margen bruto", valor: formatMonto(actual.margenBruto) },
        { titulo: "Margen sobre ventas", valor: `${margenPct.toFixed(1)}%` },
      ],
    });
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

  if (tipo === "stock-critico") {
    const productos = await reporteStockCritico();
    if (productos.length === 0) {
      contenedor.innerHTML = `<div class="card empty-state">Ningún producto activo está en o por debajo de su stock mínimo.</div>`;
      return;
    }
    const columnas = [
      { clave: "sku", titulo: "SKU" },
      { clave: "descripcion", titulo: "Producto" },
      { clave: "stockTotal", titulo: "Stock", formato: "numero", align: "right" },
      { clave: "stockMinimo", titulo: "Mínimo", formato: "numero", align: "right" },
    ];
    contenedor.innerHTML = `<div id="tabla-stock-critico" class="card" style="padding:20px"></div>`;
    renderizarTabla(document.getElementById("tabla-stock-critico"), { columnas, filas: productos });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto: "", columnas, filas: productos });
    return;
  }

  if (tipo === "facturas-vencer") {
    const facturas = await reporteFacturasPorVencer();
    if (facturas.length === 0) {
      contenedor.innerHTML = `<div class="card empty-state">No hay facturas de compra con saldo pendiente.</div>`;
      return;
    }
    const columnas = [
      { clave: "proveedorNombre", titulo: "Proveedor" },
      { clave: "numeroFactura", titulo: "Comprobante" },
      { clave: "fechaVencimiento", titulo: "Vencimiento", formato: "fecha" },
      { clave: "saldo", titulo: "Saldo", formato: "moneda", align: "right" },
    ];
    contenedor.innerHTML = `<div id="tabla-facturas" class="card" style="padding:20px"></div>`;
    renderizarTabla(document.getElementById("tabla-facturas"), { columnas, filas: facturas });
    renderizarExportar(exportarTop, { nombreArchivo, tituloReporte: reporte.titulo, periodoTexto: "", columnas, filas: facturas });
    return;
  }

  if (tipo === "valorizacion-stock") {
    const { total, principales } = await reporteValorizacionStock(50);
    contenedor.innerHTML = `
      <div class="dashboard-grid" style="margin-bottom:16px">
        ${kpiCard("Capital inmovilizado en stock", formatMonto(total))}
      </div>
      <div class="card" style="padding:20px; margin-bottom:16px">
        <div class="section-title">Productos con mayor valorización</div>
        <div id="empty" class="hint" style="display:${principales.length ? "none" : "block"}">Sin stock valorizado todavía.</div>
        <div style="height:${Math.max(Math.min(principales.length, 15) * 34, 120)}px"><canvas id="chart-valorizacion"></canvas></div>
      </div>
      <div id="tabla-valorizacion" class="card" style="padding:20px"></div>
    `;
    barChart("chart-valorizacion", principales.slice(0, 15).map((p) => p.productoDescripcion), principales.slice(0, 15).map((p) => p.valorizado));
    const columnas = [
      { clave: "productoDescripcion", titulo: "Producto" },
      { clave: "stockTotal", titulo: "Stock", formato: "numero", align: "right" },
      { clave: "costoReferencia", titulo: "Costo unitario", formato: "moneda", align: "right" },
      { clave: "valorizado", titulo: "Valorizado", formato: "moneda", align: "right" },
    ];
    renderizarTabla(document.getElementById("tabla-valorizacion"), { columnas, filas: principales });
    renderizarExportar(exportarTop, {
      nombreArchivo,
      tituloReporte: reporte.titulo,
      periodoTexto: "",
      resumen: [{ titulo: "Capital inmovilizado en stock", valor: formatMonto(total) }],
      columnas,
      filas: principales,
    });
    return;
  }

  if (tipo === "fletes") {
    const resultado = await reporteFletes();
    renderizarSinDatos(contenedor, resultado.motivo);
    return;
  }
}

// --- Control de período: presets + rango personalizado ---------------------------------------
function obtenerRango() {
  const periodoSelect = document.getElementById("periodo-select");
  if (periodoSelect.value === "Personalizado") {
    const desde = document.getElementById("fecha-desde").value;
    const hasta = document.getElementById("fecha-hasta").value;
    if (desde && hasta) return rangoPeriodo("Personalizado", { desde, hasta });
  }
  return rangoPeriodo(periodoSelect.value);
}

if (!SIN_PERIODO) {
  const periodoSelect = document.getElementById("periodo-select");
  const fechaDesde = document.getElementById("fecha-desde");
  const fechaHasta = document.getElementById("fecha-hasta");
  const fechaHastaLabel = document.getElementById("fecha-hasta-label");

  periodoSelect.addEventListener("change", () => {
    const personalizado = periodoSelect.value === "Personalizado";
    fechaDesde.style.display = personalizado ? "" : "none";
    fechaHasta.style.display = personalizado ? "" : "none";
    fechaHastaLabel.style.display = personalizado ? "" : "none";
    if (personalizado && !fechaDesde.value) {
      const { desde, hasta } = rangoPeriodo("Este mes");
      fechaDesde.value = desde;
      fechaHasta.value = hasta;
    }
    if (!personalizado || (fechaDesde.value && fechaHasta.value)) cargar();
  });
  fechaDesde.addEventListener("change", () => fechaDesde.value && fechaHasta.value && cargar());
  fechaHasta.addEventListener("change", () => fechaDesde.value && fechaHasta.value && cargar());
}

cargar();
