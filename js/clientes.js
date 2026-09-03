// Clientes: mismo modelo que proveedores (razón social/CUIT + datos de ARCA), del otro lado
// de la operación. Cuenta corriente de clientes queda lista para cuando exista el módulo de Ventas.
// domicilioEntrega/whatsapp/email son datos de contacto propios (no vienen de ARCA) — quedan
// cargados a mano, como base para integraciones futuras (normalización de mapas, WhatsApp/Meta, mail).
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit } from "./firebase.js";
import { capitalizarDireccion, keywordsDeTextos, tokenizar } from "./texto.js";
import { dniDesdeCuit } from "./cuit.js";

// Truco estándar de Firestore para range query "empieza con": el límite superior tiene que ser el
// prefijo más un carácter que ordene después de cualquier texto normal (U+F8FF, área de uso
// privado de Unicode) — un string vacío acá deja el rango en field <= prefijo, o sea una
// búsqueda EXACTA, no por prefijo (buscarClientes("aguero") no encontraba "Aguero Martin Gabriel").
const COTA_SUPERIOR_UNICODE = "";

// Por palabra suelta, en cualquier orden — "barbara saravia" y "saravia barbara" encuentran el mismo
// cliente, y agregar una palabra más sigue filtrando (no hace falta que sea el principio del nombre
// completo). Mismo patrón que buscarProductos (js/productos.js): la primera palabra tipeada filtra
// en Firestore contra el índice de prefijos (searchKeywords, ver keywordsDeTextos en js/texto.js) y,
// si hay más palabras, se exige que el cliente matchee todas — ya en memoria, sobre el resultado
// acotado que devolvió Firestore, no sobre la colección entera.
export async function buscarClientes(texto) {
  const palabras = tokenizar(texto);
  if (palabras.length === 0) return [];

  const snap = await getDocs(query(collection(db, "clientes"), where("searchKeywords", "array-contains", palabras[0]), limit(24)));
  let resultados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (palabras.length > 1) {
    resultados = resultados.filter((c) => palabras.slice(1).every((palabra) => (c.searchKeywords || []).includes(palabra)));
  }

  return resultados.slice(0, 8);
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

// Punto único de búsqueda "como se escriba" para los buscadores de cliente (picker de Nueva Venta,
// listado de Configuración → Clientes): un CUIT/DNI siempre empieza con un dígito, un nombre nunca.
// Para un documento se combinan dos búsquedas en paralelo — por CUIT completo Y por DNI embebido —
// porque un mismo número de documento puede estar guardado de las dos formas según el cliente (ver
// buscarClientesPorDni); se corren juntas y se descartan duplicados por id.
// Sin esto, cada pantalla traía la colección ENTERA de clientes para filtrar en memoria — funcionaba
// con los clientes de prueba, pero se vuelve pesado/lento en serio con miles de clientes reales
// (ver migración de GBP). Ninguna búsqueda final trae más de 8 resultados.
export async function buscarClientesTexto(texto) {
  const t = (texto || "").trim();
  if (!t) return [];
  if (!/^\d/.test(t)) return buscarClientes(t);

  const [porCuit, porDni] = await Promise.all([buscarClientesPorCuit(t), buscarClientesPorDni(t.replace(/\D/g, ""))]);
  const combinados = new Map();
  for (const c of [...porCuit, ...porDni]) combinados.set(c.id, c);
  return Array.from(combinados.values()).slice(0, 8);
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
    email: datosContacto.email?.trim() || null,
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
    email: datosContacto.email?.trim() || null,
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
