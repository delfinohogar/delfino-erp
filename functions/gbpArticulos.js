// Sincroniza precio, stock, descripción e IVA del catálogo con GBP — SOLO lectura de GBP, y solo
// ACTUALIZA productos que ya existen en Delfino (matcheados por identificadorExterno = item_id de
// GBP). No crea productos nuevos todavía: GBP no expone un campo de costo directo en este webservice
// (solo % de markup), y este proyecto no fabrica datos financieros que no se puedan verificar — los
// artículos de GBP sin correlato en Delfino se devuelven en `nuevos` para que un administrador los
// revise y cargue el costo a mano (Productos → Nuevo, o el importador de Excel existente).
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const gbp = require("./gbp");

// Igual que SKUS_EXCLUIDOS en js/importar-globalbluepoint.js (financiación/flete/notas de crédito
// modeladas como ítems falsos en el ERP viejo, no son productos reales) — mantener sincronizado si
// cambia allá.
const SKUS_EXCLUIDOS = new Set(["1301", "5325", "5462", "5463"]);

function numero(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Mismo índice de búsqueda que camposBusqueda en js/productos.js (duplicado a propósito: ese archivo
// depende del SDK cliente de Firebase, acá corre con el SDK admin) — recomputar cuando cambia la
// descripción, si no el producto queda sin encontrarse por su descripción nueva en el buscador.
function lower(v) {
  return (v || "").toString().trim().toLowerCase();
}
function tokenizar(texto) {
  return lower(texto).split(/[^a-z0-9áéíóúñ]+/i).filter(Boolean);
}
function generarPrefijos(palabra) {
  const prefijos = [];
  for (let i = Math.min(2, palabra.length); i <= palabra.length; i++) prefijos.push(palabra.slice(0, i));
  return prefijos;
}
function searchKeywordsPara(sku, descripcion, marcaNombre) {
  const palabras = [...tokenizar(sku), ...tokenizar(descripcion), ...tokenizar(marcaNombre)];
  const keywords = new Set();
  palabras.forEach((p) => generarPrefijos(p).forEach((pre) => keywords.add(pre)));
  return Array.from(keywords);
}

async function armarCatalogoGbp() {
  const token = await gbp.authenticate();
  const [items, categorias, subcategorias, marcas, precios, stock] = await Promise.all([
    gbp.itemsActivos(token),
    gbp.categorias(token),
    gbp.subcategorias(token),
    gbp.marcas(token),
    gbp.preciosListaContado(token),
    gbp.stockDepoCentral(token),
  ]);

  const catPorId = new Map(categorias.map((c) => [String(c.cat_id), c.cat_desc]));
  const subcatPorId = new Map(subcategorias.map((s) => [String(s.subcat_id), s.subcat_desc]));
  const marcaPorId = new Map(marcas.map((m) => [String(m.brand_id), m.brand_desc]));
  const precioPorItem = new Map(precios.map((p) => [String(p.item_id), numero(p.prli_price_Final_Pesos)]));
  const stockPorItem = new Map(stock.map((s) => [String(s.item_id), numero(s.Stock ?? s.FS)]));

  return items
    .filter((it) => !SKUS_EXCLUIDOS.has(String(it.item_code)))
    .map((it) => {
      const marcaNombre = marcaPorId.get(String(it.brand_id)) || null;
      const descripcion = String(it.item_desc || "").replace(/\s+/g, " ").trim();
      return {
        identificadorExterno: String(it.item_id),
        sku: String(it.item_code),
        descripcion,
        categoriaNombre: catPorId.get(String(it.cat_id)) || null,
        subcategoriaNombre: subcatPorId.get(String(it.subcat_id)) || null,
        marcaNombre,
        iva: numero(it.tax_percentage),
        precioVenta: precioPorItem.has(String(it.item_id)) ? precioPorItem.get(String(it.item_id)) : null,
        stockTotal: stockPorItem.has(String(it.item_id)) ? stockPorItem.get(String(it.item_id)) : 0,
      };
    });
}

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfil.data()?.rol !== "administrador") {
    throw new HttpsError("permission-denied", "Solo un administrador puede sincronizar el catálogo de GBP.");
  }
  return db;
}

