import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { attachAutocomplete } from "/js/autocomplete.js";
import { pedirProveedorModal } from "/js/proveedor-modal.js";
import { abrirSelectorCategoria } from "/js/categoria-tree-modal.js";
import {
  buscarMarcas,
  crearMarca,
  obtenerCategoria,
  buscarProveedores,
  crearProveedor,
  listarListasPrecios,
  obtenerPrecioProductoLista,
  calcularPrecioLista,
} from "/js/catalogo.js";
import { obtenerProducto, crearProducto, actualizarProducto, obtenerLogAuditoria } from "/js/productos.js";
import { mostrarHistorialCostos } from "/js/historial-costos-modal.js";
import { obtenerCotizacionDolarOficial } from "/js/cotizacion-dolar.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const params = new URLSearchParams(location.search);
const productoId = params.get("id");
const esEdicion = Boolean(productoId);

const content = renderShell({
  active: "productos",
  titulo: esEdicion ? "Editar producto" : "Nuevo producto",
  usuario,
});

content.innerHTML = `
  <form id="form-producto">
    <div class="card mb-16">
      <div class="section-title">Identificación</div>
      <div class="field-row">
        <div class="field">
          <label for="sku">SKU (interno)</label>
          <input type="text" id="sku" required />
        </div>
        <div class="field">
          <label for="codigoInterno">Código interno</label>
          <input type="text" id="codigoInterno" />
        </div>
        <div class="field">
          <label for="codigoBarras">Código de barras / EAN</label>
          <input type="text" id="codigoBarras" />
        </div>
        <div class="field" style="grid-column: 1 / -1">
          <label for="descripcion">Descripción del artículo</label>
          <input type="text" id="descripcion" required />
        </div>
        <div class="field autocomplete" id="wrapper-marca">
          <label for="marca-search">Marca</label>
          <input type="text" id="marca-search" data-role="search" autocomplete="off" />
          <div class="autocomplete-list" data-role="list"></div>
        </div>
        <div class="field">
          <label>Categoría</label>
          <button type="button" id="categoria-picker-btn" class="categoria-picker-btn">Elegir categoría…</button>
        </div>
        <div class="field">
          <label for="identificadorExterno">Identificador externo</label>
          <input type="text" id="identificadorExterno" />
          <div class="hint">Para cruzar con listas de proveedor / importaciones.</div>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Proveedor</div>
      <div class="field-row">
        <div class="field autocomplete" id="wrapper-proveedor">
          <label for="proveedor-search">Proveedor principal</label>
          <input type="text" id="proveedor-search" data-role="search" autocomplete="off" />
          <div class="autocomplete-list" data-role="list"></div>
          <div class="hint" id="proveedor-cuit-hint"></div>
        </div>
        <div class="field">
          <label for="codigoProveedorPrincipal">Código del proveedor para este artículo</label>
          <input type="text" id="codigoProveedorPrincipal" />
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Precio y costo</div>
      <div class="field-row">
        <div class="field">
          <label for="costoMoneda">Moneda del costo</label>
          <select id="costoMoneda">
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>
        <div class="field">
          <label for="costoOriginal" id="costoOriginal-label">Costo de referencia sin IVA</label>
          <input type="number" id="costoOriginal" step="0.01" min="0" required />
          <div class="hint" id="costo-dolar-hint"></div>
        </div>
        <div class="field">
          <label for="iva">IVA (%)</label>
          <input type="number" id="iva" step="0.01" min="0" value="21" required />
        </div>
        <div class="field">
          <label for="costoModo">Modo de costeo</label>
          <select id="costoModo">
            <option value="ultimo">Último costo</option>
            <option value="promedio">Promedio ponderado</option>
          </select>
        </div>
      </div>
      <div class="field-row" id="costo-ultimo-row" style="display:none">
        <div class="field">
          <label>Último costo (de la última compra)</label>
          <input type="text" id="costoUltimo" disabled />
        </div>
        <div class="field" style="align-self:flex-end">
          <button type="button" id="btn-historial-costos">Ver historial de costos</button>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="modoPrecio">Modo de precio</label>
          <select id="modoPrecio">
            <option value="margen">Calculado por margen</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div class="field">
          <label for="margenObjetivo">Margen objetivo (%)</label>
          <input type="number" id="margenObjetivo" step="0.01" min="0" value="30" />
        </div>
        <div class="field">
          <label for="margenMinimo">Margen mínimo (%)</label>
          <input type="number" id="margenMinimo" step="0.01" min="0" />
        </div>
        <div class="field">
          <label for="precioVenta">Precio de venta</label>
          <input type="number" id="precioVenta" step="0.01" min="0" />
        </div>
      </div>
      <div class="hint" id="ganancia-hint" style="font-size:13px"></div>
    </div>

    <div class="card" id="listas-precios-section" style="display:none; padding:20px; margin-bottom:16px">
      <div class="section-title">Listas de precios</div>
      <table>
        <thead>
          <tr>
            <th>Lista</th>
            <th>Precio</th>
          </tr>
        </thead>
        <tbody id="listas-precios-body"></tbody>
      </table>
      <div class="hint" style="margin-top:8px">Los precios manuales por lista se editan desde <a href="/productos/precios.html">Productos → Precios</a>.</div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Stock</div>
      <div class="field-row">
        <div class="field">
          <label>Stock total</label>
          <input type="number" id="stockTotal" step="1" value="0" disabled />
        </div>
        <div class="field">
          <label>Stock reservado</label>
          <input type="number" id="stockReservado" step="1" value="0" disabled />
        </div>
        <div class="field">
          <label>Stock disponible</label>
          <input type="text" id="stockDisponible" disabled />
        </div>
        <div class="field">
          <label for="stockMinimo">Stock mínimo (alerta)</label>
          <input type="number" id="stockMinimo" step="1" value="0" />
        </div>
      </div>
      <div class="hint">El stock no se edita acá: sube con las compras y baja con las ventas (módulos futuros). Solo el mínimo de alerta es editable desde la ficha. Depósito único hoy (Casa Central) — el modelo ya soporta multidepósito a futuro.</div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Comercial</div>
      <div class="field-row">
        <div class="field">
          <label for="estado">Estado</label>
          <select id="estado">
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>
        <div class="field">
          <label for="visibilidad">Visibilidad</label>
          <select id="visibilidad">
            <option value="ambos">Venta y compra</option>
            <option value="venta">Solo venta</option>
            <option value="compra">Solo compra</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="linkTiendaNube">Link Tienda Nube</label>
        <input type="url" id="linkTiendaNube" placeholder="https://tutienda.mitiendanube.com/productos/..." />
      </div>
    </div>

    <div id="auditoria-section" style="display:none" class="card mb-16">
      <div class="section-title">Auditoría</div>
      <div id="log-auditoria"></div>
    </div>

    <div class="toolbar">
      <button type="submit" class="primary" id="submit-btn">${esEdicion ? "Guardar cambios" : "Crear producto"}</button>
      <a href="/productos/"><button type="button">Cancelar</button></a>
      <span class="error-text" id="form-error" style="display:none"></span>
    </div>
  </form>
`;

