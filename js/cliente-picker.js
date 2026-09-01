// Selector de cliente estilo "combobox", mismo patrón que proveedor-picker.js: un botón que muestra
// el elegido y, al abrirse, un panel con buscador (por nombre o CUIT/DNI), "+ Crear nuevo cliente"
// fijo arriba, y la lista. A diferencia del de proveedor, el cliente es opcional (ventas sin cliente
// son "Consumidor final") — por eso suma limpiarSeleccion().
import { listarClientesTodos, crearCliente, buscarClientePorCuit } from "./clientes.js";
import { pedirClienteModal } from "./cliente-modal.js";

export function initClientePicker(container, { onSelect, seleccionActual = null, placeholder = "Elegir cliente…" } = {}) {
  container.classList.add("picker");
  container.innerHTML = `
    <button type="button" class="picker-toggle" id="cp-toggle">
      <span id="cp-label">${seleccionActual ? seleccionActual.razonSocial : placeholder}</span>
      <span class="picker-chevron">▾</span>
    </button>
    <div class="picker-panel" id="cp-panel" style="display:none">
      <input type="text" id="cp-search" placeholder="Buscá por nombre o DNI/CUIT…" autocomplete="off" />
      <div class="picker-item picker-create" id="cp-crear">+ Crear nuevo cliente</div>
      <div class="picker-list" id="cp-list"></div>
    </div>
  `;

  const toggle = container.querySelector("#cp-toggle");
  const label = container.querySelector("#cp-label");
  const panel = container.querySelector("#cp-panel");
  const searchInput = container.querySelector("#cp-search");
  const listEl = container.querySelector("#cp-list");
  const crearEl = container.querySelector("#cp-crear");

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
    items.forEach((c) => {
      const row = document.createElement("div");
      row.className = "picker-item";
      row.innerHTML = `<div>${c.razonSocial}</div><div class="hint">CUIT ${c.cuit || "-"}</div>`;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        elegir(c);
      });
      listEl.appendChild(row);
    });
  }

  function elegir(c) {
    seleccionado = c;
    label.textContent = c.razonSocial;
    cerrar();
    onSelect(c);
  }

  async function abrir() {
    abierto = true;
    panel.style.display = "block";
    searchInput.value = "";
    searchInput.focus();
    if (!cargados) {
      todos = await listarClientesTodos();
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
    const filtrados = todos.filter((c) => (c.razonSocialLower || "").includes(texto) || (c.cuit || "").includes(texto));
    render(filtrados);
  });

  crearEl.addEventListener("mousedown", async (e) => {
    e.preventDefault();
    cerrar();
    const datos = await pedirClienteModal(searchInput.value.trim());
    if (!datos) return;

    // crearCliente no valida nada por sí sola — antes de duplicar, se chequea si ese CUIT/DNI
    // ya está cargado y se ofrece usar ese cliente en vez de crear uno nuevo.
    const existente = await buscarClientePorCuit(datos.cuit);
    if (existente) {
      const usarExistente = confirm(
        `Ya hay un cliente con ese CUIT/DNI: "${existente.razonSocial}".\n\n¿Usar ese cliente en vez de crear uno nuevo?`
      );
      if (usarExistente) {
        elegir(existente);
        return;
      }
    }

    const nuevo = await crearCliente(datos.razonSocial, datos.cuit, datos.datosArca, datos.datosContacto);
    cargados = false;
    elegir(nuevo);
  });

  document.addEventListener("mousedown", (e) => {
    if (abierto && !container.contains(e.target)) cerrar();
  });

  return {
    getSeleccionado: () => seleccionado,
    seleccionarDirecto(cliente) {
      elegir(cliente);
    },
    limpiarSeleccion() {
      seleccionado = null;
      label.textContent = placeholder;
      onSelect(null);
    },
    abrirPanel() {
      if (!abierto) abrir();
    },
  };
}
