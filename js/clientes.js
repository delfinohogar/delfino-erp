// Clientes: mismo modelo que proveedores (razón social/CUIT + datos de ARCA), del otro lado
// de la operación. Cuenta corriente de clientes queda lista para cuando exista el módulo de Ventas.
// domicilioEntrega/whatsapp/email son datos de contacto propios (no vienen de ARCA) — quedan
// cargados a mano, como base para integraciones futuras (normalización de mapas, WhatsApp/Meta, mail).
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit } from "./firebase.js";
import { capitalizarDireccion, keywordsDeTextos, tokenizar, normalizarTexto } from "./texto.js";
import { dniDesdeCuit, normalizarTelefono, soloDigitos } from "./cuit.js";

// Truco estándar de Firestore para range query "empieza con": el límite superior tiene que ser el
// prefijo más un carácter que ordene después de cualquier texto normal (U+F8FF, área de uso
// privado de Unicode) — un string vacío acá deja el rango en field <= prefijo, o sea una
// búsqueda EXACTA, no por prefijo (buscarClientes("aguero") no encontraba "Aguero Martin Gabriel").
const COTA_SUPERIOR_UNICODE = "";

const LIMITE_CANDIDATOS_NOMBRE = 100;

// Por palabra suelta, en cualquier orden — "barbara saravia" y "saravia barbara" encuentran el mismo
// cliente, y agregar una palabra más sigue filtrando (no hace falta que sea el principio del nombre
// completo). Mismo patrón que buscarProductos (js/productos.js): UNA palabra filtra en Firestore
// contra el índice de prefijos (searchKeywords, ver keywordsDeTextos en js/texto.js) y, si hay más,
// se exige que el cliente matchee todas — ya en memoria, sobre el resultado acotado que devolvió
// Firestore, no sobre la colección entera. Devuelve el candidato SIN recortar a 8 ni ordenar por
// relevancia — eso lo hace buscarClientesTexto, el único punto de salida real.
//
// Se usa la palabra MÁS LARGA tipeada para esa consulta, no la primera que se haya escrito: con
// 31.000 clientes reales, una palabra corta como "sara" ya matchea a más de 90 personas — si la
// consulta solo trajera esas primeras N (sin orden particular de Firestore) un cliente real que sí
// cumple con TODO lo tipeado podría quedar afuera. La palabra más larga suele ser más selectiva.
//
// Red de seguridad: si aun así el resultado viene MUY cerca del límite (90+ de 100), es señal de que
// probablemente se cortaron candidatos reales — se refuerza con la segunda palabra más larga (si hay
// otra) antes de aplicar el filtro final, en vez de resignarse a esa pérdida. No es una garantía
// absoluta a cualquier escala (dos palabras extremadamente comunes juntas siguen pudiendo perder un
// caso), pero reduce mucho el riesgo sin construir un índice de frecuencia aparte.
// truncado: true si la consulta principal (o la de respaldo) llegó al tope — o sea, podría haber más
// candidatos en Firestore que no se trajeron. Sirve para que quien cachee este resultado (ver
// js/cliente-picker.js) sepa si es seguro reusarlo para filtrar en memoria una búsqueda más
// específica, o si hace falta volver a consultar Firestore (ver nota de cache más abajo).
async function buscarClientesCandidatosPorNombre(texto) {
  const palabras = tokenizar(texto);
  if (palabras.length === 0) return { candidatos: [], truncado: false };

  const ordenadas = [...palabras].sort((a, b) => b.length - a.length);
  const palabraPrincipal = ordenadas[0];
  const restoPalabras = palabras.filter((p) => p !== palabraPrincipal);

  const snap = await getDocs(
    query(collection(db, "clientes"), where("searchKeywords", "array-contains", palabraPrincipal), limit(LIMITE_CANDIDATOS_NOMBRE))
  );
  let resultados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let truncado = resultados.length >= LIMITE_CANDIDATOS_NOMBRE;

  if (resultados.length >= LIMITE_CANDIDATOS_NOMBRE - 10 && ordenadas.length > 1) {
    const snap2 = await getDocs(
      query(collection(db, "clientes"), where("searchKeywords", "array-contains", ordenadas[1]), limit(LIMITE_CANDIDATOS_NOMBRE))
    );
    if (snap2.docs.length >= LIMITE_CANDIDATOS_NOMBRE) truncado = true;
    const combinados = new Map(resultados.map((c) => [c.id, c]));
    snap2.docs.forEach((d) => combinados.set(d.id, { id: d.id, ...d.data() }));
    resultados = Array.from(combinados.values());
  }

  if (restoPalabras.length > 0) {
    resultados = resultados.filter((c) => restoPalabras.every((palabra) => (c.searchKeywords || []).includes(palabra)));
  }

  return { candidatos: resultados, truncado };
}

