// Utilidades chicas de formateo de texto libre (domicilios, etc.) — nada específico de un dominio.
const PALABRAS_MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "en", "al"]);

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
