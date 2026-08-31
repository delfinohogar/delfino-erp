import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { guardarDashboardCards } from "/js/usuarios.js";
import { db, doc, getDoc } from "/js/firebase.js";
import {
  TARJETAS_DASHBOARD,
  PERIODOS,
  rangoPeriodo,
  obtenerVentasPeriodo,
  obtenerStockCritico,
  obtenerSaldoClientes,
  obtenerCuentaProveedores,
} from "/js/dashboard.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "dashboard", titulo: "Dashboard", usuario });

content.innerHTML = `
  <div class="toolbar">
    <select id="periodo-select">
      ${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}
    </select>
    <button type="button" id="btn-personalizar">Personalizar</button>
  </div>
  <div id="tarjetas-grid" class="dashboard-grid"></div>
`;

const grid = document.getElementById("tarjetas-grid");
const periodoSelect = document.getElementById("periodo-select");

// Config guardada en el perfil (usuarios/{uid}.dashboardCards) — viaja con la cuenta entre PCs.
// Sin config guardada todavía, se muestran todas.
const perfilSnap = await getDoc(doc(db, "usuarios", usuario.uid));
let cardsVisibles = perfilSnap.data()?.dashboardCards || TARJETAS_DASHBOARD.map((t) => t.id);

function formatMonto(valor) {
  return `$${Math.round(valor).toLocaleString("es-AR")}`;
}

function variacion(actual, anterior) {
  if (!anterior) return null;
  const pct = ((actual - anterior) / anterior) * 100;
  const signo = pct >= 0 ? "+" : "";
  return { texto: `${signo}${pct.toFixed(1)}% vs. período anterior`, positivo: pct >= 0 };
}

function tarjetaHtml({ titulo, valor, comparacion, href }) {
  return `
    <a href="${href}" class="card dashboard-card">
      <div class="hint" style="margin:0">${titulo}</div>
      <div class="dashboard-card-valor">${valor}</div>
      ${
        comparacion
          ? `<div class="hint" style="color:var(--${comparacion.positivo ? "success" : "danger"})">${comparacion.texto}</div>`
          : ""
      }
    </a>
  `;
}

async function cargar() {
  grid.innerHTML = `<div class="hint" style="padding:24px">Cargando…</div>`;

  const { desde, hasta, desdeAnterior, hastaAnterior } = rangoPeriodo(periodoSelect.value);
  const [ventasActual, ventasAnterior, stockCritico, saldoClientes, cuentaProveedores] = await Promise.all([
    obtenerVentasPeriodo(desde, hasta),
    obtenerVentasPeriodo(desdeAnterior, hastaAnterior),
    obtenerStockCritico(),
    obtenerSaldoClientes(),
    obtenerCuentaProveedores(),
  ]);

  const datosPorTarjeta = {
    "ventas-totales": {
      titulo: "Ventas totales",
      valor: formatMonto(ventasActual.total),
      comparacion: variacion(ventasActual.total, ventasAnterior.total),
      href: "/productos/ventas.html",
    },
    "cantidad-ventas": {
      titulo: "Cantidad de ventas",
      valor: String(ventasActual.cantidad),
      comparacion: variacion(ventasActual.cantidad, ventasAnterior.cantidad),
      href: "/productos/ventas.html",
    },
    "stock-critico": {
      titulo: "Stock crítico",
      valor: String(stockCritico.cantidad),
      href: "/productos/inventario.html",
    },
    "cuentas-cobrar": {
      titulo: "Cuentas por cobrar",
      valor: formatMonto(saldoClientes.saldoTotal),
      href: "/productos/cuenta-corriente-clientes.html",
    },
    "cuentas-pagar": {
      titulo: "Cuentas por pagar",
      valor: formatMonto(cuentaProveedores.saldoTotal),
      href: "/productos/cuenta-corriente.html",
    },
    "facturas-vencer": {
      titulo: "Facturas próximas a vencer (7 días)",
      valor: String(cuentaProveedores.facturasPorVencer),
      href: "/productos/compras.html",
    },
  };

  const visibles = TARJETAS_DASHBOARD.filter((t) => cardsVisibles.includes(t.id));
  if (visibles.length === 0) {
    grid.innerHTML = `<div class="empty-state">No hay tarjetas para mostrar. Usá "Personalizar" para elegir cuáles ver.</div>`;
    return;
  }
  grid.innerHTML = visibles.map((t) => tarjetaHtml(datosPorTarjeta[t.id])).join("");
}

periodoSelect.addEventListener("change", cargar);

function abrirPersonalizar() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Personalizar Dashboard</div>
      <form id="personalizar-form">
        ${TARJETAS_DASHBOARD.map(
          (t) => `
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:400; margin-bottom:10px; color:var(--foreground)">
            <input type="checkbox" name="tarjeta" value="${t.id}" ${cardsVisibles.includes(t.id) ? "checked" : ""} />
            ${t.titulo}
          </label>
        `
        ).join("")}
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Guardar</button>
          <button type="button" id="personalizar-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();
  overlay.querySelector("#personalizar-cancelar").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  overlay.querySelector("#personalizar-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const seleccionadas = Array.from(overlay.querySelectorAll('input[name="tarjeta"]:checked')).map((c) => c.value);
    cardsVisibles = seleccionadas;
    await guardarDashboardCards(usuario.uid, seleccionadas);
    cerrar();
    cargar();
  });
}

document.getElementById("btn-personalizar").addEventListener("click", abrirPersonalizar);

cargar();
