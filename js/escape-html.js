// Escapa un valor para insertarlo de forma segura dentro de HTML armado con template literals — ya
// sea como texto entre tags o dentro de un atributo entre comillas dobles. Usar en CUALQUIER dato que
// venga de Firestore o de un input de usuario (razón social, domicilio, observaciones, notas, etc.);
// nunca hace falta en el HTML fijo que arma el propio sistema (las etiquetas del template en sí).
//
// Sin esto, un dato como razonSocial cargado por cualquier vendedor podía llevar HTML/script que se
// ejecutaba para cualquier otro usuario que abriera esa venta/cliente — ver auditoría de seguridad.
export function escapeHtml(valor) {
  if (valor == null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
