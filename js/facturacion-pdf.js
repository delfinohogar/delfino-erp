// PDF del comprobante interno — usa jsPDF + autotable (mismo CDN que ya usan los reportes,
// ver reportes-detalle.html). No depende de ARCA para nada: solo con los datos que ya tiene el
// comprobante y la configuración de empresa arma un PDF A4 listo para imprimir o compartir.
import { formatearNumeroComprobante } from "./facturacion.js";

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

function formatFecha(fechaStr) {
  if (!fechaStr) return "";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
}

export function nombreArchivoComprobante(comprobante) {
  const numero = comprobante.numeroCompleto || "borrador";
  return `Delfino_Hogar_Comprobante_${numero}.pdf`;
}

// Devuelve el objeto jsPDF ya armado — el que llama decide si hace .save() (descarga) o .output()
// (para abrirlo en una pestaña, por ejemplo antes de mandarlo por WhatsApp).
export function generarPdfComprobante(comprobante, configEmpresa = {}) {
  if (!window.jspdf) throw new Error("El motor de PDF todavía está cargando — probá de nuevo en un segundo.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const anchoUtil = doc.internal.pageSize.getWidth() - 28; // márgenes de 14mm a cada lado

  const ACCENT = [226, 62, 58];
  const GRIS = [110, 110, 110];
  const NEGRO = [20, 20, 20];

  let y = 16;

  // --- Encabezado: marca + tagline -------------------------------------------------------------
  if (configEmpresa.logoDataUrl) {
    try {
      doc.addImage(configEmpresa.logoDataUrl, "PNG", 14, y - 4, 16, 16);
    } catch {
      // logo con formato no soportado por addImage — se sigue sin logo, no bloquea el comprobante
    }
  }
  const xTexto = configEmpresa.logoDataUrl ? 34 : 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ACCENT);
  doc.text(configEmpresa.nombreFantasia || "DELFINO HOGAR", xTexto, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text("Electrodomésticos • Hogar • Colchones", xTexto, y);

  // --- Datos de la empresa (arriba a la derecha) ------------------------------------------------
  const datosEmpresa = [
    configEmpresa.razonSocial,
    configEmpresa.cuit ? `CUIT ${configEmpresa.cuit}` : null,
    configEmpresa.domicilioFiscal,
    configEmpresa.condicionIva,
    configEmpresa.telefono ? `Tel: ${configEmpresa.telefono}` : null,
    configEmpresa.whatsapp ? `WhatsApp: ${configEmpresa.whatsapp}` : null,
    configEmpresa.sitioWeb,
  ].filter(Boolean);
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  let yEmpresa = 12;
  datosEmpresa.forEach((linea) => {
    doc.text(String(linea), 14 + anchoUtil, yEmpresa, { align: "right" });
    yEmpresa += 4;
  });

  y = Math.max(y + 8, yEmpresa + 2);
  doc.setDrawColor(220, 220, 220);
  doc.line(14, y, 14 + anchoUtil, y);
  y += 8;

  // --- Comprobante interno + número + fecha -----------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...NEGRO);
  doc.text("COMPROBANTE INTERNO", 14, y);
  doc.setFontSize(11);
  doc.text(comprobante.numeroCompleto || formatearNumeroComprobante(comprobante.puntoVenta || "0001", comprobante.numero || 0), 14 + anchoUtil, y, { align: "right" });
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...GRIS);
  doc.text(`Fecha: ${formatFecha(comprobante.fechaEmision)}`, 14 + anchoUtil, y, { align: "right" });
  y += 9;

  // --- Banner "sin validez fiscal" ---------------------------------------------------------------
  doc.setFillColor(253, 243, 227); // warning-bg
  doc.setDrawColor(160, 90, 0);
  doc.roundedRect(14, y, anchoUtil, 9, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(160, 90, 0);
  doc.text("COMPROBANTE INTERNO — SIN VALIDEZ FISCAL", 14 + anchoUtil / 2, y + 6, { align: "center" });
  y += 16;

  // --- Datos del cliente -------------------------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NEGRO);
  doc.text("DATOS DEL CLIENTE", 14, y);
  y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const lineasCliente = [
    comprobante.clienteNombre,
    comprobante.clienteCuit ? `CUIT/DNI: ${comprobante.clienteCuit}` : null,
    comprobante.clienteDireccion,
    comprobante.clienteCondicionIva,
  ].filter(Boolean);
  lineasCliente.forEach((linea) => {
    doc.text(String(linea), 14, y);
    y += 4.6;
  });
  y += 4;

  // --- Detalle de productos ------------------------------------------------------------------
  doc.autoTable({
    startY: y,
    head: [["Código", "Producto", "Cant.", "Precio unitario", "Desc.", "Total"]],
    body: comprobante.items.map((it) => [
      it.productoSku || "-",
      it.productoDescripcion,
      String(it.cantidad),
      formatMonto(it.precioUnitario),
      it.descuentoPct ? `${it.descuentoPct}%` : "-",
      formatMonto(it.subtotal),
    ]),
    theme: "striped",
    headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2.4 },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // --- Totales -------------------------------------------------------------------------------
  const anchoTotales = 70;
  const xTotales = 14 + anchoUtil - anchoTotales;
  const filaTotal = (label, valor, destacado = false) => {
    doc.setFont("helvetica", destacado ? "bold" : "normal");
    doc.setFontSize(destacado ? 12 : 9.5);
    doc.setTextColor(...(destacado ? ACCENT : GRIS));
    doc.text(label, xTotales, y);
    doc.text(valor, xTotales + anchoTotales, y, { align: "right" });
    y += destacado ? 7 : 5.5;
  };
  filaTotal("Subtotal", formatMonto(comprobante.subtotal));
  if (comprobante.descuento > 0) filaTotal("Descuento", `-${formatMonto(comprobante.descuento)}`);
  filaTotal("IVA", formatMonto(comprobante.iva));
  doc.setDrawColor(220, 220, 220);
  doc.line(xTotales, y - 2, xTotales + anchoTotales, y - 2);
  filaTotal("TOTAL", formatMonto(comprobante.total), true);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...NEGRO);
  doc.text(`Forma de pago: ${comprobante.formaPago}`, 14, y);
  y += 6;

  if (comprobante.observaciones) {
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    const lineas = doc.splitTextToSize(comprobante.observaciones, anchoUtil);
    doc.text(lineas, 14, y);
    y += lineas.length * 4.2 + 2;
  }

  // Espacio reservado para CAE/QR fiscal cuando exista ARCA — hoy no se dibuja nada acá a
  // propósito (no hay datos reales que mostrar, y no queremos ni un placeholder que sugiera
  // validez fiscal). Ver comprobante.cae / comprobante.qr, siempre null en esta versión.

  const paginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text("Comprobante interno — sin validez fiscal. Generado por Delfino ERP.", 14, doc.internal.pageSize.getHeight() - 8);
    doc.text(`Página ${i} de ${paginas}`, 14 + anchoUtil, doc.internal.pageSize.getHeight() - 8, { align: "right" });
  }

  return doc;
}

export function descargarPdfComprobante(comprobante, configEmpresa) {
  const doc = generarPdfComprobante(comprobante, configEmpresa);
  doc.save(nombreArchivoComprobante(comprobante));
}
