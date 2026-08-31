// Autocomplete genérico con "crear al vuelo": si el texto tipeado no matchea nada existente,
// ofrece un ítem "Crear '<texto>'" que llama a onCreate() y selecciona el resultado.
// wrapperEl debe tener adentro: input[data-role=search] y un div[data-role=list].
export function attachAutocomplete(wrapperEl, { buscar, etiqueta, onSelect, onCreate, crearLabel = "Crear" }) {
  const input = wrapperEl.querySelector('[data-role="search"]');
  const list = wrapperEl.querySelector('[data-role="list"]');
  let items = [];
  let debounceTimer = null;

  // La lista se mueve a <body> con posición fija: si se la deja adentro de un contenedor con
  // overflow (ej. la tabla de líneas con scroll horizontal), queda recortada/atrapada en vez de
  // flotar sobre el resto de la página.
  document.body.appendChild(list);
  list.style.position = "fixed";
  list.style.right = "auto";

  function posicionar() {
    const r = input.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom + 4}px`;
    list.style.width = `${r.width}px`;
  }

  function cerrar() {
    list.classList.remove("open");
    list.innerHTML = "";
  }

  function render(texto) {
    list.innerHTML = "";
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "autocomplete-item";
      el.textContent = etiqueta(item);
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = etiqueta(item);
        cerrar();
        onSelect(item);
      });
      list.appendChild(el);
    });

    if (texto && onCreate) {
      const exact = items.some((item) => etiqueta(item).toLowerCase() === texto.toLowerCase());
      if (!exact) {
        const createEl = document.createElement("div");
        createEl.className = "autocomplete-item";
        createEl.innerHTML = `<span class="create-new">+ ${crearLabel} "${texto}"</span>`;
        createEl.addEventListener("mousedown", async (e) => {
          e.preventDefault();
          const nuevo = await onCreate(texto);
          if (!nuevo) return; // el usuario canceló la creación (ej. cerró el modal)
          input.value = etiqueta(nuevo);
          cerrar();
          onSelect(nuevo);
        });
        list.appendChild(createEl);
      }
    }

    posicionar();
    list.classList.toggle("open", list.children.length > 0);
  }

  input.addEventListener("input", () => {
    onSelect(null); // se limpia la selección hasta que el usuario elija algo de la lista
    const texto = input.value.trim();
    clearTimeout(debounceTimer);
    if (!texto) {
      cerrar();
      return;
    }
    debounceTimer = setTimeout(async () => {
      items = await buscar(texto);
      render(texto);
    }, 200);
  });

  input.addEventListener("blur", () => {
    setTimeout(cerrar, 150);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (list.classList.contains("open")) posicionar();
    },
    true
  );
}
