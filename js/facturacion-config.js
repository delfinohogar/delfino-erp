// Configuración general de Facturación (no los datos de la empresa — esos ya viven en
// configuracion/empresa, ver js/configuracion-empresa.js — acá solo lo específico de comprobantes:
// diseño y el estado de la integración fiscal). Un solo documento, mismo patrón que
// configuracion/empresa.
import { db, doc, getDoc, setDoc } from "./firebase.js";

const REF = () => doc(db, "configuracion", "facturacion");

const DEFAULTS = {
  mostrarLogoEnComprobante: true,
  textoLegal: "Comprobante interno — sin validez fiscal.",
  // Integración fiscal — preparado para ARCA, desactivado siempre por ahora. No hay ninguna forma
  // de poner esto en true desde la UI todavía (ver configuracion/facturacion.js): es a propósito.
  arcaActivo: false,
  arcaAmbiente: "testing", // "testing" | "produccion" — no se usa mientras arcaActivo sea false
};

export async function obtenerConfigFacturacion() {
  const snap = await getDoc(REF());
  return { ...DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
}

export async function guardarDisenoComprobante({ mostrarLogoEnComprobante, textoLegal }) {
  await setDoc(REF(), { mostrarLogoEnComprobante, textoLegal: textoLegal?.trim() || DEFAULTS.textoLegal }, { merge: true });
}
