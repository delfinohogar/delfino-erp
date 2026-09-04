# Integración con Tienda Nube — arquitectura preparada, sin conectar

Estado a 2026-09-02: **no hay credenciales ni API de Tienda Nube conectadas.** Este documento describe
la arquitectura que ya está construida (modelo de datos, cola, idempotencia) para que cuando existan
esas credenciales, conectar la integración real sea "implementar las funciones marcadas como stub en
`js/tiendanube-sync.js`", no rediseñar Productos, Stock, Ventas o Precios.

## 1. Quién es el maestro de cada dato

| Dato | Maestro | Dirección |
|---|---|---|
| Stock | **ERP** | ERP → Tienda Nube |
| Costo | **ERP** | (nunca sale del ERP) |
| Precio de venta | **ERP** | ERP → Tienda Nube |
| Margen | **ERP** | (nunca sale del ERP) |
| Imagen | **ERP si hay una manual**, si no Tienda Nube | Tienda Nube → ERP (solo si no hay manual) |
| Orden / pedido online | **Tienda Nube** | Tienda Nube → ERP |
| Venta (la operación en sí) | **ERP** | (se genera en el ERP a partir de la orden) |
| Factura | **ERP** | (se genera en el ERP a partir de la venta) |

Tienda Nube nunca decide stock, costo, precio o margen — sólo los recibe. El ERP nunca decide si una
orden existe o su estado de pago — sólo los recibe de Tienda Nube y actúa en consecuencia.

## 2. Identificación de productos: por SKU, siempre

`producto.sku` (ya único dentro del ERP — ver Prioridad 5.9 de la auditoría de UI, que señala que hoy
no hay una validación explícita de unicidad de SKU al crear un producto; conviene agregarla antes de
depender de esto para vincular con Tienda Nube) es la clave de vínculo. Nunca se relaciona por
descripción — dos productos pueden llamarse casi igual, un SKU no.

Cuando se vincula un producto, se guarda en el propio doc de `productos/{id}`:

```js
tiendaNube: {
  vinculado: true,
  idExterno: "12345678",      // product_id de Tienda Nube
  vinculadoEn: <timestamp>,
  vinculadoPor: <uid>,
}
```

Si el ERP tiene un SKU que Tienda Nube no encuentra: se muestra "Producto no encontrado en Tienda
Nube" y se permite vincularlo a mano después — nunca se inventa una coincidencia por similitud de
nombre.

## 3. Cola de sincronización (ERP → Tienda Nube)

Colección `colaSincronizacionTiendaNube` — ya existe y ya se está llenando... **no, todavía no**: el
modelo y las funciones (`encolarSincronizacion()` en `js/tiendanube-sync.js`) están listos, pero
deliberadamente **no están conectados todavía a `crearVenta`/`crearCompra`/`actualizarProducto`** (ver
sección 8, "qué falta para conectar de verdad").

Cada documento:

```js
{
  tipo: "stock" | "precio" | "imagen",
  productoId, sku,
  valorAnterior, valorNuevo,
  motivo,                        // ej. "Venta #1234", "Compra FC 0001-00088888"
  estado: "pendiente" | "enviado" | "confirmado" | "error",
  intentos, ultimoError,
  usuario, creadoEn, actualizadoEn,
}
```

`encolarSincronizacion()` **nunca tira una excepción** — un fallo al encolar (Firestore caído,
permiso, lo que sea) se loguea con `console.warn` y listo. La regla de oro de todo el diseño: **una
falla de Tienda Nube (o de la cola) nunca puede bloquear una venta o una operación interna del ERP.**

### Por qué una cola y no "mandar directo"

- Si Tienda Nube está caída, la cola absorbe el cambio y lo reintenta después — la venta ya se hizo,
  no se pierde.
- Da trazabilidad real: "qué se intentó enviar, cuándo, resultado" (pedido explícitamente en el punto
  24) sin tener que parsear logs de Cloud Functions.
