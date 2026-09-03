// Vincular clientes de GBP con Delfino — siempre previsualiza antes de aplicar (mismo patrón que la
// reconciliación de catálogo de Tiendanube, ver tiendanubeCatalogo.js): gbpPreviewVincularClientes
// es de solo lectura y trae la lista completa; gbpAplicarVincularClientes recién ahí escribe, con lo
// que el admin ya vio y confirmó (no recalcula nada — usa tal cual lo que le llega del cliente).
//
// Dos cosas relacionadas en la misma consulta (las dos necesitan la lista completa de clientes de
// GBP, que es pesada de traer — 31.000+ filas paginadas de a 500):
//
// 1. Clientes que YA existen en Delfino, cruzados con su cliente correspondiente en GBP por
//    CUIT/DNI (identificadorExterno, mismo patrón que ya usan los productos). El ID propio de
//    Delfino nunca se toca, solo se agrega la referencia.
//
// 2. Para el resto — clientes de GBP que aparecen en facturas ya sincronizadas pero que NO son
//    clientes reales de Delfino — una ficha liviana en `clientesGbp` (solo nombre/CUIT/domicilio,
//    no un cliente operativo: no aparece en el buscador de Nueva Venta ni en Cuenta Corriente).
//    Solo se crea ficha para quien ya tiene una compra sincronizada, nunca los 31.000 de GBP de una.
//
// El cruce por CUIT tolera que un lado tenga el CUIT completo (11 dígitos) y el otro el DNI puro
// (7-8 dígitos) de la misma persona — es habitual que GBP tenga cargado el DNI sin el prefijo/dígito
// verificador para consumidor final. Misma idea que cuitsPosiblesDesdeDni (js/cuit.js).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const gbp = require("./gbp");
const { keywordsDeTextos } = require("./texto");

// Mismas claves que COLUMNAS en js/gbp-clientes-excel.js — a propósito duplicado (ese archivo corre
// con el SDK cliente, éste con el admin): son las que exportarTodosLosClientesGbp() usa allá para
// armar el .xlsx con exportarExcel(), sin que el usuario tenga que tocar ni una columna.
const COLUMNAS_EXPORT_CLIENTES = [
  { clave: "identificadorExterno" },
  { clave: "razonSocial" },
  { clave: "cuit" },
  { clave: "condicionIva" },
  { clave: "domicilioEntrega" },
  { clave: "codigoPostalEntrega" },
  { clave: "localidadEntrega" },
  { clave: "provinciaEntrega" },
  { clave: "paisEntrega" },
  { clave: "whatsapp" },
  { clave: "email" },
];

function soloDigitos(valor) {
  return (valor || "").toString().replace(/\D/g, "");
}

// Mismo criterio que capitalizarDireccion en js/texto.js — duplicado a propósito (ese archivo corre
// con el SDK cliente, éste con el admin): GBP guarda domicilio/localidad en mayúsculas.
const PALABRAS_MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "en", "al"]);
function capitalizarDireccion(texto) {
  if (!texto) return texto;
  return texto
    .toLowerCase()
    .split(" ")
    .map((palabra, i) => {
      if (!palabra) return palabra;
      if (i > 0 && PALABRAS_MINUSCULAS.has(palabra)) return palabra;
      return palabra.charAt(0).toUpperCase() + palabra.slice(1);
    })
    .join(" ");
}

// Mismo criterio que normalizarTelefono (js/cuit.js): últimos 10 dígitos, para poder buscar el
// teléfono sin importar cómo se haya cargado (con o sin código de país, con o sin el 9 de celular).
function normalizarTelefono(valor) {
  const d = soloDigitos(valor);
  if (d.length < 8) return null;
  return d.slice(-10);
}

