// Selector de cliente estilo "combobox", mismo patrón que proveedor-picker.js: un botón que muestra
// el elegido y, al abrirse, un panel con buscador (por nombre o CUIT/DNI), "+ Crear nuevo cliente"
// fijo arriba, y la lista. A diferencia del de proveedor, el cliente es opcional (ventas sin cliente
// son "Consumidor final") — por eso suma limpiarSeleccion().
import { crearCliente, buscarClientePorCuit, buscarClientesTexto } from "./clientes.js";
import { pedirClienteModal } from "./cliente-modal.js";
import { escapeHtml } from "./escape-html.js";

export function initClientePicker(container, { onSelect, seleccionActual = null, placeholder = "Elegir cliente…" } = {}) {
  container.classList.add("picker");
  container.innerHTML = `
    <button type="button" class="picker-toggle" id="cp-toggle">
      <span id="cp-label">${seleccionActual ? escapeHtml(seleccionActual.razonSocial) : placeholder}</span>
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
  let abierto = false;
  let busquedaId = 0; // descarta una respuesta vieja si llega después de una más nueva

  function render(items, mensajeVacio) {
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.innerHTML = `<div class="hint" style="padding:8px 12px">${mensajeVacio}</div>`;
      return;
    }
    items.forEach((c) => {
      const row = document.createElement("div");
      row.className = "picker-item";
      row.innerHTML = `<div>${escapeHtml(c.razonSocial)}</div><div class="hint">CUIT ${escapeHtml(c.cuit || "-")}</div>`;
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

  function abrir() {
    abierto = true;
    panel.style.display = "block";
    searchInput.value = "";
    searchInput.focus();
    render([], "Escribí un nombre o CUIT/DNI para buscar.");
  }

  function cerrar() {
    abierto = false;
    panel.style.display = "none";
  }

  toggle.addEventListener("click", () => (abierto ? cerrar() : abrir()));

  // Búsqueda bajo demanda (Firestore, prefijo por nombre o CUIT — ver buscarClientesTexto) en vez de
  // traer TODOS los clientes al abrir el panel y filtrar en memoria: con los clientes de prueba no se
  // notaba, pero con miles reales (migración de GBP) esa carga inicial se volvía lenta o directamente
  // se colgaba. Debounce de 300ms para no disparar una consulta por cada tecla, y un id de búsqueda
  // para no pintar una respuesta vieja que llegó tarde si mientras tanto se siguió escribiendo.
  let debounceTimer = null;
  searchInput.addEventListener("input", () => {
    const texto = searchInput.value.trim();
    clearTimeout(debounceTimer);
    if (!texto) {
      render([], "Escribí un nombre o CUIT/DNI para buscar.");
      return;
    }
    const idActual = ++busquedaId;
    debounceTimer = setTimeout(async () => {
      const resultados = await buscarClientesTexto(texto);
      if (idActual !== busquedaId) return; // llegó tarde, ya hay una búsqueda más nueva en curso
      render(resultados, "Sin resultados.");
    }, 300);
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
