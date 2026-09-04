# Arquitectura

Escribe solo el director. Se completa en la FASE 0 con el relevamiento real del código.

## Punto de partida verificado (FASE -1)

Frontend estático (JavaScript vanilla, módulos ES, Firebase desde CDN) servido por Netlify.
No hay backend para operaciones de negocio: la lógica de venta, stock, cobros y asientos vive
en `js/*.js` y escribe directo en Firestore desde el navegador, protegida por `firestore.rules`.

Cloud Functions existentes (`functions/`): consulta de padrón ARCA (WSAA + A13/A5), Mercado
Pago en modo TEST, chat con IA, extracción de facturas, carga de secretos por un administrador.
No hay facturación electrónica (WSFE).

Separación existente y aprovechable: 15 módulos en `js/` concentran toda la escritura a
Firestore; `productos/`, `configuracion/`, `contabilidad/`, `facturacion/` y `mercado-pago/`
son UI que importa de `js/`. El contrato a preservar en la migración es la firma de las
funciones exportadas de `js/*.js`.

Colecciones en uso: productos, ventas, compras, cobros, pagosProveedores, ordenesCompra,
clientes, proveedores, categorias, marcas, listasPrecios, comprobantes, asientosContables,
cuentasContables, usuarios, sucursales, depositos, contadores, pagosMercadoPago,
logIntegracionMercadoPago; subcolecciones logAuditoria, historialCostos, stockPorDeposito, precios.
