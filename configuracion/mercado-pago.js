import { requireAuth } from "/js/auth.js";
import { renderConfigShell } from "/js/configuracion-shell.js";
import { functions, httpsCallable } from "/js/firebase.js";
import { obtenerConfigMercadoPago, guardarConfigMercadoPago } from "/js/mercado-pago.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderConfigShell({ activeItem: "mercado-pago", titulo: "Mercado Pago", usuario });

content.innerHTML = `
  <div id="banner-modo"></div>

  <div class="card" style="padding:20px; margin-bottom:16px; max-width:560px">
    <div class="section-title">Modo</div>
    <div class="hint" style="margin-bottom:12px">
      En TEST, todas las operaciones van contra el entorno de pruebas de Mercado Pago (Point con el
      dispositivo virtual de prueba) — no se procesa dinero real bajo ninguna circunstancia.
      Producción todavía no está habilitada en este ERP.
    </div>
    <div class="field-row">
      <label style="display:flex; align-items:center; gap:8px; font-weight:400; color:var(--foreground)">
        <input type="radio" name="modo" value="test" style="width:auto" />
        🧪 TEST
      </label>
      <label style="display:flex; align-items:center; gap:8px; font-weight:400; color:var(--muted)">
        <input type="radio" name="modo" value="produccion" style="width:auto" disabled />
        🟢 PRODUCCIÓN <span class="badge muted">no disponible todavía</span>
      </label>
    </div>
    <div class="toolbar" style="margin-top:8px">
      <button type="button" id="btn-guardar" class="primary">Guardar</button>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px; max-width:560px">
    <div class="section-title">Access Token de prueba</div>
    <div class="hint" style="margin-bottom:10px">
      Es la única credencial que hace falta — Point/Orders no necesita Public Key ni nada del lado
      del navegador, la tarjeta la lee el terminal, no el ERP. Se busca en Mercado Pago →
      <strong>Tus integraciones</strong> → tu aplicación → <strong>Credenciales de prueba</strong>
      (empieza con <code>TEST-</code>).
    </div>
    <div class="field">
      <label for="input-access-token">Pegar Access Token de prueba</label>
      <input type="password" id="input-access-token" placeholder="TEST-xxxxxxxxxxxx-xxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxx" autocomplete="off" />
    </div>
    <div class="toolbar" style="margin-top:8px">
      <button type="button" id="btn-guardar-token" class="primary">Guardar credencial</button>
    </div>
    <div id="token-estado" class="hint" style="margin-top:8px"></div>
    <div class="hint" style="margin-top:10px">
      El valor va directo a Secret Manager (el mismo lugar donde vive cualquier credencial de este
      ERP) — no queda guardado en Firestore ni se vuelve a mostrar en ninguna pantalla, ni siquiera
      acá. Si preferís la terminal en vez de este formulario, también funciona:
      <code>firebase functions:secrets:set MP_ACCESS_TOKEN_TEST --project delfino-hogar-erp</code>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px; max-width:560px">
    <div class="section-title">Secret del webhook</div>
    <div class="hint" style="margin-bottom:10px">
      Se completa más adelante: primero hay que desplegar el webhook para tener la URL, configurarla
      en Mercado Pago, y recién ahí Mercado Pago genera esta clave. El Centro de pruebas te va a
      avisar cuándo cargarla.
    </div>
    <div class="field">
      <label for="input-webhook-secret">Pegar secret del webhook</label>
      <input type="password" id="input-webhook-secret" placeholder="Se genera al configurar el webhook en Mercado Pago" autocomplete="off" />
    </div>
    <div class="toolbar" style="margin-top:8px">
      <button type="button" id="btn-guardar-webhook-secret" class="primary">Guardar credencial</button>
    </div>
    <div id="webhook-secret-estado" class="hint" style="margin-top:8px"></div>
  </div>

  <div class="toolbar">
    <a href="/mercado-pago/centro-pruebas.html"><button type="button" class="primary">Ir al Centro de pruebas →</button></a>
  </div>
`;

function pintarBanner(modo) {
  document.getElementById("banner-modo").innerHTML =
    modo === "produccion"
      ? ""
      : `<div class="card" style="padding:12px 16px; margin-bottom:16px; background:var(--warning-bg); border-color:var(--warning); color:var(--warning); font-weight:600; text-align:center">
          🧪 MODO PRUEBA — NO SE ESTÁN PROCESANDO COBROS REALES
        </div>`;
}

const config = await obtenerConfigMercadoPago();
const modoActual = config.modo === "produccion" ? "produccion" : "test";
document.querySelector(`input[name="modo"][value="${modoActual}"]`).checked = true;
pintarBanner(modoActual);

document.getElementById("btn-guardar").addEventListener("click", async () => {
  const modo = document.querySelector('input[name="modo"]:checked').value;
  await guardarConfigMercadoPago({ modo });
  pintarBanner(modo);
  alert("Configuración guardada.");
});

async function guardarSecreto(nombre, inputId, estadoId, boton) {
  const input = document.getElementById(inputId);
  const estadoEl = document.getElementById(estadoId);
  const valor = input.value;
  if (!valor.trim()) {
    estadoEl.textContent = "Pegá un valor primero.";
    estadoEl.className = "hint error-text";
    return;
  }
  boton.disabled = true;
  estadoEl.textContent = "Guardando…";
  estadoEl.className = "hint";
  try {
    const fn = httpsCallable(functions, "guardarSecretoAdmin");
    await fn({ nombre, valor });
    input.value = ""; // nunca se deja el valor pegado en pantalla más tiempo del necesario
    estadoEl.textContent = "Guardado. Avisale a la IA para que redespliegue las funciones y tome este valor.";
    estadoEl.className = "hint";
  } catch (err) {
    estadoEl.textContent = "No se pudo guardar: " + (err?.message || "error desconocido");
    estadoEl.className = "hint error-text";
  } finally {
    boton.disabled = false;
  }
}

document.getElementById("btn-guardar-token").addEventListener("click", () => {
  guardarSecreto("MP_ACCESS_TOKEN_TEST", "input-access-token", "token-estado", document.getElementById("btn-guardar-token"));
});
document.getElementById("btn-guardar-webhook-secret").addEventListener("click", () => {
  guardarSecreto("MP_WEBHOOK_SECRET_TEST", "input-webhook-secret", "webhook-secret-estado", document.getElementById("btn-guardar-webhook-secret"));
});
