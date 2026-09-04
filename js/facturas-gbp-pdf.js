// PDF de una factura importada de GBP — diseño calcado del comprobante real que imprime GBP
// (wfmDocumentsPrint.aspx): placa circular con la letra, bloque de datos fiscales del emisor a la
// derecha, grilla de datos del cliente, tabla de ítems con los mismos encabezados en español,
// banda de TOTAL, e "importe en letras" + CAE + QR al pie, igual que un comprobante AFIP real.
import { formatMoneda as formatMonto } from "./formato.js";

function formatFecha(fechaStr) {
  if (!fechaStr) return "";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-AR");
}

function comprobanteTexto(f) {
  const numeroFmt = String(f.numero ?? "").padStart(8, "0");
  return `${String(f.puntoVenta ?? "").padStart(4, "0")}-${numeroFmt}`;
}

export function nombreArchivoFacturaGbp(f) {
  return `Factura_${f.letra || ""}_${comprobanteTexto(f)}.pdf`.replace(/\s+/g, "_");
}

// --- Número a letras (pesos argentinos) -----------------------------------------------------
const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const DIEC = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
const VEINTIS = ["VEINTE", "VEINTIUNO", "VEINTIDOS", "VEINTITRES", "VEINTICUATRO", "VEINTICINCO", "VEINTISEIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function centenasATexto(n) {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let texto = c > 0 ? CENTENAS[c] + " " : "";
  if (resto === 0) return texto.trim();
  if (resto < 10) texto += UNIDADES[resto];
  else if (resto < 20) texto += DIEC[resto - 10];
  else if (resto < 30) texto += VEINTIS[resto - 20];
  else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    texto += DECENAS[d] + (u > 0 ? " Y " + UNIDADES[u] : "");
  }
  return texto.trim();
}

function milesATexto(n) {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  let texto = miles > 0 ? (miles === 1 ? "MIL" : centenasATexto(miles) + " MIL") + " " : "";
  texto += centenasATexto(resto);
  return texto.trim();
}

// Alcanza y sobra para importes de venta minorista reales — no hace falta soportar miles de millones.
function montoEnLetras(valor) {
  const entero = Math.floor(Math.abs(valor));
  const centavos = Math.round((Math.abs(valor) - entero) * 100);
  const millones = Math.floor(entero / 1000000);
  const resto = entero % 1000000;
  let texto = millones > 0 ? (millones === 1 ? "UN MILLON" : centenasATexto(millones) + " MILLONES") + " " : "";
  texto += milesATexto(resto);
  texto = texto.trim() || "CERO";
  return `${texto} c/ ${String(centavos).padStart(2, "0")}/100`;
}

// --- QR fiscal (mismo formato que exige AFIP: https://www.afip.gob.ar/fe/qr/) ------------------
// Con el CAE ya emitido (la factura viene de GBP, ya autorizada), esto reconstruye el QR real que
// llevaba el comprobante original — no es una emisión nueva, es una reimpresión fiel.
const TIPO_CMP_AFIP = { A: 1, B: 6, C: 11 };

