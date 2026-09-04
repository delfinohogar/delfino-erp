import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { attachAutocomplete } from "/js/autocomplete.js";
import { initProveedorPicker } from "/js/proveedor-picker.js";
import { buscarProductos, crearProducto, obtenerProducto } from "/js/productos.js";
import { crearCompra } from "/js/compras.js";
import { extraerFacturaDeArchivo } from "/js/extraer-factura.js";
import { pedirProductoRapidoModal } from "/js/producto-rapido-modal.js";
import { obtenerOrdenCompra, marcarOrdenRecibida } from "/js/ordenes-compra.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const ordenId = new URLSearchParams(location.search).get("ordenId");

const content = renderShell({
  active: ordenId ? "ordenes-compra" : "compras",
  titulo: ordenId ? "Confirmar recepción" : "Nueva compra",
  usuario,
});

content.innerHTML = `
  ${
    ordenId
      ? `<div class="hint" style="margin-bottom:16px">
          Confirmando la recepción de una orden de compra — revisá los datos de la factura y los
          productos (ya vinculados) antes de guardar. Esto va a sumar stock y actualizar costos.
        </div>`
      : `<div class="card mb-16">
          <div class="section-title">Cargar factura con IA</div>
          <div class="hint" style="margin-bottom:8px">
            Subí el PDF o la foto de la factura y la IA completa los campos — siempre revisá antes de guardar
            (los productos de cada línea hay que confirmarlos a mano, para evitar matches incorrectos).
          </div>
          <div style="display:flex; align-items:center; gap:12px">
            <input type="file" id="archivo-factura" accept="application/pdf,image/*" />
            <button type="button" id="btn-completar-ia">Completar con IA</button>
            <span class="hint" id="ia-estado"></span>
          </div>
        </div>`
  }

  <form id="form-compra">
    <div class="card mb-16">
      <div class="section-title">Comprobante</div>
      <div class="field-row">
        <div class="field">
          <label>Proveedor *</label>
          <div id="proveedor-picker"></div>
        </div>
        <div class="field">
          <label for="tipo-comprobante">Tipo de comprobante *</label>
          <select id="tipo-comprobante">
            <option>Factura A</option>
            <option>Factura B</option>
            <option>Factura C</option>
            <option>Remito</option>
            <option>Nota de crédito</option>
          </select>
        </div>
        <div class="field">
          <label for="numero-factura">N° de factura *</label>
          <input type="text" id="numero-factura" placeholder="Ingresá el número de factura" required />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="fecha-factura">Fecha de factura *</label>
          <input type="date" id="fecha-factura" required />
        </div>
        <div class="field">
          <label for="fecha-vencimiento">Fecha de vencimiento</label>
          <input type="date" id="fecha-vencimiento" />
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="section-title">Productos</div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th style="width:30%">Nombre</th>
              <th>Cantidad</th>
              <th>Costo unitario</th>
              <th>Desc. %</th>
              <th>IVA %</th>
              <th>Subtotal</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="lineas-body"></tbody>
        </table>
      </div>
      <button type="button" id="btn-agregar-linea" style="margin-top:12px">+ Agregar línea</button>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px; max-width:340px; margin-left:auto">
      <div class="field-row">
        <div class="field">
          <label for="descuento-global">Descuento ($)</label>
          <input type="number" id="descuento-global" step="0.01" min="0" value="0" />
        </div>
        <div class="field">
          <label for="percepciones">Percepciones / Impuestos ($)</label>
          <input type="number" id="percepciones" step="0.01" min="0" value="0" />
        </div>
      </div>
      <div class="hint" style="display:flex; justify-content:space-between"><span>Importes</span><span id="totales-importes">0</span></div>
      <div class="hint" style="display:flex; justify-content:space-between"><span>IVA</span><span id="totales-iva">0</span></div>
      <div style="display:flex; justify-content:space-between; font-weight:600; margin-top:8px; font-size:15px">
        <span>Total</span><span id="totales-total">0</span>
      </div>

      <div class="hint" style="margin-top:14px; margin-bottom:4px">Retenciones (a depositar, no se le pagan al proveedor)</div>
      <div class="field">
        <label for="retencion-iva">Retención IVA ($)</label>
        <input type="number" id="retencion-iva" step="0.01" min="0" value="0" />
      </div>
      <div class="field">
        <label for="retencion-ganancias">Retención Ganancias ($)</label>
        <input type="number" id="retencion-ganancias" step="0.01" min="0" value="0" />
      </div>
      <div class="field">
        <label for="retencion-iibb">Retención IIBB ($)</label>
        <input type="number" id="retencion-iibb" step="0.01" min="0" value="0" />
      </div>
      <div style="display:flex; justify-content:space-between; font-weight:600; margin-top:8px; font-size:15px">
        <span>Neto a pagar</span><span id="totales-neto-pagar">0</span>
      </div>
    </div>

    <div class="toolbar">
      <button type="submit" class="primary" id="submit-btn">${ordenId ? "Confirmar recepción" : "Crear compra"}</button>
      <a href="${ordenId ? "/productos/ordenes-compra.html" : "/productos/compras.html"}"><button type="button">Cancelar</button></a>
      <span class="error-text" id="form-error" style="display:none"></span>
    </div>
  </form>
`;

