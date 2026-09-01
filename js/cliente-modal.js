import { consultarPadronArca } from "./arca.js";
import { soloDigitos, formatearCuit, validarCuit, cuitsPosiblesDesdeDni } from "./cuit.js";
import { mostrarCentralDeudores } from "./bcra-modal.js";
import { capitalizarDireccion } from "./texto.js";

// Modal para crear (o editar, si se pasa clienteExistente) un cliente. El documento va primero
// (con "Buscar en ARCA" al lado) porque encontrar el CUIT/DNI completa la razón social sola —
// escribir el nombre a mano es el camino lento, no el default. El domicilio es opcional y queda
// colapsado como una chip con "Editar" (igual con el que trae ARCA: se ofrece como punto de partida
// para el domicilio de entrega, pero se puede corregir o borrar, nunca se fuerza).
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
            <label for="cm-cuit">CUIT / DNI</label>
            <div class="stack-row">
              <input type="text" id="cm-cuit" placeholder="Ingresá un DNI o CUIT" value="${clienteExistente?.cuit || ""}" style="flex:1" required />
              <button type="button" id="cm-consultar-arca">🔎 Buscar en ARCA</button>
            </div>
            <div class="hint" id="cm-cuit-validacion"></div>
            <div class="hint" id="cm-arca-estado"></div>
          </div>
          <div class="field">
            <label for="cm-razonSocial">Nombre / Razón social</label>
            <input type="text" id="cm-razonSocial" value="${clienteExistente?.razonSocial || razonSocialInicial || ""}" required />
          </div>
          <div id="cm-arca-preview" style="display:${clienteExistente?.condicionIva ? "block" : "none"}" class="hint">
            <div id="cm-arca-preview-content">${
              clienteExistente?.condicionIva
                ? `Condición IVA: ${clienteExistente.condicionIva}<br/>${clienteExistente.domicilioFiscal ? `Domicilio: ${clienteExistente.domicilioFiscal}<br/>` : ""}${clienteExistente.provincia || ""}`
                : ""
            }</div>
          </div>
          <div class="field">
            <label>Domicilio de entrega <span class="hint mt-0" style="display:inline">(opcional)</span></label>
            <div id="cm-domicilio-resumen"></div>
            <input type="text" id="cm-domicilio-entrega" value="${clienteExistente?.domicilioEntrega || ""}" placeholder="Calle, número, localidad…" style="display:none" />
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
            <button type="button" id="cm-central-deudores">🏦 Central de Deudores</button>
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
    const estadoEl = overlay.querySelector("#cm-arca-estado");
    const previewEl = overlay.querySelector("#cm-arca-preview");
    const previewContentEl = overlay.querySelector("#cm-arca-preview-content");
    const consultarBtn = overlay.querySelector("#cm-consultar-arca");
    const domicilioEntregaInput = overlay.querySelector("#cm-domicilio-entrega");
    const domicilioResumenEl = overlay.querySelector("#cm-domicilio-resumen");

    // El domicilio arranca colapsado — como chip de solo lectura si ya hay algo cargado (a mano o
    // sugerido por ARCA), o como "+ Agregar domicilio" si está vacío. Nunca obliga a mirar un campo
    // que no hace falta tocar.
    let domicilioEditando = false;
    function pintarDomicilio() {
      const valor = domicilioEntregaInput.value.trim();
      if (domicilioEditando) {
        domicilioResumenEl.style.display = "none";
        domicilioEntregaInput.style.display = "block";
        domicilioEntregaInput.focus();
        return;
      }
      domicilioEntregaInput.style.display = "none";
      domicilioResumenEl.style.display = "flex";
      domicilioResumenEl.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--muted-bg); border-radius:8px; padding:8px 10px;";
      domicilioResumenEl.innerHTML = valor
        ? `<span style="font-size:13px">${valor}</span><button type="button" id="cm-domicilio-toggle" class="link-btn" style="flex-shrink:0">✏️ Editar</button>`
        : `<button type="button" id="cm-domicilio-toggle" class="link-btn">+ Agregar domicilio</button>`;
      domicilioResumenEl.querySelector("#cm-domicilio-toggle").addEventListener("click", () => {
        domicilioEditando = true;
        pintarDomicilio();
      });
    }
    domicilioEntregaInput.addEventListener("blur", () => {
      domicilioEntregaInput.value = capitalizarDireccion(domicilioEntregaInput.value.trim());
      domicilioEditando = false;
      pintarDomicilio();
    });
    pintarDomicilio();

    cuitInput.focus();
    cuitInput.select();

    function actualizarCuit() {
      const digitos = soloDigitos(cuitInput.value);
      const posicionCursor = cuitInput.selectionStart;
      const antesLen = cuitInput.value.length;
      cuitInput.value = formatearCuit(digitos);
      const diff = cuitInput.value.length - antesLen;
      cuitInput.setSelectionRange(posicionCursor + diff, posicionCursor + diff);

      if (digitos.length === 11) {
        cuitValidacionEl.textContent = validarCuit(digitos) ? "✓ CUIT válido." : "El CUIT no es válido (dígito verificador incorrecto).";
        cuitValidacionEl.className = validarCuit(digitos) ? "hint" : "hint error-text";
      } else if (digitos.length === 7 || digitos.length === 8) {
        // No hace falta elegir el prefijo a mano: "Buscar en ARCA" ya prueba los de persona física
        // (20/27/23/24) uno por uno hasta encontrar el real (ver el handler de cm-consultar-arca).
        cuitValidacionEl.textContent = "Parece un DNI — Buscar en ARCA prueba los prefijos solo.";
        cuitValidacionEl.className = "hint";
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

      // El domicilio fiscal de ARCA es solo una sugerencia para el de entrega — nunca pisa uno que
      // el vendedor ya haya cargado a mano, y sigue siendo editable/borrable desde la chip de arriba.
      if (datos.domicilioFiscal && !domicilioEntregaInput.value.trim()) {
        // Todo en un solo capitalizarDireccion() para que quede igual la primera vez que al volver
        // a tocarlo (blur re-capitaliza el string completo — si "CP" se agregaba aparte quedaba bien
        // solo la primera vez y pasaba a "Cp" en cuanto se editaba una vez).
        const partes = [datos.domicilioFiscal, datos.provincia, datos.codigoPostal ? `CP ${datos.codigoPostal}` : ""].filter(Boolean).join(", ");
        domicilioEntregaInput.value = capitalizarDireccion(partes);
        domicilioEditando = false;
        pintarDomicilio();
      }
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
      const domicilioEntregaNuevo = domicilioEntregaInput.value.trim();
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
