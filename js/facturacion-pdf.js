// PDF del comprobante interno — usa jsPDF + autotable (mismo CDN que ya usan los reportes,
// ver reportes-detalle.html). No depende de ARCA para nada: solo con los datos que ya tiene el
// comprobante y la configuración de empresa arma un PDF A4 listo para imprimir o compartir.
// Mismo esqueleto visual que renderizarComprobanteHtml (facturacion-preview.js) — inspirado en el
// formato clásico de comprobante AFIP/ARCA (letra en recuadro, dos columnas, medios de pago).
export function nombreArchivoComprobante(comprobante) {
  const numero = (comprobante.numeroCompleto || "borrador").replace(/\s+/g, "_");
  return `Delfino_Hogar_Comprobante_${numero}.pdf`;
}

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFecha(fechaStr) {
  if (!fechaStr) return "";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
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

  let y = 14;
  const mostrarLogo = configEmpresa.mostrarLogoEnComprobante !== false;
  const textoLegal = configEmpresa.textoLegal || "Comprobante interno — sin validez fiscal.";

  // --- Encabezado: marca + recuadro de letra + número ------------------------------------------
  if (mostrarLogo && configEmpresa.logoDataUrl) {
    try {
      doc.addImage(configEmpresa.logoDataUrl, "PNG", 14, y - 2, 14, 14);
    } catch {
      // logo con formato no soportado por addImage — se sigue sin logo, no bloquea el comprobante
    }
  }
  const xTexto = configEmpresa.logoDataUrl ? 31 : 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...ACCENT);
  doc.text(configEmpresa.nombreFantasia || "Delfino Hogar", xTexto, y + 3);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  const datosEmpresa = [configEmpresa.razonSocial, configEmpresa.domicilioFiscal, configEmpresa.telefono ? `Tel.: ${configEmpresa.telefono}` : null].filter(Boolean);
  let yEmp = y + 8;
  datosEmpresa.forEach((l) => {
    doc.text(String(l), xTexto, yEmp);
    yEmp += 3.6;
  });

  // Recuadro con la letra, centrado
  const xCaja = 14 + anchoUtil / 2 - 9;
  doc.setDrawColor(20, 20, 20);
  doc.roundedRect(xCaja, y - 2, 18, 15, 0.8, 0.8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...NEGRO);
  doc.text(comprobante.letra || "X", xCaja + 9, y + 7, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...GRIS);
  doc.text(comprobante.tipoComprobanteCodigo === "COMPROBANTE_INTERNO" ? "No fiscal" : comprobante.tipoComprobante, xCaja + 9, y + 11.5, { align: "center" });

  // Datos del comprobante a la derecha
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NEGRO);
  doc.text(comprobante.tipoComprobante, 14 + anchoUtil, y + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`N.º ${(comprobante.numeroCompleto || "(sin emitir)").replace(/^[A-Z]\s/, "")}`, 14 + anchoUtil, y + 7, { align: "right" });
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  doc.text(`Fecha de emisión: ${formatFecha(comprobante.fechaEmision)}`, 14 + anchoUtil, y + 11.5, { align: "right" });

  y = Math.max(yEmp, y + 15) + 4;
  doc.setDrawColor(220, 220, 220);
  doc.line(14, y, 14 + anchoUtil, y);
  y += 8;

  // --- Banner "sin validez fiscal" ---------------------------------------------------------------
  doc.setFillColor(253, 243, 227); // warning-bg
  doc.setDrawColor(160, 90, 0);
  doc.roundedRect(14, y, anchoUtil, 9, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(160, 90, 0);
  doc.text("COMPROBANTE INTERNO — SIN VALIDEZ FISCAL", 14 + anchoUtil / 2, y + 6, { align: "center" });
  y += 14;

  if (comprobante.estado === "ANULADA") {
    doc.setFillColor(253, 236, 235); // danger-bg
    doc.setDrawColor(194, 58, 46);
    doc.roundedRect(14, y, anchoUtil, 9, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(194, 58, 46);
    doc.text(`ANULADO${comprobante.motivoAnulacion ? " — " + comprobante.motivoAnulacion : ""}`, 14 + anchoUtil / 2, y + 6, { align: "center" });
    y += 14;
  }

  // --- Cliente / condición (dos columnas) ---------------------------------------------------------
  doc.setDrawColor(220, 220, 220);
  doc.line(14, y, 14 + anchoUtil, y);
  y += 6;
  const mitad = anchoUtil / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NEGRO);
  doc.text(comprobante.clienteNombre, 14, y);
  doc.text(`IVA: ${comprobante.clienteCondicionIva || "Consumidor Final"}`, 14 + mitad, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  if (comprobante.clienteCuit) {
    doc.text(`CUIT: ${comprobante.clienteCuit}`, 14, y);
  }
  doc.text(`Venta: ${comprobante.formaPago}`, 14 + mitad, y);
  y += 4.5;
  if (comprobante.clienteDireccion) {
    doc.text(`Domicilio: ${comprobante.clienteDireccion}`, 14, y);
    y += 4.5;
  }
  y += 4;
  doc.line(14, y - 4, 14 + anchoUtil, y - 4);

  // --- Detalle de productos ------------------------------------------------------------------
  doc.autoTable({
    startY: y,
    head: [["Código", "Descripción", "Cant.", "Precio unitario", "Desc.", "Subtotal"]],
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

  // --- Medios de pago --------------------------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NEGRO);
  doc.text("Medios de pago", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const medios = comprobante.pagos?.length ? comprobante.pagos.map((p) => ({ medio: p.medio, monto: p.monto })) : [{ medio: comprobante.formaPago, monto: comprobante.total }];
  medios.forEach((m) => {
    doc.setTextColor(...GRIS);
    doc.text(m.medio, 14, y);
    doc.setTextColor(...NEGRO);
    doc.text(formatMonto(m.monto), 14 + anchoUtil, y, { align: "right" });
    y += 5;
  });
  y += 2;

  if (comprobante.observaciones) {
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    const lineas = doc.splitTextToSize(comprobante.observaciones, anchoUtil);
    doc.text(lineas, 14, y);
    y += lineas.length * 4 + 2;
  }

  // Espacio reservado para CAE/QR fiscal cuando exista ARCA — hoy no se dibuja nada acá a
  // propósito (no hay datos reales que mostrar, y no queremos ni un placeholder que sugiera
  // validez fiscal). Ver comprobante.cae / comprobante.qr, siempre null en esta versión.

  const paginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text(`Hoja ${i} de ${paginas}`, 14, doc.internal.pageSize.getHeight() - 8);
    doc.text("Generado por Delfino ERP", 14 + anchoUtil, doc.internal.pageSize.getHeight() - 8, { align: "right" });
  }

  return doc;
}

export function descargarPdfComprobante(comprobante, configEmpresa) {
  const doc = generarPdfComprobante(comprobante, configEmpresa);
  doc.save(nombreArchivoComprobante(comprobante));
}

// "Ver PDF" — abre el mismo PDF en una pestaña nueva en vez de descargarlo, para previsualizar antes
// de mandarlo. Mismo generador que descargarPdfComprobante, solo cambia el output().
export function verPdfComprobante(comprobante, configEmpresa) {
  const doc = generarPdfComprobante(comprobante, configEmpresa);
  window.open(doc.output("bloburl"), "_blank");
}
