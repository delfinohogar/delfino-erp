import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { obtenerConfigFacturacion } from "/js/facturacion-config.js";
import { obtenerComprobante, crearNotaCredito } from "/js/facturacion.js";
import { renderizarComprobanteHtml } from "/js/facturacion-preview.js";
import { descargarPdfComprobante } from "/js/facturacion-pdf.js";
import { abrirWhatsappComprobante } from "/js/facturacion-whatsapp.js";
import { abrirEmailComprobante, asuntoEmailComprobante, mensajeEmailComprobante } from "/js/facturacion-email.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const id = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "facturacion-dashboard", titulo: "Comprobante", usuario });

const [comprobante, configEmpresaBase, configFacturacion] = await Promise.all([
  obtenerComprobante(id),
  obtenerConfigEmpresa(),
  obtenerConfigFacturacion(),
]);
const configEmpresa = { ...configEmpresaBase, ...configFacturacion };

if (!comprobante) {
  content.innerHTML = `<div class="empty-state">No se encontró ese comprobante. <a href="/facturacion/dashboard.html">Volver a Facturación</a></div>`;
  throw new Error("comprobante no encontrado");
}

function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

function pintar() {
  content.innerHTML = `
    <div class="toolbar no-imprimir">
      <a href="/facturacion/dashboard.html" class="link-btn">← Facturación</a>
      <button type="button" id="btn-pdf">📄 PDF</button>
      <button type="button" id="btn-imprimir">🖨️ Imprimir</button>
      <button type="button" id="btn-whatsapp">📱 WhatsApp</button>
      <button type="button" id="btn-email">✉️ Email</button>
      ${
        comprobante.estado === "EMITIDA" && !comprobante.tipoComprobanteCodigo?.startsWith("NOTA_CREDITO") && usuario.rol === "administrador"
          ? `<button type="button" id="btn-nota-credito" style="color:var(--danger); border-color:var(--danger)">↩️ Emitir Nota de Crédito</button>`
          : ""
      }
    </div>

    <div class="card no-imprimir" style="padding:16px 20px; margin-bottom:16px">
      <div class="section-title">Ficha</div>
      <div class="dashboard-grid">
        <div><div class="hint" style="margin:0">Generado por</div><div style="font-weight:600">${comprobante.creadoPorNombre || "-"}</div></div>
        <div><div class="hint" style="margin:0">Fecha de creación</div><div style="font-weight:600">${formatFechaHora(comprobante.creadoEn)}</div></div>
        ${comprobante.ventaId ? `<div><div class="hint" style="margin:0">Origen</div><div style="font-weight:600">Venta vinculada</div></div>` : ""}
        ${
          comprobante.comprobanteRelacionadoId
            ? `<div><div class="hint" style="margin:0">${comprobante.tipoComprobanteCodigo?.startsWith("NOTA_CREDITO") ? "Nota de crédito de" : "Comprobante relacionado"}</div><div style="font-weight:600"><a href="/facturacion/ficha.html?id=${comprobante.comprobanteRelacionadoId}">Ver</a></div></div>`
            : ""
        }
        ${
          comprobante.estado === "ANULADA"
            ? `<div><div class="hint" style="margin:0">Anulado por</div><div style="font-weight:600">${comprobante.anuladoPorNombre || "-"} — ${formatFechaHora(comprobante.fechaAnulacion)}</div></div>`
            : ""
        }
      </div>
    </div>

    ${renderizarComprobanteHtml(comprobante, configEmpresa)}

    <div id="anular-resultado" class="hint no-imprimir" style="text-align:center; margin-top:12px"></div>
  `;

  document.getElementById("btn-pdf").addEventListener("click", () => descargarPdfComprobante(comprobante, configEmpresa));
  document.getElementById("btn-imprimir").addEventListener("click", () => window.print());
  document.getElementById("btn-whatsapp").addEventListener("click", () => {
    const { tieneNumero } = abrirWhatsappComprobante(comprobante, null);
    alert(
      tieneNumero
        ? "Se abrió WhatsApp con el mensaje listo — adjuntá el PDF a mano, no se puede hacer automáticamente desde el navegador."
        : "Este comprobante no tiene un WhatsApp de cliente asociado — elegí el contacto a mano. No te olvides de adjuntar el PDF."
    );
  });
  document.getElementById("btn-email").addEventListener("click", () => abrirModalEmail());

  document.getElementById("btn-nota-credito")?.addEventListener("click", async () => {
    const motivo = prompt("Motivo de la nota de crédito (ej. devolución, cancelación/ajuste):");
    if (!motivo) return;
    if (!confirm(`¿Generar una Nota de Crédito por el total de ${comprobante.numeroCompleto}? El comprobante original queda registrado, no se borra.`)) return;
    try {
      const notaCredito = await crearNotaCredito(comprobante.id, motivo, usuario);
      location.href = `/facturacion/ficha.html?id=${notaCredito.id}`;
    } catch (err) {
      document.getElementById("anular-resultado").textContent = err?.message || "No se pudo generar la nota de crédito.";
      document.getElementById("anular-resultado").classList.add("error-text");
    }
  });
}

function abrirModalEmail() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:460px">
      <div class="section-title">Enviar por email</div>
      <div class="field">
        <label for="em-para">Para</label>
        <input type="email" id="em-para" placeholder="cliente@ejemplo.com" />
      </div>
      <div class="field">
        <label for="em-asunto">Asunto</label>
        <input type="text" id="em-asunto" value="${asuntoEmailComprobante()}" />
      </div>
      <div class="field">
        <label for="em-mensaje">Mensaje</label>
        <textarea id="em-mensaje" rows="6" style="width:100%; font-family:inherit; font-size:14px; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--background); color:var(--foreground)">${mensajeEmailComprobante(comprobante)}</textarea>
      </div>
      <div class="hint" style="margin-bottom:10px">Se abre tu programa de correo con esto ya cargado — el PDF no se adjunta solo, lo adjuntás vos ahí.</div>
      <div class="toolbar">
        <button type="button" class="primary" id="em-enviar">Abrir email</button>
        <button type="button" id="em-cancelar">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#em-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#em-enviar").addEventListener("click", () => {
    abrirEmailComprobante({
      para: overlay.querySelector("#em-para").value.trim(),
      asunto: overlay.querySelector("#em-asunto").value.trim(),
      mensaje: overlay.querySelector("#em-mensaje").value,
    });
    overlay.remove();
  });
}

pintar();
