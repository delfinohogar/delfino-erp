import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarAsientosPagina, listarPlanDeCuentas } from "/js/contabilidad.js";
import { formatMoneda } from "/js/formato.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-libro-diario", titulo: "Libro Diario", usuario });

content.innerHTML = `
  <div id="lista-asientos"></div>
  <div class="toolbar" id="paginacion" style="justify-content:center; display:none">
    <button type="button" id="btn-mas">Cargar más asientos</button>
  </div>
`;

// El asiento guarda el código de cuenta ("1.1.1"); mostrar el nombre evita tener que memorizar el
// plan de cuentas para leer el Libro Diario.
const NOMBRE_CUENTA = new Map((await listarPlanDeCuentas()).map((c) => [c.codigo, c.nombre]));

function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}

// Antes mostraba el número pelado, sin "$" y con decimales inconsistentes (toLocaleString sin
// fijar cantidad de decimales) — en un libro contable eso es peor que en cualquier otra pantalla.
function formatMonto(v) {
  return v ? formatMoneda(v, { decimales: 2 }) : "";
}

const contenedor = document.getElementById("lista-asientos");
const paginacion = document.getElementById("paginacion");
const btnMas = document.getElementById("btn-mas");

let cursor = null;
let vacio = true;

function pintar(asientos) {
  contenedor.insertAdjacentHTML(
    "beforeend",
    asientos
      .map(
        (a) => `
    <div class="card" style="padding:16px; margin-bottom:12px">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px">
        <div><strong>#${a.numero}</strong> — ${escapeHtml(a.descripcion)}</div>
        <span class="hint mt-0">${formatFecha(a.fecha)}</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead>
          <tbody>
            ${a.movimientos
              .map(
                (m) =>
                  `<tr><td>${NOMBRE_CUENTA.get(m.cuenta) || m.cuenta} <span class="hint">${m.cuenta}</span></td><td class="num">${formatMonto(m.debe)}</td><td class="num">${formatMonto(m.haber)}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `
      )
      .join("")
  );
}

async function cargarPagina() {
  btnMas.disabled = true;
  btnMas.textContent = "Cargando…";
  try {
    const { asientos, cursor: siguiente, hayMas } = await listarAsientosPagina({ cursor });
    if (asientos.length > 0) {
      vacio = false;
      pintar(asientos);
      cursor = siguiente;
    }
    if (vacio) {
      contenedor.innerHTML = `<div class="empty-state">Todavía no hay asientos contables. Se generan solos con cada venta, compra, cobro o pago.</div>`;
    }
    paginacion.style.display = hayMas ? "flex" : "none";
  } finally {
    btnMas.disabled = false;
    btnMas.textContent = "Cargar más asientos";
  }
}

btnMas.addEventListener("click", cargarPagina);
cargarPagina();
