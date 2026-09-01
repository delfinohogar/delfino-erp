// Configuraciones generales del ERP (no de la empresa — esos datos viven en Empresa y Sucursales,
// no se duplican acá). Hoy el único ajuste realmente general que existe es el tema — se deja la
// página lista para sumar más adelante, sin inventar opciones que todavía no existen.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { initSelectorTema } from "/js/tema.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "configuracion", titulo: "Configuración general", usuario });

content.innerHTML = `
  <div class="toolbar">
    <a href="/configuracion/index.html" class="link-btn">← Configuración</a>
  </div>
  <div class="card" style="padding:20px; margin-bottom:16px; max-width:520px">
    <div class="section-title">Apariencia</div>
    <div class="hint" style="margin-bottom:12px">Cómo se ve el ERP en este dispositivo.</div>
    <div id="theme-picker-general"></div>
  </div>
  <div class="card" style="padding:20px; max-width:520px">
    <div class="section-title">Datos de la empresa</div>
    <div class="hint">Nombre comercial, razón social, CUIT, domicilio, logo y contacto se administran en <a href="/configuracion/empresa.html">Empresa y Sucursales</a> — no se duplican acá.</div>
  </div>
`;

initSelectorTema(document.getElementById("theme-picker-general"));
