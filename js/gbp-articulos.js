// Sincronización de precio/stock/descripción/IVA del catálogo con GBP — preview-antes-de-aplicar,
// mismo patrón que la reconciliación de Tiendanube y gbpPreviewVincularClientes. No crea productos
// nuevos (ver functions/gbpArticulos.js): los que GBP tiene y Delfino no, se listan aparte.
import { functions, httpsCallable } from "./firebase.js";

export async function previewArticulosGbp() {
  const fn = httpsCallable(functions, "gbpPreviewArticulos", { timeout: 280000 });
  const res = await fn();
  return res.data;
}

// items: el array `actualizados` (o un subconjunto) que devolvió previewArticulosGbp — se reenvía
// tal cual, sin que el cliente tenga que reconstruir nada.
export async function aplicarArticulosGbp(items) {
  const fn = httpsCallable(functions, "gbpAplicarArticulos", { timeout: 280000 });
  const res = await fn({ items });
  return res.data;
}
