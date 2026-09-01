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
import { generarAsiento, CUENTA } from "./contabilidad.js";
import { listarSucursalesActivas } from "./sucursales.js";
import { listarCajasPorSucursal, sesionAbiertaDeCaja, registrarMovimientoCaja } from "./cajas.js";
import { listarCuentasBancariasActivas, registrarMovimientoBancario } from "./bancos.js";
import { crearCuentaPorCobrar } from "./cuentas-por-cobrar.js";

// Débito y Transferencia van a Banco (acreditación same-day, se tratan como disponible ya). Crédito,
// Mercado Pago, GoCuotas y Boston Cred generan una Cuenta por Cobrar — el dinero no está disponible
// todavía, solo prometido (ver js/cuentas-por-cobrar.js). Efectivo va a la Caja de la sucursal.
// La lista de medios que ve el vendedor al cobrar ya no vive acá — es Configuración → Tesorería →
// Medios de pago (ver js/medios-pago.js), para poder activar/desactivar sin tocar código. Este switch
// de a dónde va cada uno sigue fijo acá: es el que de verdad mueve la plata, y generalizarlo para que
// lo maneje cada medio configurado es un cambio de arquitectura aparte, todavía no hecho (ver nota en
// js/medios-pago.js) — un medio nuevo que se cree ahí queda activo para cobrar pero sin ruteo real
// hasta que se sume acá explícitamente.
const MEDIOS_A_CUENTA_POR_COBRAR = { "Crédito": "Tarjeta de crédito", "Mercado Pago": "Mercado Pago", GoCuotas: "GoCuotas", "Boston Cred": "Boston Cred" };

// Dónde termina la plata de un pago de venta, según el medio — el corazón de la integración con
// Tesorería (VENTA → COBRO → TESORERÍA). Nunca registra un pago como "disponible" si en realidad
// quedó pendiente de acreditar (ver PROMPT MAESTRO — TESORERÍA, punto 36).
async function routearPagoATesoreria({ medio, monto, ventaId, numeroVenta, clienteId, clienteNombre, fecha }, usuario) {
  if (medio === "Pendiente de pago" || medio === "Otro" || monto <= 0) return { ruteado: false, motivo: "Medio sin destino de tesorería definido." };

  const sucursales = await listarSucursalesActivas();
  const sucursal = sucursales[0] || null;

  const medioCuentaPorCobrar = MEDIOS_A_CUENTA_POR_COBRAR[medio];
  if (medioCuentaPorCobrar) {
    await crearCuentaPorCobrar({ medio: medioCuentaPorCobrar, ventaId, clienteId, clienteNombre, fecha, importeBruto: monto, sucursalId: sucursal?.id }, usuario);
    return { ruteado: true, destino: "cuentaPorCobrar", medio: medioCuentaPorCobrar };
  }

  if (medio === "Efectivo") {
    if (!sucursal) return { ruteado: false, motivo: "No hay ninguna sucursal configurada — no se sabe a qué caja va el efectivo." };
    const cajas = await listarCajasPorSucursal(sucursal.id);
    const caja = cajas.find((c) => c.tipo === "Principal" && c.activa !== false) || cajas.find((c) => c.activa !== false);
    if (!caja) return { ruteado: false, motivo: `${sucursal.nombre} todavía no tiene ninguna caja creada (Tesorería → Cajas).` };
    const sesion = await sesionAbiertaDeCaja(caja.id);
    if (!sesion) return { ruteado: false, motivo: `${caja.nombre} (${sucursal.nombre}) está cerrada — abrila para que el efectivo de las ventas se registre ahí.` };
    await registrarMovimientoCaja(
      { cajaId: caja.id, sesionId: sesion.id, sucursalId: sucursal.id, tipo: "ingreso", concepto: `Cobro venta #${numeroVenta}`, importe: monto, medio, ventaId, clienteId, clienteNombre, origen: { tipo: "venta", id: ventaId } },
      usuario
    );
    return { ruteado: true, destino: "caja", id: caja.id };
  }

  if (medio === "Débito" || medio === "Transferencia") {
    const cuentas = await listarCuentasBancariasActivas();
    const cuenta = (sucursal ? cuentas.find((c) => c.sucursalId === sucursal.id) : null) || cuentas[0];
    if (!cuenta) return { ruteado: false, motivo: "No hay ninguna cuenta bancaria configurada (Tesorería → Bancos)." };
    await registrarMovimientoBancario(
      { cuentaId: cuenta.id, fecha, tipo: "ingreso", concepto: `Cobro venta #${numeroVenta}`, importe: monto, ventaId, clienteId, clienteNombre, origen: { tipo: "venta", id: ventaId } },
      usuario
    );
    return { ruteado: true, destino: "banco", id: cuenta.id };
  }

  return { ruteado: false, motivo: "Medio sin destino de tesorería definido." };
}

