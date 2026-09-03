// Cliente SOAP para el webservice de GlobalBluePoint (wsBasicQuery.asmx) — mismo endpoint y patrón
// de autenticación que ya usa gbp-tiendanube-sync (proyecto externo, no este repo), portado acá para
// que las Cloud Functions de Delfino ERP puedan llamarlo directamente.
//
// wsExportDataById(intExpgr_id) ejecuta una "Exportación Personalizada" dada de alta en GBP
// (Configuración > Exportación Personalizada) y devuelve el resultado como un string con XML anidado
// (GBP-dentro-de-GBP) — por eso el doble parseo en parseTablaXml.
//
// IMPORTANTE: las etiquetas @datFromDate/@datToDate/@intUser_ID etc. que documenta la wiki de GBP
// para las Exportaciones Personalizadas SOLO se completan desde el formulario interactivo de esa
// pantalla — llamado por webservice (sin sesión de usuario) tira "Object reference not set to an
// instance of an object" (confirmado con una llamada real). Por eso las consultas que arma este
// proyecto usan un filtro de fecha calculado en la propia SQL (DATEADD/GETDATE), sin parámetros.
const { defineSecret } = require("firebase-functions/params");
const { XMLParser } = require("fast-xml-parser");

const gbpEndpoint = defineSecret("GBP_ENDPOINT");
const gbpUsername = defineSecret("GBP_USERNAME");
const gbpPassword = defineSecret("GBP_PASSWORD");
const gbpCompany = defineSecret("GBP_COMPANY");
const gbpWebservice = defineSecret("GBP_WEBSERVICE");

// Para declarar en el arreglo "secrets" de cada función que use este cliente.
const GBP_SECRETS = [gbpEndpoint, gbpUsername, gbpPassword, gbpCompany, gbpWebservice];

const parser = new XMLParser({ ignoreAttributes: false });

function buildEnvelope(methodName, paramsXml, token) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <wsBasicQueryHeader xmlns="http://microsoft.com/webservices/">
      <pUsername>${gbpUsername.value()}</pUsername>
      <pPassword>${gbpPassword.value()}</pPassword>
      <pCompany>${gbpCompany.value()}</pCompany>
      <pWebWervice>${gbpWebservice.value()}</pWebWervice>
      <pAuthenticatedToken>${token || ""}</pAuthenticatedToken>
    </wsBasicQueryHeader>
  </soap:Header>
  <soap:Body>
    <${methodName} xmlns="http://microsoft.com/webservices/">${paramsXml || ""}</${methodName}>
  </soap:Body>
