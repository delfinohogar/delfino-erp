// Cliente de Mercado Pago (Point/Orders API, pagos presenciales) — el Access Token vive
// exclusivamente en las Cloud Functions (functions/mercadoPago.js); acá solo hay llamadas
// httpsCallable, nunca ninguna credencial secreta.
import { db, doc, getDoc, setDoc, functions, httpsCallable } from "./firebase.js";

const REF = () => doc(db, "configuracion", "mercadoPago");

export async function obtenerConfigMercadoPago() {
  const snap = await getDoc(REF());
  return snap.exists() ? snap.data() : { modo: "test", habilitado: false };
}

export async function guardarConfigMercadoPago({ modo }) {
  await setDoc(REF(), { modo }, { merge: true });
}

export async function probarConexionMercadoPago(modo = "test") {
  const fn = httpsCallable(functions, "mpProbarConexion");
  const res = await fn({ modo });
  return res.data; // { ok, cantidadMediosPago }
}

export async function listarTerminales() {
  const fn = httpsCallable(functions, "mpListarTerminales");
  const res = await fn({});
  return res.data.terminales; // [{ id, pos_id, store_id, operating_mode }]
}

export async function crearOrdenPrueba(terminalId) {
  const fn = httpsCallable(functions, "mpCrearOrdenPrueba");
  const res = await fn({ terminalId });
  return res.data; // { orderId, status }
}

// estado: "processed" | "failed" | "refunded" | "canceled" — SOLO tiene efecto en sandbox, hace
// las veces del terminal físico reportando el resultado.
export async function simularEventoOrden(orderId, estado) {
  const fn = httpsCallable(functions, "mpSimularEventoOrden");
  const res = await fn({ orderId, estado });
  return res.data;
}

export async function consultarPago(orderId) {
  const fn = httpsCallable(functions, "mpConsultarPago");
  const res = await fn({ orderId });
  return res.data;
}

export async function crearDevolucion(orderId, monto) {
  const fn = httpsCallable(functions, "mpCrearDevolucion");
  const res = await fn({ orderId, monto });
  return res.data; // { estado }
}
