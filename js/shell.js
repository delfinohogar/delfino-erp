import { cerrarSesion } from "./auth.js";
import { montarChatWidget } from "./chat-widget.js";

// Arma el layout (sidebar + topbar) y devuelve el <main> donde cada página vuelca su contenido.
export function renderShell({ active, titulo, usuario }) {
  document.body.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="dot"></span> Delfino ERP</div>
        <div class="nav-group-label">Ventas</div>
        <a href="/productos/venta-nueva.html" data-key="venta-nueva">Nueva venta</a>
        <a href="/productos/ventas.html" data-key="ventas">Ventas</a>
        <a href="/productos/cuenta-corriente-clientes.html" data-key="cuenta-corriente-clientes">Cuenta corriente</a>
        <a href="/productos/cobros.html" data-key="cobros">Cobros</a>
        <div class="nav-group-label">Productos</div>
        <a href="/productos/" data-key="productos">Productos</a>
        <a href="/productos/precios.html" data-key="precios">Precios</a>
        <a href="/productos/inventario.html" data-key="inventario">Inventario</a>
        <a href="/productos/movimientos.html" data-key="movimientos">Movimientos</a>
        <a href="/productos/importar.html" data-key="importar">Importar</a>
        <div class="nav-group-label">Compras</div>
        <a href="/productos/ordenes-compra.html" data-key="ordenes-compra">Órdenes de compra</a>
        <a href="/productos/compras.html" data-key="compras">Compras</a>
        <a href="/productos/cuenta-corriente.html" data-key="cuenta-corriente">Cuenta corriente</a>
        <a href="/productos/pagos.html" data-key="pagos">Pagos</a>
        <div class="nav-group-label">Configuración</div>
        <a href="/configuracion/categorias.html" data-key="config-categorias">Categorías</a>
        <a href="/configuracion/marcas.html" data-key="config-marcas">Marcas</a>
        <a href="/configuracion/proveedores.html" data-key="config-proveedores">Proveedores</a>
        <a href="/configuracion/clientes.html" data-key="config-clientes">Clientes</a>
        <a href="/configuracion/listas-precios.html" data-key="config-precios">Listas de Precios</a>
        ${usuario?.rol === "administrador" ? '<a href="/configuracion/usuarios.html" data-key="config-usuarios">Usuarios</a>' : ""}
      </aside>
      <div class="sidebar-backdrop"></div>
      <div class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button id="sidebar-toggle" class="sidebar-toggle" aria-label="Abrir menú">☰</button>
            <h1>${titulo}</h1>
          </div>
          <div style="display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted)">
            <span>${usuario?.nombre || usuario?.email || ""}</span>
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

  return document.getElementById("main-content");
}
