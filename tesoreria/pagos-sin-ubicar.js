import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarVentasConPagoSinUbicar } from "/js/ventas.js";
import { listarCobrosConPagoSinUbicar } from "/js/cobros.js";
import { marcarPagoSinUbicarResuelto, mapaResolucionesPagoSinUbicar } from "/js/resoluciones-pago-sin-ubicar.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-dashboard", titulo: "Pagos sin ubicar", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

content.innerHTML = `<div class="hint">Cargando…</div>`;

// Se junta ventas (pago al confirmar) y cobros manuales (contra una cuenta corriente) en una sola
// lista — para Tesorería es el mismo problema: plata que se cobró pero que el sistema no supo dónde
// poner (caja cerrada, medio sin destino configurado en Configuración → Medios de pago, etc.).
async function cargar() {
  const [ventas, cobros, resoluciones] = await Promise.all([
    listarVentasConPagoSinUbicar(),
    listarCobrosConPagoSinUbicar(),
    mapaResolucionesPagoSinUbicar(),
  ]);

  const items = [
    ...ventas.map((v) => ({
      origenTipo: "venta",
      origenId: v.id,
      titulo: `Venta #${v.numeroVenta}`,
      href: `/productos/venta-ficha.html?id=${v.id}`,
      cliente: v.clienteNombre,
      sucursal: v.sucursalNombre,
      fecha: v.creadoEn,
      pagosSinRutear: (v.routeoTesoreria || []).filter((r) => !r.ruteado),
    })),
    ...cobros.map((c) => ({
      origenTipo: "cobro",
      origenId: c.id,
      titulo: `Cobro — Venta #${c.numeroVenta}`,
      href: `/productos/venta-ficha.html?id=${c.ventaId}`,
      cliente: c.clienteNombre,
      sucursal: null,
      fecha: c.creadoEn,
      pagosSinRutear: c.routeoTesoreria?.ruteado ? [] : [{ medio: c.medioPago, monto: c.monto, motivo: c.routeoTesoreria?.motivo }],
    })),
  ].sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));

  if (items.length === 0) {
    content.innerHTML = `<div class="card" style="padding:20px"><div class="hint">No hay pagos sin ubicar. 🟢</div></div>`;
    return;
  }

  content.innerHTML = `
    <div class="hint" style="margin-bottom:16px">
      Ventas y cobros donde Tesorería no pudo ubicar la plata sola (caja cerrada, medio sin destino
      configurado, etc.) — la venta/el cobro quedaron registrados igual, esto es solo para llevar
      registro de que alguien lo revisó y ubicó la plata a mano.
    </div>
    <div id="lista"></div>
  `;
  const lista = document.getElementById("lista");

  items.forEach((item) => {
    const resolucion = resoluciones.get(`${item.origenTipo}_${item.origenId}`);
    const div = document.createElement("div");
    div.className = "card";
    div.style.padding = "16px 20px";
    div.style.marginBottom = "12px";
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:start; gap:12px; flex-wrap:wrap">
        <div>
          <div style="font-weight:600"><a href="${item.href}">${item.titulo}</a> ${resolucion ? '<span class="badge success">Resuelto</span>' : '<span class="badge warning">Sin resolver</span>'}</div>
          <div class="hint">${item.cliente || "Consumidor final"}${item.sucursal ? " · " + item.sucursal : ""} · ${formatFechaHora(item.fecha)}</div>
          ${item.pagosSinRutear.map((r) => `<div class="hint">— ${r.medio} (${formatMonto(r.monto)}): ${r.motivo || "sin motivo registrado"}</div>`).join("")}
        </div>
        <div style="min-width:220px; text-align:right">
          ${
            resolucion
              ? `<div class="hint">Por ${resolucion.resueltoPorNombre}, ${formatFechaHora(resolucion.resueltoEn)}${resolucion.nota ? ` — "${resolucion.nota}"` : ""}</div>`
              : `<button type="button" data-role="resolver">Marcar resuelto</button>`
          }
        </div>
      </div>
    `;
    const btn = div.querySelector("[data-role=resolver]");
    if (btn) {
      btn.addEventListener("click", async () => {
        const nota = prompt("¿Cómo se ubicó esta plata? (opcional, queda como nota)") || "";
        btn.disabled = true;
        await marcarPagoSinUbicarResuelto({ origenTipo: item.origenTipo, origenId: item.origenId, nota }, usuario);
        cargar();
      });
    }
    lista.appendChild(div);
  });
}

cargar();
