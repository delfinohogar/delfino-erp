import { requireAuth } from "/js/auth.js";
import { renderConfigShell } from "/js/configuracion-shell.js";
import { resumenIntegracionTiendaNube } from "/js/tiendanube-sync.js";
import { formatFechaHora } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderConfigShell({ activeItem: "integraciones", titulo: "Integraciones", usuario });

// Best-effort: si esto falla (ej. un índice recién creado que todavía está construyéndose), el resto
// de la pantalla tiene que poder mostrarse igual — no tiene sentido que un problema de esta tarjeta
// puntual deje en blanco toda Configuración → Integraciones.
let resumenTn = { pendientes: 0, errores: 0, ordenesRecibidas: 0, ultimaOrden: null };
try {
  resumenTn = await resumenIntegracionTiendaNube();
} catch (err) {
  console.warn("No se pudo cargar el resumen de Tienda Nube:", err?.message || err);
}

content.innerHTML = `
  <div class="hint" style="margin-bottom:16px; max-width:64ch">
    Conexiones con servicios externos. Configurar acá es distinto de operar — para consultar
    operaciones, saldos o acreditaciones de un medio ya conectado, andá al módulo correspondiente
    (ej. <a href="/tesoreria/cuentas-por-cobrar.html">Tesorería → Cuentas por cobrar</a>).
  </div>

  <div class="card mb-16">
    <div class="section-title">💳 Mercado Pago</div>
    <div class="hint" style="margin-bottom:12px">Entorno, credenciales, webhook y estado de la integración de pruebas (sandbox).</div>
    <div class="toolbar">
      <a href="/configuracion/mercado-pago.html"><button type="button" class="primary">Configurar</button></a>
      <a href="/mercado-pago/centro-pruebas.html"><button type="button">Centro de pruebas</button></a>
    </div>
  </div>

  <div class="card mb-16">
    <div class="section-title">🛒 Tienda Nube</div>
    <div class="hint" style="margin-bottom:12px; max-width:64ch">
      Arquitectura preparada — ERP como maestro de stock/precio/imágenes, Tienda Nube origina las
      órdenes online (ver <code>docs/tiendanube-integracion.md</code>). Todavía sin credenciales/API
      conectadas: nada de lo de abajo se manda de verdad todavía, solo queda en cola lista para
      cuando se conecte.
    </div>
    <div class="dashboard-grid" style="margin-bottom:12px">
      <div class="card dashboard-card">
        <div class="hint mt-0">Cambios pendientes de sincronizar</div>
        <div class="dashboard-card-valor">${resumenTn.pendientes}</div>
      </div>
      <div class="card dashboard-card">
        <div class="hint mt-0">Con error</div>
        <div class="dashboard-card-valor" style="color:${resumenTn.errores > 0 ? "var(--danger)" : "inherit"}">${resumenTn.errores}</div>
      </div>
      <div class="card dashboard-card">
        <div class="hint mt-0">Órdenes recibidas</div>
        <div class="dashboard-card-valor">${resumenTn.ordenesRecibidas}</div>
      </div>
    </div>
    <div class="hint">${resumenTn.ultimaOrden ? `Última orden: ${resumenTn.ultimaOrden.numeroOrden || resumenTn.ultimaOrden.idExterno} — ${formatFechaHora(resumenTn.ultimaOrden.recibidaEn)}` : "Todavía no llegó ninguna orden."}</div>
  </div>

  <div class="card" style="padding:20px; opacity:0.6">
    <div class="section-title">🧾 ARCA</div>
    <div class="hint">Facturación electrónica — arquitectura preparada (ver Configuración → Facturación → Integración fiscal), sin conectar todavía.</div>
  </div>

  <div class="card" style="padding:20px; margin-top:16px; opacity:0.6">
    <div class="section-title">🚚 Andreani / ZipNova</div>
    <div class="hint">Logística y envíos — no implementadas todavía. Quedan reservadas para cuando el ERP sume un módulo de Entregas/Logística.</div>
  </div>
`;
