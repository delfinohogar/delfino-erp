// Importación del catálogo desde el export de GlobalBluePoint ERP (planilla "Table" con 15
// columnas fijas: item_code, item_desc, Stk, AStk, Lista de Precios, Lista Contado, Depo Central,
// Depo Lirio, Depo Video, Lista de Costos, cat_desc, subcat_desc, brand_desc, tax_percentage, ID).
//
// Reglas de negocio confirmadas con el dueño del negocio antes de programar esto (ver el mapeo que
// se armó y corrigió en el chat, Prioridad 4.1):
//   - item_code -> sku, ID -> identificadorExterno.
//   - Lista de Costos YA trae el IVA cargado adentro (21% o 10.5%, según tax_percentage) — acá se
//     saca para guardar el costo neto, que es lo que espera calcularPrecioLista (js/catalogo.js).
//   - Costos en USD se convierten a ARS con la cotización oficial (js/cotizacion-dolar.js) antes de
//     sacarles el IVA.
//   - El stock se toma solo de "Depo Central" (se confirmó Depo Central === AStk en todo el archivo
//     real, así que no se pierde nada real al no repartir por depósito).
//   - El precio de venta es "Lista Contado", no "Lista de Precios" — el dueño del negocio aclaró que
//     esa segunda lista no se usa para vender de verdad. "Lista de Precios" solo se usa como
//     referencia interna para detectar precios viejos (ver revisarPrecio), no se guarda en ningún
//     lado.
//   - 4 líneas del Excel no son productos (financiación/flete/descuentos/notas de crédito modeladas
//     como ítems falsos en el ERP viejo) — se excluyen por SKU, no se importan.
//   - Precios con una relación Lista Contado / Lista de Precios muy alejada de 1 (<0.5 o >1.5) casi
//     seguro quedaron desactualizados — se importan con stock en 0 y marcados para revisar, para que
//     no se puedan vender hasta que alguien les cargue un precio real.
import {
  db,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from "./firebase.js";
import { camposBusqueda } from "./productos.js";
import { obtenerCotizacionDolarOficial } from "./cotizacion-dolar.js";

export const SKUS_EXCLUIDOS = new Set(["1301", "5325", "5462", "5463"]);

function limpiarDescripcion(texto) {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .trim();
}

// "120.000,00 ARS" -> 120000
function parsePrecioArs(texto) {
  if (!texto) return 0;
  const limpio = String(texto).replace(" ARS", "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : 0;
}

// Devuelve { monto, moneda } — soporta "92.308,00 ARS" y "52,00 USD" (mismo formato de coma decimal
// en las dos monedas, no es un típico "1,234.56" en inglés).
function parseCosto(texto) {
  if (!texto) return { monto: 0, moneda: "ARS" };
  const s = String(texto);
  const moneda = s.endsWith(" USD") ? "USD" : "ARS";
  const limpio = s.replace(" USD", "").replace(" ARS", "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpio);
  return { monto: Number.isFinite(n) ? n : 0, moneda };
}

// Convierte las filas crudas de la planilla en candidatos a importar, con toda la lógica de negocio
// ya aplicada. No escribe nada en Firestore — eso lo hace confirmarImportacion más abajo, después de
// que alguien revisó la previsualización.
export async function prepararImportacion(filas) {
  let cotizacion = null;
  let errorCotizacion = null;
  try {
    cotizacion = await obtenerCotizacionDolarOficial();
  } catch (err) {
    errorCotizacion = err?.message || "No se pudo obtener la cotización del dólar.";
  }

  const productos = [];
  const excluidos = [];
  const sinSku = [];

  for (const fila of filas) {
    const sku = String(fila.item_code ?? "").trim();
    const descripcion = limpiarDescripcion(fila.item_desc);
    if (!sku) {
      if (descripcion) sinSku.push({ descripcion });
      continue;
    }
    if (SKUS_EXCLUIDOS.has(sku)) {
      excluidos.push({ sku, descripcion });
      continue;
    }

    // El precio de venta real es "Lista Contado" — "Lista de Precios" no se usa para vender, queda
    // solo como referencia interna acá abajo para detectar precios viejos.
    const precioVenta = parsePrecioArs(fila["Lista Contado"]);
    const precioListaReferencia = parsePrecioArs(fila["Lista de Precios"]);
    const iva = parseFloat(fila.tax_percentage) || 0;
    const { monto: costoOriginal, moneda: costoMoneda } = parseCosto(fila["Lista de Costos"]);
    const costoTipoCambio = costoMoneda === "USD" ? cotizacion?.valor || null : null;
    const costoBrutoArs = costoMoneda === "USD" ? costoOriginal * (costoTipoCambio || 0) : costoOriginal;
    const costoReferencia = iva > 0 ? Math.round((costoBrutoArs / (1 + iva / 100)) * 100) / 100 : Math.round(costoBrutoArs * 100) / 100;

    // Si Lista Contado (el precio que se importa) se aleja demasiado de Lista de Precios, el precio
    // casi seguro quedó viejo (visto en la auditoría: ventiladores/mouses a $2.000 en medio de un
    // catálogo de $50.000+). Se importa con stock 0 para que no se pueda vender hasta que alguien lo
    // revise a mano.
    const ratio = precioListaReferencia > 0 ? precioVenta / precioListaReferencia : 1;
    const revisarPrecio = precioListaReferencia > 0 && precioVenta > 0 && (ratio < 0.5 || ratio > 1.5);

    productos.push({
      sku,
      identificadorExterno: String(fila.ID ?? "").trim(),
      descripcion,
      categoriaNombre: String(fila.cat_desc ?? "").trim(),
      subcategoriaNombre: String(fila.subcat_desc ?? "").trim(),
      marcaNombre: String(fila.brand_desc ?? "").trim(),
      iva,
      costoMoneda,
      costoOriginal,
      costoTipoCambio,
      costoReferencia,
      precioVenta,
      precioListaReferencia,
      stockTotal: revisarPrecio ? 0 : Number(fila["Depo Central"]) || 0,
      revisarPrecio,
    });
  }

  return { productos, excluidos, sinSku, cotizacionDolar: cotizacion, errorCotizacion };
}

function enLotes(array, tamano) {
  const lotes = [];
  for (let i = 0; i < array.length; i += tamano) lotes.push(array.slice(i, i + tamano));
  return lotes;
}

// Crea (o reutiliza) categorías, subcategorías y marcas; después crea o actualiza cada producto en
// lotes. Devuelve { creados, actualizados } para el resumen final.
// onProgreso(paso, hecho, total) — para la barra de progreso de la pantalla.
export async function confirmarImportacion(productos, usuario, onProgreso = () => {}) {
  onProgreso("Leyendo categorías y marcas existentes…", 0, 1);

  const [categoriasSnap, subcategoriasSnap, marcasSnap, productosSnap] = await Promise.all([
    getDocs(query(collection(db, "categorias"), where("nivel", "==", "categoria"))),
    getDocs(query(collection(db, "categorias"), where("nivel", "==", "subcategoria"))),
    getDocs(collection(db, "marcas")),
    getDocs(collection(db, "productos")),
  ]);

  const categoriaPorNombre = new Map(categoriasSnap.docs.map((d) => [d.data().nombreLower, d.id]));
  // Subcategorías se identifican por (nombre + categoría padre) — "Accesorios" de Tecnología y
  // "Accesorios" de Audio son documentos distintos, no se pueden mapear solo por nombre.
  const subcategoriaPorClave = new Map(subcategoriasSnap.docs.map((d) => [`${d.data().parentId}::${d.data().nombreLower}`, d.id]));
  const marcaPorNombre = new Map(marcasSnap.docs.map((d) => [d.data().nombreLower, d.id]));
  const productoPorSku = new Map(productosSnap.docs.map((d) => [d.data().sku, d.id]));

  // --- 1) categorías y subcategorías nuevas ---
  const categoriasFaltantes = new Map();
  const subcategoriasFaltantes = new Map();
  for (const p of productos) {
    if (p.categoriaNombre && !categoriaPorNombre.has(p.categoriaNombre.toLowerCase())) {
      categoriasFaltantes.set(p.categoriaNombre.toLowerCase(), p.categoriaNombre);
    }
  }
  {
    let lote = writeBatch(db);
    let enLote = 0;
    for (const [key, nombre] of categoriasFaltantes) {
      const ref = doc(collection(db, "categorias"));
      lote.set(ref, { nombre, nombreLower: key, nivel: "categoria", parentId: null });
      categoriaPorNombre.set(key, ref.id);
      enLote++;
      if (enLote >= 400) {
        await lote.commit();
        lote = writeBatch(db);
        enLote = 0;
      }
    }
    if (enLote > 0) await lote.commit();
  }

  for (const p of productos) {
    if (!p.subcategoriaNombre || !p.categoriaNombre) continue;
    const parentId = categoriaPorNombre.get(p.categoriaNombre.toLowerCase());
    const clave = `${parentId}::${p.subcategoriaNombre.toLowerCase()}`;
    if (!subcategoriaPorClave.has(clave)) {
      subcategoriasFaltantes.set(clave, { nombre: p.subcategoriaNombre, parentId });
    }
  }
  {
    let lote = writeBatch(db);
    let enLote = 0;
    for (const [clave, { nombre, parentId }] of subcategoriasFaltantes) {
      const ref = doc(collection(db, "categorias"));
      lote.set(ref, { nombre, nombreLower: nombre.toLowerCase(), nivel: "subcategoria", parentId });
      subcategoriaPorClave.set(clave, ref.id);
      enLote++;
      if (enLote >= 400) {
        await lote.commit();
        lote = writeBatch(db);
        enLote = 0;
      }
    }
    if (enLote > 0) await lote.commit();
  }

  // --- 2) marcas nuevas ---
  const marcasFaltantes = new Map();
  for (const p of productos) {
    if (p.marcaNombre && !marcaPorNombre.has(p.marcaNombre.toLowerCase())) {
      marcasFaltantes.set(p.marcaNombre.toLowerCase(), p.marcaNombre);
    }
  }
  {
    let lote = writeBatch(db);
    let enLote = 0;
    for (const [key, nombre] of marcasFaltantes) {
      const ref = doc(collection(db, "marcas"));
      lote.set(ref, { nombre, nombreLower: key, activo: true });
      marcaPorNombre.set(key, ref.id);
      enLote++;
      if (enLote >= 400) {
        await lote.commit();
        lote = writeBatch(db);
        enLote = 0;
      }
    }
    if (enLote > 0) await lote.commit();
  }

  // --- 3) productos ---
  const ahora = serverTimestamp();
  let creados = 0;
  let actualizados = 0;
  const lotesProductos = enLotes(productos, 150);
  let hechos = 0;
  for (const lote of lotesProductos) {
    const batch = writeBatch(db);
    for (const p of lote) {
      const categoriaId = p.categoriaNombre ? categoriaPorNombre.get(p.categoriaNombre.toLowerCase()) || null : null;
      const subcategoriaId =
        p.subcategoriaNombre && categoriaId ? subcategoriaPorClave.get(`${categoriaId}::${p.subcategoriaNombre.toLowerCase()}`) || null : null;
      const marcaId = p.marcaNombre ? marcaPorNombre.get(p.marcaNombre.toLowerCase()) || null : null;

      const datosProducto = {
        sku: p.sku,
        identificadorExterno: p.identificadorExterno,
        descripcion: p.descripcion,
        categoriaId,
        subcategoriaId,
        marcaId,
        marcaNombre: p.marcaNombre || null,
        iva: p.iva,
        costoMoneda: p.costoMoneda,
        costoOriginal: p.costoOriginal,
        costoTipoCambio: p.costoTipoCambio,
        costoReferencia: p.costoReferencia,
        precioVenta: p.precioVenta,
        stockTotal: p.stockTotal,
        stockReservado: 0,
        estado: p.revisarPrecio ? "inactivo" : "activo",
        visibilidad: "ambos",
        revisarPrecio: p.revisarPrecio,
        modificadoPor: usuario.uid,
        modificadoEn: ahora,
        ...camposBusqueda(p, p.marcaNombre),
      };

      const idExistente = productoPorSku.get(p.sku);
      let productoId;
      if (idExistente) {
        productoId = idExistente;
        batch.set(doc(db, "productos", productoId), datosProducto, { merge: true });
        actualizados++;
      } else {
        productoId = doc(collection(db, "productos")).id;
        batch.set(doc(db, "productos", productoId), { ...datosProducto, creadoPor: usuario.uid, creadoEn: ahora });
        productoPorSku.set(p.sku, productoId);
        creados++;
      }
    }
    await batch.commit();
    hechos += lote.length;
    onProgreso(`Importando productos… ${hechos}/${productos.length}`, hechos, productos.length);
  }

  return { creados, actualizados };
}
