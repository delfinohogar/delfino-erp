# Tareas

Formato obligatorio. Un hook parsea `status:`, `owner:` y `files:`, así que no lo cambies.

    ### TASK-NNN — título
    status: PENDING | IN_PROGRESS | TESTED | IN_REVIEW | REJECTED | APPROVED | DONE | BLOCKED_NIVEL3 | BLOCKED_TECNICO
    owner: implementador
    depends: TASK-…
    files:
    - ruta/o/glob
    accept:
    - criterio verificable

Reglas: una sola tarea IN_PROGRESS por owner; dos tareas nunca comparten archivos en `files:`;
ninguna tarea pasa a DONE sin `migration/approvals/TASK-NNN.approved`.

Este es el **primer lote de FASE 1**: cubre los pasos 1 a 3 del plan maestro (backend mínimo,
esquema al día, servicios de dominio en la base). Las tareas de API, adaptador y shadow se
escriben cuando este lote esté aprobado, para no planificar sobre un esquema que todavía puede
cambiar.

Los tests los escribe el tester en `tests/`, así que `tests/` no aparece en ningún `files:`.
Única excepción: TASK-011, cuyo entregable **es** un test y por eso sí lo declara.

**Orden de ejecución:** TASK-011 va antes que TASK-002. La suite tiene que estar en verde antes
de tocar reglas de negocio: un rojo crónico entrena a ignorar los rojos, y TASK-002 es la primera
tarea cuyo resultado es contable.

---

### TASK-001 — Backend Node mínimo: cliente pg y migrador con versiones
status: DONE
owner: implementador
depends:
files:
- backend/package.json
- backend/src/db/pool.js
- backend/src/db/migrar.js
- backend/README.md
accept:
- `node backend/src/db/migrar.js` aplica en orden alfabético las migraciones de `backend/db/migrations/` y registra cada una en una tabla `schema_migrations` con nombre y fecha
- correrlo dos veces seguidas no reaplica ninguna migración y termina con éxito
- el pool lee `DATABASE_URL` y, en tests, `DATABASE_URL_TEST`; falla con mensaje claro si no hay ninguna
- no abre puertos, no escucha HTTP, no importa firebase
- `npm test` sigue en verde y los 21 tests de invariantes siguen pasando

### TASK-011 — El test de aislamiento se autentica con un usuario efímero propio
status: DONE
owner: tester
depends: TASK-001
files:
- tests/integration/safety.test.js
accept:
- el test se autentica contra el emulador de Auth antes de escribir, y pasa por `firestore.rules`, igual que hace el ERP real
- **el test no toca `admin@delfino.local` en ningún camino de ejecución**: crea su propio usuario efímero `safety-<uuid>@test.local` con password aleatoria por corrida, lo usa y lo borra. Un test no puede dejar a Gastón sin acceso a su entorno local si falla a la mitad (decisión de Gastón 2026-09-04, el auditor coincide y la hace bloqueante)
- el perfil del usuario efímero usa el rol mínimo suficiente (`vendedor`, no `administrador`) y **no** escribe el campo `nombre`, para que un huérfano no aparezca en el listado de `js/usuarios.js`
- `afterAll` solo borra lo que esta corrida creó, con un flag seteado **después** de que `createUser` devolvió: ninguna rama puede borrar un uid que el test no creó
- prueba obligatoria de falla a la mitad: con un `throw` inyectado en cuatro puntos del `beforeAll`, en las cuatro corridas `admin@delfino.local` sigue existiendo, su perfil conserva su `rol`, el login `admin@delfino.local` / `delfino-dev` sigue respondiendo 200 —verificado de verdad, no por lectura del código— y no queda ningún `clientes/safety-check-*`
- barrido de huérfanos al empezar: elimina los `safety-*@test.local` de corridas anteriores, matchea por el patrón exacto, **nunca** puede alcanzar a `admin@delfino.local`, y con cero coincidencias no lanza
- dos corridas seguidas dejan `/usuarios` y `/clientes` con exactamente los mismos documentos que antes de la primera, por comparación explícita
- la demostración de que el test **puede fallar** sigue en pie con el usuario efímero: la mutación de aislamiento sigue dando ROJO con "AISLAMIENTO ROTO", y un rol sin permiso sigue dando `PERMISSION_DENIED` (R20)
- R17 y R18 quedan marcados en RISKS.md como ELIMINADOS, no mitigados, con la fecha
- **no se modifica `firestore.rules`**: agregar una regla a producción para que pase un test es la salida equivocada
- la escritura de prueba va a una colección que las reglas ya contemplan para un usuario logueado; `_safety` no existe en las reglas y no se inventa
- el test sigue probando lo que dice probar: que la escritura **va al emulador** y no puede llegar a producción. Si el aislamiento se rompe, el test falla
- el test es autosuficiente: no depende de que alguien haya corrido `npm run seed` antes, ni de qué `projectId` usó el seed
- el dato de prueba que escribe se borra al terminar, o se escribe en un id propio que no ensucia la base del emulador
- los 4 tests de `safety.test.js` en verde, y la suite completa sin ningún rojo
- no se toca ningún otro test ni código de aplicación

