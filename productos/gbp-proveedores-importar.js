// Importar proveedores desde el Grid Export de GBP (Configuración → Proveedores → exportar grilla
// a Excel, dentro de GBP) — no depende del webservice (no tiene ningún método para proveedores, ver
// js/gbp-proveedores-excel.js). Un solo paso: el archivo ya lo tiene el usuario, se sube, se
// previsualiza y se confirma — mismo patrón de subir → previsualizar → confirmar que el resto de los
// importadores (productos/importar.js, gbp-clientes-importar.js), sin el paso de "descargar" porque
// acá no hay nada que descargar primero.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { prepararImportacionProveedores, confirmarImportacionProveedores } from "/js/gbp-proveedores-excel.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "gbp-proveedores-importar", titulo: "Proveedores GBP — Excel", usuario });

content.innerHTML = `
  <div class="card mb-16" style="padding:20px">
    <div class="section-title">Subir el Grid Export de Proveedores de GBP</div>
    <div class="hint" style="max-width:64ch; margin-bottom:12px">
      En GBP: pantalla de Proveedores → exportar la grilla a Excel. Subí ese archivo tal cual acá —
      no hace falta tocarle las columnas. La fila "Otros Pagos (No usar como proveedor)" se descarta
      sola. La columna "ID" es la clave para no duplicar si volvés a subir el mismo archivo más adelante.
    </div>
    <input type="file" id="imp-archivo" accept=".xlsx,.xls" />
    <div class="error-text hidden" id="imp-error"></div>
  </div>

  <div id="imp-preview"></div>
`;

const archivoInput = document.getElementById("imp-archivo");
const errorEl = document.getElementById("imp-error");
const previewEl = document.getElementById("imp-preview");

archivoInput.addEventListener("change", async () => {
  const file = archivoInput.files[0];
  if (!file) return;
  errorEl.classList.add("hidden");
  previewEl.innerHTML = `<div class="hint">Leyendo ${escapeHtml(file.name)}…</div>`;
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
    if (filas.length === 0) throw new Error("La hoja no tiene filas.");
    pintarPreview(prepararImportacionProveedores(filas));
  } catch (err) {
    previewEl.innerHTML = "";
    errorEl.textContent = "No se pudo leer el archivo: " + (err?.message || "error desconocido");
    errorEl.classList.remove("hidden");
  }
});

function pintarPreview({ validos, excluidos, sinDatos }) {
  const muestra = validos.slice(0, 20);
  previewEl.innerHTML = `
    <div class="dashboard-grid mb-16">
      <div class="card dashboard-card"><div class="hint mt-0">A importar</div><div class="dashboard-card-valor">${validos.length}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Excluidos ("No usar")</div><div class="dashboard-card-valor">${excluidos.length}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Sin datos completos (se ignoran)</div><div class="dashboard-card-valor" style="color:${sinDatos.length ? "var(--danger)" : "inherit"}">${sinDatos.length}</div></div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Vista previa (primeros ${muestra.length} de ${validos.length})</div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Razón social</th><th>CUIT</th><th>Condición IVA</th><th>Localidad</th><th>Provincia</th></tr></thead>
          <tbody>
            ${muestra.map((p) => `<tr><td>${escapeHtml(p.razonSocial)}</td><td>${escapeHtml(p.cuit)}</td><td>${escapeHtml(p.condicionIva || "-")}</td><td>${escapeHtml(p.localidad || "-")}</td><td>${escapeHtml(p.provincia || "-")}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    ${
      sinDatos.length > 0
        ? `<div class="card mb-16" style="background:var(--warning-bg); border-color:var(--warning)">
        <div style="font-weight:600; color:var(--warning)">⚠️ Filas que no se van a importar (falta ID, nombre o CUIT)</div>
        ${sinDatos.map((e) => `<div class="hint">Fila ${e.fila}: ${escapeHtml(e.nombre)}</div>`).join("")}
      </div>`
        : ""
    }

    <div class="toolbar">
      <button type="button" class="primary" id="imp-confirmar" ${validos.length === 0 ? "disabled" : ""}>Confirmar importación (${validos.length} proveedores)</button>
    </div>
    <div id="imp-progreso" class="hint" style="margin-top:10px"></div>
    <div id="imp-resultado"></div>
  `;

  document.getElementById("imp-confirmar").addEventListener("click", async () => {
    const btn = document.getElementById("imp-confirmar");
    btn.disabled = true;
    const progresoEl = document.getElementById("imp-progreso");
    try {
      const { creados, actualizados } = await confirmarImportacionProveedores(validos, (mensaje) => {
        progresoEl.textContent = mensaje;
      });
      progresoEl.textContent = "";
      document.getElementById("imp-resultado").innerHTML = `
        <div class="card" style="background:var(--success-bg); border-color:var(--success); text-align:center; padding:20px">
          <div style="font-size:16px; font-weight:700; color:var(--success)">✓ Importación terminada</div>
          <div class="hint">${creados} proveedores nuevos · ${actualizados} actualizados</div>
        </div>
      `;
    } catch (err) {
      progresoEl.textContent = "";
      errorEl.textContent = "Error durante la importación: " + (err?.message || "error desconocido");
      errorEl.classList.remove("hidden");
      btn.disabled = false;
    }
  });
}
