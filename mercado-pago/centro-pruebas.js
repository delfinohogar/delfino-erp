import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { db, collection, query, orderBy, limit, getDocs } from "/js/firebase.js";
import {
  obtenerConfigMercadoPago,
  probarConexionMercadoPago,
  listarTerminales,
  crearOrdenPrueba,
  simularEventoOrden,
  consultarPago,
  crearDevolucion,
} from "/js/mercado-pago.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "mp-centro-pruebas", titulo: "Centro de pruebas", usuario });

const WEBHOOK_URL = "https://southamerica-east1-delfino-hogar-erp.cloudfunctions.net/mpWebhook";
const RESULTADOS_SIMULABLES = [
  { valor: "processed", label: "✅ Aprobado (processed)" },
  { valor: "failed", label: "❌ Rechazado (failed)" },
  { valor: "canceled", label: "🚫 Cancelado (canceled)" },
  { valor: "refunded", label: "↩️ Devuelto (refunded)" },
];

content.innerHTML = `
  <div id="banner-modo"></div>

  <div class="dashboard-grid" style="margin-bottom:16px">
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Estado de conexión</div>
      <div class="dashboard-card-valor" id="kpi-conexion">—</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Modo</div>
      <div class="dashboard-card-valor">🧪 TEST</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Última prueba</div>
      <div class="dashboard-card-valor" id="kpi-ultima-fecha" style="font-size:18px">—</div>
      <div class="hint" id="kpi-ultimo-payment" style="margin:0">—</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">Último resultado</div>
      <div class="dashboard-card-valor" id="kpi-ultimo-resultado" style="font-size:18px">—</div>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">Terminal (dispositivo virtual de prueba)</div>
    <div class="hint" style="margin-bottom:10px">
      No hace falta ningún Point físico — Mercado Pago provee un dispositivo virtual de prueba
      (<code>SBX0000001</code>) que aparece acá automáticamente una vez que hay credenciales de
      prueba cargadas.
    </div>
    <div class="field-row">
      <div class="field" style="max-width:360px">
        <label for="select-terminal">Terminal</label>
        <select id="select-terminal"><option value="">— Probá conexión y listá terminales —</option></select>
      </div>
      <button type="button" id="btn-listar-terminales" style="margin-top:22px">🔄 Listar terminales</button>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">Acciones</div>
    <div class="toolbar" style="margin-bottom:0">
      <button type="button" id="btn-probar-conexion">🔌 Probar conexión</button>
      <button type="button" id="btn-crear-prueba" class="primary">➕ Crear prueba ($1.000)</button>
      <button type="button" id="btn-consultar-pago">🔍 Consultar orden</button>
      <button type="button" id="btn-probar-webhook">🪝 Probar webhook</button>
      <button type="button" id="btn-actualizar-estado">🔄 Actualizar estado</button>
    </div>
    <div class="field-row" style="margin-top:12px; align-items:end">
      <div class="field" style="max-width:280px">
        <label for="select-resultado">Simular resultado (solo sandbox)</label>
        <select id="select-resultado">${RESULTADOS_SIMULABLES.map((r) => `<option value="${r.valor}">${r.label}</option>`).join("")}</select>
      </div>
      <button type="button" id="btn-simular">Simular</button>
    </div>
    <div id="resultado-accion" class="hint" style="margin-top:10px"></div>
  </div>

  <div id="seccion-pago" style="display:none">
    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Última orden de prueba</div>
      <div class="dashboard-grid">
        <div><div class="hint" style="margin:0">Order ID</div><div id="pago-id" style="font-weight:600">—</div></div>
        <div><div class="hint" style="margin:0">Estado</div><div id="pago-estado" style="font-weight:600">—</div></div>
        <div><div class="hint" style="margin:0">Importe</div><div id="pago-importe" style="font-weight:600">—</div></div>
        <div><div class="hint" style="margin:0">Medio de pago</div><div id="pago-medio" style="font-weight:600">—</div></div>
        <div><div class="hint" style="margin:0">Terminal</div><div id="pago-terminal" style="font-weight:600">—</div></div>
        <div><div class="hint" style="margin:0">Acreditado</div><div id="pago-acreditado" style="font-weight:600">—</div></div>
      </div>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Conciliación</div>
      <div id="conciliacion-resultado"></div>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Comisión</div>
      <div id="comision-resultado" class="hint"></div>
    </div>

    <div class="card" style="padding:20px; margin-bottom:16px">
      <div class="section-title">Devolución</div>
      <div class="toolbar" style="margin-bottom:8px">
        <button type="button" id="btn-devolucion">↩️ Generar devolución total</button>
      </div>
      <div id="devolucion-resultado" class="hint"></div>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">Webhook</div>
    <div class="hint" style="margin-bottom:8px">
      Configurala en Mercado Pago → Tus integraciones → tu aplicación → Webhooks → Configurar notificaciones,
      con el evento <strong>Órdenes</strong> (o Pagos, según la versión del panel) activado:
    </div>
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px">
      <input type="text" id="webhook-url" value="${WEBHOOK_URL}" readonly style="flex:1" />
      <button type="button" id="btn-copiar-webhook">Copiar</button>
    </div>
    <div class="hint">Últimas notificaciones recibidas:</div>
    <div id="webhook-log" class="table-scroll"></div>
  </div>

  <div class="card" style="padding:20px">
    <div class="section-title">Log de integración</div>
    <div id="log-integracion" class="table-scroll"></div>
  </div>
`;

