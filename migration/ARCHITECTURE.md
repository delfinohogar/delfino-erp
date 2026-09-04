# Arquitectura

Escribe solo el director. Relevamiento del 2026-09-04 sobre el master actual, hecho con tres
pasadas de lectura independientes. Reemplaza por completo el borrador de FASE -1, cuyos conteos
de superficie no eran válidos.

Todo lo que dice VERIFICADO se comprobó leyendo el código. Lo que dice DESCONOCIDO no se puede
determinar desde el repositorio y no se asume.

---

# Parte 1 — El sistema real

## 1.1 Superficie

| | Archivos | LOC |
|---|---|---|
| Módulos de dominio `js/` | 83 | 10.719 |
| Pantallas (UI) | 75 | 12.403 |
| **Total frontend** | **158** | **~23.100** |
| Páginas HTML | 74 | — |
| Colecciones Firestore raíz | 41 | — |
| Subcolecciones | 6 | — |

Distribución de la UI: `productos/` 28 páginas (contiene ventas, compras y catálogo mezclados),
`configuracion/` 18, `tesoreria/` 12, `contabilidad/` 7, `facturacion/` 3, `mercado-pago/` 1,
raíz 5.

## 1.2 La frontera UI ↔ datos ya existe

VERIFICADO: **cero escrituras a Firestore fuera de `js/`.** Los 75 archivos de UI no contienen
un solo `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `runTransaction`, `writeBatch` ni
`increment`. No importan el SDK de Firestore. Las tres coincidencias que aparecen en esas
carpetas son comentarios.

VERIFICADO: `js/firebase.js` (98 LOC) es el **único punto de inicialización y re-exportación del
SDK**. Ningún módulo importa desde la CDN de Google directamente.

Cadena real: `UI → js/*.js → js/firebase.js → SDK Firebase → Firestore`.

Consecuencia para la migración: **el trabajo toca 32 archivos, no 158**, y `js/firebase.js` es el
punto de inyección natural del adaptador que pide la decisión "Capa Repository/Adapter antes de
reemplazar js/*.js".

Corrección al borrador anterior: decía "15 módulos concentran toda la escritura". El número es
falso —son **32**— pero la propiedad estructural que importaba es más fuerte de lo que esa frase
describía.

Reparto de las escrituras: **107 call-sites directos** más **33 dentro de `tx.*` / `batch.*`** =
140. Los cinco módulos con más escrituras son `js/ventas.js` (11), `js/productos.js` (9),
`js/catalogo.js` (9), `js/importar-globalbluepoint.js` (8) y `js/bancos.js` (6).

## 1.3 Dos ausencias que favorecen el modelo relacional

VERIFICADO: **`increment` no se usa en ninguna parte del frontend.** Ni siquiera está
re-exportado por `js/firebase.js`. No hay contadores atómicos de campo: todos los saldos se
derivan sumando sus movimientos. Patrón declarado explícitamente en `js/cajas.js` y
`js/bancos.js`. Traduce 1:1 a `SUM()`.

VERIFICADO: **`deleteDoc` se importa y re-exporta en `js/firebase.js` pero ningún módulo lo
usa.** No hay borrado físico: todo es baja lógica por campo de estado. El esquema puede asumir
soft-delete en todo el modelo.

## 1.4 Colecciones y quién las escribe

41 raíz. El borrador anterior listaba 23 y cuatro de ellas eran en realidad subcolecciones: la
cobertura real era del 46 %.

### Ventas
| Colección | La escribe | Nota |
|---|---|---|
| `ventas` | `js/ventas.js` | **Inmutable**: `firestore.rules` tiene `allow update, delete: if false` |
| `ventasIdempotencia` | `js/ventas.js` | clave de idempotencia, ver 1.6 |
| `reversasVenta` | `js/ventas.js` | idempotencia de la reversa por nota de crédito |
| `entregas` | `js/entregas.js` | id = `ventaId`, idempotente por diseño |
| `cobros` | `js/ventas.js` (automático) y `js/cobros.js` (manual) | **dos shapes distintos**, ver 1.5 |

### Catálogo y stock
`productos` ← `js/productos.js`, `js/ventas.js` (solo `stockTotal`), `js/combos.js`,
`js/importar-globalbluepoint.js`, `js/producto-imagenes.js`, `js/gbp-articulos.js`.
`categorias`, `marcas`, `listasPrecios`, `depositos`, `proveedores` ← `js/catalogo.js`.
`clientes` ← `js/clientes.js`, `js/gbp-clientes-excel.js`.

Subcolecciones de `productos`: `logAuditoria` (también consultada por `collectionGroup`),
`historialCostos`, `stockPorDeposito`, `precios`, `proveedores`. Más `usuarios/{uid}/logAuditoria`.
`historialCostos` y `logAuditoria` son inmutables por regla.

### Contabilidad y facturación
`asientosContables`, `cuentasContables` ← `js/contabilidad.js`.
`comprobantes` ← `js/facturacion.js`.
`contadores` ← `js/ventas.js`, `js/contabilidad.js`, `js/facturacion.js`.

### Tesorería — 13 colecciones, ninguna estaba en el inventario anterior
`cajas`, `sesionesCaja`, `movimientosCaja` ← `js/cajas.js`.
`bancos`, `cuentasBancarias`, `movimientosBancarios` ← `js/bancos.js`.
`cuentasPorCobrar` ← `js/cuentas-por-cobrar.js`. `mediosPago` ← `js/medios-pago.js`.
`gastos` ← `js/gastos.js`. `chequesEmitidos` ← `js/cheques.js`. `chequeras` ← `js/chequeras.js`.
`transferenciasInternas` ← `js/transferencias.js`.
`resolucionesPagoSinUbicar` ← `js/resoluciones-pago-sin-ubicar.js`.

Es el bloque con más lógica de saldo derivado del sistema, y el que estaba enteramente ausente
de la documentación previa.

### Compras
`compras` ← `js/compras.js`. `pagosProveedores` ← `js/pagos.js`.
`ordenesCompra` ← `js/ordenes-compra.js`.

### Configuración
`usuarios` ← `js/usuarios.js`. `sucursales` ← `js/sucursales.js`.
`configuracion` ← `js/configuracion-empresa.js`, `js/facturacion-config.js`. Son documentos
singleton: `configuracion/empresa`, `configuracion/facturacion`, `configuracion/mercadoPago`.

### Integraciones
Mercado Pago: `pagosMercadoPago`, `devolucionesMercadoPago`, `webhooksMercadoPagoProcesados`,
`logIntegracionMercadoPago`.
Tiendanube: `ordenesTiendaNube`, `colaSincronizacionTiendaNube`, `logIntegracionTiendaNube`.
GBP: `facturasGbp`, `clientesGbp`.
ARCA: `logIntegracionArca`, `arcaNumeracionLocks` (lock de numeración fiscal por
`{ptoVta}_{cbteTipo}`).

Estas las escriben en parte las Cloud Functions y en parte `js/mercado-pago.js`,
`js/tiendanube-sync.js` y los módulos `js/gbp-*`.

> `firestore.rules` tiene un bloque `match` por colección y es el inventario más completo del
> modelo de permisos. Es la fuente a traducir cuando se defina la autorización del backend.

## 1.5 `crearVenta`: el inventario de escrituras y su atomicidad real

Archivo: `js/ventas.js`. Llamador único: `productos/venta-nueva.js:535`.

Orden real de ejecución:

| # | Operación | Colección | ¿Transacción? |
|---|---|---|---|
| 0 | `getDoc` de la clave de idempotencia | `ventasIdempotencia/{key}` | no |
| 1 | `setDoc` estado `procesando` | `ventasIdempotencia/{key}` | no |
| 2 | `getDoc` ×N ítems, valida stock previo | `productos/{id}` | no |
| 3 | contador de ventas | `contadores/ventas` | **tx propia, aislada** |
| 4 | ×N: `tx.update` producto + `tx.set` auditoría | `productos/{id}` (+ `logAuditoria`) | **una tx por ítem** |
| 5 | `resolverSucursalUsuario` | `usuarios`, `sucursales` | no |
| 6 | genera `ventaRef` client-side, sin escribir | — | — |
| 7 | ×N pagos: ruteo a Tesorería | `cuentasPorCobrar` \| `movimientosCaja` \| `movimientosBancarios` | no |
| 8 | `setDoc` del documento de venta | `ventas/{id}` | no |
| 9 | vínculo con orden MP, best-effort | `pagosMercadoPago` | no |
| 10 | entrega, si no es "Retira ahora" | `entregas/{ventaId}` | no |
| 11 | ×N: un `addDoc` por pago inmediato | `cobros` | no |
| 12 | contador de asientos | `contadores/asientos` | **tx propia, aislada** |
| 13 | `addDoc` del asiento | `asientosContables` | no |
| 14 | `setDoc` merge estado `completa` | `ventasIdempotencia/{key}` | no |
| — | **fuera de `crearVenta`** | `contadores/comprobantes_*`, `comprobantes` | tx solo el contador |

**Atomicidad real: ninguna.** Para la venta mínima —un ítem simple, un pago, cliente asignado,
"Retira ahora"— son **9 round-trips de escritura** (≈11 documentos) y **4 transacciones Firestore
independientes que no comparten atomicidad entre sí**. Escala lineal: +1 tx por ítem, +1
escritura por pago ruteado, +1 por cobro.

Corrección a R1: decía "seis escrituras separadas". El conteo era correcto cuando se escribió;
después se agregaron idempotencia, ruteo a Tesorería, entregas y comprobante.

Qué queda roto según dónde se corte:

| Corta en | Estado resultante |
|---|---|
| 3–4 | número quemado, stock descontado, **sin venta** |
| 7 | movimiento de caja/banco/CxC creado **sin venta**: plata registrada sin respaldo |
| 8 | venta escrita **sin cobros ni asiento**: la cuenta corriente muestra la deuda total |
| 11 | venta + cobros parciales, **sin asiento**: Libro Diario desincronizado |
| 13 | todo escrito pero la clave queda en `procesando`: **la venta se bloquea para siempre** |

Esto es R1, y es la razón de la migración.

### El cobro automático y el manual tienen shapes distintos
El cobro que genera `crearVenta` no lleva `routeoTesoreria` ni `tieneSinUbicar`; el cobro manual
de `js/cobros.js` sí. Dos formas en la misma colección: hay que unificarlas en el modelo relacional.

### Los ítems no tienen depósito
VERIFICADO: el modelo actual es **mono-depósito de hecho**.

## 1.6 Idempotencia: existe, y es lo mejor implementado del flujo

`ventasIdempotencia/{idempotencyKey}` con máquina de estados:

- **no existe** → escribe `procesando` y sigue;
- **`completa`** → devuelve `previa.resultado` sin tocar nada — el caso feliz del reintento;
- **`procesando`** → corta con mensaje ("puede ser un reintento muy rápido");
- **`error`** → corta y **no reprocesa**: puede haber stock o Tesorería a medio escribir, y
  requiere revisión manual.

La clave la genera la UI con `crypto.randomUUID()`, una por intento de carrito. Se descarta al
modificar el carrito y, deliberadamente, recién **después** de que `crearComprobante` tuvo éxito
—así un fallo del comprobante permite reintentar reusando la venta ya hecha.

Doble clic en "Confirmar venta": cubierto, pero por el reuso de clave, no por el guard de botón.
`continuarBtn.disabled = true` está **después** del `await` del modal de pago, así que entre el
click y la resolución del modal el botón sigue habilitado.

**El agujero: TOCTOU.** `reservarIdempotenciaVenta` hace `getDoc` y después `setDoc`, sin
transacción y sin create condicional. Dos llamadas realmente concurrentes pueden leer ambas "no
existe" y seguir las dos → doble descuento de stock y doble ruteo de pago. En la práctica el
modal serializa lo suficiente como para taparlo; no es estructuralmente seguro.

Otras idempotencias: `reversasVenta/{ventaId}`, `entregas/{ventaId}`, y el webhook de Tiendanube
por id externo. El cobro automático de venta **no tiene clave propia**: depende de la de la venta.

## 1.7 Ruteo de pagos a Tesorería

`routearPagoATesoreria` corre **antes** del asiento, a propósito: el asiento se arma con el
resultado real del ruteo para que contabilidad y Tesorería no puedan contradecirse. Antes de ese
cambio el asiento suponía que todo entraba a Caja, y una venta con tarjeta sobrestimaba el
disponible.

El destino sale del catálogo configurable `mediosPago` (campo `destino`), no de un `switch` por
nombre: un medio nuevo rutea apenas se lo crea. Tres destinos, y su cuenta contable en
`cuentaParaDestinoTesoreria()`:

| destino | va a | cuenta |
|---|---|---|
| `caja` | `movimientosCaja`, exige sesión de caja abierta | 1.1.1 |
| `banco` | `movimientosBancarios` | 1.1.1 |
| `cuentaPorCobrar` | `cuentasPorCobrar` (tarjeta, MP, GoCuotas, Boston Cred) | 1.1.5 |

Un pago que no se puede rutear —caja cerrada, medio sin destino— **nunca bloquea la venta**:
queda `ruteado:false` con motivo, la venta se marca `tieneSinUbicar:true`, y contablemente se
imputa a 1.1.2 Deudores por Ventas, que es lo más honesto sin desbalancear. La pantalla
`tesoreria/pagos-sin-ubicar.js` los lista.

Como la venta es inmutable, el resultado del ruteo se guarda dentro del alta o se pierde.

## 1.8 Combos

`tipoProducto: "combo"` con `componentes: [{productoId, sku, descripcion, cantidad}]`.

Regla verificada: **vender un combo nunca descuenta un `stockTotal` propio.** Descuenta el stock
de cada componente, multiplicado por la cantidad vendida del combo. La línea de la venta sigue
mostrando el combo tal como se vendió; la expansión es solo para saber qué stock tocar.

`costoReferencia` del combo ya es la suma de sus componentes: lo mantiene al día el trigger
`onProductoActualizadoRecalcularCombos` de `functions/combosSync.js`. Por eso `crearVenta` lee el
costo igual para un combo que para un producto simple.

Detalle fino: a un componente descontado por combo **no** se le tocan `ultimoPrecioVenta` ni
`ultimaVentaEn`, porque no tuvo precio individual.

## 1.9 Notas de crédito y reversa

`crearNotaCredito` en `js/facturacion.js` llama a `revertirVentaPorNotaCredito` **antes** de
marcar el comprobante original como ANULADA.

La venta es inmutable, así que la reversa nunca la toca: revierte sus **efectos**. Devuelve el
stock —expandiendo combos igual que al vender—, revierte cada tramo de Tesorería a donde había
ido, y genera un asiento espejado con los mismos montos y debe/haber invertidos.

Idempotente por `reversasVenta/{ventaId}`: como una venta solo se revierte una vez, la clave
natural sirve de idempotencia y de "ya se hizo".

Degradación deliberada: un tramo que no se puede revertir todavía —caja cerrada, cuenta por
cobrar ya cobrada que necesita reembolso real— **no frena el resto**. Queda en
`pendientesRevision` y se imputa a 1.1.2 mientras tanto, así el asiento cierra sin importar
cuántos tramos se pudieron revertir. Un producto borrado va a `productosNoEncontrados`.

## 1.10 Numeración

Tres contadores, forma `{ ultimo: number }`, patrón idéntico: `runTransaction` con `tx.get` +
`tx.set`, **cada uno en su propia transacción aislada de la operación**.

| Documento | Lo incrementa |
|---|---|
| `contadores/ventas` | `js/ventas.js` |
| `contadores/asientos` | `js/contabilidad.js` |
| `contadores/comprobantes_{puntoVenta}_{tipo}` | `js/facturacion.js` |

La venta obtiene su número antes de escribir nada del negocio: si falla después, **el número
queda quemado** (R10). Los comprobantes no usan un contador único sino uno por punto de venta y
tipo, porque la numeración fiscal lo exige.

Dato suelto: `scripts/seed-emulator.mjs` crea `contadores/comprobantes` sin sufijo, y ese
documento no lo usa nadie.

## 1.11 Contabilidad

Plan de cuentas en `PLAN_DE_CUENTAS` (`js/contabilidad.js`), sembrado idempotente a
`cuentasContables` con id = código. `imputable:false` son agrupadoras.

Cuentas que toca una venta: **1.1.1** Caja y Bancos, **1.1.2** Deudores por Ventas, **1.1.3**
Bienes de Cambio, **1.1.5** Deudores por Tarjetas y Acreditaciones, **2.1.2** IVA Débito Fiscal,
**4.1** Ventas, **5.1** Costo de Mercadería Vendida.

Asiento de venta: al Debe, cada destino de Tesorería según el ruteo real, más lo pendiente a
1.1.2, más el costo a 5.1. Al Haber, el neto a 4.1, el IVA a 2.1.2, y el costo a 1.1.3.

**El IVA se discrimina de verdad.** `discriminarIva(montoConIva, ivaPct)` resta hacia atrás
porque el precio ya lo incluye. Corrección a `CLAUDE.md`, que dice que el IVA "está preparado
pero calculado en $0": eso es falso desde hace tiempo, y la decisión del 2026-09-04 lo confirma
y corrige la premisa de P6.

Validación Debe = Haber: en el cliente, antes de escribir, con tolerancia de un centavo. **Nada
lo impone del lado de Firestore.**

**Bug: `normalizarFecha` corre el día.** Usa `toISOString()`, que convierte a UTC. Un `Date` local
del 1/1 a las 21:00 ART se guarda como `"2026-01-02"`. Toda venta cargada después de las 21:00
hora argentina queda asentada al día siguiente. No maneja `Timestamp` de Firestore: si le llega
uno, lo devuelve tal cual.

## 1.12 Cloud Functions y su rol

`functions/` es producción desplegada y no se toca. Exporta 30 funciones:

- **ARCA padrón** — `consultarPadronArca` (WSAA + A13/A5). Alta de clientes y proveedores.
- **ARCA fiscal** — `arcaAutorizarComprobante` (WSFEv1). Ver 1.13.
- **Mercado Pago** — 11 funciones (Point/Orders, webhook, devoluciones). Modo TEST. El Access
  Token vive en Functions, nunca en el navegador.
- **Tiendanube** — `tnWebhook` (pedidos) y 5 de catálogo (`tnReconciliarCatalogo`,
  `tnVincularProductos`, `tnActualizarStock`, `tnImportarProductos`, `tnImportarImagenes`).
- **GBP** — `gbpSincronizarFacturas` y 6 de clientes/artículos.
- **Combos** — `onProductoActualizadoRecalcularCombos`, el único trigger de Firestore.
- **IA y utilidades** — `chatConsulta`, `extraerFactura`, `guardarSecretoAdmin`,
  `crearUsuarioCompleto`.

Ninguna interviene en el flujo de venta salvo el trigger de combos, que recalcula costo y precio
del combo cuando cambia un componente.

## 1.13 Estado de ARCA WSFEv1

La integración fiscal está **completa y apagada**. `arcaActivo: false` en
`js/facturacion-config.js`, sin UI para activarla. `js/facturacion.js` elige entre
`InternalProvider` y `ArcaFiscalProvider` en un único punto de decisión según ese flag.

**Qué está efectivamente desplegado es DESCONOCIDO.** `functions/index.js:49` exporta
`arcaAutorizarComprobante`, pero exportada no es desplegada: los deploys se hacen con
`--only <función>`. Solo se verifica en Firebase Console, y eso lo hace Gastón. Ver R8.

Activar ARCA es Nivel 3 explícito.

## 1.14 Dirección de la integración con Tiendanube

Regla arquitectónica ya decidida: **Delfino ERP es la fuente de verdad de productos, precios y
stock.** Las plataformas externas reciben.

| Flujo | Dirección |
|---|---|
| Productos | ERP → Tiendanube |
| Precios | ERP → Tiendanube |
| Stock | ERP → Tiendanube (`tnActualizarStock`) |
| **Pedidos** | **Tiendanube → ERP** — el único que empieza afuera |

VERIFICADO: `tnWebhook` **no escribe stock**. Solo registra el pedido en `ordenesTiendaNube`
usando el id externo como id de documento —idempotente por diseño— y deja un log. La regla ya se
cumple hoy.

`js/tiendanube-sync.js` está preparado pero **no conectado**.

Prohibido: que Tiendanube modifique stock en Firestore mientras el ERP lo modifica en Postgres.

## 1.15 Productos, precios y clientes

**Producto.** `costoReferencia` siempre en ARS y sin IVA; `precioVenta` **con IVA incluido**;
`iva` por producto (default 21); `costoModo` (`ultimo` | `promedio`); `modoPrecio`
(`margen` | `manual`); `stockTotal` y `stockReservado` como campos.

**El margen se aplica sobre el costo CON IVA**, no sobre el neto:
`costoConIva = costoReferencia × (1 + iva/100)`, y después el margen y el redondeo
(`entero` | `multiplo_10` | `multiplo_100` | centavos). Criterio consistente en el formulario,
los aumentos masivos y las listas.

**La venta no usa listas de precios.** Toma `producto.precioVenta` directo y el vendedor lo puede
editar en la fila del carrito. Las listas (`listasPrecios` + override en
`productos/{id}/precios/{listaId}`) existen y se usan en otras pantallas.

**Stock.** VERIFICADO: la fuente de verdad es `productos.stockTotal`. La subcolección
`stockPorDeposito` **no la escribe ningún módulo de negocio**: solo se lee y se muestra. Está
muerta. `stockDisponible` es un cálculo de UI que no se persiste. Esto refuerza P1: no hay dos
fuentes desincronizadas que reconciliar, hay una sola real.

**No existe una colección de movimientos de stock.** El movimiento se registra como entrada del
log de auditoría del producto, con `valorAnterior`/`valorNuevo` y el motivo **como string**
(`"Venta #123"`, `"Venta #123 (combo SKU)"`). La pantalla Movimientos es un `collectionGroup`
sobre `logAuditoria`. Sin delta, sin depósito, sin motivo tipado.

**Cliente.** Sin campo de saldo, sin límite de crédito, sin `creadoEn`. La cuenta corriente es
**100 % derivada**: `calcularCuentaCorriente` lee todas las ventas, todos los cobros y todos los
comprobantes del cliente —**las tres queries sin `limit`**— y calcula
`saldo = facturado − notasCrédito − pagado`. El `montoPendiente` guardado en la venta no se usa
para el saldo. Diseñado para ~31.000 clientes reales; la búsqueda usa `searchKeywords` con
`array-contains` y scoring de relevancia.

**Contrato con fuga de tipo Firestore:** `listarAsientosPagina` devuelve un `DocumentSnapshot`
como `cursor` y espera recibirlo de vuelta. Es la única fuga en el contrato público del dominio
de la PoC, y hay que reemplazarla por un cursor opaco antes de migrar. Segundo detalle:
`actualizarCliente` **no hace merge parcial** — pisa lo que no venga en `datosContacto`.

---

# Parte 2 — Arquitectura propuesta

## 2.1 Principio

Cadena objetivo, según la decisión "PostgreSQL como última barrera":

```
UI → Adapter/Repository → Backend API → Servicio de dominio → Transacción PostgreSQL
   → constraints / locks / invariantes → COMMIT
```

La UI valida para experiencia. El backend revalida las reglas de negocio. PostgreSQL es la última
barrera de las invariantes que puedan garantizarse en la base. Una operación crítica no queda
guardada a medias.

**La UI no debe necesitar saber si la persistencia final es Firestore o PostgreSQL.**

## 2.2 Por qué la migración es viable en 32 archivos

La frontera que la decisión del adaptador pide construir **ya existe casi entera**: la UI no toca
Firestore, y `js/firebase.js` es el único acceso al SDK. El adaptador se interpone ahí, y cada
módulo de `js/` migra de a uno, conservando su firma exportada. Esas firmas son el contrato: 77
funciones en los 7 módulos del dominio de la PoC, con retorno `{id, ...data}` para un documento y
array para listas.

Ocho funciones son **puras** y migran sin tocarse: `camposBusqueda`, `filtrarProductosLocal`,
`filtrarYOrdenarCandidatosPorNombre`, `calcularRelevanciaCliente`, `normalizarFecha` (con el bug
de UTC corregido), `discriminarIva`, `aplicarRedondeo`, `calcularPrecioLista` y
`cuentaParaDestinoTesoreria`.

## 2.3 Modelo relacional

Base: `backend/db/migrations/0001_esquema_poc.sql` y `0002_venta_servicio.sql`. 17 tablas, 1
vista, 4 funciones, 2 triggers, validados empíricamente contra PostgreSQL 16.15. **No están
aprobados**: su propia cabecera lo dice, y la verificación del director y del auditor sigue
pendiente.

Núcleo que ya está bien resuelto:

- `stock(producto_id, deposito_id, fisico, reservado, disponible GENERATED)` con
  `disponible = fisico − reservado` calculado por la base. Cumple P11 estructuralmente: no hay
  tres saldos independientes que puedan desincronizarse.
- `reservas` con `cantidad_pendiente` generada, `cantidad` acumulada, y CHECK
  `consumida + liberada <= cantidad`. Trazabilidad completa por P11.
- `asiento_balanceado_trg`: constraint trigger `DEFERRABLE INITIALLY DEFERRED`. Un asiento
  desbalanceado **no puede llegar al COMMIT**, ni armado en varias sentencias.
- `siguiente_numero()` dentro de la transacción de la operación: sin números quemados (R10).
- `idempotency_keys.clave` como PK y `ventas.idempotency_key` UNIQUE: cierra el TOCTOU de 1.6.
- `pedido_editable()` con `SELECT ... FOR UPDATE`: cierra la carrera FACTURAR vs MODIFICAR.
- Orden de bloqueo ascendente por `(producto_id, deposito_id)`: anti-deadlock, verificado.

### Cambios obligatorios al esquema

| # | Cambio | Origen |
|---|---|---|
| 1 | `crear_venta()` calcula IVA por línea e imputa a **2.1.2** | Decisión Nivel 3 del 2026-09-04, corrige P6 |
| 2 | `venta_pagos` guarda el **destino contable** (`caja`\|`banco`\|`cuentaPorCobrar`) e imputa a 1.1.1 o 1.1.5 | Decisión Nivel 3 del 2026-09-04 |
| 3 | `venta_items` con referencia opcional a la lista de precios usada | P3 |
| 4 | Tabla de historial de costos con origen (`manual`\|`factura_compra`), compra relacionada y motivo | P5 |
| 5 | `movimientos_stock` lo escribe `crear_entrega()`, no la rama `'pendiente'` de `crear_venta()` | ver nota |
| 6 | Funciones de servicio `crear_pedido`, `facturar_pedido`, `crear_entrega` — **no existen** | ALCANCE (B) |
| 7 | `contadores`: `comprobantes_{pv}_{tipo}` continúa; `ventas` y `asientos` arrancan en 0, de modo que la primera operación obtiene el número 1 | P7 resuelta |
| 8 | `fecha_operacion` como `date` local, sin `toISOString()` | P8 + bug de UTC |

Nota sobre el punto 5: una venta pendiente de entrega **no mueve stock físico** —solo reserva—,
así que es correcto que no escriba `movimientos_stock`. El movimiento pertenece a `crear_entrega()`,
que es donde el físico baja de verdad. Lo que falta no es una fila en la rama `'pendiente'`, sino
la función de entrega, que todavía no existe.

Fuera de alcance por decisión: Tesorería (solo se conserva el destino contable), listas de precios
completas (P3), compras, comprobantes fiscales, usuarios y roles.

## 2.6 Un bloqueo conocido para el adaptador

La decisión "Capa Repository/Adapter" pide interponerse entre la UI y la persistencia, y el punto
natural es `js/firebase.js`, que es el único acceso al SDK. Pero ese archivo está en la lista de
los que **solo modifica Gastón**, junto con `build.js`. Además, las páginas cargan desde `dist/`,
así que ningún cambio ahí tiene efecto sin `npm run build`.

Consecuencia: el adaptador se diseña y se prueba sin tocar `js/firebase.js`, y su conexión final
es una acción de Gastón. Hay que resolverlo antes de llegar al paso 5 del plan maestro; no bloquea
nada de los pasos 1 a 4.

## 2.4 Alcance de la PoC

Dos alcances que se evalúan por separado, con GO/ADJUST/NO-GO propio cada uno:

- **Alcance A — migración.** Clientes, productos y venta completa. Se valida por reconciliación
  contra Firestore donde exista contraparte.
- **Alcance B — módulo nuevo.** Pedidos, Reservas y Entregas **completos**. No se valida contra
  Firestore, porque la funcionalidad no existe: se valida contra DECISIONS.md, las invariantes y
  las pruebas del auditor.

Circuitos obligatorios: `Pedido → Reserva → FACTURAR → Venta → Entrega`;
`Pedido → Reserva → Cancelación → Liberación`; `Venta pendiente de entrega → Reserva → Entrega`.

Recordatorio de P11: **FACTURAR** significa convertir un pedido en venta registrada. No significa
emitir un comprobante fiscal ante ARCA, y no puede depender de que ARCA esté activo.

## 2.5 Qué se migra en el corte

Por P9, definitivo: **solo artículos, stock vigente al corte, clientes y proveedores.** Nada de
ventas, compras, cobros, pagos, cuentas corrientes, saldos, asientos, comprobantes ni historiales.
PostgreSQL empieza su propio historial operativo. El stock trasladado es stock inicial: no se
reconstruye reproduciendo compras y ventas anteriores.

Consecuencia útil del relevamiento: como el stock real vive en un solo campo (`stockTotal`) y la
subcolección por depósito está muerta, la migración de stock es un volcado a un depósito principal
único, no una reconciliación entre dos fuentes.
