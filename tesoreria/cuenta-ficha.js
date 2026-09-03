import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerCuentaBancaria, listarMovimientosPorCuenta, saldoCuenta, registrarMovimientoBancario, conciliarMovimientoBancario } from "/js/bancos.js";
import { crearChequera, listarChequerasPorCuenta, actualizarChequera, numerosDisponibles } from "/js/chequeras.js";
import { emitirCheque, efectivizarCheque, anularCheque, listarChequesPorCuenta, saldoProyectado } from "/js/cheques.js";
import { formatMoneda as formatMonto, formatFecha } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const cuentaId = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "tesoreria-bancos", titulo: "Cuenta bancaria", usuario });

if (!cuentaId) {
  content.innerHTML = `<div class="empty-state">Falta la cuenta.</div>`;
  throw new Error("falta id de cuenta");
}
const cuenta = await obtenerCuentaBancaria(cuentaId);
if (!cuenta) {
  content.innerHTML = `<div class="empty-state">No se encontró esa cuenta. <a href="/tesoreria/bancos.html">Volver a Bancos</a></div>`;
  throw new Error("cuenta no encontrada");
}

function badgeEstadoCheque(estado) {
  if (estado === "efectivizado") return '<span class="badge success">Efectivizado</span>';
  if (estado === "anulado") return '<span class="badge danger">Anulado</span>';
  return '<span class="badge warning">Pendiente</span>';
}

