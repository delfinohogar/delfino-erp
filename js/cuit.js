// Normalización y validación de CUIT/CUIL argentino, más ayuda para cuando lo que se tiene es
// un DNI: deriva los CUIT probables (persona física) para buscarlos en el padrón de ARCA.
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

// Prefijos de persona física más comunes: 20 (M), 23/24 (casos especiales), 27 (F).
const PREFIJOS_PERSONA_FISICA = [
  { prefijo: "20", etiqueta: "20 — Masculino" },
  { prefijo: "27", etiqueta: "27 — Femenino" },
  { prefijo: "23", etiqueta: "23 — Otro" },
  { prefijo: "24", etiqueta: "24 — Otro" },
];

export function soloDigitos(valor) {
  return (valor || "").toString().replace(/\D/g, "");
}

// Recibe los primeros 10 dígitos (prefijo + DNI) y devuelve el dígito verificador (0-9),
// o null si esa combinación no da un CUIT válido según el algoritmo de AFIP/ARCA.
export function calcularDigitoVerificador(cuit10) {
  if (!/^\d{10}$/.test(cuit10)) return null;
  const suma = cuit10
    .split("")
    .reduce((acc, digito, i) => acc + Number(digito) * PESOS[i], 0);
  const resto = suma % 11;
  const verificador = 11 - resto;
  if (verificador === 11) return 0;
  if (verificador === 10) return null; // no existe CUIT válido para esta base
  return verificador;
}

export function validarCuit(valor) {
  const digitos = soloDigitos(valor);
  if (digitos.length !== 11) return false;
  const dv = calcularDigitoVerificador(digitos.slice(0, 10));
  return dv !== null && dv === Number(digitos[10]);
}

export function formatearCuit(valor) {
  const d = soloDigitos(valor).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

// dni: 7 u 8 dígitos. Devuelve los CUIT probables (formateados) para cada prefijo de persona física.
export function cuitsPosiblesDesdeDni(dni) {
  const d = soloDigitos(dni).padStart(8, "0");
  if (d.length !== 8) return [];
  return PREFIJOS_PERSONA_FISICA.map(({ prefijo, etiqueta }) => {
    const base = prefijo + d;
    const dv = calcularDigitoVerificador(base);
    if (dv === null) return null;
    const cuit = base + dv;
    return { etiqueta, cuit, formateado: formatearCuit(cuit) };
  }).filter(Boolean);
}
