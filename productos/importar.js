// Importar catálogo desde un Excel de GlobalBluePoint ERP — flujo: subir archivo → previsualizar
// (con toda la lógica de negocio ya aplicada, sin escribir nada) → confirmar → escribe en Firestore.
// Solo administrador: escribe ~1.700 documentos de una sola vez (productos + categorías + marcas +
// overrides de precio), no es una acción para dejar abierta a cualquier rol.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { prepararImportacion, confirmarImportacion } from "/js/importar-globalbluepoint.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = "";
  location.href = "/productos/";
  throw new Error("solo administrador");
}

const content = renderShell({ active: "importar", titulo: "Importar productos", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

content.innerHTML = `
  <div class="card mb-16">
    <div class="section-title">Subir archivo</div>
    <p class="hint" style="margin-top:0">
      Export de GlobalBluePoint ERP (hoja "Table", 15 columnas: item_code, item_desc, Stk, AStk,
      Lista de Precios, Lista Contado, Depo Central, Depo Lirio, Depo Video, Lista de Costos,
      cat_desc, subcat_desc, brand_desc, tax_percentage, ID). No se escribe nada todavía — primero
      se arma una previsualización.
    </p>
    <input type="file" id="imp-archivo" accept=".xlsx,.xls" />
    <div class="error-text hidden" id="imp-error"></div>
  </div>
  <div id="imp-preview"></div>
`;

const archivoInput = document.getElementById("imp-archivo");
const errorEl = document.getElementById("imp-error");
const previewEl = document.getElementById("imp-preview");

let candidatos = null;

archivoInput.addEventListener("change", async () => {
  const file = archivoInput.files[0];
  if (!file) return;
  errorEl.classList.add("hidden");
  previewEl.innerHTML = `<div class="hint">Leyendo ${file.name}…</div>`;
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
    if (filas.length === 0) throw new Error("La hoja no tiene filas.");

    previewEl.innerHTML = `<div class="hint">Procesando ${filas.length} filas…</div>`;
    const resultado = await prepararImportacion(filas);
    candidatos = resultado;
    pintarPreview(resultado);
  } catch (err) {
    previewEl.innerHTML = "";
    errorEl.textContent = "No se pudo leer el archivo: " + (err?.message || "error desconocido");
    errorEl.classList.remove("hidden");
  }
});

function pintarPreview({ productos, excluidos, sinSku, cotizacionDolar, errorCotizacion }) {
  const aRevisar = productos.filter((p) => p.revisarPrecio);
  const muestra = productos.slice(0, 12);

  previewEl.innerHTML = `
    <div class="dashboard-grid mb-16">
      <div class="card dashboard-card">
        <div class="hint mt-0">A importar</div>
        <div class="dashboard-card-valor">${productos.length}</div>
      </div>
      <div class="card dashboard-card">
        <div class="hint mt-0">Excluidos (no son productos)</div>
        <div class="dashboard-card-valor">${excluidos.length}</div>
      </div>
      <div class="card dashboard-card">
        <div class="hint mt-0">Marcados para revisar precio</div>
        <div class="dashboard-card-valor" style="color:${aRevisar.length > 0 ? "var(--warning)" : "inherit"}">${aRevisar.length}</div>
        <div class="hint">Entran con stock 0 hasta que alguien les cargue un precio real.</div>
      </div>
      <div class="card dashboard-card">
        <div class="hint mt-0">Cotización dólar oficial</div>
        <div class="dashboard-card-valor" style="font-size:18px">${cotizacionDolar ? formatMonto(cotizacionDolar.valor) : "—"}</div>
        <div class="hint">${errorCotizacion ? `<span style="color:var(--danger)">${errorCotizacion}</span>` : cotizacionDolar ? `BCRA, ${cotizacionDolar.fecha}` : ""}</div>
      </div>
    </div>

    ${
      errorCotizacion
        ? `<div class="card mb-16" style="background:var(--warning-bg); border-color:var(--warning)">
        <div style="font-weight:600; color:var(--warning)">⚠️ No se pudo obtener la cotización del dólar</div>
        <div class="hint">Los costos en USD van a quedar con costoReferencia $0 hasta corregirlos a mano — el resto del catálogo (en pesos) no se ve afectado.</div>
      </div>`
        : ""
    }

    <div class="card mb-16">
      <div class="section-title">Vista previa (primeros ${muestra.length} de ${productos.length})</div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>SKU</th><th>Descripción</th><th>Categoría / Subcategoría</th><th>Marca</th>
              <th class="num">Precio (Lista Contado)</th><th class="num">Costo neto</th><th class="num">Stock</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${muestra
              .map(
                (p) => `
              <tr>
                <td>${p.sku}</td>
                <td>${p.descripcion}</td>
                <td>${p.categoriaNombre}${p.subcategoriaNombre ? " / " + p.subcategoriaNombre : ""}</td>
                <td>${p.marcaNombre || "-"}</td>
                <td class="num">${formatMonto(p.precioVenta)}${p.revisarPrecio ? `<div class="hint mt-0">Lista de Precios: ${formatMonto(p.precioListaReferencia)}</div>` : ""}</td>
                <td class="num">${formatMonto(p.costoReferencia)}${p.costoMoneda === "USD" ? ` <span class="hint mt-0">(USD ${p.costoOriginal})</span>` : ""}</td>
                <td class="num">${p.stockTotal}</td>
                <td>${p.revisarPrecio ? '<span class="badge warning">Revisar precio</span>' : ""}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    ${
      excluidos.length > 0
        ? `<div class="card mb-16">
        <div class="section-title">Excluidos — no son productos</div>
        <div class="hint" style="margin-top:0">Renglones administrativos del ERP viejo (financiación, flete, descuentos, notas de crédito), no artículos reales.</div>
        ${excluidos.map((e) => `<div class="hint">SKU ${e.sku} — ${e.descripcion}</div>`).join("")}
      </div>`
        : ""
    }

    ${
      sinSku.length > 0
        ? `<div class="card mb-16"><div class="section-title">Sin SKU (${sinSku.length}) — se ignoran</div></div>`
        : ""
    }

    <div class="toolbar">
      <button type="button" class="primary" id="imp-confirmar">Confirmar importación (${productos.length} productos)</button>
    </div>
    <div id="imp-progreso" class="hint" style="margin-top:10px"></div>
    <div id="imp-resultado"></div>
  `;

  document.getElementById("imp-confirmar").addEventListener("click", async () => {
    const btn = document.getElementById("imp-confirmar");
    btn.disabled = true;
    const progresoEl = document.getElementById("imp-progreso");
    try {
      const { creados, actualizados } = await confirmarImportacion(productos, usuario, (mensaje) => {
        progresoEl.textContent = mensaje;
      });
      progresoEl.textContent = "";
      document.getElementById("imp-resultado").innerHTML = `
        <div class="card" style="background:var(--success-bg); border-color:var(--success); text-align:center; padding:20px">
          <div style="font-size:16px; font-weight:700; color:var(--success)">✓ Importación terminada</div>
          <div class="hint">${creados} productos nuevos · ${actualizados} actualizados${aRevisar.length > 0 ? ` · ${aRevisar.length} quedaron inactivos, marcados para revisar precio` : ""}</div>
          <a href="/productos/"><button type="button" class="primary" style="margin-top:10px">Ver catálogo</button></a>
        </div>
      `;
    } catch (err) {
      progresoEl.textContent = "";
      errorEl.textContent = "Error durante la importación: " + (err?.message || "error desconocido");
      errorEl.classList.remove("hidden");
      btn.disabled = false;
    }
  });
}
