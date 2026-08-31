// Datos generales de Delfino Hogar (no de un usuario puntual): contacto, logo y datos fiscales.
// Un solo documento (configuracion/empresa), igual patrón que contadores/ventas.
import { db, doc, getDoc, setDoc } from "./firebase.js";

const REF = () => doc(db, "configuracion", "empresa");

export async function obtenerConfigEmpresa() {
  const snap = await getDoc(REF());
  return snap.exists() ? snap.data() : {};
}

export async function guardarDatosContacto({ nombreFantasia, email, telefono }) {
  await setDoc(REF(), { nombreFantasia: nombreFantasia.trim(), email: email.trim(), telefono: telefono.trim() }, { merge: true });
}

export async function guardarLogo(logoDataUrl) {
  await setDoc(REF(), { logoDataUrl }, { merge: true });
}

export async function guardarDatosFiscales({ cuit, datosArca, inicioActividades, iibb }) {
  const cambios = {
    cuit: cuit.trim(),
    inicioActividades: inicioActividades || null,
    iibb: iibb?.trim() || null,
  };
  if (datosArca) {
    Object.assign(cambios, {
      razonSocial: datosArca.razonSocial || null,
      condicionIva: datosArca.condicionIva || null,
      domicilioFiscal: datosArca.domicilioFiscal || null,
      provincia: datosArca.provincia || null,
      codigoPostal: datosArca.codigoPostal || null,
      fechaConsultaArca: new Date(),
    });
  }
  await setDoc(REF(), cambios, { merge: true });
}
