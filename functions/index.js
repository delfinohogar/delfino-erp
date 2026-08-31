// Consulta el padrón de ARCA para un CUIT dado — directo contra los servidores de ARCA
// (WSAA + SOAP), sin pasar por ningún servicio de terceros. Combina dos servicios:
//   - Padrón Alcance 13 (ws_sr_padron_a13): razón social, domicilio, actividad.
//   - Constancia de inscripción (ws_sr_constancia_inscripcion / A5): condición frente al IVA.
// Ver arcaWsaa.js para el detalle del login y la consulta a cada uno.
//
// Requiere 3 secrets configurados en Firebase (nunca se suben al repo):
//   AFIP_CERT   (contenido del archivo .crt, certificado de producción emitido por ARCA)
//   AFIP_KEY    (contenido de la clave privada .key correspondiente)
//   AFIP_CUIT   (CUIT de Delfino Hogar, el que autorizó ambos servicios en ARCA)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { consultarPersonaA13, consultarPersonaA5 } = require("./arcaWsaa");

admin.initializeApp();

// Botón de chat con la IA (consultas de solo-lectura sobre los datos del ERP).
exports.chatConsulta = require("./chatIa").chatConsulta;

// Lee un PDF/foto de factura de compra y devuelve los campos para precargar "Nueva compra".
exports.extraerFactura = require("./extraerFactura").extraerFactura;

const afipCert = defineSecret("AFIP_CERT");
const afipKey = defineSecret("AFIP_KEY");
const afipCuit = defineSecret("AFIP_CUIT");

function limpiarCuit(cuit) {
  return (cuit || "").toString().replace(/\D/g, "");
}

// idImpuesto del catálogo de ARCA para IVA (impuesto 30).
const ID_IMPUESTO_IVA = 30;

// A partir de la respuesta de A5 (constancia de inscripción), arma la condición frente al IVA
// propiamente dicha (Responsable Inscripto / Monotributista / etc.) — no la lista completa de
// impuestos en los que está inscripto (eso queda aparte, no hace falta mezclarlo acá).
function condicionIvaDesdePersonaA5(personaA5) {
  if (!personaA5) return null;

  if (personaA5.datosMonotributo) {
    const categoria = personaA5.datosMonotributo.descripcionCategoria || personaA5.datosMonotributo.categoriaMonotributo;
    return categoria ? `Monotributista (categoría ${categoria})` : "Monotributista";
  }

  const impuestosRaw = personaA5.datosRegimenGeneral?.impuesto;
  const impuestos = Array.isArray(impuestosRaw) ? impuestosRaw : impuestosRaw ? [impuestosRaw] : [];
  const iva = impuestos.find((i) => Number(i.idImpuesto) === ID_IMPUESTO_IVA);
  if (iva) return iva.estadoImpuesto === "AC" ? "Responsable Inscripto" : "IVA dado de baja";

  return impuestos.length ? "No inscripto en IVA" : null;
}

exports.consultarPadronArca = onCall(
  { region: "southamerica-east1", secrets: [afipCert, afipKey, afipCuit], timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Hay que estar logueado para consultar ARCA.");
    }

    const cuitConsultado = limpiarCuit(request.data?.cuit);
    if (cuitConsultado.length !== 11) {
      throw new HttpsError("invalid-argument", "El CUIT debe tener 11 dígitos.");
    }

    const cuitRepresentada = limpiarCuit(afipCuit.value());
    const cert = afipCert.value();
    const key = afipKey.value();

    let persona;
    try {
      persona = await consultarPersonaA13({ cuitRepresentada, cuitConsultado, cert, key });
    } catch (err) {
      console.error("Error consultando padrón A13:", err?.message || err);
      throw new HttpsError("not-found", "No se encontraron datos para ese CUIT en ARCA: " + (err?.message || "error desconocido"));
    }

    // La condición de IVA es "best effort": si todavía no autorizaste este segundo servicio en
    // ARCA (o falla por lo que sea), no rompe la consulta principal — solo queda sin ese dato.
    let condicionIva = null;
    try {
      const personaA5 = await consultarPersonaA5({ cuitRepresentada, cuitConsultado, cert, key });
      condicionIva = condicionIvaDesdePersonaA5(personaA5);
    } catch (err) {
      console.error("Error consultando constancia de inscripción (A5):", err?.message || err);
    }

    const domiciliosRaw = persona.domicilio;
    const domicilios = Array.isArray(domiciliosRaw) ? domiciliosRaw : domiciliosRaw ? [domiciliosRaw] : [];
    const domicilioFiscal = domicilios.find((d) => d.tipoDomicilio === "FISCAL") || domicilios[0] || {};

    return {
      razonSocial: persona.razonSocial || [persona.nombre, persona.apellido].filter(Boolean).join(" ") || null,
      condicionIva,
      domicilioFiscal: domicilioFiscal.direccion || null,
      provincia: domicilioFiscal.descripcionProvincia || null,
      codigoPostal: domicilioFiscal.codigoPostal || null,
      situacionTributaria: persona.estadoClave || null,
      actividades: persona.descripcionActividadPrincipal
        ? [{ id: persona.idActividadPrincipal, descripcion: persona.descripcionActividadPrincipal }]
        : [],
    };
  }
);
