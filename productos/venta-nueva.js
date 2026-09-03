import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarProductosActivos, filtrarProductosLocal, listarProductosVendidosRecientemente } from "/js/productos.js";
import { crearVenta, TIPOS_ENTREGA } from "/js/ventas.js";
import { actualizarCliente, crearCliente, buscarClientePorCuit } from "/js/clientes.js";
import { pedirClienteModal } from "/js/cliente-modal.js";
import { initClientePicker } from "/js/cliente-picker.js";
import { pedirMedioPagoVenta } from "/js/venta-pago-modal.js";
import { mostrarDetalleCliente } from "/js/cliente-detalle-modal.js";
import { ultimosPreciosPorProducto } from "/js/cuenta-corriente.js";
import { listarVentasPorCliente } from "/js/ventas.js";
import { crearComprobante, comprobanteDesdeVenta, tiposComprobanteDisponibles } from "/js/facturacion.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { obtenerConfigFacturacion } from "/js/facturacion-config.js";
import { renderizarComprobanteHtml } from "/js/facturacion-preview.js";
import { descargarPdfComprobante } from "/js/facturacion-pdf.js";
import { abrirWhatsappComprobante } from "/js/facturacion-whatsapp.js";
import { abrirEmailComprobante, asuntoEmailComprobante, mensajeEmailComprobante } from "/js/facturacion-email.js";
import { resolverSucursalUsuario } from "/js/sucursales.js";
import { listarCajasAbiertasPorSucursal } from "/js/cajas.js";
import { miniaturaProductoHtml } from "/js/producto-imagenes.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const configEmpresa = { ...(await obtenerConfigEmpresa()), ...(await obtenerConfigFacturacion()) };
const TIPOS_COMPROBANTE_UI = tiposComprobanteDisponibles();

// Misma resolución que hace crearVenta (js/ventas.js) — se repite acá solo para poder avisar en
// pantalla y, si hay más de una caja abierta, dejar elegir cuál. La fuente de verdad real es la del
// backend; esto es nada más para que el cajero no se entere recién después de vender.
const { sucursal: sucursalVenta, asumida: sucursalSinAsignar } = await resolverSucursalUsuario(usuario);
const cajasAbiertas = sucursalVenta ? await listarCajasAbiertasPorSucursal(sucursalVenta.id) : [];

// Todo el catálogo activo se trae una sola vez al entrar a la pantalla — el buscador de acá abajo
// filtra esta lista en memoria (igual que La Pyme), no dispara una consulta a Firestore por letra.
const catalogoVenta = await listarProductosActivos();

const content = renderShell({ active: "venta-nueva", titulo: "Nueva venta", usuario });

const cajaSelectHtml =
  cajasAbiertas.length > 1
    ? `<div class="field" style="margin-bottom:14px">
        <label for="pos-caja">Caja</label>
        <select id="pos-caja">
          ${cajasAbiertas.map((c, i) => `<option value="${i}">${c.caja.nombre}</option>`).join("")}
        </select>
      </div>`
    : "";

