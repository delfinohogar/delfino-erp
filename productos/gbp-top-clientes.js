// Ranking de clientes por lo comprado en GBP (histórico importado) — de qué SKU compró cada uno,
// cuánto y cuántas veces. Solo lectura, no cruza con Cuenta Corriente de Delfino (ver Facturas GBP
// para el porqué). Se arma en memoria a partir de facturasGbp — con los volúmenes de hoy (miles de
// facturas, no millones) no hace falta agregarlo del lado del servidor.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarFacturasGbp, listarClientesGbpLiviano } from "/js/gbp-facturas.js";
import { listarClientesTodos } from "/js/clientes.js";
import { formatMoneda } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "gbp-top-clientes", titulo: "Top Clientes GBP", usuario });

content.innerHTML = `
  <div class="card mb-16" style="padding:16px 20px">
    <div class="hint" style="max-width:64ch; margin:0">
      Ranking de clientes según lo facturado en GBP (los últimos 90 días sincronizados por ahora — ver
      Facturas GBP para traer más historial). Click en un cliente para ver qué le vendiste.
    </div>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>#</th>
            <th>Cliente</th>
            <th>Total comprado</th>
            <th>Facturas</th>
            <th>Artículos distintos</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay facturas sincronizadas.</div>
  </div>
`;

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

function abrirDetalleCliente(fila) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:640px">
      <div class="section-title">${fila.nombre}</div>
      <div class="hint" style="margin-bottom:12px">
        ${fila.cantFacturas} factura${fila.cantFacturas === 1 ? "" : "s"} · Total ${formatMoneda(fila.total)}
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Cant. comprada</th><th>Total gastado</th></tr></thead>
          <tbody>
            ${fila.productos
              .map(
                (p) => `
              <tr>
                <td>${p.sku}</td>
                <td>${p.descripcion || "(sin vincular en Delfino)"}</td>
                <td>${p.cantidad}</td>
                <td>${formatMoneda(p.importe)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="toolbar" style="margin-top:14px; justify-content:flex-end">
        <button type="button" id="btn-cerrar-detalle">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const cerrar = () => overlay.remove();
  overlay.querySelector("#btn-cerrar-detalle").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => e.target === overlay && cerrar());
}

async function cargar() {
  const [facturas, clientesGbpLivianos, clientesDelfino] = await Promise.all([
    listarFacturasGbp(),
    listarClientesGbpLiviano(),
    listarClientesTodos(),
  ]);

  const nombrePorIdExterno = new Map();
  clientesGbpLivianos.forEach((c) => nombrePorIdExterno.set(c.id, c.nombre));
  // Los clientes reales de Delfino pisan a la ficha liviana si por algún motivo hay las dos —
  // es el nombre en el que más se puede confiar (cargado/corregido a mano en Delfino).
  clientesDelfino.forEach((c) => {
    if (c.identificadorExterno) nombrePorIdExterno.set(String(c.identificadorExterno), c.razonSocial);
  });

  const porCliente = new Map();
  facturas.forEach((f) => {
    if (!f.clienteIdExterno || f.anulada) return;
    if (!porCliente.has(f.clienteIdExterno)) {
      porCliente.set(f.clienteIdExterno, { total: 0, cantFacturas: 0, productos: new Map() });
    }
    const entry = porCliente.get(f.clienteIdExterno);
    entry.total += f.total || 0;
    entry.cantFacturas += 1;
    (f.lineas || []).forEach((l) => {
      const skuKey = l.sku || l.itemIdExterno || "-";
      if (!entry.productos.has(skuKey)) entry.productos.set(skuKey, { sku: skuKey, descripcion: l.descripcion, cantidad: 0, importe: 0 });
      const p = entry.productos.get(skuKey);
      p.cantidad += l.cantidad;
      p.importe += l.cantidad * l.precioUnitario;
    });
  });

  const ranking = Array.from(porCliente.entries())
    .map(([clienteIdExterno, v]) => ({
      clienteIdExterno,
      nombre: nombrePorIdExterno.get(clienteIdExterno) || `Cliente GBP #${clienteIdExterno}`,
      total: v.total,
      cantFacturas: v.cantFacturas,
      productos: Array.from(v.productos.values()).sort((a, b) => b.importe - a.importe),
    }))
    .sort((a, b) => b.total - a.total);

  emptyState.style.display = ranking.length === 0 ? "block" : "none";
  tablaBody.innerHTML = "";
  ranking.forEach((fila, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${fila.nombre}</td>
      <td>${formatMoneda(fila.total)}</td>
      <td>${fila.cantFacturas}</td>
      <td>${fila.productos.length}</td>
    `;
    tr.addEventListener("click", () => abrirDetalleCliente(fila));
    tablaBody.appendChild(tr);
  });
}

cargar();