// Igual que antes, pero como función pública de un solo uso (compatibilidad — el único punto de
// entrada real para las pantallas es buscarClientesTexto, más abajo).
export async function buscarClientes(texto) {
  const { candidatos } = await buscarClientesCandidatosPorNombre(texto);
  return candidatos.slice(0, 8);
}

// Variante para cache local del lado de la pantalla (ver js/cliente-picker.js y
// configuracion/clientes.js): devuelve TODOS los candidatos sin ordenar ni recortar a 8, más
// truncado, para que quien la llama pueda guardar el conjunto y, mientras el usuario siga agregando
// letras a la MISMA búsqueda por nombre, filtrarlo de nuevo en memoria en vez de volver a golpear
// Firestore — nunca al revés: si truncado es true, cachear igual sería arriesgar falsos negativos
// (un cliente que exista en Firestore pero haya quedado afuera del recorte), así que quien cachea
// tiene que revisar ese flag antes de reusar el resultado.
export async function buscarCandidatosClientesPorNombre(texto) {
  return buscarClientesCandidatosPorNombre(texto);
}

// Aplica el mismo filtro multi-palabra que buscarClientesCandidatosPorNombre, pero sobre un array ya
// en memoria (el cache de buscarCandidatosClientesPorNombre) en vez de volver a consultar Firestore,
// y después ordena por relevancia y recorta a 8 — mismo criterio final que buscarClientesTexto.
export function filtrarYOrdenarCandidatosPorNombre(candidatos, texto) {
  const palabras = tokenizar(texto);
  const filtrados =
    palabras.length > 0 ? candidatos.filter((c) => palabras.every((palabra) => (c.searchKeywords || []).includes(palabra))) : candidatos;
  return filtrados.sort((a, b) => calcularRelevanciaCliente(b, texto) - calcularRelevanciaCliente(a, texto)).slice(0, 8);
}