// --- Estado de selección de catálogo ---
let marcaSeleccionada = null;
let categoriaSeleccionada = null; // { id, nombre }
let subcategoriaSeleccionada = null; // { id, nombre } | null
let proveedorSeleccionado = null;

const categoriaPickerBtn = document.getElementById("categoria-picker-btn");

function actualizarTextoCategoria() {
  if (!categoriaSeleccionada) {
    categoriaPickerBtn.textContent = "Elegir categoría…";
  } else if (subcategoriaSeleccionada) {
    categoriaPickerBtn.textContent = `${categoriaSeleccionada.nombre} > ${subcategoriaSeleccionada.nombre}`;
  } else {
    categoriaPickerBtn.textContent = categoriaSeleccionada.nombre;
  }
}

categoriaPickerBtn.addEventListener("click", async () => {
  const resultado = await abrirSelectorCategoria({
    categoriaId: categoriaSeleccionada?.id,
    subcategoriaId: subcategoriaSeleccionada?.id,
  });
  if (!resultado) return;
  categoriaSeleccionada = { id: resultado.categoriaId, nombre: resultado.categoriaNombre };
  subcategoriaSeleccionada = resultado.subcategoriaId
    ? { id: resultado.subcategoriaId, nombre: resultado.subcategoriaNombre }
    : null;
  actualizarTextoCategoria();
});

attachAutocomplete(document.getElementById("wrapper-marca"), {
  buscar: buscarMarcas,
  etiqueta: (m) => m.nombre,
  crearLabel: "Crear marca",
  onCreate: (texto) => crearMarca(texto),
  onSelect: (item) => (marcaSeleccionada = item),
});

