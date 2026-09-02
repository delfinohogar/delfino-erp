// Modal de medio de pago al confirmar una venta: uno o varios medios cuya suma debe cubrir el total
// (mismo concepto que "Dividir entre varios medios" de La Pyme). "Pendiente de pago" (a cuenta
// corriente) solo aparece si hay un cliente elegido — no tiene sentido dejarle una deuda a
// "Consumidor final". Devuelve el array de pagos, o null si se cancela.
// Los medios disponibles salen de Configuración → Tesorería → Medios de pago — activar/desactivar
// uno ahí cambia lo que ve el vendedor acá, sin tocar código (ver js/medios-pago.js).
//
// Mercado Pago es un medio más de esta lista, con una particularidad: a diferencia de Efectivo o
// Transferencia (que el cajero solo declara), acá hace falta cobrar de verdad en la terminal ANTES
// de poder cerrar la venta — así que si hay una línea "Mercado Pago", confirmar no resuelve el
// modal al toque: primero corre el cobro real (ver iniciarCobroMercadoPago en mercado-pago.js) y
// recién si la terminal aprueba se resuelve con los pagos, listos para crearVenta. Todo pasa dentro
// de este mismo modal — no hay una pantalla aparte de "venta rápida con Point".
import { listarMediosPagoActivos, MEDIOS_DE_SISTEMA } from "./medios-pago.js";
import { obtenerConfigMercadoPago, iniciarCobroMercadoPago } from "./mercado-pago.js";

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
    overlay.innerHTML = `<div class="modal-card card" style="max-width:440px"></div>`;
    document.body.appendChild(overlay);
    const card = overlay.querySelector(".modal-card");

    // "normal" = armando las líneas de pago (vista de siempre). "cobro-mp" = esperando el resultado
    // real de la terminal para la línea de Mercado Pago. Esc/Enter globales solo actúan en "normal"
    // — durante un cobro en curso no tiene que haber ninguna forma "rápida" de cerrar el modal por
    // accidente, eso pasa exclusivamente por el botón "Cancelar cobro".
    let vista = "normal";

    function cerrar(resultado) {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(resultado);
    }

    function onKeydown(e) {
      if (vista !== "normal") return;
      if (e.key === "Escape") cerrar(null);
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        confirmarEl?.click();
      }
    }
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (e) => {
      if (vista === "normal" && e.target === overlay) cerrar(null);
    });

    let confirmarEl = null;

    // ---- Vista normal: armar las líneas de pago -------------------------------------------------
    function montarVistaNormal(pagosPrevios) {
      vista = "normal";
      card.innerHTML = `
        <div class="section-title">Confirmar venta${clienteSeleccionado ? ` a ${clienteSeleccionado.razonSocial}` : ""}</div>
        <div style="font-size:20px; font-weight:600; margin-bottom:14px">$${total.toLocaleString("es-AR")}</div>
        <div id="vp-lineas"></div>
        <button type="button" id="vp-agregar-medio" class="link-btn">+ Agregar otro medio de pago</button>
        <div id="vp-resto" style="font-size:14px; font-weight:600; margin:12px 0"></div>
        <div class="error-text" id="vp-error" style="display:none"></div>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="primary" id="vp-confirmar">Confirmar venta <span class="hint" style="margin:0; color:inherit; opacity:0.75">Enter</span></button>
          <button type="button" id="vp-cancelar">Cancelar <span class="hint mt-0">Esc</span></button>
        </div>
      `;

      const lineasEl = card.querySelector("#vp-lineas");
      const restoEl = card.querySelector("#vp-resto");
      const errorEl = card.querySelector("#vp-error");
      confirmarEl = card.querySelector("#vp-confirmar");

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

      if (pagosPrevios) {
        pagosPrevios.forEach((p) => agregarLinea(p.medio, p.monto));
      } else {
        agregarLinea(medios[0], total);
      }
      recalcular();

      card.querySelector("#vp-agregar-medio").addEventListener("click", () => {
        const restante = Math.max(Math.round((total - sumaActual()) * 100) / 100, 0);
        const medioUsado = lineasEl.querySelector("[data-role=medio]")?.value;
        agregarLinea(medios.find((m) => m !== medioUsado) || medios[0], restante);
        recalcular();
      });

      function confirmar() {
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

        // Por ahora se admite una sola línea de Mercado Pago por venta — cobrar dos terminales
        // distintas para una misma venta no aporta nada hoy y complica la máquina de estados sin
        // necesidad real. Si hace falta más adelante, se generaliza.
        const lineasMp = pagos.filter((p) => p.medio === "Mercado Pago");
        if (lineasMp.length > 1) {
          errorEl.textContent = "Por ahora se admite una sola línea de Mercado Pago por venta — unificalas en una sola.";
          errorEl.style.display = "block";
          return;
        }

        if (lineasMp.length === 1) {
          iniciarFlujoMp(pagos, lineasMp[0]);
          return;
        }

        cerrar(pagos);
      }

      card.querySelector("#vp-cancelar").addEventListener("click", () => cerrar(null));
      confirmarEl.addEventListener("click", confirmar);
    }

    // ---- Vista de cobro con Mercado Pago ----------------------------------------------------------
    async function iniciarFlujoMp(pagos, lineaMp) {
      const config = await obtenerConfigMercadoPago();
      if (!config.terminalId) {
        montarVistaNormal(pagos);
        const errorEl = card.querySelector("#vp-error");
        errorEl.textContent = "Mercado Pago no tiene un terminal configurado — pedile a un administrador que lo cargue en Configuración → Mercado Pago.";
        errorEl.style.display = "block";
        return;
      }
      correrCobro(pagos, lineaMp, config.terminalId);
    }

    function correrCobro(pagos, lineaMp, terminalId) {
      vista = "cobro-mp";
      const maquina = iniciarCobroMercadoPago({ terminalId, monto: lineaMp.monto });

      function pintar(estado) {
        if (estado === "CREANDO") {
          card.innerHTML = `
            <div class="section-title">Cobrando con Mercado Pago</div>
            <div style="text-align:center; padding:24px 0">
              <div class="hint">Creando la orden…</div>
            </div>
          `;
        } else if (estado === "ESPERANDO") {
          card.innerHTML = `
            <div class="section-title">Cobrando con Mercado Pago</div>
            <div style="text-align:center; padding:24px 0">
              <div style="font-size:20px; font-weight:600; margin-bottom:8px">$${lineaMp.monto.toLocaleString("es-AR")}</div>
              <div class="hint" style="margin-bottom:16px">⏳ Esperando el pago en la terminal…</div>
              <div class="hint">Acercá o insertá la tarjeta en el Point.</div>
            </div>
            <div class="toolbar" style="justify-content:center">
              <button type="button" id="mp-cancelar-cobro">Cancelar cobro</button>
            </div>
          `;
          card.querySelector("#mp-cancelar-cobro").addEventListener("click", async (e) => {
            e.target.disabled = true;
            e.target.textContent = "Cancelando…";
            await maquina.cancelar();
            // Si para cuando terminó de cancelar la orden ya estaba aprobada, pintar("APROBADO") ya
            // se disparó solo (ver onCambio) y este código ya no tiene nada que hacer acá.
          });
        } else if (estado === "APROBADO") {
          // No hay ningún botón para "seguir después" acá a propósito: una vez aprobado, el cobro
          // ya es real y la venta se tiene que crear sí o sí — no puede quedar a criterio del
          // cajero abandonar la pantalla con la plata ya cobrada y la venta sin registrar.
          card.innerHTML = `
            <div class="section-title">Cobrando con Mercado Pago</div>
            <div style="text-align:center; padding:24px 0">
              <div style="font-size:32px; color:var(--success)">✓</div>
              <div style="font-weight:600; margin:8px 0">Pago aprobado</div>
              <div class="hint">Registrando la venta…</div>
            </div>
          `;
          const pagosFinal = pagos.map((p) => (p === lineaMp ? { ...p, mpOrderId: maquina.orderId } : p));
          cerrar(pagosFinal);
        } else if (estado === "RECHAZADO") {
          card.innerHTML = `
            <div class="section-title">Cobrando con Mercado Pago</div>
            <div style="text-align:center; padding:24px 0">
              <div style="font-size:32px; color:var(--danger)">✕</div>
              <div style="font-weight:600; margin:8px 0; color:var(--danger)">El pago fue rechazado</div>
            </div>
            <div class="toolbar" style="justify-content:center">
              <button type="button" class="primary" id="mp-reintentar">Reintentar</button>
              <button type="button" id="mp-cambiar-medio">Cambiar medio de pago</button>
            </div>
          `;
          card.querySelector("#mp-reintentar").addEventListener("click", () => correrCobro(pagos, lineaMp, terminalId));
          card.querySelector("#mp-cambiar-medio").addEventListener("click", () => montarVistaNormal(pagos));
        } else if (estado === "CANCELADO") {
          card.innerHTML = `
            <div class="section-title">Cobrando con Mercado Pago</div>
            <div style="text-align:center; padding:24px 0">
              <div style="font-weight:600; margin:8px 0">Cobro cancelado</div>
              <div class="hint">No se registró ningún pago.</div>
            </div>
            <div class="toolbar" style="justify-content:center">
              <button type="button" class="primary" id="mp-volver">Volver</button>
            </div>
          `;
          card.querySelector("#mp-volver").addEventListener("click", () => montarVistaNormal(pagos));
        }
      }

      maquina.onCambio((estado) => pintar(estado));
      pintar("CREANDO");
      maquina.iniciar().catch(() => {
        // El error ya movió a maquina.estado = "RECHAZADO" adentro de iniciarCobroMercadoPago
        // (no se pudo ni crear la orden) — onCambio ya disparó pintar("RECHAZADO"), nada más que
        // hacer acá salvo no dejar una excepción sin atrapar.
      });
    }

    montarVistaNormal(null);
  });
}
