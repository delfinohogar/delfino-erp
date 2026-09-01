// Render HTML del comprobante — lo usan tanto la vista previa (antes de emitir) como la ficha
// (después de emitido) y la pantalla de impresión, para que las tres se vean exactamente igual.
function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFecha(fechaStr) {
  if (!fechaStr) return "";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
}

export function renderizarComprobanteHtml(comprobante, configEmpresa = {}) {
  const datosEmpresa = [
    configEmpresa.razonSocial,
    configEmpresa.cuit ? `CUIT ${configEmpresa.cuit}` : null,
    configEmpresa.domicilioFiscal,
    configEmpresa.condicionIva,
    configEmpresa.telefono ? `Tel: ${configEmpresa.telefono}` : null,
    configEmpresa.whatsapp ? `WhatsApp: ${configEmpresa.whatsapp}` : null,
    configEmpresa.sitioWeb,
  ].filter(Boolean);

  const datosCliente = [
    comprobante.clienteNombre,
    comprobante.clienteCuit ? `CUIT/DNI: ${comprobante.clienteCuit}` : null,
    comprobante.clienteDireccion,
    comprobante.clienteCondicionIva,
  ].filter(Boolean);

  return `
    <div class="comprobante">
      <div class="comprobante-header">
        <div class="comprobante-marca">
          ${configEmpresa.logoDataUrl ? `<img src="${configEmpresa.logoDataUrl}" alt="" />` : ""}
          <div>
            <div class="comprobante-nombre">${configEmpresa.nombreFantasia || "Delfino Hogar"}</div>
            <div class="comprobante-tagline">Electrodomésticos • Hogar • Colchones</div>
          </div>
        </div>
        <div class="comprobante-datos-empresa">
          ${datosEmpresa.map((l) => `<div>${l}</div>`).join("")}
        </div>
      </div>

      <div class="comprobante-titulo-row">
        <div>
          <div class="comprobante-titulo">COMPROBANTE INTERNO</div>
          <div class="hint" style="margin:0">${comprobante.estado === "ANULADA" ? "ANULADO" : ""}</div>
        </div>
        <div style="text-align:right">
          <div class="comprobante-numero">${comprobante.numeroCompleto || "(sin emitir)"}</div>
          <div class="hint" style="margin:0">Fecha: ${formatFecha(comprobante.fechaEmision)}</div>
        </div>
      </div>

      <div class="comprobante-banner-fiscal">🧾 COMPROBANTE INTERNO — SIN VALIDEZ FISCAL</div>
      ${comprobante.estado === "ANULADA" ? `<div class="comprobante-banner-fiscal comprobante-banner-anulado">ANULADO — ${comprobante.motivoAnulacion || ""}</div>` : ""}

      <div class="comprobante-seccion">
        <div class="comprobante-seccion-titulo">Datos del cliente</div>
        ${datosCliente.map((l) => `<div>${l}</div>`).join("")}
      </div>

      <div class="table-scroll">
        <table class="comprobante-tabla">
          <thead>
            <tr><th>Código</th><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio unitario</th><th style="text-align:right">Desc.</th><th style="text-align:right">Total</th></tr>
          </thead>
          <tbody>
            ${comprobante.items
              .map(
                (it) => `
              <tr>
                <td>${it.productoSku || "-"}</td>
                <td>${it.productoDescripcion}</td>
                <td style="text-align:right">${it.cantidad}</td>
                <td style="text-align:right">${formatMonto(it.precioUnitario)}</td>
                <td style="text-align:right">${it.descuentoPct ? it.descuentoPct + "%" : "-"}</td>
                <td style="text-align:right">${formatMonto(it.subtotal)}</td>
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

      <div class="comprobante-forma-pago">Forma de pago: <strong>${comprobante.formaPago}</strong></div>
      ${comprobante.observaciones ? `<div class="hint" style="margin-top:8px">${comprobante.observaciones}</div>` : ""}

      <div class="comprobante-footer">Comprobante interno — sin validez fiscal. Generado por Delfino ERP.</div>
    </div>
  `;
}
