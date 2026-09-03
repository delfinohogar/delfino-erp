// Modal de detalle de una factura de GBP — qué artículos incluye (SKU, cantidad, precio) y botón
// para descargar el PDF. Compartido entre Facturas GBP y el historial de Cuenta Corriente de
// Clientes, para no duplicar el mismo modal en las dos pantallas (mismo patrón que cliente-modal.js).
import { formatMoneda, formatFecha } from "./formato.js";
import { descargarPdfFacturaGbp } from "./facturas-gbp-pdf.js";
import { db, doc, getDoc } from "./firebase.js";

function comprobanteTexto(f) {
  const numeroFmt = String(f.numero ?? "").padStart(8, "0");
  return `${f.letra || ""} ${String(f.puntoVenta ?? "").padStart(4, "0")}-${numeroFmt}`.trim();
}

// cliente: opcional — si quien llama ya tiene el cliente de Delfino a mano (ej. Cuenta Corriente),
// se lo pasa para no volver a buscarlo; si no, se resuelve acá mismo a partir de f.clienteId.
export function mostrarDetalleFacturaGbp(f, configEmpresa, cliente = undefined) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:640px">
      <div class="section-title">Factura ${comprobanteTexto(f)}</div>
      <div class="hint" style="margin-bottom:12px">
        ${formatFecha(f.fecha)} · Cliente GBP #${f.clienteIdExterno || "-"} · CAE ${f.cae || "-"}
        ${f.anulada ? ' · <span style="color:var(--danger)">Anulada</span>' : ""}
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>SKU</th><th>Producto</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${(f.lineas || [])
              .map(
                (l) => `
              <tr>
                <td>${l.sku || l.itemIdExterno}</td>
                <td>${l.descripcion || "(sin vincular en Delfino)"}</td>
                <td>${l.cantidad}</td>
                <td>${formatMoneda(l.precioUnitario)}</td>
                <td>${formatMoneda(l.cantidad * l.precioUnitario)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="toolbar" style="margin-top:14px; justify-content:flex-end">
        <button type="button" id="btn-pdf-detalle">📄 Descargar PDF</button>
        <button type="button" id="btn-cerrar-detalle">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const cerrar = () => overlay.remove();
  overlay.querySelector("#btn-cerrar-detalle").addEventListener("click", cerrar);
  overlay.addEventListener("click", (e) => e.target === overlay && cerrar());
  overlay.querySelector("#btn-pdf-detalle").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      let clienteFinal = cliente;
      if (clienteFinal === undefined) {
        const clienteSnap = f.clienteId ? await getDoc(doc(db, "clientes", f.clienteId)) : null;
        clienteFinal = clienteSnap?.exists() ? clienteSnap.data() : null;
      }
      await descargarPdfFacturaGbp(f, configEmpresa, clienteFinal);
    } finally {
      btn.disabled = false;
    }
  });
}
