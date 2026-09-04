// Envío por WhatsApp: arma el mensaje y abre wa.me — no hay forma de adjuntar el PDF automáticamente
// desde el navegador (WhatsApp Web/App no lo permite), así que no se inventa esa parte: se le avisa
// al usuario que tiene que adjuntarlo a mano. No se usa ninguna API externa de WhatsApp.
import { formatMoneda as formatMonto } from "./formato.js";

export function mensajeWhatsapp(comprobante) {
  const nombre = comprobante.clienteNombre === "Consumidor final" ? "" : comprobante.clienteNombre?.split(" ")[0] || "";
  return (
    `Hola${nombre ? " " + nombre : ""} 👋\n` +
    `Te enviamos el comprobante correspondiente a tu compra en Delfino Hogar.\n\n` +
    `🧾 Comprobante: ${comprobante.numeroCompleto}\n` +
    `💰 Total: ${formatMonto(comprobante.total)}\n\n` +
    `Muchas gracias por elegir Delfino Hogar.`
  );
}

function soloDigitos(texto) {
  return (texto || "").replace(/\D/g, "");
}

// wa.me necesita el número completo con código de país (54) + el 9 de celular argentino — pero
// cargar un cliente es más rápido tipeando directo desde el código de área (ej. "11 2345-6789"),
// que es como se termina escribiendo en la práctica. Si ya viene con 54 (con o sin el 9) se respeta
// tal cual; si no, se asume que es un número local y se le antepone 549.
function numeroWhatsappCompleto(texto) {
  const digitos = soloDigitos(texto);
  if (!digitos) return "";
  if (digitos.startsWith("549")) return digitos;
  if (digitos.startsWith("54")) return "549" + digitos.slice(2);
  return "549" + digitos;
}

// Devuelve { url, tieneNumero } — tieneNumero=false cuando el cliente no tiene WhatsApp cargado:
// igual se abre WhatsApp con el mensaje listo para elegir el contacto a mano.
export function abrirWhatsappComprobante(comprobante, telefonoCliente) {
  const mensaje = encodeURIComponent(mensajeWhatsapp(comprobante));
  const digitos = numeroWhatsappCompleto(telefonoCliente);
  const url = digitos ? `https://wa.me/${digitos}?text=${mensaje}` : `https://wa.me/?text=${mensaje}`;
  window.open(url, "_blank");
  return { tieneNumero: Boolean(digitos) };
}