attachAutocomplete(document.getElementById("wrapper-proveedor"), {
  buscar: buscarProveedores,
  etiqueta: (p) => p.razonSocial,
  crearLabel: "Crear proveedor",
  onCreate: async (texto) => {
    // Un proveedor creado acá después tiene cuenta corriente propia — con el nombre no alcanza,
    // pedimos CUIT y ofrecemos autocompletar el resto consultando ARCA.
    const datos = await pedirProveedorModal(texto);
    if (!datos) return null; // canceló el modal
    return crearProveedor(datos.razonSocial, datos.cuit, datos.datosArca);
  },
  onSelect: (item) => {
    proveedorSeleccionado = item;
    document.getElementById("proveedor-cuit-hint").textContent = item?.cuit ? `CUIT: ${item.cuit}` : "";
  },
});

// --- Costo en pesos o dólares (al oficial de BCRA) ---
const costoOriginalEl = document.getElementById("costoOriginal");
const costoMonedaEl = document.getElementById("costoMoneda");
const costoOriginalLabelEl = document.getElementById("costoOriginal-label");
const costoDolarHintEl = document.getElementById("costo-dolar-hint");
const ivaEl = document.getElementById("iva");
const modoPrecioEl = document.getElementById("modoPrecio");
const margenObjetivoEl = document.getElementById("margenObjetivo");
const precioVentaEl = document.getElementById("precioVenta");
const gananciaHint = document.getElementById("ganancia-hint");

let cotizacionDolar = null; // { valor, fecha } — se pide una sola vez por carga de página

// Costo de referencia en pesos, que es lo que se usa en todo el resto del sistema (precios,
// compras, etc.) — si la moneda es USD, se convierte al oficial de BCRA.
function costoReferenciaArs() {
  const original = parseFloat(costoOriginalEl.value) || 0;
  if (costoMonedaEl.value === "USD" && cotizacionDolar) return original * cotizacionDolar.valor;
  return original;
}