function urlQrAfip(f, configEmpresa, clienteCuit) {
  const cuitEmisor = (configEmpresa.cuit || "").replace(/\D/g, "");
  const cuitCliente = (clienteCuit || "").replace(/\D/g, "");
  const payload = {
    ver: 1,
    fecha: f.fecha,
    cuit: Number(cuitEmisor) || 0,
    ptoVta: f.puntoVenta,
    tipoCmp: TIPO_CMP_AFIP[f.letra] || 6,
    nroCmp: f.numero,
    importe: f.total,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: cuitCliente.length === 11 ? 80 : 99,
    nroDocRec: cuitCliente.length === 11 ? Number(cuitCliente) : 0,
    tipoCodAut: "E",
    codAut: Number(f.cae) || 0,
  };
  const base64 = btoa(JSON.stringify(payload));
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

// qrcodejs (davidshimjs) dibuja en un elemento del DOM — se crea uno invisible, se lee el canvas y
// se descarta. No tiene una API de "dame el dataURL directo" como otras librerías de QR.
function generarQrDataUrl(texto) {
  return new Promise((resolve, reject) => {
    if (!window.QRCode) return reject(new Error("La librería de QR todavía está cargando."));
    const div = document.createElement("div");
    div.style.cssText = "position:fixed; left:-9999px; top:-9999px";
    document.body.appendChild(div);
    try {
      new window.QRCode(div, { text: texto, width: 128, height: 128, correctLevel: window.QRCode.CorrectLevel.M });
      setTimeout(() => {
        const canvas = div.querySelector("canvas");
        const dataUrl = canvas ? canvas.toDataURL("image/png") : null;
        div.remove();
        dataUrl ? resolve(dataUrl) : reject(new Error("No se pudo generar el QR."));
      }, 60);
    } catch (err) {
      div.remove();
      reject(err);
    }
  });
}

// --- PDF -----------------------------------------------------------------------------------
// cliente: opcional — el documento de Delfino ya vinculado (ver gbpVincularClientes), si se tiene a
// mano. Sin él, se muestra "Consumidor Final" con el ID de GBP como referencia, igual que hace GBP
// cuando la venta no tiene datos completos del comprador.
export async function generarPdfFacturaGbp(f, configEmpresa = {}, cliente = null) {
  if (!window.jspdf) throw new Error("El motor de PDF todavía está cargando — probá de nuevo en un segundo.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const anchoUtil = doc.internal.pageSize.getWidth() - 28;
  const xDer = 14 + anchoUtil;

  const NEGRO = [20, 20, 20];
  const GRIS = [90, 90, 90];
  const ACCENT = [226, 62, 58];
  const GRIS_CLARO = [242, 242, 242];

  let y = 14;

  // --- Encabezado: emisor / placa / datos del comprobante --------------------------------------
  if (configEmpresa.logoDataUrl) {
    try {
      doc.addImage(configEmpresa.logoDataUrl, "PNG", 14, y, 13, 13);
    } catch {
      // logo con formato no soportado por addImage — se sigue sin logo
    }
  }
  const xTexto = configEmpresa.logoDataUrl ? 29 : 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...ACCENT);
  doc.text(configEmpresa.nombreFantasia || "Delfino Hogar", xTexto, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  let yEmp = y + 9.5;
  [configEmpresa.domicilioFiscal, [configEmpresa.provincia, configEmpresa.codigoPostal].filter(Boolean).join(" — CP "), configEmpresa.telefono ? `Teléfono/Fax: ${configEmpresa.telefono}` : null]
    .filter(Boolean)
    .forEach((l) => {
      doc.text(String(l), xTexto, yEmp);
      yEmp += 3.4;
    });

  // Placa circular con la letra, centrada
  const cx = 14 + anchoUtil / 2;
  const cy = y + 8;
  doc.setDrawColor(...NEGRO);
  doc.setLineWidth(0.4);
  doc.circle(cx, cy, 8.5, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...NEGRO);
  doc.text(f.letra || "X", cx, cy + 3, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...GRIS);
  const codigoAfip = { A: "01", B: "06", C: "11" }[f.letra] || "-";
  doc.text(`Código ${codigoAfip}`, cx, cy + 14, { align: "center" });

  // Datos del comprobante, alineados a la derecha
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...NEGRO);
  doc.text("FACTURA", xDer, y + 4, { align: "right" });
  doc.setFontSize(10);
  doc.text(`N° ${comprobanteTexto(f)}`, xDer, y + 9.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  doc.text(`Fecha ${formatFecha(f.fecha)}`, xDer, y + 14, { align: "right" });

  doc.setFontSize(7.5);
  let yFiscal = y + 19;
  const datosFiscales = [
    configEmpresa.cuit ? ["CUIT N°", configEmpresa.cuit] : null,
    configEmpresa.iibb ? ["Ing. Brutos", configEmpresa.iibb] : null,
    configEmpresa.inicioActividades ? ["Inicio Actividades", formatFecha(configEmpresa.inicioActividades)] : null,
    [configEmpresa.condicionIva || "IVA Responsable Inscripto", null],
  ].filter(Boolean);
  datosFiscales.forEach(([label, valor]) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NEGRO);
    const texto = valor ? `${label}  ${valor}` : label;
    doc.text(texto, xDer, yFiscal, { align: "right" });
    yFiscal += 3.6;
  });

  y = Math.max(yEmp, cy + 17, yFiscal) + 3;
  doc.setDrawColor(180, 180, 180);
  doc.line(14, y, xDer, y);
  y += 6;

  // --- Datos del cliente (grilla, como el comprobante de GBP) -----------------------------------
  const mitad = 14 + anchoUtil * 0.58;
  const filaCliente = (izq, der) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...NEGRO);
    if (izq) {
      doc.text(izq[0], 14, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRIS);
      doc.text(String(izq[1] ?? "-"), 14 + izq[2], y);
    }
    if (der) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NEGRO);
      doc.text(der[0], mitad, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GRIS);
      doc.text(String(der[1] ?? "-"), mitad + der[2], y);
    }
    y += 4.6;
  };

  filaCliente(["Cliente", `${f.clienteIdExterno ? f.clienteIdExterno + " — " : ""}${cliente?.razonSocial || "CONSUMIDOR FINAL"}`, 16], null);
  filaCliente(["Domicilio", cliente?.domicilioFiscal || "-", 20], ["Condición fiscal", cliente?.condicionIva || "Consumidor Final", 30]);
  filaCliente(
    ["Provincia", [cliente?.provincia, cliente?.codigoPostal ? `CP ${cliente.codigoPostal}` : null].filter(Boolean).join(" — ") || "-", 18],
    ["CUIT/DNI", cliente?.cuit || "-", 18]
  );
  filaCliente(["Fecha", formatFecha(f.fecha), 12], ["Condición de venta", "Contado", 34]);

  y += 2;
  doc.setDrawColor(180, 180, 180);
  doc.line(14, y, xDer, y);
  y += 2;

  // --- Detalle ---------------------------------------------------------------------------------
  doc.autoTable({
    startY: y,
    head: [["CÓD.", "DESCRIPCIÓN", "CANT.", "P. UNITARIO", "IMPORTE"]],
    body: (f.lineas || []).map((l) => [
      l.sku || l.itemIdExterno,
      l.descripcion || "(sin vincular en Delfino)",
      String(l.cantidad),
      formatMonto(l.precioUnitario),
      formatMonto(l.cantidad * l.precioUnitario),
    ]),
    theme: "plain",
    headStyles: { fillColor: GRIS_CLARO, textColor: NEGRO, fontStyle: "bold", fontSize: 8, lineWidth: { bottom: 0.3 }, lineColor: NEGRO },
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 10;

  // --- Total (banda gris, como el comprobante de GBP) -------------------------------------------
  doc.setFillColor(...GRIS_CLARO);
  doc.rect(14, y, anchoUtil, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...NEGRO);
  doc.text("TOTAL", xDer - 2, y + 4, { align: "right" });
  y += 11;
  doc.setFontSize(15);
  doc.setTextColor(...ACCENT);
  doc.text(formatMonto(f.total, { decimales: 2 }), xDer, y, { align: "right" });
  y += 10;

  // --- Pie: importe en letras + CAE + QR -------------------------------------------------------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...NEGRO);
  doc.text("Importe en letras:", 14, y);
  doc.setFont("helvetica", "bold");
  const letrasWrap = doc.splitTextToSize(`SON ${montoEnLetras(f.total)}`, anchoUtil - 55);
  doc.text(letrasWrap, 43, y);
  y += letrasWrap.length * 3.6 + 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Pesos (ARS)", 14, y);
  doc.setFontSize(8);
  doc.setTextColor(...NEGRO);
  doc.text("ORIGINAL", 14, y + 8);

  doc.setFontSize(8);
  doc.text(`C.A.E.: ${f.cae || "-"}`, xDer - 32, y, { align: "right" });
  doc.text(`Vto. C.A.E.: ${formatFecha(f.caeVencimiento)}`, xDer - 32, y + 4.5, { align: "right" });
  if (f.anulada) {
    doc.setTextColor(...ACCENT);
    doc.setFont("helvetica", "bold");
    doc.text("FACTURA ANULADA", xDer - 32, y + 9, { align: "right" });
  }

  try {
    const qrDataUrl = await generarQrDataUrl(urlQrAfip(f, configEmpresa, cliente?.cuit));
    doc.addImage(qrDataUrl, "PNG", xDer - 22, y - 2, 22, 22);
  } catch {
    // Sin QR el PDF sigue siendo válido como registro — el CAE en texto ya está arriba.
  }

  doc.setFontSize(7);
  doc.setTextColor(...GRIS);
  doc.text("Emitida en GBP — importada a Delfino ERP", 14, doc.internal.pageSize.getHeight() - 8);

  return doc;
}

export async function descargarPdfFacturaGbp(f, configEmpresa, cliente) {
  const doc = await generarPdfFacturaGbp(f, configEmpresa, cliente);
  doc.save(nombreArchivoFacturaGbp(f));
}
