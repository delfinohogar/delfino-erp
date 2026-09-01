// Clientes: mismo modelo que proveedores (razón social/CUIT + datos de ARCA), del otro lado
// de la operación. Cuenta corriente de clientes queda lista para cuando exista el módulo de Ventas.
// domicilioEntrega/whatsapp/email son datos de contacto propios (no vienen de ARCA) — quedan
// cargados a mano, como base para integraciones futuras (normalización de mapas, WhatsApp/Meta, mail).
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, limit } from "./firebase.js";
import { capitalizarDireccion } from "./texto.js";

const COTA_SUPERIOR_UNICODE = "";

export async function buscarClientes(texto) {
  if (!texto) return [];
  const t = texto.trim().toLowerCase();
  const snap = await getDocs(
    query(
      collection(db, "clientes"),
      where("razonSocialLower", ">=", t),
      where("razonSocialLower", "<=", t + COTA_SUPERIOR_UNICODE),
      orderBy("razonSocialLower"),
      limit(8)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// datosArca: opcional — lo que devuelve la consulta al padrón de ARCA. Sin eso, queda cargado a mano.
// datosContacto: opcional — { domicilioEntrega, whatsapp, email }, siempre a mano.
export async function crearCliente(razonSocial, cuit = "", datosArca = null, datosContacto = {}) {
  const cliente = {
    razonSocial: razonSocial.trim(),
    razonSocialLower: razonSocial.trim().toLowerCase(),
    cuit: cuit.trim(),
    condicionIva: datosArca?.condicionIva || null,
    domicilioFiscal: datosArca?.domicilioFiscal || null,
    provincia: datosArca?.provincia || null,
    codigoPostal: datosArca?.codigoPostal || null,
    situacionTributaria: datosArca?.situacionTributaria || null,
    actividades: datosArca?.actividades || [],
    fuenteDatos: datosArca ? "arca" : "manual",
    fechaConsultaArca: datosArca ? new Date() : null,
    domicilioEntrega: capitalizarDireccion(datosContacto.domicilioEntrega?.trim()) || null,
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
    cuit: cuit.trim(),
    domicilioEntrega: capitalizarDireccion(datosContacto.domicilioEntrega?.trim()) || null,
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

// Para evitar altas duplicadas: crearCliente no valida nada solo, así que quien da de alta un
// cliente (ej. "+ Agregar cliente" en Nueva Venta) tiene que chequear esto antes de llamarla.
export async function buscarClientePorCuit(cuit) {
  const limpio = (cuit || "").trim();
  if (!limpio) return null;
  const snap = await getDocs(query(collection(db, "clientes"), where("cuit", "==", limpio), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
