// Reconciliación de catálogo Delfino <-> Tiendanube, por SKU — SOLO LECTURA hasta que un admin
// elige explícitamente qué aplicar desde la pantalla de previsualización (productos/tiendanube-
// catalogo.js). Ninguna de estas funciones escribe nada en Tiendanube — todo lo que "se aplica" es
// siempre una escritura hacia Delfino (crear producto, vincular, actualizar stock), nunca al revés
// (ver la restricción explícita del pedido: "conectar sin cambiar stock ni precios [de Tiendanube]").
//
// Precio: Tiendanube muestra precio de LISTA (sin el descuento por efectivo/transferencia que sí
// tiene producto.precioVenta en Delfino — confirmado a mano cruzando ambos catálogos el 02/09/2026,
// coincide con cashDiscountFactor de gbp-tiendanube-sync/config.js). Por eso esta reconciliación
// NUNCA propone actualizar precio automáticamente — solo lo deja listado como diagnóstico.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

const accessToken = defineSecret("TIENDANUBE_ACCESS_TOKEN");

// Firestore no acepta más de 500 escrituras por batch — "vincular" en particular puede superar
// eso (hasta 741 en el catálogo actual). commitEnTandas junta varios batches chicos en vez de uno
// solo gigante que reventaría a mitad de camino.
async function commitEnTandas(db, items, escribirItem) {
  const TAMANO_TANDA = 400; // margen bajo 500 por si escribirItem hace más de un write por item
  for (let i = 0; i < items.length; i += TAMANO_TANDA) {
    const batch = db.batch();
    items.slice(i, i + TAMANO_TANDA).forEach((it) => escribirItem(batch, it));
    await batch.commit();
  }
}
const STORE_ID = "4363883";
const API_BASE = `https://api.tiendanube.com/2025-03/${STORE_ID}`;
const USER_AGENT = "Delfino ERP (gasti.delfino@gmail.com)";

async function obtenerCatalogoTiendaNube(token) {
  const variantes = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API_BASE}/products?per_page=200&page=${page}&fields=id,name,variants,images`, {
      headers: { Authentication: `bearer ${token}`, "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al listar productos.`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const p of data) {
      // La imagen es del PRODUCTO, no de la variante — todas las variantes de un mismo producto
      // comparten el mismo set de fotos. position más baja = principal (convención de Tiendanube).
      const imagenes = [...(p.images || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const imagenPrincipal = imagenes[0] || null;
      for (const v of p.variants || []) {
        if (!v.sku) continue; // sin SKU no hay con qué vincular — se ignora, no se inventa uno
        variantes.push({
          sku: v.sku,
          idExternoProducto: String(p.product_id ?? p.id),
          idExternoVariante: String(v.id),
          nombre: p.name?.es || "",
          precio: Number(v.price) || 0,
          stock: v.stock ?? 0,
          imagenUrl: imagenPrincipal?.src || null,
          imagenIdExterno: imagenPrincipal ? String(imagenPrincipal.id) : null,
        });
      }
    }
    if (data.length < 200) break;
    page++;
  }
  return variantes;
}

// Grupos de descuento conocidos (ver cabecera) — solo para separar "diferencia esperable" de
// "anomalía real" en el reporte. Tolerancia amplia (1%) porque el precio de Tiendanube viene
// redondeado a 2 decimales sobre una división, no es exacto centavo a centavo.
const FACTORES_CONOCIDOS = [0.7, 0.933333];
function esDiferenciaEsperada(precioDelfino, precioTiendaNube) {
  if (!precioDelfino) return false;
  const ratio = precioTiendaNube / precioDelfino;
  return FACTORES_CONOCIDOS.some((f) => Math.abs(ratio - 1 / f) < 0.05);
}

