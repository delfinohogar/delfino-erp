import { cerrarSesion } from "./auth.js";
import { montarChatWidget } from "./chat-widget.js";
import { icono, ICONOS_NAV } from "./iconos.js";
import { initBuscadorGlobal } from "./buscador-global.js";
import { obtenerConfigEmpresa } from "./configuracion-empresa.js";
import { aplicarTemaGuardado, initSelectorTema } from "./tema.js";

function nav(key, href, label) {
  return `<a href="${href}" data-key="${key}" title="${label}">${icono(ICONOS_NAV[key])}<span>${label}</span></a>`;
}

// Grupo desplegable (acordeón), igual que los módulos de La Pyme: un encabezado con ícono + label
// + flecha que abre/cierra la lista de items, en vez del rótulo fijo de antes.
function grupo(key, label, iconoGrupo, itemsHtml) {
  return `
    <div class="nav-group" data-group="${key}">
      <button type="button" class="nav-group-header">
        ${icono(iconoGrupo)}<span>${label}</span>${icono("chevron")}
      </button>
      <div class="nav-group-items">${itemsHtml}</div>
    </div>
  `;
}

// Arma el layout (sidebar + topbar) y devuelve el <main> donde cada página vuelca su contenido.
export function renderShell({ active, titulo, usuario }) {
  // Lo antes posible, para minimizar el parpadeo de tema equivocado antes de que se arme el resto.
  aplicarTemaGuardado();

  document.body.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="dot"></span><span class="brand-text">Delfino ERP</span></div>
        ${nav("dashboard", "/dashboard.html", "Dashboard")}
        ${nav("reportes", "/reportes.html", "Reportes")}
        ${grupo(
          "ventas",
          "Ventas",
          "bolsa",
          nav("venta-nueva", "/productos/venta-nueva.html", "Nueva venta") +
            nav("ventas", "/productos/ventas.html", "Ventas") +
            nav("cuenta-corriente-clientes", "/productos/cuenta-corriente-clientes.html", "Cuenta corriente") +
            nav("cobros", "/productos/cobros.html", "Cobros")
        )}
        ${grupo(
          "productos",
          "Productos",
          "caja",
          nav("productos", "/productos/", "Productos") +
            nav("precios", "/productos/precios.html", "Precios") +
            nav("inventario", "/productos/inventario.html", "Inventario") +
            nav("movimientos", "/productos/movimientos.html", "Movimientos") +
            nav("importar", "/productos/importar.html", "Importar")
        )}
        ${grupo(
          "compras",
          "Compras",
          "camion",
          nav("ordenes-compra", "/productos/ordenes-compra.html", "Órdenes de compra") +
            nav("compras", "/productos/compras.html", "Compras") +
            nav("cuenta-corriente", "/productos/cuenta-corriente.html", "Cuenta corriente") +
            nav("pagos", "/productos/pagos.html", "Pagos")
        )}
        ${grupo(
          "contabilidad",
          "Contabilidad",
          "libro",
          nav("contabilidad-libro-diario", "/contabilidad/libro-diario.html", "Libro Diario") +
            nav("contabilidad-libro-mayor", "/contabilidad/libro-mayor.html", "Libro Mayor") +
            nav("contabilidad-sumas-saldos", "/contabilidad/sumas-saldos.html", "Sumas y Saldos") +
            nav("contabilidad-estado-resultados", "/contabilidad/estado-resultados.html", "Estado de Resultados") +
            nav("contabilidad-plan-cuentas", "/contabilidad/plan-cuentas.html", "Plan de Cuentas")
        )}
        ${grupo(
          "facturacion",
          "Facturación",
          "recibo",
          nav("facturacion-dashboard", "/facturacion/dashboard.html", "Historial de comprobantes") +
            nav("facturacion-nuevo", "/facturacion/nuevo.html", "Nuevo comprobante (manual)")
        )}
        ${grupo(
          "mercado-pago",
          "Mercado Pago",
          "billetera",
          nav("mp-centro-pruebas", "/mercado-pago/centro-pruebas.html", "Centro de pruebas") +
            (usuario?.rol === "administrador" ? nav("config-mercado-pago", "/configuracion/mercado-pago.html", "Configuración") : "")
        )}
        ${grupo(
          "configuracion",
          "Configuración",
          "edificio",
          (usuario?.rol === "administrador" ? nav("config-empresa", "/configuracion/empresa.html", "Empresa") : "") +
            (usuario?.rol === "administrador" ? nav("config-sucursales", "/configuracion/sucursales.html", "Sucursales") : "") +
            (usuario?.rol === "administrador" ? nav("config-facturacion", "/configuracion/facturacion.html", "Facturación") : "") +
            nav("config-categorias", "/configuracion/categorias.html", "Categorías") +
            nav("config-marcas", "/configuracion/marcas.html", "Marcas") +
            nav("config-proveedores", "/configuracion/proveedores.html", "Proveedores") +
            nav("config-clientes", "/configuracion/clientes.html", "Clientes") +
            nav("config-precios", "/configuracion/listas-precios.html", "Listas de Precios") +
            (usuario?.rol === "administrador" ? nav("config-usuarios", "/configuracion/usuarios.html", "Usuarios") : "")
        )}
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

  // Acordeón de módulos, igual que La Pyme: el grupo del ítem activo arranca abierto, y solo uno
  // puede estar abierto a la vez (abrir uno cierra los demás).
  const gruposEl = document.querySelectorAll(".nav-group");
  const grupoActivo = activeLink?.closest(".nav-group");
  if (grupoActivo) grupoActivo.classList.add("open");
  gruposEl.forEach((g) => {
    g.querySelector(".nav-group-header").addEventListener("click", () => {
      const yaAbierto = g.classList.contains("open");
      gruposEl.forEach((otro) => otro.classList.remove("open"));
      if (!yaAbierto) g.classList.add("open");
    });
  });

  document.getElementById("logout-btn").addEventListener("click", cerrarSesion);

  const sidebarEl = document.querySelector(".sidebar");
  const backdropEl = document.querySelector(".sidebar-backdrop");
  const ES_MOBILE = () => window.innerWidth <= 860;

  // En desktop la barra SIEMPRE está visible y fija (como en La Pyme) — el botón no la esconde,
  // la colapsa a solo íconos para devolverle ancho al contenido (el grid de tarjetas se reacomoda
  // solo, vía CSS Grid). En mobile sigue siendo una superposición que se puede ocultar del todo.
  let prefColapsada = false;
  try {
    prefColapsada = localStorage.getItem("sidebarColapsada") === "true";
  } catch {
    // Storage bloqueado (ej. navegación privada) — se sigue con el default (expandida).
  }
  if (!ES_MOBILE() && prefColapsada) sidebarEl.classList.add("collapsed");

  const cerrarSidebarMobile = () => {
    sidebarEl.classList.remove("open");
    backdropEl.classList.remove("open");
  };
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    if (ES_MOBILE()) {
      const abierta = sidebarEl.classList.toggle("open");
      backdropEl.classList.toggle("open", abierta);
      return;
    }
    const colapsada = sidebarEl.classList.toggle("collapsed");
    try {
      localStorage.setItem("sidebarColapsada", colapsada ? "true" : "false");
    } catch {
      // Sin storage, el toggle sigue funcionando — solo no se recuerda para la próxima página.
    }
  });
  backdropEl.addEventListener("click", cerrarSidebarMobile);
  // Elegir un destino cierra la superposición solo en mobile — en desktop la barra se queda fija
  // (expandida o colapsada, como estuviera), nunca se cierra sola al navegar.
  sidebarEl.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      if (ES_MOBILE()) cerrarSidebarMobile();
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