- Separa "el stock cambió en el ERP" (evento local, inmediato, ya sabemos hacerlo bien) de "avisarle a
  Tienda Nube" (llamada de red externa, puede fallar, puede tardar, no debería bloquear nada).

### Procesamiento (cuando exista la conexión real)

Una Cloud Function programada (`onSchedule`, cada N minutos) o un trigger (`onDocumentCreated` sobre
`colaSincronizacionTiendaNube`) toma los documentos `estado:"pendiente"`, llama a la API real de
Tienda Nube, y marca `enviado`/`confirmado`/`error` con `ultimoError` si corresponde. Reintentos con
backoff — no reintentar infinito ni inmediato.

## 4. Imágenes

Ya implementado en `js/producto-imagenes.js` (ver commit de arquitectura de imágenes): cada producto
tiene un array `imagenes` con `origen: "manual" | "tienda_nube"`. `imagenPrincipal()` resuelve la
prioridad: manual marcada principal → manual más antigua → tienda_nube → ninguna.

Cuando exista la integración: `buscarImagenTiendaNube(sku)` (stub en `js/tiendanube-sync.js`) trae la
imagen principal de Tienda Nube por SKU y la agrega al array con `origen:"tienda_nube"` — nunca pisa
una imagen manual existente, solo se usa cuando no hay ninguna.

## 5. Órdenes online (Tienda Nube → ERP)

```
Cliente compra en Tienda Nube
  → Tienda Nube genera la orden
  → webhook / notificación llega al ERP
  → registrarOrdenTiendaNube(datosOrden)          [YA IMPLEMENTADO — ver abajo]
  → (si el pago está confirmado) procesarOrdenTiendaNube(idExterno)   [STUB — falta implementar]
      → identifica cliente (por email/teléfono, crea uno nuevo si no existe — mismo flujo que
        "+ Agregar cliente" ya usa en Nueva Venta, con el mismo chequeo de CUIT/DNI duplicado)
      → identifica productos por SKU (si un SKU no existe en el ERP, la orden queda con estado
        "error" y un detalle claro — nunca se inventa un producto)
      → crearVenta() con esos ítems               [ya existe, js/ventas.js]
      → crearComprobante()                        [ya existe, js/facturacion.js]
      → si estadoPago === "aprobado": el comprobante queda cobrado; si no, queda pendiente
      → stock baja como parte de crearVenta (ya lo hace solo)
      → encolarSincronizacion({tipo:"stock", ...}) para devolverle el stock nuevo a Tienda Nube
```

### Idempotencia (punto 18 del pedido)

El **id del documento** en `ordenesTiendaNube` es el id externo de la orden en Tienda Nube — nunca un
id autogenerado. `registrarOrdenTiendaNube()` hace `getDoc` antes de `setDoc`: si ya existe, devuelve
`{ yaExistia: true }` y no vuelve a escribir nada. Un reintento de webhook, una notificación duplicada,
un timeout que se reintenta solo — todo cae en el mismo `setDoc` al mismo id, que es un no-op si ya
estaba. **Esto es lo que garantiza que una orden nunca genera dos ventas.**

### Estado de pago (punto 19 del pedido)

`ordenesTiendaNube.estadoPago` distingue `pendiente | aprobado | rechazado | reembolsado`.
`procesarOrdenTiendaNube` **nunca asume cobrado solo porque la orden existe** — solo genera venta+
factura con estado "cobrada" cuando `estadoPago === "aprobado"`. Si llega en `pendiente`, la orden
queda registrada (para no perderla) pero sin procesar hasta que una notificación posterior confirme el
pago.

### Facturación (punto 20 del pedido)

La factura generada guarda la cadena completa: `ordenesTiendaNube.idExterno` → `ventaId` → `facturaId`
(campos ya en el schema de `ordenesTiendaNube`). Si ARCA todavía no está conectado (no lo está — ver
`configuracion/facturacion.js`), la factura sale como comprobante interno igual que cualquier otra
venta del ERP hoy — no se inventa un estado fiscal que no existe.

