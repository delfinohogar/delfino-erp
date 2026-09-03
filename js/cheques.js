// Cheques emitidos contra una chequera. Un cheque NO toca movimientosBancarios (el saldo real) hasta
// que se efectiviza — mientras tanto queda "pendiente" y solo se descuenta del saldo proyectado (ver
// saldoProyectado más abajo), que es una consulta aparte, nunca el saldo real de la cuenta.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, serverTimestamp, runTransaction } from "./firebase.js";
import { registrarMovimientoBancario } from "./bancos.js";

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

// datos: { chequeraId, fechaPago, beneficiario, concepto?, importe, origen?: { tipo, id } }
// Si fechaPago es hoy o pasada, el cheque se efectiviza en el momento (crea el movimiento bancario ya).
// Si es futura, queda "pendiente" — recién se efectiviza con efectivizarCheque, a mano o cuando llegue la fecha.
export async function emitirCheque(datos, usuario) {
  if (!(datos.importe > 0)) throw new Error("El importe tiene que ser mayor a cero.");
  if (!datos.beneficiario?.trim()) throw new Error("Falta el beneficiario del cheque.");
  if (!datos.chequeraId) throw new Error("Falta elegir la chequera.");

  const chequeraRef = doc(db, "chequeras", datos.chequeraId);
  const { chequera, numeroCheque } = await runTransaction(db, async (tx) => {
    const snap = await tx.get(chequeraRef);
    if (!snap.exists()) throw new Error("No se encontró la chequera.");
    const chequera = snap.data();
    if (chequera.activa === false) throw new Error("Esta chequera está inactiva.");
    if (chequera.proximoNumero > chequera.numeroHasta) throw new Error("Esta chequera no tiene más números disponibles.");
    const numeroCheque = chequera.proximoNumero;
    tx.update(chequeraRef, { proximoNumero: numeroCheque + 1 });
    return { chequera, numeroCheque };
  });

  const fechaEmision = hoy();
  const fechaPago = datos.fechaPago || fechaEmision;
  const esInmediato = fechaPago <= fechaEmision;
  const beneficiario = datos.beneficiario.trim();
  const concepto = datos.concepto?.trim() || "";

  const ref = await addDoc(collection(db, "chequesEmitidos"), {
    cuentaBancariaId: chequera.cuentaBancariaId,
    cuentaBancariaNombre: chequera.cuentaBancariaNombre,
    bancoNombre: chequera.bancoNombre,
    chequeraId: datos.chequeraId,
    numeroCheque,
    fechaEmision,
    fechaPago,
    beneficiario,
    concepto,
    importe: Math.round(datos.importe * 100) / 100,
    estado: esInmediato ? "efectivizado" : "pendiente",
    movimientoBancarioId: null,
    fechaEfectivizacion: esInmediato ? fechaPago : null,
    origen: datos.origen || null,
    motivoAnulacion: null,
    anuladoPor: null,
    anuladoPorNombre: null,
    fechaAnulacion: null,
    creadoEn: serverTimestamp(),
    creadoPor: usuario.uid,
    creadoPorNombre: usuario.nombre || usuario.email,
  });

  if (esInmediato) {
    const mov = await registrarMovimientoBancario(
      {
        cuentaId: chequera.cuentaBancariaId,
        fecha: fechaPago,
        tipo: "egreso",
        concepto: `Cheque N° ${numeroCheque} — ${beneficiario}${concepto ? " · " + concepto : ""}`,
        importe: datos.importe,
        referencia: `Cheque ${numeroCheque}`,
        origen: { tipo: "cheque", id: ref.id },
      },
      usuario
    );
    await updateDoc(doc(db, "chequesEmitidos", ref.id), { movimientoBancarioId: mov.id });
  }

  return { id: ref.id, numeroCheque, estado: esInmediato ? "efectivizado" : "pendiente" };
}

// Pasa un cheque pendiente a efectivizado — a mano (el usuario confirma que el banco ya lo debitó) o
// llamado desde una pantalla que recorre los que ya llegaron a su fechaPago. Recién acá se crea el
// movimiento bancario real; hasta este momento el cheque solo vivía en el saldo proyectado.
export async function efectivizarCheque(chequeId, usuario) {
  const ref = doc(db, "chequesEmitidos", chequeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("No se encontró el cheque.");
  const cheque = snap.data();
  if (cheque.estado !== "pendiente") throw new Error("Este cheque no está pendiente.");

  const mov = await registrarMovimientoBancario(
    {
      cuentaId: cheque.cuentaBancariaId,
      fecha: cheque.fechaPago,
      tipo: "egreso",
      concepto: `Cheque N° ${cheque.numeroCheque} — ${cheque.beneficiario}${cheque.concepto ? " · " + cheque.concepto : ""}`,
      importe: cheque.importe,
      referencia: `Cheque ${cheque.numeroCheque}`,
      origen: { tipo: "cheque", id: chequeId },
    },
    usuario
  );
  await updateDoc(ref, { estado: "efectivizado", movimientoBancarioId: mov.id, fechaEfectivizacion: cheque.fechaPago });
}

export async function anularCheque(chequeId, motivo, usuario) {
  const ref = doc(db, "chequesEmitidos", chequeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("No se encontró el cheque.");
  const cheque = snap.data();
  if (cheque.estado === "anulado") throw new Error("Este cheque ya está anulado.");
  if (cheque.estado === "efectivizado") throw new Error("Este cheque ya se efectivizó — para anularlo hay que anular el movimiento bancario en Bancos.");
  await updateDoc(ref, {
    estado: "anulado",
    motivoAnulacion: motivo || null,
    anuladoPor: usuario.uid,
    anuladoPorNombre: usuario.nombre || usuario.email,
    fechaAnulacion: serverTimestamp(),
  });
}

export async function listarChequesPorCuenta(cuentaBancariaId) {
  const snap = await getDocs(query(collection(db, "chequesEmitidos"), where("cuentaBancariaId", "==", cuentaBancariaId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.numeroCheque - b.numeroCheque);
}

export async function listarChequesPendientes() {
  const snap = await getDocs(query(collection(db, "chequesEmitidos"), where("estado", "==", "pendiente")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.fechaPago < b.fechaPago ? -1 : a.fechaPago > b.fechaPago ? 1 : 0));
}

// Saldo actual menos lo comprometido en cheques pendientes — la "foto a futuro" de la cuenta. Nunca
// se guarda: siempre se calcula sobre saldoActual + los pendientes vigentes en ese momento.
export function saldoProyectado(saldoActual, chequesPendientes) {
  const comprometido = chequesPendientes.reduce((acc, c) => acc + c.importe, 0);
  return Math.round((saldoActual - comprometido) * 100) / 100;
}
