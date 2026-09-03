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
  setDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
} from "./firebase.js";
import { generarAsiento, CUENTA, cuentaParaDestinoTesoreria, discriminarIva } from "./contabilidad.js";
import { resolverSucursalUsuario } from "./sucursales.js";
import { listarCajasPorSucursal, sesionAbiertaDeCaja, registrarMovimientoCaja } from "./cajas.js";
import { listarCuentasBancariasActivas, registrarMovimientoBancario } from "./bancos.js";
import { crearCuentaPorCobrar, anularCuentaPorCobrarPendiente } from "./cuentas-por-cobrar.js";
import { obtenerMedioPagoPorNombre } from "./medios-pago.js";
import { crearEntrega } from "./entregas.js";
import { vincularVentaAOrden } from "./mercado-pago.js";

// Dónde termina la plata de un pago de venta — el corazón de la integración con Tesorería
// (VENTA → COBRO → TESORERÍA). Nunca registra un pago como "disponible" si en realidad quedó
// pendiente de acreditar (ver PROMPT MAESTRO — TESORERÍA, punto 36).
//
// El destino sale del medio configurado en Configuración → Medios de pago (campo `destino`, ver
// js/medios-pago.js) — ya no de un switch por nombre acá. Así un medio nuevo ("Cheque", "Vale")
// rutea de verdad apenas se lo crea, sin tocar código. Si el medio no existe en el catálogo o no
// tiene destino, NO se inventa uno: se devuelve ruteado:false con el motivo, y quien llama decide
// (ver crearVenta: la venta se registra igual, pero queda marcada como pago sin ubicar).
//
// sucursal y caja ya vienen resueltas (una sola vez por venta, no por cada pago — ver crearVenta):
// caja es opcional, para cuando el cajero eligió una puntual entre varias abiertas — viene con la
// misma forma que devuelve listarCajasAbiertasPorSucursal, { caja, sesion }; sin ella, cae al
// criterio de siempre (la "Principal", o la primera caja abierta de esa sucursal).
async function routearPagoATesoreria({ medio, monto, referencia, ventaId, numeroVenta, clienteId, clienteNombre, fecha, sucursal, caja }, usuario) {
  if (medio === "Pendiente de pago" || monto <= 0) return { ruteado: false, motivo: "Pago a cuenta corriente — no mueve dinero todavía." };

  const config = await obtenerMedioPagoPorNombre(medio);
  if (!config) return { ruteado: false, motivo: `El medio "${medio}" no está en Configuración → Medios de pago, así que no se sabe a dónde va la plata.` };
  if (!config.destino) return { ruteado: false, motivo: `"${medio}" no tiene un destino de Tesorería configurado (Configuración → Medios de pago).` };

  if (config.destino === "cuentaPorCobrar") {
    // medioCuentaPorCobrar permite que "Crédito" agrupe como "Tarjeta de crédito" en Tesorería; si
    // no está definido (medio nuevo), se usa el propio nombre del medio.
    const medioCxC = config.medioCuentaPorCobrar || medio;
    await crearCuentaPorCobrar({ medio: medioCxC, ventaId, clienteId, clienteNombre, fecha, importeBruto: monto, sucursalId: sucursal?.id, referencia }, usuario);
    return { ruteado: true, destino: "cuentaPorCobrar", medio: medioCxC };
  }

  if (config.destino === "caja") {
    if (!sucursal) return { ruteado: false, motivo: "No hay ninguna sucursal configurada — no se sabe a qué caja va el efectivo." };
    let cajaElegida = caja?.caja || null;
    let sesion = caja?.sesion || null;
    if (!cajaElegida) {
      const cajas = await listarCajasPorSucursal(sucursal.id);
      cajaElegida = cajas.find((c) => c.tipo === "Principal" && c.activa !== false) || cajas.find((c) => c.activa !== false);
      if (!cajaElegida) return { ruteado: false, motivo: `${sucursal.nombre} todavía no tiene ninguna caja creada (Tesorería → Cajas).` };
      sesion = await sesionAbiertaDeCaja(cajaElegida.id);
    }
    if (!sesion) return { ruteado: false, motivo: `${cajaElegida.nombre} (${sucursal.nombre}) está cerrada — abrila para que el efectivo de las ventas se registre ahí.` };
    await registrarMovimientoCaja(
      { cajaId: cajaElegida.id, sesionId: sesion.id, sucursalId: sucursal.id, tipo: "ingreso", concepto: `Cobro venta #${numeroVenta}`, importe: monto, medio, ventaId, clienteId, clienteNombre, origen: { tipo: "venta", id: ventaId } },
      usuario
    );
    return { ruteado: true, destino: "caja", id: cajaElegida.id };
  }

  if (config.destino === "banco") {
    const cuentas = await listarCuentasBancariasActivas();
    const cuenta = (sucursal ? cuentas.find((c) => c.sucursalId === sucursal.id) : null) || cuentas[0];
    if (!cuenta) return { ruteado: false, motivo: "No hay ninguna cuenta bancaria configurada (Tesorería → Bancos)." };
    await registrarMovimientoBancario(
      { cuentaId: cuenta.id, fecha, tipo: "ingreso", concepto: `Cobro venta #${numeroVenta}`, importe: monto, ventaId, clienteId, clienteNombre, origen: { tipo: "venta", id: ventaId } },
      usuario
    );
    return { ruteado: true, destino: "banco", id: cuenta.id };
  }

  return { ruteado: false, motivo: `Destino "${config.destino}" no reconocido para el medio "${medio}".` };
}

