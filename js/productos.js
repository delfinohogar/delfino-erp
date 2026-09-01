import {
  db,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from "./firebase.js";

// Firestore permite hasta 500 operaciones por batch; dejamos margen para el write del producto
// + el de auditoría por cada uno (2 ops por producto) sin acercarnos al límite.
const TAMANO_LOTE = 200;

function enLotes(array, tamano) {
  const lotes = [];
  for (let i = 0; i < array.length; i += tamano) lotes.push(array.slice(i, i + tamano));
  return lotes;
}

const CAMPOS_AUDITABLES = [
  "sku",
  "codigoInterno",
  "codigoBarras",
  "descripcion",
  "marcaId",
  "categoriaId",
  "subcategoriaId",
  "identificadorExterno",
  "proveedorPrincipalId",
  "codigoProveedorPrincipal",
  "costoReferencia",
  "iva",
  "costoModo",
  "modoPrecio",
  "margenObjetivo",
  "margenMinimo",
  "stockMinimo",
  "estado",
  "visibilidad",
  "linkTiendaNube",
];

function lower(v) {
  return (v || "").toString().trim().toLowerCase();
}

// Separa en palabras (sin acentos raros de puntuación) para indexar por término, no por frase completa.
function tokenizar(texto) {
  return lower(texto)
    .split(/[^a-z0-9áéíóúñ]+/i)
    .filter(Boolean);
}

// Prefijos de una palabra desde 2 letras hasta la palabra completa (ej. "hepa" -> "he","hep","hepa"),
// para poder buscar por "empieza con" sobre cada palabra individual, no solo sobre el string entero.
function generarPrefijos(palabra) {
  const prefijos = [];
  for (let i = Math.min(2, palabra.length); i <= palabra.length; i++) {
    prefijos.push(palabra.slice(0, i));
  }
  return prefijos;
}

// Índice de búsqueda: todas las palabras (y sus prefijos) de sku/código/descripción/marca, en un solo
// array. Permite encontrar el producto escribiendo cualquier palabra suelta ("hepa", "ultracomb"),
// no solo el principio de la descripción completa.
export function camposBusqueda(producto, marcaNombre) {
  const palabras = [
    ...tokenizar(producto.sku),
    ...tokenizar(producto.codigoInterno),
    ...tokenizar(producto.codigoBarras),
    ...tokenizar(producto.descripcion),
    ...tokenizar(marcaNombre),
  ];
  const keywords = new Set();
  palabras.forEach((p) => generarPrefijos(p).forEach((pre) => keywords.add(pre)));
  return { searchKeywords: Array.from(keywords) };
}

export async function obtenerProducto(id) {
  const snap = await getDoc(doc(db, "productos", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function crearProducto(datos, marcaNombre, usuario) {
  const ahora = serverTimestamp();
  const producto = {
    ...datos,
    ...camposBusqueda(datos, marcaNombre),
    stockTotal: datos.stockTotal ?? 0,
    stockReservado: datos.stockReservado ?? 0,
    creadoPor: usuario.uid,
    creadoEn: ahora,
    modificadoPor: usuario.uid,
    modificadoEn: ahora,
  };

  const ref = await addDoc(collection(db, "productos"), producto);

  await addDoc(collection(db, "productos", ref.id, "logAuditoria"), {
    campo: "*",
    valorAnterior: null,
    valorNuevo: "creación",
    usuario: usuario.uid,
    fecha: ahora,
    productoId: ref.id,
    productoSku: datos.sku,
    productoDescripcion: datos.descripcion,
  });

  if (datos.costoReferencia != null) {
    await addDoc(collection(db, "productos", ref.id, "historialCostos"), {
      fecha: ahora,
      costoAnterior: null,
      costoNuevo: datos.costoReferencia,
      usuario: usuario.uid,
      motivo: "alta de producto",
    });
  }

  return ref.id;
}

export async function actualizarProducto(id, datosNuevos, datosAnteriores, marcaNombre, usuario) {
  const ahora = serverTimestamp();
  const cambios = {
    ...datosNuevos,
    ...camposBusqueda(datosNuevos, marcaNombre),
    modificadoPor: usuario.uid,
    modificadoEn: ahora,
  };

  await updateDoc(doc(db, "productos", id), cambios);

  for (const campo of CAMPOS_AUDITABLES) {
    const anterior = datosAnteriores[campo] ?? null;
    const nuevo = datosNuevos[campo] ?? null;
    if (anterior !== nuevo) {
      await addDoc(collection(db, "productos", id, "logAuditoria"), {
        campo,
        valorAnterior: anterior,
        valorNuevo: nuevo,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: id,
        productoSku: datosNuevos.sku,
        productoDescripcion: datosNuevos.descripcion,
      });
    }
  }

  if (datosAnteriores.costoReferencia !== datosNuevos.costoReferencia) {
    await addDoc(collection(db, "productos", id, "historialCostos"), {
      fecha: ahora,
      costoAnterior: datosAnteriores.costoReferencia ?? null,
      costoNuevo: datosNuevos.costoReferencia,
      usuario: usuario.uid,
      motivo: "edición manual",
    });
  }
}

export async function obtenerHistorialCostos(productoId) {
  const snap = await getDocs(
    query(collection(db, "productos", productoId, "historialCostos"), orderBy("fecha", "desc"), limit(20))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtenerLogAuditoria(productoId) {
  const snap = await getDocs(
    query(collection(db, "productos", productoId, "logAuditoria"), orderBy("fecha", "desc"), limit(50))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// "Movimientos": feed unificado de los cambios registrados en el log de auditoría de todos los productos
// (collection group query, no requiere una colección nueva ni un modelo de datos aparte).
export async function obtenerMovimientosRecientes(maxResultados = 100) {
  const snap = await getDocs(query(collectionGroup(db, "logAuditoria"), orderBy("fecha", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Búsqueda predictiva: por palabra (no por frase completa) sobre sku / código de barras / descripción / marca.
// La primera palabra tipeada filtra en Firestore (array-contains sobre el índice de prefijos);
// si hay más palabras, se refina en el cliente exigiendo que el producto matchee todas.
export async function buscarProductos(texto, maxResultados = 20) {
  const palabras = tokenizar(texto);
  if (palabras.length === 0) return [];

  const snap = await getDocs(
    query(collection(db, "productos"), where("searchKeywords", "array-contains", palabras[0]), limit(maxResultados * 3))
  );
  let resultados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (palabras.length > 1) {
    resultados = resultados.filter((p) =>
      palabras.slice(1).every((palabra) => (p.searchKeywords || []).includes(palabra))
    );
  }

  return resultados.slice(0, maxResultados);
}

// Todo el catálogo activo, para pantallas (como Nueva Venta) que necesitan filtrar en el cliente
// sobre una lista ya cargada en vez de consultar Firestore en cada tecla — así el buscador responde
// al instante, igual que en La Pyme, sin depender de la latencia de red por letra tipeada.
export async function listarProductosActivos() {
  const snap = await getDocs(query(collection(db, "productos"), where("estado", "==", "activo")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Mismo criterio de coincidencia que buscarProductos (todas las palabras deben estar en
// searchKeywords), pero aplicado en memoria sobre una lista ya traída — sin ida y vuelta a Firestore.
export function filtrarProductosLocal(productos, texto, maxResultados = 15) {
  const palabras = tokenizar(texto);
  if (palabras.length === 0) return [];
  return productos
    .filter((p) => palabras.every((palabra) => (p.searchKeywords || []).includes(palabra)))
    .slice(0, maxResultados);
}

// Para que el buscador de Nueva Venta no arranque vacío — ultimaVentaEn lo pisa crearVenta (ver
// js/ventas.js) cada vez que se vende ese producto, así que esto siempre refleja lo que de verdad
// se está vendiendo, no una lista fija a mano. Los productos que nunca se vendieron no tienen ese
// campo y quedan afuera solos (orderBy los excluye), no hace falta filtrarlos aparte.
export async function listarProductosVendidosRecientemente(maxResultados = 8) {
  const snap = await getDocs(query(collection(db, "productos"), orderBy("ultimaVentaEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarProductos(maxResultados = 50) {
  const snap = await getDocs(query(collection(db, "productos"), orderBy("descripcion"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Edición masiva (solo administrador) ---
// "productos" recibe los objetos ya cargados en la lista (con id, sku, descripcion, etc.) para no
// tener que releerlos de Firestore antes de escribir.

export async function actualizarCategoriaMasivo(productos, categoriaId, subcategoriaId, usuario) {
  const ahora = serverTimestamp();
  for (const lote of enLotes(productos, TAMANO_LOTE)) {
    const batch = writeBatch(db);
    lote.forEach((p) => {
      batch.update(doc(db, "productos", p.id), { categoriaId, subcategoriaId, modificadoPor: usuario.uid, modificadoEn: ahora });
      batch.set(doc(collection(db, "productos", p.id, "logAuditoria")), {
        campo: "categoriaId",
        valorAnterior: p.categoriaId ?? null,
        valorNuevo: categoriaId,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: p.id,
        productoSku: p.sku,
        productoDescripcion: p.descripcion,
      });
    });
    await batch.commit();
  }
}

export async function actualizarMarcaMasivo(productos, marcaId, marcaNombre, usuario) {
  const ahora = serverTimestamp();
  for (const lote of enLotes(productos, TAMANO_LOTE)) {
    const batch = writeBatch(db);
    lote.forEach((p) => {
      const { searchKeywords } = camposBusqueda(
        { sku: p.sku, codigoInterno: p.codigoInterno, codigoBarras: p.codigoBarras, descripcion: p.descripcion },
        marcaNombre
      );
      batch.update(doc(db, "productos", p.id), {
        marcaId,
        marcaNombre,
        searchKeywords,
        modificadoPor: usuario.uid,
        modificadoEn: ahora,
      });
      batch.set(doc(collection(db, "productos", p.id, "logAuditoria")), {
        campo: "marcaId",
        valorAnterior: p.marcaId ?? null,
        valorNuevo: marcaId,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: p.id,
        productoSku: p.sku,
        productoDescripcion: p.descripcion,
      });
    });
    await batch.commit();
  }
}

// modo: 'precioVenta' (sube el precio de venta directo y pasa el producto a modo manual)
//     | 'margen' (sube el margen objetivo y recalcula el precio — solo productos que ya estén en modo margen).
// Devuelve { omitidos } con la cantidad de productos en modo manual que se salteó cuando modo === 'margen'.
export async function aumentarPrecioMasivo(productos, porcentaje, modo, usuario) {
  const ahora = serverTimestamp();
  let omitidos = 0;

  for (const lote of enLotes(productos, TAMANO_LOTE)) {
    const batch = writeBatch(db);
    lote.forEach((p) => {
      if (modo === "margen" && p.modoPrecio !== "margen") {
        omitidos++;
        return;
      }

      const cambios = { modificadoPor: usuario.uid, modificadoEn: ahora };
      let campo, valorAnterior, valorNuevo;

      if (modo === "precioVenta") {
        campo = "precioVenta";
        valorAnterior = p.precioVenta ?? 0;
        valorNuevo = Math.round(valorAnterior * (1 + porcentaje / 100) * 100) / 100;
        cambios.precioVenta = valorNuevo;
        cambios.modoPrecio = "manual";
      } else {
        campo = "margenObjetivo";
        valorAnterior = p.margenObjetivo ?? 0;
        valorNuevo = Math.round(valorAnterior * (1 + porcentaje / 100) * 100) / 100;
        cambios.margenObjetivo = valorNuevo;
        const costoConIva = (p.costoReferencia ?? 0) * (1 + (p.iva ?? 0) / 100);
        cambios.precioVenta = Math.round(costoConIva * (1 + valorNuevo / 100) * 100) / 100;
      }

      batch.update(doc(db, "productos", p.id), cambios);
      batch.set(doc(collection(db, "productos", p.id, "logAuditoria")), {
        campo,
        valorAnterior,
        valorNuevo,
        usuario: usuario.uid,
        fecha: ahora,
        productoId: p.id,
        productoSku: p.sku,
        productoDescripcion: p.descripcion,
      });
    });
    await batch.commit();
  }

  return { omitidos };
}
