// Modal de medio de pago al confirmar una venta: uno o varios medios cuya suma debe cubrir el total
// (mismo concepto que "Dividir entre varios medios" de La Pyme). "Pendiente de pago" (a cuenta
// corriente) solo aparece si hay un cliente elegido — no tiene sentido dejarle una deuda a
// "Consumidor final". Devuelve el array de pagos, o null si se cancela.
// Los medios disponibles salen de Configuración → Tesorería → Medios de pago — activar/desactivar
// uno ahí cambia lo que ve el vendedor acá, sin tocar código (ver js/medios-pago.js).
import { listarMediosPagoActivos, MEDIOS_DE_SISTEMA } from "./medios-pago.js";

export async function pedirMedioPagoVenta(total, clienteSeleccionado) {
  const mediosActivos = await listarMediosPagoActivos();
  // Antes de que un administrador entre a Configuración → Medios de pago por primera vez (lo que
  // siembra la colección real), un vendedor tiene que poder vender igual — cae a la misma lista de
  // siempre en memoria, sin escribir nada (sembrar la colección es admin-only, ver firestore.rules).
  const nombres = mediosActivos.length > 0 ? mediosActivos.map((m) => m.nombre) : MEDIOS_DE_SISTEMA.map((m) => m.nombre);
  return new Promise((resolve) => {
    const medios = [...nombres, ...(clienteSeleccionado ? ["Pendiente de pago"] : [])];

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card card" style="max-width:440px">
        <div class="section-title">Confirmar venta${clienteSeleccionado ? ` a ${clienteSeleccionado.razonSocial}` : ""}</div>
        <div style="font-size:20px; font-weight:600; margin-bottom:14px">$${total.toLocaleString("es-AR")}</div>
        <div id="vp-lineas"></div>
        <button type="button" id="vp-agregar-medio" class="link-btn">+ Agregar otro medio de pago</button>
        <div id="vp-resto" style="font-size:14px; font-weight:600; margin:12px 0"></div>
        <div class="error-text" id="vp-error" style="display:none"></div>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="primary" id="vp-confirmar">Confirmar venta</button>
          <button type="button" id="vp-cancelar">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const lineasEl = overlay.querySelector("#vp-lineas");
    const restoEl = overlay.querySelector("#vp-resto");
    const errorEl = overlay.querySelector("#vp-error");

    function sumaActual() {
      return Array.from(lineasEl.querySelectorAll("[data-role=linea]")).reduce(
        (acc, l) => acc + (parseFloat(l.querySelector("[data-role=monto]").value) || 0),
        0
      );
    }

    function recalcular() {
      const resto = Math.round((total - sumaActual()) * 100) / 100;
      if (resto > 0) {
        restoEl.textContent = `Falta cubrir: $${resto.toLocaleString("es-AR")}`;
        restoEl.style.color = "var(--foreground)";
      } else if (resto < 0) {
        restoEl.textContent = `Vuelto: $${Math.abs(resto).toLocaleString("es-AR")}`;
        restoEl.style.color = "var(--warning)";
      } else {
        restoEl.textContent = "Cubre el total ✓";
        restoEl.style.color = "var(--success)";
      }
      const quitarBotones = lineasEl.querySelectorAll("[data-role=quitar]");
      quitarBotones.forEach((b) => (b.disabled = quitarBotones.length <= 1));
    }

    function agregarLinea(medioDefault, montoDefault) {
      const div = document.createElement("div");
      div.className = "field-row";
      div.dataset.role = "linea";
      div.style.alignItems = "end";
      div.innerHTML = `
        <div class="field" style="margin-bottom:8px">
          <label>Medio</label>
          <select data-role="medio">
            ${medios.map((m) => `<option ${m === medioDefault ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="margin-bottom:8px">
          <label>Monto</label>
          <input type="number" data-role="monto" step="0.01" min="0" value="${montoDefault}" />
        </div>
        <button type="button" data-role="quitar" style="margin-bottom:14px">✕</button>
      `;
      lineasEl.appendChild(div);
      div.querySelector("[data-role=monto]").addEventListener("input", recalcular);
      div.querySelector("[data-role=quitar]").addEventListener("click", () => {
        div.remove();
        recalcular();
      });
    }

    agregarLinea(medios[0], total);
    recalcular();

    overlay.querySelector("#vp-agregar-medio").addEventListener("click", () => {
      const restante = Math.max(Math.round((total - sumaActual()) * 100) / 100, 0);
      const medioUsado = lineasEl.querySelector("[data-role=medio]")?.value;
      agregarLinea(medios.find((m) => m !== medioUsado) || medios[0], restante);
      recalcular();
    });

    function cerrar(resultado) {
      overlay.remove();
      resolve(resultado);
    }

    overlay.querySelector("#vp-cancelar").addEventListener("click", () => cerrar(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cerrar(null);
    });

    overlay.querySelector("#vp-confirmar").addEventListener("click", () => {
      errorEl.style.display = "none";
      const pagos = Array.from(lineasEl.querySelectorAll("[data-role=linea]"))
        .map((l) => ({
          medio: l.querySelector("[data-role=medio]").value,
          monto: parseFloat(l.querySelector("[data-role=monto]").value) || 0,
        }))
        .filter((p) => p.monto > 0);

      if (pagos.length === 0) {
        errorEl.textContent = "Agregá al menos un medio de pago.";
        errorEl.style.display = "block";
        return;
      }
      const suma = pagos.reduce((acc, p) => acc + p.monto, 0);
      if (Math.abs(suma - total) > 0.5) {
        errorEl.textContent = `La suma de los medios de pago ($${suma.toLocaleString("es-AR")}) no coincide con el total ($${total.toLocaleString("es-AR")}).`;
        errorEl.style.display = "block";
        return;
      }
      cerrar(pagos);
    });
  });
}
