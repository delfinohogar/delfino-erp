// Ventas: registra una venta real (a diferencia del viejo registrarVenta, que solo bajaba stock sin
// dejar total, precio ni cliente). Guarda cliente (opcional — sin cliente es "Consumidor final"),
// ítems con precio y costo al momento de la venta (foto del costo, para poder calcular margen después
// sin inventar nada) y cómo se pagó — uno o varios medios, igual que en La Pyme.
// La porción pagada con medio "Pendiente de pago" queda como deuda del cliente (ver cobros.js);
// el resto se registra como cobro inmediato, atado a la venta — mismo patrón que compras/pagosProveedores,
// del otro lado de la operación.
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

export const MEDIOS_PAGO_VENTA = ["Efectivo", "Tarjeta", "Transferencia", "Otro", "Pendiente de pago"];

async function siguienteNumeroVenta() {
  const contadorRef = doc(db, "contadores", "ventas");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(contadorRef);
    const ultimo = snap.exists() ? snap.data().ultimo || 0 : 0;
    const siguiente = ultimo + 1;
    tx.set(contadorRef, { ultimo: siguiente });
    return siguiente;
  });
}

// datos: { fecha, clienteId, clienteNombre, items, descuentoGlobal, subtotal, total, pagos }
// items: [{ productoId, productoSku, productoDescripcion, cantidad, precioUnitario, descuentoPct, subtotal }]
// pagos: [{ medio, monto }] — la suma debe ser igual a datos.total (se valida en la UI).
export async function crearVenta(datos, usuario) {
  // Se valida el stock ANTES de escribir nada — si algo no alcanza, no queda ninguna venta a medio
  // registrar. (Se vuelve a revisar dentro de cada transacción, por si cambió stock en el medio tiempo.)
  const productoSnaps = await Promise.all(datos.items.map((item) => getDoc(doc(db, "productos", item.productoId))));
  productoSnaps.forEach((snap, i) => {
    const item = datos.items[i];
    if (!snap.exists()) throw new Error(`Producto ${item.productoSku || item.productoId} no encontrado.`);
    const stockActual = snap.data().stockTotal ?? 0;
    if (stockActual < item.cantidad) {
      throw new Error(
        `Stock insuficiente para ${item.productoSku || ""} ${item.productoDescripcion || ""} (disponible: ${stockActual}).`
      );
    }
  });

  const ahora = serverTimestamp();
  const numeroVenta = await siguienteNumeroVenta();

  const items = datos.items.map((item, i) => ({ ...item, costoUnitario: productoSnaps[i].data().costoReferencia ?? 0 }));

  for (const item of items) {
    await runTransaction(db, async (tx) => {
      const productoRef = doc(db, "productos", item.productoId);
      const snap = await tx.get(productoRef);
      if (!snap.exists()) throw new Error(`Producto ${item.productoSku || item.productoId} no encontrado.`);
      const producto = snap.data();
      const stockAnterior = producto.stockTotal ?? 0;
      const stockNuevo = stockAnterior - item.cantidad;
      if (stockNuevo < 0) {
        throw new Error(
          `Stock insuficiente para ${item.productoSku || ""} ${item.productoDescripcion || ""} (disponible: ${stockAnterior}).`
        );
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
        motivo: `Venta #${numeroVenta}`,
      });
    });
  }

  const montoPendiente = (datos.pagos || [])
    .filter((p) => p.medio === "Pendiente de pago")
    .reduce((acc, p) => acc + p.monto, 0);

  const ventaRef = await addDoc(collection(db, "ventas"), {
    numeroVenta,
    fecha: datos.fecha,
    clienteId: datos.clienteId || null,
    clienteNombre: datos.clienteId ? datos.clienteNombre : "Consumidor final",
    vendedorId: usuario.uid,
    vendedorNombre: usuario.nombre || usuario.email,
    items,
    descuentoGlobal: datos.descuentoGlobal || 0,
    subtotal: datos.subtotal,
    total: datos.total,
    pagos: datos.pagos,
    montoPendiente,
    creadoPor: usuario.uid,
    creadoEn: ahora,
  });

  // Todo lo que no quedó "Pendiente de pago" es un cobro inmediato, atado a esta venta — así el saldo
  // del cliente sale de restar ventas.total menos cobros.monto, igual que con proveedores.
  if (datos.clienteId) {
    for (const pago of datos.pagos) {
      if (pago.medio === "Pendiente de pago" || pago.monto <= 0) continue;
      await addDoc(collection(db, "cobros"), {
        clienteId: datos.clienteId,
        clienteNombre: datos.clienteNombre,
        ventaId: ventaRef.id,
        numeroVenta,
        monto: pago.monto,
        fecha: datos.fecha,
        medioPago: pago.medio,
        referencia: "",
        notas: "Cobro automático al confirmar la venta",
        usuario: usuario.uid,
        creadoEn: ahora,
      });
    }
  }

  return { id: ventaRef.id, numeroVenta };
}

export async function listarVentas(maxResultados = 100) {
  const snap = await getDocs(query(collection(db, "ventas"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarVentasPorCliente(clienteId) {
  const snap = await getDocs(query(collection(db, "ventas"), where("clienteId", "==", clienteId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerVenta(id) {
  const snap = await getDoc(doc(db, "ventas", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
