import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { guardarDashboardCards } from "/js/usuarios.js";
import { db, doc, getDoc } from "/js/firebase.js";
import { CATEGORIAS_REPORTES, PERIODOS, rangoPeriodo, RESUMENES_DASHBOARD } from "/js/dashboard.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "dashboard", titulo: "Dashboard", usuario });

content.innerHTML = `
  <div class="toolbar">
    <select id="periodo-select">
      ${PERIODOS.map((p) => `<option ${p === "Este mes" ? "selected" : ""}>${p}</option>`).join("")}
    </select>
    <button type="button" id="btn-personalizar">Personalizar</button>
    <a href="/reportes.html"><button type="button">Ver reportes</button></a>
  </div>
  <div id="tarjetas-grid" class="dashboard-grid"></div>
`;

const grid = document.getElementById("tarjetas-grid");
const periodoSelect = document.getElementById("periodo-select");

// Todo reporte con una entrada en RESUMENES_DASHBOARD puede mostrarse acá — el catálogo es el mismo
// que /reportes.html (CATEGORIAS_REPORTES), así que agregar un reporte nuevo a esa lista más una
// entrada en RESUMENES_DASHBOARD alcanza para que también pueda ser tarjeta.
const todosLosReportes = CATEGORIAS_REPORTES.flatMap((g) => g.reportes.map((r) => ({ ...r, categoria: g.categoria }))).filter(
  (r) => RESUMENES_DASHBOARD[r.id]
);

// Config guardada en el perfil (usuarios/{uid}.dashboardCards) — viaja con la cuenta entre PCs.
// Sin config guardada todavía, se muestran todas.
const perfilSnap = await getDoc(doc(db, "usuarios", usuario.uid));
let cardsVisibles = perfilSnap.data()?.dashboardCards || todosLosReportes.map((r) => r.id);

function hrefDe(reporte) {
  return reporte.href || `/reportes-detalle.html?tipo=${reporte.id}`;
}

function tarjetaHtml(reporte, resumen, chartId) {
  return `
    <a href="${hrefDe(reporte)}" class="card dashboard-card">
      <div class="hint" style="margin:0">${reporte.titulo}</div>
      <div class="dashboard-card-valor" style="font-size:${resumen.valor.length > 14 ? "18px" : "26px"}">${resumen.valor}</div>
      ${resumen.sub ? `<div class="hint" style="margin:0">${resumen.sub}</div>` : ""}
      ${
        resumen.comparacion
          ? `<div class="hint" style="color:var(--${resumen.comparacion.positivo ? "success" : "danger"})">${resumen.comparacion.texto}</div>`
          : ""
      }
      ${chartId ? `<div class="dashboard-card-sparkline"><canvas id="${chartId}"></canvas></div>` : ""}
    </a>
  `;
}

const ACCENT = "#e23e3a";
const ACCENT_SUAVE = "rgba(226, 62, 58, 0.12)";
let sparklines = [];

function pintarSparkline(canvasId, valores) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  sparklines.push(
    new Chart(canvas, {
      type: "line",
      data: {
        labels: valores.map(() => ""),
        datasets: [
          { data: valores, borderColor: ACCENT, backgroundColor: ACCENT_SUAVE, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    })
  );
}

async function cargar() {
  grid.innerHTML = `<div class="hint" style="padding:24px">Cargando…</div>`;
  sparklines.forEach((c) => c.destroy());
  sparklines = [];

  const visibles = todosLosReportes.filter((r) => cardsVisibles.includes(r.id));
  if (visibles.length === 0) {
    grid.innerHTML = `<div class="empty-state">No hay tarjetas para mostrar. Usá "Personalizar" para elegir cuáles ver.</div>`;
    return;
  }

  const rango = rangoPeriodo(periodoSelect.value);
  const resumenes = await Promise.all(visibles.map((r) => RESUMENES_DASHBOARD[r.id](rango)));

  grid.innerHTML = visibles.map((r, i) => tarjetaHtml(r, resumenes[i], r.id === "resumen-ventas" ? "spark-resumen-ventas" : null)).join("");

  const iVentas = visibles.findIndex((r) => r.id === "resumen-ventas");
  if (iVentas >= 0 && resumenes[iVentas].serie) pintarSparkline("spark-resumen-ventas", resumenes[iVentas].serie);
}

periodoSelect.addEventListener("change", cargar);

function abrirPersonalizar() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Personalizar Dashboard</div>
      <form id="personalizar-form">
        ${CATEGORIAS_REPORTES.map((g) => {
          const reportesConResumen = g.reportes.filter((r) => RESUMENES_DASHBOARD[r.id]);
          if (reportesConResumen.length === 0) return "";
          return `
            <div class="hint" style="margin:12px 0 6px; font-weight:600; color:var(--foreground)">${g.categoria}</div>
            ${reportesConResumen
              .map(
                (r) => `
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:400; margin-bottom:8px; color:var(--foreground)">
                <input type="checkbox" name="tarjeta" value="${r.id}" ${cardsVisibles.includes(r.id) ? "checked" : ""} />
                ${r.titulo}
              </label>
            `
              )
              .join("")}
          `;
        }).join("")}
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
