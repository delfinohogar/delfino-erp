// Selector de proveedor estilo "combobox": un botón que muestra el elegido y, al abrirse,
// un panel con buscador (por nombre o CUIT), "+ Crear nuevo proveedor" fijo arriba, y la lista.
import { listarProveedoresTodos, crearProveedor } from "./catalogo.js";
import { pedirProveedorModal } from "./proveedor-modal.js";

export function initProveedorPicker(container, { onSelect, seleccionActual = null } = {}) {
  container.classList.add("picker");
  container.innerHTML = `
    <button type="button" class="picker-toggle" id="pp-toggle">
      <span id="pp-label">${seleccionActual ? seleccionActual.razonSocial : "Elegir proveedor…"}</span>
      <span class="picker-chevron">▾</span>
    </button>
    <div class="picker-panel" id="pp-panel" style="display:none">
      <input type="text" id="pp-search" placeholder="Buscá por nombre o DNI/CUIT…" autocomplete="off" />
      <div class="picker-item picker-create" id="pp-crear">+ Crear nuevo proveedor</div>
      <div class="picker-list" id="pp-list"></div>
    </div>
  `;

  const toggle = container.querySelector("#pp-toggle");
  const label = container.querySelector("#pp-label");
  const panel = container.querySelector("#pp-panel");
  const searchInput = container.querySelector("#pp-search");
  const listEl = container.querySelector("#pp-list");
  const crearEl = container.querySelector("#pp-crear");

  let seleccionado = seleccionActual;
  let todos = [];
  let cargados = false;
  let abierto = false;

  function render(items) {
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.innerHTML = '<div class="hint" style="padding:8px 12px">Sin resultados.</div>';
      return;
    }
    items.forEach((p) => {
      const row = document.createElement("div");
      row.className = "picker-item";
      row.innerHTML = `<div>${p.razonSocial}</div><div class="hint">CUIT ${p.cuit || "-"}</div>`;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        elegir(p);
      });
      listEl.appendChild(row);
    });
  }

  function elegir(p) {
    seleccionado = p;
    label.textContent = p.razonSocial;
    cerrar();
    onSelect(p);
  }

  async function abrir() {
    abierto = true;
    panel.style.display = "block";
    searchInput.value = "";
    searchInput.focus();
    if (!cargados) {
      todos = await listarProveedoresTodos();
      cargados = true;
    }
    render(todos);
  }

  function cerrar() {
    abierto = false;
    panel.style.display = "none";
  }

  toggle.addEventListener("click", () => (abierto ? cerrar() : abrir()));

  searchInput.addEventListener("input", () => {
    const texto = searchInput.value.trim().toLowerCase();
    if (!texto) {
      render(todos);
      return;
    }
    const filtrados = todos.filter(
      (p) => (p.razonSocialLower || "").includes(texto) || (p.cuit || "").includes(texto)
    );
    render(filtrados);
  });

  crearEl.addEventListener("mousedown", async (e) => {
    e.preventDefault();
    cerrar();
    const datos = await pedirProveedorModal(searchInput.value.trim());
    if (!datos) return;
    const nuevo = await crearProveedor(datos.razonSocial, datos.cuit, datos.datosArca);
    cargados = false;
    elegir(nuevo);
  });

  document.addEventListener("mousedown", (e) => {
    if (abierto && !container.contains(e.target)) cerrar();
  });

  return {
    getSeleccionado: () => seleccionado,
    // Usado cuando ya se conoce el proveedor exacto (ej. viniendo de una orden de compra) — lo
    // selecciona directo, sin pasar por la búsqueda.
    seleccionarDirecto(proveedor) {
      elegir(proveedor);
    },
    // Usado al precargar desde la IA: intenta encontrar un match exacto por CUIT o nombre;
    // si no hay match, abre el panel con el texto ya escrito para que el usuario cree el proveedor.
    async buscarOAbrir(texto, cuit) {
      if (!cargados) {
        todos = await listarProveedoresTodos();
        cargados = true;
      }
      const cuitLimpio = (cuit || "").replace(/\D/g, "");
      const match =
        (cuitLimpio && todos.find((p) => (p.cuit || "").replace(/\D/g, "") === cuitLimpio)) ||
        todos.find((p) => (p.razonSocialLower || "") === (texto || "").toLowerCase());
      if (match) {
        elegir(match);
        return;
      }
      abierto = true;
      panel.style.display = "block";
      searchInput.value = texto || "";
      render(todos.filter((p) => (p.razonSocialLower || "").includes((texto || "").toLowerCase())));
    },
  };
}
