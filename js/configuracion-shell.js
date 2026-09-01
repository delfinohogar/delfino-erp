// Shell interno de Configuración: sidebar propio (acordeón, igual criterio que el sidebar principal)
// + panel de contenido a la derecha — en vez de la pantalla de tarjetas grandes de antes. Cada
// pantalla de configuración sigue siendo su propia página (no es un SPA de verdad): clickear un ítem
// del menú es una navegación normal, pero visualmente y en mobile se comporta como un panel admin.
//
// Uso: reemplaza el renderShell() directo que ya tenía cada página de configuración — misma firma de
// retorno (un elemento donde volcar innerHTML), así que el resto de cada página no cambia.
import { renderShell } from "./shell.js";
import { icono } from "./iconos.js";

// { key, label, icono, href? (sección sin submenú) | items: [{key,label,href,soloAdmin?,disabled?}] }
const SECCIONES = [
  {
    key: "empresa-sucursales",
    label: "Empresa y sucursales",
    icono: "edificio",
    items: [
      { key: "empresa", label: "Empresa", href: "/configuracion/empresa.html", soloAdmin: true },
      { key: "sucursales", label: "Sucursales", href: "/configuracion/sucursales.html", soloAdmin: true },
    ],
  },
  {
    key: "tesoreria",
    label: "Tesorería",
    icono: "balanza",
    items: [
      { key: "tesoreria-cajas", label: "Cajas", href: "/configuracion/tesoreria-cajas.html", soloAdmin: true },
      { key: "tesoreria-bancos", label: "Bancos", href: "/configuracion/tesoreria-bancos.html", soloAdmin: true },
      { key: "medios-pago", label: "Medios de pago", href: "/configuracion/medios-pago.html", soloAdmin: true },
    ],
  },
  { key: "facturacion", label: "Facturación", icono: "recibo", href: "/configuracion/facturacion.html", soloAdmin: true },
  {
    key: "integraciones",
    label: "Integraciones",
    icono: "intercambio",
    items: [
      { key: "mercado-pago", label: "Mercado Pago", href: "/configuracion/mercado-pago.html", soloAdmin: true },
      { key: "arca", label: "ARCA", disabled: true },
      { key: "otras-integraciones", label: "Otras integraciones", disabled: true },
    ],
  },
  {
    key: "usuarios",
    label: "Usuarios y permisos",
    icono: "usuarios",
    items: [{ key: "usuarios", label: "Usuarios", href: "/configuracion/usuarios.html", soloAdmin: true }],
  },
  {
    key: "productos",
    label: "Productos",
    icono: "caja",
    items: [
      { key: "categorias", label: "Categorías", href: "/configuracion/categorias.html" },
      { key: "marcas", label: "Marcas", href: "/configuracion/marcas.html" },
      { key: "proveedores", label: "Proveedores", href: "/configuracion/proveedores.html" },
      { key: "listas-precios", label: "Listas de precios", href: "/configuracion/listas-precios.html" },
    ],
  },
  { key: "general", label: "Configuración general", icono: "edificio", href: "/configuracion/general.html" },
];

export function renderConfigShell({ activeItem, titulo, usuario }) {
  const content = renderShell({ active: "configuracion", titulo, usuario });
  const esAdmin = usuario?.rol === "administrador";

  function renderSeccion(sec) {
    if (!sec.items) {
      if (sec.soloAdmin && !esAdmin) return "";
      return `<a href="${sec.href}" class="config-sidebar-link ${activeItem === sec.key ? "active" : ""}">${icono(sec.icono)}<span>${sec.label}</span></a>`;
    }
    const items = sec.items.filter((i) => !i.soloAdmin || esAdmin);
    if (items.length === 0) return "";
    const abierto = items.some((i) => i.key === activeItem);
    return `
      <div class="config-sidebar-group ${abierto ? "open" : ""}" data-group="${sec.key}">
        <button type="button" class="config-sidebar-group-header">${icono(sec.icono)}<span>${sec.label}</span>${icono("chevron")}</button>
        <div class="config-sidebar-group-items">
          ${items
            .map((i) =>
              i.disabled
                ? `<span class="config-sidebar-link disabled" title="Todavía no disponible">${i.label}</span>`
                : `<a href="${i.href}" class="config-sidebar-link ${activeItem === i.key ? "active" : ""}">${i.label}</a>`
            )
            .join("")}
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <button type="button" class="config-mobile-toggle" id="config-mobile-toggle">${icono("edificio")}<span>Configuración</span></button>
    <div class="config-layout">
      <nav class="config-sidebar" id="config-sidebar">
        ${SECCIONES.map(renderSeccion).join("")}
      </nav>
      <div class="config-content" id="config-content"></div>
    </div>
  `;

  const grupos = content.querySelectorAll(".config-sidebar-group");
  grupos.forEach((g) => {
    g.querySelector(".config-sidebar-group-header").addEventListener("click", () => {
      const yaAbierto = g.classList.contains("open");
      grupos.forEach((otro) => otro.classList.remove("open"));
      if (!yaAbierto) g.classList.add("open");
    });
  });

  const sidebarEl = content.querySelector("#config-sidebar");
  content.querySelector("#config-mobile-toggle").addEventListener("click", () => {
    sidebarEl.classList.toggle("open");
  });
  sidebarEl.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => sidebarEl.classList.remove("open")));

  return content.querySelector("#config-content");
}
