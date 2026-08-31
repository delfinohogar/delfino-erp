// Módulo de Reportes: series y agregados sobre ventas, para el Dashboard y la pantalla de Reportes.
// Todo se calcula al vuelo sobre /ventas — sin totales pre-calculados, mismo criterio que el resto
// del sistema (cuentas corrientes, Dashboard).
import { db, collection, getDocs, query, where } from "./firebase.js";

// Catálogo de reportes disponibles, agrupados por categoría — el catálogo de /reportes.html se arma
// a partir de esto, así que sumar un reporte nuevo es agregarlo acá una sola vez.
export const CATEGORIAS_REPORTES = [
  {
    categoria: "Ventas",
    reportes: [
      { id: "resumen-ventas", titulo: "Resumen de ventas", descripcion: "Total, cantidad y evolución diaria del período." },
      { id: "productos-mas-vendidos", titulo: "Productos más vendidos", descripcion: "Ranking por unidades vendidas." },
      { id: "mejores-clientes", titulo: "Mejores clientes", descripcion: "Clientes con mayor facturación del período." },
      { id: "rentabilidad", titulo: "Rentabilidad bruta", descripcion: "Margen real: precio de venta menos costo al momento de vender." },
    ],
  },
  {
    categoria: "Inventario",
    reportes: [
      { id: "valorizacion-stock", titulo: "Valorización de stock", descripcion: "Capital inmovilizado en inventario, valorizado al costo." },
    ],
  },
  {
    categoria: "Financieros",
    reportes: [
      { id: "cuenta-corriente-clientes", titulo: "Cuenta corriente de clientes", descripcion: "Saldo a cobrar por cliente.", href: "/productos/cuenta-corriente-clientes.html" },
      { id: "cuenta-corriente-proveedores", titulo: "Cuenta corriente de proveedores", descripcion: "Saldo adeudado por proveedor.", href: "/productos/cuenta-corriente.html" },
    ],
  },
  {
    categoria: "Impositivo",
    reportes: [
      { id: "posicion-iva", titulo: "Posición IVA", descripcion: "Débito fiscal de ventas contra crédito fiscal de compras del período." },
    ],
  },
];

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}

function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return fechaISO(d);
}

async function ventasEnRango(desde, hasta) {
  const snap = await getDocs(query(collection(db, "ventas"), where("fecha", ">=", desde), where("fecha", "<=", hasta)));
  return snap.docs.map((d) => d.data());
}

// Serie diaria de ventas (total $ y cantidad), con todos los días del rango presentes aunque no
// hayan tenido ventas — para que el gráfico no tenga huecos.
export async function reporteVentasPorDia(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  const porDia = {};
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    porDia[f] = { fecha: f, total: 0, cantidad: 0 };
  }
  ventas.forEach((v) => {
    if (!porDia[v.fecha]) porDia[v.fecha] = { fecha: v.fecha, total: 0, cantidad: 0 };
    porDia[v.fecha].total += v.total || 0;
    porDia[v.fecha].cantidad += 1;
  });
  return Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export async function reporteVentasPorMedioPago(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  const porMedio = {};
  ventas.forEach((v) => {
    (v.pagos || []).forEach((p) => {
      porMedio[p.medio] = (porMedio[p.medio] || 0) + (p.monto || 0);
    });
  });
  return Object.entries(porMedio)
    .map(([medio, monto]) => ({ medio, monto: Math.round(monto * 100) / 100 }))
    .sort((a, b) => b.monto - a.monto);
}

// Total vendido, cantidad, ticket promedio, unidades y margen bruto real (precio menos costoUnitario
// — la foto del costo que se guarda en cada ítem al momento de vender, ver ventas.js). Ninguna otra
// parte del sistema calcula esto todavía, así que vive acá.
export async function reporteResumenVentas(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  let total = 0;
  let unidades = 0;
  let margenBruto = 0;
  ventas.forEach((v) => {
    total += v.total || 0;
    (v.items || []).forEach((it) => {
      unidades += it.cantidad || 0;
      margenBruto += (it.subtotal || 0) - (it.costoUnitario || 0) * (it.cantidad || 0);
    });
  });
  const cantidad = ventas.length;
  return {
    total: Math.round(total * 100) / 100,
    cantidad,
    ticketPromedio: cantidad > 0 ? Math.round((total / cantidad) * 100) / 100 : 0,
    unidades,
    margenBruto: Math.round(margenBruto * 100) / 100,
  };
}

