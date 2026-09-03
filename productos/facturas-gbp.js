// Historial de facturas emitidas en GBP — solo lectura/consulta, no afecta el saldo de Cuenta
// Corriente ni factura nada del lado de Delfino (ver conversación de diseño). Todo es manual: un
// admin toca "Sincronizar ahora" para traer lo nuevo de GBP (ventana configurada en las consultas
// de GBP, ver js/gbp-facturas.js) y "Vincular clientes" para cruzar clientes de Delfino con su
// cliente de GBP por CUIT/DNI — siempre previsualiza antes de aplicar (gbpPreviewVincularClientes /
// gbpAplicarVincularClientes) — hace falta correrlo al menos una vez, y de nuevo cada tanto que se
// carguen clientes nuevos, para que las facturas queden asociadas y aparezcan en la ficha de Cuenta
// Corriente de cada cliente.
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarFacturasGbp, sincronizarFacturasGbp, previewVincularClientesGbp, aplicarVincularClientesGbp } from "/js/gbp-facturas.js";
import { formatMoneda, formatFecha } from "/js/formato.js";
import { obtenerConfigEmpresa } from "/js/configuracion-empresa.js";
import { mostrarDetalleFacturaGbp } from "/js/factura-gbp-detalle-modal.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "facturas-gbp", titulo: "Facturas GBP", usuario });

const PERIODOS = ["Hoy", "Esta semana", "Este mes", "Último año", "Todas"];

function inicioSemana(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00Z");
  const diaSemana = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - diaSemana);
  return d.toISOString().slice(0, 10);
}

function rangoPeriodo(periodo, hoy) {
  if (periodo === "Hoy") return { desde: hoy, hasta: hoy };
  if (periodo === "Esta semana") return { desde: inicioSemana(hoy), hasta: hoy };
  if (periodo === "Este mes") return { desde: hoy.slice(0, 8) + "01", hasta: hoy };
  if (periodo === "Último año") {
    const d = new Date(hoy + "T00:00:00Z");
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return { desde: d.toISOString().slice(0, 10), hasta: hoy };
  }
  return { desde: null, hasta: null }; // "Todas"
}

content.innerHTML = `
  <div class="card mb-16" style="padding:16px 20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px">
    <div class="hint" style="max-width:56ch; margin:0">
      Historial de facturas emitidas en GBP, solo de consulta — no genera ni afecta nada en Delfino.
    </div>
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
      <button type="button" id="btn-vincular">Vincular clientes</button>
      <button type="button" id="btn-sincronizar" class="primary">Sincronizar ahora</button>
      <span id="sync-estado" class="hint mt-0"></span>
    </div>
  </div>

  <div class="card mb-16" style="padding:16px 20px">
    <div class="field-row" style="align-items:flex-end">
      <div class="field" style="max-width:220px">
        <label for="periodo-select">Período</label>
        <select id="periodo-select">${PERIODOS.map((p) => `<option${p === "Este mes" ? " selected" : ""}>${p}</option>`).join("")}</select>
      </div>
      <div style="margin-left:auto; text-align:right">
        <div class="hint mt-0">Facturas / Total del período</div>
        <div id="resumen-periodo" style="font-size:18px; font-weight:600"></div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Comprobante</th>
            <th>Cliente (GBP)</th>
            <th>Total</th>
            <th>CAE</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">No hay facturas en este período.</div>
  </div>
`;

const btnVincular = document.getElementById("btn-vincular");
const btnSincronizar = document.getElementById("btn-sincronizar");
const syncEstado = document.getElementById("sync-estado");
const periodoSelect = document.getElementById("periodo-select");
const resumenEl = document.getElementById("resumen-periodo");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

let todasLasFacturas = [];
const configEmpresa = await obtenerConfigEmpresa();

function comprobanteTexto(f) {
  const numeroFmt = String(f.numero ?? "").padStart(8, "0");
  return `${f.letra || ""} ${String(f.puntoVenta ?? "").padStart(4, "0")}-${numeroFmt}`.trim();
}

