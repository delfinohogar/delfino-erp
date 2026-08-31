// Selector de categoría en árbol (estilo Tiendanube): navegás Categoría > SubCategoría,
// seleccionás un nodo existente, creás uno nuevo ahí mismo, o lo renombrás con el lápiz.
import { db, collection, getDocs, query, where, orderBy } from "./firebase.js";
import { crearCategoria, renombrarCategoria } from "./catalogo.js";

async function cargarArbol() {
  const [catSnap, subSnap] = await Promise.all([
    getDocs(query(collection(db, "categorias"), where("nivel", "==", "categoria"), orderBy("nombreLower"))),
    getDocs(query(collection(db, "categorias"), where("nivel", "==", "subcategoria"), orderBy("nombreLower"))),
  ]);
  const categorias = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const subcategorias = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return categorias.map((c) => ({ ...c, hijos: subcategorias.filter((s) => s.parentId === c.id) }));
}

// seleccionActual: { categoriaId, subcategoriaId } | null
// Devuelve { categoriaId, subcategoriaId, categoriaNombre, subcategoriaNombre } o null si se cancela.
export function abrirSelectorCategoria(seleccionActual) {
  return new Promise(async (resolve) => {
    let arbol = await cargarArbol();
    let seleccion = { categoriaId: seleccionActual?.categoriaId || null, subcategoriaId: seleccionActual?.subcategoriaId || null };
    const expandidos = new Set(seleccion.categoriaId ? [seleccion.categoriaId] : []);
    let filtro = "";
    let agregandoRaiz = false;
    let agregandoHijoDe = null; // id de categoría donde se está por agregar una subcategoría
    let editandoId = null; // id del nodo (categoría o subcategoría) que se está renombrando

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card card" style="max-width:420px; max-height:80vh; display:flex; flex-direction:column">
      <div class="section-title">Elegir categoría</div>
      <input type="text" id="ct-filtro" placeholder="Buscar…" style="margin-bottom:10px" />
      <div id="ct-arbol" style="overflow-y:auto; flex:1; min-height:200px"></div>
      <button type="button" id="ct-agregar-raiz" style="margin-top:10px; text-align:left; color:var(--accent); border:none; background:none">+ Nueva categoría</button>
      <div class="toolbar" style="margin-top:12px">
        <button type="button" id="ct-confirmar" class="primary">Usar esta categoría</button>
        <button type="button" id="ct-cancelar">Cancelar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const arbolEl = overlay.querySelector("#ct-arbol");
    const filtroEl = overlay.querySelector("#ct-filtro");
    const confirmarBtn = overlay.querySelector("#ct-confirmar");

    function coincide(nombre) {
      return !filtro || nombre.toLowerCase().includes(filtro.toLowerCase());
    }

    function filaHtml({ id, nombre, esHijo, expandido }) {
      const seleccionado =
        (esHijo && seleccion.subcategoriaId === id) || (!esHijo && !seleccion.subcategoriaId && seleccion.categoriaId === id);

      if (editandoId === id) {
        return `
          <div style="margin-left:${esHijo ? "20px" : "0"}; display:flex; gap:6px; padding:4px 8px; align-items:center">
            <span class="tree-toggle"></span>
            <input type="text" data-rename-input="${id}" value="${nombre}" style="flex:1" />
            <button type="button" data-rename-ok="${id}">✓</button>
          </div>
        `;
      }

      return `
        <div class="tree-row ${seleccionado ? "selected" : ""}" style="margin-left:${esHijo ? "20px" : "0"}">
          ${!esHijo ? `<span class="tree-toggle" data-toggle="${id}">${expandido ? "▾" : "▸"}</span>` : '<span class="tree-toggle"></span>'}
          <span class="tree-label" data-select="${id}" data-hijo-select="${esHijo}">${nombre}</span>
          <span data-edit="${id}" title="Renombrar" style="cursor:pointer; opacity:0.6; padding:0 4px">✎</span>
        </div>
      `;
    }

    function render() {
      let html = "";
      arbol.forEach((cat) => {
        const hijosFiltrados = cat.hijos.filter((h) => coincide(h.nombre));
        const catCoincide = coincide(cat.nombre);
        if (!catCoincide && hijosFiltrados.length === 0 && filtro) return;

        const expandido = expandidos.has(cat.id) || (filtro && hijosFiltrados.length > 0);
        html += filaHtml({ id: cat.id, nombre: cat.nombre, esHijo: false, expandido });

        if (expandido) {
          const hijosAMostrar = filtro ? hijosFiltrados : cat.hijos;
          hijosAMostrar.forEach((sub) => {
            html += filaHtml({ id: sub.id, nombre: sub.nombre, esHijo: true });
          });
          if (agregandoHijoDe === cat.id) {
            html += `<div style="margin-left:20px; display:flex; gap:6px; padding:4px 8px">
              <input type="text" id="ct-nuevo-hijo-input" placeholder="Nueva subcategoría…" style="flex:1" />
              <button type="button" id="ct-nuevo-hijo-ok">✓</button>
            </div>`;
          } else {
            html += `<div style="margin-left:20px"><button type="button" class="ct-agregar-hijo" data-parent="${cat.id}" style="border:none;background:none;color:var(--accent);padding:4px 8px">+ Nueva subcategoría</button></div>`;
          }
        }
      });

      if (agregandoRaiz) {
        html += `<div style="display:flex; gap:6px; padding:4px 8px; margin-top:4px">
          <input type="text" id="ct-nueva-raiz-input" placeholder="Nueva categoría…" style="flex:1" />
          <button type="button" id="ct-nueva-raiz-ok">✓</button>
        </div>`;
      }

      arbolEl.innerHTML = html || `<div class="hint" style="padding:8px">Sin resultados.</div>`;
      wireRowEvents();
    }

    function wireRowEvents() {
      arbolEl.querySelectorAll("[data-toggle]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = el.dataset.toggle;
          if (expandidos.has(id)) expandidos.delete(id);
          else expandidos.add(id);
          render();
        });
      });

      arbolEl.querySelectorAll("[data-select]").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.dataset.select;
          const esHijo = el.dataset.hijoSelect === "true";
          if (esHijo) {
            const cat = arbol.find((c) => c.hijos.some((h) => h.id === id));
            seleccion = { categoriaId: cat.id, subcategoriaId: id };
          } else {
            seleccion = { categoriaId: id, subcategoriaId: null };
            expandidos.add(id);
          }
          render();
        });
      });

      arbolEl.querySelectorAll("[data-edit]").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          editandoId = el.dataset.edit;
          render();
          overlay.querySelector(`[data-rename-input="${editandoId}"]`)?.focus();
        });
      });

      arbolEl.querySelectorAll("[data-rename-ok]").forEach((el) => {
        const id = el.dataset.renameOk;
        const confirmarRename = async () => {
          const input = overlay.querySelector(`[data-rename-input="${id}"]`);
          const nuevoNombre = input.value.trim();
          if (!nuevoNombre) return;
          await renombrarCategoria(id, nuevoNombre);
          const cat = arbol.find((c) => c.id === id);
          if (cat) {
            cat.nombre = nuevoNombre;
          } else {
            arbol.forEach((c) => {
              const sub = c.hijos.find((h) => h.id === id);
              if (sub) sub.nombre = nuevoNombre;
            });
          }
          editandoId = null;
          render();
        };
        el.addEventListener("click", confirmarRename);
        overlay.querySelector(`[data-rename-input="${id}"]`)?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirmarRename();
          }
          if (e.key === "Escape") {
            editandoId = null;
            render();
          }
        });
      });

      arbolEl.querySelectorAll(".ct-agregar-hijo").forEach((el) => {
        el.addEventListener("click", () => {
          agregandoHijoDe = el.dataset.parent;
          render();
          overlay.querySelector("#ct-nuevo-hijo-input")?.focus();
        });
      });

      const nuevoHijoInput = arbolEl.querySelector("#ct-nuevo-hijo-input");
      if (nuevoHijoInput) {
        const confirmarNuevoHijo = async () => {
          const nombre = nuevoHijoInput.value.trim();
          if (!nombre) return;
          const nueva = await crearCategoria(nombre, "subcategoria", agregandoHijoDe);
          const cat = arbol.find((c) => c.id === agregandoHijoDe);
          cat.hijos.push(nueva);
          seleccion = { categoriaId: cat.id, subcategoriaId: nueva.id };
          agregandoHijoDe = null;
          render();
        };
        nuevoHijoInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirmarNuevoHijo();
          }
        });
        overlay.querySelector("#ct-nuevo-hijo-ok").addEventListener("click", confirmarNuevoHijo);
      }

      const nuevaRaizInput = arbolEl.querySelector("#ct-nueva-raiz-input");
      if (nuevaRaizInput) {
        nuevaRaizInput.focus();
        const confirmarNuevaRaiz = async () => {
          const nombre = nuevaRaizInput.value.trim();
          if (!nombre) return;
          const nueva = await crearCategoria(nombre, "categoria");
          arbol.push({ ...nueva, hijos: [] });
          seleccion = { categoriaId: nueva.id, subcategoriaId: null };
          agregandoRaiz = false;
          render();
        };
        nuevaRaizInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            confirmarNuevaRaiz();
          }
        });
        overlay.querySelector("#ct-nueva-raiz-ok").addEventListener("click", confirmarNuevaRaiz);
      }
    }

    filtroEl.addEventListener("input", () => {
      filtro = filtroEl.value;
      render();
    });

    overlay.querySelector("#ct-agregar-raiz").addEventListener("click", () => {
      agregandoRaiz = true;
      render();
    });

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    confirmarBtn.addEventListener("click", () => {
      if (!seleccion.categoriaId) {
        cerrar(null);
        return;
      }
      const cat = arbol.find((c) => c.id === seleccion.categoriaId);
      const sub = seleccion.subcategoriaId ? cat?.hijos.find((h) => h.id === seleccion.subcategoriaId) : null;
      cerrar({
        categoriaId: seleccion.categoriaId,
        subcategoriaId: seleccion.subcategoriaId,
        categoriaNombre: cat?.nombre || "",
        subcategoriaNombre: sub?.nombre || "",
      });
    });

    overlay.querySelector("#ct-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });

    render();
  });
}