function pintarBanner(modo) {
  document.getElementById("banner-modo").innerHTML =
    modo === "produccion"
      ? ""
      : `<div class="card" style="padding:12px 16px; margin-bottom:16px; background:var(--warning-bg); border-color:var(--warning); color:var(--warning); font-weight:600; text-align:center">
          🧪 MODO PRUEBA — NO SE ESTÁN PROCESANDO COBROS REALES
        </div>`;
}

function formatMonto(v) {
  return v == null ? "-" : `$${Number(v).toLocaleString("es-AR")}`;
}
function formatFecha(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

const config = await obtenerConfigMercadoPago();
pintarBanner(config.modo || "test");
document.getElementById("kpi-conexion").textContent = config.ultimaConexionOk ? "🟢 Conectado" : config.ultimaConexionOk === false ? "🔴 Error" : "—";

let pagoActual = null;

async function cargarLogs() {
  const snap = await getDocs(query(collection(db, "logIntegracionMercadoPago"), orderBy("fecha", "desc"), limit(20)));
  const filas = snap.docs.map((d) => d.data());
  document.getElementById("log-integracion").innerHTML = filas.length
    ? `<table>
        <thead><tr><th>Fecha</th><th>Endpoint</th><th>Operación</th><th>Resultado</th><th>Order ID</th><th>Detalle</th></tr></thead>
        <tbody>
          ${filas
            .map(
              (f) => `
            <tr>
              <td>${formatFecha(f.fecha)}</td>
              <td>${f.endpoint || "-"}</td>
              <td>${f.tipoOperacion || "-"}</td>
              <td>${f.resultado === "ok" ? "🟢 ok" : "🔴 error"}</td>
              <td>${f.paymentId || "-"}</td>
              <td>${f.mensajeError || "-"}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>`
    : `<div class="hint" style="padding:12px">Todavía no hay operaciones registradas.</div>`;

  const webhooks = filas.filter((f) => f.tipoOperacion === "webhook");
  document.getElementById("webhook-log").innerHTML = webhooks.length
    ? `<table>
        <thead><tr><th>Fecha</th><th>Resultado</th><th>Order ID</th><th>Detalle</th></tr></thead>
        <tbody>
          ${webhooks
            .map((f) => `<tr><td>${formatFecha(f.fecha)}</td><td>${f.resultado === "ok" ? "🟢 ok" : "🔴 error"}</td><td>${f.paymentId || "-"}</td><td>${f.mensajeError || "-"}</td></tr>`)
            .join("")}
        </tbody>
      </table>`
    : `<div class="hint" style="padding:12px">Todavía no llegó ninguna notificación — creá una prueba y simulá un resultado.</div>`;
}

function pintarPago(pago) {
  pagoActual = pago;
  if (!pago) return;
  document.getElementById("seccion-pago").style.display = "block";
  document.getElementById("pago-id").textContent = pago.orderId;
  document.getElementById("pago-estado").textContent = pago.estado + (pago.estadoDetalle ? ` (${pago.estadoDetalle})` : "");
  document.getElementById("pago-importe").textContent = formatMonto(pago.importe);
  document.getElementById("pago-medio").textContent = pago.medioPago || "-";
  document.getElementById("pago-terminal").textContent = pago.terminalId || "-";
  document.getElementById("pago-acreditado").textContent = pago.acreditado ? "Sí" : "No";

  const ventaErp = 1000;
  const importeMp = pago.importe ?? 0;
  const conciliado = Math.abs(ventaErp - importeMp) < 0.01;
  document.getElementById("conciliacion-resultado").innerHTML = `
    <div class="dashboard-grid" style="margin-bottom:10px">
      <div><div class="hint" style="margin:0">Venta ERP</div><div style="font-weight:600">${formatMonto(ventaErp)}</div></div>
      <div><div class="hint" style="margin:0">Mercado Pago</div><div style="font-weight:600">${pago.importe != null ? formatMonto(pago.importe) : "Todavía sin importe (orden pendiente)"}</div></div>
    </div>
    <div style="font-weight:700; color:var(--${conciliado ? "success" : "danger"})">${pago.importe == null ? "⏳ Pendiente de conciliar" : conciliado ? "🟢 CONCILIADO" : "🔴 DIFERENCIA"}</div>
  `;

  document.getElementById("comision-resultado").textContent = pago.comisionDisponible
    ? `Comisión: ${formatMonto(pago.comision)} — Neto: ${formatMonto(pago.neto)}`
    : "Comisión no disponible en esta operación de prueba.";

  document.getElementById("kpi-ultima-fecha").textContent = formatFecha(pago.actualizadoEn);
  document.getElementById("kpi-ultimo-payment").textContent = `ID ${pago.orderId}`;
  document.getElementById("kpi-ultimo-resultado").textContent = pago.estado.toUpperCase();
}

async function cargarUltimoPago() {
  const snap = await getDocs(query(collection(db, "pagosMercadoPago"), orderBy("actualizadoEn", "desc"), limit(1)));
  if (!snap.empty) pintarPago(snap.docs[0].data());
}

function mostrarResultado(texto, esError = false) {
  const el = document.getElementById("resultado-accion");
  el.textContent = texto;
  el.className = esError ? "hint error-text" : "hint";
}

document.getElementById("btn-probar-conexion").addEventListener("click", async () => {
  mostrarResultado("Probando conexión…");
  try {
    const res = await probarConexionMercadoPago("test");
    document.getElementById("kpi-conexion").textContent = "🟢 Conectado";
    mostrarResultado(`🟢 Conexión correcta — ${res.cantidadMediosPago} medios de pago disponibles.`);
  } catch (err) {
    document.getElementById("kpi-conexion").textContent = "🔴 Error";
    mostrarResultado("🔴 Error de conexión: " + (err?.message || "error desconocido"), true);
  }
  cargarLogs();
});

async function cargarTerminales() {
  const select = document.getElementById("select-terminal");
  select.innerHTML = `<option value="">Cargando…</option>`;
  try {
    const terminales = await listarTerminales();
    const opciones = terminales.map((t) => `<option value="${t.id}">${t.id}${t.id.includes("SBX0000001") ? " (virtual de prueba)" : ""}</option>`);
    // El dispositivo virtual de prueba (SBX0000001) no siempre aparece listado en cuentas nuevas,
    // pero es un ID estándar documentado por Mercado Pago — se ofrece como opción igual si no vino
    // en el listado, en vez de dejar al usuario sin ninguna forma de probar.
    if (!terminales.some((t) => t.id.includes("SBX0000001"))) {
      opciones.push(`<option value="NEWLAND_N950__SBX0000001">NEWLAND_N950__SBX0000001 (virtual de prueba — estándar)</option>`);
    }
    select.innerHTML = opciones.join("");
    if (terminales.length === 0) {
      mostrarResultado("No hay terminales vinculados todavía — se agregó el dispositivo virtual estándar de Mercado Pago como opción.");
    }
  } catch (err) {
    select.innerHTML = `<option value="">Error al listar</option>`;
    mostrarResultado("No se pudieron listar terminales: " + (err?.message || "error desconocido"), true);
  }
  cargarLogs();
}
document.getElementById("btn-listar-terminales").addEventListener("click", cargarTerminales);

document.getElementById("btn-crear-prueba").addEventListener("click", async () => {
  const terminalId = document.getElementById("select-terminal").value;
  if (!terminalId) return mostrarResultado("Elegí un terminal primero (Listar terminales).", true);
  mostrarResultado("Creando orden de prueba…");
  try {
    const resultado = await crearOrdenPrueba(terminalId);
    mostrarResultado(`Orden creada — ID ${resultado.orderId}, estado: ${resultado.status}. Ahora simulá un resultado.`);
    const pago = await consultarPago(resultado.orderId);
    pintarPago(pago);
  } catch (err) {
    mostrarResultado("No se pudo crear la orden de prueba: " + (err?.message || "error desconocido"), true);
  }
  cargarLogs();
});

document.getElementById("btn-simular").addEventListener("click", async () => {
  if (!pagoActual) return mostrarResultado("Creá una orden de prueba primero.", true);
  const estado = document.getElementById("select-resultado").value;
  mostrarResultado("Simulando resultado…");
  try {
    await simularEventoOrden(pagoActual.orderId, estado);
    mostrarResultado("Evento simulado — puede tardar unos segundos en reflejarse. Usá 'Actualizar estado'.");
  } catch (err) {
    mostrarResultado("No se pudo simular el evento: " + (err?.message || "error desconocido"), true);
  }
  cargarLogs();
});

document.getElementById("btn-consultar-pago").addEventListener("click", async () => {
  if (!pagoActual) return mostrarResultado("Todavía no creaste ninguna orden de prueba.", true);
  mostrarResultado("Consultando orden…");
  try {
    const pago = await consultarPago(pagoActual.orderId);
    pintarPago(pago);
    mostrarResultado("Orden consultada — estado actual: " + pago.estado);
  } catch (err) {
    mostrarResultado("No se pudo consultar la orden: " + (err?.message || "error desconocido"), true);
  }
  cargarLogs();
});

document.getElementById("btn-actualizar-estado").addEventListener("click", () => {
  document.getElementById("btn-consultar-pago").click();
});

document.getElementById("btn-probar-webhook").addEventListener("click", () => {
  mostrarResultado("La URL del webhook está configurada abajo. Las notificaciones llegan solas al crear/simular una orden — mirá la tabla de notificaciones recibidas.");
  cargarLogs();
});

document.getElementById("btn-copiar-webhook").addEventListener("click", async () => {
  await navigator.clipboard.writeText(WEBHOOK_URL);
  mostrarResultado("URL del webhook copiada.");
});

document.getElementById("btn-devolucion").addEventListener("click", async () => {
  if (!pagoActual) return mostrarResultado("Todavía no creaste ninguna orden de prueba.", true);
  if (pagoActual.estado !== "processed") return mostrarResultado("Solo se puede devolver una orden procesada (processed).", true);
  if (!confirm(`¿Generar una devolución total de ${formatMonto(pagoActual.importe)} para la orden ${pagoActual.orderId}?`)) return;
  const el = document.getElementById("devolucion-resultado");
  el.textContent = "Generando devolución…";
  try {
    const res = await crearDevolucion(pagoActual.orderId);
    el.textContent = `Devolución generada — estado de la orden: ${res.estado}.`;
    const pago = await consultarPago(pagoActual.orderId);
    pintarPago(pago);
  } catch (err) {
    el.textContent = "No se pudo generar la devolución: " + (err?.message || "error desconocido");
    el.className = "hint error-text";
  }
  cargarLogs();
});

await cargarUltimoPago();
await cargarTerminales();
await cargarLogs();
