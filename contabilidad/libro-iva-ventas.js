import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { PERIODOS, rangoPeriodo } from "/js/dashboard.js";
import { libroIvaVentas } from "/js/libro-iva.js";
import { renderizarTabla, renderizarExportar } from "/js/report-engine.js";
import { formatMoneda as formatMonto } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-libro-iva-ventas", titulo: "Libro IVA Ventas", usuario });

content.innerHTML = `
  <div class="toolbar">
    <select id="periodo-select">
      ${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}
    </select>
  </div>
  <div id="resumen" class="dashboard-grid" style="margin-bottom:16px"></div>
  <div class="card">
    <div id="exportar-top" style="margin-bottom:12px"></div>
    <div id="tabla"></div>
  </div>
`;

const columnas = [
  { clave: "fecha", titulo: "Fecha", formato: "fecha" },
  { clave: "letra", titulo: "Letra" },
  { clave: "numeroCompleto", titulo: "Comprobante" },
  { clave: "clienteNombre", titulo: "Cliente" },
  { clave: "clienteCuit", titulo: "CUIT" },
  { clave: "neto", titulo: "Neto", formato: "moneda", align: "right" },
  { clave: "iva", titulo: "IVA", formato: "moneda", align: "right" },
  { clave: "total", titulo: "Total", formato: "moneda", align: "right" },
];

async function cargar() {
  const { desde, hasta } = rangoPeriodo(document.getElementById("periodo-select").value);
  const { filas, totales } = await libroIvaVentas(desde, hasta);

  document.getElementById("resumen").innerHTML = `
    <div class="card dashboard-card"><div class="hint mt-0">Neto gravado</div><div class="dashboard-card-valor">${formatMonto(totales.neto)}</div></div>
    <div class="card dashboard-card"><div class="hint mt-0">IVA Débito Fiscal</div><div class="dashboard-card-valor">${formatMonto(totales.iva)}</div></div>
    <div class="card dashboard-card"><div class="hint mt-0">Total facturado</div><div class="dashboard-card-valor">${formatMonto(totales.total)}</div></div>
  `;

  renderizarTabla(document.getElementById("tabla"), {
    columnas,
    filas,
    totales: (datos) => ({
      fecha: "Total",
      neto: formatMonto(datos.reduce((acc, f) => acc + f.neto, 0)),
      iva: formatMonto(datos.reduce((acc, f) => acc + f.iva, 0)),
      total: formatMonto(datos.reduce((acc, f) => acc + f.total, 0)),
    }),
  });
  renderizarExportar(document.getElementById("exportar-top"), {
    nombreArchivo: `libro-iva-ventas-${desde}-a-${hasta}`,
    tituloReporte: "Libro IVA Ventas",
    periodoTexto: `${desde} a ${hasta}`,
    columnas,
    filas,
  });
}

document.getElementById("periodo-select").addEventListener("change", cargar);
cargar();
