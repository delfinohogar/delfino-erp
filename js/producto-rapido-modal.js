// Alta rápida de producto desde una línea de compra cuando no existe en el catálogo.
// Pide solo lo imprescindible (SKU, descripción, marca) — el resto de la ficha (categoría,
// precio, etc.) se completa después desde Productos.
import { attachAutocomplete } from "./autocomplete.js";
import { buscarMarcas, crearMarca } from "./catalogo.js";

export function pedirProductoRapidoModal(descripcionInicial) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:420px">
        <div class="section-title">Crear producto</div>
        <div class="hint" style="margin-bottom:8px">
          Carga rápida — categoría, precio de venta y el resto de la ficha se completan después desde Productos.
        </div>
        <form id="pr-form">
          <div class="field">
            <label for="pr-sku">SKU (interno)</label>
            <input type="text" id="pr-sku" required />
          </div>
          <div class="field">
            <label for="pr-descripcion">Descripción</label>
            <input type="text" id="pr-descripcion" required />
          </div>
          <div class="field autocomplete" id="pr-wrapper-marca">
            <label for="pr-marca">Marca</label>
            <input type="text" id="pr-marca" data-role="search" autocomplete="off" required />
            <div class="autocomplete-list" data-role="list"></div>
          </div>
          <div class="field">
            <label for="pr-iva">IVA (%)</label>
            <input type="number" id="pr-iva" step="0.01" min="0" value="21" />
          </div>
          <div class="toolbar" style="margin-top:8px">
            <button type="submit" class="primary">Crear</button>
            <button type="button" id="pr-cancelar">Cancelar</button>
          </div>
          <div class="error-text" id="pr-error" style="display:none">Elegí (o creá) una marca.</div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector("#pr-form");
    const descripcionInput = overlay.querySelector("#pr-descripcion");
    descripcionInput.value = descripcionInicial || "";
    overlay.querySelector("#pr-sku").focus();

    let marcaSeleccionada = null;
    attachAutocomplete(overlay.querySelector("#pr-wrapper-marca"), {
      buscar: buscarMarcas,
      etiqueta: (m) => m.nombre,
      crearLabel: "Crear marca",
      onCreate: (texto) => crearMarca(texto),
      onSelect: (item) => (marcaSeleccionada = item),
    });

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!marcaSeleccionada) {
        overlay.querySelector("#pr-error").style.display = "block";
        return;
      }
      cerrar({
        sku: overlay.querySelector("#pr-sku").value.trim(),
        descripcion: descripcionInput.value.trim(),
        iva: parseFloat(overlay.querySelector("#pr-iva").value) || 0,
        marcaId: marcaSeleccionada.id,
        marcaNombre: marcaSeleccionada.nombre,
      });
    });

    overlay.querySelector("#pr-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
