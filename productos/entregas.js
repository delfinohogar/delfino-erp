// Entregas pendientes: ventas con "Envío a domicilio" u "Otro" que todavía no se marcaron
// entregadas. El estado vive en /entregas (ver js/entregas.js), no en la venta — es lo único que
// Logística necesita poder tocar después de vender.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarEntregas, marcarEntregado } from "/js/entregas.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "entregas", titulo: "Entregas", usuario });

function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

content.innerHTML = `<div class="hint">Cargando…</div>`;

let mostrarEntregadas = false;

async function cargar() {
  const todas = await listarEntregas();
  const pendientes = todas.filter((e) => e.estado !== "entregado");
  const entregadas = todas.filter((e) => e.estado === "entregado").sort((a, b) => (b.entregadoEn?.seconds || 0) - (a.entregadoEn?.seconds || 0));
  const lista = mostrarEntregadas ? [...pendientes, ...entregadas] : pendientes;

  content.innerHTML = `
    <div class="toolbar" style="margin-bottom:16px">
      <label style="display:flex; align-items:center; gap:6px; font-size:14px">
        <input type="checkbox" id="chk-entregadas" ${mostrarEntregadas ? "checked" : ""} /> Mostrar entregadas también
      </label>
    </div>
    <div class="card">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Venta</th>
              <th>Cliente</th>
              <th>Sucursal</th>
              <th>Tipo</th>
              <th>Domicilio / nota</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
      <div id="empty-state" class="empty-state" style="display:${lista.length === 0 ? "block" : "none"}">
        ${pendientes.length === 0 ? "No hay entregas pendientes. 🟢" : ""}
      </div>
    </div>
  `;

  document.getElementById("chk-entregadas").addEventListener("change", (e) => {
    mostrarEntregadas = e.target.checked;
    cargar();
  });

  const tablaBody = document.getElementById("tabla-body");
  lista.forEach((entrega) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a href="/productos/venta-ficha.html?id=${entrega.ventaId}">#${entrega.numeroVenta ?? ""}</a></td>
      <td>${entrega.clienteNombre || "Consumidor final"}</td>
      <td>${entrega.sucursalNombre || "-"}</td>
      <td>${entrega.tipoEntrega}</td>
      <td>${entrega.domicilioEntrega || entrega.notaEntrega || "-"}</td>
      <td>${
        entrega.estado === "entregado"
          ? `<span class="badge success">Entregado</span> <span class="hint">${entrega.entregadoPorNombre}, ${formatFechaHora(entrega.entregadoEn)}</span>`
          : '<span class="badge warning">Pendiente</span>'
      }</td>
      <td>${entrega.estado === "entregado" ? "" : `<button type="button" data-role="entregar">Marcar entregado</button>`}</td>
    `;
    tr.querySelector("[data-role=entregar]")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        await marcarEntregado(entrega.ventaId, usuario);
        cargar();
      } catch (err) {
        alert("No se pudo marcar como entregado: " + (err?.message || "error desconocido"));
        e.target.disabled = false;
      }
    });
    tablaBody.appendChild(tr);
  });
}

cargar();
