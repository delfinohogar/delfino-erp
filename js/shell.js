import { cerrarSesion } from "./auth.js";
import { montarChatWidget } from "./chat-widget.js";
import { icono, ICONOS_NAV } from "./iconos.js";
import { initBuscadorGlobal } from "./buscador-global.js";
import { obtenerConfigEmpresa } from "./configuracion-empresa.js";
import { aplicarTemaGuardado, initSelectorTema } from "./tema.js";

function nav(key, href, label) {
  return `<a href="${href}" data-key="${key}">${icono(ICONOS_NAV[key])}<span>${label}</span></a>`;
}

// Arma el layout (sidebar + topbar) y devuelve el <main> donde cada página vuelca su contenido.
export function renderShell({ active, titulo, usuario }) {
  // Lo antes posible, para minimizar el parpadeo de tema equivocado antes de que se arme el resto.
  aplicarTemaGuardado();

  document.body.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="dot"></span> Delfino ERP</div>
        ${nav("dashboard", "/dashboard.html", "Dashboard")}
        ${nav("reportes", "/reportes.html", "Reportes")}
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
        <div class="nav-group-label">Contabilidad</div>
        ${nav("contabilidad-libro-diario", "/contabilidad/libro-diario.html", "Libro Diario")}
        ${nav("contabilidad-libro-mayor", "/contabilidad/libro-mayor.html", "Libro Mayor")}
        ${nav("contabilidad-sumas-saldos", "/contabilidad/sumas-saldos.html", "Sumas y Saldos")}
        ${nav("contabilidad-estado-resultados", "/contabilidad/estado-resultados.html", "Estado de Resultados")}
        ${nav("contabilidad-plan-cuentas", "/contabilidad/plan-cuentas.html", "Plan de Cuentas")}
        <div class="nav-group-label">Configuración</div>
        ${usuario?.rol === "administrador" ? nav("config-empresa", "/configuracion/empresa.html", "Empresa") : ""}
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
            <span id="topbar-org" class="topbar-org"></span>
            <h1>${titulo}</h1>
          </div>
          <div id="gsearch-container" class="topbar-search"></div>
          <div class="topbar-right">
            <button type="button" id="topbar-ia-btn" class="icon-btn" title="Preguntale a la IA" aria-label="Preguntale a la IA">✨</button>
            <div id="theme-picker-container"></div>
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
  const ES_MOBILE = () => window.innerWidth <= 860;

  // En desktop arranca visible y fija (salvo que el usuario la haya cerrado antes — se recuerda
  // entre páginas porque cada navegación acá es una carga de página nueva, no una SPA). En mobile
  // siempre arranca oculta: reservarle 220px fijos a una pantalla chica no tiene sentido.
  let prefAbierta = true;
  try {
    prefAbierta = localStorage.getItem("sidebarAbierta") !== "false";
  } catch {
    // Storage bloqueado (ej. navegación privada) — se sigue con el default (abierta).
  }
  if (!ES_MOBILE() && prefAbierta) sidebarEl.classList.add("open");

  const cerrarSidebar = () => {
    sidebarEl.classList.remove("open");
    backdropEl.classList.remove("open");
  };
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    const abierta = sidebarEl.classList.toggle("open");
    backdropEl.classList.toggle("open", abierta && ES_MOBILE());
    if (!ES_MOBILE()) {
      try {
        localStorage.setItem("sidebarAbierta", abierta ? "true" : "false");
      } catch {
        // Sin storage, el toggle sigue funcionando — solo no se recuerda para la próxima página.
      }
    }
  });
  backdropEl.addEventListener("click", cerrarSidebar);
  // Al elegir un destino desde la barra solo tiene sentido cerrarla en mobile (ahí es una
  // superposición); en desktop se queda fija, como el resto de La Pyme.
  sidebarEl.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      if (ES_MOBILE()) cerrarSidebar();
    })
  );

  montarChatWidget();
  initBuscadorGlobal(document.getElementById("gsearch-container"));
  initSelectorTema(document.getElementById("theme-picker-container"));
  document.getElementById("topbar-ia-btn").addEventListener("click", () => {
    document.getElementById("chat-ia-fab")?.click();
  });

  // Logo/nombre de la empresa en la topbar — no bloquea el resto del render.
  obtenerConfigEmpresa().then((config) => {
    if (!config.logoDataUrl && !config.nombreFantasia) return;
    document.getElementById("topbar-org").innerHTML = `
      ${config.logoDataUrl ? `<img src="${config.logoDataUrl}" alt="" />` : ""}
      ${config.nombreFantasia ? `<span>${config.nombreFantasia}</span>` : ""}
    `;
  });

  return document.getElementById("main-content");
}