content.innerHTML = `
  ${
    sucursalSinAsignar
      ? `<div class="card no-imprimir" style="padding:12px 20px; margin-bottom:16px; background:var(--warning-bg); border-color:var(--warning)">
        <div style="font-weight:600; color:var(--warning)">⚠️ Tu usuario no tiene sucursal asignada</div>
        <div class="hint">El efectivo de esta venta va a ir a ${sucursalVenta ? sucursalVenta.nombre : "ninguna sucursal (no hay ninguna activa)"}. Pedile a un administrador que te asigne una en Configuración → Usuarios.</div>
      </div>`
      : ""
  }
  ${
    sucursalVenta && cajasAbiertas.length === 0
      ? `<div class="card no-imprimir" style="padding:12px 20px; margin-bottom:16px; background:var(--warning-bg); border-color:var(--warning)">
        <div style="font-weight:600; color:var(--warning)">⚠️ No hay ninguna caja abierta en ${sucursalVenta.nombre}</div>
        <div class="hint">El efectivo de esta venta va a quedar sin ubicar en Tesorería hasta que abras una caja.</div>
      </div>`
      : ""
  }
  <div class="pos-layout" id="pos-layout">
    <div class="pos-buscar card">
      <input type="text" id="pos-search" placeholder="Buscar producto por SKU, código o descripción…" autocomplete="off" />
      <div id="pos-resultados" class="pos-resultados"></div>
    </div>
    <div class="pos-carrito card">
      ${cajaSelectHtml}
      <div class="pos-cliente-row">
        <button type="button" id="btn-agregar-cliente" class="link-btn">+ Agregar cliente</button>
        <div id="cliente-picker" style="flex:1; max-width:280px; margin-left:auto"></div>
        <button type="button" id="btn-ver-cliente" class="link-btn" style="display:none">Ver</button>
        <button type="button" id="btn-editar-cliente" class="link-btn" style="display:none">Editar</button>
        <button type="button" id="btn-quitar-cliente" class="link-btn" style="display:none">Quitar</button>
      </div>
      <div id="pos-cliente-info" class="hint" style="display:none; margin:-8px 0 14px"></div>
      <div class="field" style="margin-bottom:14px">
        <label for="pos-tipo-entrega">Entrega</label>
        <select id="pos-tipo-entrega">
          ${TIPOS_ENTREGA.map((t) => `<option>${t}</option>`).join("")}
        </select>
        <input type="text" id="pos-domicilio-entrega" placeholder="Domicilio de entrega…" style="display:none; margin-top:8px; width:100%" />
        <input type="text" id="pos-nota-entrega" placeholder="Detalle…" style="display:none; margin-top:8px; width:100%" />
      </div>
      <div id="pos-carrito-vacio" class="empty-state">El carrito está vacío. Buscá productos para agregarlos.</div>
      <div id="pos-carrito-items"></div>
      <div class="pos-total-row">
        <span>Total</span>
        <span id="pos-total">$0</span>
      </div>
      <div class="field" style="margin-top:14px; margin-bottom:0">
        <label for="pos-tipo-comprobante">🧾 Comprobante</label>
        <select id="pos-tipo-comprobante">
          ${TIPOS_COMPROBANTE_UI.map((t) => `<option value="${t.codigo}">${t.nombre}</option>`).join("")}
        </select>
        <div class="hint" style="margin-top:4px">Comprobante interno — sin validez fiscal. Se genera automáticamente al confirmar.</div>
      </div>
      <button type="button" class="primary" id="pos-continuar" disabled style="width:100%; margin-top:14px">Continuar</button>
      <div class="error-text" id="pos-error" style="display:none"></div>
    </div>
  </div>
  <div id="pos-confirmacion" style="display:none; max-width:820px; margin:24px auto"></div>
`;

const posLayout = document.getElementById("pos-layout");
const searchInput = document.getElementById("pos-search");
const resultadosEl = document.getElementById("pos-resultados");
const carritoVacioEl = document.getElementById("pos-carrito-vacio");
const carritoItemsEl = document.getElementById("pos-carrito-items");
const totalEl = document.getElementById("pos-total");
const continuarBtn = document.getElementById("pos-continuar");
const errorEl = document.getElementById("pos-error");
const btnVerCliente = document.getElementById("btn-ver-cliente");
const btnQuitarCliente = document.getElementById("btn-quitar-cliente");
const btnEditarCliente = document.getElementById("btn-editar-cliente");
const clienteInfoEl = document.getElementById("pos-cliente-info");
const tipoEntregaSelect = document.getElementById("pos-tipo-entrega");
const domicilioEntregaInput = document.getElementById("pos-domicilio-entrega");
const notaEntregaInput = document.getElementById("pos-nota-entrega");

let carrito = []; // { productoId, productoSku, productoDescripcion, cantidad, precioUnitario, descuentoPct }
let clienteSeleccionado = null;
// Precio → productoId de la última vez que se le vendió algo a ESTE cliente (se recalcula al elegir
// cliente). Se muestra junto al resultado de búsqueda como referencia — igual que "Última venta a
// este cliente" en La Pyme — sin bloquear el agregado al carrito con un modal aparte.
let preciosCliente = new Map();

async function cargarPreciosCliente(cliente) {
  preciosCliente = cliente ? ultimosPreciosPorProducto(await listarVentasPorCliente(cliente.id)) : new Map();
}

