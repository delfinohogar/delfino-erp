// Libro IVA Ventas / Compras — agregación por período de lo que ya se carga en Facturación y
// Compras. No es un módulo de carga nueva: solo junta datos que ya existen y los suma.
//
// Notas de crédito de VENTAS: ya existen (js/facturacion.js: crearNotaCredito) y se descuentan acá
// (esNotaCredito de tipoComprobantePorCodigo). Notas de crédito de COMPRAS todavía no existen en el
// sistema (js/compras.js no tiene ningún mecanismo de NC/ND de proveedor) — este libro de compras
// no las contempla porque no hay de dónde sacarlas; es una limitación real, no un olvido.
import { db, collection, getDocs } from "./firebase.js";
import { listarComprobantes, tipoComprobantePorCodigo } from "./facturacion.js";

function fechaCompraNormalizada(c) {
  return c.fecha?.toDate ? c.fecha.toDate().toISOString().slice(0, 10) : c.fecha || null;
}

// Cada fila ya viene con signo: una nota de crédito resta (neto/iva/total negativos), así que sumar
// la columna alcanza para el total del período — no hace falta acordarse de restar en otro lado.
export async function libroIvaVentas(desde, hasta) {
  const comprobantes = (await listarComprobantes({ desde, hasta, maxResultados: 5000 })).filter((c) => c.estado === "EMITIDA");

  const filas = comprobantes.map((c) => {
    const tipo = tipoComprobantePorCodigo(c.tipoComprobanteCodigo);
    const signo = tipo.esNotaCredito ? -1 : 1;
    return {
      id: c.id,
      fecha: c.fechaEmision,
      letra: c.letra,
      tipoComprobante: c.tipoComprobante,
      numeroCompleto: c.numeroCompleto,
      clienteNombre: c.clienteNombre,
      clienteCuit: c.clienteCuit,
      esNotaCredito: tipo.esNotaCredito,
      neto: Math.round(c.subtotal * signo * 100) / 100,
      iva: Math.round(c.iva * signo * 100) / 100,
      total: Math.round(c.total * signo * 100) / 100,
    };
  });

  const totales = filas.reduce(
    (acc, f) => ({ neto: acc.neto + f.neto, iva: acc.iva + f.iva, total: acc.total + f.total }),
    { neto: 0, iva: 0, total: 0 }
  );
  return {
    filas: filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)),
    totales: { neto: Math.round(totales.neto * 100) / 100, iva: Math.round(totales.iva * 100) / 100, total: Math.round(totales.total * 100) / 100 },
  };
}

export async function libroIvaCompras(desde, hasta) {
  // compras.fecha puede ser Timestamp o string "YYYY-MM-DD" según cuándo se cargó (ver compras.js) —
  // no se puede filtrar por rango del lado de Firestore sin que los tipos coincidan, mismo criterio
  // defensivo que ya usa reportePosicionIva con esta misma colección.
  const snap = await getDocs(collection(db, "compras"));
  const compras = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => {
      const fecha = fechaCompraNormalizada(c);
      return fecha >= desde && fecha <= hasta;
    });

  const filas = compras.map((c) => ({
    id: c.id,
    fecha: fechaCompraNormalizada(c),
    proveedorNombre: c.proveedorNombre,
    tipoComprobante: c.tipoComprobante,
    numeroFactura: c.numeroFactura,
    neto: Math.round((c.importes - (c.descuentoGlobal || 0)) * 100) / 100,
    iva: Math.round((c.ivaTotal || 0) * 100) / 100,
    percepciones: c.percepciones || 0,
    total: c.total || 0,
    montoRetenciones: c.montoRetenciones || 0,
    netoAPagarProveedor: c.netoAPagarProveedor ?? c.total ?? 0,
  }));

  const totales = filas.reduce(
    (acc, f) => ({
      neto: acc.neto + f.neto,
      iva: acc.iva + f.iva,
      percepciones: acc.percepciones + f.percepciones,
      total: acc.total + f.total,
      montoRetenciones: acc.montoRetenciones + f.montoRetenciones,
    }),
    { neto: 0, iva: 0, percepciones: 0, total: 0, montoRetenciones: 0 }
  );
  return {
    filas: filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)),
    totales: Object.fromEntries(Object.entries(totales).map(([k, v]) => [k, Math.round(v * 100) / 100])),
  };
}
