import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { attachAutocomplete } from "/js/autocomplete.js";
import { buscarProductos } from "/js/productos.js";
import { registrarVenta } from "/js/venta.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "productos", titulo: "Registrar venta", usuario });

content.innerHTML = `
  <div class="hint" style="margin-bottom:12px">
    Baja simple de stock por venta — sin cliente, numeración ni totales (eso queda para un módulo de Ventas más adelante).
  </div>
  <form id="form-venta">
    <div class="card" style="padding:20px; margin-bottom:16px">
      <table>
        <thead>
          <tr>
            <th style="width:50%">Producto</th>
            <th>Cantidad</th>
            <th>Stock actual</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="lineas-body"></tbody>
      </table>
      <button type="button" id="btn-agregar-linea" style="margin-top:12px">+ Agregar línea</button>
    </div>
    <div class="toolbar">
      <button type="submit" class="primary" id="submit-btn">Registrar venta</button>
      <a href="/productos/"><button type="button">Cancelar</button></a>
      <span class="error-text" id="form-error" style="display:none"></span>
    </div>
  </form>
`;

const lineasBody = document.getElementById("lineas-body");
let contadorLinea = 0;

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
    <td><input type="number" data-role="cantidad" step="1" min="1" value="1" style="max-width:90px" /></td>
    <td data-role="stock-actual" class="hint">-</td>
    <td><button type="button" data-role="quitar">Quitar</button></td>
  `;
  lineasBody.appendChild(tr);

  let productoSeleccionado = null;
  attachAutocomplete(document.getElementById(`wrapper-${id}`), {
    buscar: buscarProductos,
    etiqueta: (p) => `${p.sku ? p.sku + " — " : ""}${p.descripcion}`,
    onSelect: (item) => {
      productoSeleccionado = item;
      tr.querySelector("[data-role=stock-actual]").textContent = item ? item.stockTotal ?? 0 : "-";
    },
  });
  tr._getProducto = () => productoSeleccionado;

  tr.querySelector("[data-role=quitar]").addEventListener("click", () => tr.remove());
}

document.getElementById("btn-agregar-linea").addEventListener("click", agregarLinea);
agregarLinea();

document.getElementById("form-venta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  errorEl.style.display = "none";

  const items = [];
  for (const tr of lineasBody.querySelectorAll("tr")) {
    const producto = tr._getProducto();
    const cantidad = parseFloat(tr.querySelector("[data-role=cantidad]").value) || 0;
    if (!producto || cantidad <= 0) continue;
    items.push({
      productoId: producto.id,
      productoSku: producto.sku,
      productoDescripcion: producto.descripcion,
      cantidad,
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
    await registrarVenta(items, usuario);
    location.href = "/productos/movimientos.html";
  } catch (err) {
    errorEl.textContent = err?.message || "Ocurrió un error al registrar la venta.";
    errorEl.style.display = "block";
    submitBtn.disabled = false;
  }
});