exports.tnReconciliarCatalogo = onCall({ region: "southamerica-east1", secrets: [accessToken], timeoutSeconds: 60, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfil.data()?.rol !== "administrador") throw new HttpsError("permission-denied", "Solo un administrador puede reconciliar el catálogo.");

  const [variantesTn, productosSnap] = await Promise.all([
    obtenerCatalogoTiendaNube(accessToken.value()),
    db.collection("productos").get(),
  ]);

  const delfinoPorSku = new Map();
  productosSnap.docs.forEach((d) => {
    const p = d.data();
    if (!p.sku) return;
    const tieneImagenActiva = (p.imagenes || []).some((img) => img.estado === "activa");
    delfinoPorSku.set(p.sku, {
      productoId: d.id,
      precioVenta: p.precioVenta ?? 0,
      stockTotal: p.stockTotal ?? 0,
      descripcion: p.descripcion || "",
      vinculado: p.tiendaNube?.idExterno || null,
      tieneImagenActiva,
    });
  });

  const variantesTnPorSku = new Map(variantesTn.map((v) => [v.sku, v]));

  const coincidentesConDiffStock = [];
  const preciosAnomalos = [];
  const soloEnTiendaNube = [];
  const sinImagen = [];
  const skusVistosTn = new Set();

  for (const v of variantesTn) {
    skusVistosTn.add(v.sku);
    const d = delfinoPorSku.get(v.sku);
    if (!d) {
      soloEnTiendaNube.push(v);
      continue;
    }
    if (v.stock !== d.stockTotal) {
      coincidentesConDiffStock.push({ sku: v.sku, productoId: d.productoId, nombre: v.nombre || d.descripcion, stockDelfino: d.stockTotal, stockTiendaNube: v.stock });
    }
    const precioTnRedondeado = Math.round(v.precio);
    if (precioTnRedondeado !== d.precioVenta && !esDiferenciaEsperada(d.precioVenta, v.precio)) {
      preciosAnomalos.push({ sku: v.sku, nombre: v.nombre || d.descripcion, precioDelfino: d.precioVenta, precioTiendaNube: precioTnRedondeado });
    }
    if (!d.tieneImagenActiva && v.imagenUrl) {
      sinImagen.push({ sku: v.sku, productoId: d.productoId, nombre: v.nombre || d.descripcion, imagenUrl: v.imagenUrl, imagenIdExterno: v.imagenIdExterno });
    }
  }

  const soloEnDelfino = [];
  const vinculables = [];
  for (const [sku, d] of delfinoPorSku) {
    if (!skusVistosTn.has(sku)) {
      soloEnDelfino.push({ sku, productoId: d.productoId, nombre: d.descripcion });
    } else if (!d.vinculado) {
      const v = variantesTnPorSku.get(sku);
      vinculables.push({ sku, productoId: d.productoId, idExternoVariante: v.idExternoVariante, idExternoProducto: v.idExternoProducto, nombre: d.descripcion });
    }
  }

  return {
    totales: { delfino: delfinoPorSku.size, tiendaNube: variantesTn.length, coincidentes: variantesTn.length - soloEnTiendaNube.length },
    vinculables,
    soloEnTiendaNube,
    soloEnDelfino,
    diffsStock: coincidentesConDiffStock,
    preciosAnomalos,
    sinImagen,
    generadoEn: new Date().toISOString(),
  };
});

// --- Acciones de aplicación (siempre elegidas a mano, nunca automáticas) -------------------------

// items: [{ productoId, idExternoVariante, idExternoProducto }]
exports.tnVincularProductos = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfil.data()?.rol !== "administrador") throw new HttpsError("permission-denied", "Solo un administrador puede vincular productos.");

  const { items } = request.data || {};
  if (!Array.isArray(items) || items.length === 0) throw new HttpsError("invalid-argument", "Faltan items para vincular.");

  await commitEnTandas(db, items, (batch, it) => {
    batch.update(db.collection("productos").doc(it.productoId), {
      tiendaNube: {
        vinculado: true,
        idExterno: it.idExternoVariante,
        idExternoProducto: it.idExternoProducto,
        vinculadoEn: admin.firestore.FieldValue.serverTimestamp(),
        vinculadoPor: request.auth.uid,
      },
    });
  });
  return { ok: true, vinculados: items.length };
});

// items: [{ productoId, stockNuevo }]
exports.tnActualizarStock = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfil.data()?.rol !== "administrador") throw new HttpsError("permission-denied", "Solo un administrador puede actualizar stock en lote.");

  const { items } = request.data || {};
  if (!Array.isArray(items) || items.length === 0) throw new HttpsError("invalid-argument", "Faltan items para actualizar.");

  const ahora = admin.firestore.FieldValue.serverTimestamp();
  await commitEnTandas(db, items, (batch, it) => {
    const ref = db.collection("productos").doc(it.productoId);
    batch.update(ref, { stockTotal: it.stockNuevo, modificadoPor: request.auth.uid, modificadoEn: ahora });
    batch.set(ref.collection("logAuditoria").doc(), {
      campo: "stockTotal",
      valorNuevo: it.stockNuevo,
      usuario: request.auth.uid,
      fecha: ahora,
      productoId: it.productoId,
      motivo: "Reconciliación de catálogo Tienda Nube",
    });
  });
  return { ok: true, actualizados: items.length };
});