document.getElementById("fecha-factura").value = new Date().toISOString().slice(0, 10);

let proveedorSeleccionado = null;
const proveedorPicker = initProveedorPicker(document.getElementById("proveedor-picker"), {
  onSelect: (item) => (proveedorSeleccionado = item),
});

const lineasBody = document.getElementById("lineas-body");
const descuentoGlobalEl = document.getElementById("descuento-global");
const percepcionesEl = document.getElementById("percepciones");
const retencionIvaEl = document.getElementById("retencion-iva");
const retencionGananciasEl = document.getElementById("retencion-ganancias");
const retencionIibbEl = document.getElementById("retencion-iibb");
let contadorLinea = 0;

function recalcularTotales() {
  let importes = 0;
  let iva = 0;
  lineasBody.querySelectorAll("tr").forEach((tr) => {
    const cantidad = parseFloat(tr.querySelector("[data-role=cantidad]").value) || 0;
    const costo = parseFloat(tr.querySelector("[data-role=costo]").value) || 0;
    const desc = parseFloat(tr.querySelector("[data-role=descuento]").value) || 0;
    const ivaPct = parseFloat(tr.querySelector("[data-role=ivaPct]").value) || 0;
    const subtotal = cantidad * costo * (1 - desc / 100);
    tr.querySelector("[data-role=subtotal]").textContent = subtotal.toLocaleString("es-AR", { maximumFractionDigits: 2 });
    importes += subtotal;
    iva += (subtotal * ivaPct) / 100;
  });

  const descuentoGlobal = parseFloat(descuentoGlobalEl.value) || 0;
  const percepciones = parseFloat(percepcionesEl.value) || 0;
  const total = importes - descuentoGlobal + iva + percepciones;
  const montoRetenciones = (parseFloat(retencionIvaEl.value) || 0) + (parseFloat(retencionGananciasEl.value) || 0) + (parseFloat(retencionIibbEl.value) || 0);
  const netoAPagar = total - montoRetenciones;

  document.getElementById("totales-importes").textContent = importes.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  document.getElementById("totales-iva").textContent = iva.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  document.getElementById("totales-total").textContent = total.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  document.getElementById("totales-neto-pagar").textContent = netoAPagar.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function agregarLinea(prefill = null) {
  const id = `linea-${contadorLinea++}`;
  const tr = document.createElement("tr");
  tr.dataset.id = id;
  tr.innerHTML = `
    <td>
      <div class="field autocomplete" id="wrapper-${id}" style="margin:0">
        <input type="text" data-role="search" autocomplete="off" placeholder="Buscar producto…" />
        <div class="autocomplete-list" data-role="list"></div>
      </div>
    </td>
    <td><input type="number" data-role="cantidad" step="1" min="0" value="${prefill?.cantidad ?? 1}" style="max-width:80px" /></td>
    <td><input type="number" data-role="costo" step="0.01" min="0" value="${prefill?.costoUnitario ?? 0}" style="max-width:110px" /></td>
    <td><input type="number" data-role="descuento" step="0.01" min="0" value="${prefill?.descuentoPct ?? 0}" style="max-width:80px" /></td>
    <td><input type="number" data-role="ivaPct" step="0.01" min="0" value="${prefill?.ivaPct ?? 21}" style="max-width:80px" /></td>
    <td data-role="subtotal">0</td>
    <td><button type="button" data-role="quitar">Quitar</button></td>
  `;
  lineasBody.appendChild(tr);

  let productoSeleccionado = null;
  const wrapper = document.getElementById(`wrapper-${id}`);
  attachAutocomplete(wrapper, {
    buscar: buscarProductos,
    etiqueta: (p) => `${p.sku ? p.sku + " — " : ""}${p.descripcion}`,
    crearLabel: "Crear producto",
    onCreate: async (texto) => {
      const datos = await pedirProductoRapidoModal(texto);
      if (!datos) return null;
      const id = await crearProducto(
        {
          sku: datos.sku,
          descripcion: datos.descripcion,
          marcaId: datos.marcaId,
          marcaNombre: datos.marcaNombre,
          iva: datos.iva,
          costoReferencia: 0,
          costoModo: "ultimo",
          modoPrecio: "margen",
          margenObjetivo: 30,
          estado: "activo",
          visibilidad: "ambos",
          stockMinimo: 0,
        },
        datos.marcaNombre,
        usuario
      );
      return { id, sku: datos.sku, descripcion: datos.descripcion, iva: datos.iva, stockTotal: 0 };
    },
    onSelect: (item) => {
      productoSeleccionado = item;
      if (item?.iva != null) tr.querySelector("[data-role=ivaPct]").value = item.iva;
      if (item) wrapper.querySelector('[data-role="search"]').style.borderColor = "";
      recalcularTotales();
    },
  });
  tr._getProducto = () => productoSeleccionado;

  if (prefill?.productoConocido) {
    // Ya se sabe exactamente qué producto es (ej. viniendo de una orden de compra) — se
    // preselecciona directo, sin necesidad de que el usuario lo busque y confirme.
    productoSeleccionado = prefill.productoConocido;
    wrapper.querySelector('[data-role="search"]').value = `${prefill.productoConocido.sku ? prefill.productoConocido.sku + " — " : ""}${prefill.productoConocido.descripcion}`;
  } else if (prefill?.descripcion) {
    const buscador = wrapper.querySelector('[data-role="search"]');
    buscador.value = prefill.descripcion;
    buscador.style.borderColor = "var(--warning, #d97706)";
    // La búsqueda recién se dispara al enfocar esta línea puntual — si precargamos todas a la vez
    // con dispatchEvent, cada fila abre su propia lista de sugerencias y quedan superpuestas.
    buscador.addEventListener("focus", function alEnfocar() {
      buscador.removeEventListener("focus", alEnfocar);
      buscador.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  tr.querySelectorAll("[data-role=cantidad], [data-role=costo], [data-role=descuento], [data-role=ivaPct]").forEach((el) =>
    el.addEventListener("input", recalcularTotales)
  );
  tr.querySelector("[data-role=quitar]").addEventListener("click", () => {
    tr.remove();
    recalcularTotales();
  });
}

document.getElementById("btn-agregar-linea").addEventListener("click", () => agregarLinea());
[descuentoGlobalEl, percepcionesEl, retencionIvaEl, retencionGananciasEl, retencionIibbEl].forEach((el) => el.addEventListener("input", recalcularTotales));

if (ordenId) {
  const orden = await obtenerOrdenCompra(ordenId);
  if (orden) {
    proveedorPicker.seleccionarDirecto({ id: orden.proveedorId, razonSocial: orden.proveedorNombre });
    const items = await Promise.all(
      orden.items.map(async (it) => {
        const producto = await obtenerProducto(it.productoId);
        return {
          cantidad: it.cantidad,
          costoUnitario: it.precioFinal,
          descuentoPct: 0,
          ivaPct: producto?.iva ?? 21,
          productoConocido: producto ? { id: producto.id, sku: producto.sku, descripcion: producto.descripcion } : null,
        };
      })
    );
    items.forEach((item) => agregarLinea(item));
    recalcularTotales();
  } else {
    agregarLinea();
  }
} else {
  agregarLinea();
}

document.getElementById("btn-completar-ia")?.addEventListener("click", async () => {
  const archivoInput = document.getElementById("archivo-factura");
  const estadoEl = document.getElementById("ia-estado");
  const file = archivoInput.files[0];
  if (!file) {
    estadoEl.textContent = "Elegí un archivo primero.";
    estadoEl.className = "hint error-text";
    return;
  }

  estadoEl.textContent = "Leyendo factura con IA…";
  estadoEl.className = "hint";
  const btn = document.getElementById("btn-completar-ia");
  btn.disabled = true;

  try {
    const datos = await extraerFacturaDeArchivo(file);

    if (datos.proveedorRazonSocial) {
      await proveedorPicker.buscarOAbrir(datos.proveedorRazonSocial, datos.proveedorCuit);
    }

    if (datos.tipoComprobante) {
      const select = document.getElementById("tipo-comprobante");
      const match = Array.from(select.options).find((o) =>
        o.textContent.toLowerCase().includes(datos.tipoComprobante.toLowerCase().split(" ")[0])
      );
      if (match) select.value = match.value;
    }

    if (datos.numeroFactura) document.getElementById("numero-factura").value = datos.numeroFactura;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha || "")) document.getElementById("fecha-factura").value = datos.fecha;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaVencimiento || "")) document.getElementById("fecha-vencimiento").value = datos.fechaVencimiento;
    if (datos.descuentoGlobal) descuentoGlobalEl.value = datos.descuentoGlobal;
    if (datos.percepciones) percepcionesEl.value = datos.percepciones;

    if (Array.isArray(datos.items) && datos.items.length > 0) {
      lineasBody.innerHTML = "";
      datos.items.forEach((item) => agregarLinea(item));
    }

    recalcularTotales();
    estadoEl.textContent = `Listo — revisá los datos y confirmá el producto de cada línea (quedaron marcadas en naranja).`;
    estadoEl.className = "hint";
  } catch (err) {
    estadoEl.textContent = "No se pudo leer la factura: " + (err?.message || "error desconocido");
    estadoEl.className = "hint error-text";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("form-compra").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  errorEl.style.display = "none";

  if (!proveedorSeleccionado) {
    errorEl.textContent = "Elegí (o creá) un proveedor.";
    errorEl.style.display = "block";
    return;
  }

  const items = [];
  for (const tr of lineasBody.querySelectorAll("tr")) {
    const producto = tr._getProducto();
    const cantidad = parseFloat(tr.querySelector("[data-role=cantidad]").value) || 0;
    const costoUnitario = parseFloat(tr.querySelector("[data-role=costo]").value) || 0;
    const descuentoPct = parseFloat(tr.querySelector("[data-role=descuento]").value) || 0;
    const ivaPct = parseFloat(tr.querySelector("[data-role=ivaPct]").value) || 0;
    if (!producto || cantidad <= 0) continue;
    items.push({
      productoId: producto.id,
      productoSku: producto.sku,
      productoDescripcion: producto.descripcion,
      cantidad,
      costoUnitario,
      descuentoPct,
      ivaPct,
      subtotal: Math.round(cantidad * costoUnitario * (1 - descuentoPct / 100) * 100) / 100,
    });
  }

  if (items.length === 0) {
    errorEl.textContent = "Agregá al menos un producto con cantidad mayor a cero.";
    errorEl.style.display = "block";
    return;
  }

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.disabled = true;

  try {
    const compraId = await crearCompra(
      {
        proveedorId: proveedorSeleccionado.id,
        proveedorNombre: proveedorSeleccionado.razonSocial,
        tipoComprobante: document.getElementById("tipo-comprobante").value,
        numeroFactura: document.getElementById("numero-factura").value.trim(),
        fecha: new Date(document.getElementById("fecha-factura").value),
        fechaVencimiento: document.getElementById("fecha-vencimiento").value
          ? new Date(document.getElementById("fecha-vencimiento").value)
          : null,
        descuentoGlobal: parseFloat(descuentoGlobalEl.value) || 0,
        percepciones: parseFloat(percepcionesEl.value) || 0,
        retencionIva: parseFloat(retencionIvaEl.value) || 0,
        retencionGanancias: parseFloat(retencionGananciasEl.value) || 0,
        retencionIibb: parseFloat(retencionIibbEl.value) || 0,
        items,
      },
      usuario
    );
    if (ordenId) {
      await marcarOrdenRecibida(ordenId, compraId);
      location.href = "/productos/ordenes-compra.html";
    } else {
      location.href = "/productos/compras.html";
    }
  } catch (err) {
    errorEl.textContent = "Ocurrió un error al guardar. " + (err?.message || "");
    errorEl.style.display = "block";
    submitBtn.disabled = false;
  }
});
