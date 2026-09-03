// Buscador superior tipo paleta de comandos: Ctrl+K (o Cmd+K) lo enfoca desde cualquier pantalla.
// Sin texto muestra acciones rápidas; al escribir, además busca en productos/clientes/proveedores.
import { buscarProductos } from "./productos.js";
import { buscarClientesTexto } from "./clientes.js";
import { buscarProveedores } from "./catalogo.js";

const ACCIONES = [
  { label: "Dashboard", href: "/dashboard.html" },
  { label: "Nueva venta", href: "/productos/venta-nueva.html" },
  { label: "Nuevo producto", href: "/productos/form.html" },
  { label: "Nueva compra", href: "/productos/compras-nueva.html" },
  { label: "Registrar cobro", href: "/productos/cobros-nueva.html" },
  { label: "Registrar pago", href: "/productos/pagos-nueva.html" },
];

export function initBuscadorGlobal(container) {
  container.classList.add("gsearch");
  container.innerHTML = `
    <input type="text" id="gsearch-input" placeholder="Buscar…" autocomplete="off" />
    <span class="gsearch-kbd">Ctrl K</span>
    <div class="gsearch-panel" id="gsearch-panel" style="display:none"></div>
  `;

  const input = container.querySelector("#gsearch-input");
  const panel = container.querySelector("#gsearch-panel");

  function seccion(titulo, items) {
    if (items.length === 0) return "";
    return `
      <div class="gsearch-seccion">${titulo}</div>
      ${items
        .map(
          (it, i) =>
            `<div class="gsearch-item" data-href="${it.href}"><span>${it.label}</span>${it.sub ? `<span class="hint">${it.sub}</span>` : ""}</div>`
        )
        .join("")}
    `;
  }

  function render(html) {
    panel.innerHTML = html || `<div class="hint" style="padding:12px">Sin resultados.</div>`;
    panel.querySelectorAll("[data-href]").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        location.href = el.dataset.href;
      });
    });
  }

  function abrir() {
    panel.style.display = "block";
    if (!input.value.trim()) {
      render(seccion("Acciones", ACCIONES));
    }
  }

  function cerrar() {
    panel.style.display = "none";
  }

  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const texto = input.value.trim();
    if (!texto) {
      abrir();
      return;
    }
    const accionesFiltradas = ACCIONES.filter((a) => a.label.toLowerCase().includes(texto.toLowerCase()));
    render(seccion("Acciones", accionesFiltradas));
    debounceTimer = setTimeout(async () => {
      const [productos, clientes, proveedores] = await Promise.all([
        buscarProductos(texto, 5),
        buscarClientesTexto(texto),
        buscarProveedores(texto),
      ]);
      render(
        seccion("Acciones", accionesFiltradas) +
          seccion(
            "Productos",
            productos.slice(0, 5).map((p) => ({ label: p.descripcion, sub: p.sku, href: `/productos/form.html?id=${p.id}` }))
          ) +
          seccion(
            "Clientes",
            clientes.slice(0, 5).map((c) => ({ label: c.razonSocial, sub: c.cuit, href: `/configuracion/cliente-ficha.html?id=${c.id}` }))
          ) +
          seccion(
            "Proveedores",
            proveedores
              .slice(0, 5)
              .map((p) => ({ label: p.razonSocial, sub: p.cuit, href: `/configuracion/proveedor-ficha.html?id=${p.id}` }))
          )
      );
    }, 250);
  });

  input.addEventListener("focus", abrir);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.blur();
      cerrar();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!container.contains(e.target)) cerrar();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