// Muestra, sin poder editarlo acá, el domicilio y teléfono que ya tiene cargados el cliente — para
// que el vendedor pueda confirmárselo al comprador sin tener que ir a Clientes. Editable solo desde
// "Editar" (btnEditarCliente) o desde Clientes.
function actualizarInfoCliente(cliente) {
  const partes = [];
  if (cliente?.domicilioEntrega) partes.push(`📍 ${cliente.domicilioEntrega}`);
  if (cliente?.whatsapp) partes.push(`📞 ${cliente.whatsapp}`);
  clienteInfoEl.textContent = partes.join("   ·   ");
  clienteInfoEl.style.display = partes.length > 0 ? "block" : "none";
}

const clientePicker = initClientePicker(document.getElementById("cliente-picker"), {
  placeholder: "Consumidor final",
  onSelect: (cliente) => {
    clienteSeleccionado = cliente;
    btnVerCliente.style.display = cliente ? "inline-block" : "none";
    btnQuitarCliente.style.display = cliente ? "inline-block" : "none";
    btnEditarCliente.style.display = cliente ? "inline-block" : "none";
    actualizarInfoCliente(cliente);
    if (cliente?.domicilioEntrega && !domicilioEntregaInput.value) {
      domicilioEntregaInput.value = cliente.domicilioEntrega;
    }
    cargarPreciosCliente(cliente);
  },
});

btnVerCliente.addEventListener("click", () => mostrarDetalleCliente(clienteSeleccionado));

// Va directo a la pantalla de alta (no al buscador) — el nombre del botón es "Agregar", no "Elegir".
// Antes de crear, chequea por CUIT/DNI: si ya existe, ofrece usar ese cliente en vez de duplicarlo
// (crearCliente no valida nada por sí sola).
document.getElementById("btn-agregar-cliente").addEventListener("click", async () => {
  const datos = await pedirClienteModal("");
  if (!datos) return;

  const existente = await buscarClientePorCuit(datos.cuit);
  if (existente) {
    const usarExistente = confirm(
      `Ya hay un cliente con ese CUIT/DNI: "${existente.razonSocial}".\n\n¿Usar ese cliente en vez de crear uno nuevo?`
    );
    if (usarExistente) {
      clientePicker.seleccionarDirecto(existente);
      return;
    }
  }

  const nuevo = await crearCliente(datos.razonSocial, datos.cuit, datos.datosArca, datos.datosContacto);
  clientePicker.seleccionarDirecto(nuevo);
});

function actualizarCamposEntrega() {
  const tipo = tipoEntregaSelect.value;
  domicilioEntregaInput.style.display = tipo === "Envío a domicilio" ? "block" : "none";
  notaEntregaInput.style.display = tipo === "Otro" ? "block" : "none";
  if (tipo === "Envío a domicilio" && !domicilioEntregaInput.value && clienteSeleccionado?.domicilioEntrega) {
    domicilioEntregaInput.value = clienteSeleccionado.domicilioEntrega;
  }
}
tipoEntregaSelect.addEventListener("change", actualizarCamposEntrega);
actualizarCamposEntrega();

btnQuitarCliente.addEventListener("click", () => clientePicker.limpiarSeleccion());

// Por si cambió de domicilio, WhatsApp, etc. desde la última venta — se edita ahí mismo, sin tener
// que ir a Clientes y volver.
btnEditarCliente.addEventListener("click", async () => {
  const resultado = await pedirClienteModal(clienteSeleccionado.razonSocial, clienteSeleccionado);
  if (!resultado) return;
  await actualizarCliente(clienteSeleccionado.id, resultado.razonSocial, resultado.cuit, resultado.datosArca, resultado.datosContacto);
  const actualizado = {
    ...clienteSeleccionado,
    razonSocial: resultado.razonSocial,
    cuit: resultado.cuit,
    domicilioEntrega: resultado.datosContacto.domicilioEntrega || null,
    whatsapp: resultado.datosContacto.whatsapp || null,
    email: resultado.datosContacto.email || null,
    ...(resultado.datosArca || {}),
  };
  clienteSeleccionado = actualizado;
  clientePicker.seleccionarDirecto(actualizado);
});

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
      iva: producto.iva ?? 21,
    });
  }
  searchInput.value = "";
  mostrarRecientes();
  // Reenfocar el buscador después de cada producto sirve para seguir tipeando rápido con teclado
  // físico (el flujo pensado originalmente) — pero en un dispositivo táctil reabre el teclado
  // virtual solo, sin que nadie lo haya pedido, y en iOS Safari eso dispara el zoom automático de
  // la página al enfocar un input por código (no por un toque directo del usuario). "pointer: coarse"
  // es la señal correcta de "el input principal es táctil" — no se basa en el ancho de pantalla
  // (una tablet o un notebook con pantalla táctil también cuentan), a diferencia del breakpoint de
  // CSS que sí usa max-width.
  if (!window.matchMedia("(pointer: coarse)").matches) {
    searchInput.focus();
  }
  pintarCarrito();
}

