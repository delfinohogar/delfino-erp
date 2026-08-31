// Datos para el Dashboard: cada función agrega lo que ya existe en ventas/productos/compras/pagos
// del lado del cliente — sin colecciones nuevas, solo lectura y suma. Igual criterio que las
// cuentas corrientes: se trae todo lo relevante y se calcula acá, no hay totales pre-calculados.
import { db, collection, getDocs, query, where, limit } from "./firebase.js";

export const TARJETAS_DASHBOARD = [
  { id: "ventas-totales", titulo: "Ventas totales" },
  { id: "cantidad-ventas", titulo: "Cantidad de ventas" },
  { id: "stock-critico", titulo: "Stock crítico" },
  { id: "cuentas-cobrar", titulo: "Cuentas por cobrar" },
  { id: "cuentas-pagar", titulo: "Cuentas por pagar" },
  { id: "facturas-vencer", titulo: "Facturas próximas a vencer" },
];

const PERIODOS = ["Hoy", "Esta semana", "Este mes"];
export { PERIODOS };

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}

function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return fechaISO(d);
}

// Rango del período elegido y el rango equivalente inmediatamente anterior, para poder comparar
// ("esta semana" vs "la semana pasada", etc.) — todo en fechas YYYY-MM-DD, mismo formato que fecha
// en ventas/compras.
export function rangoPeriodo(periodo) {
  const hoy = fechaISO(new Date());
  if (periodo === "Hoy") {
    return { desde: hoy, hasta: hoy, desdeAnterior: sumarDias(hoy, -1), hastaAnterior: sumarDias(hoy, -1) };
  }
  if (periodo === "Esta semana") {
    const d = new Date(hoy + "T00:00:00Z");
    const diaSemana = (d.getUTCDay() + 6) % 7; // lunes = 0
    const desde = sumarDias(hoy, -diaSemana);
    return { desde, hasta: hoy, desdeAnterior: sumarDias(desde, -7), hastaAnterior: sumarDias(hoy, -7) };
  }
  // "Este mes"
  const desde = hoy.slice(0, 8) + "01";
  const mesAnteriorDate = new Date(desde + "T00:00:00Z");
  mesAnteriorDate.setUTCMonth(mesAnteriorDate.getUTCMonth() - 1);
  const desdeAnterior = fechaISO(mesAnteriorDate);
  const diasTranscurridos = (new Date(hoy + "T00:00:00Z") - new Date(desde + "T00:00:00Z")) / 86400000;
  const hastaAnterior = sumarDias(desdeAnterior, diasTranscurridos);
  return { desde, hasta: hoy, desdeAnterior, hastaAnterior };
}

export async function obtenerVentasPeriodo(desde, hasta) {
  const snap = await getDocs(query(collection(db, "ventas"), where("fecha", ">=", desde), where("fecha", "<=", hasta)));
  const ventas = snap.docs.map((d) => d.data());
  return {
    total: ventas.reduce((acc, v) => acc + (v.total || 0), 0),
    cantidad: ventas.length,
  };
}

export async function obtenerStockCritico() {
  const snap = await getDocs(query(collection(db, "productos"), where("estado", "==", "activo")));
  const criticos = snap.docs
    .map((d) => d.data())
    .filter((p) => (p.stockTotal ?? 0) <= (p.stockMinimo ?? 0));
  return { cantidad: criticos.length };
}

// Saldo global a cobrar: solo hace falta mirar cobros de las ventas que arrancaron con algo
// pendiente (ver ventas.js) — el resto ya se sabe saldadas.
export async function obtenerSaldoClientes() {
  const ventasSnap = await getDocs(query(collection(db, "ventas"), where("montoPendiente", ">", 0)));
  const ventas = ventasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (ventas.length === 0) return { saldoTotal: 0 };

  const cobrosSnap = await getDocs(query(collection(db, "cobros"), limit(500)));
  const cobros = cobrosSnap.docs.map((d) => d.data());

  const saldoTotal = ventas.reduce((acc, v) => {
    const cobrado = cobros.filter((c) => c.ventaId === v.id).reduce((a, c) => a + (c.monto || 0), 0);
    return acc + Math.max((v.total || 0) - cobrado, 0);
  }, 0);
  return { saldoTotal: Math.round(saldoTotal * 100) / 100 };
}

// Saldo global adeudado a proveedores y facturas por vencer en los próximos 7 días (o ya vencidas).
export async function obtenerCuentaProveedores() {
  const [comprasSnap, pagosSnap] = await Promise.all([
    getDocs(query(collection(db, "compras"), limit(500))),
    getDocs(query(collection(db, "pagosProveedores"), limit(500))),
  ]);
  const compras = comprasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const pagos = pagosSnap.docs.map((d) => d.data());

  const limite7dias = sumarDias(fechaISO(new Date()), 7);
  let saldoTotal = 0;
  let facturasPorVencer = 0;

  compras.forEach((c) => {
    const pagado = pagos.filter((p) => p.compraId === c.id).reduce((acc, p) => acc + (p.monto || 0), 0);
    const saldo = (c.total || 0) - pagado;
    if (saldo <= 0.01) return;
    saldoTotal += saldo;
    if (c.fechaVencimiento && c.fechaVencimiento <= limite7dias) facturasPorVencer++;
  });

  return { saldoTotal: Math.round(saldoTotal * 100) / 100, facturasPorVencer };
}
