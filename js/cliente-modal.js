import { consultarPadronArca } from "./arca.js";
import { soloDigitos, formatearCuit, validarCuit, cuitsPosiblesDesdeDni } from "./cuit.js";
import { mostrarCentralDeudores } from "./bcra-modal.js";
import { capitalizarDireccion } from "./texto.js";

// Modal para crear (o editar, si se pasa clienteExistente) un cliente: Razón Social + CUIT/DNI,
// con botón "Consultar ARCA" que autocompleta el resto, y "Central de Deudores" (BCRA).
// Devuelve { razonSocial, cuit, datosArca } o null si se cancela.
export function pedirClienteModal(razonSocialInicial, clienteExistente = null) {
  return new Promise((resolve) => {
    let datosArca = null;
    const esEdicion = Boolean(clienteExistente);

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:420px">
        <div class="section-title">${esEdicion ? "Editar cliente" : "Nuevo cliente"}</div>
        <form id="cliente-modal-form">
          <div class="field">
            <label for="cm-razonSocial">Nombre / Razón social</label>
            <input type="text" id="cm-razonSocial" value="${clienteExistente?.razonSocial || razonSocialInicial || ""}" required />
          </div>
          <div class="field">
            <label for="cm-cuit">CUIT / DNI</label>
            <input type="text" id="cm-cuit" placeholder="30-XXXXXXXX-X" value="${clienteExistente?.cuit || ""}" required />
            <div class="toolbar" style="margin-top:6px">
              <button type="button" id="cm-consultar-arca">🔎 Consultar ARCA</button>
              <button type="button" id="cm-central-deudores">🏦 Central de Deudores</button>
            </div>
            <div class="hint" id="cm-cuit-validacion"></div>
            <div class="hint" id="cm-dni-sugerencias"></div>
            <div class="hint" id="cm-arca-estado"></div>
          </div>
          <div id="cm-arca-preview" style="display:${clienteExistente?.condicionIva ? "block" : "none"}" class="hint">
            <div id="cm-arca-preview-content">${
              clienteExistente?.condicionIva
                ? `Condición IVA: ${clienteExistente.condicionIva}<br/>${clienteExistente.domicilioFiscal ? `Domicilio: ${clienteExistente.domicilioFiscal}<br/>` : ""}${clienteExistente.provincia || ""}`
                : ""
            }</div>
          </div>
          <div class="field">
            <label for="cm-domicilio-entrega">Domicilio de entrega</label>
            <input type="text" id="cm-domicilio-entrega" value="${clienteExistente?.domicilioEntrega || ""}" placeholder="Calle, número, localidad…" />
          </div>
          <div class="field-row">
            <div class="field">
              <label for="cm-whatsapp">WhatsApp</label>
              <input type="text" id="cm-whatsapp" value="${clienteExistente?.whatsapp || ""}" placeholder="+54 9 11 XXXX-XXXX" />
            </div>
            <div class="field">
              <label for="cm-email">Email</label>
              <input type="email" id="cm-email" value="${clienteExistente?.email || ""}" />
            </div>
          </div>
          <div class="toolbar" style="margin-top:8px">
            <button type="submit" class="primary">${esEdicion ? "Guardar cambios" : "Crear"}</button>
            <button type="button" id="cm-cancelar">Cancelar</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = overlay.querySelector("#cliente-modal-form");
    const razonSocialInput = overlay.querySelector("#cm-razonSocial");
    const cuitInput = overlay.querySelector("#cm-cuit");
    const cuitValidacionEl = overlay.querySelector("#cm-cuit-validacion");
    const dniSugerenciasEl = overlay.querySelector("#cm-dni-sugerencias");
    const estadoEl = overlay.querySelector("#cm-arca-estado");
    const previewEl = overlay.querySelector("#cm-arca-preview");
    const previewContentEl = overlay.querySelector("#cm-arca-preview-content");
    const consultarBtn = overlay.querySelector("#cm-consultar-arca");
    const domicilioEntregaInput = overlay.querySelector("#cm-domicilio-entrega");

    domicilioEntregaInput.addEventListener("blur", () => {
      domicilioEntregaInput.value = capitalizarDireccion(domicilioEntregaInput.value.trim());
    });

    razonSocialInput.focus();
    razonSocialInput.select();

    function actualizarCuit() {
      const digitos = soloDigitos(cuitInput.value);
      const posicionCursor = cuitInput.selectionStart;
      const antesLen = cuitInput.value.length;
      cuitInput.value = formatearCuit(digitos);
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

    overlay.querySelector("#cm-central-deudores").addEventListener("click", () => {
      const digitos = soloDigitos(cuitInput.value);
      if (digitos.length !== 11) {
        cuitValidacionEl.textContent = "Necesitás un CUIT completo (11 dígitos) para consultar BCRA.";
        cuitValidacionEl.className = "hint error-text";
        return;
      }
      mostrarCentralDeudores(digitos, razonSocialInput.value.trim());
    });

    function mostrarResultadoArca(datos) {
      datosArca = datos;
      if (datos.razonSocial) razonSocialInput.value = datos.razonSocial;
      previewContentEl.innerHTML = `
        ${datos.condicionIva ? `Condición IVA: ${datos.condicionIva}<br/>` : ""}
        ${datos.domicilioFiscal ? `Domicilio: ${datos.domicilioFiscal}<br/>` : ""}
        ${datos.provincia ? `Provincia: ${datos.provincia}` : ""}
        ${datos.codigoPostal ? ` (CP ${datos.codigoPostal})` : ""}
      `;
      previewEl.style.display = "block";
    }

    consultarBtn.addEventListener("click", async () => {
      const digitos = soloDigitos(cuitInput.value);
      consultarBtn.disabled = true;

      if (digitos.length === 11) {
        estadoEl.textContent = "Consultando ARCA…";
        estadoEl.className = "hint";
        try {
          mostrarResultadoArca(await consultarPadronArca(digitos));
          estadoEl.textContent = "Datos encontrados en ARCA — revisá y confirmá.";
        } catch (err) {
          estadoEl.textContent = "No se pudo consultar ARCA (" + (err?.message || "error desconocido") + "). Cargá los datos a mano.";
          estadoEl.className = "hint error-text";
        } finally {
          consultarBtn.disabled = false;
        }
        return;
      }

      if (digitos.length === 7 || digitos.length === 8) {
        // Con un DNI no alcanza un CUIT directo: se prueban los prefijos de persona física
        // (20/27/23/24) contra ARCA hasta encontrar uno real, sin que el usuario tenga que elegir a mano.
        const candidatos = cuitsPosiblesDesdeDni(digitos);
        estadoEl.textContent = "Buscando el CUIT correspondiente a este DNI en ARCA…";
        estadoEl.className = "hint";
        let encontrado = null;
        for (const candidato of candidatos) {
          try {
            const datos = await consultarPadronArca(candidato.cuit);
            encontrado = { cuit: candidato.cuit, datos };
            break;
          } catch {
            // este prefijo no correspondía a una persona real — se prueba el siguiente
          }
        }
        if (encontrado) {
          cuitInput.value = formatearCuit(encontrado.cuit);
          actualizarCuit();
          mostrarResultadoArca(encontrado.datos);
          estadoEl.textContent = "Datos encontrados en ARCA — revisá y confirmá.";
        } else {
          estadoEl.textContent = "No se encontró un CUIT válido en ARCA para ese DNI. Cargá los datos a mano.";
          estadoEl.className = "hint error-text";
        }
        consultarBtn.disabled = false;
        return;
      }

      estadoEl.textContent = "Ingresá un CUIT (11 dígitos) o un DNI (7-8 dígitos) primero.";
      estadoEl.className = "hint error-text";
      consultarBtn.disabled = false;
    });

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const domicilioEntregaNuevo = overlay.querySelector("#cm-domicilio-entrega").value.trim();
      cerrar({
        razonSocial: razonSocialInput.value.trim(),
        cuit: cuitInput.value.trim(),
        datosArca,
        datosContacto: {
          domicilioEntrega: domicilioEntregaNuevo,
          whatsapp: overlay.querySelector("#cm-whatsapp").value.trim(),
          email: overlay.querySelector("#cm-email").value.trim(),
          domicilioEntregaCambio: domicilioEntregaNuevo !== (clienteExistente?.domicilioEntrega || ""),
        },
      });
    });

    overlay.querySelector("#cm-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });
  });
}
