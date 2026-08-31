import { buscarCandidatosDireccion } from "./motor-mapas.js";

// Modal para confirmar la geocodificación de un domicilio: busca varias opciones (los nombres de
// calle se repiten mucho), deja corregir el texto de búsqueda y reintentar, elegir la correcta,
// o cargarla a mano si ninguna lo es. Devuelve { direccionNormalizada, lat, lon } o null si se cancela.
export function pedirNormalizacionDireccion(direccionTexto, provinciaSugerida = null) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:480px">
        <div class="section-title">Confirmar ubicación</div>
        <div class="field">
          <label for="nd-buscar">Buscar dirección</label>
          <div style="display:flex; gap:8px">
            <input type="text" id="nd-buscar" value="${direccionTexto}" style="flex:1" />
            <button type="button" id="nd-buscar-btn">Buscar</button>
          </div>
        </div>
        <div id="nd-lista"></div>
        <div class="hint" id="nd-manual-toggle" style="margin-top:10px; cursor:pointer; color:var(--accent)">
          Ninguna es correcta — corregir a mano
        </div>
        <form id="nd-manual-form" style="display:none; margin-top:8px">
          <div class="field">
            <label for="nd-direccion">Dirección normalizada</label>
            <input type="text" id="nd-direccion" required />
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nd-lat">Latitud</label>
              <input type="number" id="nd-lat" step="any" required />
            </div>
            <div class="field">
              <label for="nd-lon">Longitud</label>
              <input type="number" id="nd-lon" step="any" required />
            </div>
          </div>
          <div class="hint">Tip: buscá la dirección en Google Maps o OpenStreetMap y copiá las coordenadas del link.</div>
          <div class="toolbar" style="margin-top:8px">
            <button type="submit" class="primary">Usar estos datos</button>
          </div>
        </form>
        <div class="toolbar" style="margin-top:12px">
          <button type="button" id="nd-cancelar">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const buscarInput = overlay.querySelector("#nd-buscar");
    const buscarBtn = overlay.querySelector("#nd-buscar-btn");
    const listaEl = overlay.querySelector("#nd-lista");
    const manualToggle = overlay.querySelector("#nd-manual-toggle");
    const manualForm = overlay.querySelector("#nd-manual-form");

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    async function buscar() {
      const texto = buscarInput.value.trim();
      if (!texto) return;
      listaEl.innerHTML = `<div class="hint">Buscando "${texto}"…</div>`;
      buscarBtn.disabled = true;
      try {
        const { candidatos, total } = await buscarCandidatosDireccion(texto, { provincia: provinciaSugerida }, 5);
        if (candidatos.length === 0) {
          listaEl.innerHTML = `<div class="hint">No se encontró ninguna coincidencia — corregí el texto de arriba y volvé a buscar, o cargala a mano.</div>`;
          return;
        }
        listaEl.innerHTML = `<div class="hint" style="margin-bottom:6px">${total > candidatos.length ? `Se muestran ${candidatos.length} de ${total} coincidencias — elegí la correcta:` : "Elegí la correcta:"}</div>`;
        candidatos.forEach((c) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = c.direccionNormalizada;
          btn.style.display = "block";
          btn.style.width = "100%";
          btn.style.textAlign = "left";
          btn.style.marginBottom = "6px";
          btn.addEventListener("click", () => cerrar({ ...c, domicilioEntregaTexto: buscarInput.value.trim() }));
          listaEl.appendChild(btn);
        });
      } catch (err) {
        listaEl.innerHTML = `<div class="hint error-text">No se pudo buscar: ${err?.message || "error desconocido"}</div>`;
      } finally {
        buscarBtn.disabled = false;
      }
    }

    buscarBtn.addEventListener("click", buscar);
    buscarInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        buscar();
      }
    });
    buscar();

    manualToggle.addEventListener("click", () => {
      manualForm.style.display = manualForm.style.display === "none" ? "block" : "none";
      overlay.querySelector("#nd-direccion").value = buscarInput.value.trim();
    });

    manualForm.addEventListener("submit", (e) => {
      e.preventDefault();
      cerrar({
        direccionNormalizada: overlay.querySelector("#nd-direccion").value.trim(),
        lat: parseFloat(overlay.querySelector("#nd-lat").value),
        lon: parseFloat(overlay.querySelector("#nd-lon").value),
        domicilioEntregaTexto: buscarInput.value.trim(),
      });
    });

    overlay.querySelector("#nd-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
