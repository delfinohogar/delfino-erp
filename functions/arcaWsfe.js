// WSFEv1 — Facturación Electrónica de ARCA (ex AFIP): pide el CAE (Código de Autorización
// Electrónico) que autoriza fiscalmente una Factura A/B/C. Reutiliza obtenerTicketAcceso de
// arcaWsaa.js (mismo mecanismo de login que ya usa el padrón) con servicio:"wsfe".
//
// TODAVÍA NO PROBADO CONTRA ARCA — no hay certificado de homologación cargado en este proyecto
// (ver AFIP_CERT_HOMO/AFIP_KEY_HOMO en functions/index.js). El request/response está armado según
// la documentación oficial de ARCA (manual del desarrollador WSFEv1, consultado 02/09/2026) y
// fuentes públicas de referencia (ej. pyafipws, la implementación de referencia más usada en
// Argentina) — pendiente de confirmar campo por campo contra una respuesta real.
//
// Endpoints (namespace del servicio: http://ar.gov.afip.dif.FEV1/):
//   Homologación: https://wswhomo.afip.gov.ar/wsfev1/service.asmx
//   Producción:   https://servicios1.afip.gov.ar/wsfev1/service.asmx
const { XMLParser } = require("fast-xml-parser");
const { obtenerTicketAcceso } = require("./arcaWsaa");

const WSFE_URLS = {
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  testing: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
};
const NAMESPACE = "http://ar.gov.afip.dif.FEV1/";

// Códigos estables del catálogo de ARCA (sin cambios documentados en años — todas las librerías de
// referencia en Argentina usan estos mismos valores). ARCA expone además un método de consulta en
// vivo (FEParamGetTiposIva) para validarlos dinámicamente — no implementado acá por ahora: para el
// volumen y la etapa de prueba de Delfino alcanza con la tabla fija, documentada explícitamente.
const CBTE_TIPO = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
};

const DOC_TIPO = {
  CUIT: 80,
  DNI: 96,
  CONSUMIDOR_FINAL: 99, // "sin identificar" — solo válido para Factura B/C, nunca para Factura A
};

// Delfino vende productos físicos, nunca servicios — así que Concepto es siempre 1. Se deja el
// catálogo completo documentado por si algún día hace falta facturar un servicio (ej. flete
// facturado aparte), aunque hoy nada en el ERP genera ese caso.
const CONCEPTO = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 };

// Id de alícuota de IVA del catálogo de ARCA. Factura C NUNCA discrimina IVA (ver solicitarCae) —
// para las que sí discriminan, estos son los Id que importan a Delfino (0/5/10.5/21/27%, aunque
// Delfino hoy en la práctica solo usa 21% y 10.5% en sus productos — el resto queda preparado).
const ALICUOTA_IVA_ID = {
  0: 3,
  5: 8,
  10.5: 4,
  21: 5,
  27: 6,
};

function idAlicuotaIva(porcentaje) {
  const id = ALICUOTA_IVA_ID[porcentaje];
  if (!id) {
    throw new Error(
      `No se reconoce la alícuota de IVA ${porcentaje}% — ARCA solo admite 0%, 5%, 10.5%, 21% o 27%. Revisá el campo "IVA (%)" del producto.`
    );
  }
  return id;
}

function fechaArcaHoy() {
  // ARCA exige AAAAMMDD, sin separadores, en hora Argentina (GMT-3 fijo).
  const local = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10).replace(/-/g, "");
}

async function llamarWsfe({ metodo, cuerpoInterno, ambiente, cuit, token, sign }) {
  const url = WSFE_URLS[ambiente];
  if (!url) throw new Error(`Ambiente ARCA desconocido: "${ambiente}" (esperado "testing" o "produccion").`);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NAMESPACE}">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:${metodo}>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      ${cuerpoInterno}
    </ar:${metodo}>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${NAMESPACE}${metodo}` },
    body: soapBody,
  });
  const texto = await res.text();

  const fault = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`WSFEv1 (${metodo}) rechazó la solicitud: ${fault[1]}`);
  if (!res.ok) throw new Error(`WSFEv1 (${metodo}) respondió ${res.status}: ${texto.slice(0, 500)}`);

  // parseTagValue:false a propósito — el parser por defecto convierte cualquier contenido con
  // pinta de número a JS Number, y eso incluye el CAE (14 dígitos): un código no es una cantidad,
  // no tiene que pasar por conversión numérica (riesgo real de perder ceros a la izquierda o
  // truncar precisión si ARCA algún día usa un formato distinto). Los pocos campos que sí son
  // numéricos de verdad (CbteNro, etc.) se convierten a mano con Number() donde hace falta.
  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false });
  const parsed = parser.parse(texto);
  const resultado = parsed?.Envelope?.Body?.[`${metodo}Response`]?.[`${metodo}Result`];
  if (!resultado) throw new Error(`Respuesta de WSFEv1 (${metodo}) inesperada: ${texto.slice(0, 500)}`);
  return resultado;
}

// Normaliza Errors/Events/Observaciones de ARCA (siempre vienen como objeto {Err:[...]} con UN
// elemento, o {Err:{...}} con varios, o ausentes) a un array plano — nunca inventa un array vacío
// como si "no hubiera pasado nada" cuando en realidad el campo no vino.
function comoArray(valor, clave) {
  if (!valor) return [];
  const contenido = valor[clave];
  if (!contenido) return [];
  return Array.isArray(contenido) ? contenido : [contenido];
}

// Devuelve el último número de comprobante AUTORIZADO por ARCA para este punto de venta + tipo —
// la única fuente de verdad válida para el próximo número (nunca el contador interno de Delfino,
// ver contadorId en js/facturacion.js, que es un contador DISTINTO para los comprobantes internos).
async function obtenerUltimoAutorizado({ ptoVta, cbteTipo, cuit, cert, key, ambiente }) {
  const { token, sign } = await obtenerTicketAcceso("wsfe", cert, key, ambiente);
  const resultado = await llamarWsfe({
    metodo: "FECompUltimoAutorizado",
    cuerpoInterno: `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
    ambiente,
    cuit,
    token,
    sign,
  });
  const errores = comoArray(resultado.Errors, "Err");
  if (errores.length > 0) {
    throw new Error("ARCA rechazó la consulta de FECompUltimoAutorizado: " + errores.map((e) => `[${e.Code}] ${e.Msg}`).join("; "));
  }
  return Number(resultado.CbteNro || 0);
}

