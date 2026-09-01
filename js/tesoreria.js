// Agregación de Tesorería: junta lo que ya calculan cajas.js/bancos.js/cuentas-por-cobrar.js/gastos.js
// en las vistas que pide el módulo (Posición de Tesorería, Movimientos unificados, Centro de
// Pendientes). No duplica datos — todo sale de consultar las colecciones reales cada vez.
import { listarCajas, sesionAbiertaDeCaja, listarMovimientosPorSesion, saldoSesion, listarSesionesAbiertas, listarSesionesPorCaja } from "./cajas.js";
import { listarCuentasBancariasActivas, listarMovimientosPorCuenta, saldoCuenta, listarMovimientosBancariosPendientes } from "./bancos.js";
import { listarCuentasPorCobrarPendientes, MEDIOS_CUENTA_POR_COBRAR, estaVencida, estaProximaAVencer } from "./cuentas-por-cobrar.js";
import { listarGastos } from "./gastos.js";
import { listarCompras } from "./compras.js";
import { listarPagos } from "./pagos.js";
import { db, collection, getDocs, query } from "./firebase.js";

const HOY = () => new Date().toISOString().slice(0, 10);
const INICIO_MES = () => HOY().slice(0, 8) + "01";

// { caja, saldo, sesion } por cada caja del negocio (o filtrado por sucursal).
export async function saldosPorCaja(sucursalId = null) {
  const cajas = (await listarCajas()).filter((c) => c.activa !== false && (!sucursalId || c.sucursalId === sucursalId));
  return Promise.all(
    cajas.map(async (caja) => {
      const abierta = await sesionAbiertaDeCaja(caja.id);
      if (abierta) {
        const movimientos = await listarMovimientosPorSesion(abierta.id);
        return { caja, saldo: saldoSesion(abierta, movimientos), sesion: abierta };
      }
      const sesiones = await listarSesionesPorCaja(caja.id, 1);
      return { caja, saldo: sesiones[0]?.dineroContado ?? 0, sesion: sesiones[0] || null };
    })
  );
}

// { cuenta, saldo } por cada cuenta bancaria activa (o filtrado por sucursal).
export async function saldosPorCuentaBancaria(sucursalId = null) {
  const cuentas = (await listarCuentasBancariasActivas()).filter((c) => !sucursalId || c.sucursalId === sucursalId);
  return Promise.all(
    cuentas.map(async (cuenta) => {
      const movimientos = await listarMovimientosPorCuenta(cuenta.id);
      return { cuenta, saldo: saldoCuenta(movimientos) };
    })
  );
}

function totalPorMedio(cuentas, medio) {
  return Math.round(cuentas.filter((c) => c.medio === medio).reduce((acc, c) => acc + (c.saldoPendiente || 0), 0) * 100) / 100;
}

