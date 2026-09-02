// Datos para el Dashboard: cada función agrega lo que ya existe en ventas/productos/compras/pagos
// del lado del cliente — sin colecciones nuevas, solo lectura y suma. Igual criterio que las
// cuentas corrientes: se trae todo lo relevante y se calcula acá, no hay totales pre-calculados.
//
// Las tarjetas del Dashboard son el MISMO catálogo que /reportes.html (CATEGORIAS_REPORTES) — todo
// reporte tiene la posibilidad de mostrarse acá como tarjeta resumen. RESUMENES_DASHBOARD define,
// para cada uno, qué número puntual mostrar; si un reporte nuevo no tiene entrada acá, la tarjeta
// simplemente no aparece como opción en "Personalizar" hasta que se le agregue una.
import { db, collection, getDocs, query, where, limit } from "./firebase.js";
import { formatMoneda, formatPorcentaje } from "./formato.js";
import {
  CATEGORIAS_REPORTES,
  reporteResumenVentas,
  reporteVentasPorDia,
  reporteVentasDetalle,
  reporteProductosMasVendidos,
  reporteMejoresClientes,
  reporteValorizacionStock,
  reporteStockCritico,
  reporteFacturasPorVencer,
  reportePosicionIva,
  reporteFormasDePago,
  reporteVentasPorCategoria,
  reporteRentabilidadPorProducto,
  reporteClientesDetalle,
} from "./reportes.js";

export { CATEGORIAS_REPORTES };

const PERIODOS = ["Hoy", "Ayer", "Esta semana", "Este mes", "Mes anterior", "Personalizado"];
export { PERIODOS };

function primerDiaDelMes(fechaStr) {
  return fechaStr.slice(0, 8) + "01";
}

function mesAnterior(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  return fechaISO(d);
}

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
// en ventas/compras. "Personalizado" ignora los presets y usa el {desde,hasta} que se le pase.
export function rangoPeriodo(periodo, personalizado) {
  const hoy = fechaISO(new Date());

  if (periodo === "Personalizado" && personalizado?.desde && personalizado?.hasta) {
    const { desde, hasta } = personalizado;
    const dias = Math.round((new Date(hasta + "T00:00:00Z") - new Date(desde + "T00:00:00Z")) / 86400000) + 1;
    return { desde, hasta, desdeAnterior: sumarDias(desde, -dias), hastaAnterior: sumarDias(desde, -1) };
  }
  if (periodo === "Hoy") {
    return { desde: hoy, hasta: hoy, desdeAnterior: sumarDias(hoy, -1), hastaAnterior: sumarDias(hoy, -1) };
  }
  if (periodo === "Ayer") {
    const ayer = sumarDias(hoy, -1);
    return { desde: ayer, hasta: ayer, desdeAnterior: sumarDias(ayer, -1), hastaAnterior: sumarDias(ayer, -1) };
  }
  if (periodo === "Esta semana") {
    const d = new Date(hoy + "T00:00:00Z");
    const diaSemana = (d.getUTCDay() + 6) % 7; // lunes = 0
    const desde = sumarDias(hoy, -diaSemana);
    return { desde, hasta: hoy, desdeAnterior: sumarDias(desde, -7), hastaAnterior: sumarDias(hoy, -7) };
  }
  if (periodo === "Mes anterior") {
    const primerDiaEsteMes = primerDiaDelMes(hoy);
    const ultimoDiaMesAnterior = sumarDias(primerDiaEsteMes, -1);
    const primerDiaMesAnterior = primerDiaDelMes(ultimoDiaMesAnterior);
    const finDosMesesAtras = sumarDias(primerDiaMesAnterior, -1);
    const inicioDosMesesAtras = primerDiaDelMes(finDosMesesAtras);
    return { desde: primerDiaMesAnterior, hasta: ultimoDiaMesAnterior, desdeAnterior: inicioDosMesesAtras, hastaAnterior: finDosMesesAtras };
  }
  // "Este mes"
  const desde = primerDiaDelMes(hoy);
  const desdeAnterior = mesAnterior(desde);
  const diasTranscurridos = (new Date(hoy + "T00:00:00Z") - new Date(desde + "T00:00:00Z")) / 86400000;
  const hastaAnterior = sumarDias(desdeAnterior, diasTranscurridos);
  return { desde, hasta: hoy, desdeAnterior, hastaAnterior };
}

