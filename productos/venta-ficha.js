// Ficha de una venta puntual — todo lo que generó esa operación en un solo lugar: productos,
// pagos/cobros, cómo impactó en la contabilidad, el cliente y una rentabilidad estimada. Se llega
// acá desde Ventas (clic en la fila) y desde Cuenta corriente de clientes (clic en un movimiento).
//
// Solo lectura: la venta es inmutable a propósito (ver firestore.rules) — nada de lo que se muestra
// acá se edita desde esta pantalla. Las acciones del comprobante (PDF/imprimir/WhatsApp/email/nota
// de crédito) reusan el mismo generador que ya usan Nueva Venta y Facturación, no uno nuevo.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerVenta } from "/js/ventas.js";
import { listarCobrosPorVenta } from "/js/cobros.js";
import { obtenerEntrega, marcarEntregado, crearEntrega } from "/js/entregas.js";
import { obtenerCliente, actualizarCliente } from "/js/clientes.js";
import { pedirClienteModal } from "/js/cliente-modal.js";
import { PLAN_DE_CUENTAS, listarAsientosPorOrigen } from "/js/contabilidad.js";
import { obtenerComprobantePorVenta, crearNotaCredito } from "/js/facturacion.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { obtenerConfigFacturacion } from "/js/facturacion-config.js";
import { descargarPdfComprobante } from "/js/facturacion-pdf.js";
import { abrirWhatsappComprobante } from "/js/facturacion-whatsapp.js";
import { abrirEmailComprobante, asuntoEmailComprobante, mensajeEmailComprobante } from "/js/facturacion-email.js";
import { formatMoneda as formatMonto } from "/js/formato.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const ventaId = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "ventas", titulo: "Ficha de venta", usuario });

if (!ventaId) {
  content.innerHTML = `<div class="empty-state">Falta la venta.</div>`;
  throw new Error("falta id de venta");
}

