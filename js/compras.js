// Compras a proveedor: al crearse suman stock y actualizan el costo de referencia de cada producto
// según su modo de costeo (último costo reemplaza, promedio ponderado recalcula).
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
} from "./firebase.js";
import { generarAsiento, CUENTA, normalizarFecha } from "./contabilidad.js";

export async function listarCompras(maxResultados = 100) {
  const snap = await getDocs(query(collection(db, "compras"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarComprasPorProveedor(proveedorId) {
  const snap = await getDocs(query(collection(db, "compras"), where("proveedorId", "==", proveedorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// datos: { proveedorId, proveedorNombre, tipoComprobante, numeroFactura, fecha, fechaVencimiento,
//          descuentoGlobal, percepciones, items, retencionIva?, retencionGanancias?, retencionIibb? }
// items: [{ productoId, productoSku, productoDescripcion, cantidad, costoUnitario, descuentoPct, ivaPct, subtotal }]
// El costo que impacta en el producto es el neto por unidad DESPUÉS del descuento de línea (sin IVA);
// el IVA de cada línea es información del comprobante, no se mezcla con costoReferencia del producto.
//
// Retenciones: lo que Delfino, como agente de retención, le retiene al proveedor en esta factura —
// no es plata que se le vaya a pagar (va a AFIP/ARBA en su nombre), así que se descuenta de entrada
// de lo que la cuenta corriente del proveedor va a pedir pagar (ver netoAPagarProveedor y
// reporteFacturasPorVencer en reportes.js). Se cargan acá, al recibir la factura — no al pagarla —
// por pedido explícito del dueño (2026-09-02): quiere verlas reflejadas apenas entra la factura.
export async function crearCompra(datos, usuario) {
  const ahora = serverTimestamp();
  // Antes guardaba lo que llegara en datos.fecha tal cual — productos/compras-nueva.js manda un
  // Date, así que quedaba como Timestamp en vez del string "YYYY-MM-DD" que usa ventas.fecha. El
  // asiento generado por esta misma función ya normalizaba su propia fecha (generarAsiento llama a
  // normalizarFecha internamente) pero el documento de compras quedaba con el tipo inconsistente —
  // es la razón documentada por la que reportePosicionIva (js/reportes.js) tiene que traer TODA la
  // colección de compras y filtrar en memoria en vez de un where() por fecha.
  const fecha = normalizarFecha(datos.fecha);
  const fechaVencimiento = datos.fechaVencimiento ? normalizarFecha(datos.fechaVencimiento) : null;
  const importes = datos.items.reduce((acc, it) => acc + it.subtotal, 0);
  const ivaTotal = datos.items.reduce((acc, it) => acc + (it.subtotal * (it.ivaPct || 0)) / 100, 0);
  const descuentoGlobal = datos.descuentoGlobal || 0;
  const percepciones = datos.percepciones || 0;
  const total = importes - descuentoGlobal + ivaTotal + percepciones;

  const retencionIva = Math.round((datos.retencionIva || 0) * 100) / 100;
  const retencionGanancias = Math.round((datos.retencionGanancias || 0) * 100) / 100;
  const retencionIibb = Math.round((datos.retencionIibb || 0) * 100) / 100;
  const montoRetenciones = Math.round((retencionIva + retencionGanancias + retencionIibb) * 100) / 100;
  if (montoRetenciones > total) throw new Error("Las retenciones no pueden ser mayores que el total de la factura.");
  const netoAPagarProveedor = Math.round((total - montoRetenciones) * 100) / 100;

  const compraRef = await addDoc(collection(db, "compras"), {
    proveedorId: datos.proveedorId,
    proveedorNombre: datos.proveedorNombre,
    tipoComprobante: datos.tipoComprobante,
    numeroFactura: datos.numeroFactura,
    fecha,
    fechaVencimiento,
    items: datos.items,
    importes,
    ivaTotal,
    descuentoGlobal,
    percepciones,
    total,
    retencionIva,
    retencionGanancias,
    retencionIibb,
    montoRetenciones,
    netoAPagarProveedor,
    usuario: usuario.uid,
    creadoEn: ahora,
  });

  for (const item of datos.items) {
    const costoNetoUnitario = item.costoUnitario * (1 - (item.descuentoPct || 0) / 100);

    await runTransaction(db, async (tx) => {
      const productoRef = doc(db, "productos", item.productoId);
      const productoSnap = await tx.get(productoRef);
      // Antes: `return` silencioso — la compra quedaba guardada con este ítem como si el stock se
      // hubiera cargado, pero nunca pasaba nada de verdad (producto borrado/ID inválido). Con `throw`
      // la transacción de ESTE ítem no se confirma y el error llega a quien llamó a crearCompra, en
      // vez de una compra "fantasma" con stock que nunca se movió.
      if (!productoSnap.exists()) {
        throw new Error(`El producto ${item.productoId} no existe — no se pudo actualizar su stock.`);
      }
      const producto = productoSnap.data();

      const stockAnterior = producto.stockTotal ?? 0;
      const stockNuevo = stockAnterior + item.cantidad;

      const costoAnterior = producto.costoReferencia ?? 0;
      let costoNuevo = costoAnterior;
      if (producto.costoModo === "promedio" && stockAnterior > 0) {
        costoNuevo = (stockAnterior * costoAnterior + item.cantidad * costoNetoUnitario) / stockNuevo;
      } else {
        costoNuevo = costoNetoUnitario;
      }
      costoNuevo = Math.round(costoNuevo * 100) / 100;

      // "Último costo" se actualiza siempre con cada compra, sin importar el modo de costeo del
      // producto — es solo informativo (de dónde salió el último precio pagado), no se usa para
      // calcular el precio de venta a menos que costoModo sea 'ultimo'.
      tx.update(productoRef, {
        stockTotal: stockNuevo,
        costoReferencia: costoNuevo,
        costoUltimo: Math.round(costoNetoUnitario * 100) / 100,
        modificadoPor: usuario.uid,
        modificadoEn: ahora,
      });

      tx.set(doc(collection(db, "productos", item.productoId, "logAuditoria")), {
        campo: "stockTotal",
        valorAnterior: stockAnterior,
        valorNuevo: stockNuevo,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: item.productoId,
        productoSku: item.productoSku,
        productoDescripcion: item.productoDescripcion,
        motivo: `Compra ${datos.tipoComprobante} ${datos.numeroFactura} — ${datos.proveedorNombre}`,
      });

      if (costoNuevo !== costoAnterior) {
        tx.set(doc(collection(db, "productos", item.productoId, "historialCostos")), {
          fecha: ahora,
          costoAnterior,
          costoNuevo,
          usuario: usuario.uid,
          motivo: `Compra ${datos.tipoComprobante} ${datos.numeroFactura}`,
        });
      }
    });
  }

  // Asiento contable: el neto (sin IVA) entra a Bienes de Cambio, el IVA de la factura es crédito
  // fiscal (no es costo de mercadería). Del lado del haber, lo que realmente se le va a pagar al
  // proveedor es el total MENOS las retenciones — esas quedan como pasivo a depositar, no desaparecen.
  const netoSinIva = importes - descuentoGlobal + percepciones;
  const movimientosRetenciones = [
    retencionIva > 0 ? { cuenta: CUENTA.RETENCION_IVA, debe: 0, haber: retencionIva } : null,
    retencionGanancias > 0 ? { cuenta: CUENTA.RETENCION_GANANCIAS, debe: 0, haber: retencionGanancias } : null,
    retencionIibb > 0 ? { cuenta: CUENTA.RETENCION_IIBB, debe: 0, haber: retencionIibb } : null,
  ].filter(Boolean);
  await generarAsiento(
    {
      fecha,
      descripcion: `Compra ${datos.tipoComprobante} ${datos.numeroFactura} — ${datos.proveedorNombre}`,
      origen: { tipo: "compra", id: compraRef.id, numero: datos.numeroFactura },
      movimientos: [
        { cuenta: CUENTA.BIENES_DE_CAMBIO, debe: Math.round(netoSinIva * 100) / 100, haber: 0 },
        { cuenta: CUENTA.IVA_CREDITO_FISCAL, debe: Math.round(ivaTotal * 100) / 100, haber: 0 },
        { cuenta: CUENTA.PROVEEDORES, debe: 0, haber: netoAPagarProveedor },
        ...movimientosRetenciones,
      ],
    },
    usuario
  );

  return compraRef.id;
}
