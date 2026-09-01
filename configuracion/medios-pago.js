import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarMediosPago, crearMedioPago, actualizarMedioPago, sembrarMediosPagoIniciales, DESTINOS_TESORERIA } from "/js/medios-pago.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "configuracion", titulo: "Medios de pago", usuario });

function labelDestino(destino) {
  return DESTINOS_TESORERIA.find((d) => d.valor === destino)?.label || "Sin destino específico";
}

content.innerHTML = `
  <div class="hint" style="margin-bottom:12px; max-width:70ch">
    Cómo puede pagar un cliente — separado de las cuentas de Tesorería (caja/banco), que son dónde
    vive esa plata. Desactivar un medio acá lo saca del selector de pago de Nueva Venta al instante.
  </div>
  <div class="toolbar">
    <button type="button" id="btn-nuevo" class="primary">+ Nuevo medio de pago</button>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead><tr><th>Medio</th><th>Destino en Tesorería</th><th>Comentario</th><th>Estado</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Cargando medios de pago…</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  let medios = await listarMediosPago();
  if (medios.length === 0) {
    await sembrarMediosPagoIniciales();
    medios = await listarMediosPago();
  }
  emptyState.style.display = "none";
  tbody.innerHTML = medios
    .map(
      (m) => `
    <tr>
      <td>${m.nombre}${m.esSistema ? "" : ' <span class="badge muted">Personalizado</span>'}</td>
      <td>${labelDestino(m.destino)}${!m.esSistema && m.destino ? '<div class="hint">Sin ruteo automático todavía — ver nota</div>' : ""}</td>
      <td><input type="text" data-comentario="${m.id}" value="${m.comentario || ""}" placeholder="Notas, características…" style="width:100%" /></td>
      <td>${m.activo !== false ? '<span class="badge success">Activo</span>' : '<span class="badge muted">Inactivo</span>'}</td>
      <td style="white-space:nowrap">
        <button type="button" data-guardar="${m.id}">Guardar</button>
        <button type="button" data-toggle="${m.id}" data-activo="${m.activo !== false}">${m.activo !== false ? "Desactivar" : "Activar"}</button>
      </td>
    </tr>
  `
    )
    .join("");

  tbody.querySelectorAll("[data-guardar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const comentario = tbody.querySelector(`[data-comentario="${btn.dataset.guardar}"]`).value;
      await actualizarMedioPago(btn.dataset.guardar, { comentario });
      btn.textContent = "✓ Guardado";
      setTimeout(() => (btn.textContent = "Guardar"), 1200);
    });
  });
  tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await actualizarMedioPago(btn.dataset.toggle, { activo: btn.dataset.activo !== "true" });
      cargar();
    });
  });
}

document.getElementById("btn-nuevo").addEventListener("click", () => {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Nuevo medio de pago</div>
      <form id="form-medio">
        <div class="field">
          <label for="mp-nombre">Nombre</label>
          <input type="text" id="mp-nombre" placeholder="Ej. Cheque, Vale…" required />
        </div>
        <div class="field">
          <label for="mp-destino">Destino en Tesorería</label>
          <select id="mp-destino">
            ${DESTINOS_TESORERIA.map((d) => `<option value="${d.valor ?? ""}">${d.label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="mp-comentario">Comentario (opcional)</label>
          <input type="text" id="mp-comentario" />
        </div>
        <div class="hint" style="margin-bottom:10px">
          Queda disponible para cobrar de inmediato. El ruteo automático a Tesorería para medios
          nuevos (no los 8 originales) todavía no está generalizado — este quedará documentado como
          "sin ubicar" en los reportes hasta que se conecte en código.
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Crear</button>
          <button type="button" id="mp-cancelar">Cancelar</button>
        </div>
        <div class="error-text" id="mp-error" style="display:none"></div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#mp-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-medio").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector("#mp-error");
    errorEl.style.display = "none";
    try {
      await crearMedioPago({
        nombre: overlay.querySelector("#mp-nombre").value,
        destino: overlay.querySelector("#mp-destino").value || null,
        comentario: overlay.querySelector("#mp-comentario").value,
      });
      overlay.remove();
      cargar();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo crear el medio de pago.";
      errorEl.style.display = "block";
    }
  });
});

cargar();
