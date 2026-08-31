import { obtenerHistorialCostos } from "./productos.js";

function formatFecha(fecha) {
  if (!fecha?.toDate) return "-";
  return fecha.toDate().toLocaleString("es-AR");
}

export async function mostrarHistorialCostos(productoId) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:480px">
      <div class="section-title">Historial de costos</div>
      <div id="hc-contenido" class="hint">Cargando…</div>
      <div class="toolbar" style="margin-top:12px">
        <button type="button" id="hc-cerrar">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();
  overlay.querySelector("#hc-cerrar").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  const contenido = overlay.querySelector("#hc-contenido");
  try {
    const historial = await obtenerHistorialCostos(productoId);
    if (historial.length === 0) {
      contenido.innerHTML = `<div class="hint">Todavía no hay cambios de costo registrados.</div>`;
      return;
    }
    contenido.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Costo anterior</th>
              <th>Costo nuevo</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            ${historial
              .map(
                (h) => `
              <tr>
                <td>${formatFecha(h.fecha)}</td>
                <td>${h.costoAnterior != null ? h.costoAnterior.toLocaleString("es-AR") : "-"}</td>
                <td>${h.costoNuevo != null ? h.costoNuevo.toLocaleString("es-AR") : "-"}</td>
                <td>${h.motivo || "-"}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    contenido.innerHTML = `<div class="hint error-text">No se pudo cargar el historial: ${err?.message || "error desconocido"}</div>`;
  }
}