// Tipos de entrega: por ahora fijos acá, pero es el único lugar que el futuro módulo de Logística
// necesita tocar para agregar/quitar opciones (ej. "Envío programado", "Retiro en depósito").
export const TIPOS_ENTREGA = ["Retira ahora", "Envío a domicilio", "Otro"];

// Idempotencia de crearVenta — un pedido puede reintentarse (falla de red a mitad de camino, o el
// cajero reintenta tras un error) y sin esto cada reintento vuelve a descontar stock y a rutear el
// pago de nuevo. La clave la genera quien llama (productos/venta-nueva.js: una por intento de
// carrito, se reutiliza en un reintento del MISMO pedido y se descarta al modificar el carrito o al
// confirmar con éxito). Sin datos.idempotencyKey (cualquier otro llamador presente o futuro),
// crearVenta se comporta exactamente igual que antes de este cambio — es puramente aditivo.
async function reservarIdempotenciaVenta(idempotencyKey, usuario) {
  if (!idempotencyKey) return { ref: null, previa: null };
  const ref = doc(db, "ventasIdempotencia", idempotencyKey);
  const snap = await getDoc(ref);
  if (snap.exists()) return { ref, previa: snap.data() };
  await setDoc(ref, {
    estado: "procesando",
    ventaId: null,
    resultado: null,
    error: null,
    usuario: usuario.uid,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  });
  return { ref, previa: null };
}

async function marcarIdempotenciaError(ref, error) {
  if (!ref) return;
  try {
    await setDoc(ref, { estado: "error", error: error?.message || String(error), actualizadoEn: serverTimestamp() }, { merge: true });
  } catch (e) {
    // Best-effort: si esto falla, el error real de la venta (el que importa) igual sigue su curso
    // hacia quien llamó — ver el catch en crearVenta. Perder la constancia acá es peor UX (un admin
    // no ve el porqué en ventasIdempotencia) pero no debe tapar el error original.
    console.error("No se pudo dejar constancia del error en ventasIdempotencia:", e);
  }
}

