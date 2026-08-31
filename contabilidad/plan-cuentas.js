import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarPlanDeCuentas } from "/js/contabilidad.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-plan-cuentas", titulo: "Plan de Cuentas", usuario });

content.innerHTML = `
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Cuenta</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">
      Todavía no se sembró el plan de cuentas. Contactá a un administrador.
    </div>
  </div>
`;

const TIPO_LABEL = { activo: "Activo", pasivo: "Pasivo", patrimonio: "Patrimonio Neto", ingreso: "Ingreso", egreso: "Egreso" };

async function cargar() {
  const cuentas = await listarPlanDeCuentas();
  const tablaBody = document.getElementById("tabla-body");
  document.getElementById("empty-state").style.display = cuentas.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";
  cuentas.forEach((c) => {
    const nivel = c.codigo.split(".").length - 1;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.codigo}</td>
      <td style="padding-left:${20 + nivel * 20}px; font-weight:${c.imputable ? "400" : "600"}">${c.nombre}</td>
      <td class="hint">${TIPO_LABEL[c.tipo] || c.tipo}</td>
    `;
    tablaBody.appendChild(tr);
  });
}

cargar();