export async function reporteMejoresClientes(desde, hasta, top = 8) {
  const ventas = await ventasEnRango(desde, hasta);
  const porCliente = {};
  ventas.forEach((v) => {
    const key = v.clienteId || "consumidor-final";
    if (!porCliente[key]) porCliente[key] = { clienteNombre: v.clienteNombre || "Consumidor final", total: 0, cantidad: 0 };
    porCliente[key].total += v.total || 0;
    porCliente[key].cantidad += 1;
  });
  return Object.values(porCliente)
    .sort((a, b) => b.total - a.total)
    .slice(0, top);
}

export async function reporteVentasPorVendedor(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  const porVendedor = {};
  ventas.forEach((v) => {
    const key = v.vendedorId || "-";
    if (!porVendedor[key]) porVendedor[key] = { vendedorNombre: v.vendedorNombre || "-", total: 0 };
    porVendedor[key].total += v.total || 0;
  });
  return Object.values(porVendedor).sort((a, b) => b.total - a.total);
}

// Capital inmovilizado en stock: stockTotal * costoReferencia de cada producto activo. No depende
// de un rango de fechas — es una foto del inventario actual, no una evolución en el tiempo.
export async function reporteValorizacionStock(top = 10) {
  const snap = await getDocs(query(collection(db, "productos"), where("estado", "==", "activo")));
  const productos = snap.docs
    .map((d) => d.data())
    .map((p) => ({
      productoDescripcion: p.descripcion,
      stockTotal: p.stockTotal ?? 0,
      costoReferencia: p.costoReferencia ?? 0,
      valorizado: (p.stockTotal ?? 0) * (p.costoReferencia ?? 0),
    }))
    .filter((p) => p.valorizado > 0);

  const total = productos.reduce((acc, p) => acc + p.valorizado, 0);
  const principales = productos.sort((a, b) => b.valorizado - a.valorizado).slice(0, top);
  return { total: Math.round(total * 100) / 100, principales };
}

// Posición IVA del período: débito fiscal (IVA de lo vendido) contra crédito fiscal (IVA de lo
// comprado). El sistema no discrimina IVA en las ventas todavía (no factura fiscalmente) — por eso
// el débito fiscal da $0 siempre, no es un error, es lo que hay hasta que exista facturación
// electrónica. Retenciones no se registran en ningún lado del sistema, así que van en $0 explícito
// en vez de inventar un valor.
export async function reportePosicionIva(desde, hasta) {
  // compras.fecha es un Timestamp (a diferencia de ventas.fecha, que es un string) — no se puede
  // filtrar por rango del lado de Firestore sin que los tipos coincidan, así que se trae todo y se
  // filtra acá, mismo criterio defensivo que ya usa cuenta-corriente.js con esta misma colección.
  const snap = await getDocs(collection(db, "compras"));
  const compras = snap.docs
    .map((d) => d.data())
    .filter((c) => {
      const fechaStr = c.fecha?.toDate ? fechaISO(c.fecha.toDate()) : c.fecha;
      return fechaStr >= desde && fechaStr <= hasta;
    });
  const creditoFiscalCompras = compras.reduce((acc, c) => acc + (c.ivaTotal || 0), 0);
  const percepcionesSufridas = compras.reduce((acc, c) => acc + (c.percepciones || 0), 0);
  const debitoFiscalVentas = 0;
  // Positivo = a favor nuestro (crédito > débito). Retenciones/percepciones que ya nos aplicaron
  // suman a favor — son IVA que ya "pagamos" de más y se puede usar contra el saldo técnico.
  const saldoTecnico = creditoFiscalCompras - debitoFiscalVentas;
  const retencionesSufridas = 0;
  const saldoAFavorEstimado = saldoTecnico + retencionesSufridas + percepcionesSufridas;

  return {
    debitoFiscalVentas,
    creditoFiscalCompras: Math.round(creditoFiscalCompras * 100) / 100,
    saldoTecnico: Math.round(saldoTecnico * 100) / 100,
    retencionesSufridas,
    percepcionesSufridas: Math.round(percepcionesSufridas * 100) / 100,
    saldoAFavorEstimado: Math.round(saldoAFavorEstimado * 100) / 100,
  };
}

export async function reporteProductosMasVendidos(desde, hasta, top = 8) {
  const ventas = await ventasEnRango(desde, hasta);
  const porProducto = {};
  ventas.forEach((v) => {
    (v.items || []).forEach((it) => {
      if (!porProducto[it.productoId]) {
        porProducto[it.productoId] = { productoDescripcion: it.productoDescripcion, cantidad: 0, total: 0 };
      }
      porProducto[it.productoId].cantidad += it.cantidad;
      porProducto[it.productoId].total += it.subtotal || 0;
    });
  });
  return Object.values(porProducto)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, top);
}
