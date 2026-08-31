import { cerrarSesion } from "./auth.js";
import { montarChatWidget } from "./chat-widget.js";
import { icono, ICONOS_NAV } from "./iconos.js";
import { initBuscadorGlobal } from "./buscador-global.js";

function nav(key, href, label) {
  return `<a href="${href}" data-key="${key}">${icono(ICONOS_NAV[key])}<span>${label}</span></a>`;
}

// Arma el layout (sidebar + topbar) y devuelve el <main> donde cada página vuelca su contenido.
export function renderShell({ active, titulo, usuario }) {
  document.body.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="dot"></span> Delfino ERP</div>
        ${nav("dashboard", "/dashboard.html", "Dashboard")}
        <div class="nav-group-label">Ventas</div>
        ${nav("venta-nueva", "/productos/venta-nueva.html", "Nueva venta")}
        ${nav("ventas", "/productos/ventas.html", "Ventas")}
        ${nav("cuenta-corriente-clientes", "/productos/cuenta-corriente-clientes.html", "Cuenta corriente")}
        ${nav("cobros", "/productos/cobros.html", "Cobros")}
        <div class="nav-group-label">Productos</div>
        ${nav("productos", "/productos/", "Productos")}
        ${nav("precios", "/productos/precios.html", "Precios")}
        ${nav("inventario", "/productos/inventario.html", "Inventario")}
        ${nav("movimientos", "/productos/movimientos.html", "Movimientos")}
        ${nav("importar", "/productos/importar.html", "Importar")}
        <div class="nav-group-label">Compras</div>
        ${nav("ordenes-compra", "/productos/ordenes-compra.html", "Órdenes de compra")}
        ${nav("compras", "/productos/compras.html", "Compras")}
        ${nav("cuenta-corriente", "/productos/cuenta-corriente.html", "Cuenta corriente")}
        ${nav("pagos", "/productos/pagos.html", "Pagos")}
        <div class="nav-group-label">Configuración</div>
        ${nav("config-categorias", "/configuracion/categorias.html", "Categorías")}
        ${nav("config-marcas", "/configuracion/marcas.html", "Marcas")}
        ${nav("config-proveedores", "/configuracion/proveedores.html", "Proveedores")}
        ${nav("config-clientes", "/configuracion/clientes.html", "Clientes")}
        ${nav("config-precios", "/configuracion/listas-precios.html", "Listas de Precios")}
        ${usuario?.rol === "administrador" ? nav("config-usuarios", "/configuracion/usuarios.html", "Usuarios") : ""}
      </aside>
      <div class="sidebar-backdrop"></div>
      <div class="main">
        <div class="topbar">
          <div class="topbar-left">
            <button id="sidebar-toggle" class="sidebar-toggle" aria-label="Abrir menú">☰</button>
            <h1>${titulo}</h1>
          </div>
          <div id="gsearch-container" class="topbar-search"></div>
          <div class="topbar-right">
            <button type="button" id="topbar-ia-btn" class="icon-btn" title="Preguntale a la IA" aria-label="Preguntale a la IA">✨</button>
            <span class="hint" style="margin:0">${usuario?.nombre || usuario?.email || ""}</span>
            <button id="logout-btn">Salir</button>
          </div>
        </div>
        <div id="main-content"></div>
      </div>
    </div>
  `;

  const activeLink = document.querySelector(`.sidebar a[data-key="${active}"]`);
  if (activeLink) activeLink.classList.add("active");

  document.getElementById("logout-btn").addEventListener("click", cerrarSesion);

  const sidebarEl = document.querySelector(".sidebar");
  const backdropEl = document.querySelector(".sidebar-backdrop");
  const cerrarSidebar = () => {
    sidebarEl.classList.remove("open");
    backdropEl.classList.remove("open");
  };
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    sidebarEl.classList.toggle("open");
    backdropEl.classList.toggle("open");
  });
  backdropEl.addEventListener("click", cerrarSidebar);
  sidebarEl.querySelectorAll("a").forEach((a) => a.addEventListener("click", cerrarSidebar));

  montarChatWidget();
  initBuscadorGlobal(document.getElementById("gsearch-container"));
  document.getElementById("topbar-ia-btn").addEventListener("click", () => {
    document.getElementById("chat-ia-fab")?.click();
  });

  return document.getElementById("main-content");
}
