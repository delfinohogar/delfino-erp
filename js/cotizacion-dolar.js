// Cotización oficial del dólar — API pública de BCRA (Estadísticas Cambiarias), sin API key.
// Se usa para poder cargar el costo de un producto en USD y convertirlo a pesos al valor oficial.
const BCRA_URL = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD";

// Devuelve { valor, fecha } — valor es pesos por dólar, según la última cotización oficial publicada.
export async function obtenerCotizacionDolarOficial() {
  const res = await fetch(BCRA_URL);
  if (!res.ok) throw new Error(`BCRA respondió ${res.status}`);
  const data = await res.json();
  const resultado = data.results?.[0];
  const detalle = resultado?.detalle?.[0];
  if (!detalle?.tipoCotizacion) throw new Error("No se pudo leer la cotización del dólar oficial.");
  return { valor: detalle.tipoCotizacion, fecha: resultado.fecha };
}
