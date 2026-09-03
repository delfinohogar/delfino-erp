// Utilidades chicas de formateo/indexado de texto libre (domicilios, nombres, etc.) — nada
// específico de un dominio (antes vivían duplicadas en cada archivo que las necesitaba).
const PALABRAS_MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "en", "al"]);

// Separa en palabras (sin acentos ni puntuación) para indexar por término, no por frase completa —
// misma función que ya usaba solo js/productos.js, ahora compartida (ver camposBusquedaTexto acá
// abajo y buscarClientesPorNombre en js/clientes.js).
export function tokenizar(texto) {
  return (texto || "")
    .toString()
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñ]+/i)
    .filter(Boolean);
}

// Prefijos de una palabra desde 2 letras hasta la palabra completa (ej. "hepa" -> "he","hep","hepa"),
// para poder buscar por "empieza con" sobre cada palabra individual, no solo sobre el string entero.
export function generarPrefijos(palabra) {
  const prefijos = [];
  for (let i = Math.min(2, palabra.length); i <= palabra.length; i++) {
    prefijos.push(palabra.slice(0, i));
  }
  return prefijos;
}

// Índice de búsqueda por palabra suelta, en cualquier orden — junta las palabras (y sus prefijos) de
// cada texto que se le pase en un solo array searchKeywords. "SARAVIA BARBARA" queda buscable
// escribiendo "barbara" o "barbara s", sin que importe qué palabra viene primero (ver camposBusqueda
// en js/productos.js para el mismo criterio aplicado a sku/descripción/marca).
export function keywordsDeTextos(...textos) {
  const keywords = new Set();
  textos.forEach((texto) => tokenizar(texto).forEach((p) => generarPrefijos(p).forEach((pre) => keywords.add(pre))));
  return Array.from(keywords);
}

// "mitre 500, quilmes oeste" -> "Mitre 500, Quilmes Oeste" (conectores como "de"/"del" quedan en
// minúscula salvo que sean la primera palabra, como es la convención habitual en español).
export function capitalizarDireccion(texto) {
  if (!texto) return texto;
  return texto
    .toLowerCase()
    .split(" ")
    .map((palabra, i) => {
      if (!palabra) return palabra;
      if (i > 0 && PALABRAS_MINUSCULAS.has(palabra)) return palabra;
      return palabra.charAt(0).toUpperCase() + palabra.slice(1);
    })
    .join(" ");
}