async function marcarIdempotenciaCompleta(ref, resultado) {
  if (!ref) return;
  await setDoc(ref, { estado: "completa", ventaId: resultado.id, resultado, actualizadoEn: serverTimestamp() }, { merge: true });
}

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
  const { ref: idemRef, previa } = await reservarIdempotenciaVenta(datos.idempotencyKey, usuario);
  if (previa) {
    if (previa.estado === "completa") return previa.resultado;
    if (previa.estado === "procesando") {
      throw new Error(
        "Esta venta ya se está procesando (puede ser un reintento muy rápido) — esperá unos segundos y revisá la lista de ventas antes de volver a confirmar."
      );
    }
    // estado === "error": un intento anterior con este mismo pedido falló a mitad de camino — puede
    // haber quedado stock ya descontado o un movimiento de Tesorería ya creado sin que la venta se
    // haya llegado a registrar. Reintentar a ciegas con la misma clave podría duplicarlo, así que se
    // corta acá en vez de reprocesar — hay que revisar ventasIdempotencia a mano antes de reintentar.
    // Recargar la página (ver productos/venta-nueva.js) genera una clave nueva y permite una venta nueva.
    throw new Error(
      `Un intento anterior de esta venta falló (${previa.error || "error desconocido"}). Recargá la página antes de reintentar — puede haber quedado stock o un movimiento de Tesorería a medio registrar; si es así, un administrador tiene que revisarlo.`
    );
  }

  try {
    return await crearVentaInterno(datos, usuario, idemRef);
  } catch (err) {
    await marcarIdempotenciaError(idemRef, err);
    throw err;
  }
}

