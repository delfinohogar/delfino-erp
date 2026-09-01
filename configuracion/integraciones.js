import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "configuracion", titulo: "Integraciones", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/configuracion/index.html" class="link-btn">← Configuración</a>
  </div>
  <div class="hint" style="margin-bottom:16px; max-width:64ch">
    Conexiones con servicios externos. Configurar acá es distinto de operar — para consultar
    operaciones, saldos o acreditaciones de un medio ya conectado, andá al módulo correspondiente
    (ej. <a href="/tesoreria/cuentas-por-cobrar.html">Tesorería → Cuentas por cobrar</a>).
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">💳 Mercado Pago</div>
    <div class="hint" style="margin-bottom:12px">Entorno, credenciales, webhook y estado de la integración de pruebas (sandbox).</div>
    <div class="toolbar">
      <a href="/configuracion/mercado-pago.html"><button type="button" class="primary">Configurar</button></a>
      <a href="/mercado-pago/centro-pruebas.html"><button type="button">Centro de pruebas</button></a>
    </div>
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
