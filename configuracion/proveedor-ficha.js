import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerProveedor, actualizarProveedor } from "/js/catalogo.js";
import { pedirProveedorModal } from "/js/proveedor-modal.js";
import { consultarPadronArca } from "/js/arca.js";
import { soloDigitos, formatearCuit, cuitsPosiblesDesdeDni } from "/js/cuit.js";
import { mostrarCentralDeudores } from "/js/bcra-modal.js";
import { listarComprasPorProveedor } from "/js/compras.js";
import { listarPagosPorProveedor } from "/js/pagos.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const proveedorId = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "config-proveedores", titulo: "Ficha de proveedor", usuario });

if (!proveedorId) {
  content.innerHTML = `<div class="card empty-state">Falta el proveedor.</div>`;
  throw new Error("falta id de proveedor");
}

content.innerHTML = `
  <div class="card mb-16">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px">
      <div>
        <div id="f-razonSocial" style="font-size:20px; font-weight:600"></div>
        <div class="hint" id="f-cuit" style="margin-top:4px"></div>
        <div class="hint" id="f-gbp" style="margin-top:2px; display:none"></div>
      </div>
      <div style="display:flex; gap:8px; align-items:center">
        <span id="f-origen"></span>
        <button type="button" id="btn-reconsultar">🔎 Re-consultar ARCA</button>
        <button type="button" id="btn-deudores">🏦 Central de Deudores</button>
        <button type="button" id="btn-editar">Editar</button>
      </div>
    </div>
    <div class="hint error-text" id="f-error" style="display:none; margin-top:8px"></div>
  </div>

  <div class="card mb-16">
    <div class="section-title">Datos ARCA</div>
    <div class="field-row">
      <div class="field"><label>Condición IVA</label><div id="d-condicionIva">-</div></div>
      <div class="field"><label>Situación tributaria</label><div id="d-situacion">-</div></div>
      <div class="field"><label>Provincia</label><div id="d-provincia">-</div></div>
      <div class="field"><label>Código postal</label><div id="d-cp">-</div></div>
    </div>
    <div class="field"><label>Domicilio fiscal</label><div id="d-domicilio">-</div></div>
    <div class="field"><label>Actividades</label><div id="d-actividades">-</div></div>
    <div class="hint" id="d-fecha"></div>
  </div>

  <div class="card mb-16">
    <div class="section-title">Contacto</div>
    <div class="field-row">
      <div class="field"><label>Localidad</label><div id="d-localidad">-</div></div>
      <div class="field"><label>Teléfono</label><div id="d-telefono">-</div></div>
      <div class="field"><label>Email</label><div id="d-email">-</div></div>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center">
    <div>
      <div class="section-title" style="border:none; margin:0; padding:0">Cuenta corriente</div>
      <div class="hint" id="cc-resumen">Cargando…</div>
    </div>
    <a id="cc-link" href="#"><button type="button">Ver cuenta corriente completa</button></a>
  </div>

  <div class="card" style="padding:20px">
    <div class="section-title">Compras recientes</div>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Comprobante</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody id="compras-body"></tbody>
      </table>
    </div>
    <div id="compras-empty" class="hint" style="display:none; padding:12px 0">Todavía no hay compras registradas a este proveedor.</div>
  </div>
`;

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

function pintarProveedor(p) {
  document.getElementById("f-razonSocial").textContent = p.razonSocial || "";
  document.getElementById("f-cuit").textContent = p.cuit ? `CUIT ${p.cuit}` : "Sin CUIT cargado";
  document.getElementById("f-origen").innerHTML =
    p.fuenteDatos === "arca" ? '<span class="badge success">Origen: ARCA</span>' : '<span class="badge muted">Origen: Manual</span>';

  // Referencia para cruzar a mano con GBP — mismo criterio que configuracion/cliente-ficha.js.
  const gbpEl = document.getElementById("f-gbp");
  if (p.identificadorExterno) {
    gbpEl.textContent = `ID GBP: ${p.identificadorExterno}`;
    gbpEl.style.display = "block";
  } else {
    gbpEl.style.display = "none";
  }

  document.getElementById("d-condicionIva").textContent = p.condicionIva || "-";
  document.getElementById("d-situacion").textContent = p.situacionTributaria || "-";
  document.getElementById("d-provincia").textContent = p.provincia || "-";
  document.getElementById("d-cp").textContent = p.codigoPostal || "-";
  document.getElementById("d-domicilio").textContent = p.domicilioFiscal || "-";
  document.getElementById("d-actividades").textContent = (p.actividades || []).map((a) => a.descripcion).join(", ") || "-";
  document.getElementById("d-fecha").textContent = p.fechaConsultaArca
    ? `Última consulta a ARCA: ${formatFecha(p.fechaConsultaArca)}`
    : "Todavía no se consultó ARCA para este proveedor.";

  document.getElementById("d-localidad").textContent = p.localidad || "-";
  document.getElementById("d-telefono").textContent = p.telefono || "-";
  document.getElementById("d-email").textContent = p.email || "-";
}

