// Imágenes de producto — array de objetos en el propio doc de producto (no una subcolección):
// un producto real tiene entre 0 y ~8 fotos, siempre se muestran junto con el resto de sus datos
// (Productos, Nueva Venta), y una subcolección obligaría a una lectura extra por producto en cada
// lista/búsqueda solo para pintar la miniatura — el array evita eso sin perder nada del modelo pedido.
//
// Cada imagen: { id, origen, url, principal, orden, identificadorExterno, estado, creadoEn, actualizadoEn }
// - origen: "manual" (subida a mano desde acá) | "tienda_nube" (preparado para cuando se conecte la
//   sincronización real — ver docs/tiendanube-integracion.md — hoy nunca se crea desde acá).
// - identificadorExterno: id de la imagen en el sistema de origen (ej. el id de imagen en Tienda
//   Nube), para poder re-sincronizar sin duplicar una vez exista esa integración.
// - estado: "activa" | "eliminada" — soft-delete: eliminarImagen no borra el elemento del array
//   (evita reordenar "orden" de todos los demás y pierde trazabilidad de qué había), lo marca
//   eliminada y también borra el archivo real de Storage. Los lugares que muestran imágenes siempre
//   filtran por estado==="activa" (ver imagenPrincipal/imagenesActivas).
//
// creadoEn/actualizadoEn son Date (no serverTimestamp()): Firestore no permite sentinels de servidor
// dentro de elementos de un array, así que acá se usa la hora del cliente — no se usan para nada
// financiero ni de orden crítico, solo referencia.
import { db, doc, getDoc, updateDoc, storage, ref, uploadBytes, getDownloadURL, deleteObject } from "./firebase.js";

function nuevoId() {
  return crypto.randomUUID();
}

export function imagenesActivas(producto) {
  return (producto?.imagenes || []).filter((img) => img.estado === "activa").sort((a, b) => a.orden - b.orden);
}

// Prioridad (ver punto 10 del pedido): 1) manual marcada principal, 2) manual más antigua si ninguna
// está marcada, 3) tienda_nube principal (cuando exista esa integración), 4) null ("Sin imagen").
// Una sola función, así que cambiar la prioridad el día de mañana es un cambio en un solo lugar, no
// en cada pantalla que hoy hace `p.imagenes && p.imagenes[0]` a mano.
export function imagenPrincipal(producto) {
  const activas = imagenesActivas(producto);
  if (activas.length === 0) return null;
  const manuales = activas.filter((img) => img.origen === "manual");
  const manualPrincipal = manuales.find((img) => img.principal) || manuales[0];
  if (manualPrincipal) return manualPrincipal;
  const externas = activas.filter((img) => img.origen !== "manual");
  return externas.find((img) => img.principal) || externas[0] || null;
}

async function actualizarImagenes(productoId, mutar, usuario) {
  const ref_ = doc(db, "productos", productoId);
  const snap = await getDoc(ref_);
  if (!snap.exists()) throw new Error("No se encontró el producto.");
  const imagenes = mutar([...(snap.data().imagenes || [])]);
  await updateDoc(ref_, { imagenes, modificadoPor: usuario.uid, modificadoEn: new Date() });
  return imagenes;
}

// Sube el archivo a Storage (productos/{productoId}/{imagenId}.{ext}) y agrega la entrada al array.
// Si es la primera imagen manual activa del producto, queda como principal automáticamente — así el
// caso más común (un producto, una foto) no exige un segundo paso de "marcar como principal".
export async function agregarImagenManual(productoId, archivo, usuario) {
  const id = nuevoId();
  const ext = (archivo.name.split(".").pop() || "jpg").toLowerCase();
  const storageRef = ref(storage, `productos/${productoId}/${id}.${ext}`);
  await uploadBytes(storageRef, archivo, { contentType: archivo.type });
  const url = await getDownloadURL(storageRef);
  const ahora = new Date();

  return actualizarImagenes(
    productoId,
    (imagenes) => {
      const yaHayManualActiva = imagenes.some((img) => img.origen === "manual" && img.estado === "activa");
      const ordenMax = imagenes.reduce((max, img) => Math.max(max, img.orden ?? 0), -1);
      imagenes.push({
        id,
        origen: "manual",
        url,
        principal: !yaHayManualActiva,
        orden: ordenMax + 1,
        identificadorExterno: null,
        estado: "activa",
        creadoEn: ahora,
        actualizadoEn: ahora,
      });
      return imagenes;
    },
    usuario
  );
}

