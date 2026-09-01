// Configuración → Facturación: NO son los datos de la empresa (esos viven en Configuración →
// Empresa, ver configuracion/empresa.js — se muestran acá solo de referencia, nunca duplicados).
// Cuatro pestañas: Tipos de comprobante (catálogo, qué está habilitado hoy), Puntos de venta
// (resumen — la gestión real es Configuración → Sucursales), Diseño de comprobante (logo/texto
// legal del PDF) e Integración fiscal (estado de ARCA — hoy siempre apagada, ver js/facturacion.js
// evaluarProveedorFiscal()).
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { obtenerConfigFacturacion, guardarDisenoComprobante } from "/js/facturacion-config.js";
import { TIPOS_COMPROBANTE } from "/js/facturacion.js";
import { listarSucursales } from "/js/sucursales.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "configuracion", titulo: "Facturación", usuario });

const [configEmpresa, configFacturacion, sucursales] = await Promise.all([
  obtenerConfigEmpresa(),
  obtenerConfigFacturacion(),
  listarSucursales(),
]);

content.innerHTML = `
  <div class="tabs">
    <button type="button" class="tab-btn active" data-tab="tipos">Tipos de comprobante</button>
    <button type="button" class="tab-btn" data-tab="puntos">Puntos de venta</button>
    <button type="button" class="tab-btn" data-tab="diseno">Diseño de comprobante</button>
    <button type="button" class="tab-btn" data-tab="fiscal">Integración fiscal</button>
  </div>

  <div id="tab-tipos" class="tab-panel">
    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Catálogo de tipos de comprobante</div>
      <div class="hint" style="margin-bottom:12px; max-width:64ch">
        Los internos ya se pueden emitir desde Ventas. Los que requieren ARCA están preparados en la
        estructura pero no son seleccionables todavía — no hay forma de emitir una Factura A/B/C real
        sin conexión fiscal, y este sistema no va a fingir que sí.
      </div>
      <table>
        <thead><tr><th>Letra</th><th>Nombre</th><th>Tipo</th><th>Estado</th></tr></thead>
        <tbody>
          ${TIPOS_COMPROBANTE.map(
            (t) => `
            <tr>
              <td><code>${t.letra}</code></td>
              <td>${t.nombre}</td>
              <td>${t.esNotaCredito ? "Nota de crédito" : "Comprobante"}</td>
              <td>${t.requiereArca ? '<span class="badge muted">Requiere ARCA</span>' : '<span class="badge success">Disponible</span>'}</td>
            </tr>
          `
          ).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <div id="tab-puntos" class="tab-panel" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Puntos de venta</div>
      <div class="hint" style="margin-bottom:12px; max-width:64ch">
        Cada sucursal tiene su propio punto de venta y su propia numeración de comprobantes — nunca
        un contador global único. La gestión (alta, edición, activar/desactivar) se hace en
        <a href="/configuracion/sucursales.html">Configuración → Sucursales</a>.
      </div>
      ${
        sucursales.length === 0
          ? `<div class="empty-state">Todavía no hay sucursales cargadas — mientras tanto se factura con el punto de venta 0001 (Casa Central) por defecto. <a href="/configuracion/sucursales.html">Cargar sucursales</a></div>`
          : `<table>
              <thead><tr><th>Punto de venta</th><th>Nombre</th><th>Estado</th></tr></thead>
              <tbody>
                ${sucursales
                  .map(
                    (s) => `
                  <tr>
                    <td><code>${s.puntoVenta}</code></td>
                    <td>${s.nombre}</td>
                    <td>${s.activa !== false ? '<span class="badge success">Activa</span>' : '<span class="badge muted">Inactiva</span>'}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  </div>

  <div id="tab-diseno" class="tab-panel" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
      <div class="section-title">Diseño del comprobante</div>
      <div class="hint" style="margin-bottom:12px; max-width:64ch">
        El logo y los datos de contacto se toman de <a href="/configuracion/empresa.html">Configuración → Empresa</a> (no se duplican acá). Esto solo controla cómo se ven en el PDF/impresión del comprobante.
      </div>
      <form id="form-diseno">
        <div class="field">
          <label style="display:flex; align-items:center; gap:8px; font-weight:400">
            <input type="checkbox" id="mostrarLogo" style="width:auto" />
            Mostrar el logo de la empresa en el comprobante
          </label>
        </div>
        <div class="field">
          <label for="textoLegal">Texto legal / informativo (pie del comprobante)</label>
          <input type="text" id="textoLegal" placeholder="Comprobante interno — sin validez fiscal." />
          <div class="hint">Se muestra al pie del PDF, la vista previa y la impresión — en Venta, Historial y Nuevo comprobante por igual, porque los tres usan el mismo generador.</div>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Guardar</button>
        </div>
        <div class="hint" id="diseno-estado"></div>
      </form>
    </div>
  </div>

  <div id="tab-fiscal" class="tab-panel" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px; max-width:560px">
      <div class="section-title">Integración fiscal (ARCA)</div>
      <div class="hint" style="margin-bottom:16px; max-width:64ch">
        Arquitectura preparada, sin conectar todavía. Cuando se implemente, esta pantalla es la
        única que va a cambiar de estado — Ventas, el PDF y el historial no necesitan tocarse (ver
        <code>evaluarProveedorFiscal()</code> en <code>js/facturacion.js</code>).
      </div>
      <div class="dashboard-grid" style="margin-bottom:16px">
        <div>
          <div class="hint" style="margin:0">Estado</div>
          <div style="font-weight:600">🔴 ARCA desactivado</div>
        </div>
        <div>
          <div class="hint" style="margin:0">Ambiente</div>
          <div style="font-weight:600">🧪 Testing (preparado, no conectado)</div>
        </div>
        <div>
          <div class="hint" style="margin:0">Servicio</div>
          <div style="font-weight:600">WSFEv1 (a confirmar contra doc. oficial)</div>
        </div>
        <div>
          <div class="hint" style="margin:0">CUIT</div>
          <div style="font-weight:600">${configEmpresa.cuit || "Sin configurar (Configuración → Empresa)"}</div>
        </div>
        <div>
          <div class="hint" style="margin:0">Certificado TEST</div>
          <div style="font-weight:600">No configurado</div>
        </div>
        <div>
          <div class="hint" style="margin:0">Certificado producción</div>
          <div style="font-weight:600">No configurado</div>
        </div>
      </div>
      <div class="toolbar">
        <button type="button" id="btn-probar-arca">Probar conexión</button>
      </div>
      <div class="hint" id="arca-estado" style="margin-top:8px"></div>
    </div>
  </div>
`;

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.style.display = "none"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).style.display = "block";
  });
});

document.getElementById("mostrarLogo").checked = configFacturacion.mostrarLogoEnComprobante !== false;
document.getElementById("textoLegal").value = configFacturacion.textoLegal || "";

document.getElementById("form-diseno").addEventListener("submit", async (e) => {
  e.preventDefault();
  const estadoEl = document.getElementById("diseno-estado");
  try {
    await guardarDisenoComprobante({
      mostrarLogoEnComprobante: document.getElementById("mostrarLogo").checked,
      textoLegal: document.getElementById("textoLegal").value,
    });
    estadoEl.textContent = "Guardado — se aplica al próximo comprobante que se genere o imprima.";
    estadoEl.className = "hint";
  } catch (err) {
    estadoEl.textContent = err?.message || "No se pudo guardar.";
    estadoEl.className = "hint error-text";
  }
});

document.getElementById("btn-probar-arca").addEventListener("click", () => {
  const estadoEl = document.getElementById("arca-estado");
  estadoEl.textContent =
    "ARCA todavía no está conectado en este sistema — falta implementar WSAA (autenticación con certificado) y WSFEv1 (autorización de comprobantes) contra la documentación oficial vigente. No hay nada que probar todavía.";
  estadoEl.className = "hint";
});