let proveedor = await obtenerProveedor(proveedorId);
if (!proveedor) {
  content.innerHTML = `<div class="card empty-state">No se encontró el proveedor.</div>`;
  throw new Error("proveedor no encontrado");
}
pintarProveedor(proveedor);
document.getElementById("cc-link").href = `/productos/cuenta-corriente.html?proveedorId=${proveedorId}`;

document.getElementById("btn-editar").addEventListener("click", async () => {
  const datos = await pedirProveedorModal(null, proveedor);
  if (!datos) return;
  await actualizarProveedor(proveedorId, datos.razonSocial, datos.cuit, datos.datosArca);
  proveedor = await obtenerProveedor(proveedorId);
  pintarProveedor(proveedor);
});

document.getElementById("btn-deudores").addEventListener("click", () => {
  const errorEl = document.getElementById("f-error");
  errorEl.style.display = "none";
  if (!proveedor.cuit) {
    errorEl.textContent = "Este proveedor no tiene CUIT cargado.";
    errorEl.style.display = "block";
    return;
  }
  mostrarCentralDeudores(proveedor.cuit.replace(/\D/g, ""), proveedor.razonSocial);
});

document.getElementById("btn-reconsultar").addEventListener("click", async () => {
  const errorEl = document.getElementById("f-error");
  errorEl.style.display = "none";
  if (!proveedor.cuit) {
    errorEl.textContent = "Este proveedor no tiene CUIT cargado.";
    errorEl.style.display = "block";
    return;
  }
  const btn = document.getElementById("btn-reconsultar");
  btn.disabled = true;
  btn.textContent = "Consultando…";
  try {
    const digitos = soloDigitos(proveedor.cuit);
    // Un DNI (7-8 dígitos) no es un identificador válido para ARCA — hace falta el CUIL. Mismo
    // criterio que ya usa pedirClienteModal (js/cliente-modal.js): se prueban los prefijos de
    // persona física (20/27/23/24) contra ARCA hasta encontrar el real.
    let cuitParaGuardar = proveedor.cuit;
    let datosArca;
    if (digitos.length === 7 || digitos.length === 8) {
      const candidatos = cuitsPosiblesDesdeDni(digitos);
      let encontrado = null;
      for (const candidato of candidatos) {
        try {
          const datos = await consultarPadronArca(candidato.cuit);
          encontrado = { cuit: candidato.cuit, datos };
          break;
        } catch {
          // este prefijo no correspondía a una persona real — se prueba el siguiente
        }
      }
      if (!encontrado) throw new Error(`No se encontró ningún CUIL registrado en ARCA para el DNI ${digitos}.`);
      cuitParaGuardar = formatearCuit(encontrado.cuit);
      datosArca = encontrado.datos;
    } else {
      datosArca = await consultarPadronArca(proveedor.cuit);
    }
    await actualizarProveedor(proveedorId, proveedor.razonSocial, cuitParaGuardar, datosArca);
    proveedor = await obtenerProveedor(proveedorId);
    pintarProveedor(proveedor);
  } catch (err) {
    errorEl.textContent = "No se pudo consultar ARCA: " + (err?.message || "error desconocido");
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "🔎 Re-consultar ARCA";
  }
});

// --- Cuenta corriente (resumen) y compras recientes ---
const [compras, pagos] = await Promise.all([listarComprasPorProveedor(proveedorId), listarPagosPorProveedor(proveedorId)]);

// Contra netoAPagarProveedor, no el total bruto (ver compras.js) — con retenciones, esa diferencia
// va a AFIP/ARBA, no al proveedor, así que no cuenta como saldo adeudado.
const totalCompras = compras.reduce((acc, c) => acc + (c.netoAPagarProveedor ?? c.total ?? 0), 0);
const totalPagos = pagos.reduce((acc, p) => acc + (p.monto || 0), 0);
const saldo = totalCompras - totalPagos;

const ccResumen = document.getElementById("cc-resumen");
ccResumen.textContent =
  compras.length === 0
    ? "Sin compras registradas todavía."
    : `Saldo adeudado: $${saldo.toLocaleString("es-AR")} (${compras.length} compra${compras.length === 1 ? "" : "s"} cargada${compras.length === 1 ? "" : "s"})`;
ccResumen.style.color = saldo > 0 ? "var(--danger)" : "var(--foreground)";

const comprasBody = document.getElementById("compras-body");
const comprasEmpty = document.getElementById("compras-empty");
const recientes = [...compras].sort((a, b) => (b.creadoEn?.toDate?.() || 0) - (a.creadoEn?.toDate?.() || 0)).slice(0, 5);
comprasEmpty.style.display = recientes.length === 0 ? "block" : "none";
recientes.forEach((c) => {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${formatFecha(c.fecha)}</td>
    <td>${c.tipoComprobante || ""} ${c.numeroFactura || ""}</td>
    <td>${(c.total ?? 0).toLocaleString("es-AR")}</td>
  `;
  comprasBody.appendChild(tr);
});
