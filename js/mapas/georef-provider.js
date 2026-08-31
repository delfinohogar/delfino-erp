// Proveedor de mapas: API Georef (IGN / datos.gob.ar) — pública, gratis, sin API key.
// Implementa la parte de geocodificación/coordenadas de la interfaz de motor-mapas.js.
// No ofrece distancias, tiempos, rutas ni optimización — eso queda sin proveedor hasta conectar
// uno que sí los tenga (ver motor-mapas.js).
//
// Este archivo es el ÚNICO lugar del proyecto que debería conocer la forma particular de la API
// de Georef — nada fuera de /js/mapas debería importarlo directo.
const GEOREF_URL = "https://apis.datos.gob.ar/georef/api/direcciones";

// Nombres más largos/específicos primero: "Ciudad Autónoma de Buenos Aires" contiene "Buenos Aires"
// como subcadena, así que hay que probarla (y sus variantes) antes que la provincia "Buenos Aires" sola.
const PROVINCIAS = [
  { nombre: "Ciudad Autónoma de Buenos Aires", alias: ["ciudad autónoma de buenos aires", "caba", "capital federal"] },
  { nombre: "Buenos Aires", alias: ["buenos aires"] },
  { nombre: "Catamarca", alias: ["catamarca"] },
  { nombre: "Chaco", alias: ["chaco"] },
  { nombre: "Chubut", alias: ["chubut"] },
  { nombre: "Córdoba", alias: ["córdoba", "cordoba"] },
  { nombre: "Corrientes", alias: ["corrientes"] },
  { nombre: "Entre Ríos", alias: ["entre ríos", "entre rios"] },
  { nombre: "Formosa", alias: ["formosa"] },
  { nombre: "Jujuy", alias: ["jujuy"] },
  { nombre: "La Pampa", alias: ["la pampa"] },
  { nombre: "La Rioja", alias: ["la rioja"] },
  { nombre: "Mendoza", alias: ["mendoza"] },
  { nombre: "Misiones", alias: ["misiones"] },
  { nombre: "Neuquén", alias: ["neuquén", "neuquen"] },
  { nombre: "Río Negro", alias: ["río negro", "rio negro"] },
  { nombre: "Salta", alias: ["salta"] },
  { nombre: "San Juan", alias: ["san juan"] },
  { nombre: "San Luis", alias: ["san luis"] },
  { nombre: "Santa Cruz", alias: ["santa cruz"] },
  { nombre: "Santa Fe", alias: ["santa fe"] },
  { nombre: "Santiago del Estero", alias: ["santiago del estero"] },
  { nombre: "Tierra del Fuego", alias: ["tierra del fuego"] },
  { nombre: "Tucumán", alias: ["tucumán", "tucuman"] },
];

// Si el usuario ya escribió la provincia como parte del domicilio (ej. "Mitre 500, Quilmes,
// Buenos Aires"), usar eso para desambiguar es más confiable que cualquier sugerencia externa —
// hay cientos de calles con el mismo nombre repetidas por todo el país.
function detectarProvinciaEnTexto(texto) {
  const t = texto.toLowerCase();
  for (const { nombre, alias } of PROVINCIAS) {
    if (alias.some((a) => t.includes(a))) return nombre;
  }
  return null;
}

// texto: dirección libre (ej. "Mitre 500, Quilmes"). provinciaSugerida: opcional, se usa solo si
// el texto no menciona ninguna provincia por su cuenta.
// Devuelve { direccionNormalizada, lat, lon, cantidadCoincidencias } o null si no hay resultado.
// Es un atajo de buscarCandidatos() quedándose con el primero — para cuando no hace falta que el
// usuario elija (ej. re-normalizar algo que ya se había confirmado antes).
export async function geocodificar(texto, contexto = {}) {
  const { candidatos, total } = await buscarCandidatos(texto, contexto, 1);
  if (!candidatos.length) return null;
  return { ...candidatos[0], cantidadCoincidencias: total };
}

// Devuelve hasta "cantidad" candidatos (no solo el primero) para que el usuario elija cuál es el
// correcto cuando el nombre de calle se repite — como pasa seguido en el conurbano bonaerense.
// { candidatos: [{direccionNormalizada, lat, lon}], total } — total es la cantidad real que
// existe en el país (puede ser mayor a "cantidad" si hay más de las que se pidieron).
export async function buscarCandidatos(texto, { provincia: provinciaSugerida } = {}, cantidad = 5) {
  if (!texto?.trim()) return { candidatos: [], total: 0 };
  const params = new URLSearchParams({ direccion: texto.trim(), max: String(cantidad) });
  const provincia = detectarProvinciaEnTexto(texto) || provinciaSugerida;
  if (provincia) params.set("provincia", provincia);

  const res = await fetch(`${GEOREF_URL}?${params}`);
  if (!res.ok) throw new Error(`Georef respondió ${res.status}`);
  const data = await res.json();

  const candidatos = (data.direcciones || []).map((d) => ({
    direccionNormalizada: d.nomenclatura,
    lat: d.ubicacion?.lat ?? null,
    lon: d.ubicacion?.lon ?? null,
  }));
  return { candidatos, total: data.total ?? candidatos.length };
}