// Mismo criterio que buscarClientes pero por prefijo de CUIT/DNI en vez de nombre — ver
// buscarClientesTexto, que decide cuál de las dos usar según lo que se haya tipeado.
export async function buscarClientesPorCuit(texto) {
  if (!texto) return [];
  const t = texto.trim();
  const snap = await getDocs(
    query(collection(db, "clientes"), where("cuit", ">=", t), where("cuit", "<=", t + COTA_SUPERIOR_UNICODE), orderBy("cuit"), limit(8))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Mismo criterio, pero contra el DNI embebido (ver dni en crearCliente/actualizarCliente y
// dniDesdeCuit en js/cuit.js) — así "36727434" encuentra un cliente aunque su cuit haya quedado
// como el CUIL completo "20-36727434-5" (lo que pasa apenas se resuelve por ARCA), no solo a los
// que se quedaron con el DNI suelto.
export async function buscarClientesPorDni(texto) {
  if (!texto) return [];
  const t = texto.trim();
  const snap = await getDocs(
    query(collection(db, "clientes"), where("dni", ">=", t), where("dni", "<=", t + COTA_SUPERIOR_UNICODE), orderBy("dni"), limit(8))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Por prefijo de searchPhone (ver normalizarTelefono en js/cuit.js y el campo en crearCliente más
// abajo) — encuentra al cliente aunque el teléfono se haya tipeado con espacios, guiones, código de
// país o el 9 de celular; el whatsapp que se muestra en la ficha nunca se toca, esto es solo para
// buscar. null (texto muy corto para ser un teléfono real) devuelve vacío sin consultar nada.
export async function buscarClientesPorTelefono(texto) {
  const t = normalizarTelefono(texto);
  if (!t) return [];
  const snap = await getDocs(
    query(collection(db, "clientes"), where("searchPhone", ">=", t), where("searchPhone", "<=", t + COTA_SUPERIOR_UNICODE), orderBy("searchPhone"), limit(8))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Por prefijo de email — se guarda ya en minúsculas/recortado (ver crearCliente/actualizarCliente),
// así que alcanza con normalizar el mismo criterio acá para que la comparación de rango funcione.
export async function buscarClientesPorEmail(texto) {
  const t = texto.trim().toLowerCase();
  if (!t) return [];
  const snap = await getDocs(
    query(collection(db, "clientes"), where("email", ">=", t), where("email", "<=", t + COTA_SUPERIOR_UNICODE), orderBy("email"), limit(8))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Puntaje determinístico para ordenar un conjunto YA ACOTADO de candidatos (nunca corre sobre la
// colección completa) — coincidencia exacta de documento/teléfono/email primero, después nombre
// exacto, después "tiene todas las palabras tipeadas", después "empieza con lo tipeado", por último
// cualquier coincidencia parcial por prefijo. Los puntajes son arbitrarios en su valor absoluto, lo
// único que importa es el orden relativo entre ellos.
export function calcularRelevanciaCliente(cliente, texto) {
  const textoNorm = normalizarTexto(texto);
  const digitos = soloDigitos(texto);
  const nombreNorm = normalizarTexto(cliente.razonSocial || "");
  const palabrasNombre = nombreNorm.split(" ").filter(Boolean);
  const palabrasBuscadas = tokenizar(texto);
  let score = 0;

  if (digitos && (cliente.dni === digitos || soloDigitos(cliente.cuit) === digitos)) score += 100;
  const telNorm = normalizarTelefono(texto);
  if (telNorm && cliente.searchPhone === telNorm) score += 100;
  if (cliente.email && textoNorm && cliente.email === textoNorm) score += 100;
  if (nombreNorm && nombreNorm === textoNorm) score += 90;
  if (palabrasBuscadas.length > 0 && palabrasBuscadas.every((p) => palabrasNombre.includes(p))) score += 50;
  if (textoNorm && nombreNorm.startsWith(textoNorm)) score += 30;
  if (palabrasBuscadas.length > 0 && palabrasBuscadas.every((p) => palabrasNombre.some((n) => n.startsWith(p)))) score += 10;

  return score;
}

// Punto único de búsqueda "como se escriba" para los buscadores de cliente (picker de Nueva Venta,
// Facturación, Cuenta Corriente y Cobros; listado de Configuración → Clientes; buscador global) — un
// solo lugar decide qué campo(s) consultar según lo que se haya tipeado, y ordena por relevancia
// antes de devolver. Sin esto, cada pantalla traía la colección ENTERA de clientes para filtrar en
// memoria — funcionaba con los clientes de prueba, pero se vuelve pesado/lento en serio con miles de
// clientes reales (ver migración de GBP). Ninguna búsqueda final trae más de 8 resultados.
export async function buscarClientesTexto(texto) {
  const t = (texto || "").trim();
  if (!t) return [];

  let candidatos;
  if (t.includes("@")) {
    candidatos = await buscarClientesPorEmail(t);
  } else if (/^[\d+]/.test(t)) {
    // Documento (CUIT/DNI) y teléfono se prueban siempre juntos: un mismo texto numérico puede ser
    // cualquiera de los dos, y las tres consultas son baratas (limit 8 cada una) corriendo en
    // paralelo — más simple y más robusto que tratar de adivinar cuál es por el largo del número.
    const soloDigitosTexto = t.replace(/\D/g, "");
    const [porCuit, porDni, porTelefono] = await Promise.all([
      buscarClientesPorCuit(t),
      buscarClientesPorDni(soloDigitosTexto),
      buscarClientesPorTelefono(t),
    ]);
    const combinados = new Map();
    for (const c of [...porCuit, ...porDni, ...porTelefono]) combinados.set(c.id, c);
    candidatos = Array.from(combinados.values());
  } else {
    ({ candidatos } = await buscarClientesCandidatosPorNombre(t));
  }

  return candidatos.sort((a, b) => calcularRelevanciaCliente(b, t) - calcularRelevanciaCliente(a, t)).slice(0, 8);
}

// datosArca: opcional — lo que devuelve la consulta al padrón de ARCA. Sin eso, queda cargado a mano.
// datosContacto: opcional — { domicilioEntrega, whatsapp, email }, siempre a mano.
export async function crearCliente(razonSocial, cuit = "", datosArca = null, datosContacto = {}) {
  const cliente = {
    razonSocial: razonSocial.trim(),
    razonSocialLower: razonSocial.trim().toLowerCase(),
    searchKeywords: keywordsDeTextos(razonSocial),
    cuit: cuit.trim(),
    dni: dniDesdeCuit(cuit),
    condicionIva: datosArca?.condicionIva || null,
    domicilioFiscal: datosArca?.domicilioFiscal || null,
    provincia: datosArca?.provincia || null,
    codigoPostal: datosArca?.codigoPostal || null,
    situacionTributaria: datosArca?.situacionTributaria || null,
    actividades: datosArca?.actividades || [],
    fuenteDatos: datosArca ? "arca" : "manual",
    fechaConsultaArca: datosArca ? new Date() : null,
    domicilioEntrega: capitalizarDireccion(datosContacto.domicilioEntrega?.trim()) || null,
    codigoPostalEntrega: datosContacto.codigoPostalEntrega?.trim() || null,
    localidadEntrega: datosContacto.localidadEntrega?.trim() || null,
    provinciaEntrega: datosContacto.provinciaEntrega?.trim() || "Buenos Aires",
    paisEntrega: datosContacto.paisEntrega?.trim() || "Argentina",
    whatsapp: datosContacto.whatsapp?.trim() || null,
    searchPhone: normalizarTelefono(datosContacto.whatsapp),
    email: datosContacto.email?.trim().toLowerCase() || null,
    domicilioEntregaNormalizado: null,
    domicilioEntregaLat: null,
    domicilioEntregaLon: null,
    activo: true,
  };
  const ref = await addDoc(collection(db, "clientes"), cliente);
  return { id: ref.id, ...cliente };
}

export async function actualizarCliente(id, razonSocial, cuit, datosArca = null, datosContacto = {}) {
  const cambios = {
    razonSocial: razonSocial.trim(),
    razonSocialLower: razonSocial.trim().toLowerCase(),
    searchKeywords: keywordsDeTextos(razonSocial),
    cuit: cuit.trim(),
    dni: dniDesdeCuit(cuit),
    domicilioEntrega: capitalizarDireccion(datosContacto.domicilioEntrega?.trim()) || null,
    codigoPostalEntrega: datosContacto.codigoPostalEntrega?.trim() || null,
    localidadEntrega: datosContacto.localidadEntrega?.trim() || null,
    provinciaEntrega: datosContacto.provinciaEntrega?.trim() || "Buenos Aires",
    paisEntrega: datosContacto.paisEntrega?.trim() || "Argentina",
    whatsapp: datosContacto.whatsapp?.trim() || null,
    searchPhone: normalizarTelefono(datosContacto.whatsapp),
    email: datosContacto.email?.trim().toLowerCase() || null,
  };
  // Si cambió el texto del domicilio, la normalización/coordenadas anteriores quedan obsoletas —
  // se limpian acá y se vuelven a calcular con el botón "Normalizar dirección".
  if (datosContacto.domicilioEntregaCambio) {
    Object.assign(cambios, { domicilioEntregaNormalizado: null, domicilioEntregaLat: null, domicilioEntregaLon: null });
  }
  if (datosArca) {
    Object.assign(cambios, {
      condicionIva: datosArca.condicionIva || null,
      domicilioFiscal: datosArca.domicilioFiscal || null,
      provincia: datosArca.provincia || null,
      codigoPostal: datosArca.codigoPostal || null,
      situacionTributaria: datosArca.situacionTributaria || null,
      actividades: datosArca.actividades || [],
      fuenteDatos: "arca",
      fechaConsultaArca: new Date(),
    });
  }
  await updateDoc(doc(db, "clientes", id), cambios);
}

// Guarda el resultado de geocodificar el domicilio de entrega (ver js/motor-mapas.js).
// domicilioEntregaTexto: opcional — si el usuario corrigió el texto de búsqueda en el modal de
// normalización, esto también actualiza el domicilio de entrega "real" del cliente, no solo la
// versión geocodificada (si no, la corrección se perdía al cerrar el modal).
export async function guardarUbicacionCliente(id, { direccionNormalizada, lat, lon, domicilioEntregaTexto }) {
  const cambios = {
    domicilioEntregaNormalizado: direccionNormalizada,
    domicilioEntregaLat: lat,
    domicilioEntregaLon: lon,
  };
  if (domicilioEntregaTexto) {
    cambios.domicilioEntrega = capitalizarDireccion(domicilioEntregaTexto.trim());
  }
  await updateDoc(doc(db, "clientes", id), cambios);
}

export async function listarClientesTodos() {
  const snap = await getDocs(query(collection(db, "clientes"), orderBy("razonSocialLower")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerCliente(id) {
  const snap = await getDoc(doc(db, "clientes", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Autocompletar localidad/provincia a partir de un CP que ya vimos en otro cliente — no depende de
// ningún servicio externo (Georef no tiene búsqueda por código postal, se verificó a mano). Se arma
// solo con los datos reales ya cargados, sobre todo los importados de GBP (que siempre traen
// CP+localidad juntos) — mejora sola con el tiempo, sin mantener ninguna lista aparte.
export async function buscarLocalidadPorCodigoPostal(cp) {
  const limpio = (cp || "").trim();
  if (!limpio) return null;
  const snap = await getDocs(query(collection(db, "clientes"), where("codigoPostalEntrega", "==", limpio), limit(1)));
  if (snap.empty) return null;
  const c = snap.docs[0].data();
  if (!c.localidadEntrega && !c.provinciaEntrega) return null;
  return { localidad: c.localidadEntrega || null, provincia: c.provinciaEntrega || null };
}

// Para evitar altas duplicadas: crearCliente no valida nada solo, así que quien da de alta un
// cliente (ej. "+ Agregar cliente" en Nueva Venta) tiene que chequear esto antes de llamarla.
export async function buscarClientePorCuit(cuit) {
  const limpio = (cuit || "").trim();
  if (!limpio) return null;
  const snap = await getDocs(query(collection(db, "clientes"), where("cuit", "==", limpio), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
