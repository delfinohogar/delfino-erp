import { functions, httpsCallable } from "./firebase.js";

export async function preguntarIa(mensaje, historial = []) {
  const fn = httpsCallable(functions, "chatConsulta");
  const res = await fn({ mensaje, historial });
  return res.data; // { respuesta, historial }
}