async function crearVentaInterno(datos, usuario, idemRef) {
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

  // Para un combo, costoReferencia YA es la suma de sus componentes (lo mantiene al día el trigger
  // de functions/combosSync.js cada vez que cambia alguno) — no hace falta ningún caso especial acá,
  // se lee igual que para un producto simple.
  // iva sale del producto (no del carrito) por la misma razón que costoUnitario: es la foto real al
  // momento de la venta, no lo que haya quedado cacheado del lado del cliente.
  const items = datos.items.map((item, i) => ({ ...item, costoUnitario: productoSnaps[i].data().costoReferencia ?? 0, iva: productoSnaps[i].data().iva ?? 21 }));

  // Vender un combo NUNCA descuenta un stockTotal propio (es un valor calculado, no la fuente de
  // verdad — ver js/combos.js) — descuenta el stock de SUS COMPONENTES, cada uno multiplicado por
  // la cantidad que el combo necesita. Un producto simple se descuenta a sí mismo, como siempre. La
  // venta en sí (datos.items / venta.pagos) sigue mostrando la línea del combo tal cual se vendió —
  // esta expansión es solo para saber qué stock real hay que tocar.
  const descuentosStock = [];
  datos.items.forEach((item, i) => {
    const producto = productoSnaps[i].data();
    if (producto.tipoProducto === "combo") {
      for (const c of producto.componentes || []) {
        descuentosStock.push({
          productoId: c.productoId,
          productoSku: c.sku,
          productoDescripcion: c.descripcion,
          cantidad: c.cantidad * item.cantidad,
          esComponenteDeCombo: true,
          comboSku: item.productoSku,
        });
      }
    } else {
      descuentosStock.push({ productoId: item.productoId, productoSku: item.productoSku, productoDescripcion: item.productoDescripcion, cantidad: item.cantidad, esComponenteDeCombo: false, precioUnitario: item.precioUnitario });
    }
  });

  for (const descuento of descuentosStock) {
    await runTransaction(db, async (tx) => {
      const productoRef = doc(db, "productos", descuento.productoId);
      const snap = await tx.get(productoRef);
      if (!snap.exists()) throw new Error(`Producto ${descuento.productoSku || descuento.productoId} no encontrado.`);
      const producto = snap.data();
      const stockAnterior = producto.stockTotal ?? 0;
      const stockNuevo = stockAnterior - descuento.cantidad;
      if (stockNuevo < 0) {
        throw new Error(
          `Stock insuficiente para ${descuento.productoSku || ""} ${descuento.productoDescripcion || ""} (disponible: ${stockAnterior}).`
        );
      }
      // ultimoPrecioVenta/ultimaVentaEn son "a qué precio se vendió este producto solo" — un
      // componente de combo no tiene ese precio individual (el combo se vendió por su propio precio
      // total), así que esos dos campos NO se tocan para descuentos que vienen de un combo.
      const cambios = { stockTotal: stockNuevo, modificadoPor: usuario.uid, modificadoEn: ahora };
      if (!descuento.esComponenteDeCombo) {
        cambios.ultimoPrecioVenta = descuento.precioUnitario;
        cambios.ultimaVentaEn = ahora;
      }
      tx.update(productoRef, cambios);
      tx.set(doc(collection(db, "productos", descuento.productoId, "logAuditoria")), {
        campo: "stockTotal",
        valorAnterior: stockAnterior,
        valorNuevo: stockNuevo,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: descuento.productoId,
        productoSku: descuento.productoSku,
        productoDescripcion: descuento.productoDescripcion,
        motivo: descuento.esComponenteDeCombo ? `Venta #${numeroVenta} (combo ${descuento.comboSku})` : `Venta #${numeroVenta}`,
      });
    });
  }

  const montoPendiente = (datos.pagos || [])
    .filter((p) => p.medio === "Pendiente de pago")
    .reduce((acc, p) => acc + p.monto, 0);

  // Sucursal donde se vende: la del usuario logueado si tiene una asignada; si no, la primera activa
  // (y queda marcada como "asumida" para que la pantalla avise). Se resuelve UNA vez y se usa tanto
  // para dejar constancia en la venta como para rutear cada pago a la caja/cuenta correcta.
  const { sucursal, asumida: sucursalAsumida } = await resolverSucursalUsuario(usuario);

  // El ID se genera ANTES de escribir la venta (Firestore permite armar la referencia sin escribir
  // todavía) para poder rutear cada pago a Tesorería primero y guardar el resultado en la venta misma
  // en un solo write — la venta es inmutable (firestore.rules: allow update: if false), así que el
  // resultado del ruteo tiene que quedar adentro del alta o se pierde para siempre apenas se cierra
  // la pantalla (ver tesoreria/pagos-sin-ubicar.js, que lista tieneSinUbicar==true).
  const ventaRef = doc(collection(db, "ventas"));

  // Tesorería PRIMERO: cada pago que no quedó "Pendiente de pago" busca dónde termina esa plata
  // (caja, banco, o una cuenta por cobrar si todavía no está disponible) — ver routearPagoATesoreria.
  // Un pago sin dónde rutear (ej. caja cerrada) NUNCA bloquea la venta — solo queda sin reflejar en
  // Tesorería, y se informa en el resultado para que la pantalla lo pueda avisar.
  //
  // Va antes del asiento a propósito: el asiento se arma con el resultado REAL del ruteo, para que
  // contabilidad y Tesorería no se puedan contradecir (antes el asiento suponía que todo entraba a
  // Caja, y una venta con tarjeta sobrestimaba el disponible).
  // La caja puntual la manda la pantalla de Nueva Venta solo cuando había más de una abierta para
  // elegir; si no, se cae al criterio de siempre dentro de routearPagoATesoreria (la "Principal" de
  // la sucursal ya resuelta arriba).
  const cajaSeleccionada = datos.cajaSeleccionada || null;

  const routeo = [];
  for (const pago of datos.pagos) {
    if (pago.medio === "Pendiente de pago" || pago.monto <= 0) continue;
    const resultado = await routearPagoATesoreria(
      { medio: pago.medio, monto: pago.monto, referencia: pago.referencia || null, ventaId: ventaRef.id, numeroVenta, clienteId: datos.clienteId, clienteNombre: datos.clienteId ? datos.clienteNombre : "Consumidor final", fecha: datos.fecha, sucursal, caja: cajaSeleccionada },
      usuario
    );
    routeo.push({ medio: pago.medio, monto: pago.monto, ...resultado });
  }
  const tieneSinUbicar = routeo.some((r) => !r.ruteado);

  await setDoc(ventaRef, {
    numeroVenta,
    fecha: datos.fecha,
    clienteId: datos.clienteId || null,
    clienteNombre: datos.clienteId ? datos.clienteNombre : "Consumidor final",
    vendedorId: usuario.uid,
    vendedorNombre: usuario.nombre || usuario.email,
    sucursalId: sucursal?.id || null,
    sucursalNombre: sucursal?.nombre || null,
    items,
    descuentoGlobal: datos.descuentoGlobal || 0,
    subtotal: datos.subtotal,
    total: datos.total,
    pagos: datos.pagos,
    montoPendiente,
    tipoEntrega: datos.tipoEntrega || "Retira ahora",
    domicilioEntrega: datos.tipoEntrega === "Envío a domicilio" ? datos.domicilioEntrega || null : null,
    notaEntrega: datos.notaEntrega || null,
    // El estado real de la entrega (pendiente/entregado) vive en /entregas, no acá — la venta es
    // inmutable, así que un campo estadoEntrega congelado en el momento de vender nunca se podría
    // actualizar cuando se entregue de verdad (ver crearEntrega más abajo y js/entregas.js).
    // Ruteo a Tesorería, guardado tal cual quedó: si algún pago no se pudo ubicar (caja cerrada, medio
    // sin destino configurado), tieneSinUbicar queda en true para que el Centro de Pendientes lo pueda
    // encontrar con una sola query — sin esto, el aviso solo vivía en memoria y se perdía al cerrar la
    // pantalla de confirmación.
    routeoTesoreria: routeo,
    tieneSinUbicar,
    creadoPor: usuario.uid,
    creadoEn: ahora,
  });

  // Cierra el vínculo Venta ↔ pagosMercadoPago: la orden se crea (y se aprueba) ANTES de esta
  // venta existir, así que arranca con ventaId:null (ver mpCrearOrdenVenta) — recién acá, con la
  // venta ya escrita, se puede completar. Best-effort a propósito: si esto falla, la venta ya está
  // creada y el cobro ya está aprobado — la fuente de verdad de "esta venta se pagó con MP" sigue
  // siendo pagos[].mpOrderId, guardado arriba; este vínculo es trazabilidad extra, no crítica.
  for (const pago of datos.pagos) {
    if (!pago.mpOrderId) continue;
    try {
      await vincularVentaAOrden(pago.mpOrderId, ventaRef.id);
    } catch (err) {
      console.error(`No se pudo vincular la venta #${numeroVenta} con la orden de Mercado Pago ${pago.mpOrderId}:`, err);
    }
  }

  // "Retira ahora" no genera entrega — ya está resuelta en el momento. El resto queda pendiente en
  // una colección aparte (no en la venta, que es inmutable) para poder marcarla "entregado" después
  // sin tocar el registro original de la venta (ver js/entregas.js y productos/entregas.js).
  if (datos.tipoEntrega && datos.tipoEntrega !== "Retira ahora") {
    await crearEntrega(
      {
        ventaId: ventaRef.id,
        numeroVenta,
        clienteId: datos.clienteId || null,
        clienteNombre: datos.clienteId ? datos.clienteNombre : "Consumidor final",
        sucursalId: sucursal?.id || null,
        sucursalNombre: sucursal?.nombre || null,
        tipoEntrega: datos.tipoEntrega,
        domicilioEntrega: datos.domicilioEntrega,
        notaEntrega: datos.notaEntrega,
      },
      usuario
    );
  }

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
        mpOrderId: pago.mpOrderId || null,
        referencia: "",
        notas: "Cobro automático al confirmar la venta",
        usuario: usuario.uid,
        creadoEn: ahora,
      });
    }
  }

  // Asiento contable: el debe se reparte según a dónde fue realmente cada pago (Caja y Bancos si
  // quedó disponible, Deudores por Tarjetas si quedó pendiente de acreditar), más Deudores por
  // Ventas por lo que quedó a cuenta corriente. El costo sale de Bienes de Cambio y pasa a Costo de
  // Mercadería Vendida — un solo asiento balanceado (ver contabilidad.js).
  const costoTotal = items.reduce((acc, it) => acc + (it.costoUnitario || 0) * (it.cantidad || 0), 0);
  const redondear = (v) => Math.round(v * 100) / 100;

  // Un pago que no se pudo rutear no tiene cuenta contable donde imputarse sin mentir. Se acumula
  // aparte y se imputa a Deudores por Ventas: es plata que el cliente entregó pero que el sistema
  // todavía no ubicó, así que tratarla como un crédito a resolver es lo más honesto (y deja el
  // asiento balanceado). Queda visible en el aviso de "pago sin ubicar" de la pantalla de venta.
  const debePorCuenta = new Map();
  const sumar = (cuenta, monto) => debePorCuenta.set(cuenta, (debePorCuenta.get(cuenta) || 0) + monto);
  for (const r of routeo) {
    const cuenta = r.ruteado ? cuentaParaDestinoTesoreria(r.destino) : null;
    sumar(cuenta || CUENTA.DEUDORES_VENTAS, r.monto);
  }
  if (montoPendiente > 0) sumar(CUENTA.DEUDORES_VENTAS, montoPendiente);

  // El precio de cada ítem ya incluye IVA (ver productos.js: campo `iva`) — se discrimina acá para
  // no seguir cargando todo el bruto a "Ventas" como si fuera ingreso propio (antes de esto, el IVA
  // cobrado en cada venta quedaba mezclado con el ingreso real, sobrestimándolo).
  const ivaVenta = redondear(items.reduce((acc, it) => acc + discriminarIva(it.subtotal, it.iva).iva, 0));
  const ventaNeta = redondear(datos.total - ivaVenta);

  const movimientos = [
    ...Array.from(debePorCuenta, ([cuenta, monto]) => ({ cuenta, debe: redondear(monto), haber: 0 })),
    { cuenta: CUENTA.VENTAS, debe: 0, haber: ventaNeta },
    { cuenta: CUENTA.IVA_DEBITO_FISCAL, debe: 0, haber: ivaVenta },
    { cuenta: CUENTA.COSTO_MERCADERIA_VENDIDA, debe: redondear(costoTotal), haber: 0 },
    { cuenta: CUENTA.BIENES_DE_CAMBIO, debe: 0, haber: redondear(costoTotal) },
  ];
  await generarAsiento(
    { fecha: datos.fecha, descripcion: `Venta #${numeroVenta} — ${datos.clienteId ? datos.clienteNombre : "Consumidor final"}`, origen: { tipo: "venta", id: ventaRef.id, numero: numeroVenta }, movimientos },
    usuario
  );

  const resultado = {
    id: ventaRef.id,
    numeroVenta,
    routeoTesoreria: routeo,
    sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null,
    sucursalAsumida,
  };
  await marcarIdempotenciaCompleta(idemRef, resultado);
  return resultado;
}

