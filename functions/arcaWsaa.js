// Integración directa con ARCA (ex AFIP), sin intermediarios de terceros:
//   1) Arma el "Login Ticket Request" y lo firma como CMS/PKCS#7 con el certificado propio
//      (node-forge, todo en el propio proceso — la clave privada nunca sale de este Cloud Function).
//   2) Se lo manda al WSAA (wsaa.afip.gov.ar) y obtiene el token/sign (Ticket de Acceso).
//   3) Con ese ticket consulta el padrón (ws_sr_padron_a13) directo contra aws.afip.gov.ar.
//
// Namespaces y endpoints confirmados contra los WSDL reales el 31/08/2026:
//   https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl
//   https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13?wsdl
const forge = require("node-forge");
const { XMLParser } = require("fast-xml-parser");

const WSAA_URL = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const PADRON_A13_URL = "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13";
const PADRON_A5_URL = "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5";

// Argentina es GMT-3 fijo (no tiene horario de verano desde 2009). El WSAA exige el offset
// explícito en generationTime/expirationTime — mandarlas en UTC ("Z") hace que rechace el ticket.
function formatearFechaArg(date) {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

function crearLoginTicketXml(servicio) {
  const ahora = new Date();
  const generationTime = formatearFechaArg(new Date(ahora.getTime() - 60 * 1000));
  const expirationTime = formatearFechaArg(new Date(ahora.getTime() + 10 * 60 * 1000));
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

// CMS (PKCS#7) firmado con el certificado propio, con el contenido embebido (equivalente a
// `openssl smime -sign -nodetach -outform DER`), codificado en base64 tal como lo pide el WSAA.
function firmarCms(xml, certPem, keyPem) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// El TA (Ticket de Acceso) es válido ~12hs, pero acá se pide uno nuevo por invocación —
// simple y suficiente para el volumen de consultas de este ERP; se puede cachear más adelante
// (ej. en Firestore) si hiciera falta reducir la latencia.
async function obtenerTicketAcceso(servicio, certPem, keyPem) {
  const xml = crearLoginTicketXml(servicio);
  const cms = firmarCms(xml, certPem, keyPem);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(WSAA_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: soapBody,
  });
  const texto = await res.text();

  const fault = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error("WSAA rechazó el login: " + decodeEntities(fault[1]));
  if (!res.ok) throw new Error(`WSAA respondió ${res.status}: ${texto.slice(0, 500)}`);

  const ret = texto.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/);
  if (!ret) throw new Error("Respuesta de WSAA inesperada: " + texto.slice(0, 500));

  const ticketXml = decodeEntities(ret[1]);
  const token = ticketXml.match(/<token>([\s\S]*?)<\/token>/)?.[1];
  const sign = ticketXml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1];
  if (!token || !sign) throw new Error("No se pudo extraer token/sign del ticket de WSAA.");
  return { token, sign };
}

// Helper genérico: A13 y A5 comparten exactamente la misma firma de getPersona
// (token, sign, cuitRepresentada, idPersona), solo cambian servicio/endpoint/namespace.
async function consultarPersonaGenerica({ servicioWsaa, url, namespace, prefijo, cuitRepresentada, cuitConsultado, cert, key }) {
  const { token, sign } = await obtenerTicketAcceso(servicioWsaa, cert, key);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:${prefijo}="${namespace}">
  <soapenv:Header/>
  <soapenv:Body>
    <${prefijo}:getPersona>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${cuitRepresentada}</cuitRepresentada>
      <idPersona>${cuitConsultado}</idPersona>
    </${prefijo}:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: soapBody,
  });
  const texto = await res.text();

  const fault = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error("El padrón rechazó la consulta: " + decodeEntities(fault[1]));
  if (!res.ok) throw new Error(`El padrón respondió ${res.status}: ${texto.slice(0, 500)}`);

  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
  const parsed = parser.parse(texto);
  const personaReturn = parsed?.Envelope?.Body?.getPersonaResponse?.personaReturn;
  if (!personaReturn) {
    throw new Error("No se encontraron datos para ese CUIT en el padrón.");
  }
  // A13 envuelve los datos en "persona"; A5 (constancia de inscripción) los deja directo en
  // personaReturn (datosGenerales/datosRegimenGeneral/datosMonotributo) — se admiten ambas formas.
  return personaReturn.persona || personaReturn;
}

// cuitRepresentada: CUIT de Delfino Hogar (el que autorizó el servicio en ARCA).
// cuitConsultado: CUIT que se quiere averiguar (el del proveedor/cliente).
function consultarPersonaA13({ cuitRepresentada, cuitConsultado, cert, key }) {
  return consultarPersonaGenerica({
    servicioWsaa: "ws_sr_padron_a13",
    url: PADRON_A13_URL,
    namespace: "http://a13.soap.ws.server.puc.sr/",
    prefijo: "a13",
    cuitRepresentada,
    cuitConsultado,
    cert,
    key,
  });
}

// Padrón Alcance 5 = "Consulta de constancia de inscripción": trae la condición frente al IVA,
// categoría de monotributo, régimen general, etc. — datos que A13 no incluye.
function consultarPersonaA5({ cuitRepresentada, cuitConsultado, cert, key }) {
  return consultarPersonaGenerica({
    servicioWsaa: "ws_sr_constancia_inscripcion",
    url: PADRON_A5_URL,
    namespace: "http://a5.soap.ws.server.puc.sr/",
    prefijo: "a5",
    cuitRepresentada,
    cuitConsultado,
    cert,
    key,
  });
}

module.exports = { consultarPersonaA13, consultarPersonaA5 };