### TASK-012 — Validación de flags del migrador (R14)
status: PENDING
owner: implementador
depends: TASK-011
files:
- backend/src/db/migrar.js
- backend/README.md
accept:
- un argumento desconocido o mal tipeado **aborta con exit distinto de 0** y lista los flags válidos; nunca cae silenciosamente en el modo que aplica migraciones
- caso concreto que hoy falla: `node backend/src/db/migrar.js --estad` no debe aplicar nada
- `--estado` no crea la tabla `schema_migrations`, o el README deja de afirmar que "no escribe esquema": el código y la documentación tienen que coincidir
- `--marcar-aplicadas` sigue exigiendo el string exacto y sigue sin tener abreviatura
- las migraciones existentes no se modifican y los tests de TASK-001 siguen en verde
- se actualiza R14 en RISKS.md como mitigado, con la fecha

### TASK-013 — El seed apunta al proyecto del emulador, o falla claro (R16)
status: PENDING
owner: implementador
depends: TASK-011
files:
- scripts/seed-emulator.mjs
accept:
- el default de `projectId` es `delfino-hogar-erp`, el mismo que usan `npm run emulators`, `npm run test:integration` y `js/firebase-config.js`; ya no `demo-delfino`
- si el proyecto que va a usar el seed **no coincide** con el del emulador al que se conecta, aborta con un mensaje que nombre los dos valores y explique qué hacer; nunca siembra en silencio en un namespace que el ERP no mira
- el seed sigue abortando si las variables de emulador no están o no son locales: esa barrera no se toca
- correrlo deja el usuario `admin@delfino.local` y su perfil en `/usuarios/{uid}` **visibles para el ERP local**, que es el síntoma que originó R16
- correrlo dos veces seguidas sigue siendo idempotente
- R16 queda actualizado en RISKS.md como mitigado, con la fecha

### TASK-002 — Migración 0003: IVA discriminado, destino de pago y fecha local
status: PENDING
owner: implementador
depends: TASK-001, TASK-011
files:
- backend/db/migrations/0003_iva_y_destino_pago.sql
accept:
- `productos` tiene columna `iva numeric` con default 21 y CHECK `>= 0`
- `venta_pagos` tiene `destino_contable text` con CHECK en (`caja`, `banco`, `cuentaPorCobrar`)
- `crear_venta()` calcula `iva_pct` e `iva_monto` por línea restando hacia atrás sobre el precio, que ya incluye IVA, y llena `ventas.iva_total`
- el asiento imputa el neto a 4.1 y el IVA a 2.1.2; cada pago a 1.1.1 o 1.1.5 según su destino; el pendiente a 1.1.2
- el asiento cierra Debe = Haber en todos los casos, incluido el de alícuotas mixtas 21 % y 10,5 %
- invariantes IVA_DISCRIMINADO e IMPUTACION_PAGOS de TEST_MATRIX.md
- si algún test existente asumía IVA en cero, el implementador lo reporta y NO lo modifica: los tests son del tester
- `ventas.fecha_operacion` es `date` en hora local, nunca derivada de `toISOString()`: una venta registrada a las 21:00 hora Argentina queda con la fecha de ese día y no con la del día siguiente (cambio 8 de ARCHITECTURE §2.3, P8 + bug de UTC)

### TASK-003 — Migración 0004: lista de precios en la venta e historial de costos
status: PENDING
owner: implementador
depends: TASK-002
files:
- backend/db/migrations/0004_precios_y_costos.sql
accept:
- tabla `listas_precios` con `nombre` único, `regla_margen`, `regla_redondeo`, `activa`
- `venta_items.lista_precio_id` nullable, FK a `listas_precios`; la venta sigue funcionando sin lista, que es el comportamiento de P3
- tabla `historial_costos` con producto, costo anterior, costo nuevo, fecha, usuario, `origen` CHECK en (`manual`, `factura_compra`), compra relacionada nullable, método de costeo y motivo
- `historial_costos` es inmutable: un UPDATE o un DELETE sobre una fila existente se rechaza
- el esquema NO recalcula el costo maestro automáticamente en ninguna operación (P5)

### TASK-004 — Migración 0005: contadores del corte
status: PENDING
owner: implementador
depends: TASK-003
files:
- backend/db/migrations/0005_contadores_corte.sql
accept:
- existe un contador por punto de venta y tipo de comprobante, con la forma `comprobantes_{pv}_{tipo}`, y `siguiente_numero()` lo soporta
- los contadores `ventas` y `asientos` arrancan en 0, de modo que la primera operación obtiene el número 1 (P7)
- existe una función o procedimiento para fijar el valor inicial de un contador de comprobantes al hacer el corte, y deja constancia de quién y cuándo
- invariante NUMERACION_CORTE de TEST_MATRIX.md

