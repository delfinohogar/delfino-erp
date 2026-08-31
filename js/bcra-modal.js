import { consultarCentralDeudores } from "./bcra.js";

const SITUACION_LABEL = {
  1: "Normal",
  2: "Riesgo bajo",
  3: "Riesgo medio",
  4: "Riesgo alto",
  5: "Irrecuperable",
  6: "Irrecuperable (disp. técnica)",
};

function situacionBadge(s) {
  const clase = s <= 1 ? "success" : s <= 3 ? "warning" : "danger";
  return `<span class="badge ${clase}">${s} — ${SITUACION_LABEL[s] || "?"}</span>`;
}

// Modal informativo — no devuelve nada, solo muestra el resultado de la consulta.
export function mostrarCentralDeudores(cuit, razonSocial) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:560px">
      <div class="section-title">Central de Deudores (BCRA)${razonSocial ? " — " + razonSocial : ""}</div>
      <div id="bd-contenido" class="hint">Consultando…</div>
      <div class="toolbar" style="margin-top:12px">
        <button type="button" id="bd-cerrar">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
  }
  overlay.querySelector("#bd-cerrar").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  const contenido = overlay.querySelector("#bd-contenido");

  (async () => {
    try {
      const datos = await consultarCentralDeudores(cuit);
      if (!datos || !datos.periodos?.length) {
        contenido.innerHTML = `<div class="hint">Sin registros de deuda en el sistema financiero para este CUIT.</div>`;
        return;
      }
      const ultimoPeriodo = datos.periodos[0];
      contenido.innerHTML = `
        <div class="hint" style="margin-bottom:8px">
          Período ${ultimoPeriodo.periodo} · montos informados por BCRA en miles de $
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Entidad</th>
                <th>Situación</th>
                <th>Monto</th>
                <th>Días atraso</th>
              </tr>
            </thead>
            <tbody>
              ${ultimoPeriodo.entidades
                .map(
                  (e) => `
                <tr>
                  <td>${e.entidad}</td>
                  <td>${situacionBadge(e.situacion)}</td>
                  <td>$${(e.monto ?? 0).toLocaleString("es-AR")} mil</td>
                  <td>${e.diasAtrasoPago ?? 0}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      contenido.innerHTML = `<div class="hint error-text">No se pudo consultar BCRA: ${err?.message || "error desconocido"}</div>`;
    }
  })();
}
