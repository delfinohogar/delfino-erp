import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { consultarPadronArca } from "/js/arca.js";
import { soloDigitos, formatearCuit, validarCuit } from "/js/cuit.js";
import {
  obtenerConfigEmpresa,
  guardarDatosContacto,
  guardarLogo,
  guardarDatosFiscales,
} from "/js/configuracion-empresa.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "config-empresa", titulo: "Empresa", usuario });

content.innerHTML = `
  <div class="tabs">
    <button type="button" class="tab-btn active" data-tab="general">General</button>
    <button type="button" class="tab-btn" data-tab="impositivo">Impositivo (ARCA)</button>
  </div>

  <div id="tab-general" class="tab-panel">
    <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
      <div class="section-title">Información de contacto</div>
      <div class="hint" style="margin-bottom:12px">Estos datos identifican a Delfino Hogar dentro del sistema.</div>
      <form id="form-contacto">
        <div class="field">
          <label for="nombreFantasia">Nombre de fantasía</label>
          <input type="text" id="nombreFantasia" placeholder="Delfino Hogar" />
        </div>
        <div class="field-row">
          <div class="field">
            <label for="email">Email</label>
            <input type="email" id="email" placeholder="contacto@ejemplo.com" />
          </div>
          <div class="field">
            <label for="telefono">Teléfono</label>
            <input type="text" id="telefono" placeholder="+54 9 11 XXXX-XXXX" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="whatsapp">WhatsApp</label>
            <input type="text" id="whatsapp" placeholder="+54 9 11 XXXX-XXXX" />
          </div>
          <div class="field">
            <label for="sitioWeb">Sitio web</label>
            <input type="text" id="sitioWeb" placeholder="www.delfinohogar.com.ar" />
          </div>
        </div>
        <div class="hint" style="margin-bottom:12px">Estos datos aparecen en el encabezado de los comprobantes (Facturación).</div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Guardar</button>
        </div>
      </form>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
      <div class="section-title">Logo de la organización</div>
      <div class="hint" style="margin-bottom:12px">Aparece arriba de todo, junto a la marca del sistema. PNG o JPG.</div>
      <div style="display:flex; align-items:center; gap:16px">
        <div id="logo-preview" style="width:64px; height:64px; border-radius:8px; border:1px solid var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--muted-bg)">
          <span class="hint" style="margin:0">Sin logo</span>
        </div>
        <input type="file" id="logo-input" accept="image/png,image/jpeg" />
      </div>
      <div class="hint" id="logo-estado"></div>
    </div>
  </div>

  <div id="tab-impositivo" class="tab-panel" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
      <div class="section-title">Datos fiscales</div>
      <div class="hint" style="margin-bottom:12px">
        Se completan consultando ARCA por CUIT. Van a ser la base del módulo impositivo (facturación
        electrónica), que armamos más adelante.
      </div>
      <form id="form-fiscal">
        <div class="field">
          <label for="cuit">CUIT</label>
          <input type="text" id="cuit" placeholder="30-XXXXXXXX-X" />
          <div class="toolbar" style="margin-top:6px">
            <button type="button" id="btn-consultar-arca">🔎 Consultar ARCA</button>
          </div>
          <div class="hint" id="cuit-validacion"></div>
          <div class="hint" id="arca-estado"></div>
        </div>
        <div id="datos-fiscales-preview" class="hint" style="display:none; margin-bottom:12px"></div>
        <div class="field-row">
          <div class="field">
            <label for="inicioActividades">Inicio de actividades</label>
            <input type="date" id="inicioActividades" />
          </div>
          <div class="field">
            <label for="iibb">IIBB (opcional)</label>
            <input type="text" id="iibb" placeholder="Número de IIBB" />
          </div>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Guardar</button>
        </div>
      </form>
    </div>
  </div>
`;

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";
  });
});

// --- Carga inicial ---
const config = await obtenerConfigEmpresa();

document.getElementById("nombreFantasia").value = config.nombreFantasia || "";
document.getElementById("email").value = config.email || "";
document.getElementById("telefono").value = config.telefono || "";
document.getElementById("whatsapp").value = config.whatsapp || "";
document.getElementById("sitioWeb").value = config.sitioWeb || "";
document.getElementById("cuit").value = config.cuit ? formatearCuit(config.cuit) : "";
document.getElementById("inicioActividades").value = config.inicioActividades || "";
document.getElementById("iibb").value = config.iibb || "";

const logoPreview = document.getElementById("logo-preview");
function pintarLogo(dataUrl) {
  logoPreview.innerHTML = dataUrl
    ? `<img src="${dataUrl}" alt="Logo" style="width:100%; height:100%; object-fit:contain" />`
    : `<span class="hint" style="margin:0">Sin logo</span>`;
}
pintarLogo(config.logoDataUrl);

