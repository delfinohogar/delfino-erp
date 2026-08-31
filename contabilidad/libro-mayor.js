import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarPlanDeCuentas, obtenerLibroMayor } from "/js/contabilidad.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-libro-mayor", titulo: "Libro Mayor", usuario });

content.innerHTML = `
  <div class="toolbar">
    <select id="cuenta-select" style="min-width:280px"></select>
  </div>
  <div id="resultado"></div>
`;

const cuentas = (await listarPlanDeCuentas()).filter((c) => c.imputable);
const select = document.getElementById("cuenta-select");
select.innerHTML = cuentas.map((c) => `<option value="${c.codigo}">${c.codigo} — ${c.nombre}</option>`).join("");

function formatFecha(fecha) {
  return fecha ? new Date(fecha).toLocaleDateString("es-AR") : "-";
}

async function cargar() {
  const resultado = document.getElementById("resultado");
  resultado.innerHTML = `<div class="hint" style="padding:16px">Cargando…</div>`;
  const { movimientos } = await obtenerLibroMayor(select.value);

  if (movimientos.length === 0) {
    resultado.innerHTML = `<div class="empty-state">Esta cuenta todavía no tiene movimientos.</div>`;
    return;
  }

  resultado.innerHTML = `
    <div class="card">
      <div class="table-scroll">
        <table>
          <thead>
            <tr><th>Fecha</th><th>Asiento</th><th>Descripción</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr>
          </thead>
          <tbody>
            ${movimientos
              .map(
                (m) => `
              <tr>
                <td>${formatFecha(m.fecha)}</td>
                <td>#${m.numero}</td>
                <td>${m.descripcion}</td>
                <td>${m.debe ? m.debe.toLocaleString("es-AR") : ""}</td>
                <td>${m.haber ? m.haber.toLocaleString("es-AR") : ""}</td>
                <td>${m.saldo.toLocaleString("es-AR")}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

select.addEventListener("change", cargar);
cargar();
