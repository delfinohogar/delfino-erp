// Motor de reportes: piezas reutilizables para que cada pantalla de reporte no reinvente tabla,
// exportación ni comparación de períodos. Todo opera sobre los datos que le pasa cada reporte —
// este módulo no sabe nada de ventas/productos/clientes, solo sabe renderizar y exportar.
import { formatMoneda, formatPorcentaje, formatCantidad } from "./formato.js";

function formatoPlano(valor, formato) {
  if (valor === null || valor === undefined || valor === "") return formato === "fecha" ? "-" : "";
  // porcentaje usaba toFixed(1) directo — coma decimal en todo el ERP, pero acá salía con punto
  // ("33.6%" en vez de "33,6%") porque toFixed() no respeta la configuración regional.
  if (formato === "moneda") return formatMoneda(valor);
  if (formato === "numero") return formatCantidad(valor);
  if (formato === "porcentaje") return formatPorcentaje(valor);
  if (formato === "fecha") return formatearFecha(valor);
  return String(valor);
}

function formatearFecha(valor) {
  if (!valor) return "-";
  const fecha = valor?.toDate ? valor.toDate() : new Date(valor.includes?.("T") ? valor : valor + "T00:00:00");
  if (Number.isNaN(fecha.getTime())) return String(valor);
  return fecha.toLocaleDateString("es-AR");
}

function valorOrdenable(fila, columna) {
  const v = fila[columna.clave];
  if (v?.toDate) return v.toDate().getTime();
  if (typeof v === "string" && columna.formato === "fecha") return v;
  return v ?? "";
}

function descargarBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportarCSV(nombreArchivo, columnas, filas) {
  const encabezado = columnas.map((c) => `"${c.titulo.replace(/"/g, '""')}"`).join(";");
  const cuerpo = filas.map((f) => columnas.map((c) => `"${formatoPlano(f[c.clave], c.formato).replace(/"/g, '""')}"`).join(";"));
  const contenido = [encabezado, ...cuerpo].join("\r\n");
  descargarBlob(new Blob(["﻿" + contenido], { type: "text/csv;charset=utf-8;" }), asegurarExtension(nombreArchivo, "csv"));
}

export function exportarExcel(nombreArchivo, columnas, filas) {
  if (!window.XLSX) {
    alert("El motor de Excel todavía está cargando — probá de nuevo en un segundo.");
    return;
  }
  const datos = [columnas.map((c) => c.titulo), ...filas.map((f) => columnas.map((c) => rawParaExcel(f[c.clave], c.formato)))];
  const hoja = window.XLSX.utils.aoa_to_sheet(datos);
  const libro = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(libro, hoja, "Reporte");
  window.XLSX.writeFile(libro, asegurarExtension(nombreArchivo, "xlsx"));
}

function rawParaExcel(valor, formato) {
  if (formato === "moneda" || formato === "numero") return typeof valor === "number" ? valor : Number(valor) || 0;
  if (formato === "porcentaje") return typeof valor === "number" ? `${valor.toFixed(1)}%` : valor;
  if (formato === "fecha") return formatearFecha(valor);
  return valor ?? "";
}

