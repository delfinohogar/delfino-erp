// Helpers de acceso a las colecciones de catálogo (categorías, marcas, proveedores).
// Todas ofrecen buscarPorPrefijo() para autocompletar y crear() para "crear al vuelo" desde la ficha de producto.
import { db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where, orderBy, limit } from "./firebase.js";

// Caracter unicode muy alto: usado como cota superior para lograr un "empieza con" (prefix match) en Firestore.
const COTA_SUPERIOR_UNICODE = "";

function prefixQuery(colName, campo, texto, extraWhere = []) {
  const textoLower = texto.toLowerCase();
  return query(
    collection(db, colName),
    ...extraWhere,
    where(campo, ">=", textoLower),
    where(campo, "<=", textoLower + COTA_SUPERIOR_UNICODE),
    orderBy(campo),
    limit(8)
  );
}

// --- Marcas ---
export async function buscarMarcas(texto) {
  if (!texto) return [];
  const snap = await getDocs(prefixQuery("marcas", "nombreLower", texto));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function crearMarca(nombre) {
  const ref = await addDoc(collection(db, "marcas"), {
    nombre: nombre.trim(),
    nombreLower: nombre.trim().toLowerCase(),
    activo: true,
  });
  return { id: ref.id, nombre: nombre.trim(), activo: true };
}

export async function listarMarcas() {
  const snap = await getDocs(query(collection(db, "marcas"), orderBy("nombreLower")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function renombrarMarca(id, nuevoNombre) {
  const nombre = nuevoNombre.trim();
  await updateDoc(doc(db, "marcas", id), { nombre, nombreLower: nombre.toLowerCase() });
  return nombre;
}

// --- Categorías (nivel: 'categoria' | 'subcategoria', parentId null para nivel 'categoria') ---
export async function buscarCategorias(texto, nivel, parentId) {
  if (!texto) return [];
  const extraWhere = [where("nivel", "==", nivel)];
  if (nivel === "subcategoria") {
    if (!parentId) return [];
    extraWhere.push(where("parentId", "==", parentId));
  }
  const snap = await getDocs(prefixQuery("categorias", "nombreLower", texto, extraWhere));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function crearCategoria(nombre, nivel, parentId = null) {
  const ref = await addDoc(collection(db, "categorias"), {
    nombre: nombre.trim(),
    nombreLower: nombre.trim().toLowerCase(),
    nivel,
    parentId,
  });
  return { id: ref.id, nombre: nombre.trim(), nivel, parentId };
}

export async function renombrarCategoria(id, nuevoNombre) {
  const nombre = nuevoNombre.trim();
  await updateDoc(doc(db, "categorias", id), { nombre, nombreLower: nombre.toLowerCase() });
  return nombre;
}

// Lista completa de categorías de un nivel (para poblar selects de filtro, no autocompletar).
export async function listarCategoriasPorNivel(nivel) {
  const snap = await getDocs(query(collection(db, "categorias"), where("nivel", "==", nivel), orderBy("nombreLower")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerCategoria(id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, "categorias", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- Proveedores ---
export async function buscarProveedores(texto) {
  if (!texto) return [];
  const snap = await getDocs(prefixQuery("proveedores", "razonSocialLower", texto));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// datosArca: opcional — lo que devuelve la consulta al padrón de ARCA (ws_sr_padron_a13), cuando esté conectada.
// Si no se pasa, el proveedor queda cargado a mano con fuenteDatos: 'manual', y se puede completar después.
export async function crearProveedor(razonSocial, cuit = "", datosArca = null) {
  const proveedor = {
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
    activo: true,
  };
  const ref = await addDoc(collection(db, "proveedores"), proveedor);
  return { id: ref.id, ...proveedor };
}

export async function actualizarProveedor(id, razonSocial, cuit, datosArca = null) {
  const cambios = {
    razonSocial: razonSocial.trim(),
    razonSocialLower: razonSocial.trim().toLowerCase(),
    cuit: cuit.trim(),
  };
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
  await updateDoc(doc(db, "proveedores", id), cambios);
}

export async function listarProveedoresTodos() {
  const snap = await getDocs(query(collection(db, "proveedores"), orderBy("razonSocialLower")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerProveedor(id) {
  const snap = await getDoc(doc(db, "proveedores", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// --- Listas de precios ---

// Compartido con la ficha de producto y la pantalla de Precios, para no duplicar la fórmula.
export function aplicarRedondeo(valor, regla) {
  switch (regla) {
    case "entero":
      return Math.round(valor);
    case "multiplo_10":
      return Math.round(valor / 10) * 10;
    case "multiplo_100":
      return Math.round(valor / 100) * 100;
    default:
      return Math.round(valor * 100) / 100;
  }
}

export function calcularPrecioLista(producto, lista) {
  const costoConIva = (producto.costoReferencia ?? 0) * (1 + (producto.iva ?? 0) / 100);
  return aplicarRedondeo(costoConIva * (1 + (lista.reglaMargen ?? 0) / 100), lista.reglaRedondeo);
}

export async function listarListasPrecios() {
  const snap = await getDocs(query(collection(db, "listasPrecios"), orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function crearListaPrecio({ nombre, reglaMargen, reglaRedondeo, activa = true }) {
  const ref = await addDoc(collection(db, "listasPrecios"), { nombre: nombre.trim(), reglaMargen, reglaRedondeo, activa });
  return { id: ref.id, nombre: nombre.trim(), reglaMargen, reglaRedondeo, activa };
}

export async function actualizarListaPrecio(id, datos) {
  await updateDoc(doc(db, "listasPrecios", id), datos);
}

// Override manual de precio de un producto para una lista puntual (productos/{id}/precios/{listaId}).
// Si nunca se guardó nada para esa combinación, devuelve null (se usa el precio calculado de la lista).
export async function obtenerPrecioProductoLista(productoId, listaId) {
  const snap = await getDoc(doc(db, "productos", productoId, "precios", listaId));
  return snap.exists() ? snap.data() : null;
}

export async function guardarPrecioProductoLista(productoId, listaId, datos) {
  await setDoc(doc(db, "productos", productoId, "precios", listaId), datos, { merge: true });
}

// --- Depósitos ---
export async function listarDepositos() {
  const snap = await getDocs(query(collection(db, "depositos"), orderBy("nombre")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Stock de un producto desglosado por depósito (productos/{id}/stockPorDeposito/{depositoId}).
export async function listarStockPorDeposito(productoId) {
  const snap = await getDocs(collection(db, "productos", productoId, "stockPorDeposito"));
  const stock = {};
  snap.docs.forEach((d) => {
    stock[d.id] = d.data().cantidad ?? 0;
  });
  return stock;
}
