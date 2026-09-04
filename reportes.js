import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { CATEGORIAS_REPORTES } from "/js/reportes.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "reportes", titulo: "Reportes", usuario });

content.innerHTML = CATEGORIAS_REPORTES.map(
  (grupo) => `
    <div class="section-title" style="border:none; padding:0; margin:20px 0 10px">${grupo.categoria}</div>
    <div class="dashboard-grid" style="margin-bottom:8px">
      ${grupo.reportes
        .map(
          (r) => `
        <a href="${r.href || `/reportes-detalle.html?tipo=${r.id}`}" class="card dashboard-card" style="padding:16px">
          <div style="font-weight:600; margin-bottom:4px">${r.titulo}</div>
          <div class="hint mt-0">${r.descripcion}</div>
        </a>
      `
        )
        .join("")}
    </div>
  `
).join("");
