import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { obtenerConfigFacturacion } from "/js/facturacion-config.js";
import { obtenerComprobante, crearNotaCredito } from "/js/facturacion.js";
import { obtenerVenta } from "/js/ventas.js";
import { listarCobrosPorVenta } from "/js/cobros.js";
import { obtenerCliente } from "/js/clientes.js";
import { renderizarComprobanteHtml } from "/js/facturacion-preview.js";
import { descargarPdfComprobante, verPdfComprobante } from "/js/facturacion-pdf.js";
import { abrirWhatsappComprobante } from "/js/facturacion-whatsapp.js";
import { abrirEmailComprobante, asuntoEmailComprobante, mensajeEmailComprobante } from "/js/facturacion-email.js";
import { formatMoneda as formatMonto } from "/js/formato.js";

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

// El pago real vive en la venta (pagos declarados al vender) + los cobros que se hayan sumado
// después — el comprobante no duplica esto, solo lo muestra. Comprobantes sin venta (notas de
// crédito, o cargados a mano desde Facturación) no tienen de dónde sacar un historial: se muestran
// con su propia foto (comprobante.pagos) como único pago, siempre confirmado.
const [venta, cobros, cliente] = comprobante.ventaId
  ? await Promise.all([obtenerVenta(comprobante.ventaId), listarCobrosPorVenta(comprobante.ventaId), comprobante.clienteId ? obtenerCliente(comprobante.clienteId) : null])
  : [null, [], comprobante.clienteId ? await obtenerCliente(comprobante.clienteId) : null];

function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}
function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}
// Historial de pagos: lo declarado al vender (menos "Pendiente de pago", que no es un pago) + los
// cobros que se hayan registrado después. Sin "estado" rechazado/pendiente por fila — en este
// sistema un cobro solo se crea cuando el dinero ya entró, no hay pagos "en proceso" que mostrar acá.
function historialPagos() {
  if (venta) {
    const pagosIniciales = (venta.pagos || [])
      .filter((p) => p.medio !== "Pendiente de pago" && p.monto > 0)
      .map((p) => ({ fecha: venta.fecha, medio: p.medio, monto: p.monto, referencia: "-" }));
    const pagosPosteriores = cobros.map((c) => ({ fecha: c.fecha, medio: c.medioPago, monto: c.monto, referencia: c.referencia || "-" }));
    return [...pagosIniciales, ...pagosPosteriores];
  }
  if (comprobante.pagos?.length) return comprobante.pagos.map((p) => ({ fecha: comprobante.fechaEmision, medio: p.medio, monto: p.monto, referencia: "-" }));
  if (comprobante.total > 0) return [{ fecha: comprobante.fechaEmision, medio: comprobante.formaPago, monto: comprobante.total, referencia: "-" }];
  return [];
}
const pagos = historialPagos();
const totalPagado = pagos.reduce((acc, p) => acc + (p.monto || 0), 0);
// Solo la venta sabe si algo quedó pendiente al momento de vender (montoPendiente, congelado ahí) —
// sin venta detrás (nota de crédito, comprobante manual) se asume pagado, no hay dato para dudarlo.
const saldoPendiente = venta && (venta.montoPendiente || 0) > 0.01 ? Math.max(Math.round((comprobante.total - totalPagado) * 100) / 100, 0) : 0;

