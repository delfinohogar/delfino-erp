// Motor de Mapas — capa de abstracción sobre el/los proveedor(es) de mapas y geolocalización.
// El resto de la app (Clientes hoy, Logística/Reparto más adelante) llama SOLO a las funciones
// de este archivo, nunca a un proveedor puntual (Georef, Google, Mapbox, OSRM, etc.) directamente.
// Así, cambiar de proveedor el día de mañana es cambiar este archivo — no reescribir Logística.
//
// Proveedor actual: Georef (IGN / datos.gob.ar), público y sin costo — ver /js/mapas/georef-provider.js.
// Cubre geocodificación/validación/coordenadas para direcciones argentinas. Distancias, tiempos,
// rutas y optimización todavía no tienen proveedor conectado (Georef no los ofrece): quedan
// definidos acá para que el resto de la app ya pueda integrarse contra esta interfaz, y se
// completan el día que se conecte un proveedor que sí los tenga (ej. OSRM, Google Routes, Mapbox).
import * as georef from "./mapas/georef-provider.js";

function noImplementado(nombre) {
  throw new Error(`${nombre}: todavía no hay un proveedor de mapas conectado que ofrezca esto.`);
}

// --- Geocodificación / coordenadas ---

// direccion: texto libre. contexto: { provincia } opcional, para desambiguar si el texto no
// menciona una provincia por su cuenta.
// Devuelve { direccionNormalizada, lat, lon, cantidadCoincidencias } o null si no se encontró.
export async function geocodificar(direccion, contexto = {}) {
  return georef.geocodificar(direccion, contexto);
}

// Como los nombres de calle se repiten mucho (todo el conurbano tiene una "Mitre", una "San
// Martín", etc.), esto devuelve varias opciones para que el usuario elija la correcta en vez de
// quedarse con la primera que responda el proveedor.
export async function buscarCandidatosDireccion(direccion, contexto = {}, cantidad = 5) {
  return georef.buscarCandidatos(direccion, contexto, cantidad);
}

// --- Validación de direcciones ---

// Hoy es la misma consulta que geocodificar: si el proveedor devuelve un resultado, se considera
// una dirección válida. El día que haya un proveedor con validación real (autocorrección de
// errores tipográficos, sugerencias, etc.) esta es la función que cambia — el resto de la app no.
export async function validarDireccion(direccion, contexto = {}) {
  const resultado = await geocodificar(direccion, contexto);
  return { valida: Boolean(resultado), ...resultado };
}

// --- Distancias / tiempos / rutas / optimización (sin proveedor conectado todavía) ---

// origen/destino: { lat, lon }. Devolvería { metros, texto }.
export async function calcularDistancia(origen, destino) {
  noImplementado("calcularDistancia");
}

// Devolvería { segundos, texto }.
export async function calcularTiempo(origen, destino) {
  noImplementado("calcularTiempo");
}

// paradas: [{ lat, lon }, ...]. Devolvería la ruta (polilínea, distancia y tiempo totales).
export async function calcularRuta(paradas) {
  noImplementado("calcularRuta");
}

// paradas: [{ lat, lon }, ...]. Para cuando haya que ordenar varias entregas de reparto de la
// forma más eficiente — no todo proveedor lo ofrece, de ahí el "cuando corresponda".
export async function optimizarRuta(paradas) {
  noImplementado("optimizarRuta");
}

// --- Mapas (visualización) ---

// URL pública para ver un punto en el mapa (sirve para un link "Ver en el mapa"). OpenStreetMap
// no requiere key; el día que haya Google Maps conectado, este es el único lugar que cambia.
export function urlMapa(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}