exports.gbpPreviewArticulos = onCall(
  { region: "southamerica-east1", secrets: gbp.GBP_SECRETS, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    const db = await requireAdmin(request);

    const [catalogoGbp, productosSnap] = await Promise.all([armarCatalogoGbp(), db.collection("productos").get()]);
    const porIdExterno = new Map();
    productosSnap.docs.forEach((d) => {
      const p = d.data();
      if (p.identificadorExterno) porIdExterno.set(String(p.identificadorExterno), { id: d.id, ...p });
    });

    const actualizados = [];
    const nuevos = [];
    let sinCambios = 0;

    for (const art of catalogoGbp) {
      const existente = porIdExterno.get(art.identificadorExterno);
      if (!existente) {
        nuevos.push(art);
        continue;
      }
      const cambios = {};
      if (art.precioVenta != null && Math.round(art.precioVenta) !== Math.round(existente.precioVenta ?? 0)) {
        cambios.precioVenta = { anterior: existente.precioVenta ?? 0, nuevo: art.precioVenta };
      }
      if (Math.round(art.stockTotal) !== Math.round(existente.stockTotal ?? 0)) {
        cambios.stockTotal = { anterior: existente.stockTotal ?? 0, nuevo: art.stockTotal };
      }
      if (art.descripcion && art.descripcion !== existente.descripcion) {
        cambios.descripcion = { anterior: existente.descripcion || "", nuevo: art.descripcion };
      }
      if (art.iva && art.iva !== existente.iva) {
        cambios.iva = { anterior: existente.iva ?? null, nuevo: art.iva };
      }
      if (Object.keys(cambios).length === 0) {
        sinCambios++;
        continue;
      }
      actualizados.push({
        productoId: existente.id,
        sku: existente.sku,
        descripcion: existente.descripcion,
        marcaNombre: existente.marcaNombre || art.marcaNombre || null,
        cambios,
      });
    }

    return { actualizados, nuevos, sinCambios, totalGbp: catalogoGbp.length, totalDelfino: productosSnap.size };
  }
);

// datos: { items: [{ productoId, sku, marcaNombre, cambios: { precioVenta?, stockTotal?, descripcion?, iva? } }] }
// (misma forma que devuelve gbpPreviewArticulos en `actualizados` — el cliente reenvía los que el
// usuario dejó tildados, sin volver a pedirle nada más).
exports.gbpAplicarArticulos = onCall(
  { region: "southamerica-east1", secrets: gbp.GBP_SECRETS, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    const db = await requireAdmin(request);
    const items = request.data?.items;
    if (!Array.isArray(items) || items.length === 0) throw new HttpsError("invalid-argument", "No hay nada para aplicar.");

    let batch = db.batch();
    let enLote = 0;
    let aplicados = 0;
    for (const item of items) {
      const cambios = {};
      if (item.cambios?.precioVenta) cambios.precioVenta = item.cambios.precioVenta.nuevo;
      if (item.cambios?.stockTotal) cambios.stockTotal = item.cambios.stockTotal.nuevo;
      if (item.cambios?.iva) cambios.iva = item.cambios.iva.nuevo;
      if (item.cambios?.descripcion) {
        cambios.descripcion = item.cambios.descripcion.nuevo;
        cambios.searchKeywords = searchKeywordsPara(item.sku, item.cambios.descripcion.nuevo, item.marcaNombre);
      }
      if (Object.keys(cambios).length === 0) continue;
      cambios.modificadoEn = admin.firestore.FieldValue.serverTimestamp();
      cambios.modificadoPor = request.auth.uid;
      batch.set(db.collection("productos").doc(item.productoId), cambios, { merge: true });
      enLote++;
      aplicados++;
      if (enLote >= 400) {
        await batch.commit();
        batch = db.batch();
        enLote = 0;
      }
    }
    if (enLote > 0) await batch.commit();
    return { aplicados };
  }
);