// Mismo criterio que formatearCuit (js/cuit.js): hasta 8 dígitos puede ser un DNI (sin guiones), a
// partir de ahí ya solo puede ser un CUIT en camino a 11.
function formatearCuit(valor) {
  const d = soloDigitos(valor).slice(0, 11);
  if (d.length <= 8) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

// Mismo criterio que dniDesdeCuit (js/cuit.js) — duplicado a propósito (ver capitalizarDireccion más
// arriba): el DNI embebido dentro de un CUIL completo, para poder buscar clientes por DNI sin
// importar si terminaron con el CUIL completo (los que ya se resolvieron por ARCA) o con el DNI
// suelto (todos los que todavía no).
const PREFIJOS_PERSONA_FISICA = ["20", "23", "24", "27"];
function dniDesdeCuit(cuit) {
  const d = soloDigitos(cuit);
  if (d.length === 11 && PREFIJOS_PERSONA_FISICA.includes(d.slice(0, 2))) return d.slice(2, 10);
  if (d.length === 7 || d.length === 8) return d.padStart(8, "0");
  return null;
}

// Mapeo GBP -> esquema de clientes de Delfino (ver js/clientes.js:crearCliente para el esquema
// real). condicionIva/situacionTributaria/actividades quedan vacíos — Customers_funGetXMLData no
// los da; quedan disponibles para completar con una consulta a ARCA después, como cualquier cliente
// cargado a mano — salvo condicionIva: si el documento es un DNI puro (sin CUIT), ya se sabe que es
// Consumidor Final (no hace falta ARCA para eso, es así por definición fiscal).
//
// El domicilio de GBP es de ENTREGA, no fiscal — GBP no distingue las dos cosas como ARCA, y lo que
// tiene cargado es la dirección real del cliente para venderle/entregarle, no un domicilio impositivo.
// domicilioFiscal/provincia (fiscal) quedan vacíos hasta una consulta real a ARCA.
//
// cust_city es la localidad (confirmado contra la ficha real de GBP, no la provincia — esa la
// resuelve GBP con un state_id que el webservice no expone como texto). provinciaEntrega/paisEntrega
// quedan fijos en Buenos Aires/Argentina — confirmado con el dueño del negocio que es así para la
// gran mayoría (zona sur del Gran Buenos Aires); se corrige a mano si alguna vez no es el caso.
function mapearClienteGbp(g) {
  const nombre = g.cust_name || `Cliente GBP #${g.cust_id}`;
  const digitos = soloDigitos(g.cust_taxNumber);
  return {
    razonSocial: nombre,
    razonSocialLower: nombre.toLowerCase(),
    searchKeywords: keywordsDeTextos(nombre),
    cuit: formatearCuit(g.cust_taxNumber),
    dni: dniDesdeCuit(g.cust_taxNumber),
    condicionIva: digitos && digitos.length <= 8 ? "Consumidor Final" : null,
    domicilioFiscal: null,
    provincia: null,
    codigoPostal: null,
    domicilioEntrega: g.cust_address ? capitalizarDireccion(String(g.cust_address)) : null,
    localidadEntrega: g.cust_city ? capitalizarDireccion(String(g.cust_city)) : null,
    codigoPostalEntrega: g.cust_zip != null ? String(g.cust_zip) : null,
    provinciaEntrega: "Buenos Aires",
    paisEntrega: "Argentina",
    situacionTributaria: null,
    actividades: [],
    fuenteDatos: "gbp",
    fechaConsultaArca: null,
    whatsapp: g.cust_phone1 ? String(g.cust_phone1) : null,
    searchPhone: normalizarTelefono(g.cust_phone1),
    email: g.cust_email ? String(g.cust_email).trim().toLowerCase() : null,
    domicilioEntregaNormalizado: null,
    domicilioEntregaLat: null,
    domicilioEntregaLon: null,
    activo: true,
    identificadorExterno: String(g.cust_id),
  };
}

function requiereAdmin(db, request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  return db
    .collection("usuarios")
    .doc(request.auth.uid)
    .get()
    .then((perfil) => {
      if (perfil.data()?.rol !== "administrador") {
        throw new HttpsError("permission-denied", "Solo un administrador puede vincular clientes de GBP.");
      }
    });
}

async function calcularVinculacion(db) {
  const token = await gbp.authenticate();
  const todosLosClientesGbp = await gbp.listarTodosLosClientes(token);
  const clientesGbpPorId = new Map(todosLosClientesGbp.map((c) => [String(c.cust_id), c]));

  // Dos índices sobre los clientes de GBP: por dígitos tal cual, y por el "DNI de 8" que se puede
  // extraer tanto de un DNI puro como del medio de un CUIT completo — así el cruce funciona sin
  // importar en qué formato haya quedado cargado cada lado. Guardan un ARRAY de cust_id, no uno
  // solo — en una base de 31.000 clientes cargada en años es real que dos personas distintas hayan
  // quedado con el mismo DNI cargado por error. Si un documento resulta ambiguo (matchea más de un
  // cliente de GBP), no se adivina cuál es: se deja afuera de "vinculaciones" y se informa aparte,
  // para que lo resuelva un humano en vez de arriesgarse a pisar el cliente equivocado.
  const gbpPorDigitos = new Map();
  const gbpPorDni8 = new Map();
  const agregarAIndice = (indice, key, custId) => {
    if (!indice.has(key)) indice.set(key, new Set());
    indice.get(key).add(custId);
  };
  for (const g of todosLosClientesGbp) {
    const d = soloDigitos(g.cust_taxNumber);
    if (!d) continue;
    agregarAIndice(gbpPorDigitos, d, g.cust_id);
    if (d.length === 11) agregarAIndice(gbpPorDni8, d.slice(2, 10), g.cust_id);
    else if (d.length <= 8) agregarAIndice(gbpPorDni8, d.padStart(8, "0"), g.cust_id);
  }
  // custId único si el Set tiene 1 solo elemento; null si no matcheó nada; "AMBIGUO" (Set con 2+) si
  // el documento aparece en más de un cliente de GBP.
  function resolverCustIdUnico(d) {
    let candidatos = gbpPorDigitos.get(d);
    if (!candidatos) {
      const dni8 = d.length === 11 ? d.slice(2, 10) : d.length <= 8 ? d.padStart(8, "0") : null;
      if (dni8) candidatos = gbpPorDni8.get(dni8);
    }
    if (!candidatos || candidatos.size === 0) return { custId: null, ambiguo: false };
    if (candidatos.size > 1) return { custId: null, ambiguo: true, candidatos: Array.from(candidatos) };
    return { custId: Array.from(candidatos)[0], ambiguo: false };
  }

  const clientesSnap = await db.collection("clientes").get();
  const vinculaciones = [];
  const ambiguos = [];
  const custIdsVinculados = new Set(); // ya son cliente real de Delfino — no necesitan ficha liviana
  clientesSnap.forEach((doc) => {
    const c = doc.data();
    const d = soloDigitos(c.cuit);
    if (!d) return;
    const { custId, ambiguo, candidatos } = resolverCustIdUnico(d);
    if (ambiguo) {
      ambiguos.push({
        clienteId: doc.id,
        clienteNombre: c.razonSocial,
        clienteCuit: c.cuit,
        candidatos: candidatos.map((cid) => {
          const g = clientesGbpPorId.get(String(cid));
          return { custId: String(cid), custNombre: g?.cust_name || null };
        }),
      });
      return;
    }
    if (!custId) return;
    // Ya estaba vinculado a este mismo cliente de GBP — no hace falta re-mostrarlo en el preview.
    if (String(c.identificadorExterno) === String(custId)) {
      custIdsVinculados.add(String(custId));
      return;
    }
    const g = clientesGbpPorId.get(String(custId));
    vinculaciones.push({
      clienteId: doc.id,
      clienteNombre: c.razonSocial,
      clienteCuit: c.cuit,
      custId: String(custId),
      custNombre: g?.cust_name || null,
      custCuit: g?.cust_taxNumber ? String(g.cust_taxNumber) : null,
    });
    custIdsVinculados.add(String(custId));
  });

  // Fichas livianas: clientes de GBP que aparecen en facturas ya sincronizadas y no son cliente real.
  const facturasSnap = await db.collection("facturasGbp").select("clienteIdExterno").get();
  const custIdsConCompra = new Set();
  facturasSnap.forEach((doc) => {
    const id = doc.data().clienteIdExterno;
    if (id) custIdsConCompra.add(String(id));
  });

  const clientesGbpExistentesSnap = await db.collection("clientesGbp").select().get();
  const yaTienenFicha = new Set(clientesGbpExistentesSnap.docs.map((d) => d.id));

  const fichasNuevas = [];
  for (const custId of custIdsConCompra) {
    if (custIdsVinculados.has(custId) || yaTienenFicha.has(custId)) continue;
    const g = clientesGbpPorId.get(custId);
    if (!g) continue; // referenciado en una factura pero ya no existe como cliente en GBP
    fichasNuevas.push({
      custId,
      nombre: g.cust_name || null,
      cuit: g.cust_taxNumber ? String(g.cust_taxNumber) : null,
      domicilio: g.cust_address ? String(g.cust_address) : null,
      ciudad: g.cust_city || null,
      codigoPostal: g.cust_zip || null,
      telefono: g.cust_phone1 ? String(g.cust_phone1) : null,
      email: g.cust_email || null,
    });
  }

  return {
    totalClientesGbp: todosLosClientesGbp.length,
    totalClientesDelfino: clientesSnap.size,
    vinculaciones,
    fichasNuevas,
    ambiguos,
  };
}

// Prueba puntual: trae UN cliente de GBP (rápido, sin recorrer los 31.000+) y lo crea como cliente
// REAL de Delfino con el mapeo de arriba — para poder revisar cómo queda antes de aplicarlo a todos
// los que ya tienen ficha liviana. Si ya existe un cliente vinculado a este mismo custId (de una
// prueba anterior), lo actualiza en vez de duplicarlo — mismo criterio de "no pisarse" que el resto.
exports.gbpImportarClientePrueba = onCall({ region: "southamerica-east1", secrets: gbp.GBP_SECRETS, timeoutSeconds: 60 }, async (request) => {
  const db = admin.firestore();
  await requiereAdmin(db, request);

  const custId = String(request.data?.custId || "").trim();
  if (!custId) throw new HttpsError("invalid-argument", "Falta custId.");

  const token = await gbp.authenticate();
  const g = await gbp.obtenerCliente(token, custId);
  if (!g) throw new HttpsError("not-found", `No se encontró el cliente #${custId} en GBP.`);

  const datos = mapearClienteGbp(g);
  const existenteSnap = await db.collection("clientes").where("identificadorExterno", "==", custId).limit(1).get();
  let id;
  if (!existenteSnap.empty) {
    id = existenteSnap.docs[0].id;
    await db.collection("clientes").doc(id).set(datos, { merge: true });
  } else {
    id = (await db.collection("clientes").add(datos)).id;
  }
  return { id, cliente: datos, datosOriginalesGbp: g };
});

exports.gbpPreviewVincularClientes = onCall({ region: "southamerica-east1", secrets: gbp.GBP_SECRETS, timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
  const db = admin.firestore();
  await requiereAdmin(db, request);
  return calcularVinculacion(db);
});

exports.gbpAplicarVincularClientes = onCall({ region: "southamerica-east1", timeoutSeconds: 180, memory: "512MiB" }, async (request) => {
  const db = admin.firestore();
  await requiereAdmin(db, request);

  const vinculaciones = Array.isArray(request.data?.vinculaciones) ? request.data.vinculaciones : [];
  const fichasNuevas = Array.isArray(request.data?.fichasNuevas) ? request.data.fichasNuevas : [];

  const TAMANO_TANDA = 400;
  for (let i = 0; i < vinculaciones.length; i += TAMANO_TANDA) {
    const batch = db.batch();
    for (const v of vinculaciones.slice(i, i + TAMANO_TANDA)) {
      if (!v?.clienteId || !v?.custId) continue;
      batch.update(db.collection("clientes").doc(String(v.clienteId)), { identificadorExterno: String(v.custId) });
    }
    await batch.commit();
  }

  for (let i = 0; i < fichasNuevas.length; i += TAMANO_TANDA) {
    const batch = db.batch();
    for (const f of fichasNuevas.slice(i, i + TAMANO_TANDA)) {
      if (!f?.custId) continue;
      const { custId, ...datos } = f;
      batch.set(db.collection("clientesGbp").doc(String(custId)), datos, { merge: true });
    }
    await batch.commit();
  }

  // Backfill: facturas de estos mismos clientes de GBP que ya estaban sincronizadas ANTES de este
  // vínculo se quedan con clienteId null para siempre si nadie las toca — gbpSincronizarFacturas solo
  // calcula clienteId en el momento del sync (ver gbpFacturas.js), y antes de este vínculo no había
  // con qué cliente de Delfino cruzarlas. Sin este backfill, un cliente recién vinculado no ve sus
  // compras ya sincronizadas en Cuenta Corriente hasta que alguien vuelva a apretar "Sincronizar
  // ahora" a mano (fácil de no saber que hace falta).
  const custIdAClienteId = new Map(vinculaciones.filter((v) => v?.clienteId && v?.custId).map((v) => [String(v.custId), String(v.clienteId)]));
  let facturasVinculadas = 0;
  if (custIdAClienteId.size > 0) {
    const facturasSnap = await db.collection("facturasGbp").select("clienteIdExterno", "clienteId").get();
    const aActualizar = facturasSnap.docs.filter((doc) => {
      const idExt = doc.data().clienteIdExterno;
      const clienteIdNuevo = idExt ? custIdAClienteId.get(String(idExt)) : null;
      return clienteIdNuevo && doc.data().clienteId !== clienteIdNuevo;
    });
    for (let i = 0; i < aActualizar.length; i += TAMANO_TANDA) {
      const batch = db.batch();
      for (const doc of aActualizar.slice(i, i + TAMANO_TANDA)) {
        batch.update(doc.ref, { clienteId: custIdAClienteId.get(String(doc.data().clienteIdExterno)) });
      }
      await batch.commit();
    }
    facturasVinculadas = aActualizar.length;
  }

  return { vinculados: vinculaciones.length, fichasCreadas: fichasNuevas.length, facturasVinculadas };
});

// Exporta el universo COMPLETO de clientes de GBP (~31.000, no solo los que ya tienen ficha liviana
// por haber comprado en los últimos 90 días — ver gbpFacturas.js), con la misma forma de fila que ya
// usa la plantilla de productos/gbp-clientes-importar.html, para revisar/corregir/filtrar a mano
// antes de subirlo. Devuelve las filas ya armadas (no el objeto crudo de GBP) — el .xlsx en sí lo
// arma el navegador con el mismo motor que ya usa el botón "para revisar" (exportarExcel), no hace
// falta Storage ni URLs firmadas: 31.000 filas de texto corto entran sobradas en una respuesta.
exports.gbpExportarTodosLosClientes = onCall(
  { region: "southamerica-east1", secrets: gbp.GBP_SECRETS, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    const db = admin.firestore();
    await requiereAdmin(db, request);

    const token = await gbp.authenticate();
    const todosLosClientesGbp = await gbp.listarTodosLosClientes(token);

    const filas = todosLosClientesGbp.map((g) => {
      const datos = mapearClienteGbp(g);
      const fila = {};
      for (const col of COLUMNAS_EXPORT_CLIENTES) fila[col.clave] = datos[col.clave] ?? "";
      return fila;
    });

    return { filas, total: filas.length };
  }
);
