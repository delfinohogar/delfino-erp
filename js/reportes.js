// Módulo de Reportes: series y agregados sobre ventas, para el Dashboard y la pantalla de Reportes.
// Todo se calcula al vuelo sobre /ventas — sin totales pre-calculados, mismo criterio que el resto
// del sistema (cuentas corrientes, Dashboard).
import { db, collection, getDocs, query, where } from "./firebase.js";

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
