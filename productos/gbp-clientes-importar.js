// Exportar clientes de GBP a Excel para revisarlos/corregirlos a mano, y subirlos de vuelta como
// clientes reales de Delfino — en vez de aplicar directo lo que trae GBP. Mismo patrón de archivo
// que la importación de catálogo (ver productos/importar.js): subir → previsualizar → confirmar.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { exportarClientesGbpParaRevisar, prepararImportacionClientes, confirmarImportacionClientes } from "/js/gbp-clientes-excel.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "gbp-clientes-importar", titulo: "Clientes GBP — Excel", usuario });

content.innerHTML = `
  <div class="card mb-16" style="padding:20px">
    <div class="section-title">1. Descargar para revisar</div>
    <div class="hint" style="max-width:64ch; margin-bottom:12px">
      Baja un Excel con los clientes de GBP que ya compraron algo (los que hoy son "ficha liviana",
      sin cuenta corriente ni Nueva Venta) — corregí lo que haga falta ahí y volvé a subirlo abajo.
      La columna "ID GBP" es la clave para no duplicar — no la edites ni la borres.
    </div>
    <button type="button" id="btn-exportar" class="primary">📥 Descargar clientes GBP para revisar (.xlsx)</button>
    <span id="exportar-estado" class="hint mt-0" style="margin-left:10px"></span>
  </div>

  <div class="card mb-16" style="padding:20px">
    <div class="section-title">2. Subir el archivo ya corregido</div>
    <input type="file" id="imp-archivo" accept=".xlsx,.xls" />
    <div class="error-text hidden" id="imp-error"></div>
  </div>

  <div id="imp-preview"></div>
`;

document.getElementById("btn-exportar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-exportar");
  const estadoEl = document.getElementById("exportar-estado");
  btn.disabled = true;
  estadoEl.textContent = "Generando…";
  try {
    const cantidad = await exportarClientesGbpParaRevisar();
    estadoEl.textContent = `Listo: ${cantidad} clientes.`;
  } catch (err) {
    estadoEl.textContent = `Error: ${err?.message || "no se pudo exportar"}`;
  } finally {
    btn.disabled = false;
  }
});

const archivoInput = document.getElementById("imp-archivo");
const errorEl = document.getElementById("imp-error");
const previewEl = document.getElementById("imp-preview");

archivoInput.addEventListener("change", async () => {
  const file = archivoInput.files[0];
  if (!file) return;
  errorEl.classList.add("hidden");
  previewEl.innerHTML = `<div class="hint">Leyendo ${file.name}…</div>`;
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
    if (filas.length === 0) throw new Error("La hoja no tiene filas.");
    pintarPreview(prepararImportacionClientes(filas));
  } catch (err) {
    previewEl.innerHTML = "";
    errorEl.textContent = "No se pudo leer el archivo: " + (err?.message || "error desconocido");
    errorEl.classList.remove("hidden");
  }
});

function pintarPreview({ validas, sinId, sinNombre }) {
  const muestra = validas.slice(0, 15);
  previewEl.innerHTML = `
    <div class="dashboard-grid mb-16">
      <div class="card dashboard-card"><div class="hint mt-0">A importar</div><div class="dashboard-card-valor">${validas.length}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Sin ID GBP (se ignoran)</div><div class="dashboard-card-valor" style="color:${sinId.length ? "var(--danger)" : "inherit"}">${sinId.length}</div></div>
      <div class="card dashboard-card"><div class="hint mt-0">Sin razón social (se ignoran)</div><div class="dashboard-card-valor" style="color:${sinNombre.length ? "var(--danger)" : "inherit"}">${sinNombre.length}</div></div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Vista previa (primeros ${muestra.length} de ${validas.length})</div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Razón social</th><th>CUIT/DNI</th><th>Domicilio</th><th>Localidad</th><th>Provincia</th></tr></thead>
          <tbody>
            ${muestra.map((c) => `<tr><td>${c.razonSocial}</td><td>${c.cuit || "-"}</td><td>${c.domicilioEntrega || "-"}</td><td>${c.localidadEntrega || "-"}</td><td>${c.provinciaEntrega || "-"}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    ${
      sinId.length > 0 || sinNombre.length > 0
        ? `<div class="card mb-16" style="background:var(--warning-bg); border-color:var(--warning)">
        <div style="font-weight:600; color:var(--warning)">⚠️ Filas que no se van a importar</div>
        ${sinId.map((e) => `<div class="hint">Fila ${e.fila}: falta el ID GBP.</div>`).join("")}
        ${sinNombre.map((e) => `<div class="hint">Fila ${e.fila} (ID ${e.identificadorExterno}): falta la razón social.</div>`).join("")}
      </div>`
        : ""
    }

    <div class="toolbar">
      <button type="button" class="primary" id="imp-confirmar" ${validas.length === 0 ? "disabled" : ""}>Confirmar importación (${validas.length} clientes)</button>
    </div>
    <div id="imp-progreso" class="hint" style="margin-top:10px"></div>
    <div id="imp-resultado"></div>
  `;

  document.getElementById("imp-confirmar").addEventListener("click", async () => {
    const btn = document.getElementById("imp-confirmar");
    btn.disabled = true;
    const progresoEl = document.getElementById("imp-progreso");
    try {
      const { creados, actualizados } = await confirmarImportacionClientes(validas, (mensaje) => {
        progresoEl.textContent = mensaje;
      });
      progresoEl.textContent = "";
      document.getElementById("imp-resultado").innerHTML = `
        <div class="card" style="background:var(--success-bg); border-color:var(--success); text-align:center; padding:20px">
          <div style="font-size:16px; font-weight:700; color:var(--success)">✓ Importación terminada</div>
          <div class="hint">${creados} clientes nuevos · ${actualizados} actualizados</div>
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
