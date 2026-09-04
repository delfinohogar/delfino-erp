import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { registrarGasto, listarGastos, categoriasUsadas, anularGasto } from "/js/gastos.js";
import { listarCajas, sesionAbiertaDeCaja } from "/js/cajas.js";
import { listarCuentasBancariasActivas } from "/js/bancos.js";
import { listarSucursalesActivas } from "/js/sucursales.js";
import { formatMoneda as formatMonto } from "/js/formato.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-gastos", titulo: "Gastos", usuario });

function formatFecha(fecha) {
  if (!fecha) return "-";
  return new Date(fecha).toLocaleDateString("es-AR");
}

const HOY = new Date().toISOString().slice(0, 10);
const INICIO_MES = HOY.slice(0, 8) + "01";

content.innerHTML = `
  <div class="toolbar">
    <a href="/tesoreria/dashboard.html" class="link-btn">← Tesorería</a>
    <button type="button" id="btn-nuevo" class="primary">+ Registrar gasto</button>
  </div>
  <div class="card mb-16">
    <div class="field-row">
      <div class="field"><label for="f-desde">Desde</label><input type="date" id="f-desde" value="${INICIO_MES}" /></div>
      <div class="field"><label for="f-hasta">Hasta</label><input type="date" id="f-hasta" value="${HOY}" /></div>
    </div>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Sucursal</th><th>Destino</th><th class="num">Importe</th><th></th></tr></thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No hay gastos en ese rango.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const desde = document.getElementById("f-desde").value;
  const hasta = document.getElementById("f-hasta").value;
  const gastos = await listarGastos({ desde, hasta });
  emptyState.style.display = gastos.length === 0 ? "block" : "none";
  tbody.innerHTML = gastos
    .map(
      (g) => `
    <tr style="${g.estado === "anulado" ? "opacity:0.5; text-decoration:line-through" : ""}">
      <td>${formatFecha(g.fecha)}</td>
      <td>${escapeHtml(g.categoria)}</td>
      <td>${escapeHtml(g.concepto)}${g.proveedorNombre ? ` — ${escapeHtml(g.proveedorNombre)}` : ""}</td>
      <td>${g.sucursalNombre || "-"}</td>
      <td>${g.destinoTipo === "caja" ? "🧾" : "🏦"} ${g.destinoNombre}</td>
      <td class="num">${formatMonto(g.importe)}</td>
      <td>${g.estado !== "anulado" && usuario.rol === "administrador" ? `<button type="button" class="danger" data-anular="${g.id}">Anular</button>` : ""}</td>
    </tr>
  `
    )
    .join("");
  tbody.querySelectorAll("[data-anular]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const motivo = prompt("Motivo de la anulación:");
      if (!motivo) return;
      await anularGasto(btn.dataset.anular, motivo, usuario);
      cargar();
    })
  );
}

document.getElementById("f-desde").addEventListener("change", cargar);
document.getElementById("f-hasta").addEventListener("change", cargar);

document.getElementById("btn-nuevo").addEventListener("click", async () => {
  const [sucursales, cajas, cuentas, categorias] = await Promise.all([listarSucursalesActivas(), listarCajas(), listarCuentasBancariasActivas(), categoriasUsadas()]);
  const cajasConEstado = await Promise.all(
    cajas
      .filter((c) => c.activa !== false)
      .map(async (c) => ({ caja: c, sesion: await sesionAbiertaDeCaja(c.id) }))
  );
  const cajasAbiertas = cajasConEstado.filter((c) => c.sesion);

  if (cajasAbiertas.length === 0 && cuentas.length === 0) {
    alert("Todavía no hay ninguna caja abierta ni cuenta bancaria cargada — abrí una caja o cargá un banco antes de registrar un gasto.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card">
      <div class="section-title">Registrar gasto</div>
      <form id="form-gasto">
        <div class="field-row">
          <div class="field"><label for="g-fecha">Fecha</label><input type="date" id="g-fecha" value="${HOY}" required /></div>
          <div class="field"><label for="g-importe">Importe</label><input type="number" id="g-importe" min="0.01" step="0.01" required /></div>
        </div>
        <div class="field">
          <label for="g-categoria">Categoría</label>
          <input type="text" id="g-categoria" list="categorias-lista" placeholder="Ej. Luz, Alquiler, Fletes…" required />
          <datalist id="categorias-lista">${categorias.map((c) => `<option value="${c}"></option>`).join("")}</datalist>
        </div>
        <div class="field">
          <label for="g-concepto">Concepto</label>
          <input type="text" id="g-concepto" required />
        </div>
        <div class="field">
          <label for="g-proveedor">Proveedor (opcional)</label>
          <input type="text" id="g-proveedor" />
        </div>
        <div class="field">
          <label for="g-sucursal">Sucursal</label>
          <select id="g-sucursal">${sucursales.map((s) => `<option value="${s.id}" data-nombre="${s.nombre}">${s.nombre}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="g-destino">Sale de</label>
          <select id="g-destino">
            ${cajasAbiertas.map((c) => `<option value="caja:${c.caja.id}:${c.sesion.id}" data-nombre="${c.caja.nombre}">🧾 ${c.caja.nombre} (${c.caja.sucursalNombre})</option>`).join("")}
            ${cuentas.map((c) => `<option value="banco:${c.id}" data-nombre="${c.nombre}">🏦 ${c.bancoNombre} — ${c.nombre}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="g-comprobante">Comprobante (opcional)</label>
          <input type="text" id="g-comprobante" placeholder="N° de factura/recibo" />
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button type="submit" class="primary">Registrar</button>
          <button type="button" id="g-cancelar">Cancelar</button>
        </div>
        <div class="error-text" id="g-error" style="display:none"></div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#g-cancelar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => e.target === overlay && overlay.remove());
  overlay.querySelector("#form-gasto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = overlay.querySelector("#g-error");
    errorEl.style.display = "none";
    const destinoSel = overlay.querySelector("#g-destino");
    const [tipo, id, sesionId] = destinoSel.value.split(":");
    const sucSel = overlay.querySelector("#g-sucursal");
    try {
      await registrarGasto(
        {
          fecha: overlay.querySelector("#g-fecha").value,
          sucursalId: sucSel.value || null,
          sucursalNombre: sucSel.value ? sucSel.selectedOptions[0].dataset.nombre : null,
          categoria: overlay.querySelector("#g-categoria").value,
          proveedorNombre: overlay.querySelector("#g-proveedor").value,
          concepto: overlay.querySelector("#g-concepto").value,
          importe: parseFloat(overlay.querySelector("#g-importe").value),
          destino: { tipo, id, nombre: destinoSel.selectedOptions[0].dataset.nombre, sesionId },
          comprobante: overlay.querySelector("#g-comprobante").value,
        },
        usuario
      );
      overlay.remove();
      cargar();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo registrar el gasto.";
      errorEl.style.display = "block";
    }
  });
});

cargar();