const NOMBRE_CUENTA = new Map(PLAN_DE_CUENTAS.map((c) => [c.codigo, c.nombre]));

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}
function formatFechaHora(fecha) {
  if (!fecha) return "-";
  const f = fecha?.toDate ? fecha.toDate() : new Date(fecha);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

const venta = await obtenerVenta(ventaId);
if (!venta) {
  content.innerHTML = `<div class="empty-state">No se encontró esa venta. <a href="/productos/ventas.html">Volver a Ventas</a></div>`;
  throw new Error("venta no encontrada");
}

const [cobros, cliente, comprobante, asientos, configEmpresa, configFacturacion, entrega] = await Promise.all([
  listarCobrosPorVenta(ventaId),
  venta.clienteId ? obtenerCliente(venta.clienteId) : Promise.resolve(null),
  obtenerComprobantePorVenta(ventaId),
  listarAsientosPorOrigen(ventaId),
  obtenerConfigEmpresa(),
  obtenerConfigFacturacion(),
  venta.tipoEntrega && venta.tipoEntrega !== "Retira ahora" ? obtenerEntrega(ventaId) : Promise.resolve(null),
]);
const configComprobante = { ...configEmpresa, ...configFacturacion };

// montoPendiente queda congelado en la venta al momento de crearla — si ahí ya era $0 (se pagó todo
// en el momento), el saldo es $0 siempre, sin importar si hay cobros registrados o no. Los cobros
// posteriores (contra clientes con cuenta corriente) recién importan cuando SÍ quedó algo pendiente
// — mismo criterio que productos/ventas-list.js, para no mostrar "pendiente" en una venta ya cobrada.
const cobrado = cobros.reduce((acc, c) => acc + (c.monto || 0), 0);
const saldo = (venta.montoPendiente || 0) > 0.01 ? Math.round(((venta.total || 0) - cobrado) * 100) / 100 : 0;

function estadoBadge() {
  if (saldo <= 0.01) return '<span class="badge success">Cobrada</span>';
  if (cobrado > 0) return '<span class="badge warning">Parcial</span>';
  return '<span class="badge muted">Pendiente</span>';
}

function entregaTexto() {
  const tipo = venta.tipoEntrega || "Retira ahora";
  if (tipo === "Retira ahora") return tipo;
  const pendiente = entrega?.estado !== "entregado";
  const badge = pendiente
    ? '<span class="badge warning">Pendiente</span> <button type="button" id="btn-marcar-entregado" class="link-btn">Marcar entregado</button>'
    : `<span class="badge success">Entregado</span> <span class="hint">por ${entrega.entregadoPorNombre}, ${formatFechaHora(entrega.entregadoEn)}</span>`;
  return `${tipo}${venta.domicilioEntrega ? " — " + escapeHtml(venta.domicilioEntrega) : ""} ${badge}`;
}

// --- Rentabilidad estimada: CMV desde el costo que quedó congelado en cada ítem al vender ---------
const cmv = (venta.items || []).reduce((acc, it) => acc + (it.costoUnitario || 0) * (it.cantidad || 0), 0);
const resultadoEstimado = Math.round(((venta.total || 0) - cmv) * 100) / 100;

function tarjetaComprobante() {
  if (!comprobante) {
    return `
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <span class="hint mt-0">Todavía no tiene comprobante.</span>
        <a href="/facturacion/nuevo.html?ventaId=${venta.id}"><button type="button">🧾 Generar comprobante</button></a>
      </div>
    `;
  }
  const puedeNC = comprobante.estado === "EMITIDA" && !comprobante.tipoComprobanteCodigo?.startsWith("NOTA_CREDITO") && usuario.rol === "administrador";
  return `
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
      <a href="/facturacion/ficha.html?id=${comprobante.id}" style="font-weight:600">${comprobante.numeroCompleto || comprobante.tipoComprobante}</a>
      ${comprobante.estado === "ANULADA" ? '<span class="badge danger">Anulado</span>' : '<span class="badge success">Emitido</span>'}
      <button type="button" id="btn-pdf">📄 PDF</button>
      <button type="button" id="btn-imprimir">🖨️ Imprimir</button>
      <button type="button" id="btn-whatsapp">📱 WhatsApp</button>
      <button type="button" id="btn-email">✉️ Email</button>
      ${puedeNC ? `<button type="button" id="btn-nota-credito" style="color:var(--danger); border-color:var(--danger)">↩️ Crear nota de crédito</button>` : ""}
    </div>
  `;
}

content.innerHTML = `
  <div class="toolbar no-imprimir">
    <a href="/productos/ventas.html" class="link-btn">← Ventas</a>
  </div>

  <div class="card no-imprimir mb-16">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px">
      <div>
        <div style="font-size:26px; font-weight:700">${formatMonto(venta.total)}</div>
        <div class="hint" style="margin-top:2px">
          Venta #${venta.numeroVenta ?? ""} — ${formatFecha(venta.fecha)} · Vendido a
          <strong style="color:var(--foreground)">${venta.clienteNombre || "Consumidor final"}</strong>
          por ${venta.vendedorNombre || "-"}
        </div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
        ${estadoBadge()}
      </div>
    </div>
    <div class="hint" style="margin-top:10px">Entrega: ${entregaTexto()}</div>
    <div style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px">
      ${tarjetaComprobante()}
    </div>
  </div>

  <div class="pos-layout">
    <div style="display:flex; flex-direction:column; gap:16px">
      <div class="card" style="padding:20px">
        <div class="section-title">Productos</div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th class="num">Subtotal</th></tr>
            </thead>
            <tbody>
              ${(venta.items || [])
                .map(
                  (it) => `
                <tr>
                  <td>${it.productoDescripcion}${it.productoSku ? `<div class="hint">${it.productoSku}</div>` : ""}</td>
                  <td class="num">${it.cantidad}</td>
                  <td class="num">${formatMonto(it.precioUnitario)}</td>
                  <td class="num">${formatMonto(it.subtotal)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div style="margin-top:12px; display:flex; flex-direction:column; gap:4px; align-items:flex-end">
          <div class="hint">Subtotal <strong style="color:var(--foreground); margin-left:8px">${formatMonto(venta.subtotal)}</strong></div>
          ${venta.descuentoGlobal ? `<div class="hint">Descuento <strong style="color:var(--foreground); margin-left:8px">${venta.descuentoGlobal}%</strong></div>` : ""}
          <div style="font-size:16px; font-weight:700; margin-top:4px">Total <span style="margin-left:8px">${formatMonto(venta.total)}</span></div>
          ${comprobante ? `<div class="hint">Comprobante <strong style="color:var(--foreground); margin-left:8px">${formatMonto(comprobante.total)}</strong></div>` : ""}
        </div>
      </div>

      <div class="card" style="padding:20px">
        <div class="section-title">Pagos</div>
        ${(venta.pagos || [])
          .map((p) => `<div style="display:flex; justify-content:space-between; padding:4px 0"><span>${p.medio}</span><span style="font-weight:600">${formatMonto(p.monto)}</span></div>`)
          .join("")}
        ${
          cobros.length > 0
            ? `
          <div class="hint" style="margin-top:12px; margin-bottom:4px">Cobros de esta venta</div>
          ${cobros
            .map(
              (c) => `<div style="display:flex; justify-content:space-between; padding:4px 0"><span>${formatFecha(c.fecha)} — ${c.medioPago}</span><span style="font-weight:600">${formatMonto(c.monto)}</span></div>`
            )
            .join("")}
        `
            : ""
        }
        ${saldo > 0.01 ? `<div class="hint" style="margin-top:10px; color:var(--warning)">Saldo pendiente: ${formatMonto(saldo)}</div>` : ""}
      </div>

      <div class="card" style="padding:20px">
        <div class="section-title">Asientos contables</div>
        ${
          asientos.length === 0
            ? `<div class="hint">Sin asientos vinculados.</div>`
            : asientos
                .map(
                  (a) => `
              <div style="margin-bottom:14px">
                <div class="hint" style="margin-bottom:6px">Asiento #${a.numero} — ${a.descripcion}</div>
                <table>
                  <thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead>
                  <tbody>
                    ${a.movimientos
                      .map(
                        (m) => `
                      <tr>
                        <td>${NOMBRE_CUENTA.get(m.cuenta) || m.cuenta}</td>
                        <td class="num">${m.debe ? formatMonto(m.debe) : ""}</td>
                        <td class="num">${m.haber ? formatMonto(m.haber) : ""}</td>
                      </tr>
                    `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
                )
                .join("")
        }
      </div>
    </div>

    <div style="display:flex; flex-direction:column; gap:16px">
      <div class="card" style="padding:20px">
        <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; border:none; margin:0; padding:0 0 10px">
          <span>Cliente</span>
          ${cliente ? `<button type="button" id="btn-editar-cliente" class="no-imprimir">Editar</button>` : ""}
        </div>
        ${
          cliente
            ? `
          <div style="font-weight:600">${escapeHtml(cliente.razonSocial)}</div>
          <div class="hint">${cliente.cuit ? `CUIT/DNI ${cliente.cuit}` : "Sin CUIT/DNI"}</div>
          ${cliente.email ? `<div class="hint" style="margin-top:6px">✉️ ${cliente.email}</div>` : ""}
          ${cliente.whatsapp ? `<div class="hint">📱 ${escapeHtml(cliente.whatsapp)}</div>` : ""}
          ${cliente.domicilioEntrega || cliente.domicilioFiscal ? `<div class="hint">📍 ${escapeHtml(cliente.domicilioEntrega || cliente.domicilioFiscal)}</div>` : ""}
          ${cliente.condicionIva ? `<div class="hint" style="margin-top:6px">IVA: ${escapeHtml(cliente.condicionIva)}</div>` : ""}
          <a href="/productos/cuenta-corriente-clientes.html" class="hint" style="display:inline-block; margin-top:10px">Ver cuenta corriente →</a>
        `
            : `<div class="hint">Consumidor final</div>`
        }
      </div>

      ${
        usuario.rol === "administrador"
          ? `<div class="card" style="padding:20px">
        <div class="section-title">Rentabilidad</div>
        <div class="hint" style="display:flex; justify-content:space-between; margin-top:4px"><span>Total facturado</span><span style="color:var(--foreground); font-weight:600">${formatMonto(venta.total)}</span></div>
        <div class="hint" style="display:flex; justify-content:space-between; margin-top:4px"><span>CMV</span><span style="color:var(--foreground)">-${formatMonto(cmv)}</span></div>
        <div style="display:flex; justify-content:space-between; margin-top:10px; padding-top:10px; border-top:1px solid var(--border); font-weight:700">
          <span>Resultado estimado</span><span style="color:${resultadoEstimado >= 0 ? "var(--success)" : "var(--danger)"}">${formatMonto(resultadoEstimado)}</span>
        </div>
        <div class="hint" style="margin-top:10px">Estimado a partir del costo cargado en cada producto al momento de la venta — no incluye gastos generales.</div>
      </div>`
          : ""
      }
    </div>
  </div>
`;

document.getElementById("btn-editar-cliente")?.addEventListener("click", async () => {
  const datos = await pedirClienteModal(null, cliente);
  if (!datos) return;
  await actualizarCliente(cliente.id, datos.razonSocial, datos.cuit, datos.datosArca, datos.datosContacto);
  location.reload();
});

document.getElementById("btn-marcar-entregado")?.addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    // Si crearEntrega falló en su momento (red caída, etc. — ver crearVenta en ventas.js), no existe
    // /entregas/{ventaId} y marcarEntregado (un updateDoc) tira "not-found" sin ningún aviso: el botón
    // quedaba deshabilitado para siempre sin que nadie se enterara de qué pasó. Se reconstruye acá con
    // los mismos datos de la venta (que ya están completos) antes de marcarla entregada.
    if (!entrega) {
      await crearEntrega(
        {
          ventaId,
          numeroVenta: venta.numeroVenta,
          clienteId: venta.clienteId,
          clienteNombre: venta.clienteNombre,
          sucursalId: venta.sucursalId,
          sucursalNombre: venta.sucursalNombre,
          tipoEntrega: venta.tipoEntrega,
          domicilioEntrega: venta.domicilioEntrega,
          notaEntrega: venta.notaEntrega,
        },
        usuario
      );
    }
    await marcarEntregado(ventaId, usuario);
    location.reload();
  } catch (err) {
    alert("No se pudo marcar como entregado: " + (err?.message || "error desconocido"));
    e.target.disabled = false;
  }
});

document.getElementById("btn-pdf")?.addEventListener("click", () => descargarPdfComprobante(comprobante, configComprobante));
document.getElementById("btn-imprimir")?.addEventListener("click", () => window.print());
document.getElementById("btn-whatsapp")?.addEventListener("click", () => {
  const { tieneNumero } = abrirWhatsappComprobante(comprobante, cliente?.whatsapp);
  alert(
    tieneNumero
      ? "Se abrió WhatsApp con el mensaje listo — adjuntá el PDF a mano, no se puede hacer automáticamente desde el navegador."
      : "Este cliente no tiene WhatsApp cargado — elegí el contacto a mano. No te olvides de adjuntar el PDF."
  );
});
document.getElementById("btn-email")?.addEventListener("click", () => abrirModalEmail());

document.getElementById("btn-nota-credito")?.addEventListener("click", async () => {
  const motivo = prompt("Motivo de la nota de crédito (ej. devolución, cancelación/ajuste):");
  if (!motivo) return;
  if (!confirm(`¿Generar una Nota de Crédito por el total de ${comprobante.numeroCompleto}? El comprobante original queda registrado, no se borra.`)) return;
  try {
    const notaCredito = await crearNotaCredito(comprobante.id, motivo, usuario);
    location.href = `/facturacion/ficha.html?id=${notaCredito.id}`;
  } catch (err) {
    alert(err?.message || "No se pudo generar la nota de crédito.");
  }
});

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
