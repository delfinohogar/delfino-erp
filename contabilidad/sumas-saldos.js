import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerSumasYSaldos } from "/js/contabilidad.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "contabilidad-sumas-saldos", titulo: "Sumas y Saldos", usuario });

content.innerHTML = `
  <div class="hint" style="margin-bottom:12px">
    Acumulado histórico de todos los asientos — no depende de un período. Las cuentas agrupadoras
    (en negrita) no reciben movimientos directos, solo ordenan el árbol.
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>Código</th><th>Cuenta</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
  </div>
`;

async function cargar() {
  const cuentas = await obtenerSumasYSaldos();
  const tablaBody = document.getElementById("tabla-body");
  tablaBody.innerHTML = cuentas
    .map((c) => {
      const nivel = c.codigo.split(".").length - 1;
      return `
      <tr>
        <td>${c.codigo}</td>
        <td style="padding-left:${nivel * 16}px; font-weight:${c.imputable ? "400" : "600"}">${c.nombre}</td>
        <td>${c.debe ? c.debe.toLocaleString("es-AR") : ""}</td>
        <td>${c.haber ? c.haber.toLocaleString("es-AR") : ""}</td>
        <td style="font-weight:${c.imputable ? "400" : "600"}">${c.saldo ? c.saldo.toLocaleString("es-AR") : ""}</td>
      </tr>
    `;
    })
    .join("");
}

cargar();