function miniatura(p) {
  return miniaturaProductoHtml(p);
}

// Se muestran como máximo 5 — con más, la lista empuja el carrito/total/comprobante fuera de la
// pantalla en celular y el vendedor tiene que scrollear para llegar a "Continuar".
const MAX_RESULTADOS_VISIBLES = 5;

let resultadosActuales = [];
function pintarResultados(productos, titulo) {
  const visibles = productos.slice(0, MAX_RESULTADOS_VISIBLES);
  resultadosActuales = visibles;
  resultadosEl.innerHTML = "";
  if (visibles.length === 0) {
    resultadosEl.innerHTML = titulo ? "" : '<div class="hint" style="padding:12px 8px">Sin resultados.</div>';
    return;
  }
  if (titulo) {
    const tituloEl = document.createElement("div");
    tituloEl.className = "hint";
    tituloEl.style.cssText = "padding:8px 8px 4px; text-transform:uppercase; letter-spacing:0.03em; font-size:11px";
    tituloEl.textContent = titulo;
    resultadosEl.appendChild(tituloEl);
  }
  visibles.forEach((p) => {
    const sinStock = (p.stockTotal ?? 0) <= 0;
    // Referencia de precio, no un bloqueo: a diferencia de La Pyme (que abre un modal aparte antes
    // de agregar), acá se agrega directo — el precio anterior solo se muestra al lado, en la fila
    // del carrito, por si conviene ajustarlo (ver pintarCarrito).
    const precioCliente = preciosCliente.get(p.id);
    const refPrecio =
      precioCliente && precioCliente.precio !== p.precioVenta
        ? `<span class="hint" style="margin:0"> · a este cliente: $${precioCliente.precio.toLocaleString("es-AR")}</span>`
        : p.ultimoPrecioVenta && p.ultimoPrecioVenta !== p.precioVenta
          ? `<span class="hint" style="margin:0"> · última venta: $${p.ultimoPrecioVenta.toLocaleString("es-AR")}</span>`
          : "";
    const div = document.createElement("div");
    div.className = "pos-result-item";
    div.innerHTML = `
      ${miniatura(p)}
      <div style="flex:1; min-width:0">
        <div>${p.descripcion || ""}</div>
        <div class="hint">${p.sku || ""}${sinStock ? ' · <span style="color:var(--danger)">Sin stock</span>' : ""}${refPrecio}</div>
      </div>
      <div style="font-weight:600">$${(p.precioVenta ?? 0).toLocaleString("es-AR")}</div>
    `;
    div.addEventListener("click", () => agregarAlCarrito(p));
    resultadosEl.appendChild(div);
  });
}

// Igual que "Vendidos recientemente" en La Pyme: con el buscador vacío no queda en blanco, muestra
// lo último que se vendió — así el vendedor puede arrancar tocando la lista en vez de tener que
// tipear siempre, para lo que se repite seguido (mismos 2-3 productos la mayoría de las ventas).
let productosRecientes = [];
function mostrarRecientes() {
  if (productosRecientes.length === 0) {
    resultadosActuales = [];
    resultadosEl.innerHTML = "";
    return;
  }
  pintarResultados(productosRecientes, "Vendidos recientemente");
}
listarProductosVendidosRecientemente().then((productos) => {
  productosRecientes = productos;
  if (!searchInput.value.trim()) mostrarRecientes();
});