export async function marcarImagenPrincipal(productoId, imagenId, usuario) {
  return actualizarImagenes(
    productoId,
    (imagenes) =>
      imagenes.map((img) => (img.origen === "manual" ? { ...img, principal: img.id === imagenId, actualizadoEn: new Date() } : img)),
    usuario
  );
}

// Soft-delete en Firestore + borrado real del archivo en Storage. Si la borrada era la principal,
// pasa la principal a la manual activa más antigua que quede (si hay alguna) — nunca deja el
// producto sin imagen principal mientras tenga al menos una imagen manual activa.
export async function eliminarImagen(productoId, imagenId, usuario) {
  const productoRef = doc(db, "productos", productoId);
  const snap = await getDoc(productoRef);
  if (!snap.exists()) throw new Error("No se encontró el producto.");
  const imagenes = snap.data().imagenes || [];
  const imagen = imagenes.find((img) => img.id === imagenId);
  if (!imagen) throw new Error("No se encontró esa imagen.");

  if (imagen.origen === "manual") {
    try {
      const ext = imagen.url.match(/\.([a-zA-Z0-9]+)\?/)?.[1] || imagen.url.split(".").pop().split("?")[0];
      await deleteObject(ref(storage, `productos/${productoId}/${imagenId}.${ext}`));
    } catch (err) {
      // Si el archivo ya no está en Storage (borrado a mano, o nunca se subió bien), no bloquea
      // la limpieza del registro en Firestore — es mejor un registro consistente que un error acá.
      console.warn("No se pudo borrar el archivo de Storage:", err?.message || err);
    }
  }

  const eraPrincipal = imagen.principal;
  let actualizadas = imagenes.map((img) => (img.id === imagenId ? { ...img, estado: "eliminada", principal: false, actualizadoEn: new Date() } : img));
  if (eraPrincipal) {
    const siguienteManual = actualizadas.filter((img) => img.origen === "manual" && img.estado === "activa").sort((a, b) => a.orden - b.orden)[0];
    if (siguienteManual) {
      actualizadas = actualizadas.map((img) => (img.id === siguienteManual.id ? { ...img, principal: true, actualizadoEn: new Date() } : img));
    }
  }

  await updateDoc(productoRef, { imagenes: actualizadas, modificadoPor: usuario.uid, modificadoEn: new Date() });
  return actualizadas;
}

// Miniatura compartida — antes productos-list.js y venta-nueva.js tenían cada uno su propia
// copia pegada de esta función (36px, mismo radio/borde, mismo placeholder "—"), así que un cambio
// al criterio de "sin imagen" había que hacerlo en dos lugares y podía divergir con el tiempo.
export function miniaturaProductoHtml(producto, tamano = 36) {
  const img = imagenPrincipal(producto);
  if (img) {
    return `<img src="${img.url}" alt="" style="width:${tamano}px;height:${tamano}px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0" />`;
  }
  return `<div style="width:${tamano}px;height:${tamano}px;border-radius:8px;background:var(--muted-bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;flex-shrink:0">—</div>`;
}

export async function reordenarImagenes(productoId, idsEnOrden, usuario) {
  return actualizarImagenes(
    productoId,
    (imagenes) => imagenes.map((img) => ({ ...img, orden: idsEnOrden.indexOf(img.id), actualizadoEn: img.id && idsEnOrden.includes(img.id) ? new Date() : img.actualizadoEn })),
    usuario
  );
}
