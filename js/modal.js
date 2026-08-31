// Modal simple para pedir un par de campos (ej. al crear un proveedor al vuelo, donde con solo
// el nombre no alcanza). Devuelve una Promise que resuelve con los valores, o null si se cancela.
export function pedirCamposModal(titulo, campos) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card">
        <div class="section-title">${titulo}</div>
        <form id="modal-form">
          ${campos
            .map(
              (c) => `
            <div class="field">
              <label for="modal-${c.name}">${c.label}</label>
              <input type="text" id="modal-${c.name}" name="${c.name}" value="${c.value || ""}" ${c.required ? "required" : ""} />
            </div>
          `
            )
            .join("")}
          <div class="toolbar" style="margin-top:8px">
            <button type="submit" class="primary">Crear</button>
            <button type="button" id="modal-cancelar">Cancelar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector("#modal-form");
    const primerInput = overlay.querySelector("input");
    primerInput.focus();
    primerInput.select();

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const resultado = {};
      campos.forEach((c) => {
        resultado[c.name] = form.elements[c.name].value.trim();
      });
      cerrar(resultado);
    });

    overlay.querySelector("#modal-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
