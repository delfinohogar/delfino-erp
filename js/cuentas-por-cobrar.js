// Cuentas por cobrar: lo que una venta generó en dinero que NO quedó disponible en el momento —
// Mercado Pago (hasta que se acredite), GoCuotas, Boston Cred, Tarjeta de crédito. Mismo modelo para
// los cuatro (un medio más solo agrega un valor a MEDIOS_CUENTA_POR_COBRAR, no una tabla nueva).
//
// Comisión/neto/fecha prevista: NUNCA se inventan. Si no hay dato real (por ejemplo, todavía no hay
// integración que informe la comisión de Mercado Pago sobre una venta puntual), quedan en null y la
// UI tiene que mostrar "No disponible" — no un valor calculado a ojo.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit, serverTimestamp, runTransaction } from "./firebase.js";
import { generarAsiento, CUENTA, cuentaParaDestinoTesoreria } from "./contabilidad.js";
import { registrarMovimientoCaja } from "./cajas.js";
import { registrarMovimientoBancario } from "./bancos.js";

// Lista "de sistema" — sigue existiendo solo para sembrar mediosPago la primera vez (ver
// MEDIOS_DE_SISTEMA en medios-pago.js). El medio real de cada cuenta por cobrar ya no se valida
// contra esta lista fija: sale de medioCuentaPorCobrar de cada medio de pago configurado (ver
// routearPagoATesoreria en ventas.js), que es dinámico — un admin puede dar de alta "Visa",
// "Mastercard", etc. como medios de pago propios desde Configuración → Medios de Pago, cada uno con
// su propia cuenta por cobrar, sin tocar código. Antes esta lista frenaba justo eso.
export const MEDIOS_CUENTA_POR_COBRAR = ["Mercado Pago", "GoCuotas", "Boston Cred", "Tarjeta de crédito"];
export const ESTADOS_CUENTA_POR_COBRAR = ["pendiente", "parcial", "cobrado", "vencido", "con_diferencia", "anulada"];

// datos: { medio, ventaId, clienteId?, clienteNombre, sucursalId?, fecha, importeBruto, comision?,
//          impuestos?, fechaPrevista?, cuotas?, referencia? }
export async function crearCuentaPorCobrar(datos, usuario) {
  if (!datos.medio?.trim()) throw new Error("Falta el medio de cobro.");
  if (!(datos.importeBruto > 0)) throw new Error("El importe bruto tiene que ser mayor a cero.");

  const comision = datos.comision ?? null;
  const impuestos = datos.impuestos ?? null;
  // Neto solo se calcula cuando se conoce la comisión real — si no, se deja null (no "bruto - 0"
  // disfrazado de neto, que induciría a pensar que no hay comisión cuando en realidad no se sabe).
  const importeNeto = comision != null ? Math.round((datos.importeBruto - comision - (impuestos || 0)) * 100) / 100 : null;

  const ref = await addDoc(collection(db, "cuentasPorCobrar"), {
    medio: datos.medio,
    ventaId: datos.ventaId || null,
    clienteId: datos.clienteId || null,
    clienteNombre: datos.clienteNombre || "Consumidor final",
    sucursalId: datos.sucursalId || null,
    fecha: datos.fecha || new Date().toISOString().slice(0, 10),
    importeBruto: Math.round(datos.importeBruto * 100) / 100,
    comision,
    impuestos,
    importeNeto,
    fechaPrevista: datos.fechaPrevista || null,
    cuotas: datos.cuotas || null,
    referencia: datos.referencia || null,
    estado: "pendiente",
    pagosRecibidos: [],
    totalCobrado: 0,
    saldoPendiente: Math.round(datos.importeBruto * 100) / 100,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
    creadoPor: usuario.uid,
  });
  return { id: ref.id };
}

