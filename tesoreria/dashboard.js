import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { posicionTesoreria, posicionPorSucursal, centroDePendientes } from "/js/tesoreria.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "tesoreria-dashboard", titulo: "Tesorería", usuario });

function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}
function formatFechaHora(v) {
  if (!v) return "-";
  const f = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}

content.innerHTML = `<div class="hint">Cargando posición de tesorería…</div>`;

const [posicion, porSucursal, pendientes] = await Promise.all([posicionTesoreria(), posicionPorSucursal(), centroDePendientes()]);

const totalPendientesAccion =
  pendientes.cajasSinCerrar.length +
  pendientes.movimientosBancariosPendientes.length +
  pendientes.cuentasPorCobrarVencidas.length;

content.innerHTML = `
  <div class="dashboard-grid" style="margin-bottom:16px">
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">💰 Disponible</div>
      <div class="dashboard-card-valor">${formatMonto(posicion.disponible.total)}</div>
      <div class="hint">Caja ${formatMonto(posicion.disponible.efectivo)} · Bancos ${formatMonto(posicion.disponible.bancos)}</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">🟡 Por acreditar</div>
      <div class="dashboard-card-valor">${formatMonto(posicion.porAcreditar.total)}</div>
      <div class="hint">MP ${formatMonto(posicion.porAcreditar.mercadoPago)} · Tarjetas ${formatMonto(posicion.porAcreditar.tarjetas)} · GoCuotas ${formatMonto(posicion.porAcreditar.gocuotas)} · Boston ${formatMonto(posicion.porAcreditar.bostonCred)}</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">💸 Gastos del mes</div>
      <div class="dashboard-card-valor">${formatMonto(posicion.gastosDelMes)}</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">⚖️ Diferencias de caja (mes)</div>
      <div class="dashboard-card-valor" style="color:${posicion.diferenciasCaja > 0 ? "var(--warning)" : "inherit"}">${formatMonto(posicion.diferenciasCaja)}</div>
      <div class="hint">${posicion.diferenciasCajaCantidad} cierre(s) con diferencia</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">🏦 Movimientos sin conciliar</div>
      <div class="dashboard-card-valor">${posicion.movimientosPendientesConciliar}</div>
    </div>
    <div class="card dashboard-card">
      <div class="hint" style="margin:0">📈 Posición proyectada</div>
      <div class="dashboard-card-valor" style="color:${posicion.posicionProyectada >= 0 ? "var(--success)" : "var(--danger)"}">${formatMonto(posicion.posicionProyectada)}</div>
      <div class="hint">Disponible + por acreditar − comprometido con proveedores (${formatMonto(posicion.egresosComprometidos)})</div>
    </div>
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">Por sucursal</div>
    ${
      porSucursal.length === 0
        ? `<div class="hint">Todavía no hay cajas cargadas — <a href="/tesoreria/cajas.html">crear la primera</a>.</div>`
        : `<div class="table-scroll"><table>
        <thead><tr><th>Sucursal</th><th style="text-align:right">Caja</th><th style="text-align:right">Bancos</th><th style="text-align:right">Por acreditar</th></tr></thead>
        <tbody>
          ${porSucursal
            .map(
              (s) => `
            <tr>
              <td>${s.sucursalNombre || "Sin sucursal"}</td>
              <td style="text-align:right">${formatMonto(s.disponible.efectivo)}</td>
              <td style="text-align:right">${formatMonto(s.disponible.bancos)}</td>
              <td style="text-align:right">${formatMonto(s.porAcreditar.total)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table></div>`
    }
  </div>

  <div class="card" style="padding:20px; margin-bottom:16px">
    <div class="section-title">⚠️ Pendientes de Tesorería ${totalPendientesAccion > 0 ? `<span class="badge warning">${totalPendientesAccion}</span>` : ""}</div>
    ${
      totalPendientesAccion === 0 && pendientes.cuentasPorCobrarProximasAVencer.length === 0
        ? `<div class="hint">Sin pendientes. 🟢</div>`
        : `
      ${
        pendientes.cajasSinCerrar.length > 0
          ? `<div style="margin-bottom:10px"><strong>Cajas sin cerrar (${pendientes.cajasSinCerrar.length})</strong>${pendientes.cajasSinCerrar
              .map((s) => `<div class="hint">— ${s.cajaNombre} (${s.sucursalNombre}), abierta desde ${formatFechaHora(s.fechaApertura)} · <a href="/tesoreria/caja-ficha.html?id=${s.cajaId}">Ver</a></div>`)
              .join("")}</div>`
          : ""
      }
      ${
        pendientes.movimientosBancariosPendientes.length > 0
          ? `<div style="margin-bottom:10px"><strong>Movimientos bancarios sin conciliar (${pendientes.movimientosBancariosPendientes.length})</strong> · <a href="/tesoreria/conciliacion.html">Ir a conciliación</a></div>`
          : ""
      }
      ${
        pendientes.cuentasPorCobrarVencidas.length > 0
          ? `<div style="margin-bottom:10px"><strong style="color:var(--danger)">Cuentas por cobrar vencidas (${pendientes.cuentasPorCobrarVencidas.length})</strong> · <a href="/tesoreria/cuentas-por-cobrar.html">Ver</a></div>`
          : ""
      }
      ${
        pendientes.cuentasPorCobrarProximasAVencer.length > 0
          ? `<div><strong style="color:var(--warning)">Próximas a vencer, 7 días (${pendientes.cuentasPorCobrarProximasAVencer.length})</strong> · <a href="/tesoreria/cuentas-por-cobrar.html">Ver</a></div>`
          : ""
      }
    `
    }
  </div>

  <div class="toolbar">
    <a href="/tesoreria/cajas.html"><button type="button">🧾 Cajas</button></a>
    <a href="/tesoreria/bancos.html"><button type="button">🏦 Bancos</button></a>
    <a href="/tesoreria/cuentas-por-cobrar.html"><button type="button">💰 Cuentas por cobrar</button></a>
    <a href="/tesoreria/gastos.html"><button type="button">💸 Gastos</button></a>
    <a href="/tesoreria/transferencias.html"><button type="button">🔁 Transferencias</button></a>
    <a href="/tesoreria/movimientos.html"><button type="button">📋 Movimientos</button></a>
    <a href="/tesoreria/conciliacion.html"><button type="button">✅ Conciliación</button></a>
  </div>
`;
