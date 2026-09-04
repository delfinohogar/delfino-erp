// Utilidades chicas de indexado de texto libre — mismo criterio que js/texto.js (SDK cliente), acá
// duplicado para el SDK admin (antes vivía copiado suelto en gbpArticulos.js y otra vez en
// gbpClientes.js; ahora las dos lo importan de acá).
// Mismo criterio que normalizarTexto en js/texto.js (SDK cliente): minúsculas + sin acentos/diéresis
// (NFD separa la letra de su marca, se descarta la marca) — "ü"/"ñ" quedan como su letra base "u"/"n",
// a propósito, para que buscar sin tilde encuentre igual (antes "AGÜERO" se cortaba en "ag"+"ero" acá
// también, mismo bug que del lado cliente).
function normalizarTexto(v) {
  return (v || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function tokenizar(texto) {
  return normalizarTexto(texto).split(/[^a-z0-9]+/i).filter(Boolean);
}

function generarPrefijos(palabra) {
  const prefijos = [];
  for (let i = Math.min(2, palabra.length); i <= palabra.length; i++) prefijos.push(palabra.slice(0, i));
  return prefijos;
}

// Índice de búsqueda por palabra suelta, en cualquier orden — junta las palabras (y sus prefijos) de
// todos los textos que se le pasen en un solo array searchKeywords.
function keywordsDeTextos(...textos) {
  const keywords = new Set();
  textos.forEach((texto) => tokenizar(texto).forEach((p) => generarPrefijos(p).forEach((pre) => keywords.add(pre))));
  return Array.from(keywords);
}

module.exports = { tokenizar, generarPrefijos, keywordsDeTextos, normalizarTexto };
