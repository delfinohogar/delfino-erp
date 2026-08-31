// Botón flotante de chat con la IA, disponible en todas las pantallas (se monta desde renderShell).
// Le hace preguntas de solo-lectura sobre los datos reales del ERP (stock, precios, historial, proveedores).
import { preguntarIa } from "./chat-ia.js";

export function montarChatWidget() {
  if (document.getElementById("chat-ia-fab")) return; // ya montado

  let historial = [];
  let abierto = false;

  const fab = document.createElement("button");
  fab.id = "chat-ia-fab";
  fab.className = "chat-ia-fab";
  fab.type = "button";
  fab.textContent = "💬";
  fab.title = "Preguntale a la IA sobre tus datos";

  const panel = document.createElement("div");
  panel.className = "chat-ia-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="chat-ia-header">
      <span>Preguntale a la IA</span>
      <button type="button" id="chat-ia-cerrar" style="border:none;background:none;color:inherit;cursor:pointer">✕</button>
    </div>
    <div class="chat-ia-mensajes" id="chat-ia-mensajes">
      <div class="chat-ia-bubble assistant">Hola — preguntame cosas como "¿qué productos tienen poco stock?" o "¿cuánto sale la aspiradora Ultracomb?".</div>
    </div>
    <form id="chat-ia-form" class="chat-ia-input-row">
      <input type="text" id="chat-ia-input" placeholder="Escribí tu pregunta…" autocomplete="off" />
      <button type="submit" class="primary">Enviar</button>
    </form>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const mensajesEl = panel.querySelector("#chat-ia-mensajes");
  const formEl = panel.querySelector("#chat-ia-form");
  const inputEl = panel.querySelector("#chat-ia-input");

  function agregarBurbuja(texto, rol) {
    const b = document.createElement("div");
    b.className = `chat-ia-bubble ${rol}`;
    b.textContent = texto;
    mensajesEl.appendChild(b);
    mensajesEl.scrollTop = mensajesEl.scrollHeight;
    return b;
  }

  function alternar() {
    abierto = !abierto;
    panel.style.display = abierto ? "flex" : "none";
    if (abierto) inputEl.focus();
  }

  fab.addEventListener("click", alternar);
  panel.querySelector("#chat-ia-cerrar").addEventListener("click", alternar);

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const mensaje = inputEl.value.trim();
    if (!mensaje) return;
    inputEl.value = "";
    agregarBurbuja(mensaje, "user");
    const pensando = agregarBurbuja("Pensando…", "assistant");
    inputEl.disabled = true;

    try {
      const res = await preguntarIa(mensaje, historial);
      historial = res.historial || historial;
      pensando.textContent = res.respuesta || "No obtuve respuesta.";
    } catch (err) {
      pensando.textContent = "No se pudo conectar con la IA (" + (err?.message || "error desconocido") + ").";
      pensando.classList.add("error");
    } finally {
      inputEl.disabled = false;
      inputEl.focus();
    }
  });
}
