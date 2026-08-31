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

export async function listarCompras(maxResultados = 100) {
  const snap = await getDocs(query(collection(db, "compras"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarComprasPorProveedor(proveedorId) {
  const snap = await getDocs(query(collection(db, "compras"), where("proveedorId", "==", proveedorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// datos: { proveedorId, proveedorNombre, tipoComprobante, numeroFactura, fecha, fechaVencimiento,
//          descuentoGlobal, percepciones, items }
// items: [{ productoId, productoSku, productoDescripcion, cantidad, costoUnitario, descuentoPct, ivaPct, subtotal }]
// El costo que impacta en el producto es el neto por unidad DESPUÉS del descuento de línea (sin IVA);
// el IVA de cada línea es información del comprobante, no se mezcla con costoReferencia del producto.
export async function crearCompra(datos, usuario) {
  const ahora = serverTimestamp();
  const importes = datos.items.reduce((acc, it) => acc + it.subtotal, 0);
  const ivaTotal = datos.items.reduce((acc, it) => acc + (it.subtotal * (it.ivaPct || 0)) / 100, 0);
  const descuentoGlobal = datos.descuentoGlobal || 0;
  const percepciones = datos.percepciones || 0;
  const total = importes - descuentoGlobal + ivaTotal + percepciones;

  const compraRef = await addDoc(collection(db, "compras"), {
    proveedorId: datos.proveedorId,
    proveedorNombre: datos.proveedorNombre,
    tipoComprobante: datos.tipoComprobante,
    numeroFactura: datos.numeroFactura,
    fecha: datos.fecha,
    fechaVencimiento: datos.fechaVencimiento || null,
    items: datos.items,
    importes,
    ivaTotal,
    descuentoGlobal,
    percepciones,
    total,
    usuario: usuario.uid,
    creadoEn: ahora,
  });

  for (const item of datos.items) {
    const costoNetoUnitario = item.costoUnitario * (1 - (item.descuentoPct || 0) / 100);

    await runTransaction(db, async (tx) => {
      const productoRef = doc(db, "productos", item.productoId);
      const productoSnap = await tx.get(productoRef);
      if (!productoSnap.exists()) return;
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

  return compraRef.id;
}
