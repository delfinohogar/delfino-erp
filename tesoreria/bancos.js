// Vista operativa: qué cuentas hay y cuánto tienen, para ver movimientos y conciliar. Crear un banco
// o una cuenta nueva es Configuración → Tesorería → Bancos (configuracion/tesoreria-bancos.js).
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCuentasBancariasActivas, saldoActualCuenta } from "/js/bancos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-bancos", titulo: "Bancos", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
    ${usuario.rol === "administrador" ? '<a href="/configuracion/tesoreria-bancos.html"><button type="button">⚙️ Administrar bancos</button></a>' : ""}
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead><tr><th>Banco</th><th>Cuenta</th><th>Alias/CBU</th><th>Sucursal</th><th style="text-align:right">Saldo</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay cuentas bancarias cargadas.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const cuentas = await listarCuentasBancariasActivas();
  emptyState.style.display = cuentas.length === 0 ? "block" : "none";
  const filas = await Promise.all(cuentas.map(async (c) => ({ cuenta: c, saldo: await saldoActualCuenta(c.id) })));
  tbody.innerHTML = filas
    .map(
      ({ cuenta, saldo }) => `
    <tr style="cursor:pointer" data-id="${cuenta.id}">
      <td>${cuenta.bancoNombre}</td>
      <td>${cuenta.nombre}</td>
      <td>${cuenta.alias || cuenta.cbu || cuenta.numeroCuenta || "-"}</td>
      <td>${cuenta.sucursalNombre || "-"}</td>
      <td style="text-align:right">${formatMonto(saldo)}</td>
      <td><a href="/tesoreria/cuenta-ficha.html?id=${cuenta.id}"><button type="button">Ver</button></a></td>
    </tr>
  `
    )
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      location.href = `/tesoreria/cuenta-ficha.html?id=${tr.dataset.id}`;
    })
  );
}

cargar();
