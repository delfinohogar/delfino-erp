// Historial de facturas de GBP ya sincronizado a Firestore (colección facturasGbp, solo lectura —
// la escribe únicamente functions/gbpFacturas.js). Ver productos/facturas-gbp.js para la pantalla.
import { db, collection, query, where, orderBy, limit, getDocs, functions, httpsCallable } from "./firebase.js";

export async function listarFacturasGbp(maxResultados = 3000) {
  const snap = await getDocs(query(collection(db, "facturasGbp"), orderBy("fecha", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Para la sección "Historial de compras GBP" de Cuenta Corriente de Clientes — requiere que el
// cliente ya esté vinculado (clientes.identificadorExterno, ver gbpVincularClientes).
export async function listarFacturasGbpPorCliente(clienteId) {
  const snap = await getDocs(query(collection(db, "facturasGbp"), where("clienteId", "==", clienteId), orderBy("fecha", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Trae (y guarda en Firestore) las facturas emitidas en GBP dentro de la ventana que tengan
// configuradas las consultas "Delfino - Facturas Encabezado/Líneas" en GBP — hoy son los últimos
// 90 días, se puede ampliar editando esas consultas directo en GBP, sin tocar este código.
export async function sincronizarFacturasGbp() {
  const fn = httpsCallable(functions, "gbpSincronizarFacturas");
  const res = await fn();
  return res.data;
}

// Trae qué se vincularía SIN escribir nada — mismo patrón que la reconciliación de Tiendanube:
// siempre se previsualiza antes de aplicar. Devuelve { vinculaciones, fichasNuevas, totales... }.
export async function previewVincularClientesGbp() {
  // Recorre los 31.000+ clientes de GBP paginados — más de los 70s que el SDK espera por defecto.
  const fn = httpsCallable(functions, "gbpPreviewVincularClientes", { timeout: 280000 });
  const res = await fn();
  return res.data;
}

// Aplica lo que ya se previsualizó (y el admin confirmó) — no vuelve a consultar GBP, solo escribe
// las listas que se le pasan.
export async function aplicarVincularClientesGbp({ vinculaciones, fichasNuevas }) {
  const fn = httpsCallable(functions, "gbpAplicarVincularClientes");
  const res = await fn({ vinculaciones, fichasNuevas });
  return res.data;
}

// Fichas livianas de clientes de GBP (nombre/CUIT/domicilio) que no son clientes operativos de
// Delfino — solo existen para poder mostrar un nombre real en vez de "Cliente GBP #12345" en
// reportes como Top Clientes. Las crea gbpVincularClientes.
export async function listarClientesGbpLiviano() {
  const snap = await getDocs(collection(db, "clientesGbp"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
