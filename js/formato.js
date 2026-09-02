// Formateo centralizado — antes cada pantalla tenía su propia función formatMonto() copiada y
// pegada (29 archivos, casi todas idénticas), lo que dejó huecos: productos-list.js usaba
// toLocaleString("es-AR") sin fijar decimales, así que "22528.1" salía como "22.528,1" (un solo
// decimal) al lado de "5681.82" como "5.681,82" (dos) — mismo dato, formato distinto según el
// número. Todo lo que muestre dinero/porcentaje/cantidad/fecha en el ERP tiene que pasar por acá.
//
// Convención de decimales para dinero: 0 por defecto (precios de venta y totales del negocio son
// siempre pesos redondos en Delfino Hogar — forzar ",00" en todos lados sería ruido, no prolijidad)
// — pasar { decimales: 2 } en los lugares donde el número puede tener centavos reales y por eso
// importa mostrarlos siempre completos (costo neto de IVA, márgenes, valores intermedios de cálculo).

export function formatMoneda(valor, { decimales = 0, signo = "$" } = {}) {
  const n = Number(valor) || 0;
  return `${signo}${n.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
}

export function formatPorcentaje(valor, { decimales = 1 } = {}) {
  const n = Number(valor) || 0;
  return `${n.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}%`;
}

export function formatCantidad(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString("es-AR");
}

// "YYYY-MM-DD" (formato interno de fecha en todo el ERP) -> "DD/MM/AAAA".
export function formatFecha(fechaStr) {
  if (!fechaStr) return "-";
  const [anio, mes, dia] = fechaStr.split("-");
  if (!anio || !mes || !dia) return fechaStr;
  return `${dia}/${mes}/${anio}`;
}

// Para Timestamps de Firestore (o Date) donde además importa la hora — auditoría, movimientos, etc.
export function formatFechaHora(valor) {
  if (!valor) return "-";
  const f = valor?.toDate ? valor.toDate() : new Date(valor);
  return Number.isNaN(f.getTime()) ? "-" : f.toLocaleString("es-AR");
}
