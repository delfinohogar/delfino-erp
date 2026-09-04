import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerCliente, actualizarCliente, guardarUbicacionCliente } from "/js/clientes.js";
import { pedirClienteModal } from "/js/cliente-modal.js";
import { consultarPadronArca } from "/js/arca.js";
import { soloDigitos, formatearCuit, cuitsPosiblesDesdeDni } from "/js/cuit.js";
import { mostrarCentralDeudores } from "/js/bcra-modal.js";
import { urlMapa } from "/js/motor-mapas.js";
import { pedirNormalizacionDireccion } from "/js/normalizar-direccion-modal.js";
import { calcularCuentaCorriente } from "/js/cuenta-corriente.js";
import { formatMoneda as formatMonto } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const clienteId = new URLSearchParams(location.search).get("id");
const content = renderShell({ active: "config-clientes", titulo: "Ficha de cliente", usuario });

if (!clienteId) {
  content.innerHTML = `<div class="card empty-state">Falta el cliente.</div>`;
  throw new Error("falta id de cliente");
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
      <div class="field"><label>WhatsApp</label><div id="d-whatsapp">-</div></div>
      <div class="field"><label>Email</label><div id="d-email">-</div></div>
    </div>
    <div class="field">
      <label>Domicilio de entrega</label>
      <div style="display:flex; align-items:center; gap:10px">
        <div id="d-domicilio-entrega">-</div>
        <button type="button" id="btn-normalizar" style="flex-shrink:0">📍 Normalizar dirección</button>
      </div>
      <div class="hint" id="d-domicilio-normalizado" style="margin-top:6px"></div>
    </div>
    <div class="field-row" style="margin-top:14px">
      <div class="field"><label>Localidad</label><div id="d-localidad-entrega">-</div></div>
      <div class="field"><label>Código postal</label><div id="d-cp-entrega">-</div></div>
    </div>
  </div>

  <div class="card mb-16" id="cuenta-corriente">
    <div class="section-title">Cuenta corriente</div>
    <div class="dashboard-grid" id="cc-stats" style="margin-top:4px"></div>
  </div>

  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Comprobante</th>
            <th>Concepto</th>
            <th class="num">Débito</th>
            <th class="num">Crédito</th>
            <th class="num">Saldo</th>
          </tr>
        </thead>
        <tbody id="cc-tabla-body"></tbody>
      </table>
    </div>
    <div id="cc-empty-state" class="empty-state" style="display:none">Este cliente todavía no tiene ventas ni cobros registrados.</div>
  </div>
`;

function formatFecha(fecha) {
  if (!fecha) return "-";
  if (fecha.toDate) return fecha.toDate().toLocaleDateString("es-AR");
  return new Date(fecha).toLocaleDateString("es-AR");
}

function pintarCliente(c) {
  document.getElementById("f-razonSocial").textContent = c.razonSocial || "";
  document.getElementById("f-cuit").textContent = c.cuit ? `CUIT/DNI ${c.cuit}` : "Sin CUIT/DNI cargado";
  document.getElementById("f-origen").innerHTML =
    c.fuenteDatos === "arca" ? '<span class="badge success">Origen: ARCA</span>' : '<span class="badge muted">Origen: Manual</span>';

  // Referencia para cruzar a mano con GBP durante la migración — el dato ya se guardaba
  // (identificadorExterno, usado para no duplicar al importar) pero no se mostraba en ningún lado.
  const gbpEl = document.getElementById("f-gbp");
  if (c.identificadorExterno) {
    gbpEl.textContent = `ID GBP: ${c.identificadorExterno}`;
    gbpEl.style.display = "block";
  } else {
    gbpEl.style.display = "none";
  }

  document.getElementById("d-condicionIva").textContent = c.condicionIva || "-";
  document.getElementById("d-situacion").textContent = c.situacionTributaria || "-";
  document.getElementById("d-provincia").textContent = c.provincia || "-";
  document.getElementById("d-cp").textContent = c.codigoPostal || "-";
  document.getElementById("d-domicilio").textContent = c.domicilioFiscal || "-";
  document.getElementById("d-actividades").textContent = (c.actividades || []).map((a) => a.descripcion).join(", ") || "-";
  document.getElementById("d-fecha").textContent = c.fechaConsultaArca
    ? `Última consulta a ARCA: ${formatFecha(c.fechaConsultaArca)}`
    : "Todavía no se consultó ARCA para este cliente.";

  document.getElementById("d-whatsapp").textContent = c.whatsapp || "-";
  document.getElementById("d-email").textContent = c.email || "-";
  document.getElementById("d-domicilio-entrega").textContent = c.domicilioEntrega || "-";
  document.getElementById("d-localidad-entrega").textContent = c.localidadEntrega || "-";
  document.getElementById("d-cp-entrega").textContent = c.codigoPostalEntrega || "-";

  const normalizadoEl = document.getElementById("d-domicilio-normalizado");
  if (c.domicilioEntregaNormalizado) {
    normalizadoEl.innerHTML = `✓ Normalizado: ${c.domicilioEntregaNormalizado} <span class="hint">(${c.domicilioEntregaLat?.toFixed(5)}, ${c.domicilioEntregaLon?.toFixed(5)})</span> · <a href="${urlMapa(c.domicilioEntregaLat, c.domicilioEntregaLon)}" target="_blank" rel="noopener">Ver en el mapa</a>`;
    normalizadoEl.className = "hint";
  } else {
    normalizadoEl.textContent = c.domicilioEntrega ? "Todavía no se normalizó esta dirección." : "";
    normalizadoEl.className = "hint";
  }
}

async function cargarCuentaCorriente() {
  const { movimientos, totalFacturado, totalPagado, totalNC, saldoPendiente } = await calcularCuentaCorriente(clienteId);

  document.getElementById("cc-stats").innerHTML = `
    <div><div class="hint mt-0">Saldo anterior</div><div style="font-weight:600">${formatMonto(0)}</div></div>
    <div><div class="hint mt-0">Total facturado</div><div style="font-weight:600">${formatMonto(totalFacturado)}</div></div>
    <div><div class="hint mt-0">Total pagado</div><div style="font-weight:600">${formatMonto(totalPagado)}</div></div>
    <div><div class="hint mt-0">Notas de crédito</div><div style="font-weight:600">${formatMonto(totalNC)}</div></div>
    <div><div class="hint mt-0">Saldo pendiente</div><div style="font-weight:700; color:${saldoPendiente > 0.01 ? "var(--danger)" : "var(--success)"}">${formatMonto(saldoPendiente)}</div></div>
  `;

  const tbody = document.getElementById("cc-tabla-body");
  const emptyState = document.getElementById("cc-empty-state");
  emptyState.style.display = movimientos.length === 0 ? "block" : "none";

  let saldo = 0;
  tbody.innerHTML = "";
  movimientos.forEach((m) => {
    saldo += m.debe - m.haber;
    const tr = document.createElement("tr");
    const destino = m.comprobanteId ? `/facturacion/ficha.html?id=${m.comprobanteId}` : m.ventaId ? `/productos/venta-ficha.html?id=${m.ventaId}` : null;
    if (destino) {
      tr.addEventListener("click", () => (location.href = destino));
    }
    tr.innerHTML = `
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.tipo}</td>
      <td>${m.comprobanteNumero || (m.tipo === "Factura" ? '<span class="hint">Sin emitir</span>' : "-")}</td>
      <td>${m.concepto}</td>
      <td class="num">${m.debe ? formatMonto(m.debe) : ""}</td>
      <td class="num">${m.haber ? formatMonto(m.haber) : ""}</td>
      <td class="num">${formatMonto(saldo)}</td>
    `;
    tbody.appendChild(tr);
  });
}

let cliente = await obtenerCliente(clienteId);
if (!cliente) {
  content.innerHTML = `<div class="card empty-state">No se encontró el cliente.</div>`;
  throw new Error("cliente no encontrado");
}
pintarCliente(cliente);
cargarCuentaCorriente();

document.getElementById("btn-editar").addEventListener("click", async () => {
  const datos = await pedirClienteModal(null, cliente);
  if (!datos) return;
  await actualizarCliente(clienteId, datos.razonSocial, datos.cuit, datos.datosArca, datos.datosContacto);
  cliente = await obtenerCliente(clienteId);
  pintarCliente(cliente);
});

document.getElementById("btn-normalizar").addEventListener("click", async () => {
  const errorEl = document.getElementById("f-error");
  errorEl.style.display = "none";
  errorEl.className = "hint error-text";
  if (!cliente.domicilioEntrega) {
    errorEl.textContent = "Cargá primero un domicilio de entrega (botón Editar).";
    errorEl.style.display = "block";
    return;
  }
  const btn = document.getElementById("btn-normalizar");
  btn.disabled = true;
  try {
    const resultado = await pedirNormalizacionDireccion(cliente.domicilioEntrega, cliente.provincia);
    if (!resultado) return;
    await guardarUbicacionCliente(clienteId, resultado);
    cliente = await obtenerCliente(clienteId);
    pintarCliente(cliente);
  } catch (err) {
    errorEl.textContent = "No se pudo normalizar la dirección: " + (err?.message || "error desconocido");
    errorEl.className = "hint error-text";
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-deudores").addEventListener("click", () => {
  const errorEl = document.getElementById("f-error");
  errorEl.style.display = "none";
  errorEl.className = "hint error-text";
  if (!cliente.cuit) {
    errorEl.textContent = "Este cliente no tiene CUIT/DNI cargado.";
    errorEl.style.display = "block";
    return;
  }
  mostrarCentralDeudores(cliente.cuit.replace(/\D/g, ""), cliente.razonSocial);
});

document.getElementById("btn-reconsultar").addEventListener("click", async () => {
  const errorEl = document.getElementById("f-error");
  errorEl.style.display = "none";
  errorEl.className = "hint error-text";
  if (!cliente.cuit) {
    errorEl.textContent = "Este cliente no tiene CUIT cargado.";
    errorEl.style.display = "block";
    return;
  }
  const btn = document.getElementById("btn-reconsultar");
  btn.disabled = true;
  btn.textContent = "Consultando…";
  try {
    const digitos = soloDigitos(cliente.cuit);
    // Un DNI (7-8 dígitos) no es un identificador válido para ARCA — hace falta el CUIL. Mismo
    // criterio que ya usa pedirClienteModal (js/cliente-modal.js): se prueban los prefijos de
    // persona física (20/27/23/24) contra ARCA hasta encontrar el real, sin pedirle al usuario que
    // elija a mano. Si el cliente ya tiene CUIT/CUIL completo, se consulta directo como siempre.
    let cuitParaGuardar = cliente.cuit;
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
      // Persona resuelta por DNI y ARCA no le encontró ninguna inscripción — es la definición misma
      // de Consumidor Final, no un dato que falte. Nunca se deja en blanco (mismo criterio que
      // js/cliente-modal.js).
      if (!encontrado.datos.condicionIva) encontrado.datos.condicionIva = "Consumidor Final";
      cuitParaGuardar = formatearCuit(encontrado.cuit);
      datosArca = encontrado.datos;
    } else {
      datosArca = await consultarPadronArca(cliente.cuit);
    }
    // actualizarCliente pisa TODO lo que no venga en datosContacto (updateDoc, no merge parcial por
    // campo) — hay que mandar los que ya tenía el cliente, no solo los tres que importan acá, o se
    // pierden en silencio (pasó de verdad: localidad y código postal quedaban en null).
    await actualizarCliente(clienteId, cliente.razonSocial, cuitParaGuardar, datosArca, {
      domicilioEntrega: cliente.domicilioEntrega,
      codigoPostalEntrega: cliente.codigoPostalEntrega,
      localidadEntrega: cliente.localidadEntrega,
      provinciaEntrega: cliente.provinciaEntrega,
      paisEntrega: cliente.paisEntrega,
      whatsapp: cliente.whatsapp,
      email: cliente.email,
    });
    cliente = await obtenerCliente(clienteId);
    pintarCliente(cliente);
  } catch (err) {
    errorEl.textContent = "No se pudo consultar ARCA: " + (err?.message || "error desconocido");
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "🔎 Re-consultar ARCA";
  }
});