// El dashboard central: DISPONIBLE AHORA / POR ACREDITAR / GASTOS DEL MES / DIFERENCIAS DE CAJA /
// PENDIENTES DE CONCILIAR / POSICIÓN PROYECTADA — todo derivado de movimientos reales, nada tipeado.
export async function posicionTesoreria(sucursalId = null) {
  const [cajas, cuentas, cuentasPorCobrar, gastosDelMes, movBancariosPendientes, compras, pagos, sesionesAbiertas] = await Promise.all([
    saldosPorCaja(sucursalId),
    saldosPorCuentaBancaria(sucursalId),
    listarCuentasPorCobrarPendientes(),
    listarGastos({ desde: INICIO_MES(), hasta: HOY(), sucursalId: sucursalId || undefined, maxResultados: 1000 }),
    listarMovimientosBancariosPendientes(),
    listarCompras(500),
    listarPagos(500),
    listarSesionesAbiertas(),
  ]);

  const efectivo = Math.round(cajas.reduce((acc, c) => acc + c.saldo, 0) * 100) / 100;
  const bancos = Math.round(cuentas.reduce((acc, c) => acc + c.saldo, 0) * 100) / 100;
  // "Mercado Pago disponible" como cuenta separada solo existe si se cargó una cuenta bancaria que
  // representa la billetera de Mercado Pago (banco = "Mercado Pago") — no se inventa un saldo aparte.
  const mercadoPagoDisponible = Math.round(cuentas.filter((c) => c.cuenta.bancoNombre === "Mercado Pago").reduce((acc, c) => acc + c.saldo, 0) * 100) / 100;

  const cxcActivas = sucursalId ? cuentasPorCobrar.filter((c) => c.sucursalId === sucursalId) : cuentasPorCobrar;
  const porAcreditar = {
    mercadoPago: totalPorMedio(cxcActivas, "Mercado Pago"),
    tarjetas: totalPorMedio(cxcActivas, "Tarjeta de crédito"),
    gocuotas: totalPorMedio(cxcActivas, "GoCuotas"),
    bostonCred: totalPorMedio(cxcActivas, "Boston Cred"),
  };
  porAcreditar.total = Math.round((porAcreditar.mercadoPago + porAcreditar.tarjetas + porAcreditar.gocuotas + porAcreditar.bostonCred) * 100) / 100;

  const gastosMes = Math.round(gastosDelMes.filter((g) => g.estado !== "anulado").reduce((acc, g) => acc + g.importe, 0) * 100) / 100;

  const totalCompras = compras.reduce((acc, c) => acc + (c.total || 0), 0);
  const totalPagosProveedores = pagos.reduce((acc, p) => acc + (p.monto || 0), 0);
  const egresosComprometidos = Math.round(Math.max(totalCompras - totalPagosProveedores, 0) * 100) / 100;

  const sesionesCerradasDelMes = (
    await Promise.all(cajas.map((c) => listarSesionesPorCaja(c.caja.id, 20)))
  ).flat().filter((s) => s.estado === "cerrada" && s.fechaCierre?.toDate?.() >= new Date(INICIO_MES()));
  const diferenciasCaja = Math.round(sesionesCerradasDelMes.reduce((acc, s) => acc + Math.abs(s.diferencia || 0), 0) * 100) / 100;

  const disponibleTotal = Math.round((efectivo + bancos) * 100) / 100;

  return {
    disponible: { efectivo, bancos, mercadoPagoDisponible, total: disponibleTotal },
    porAcreditar,
    gastosDelMes: gastosMes,
    diferenciasCaja,
    diferenciasCajaCantidad: sesionesCerradasDelMes.filter((s) => Math.abs(s.diferencia || 0) > 0.01).length,
    movimientosPendientesConciliar: movBancariosPendientes.length,
    egresosComprometidos,
    cajasSinCerrar: sesionesAbiertas.length,
    posicionProyectada: Math.round((disponibleTotal + porAcreditar.total - egresosComprometidos) * 100) / 100,
  };
}

export async function posicionPorSucursal() {
  const cajas = await listarCajas();
  const sucursales = [...new Map(cajas.map((c) => [c.sucursalId, c.sucursalNombre])).entries()];
  return Promise.all(
    sucursales.map(async ([sucursalId, sucursalNombre]) => ({
      sucursalId,
      sucursalNombre,
      ...(await posicionTesoreria(sucursalId)),
    }))
  );
}

// Centro de Pendientes: todo lo que requiere una acción humana, junto en una sola lista.
export async function centroDePendientes() {
  const [sesionesAbiertas, movBancariosPendientes, cuentasPorCobrar] = await Promise.all([
    listarSesionesAbiertas(),
    listarMovimientosBancariosPendientes(),
    listarCuentasPorCobrarPendientes(),
  ]);
  const hoy = HOY();
  return {
    cajasSinCerrar: sesionesAbiertas,
    movimientosBancariosPendientes: movBancariosPendientes,
    cuentasPorCobrarVencidas: cuentasPorCobrar.filter((c) => estaVencida(c, hoy)),
    cuentasPorCobrarProximasAVencer: cuentasPorCobrar.filter((c) => estaProximaAVencer(c, 7, hoy)),
    cuentasPorCobrarPorMedio: Object.fromEntries(MEDIOS_CUENTA_POR_COBRAR.map((m) => [m, cuentasPorCobrar.filter((c) => c.medio === m)])),
  };
}

// Historial unificado: movimientos de caja + movimientos bancarios, mismo shape para poder listarlos
// juntos en Tesorería → Movimientos (no es una colección nueva — se arma en el momento, igual que ya
// hace productos/cuenta-corriente-clientes.js con ventas+cobros).
export async function listarMovimientosTesoreria({ desde, hasta } = {}) {
  const [cajaSnap, bancoSnap] = await Promise.all([
    getDocs(query(collection(db, "movimientosCaja"))),
    getDocs(query(collection(db, "movimientosBancarios"))),
  ]);
  const deCaja = cajaSnap.docs.map((d) => ({ id: d.id, origenTipo: "caja", ...d.data() }));
  const deBanco = bancoSnap.docs.map((d) => ({ id: d.id, origenTipo: "banco", ...d.data() }));
  let todos = [...deCaja, ...deBanco];
  if (desde) todos = todos.filter((m) => m.fecha >= desde);
  if (hasta) todos = todos.filter((m) => m.fecha <= hasta);
  return todos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
}