export async function listarCuentasPorCobrar({ medio, estado } = {}) {
  let clausulas = [orderBy("creadoEn", "desc")];
  if (medio) clausulas.unshift(where("medio", "==", medio));
  if (estado) clausulas.unshift(where("estado", "==", estado));
  const snap = await getDocs(query(collection(db, "cuentasPorCobrar"), ...clausulas));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCuentasPorCobrarPendientes() {
  const snap = await getDocs(query(collection(db, "cuentasPorCobrar"), where("estado", "in", ["pendiente", "parcial", "vencido", "con_diferencia"])));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerCuentaPorCobrar(id) {
  const snap = await getDoc(doc(db, "cuentasPorCobrar", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Registra un cobro/acreditación real — total o parcial — contra una cuenta por cobrar. El importe
// esperado vs. recibido puede diferir (comisión no prevista, retención, ajuste): la diferencia queda
// registrada explícitamente en el pago, nunca se oculta ajustando el importe esperado original.
// destino: { tipo: "caja"|"banco", id, nombre, sesionId? } — dónde entró realmente la plata.
//
// Antes esto era un getDoc + updateDoc sin transacción (dos acreditaciones simultáneas contra la
// misma cuenta podían pisarse: el updateDoc reemplaza pagosRecibidos entero, no lo agrega, así que
// la segunda escritura borraba el pago de la primera) y nunca tocaba Tesorería ni Contabilidad — el
// llamador (tesoreria/cuentas-por-cobrar.js) hacía el movimiento de caja/banco en un paso aparte, y
// si ese segundo paso fallaba, la cuenta quedaba marcada cobrada sin que la plata apareciera en
// ningún lado. Ahora todo pasa acá: transacción para el update de la cuenta, y recién si eso
// confirma se mueve Tesorería + se genera el asiento (mismo orden que crearCobro/crearPago).
export async function registrarCobroCuentaPorCobrar(cuentaId, { importeRecibido, fecha, destino, referencia, motivoDiferencia }, usuario) {
  if (!(importeRecibido > 0)) throw new Error("El importe recibido tiene que ser mayor a cero.");

  const pago = {
    fecha: fecha || new Date().toISOString().slice(0, 10),
    importe: Math.round(importeRecibido * 100) / 100,
    destino,
    referencia: referencia || "",
    motivoDiferencia: motivoDiferencia || null,
    usuario: usuario.uid,
    usuarioNombre: usuario.nombre || usuario.email,
    creadoEn: new Date(),
  };

  const cuentaRef = doc(db, "cuentasPorCobrar", cuentaId);
  const resultado = await runTransaction(db, async (tx) => {
    const snap = await tx.get(cuentaRef);
    if (!snap.exists()) throw new Error("No se encontró la cuenta por cobrar.");
    const cuenta = snap.data();
    if (cuenta.estado === "cobrado") throw new Error("Esta cuenta ya está completamente cobrada.");

    const pagosRecibidos = [...(cuenta.pagosRecibidos || []), pago];
    const totalCobrado = Math.round(pagosRecibidos.reduce((acc, p) => acc + p.importe, 0) * 100) / 100;
    const esperado = cuenta.importeNeto ?? cuenta.importeBruto;
    const saldoPendiente = Math.max(Math.round((esperado - totalCobrado) * 100) / 100, 0);
    const estado = saldoPendiente <= 0.01 ? "cobrado" : totalCobrado > 0 ? "parcial" : "pendiente";

    tx.update(cuentaRef, { pagosRecibidos, totalCobrado, saldoPendiente, estado, actualizadoEn: serverTimestamp() });

    return { cuenta, totalCobrado, saldoPendiente, estado, diferencia: Math.round((totalCobrado - esperado) * 100) / 100 };
  });

  const origen = { tipo: "cuentaPorCobrar", id: cuentaId };
  if (destino.tipo === "caja") {
    await registrarMovimientoCaja(
      { cajaId: destino.id, sesionId: destino.sesionId, tipo: "ingreso", concepto: `Acreditación ${resultado.cuenta.medio} — ${resultado.cuenta.clienteNombre}`, importe: pago.importe, medio: resultado.cuenta.medio, clienteId: resultado.cuenta.clienteId, clienteNombre: resultado.cuenta.clienteNombre, origen },
      usuario
    );
  } else {
    await registrarMovimientoBancario(
      { cuentaId: destino.id, fecha: pago.fecha, tipo: "ingreso", concepto: `Acreditación ${resultado.cuenta.medio} — ${resultado.cuenta.clienteNombre}`, importe: pago.importe, clienteId: resultado.cuenta.clienteId, clienteNombre: resultado.cuenta.clienteNombre, origen },
      usuario
    );
  }

  // Antes esta plata nunca cerraba el círculo contable: la venta original ya había debitado
  // "Deudores por Tarjetas y Acreditaciones" (1.1.5), pero nada lo acreditaba de vuelta cuando la
  // plata realmente entraba a Caja/Bancos — esa cuenta se acumulaba para siempre sin cancelarse.
  await generarAsiento(
    {
      fecha: pago.fecha,
      descripcion: `Acreditación ${resultado.cuenta.medio} — ${resultado.cuenta.clienteNombre}`,
      origen,
      movimientos: [
        { cuenta: cuentaParaDestinoTesoreria(destino.tipo), debe: pago.importe, haber: 0 },
        { cuenta: CUENTA.DEUDORES_TARJETAS, debe: 0, haber: pago.importe },
      ],
    },
    usuario
  );

  return { pago, totalCobrado: resultado.totalCobrado, saldoPendiente: resultado.saldoPendiente, estado: resultado.estado, diferencia: resultado.diferencia };
}

// Cancela lo que quede PENDIENTE de cobrar de la cuenta por cobrar que generó una venta, cuando esa
// venta se revierte por nota de crédito (ver revertirVentaPorNotaCredito en js/ventas.js). Nunca toca
// plata que ya se cobró de verdad — eso es un reembolso real (hay que devolver dinero por el mismo
// medio o a mano), no una cancelación contable, y se deja fuera a propósito para que lo resuelva un
// administrador; devuelve anulada:false con el motivo para que el llamador lo registre como pendiente
// de revisión en vez de darlo por hecho.
export async function anularCuentaPorCobrarPendiente(ventaId, motivo, usuario) {
  const snap = await getDocs(query(collection(db, "cuentasPorCobrar"), where("ventaId", "==", ventaId), limit(1)));
  if (snap.empty) return { anulada: false, motivo: "No se encontró ninguna cuenta por cobrar para esta venta." };

  const cuentaRef = snap.docs[0].ref;
  const cuenta = snap.docs[0].data();
  if (cuenta.estado === "anulada") return { anulada: true, yaEstaba: true };

  const saldoAAnular = cuenta.saldoPendiente || 0;
  if (saldoAAnular <= 0) {
    return {
      anulada: false,
      motivo: `Ya tiene $${cuenta.totalCobrado} cobrado — el reembolso de esa plata hay que gestionarlo a mano (Tesorería) antes de poder cerrarla.`,
    };
  }

  await updateDoc(cuentaRef, {
    estado: "anulada",
    saldoPendiente: 0,
    motivoAnulacion: motivo,
    anuladoPor: usuario.uid,
    actualizadoEn: serverTimestamp(),
  });
  return { anulada: true, saldoAnulado: saldoAAnular, cuentaId: cuentaRef.id };
}

// Para "Vencido" / "Próximo a vencer" del dashboard — compara fechaPrevista contra hoy. Si no hay
// fechaPrevista (no siempre se conoce), no se puede clasificar como vencida: se deja fuera del corte,
// nunca se asume una fecha que no fue informada.
export function estaVencida(cuenta, hoy = new Date().toISOString().slice(0, 10)) {
  return Boolean(cuenta.fechaPrevista) && cuenta.fechaPrevista < hoy && cuenta.estado !== "cobrado";
}
export function estaProximaAVencer(cuenta, diasVentana = 7, hoy = new Date().toISOString().slice(0, 10)) {
  if (!cuenta.fechaPrevista || cuenta.estado === "cobrado") return false;
  const limite = new Date(hoy);
  limite.setDate(limite.getDate() + diasVentana);
  return cuenta.fechaPrevista >= hoy && cuenta.fechaPrevista <= limite.toISOString().slice(0, 10);
}
