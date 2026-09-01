// Cuenta corriente de un cliente: ventas (Débito) + cobros (Crédito) + notas de crédito (Crédito),
// armado en el momento a partir de las colecciones reales — mismo cálculo que usa
// configuracion/cliente-ficha.js, factorizado acá para que también lo use el snapshot rápido de
// cliente en Nueva Venta (js/cliente-detalle-modal.js) sin duplicar la lógica de saldo.
import { listarVentasPorCliente } from "./ventas.js";
import { listarCobrosPorCliente } from "./cobros.js";
import { listarComprobantesPorCliente } from "./facturacion.js";

function fechaOrden(fecha) {
  if (!fecha) return 0;
  return fecha?.toDate ? fecha.toDate().getTime() : new Date(fecha).getTime();
}

export async function calcularCuentaCorriente(clienteId) {
  const [ventas, cobros, comprobantes] = await Promise.all([
    listarVentasPorCliente(clienteId),
    listarCobrosPorCliente(clienteId),
    listarComprobantesPorCliente(clienteId),
  ]);

  const comprobantePorVenta = new Map(comprobantes.filter((c) => c.ventaId).map((c) => [c.ventaId, c]));
  const notasCredito = comprobantes.filter((c) => c.tipoComprobanteCodigo?.startsWith("NOTA_CREDITO") && c.estado === "EMITIDA");

  const movimientos = [
    ...ventas.map((v) => {
      const comp = comprobantePorVenta.get(v.id);
      return {
        fecha: v.fecha,
        tipo: "Factura",
        comprobanteId: comp?.id || null,
        comprobanteNumero: comp?.numeroCompleto || null,
        concepto: "Venta",
        debe: v.total || 0,
        haber: 0,
        ventaId: v.id,
        numeroVenta: v.numeroVenta,
        items: v.items || [],
      };
    }),
    ...cobros.map((c) => ({
      fecha: c.fecha,
      tipo: "Pago",
      comprobanteId: null,
      comprobanteNumero: null,
      concepto: `Pago (${c.medioPago || "-"}) — venta #${c.numeroVenta ?? ""}`,
      debe: 0,
      haber: c.monto || 0,
      ventaId: c.ventaId,
    })),
    ...notasCredito.map((nc) => ({
      fecha: nc.fechaEmision,
      tipo: "Nota de crédito",
      comprobanteId: nc.id,
      comprobanteNumero: nc.numeroCompleto,
      concepto: nc.observaciones || "Nota de crédito",
      debe: 0,
      haber: nc.total || 0,
      ventaId: null,
    })),
  ];
  movimientos.sort((a, b) => fechaOrden(a.fecha) - fechaOrden(b.fecha));

  const totalFacturado = ventas.reduce((acc, v) => acc + (v.total || 0), 0);
  const totalPagado = cobros.reduce((acc, c) => acc + (c.monto || 0), 0);
  const totalNC = notasCredito.reduce((acc, nc) => acc + (nc.total || 0), 0);
  const saldoPendiente = Math.round((totalFacturado - totalNC - totalPagado) * 100) / 100;

  return { ventas, cobros, movimientos, totalFacturado, totalPagado, totalNC, saldoPendiente, cantidadPedidos: ventas.length };
}

// Precio al que se le vendió cada producto a este cliente por última vez — Map productoId → { precio, fecha }.
// Se arma a partir de las mismas ventas que ya trae calcularCuentaCorriente (nada de una consulta aparte).
export function ultimosPreciosPorProducto(ventas) {
  const mapa = new Map();
  const ventasOrdenadas = [...ventas].sort((a, b) => fechaOrden(b.fecha) - fechaOrden(a.fecha));
  for (const v of ventasOrdenadas) {
    for (const item of v.items || []) {
      if (!mapa.has(item.productoId)) {
        mapa.set(item.productoId, { precio: item.precioUnitario, fecha: v.fecha });
      }
    }
  }
  return mapa;
}
