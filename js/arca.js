// Consulta el padrón de ARCA (ws_sr_padron_a13) para un CUIT, vía Cloud Function.
// La function guarda el certificado/clave privada del lado del servidor — nunca viaja al navegador.
// Hasta que exista esa function (requiere plan Blaze + certificado ARCA), esto rechaza con un mensaje claro.
import { functions, httpsCallable } from "./firebase.js";

export async function consultarPadronArca(cuit) {
  const fn = httpsCallable(functions, "consultarPadronArca");
  const res = await fn({ cuit });
  // Se espera: { razonSocial, condicionIva, domicilioFiscal, provincia, codigoPostal, situacionTributaria, actividades: [] }
  return res.data;
}