async function pintar() {
  const [movimientos, chequeras, cheques] = await Promise.all([listarMovimientosPorCuenta(cuentaId), listarChequerasPorCuenta(cuentaId), listarChequesPorCuenta(cuentaId)]);
  const saldo = saldoCuenta(movimientos);
  const pendientes = movimientos.filter((m) => m.estado === "pendiente").length;
  const chequesPendientes = cheques.filter((c) => c.estado === "pendiente");
  const saldoProy = saldoProyectado(saldo, chequesPendientes);
  const chequerasConNumeros = chequeras.filter((ch) => ch.activa !== false && numerosDisponibles(ch) > 0);

  content.innerHTML = `
    <div class="toolbar">
      <a href="/tesoreria/bancos.html" class="link-btn">← Bancos</a>
      <button type="button" id="btn-movimiento">+ Registrar movimiento</button>
    </div>

    <div class="card mb-16">
      <div style="font-size:20px; font-weight:700">${cuenta.bancoNombre} — ${cuenta.nombre}</div>
      <div class="hint">${cuenta.alias || ""} ${cuenta.cbu ? `· CBU ${cuenta.cbu}` : ""} ${cuenta.sucursalNombre ? `· ${cuenta.sucursalNombre}` : ""}</div>
      <div style="font-size:26px; font-weight:700; margin-top:12px">${formatMonto(saldo)}</div>
      ${chequesPendientes.length > 0 ? `<div class="hint">Saldo proyectado (con ${chequesPendientes.length} cheque(s) pendiente(s)): <strong style="color:var(--foreground)">${formatMonto(saldoProy)}</strong></div>` : ""}
      ${pendientes > 0 ? `<div class="hint" style="color:var(--warning)">${pendientes} movimiento(s) sin conciliar</div>` : ""}
    </div>

    <div class="card mb-16">
      <div class="toolbar" style="margin-bottom:8px">
        <div class="section-title" style="margin:0">Chequeras</div>
        ${usuario.rol === "administrador" ? '<button type="button" id="btn-chequera">+ Nueva chequera</button>' : ""}
      </div>
      ${
        chequeras.length === 0
          ? '<div class="hint">Todavía no hay chequeras cargadas para esta cuenta.</div>'
          : `<div class="table-scroll"><table>
              <thead><tr><th>Rango</th><th>Próximo N°</th><th class="num">Disponibles</th><th>Estado</th>${usuario.rol === "administrador" ? "<th></th>" : ""}</tr></thead>
              <tbody>
                ${chequeras
                  .map(
                    (ch) => `
                  <tr>
                    <td>${ch.numeroDesde} – ${ch.numeroHasta}</td>
                    <td>${ch.proximoNumero > ch.numeroHasta ? "-" : ch.proximoNumero}</td>
                    <td class="num">${numerosDisponibles(ch)}</td>
                    <td>${ch.activa !== false ? '<span class="badge success">Activa</span>' : '<span class="badge muted">Inactiva</span>'}</td>
                    ${usuario.rol === "administrador" ? `<td><button type="button" data-toggle-chequera="${ch.id}" data-activa="${ch.activa !== false}">${ch.activa !== false ? "Desactivar" : "Activar"}</button></td>` : ""}
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table></div>`
      }
    </div>

    <div class="card mb-16">
      <div class="toolbar" style="margin-bottom:8px">
        <div class="section-title" style="margin:0">Cheques</div>
        <button type="button" id="btn-emitir-cheque" ${chequerasConNumeros.length === 0 ? "disabled title='Cargá una chequera con números disponibles primero'" : ""}>+ Emitir cheque</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>N°</th><th>Beneficiario</th><th>Concepto</th><th>Emisión</th><th>Pago</th><th class="num">Importe</th><th>Estado</th><th></th></tr></thead>
          <tbody id="cheques-body"></tbody>
        </table>
      </div>
      <div id="cheques-empty" class="empty-state" style="display:${cheques.length === 0 ? "block" : "none"}">Todavía no se emitieron cheques desde esta cuenta.</div>
    </div>

    <div class="card">
      <div class="table-scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th class="num">Importe</th><th>Estado</th><th></th></tr></thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
      <div id="empty-state" class="empty-state" style="display:none">Todavía no hay movimientos.</div>
    </div>
  `;

  const tbody = document.getElementById("tabla-body");
  document.getElementById("empty-state").style.display = movimientos.length === 0 ? "block" : "none";
  tbody.innerHTML = movimientos
    .slice()
    .reverse()
    .map(
      (m) => `
    <tr style="${m.estado === "anulado" ? "opacity:0.5; text-decoration:line-through" : ""}">
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.tipo === "ingreso" ? "🟢" : "🔴"} ${m.concepto}${m.ventaId ? ` · <a href="/productos/venta-ficha.html?id=${m.ventaId}">Ver venta</a>` : ""}</td>
      <td>${m.referencia || "-"}</td>
      <td class="num">${m.tipo === "ingreso" ? "" : "-"}${formatMonto(m.importe)}</td>
      <td>${m.estado === "conciliado" ? '<span class="badge success">Conciliado</span>' : m.estado === "anulado" ? '<span class="badge danger">Anulado</span>' : '<span class="badge warning">Pendiente</span>'}</td>
      <td>${m.estado === "pendiente" ? `<button type="button" data-conciliar="${m.id}">✅ Conciliar</button>` : ""}</td>
    </tr>
  `
    )
    .join("");

  tbody.querySelectorAll("[data-conciliar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await conciliarMovimientoBancario(btn.dataset.conciliar, usuario);
      pintar();
    });
  });

  const chequesBody = document.getElementById("cheques-body");
  chequesBody.innerHTML = cheques
    .slice()
    .reverse()
    .map(
      (c) => `
    <tr style="${c.estado === "anulado" ? "opacity:0.5; text-decoration:line-through" : ""}">
      <td>${c.numeroCheque}</td>
      <td>${c.beneficiario}</td>
      <td>${c.concepto || "-"}</td>
      <td>${formatFecha(c.fechaEmision)}</td>
      <td>${formatFecha(c.fechaPago)}</td>
      <td class="num">${formatMonto(c.importe)}</td>
      <td>${badgeEstadoCheque(c.estado)}</td>
      <td>
        ${c.estado === "pendiente" ? `<button type="button" data-efectivizar="${c.id}">✅ Efectivizar</button>` : ""}
        ${c.estado === "pendiente" && usuario.rol === "administrador" ? `<button type="button" data-anular-cheque="${c.id}">Anular</button>` : ""}
      </td>
    </tr>
  `
    )
    .join("");

  chequesBody.querySelectorAll("[data-efectivizar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Confirmás que el banco ya debitó este cheque? Se va a registrar el movimiento bancario real.")) return;
      try {
        await efectivizarCheque(btn.dataset.efectivizar, usuario);
        pintar();
      } catch (err) {
        alert(err?.message || "No se pudo efectivizar el cheque.");
      }
    });
  });
  chequesBody.querySelectorAll("[data-anular-cheque]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const motivo = prompt("Motivo de la anulación (opcional):") || "";
      try {
        await anularCheque(btn.dataset.anularCheque, motivo, usuario);
        pintar();
      } catch (err) {
        alert(err?.message || "No se pudo anular el cheque.");
      }
    });
  });

  document.getElementById("btn-movimiento").addEventListener("click", () => abrirModalMovimiento());
  document.getElementById("btn-emitir-cheque").addEventListener("click", () => abrirModalEmitirCheque(chequerasConNumeros));
  document.getElementById("btn-chequera")?.addEventListener("click", () => abrirModalChequera());
  content.querySelectorAll("[data-toggle-chequera]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await actualizarChequera(btn.dataset.toggleChequera, { activa: btn.dataset.activa !== "true" });
      pintar();
    });
  });
}

function abrirModalMovimiento() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Registrar movimiento bancario</div>
      <form id="form-mov">
        <div class="field">
          <label for="m-tipo">Tipo</label>
          <select id="m-tipo"><option value="ingreso">🟢 Ingreso</option><option value="egreso">🔴 Egreso</option></select>
        </div>
        <div class="field">
          <label for="m-concepto">Concepto</label>
          <input type="text" id="m-concepto" placeholder="Ej. Depósito, comisión, débito automático…" required />
        </div>
        <div class="field-row">
          <div class="field"><label for="m-importe">Importe</label><input type="number" id="m-importe" min="0.01" step="0.01" required /></div>
          <div class="field"><label for="m-fecha">Fecha</label><input type="date" id="m-fecha" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        </div>
        <div class="field">
          <label for="m-referencia">Referencia (opcional)</label>
          <input type="text" id="m-referencia" />
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Registrar</button>
          <button type="button" id="m-cancelar">Cancelar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#m-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-mov").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await registrarMovimientoBancario(
        {
          cuentaId,
          tipo: overlay.querySelector("#m-tipo").value,
          concepto: overlay.querySelector("#m-concepto").value.trim(),
          importe: parseFloat(overlay.querySelector("#m-importe").value),
          fecha: overlay.querySelector("#m-fecha").value,
          referencia: overlay.querySelector("#m-referencia").value.trim(),
        },
        usuario
      );
      overlay.remove();
      pintar();
    } catch (err) {
      alert(err?.message || "No se pudo registrar el movimiento.");
    }
  });
}

function abrirModalChequera() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Nueva chequera</div>
      <div class="hint" style="margin-bottom:10px">Cargá el rango de números que te asignó el banco para esta cuenta.</div>
      <form id="form-chequera">
        <div class="field-row">
          <div class="field"><label for="ch-desde">Número desde</label><input type="number" id="ch-desde" min="1" step="1" required /></div>
          <div class="field"><label for="ch-hasta">Número hasta</label><input type="number" id="ch-hasta" min="1" step="1" required /></div>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Crear</button>
          <button type="button" id="ch-cancelar">Cancelar</button>
        </div>
        <div class="error-text" id="ch-error" style="display:none"></div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#ch-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-chequera").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector("#ch-error");
    errorEl.style.display = "none";
    try {
      await crearChequera(
        {
          cuentaBancariaId: cuentaId,
          cuentaBancariaNombre: cuenta.nombre,
          bancoNombre: cuenta.bancoNombre,
          numeroDesde: parseInt(overlay.querySelector("#ch-desde").value, 10),
          numeroHasta: parseInt(overlay.querySelector("#ch-hasta").value, 10),
        },
        usuario
      );
      overlay.remove();
      pintar();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo crear la chequera.";
      errorEl.style.display = "block";
    }
  });
}

function abrirModalEmitirCheque(chequerasDisponibles) {
  if (chequerasDisponibles.length === 0) {
    alert("No hay chequeras activas con números disponibles. Cargá una arriba.");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Emitir cheque</div>
      <form id="form-cheque">
        <div class="field">
          <label for="cq-chequera">Chequera</label>
          <select id="cq-chequera">
            ${chequerasDisponibles.map((ch) => `<option value="${ch.id}">N° ${ch.proximoNumero} (rango ${ch.numeroDesde}–${ch.numeroHasta})</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="cq-beneficiario">Beneficiario</label>
          <input type="text" id="cq-beneficiario" required />
        </div>
        <div class="field">
          <label for="cq-concepto">Concepto (opcional)</label>
          <input type="text" id="cq-concepto" />
        </div>
        <div class="field-row">
          <div class="field"><label for="cq-importe">Importe</label><input type="number" id="cq-importe" min="0.01" step="0.01" required /></div>
          <div class="field"><label for="cq-fecha-pago">Fecha de pago</label><input type="date" id="cq-fecha-pago" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        </div>
        <div class="hint">Si la fecha de pago es hoy o anterior, el cheque se efectiviza en el momento. Si es futura, queda pendiente y se descuenta del saldo proyectado hasta que se efectivice.</div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Emitir</button>
          <button type="button" id="cq-cancelar">Cancelar</button>
        </div>
        <div class="error-text" id="cq-error" style="display:none"></div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#cq-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-cheque").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector("#cq-error");
    errorEl.style.display = "none";
    try {
      const resultado = await emitirCheque(
        {
          chequeraId: overlay.querySelector("#cq-chequera").value,
          beneficiario: overlay.querySelector("#cq-beneficiario").value,
          concepto: overlay.querySelector("#cq-concepto").value,
          importe: parseFloat(overlay.querySelector("#cq-importe").value),
          fechaPago: overlay.querySelector("#cq-fecha-pago").value,
        },
        usuario
      );
      overlay.remove();
      alert(`Cheque N° ${resultado.numeroCheque} emitido (${resultado.estado === "efectivizado" ? "efectivizado ya" : "pendiente"}).`);
      pintar();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo emitir el cheque.";
      errorEl.style.display = "block";
    }
  });
}

pintar();