function pintar() {
  content.innerHTML = `
    <div class="toolbar no-imprimir">
      <a href="/facturacion/dashboard.html" class="link-btn">← Facturación</a>
      <button type="button" id="btn-ver-pdf">👁️ Ver PDF</button>
      <button type="button" id="btn-pdf">⬇️ Generar PDF</button>
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
      <div class="section-title">🧾 Información del comprobante</div>
      <div class="dashboard-grid">
        <div><div class="hint mt-0">Tipo</div><div style="font-weight:600">${comprobante.tipoComprobante}</div></div>
        <div><div class="hint mt-0">Letra</div><div style="font-weight:600">${comprobante.letra || "-"}</div></div>
        <div><div class="hint mt-0">Punto de venta</div><div style="font-weight:600">${comprobante.puntoVenta || "-"}</div></div>
        <div><div class="hint mt-0">Número</div><div style="font-weight:600">${comprobante.numeroCompleto || "Sin emitir"}</div></div>
        <div><div class="hint mt-0">Fecha</div><div style="font-weight:600">${formatFecha(comprobante.fechaEmision)}</div></div>
        <div><div class="hint mt-0">Estado</div><div style="font-weight:600">${comprobante.estado === "ANULADA" ? "Anulada" : comprobante.estado === "BORRADOR" ? "Borrador" : "Emitida"}</div></div>
        <div><div class="hint mt-0">Sucursal</div><div style="font-weight:600">${comprobante.sucursalNombre || "-"}</div></div>
        ${venta ? `<div><div class="hint mt-0">Vendedor</div><div style="font-weight:600">${venta.vendedorNombre || "-"}</div></div>` : ""}
        ${venta ? `<div><div class="hint mt-0">Venta asociada</div><div style="font-weight:600"><a href="/productos/venta-ficha.html?id=${venta.id}">Venta #${venta.numeroVenta ?? ""}</a></div></div>` : ""}
        ${comprobante.clienteId ? `<div><div class="hint mt-0">Cliente</div><div style="font-weight:600"><a href="/configuracion/cliente-ficha.html?id=${comprobante.clienteId}#cuenta-corriente">Ver cuenta corriente →</a></div></div>` : ""}
      </div>
      ${
        comprobante.cae
          ? `<div class="hint" style="margin-top:10px">CAE: <strong style="color:var(--foreground)">${comprobante.cae}</strong> — Vencimiento: <strong style="color:var(--foreground)">${formatFecha(comprobante.caeVencimiento)}</strong></div>`
          : `<div class="hint" style="margin-top:10px">Comprobante interno — sin validez fiscal. Sin CAE (requiere conexión con ARCA).</div>`
      }
    </div>

    <div class="card no-imprimir" style="padding:16px 20px; margin-bottom:16px">
      <div class="section-title">💳 Pago</div>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px">
        ${saldoPendiente > 0.01 ? '<span class="badge warning">🟡 PENDIENTE</span>' : '<span class="badge success">✓ PAGADO</span>'}
        ${saldoPendiente > 0.01 ? `<span>Importe pendiente: <strong>${formatMonto(saldoPendiente)}</strong></span>` : `<span>Importe: <strong>${formatMonto(totalPagado)}</strong></span>`}
      </div>
      ${
        pagos.length === 0
          ? `<div class="hint">Sin pagos registrados.</div>`
          : `
        <div class="hint" style="margin-bottom:6px">Pagos asociados</div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Medio</th><th class="num">Importe</th><th>Estado</th><th>Referencia</th></tr></thead>
            <tbody>
              ${pagos
                .map(
                  (p) => `
                <tr>
                  <td>${formatFecha(p.fecha)}</td>
                  <td>${p.medio}</td>
                  <td class="num">${formatMonto(p.monto)}</td>
                  <td><span class="badge success">Confirmado</span></td>
                  <td>${p.referencia}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:10px; font-weight:600">
          <span>Total pagado: ${formatMonto(totalPagado)}</span>
          <span>Saldo pendiente: ${formatMonto(saldoPendiente)}</span>
        </div>
      `
      }
    </div>

    <div class="card no-imprimir" style="padding:16px 20px; margin-bottom:16px">
      <div class="section-title">Ficha</div>
      <div class="dashboard-grid">
        <div><div class="hint mt-0">Generado por</div><div style="font-weight:600">${comprobante.creadoPorNombre || "-"}</div></div>
        <div><div class="hint mt-0">Fecha de creación</div><div style="font-weight:600">${formatFechaHora(comprobante.creadoEn)}</div></div>
        ${
          comprobante.comprobanteRelacionadoId
            ? `<div><div class="hint mt-0">${comprobante.tipoComprobanteCodigo?.startsWith("NOTA_CREDITO") ? "Nota de crédito de" : "Comprobante relacionado"}</div><div style="font-weight:600"><a href="/facturacion/ficha.html?id=${comprobante.comprobanteRelacionadoId}">Ver</a></div></div>`
            : ""
        }
        ${
          comprobante.estado === "ANULADA"
            ? `<div><div class="hint mt-0">Anulado por</div><div style="font-weight:600">${comprobante.anuladoPorNombre || "-"} — ${formatFechaHora(comprobante.fechaAnulacion)}</div></div>`
            : ""
        }
      </div>
    </div>

    ${renderizarComprobanteHtml(comprobante, configEmpresa)}

    <div id="anular-resultado" class="hint no-imprimir" style="text-align:center; margin-top:12px"></div>
  `;

  document.getElementById("btn-ver-pdf").addEventListener("click", () => verPdfComprobante(comprobante, configEmpresa));
  document.getElementById("btn-pdf").addEventListener("click", () => descargarPdfComprobante(comprobante, configEmpresa));
  document.getElementById("btn-imprimir").addEventListener("click", () => window.print());
  document.getElementById("btn-whatsapp").addEventListener("click", () => {
    const { tieneNumero } = abrirWhatsappComprobante(comprobante, cliente?.whatsapp);
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
        <input type="email" id="em-para" value="${cliente?.email || ""}" placeholder="cliente@ejemplo.com" />
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
