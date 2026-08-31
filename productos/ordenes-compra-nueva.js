import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { attachAutocomplete } from "/js/autocomplete.js";
import { initProveedorPicker } from "/js/proveedor-picker.js";
import { buscarProductos, crearProducto } from "/js/productos.js";
import { pedirProductoRapidoModal } from "/js/producto-rapido-modal.js";
import { crearOrdenCompra } from "/js/ordenes-compra.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "ordenes-compra", titulo: "Nueva orden de compra", usuario });

content.innerHTML = `
  <form id="form-orden">
    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Datos del pedido</div>
      <div class="field-row">
        <div class="field">
          <label>Proveedor *</label>
          <div id="proveedor-picker"></div>
        </div>
        <div class="field">
          <label for="fecha-pedido">Fecha *</label>
          <input type="date" id="fecha-pedido" required />
        </div>
        <div class="field">
          <label for="fecha-entrega">Fecha estimada de entrega</label>
          <input type="date" id="fecha-entrega" />
        </div>
        <div class="field">
          <label for="referencia">Referencia</label>
          <input type="text" id="referencia" placeholder="Ej. presupuesto, N° de pedido…" />
        </div>
      </div>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Productos</div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th style="width:40%">Nombre</th>
              <th>Cantidad</th>
              <th>Precio final</th>
              <th>Subtotal</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="lineas-body"></tbody>
        </table>
      </div>
      <button type="button" id="btn-agregar-linea" style="margin-top:12px">+ Agregar línea</button>
      <div class="hint" id="total-hint" style="margin-top:8px; font-size:14px; font-weight:600; color:var(--foreground)"></div>
    </div>

    <div class="toolbar">
      <button type="submit" class="primary" id="submit-btn">Crear orden de compra</button>
      <a href="/productos/ordenes-compra.html"><button type="button">Cancelar</button></a>
      <span class="error-text" id="form-error" style="display:none"></span>
    </div>
  </form>
`;

document.getElementById("fecha-pedido").value = new Date().toISOString().slice(0, 10);

let proveedorSeleccionado = null;
initProveedorPicker(document.getElementById("proveedor-picker"), {
  onSelect: (item) => (proveedorSeleccionado = item),
});

const lineasBody = document.getElementById("lineas-body");
const totalHint = document.getElementById("total-hint");
let contadorLinea = 0;

function recalcularTotal() {
  let total = 0;
  lineasBody.querySelectorAll("tr").forEach((tr) => {
    const cantidad = parseFloat(tr.querySelector("[data-role=cantidad]").value) || 0;
    const precio = parseFloat(tr.querySelector("[data-role=precio]").value) || 0;
    const subtotal = cantidad * precio;
    tr.querySelector("[data-role=subtotal]").textContent = subtotal.toLocaleString("es-AR");
    total += subtotal;
  });
  totalHint.textContent = `Total: $${total.toLocaleString("es-AR")}`;
}

function agregarLinea() {
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
    <td><input type="number" data-role="cantidad" step="1" min="0" value="1" style="max-width:90px" /></td>
    <td><input type="number" data-role="precio" step="0.01" min="0" value="0" style="max-width:120px" /></td>
    <td data-role="subtotal">0</td>
    <td><button type="button" data-role="quitar">Quitar</button></td>
  `;
  lineasBody.appendChild(tr);

  let productoSeleccionado = null;
  attachAutocomplete(document.getElementById(`wrapper-${id}`), {
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
      return { id, sku: datos.sku, descripcion: datos.descripcion };
    },
    onSelect: (item) => {
      productoSeleccionado = item;
      recalcularTotal();
    },
  });
  tr._getProducto = () => productoSeleccionado;

  tr.querySelectorAll("[data-role=cantidad], [data-role=precio]").forEach((el) =>
    el.addEventListener("input", recalcularTotal)
  );
  tr.querySelector("[data-role=quitar]").addEventListener("click", () => {
    tr.remove();
    recalcularTotal();
  });
}

document.getElementById("btn-agregar-linea").addEventListener("click", agregarLinea);
agregarLinea();

document.getElementById("form-orden").addEventListener("submit", async (e) => {
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
    const precioFinal = parseFloat(tr.querySelector("[data-role=precio]").value) || 0;
    if (!producto || cantidad <= 0) continue;
    items.push({
      productoId: producto.id,
      productoSku: producto.sku,
      productoDescripcion: producto.descripcion,
      cantidad,
      precioFinal,
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
    await crearOrdenCompra(
      {
        proveedorId: proveedorSeleccionado.id,
        proveedorNombre: proveedorSeleccionado.razonSocial,
        fecha: new Date(document.getElementById("fecha-pedido").value),
        fechaEstimadaEntrega: document.getElementById("fecha-entrega").value
          ? new Date(document.getElementById("fecha-entrega").value)
          : null,
        referencia: document.getElementById("referencia").value.trim(),
        items,
      },
      usuario
    );
    location.href = "/productos/ordenes-compra.html";
  } catch (err) {
    errorEl.textContent = "Ocurrió un error al guardar. " + (err?.message || "");
    errorEl.style.display = "block";
    submitBtn.disabled = false;
  }
});