// resumen: [{titulo, valor}] (los KPI de arriba). columnas/filas: la tabla de detalle (opcional).
export function exportarPDF({ nombreArchivo, tituloReporte, periodoTexto, resumen, columnas, filas }) {
  if (!window.jspdf) {
    alert("El motor de PDF todavía está cargando — probá de nuevo en un segundo.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setTextColor(226, 62, 58);
  doc.text("DELFINO HOGAR", 14, 18);
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(tituloReporte.toUpperCase(), 14, 26);

  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  let y = 33;
  if (periodoTexto) {
    doc.text(`Período: ${periodoTexto}`, 14, y);
    y += 5;
  }
  doc.text(`Generado: ${new Date().toLocaleDateString("es-AR")} ${new Date().toLocaleTimeString("es-AR")}`, 14, y);
  y += 8;

  if (resumen && resumen.length) {
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text("RESUMEN", 14, y);
    y += 2;
    doc.autoTable({
      startY: y,
      head: [["Indicador", "Valor"]],
      body: resumen.map((r) => [r.titulo, r.valor]),
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 1.5 },
      headStyles: { textColor: [110, 110, 110], fontStyle: "normal" },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  if (columnas && filas && filas.length) {
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text("DETALLE", 14, y);
    y += 2;
    doc.autoTable({
      startY: y,
      head: [columnas.map((c) => c.titulo)],
      body: filas.map((f) => columnas.map((c) => formatoPlano(f[c.clave], c.formato))),
      theme: "striped",
      headStyles: { fillColor: [226, 62, 58], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
      tableWidth: anchoPagina - 28,
    });
  } else if (columnas && filas) {
    doc.setFontSize(9);
    doc.setTextColor(140, 140, 140);
    doc.text("Sin datos para el detalle en este período.", 14, y);
  }

  doc.save(asegurarExtension(nombreArchivo, "pdf"));
}

function asegurarExtension(nombre, ext) {
  return nombre.toLowerCase().endsWith("." + ext) ? nombre : `${nombre}.${ext}`;
}

export function imprimir() {
  window.print();
}

// Barra de botones de exportación — un solo lugar que arma los 4 botones y los conecta a las
// funciones de arriba, para que cada reporte solo tenga que pasarle sus datos.
export function renderizarExportar(contenedor, { nombreArchivo, tituloReporte, periodoTexto, resumen, columnas, filas }) {
  contenedor.innerHTML = `
    <div class="reporte-exportar no-imprimir">
      <button type="button" data-accion="csv">📋 CSV</button>
      <button type="button" data-accion="excel">📊 Excel</button>
      <button type="button" data-accion="pdf">📄 PDF</button>
      <button type="button" data-accion="imprimir">🖨️ Imprimir</button>
    </div>
  `;
  contenedor.querySelector('[data-accion="csv"]').addEventListener("click", () => {
    if (!columnas || !filas?.length) return alert("No hay datos en la tabla para exportar.");
    exportarCSV(nombreArchivo, columnas, filas);
  });
  contenedor.querySelector('[data-accion="excel"]').addEventListener("click", () => {
    if (!columnas || !filas?.length) return alert("No hay datos en la tabla para exportar.");
    exportarExcel(nombreArchivo, columnas, filas);
  });
  contenedor.querySelector('[data-accion="pdf"]').addEventListener("click", () => {
    exportarPDF({ nombreArchivo, tituloReporte, periodoTexto, resumen, columnas, filas });
  });
  contenedor.querySelector('[data-accion="imprimir"]').addEventListener("click", imprimir);
}

// Tabla ordenable (click en encabezado) + buscable (filtra texto en todas las columnas) +
// paginada (carga progresiva) + fila de totales opcional. columnas: [{clave,titulo,formato,align}].
// totales: fn(filasFiltradas) => objeto {clave: valorYaFormateado} para la fila de pie, opcional.
export function renderizarTabla(contenedor, { columnas, filas, buscar = true, totales = null, porPagina = 25 }) {
  let ordenPor = null;
  let ordenAsc = true;
  let filtro = "";
  let visibles = porPagina;

  function filasFiltradas() {
    if (!filtro) return filas;
    const q = filtro.toLowerCase();
    return filas.filter((f) => columnas.some((c) => formatoPlano(f[c.clave], c.formato).toLowerCase().includes(q)));
  }

  function repintar() {
    let datos = filasFiltradas();
    if (ordenPor) {
      const col = columnas.find((c) => c.clave === ordenPor);
      datos = [...datos].sort((a, b) => {
        const va = valorOrdenable(a, col);
        const vb = valorOrdenable(b, col);
        if (va < vb) return ordenAsc ? -1 : 1;
        if (va > vb) return ordenAsc ? 1 : -1;
        return 0;
      });
    }

    const totalFilas = datos.length;
    const mostrar = datos.slice(0, visibles);
    const filaTotales = totales ? totales(datos) : null;

    contenedor.innerHTML = `
      ${buscar ? `<input type="text" class="reporte-buscar" placeholder="Buscar en la tabla…" value="${filtro.replace(/"/g, "&quot;")}" />` : ""}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              ${columnas
                .map(
                  (c) => `
                <th data-clave="${c.clave}" style="cursor:pointer; ${c.align === "right" ? "text-align:right" : ""}">
                  ${c.titulo}${ordenPor === c.clave ? (ordenAsc ? " ▲" : " ▼") : ""}
                </th>
              `
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${
              mostrar.length
                ? mostrar
                    .map(
                      (f) => `
              <tr>
                ${columnas.map((c) => `<td style="${c.align === "right" ? "text-align:right" : ""}">${formatoPlano(f[c.clave], c.formato)}</td>`).join("")}
              </tr>
            `
                    )
                    .join("")
                : `<tr><td colspan="${columnas.length}" class="hint" style="text-align:center; padding:20px">Sin resultados.</td></tr>`
            }
          </tbody>
          ${
            filaTotales
              ? `<tfoot><tr style="font-weight:600">
                  ${columnas.map((c) => `<td style="${c.align === "right" ? "text-align:right" : ""}">${filaTotales[c.clave] ?? ""}</td>`).join("")}
                </tr></tfoot>`
              : ""
          }
        </table>
      </div>
      ${totalFilas > visibles ? `<div style="text-align:center; padding:12px"><button type="button" class="reporte-cargar-mas">Cargar más (${totalFilas - visibles} restantes)</button></div>` : ""}
    `;

    if (buscar) {
      const input = contenedor.querySelector(".reporte-buscar");
      input.addEventListener("input", () => {
        filtro = input.value;
        visibles = porPagina;
        repintar();
        contenedor.querySelector(".reporte-buscar")?.focus();
        // Mantiene el cursor al final tras repintar (se pierde el foco al reescribir el input).
        const el = contenedor.querySelector(".reporte-buscar");
        if (el) el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
    contenedor.querySelectorAll("th[data-clave]").forEach((th) => {
      th.addEventListener("click", () => {
        const clave = th.dataset.clave;
        if (ordenPor === clave) ordenAsc = !ordenAsc;
        else {
          ordenPor = clave;
          ordenAsc = true;
        }
        repintar();
      });
    });
    contenedor.querySelector(".reporte-cargar-mas")?.addEventListener("click", () => {
      visibles += porPagina;
      repintar();
    });
  }

  repintar();
}

// Tabla Indicador / Actual / Anterior / Variación — para comparar dos períodos.
// indicadores: [{titulo, actual, anterior, formato}].
export function renderizarComparacion(contenedor, indicadores) {
  contenedor.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Indicador</th><th class="num">Actual</th><th class="num">Anterior</th><th class="num">Variación</th></tr></thead>
        <tbody>
          ${indicadores
            .map((i) => {
              const variacionHtml = calcularVariacionHtml(i.actual, i.anterior);
              return `
              <tr>
                <td>${i.titulo}</td>
                <td class="num">${formatoPlano(i.actual, i.formato)}</td>
                <td class="num">${formatoPlano(i.anterior, i.formato)}</td>
                <td class="num">${variacionHtml}</td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function calcularVariacionHtml(actual, anterior) {
  if (!anterior) return `<span class="hint">-</span>`;
  const pct = ((actual - anterior) / anterior) * 100;
  const signo = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "success" : "danger";
  return `<span style="color:var(--${color})">${signo}${pct.toFixed(1)}%</span>`;
}

// Mensaje estándar para reportes que todavía no tienen la información necesaria — nunca se inventa
// un número, se explica qué falta y (si aplica) dónde cargarlo.
export function renderizarSinDatos(contenedor, motivo) {
  contenedor.innerHTML = `
    <div class="card empty-state">
      <div style="font-weight:600; margin-bottom:6px; color:var(--foreground)">No hay datos suficientes para generar este reporte.</div>
      <div class="hint">${motivo}</div>
    </div>
  `;
}
