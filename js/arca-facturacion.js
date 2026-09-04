// Cliente de la integración fiscal ARCA (WSFEv1) — el certificado y la clave privada viven
// exclusivamente en la Cloud Function (functions/arcaFacturacion.js); acá solo hay una llamada
// httpsCallable, nunca ninguna credencial. Ver js/facturacion.js (ArcaFiscalProvider) para el punto
// de entrada real — este módulo no se usa desde ningún otro lado.
import { functions, httpsCallable } from "./firebase.js";

// datos: { comprobanteId, ptoVta, items, receptor: { cuit, condicionIva }, ambiente }
export async function autorizarComprobanteArca(datos) {
  const fn = httpsCallable(functions, "arcaAutorizarComprobante");
  const res = await fn(datos);
  return res.data; // { arcaEstado, cae, caeVencimiento, qr, numeroFiscal, tipoComprobanteFiscal, fechaAutorizacion, arcaErrorCodigo, arcaErrorDescripcion }
}
