import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { buscarProductos } from "/js/productos.js";
import { crearVenta } from "/js/ventas.js";
import { initClientePicker } from "/js/cliente-picker.js";
import { pedirMedioPagoVenta } from "/js/venta-pago-modal.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "venta-nueva", titulo: "Nueva venta", usuario });

content.innerHTML = `
  <div class="pos-layout" id="pos-layout">
    <div class="pos-buscar card">
      <input type="text" id="pos-search" placeholder="Buscar producto por SKU, código o descripción…" autocomplete="off" />
      <div id="pos-resultados" class="pos-resultados"></div>
    </div>
    <div class="pos-carrito card">
      <div class="pos-cliente-row">
        <span class="hint" style="margin:0">Cliente</span>
        <div id="cliente-picker" style="flex:1; max-width:280px"></div>
        <button type="button" id="btn-quitar-cliente" class="link-btn" style="display:none">Quitar</button>
      </div>
      <div id="pos-carrito-vacio" class="empty-state">El carrito está vacío. Buscá productos para agregarlos.</div>
      <div id="pos-carrito-items"></div>
      <div class="pos-total-row">
        <span>Total</span>
        <span id="pos-total">$0</span>
      </div>
      <button type="button" class="primary" id="pos-continuar" disabled style="width:100%">Continuar</button>
      <div class="error-text" id="pos-error" style="display:none"></div>
    </div>
  </div>
  <div id="pos-confirmacion" class="card" style="display:none; text-align:center; padding:40px; max-width:420px; margin:24px auto"></div>
`;

const posLayout = document.getElementById("pos-layout");
const searchInput = document.getElementById("pos-search");
const resultadosEl = document.getElementById("pos-resultados");
const carritoVacioEl = document.getElementById("pos-carrito-vacio");
const carritoItemsEl = document.getElementById("pos-carrito-items");
const totalEl = document.getElementById("pos-total");
const continuarBtn = document.getElementById("pos-continuar");
const errorEl = document.getElementById("pos-error");
const btnQuitarCliente = document.getElementById("btn-quitar-cliente");

let carrito = []; // { productoId, productoSku, productoDescripcion, cantidad, precioUnitario, descuentoPct }
let clienteSeleccionado = null;

const clientePicker = initClientePicker(document.getElementById("cliente-picker"), {
  placeholder: "Consumidor final",
  onSelect: (cliente) => {
    clienteSeleccionado = cliente;
    btnQuitarCliente.style.display = cliente ? "inline-block" : "none";
  },
});

btnQuitarCliente.addEventListener("click", () => clientePicker.limpiarSeleccion());

function subtotalItem(item) {
  return Math.round(item.cantidad * item.precioUnitario * (1 - (item.descuentoPct || 0) / 100) * 100) / 100;
}

function totalCarrito() {
  return Math.round(carrito.reduce((acc, i) => acc + subtotalItem(i), 0) * 100) / 100;
}

function actualizarTotal() {
  totalEl.textContent = `$${totalCarrito().toLocaleString("es-AR")}`;
  continuarBtn.disabled = carrito.length === 0;
}

function pintarCarrito() {
  carritoVacioEl.style.display = carrito.length === 0 ? "block" : "none";
  carritoItemsEl.innerHTML = "";
  carrito.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "pos-cart-item";
    div.innerHTML = `
      <div class="pos-cart-item-info">
        <div>${item.productoDescripcion}</div>
        <div class="hint">${item.productoSku || ""}</div>
      </div>
      <input type="number" data-role="cantidad" min="1" step="1" value="${item.cantidad}" title="Cantidad" />
      <input type="number" data-role="precio" min="0" step="0.01" value="${item.precioUnitario}" title="Precio unitario" />
      <input type="number" data-role="descuento" min="0" max="100" step="1" value="${item.descuentoPct || 0}" title="Descuento %" />
      <div class="pos-cart-item-subtotal">$${subtotalItem(item).toLocaleString("es-AR")}</div>
      <button type="button" data-role="quitar" title="Quitar">✕</button>
    `;
    const subtotalEl = div.querySelector(".pos-cart-item-subtotal");
    div.querySelector("[data-role=cantidad]").addEventListener("input", (e) => {
      item.cantidad = Math.max(parseFloat(e.target.value) || 1, 1);
      subtotalEl.textContent = `$${subtotalItem(item).toLocaleString("es-AR")}`;
      actualizarTotal();
    });
    div.querySelector("[data-role=precio]").addEventListener("input", (e) => {
      item.precioUnitario = Math.max(parseFloat(e.target.value) || 0, 0);
      subtotalEl.textContent = `$${subtotalItem(item).toLocaleString("es-AR")}`;
      actualizarTotal();
    });
    div.querySelector("[data-role=descuento]").addEventListener("input", (e) => {
      item.descuentoPct = Math.min(Math.max(parseFloat(e.target.value) || 0, 0), 100);
      subtotalEl.textContent = `$${subtotalItem(item).toLocaleString("es-AR")}`;
      actualizarTotal();
    });
    div.querySelector("[data-role=quitar]").addEventListener("click", () => {
      carrito.splice(idx, 1);
      pintarCarrito();
      actualizarTotal();
    });
    carritoItemsEl.appendChild(div);
  });
  actualizarTotal();
}

