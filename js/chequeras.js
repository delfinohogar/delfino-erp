// Chequeras: el rango de números de cheque que un banco le asignó a una cuenta. Emitir un cheque
// (ver js/cheques.js) consume el próximo número de la chequera activa — nunca se elige a mano.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, serverTimestamp } from "./firebase.js";

// datos: { cuentaBancariaId, cuentaBancariaNombre, bancoNombre, numeroDesde, numeroHasta }
export async function crearChequera(datos, usuario) {
  if (!(datos.numeroDesde > 0)) throw new Error("El número desde tiene que ser mayor a cero.");
  if (!(datos.numeroHasta >= datos.numeroDesde)) throw new Error("El número hasta tiene que ser mayor o igual al número desde.");
  const ref = await addDoc(collection(db, "chequeras"), {
    cuentaBancariaId: datos.cuentaBancariaId,
    cuentaBancariaNombre: datos.cuentaBancariaNombre,
    bancoNombre: datos.bancoNombre,
    numeroDesde: datos.numeroDesde,
    numeroHasta: datos.numeroHasta,
    proximoNumero: datos.numeroDesde,
    activa: true,
    creadoEn: serverTimestamp(),
    creadoPor: usuario.uid,
    creadoPorNombre: usuario.nombre || usuario.email,
  });
  return { id: ref.id };
}

export async function listarChequerasPorCuenta(cuentaBancariaId) {
  const snap = await getDocs(query(collection(db, "chequeras"), where("cuentaBancariaId", "==", cuentaBancariaId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.numeroDesde - b.numeroDesde);
}

export async function obtenerChequera(id) {
  const snap = await getDoc(doc(db, "chequeras", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function actualizarChequera(id, { activa }) {
  await updateDoc(doc(db, "chequeras", id), { activa });
}

export function numerosDisponibles(chequera) {
  return Math.max(chequera.numeroHasta - chequera.proximoNumero + 1, 0);
}