// items: [{ alicuotaIva, baseImponible, importeIva }] — YA agrupados por alícuota (ver
// functions/arcaFacturacion.js, que arma esto a partir de los productos de la venta). Para
// Factura C el array de IVA se omite del todo — ARCA no permite discriminar IVA en Factura C
// (el emisor es monotributista/exento, no es responsable inscripto).
function armarBloqueIva(ivaPorAlicuota, esFacturaC) {
  if (esFacturaC || ivaPorAlicuota.length === 0) return "";
  const lineas = ivaPorAlicuota
    .map(
      (l) => `
      <ar:AlicIva>
        <ar:Id>${idAlicuotaIva(l.alicuotaIva)}</ar:Id>
        <ar:BaseImp>${l.baseImponible.toFixed(2)}</ar:BaseImp>
        <ar:Importe>${l.importeIva.toFixed(2)}</ar:Importe>
      </ar:AlicIva>`
    )
    .join("");
  return `<ar:Iva>${lineas}</ar:Iva>`;
}

// Pide el CAE de UN comprobante (CantReg siempre 1 — Delfino autoriza de a uno, nunca en lote; no
// hay ningún flujo hoy que junte varias facturas en una sola solicitud).
// datos: { ptoVta, cbteTipo, docTipo, docNro, cbteNro (el "último + 1" ya calculado), importeTotal,
//          importeNeto, importeIva, ivaPorAlicuota, esFacturaC, cuit, cert, key, ambiente }
async function solicitarCae(datos) {
  const { token, sign } = await obtenerTicketAcceso("wsfe", datos.cert, datos.key, datos.ambiente);

  const detalle = `
      <ar:FECAEDetRequest>
        <ar:Concepto>${CONCEPTO.PRODUCTOS}</ar:Concepto>
        <ar:DocTipo>${datos.docTipo}</ar:DocTipo>
        <ar:DocNro>${datos.docNro}</ar:DocNro>
        <ar:CbteDesde>${datos.cbteNro}</ar:CbteDesde>
        <ar:CbteHasta>${datos.cbteNro}</ar:CbteHasta>
        <ar:CbteFch>${fechaArcaHoy()}</ar:CbteFch>
        <ar:ImpTotal>${datos.importeTotal.toFixed(2)}</ar:ImpTotal>
        <ar:ImpTotConc>0.00</ar:ImpTotConc>
        <ar:ImpNeto>${datos.importeNeto.toFixed(2)}</ar:ImpNeto>
        <ar:ImpOpEx>0.00</ar:ImpOpEx>
        <ar:ImpTrib>0.00</ar:ImpTrib>
        <ar:ImpIVA>${datos.esFacturaC ? "0.00" : datos.importeIva.toFixed(2)}</ar:ImpIVA>
        <ar:MonId>PES</ar:MonId>
        <ar:MonCotiz>1</ar:MonCotiz>
        ${armarBloqueIva(datos.ivaPorAlicuota, datos.esFacturaC)}
      </ar:FECAEDetRequest>`;

  const cuerpoInterno = `
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${datos.ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${datos.cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>${detalle}</ar:FeDetReq>
      </ar:FeCAEReq>`;

  const resultado = await llamarWsfe({
    metodo: "FECAESolicitar",
    cuerpoInterno,
    ambiente: datos.ambiente,
    cuit: datos.cuit,
    token,
    sign,
  });

  const erroresGenerales = comoArray(resultado.Errors, "Err");
  const cabecera = resultado.FeCabResp || {};
  const detalleResp = resultado.FeDetResp?.FECAEDetResponse || {};

  const observaciones = comoArray(detalleResp.Observaciones, "Obs").map((o) => ({ codigo: o.Code, mensaje: o.Msg }));

  return {
    resultadoCabecera: cabecera.Resultado || null, // "A" aprobado | "R" rechazado (a nivel lote)
    resultadoDetalle: detalleResp.Resultado || null, // "A" | "R" (a nivel de ESTE comprobante puntual)
    cae: detalleResp.CAE || null,
    caeFchVto: detalleResp.CAEFchVto || null, // formato AAAAMMDD
    observaciones,
    erroresGenerales: erroresGenerales.map((e) => ({ codigo: e.Code, mensaje: e.Msg })),
    cbteDesde: detalleResp.CbteDesde || null,
    cbteHasta: detalleResp.CbteHasta || null,
  };
}

module.exports = {
  obtenerUltimoAutorizado,
  solicitarCae,
  CBTE_TIPO,
  DOC_TIPO,
  CONCEPTO,
  idAlicuotaIva,
  // Solo para tests de lógica pura, sin red (ver informe final) — no forman parte de la superficie
  // pública de la integración.
  __testing: { armarBloqueIva, comoArray },
};
