// Medios de pago: catálogo configurable, separado de las cuentas de Tesorería (caja/banco) — un
// medio de pago es "cómo paga el cliente" (Efectivo, Mercado Pago...), una cuenta de Tesorería es
// "dónde vive la plata" (Caja Sucursal 1, Banco Galicia...). No confundir ambas entidades.
//
// El "destino" de cada medio (a qué tipo de cuenta de Tesorería va esa plata) sigue siendo el mismo
// switch ya probado en ventas.js/cobros.js — acá se guarda solo a título informativo (para mostrarlo
// en la ficha del medio) y para los medios "de sistema" (los 8 que ya existen), que son justamente
// los que ese switch reconoce por nombre. Un medio nuevo que el usuario cree acá puede activarse y
// aparecer en el selector de pago, pero hasta que se generalice el switch de ruteo (ver nota en
// ventas.js) no tiene a dónde ir en Tesorería — se lo avisa en la propia pantalla, no se lo oculta.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy, serverTimestamp } from "./firebase.js";

export const DESTINOS_TESORERIA = [
  { valor: "caja", label: "Caja (disponible en el momento)" },
  { valor: "banco", label: "Banco (disponible en el momento)" },
  { valor: "cuentaPorCobrar", label: "Cuenta por cobrar (pendiente de acreditar)" },
  { valor: null, label: "Sin destino específico" },
];

// Espejo de la lógica real en ventas.js/routearPagoATesoreria — los 8 medios que el sistema ya sabe
// rutear. Sirve para sembrar el catálogo la primera vez y para no dejar "editar el destino" de estos
// puntuales (cambiarlo ahí rompería el ruteo real sin tocar el código).
export const MEDIOS_DE_SISTEMA = [
  { nombre: "Efectivo", destino: "caja", medioCuentaPorCobrar: null },
  { nombre: "Débito", destino: "banco", medioCuentaPorCobrar: null },
  { nombre: "Transferencia", destino: "banco", medioCuentaPorCobrar: null },
  { nombre: "Crédito", destino: "cuentaPorCobrar", medioCuentaPorCobrar: "Tarjeta de crédito" },
  { nombre: "Mercado Pago", destino: "cuentaPorCobrar", medioCuentaPorCobrar: "Mercado Pago" },
  { nombre: "GoCuotas", destino: "cuentaPorCobrar", medioCuentaPorCobrar: "GoCuotas" },
  { nombre: "Boston Cred", destino: "cuentaPorCobrar", medioCuentaPorCobrar: "Boston Cred" },
  { nombre: "Otro", destino: null, medioCuentaPorCobrar: null },
];

export async function sembrarMediosPagoIniciales() {
  const existentes = await listarMediosPago();
  const nombresExistentes = new Set(existentes.map((m) => m.nombre));
  for (const medio of MEDIOS_DE_SISTEMA) {
    if (nombresExistentes.has(medio.nombre)) continue;
    await addDoc(collection(db, "mediosPago"), { ...medio, activo: true, esSistema: true, comentario: "", creadoEn: serverTimestamp() });
  }
}

export async function listarMediosPago() {
  const snap = await getDocs(query(collection(db, "mediosPago"), orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarMediosPagoActivos() {
  const todos = await listarMediosPago();
  return todos.filter((m) => m.activo !== false);
}

export async function obtenerMedioPagoPorNombre(nombre) {
  const snap = await getDocs(query(collection(db, "mediosPago"), where("nombre", "==", nombre)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// datos: { nombre, destino, medioCuentaPorCobrar?, comentario? } — los medios nuevos (no de sistema)
// se crean siempre con el destino que el usuario elige; no rutean de verdad hasta generalizar el
// switch de ventas.js, pero quedan documentados y listos para cuando se conecte.
export async function crearMedioPago(datos) {
  if (!datos.nombre?.trim()) throw new Error("El medio de pago necesita un nombre.");
  const existente = await obtenerMedioPagoPorNombre(datos.nombre.trim());
  if (existente) throw new Error(`Ya existe un medio de pago llamado "${datos.nombre.trim()}".`);
  const ref = await addDoc(collection(db, "mediosPago"), {
    nombre: datos.nombre.trim(),
    destino: datos.destino || null,
    medioCuentaPorCobrar: datos.destino === "cuentaPorCobrar" ? datos.medioCuentaPorCobrar?.trim() || datos.nombre.trim() : null,
    comentario: datos.comentario?.trim() || "",
    activo: true,
    esSistema: false,
    creadoEn: serverTimestamp(),
  });
  return { id: ref.id };
}

export async function actualizarMedioPago(id, { comentario, activo }) {
  const cambios = {};
  if (comentario !== undefined) cambios.comentario = comentario.trim();
  if (activo !== undefined) cambios.activo = activo;
  await updateDoc(doc(db, "mediosPago", id), cambios);
}

export async function obtenerMedioPago(id) {
  const snap = await getDoc(doc(db, "mediosPago", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
