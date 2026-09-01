// Centro de configuración: todo lo administrativo/estructural del ERP, agrupado por categoría, para
// que el sidebar principal no se llene de opciones de configuración sueltas. Cada tarjeta linkea a
// pantallas que ya existen — nada se duplica, esto es un índice, no una reimplementación.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "configuracion", titulo: "Configuración", usuario });

const ES_ADMIN = usuario.rol === "administrador";

// { icono, titulo, descripcion, links: [{label, href, soloAdmin}] } — una tarjeta por categoría.
const CATEGORIAS = [
  {
    icono: "🏢",
    titulo: "Empresa y Sucursales",
    descripcion: "Datos de la empresa y administración de sucursales.",
    links: [
      { label: "Empresa", href: "/configuracion/empresa.html", soloAdmin: true },
      { label: "Sucursales", href: "/configuracion/sucursales.html", soloAdmin: true },
    ],
  },
  {
    icono: "💰",
    titulo: "Tesorería",
    descripcion: "Cajas · Bancos · Medios de pago",
    links: [
      { label: "Cajas", href: "/configuracion/tesoreria-cajas.html", soloAdmin: true },
      { label: "Bancos", href: "/configuracion/tesoreria-bancos.html", soloAdmin: true },
      { label: "Medios de pago", href: "/configuracion/medios-pago.html", soloAdmin: true },
    ],
  },
  {
    icono: "🧾",
    titulo: "Facturación",
    descripcion: "Tipos de comprobante · Puntos de venta · Diseño",
    links: [{ label: "Configuración de facturación", href: "/configuracion/facturacion.html", soloAdmin: true }],
  },
  {
    icono: "🔌",
    titulo: "Integraciones",
    descripcion: "Mercado Pago · ARCA · otras",
    links: [{ label: "Integraciones", href: "/configuracion/integraciones.html", soloAdmin: true }],
  },
  {
    icono: "👤",
    titulo: "Usuarios y permisos",
    descripcion: "Usuarios · Roles · Accesos",
    links: [{ label: "Usuarios", href: "/configuracion/usuarios.html", soloAdmin: true }],
  },
  {
    icono: "📦",
    titulo: "Productos",
    descripcion: "Categorías · Marcas · Proveedores · Listas de precios",
    links: [
      { label: "Categorías", href: "/configuracion/categorias.html" },
      { label: "Marcas", href: "/configuracion/marcas.html" },
      { label: "Proveedores", href: "/configuracion/proveedores.html" },
      { label: "Listas de precios", href: "/configuracion/listas-precios.html" },
    ],
  },
  {
    icono: "⚙️",
    titulo: "Configuración general",
    descripcion: "Datos generales del ERP.",
    links: [{ label: "Configuración general", href: "/configuracion/general.html" }],
  },
];

content.innerHTML = `
  <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))">
    ${CATEGORIAS.map((cat) => {
      const links = cat.links.filter((l) => !l.soloAdmin || ES_ADMIN);
      if (links.length === 0) return "";
      return `
      <div class="card" style="padding:20px">
        <div style="font-size:15px; font-weight:600; display:flex; align-items:center; gap:8px">
          <span>${cat.icono}</span><span>${cat.titulo}</span>
        </div>
        <div class="hint" style="margin:4px 0 12px">${cat.descripcion}</div>
        <div style="display:flex; flex-direction:column; gap:6px">
          ${links.map((l) => `<a href="${l.href}">${l.label} →</a>`).join("")}
        </div>
      </div>
    `;
    }).join("")}
  </div>
`;
