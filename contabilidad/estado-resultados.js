import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { PERIODOS, rangoPeriodo } from "/js/dashboard.js";
import { obtenerEstadoResultados } from "/js/contabilidad.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-estado-resultados", titulo: "Estado de Resultados", usuario });

content.innerHTML = `
  <div class="toolbar">
    <select id="periodo-select">
      ${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}
    </select>
  </div>
  <div id="resultado"></div>
`;

function formatMonto(v) {
  return `$${Math.round(v).toLocaleString("es-AR")}`;
}

function filaHtml(titulo, monto, negrita = false) {
  return `<tr><td style="font-weight:${negrita ? "600" : "400"}">${titulo}</td><td style="text-align:right; font-weight:${negrita ? "600" : "400"}">${formatMonto(monto)}</td></tr>`;
}

async function cargar() {
  const { desde, hasta } = rangoPeriodo(document.getElementById("periodo-select").value);
  const { ingresos, egresos, totalIngresos, totalEgresos, resultado } = await obtenerEstadoResultados(desde, hasta);

  document.getElementById("resultado").innerHTML = `
    <div class="card" style="padding:20px; max-width:520px">
      <div class="table-scroll">
        <table>
          <tbody>
            <tr><td colspan="2" class="section-title" style="padding-top:0">Ingresos</td></tr>
            ${ingresos.map((c) => filaHtml(c.nombre, c.monto)).join("")}
            ${filaHtml("Total Ingresos", totalIngresos, true)}
            <tr><td colspan="2" class="section-title">Egresos</td></tr>
            ${egresos.map((c) => filaHtml(c.nombre, c.monto)).join("")}
            ${filaHtml("Total Egresos", totalEgresos, true)}
          </tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:16px; border-top:1px solid var(--border)">
        <span style="font-weight:600">Resultado del período</span>
        <span style="font-size:20px; font-weight:600; color:var(--${resultado >= 0 ? "success" : "danger"})">${formatMonto(resultado)}</span>
      </div>
    </div>
  `;
}

document.getElementById("periodo-select").addEventListener("change", cargar);
cargar();
