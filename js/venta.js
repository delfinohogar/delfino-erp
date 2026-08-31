// Baja simple de stock por venta: sin cliente/numeración/totales — eso queda para un módulo de Ventas
// más adelante. Solo descuenta stock y deja registro en el log de auditoría (aparece en Movimientos).
import { db, doc, collection, runTransaction, serverTimestamp } from "./firebase.js";

// items: [{ productoId, productoSku, productoDescripcion, cantidad }]
// Lanza un Error con el detalle si algún producto no tiene stock suficiente (no se aplica nada parcial).
export async function registrarVenta(items, usuario) {
  const ahora = serverTimestamp();

  for (const item of items) {
    await runTransaction(db, async (tx) => {
      const productoRef = doc(db, "productos", item.productoId);
      const productoSnap = await tx.get(productoRef);
      if (!productoSnap.exists()) throw new Error(`Producto ${item.productoSku || item.productoId} no encontrado.`);
      const producto = productoSnap.data();

      const stockAnterior = producto.stockTotal ?? 0;
      const stockNuevo = stockAnterior - item.cantidad;
      if (stockNuevo < 0) {
        throw new Error(`Stock insuficiente para ${item.productoSku || ""} ${item.productoDescripcion || ""} (disponible: ${stockAnterior}).`);
      }

      tx.update(productoRef, { stockTotal: stockNuevo, modificadoPor: usuario.uid, modificadoEn: ahora });

      tx.set(doc(collection(db, "productos", item.productoId, "logAuditoria")), {
        campo: "stockTotal",
        valorAnterior: stockAnterior,
        valorNuevo: stockNuevo,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: item.productoId,
        productoSku: item.productoSku,
        productoDescripcion: item.productoDescripcion,
        motivo: "Venta",
      });
    });
  }
}