// Tipos de entrega: por ahora fijos acá, pero es el único lugar que el futuro módulo de Logística
// necesita tocar para agregar/quitar opciones (ej. "Envío programado", "Retiro en depósito").
export const TIPOS_ENTREGA = ["Retira ahora", "Envío a domicilio", "Otro"];

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
    tipoEntrega: datos.tipoEntrega || "Retira ahora",
    domicilioEntrega: datos.tipoEntrega === "Envío a domicilio" ? datos.domicilioEntrega || null : null,
    notaEntrega: datos.notaEntrega || null,
    // "Retira ahora" se resuelve en el momento — el resto queda pendiente para que Logística lo tome.
    estadoEntrega: datos.tipoEntrega && datos.tipoEntrega !== "Retira ahora" ? "pendiente" : "entregado",
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

  // Asiento contable: lo pagado al momento entra a Caja, lo que quedó a cuenta corriente entra a
  // Deudores. El costo de lo vendido sale de Bienes de Cambio y pasa a Costo de Mercadería Vendida —
  // un solo asiento balanceado (ver contabilidad.js para por qué cierra matemáticamente).
  const costoTotal = items.reduce((acc, it) => acc + (it.costoUnitario || 0) * (it.cantidad || 0), 0);
  const cobradoAhora = (datos.pagos || []).filter((p) => p.medio !== "Pendiente de pago").reduce((acc, p) => acc + p.monto, 0);
  const movimientos = [
    { cuenta: CUENTA.CAJA, debe: Math.round(cobradoAhora * 100) / 100, haber: 0 },
    { cuenta: CUENTA.DEUDORES_VENTAS, debe: Math.round(montoPendiente * 100) / 100, haber: 0 },
    { cuenta: CUENTA.VENTAS, debe: 0, haber: Math.round(datos.total * 100) / 100 },
    { cuenta: CUENTA.COSTO_MERCADERIA_VENDIDA, debe: Math.round(costoTotal * 100) / 100, haber: 0 },
    { cuenta: CUENTA.BIENES_DE_CAMBIO, debe: 0, haber: Math.round(costoTotal * 100) / 100 },
  ];
  await generarAsiento(
    { fecha: datos.fecha, descripcion: `Venta #${numeroVenta} — ${datos.clienteId ? datos.clienteNombre : "Consumidor final"}`, origen: { tipo: "venta", id: ventaRef.id, numero: numeroVenta }, movimientos },
    usuario
  );

  // Tesorería: cada pago que no quedó "Pendiente de pago" busca dónde termina esa plata (caja, banco,
  // o una cuenta por cobrar si todavía no está disponible) — ver routearPagoATesoreria más arriba.
  // Un pago sin dónde rutear (ej. caja cerrada) NUNCA bloquea la venta — solo queda sin reflejar en
  // Tesorería, y se informa en el resultado para que la pantalla lo pueda avisar.
  const routeo = [];
  for (const pago of datos.pagos) {
    if (pago.medio === "Pendiente de pago" || pago.monto <= 0) continue;
    const resultado = await routearPagoATesoreria(
      { medio: pago.medio, monto: pago.monto, ventaId: ventaRef.id, numeroVenta, clienteId: datos.clienteId, clienteNombre: datos.clienteId ? datos.clienteNombre : "Consumidor final", fecha: datos.fecha },
      usuario
    );
    routeo.push({ medio: pago.medio, monto: pago.monto, ...resultado });
  }

  return { id: ventaRef.id, numeroVenta, routeoTesoreria: routeo };
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