// Saldo global a cobrar: solo hace falta mirar cobros de las ventas que arrancaron con algo
// pendiente (ver ventas.js) — el resto ya se sabe saldadas.
async function obtenerSaldoClientes() {
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

function formatMonto(valor) {
  return formatMoneda(valor);
}

function variacion(actual, anterior) {
  if (!anterior) return null;
  const pct = ((actual - anterior) / anterior) * 100;
  const signo = pct >= 0 ? "+" : "";
  return { texto: `${signo}${formatPorcentaje(pct)} vs. período anterior`, positivo: pct >= 0 };
}

// Un resumen para tarjeta = { valor, sub?, comparacion?, serie? (para sparkline) }. rango trae
// {desde, hasta, desdeAnterior, hastaAnterior} de rangoPeriodo() — los reportes "sin período" (stock
// crítico, valorización, facturas por vencer) simplemente lo ignoran.
export const RESUMENES_DASHBOARD = {
  "resumen-ventas": async ({ desde, hasta, desdeAnterior, hastaAnterior }) => {
    const [actual, anterior, serie] = await Promise.all([
      reporteResumenVentas(desde, hasta),
      reporteResumenVentas(desdeAnterior, hastaAnterior),
      reporteVentasPorDia(desde, hasta),
    ]);
    return { valor: formatMonto(actual.total), comparacion: variacion(actual.total, anterior.total), serie: serie.map((d) => d.total) };
  },
  "productos-mas-vendidos": async ({ desde, hasta }) => {
    const top = await reporteProductosMasVendidos(desde, hasta, 1);
    return top.length ? { valor: top[0].productoDescripcion, sub: `${top[0].cantidad} unidades vendidas` } : { valor: "Sin ventas" };
  },
  "mejores-clientes": async ({ desde, hasta }) => {
    const top = await reporteMejoresClientes(desde, hasta, 1);
    return top.length ? { valor: top[0].clienteNombre, sub: formatMonto(top[0].total) } : { valor: "Sin ventas" };
  },
  rentabilidad: async ({ desde, hasta, desdeAnterior, hastaAnterior }) => {
    const [actual, anterior] = await Promise.all([reporteResumenVentas(desde, hasta), reporteResumenVentas(desdeAnterior, hastaAnterior)]);
    return { valor: formatMonto(actual.margenBruto), comparacion: variacion(actual.margenBruto, anterior.margenBruto) };
  },
  "valorizacion-stock": async () => {
    const { total } = await reporteValorizacionStock(1);
    return { valor: formatMonto(total) };
  },
  "stock-critico": async () => {
    const lista = await reporteStockCritico();
    return { valor: String(lista.length) };
  },
  "cuenta-corriente-clientes": async () => {
    const { saldoTotal } = await obtenerSaldoClientes();
    return { valor: formatMonto(saldoTotal) };
  },
  "cuenta-corriente-proveedores": async () => {
    const lista = await reporteFacturasPorVencer();
    const saldoTotal = lista.reduce((acc, f) => acc + f.saldo, 0);
    return { valor: formatMonto(saldoTotal) };
  },
  "facturas-vencer": async () => {
    const lista = await reporteFacturasPorVencer();
    return { valor: String(lista.length) };
  },
  "posicion-iva": async ({ desde, hasta }) => {
    const pos = await reportePosicionIva(desde, hasta);
    return { valor: formatMonto(pos.saldoAFavorEstimado) };
  },
  "ventas-detalle": async ({ desde, hasta }) => {
    const lista = await reporteVentasDetalle(desde, hasta);
    return { valor: String(lista.length), sub: "operaciones en el período" };
  },
  "formas-pago": async ({ desde, hasta }) => {
    const lista = await reporteFormasDePago(desde, hasta);
    return lista.length ? { valor: lista[0].medio, sub: `${lista[0].porcentaje}% de las ventas` } : { valor: "Sin ventas" };
  },
  "ventas-por-categoria": async ({ desde, hasta }) => {
    const lista = await reporteVentasPorCategoria(desde, hasta);
    return lista.length ? { valor: lista[0].categoriaNombre, sub: formatMonto(lista[0].ventas) } : { valor: "Sin ventas" };
  },
  "rentabilidad-productos": async ({ desde, hasta }) => {
    const lista = await reporteRentabilidadPorProducto(desde, hasta, 1);
    return lista.length ? { valor: lista[0].productoDescripcion, sub: `${formatMonto(lista[0].ganancia)} de ganancia` } : { valor: "Sin ventas" };
  },
  "rentabilidad-categorias": async ({ desde, hasta }) => {
    const lista = await reporteVentasPorCategoria(desde, hasta);
    return lista.length ? { valor: lista[0].categoriaNombre, sub: `${formatMonto(lista[0].ganancia)} de ganancia` } : { valor: "Sin ventas" };
  },
  "clientes-detalle": async ({ desde, hasta }) => {
    const lista = await reporteClientesDetalle(desde, hasta);
    return { valor: String(lista.length), sub: "clientes con compras en el período" };
  },
};