function pintar() {
  const hoy = new Date().toISOString().slice(0, 10);
  const { desde, hasta } = rangoPeriodo(periodoSelect.value, hoy);
  const filtradas = todasLasFacturas.filter((f) => !desde || (f.fecha >= desde && f.fecha <= hasta));

  const totalPeriodo = filtradas.reduce((acc, f) => acc + (f.total || 0), 0);
  resumenEl.textContent = `${filtradas.length} · ${formatMoneda(totalPeriodo)}`;

  tablaBody.innerHTML = "";
  emptyState.style.display = filtradas.length === 0 ? "block" : "none";
  filtradas.forEach((f) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatFecha(f.fecha)}</td>
      <td>${comprobanteTexto(f)}${f.anulada ? ' <span class="hint" style="color:var(--danger)">Anulada</span>' : ""}</td>
      <td>#${f.clienteIdExterno || "-"}</td>
      <td>${formatMoneda(f.total)}</td>
      <td>${f.cae || "-"}</td>
    `;
    tr.addEventListener("click", () => mostrarDetalleFacturaGbp(f, configEmpresa));
    tablaBody.appendChild(tr);
  });
}

periodoSelect.addEventListener("change", pintar);

async function cargar() {
  todasLasFacturas = await listarFacturasGbp();
  pintar();
}

btnSincronizar.addEventListener("click", async () => {
  btnSincronizar.disabled = true;
  syncEstado.textContent = "Sincronizando…";
  try {
    const res = await sincronizarFacturasGbp();
    syncEstado.textContent = `Listo: ${res.totalFacturas} facturas, ${res.totalLineas} líneas.`;
    await cargar();
  } catch (err) {
    syncEstado.textContent = `Error: ${err?.message || "no se pudo sincronizar"}`;
  } finally {
    btnSincronizar.disabled = false;
  }
});

// Previsualiza siempre antes de escribir nada — mismo criterio que el resto del ERP (ver
// tiendanube-catalogo.js). Las vinculaciones (tocan clientes reales de Delfino) se pueden destildar
// una por una; las fichas livianas (solo agregan, no tocan nada operativo) se aplican en bloque.
function mostrarPreviewVinculacion(preview) {
  const { vinculaciones, fichasNuevas, ambiguos, totalClientesGbp, totalClientesDelfino } = preview;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card card" style="max-width:760px">
      <div class="section-title">Vincular clientes — previsualización</div>
      <div class="hint" style="margin-bottom:14px">
        GBP tiene ${totalClientesGbp.toLocaleString("es-AR")} clientes en total · Delfino tiene ${totalClientesDelfino}.
      </div>

      ${
        ambiguos && ambiguos.length > 0
          ? `<div class="card no-imprimir" style="padding:12px 16px; margin-bottom:14px; background:var(--warning-bg); border-color:var(--warning)">
              <div style="font-weight:600; color:var(--warning); margin-bottom:6px">⚠️ ${ambiguos.length} con CUIT/DNI ambiguo — no se vincularon solos</div>
              <div class="hint" style="margin-bottom:8px">Ese documento aparece en más de un cliente de GBP (típico de bases cargadas en años) — para no arriesgarme a pisar el cliente equivocado, no elijo por vos. Revisalos a mano en Configuración → Clientes si querés vincularlos.</div>
              <div class="table-scroll" style="max-height:150px">
                <table>
                  <thead><tr><th>Cliente Delfino</th><th>CUIT/DNI</th><th>Candidatos en GBP</th></tr></thead>
                  <tbody>
                    ${ambiguos
                      .map(
                        (a) => `
                      <tr>
                        <td>${a.clienteNombre}</td>
                        <td>${a.clienteCuit}</td>
                        <td>${a.candidatos.map((c) => `${c.custNombre || "?"} (#${c.custId})`).join(" · ")}</td>
                      </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>`
          : ""
      }

      <div style="font-weight:600; margin-bottom:6px">Clientes de Delfino a vincular (${vinculaciones.length})</div>
      ${
        vinculaciones.length === 0
          ? `<div class="hint" style="margin-bottom:14px">Nada nuevo para vincular acá — 🟢</div>`
          : `<div class="table-scroll" style="max-height:220px; margin-bottom:14px">
              <table>
                <thead><tr><th></th><th>Cliente Delfino</th><th>CUIT/DNI</th><th>Cliente en GBP</th></tr></thead>
                <tbody>
                  ${vinculaciones
                    .map(
                      (v, i) => `
                    <tr>
                      <td><input type="checkbox" data-role="chk-vinc" data-i="${i}" checked /></td>
                      <td>${v.clienteNombre}</td>
                      <td>${v.clienteCuit}</td>
                      <td>${v.custNombre || "#" + v.custId}</td>
                    </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
      }

      <div style="font-weight:600; margin-bottom:6px">Fichas nuevas de clientes GBP (${fichasNuevas.length})</div>
      <div class="hint" style="margin-bottom:8px">
        Clientes de GBP que ya compraron algo (en las facturas sincronizadas) pero no son cliente de Delfino —
        se guarda solo nombre/CUIT/domicilio, para poder mostrar el nombre en reportes. No aparecen en Nueva Venta
        ni en Cuenta Corriente, y no se pueden destildar uno por uno — se crean todas juntas.
      </div>
      ${
        fichasNuevas.length === 0
          ? `<div class="hint" style="margin-bottom:14px">No hay fichas nuevas para crear — 🟢</div>`
          : `<div class="table-scroll" style="max-height:220px; margin-bottom:14px">
              <table>
                <thead><tr><th>Nombre</th><th>CUIT/DNI</th><th>Ciudad</th></tr></thead>
                <tbody>
                  ${fichasNuevas
                    .slice(0, 200)
                    .map((f) => `<tr><td>${f.nombre || "-"}</td><td>${f.cuit || "-"}</td><td>${f.ciudad || "-"}</td></tr>`)
                    .join("")}
                </tbody>
              </table>
              ${fichasNuevas.length > 200 ? `<div class="hint" style="padding:8px">… y ${fichasNuevas.length - 200} más.</div>` : ""}
            </div>`
      }

      <div class="error-text" id="preview-error" style="display:none"></div>
      <div class="toolbar" style="justify-content:flex-end">
        <button type="button" id="btn-cancelar-preview">Cancelar</button>
        <button type="button" id="btn-confirmar-preview" class="primary">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const cerrar = () => overlay.remove();
  overlay.querySelector("#btn-cancelar-preview").addEventListener("click", cerrar);
  overlay.querySelector("#btn-confirmar-preview").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const errorEl = overlay.querySelector("#preview-error");
    errorEl.style.display = "none";
    try {
      const seleccionadas = Array.from(overlay.querySelectorAll("[data-role=chk-vinc]:checked")).map((chk) => vinculaciones[Number(chk.dataset.i)]);
      const res = await aplicarVincularClientesGbp({ vinculaciones: seleccionadas, fichasNuevas });
      cerrar();
      syncEstado.textContent = `Listo: ${res.vinculados} clientes vinculados, ${res.fichasCreadas} fichas nuevas creadas, ${res.facturasVinculadas} facturas ya sincronizadas quedaron asociadas.`;
      await cargar();
    } catch (err) {
      errorEl.textContent = err?.message || "No se pudo aplicar.";
      errorEl.style.display = "block";
      btn.disabled = false;
    }
  });
}

btnVincular.addEventListener("click", async () => {
  btnVincular.disabled = true;
  syncEstado.textContent = "Buscando qué se puede vincular… puede tardar unos minutos.";
  try {
    const preview = await previewVincularClientesGbp();
    syncEstado.textContent = "";
    mostrarPreviewVinculacion(preview);
  } catch (err) {
    syncEstado.textContent = `Error: ${err?.message || "no se pudo previsualizar"}`;
  } finally {
    btnVincular.disabled = false;
  }
});

cargar();