### TASK-005 — Servicio `crear_pedido`: pedido confirmado que reserva sin vender
status: PENDING
owner: implementador
depends: TASK-004
files:
- backend/db/migrations/0006_crear_pedido.sql
accept:
- `crear_pedido()` es una sola transacción: pedido, líneas, reservas y `stock.reservado`, todo o nada
- bloquea `stock` con `SELECT … FOR UPDATE` ordenado por `(producto_id, deposito_id)` ascendente antes de tocar `reservas`
- no genera venta y no descuenta stock físico (P11)
- rechaza reservar más que el disponible
- idempotente por `pedidos.idempotency_key`
- invariantes RESERVAS_CONSISTENTES, DISPONIBLE_DERIVADO, NO_VENDER_RESERVADO y ORDEN_DE_BLOQUEO

### TASK-006 — Servicio `modificar_pedido`: edición atómica con ajuste de reservas
status: PENDING
owner: implementador
depends: TASK-005
files:
- backend/db/migrations/0007_modificar_pedido.sql
accept:
- permite agregar y quitar productos, subir y bajar cantidades, y cambiar precio y descuento, mientras el pedido no se haya convertido en venta (Q1)
- bajar una cantidad libera exactamente la diferencia y vuelve al disponible en el acto
- subir o agregar exige y reserva el disponible adicional
- si algún aumento o alta no tiene disponible, la modificación **completa** se rechaza y el pedido queda exactamente como estaba
- quitar un producto marca `quitado_en` y libera la cantidad pendiente; **nunca borra la fila**
- `reservas.cantidad` solo crece; las reducciones incrementan `cantidad_liberada`
- invariantes MODIFICACION_PEDIDO_ATOMICA, MODIFICACION_LIBERA, LINEA_NO_SE_BORRA y PEDIDO_RESERVA_COHERENTE

### TASK-007 — Servicio `facturar_pedido`: convertir pedido en venta sin doble reserva
status: PENDING
owner: implementador
depends: TASK-006
files:
- backend/db/migrations/0008_facturar_pedido.sql
accept:
- FACTURAR convierte el pedido en una venta registrada; **no** emite comprobante fiscal y **no** depende de ARCA (P11)
- la mercadería ya reservada NO se vuelve a reservar, NO baja de nuevo el disponible y NO se descuenta dos veces del físico
- caso probado: físico 10, pedido 2, se factura sin retirar → físico 10, reservado 2, disponible 8
- un pedido se convierte completo en una única venta; el segundo intento se rechaza por la constraint única sobre `pedidos.venta_id` (Q2)
- si al facturar también se retira, se consume la reserva y se descuenta el físico en la misma transacción
- bloquea la fila del pedido con `SELECT … FOR UPDATE` y el guard rechaza modificar un pedido ya facturado
- invariantes NO_DOBLE_RESERVA_AL_FACTURAR, UN_PEDIDO_UNA_VENTA y FACTURAR_VS_MODIFICAR

### TASK-008 — Servicio `crear_entrega`: consumo de reserva y baja del físico
status: PENDING
owner: implementador
depends: TASK-007
files:
- backend/db/migrations/0009_crear_entrega.sql
accept:
- consume la reserva y descuenta el físico en una sola transacción, y escribe `movimientos_stock` con motivo `entrega`
- admite entrega parcial: venta de 5, se retiran 2 → entregado 2, pendiente 3, las 3 siguen reservadas
- rechaza entregar más unidades que las correspondientes y consumir más de lo reservado
- el estado de entrega de la venta se **deriva** de sus reservas, no es un campo que alguien escriba
- idempotente por `entregas.idempotency_key`
- invariantes ENTREGA_PARCIAL, NO_CONSUMIR_DE_MAS y ESTADO_ENTREGA_DERIVADO

### TASK-009 — Servicio `cancelar_pedido`: liberación sin tocar el físico
status: PENDING
owner: implementador
depends: TASK-008
files:
- backend/db/migrations/0010_cancelar_pedido.sql
accept:
- libera la cantidad pendiente de todas las reservas del pedido y deja el físico sin cambios
- el pedido queda en estado `cancelado` y no se puede facturar después
- ningún proceso libera reservas por vencimiento de `valido_hasta`: sigue siendo informativo (Q3)
- no deja reservas activas de pedidos cancelados
- invariantes CANCELACION_LIBERA y VENCIMIENTO_NO_LIBERA

### TASK-010 — Servicio `revertir_venta`: reversa por nota de crédito
status: PENDING
owner: implementador
depends: TASK-009
files:
- backend/db/migrations/0011_revertir_venta.sql
accept:
- devuelve el stock de la venta y genera un asiento espejado con los mismos montos y debe/haber invertidos
- la venta original NO se modifica
- idempotente por venta: una venta se revierte una sola vez, y el segundo intento devuelve el resultado del primero sin volver a tocar stock
- si la venta tenía reservas pendientes, se liberan
- invariantes REVERSA_NC y REVERSA_NC_UNICA

---

## Pendiente de resolver antes del paso 5 del plan maestro

El adaptador tiene que interponerse en `js/firebase.js`, que solo modifica Gastón, y las páginas
cargan desde `dist/`, así que nada tiene efecto sin `npm run build`. Se diseña y se prueba sin
tocar ese archivo; la conexión final es una acción de Gastón. No bloquea las tareas 001 a 010.
