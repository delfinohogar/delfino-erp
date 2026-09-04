// Render HTML del comprobante — lo usan tanto la vista previa (antes de emitir) como la ficha
// (después de emitido) y la pantalla de impresión, para que las tres se vean exactamente igual.
// Formato inspirado en el comprobante clásico de AFIP/ARCA (letra en recuadro, dos columnas de
// datos, medios de pago detallados) — el mismo esqueleto que va a usar el día de mañana un
// comprobante fiscal real, solo que hoy con letra "X" y la leyenda de "sin validez fiscal".
import { formatMoneda as formatMonto } from "./formato.js";
import { escapeHtml } from "./escape-html.js";

function formatFecha(fechaStr) {
  if (!fechaStr) return "";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
}

export function renderizarComprobanteHtml(comprobante, configEmpresaYFacturacion = {}) {
  const configEmpresa = configEmpresaYFacturacion;
  const mostrarLogo = configEmpresa.mostrarLogoEnComprobante !== false;
  const textoLegal = configEmpresa.textoLegal || "Comprobante interno — sin validez fiscal.";
  const datosCliente = [
    comprobante.clienteCuit ? `CUIT: ${escapeHtml(comprobante.clienteCuit)}` : null,
    comprobante.clienteDireccion ? `Domicilio: ${escapeHtml(comprobante.clienteDireccion)}` : null,
  ].filter(Boolean);

  const medios = comprobante.pagos?.length
    ? comprobante.pagos.map((p) => ({ medio: p.medio, monto: p.monto }))
    : [{ medio: comprobante.formaPago, monto: comprobante.total }];

  return `
    <div class="comprobante">
      <div class="comprobante-header">
        <div class="comprobante-marca">
          ${mostrarLogo && configEmpresa.logoDataUrl ? `<img src="${configEmpresa.logoDataUrl}" alt="" />` : ""}
          <div>
            <div class="comprobante-nombre">${configEmpresa.nombreFantasia || "Delfino Hogar"}</div>
            <div class="comprobante-datos-empresa">
              ${[configEmpresa.razonSocial, configEmpresa.domicilioFiscal, configEmpresa.telefono ? `Tel.: ${configEmpresa.telefono}` : null].filter(Boolean).map((l) => `<div>${l}</div>`).join("")}
            </div>
          </div>
        </div>

        <div class="comprobante-letra-box">
          <div class="comprobante-letra">${comprobante.letra || "X"}</div>
          <div class="comprobante-letra-cod">${comprobante.tipoComprobanteCodigo === "COMPROBANTE_INTERNO" ? "No fiscal" : comprobante.tipoComprobante}</div>
        </div>

        <div class="comprobante-datos-empresa" style="text-align:right">
          <div style="font-weight:600; color:var(--foreground)">${comprobante.tipoComprobante}</div>
          <div>N.º ${comprobante.numeroCompleto?.replace(/^[A-Z]\s/, "") || "(sin emitir)"}</div>
          <div>Fecha de emisión: ${formatFecha(comprobante.fechaEmision)}</div>
        </div>
      </div>

      <div class="comprobante-banner-fiscal">🧾 COMPROBANTE INTERNO — SIN VALIDEZ FISCAL</div>
      ${
        comprobante.estado === "ANULADA"
          ? `<div class="comprobante-banner-fiscal comprobante-banner-anulado">ANULADO${comprobante.motivoAnulacion ? " — " + comprobante.motivoAnulacion : ""}</div>`
          : ""
      }
      ${
        comprobante.comprobanteRelacionadoId
          ? `<div class="hint" style="margin-bottom:12px">Relacionado con el comprobante original (nota de crédito).</div>`
          : ""
      }

      <div class="comprobante-datos-grid">
        <div>
          <div class="comprobante-seccion-titulo">Cliente</div>
          <div style="font-weight:600">${escapeHtml(comprobante.clienteNombre)}</div>
          ${datosCliente.map((l) => `<div>${l}</div>`).join("")}
        </div>
        <div>
          <div class="comprobante-seccion-titulo">Condición</div>
          <div>IVA: ${comprobante.clienteCondicionIva || "Consumidor Final"}</div>
          <div>Venta: ${comprobante.formaPago}</div>
        </div>
      </div>

      <div class="table-scroll">
        <table class="comprobante-tabla">
          <thead>
            <tr><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio unitario</th><th class="num">Desc.</th><th class="num">Subtotal</th></tr>
          </thead>
          <tbody>
            ${comprobante.items
              .map(
                (it) => `
              <tr>
                <td>${it.productoSku || "-"}</td>
                <td>${escapeHtml(it.productoDescripcion)}</td>
                <td class="num">${it.cantidad}</td>
                <td class="num">${formatMonto(it.precioUnitario)}</td>
                <td class="num">${it.descuentoPct ? it.descuentoPct + "%" : "-"}</td>
                <td class="num">${formatMonto(it.subtotal)}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="comprobante-totales">
        <div class="comprobante-totales-tabla">
          <div><span>Subtotal</span><span>${formatMonto(comprobante.subtotal)}</span></div>
          ${comprobante.descuento > 0 ? `<div><span>Descuento</span><span>-${formatMonto(comprobante.descuento)}</span></div>` : ""}
          <div><span>IVA</span><span>${formatMonto(comprobante.iva)}</span></div>
          <div class="comprobante-total-final"><span>TOTAL</span><span>${formatMonto(comprobante.total)}</span></div>
        </div>
      </div>

      <div class="comprobante-seccion-titulo">Medios de pago</div>
      <div class="comprobante-medios-pago">
        ${medios.map((m) => `<div><span>${m.medio}</span><span>${formatMonto(m.monto)}</span></div>`).join("")}
      </div>

      ${comprobante.observaciones ? `<div class="hint" style="margin-top:12px">${escapeHtml(comprobante.observaciones)}</div>` : ""}

      <div class="comprobante-footer">
        <span>${textoLegal}</span>
        <span>Generado por Delfino ERP</span>
      </div>
    </div>
  `;
}
