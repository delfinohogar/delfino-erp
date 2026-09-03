// Reconciliación de catálogo Delfino <-> Tiendanube — wrapper de las Cloud Functions en
// functions/tiendanubeCatalogo.js. Todo pasa por acá para que el token de Tiendanube nunca toque
// el navegador (mismo criterio que js/mercado-pago.js y js/arca-facturacion.js).
import { functions, httpsCallable } from "./firebase.js";

export async function reconciliarCatalogoTiendaNube() {
  const fn = httpsCallable(functions, "tnReconciliarCatalogo");
  const res = await fn({});
  return res.data;
}

export async function vincularProductosTiendaNube(items) {
  const fn = httpsCallable(functions, "tnVincularProductos");
  const res = await fn({ items });
  return res.data;
}

export async function actualizarStockDesdeTiendaNube(items) {
  const fn = httpsCallable(functions, "tnActualizarStock");
  const res = await fn({ items });
  return res.data;
}

export async function importarProductosDesdeTiendaNube(items, ivaPorDefecto) {
  const fn = httpsCallable(functions, "tnImportarProductos");
  const res = await fn({ items, ivaPorDefecto });
  return res.data;
}

export async function importarImagenesDesdeTiendaNube(items) {
  const fn = httpsCallable(functions, "tnImportarImagenes");
  const res = await fn({ items });
  return res.data;
}
