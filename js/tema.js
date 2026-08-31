// Selector de tema Claro/Oscuro/Sistema, igual que La Pyme. "Sistema" no fuerza nada — se saca el
// atributo data-theme y el CSS de @media (prefers-color-scheme: dark) decide solo, incluso si el
// usuario cambia el tema del sistema operativo sin recargar la página.
const CLAVE = "tema";

function aplicarTema(pref) {
  if (pref === "claro") document.documentElement.setAttribute("data-theme", "light");
  else if (pref === "oscuro") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
}

// Se llama lo antes posible en cada página (ver shell.js) para minimizar el parpadeo del tema
// equivocado antes de que termine de cargar el resto.
export function aplicarTemaGuardado() {
  let pref = "sistema";
  try {
    pref = localStorage.getItem(CLAVE) || "sistema";
  } catch {
    // Sin storage (ej. navegación privada) — se sigue con "sistema".
  }
  aplicarTema(pref);
  return pref;
}

const OPCIONES = [
  { valor: "claro", label: "Claro", icono: "☀️" },
  { valor: "oscuro", label: "Oscuro", icono: "🌙" },
  { valor: "sistema", label: "Sistema", icono: "🖥️" },
];

export function initSelectorTema(container) {
  let prefActual = "sistema";
  try {
    prefActual = localStorage.getItem(CLAVE) || "sistema";
  } catch {
    // Sin storage, el selector sigue funcionando — solo no se recuerda para la próxima página.
  }

  container.classList.add("theme-picker");
  container.innerHTML = `
    <button type="button" class="icon-btn" id="theme-toggle-btn" title="Tema" aria-label="Cambiar tema">🌓</button>
    <div class="theme-panel" id="theme-panel" style="display:none">
      ${OPCIONES.map((o) => `<div class="theme-option" data-valor="${o.valor}"><span>${o.icono}</span><span>${o.label}</span></div>`).join("")}
    </div>
  `;

  const btn = container.querySelector("#theme-toggle-btn");
  const panel = container.querySelector("#theme-panel");

  function pintarSeleccion() {
    panel.querySelectorAll(".theme-option").forEach((el) => {
      el.classList.toggle("selected", el.dataset.valor === prefActual);
    });
  }
  pintarSeleccion();

  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  panel.querySelectorAll(".theme-option").forEach((el) => {
    el.addEventListener("click", () => {
      prefActual = el.dataset.valor;
      aplicarTema(prefActual);
      try {
        localStorage.setItem(CLAVE, prefActual);
      } catch {
        // Sin storage, el tema se aplica igual — solo no persiste para la próxima página.
      }
      pintarSeleccion();
      panel.style.display = "none";
    });
  });

  document.addEventListener("mousedown", (e) => {
    if (!container.contains(e.target)) panel.style.display = "none";
  });
}
