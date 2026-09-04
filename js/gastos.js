// Gastos: siempre atados a una salida real de dinero de una caja o una cuenta bancaria puntual — no
// existe "gasto" sin un movimiento de egreso detrás (ver registrarGasto). Categorías libres, no una
// lista cerrada — el usuario tipea la que corresponda y el picker sugiere las ya usadas.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";
import { registrarMovimientoCaja } from "./cajas.js";
import { registrarMovimientoBancario } from "./bancos.js";
import { generarAsiento, CUENTA, cuentaParaDestinoTesoreria } from "./contabilidad.js";

// datos: { fecha, sucursalId, sucursalNombre, categoria, proveedorNombre?, concepto, importe,
//          medioPago, destino: { tipo: "caja"|"banco", id, nombre, sesionId? }, comprobante? }
export async function registrarGasto(datos, usuario) {
  if (!(datos.importe > 0)) throw new Error("El importe tiene que ser mayor a cero.");
  if (!datos.destino?.id) throw new Error("Elegí de dónde sale la plata (caja o cuenta bancaria).");

  const ref = await addDoc(collection(db, "gastos"), {
    fecha: datos.fecha || new Date().toISOString().slice(0, 10),
    sucursalId: datos.sucursalId || null,
    sucursalNombre: datos.sucursalNombre || null,
    categoria: datos.categoria.trim(),
    proveedorNombre: datos.proveedorNombre?.trim() || null,
    concepto: datos.concepto.trim(),
    importe: Math.round(datos.importe * 100) / 100,
    medioPago: datos.medioPago || "Efectivo",
    destinoTipo: datos.destino.tipo,
    destinoId: datos.destino.id,
    destinoNombre: datos.destino.nombre,
    comprobante: datos.comprobante?.trim() || null,
    estado: "registrado",
    usuario: usuario.uid,
    usuarioNombre: usuario.nombre || usuario.email,
    creadoEn: serverTimestamp(),
  });

  const origen = { tipo: "gasto", id: ref.id };
  if (datos.destino.tipo === "caja") {
    await registrarMovimientoCaja(
      { cajaId: datos.destino.id, sesionId: datos.destino.sesionId, sucursalId: datos.sucursalId, tipo: "egreso", concepto: `Gasto — ${datos.categoria}: ${datos.concepto}`, importe: datos.importe, medio: datos.medioPago, origen },
      usuario
    );
  } else {
    await registrarMovimientoBancario(
      { cuentaId: datos.destino.id, fecha: datos.fecha, tipo: "egreso", concepto: `Gasto — ${datos.categoria}: ${datos.concepto}`, importe: datos.importe, origen },
      usuario
    );
  }

  // Antes un gasto nunca generaba asiento — Contabilidad no se enteraba de ningún egreso operativo
  // (alquiler, insumos, servicios), así que Estado de Resultados/Sumas y Saldos quedaban siempre
  // sobrestimados en la ganancia por el total acumulado de gastos, sin ningún aviso.
  await generarAsiento(
    {
      fecha: datos.fecha || new Date().toISOString().slice(0, 10),
      descripcion: `Gasto — ${datos.categoria}: ${datos.concepto}`,
      origen,
      movimientos: [
        { cuenta: CUENTA.GASTOS_GENERALES, debe: Math.round(datos.importe * 100) / 100, haber: 0 },
        { cuenta: cuentaParaDestinoTesoreria(datos.destino.tipo), debe: 0, haber: Math.round(datos.importe * 100) / 100 },
      ],
    },
    usuario
  );

  return { id: ref.id };
}

export async function listarGastos({ desde, hasta, sucursalId, maxResultados = 300 } = {}) {
  let clausulas = [orderBy("fecha", "desc"), limit(maxResultados)];
  if (desde) clausulas.unshift(where("fecha", ">=", desde));
  if (hasta) clausulas.unshift(where("fecha", "<=", hasta));
  if (sucursalId) clausulas.unshift(where("sucursalId", "==", sucursalId));
  const snap = await getDocs(query(collection(db, "gastos"), ...clausulas));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function categoriasUsadas() {
  const gastos = await listarGastos({ maxResultados: 500 });
  return [...new Set(gastos.map((g) => g.categoria))].sort();
}

export async function obtenerGasto(id) {
  const snap = await getDoc(doc(db, "gastos", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function anularGasto(id, motivo, usuario) {
  const gastoSnap = await getDoc(doc(db, "gastos", id));
  const gasto = gastoSnap.exists() ? gastoSnap.data() : null;

  await updateDoc(doc(db, "gastos", id), {
    estado: "anulado",
    motivoAnulacion: motivo,
    anuladoPor: usuario.uid,
    anuladoPorNombre: usuario.nombre || usuario.email,
    fechaAnulacion: serverTimestamp(),
  });
  // El egreso de caja/banco que generó este gasto también se anula — si no, seguiría restando saldo
  // aunque el gasto ya no cuente (el saldo siempre sale de sumar movimientos, nunca de un ajuste manual).
  const cajaSnap = await getDocs(query(collection(db, "movimientosCaja"), where("origen.tipo", "==", "gasto"), where("origen.id", "==", id)));
  for (const d of cajaSnap.docs) {
    await updateDoc(doc(db, "movimientosCaja", d.id), { estado: "anulado", motivoAnulacion: motivo, anuladoPor: usuario.uid, anuladoPorNombre: usuario.nombre || usuario.email, fechaAnulacion: serverTimestamp() });
  }
  const bancoSnap = await getDocs(query(collection(db, "movimientosBancarios"), where("origen.tipo", "==", "gasto"), where("origen.id", "==", id)));
  for (const d of bancoSnap.docs) {
    await updateDoc(doc(db, "movimientosBancarios", d.id), { estado: "anulado", motivoAnulacion: motivo, anuladoPor: usuario.uid, anuladoPorNombre: usuario.nombre || usuario.email, fechaAnulacion: serverTimestamp() });
  }

  // asientosContables es inmutable (allow update: if false) — el asiento original del gasto no se
  // puede tocar, así que la anulación se contabiliza con un asiento inverso, no con un borrado.
  if (gasto) {
    await generarAsiento(
      {
        fecha: new Date().toISOString().slice(0, 10),
        descripcion: `Anulación de gasto — ${gasto.categoria}: ${gasto.concepto} (${motivo})`,
        origen: { tipo: "gasto", id, anulacion: true },
        movimientos: [
          { cuenta: cuentaParaDestinoTesoreria(gasto.destinoTipo), debe: Math.round(gasto.importe * 100) / 100, haber: 0 },
          { cuenta: CUENTA.GASTOS_GENERALES, debe: 0, haber: Math.round(gasto.importe * 100) / 100 },
        ],
      },
      usuario
    );
  }
}
