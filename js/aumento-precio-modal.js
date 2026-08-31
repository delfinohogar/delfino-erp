// Modal para el aumento masivo de precios: pide el porcentaje y a qué campo aplicarlo.
// Devuelve { porcentaje, modo } o null si se cancela.
export function pedirAumentoPrecio(cantidadProductos) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:380px">
        <div class="section-title">Aumentar precio a ${cantidadProductos} producto${cantidadProductos === 1 ? "" : "s"}</div>
        <form id="aumento-form">
          <div class="field">
            <label for="ap-porcentaje">Porcentaje de aumento</label>
            <input type="number" id="ap-porcentaje" step="0.01" placeholder="Ej. 10" required />
            <div class="hint">Usá un número negativo para aplicar una baja.</div>
          </div>
          <div class="field">
            <label>Aplicar a</label>
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px">
              <label style="display:flex; align-items:center; gap:6px; font-weight:400; font-size:13px; color:var(--foreground)">
                <input type="radio" name="ap-modo" value="precioVenta" checked style="width:auto" />
                Precio de venta directo (pasa el producto a modo manual)
              </label>
              <label style="display:flex; align-items:center; gap:6px; font-weight:400; font-size:13px; color:var(--foreground)">
                <input type="radio" name="ap-modo" value="margen" style="width:auto" />
                Margen objetivo (solo productos en modo "por margen"; recalcula el precio solo)
              </label>
            </div>
          </div>
          <div class="toolbar" style="margin-top:8px">
            <button type="submit" class="primary">Aplicar aumento</button>
            <button type="button" id="ap-cancelar">Cancelar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector("#aumento-form");
    overlay.querySelector("#ap-porcentaje").focus();

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const porcentaje = parseFloat(overlay.querySelector("#ap-porcentaje").value);
      if (Number.isNaN(porcentaje)) return;
      const modo = overlay.querySelector('input[name="ap-modo"]:checked').value;
      cerrar({ porcentaje, modo });
    });

    overlay.querySelector("#ap-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
