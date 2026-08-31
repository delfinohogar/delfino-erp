import { functions, httpsCallable } from "./firebase.js";

function leerComoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Devuelve el objeto extraído (proveedorRazonSocial, numeroFactura, fecha, items, etc.) sin guardar nada.
export async function extraerFacturaDeArchivo(file) {
  const fileBase64 = await leerComoBase64(file);
  const fn = httpsCallable(functions, "extraerFactura");
  const res = await fn({ fileBase64, mimeType: file.type });
  return res.data;
}