// Revierte lo que generó una venta cuando se anula por nota de crédito (ver crearNotaCredito en
// js/facturacion.js, que llama a esto ANTES de marcar el comprobante original ANULADA). La venta es
// inmutable, así que esto nunca la toca a ella — reversa sus EFECTOS: devuelve el stock, revierte
// cada pago en Tesorería a donde había ido, y genera un asiento contable espejado.
//
// Idempotente por ventaId (reversasVenta/{ventaId}): una venta solo se puede revertir una vez, así
// que la misma clave sirve de idempotencia y de "ya se hizo" — un reintento con estado "completa"
// devuelve el resultado guardado sin volver a tocar nada; con "procesando" o "error" corta con un
// mensaje claro en vez de arriesgarse a duplicar stock o Tesorería (mismo criterio que crearVenta).
//
// Un tramo de Tesorería que no se puede revertir TODAVÍA (caja cerrada, cuenta por cobrar que ya se
// cobró de verdad y necesita un reembolso real) nunca frena el resto — stock y los demás tramos se
// revierten igual, y ese tramo queda en pendientesRevision para que un administrador lo resuelva a
// mano. Contablemente se imputa a Deudores por Ventas mientras tanto (mismo criterio que un pago sin
// rutear en la venta original), así el asiento siempre queda balanceado sin importar cuántos tramos
// se pudieron revertir de una.
export async function revertirVentaPorNotaCredito(ventaId, motivo, usuario) {
  const reversaRef = doc(db, "reversasVenta", ventaId);
  const previaSnap = await getDoc(reversaRef);
  if (previaSnap.exists()) {
    const previa = previaSnap.data();
    if (previa.estado === "completa") return previa;
    throw new Error(
      `Ya hay un intento de reversa para esta venta en estado "${previa.estado}"${previa.error ? ` (${previa.error})` : ""}. Revisá reversasVenta/${ventaId} a mano antes de reintentar — puede haber quedado stock o Tesorería a medio revertir.`
    );
  }
  await setDoc(reversaRef, {
    estado: "procesando",
    ventaId,
    motivo: motivo.trim(),
    usuario: usuario.uid,
    error: null,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  });

  try {
    const venta = await obtenerVenta(ventaId);
    if (!venta) throw new Error(`No se encontró la venta ${ventaId} para revertir.`);
    const ahora = serverTimestamp();

    // 1) Stock — devolver cada ítem, expandiendo combos igual que al vender (ver crearVentaInterno).
    // Un producto borrado desde la venta no se puede devolver a algo que ya no existe — queda
    // anotado en productosNoEncontrados para revisar a mano, sin frenar el resto de la reversa.
    const productoSnaps = await Promise.all(venta.items.map((item) => getDoc(doc(db, "productos", item.productoId))));
    const productosNoEncontrados = [];
    const devolucionesStock = [];
    venta.items.forEach((item, i) => {
      const snap = productoSnaps[i];
      if (!snap.exists()) {
        productosNoEncontrados.push(item.productoSku || item.productoId);
        return;
      }
      const producto = snap.data();
      if (producto.tipoProducto === "combo") {
        for (const c of producto.componentes || []) {
          devolucionesStock.push({ productoId: c.productoId, productoSku: c.sku, cantidad: c.cantidad * item.cantidad });
        }
      } else {
        devolucionesStock.push({ productoId: item.productoId, productoSku: item.productoSku, cantidad: item.cantidad });
      }
    });
    for (const dev of devolucionesStock) {
      await runTransaction(db, async (tx) => {
        const productoRef = doc(db, "productos", dev.productoId);
        const prodSnap = await tx.get(productoRef);
        if (!prodSnap.exists()) return;
        const stockAnterior = prodSnap.data().stockTotal ?? 0;
        const stockNuevo = stockAnterior + dev.cantidad;
        tx.update(productoRef, { stockTotal: stockNuevo, modificadoPor: usuario.uid, modificadoEn: ahora });
        tx.set(doc(collection(db, "productos", dev.productoId, "logAuditoria")), {
          campo: "stockTotal",
          valorAnterior: stockAnterior,
          valorNuevo: stockNuevo,
          usuario: usuario.uid,
          fecha: ahora,
          productoId: dev.productoId,
          productoSku: dev.productoSku,
          motivo: `Devolución venta #${venta.numeroVenta} (nota de crédito)`,
        });
      });
    }

    // 2) Tesorería + 3) cuentas del asiento — en un solo recorrido: por cada tramo de la venta
    // original se decide a qué cuenta contable va (la real, si se pudo revertir en Tesorería;
    // Deudores por Ventas como placeholder, si no) y, de paso, se revierte Tesorería de verdad.
    const pendientesRevision = [];
    const haberPorCuenta = new Map();
    const sumar = (cuenta, monto) => haberPorCuenta.set(cuenta, (haberPorCuenta.get(cuenta) || 0) + monto);

    for (const r of venta.routeoTesoreria || []) {
      if (!r.ruteado) {
        sumar(CUENTA.DEUDORES_VENTAS, r.monto);
        continue;
      }
      if (r.destino === "caja") {
        const sesion = await sesionAbiertaDeCaja(r.id);
        if (!sesion) {
          pendientesRevision.push(`Caja (id ${r.id}) está cerrada — el egreso de $${r.monto} por la devolución de la venta #${venta.numeroVenta} hay que registrarlo a mano cuando se reabra.`);
          sumar(CUENTA.DEUDORES_VENTAS, r.monto);
          continue;
        }
        await registrarMovimientoCaja(
          { cajaId: r.id, sesionId: sesion.id, sucursalId: venta.sucursalId, tipo: "egreso", concepto: `Devolución venta #${venta.numeroVenta} (NC)`, importe: r.monto, medio: r.medio, clienteId: venta.clienteId, clienteNombre: venta.clienteNombre, origen: { tipo: "notaCredito", id: ventaId } },
          usuario
        );
        sumar(cuentaParaDestinoTesoreria("caja"), r.monto);
      } else if (r.destino === "banco") {
        await registrarMovimientoBancario(
          { cuentaId: r.id, fecha: venta.fecha, tipo: "egreso", concepto: `Devolución venta #${venta.numeroVenta} (NC)`, importe: r.monto, clienteId: venta.clienteId, clienteNombre: venta.clienteNombre, origen: { tipo: "notaCredito", id: ventaId } },
          usuario
        );
        sumar(cuentaParaDestinoTesoreria("banco"), r.monto);
      } else if (r.destino === "cuentaPorCobrar") {
        const resultado = await anularCuentaPorCobrarPendiente(ventaId, motivo.trim(), usuario);
        if (resultado.anulada) {
          sumar(cuentaParaDestinoTesoreria("cuentaPorCobrar"), r.monto);
        } else {
          pendientesRevision.push(`Cuenta por cobrar de la venta #${venta.numeroVenta}: ${resultado.motivo}`);
          sumar(CUENTA.DEUDORES_VENTAS, r.monto);
        }
      } else {
        // Destino no reconocido (no debería pasar — routearPagoATesoreria solo genera estos tres) —
        // se imputa igual a Deudores por Ventas para no dejar el asiento desbalanceado, y se avisa.
        pendientesRevision.push(`Tramo con destino "${r.destino}" de la venta #${venta.numeroVenta} no se pudo revertir automáticamente.`);
        sumar(CUENTA.DEUDORES_VENTAS, r.monto);
      }
    }
    if (venta.montoPendiente > 0) sumar(CUENTA.DEUDORES_VENTAS, venta.montoPendiente);

    const costoTotal = venta.items.reduce((acc, it) => acc + (it.costoUnitario || 0) * (it.cantidad || 0), 0);
    const redondear = (v) => Math.round(v * 100) / 100;
    const ivaVenta = redondear(venta.items.reduce((acc, it) => acc + discriminarIva(it.subtotal, it.iva).iva, 0));
    const ventaNeta = redondear(venta.total - ivaVenta);

    // Mismos montos que generó la venta original, con debe/haber invertidos — así el reverso cancela
    // exactamente lo que se había registrado, sin recalcular nada por su cuenta.
    const movimientos = [
      ...Array.from(haberPorCuenta, ([cuenta, monto]) => ({ cuenta, debe: 0, haber: redondear(monto) })),
      { cuenta: CUENTA.VENTAS, debe: ventaNeta, haber: 0 },
      { cuenta: CUENTA.IVA_DEBITO_FISCAL, debe: ivaVenta, haber: 0 },
      { cuenta: CUENTA.COSTO_MERCADERIA_VENDIDA, debe: 0, haber: redondear(costoTotal) },
      { cuenta: CUENTA.BIENES_DE_CAMBIO, debe: redondear(costoTotal), haber: 0 },
    ];
    await generarAsiento(
      {
        fecha: new Date().toISOString().slice(0, 10),
        descripcion: `Devolución venta #${venta.numeroVenta} (NC) — ${motivo.trim()}`,
        origen: { tipo: "notaCredito", id: ventaId, numero: venta.numeroVenta },
        movimientos,
      },
      usuario
    );

    const resultado = {
      estado: "completa",
      ventaId,
      numeroVenta: venta.numeroVenta,
      pendientesRevision,
      productosNoEncontrados,
      actualizadoEn: serverTimestamp(),
    };
    await setDoc(reversaRef, resultado, { merge: true });
    return resultado;
  } catch (err) {
    await setDoc(reversaRef, { estado: "error", error: err?.message || String(err), actualizadoEn: serverTimestamp() }, { merge: true }).catch((e) =>
      console.error("No se pudo dejar constancia del error en reversasVenta:", e)
    );
    throw err;
  }
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

// Ventas con al menos un pago que Tesorería no pudo ubicar (ver tieneSinUbicar en crearVenta) — para
// el Centro de Pendientes y la pantalla tesoreria/pagos-sin-ubicar.js. Se ordena en memoria (no hay
// orderBy en la query) para no depender de un índice compuesto nuevo — la lista esperable es chica.
export async function listarVentasConPagoSinUbicar() {
  const snap = await getDocs(query(collection(db, "ventas"), where("tieneSinUbicar", "==", true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.numeroVenta || 0) - (a.numeroVenta || 0));
}