async function alCambiarMoneda() {
  const esDolar = costoMonedaEl.value === "USD";
  costoOriginalLabelEl.textContent = esDolar ? "Costo de referencia sin IVA (USD)" : "Costo de referencia sin IVA";
  if (!esDolar) {
    costoDolarHintEl.textContent = "";
    recalcularPrecio();
    return;
  }
  costoDolarHintEl.textContent = "Buscando cotización oficial…";
  try {
    if (!cotizacionDolar) cotizacionDolar = await obtenerCotizacionDolarOficial();
    costoDolarHintEl.textContent = `Dólar oficial: $${cotizacionDolar.valor.toLocaleString("es-AR")} (BCRA, ${cotizacionDolar.fecha}) → Costo en pesos: $${costoReferenciaArs().toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  } catch (err) {
    costoDolarHintEl.textContent = "No se pudo obtener la cotización oficial: " + (err?.message || "error desconocido");
  }
  recalcularPrecio();
}

function recalcularPrecio() {
  const costo = costoReferenciaArs();
  const iva = parseFloat(ivaEl.value) || 0;
  const costoConIva = costo * (1 + iva / 100);

  if (costoMonedaEl.value === "USD" && cotizacionDolar) {
    costoDolarHintEl.textContent = `Dólar oficial: $${cotizacionDolar.valor.toLocaleString("es-AR")} (BCRA, ${cotizacionDolar.fecha}) → Costo en pesos: $${costo.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  }

  if (modoPrecioEl.value === "margen") {
    const margen = parseFloat(margenObjetivoEl.value) || 0;
    const precio = costoConIva * (1 + margen / 100);
    precioVentaEl.value = precio.toFixed(2);
    precioVentaEl.disabled = true;
  } else {
    precioVentaEl.disabled = false;
  }

  const precio = parseFloat(precioVentaEl.value) || 0;
  const gananciaMonto = precio - costoConIva;
  const gananciaPct = costoConIva > 0 ? (gananciaMonto / costoConIva) * 100 : 0;
  gananciaHint.textContent = `Costo con IVA: ${costoConIva.toFixed(2)} · Ganancia: ${gananciaMonto.toFixed(2)} (${gananciaPct.toFixed(1)}%)`;
}

costoMonedaEl.addEventListener("change", alCambiarMoneda);
[costoOriginalEl, ivaEl, modoPrecioEl, margenObjetivoEl, precioVentaEl].forEach((el) =>
  el.addEventListener("input", recalcularPrecio)
);
recalcularPrecio();

document.getElementById("btn-historial-costos").addEventListener("click", () => {
  mostrarHistorialCostos(productoId);
});

// --- Cálculo en vivo de stock disponible ---
const stockTotalEl = document.getElementById("stockTotal");
const stockReservadoEl = document.getElementById("stockReservado");
const stockDisponibleEl = document.getElementById("stockDisponible");

function recalcularStock() {
  const total = parseFloat(stockTotalEl.value) || 0;
  const reservado = parseFloat(stockReservadoEl.value) || 0;
  stockDisponibleEl.value = total - reservado;
}
[stockTotalEl, stockReservadoEl].forEach((el) => el.addEventListener("input", recalcularStock));
recalcularStock();

// --- Carga de datos si es edición ---
let datosOriginales = null;

if (esEdicion) {
  const producto = await obtenerProducto(productoId);
  if (!producto) {
    document.getElementById("form-error").textContent = "Producto no encontrado.";
    document.getElementById("form-error").style.display = "block";
  } else {
    datosOriginales = producto;
    document.getElementById("sku").value = producto.sku || "";
    document.getElementById("codigoInterno").value = producto.codigoInterno || "";
    document.getElementById("codigoBarras").value = producto.codigoBarras || "";
    document.getElementById("descripcion").value = producto.descripcion || "";
    document.getElementById("identificadorExterno").value = producto.identificadorExterno || "";
    document.getElementById("codigoProveedorPrincipal").value = producto.codigoProveedorPrincipal || "";
    document.getElementById("linkTiendaNube").value = producto.linkTiendaNube || "";
    // Compatibilidad con productos cargados antes de que existiera moneda: quedan en ARS.
    costoMonedaEl.value = producto.costoMoneda || "ARS";
    costoOriginalEl.value = producto.costoOriginal ?? producto.costoReferencia ?? "";
    if (producto.costoMoneda === "USD" && producto.costoTipoCambio) {
      cotizacionDolar = { valor: producto.costoTipoCambio, fecha: "última carga" };
    }
    document.getElementById("iva").value = producto.iva ?? 21;
    document.getElementById("costoModo").value = producto.costoModo || "ultimo";
    document.getElementById("modoPrecio").value = producto.modoPrecio || "margen";
    document.getElementById("margenObjetivo").value = producto.margenObjetivo ?? "";
    document.getElementById("margenMinimo").value = producto.margenMinimo ?? "";
    document.getElementById("precioVenta").value = producto.precioVenta ?? "";
    document.getElementById("stockTotal").value = producto.stockTotal ?? 0;
    document.getElementById("stockReservado").value = producto.stockReservado ?? 0;
    document.getElementById("stockMinimo").value = producto.stockMinimo ?? 0;
    document.getElementById("estado").value = producto.estado || "activo";
    document.getElementById("visibilidad").value = producto.visibilidad || "ambos";

    if (producto.marcaId) {
      marcaSeleccionada = { id: producto.marcaId, nombre: producto.marcaNombre };
      document.getElementById("marca-search").value = producto.marcaNombre || "";
    }
    if (producto.categoriaId) {
      const cat = await obtenerCategoria(producto.categoriaId);
      if (cat) categoriaSeleccionada = { id: cat.id, nombre: cat.nombre };
    }
    if (producto.subcategoriaId) {
      const sub = await obtenerCategoria(producto.subcategoriaId);
      if (sub) subcategoriaSeleccionada = { id: sub.id, nombre: sub.nombre };
    }
    actualizarTextoCategoria();
    if (producto.proveedorPrincipalId) {
      proveedorSeleccionado = { id: producto.proveedorPrincipalId, razonSocial: producto.proveedorPrincipalNombre };
      document.getElementById("proveedor-search").value = producto.proveedorPrincipalNombre || "";
    }

    recalcularPrecio();
    recalcularStock();

    // "Último costo" (de la última compra real) y el botón de historial — visibles en edición.
    document.getElementById("costo-ultimo-row").style.display = "grid";
    document.getElementById("costoUltimo").value =
      producto.costoUltimo != null ? `$${producto.costoUltimo.toLocaleString("es-AR")}` : "Sin compras registradas todavía";

    // Resumen de precios por lista (activas), solo lectura — la edición puntual queda en Precios.
    const listasSection = document.getElementById("listas-precios-section");
    const listasBody = document.getElementById("listas-precios-body");
    const listas = (await listarListasPrecios()).filter((l) => l.activa);
    if (listas.length > 0) {
      listasSection.style.display = "block";
      const filas = await Promise.all(
        listas.map(async (lista) => {
          const override = await obtenerPrecioProductoLista(productoId, lista.id);
          const precio = override?.precioManual ?? calcularPrecioLista(producto, lista);
          return { nombre: lista.nombre, precio };
        })
      );
      listasBody.innerHTML = filas
        .map((f) => `<tr><td>${f.nombre}</td><td>$${f.precio.toLocaleString("es-AR")}</td></tr>`)
        .join("");
    }

    const auditoriaSection = document.getElementById("auditoria-section");
    auditoriaSection.style.display = "block";
    const log = await obtenerLogAuditoria(productoId);
    document.getElementById("log-auditoria").innerHTML =
      "<strong style='font-size:13px'>Últimos cambios</strong><br/>" +
      (log.length
        ? log
            .map(
              (l) =>
                `<div class="hint">${l.campo}: ${l.valorAnterior ?? "-"} → ${l.valorNuevo ?? "-"}</div>`
            )
            .join("")
        : "<div class='hint'>Sin cambios registrados.</div>");
  }
}

// --- Submit ---
document.getElementById("form-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  errorEl.style.display = "none";

  if (costoMonedaEl.value === "USD" && !cotizacionDolar) {
    errorEl.textContent = "Esperá a que se cargue la cotización del dólar oficial, o cambiá la moneda a pesos.";
    errorEl.style.display = "block";
    return;
  }

  const datos = {
    sku: document.getElementById("sku").value.trim(),
    codigoInterno: document.getElementById("codigoInterno").value.trim(),
    codigoBarras: document.getElementById("codigoBarras").value.trim(),
    descripcion: document.getElementById("descripcion").value.trim(),
    marcaId: marcaSeleccionada?.id || null,
    marcaNombre: marcaSeleccionada?.nombre || null,
    categoriaId: categoriaSeleccionada?.id || null,
    subcategoriaId: subcategoriaSeleccionada?.id || null,
    identificadorExterno: document.getElementById("identificadorExterno").value.trim(),
    proveedorPrincipalId: proveedorSeleccionado?.id || null,
    proveedorPrincipalNombre: proveedorSeleccionado?.razonSocial || null,
    codigoProveedorPrincipal: document.getElementById("codigoProveedorPrincipal").value.trim(),
    linkTiendaNube: document.getElementById("linkTiendaNube").value.trim(),
    costoMoneda: costoMonedaEl.value,
    costoOriginal: parseFloat(costoOriginalEl.value) || 0,
    costoTipoCambio: costoMonedaEl.value === "USD" ? cotizacionDolar.valor : null,
    costoReferencia: Math.round(costoReferenciaArs() * 100) / 100,
    iva: parseFloat(document.getElementById("iva").value) || 0,
    costoModo: document.getElementById("costoModo").value,
    modoPrecio: document.getElementById("modoPrecio").value,
    margenObjetivo: parseFloat(document.getElementById("margenObjetivo").value) || null,
    margenMinimo: parseFloat(document.getElementById("margenMinimo").value) || null,
    precioVenta: parseFloat(document.getElementById("precioVenta").value) || 0,
    stockTotal: parseFloat(document.getElementById("stockTotal").value) || 0,
    stockReservado: parseFloat(document.getElementById("stockReservado").value) || 0,
    stockMinimo: parseFloat(document.getElementById("stockMinimo").value) || 0,
    estado: document.getElementById("estado").value,
    visibilidad: document.getElementById("visibilidad").value,
  };

  if (!datos.marcaId) {
    errorEl.textContent = "Elegí (o creá) una marca.";
    errorEl.style.display = "block";
    return;
  }

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;

  try {
    if (esEdicion) {
      await actualizarProducto(productoId, datos, datosOriginales, marcaSeleccionada.nombre, usuario);
    } else {
      await crearProducto(datos, marcaSeleccionada.nombre, usuario);
    }
    location.href = "/productos/";
  } catch (err) {
    errorEl.textContent = "Ocurrió un error al guardar. " + (err?.message || "");
    errorEl.style.display = "block";
    submitBtn.disabled = false;
  }
});