function agregarAlCarrito(producto) {
  const existente = carrito.find((i) => i.productoId === producto.id);
  if (existente) {
    existente.cantidad += 1;
  } else {
    carrito.push({
      productoId: producto.id,
      productoSku: producto.sku,
      productoDescripcion: producto.descripcion,
      cantidad: 1,
      precioUnitario: producto.precioVenta ?? 0,
      descuentoPct: 0,
    });
  }
  searchInput.value = "";
  resultadosEl.innerHTML = "";
  searchInput.focus();
  pintarCarrito();
}

function pintarResultados(productos) {
  resultadosEl.innerHTML = "";
  if (productos.length === 0) {
    resultadosEl.innerHTML = '<div class="hint" style="padding:12px 8px">Sin resultados.</div>';
    return;
  }
  productos.forEach((p) => {
    const sinStock = (p.stockTotal ?? 0) <= 0;
    const div = document.createElement("div");
    div.className = "pos-result-item";
    div.innerHTML = `
      <div>
        <div>${p.descripcion || ""}</div>
        <div class="hint">${p.sku || ""}${sinStock ? ' · <span style="color:var(--danger)">Sin stock</span>' : ""}</div>
      </div>
      <div style="font-weight:600">$${(p.precioVenta ?? 0).toLocaleString("es-AR")}</div>
    `;
    div.addEventListener("click", () => agregarAlCarrito(p));
    resultadosEl.appendChild(div);
  });
}

let debounceTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const texto = searchInput.value.trim();
  if (!texto) {
    resultadosEl.innerHTML = "";
    return;
  }
  debounceTimer = setTimeout(async () => {
    const productos = await buscarProductos(texto, 15);
    pintarResultados(productos);
  }, 200);
});

function mostrarConfirmacion(numeroVenta, total) {
  posLayout.style.display = "none";
  const conf = document.getElementById("pos-confirmacion");
  conf.style.display = "block";
  conf.innerHTML = `
    <div style="font-size:40px; color:var(--success)">✓</div>
    <div style="font-size:18px; font-weight:600; margin:8px 0">¡Venta confirmada!</div>
    <div class="hint" style="font-size:14px">Venta #${numeroVenta}</div>
    <div style="font-size:26px; font-weight:600; margin:12px 0">$${total.toLocaleString("es-AR")}</div>
    <button type="button" class="primary" id="btn-nueva-venta" style="width:100%">Nueva venta</button>
  `;
  document.getElementById("btn-nueva-venta").addEventListener("click", () => location.reload());
}

continuarBtn.addEventListener("click", async () => {
  errorEl.style.display = "none";
  const total = totalCarrito();
  const pagos = await pedirMedioPagoVenta(total, clienteSeleccionado);
  if (!pagos) return;

  continuarBtn.disabled = true;
  try {
    const datos = {
      fecha: new Date().toISOString().slice(0, 10),
      clienteId: clienteSeleccionado?.id || null,
      clienteNombre: clienteSeleccionado?.razonSocial || null,
      items: carrito.map((i) => ({
        productoId: i.productoId,
        productoSku: i.productoSku,
        productoDescripcion: i.productoDescripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        descuentoPct: i.descuentoPct || 0,
        subtotal: subtotalItem(i),
      })),
      descuentoGlobal: 0,
      subtotal: total,
      total,
      pagos,
    };
    const resultado = await crearVenta(datos, usuario);
    mostrarConfirmacion(resultado.numeroVenta, total);
  } catch (err) {
    errorEl.textContent = err?.message || "Ocurrió un error al registrar la venta.";
    errorEl.style.display = "block";
    continuarBtn.disabled = false;
  }
});

pintarCarrito();
