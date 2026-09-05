// Aritmética del IVA en centavos ENTEROS, calculada por una vía independiente de la
// implementación que se está probando.
//
// Por qué no `Number`: 1000.01 / 1.21 en punto flotante puede caer del lado equivocado de
// un medio centavo y el test estaría verificando el redondeo de IEEE-754, no el de
// PostgreSQL. Acá todo se hace con BigInt sobre centavos, así que el resultado es exacto y
// no depende de la plataforma.
//
// Semántica replicada: `round(numeric, 2)` de PostgreSQL redondea MEDIO HACIA AFUERA DEL
// CERO (half away from zero), igual que `Math.round` para positivos. No es banquero.

/** round(num/den) con num, den > 0, medio hacia arriba. Exacto. */
function dividirRedondeando(num, den) {
  return (2n * num + den) / (2n * den);
}

/**
 * IVA de una línea, en centavos enteros.
 * El precio YA incluye el IVA: iva = subtotal − subtotal/(1+a/100) = subtotal·a/(100+a).
 * `alicuota` puede tener un decimal (10,5), así que se trabaja con a·10 para no salir de
 * los enteros: a/(100+a) = (a·10)/(1000+a·10).
 * Alícuota 0 ⇒ IVA 0 (no se asume 21: eso lo hace `crear_venta` cuando NO viene alícuota).
 */
export function ivaCentavos(subtotalCentavos, alicuota) {
  const a10 = BigInt(Math.round(alicuota * 10));
  if (a10 === 0n) return 0n;
  return dividirRedondeando(BigInt(subtotalCentavos) * a10, 1000n + a10);
}

/** Neto de una línea, en centavos: round(subtotal/(1+a/100)). Solo para el análisis de R20. */
export function netoCentavos(subtotalCentavos, alicuota) {
  const a10 = BigInt(Math.round(alicuota * 10));
  const c = BigInt(subtotalCentavos);
  if (a10 === 0n) return c;
  return dividirRedondeando(c * 1000n, 1000n + a10);
}

/** subtotal de una línea = round(cantidad · precio · (1 − desc/100), 2), en centavos. */
export function subtotalCentavos({ cantidad, precio_unitario, descuento_pct = 0 }) {
  // precio y descuento con 2 decimales; cantidad con hasta 3. Se escala todo a enteros.
  const precio = BigInt(Math.round(precio_unitario * 100)); // centavos
  const cant = BigInt(Math.round(cantidad * 1000)); // milésimas
  const desc = BigInt(Math.round(descuento_pct * 100)); // centésimas de %
  // total en centavos = precio · cant/1000 · (10000 − desc)/10000
  const num = precio * cant * (10000n - desc);
  const den = 1000n * 10000n;
  return dividirRedondeando(num, den);
}

/** Criterio APROBADO (decisión Nivel 3 del 2026-09-04): redondear por línea y después sumar. */
export function ivaTotalSumaDeRedondeados(lineas) {
  let acc = 0n;
  for (const l of lineas) acc += ivaCentavos(subtotalCentavos(l), l.alicuota);
  return acc;
}

/** Criterio RECHAZADO: sumar sin redondear y redondear al final. Existe para poder mostrar
 *  que da OTRO valor y que el test distingue uno del otro. */
export function ivaTotalRedondeoAlFinal(lineas) {
  // Suma exacta como fracción: Σ subtotal_i·a_i/(100+a_i)
  let num = 0n;
  let den = 1n;
  for (const l of lineas) {
    const a10 = BigInt(Math.round(l.alicuota * 10));
    if (a10 === 0n) continue;
    const n = subtotalCentavos(l) * a10;
    const d = 1000n + a10;
    num = num * d + n * den;
    den = den * d;
  }
  return dividirRedondeando(num, den);
}

export const aPesos = (centavos) => Number(centavos) / 100;