</soap:Envelope>`;
}

// Solo las 5 entidades XML estándar — a mano, porque el des-escapado genérico de fast-xml-parser
// tiene un límite de seguridad (pensado contra XML-bombs) que una respuesta grande y legítima de
// este webservice supera de sobra (ver comentario en callSoap).
function unescapeXmlEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // el amp va último, para no des-escapar dos veces
}

async function callSoap(methodName, paramsXml, token) {
  const envelope = buildEnvelope(methodName, paramsXml, token);
  const res = await fetch(gbpEndpoint.value(), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"http://microsoft.com/webservices/${methodName}"`,
    },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GBP SOAP error (${methodName}): HTTP ${res.status} - ${text.slice(0, 500)}`);
  }
  // Métodos como wsExportDataById pueden devolver miles de filas — GBP las manda como XML-dentro-de-
  // XML, es decir el resultado entero viaja escapado como TEXTO dentro del sobre SOAP (&lt;Table&gt;
  // por cada fila). Parsear el sobre completo con fast-xml-parser choca con su límite de "entity
  // expansion" (>1000, pensado para bloquear XML-bombs, no respuestas grandes legítimas) — por eso
  // se extrae el resultado con una regex dirigida al tag exacto y se des-escapa a mano, sin ese límite.
  const match = text.match(new RegExp(`<${methodName}Result[^>]*>([\\s\\S]*?)</${methodName}Result>`));
  if (!match) {
    throw new Error(`GBP SOAP: no se encontró ${methodName}Result en la respuesta de ${methodName}. Respuesta: ${text.slice(0, 500)}`);
  }
  return unescapeXmlEntities(match[1]);
}

/** Paso 1 obligatorio: autentica y devuelve el token a usar en el resto de las llamadas. */
async function authenticate() {
  const token = await callSoap("AuthenticateUser", "");
  if (!token || String(token).toLowerCase().includes("error")) {
    throw new Error(`No se pudo autenticar contra GBP. Respuesta: ${token}`);
  }
  return token;
}

/** El resultado de GBP viene como XML-dentro-de-XML (string) — se parsea una segunda vez acá. */
function parseTablaXml(rawXmlString) {
  if (!rawXmlString || typeof rawXmlString !== "string") return [];
  const inner = parser.parse(rawXmlString);
  const root = inner?.NewDataSet || inner?.root || inner;
  if (!root) return [];
  const rows = root.Table || root.Row || root.Item || [];
  return Array.isArray(rows) ? rows : [rows];
}

/** Ejecuta una Exportación Personalizada de GBP por su ID (ver Configuración > Exportación Personalizada). */
async function exportarDatosPorId(token, expgrId) {
  const raw = await callSoap("wsExportDataById", `<intExpgr_id>${expgrId}</intExpgr_id>`, token);
  return parseTablaXml(raw);
}

/**
 * Trae TODOS los clientes de GBP (Customers_funGetXMLData, Módulo 16) — paginado de a 500, sigue
 * pidiendo páginas hasta que una vuelve vacía. pbra_id=1 (Casa Central), pcust_id=-1 ("todos").
 */
async function listarTodosLosClientes(token) {
  const clientes = [];
  let pagina = 1;
  while (true) {
    const raw = await callSoap("Customers_funGetXMLData", `<pbra_id>1</pbra_id><pcust_id>-1</pcust_id><ppage_number>${pagina}</ppage_number>`, token);
    const tanda = parseTablaXml(raw);
    if (tanda.length === 0) break;
    clientes.push(...tanda);
    pagina += 1;
  }
  return clientes;
}

/** Trae UN cliente puntual de GBP por su cust_id — para probar/inspeccionar sin recorrer los 31.000+. */
async function obtenerCliente(token, custId) {
  const raw = await callSoap("Customers_funGetXMLData", `<pbra_id>1</pbra_id><pcust_id>${custId}</pcust_id><ppage_number>1</ppage_number>`, token);
  const filas = parseTablaXml(raw);
  return filas[0] || null;
}

/** Catálogo de artículos (Item_funGetXMLData, sin parámetros) — GBP ya filtra del lado suyo a solo
 * los habilitados (confirmado con datos reales: 0 con item_disabled=true en la respuesta). No hay
 * forma de pedirle a este método los inhabilitados también — para eso hace falta una Exportación
 * Personalizada (wsExportDataById), igual que se hizo para facturas. */
async function itemsActivos(token) {
  const raw = await callSoap("Item_funGetXMLData", "", token);
  return parseTablaXml(raw);
}

async function categorias(token) {
  const raw = await callSoap("Category_funGetXMLData", "", token);
  return parseTablaXml(raw);
}

async function subcategorias(token) {
  const raw = await callSoap("SubCategory_funGetXMLData", "<pCategory>-1</pCategory>", token);
  return parseTablaXml(raw);
}

async function marcas(token) {
  const raw = await callSoap("Brand_funGetXMLData", "", token);
  return parseTablaXml(raw);
}

/** Precio final (con IVA) de "Lista Contado" (prli_id=1) para todos los artículos — confirmado con
 * el dueño del negocio que esa es la lista que se usa para vender de verdad (ver
 * js/importar-globalbluepoint.js), no "Lista de Precios" (prli_id=5). */
async function preciosListaContado(token) {
  const raw = await callSoap("PriceListItems_funGetXMLData", `<pPriceList>1</pPriceList><pItem>-1</pItem>`, token);
  return parseTablaXml(raw);
}

/** Stock de "Depo Central" (stor_id=1) para todos los artículos — mismo criterio ya confirmado en la
 * importación original (Depo Central era, en los hechos, igual al stock total disponible). */
async function stockDepoCentral(token) {
  const raw = await callSoap("ItemStorage_funGetXMLData", `<intStor_id>1</intStor_id><intItem_id>-1</intItem_id>`, token);
  return parseTablaXml(raw);
}

module.exports = {
  GBP_SECRETS,
  authenticate,
  exportarDatosPorId,
  listarTodosLosClientes,
  obtenerCliente,
  itemsActivos,
  categorias,
  subcategorias,
  marcas,
  preciosListaContado,
  stockDepoCentral,
};
