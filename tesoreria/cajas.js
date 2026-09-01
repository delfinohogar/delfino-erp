import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCajas, crearCaja, actualizarCaja, TIPOS_CAJA, saldoActualCaja } from "/js/cajas.js";
import { listarSucursalesActivas } from "/js/sucursales.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-cajas", titulo: "Cajas", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

const sucursales = await listarSucursalesActivas();

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
    ${usuario.rol === "administrador" ? '<button type="button" id="btn-nueva" class="primary">+ Nueva caja</button>' : ""}
  </div>
  ${sucursales.length === 0 ? '<div class="hint" style="margin-bottom:12px">Todavía no hay sucursales activas — cargá al menos una en <a href="/configuracion/sucursales.html">Configuración → Sucursales</a> antes de crear cajas.</div>' : ""}
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead><tr><th>Sucursal</th><th>Caja</th><th>Tipo</th><th>Estado</th><th style="text-align:right">Saldo</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay cajas creadas.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const cajas = await listarCajas();
  emptyState.style.display = cajas.length === 0 ? "block" : "none";
  const filas = await Promise.all(
    cajas.map(async (caja) => {
      const { saldo, sesion } = await saldoActualCaja(caja);
      return { caja, saldo, abierta: sesion?.estado === "abierta" };
    })
  );
  tbody.innerHTML = filas
    .map(
      ({ caja, saldo, abierta }) => `
    <tr style="cursor:pointer" data-id="${caja.id}">
      <td>${caja.sucursalNombre || "-"}</td>
      <td>${caja.nombre}</td>
      <td>${caja.tipo}</td>
      <td>${abierta ? '<span class="badge success">Abierta</span>' : '<span class="badge muted">Cerrada</span>'}${caja.activa === false ? ' <span class="badge danger">Inactiva</span>' : ""}</td>
      <td style="text-align:right">${formatMonto(saldo)}</td>
      <td style="white-space:nowrap">
        <a href="/tesoreria/caja-ficha.html?id=${caja.id}"><button type="button">Abrir</button></a>
        ${usuario.rol === "administrador" ? `<button type="button" data-toggle="${caja.id}" data-activa="${caja.activa !== false}">${caja.activa !== false ? "Desactivar" : "Activar"}</button>` : ""}
      </td>
    </tr>
  `
    )
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      location.href = `/tesoreria/caja-ficha.html?id=${tr.dataset.id}`;
    });
  });
  tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await actualizarCaja(btn.dataset.toggle, { activa: btn.dataset.activa !== "true" });
      cargar();
    });
  });
}

document.getElementById("btn-nueva")?.addEventListener("click", () => {
  if (sucursales.length === 0) {
    alert("Cargá al menos una sucursal activa en Configuración → Sucursales antes de crear una caja.");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Nueva caja</div>
      <form id="form-caja">
        <div class="field">
          <label for="c-sucursal">Sucursal</label>
          <select id="c-sucursal" required>${sucursales.map((s) => `<option value="${s.id}" data-nombre="${s.nombre}">${s.nombre}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="c-nombre">Nombre</label>
          <input type="text" id="c-nombre" placeholder="Caja 1" required />
        </div>
        <div class="field">
          <label for="c-tipo">Tipo</label>
          <select id="c-tipo">${TIPOS_CAJA.map((t) => `<option>${t}</option>`).join("")}</select>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Crear</button>
          <button type="button" id="c-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#c-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-caja").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sel = overlay.querySelector("#c-sucursal");
    await crearCaja({
      nombre: overlay.querySelector("#c-nombre").value,
      sucursalId: sel.value,
      sucursalNombre: sel.selectedOptions[0].dataset.nombre,
      tipo: overlay.querySelector("#c-tipo").value,
    });
    overlay.remove();
    cargar();
  });
});

cargar();
