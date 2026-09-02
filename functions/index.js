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
// Evita que un campo "undefined" (en vez de null) tumbe un write entero — mejor que falte el campo
// a que se caiga toda la operación por un detalle de serialización.
admin.firestore().settings({ ignoreUndefinedProperties: true });

// Botón de chat con la IA (consultas de solo-lectura sobre los datos del ERP).
exports.chatConsulta = require("./chatIa").chatConsulta;

// Lee un PDF/foto de factura de compra y devuelve los campos para precargar "Nueva compra".
exports.extraerFactura = require("./extraerFactura").extraerFactura;

// Cargar credenciales (secrets) desde una pantalla del ERP en vez de la terminal.
exports.guardarSecretoAdmin = require("./secretosAdmin").guardarSecretoAdmin;

// Alta de usuario (login + perfil) en un solo paso, sin pasar por Firebase Console.
exports.crearUsuarioCompleto = require("./usuariosAdmin").crearUsuarioCompleto;

// Integración de Mercado Pago Point (entorno de pruebas) — ver mercadoPago.js para el detalle.
const mercadoPago = require("./mercadoPago");
exports.mpProbarConexion = mercadoPago.mpProbarConexion;
exports.mpListarTerminales = mercadoPago.mpListarTerminales;
exports.mpConfigurarPuntoDeVenta = mercadoPago.mpConfigurarPuntoDeVenta;
exports.mpCrearOrdenPrueba = mercadoPago.mpCrearOrdenPrueba;
exports.mpCrearOrdenVenta = mercadoPago.mpCrearOrdenVenta;
exports.mpCancelarOrden = mercadoPago.mpCancelarOrden;
exports.mpVincularVenta = mercadoPago.mpVincularVenta;
exports.mpSimularEventoOrden = mercadoPago.mpSimularEventoOrden;
exports.mpConsultarPago = mercadoPago.mpConsultarPago;
exports.mpCrearDevolucion = mercadoPago.mpCrearDevolucion;
exports.mpWebhook = mercadoPago.mpWebhook;

// Autorización fiscal (WSFEv1) — ver arcaFacturacion.js. Inerte mientras
// configuracion/facturacion.arcaActivo sea false (siempre, por ahora).
exports.arcaAutorizarComprobante = require("./arcaFacturacion").arcaAutorizarComprobante;

const afipCert = defineSecret("AFIP_CERT");
const afipKey = defineSecret("AFIP_KEY");
const afipCuit = defineSecret("AFIP_CUIT");

function limpiarCuit(cuit) {
  return (cuit || "").toString().replace(/\D/g, "");
}

// idImpuesto del catálogo de ARCA para IVA (impuesto 30).
const ID_IMPUESTO_IVA = 30;

// El parser XML (fast-xml-parser, ignoreAttributes:true) devuelve string para un nodo hoja
// normal, pero si ARCA lo manda con atributos o hijos mixtos puede llegar como objeto
// ({"#text": "..."} o un objeto con la primera propiedad útil) — de ahí salió el bug real de
// "[object Object]" en la ficha de un cliente: se interpolaba el objeto crudo en el template
// literal sin extraer el texto. Esto lo blinda para cualquier campo de texto que venga de ARCA,
// no solo para este caso puntual.
function textoDeCampoArca(valor) {
  if (valor == null) return null;
  if (typeof valor === "string" || typeof valor === "number") return String(valor).trim() || null;
  if (typeof valor === "object") {
    if (typeof valor["#text"] === "string") return valor["#text"].trim() || null;
    const primerString = Object.values(valor).find((v) => typeof v === "string" && v.trim());
    if (primerString) return primerString.trim();
  }
  return null;
}

// A partir de la respuesta de A5 (constancia de inscripción), arma la condición frente al IVA
// propiamente dicha (Responsable Inscripto / Monotributista / etc.) — no la lista completa de
// impuestos en los que está inscripto (eso queda aparte, no hace falta mezclarlo acá).
function condicionIvaDesdePersonaA5(personaA5) {
  if (!personaA5) return null;

  if (personaA5.datosMonotributo) {
    const categoria = textoDeCampoArca(personaA5.datosMonotributo.descripcionCategoria) || textoDeCampoArca(personaA5.datosMonotributo.categoriaMonotributo);
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

    // Todo lo que viene de ARCA pasa por textoDeCampoArca antes de salir de acá — se guarda en
    // Firestore y se renderiza en varias pantallas (ficha de cliente/proveedor, modal de alta),
    // así que un campo mal parseado como objeto tiene que quedar blindado en el origen, no en
    // cada lugar que lo consume después.
    const descripcionActividad = textoDeCampoArca(persona.descripcionActividadPrincipal);

    return {
      razonSocial:
        textoDeCampoArca(persona.razonSocial) ||
        [textoDeCampoArca(persona.nombre), textoDeCampoArca(persona.apellido)].filter(Boolean).join(" ") ||
        null,
      condicionIva,
      domicilioFiscal: textoDeCampoArca(domicilioFiscal.direccion),
      provincia: textoDeCampoArca(domicilioFiscal.descripcionProvincia),
      codigoPostal: textoDeCampoArca(domicilioFiscal.codigoPostal),
      situacionTributaria: textoDeCampoArca(persona.estadoClave),
      actividades: descripcionActividad ? [{ id: textoDeCampoArca(persona.idActividadPrincipal), descripcion: descripcionActividad }] : [],
    };
  }
);
