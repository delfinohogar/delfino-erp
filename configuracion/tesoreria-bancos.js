// Definición de bancos y cuentas ("¿qué bancos y cuentas usa la empresa?") — separado de la
// operación (movimientos/conciliación), que vive en Tesorería → Bancos.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarBancos, crearBanco, actualizarBanco, listarCuentasBancarias, crearCuentaBancaria, actualizarCuentaBancaria, saldoActualCuenta } from "/js/bancos.js";
import { listarSucursalesActivas } from "/js/sucursales.js";
import { pedirCamposModal } from "/js/modal.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "configuracion", titulo: "Bancos", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

const sucursales = await listarSucursalesActivas();

content.innerHTML = `
  <div class="toolbar">
    <a href="/configuracion/index.html" class="link-btn">← Configuración</a>
    <button type="button" id="btn-nuevo-banco">+ Nuevo banco</button>
    <button type="button" id="btn-nueva-cuenta" class="primary">+ Nueva cuenta</button>
  </div>
  <div class="hint" style="margin-bottom:12px; max-width:64ch">
    Acá se define qué bancos y cuentas usa la empresa. Para ver movimientos, saldos y conciliar, andá
    a <a href="/tesoreria/bancos.html">Tesorería → Bancos</a>.
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead><tr><th>Banco</th><th>Cuenta</th><th>Alias/CBU</th><th>Sucursal</th><th>Estado</th><th style="text-align:right">Saldo</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay cuentas bancarias cargadas.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const cuentas = await listarCuentasBancarias();
  emptyState.style.display = cuentas.length === 0 ? "block" : "none";
  const filas = await Promise.all(cuentas.map(async (c) => ({ cuenta: c, saldo: await saldoActualCuenta(c.id) })));
  tbody.innerHTML = filas
    .map(
      ({ cuenta, saldo }) => `
    <tr>
      <td>${cuenta.bancoNombre}</td>
      <td>${cuenta.nombre}</td>
      <td>${cuenta.alias || cuenta.cbu || cuenta.numeroCuenta || "-"}</td>
      <td>${cuenta.sucursalNombre || "-"}</td>
      <td>${cuenta.activa !== false ? '<span class="badge success">Activa</span>' : '<span class="badge muted">Inactiva</span>'}</td>
      <td style="text-align:right">${formatMonto(saldo)}</td>
      <td><button type="button" data-toggle="${cuenta.id}" data-activa="${cuenta.activa !== false}">${cuenta.activa !== false ? "Desactivar" : "Activar"}</button></td>
    </tr>
  `
    )
    .join("");
  tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await actualizarCuentaBancaria(btn.dataset.toggle, { activa: btn.dataset.activa !== "true" });
      cargar();
    });
  });
}

document.getElementById("btn-nuevo-banco").addEventListener("click", async () => {
  const datos = await pedirCamposModal("Nuevo banco", [{ name: "nombre", label: "Nombre del banco", required: true }]);
  if (!datos) return;
  await crearBanco(datos.nombre);
  alert("Banco creado — ya lo podés elegir al crear una cuenta.");
});

document.getElementById("btn-nueva-cuenta").addEventListener("click", async () => {
  const bancos = await listarBancos();
  if (bancos.length === 0) {
    alert("Primero creá un banco (ej. 'Banco Galicia', o 'Mercado Pago' si querés trackear la billetera de MP como una cuenta más).");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Nueva cuenta bancaria</div>
      <form id="form-cuenta">
        <div class="field">
          <label for="cb-banco">Banco</label>
          <select id="cb-banco" required>${bancos.map((b) => `<option value="${b.id}" data-nombre="${b.nombre}">${b.nombre}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="cb-nombre">Nombre de la cuenta</label>
          <input type="text" id="cb-nombre" placeholder="Ej. Cuenta corriente" required />
        </div>
        <div class="field-row">
          <div class="field"><label for="cb-alias">Alias</label><input type="text" id="cb-alias" /></div>
          <div class="field"><label for="cb-cbu">CBU</label><input type="text" id="cb-cbu" /></div>
        </div>
        <div class="field">
          <label for="cb-sucursal">Sucursal (opcional)</label>
          <select id="cb-sucursal"><option value="">Sin asignar</option>${sucursales.map((s) => `<option value="${s.id}" data-nombre="${s.nombre}">${s.nombre}</option>`).join("")}</select>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Crear</button>
          <button type="button" id="cb-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#cb-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-cuenta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bancoSel = overlay.querySelector("#cb-banco");
    const sucSel = overlay.querySelector("#cb-sucursal");
    await crearCuentaBancaria({
      bancoId: bancoSel.value,
      bancoNombre: bancoSel.selectedOptions[0].dataset.nombre,
      nombre: overlay.querySelector("#cb-nombre").value,
      alias: overlay.querySelector("#cb-alias").value,
      cbu: overlay.querySelector("#cb-cbu").value,
      sucursalId: sucSel.value || null,
      sucursalNombre: sucSel.value ? sucSel.selectedOptions[0].dataset.nombre : null,
    });
    overlay.remove();
    cargar();
  });
});

cargar();
