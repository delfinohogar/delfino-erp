import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarAsientos } from "/js/contabilidad.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-libro-diario", titulo: "Libro Diario", usuario });

content.innerHTML = `<div id="lista-asientos"></div>`;

function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}

function formatMonto(v) {
  return v ? v.toLocaleString("es-AR") : "";
}

async function cargar() {
  const contenedor = document.getElementById("lista-asientos");
  const asientos = await listarAsientos();
  if (asientos.length === 0) {
    contenedor.innerHTML = `<div class="empty-state">Todavía no hay asientos contables. Se generan solos con cada venta, compra, cobro o pago.</div>`;
    return;
  }
  contenedor.innerHTML = asientos
    .map(
      (a) => `
    <div class="card" style="padding:16px; margin-bottom:12px">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px">
        <div>
          <strong>#${a.numero}</strong> — ${a.descripcion}
        </div>
        <span class="hint" style="margin:0">${formatFecha(a.fecha)}</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Cuenta</th><th>Debe</th><th>Haber</th></tr></thead>
          <tbody>
            ${a.movimientos
              .map(
                (m) =>
                  `<tr><td>${m.cuenta}</td><td>${formatMonto(m.debe)}</td><td>${formatMonto(m.haber)}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `
    )
    .join("");
}

cargar();