// items: [{ sku, nombre, precio, stock, idExternoVariante, idExternoProducto }], ivaPorDefecto: 21|10.5|...
exports.tnImportarProductos = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfil.data()?.rol !== "administrador") throw new HttpsError("permission-denied", "Solo un administrador puede importar productos.");

  const { items, ivaPorDefecto } = request.data || {};
  if (!Array.isArray(items) || items.length === 0) throw new HttpsError("invalid-argument", "Faltan items para importar.");
  if (!(Number(ivaPorDefecto) >= 0)) throw new HttpsError("invalid-argument", "Falta el IVA por defecto para los productos nuevos.");

  // Chequeo de SKU duplicado justo antes de escribir — si alguien ya cargó ese SKU a mano entre la
  // previsualización y este click, no se pisa ni se duplica: se informa y se sigue con el resto.
  // Firestore "in" acepta como mucho 30 valores por consulta, así que se parte en tandas.
  const skusExistentes = new Set();
  const todosLosSkus = items.map((i) => i.sku);
  for (let i = 0; i < todosLosSkus.length; i += 30) {
    const tanda = todosLosSkus.slice(i, i + 30);
    const snap = await db.collection("productos").where("sku", "in", tanda).get();
    snap.docs.forEach((d) => skusExistentes.add(d.data().sku));
  }

  const ahora = admin.firestore.FieldValue.serverTimestamp();
  const omitidos = items.filter((it) => skusExistentes.has(it.sku)).map((it) => it.sku);
  const aCrear = items.filter((it) => !skusExistentes.has(it.sku));

  await commitEnTandas(db, aCrear, (batch, it) => {
    const ref = db.collection("productos").doc();
    batch.set(ref, {
      sku: it.sku,
      descripcion: it.nombre || `Producto ${it.sku}`,
      // Tiendanube no informa costo ni margen — quedan en null/0 a propósito, no se inventan.
      costoReferencia: null,
      iva: Number(ivaPorDefecto),
      precioVenta: Math.round(it.precio),
      stockTotal: it.stock,
      activo: true,
      tiendaNube: {
        vinculado: true,
        idExterno: it.idExternoVariante,
        idExternoProducto: it.idExternoProducto,
        vinculadoEn: ahora,
        vinculadoPor: request.auth.uid,
      },
      fuenteDatos: "tienda_nube",
      creadoPor: request.auth.uid,
      creadoEn: ahora,
      modificadoPor: request.auth.uid,
      modificadoEn: ahora,
    });
  });
  return { ok: true, creados: aCrear.length, omitidosPorSkuExistente: omitidos };
});

// Trae la imagen principal de Tienda Nube SOLO para productos que hoy no tienen ninguna imagen
// activa en Delfino — nunca pisa una imagen manual (ver imagenPrincipal en js/producto-imagenes.js:
// una manual siempre gana si existe, así que esto ni siquiera haría falta filtrarlo por seguridad,
// pero evita hacer trabajo de más). Mismo shape de imagen que agregarImagenManual, con
// origen:"tienda_nube" e identificadorExterno = el id de la imagen en Tiendanube.
//
// items: [{ productoId, imagenUrl, imagenIdExterno }]
exports.tnImportarImagenes = onCall({ region: "southamerica-east1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  const db = admin.firestore();
  const perfil = await db.collection("usuarios").doc(request.auth.uid).get();
  if (perfil.data()?.rol !== "administrador") throw new HttpsError("permission-denied", "Solo un administrador puede importar imágenes en lote.");

  const { items } = request.data || {};
  if (!Array.isArray(items) || items.length === 0) throw new HttpsError("invalid-argument", "Faltan items para importar.");

  const ahora = new Date(); // no serverTimestamp() — no se puede dentro de un elemento de array, ver producto-imagenes.js
  let importadas = 0;
  const omitidos = [];
  // No es un batch: cada producto necesita su propio read-modify-write del array "imagenes" (no se
  // puede escribir a ciegas sin releer, para no pisar una imagen manual que se haya cargado justo
  // entre la previsualización y este click — mismo motivo que el chequeo de SKU en tnImportarProductos).
  for (const it of items) {
    const ref = db.collection("productos").doc(it.productoId);
    const snap = await ref.get();
    if (!snap.exists) {
      omitidos.push({ productoId: it.productoId, motivo: "no existe" });
      continue;
    }
    const imagenesActuales = snap.data().imagenes || [];
    if (imagenesActuales.some((img) => img.estado === "activa")) {
      omitidos.push({ productoId: it.productoId, motivo: "ya tiene una imagen (se cargó después de la previsualización)" });
      continue;
    }
    await ref.update({
      imagenes: [
        ...imagenesActuales,
        {
          id: crypto.randomUUID(),
          origen: "tienda_nube",
          url: it.imagenUrl,
          principal: true,
          orden: 0,
          identificadorExterno: it.imagenIdExterno,
          estado: "activa",
          creadoEn: ahora,
          actualizadoEn: ahora,
        },
      ],
      modificadoPor: request.auth.uid,
      modificadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
    importadas++;
  }
  return { ok: true, importadas, omitidos };
});
