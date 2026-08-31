import { attachAutocomplete } from "./autocomplete.js";
import { buscarMarcas, crearMarca } from "./catalogo.js";

// Modal chico para elegir (o crear) una marca, usado en la edición masiva de productos.
// Devuelve { id, nombre } o null si se cancela.
export function pedirMarcaModal(cantidadProductos) {
  return new Promise((resolve) => {
    let marcaSeleccionada = null;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:360px">
        <div class="section-title">Cambiar marca a ${cantidadProductos} producto${cantidadProductos === 1 ? "" : "s"}</div>
        <div class="field autocomplete" id="wrapper-marca-bulk">
          <label for="mb-search">Marca</label>
          <input type="text" id="mb-search" data-role="search" autocomplete="off" />
          <div class="autocomplete-list" data-role="list"></div>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" id="mb-aplicar" class="primary" disabled>Aplicar</button>
          <button type="button" id="mb-cancelar">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const aplicarBtn = overlay.querySelector("#mb-aplicar");

    attachAutocomplete(overlay.querySelector("#wrapper-marca-bulk"), {
      buscar: buscarMarcas,
      etiqueta: (m) => m.nombre,
      crearLabel: "Crear marca",
      onCreate: (texto) => crearMarca(texto),
      onSelect: (item) => {
        marcaSeleccionada = item;
        aplicarBtn.disabled = !item;
      },
    });

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    aplicarBtn.addEventListener("click", () => cerrar(marcaSeleccionada));
    overlay.querySelector("#mb-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
