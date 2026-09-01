// Vista operativa: qué cajas hay y cuánto tienen, para abrir/cerrar/consultar movimientos. Crear una
// caja nueva o desactivarla es Configuración → Tesorería → Cajas (configuracion/tesoreria-cajas.js).
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarCajas, saldoActualCaja } from "/js/cajas.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-cajas", titulo: "Cajas", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
    ${usuario.rol === "administrador" ? '<a href="/configuracion/tesoreria-cajas.html"><button type="button">⚙️ Administrar cajas</button></a>' : ""}
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead><tr><th>Sucursal</th><th>Caja</th><th>Tipo</th><th>Estado</th><th class="num">Saldo</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay cajas creadas.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const cajas = (await listarCajas()).filter((c) => c.activa !== false);
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
      <td>${abierta ? '<span class="badge success">Abierta</span>' : '<span class="badge muted">Cerrada</span>'}</td>
      <td class="num">${formatMonto(saldo)}</td>
      <td><a href="/tesoreria/caja-ficha.html?id=${caja.id}"><button type="button">${abierta ? "Ver" : "Abrir"}</button></a></td>
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
}

cargar();