searchInput.addEventListener("input", () => {
  const texto = searchInput.value.trim();
  if (!texto) {
    mostrarRecientes();
    return;
  }
  pintarResultados(filtrarProductosLocal(catalogoVenta, texto, MAX_RESULTADOS_VISIBLES));
});

// Enter agrega el primer resultado sin soltar el teclado — mismo espíritu que el escaneo de
// código de barras de La Pyme: escanear/tipear el código exacto suele dejar un solo resultado.
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && resultadosActuales.length > 0) {
    e.preventDefault();
    agregarAlCarrito(resultadosActuales[0]);
  }
});

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

// La venta y su comprobante quedan mostrados juntos, en la misma pantalla — no hace falta ir a
// buscar la venta en otro módulo para poder facturarla (esa era la falla de arquitectura anterior).
function mostrarConfirmacion(numeroVenta, tipoEntrega, comprobante, routeoTesoreria) {
  posLayout.style.display = "none";
  const conf = document.getElementById("pos-confirmacion");
  conf.style.display = "block";
  const sinRutear = (routeoTesoreria || []).filter((r) => !r.ruteado);
  conf.innerHTML = `
    <div class="card" style="padding:20px; text-align:center; margin-bottom:16px">
      <div style="font-size:32px; color:var(--success)">✓</div>
      <div style="font-size:16px; font-weight:600; margin:4px 0">Venta #${numeroVenta} confirmada</div>
      ${tipoEntrega !== "Retira ahora" ? `<div class="hint">${tipoEntrega} — queda pendiente para Logística.</div>` : ""}
    </div>
    ${
      sinRutear.length > 0
        ? `<div class="card no-imprimir" style="padding:14px 20px; margin-bottom:16px; background:var(--warning-bg); border-color:var(--warning)">
        <div style="font-weight:600; color:var(--warning)">⚠️ La venta se registró, pero Tesorería no pudo ubicar el pago</div>
        ${sinRutear.map((r) => `<div class="hint">${r.medio} ($${r.monto.toLocaleString("es-AR")}): ${r.motivo}</div>`).join("")}
      </div>`
        : ""
    }

    <div class="card no-imprimir" style="padding:16px 20px; margin-bottom:16px; background:var(--success-bg); border-color:var(--success); text-align:center">
      <div style="font-size:15px; font-weight:700; color:var(--success)">🧾 COMPROBANTE EMITIDO</div>
      <div class="hint" style="margin:2px 0 0">${comprobante.numeroCompleto}</div>
    </div>
    <div class="toolbar no-imprimir" style="justify-content:center">
      <button type="button" id="btn-pdf">📄 PDF</button>
      <button type="button" id="btn-imprimir">🖨️ Imprimir</button>
      <button type="button" id="btn-whatsapp">📱 WhatsApp</button>
      <button type="button" id="btn-email">✉️ Email</button>
      <button type="button" id="btn-nueva-venta" class="primary">Nueva venta</button>
    </div>
    ${renderizarComprobanteHtml(comprobante, configEmpresa)}
  `;

  document.getElementById("btn-nueva-venta").addEventListener("click", () => location.reload());
  document.getElementById("btn-pdf").addEventListener("click", () => descargarPdfComprobante(comprobante, configEmpresa));
  document.getElementById("btn-imprimir").addEventListener("click", () => window.print());
  document.getElementById("btn-whatsapp").addEventListener("click", () => {
    const { tieneNumero } = abrirWhatsappComprobante(comprobante, clienteSeleccionado?.whatsapp);
    alert(
      tieneNumero
        ? "Se abrió WhatsApp con el mensaje listo — adjuntá el PDF a mano, no se puede hacer automáticamente desde el navegador."
        : "El cliente no tiene WhatsApp cargado — elegí el contacto a mano. No te olvides de adjuntar el PDF."
    );
  });
  document.getElementById("btn-email").addEventListener("click", () => abrirModalEmail(comprobante));
}