let datosArcaPreview = null;
function pintarDatosFiscales(datos) {
  const previewEl = document.getElementById("datos-fiscales-preview");
  if (!datos) {
    previewEl.style.display = "none";
    return;
  }
  previewEl.style.display = "block";
  previewEl.innerHTML = `
    <strong style="color:var(--foreground)">${datos.razonSocial || ""}</strong><br/>
    ${datos.condicionIva ? `Condición IVA: ${datos.condicionIva}<br/>` : ""}
    ${datos.domicilioFiscal ? `Domicilio: ${datos.domicilioFiscal}<br/>` : ""}
    ${datos.provincia || ""}${datos.codigoPostal ? ` (CP ${datos.codigoPostal})` : ""}
  `;
}
if (config.razonSocial) pintarDatosFiscales(config);

// --- Formulario de contacto ---
document.getElementById("form-contacto").addEventListener("submit", async (e) => {
  e.preventDefault();
  await guardarDatosContacto({
    nombreFantasia: document.getElementById("nombreFantasia").value,
    email: document.getElementById("email").value,
    telefono: document.getElementById("telefono").value,
    whatsapp: document.getElementById("whatsapp").value,
    sitioWeb: document.getElementById("sitioWeb").value,
  });
  alert("Datos de contacto guardados.");
});

// --- Logo: se redimensiona en el navegador (canvas) para no pasarse del límite de tamaño de un
// documento de Firestore — no usamos Firebase Storage todavía.
function redimensionarLogo(archivo, maxLado = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("El archivo no parece ser una imagen válida."));
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(archivo);
  });
}

document.getElementById("logo-input").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const estadoEl = document.getElementById("logo-estado");
  estadoEl.textContent = "Subiendo…";
  try {
    const dataUrl = await redimensionarLogo(archivo);
    if (dataUrl.length > 900_000) {
      estadoEl.textContent = "La imagen es muy pesada incluso redimensionada — probá con otro archivo.";
      estadoEl.className = "hint error-text";
      return;
    }
    await guardarLogo(dataUrl);
    pintarLogo(dataUrl);
    estadoEl.textContent = "Logo guardado.";
    estadoEl.className = "hint";
  } catch (err) {
    estadoEl.textContent = err?.message || "No se pudo guardar el logo.";
    estadoEl.className = "hint error-text";
  }
});

// --- Datos fiscales (ARCA) ---
const cuitInput = document.getElementById("cuit");
const cuitValidacionEl = document.getElementById("cuit-validacion");

cuitInput.addEventListener("input", () => {
  const digitos = soloDigitos(cuitInput.value);
  const posicionCursor = cuitInput.selectionStart;
  const antesLen = cuitInput.value.length;
  cuitInput.value = formatearCuit(digitos);
  const diff = cuitInput.value.length - antesLen;
  cuitInput.setSelectionRange(posicionCursor + diff, posicionCursor + diff);

  if (digitos.length === 11) {
    cuitValidacionEl.textContent = validarCuit(digitos) ? "✓ CUIT válido." : "El CUIT no es válido (dígito verificador incorrecto).";
    cuitValidacionEl.className = validarCuit(digitos) ? "hint" : "hint error-text";
  } else {
    cuitValidacionEl.textContent = "";
  }
});
if (cuitInput.value) cuitInput.dispatchEvent(new Event("input"));

document.getElementById("btn-consultar-arca").addEventListener("click", async () => {
  const digitos = soloDigitos(cuitInput.value);
  const estadoEl = document.getElementById("arca-estado");
  if (digitos.length !== 11) {
    estadoEl.textContent = "Ingresá un CUIT completo (11 dígitos) primero.";
    estadoEl.className = "hint error-text";
    return;
  }
  const btn = document.getElementById("btn-consultar-arca");
  btn.disabled = true;
  estadoEl.textContent = "Consultando ARCA…";
  estadoEl.className = "hint";
  try {
    datosArcaPreview = await consultarPadronArca(digitos);
    pintarDatosFiscales(datosArcaPreview);
    estadoEl.textContent = "Datos encontrados — revisá y guardá.";
  } catch (err) {
    estadoEl.textContent = "No se pudo consultar ARCA (" + (err?.message || "error desconocido") + ").";
    estadoEl.className = "hint error-text";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("form-fiscal").addEventListener("submit", async (e) => {
  e.preventDefault();
  await guardarDatosFiscales({
    cuit: cuitInput.value,
    datosArca: datosArcaPreview,
    inicioActividades: document.getElementById("inicioActividades").value,
    iibb: document.getElementById("iibb").value,
  });
  alert("Datos fiscales guardados.");
});
