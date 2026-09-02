// Envío por email: el ERP no tiene backend de correo (ni SMTP propio ni un servicio como
// SendGrid conectado) — inventar uno no está pedido ni corresponde acá. En vez de eso se arma un
// mailto: con asunto y cuerpo pre-cargados, que abre el cliente de correo del usuario (Gmail,
// Outlook, la app del teléfono, lo que tenga configurado). Igual que WhatsApp, mailto: no permite
// adjuntar el PDF automáticamente — el usuario lo adjunta a mano, y la UI se lo aclara.
import { formatMoneda as formatMonto } from "./formato.js";

export function asuntoEmailComprobante() {
  return "Comprobante de compra — Delfino Hogar";
}

export function mensajeEmailComprobante(comprobante) {
  const nombre = comprobante.clienteNombre === "Consumidor final" ? "" : comprobante.clienteNombre || "";
  return (
    `Hola${nombre ? " " + nombre : ""},\n\n` +
    `Te enviamos adjunto el comprobante correspondiente a tu compra en Delfino Hogar.\n\n` +
    `Comprobante: ${comprobante.numeroCompleto}\n` +
    `Total: ${formatMonto(comprobante.total)}\n\n` +
    `Muchas gracias por elegir Delfino Hogar.\n\n` +
    `Delfino Hogar`
  );
}

export function abrirEmailComprobante({ para, asunto, mensaje }) {
  const url = `mailto:${encodeURIComponent(para || "")}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
  window.location.href = url;
}
