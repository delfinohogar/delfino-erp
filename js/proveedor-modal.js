import { consultarPadronArca } from "./arca.js";
import { soloDigitos, formatearCuit, validarCuit, cuitsPosiblesDesdeDni } from "./cuit.js";
import { mostrarCentralDeudores } from "./bcra-modal.js";

// Modal para crear (o editar, si se pasa proveedorExistente) un proveedor: Razón Social + CUIT,
// con botón "Consultar ARCA" que autocompleta el resto cuando esté disponible.
// Devuelve { razonSocial, cuit, datosArca } o null si se cancela.
export function pedirProveedorModal(razonSocialInicial, proveedorExistente = null) {
  return new Promise((resolve) => {
    let datosArca = null;
    const esEdicion = Boolean(proveedorExistente);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:420px">
        <div class="section-title">${esEdicion ? "Editar proveedor" : "Nuevo proveedor"}</div>
        <form id="proveedor-modal-form">
          <div class="field">
            <label for="pm-razonSocial">Razón social</label>
            <input type="text" id="pm-razonSocial" value="${proveedorExistente?.razonSocial || razonSocialInicial || ""}" required />
          </div>
          <div class="field">
            <label for="pm-cuit">CUIT</label>
            <input type="text" id="pm-cuit" placeholder="30-XXXXXXXX-X" value="${proveedorExistente?.cuit || ""}" required />
            <div class="toolbar" style="margin-top:6px">
              <button type="button" id="pm-consultar-arca">🔎 Consultar ARCA</button>
              <button type="button" id="pm-central-deudores">🏦 Central de Deudores</button>
            </div>
            <div class="hint" id="pm-cuit-validacion"></div>
            <div class="hint" id="pm-dni-sugerencias"></div>
            <div class="hint" id="pm-arca-estado"></div>
          </div>
          <div id="pm-arca-preview" style="display:${proveedorExistente?.condicionIva ? "block" : "none"}" class="hint">
            <div id="pm-arca-preview-content">${
              proveedorExistente?.condicionIva
                ? `Condición IVA: ${proveedorExistente.condicionIva}<br/>${proveedorExistente.domicilioFiscal ? `Domicilio: ${proveedorExistente.domicilioFiscal}<br/>` : ""}${proveedorExistente.provincia || ""}`
                : ""
            }</div>
          </div>
          <div class="toolbar" style="margin-top:8px">
            <button type="submit" class="primary">${esEdicion ? "Guardar cambios" : "Crear"}</button>
            <button type="button" id="pm-cancelar">Cancelar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector("#proveedor-modal-form");
    const razonSocialInput = overlay.querySelector("#pm-razonSocial");
    const cuitInput = overlay.querySelector("#pm-cuit");
    const cuitValidacionEl = overlay.querySelector("#pm-cuit-validacion");
    const dniSugerenciasEl = overlay.querySelector("#pm-dni-sugerencias");
    const estadoEl = overlay.querySelector("#pm-arca-estado");
    const previewEl = overlay.querySelector("#pm-arca-preview");
    const previewContentEl = overlay.querySelector("#pm-arca-preview-content");
    const consultarBtn = overlay.querySelector("#pm-consultar-arca");

    razonSocialInput.focus();
    razonSocialInput.select();

    function actualizarCuit() {
      const digitos = soloDigitos(cuitInput.value);
      const posicionCursor = cuitInput.selectionStart;
      const antesLen = cuitInput.value.length;
      cuitInput.value = formatearCuit(digitos);
      // Reubica el cursor teniendo en cuenta los guiones que se agregaron/quitaron al reformatear.
      const diff = cuitInput.value.length - antesLen;
      cuitInput.setSelectionRange(posicionCursor + diff, posicionCursor + diff);

      dniSugerenciasEl.innerHTML = "";
      if (digitos.length === 11) {
        cuitValidacionEl.textContent = validarCuit(digitos) ? "✓ CUIT válido." : "El CUIT no es válido (dígito verificador incorrecto).";
        cuitValidacionEl.className = validarCuit(digitos) ? "hint" : "hint error-text";
      } else if (digitos.length === 7 || digitos.length === 8) {
        cuitValidacionEl.textContent = "Parece un DNI. CUIT probables:";
        cuitValidacionEl.className = "hint";
        cuitsPosiblesDesdeDni(digitos).forEach(({ etiqueta, formateado }) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = formateado;
          btn.title = etiqueta;
          btn.style.marginRight = "6px";
          btn.style.marginTop = "4px";
          btn.addEventListener("click", () => {
            cuitInput.value = formateado;
            actualizarCuit();
          });
          dniSugerenciasEl.appendChild(btn);
        });
      } else {
        cuitValidacionEl.textContent = "";
      }
    }

    cuitInput.addEventListener("input", actualizarCuit);
    if (cuitInput.value) actualizarCuit();

    overlay.querySelector("#pm-central-deudores").addEventListener("click", () => {
      const digitos = soloDigitos(cuitInput.value);
      if (digitos.length !== 11) {
        cuitValidacionEl.textContent = "Necesitás un CUIT completo (11 dígitos) para consultar BCRA.";
        cuitValidacionEl.className = "hint error-text";
        return;
      }
      mostrarCentralDeudores(digitos, razonSocialInput.value.trim());
    });

    consultarBtn.addEventListener("click", async () => {
      estadoEl.textContent = "Consultando ARCA…";
      estadoEl.className = "hint";
      consultarBtn.disabled = true;
      try {
        datosArca = await consultarPadronArca(cuitInput.value);
        if (datosArca.razonSocial) razonSocialInput.value = datosArca.razonSocial;
        previewContentEl.innerHTML = `
          ${datosArca.condicionIva ? `Condición IVA: ${datosArca.condicionIva}<br/>` : ""}
          ${datosArca.domicilioFiscal ? `Domicilio: ${datosArca.domicilioFiscal}<br/>` : ""}
          ${datosArca.provincia ? `Provincia: ${datosArca.provincia}` : ""}
          ${datosArca.codigoPostal ? ` (CP ${datosArca.codigoPostal})` : ""}
        `;
        previewEl.style.display = "block";
        estadoEl.textContent = "Datos encontrados en ARCA — revisá y confirmá.";
      } catch (err) {
        estadoEl.textContent = "No se pudo consultar ARCA (" + (err?.message || "error desconocido") + "). Cargá los datos a mano.";
        estadoEl.className = "hint error-text";
      } finally {
        consultarBtn.disabled = false;
      }
    });

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      cerrar({
        razonSocial: razonSocialInput.value.trim(),
        cuit: cuitInput.value.trim(),
        datosArca,
      });
    });

    overlay.querySelector("#pm-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
