// Módulo de Reportes: series y agregados sobre ventas, para el Dashboard y la pantalla de Reportes.
// Todo se calcula al vuelo sobre /ventas — sin totales pre-calculados, mismo criterio que el resto
// del sistema (cuentas corrientes, Dashboard).
import { db, collection, getDocs, query, where } from "./firebase.js";
import { libroIvaVentas } from "./libro-iva.js";

// Catálogo de reportes disponibles, agrupados por categoría — el catálogo de /reportes.html se arma
// a partir de esto, así que sumar un reporte nuevo es agregarlo acá una sola vez.
export const CATEGORIAS_REPORTES = [
  {
    categoria: "Ventas",
    reportes: [
      { id: "resumen-ventas", titulo: "Resumen de ventas", descripcion: "Total, cantidad y evolución diaria del período." },
      { id: "ventas-detalle", titulo: "Detalle de ventas", descripcion: "Listado completo de ventas del período, con margen y forma de pago." },
      { id: "productos-mas-vendidos", titulo: "Productos más vendidos", descripcion: "Ranking por unidades vendidas." },
      { id: "mejores-clientes", titulo: "Mejores clientes", descripcion: "Clientes con mayor facturación del período." },
    ],
  },
  {
    categoria: "Inventario",
    reportes: [
      { id: "valorizacion-stock", titulo: "Valorización de stock", descripcion: "Capital inmovilizado en inventario, valorizado al costo." },
      { id: "stock-critico", titulo: "Stock crítico", descripcion: "Productos activos en o por debajo de su stock mínimo." },
    ],
  },
  {
    categoria: "Clientes",
    reportes: [
      { id: "clientes-detalle", titulo: "Clientes", descripcion: "Cantidad de compras, total comprado, ticket promedio y última compra." },
    ],
  },
  {
    categoria: "Financieros",
    reportes: [
      { id: "cuenta-corriente-clientes", titulo: "Cuenta corriente de clientes", descripcion: "Saldo a cobrar por cliente.", href: "/productos/cuenta-corriente-clientes.html" },
      { id: "cuenta-corriente-proveedores", titulo: "Cuenta corriente de proveedores", descripcion: "Saldo adeudado por proveedor.", href: "/productos/cuenta-corriente.html" },
      { id: "facturas-vencer", titulo: "Facturas por vencer", descripcion: "Facturas de compra con saldo pendiente, ordenadas por vencimiento." },
    ],
  },
  {
    categoria: "Rentabilidad",
    reportes: [
      { id: "rentabilidad", titulo: "Rentabilidad bruta", descripcion: "Margen real: precio de venta menos costo al momento de vender." },
      { id: "rentabilidad-productos", titulo: "Rentabilidad por producto", descripcion: "Ventas, costo, ganancia y margen de cada producto vendido." },
      { id: "rentabilidad-categorias", titulo: "Rentabilidad por categoría", descripcion: "Ventas, costo, ganancia y margen agrupados por categoría." },
    ],
  },
  {
    categoria: "Categorías",
    reportes: [
      { id: "ventas-por-categoria", titulo: "Ventas por categoría", descripcion: "Unidades y facturación de cada categoría en el período." },
    ],
  },
  {
    categoria: "Formas de pago",
    reportes: [
      { id: "formas-pago", titulo: "Formas de pago", descripcion: "Cantidad de operaciones e importe cobrado por cada medio de pago." },
    ],
  },
  {
    categoria: "Logística",
    reportes: [
      { id: "fletes", titulo: "Fletes / entregas", descripcion: "Recorridos, costos y flete cobrado — requiere el módulo de Reparto." },
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
  // Antes esto estaba hardcodeado en 0 — el sistema no discriminaba IVA en ninguna venta (ver
  // js/facturacion.js: calcularTotales). Ahora sale del mismo agregado que usa Libro IVA Ventas.
  const debitoFiscalVentas = (await libroIvaVentas(desde, hasta)).totales.iva;
  // Positivo = a favor nuestro (crédito > débito). Retenciones/percepciones que ya nos aplicaron
  // suman a favor — son IVA que ya "pagamos" de más y se puede usar contra el saldo técnico.
  const saldoTecnico = creditoFiscalCompras - debitoFiscalVentas;
  // Retenciones que a Delfino le practican SUS clientes (agentes de retención) sobre sus propias
  // ventas — un concepto distinto de las retenciones que Delfino le practica a SUS proveedores (ver
  // js/compras.js: retencionIva/Ganancias/Iibb, que son la contraparte inversa). Nadie informa esto
  // todavía (no hay integración que lo reporte), así que sigue en 0 — no se inventa.
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

export async function reporteStockCritico() {
  const snap = await getDocs(query(collection(db, "productos"), where("estado", "==", "activo")));
  return snap.docs
    .map((d) => d.data())
    .filter((p) => (p.stockTotal ?? 0) <= (p.stockMinimo ?? 0))
    .map((p) => ({ sku: p.sku, descripcion: p.descripcion, stockTotal: p.stockTotal ?? 0, stockMinimo: p.stockMinimo ?? 0 }))
    .sort((a, b) => a.stockTotal - b.stockTotal);
}

// Facturas de compra con saldo pendiente (impagas o parciales), sin importar el período — es un
// listado de "qué hay que pagar ahora", no una serie histórica.
export async function reporteFacturasPorVencer() {
  const [comprasSnap, pagosSnap] = await Promise.all([getDocs(collection(db, "compras")), getDocs(collection(db, "pagosProveedores"))]);
  const compras = comprasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const pagos = pagosSnap.docs.map((d) => d.data());
  return compras
    .map((c) => {
      const pagado = pagos.filter((p) => p.compraId === c.id).reduce((acc, p) => acc + (p.monto || 0), 0);
      // fechaVencimiento normalmente es un string "YYYY-MM-DD", pero alguna compra vieja (cargada
      // antes de que ese campo existiera con ese formato) puede tenerlo como Timestamp — se normaliza
      // acá para no romper el sort, mismo criterio que ya se usa con compras.fecha.
      const fechaVencimiento = c.fechaVencimiento?.toDate ? c.fechaVencimiento.toDate().toISOString().slice(0, 10) : c.fechaVencimiento || null;
      // El saldo pendiente es contra lo que realmente se le va a pagar al proveedor (total menos
      // retenciones, ver compras.js: netoAPagarProveedor) — no contra el bruto de la factura. Sin
      // esto, una compra con retenciones nunca terminaba de saldarse aunque ya estuviera pagada del
      // todo: el saldo quedaba clavado en el monto retenido para siempre.
      const netoAPagar = c.netoAPagarProveedor ?? c.total ?? 0;
      return {
        proveedorNombre: c.proveedorNombre,
        numeroFactura: c.numeroFactura,
        fechaVencimiento,
        total: c.total || 0,
        saldo: Math.round((netoAPagar - pagado) * 100) / 100,
      };
    })
    .filter((c) => c.saldo > 0.01)
    .sort((a, b) => (a.fechaVencimiento || "9999").localeCompare(b.fechaVencimiento || "9999"));
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

// Un producto vendido puede haber sido dado de baja o cambiado de categoría después — se trae el
// catálogo completo una sola vez (mismo criterio que reporteValorizacionStock/reporteStockCritico)
// para no hacer un pedido por cada ítem vendido.
async function mapaProductos() {
  const snap = await getDocs(collection(db, "productos"));
  const mapa = new Map();
  snap.docs.forEach((d) => mapa.set(d.id, d.data()));
  return mapa;
}

async function mapaCategorias() {
  const snap = await getDocs(collection(db, "categorias"));
  const mapa = new Map();
  snap.docs.forEach((d) => mapa.set(d.id, d.data().nombre));
  return mapa;
}

// Listado completo de ventas del período, una fila por venta, con costo/margen/forma de pago —
// la tabla de detalle que pide el reporte de ventas (no solo los totales de reporteResumenVentas).
export async function reporteVentasDetalle(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  return ventas
    .map((v) => {
      const costo = (v.items || []).reduce((acc, it) => acc + (it.costoUnitario || 0) * (it.cantidad || 0), 0);
      const productos = (v.items || []).map((it) => `${it.cantidad}x ${it.productoDescripcion}`).join(", ");
      const formaPago = (v.pagos || []).map((p) => p.medio).join(", ") || "-";
      return {
        fecha: v.fecha,
        numeroVenta: v.numeroVenta,
        clienteNombre: v.clienteNombre || "Consumidor final",
        productos,
        total: v.total || 0,
        costo: Math.round(costo * 100) / 100,
        margen: Math.round(((v.total || 0) - costo) * 100) / 100,
        formaPago,
      };
    })
    .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
}

// Cantidad de operaciones, importe y % sobre el total vendido, por cada medio de pago usado
// (incluye "Pendiente de pago" como un medio más — es lo que efectivamente se registró al vender).
export async function reporteFormasDePago(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  const totalVentas = ventas.reduce((acc, v) => acc + (v.total || 0), 0);
  const porMedio = {};
  ventas.forEach((v) => {
    (v.pagos || []).forEach((p) => {
      if (!porMedio[p.medio]) porMedio[p.medio] = { medio: p.medio, cantidad: 0, importe: 0 };
      porMedio[p.medio].cantidad += 1;
      porMedio[p.medio].importe += p.monto || 0;
    });
  });
  return Object.values(porMedio)
    .map((m) => ({
      ...m,
      importe: Math.round(m.importe * 100) / 100,
      porcentaje: totalVentas > 0 ? Math.round((m.importe / totalVentas) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.importe - a.importe);
}

// Unidades, facturación, costo, ganancia y margen agrupados por categoría de producto (la categoría
// ACTUAL del producto, no la que tenía al momento de venderse — mismo criterio que valorización de
// stock, que también usa el estado actual del catálogo).
export async function reporteVentasPorCategoria(desde, hasta) {
  const [ventas, productos, categorias] = await Promise.all([ventasEnRango(desde, hasta), mapaProductos(), mapaCategorias()]);
  const porCategoria = {};
  ventas.forEach((v) => {
    (v.items || []).forEach((it) => {
      const producto = productos.get(it.productoId);
      const categoriaNombre = producto?.categoriaId ? categorias.get(producto.categoriaId) || "Sin categoría" : "Sin categoría";
      if (!porCategoria[categoriaNombre]) porCategoria[categoriaNombre] = { categoriaNombre, unidades: 0, ventas: 0, costo: 0 };
      porCategoria[categoriaNombre].unidades += it.cantidad || 0;
      porCategoria[categoriaNombre].ventas += it.subtotal || 0;
      porCategoria[categoriaNombre].costo += (it.costoUnitario || 0) * (it.cantidad || 0);
    });
  });
  return Object.values(porCategoria)
    .map((c) => ({
      categoriaNombre: c.categoriaNombre,
      unidades: c.unidades,
      ventas: Math.round(c.ventas * 100) / 100,
      costo: Math.round(c.costo * 100) / 100,
      ganancia: Math.round((c.ventas - c.costo) * 100) / 100,
      margenPct: c.ventas > 0 ? Math.round(((c.ventas - c.costo) / c.ventas) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.ventas - a.ventas);
}

export async function reporteRentabilidadPorProducto(desde, hasta, top = 30) {
  const ventas = await ventasEnRango(desde, hasta);
  const porProducto = {};
  ventas.forEach((v) => {
    (v.items || []).forEach((it) => {
      if (!porProducto[it.productoId]) porProducto[it.productoId] = { productoDescripcion: it.productoDescripcion, ventas: 0, costo: 0 };
      porProducto[it.productoId].ventas += it.subtotal || 0;
      porProducto[it.productoId].costo += (it.costoUnitario || 0) * (it.cantidad || 0);
    });
  });
  return Object.values(porProducto)
    .map((p) => ({
      productoDescripcion: p.productoDescripcion,
      ventas: Math.round(p.ventas * 100) / 100,
      costo: Math.round(p.costo * 100) / 100,
      ganancia: Math.round((p.ventas - p.costo) * 100) / 100,
      margenPct: p.ventas > 0 ? Math.round(((p.ventas - p.costo) / p.ventas) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.ganancia - a.ganancia)
    .slice(0, top);
}

// Cantidad de compras, total comprado, ticket promedio y fecha de la última compra, por cliente —
// "Consumidor final" queda agrupado en una sola fila, igual que en reporteMejoresClientes.
export async function reporteClientesDetalle(desde, hasta) {
  const ventas = await ventasEnRango(desde, hasta);
  const porCliente = {};
  ventas.forEach((v) => {
    const key = v.clienteId || "consumidor-final";
    if (!porCliente[key]) porCliente[key] = { clienteNombre: v.clienteNombre || "Consumidor final", cantidadCompras: 0, totalComprado: 0, ultimaCompra: null };
    porCliente[key].cantidadCompras += 1;
    porCliente[key].totalComprado += v.total || 0;
    if (!porCliente[key].ultimaCompra || v.fecha > porCliente[key].ultimaCompra) porCliente[key].ultimaCompra = v.fecha;
  });
  return Object.values(porCliente)
    .map((c) => ({
      ...c,
      totalComprado: Math.round(c.totalComprado * 100) / 100,
      ticketPromedio: c.cantidadCompras > 0 ? Math.round((c.totalComprado / c.cantidadCompras) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.totalComprado - a.totalComprado);
}

// Fletes/entregas: el ERP todavía no tiene ningún módulo de Reparto que registre recorridos, km,
// horas, boletas o flete cobrado — no hay de dónde sacar estos números sin inventarlos. Se deja el
// reporte enganchado al catálogo (aparece en Reportes/Dashboard) pero devuelve explícitamente que
// faltan los datos, para cuando ese módulo exista.
export async function reporteFletes() {
  return {
    disponible: false,
    motivo:
      "Todavía no existe un módulo de Reparto/Logística que registre recorridos, kilómetros, horas, " +
      "boletas o flete cobrado. Este reporte se completa solo cuando esos datos se empiecen a cargar.",
  };
}