continuarBtn.addEventListener("click", async () => {
  errorEl.style.display = "none";

  const tipoEntrega = tipoEntregaSelect.value;
  if (tipoEntrega === "Envío a domicilio" && !domicilioEntregaInput.value.trim()) {
    errorEl.textContent = "Cargá el domicilio de entrega.";
    errorEl.style.display = "block";
    return;
  }

  const total = totalCarrito();
  const pagos = await pedirMedioPagoVenta(total, clienteSeleccionado);
  if (!pagos) return;

  continuarBtn.disabled = true;
  try {
    const datos = {
      fecha: new Date().toISOString().slice(0, 10),
      clienteId: clienteSeleccionado?.id || null,
      clienteNombre: clienteSeleccionado?.razonSocial || null,
      tipoEntrega,
      domicilioEntrega: domicilioEntregaInput.value.trim(),
      notaEntrega: notaEntregaInput.value.trim(),
      items: carrito.map((i) => ({
        productoId: i.productoId,
        productoSku: i.productoSku,
        productoDescripcion: i.productoDescripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        descuentoPct: i.descuentoPct || 0,
        iva: i.iva ?? 21,
        subtotal: subtotalItem(i),
      })),
      descuentoGlobal: 0,
      subtotal: total,
      total,
      pagos,
      // Solo se manda cuando el cajero tuvo que elegir entre 2+ cajas abiertas; con una sola (o
      // ninguna), crearVenta cae al criterio de siempre (ver routearPagoATesoreria en js/ventas.js).
      cajaSeleccionada: (() => {
        const select = document.getElementById("pos-caja");
        return select ? cajasAbiertas[Number(select.value)] : null;
      })(),
    };
    const resultado = await crearVenta(datos, usuario);

    // El comprobante se genera automáticamente al confirmar — nunca hay que volver a cargar
    // cliente/productos/pagos en otra pantalla (esa era la falla de arquitectura anterior).
    const comprobante = await crearComprobante(
      {
        ventaId: resultado.id,
        tipoComprobanteCodigo: document.getElementById("pos-tipo-comprobante").value,
        items: datos.items,
        descuentoGlobalPct: 0,
        cliente: clienteSeleccionado,
        formaPago: pagos.length > 1 ? "Varios medios" : pagos[0]?.medio || "Efectivo",
        pagos,
      },
      usuario
    );

    mostrarConfirmacion(resultado.numeroVenta, tipoEntrega, comprobante, resultado.routeoTesoreria);
  } catch (err) {
    // El pago con Mercado Pago ya se cobró de verdad ANTES de llegar acá (venta-pago-modal.js solo
    // resuelve con mpOrderId una vez que la terminal aprobó) — si crearVenta (o crearComprobante)
    // falla DESPUÉS de eso, hay plata cobrada y ninguna venta registrada. No se puede tratar como
    // un error cualquiera: nunca hay que dejar que el cajero piense "no pasó nada" y vuelva a
    // cobrarle al cliente. Por eso el aviso es bloqueante y el botón queda deshabilitado a
    // propósito — no se reactiva, la única salida es recargar la página.
    const pagoMp = pagos.find((p) => p.mpOrderId);
    if (pagoMp) {
      const mensaje = `El pago de Mercado Pago (orden ${pagoMp.mpOrderId}) fue APROBADO, pero la venta NO se pudo registrar en Delfino.\n\nNO vuelvas a cobrarle al cliente.\n\nContactá administración y pasales este número de orden:\n${pagoMp.mpOrderId}\n\nError técnico: ${err?.message || "desconocido"}`;
      alert(mensaje);
      errorEl.innerHTML = `
        <div style="border:2px solid var(--danger); border-radius:8px; padding:14px; text-align:left">
          <div style="font-weight:700; color:var(--danger); margin-bottom:6px">⚠️ Mercado Pago cobró, pero la venta no se registró</div>
          <div style="margin-bottom:6px">NO vuelvas a cobrarle al cliente. Contactá administración con este dato:</div>
          <div style="font-family:monospace; font-weight:700; user-select:all">Orden Mercado Pago: ${pagoMp.mpOrderId}</div>
          <div class="hint" style="margin-top:8px">Recargá la página para intentar otra venta — esta pantalla queda bloqueada a propósito.</div>
        </div>
      `;
      errorEl.style.display = "block";
      return; // continuarBtn se queda deshabilitado — no se reactiva
    }
    errorEl.textContent = err?.message || "Ocurrió un error al registrar la venta.";
    errorEl.style.display = "block";
    continuarBtn.disabled = false;
  }
});

pintarCarrito();
