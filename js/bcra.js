// Central de Deudores del Sistema Financiero (BCRA) — API pública, sin certificado ni WSAA.
// Se llama directo desde el navegador (CORS habilitado por el propio BCRA).
export async function consultarCentralDeudores(cuit) {
  const res = await fetch(`https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/${cuit}`);
  const data = await res.json();
  if (data.status === 404) return null; // sin registros de deuda para ese CUIT
  if (data.status !== 200) {
    throw new Error((data.errorMessages || []).join(", ") || "Error consultando BCRA");
  }
  return data.results;
}
