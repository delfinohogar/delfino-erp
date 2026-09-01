import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { buscarProductos } from "/js/productos.js";
import { obtenerVenta } from "/js/ventas.js";
import { obtenerCliente } from "/js/clientes.js";
import { initClientePicker } from "/js/cliente-picker.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { obtenerConfigFacturacion } from "/js/facturacion-config.js";
import { crearComprobante, comprobanteDesdeVenta, subtotalItem, calcularTotales, FORMAS_PAGO_COMPROBANTE } from "/js/facturacion.js";
import { renderizarComprobanteHtml } from "/js/facturacion-preview.js";
import { descargarPdfComprobante, nombreArchivoComprobante } from "/js/facturacion-pdf.js";
import { abrirWhatsappComprobante } from "/js/facturacion-whatsapp.js";
import { abrirEmailComprobante, asuntoEmailComprobante, mensajeEmailComprobante } from "/js/facturacion-email.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "facturacion-nuevo", titulo: "Nuevo comprobante", usuario });

const ventaId = new URLSearchParams(location.search).get("ventaId");
const configEmpresa = { ...(await obtenerConfigEmpresa()), ...(await obtenerConfigFacturacion()) };

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

// --- Estado del formulario manual (solo si no viene de una venta) -----------------------------
let items = []; // { productoId?, productoSku?, productoDescripcion, cantidad, precioUnitario, descuentoPct }
let clienteSeleccionado = null;
let datosDesdeVenta = null; // cuando ventaId está presente, se salta directo a vista previa

if (ventaId) {
  const venta = await obtenerVenta(ventaId);
  if (!venta) {
    content.innerHTML = `<div class="empty-state">No se encontró esa venta. <a href="/productos/ventas.html">Volver a Ventas</a></div>`;
    throw new Error("venta no encontrada");
  }
  const cliente = venta.clienteId ? await obtenerCliente(venta.clienteId) : null;
  datosDesdeVenta = comprobanteDesdeVenta(venta, cliente);
}

function totalesActuales() {
  return calcularTotales(items, 0);
}

