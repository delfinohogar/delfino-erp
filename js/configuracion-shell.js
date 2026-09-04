// Shell interno de Configuración: sidebar propio + panel de contenido a la derecha. Lista plana,
// sin acordeón — así es como La Pyme arma su propio panel de Configuración (el acordeón que sí
// usamos es el del sidebar principal, ese no cambia). Cada pantalla de configuración sigue siendo
// su propia página: clickear un ítem es una navegación normal, pero se comporta como panel admin.
//
// Uso: reemplaza el renderShell() directo que ya tenía cada página de configuración — misma firma de
// retorno (un elemento donde volcar innerHTML), así que el resto de cada página no cambia.
import { renderShell } from "./shell.js";
import { icono } from "./iconos.js";

// { key, label, icono, href, soloAdmin? }
const ITEMS = [
  { key: "empresa", label: "Empresa", icono: "edificio", href: "/configuracion/empresa.html", soloAdmin: true },
  { key: "sucursales", label: "Sucursales", icono: "edificio", href: "/configuracion/sucursales.html", soloAdmin: true },
  { key: "tesoreria-cajas", label: "Cajas", icono: "caja", href: "/configuracion/tesoreria-cajas.html", soloAdmin: true },
  { key: "tesoreria-bancos", label: "Bancos", icono: "balanza", href: "/configuracion/tesoreria-bancos.html", soloAdmin: true },
  { key: "medios-pago", label: "Medios de pago", icono: "tarjeta", href: "/configuracion/medios-pago.html", soloAdmin: true },
  { key: "facturacion", label: "Facturación", icono: "recibo", href: "/configuracion/facturacion.html", soloAdmin: true },
  { key: "integraciones", label: "Integraciones", icono: "intercambio", href: "/configuracion/integraciones.html", soloAdmin: true },
  { key: "usuarios", label: "Usuarios y permisos", icono: "usuarios", href: "/configuracion/usuarios.html", soloAdmin: true },
  { key: "categorias", label: "Categorías", icono: "carpeta", href: "/configuracion/categorias.html" },
  { key: "marcas", label: "Marcas", icono: "etiqueta", href: "/configuracion/marcas.html" },
  { key: "listas-precios", label: "Listas de precios", icono: "lista", href: "/configuracion/listas-precios.html" },
  { key: "general", label: "Configuración general", icono: "edificio", href: "/configuracion/general.html" },
];

export function renderConfigShell({ activeItem, titulo, usuario }) {
  const content = renderShell({ active: "configuracion", titulo, usuario });
  const esAdmin = usuario?.rol === "administrador";
  const items = ITEMS.filter((i) => !i.soloAdmin || esAdmin);

  content.innerHTML = `
    <button type="button" class="config-mobile-toggle" id="config-mobile-toggle">${icono("edificio")}<span>Configuración</span></button>
    <div class="config-layout">
      <nav class="config-sidebar" id="config-sidebar">
        ${items.map((i) => `<a href="${i.href}" class="config-sidebar-link ${activeItem === i.key ? "active" : ""}">${icono(i.icono)}<span>${i.label}</span></a>`).join("")}
      </nav>
      <div class="config-content" id="config-content"></div>
    </div>
  `;

  const sidebarEl = content.querySelector("#config-sidebar");
  content.querySelector("#config-mobile-toggle").addEventListener("click", () => {
    sidebarEl.classList.toggle("open");
  });
  sidebarEl.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => sidebarEl.classList.remove("open")));

  return content.querySelector("#config-content");
}