## 6. No-bucle de sincronización (punto 22 del pedido)

Riesgo: ERP cambia stock → Tienda Nube recibe el cambio → Tienda Nube dispara un evento →
el ERP lo interpreta como "cambió de nuevo" → reenvía → ciclo infinito.

Cómo se evita en este diseño: **el único evento que Tienda Nube manda al ERP es una orden** (compra
online). Tienda Nube nunca le "avisa" al ERP que aceptó un cambio de stock — la sincronización de
stock/precio es unidireccional ERP→Tienda Nube y no genera ninguna notificación de vuelta que el ERP
tenga que interpretar. No hay bucle posible con este flujo mientras se respete esa regla: **Tienda
Nube nunca es origen de un cambio de stock/precio, solo de órdenes.**

## 7. Qué falta para conectar de verdad (cuando haya credenciales)

1. Conseguir API key / OAuth app de Tienda Nube, guardar como secret de Cloud Functions
   (`defineSecret`, nunca hardcodeado — mismo patrón que `functions/mercadoPago.js`/`arcaWsaa.js`).
2. Implementar los 3 stubs de `js/tiendanube-sync.js`: `sincronizarStock`, `sincronizarPrecio`,
   `buscarImagenTiendaNube` — llamadas HTTP reales a la API de Tienda Nube.
3. Implementar `procesarOrdenTiendaNube` (la lógica de "qué hacer con una orden" descrita arriba).
4. Cloud Function `onRequest` para el webhook de Tienda Nube (recibe la notificación de orden nueva,
   llama a `registrarOrdenTiendaNube`, y si el pago viene confirmado, a `procesarOrdenTiendaNube`) —
   mismo esqueleto que ya existe en `functions/mercadoPago.js` (`mpWebhook`): validar firma,
   deduplicar por id externo, responder rápido y procesar.
5. Conectar `encolarSincronizacion()` en los puntos reales donde cambia stock/precio:
   - `js/ventas.js` — dentro de la transacción de stock por ítem (`crearVenta`, alrededor de la
     escritura de `stockTotal`).
   - `js/compras.js` — mismo lugar, sentido inverso.
   - `js/productos.js` (`actualizarProducto`) — cuando cambia `stockTotal` o `precioVenta` a mano.

   Deliberadamente no se conectó todavía: son los mismos puntos que la auditoría de esta noche marcó
   como el flujo más frágil del sistema (`crearVenta`/`crearCompra` no son atómicos — ver hallazgo de
   integridad transaccional). Agregar un side-effect más ahí sin una prueba de regresión completa del
   flujo de venta no es algo para hacer de madrugada sin supervisión — queda listo para conectar en
   una sesión donde se pueda probar el flujo completo de punta a punta con calma.
6. Panel de Configuración → Integraciones (ya tiene la tarjeta con contadores reales, ver
   `configuracion/integraciones.js`) — cuando haya sincronización real, agregar ahí un botón
   "Reintentar errores" y el detalle de la cola.

## 8. Qué NO hace este diseño (a propósito)

- No sincroniza en tiempo real — es una cola, con latencia de minutos, no de milisegundos. Para una
  pyme esto es la elección correcta: prioriza que el ERP nunca se bloquee por Tienda Nube.
- No resuelve conflictos de "alguien cambió el precio en Tienda Nube directamente" — por diseño, la
  regla de negocio es que eso no debería pasar (ERP es el maestro). Si pasa igual, el próximo envío del
  ERP lo va a pisar — comportamiento esperado, no un bug a resolver acá.
- No importa el catálogo completo de Tienda Nube al ERP — la relación es por SKU existente en el ERP;
  un producto que solo existe en Tienda Nube y no en el ERP no aparece en ningún lado hasta que se
  cargue en el ERP primero.