// --- Vista: formulario manual -------------------------------------------------------------------
function renderizarFormulario() {
  content.innerHTML = `
    <div class="toolbar">
      <a href="/facturacion/dashboard.html" class="link-btn">← Facturación</a>
    </div>
    <div class="pos-layout" id="pos-layout">
      <div class="pos-buscar card">
        <input type="text" id="prod-search" placeholder="Buscar producto por SKU, código o descripción…" autocomplete="off" />
        <div id="prod-resultados" class="pos-resultados"></div>
      </div>
      <div class="pos-carrito card">
        <div class="pos-cliente-row">
          <span class="hint" style="margin:0">Cliente</span>
          <div id="cliente-picker" style="flex:1; max-width:280px"></div>
        </div>
        <div class="field" style="margin-bottom:14px">
          <label for="forma-pago">Forma de pago</label>
          <select id="forma-pago">${FORMAS_PAGO_COMPROBANTE.map((f) => `<option>${f}</option>`).join("")}</select>
        </div>
        <div class="field" style="margin-bottom:14px">
          <label for="observaciones">Observaciones (opcional)</label>
          <input type="text" id="observaciones" placeholder="Notas para el comprobante…" />
        </div>
        <div id="carrito-vacio" class="empty-state">Todavía no agregaste productos.</div>
        <div id="carrito-items"></div>
        <div class="pos-total-row">
          <span>Total</span>
          <span id="carrito-total">$0</span>
        </div>
        <button type="button" class="primary" id="btn-vista-previa" disabled style="width:100%">Vista previa →</button>
        <div class="error-text" id="form-error" style="display:none"></div>
      </div>
    </div>
  `;

  const searchInput = document.getElementById("prod-search");
  const resultadosEl = document.getElementById("prod-resultados");
  const carritoVacioEl = document.getElementById("carrito-vacio");
  const carritoItemsEl = document.getElementById("carrito-items");
  const totalEl = document.getElementById("carrito-total");
  const btnVistaPrevia = document.getElementById("btn-vista-previa");
  const errorEl = document.getElementById("form-error");

  initClientePicker(document.getElementById("cliente-picker"), {
    placeholder: "Consumidor final",
    seleccionActual: clienteSeleccionado,
    onSelect: (cliente) => {
      clienteSeleccionado = cliente;
    },
  });

  function pintarCarrito() {
    carritoVacioEl.style.display = items.length === 0 ? "block" : "none";
    carritoItemsEl.innerHTML = "";
    items.forEach((item, idx) => {
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
        <div class="pos-cart-item-subtotal">${formatMonto(subtotalItem(item))}</div>
        <button type="button" data-role="quitar" title="Quitar">✕</button>
      `;
      const subtotalEl = div.querySelector(".pos-cart-item-subtotal");
      div.querySelector("[data-role=cantidad]").addEventListener("input", (e) => {
        item.cantidad = Math.max(parseFloat(e.target.value) || 1, 1);
        subtotalEl.textContent = formatMonto(subtotalItem(item));
        actualizarTotal();
      });
      div.querySelector("[data-role=precio]").addEventListener("input", (e) => {
        item.precioUnitario = Math.max(parseFloat(e.target.value) || 0, 0);
        subtotalEl.textContent = formatMonto(subtotalItem(item));
        actualizarTotal();
      });
      div.querySelector("[data-role=descuento]").addEventListener("input", (e) => {
        item.descuentoPct = Math.min(Math.max(parseFloat(e.target.value) || 0, 0), 100);
        subtotalEl.textContent = formatMonto(subtotalItem(item));
        actualizarTotal();
      });
      div.querySelector("[data-role=quitar]").addEventListener("click", () => {
        items.splice(idx, 1);
        pintarCarrito();
      });
      carritoItemsEl.appendChild(div);
    });
    actualizarTotal();
  }

  function actualizarTotal() {
    totalEl.textContent = formatMonto(totalesActuales().total);
    btnVistaPrevia.disabled = items.length === 0;
  }

  function agregarProducto(producto) {
    const existente = items.find((i) => i.productoId === producto.id);
    if (existente) existente.cantidad += 1;
    else {
      items.push({
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
      resultadosEl.innerHTML = "";
      if (productos.length === 0) {
        resultadosEl.innerHTML = '<div class="hint" style="padding:12px 8px">Sin resultados.</div>';
        return;
      }
      productos.forEach((p) => {
        const div = document.createElement("div");
        div.className = "pos-result-item";
        div.innerHTML = `<div><div>${p.descripcion || ""}</div><div class="hint">${p.sku || ""}</div></div><div style="font-weight:600">${formatMonto(p.precioVenta ?? 0)}</div>`;
        div.addEventListener("click", () => agregarProducto(p));
        resultadosEl.appendChild(div);
      });
    }, 200);
  });

  btnVistaPrevia.addEventListener("click", () => {
    errorEl.style.display = "none";
    if (items.length === 0) {
      errorEl.textContent = "Agregá al menos un producto.";
      errorEl.style.display = "block";
      return;
    }
    if (items.some((i) => !(i.cantidad > 0))) {
      errorEl.textContent = "Hay una cantidad inválida.";
      errorEl.style.display = "block";
      return;
    }
    if (items.some((i) => !(i.precioUnitario >= 0))) {
      errorEl.textContent = "Hay un precio inválido.";
      errorEl.style.display = "block";
      return;
    }
    renderizarVistaPrevia({
      items,
      descuentoGlobalPct: 0,
      cliente: clienteSeleccionado,
      formaPago: document.getElementById("forma-pago").value,
      observaciones: document.getElementById("observaciones").value,
    });
  });

  pintarCarrito();
}

// --- Vista: vista previa (antes de emitir) ------------------------------------------------------
function renderizarVistaPrevia(datos) {
  const totales = calcularTotales(datos.items, datos.descuentoGlobalPct || 0);
  const comprobantePreview = {
    estado: "BORRADOR",
    numeroCompleto: null,
    fechaEmision: new Date().toISOString().slice(0, 10),
    clienteNombre: datos.cliente?.razonSocial || "Consumidor final",
    clienteCuit: datos.cliente?.cuit || null,
    clienteDireccion: datos.cliente?.domicilioEntrega || datos.cliente?.domicilioFiscal || null,
    clienteCondicionIva: datos.cliente?.condicionIva || null,
    items: datos.items.map((it) => ({ ...it, subtotal: subtotalItem(it) })),
    ...totales,
    formaPago: datos.formaPago,
    observaciones: datos.observaciones,
  };

  content.innerHTML = `
    <div class="toolbar no-imprimir">
      <button type="button" id="btn-volver">← Volver</button>
      ${ventaId ? "" : `<button type="button" id="btn-editar">✏️ Editar</button>`}
      <button type="button" class="primary" id="btn-emitir">✅ Emitir comprobante</button>
    </div>
    <div class="hint" style="text-align:center; margin-bottom:14px">Vista previa — todavía no se emitió ningún comprobante.</div>
    ${renderizarComprobanteHtml(comprobantePreview, configEmpresa)}
    <div class="error-text" id="preview-error" style="display:none; text-align:center; margin-top:12px"></div>
  `;

  document.getElementById("btn-volver").addEventListener("click", () => (ventaId ? history.back() : renderizarFormulario()));
  document.getElementById("btn-editar")?.addEventListener("click", renderizarFormulario);

  document.getElementById("btn-emitir").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const errorEl = document.getElementById("preview-error");
    errorEl.style.display = "none";
    try {
      const comprobante = await crearComprobante(datos, usuario);
      renderizarEmitido(comprobante);
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo emitir el comprobante.";
      errorEl.style.display = "block";
      btn.disabled = false;
    }
  });
}

// --- Vista: emitido --------------------------------------------------------------------------
function renderizarEmitido(comprobante) {
  content.innerHTML = `
    <div class="card no-imprimir" style="padding:16px 20px; margin-bottom:16px; background:var(--success-bg); border-color:var(--success); text-align:center">
      <div style="font-size:15px; font-weight:700; color:var(--success)">🧾 COMPROBANTE EMITIDO</div>
      <div class="hint" style="margin:2px 0 0">${comprobante.numeroCompleto}</div>
    </div>
    <div class="toolbar no-imprimir">
      <button type="button" id="btn-pdf">📄 PDF</button>
      <button type="button" id="btn-imprimir">🖨️ Imprimir</button>
      <button type="button" id="btn-whatsapp">📱 WhatsApp</button>
      <button type="button" id="btn-email">✉️ Email</button>
      <a href="/facturacion/dashboard.html"><button type="button">Ir a Facturación</button></a>
    </div>
    ${renderizarComprobanteHtml(comprobante, configEmpresa)}
  `;

  document.getElementById("btn-pdf").addEventListener("click", () => descargarPdfComprobante(comprobante, configEmpresa));
  document.getElementById("btn-imprimir").addEventListener("click", () => window.print());
  document.getElementById("btn-whatsapp").addEventListener("click", () => {
    const { tieneNumero } = abrirWhatsappComprobante(comprobante, comprobante.clienteId ? clienteSeleccionado?.whatsapp : null);
    if (!tieneNumero) alert("El cliente no tiene WhatsApp cargado — elegí el contacto a mano. No te olvides de adjuntar el PDF, WhatsApp no lo hace automáticamente.");
    else alert("Se abrió WhatsApp con el mensaje listo — adjuntá el PDF a mano, no se puede hacer automáticamente desde el navegador.");
  });
  document.getElementById("btn-email").addEventListener("click", () => abrirModalEmail(comprobante));
}

function abrirModalEmail(comprobante) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:460px">
      <div class="section-title">Enviar por email</div>
      <div class="field">
        <label for="em-para">Para</label>
        <input type="email" id="em-para" value="${clienteSeleccionado?.email || ""}" placeholder="cliente@ejemplo.com" />
      </div>
      <div class="field">
        <label for="em-asunto">Asunto</label>
        <input type="text" id="em-asunto" value="${asuntoEmailComprobante()}" />
      </div>
      <div class="field">
        <label for="em-mensaje">Mensaje</label>
        <textarea id="em-mensaje" rows="6" style="width:100%; font-family:inherit; font-size:14px; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--background); color:var(--foreground)">${mensajeEmailComprobante(comprobante)}</textarea>
      </div>
      <div class="hint" style="margin-bottom:10px">Se abre tu programa de correo con esto ya cargado — el PDF no se adjunta solo, lo adjuntás vos ahí.</div>
      <div class="toolbar">
        <button type="button" class="primary" id="em-enviar">Abrir email</button>
        <button type="button" id="em-cancelar">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#em-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#em-enviar").addEventListener("click", () => {
    abrirEmailComprobante({
      para: overlay.querySelector("#em-para").value.trim(),
      asunto: overlay.querySelector("#em-asunto").value.trim(),
      mensaje: overlay.querySelector("#em-mensaje").value,
    });
    overlay.remove();
  });
}

// --- Arranque -----------------------------------------------------------------------------------
if (datosDesdeVenta) {
  clienteSeleccionado = datosDesdeVenta.cliente;
  renderizarVistaPrevia(datosDesdeVenta);
} else {
  renderizarFormulario();
}
