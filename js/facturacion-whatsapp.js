// Envío por WhatsApp: arma el mensaje y abre wa.me — no hay forma de adjuntar el PDF automáticamente
// desde el navegador (WhatsApp Web/App no lo permite), así que no se inventa esa parte: se le avisa
// al usuario que tiene que adjuntarlo a mano. No se usa ninguna API externa de WhatsApp.
function formatMonto(v) {
  return `$${Math.round(v || 0).toLocaleString("es-AR")}`;
}

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

// Devuelve { url, tieneNumero } — tieneNumero=false cuando el cliente no tiene WhatsApp cargado:
// igual se abre WhatsApp con el mensaje listo para elegir el contacto a mano.
export function abrirWhatsappComprobante(comprobante, telefonoCliente) {
  const mensaje = encodeURIComponent(mensajeWhatsapp(comprobante));
  const digitos = soloDigitos(telefonoCliente);
  const url = digitos ? `https://wa.me/${digitos}?text=${mensaje}` : `https://wa.me/?text=${mensaje}`;
  window.open(url, "_blank");
  return { tieneNumero: Boolean(digitos) };
}
