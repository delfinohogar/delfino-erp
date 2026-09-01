// Íconos de línea para la barra lateral: formas simples (rect/circle/line), monocromáticos
// (heredan color del texto vía currentColor) para no romper la paleta casi-mono del resto del ERP.
const BASE = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const FORMAS = {
  dashboard: `<rect x="4" y="12" width="4" height="8"/><rect x="10" y="7" width="4" height="13"/><rect x="16" y="3" width="4" height="17"/>`,
  mas: `<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
  lista: `<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>`,
  intercambio: `<polyline points="4 7 8 3 8 3 12 7"/><line x1="8" y1="3" x2="8" y2="17"/><polyline points="20 17 16 21 12 17"/><line x1="16" y1="21" x2="16" y2="7"/>`,
  billetera: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14" r="1.4"/>`,
  caja: `<rect x="4" y="8" width="16" height="12" rx="1"/><path d="M4 8l3-5h10l3 5"/><line x1="4" y1="8" x2="20" y2="8"/>`,
  etiqueta: `<path d="M11 3H5a2 2 0 0 0-2 2v6l10 10 8-8L11 3z"/><circle cx="8" cy="8" r="1.4"/>`,
  refresh: `<path d="M20 12a8 8 0 1 1-2.5-5.8"/><polyline points="20 3 20 8 15 8"/>`,
  descarga: `<line x1="12" y1="3" x2="12" y2="14"/><polyline points="7 10 12 15 17 10"/><line x1="4" y1="19" x2="20" y2="19"/>`,
  portapapeles: `<rect x="6" y="4" width="12" height="17" rx="1.5"/><rect x="9" y="2" width="6" height="4" rx="1"/>`,
  bolsa: `<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>`,
  tarjeta: `<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>`,
  carpeta: `<path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z"/>`,
  camion: `<rect x="2" y="8" width="12" height="9" rx="1"/><path d="M14 11h4l3 3v3h-7z"/><circle cx="6" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>`,
  usuario: `<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6 7-6s7 2.1 7 6"/>`,
  edificio: `<rect x="4" y="3" width="10" height="18"/><rect x="14" y="9" width="6" height="12"/><line x1="7" y1="7" x2="7" y2="7.01"/><line x1="11" y1="7" x2="11" y2="7.01"/><line x1="7" y1="11" x2="7" y2="11.01"/><line x1="11" y1="11" x2="11" y2="11.01"/><line x1="7" y1="15" x2="7" y2="15.01"/><line x1="11" y1="15" x2="11" y2="15.01"/>`,
  grafico: `<polyline points="4 16 9 10 13 13 20 5"/><polyline points="15 5 20 5 20 10"/>`,
  libro: `<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5V4.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><line x1="8" y1="7" x2="15" y2="7"/>`,
  balanza: `<line x1="12" y1="3" x2="12" y2="21"/><line x1="6" y1="7" x2="18" y2="7"/><path d="M4 7l-2 5a3 3 0 0 0 6 0L6 7"/><path d="M20 7l-2 5a3 3 0 0 0 6 0L20 7"/><line x1="9" y1="21" x2="15" y2="21"/>`,
  usuarios: `<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5.2 6-5.2s6 1.9 6 5.2"/><path d="M16 8.2A3 3 0 1 1 16 3"/><path d="M15 15c2.8.3 5 2.1 5 5"/>`,
  chevron: `<polyline points="9 6 15 12 9 18"/>`,
  recibo: `<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>`,
};

export const ICONOS_NAV = {
  dashboard: "dashboard",
  reportes: "grafico",
  "venta-nueva": "mas",
  ventas: "lista",
  "cuenta-corriente-clientes": "intercambio",
  cobros: "billetera",
  productos: "caja",
  precios: "etiqueta",
  inventario: "lista",
  movimientos: "refresh",
  importar: "descarga",
  "ordenes-compra": "portapapeles",
  compras: "bolsa",
  "cuenta-corriente": "intercambio",
  pagos: "tarjeta",
  "config-categorias": "carpeta",
  "config-marcas": "etiqueta",
  "config-proveedores": "camion",
  "config-clientes": "usuario",
  "config-precios": "lista",
  "config-usuarios": "usuarios",
  "config-empresa": "edificio",
  "contabilidad-plan-cuentas": "libro",
  "contabilidad-libro-diario": "libro",
  "contabilidad-libro-mayor": "libro",
  "contabilidad-sumas-saldos": "balanza",
  "contabilidad-estado-resultados": "grafico",
  "config-mercado-pago": "tarjeta",
  "mp-centro-pruebas": "billetera",
  "facturacion-dashboard": "recibo",
  "facturacion-nuevo": "mas",
  "config-sucursales": "edificio",
  "config-facturacion": "recibo",
  "tesoreria-dashboard": "balanza",
  "tesoreria-cajas": "caja",
  "tesoreria-bancos": "edificio",
  "tesoreria-cxc": "billetera",
  "tesoreria-gastos": "tarjeta",
  "tesoreria-transferencias": "intercambio",
  "tesoreria-movimientos": "lista",
  "tesoreria-conciliacion": "portapapeles",
  configuracion: "edificio",
};

export function icono(nombre) {
  const forma = FORMAS[nombre];
  if (!forma) return "";
  return `<svg ${BASE} class="nav-icon">${forma}</svg>`;
}
