# Matriz de tests

Las invariantes tienen **nombre fijo**: se usan tal cual en los nombres de los tests y el auditor
las cita en sus veredictos. Cambiar un nombre invalida los veredictos que lo citan.

La inició el director en FASE 0 a partir del relevamiento y de DECISIONS.md. Desde FASE 1 la
mantiene el tester. (Es convención de trabajo, no barrera técnica: ver R12.)

Cada invariante indica su origen, para que el auditor pueda rastrear por qué existe.

---

## Bloque A — Venta (alcance A: migración)

| ID | Caso | Resultado esperado | Origen |
|---|---|---|---|
| VENTA_NORMAL | stock 5, venta 2 | stock 3; venta, ítems, pago, asiento balanceado y movimiento de stock creados | base |
| STOCK_INSUFICIENTE | stock 1, venta 2 | rechazada; stock 1; sin venta, sin pago, sin asiento, sin movimiento | base |
| FALLO_INTERMEDIO | falla el asiento, y por separado falla el registro de pagos | rollback total: stock, venta y pagos no existen; el contador también revierte | base + R1 |
| DOBLE_ENVIO | misma clave de idempotencia, dos veces | una sola venta; la segunda devuelve el resultado de la primera | base |
| CONCURRENCIA | dos vendedores, última unidad, simultáneo | exactamente una confirmada; stock 0; la otra STOCK_INSUFICIENTE | base + R1 |
| CONTABILIDAD | cualquier asiento generado | Debe = Haber, redondeo a centavos | base |
| COMPROBANTES | 100 comprobantes concurrentes | 100 números distintos y consecutivos | base |
| CTA_CTE | venta con saldo pendiente | saldo del cliente = total − cobros | base |
| PAGOS_VENTA | suma de pagos reales + monto pendiente | = total de la venta. Los pagos no pueden superar el total | [GASTÓN] "Pendiente de pago" no es medio de pago |
| PENDIENTE_CON_CLIENTE | venta con `monto_pendiente > 0` y sin cliente | rechazada por constraint | P2 |
| HISTORICO_INMUTABLE | cambia el precio o el costo del producto después de vender | la venta histórica no se modifica: conserva precio, costo, descuento, IVA y subtotal de la línea | P4 |

## Bloque B — Invariantes nuevas de esta FASE 0

| ID | Caso | Resultado esperado | Origen |
|---|---|---|---|
| IVA_DISCRIMINADO | venta de un producto con IVA 21 % y otro con 10,5 % | cada línea guarda `iva_pct` e `iva_monto` reales, no cero; el asiento imputa el IVA a **2.1.2** y el neto a **4.1**; neto + IVA = total | Decisión 2026-09-04, corrige P6 |
| IMPUTACION_PAGOS | venta pagada con efectivo, tarjeta y saldo pendiente | el pago con destino `caja`/`banco` imputa a **1.1.1**; el de destino `cuentaPorCobrar` a **1.1.5**; el pendiente a **1.1.2**; el asiento cierra | Decisión 2026-09-04, Tesorería |
| COMBO_CASCADA | combo de 2 componentes (1 y 3 unidades), se venden 2 combos | el combo **no** descuenta stock propio; cada componente baja 2 y 6; un movimiento de stock por componente; el ítem de la venta sigue siendo el combo | relevamiento 1.8 |
| REVERSA_NC | nota de crédito sobre una venta ya registrada | stock devuelto (combos expandidos igual que al vender); asiento espejado con los mismos montos y debe/haber invertidos; la venta original **no se modifica** | relevamiento 1.9 |
| REVERSA_NC_UNICA | dos reversas de la misma venta | la segunda devuelve el resultado de la primera; el stock se devuelve una sola vez | relevamiento 1.9 |
| FECHA_OPERACION_LOCAL | venta cargada a las 21:00 hora argentina | `fecha_operacion` es **ese** día, no el siguiente; `creado_en` conserva el instante real | P8 + bug de UTC |
| NUMERACION_CORTE | arranque de la base nueva | `comprobantes_{pv}_{tipo}` continúa desde su último valor; `ventas` y `asientos` arrancan en 1 | P7 resuelta |

## Bloque C — Pedidos, reservas y entregas (alcance B: módulo nuevo)

No se valida contra Firestore: la funcionalidad no existe ahí. Se valida contra DECISIONS.md.

| ID | Caso | Resultado esperado | Origen |
|---|---|---|---|
| RESERVAS_CONSISTENTES | en todo momento | `stock.reservado` = suma de `reservas.cantidad_pendiente` de ese producto y depósito | P11 |
| DISPONIBLE_DERIVADO | cualquier estado | `disponible = fisico − reservado`, calculado por la base, nunca almacenado aparte | P11 |
| NO_VENDER_RESERVADO | físico 1, reservado 1, se intenta vender 1 | rechazada: el disponible es 0 | P11 |
| NO_DOBLE_RESERVA_AL_FACTURAR | físico 10, pedido 2, se factura sin retirar | físico 10, reservado 2, disponible 8 — **no** 4 ni 6. Al entregar: físico 8, reservado 0, disponible 8 | P11, regla crítica |
| UN_PEDIDO_UNA_VENTA | se intenta facturar dos veces el mismo pedido | rechazado por constraint única sobre `pedidos.venta_id` | Q2 |
| MODIFICACION_PEDIDO_ATOMICA | modificación que sube dos líneas y una no tiene disponible | la modificación **completa** se rechaza; el pedido queda exactamente como estaba | Q1 |
| MODIFICACION_LIBERA | se baja la cantidad de una línea | libera exactamente la diferencia, que vuelve al disponible en el acto | Q1 |
| LINEA_NO_SE_BORRA | se quita un producto del pedido | se marca `quitado_en` y se libera su reserva; la fila no se borra | [NIVEL 2] las líneas de pedido no se borran |
| PEDIDO_RESERVA_COHERENTE | línea que baja y vuelve a subir | `reservas.cantidad` solo crece; `cantidad_pendiente` es lo que retiene stock; `consumida + liberada <= cantidad` | [NIVEL 2] cantidad acumulada |
| VENCIMIENTO_NO_LIBERA | pedido pasado su `valido_hasta` | aparece como vencido en la vista; **ninguna** reserva se libera automáticamente | Q3 |
| CANCELACION_LIBERA | se cancela un pedido confirmado | se libera la cantidad pendiente; el físico no cambia | P11 |
| ENTREGA_PARCIAL | venta de 5, se retiran 2 | entregado 2, pendiente 3, las 3 siguen reservadas; después se retiran las 3 y la entrega se completa | Q2 |
| NO_CONSUMIR_DE_MAS | se intenta consumir o liberar más de lo reservado | rechazado por constraint | P11 |
| ESTADO_ENTREGA_DERIVADO | venta con reservas | `entregado` si ninguna reserva tiene pendiente; `pendiente` mientras quede algo. No es un campo que alguien escribe | [NIVEL 2] estado derivado |
| ORDEN_DE_BLOQUEO | dos transacciones cruzadas sobre dos productos | sin deadlock: ambas bloquean `stock` por `(producto_id, deposito_id)` ascendente | [NIVEL 2] orden de bloqueo |
| FACTURAR_VS_MODIFICAR | facturar y modificar el mismo pedido en paralelo | la modificación sobre un pedido ya facturado se rechaza. El lock solo NO alcanza: hace falta el guard | [NIVEL 2] guard, verificado empíricamente |

## Bloque D — El trigger de asiento balanceado

La REGLA está aprobada; **la implementación no**. El auditor debe probar como mínimo estos ocho
escenarios antes de aprobar el trigger.

| ID | Escenario |
|---|---|
| TRG_MULTI_SENTENCIA | asiento armado en varias sentencias dentro de una transacción |
| TRG_DESBALANCEADO_COMMIT | asiento desbalanceado: falla al COMMIT, no antes |
| TRG_ROLLBACK | rollback deja la base sin rastro |
| TRG_UPDATE | un UPDATE posterior no puede desbalancear un asiento confirmado |
| TRG_DELETE | un DELETE posterior tampoco |
| TRG_MULTIPLES | varios asientos en una misma transacción |
| TRG_CONCURRENCIA | asientos concurrentes |
| TRG_DIFERIDAS | comportamiento de las restricciones diferidas |

## Bloque E — Integridad global

| ID | Caso | Resultado esperado |
|---|---|---|
| INTEGRIDAD_GLOBAL | tras N operaciones exitosas y M fallidas | cero asientos huérfanos, cero ventas sin ítems, cero ventas sin asiento, cero desbalances, cero inconsistencias de reserva |

---

## Bloque F — Infraestructura del backend (TASK-001)

No son invariantes de negocio: son propiedades del migrador y del cliente `pg`. Los IDs son de
uso del tester y no se citan en veredictos contables.

| ID | Caso | Resultado esperado | Origen |
|---|---|---|---|
| MIGRADOR_IDEMPOTENCIA | dos y tres corridas seguidas contra la misma base | la segunda no reaplica nada, sale 0 y no reescribe `aplicada_en`; `schema_migrations` queda con una fila por migración, con nombre y fecha | TASK-001 accept |
| MIGRADOR_ORDEN_ALFABETICO | migraciones cuyo orden alfabético difiere del orden en disco | se aplican en orden alfabético; se demuestra por el contenido de `schema_migrations`, no por la consola | TASK-001 accept |
| MIGRADOR_ATOMICIDAD | una migración falla en su segunda sentencia | NO queda registrada en `schema_migrations`, su efecto parcial no persiste, las posteriores no se aplican y el reintento la vuelve a intentar | TASK-001, propiedad central |
| MIGRADOR_CONCURRENCIA | cuatro migradores en paralelo contra una base limpia | todos salen 0; cada migración se aplica exactamente una vez (`pg_advisory_lock`) | TASK-001 accept |
| MIGRADOR_VARIABLES_ENTORNO | sin `DATABASE_URL` ni `DATABASE_URL_TEST`; y fuera de tests con solo `DATABASE_URL_TEST` | falla con mensaje claro y exit 1; fuera de tests **nunca** cae en la base de tests | TASK-001 accept |
| MIGRADOR_BASELINE | `--marcar-aplicadas` | marca sin ejecutar; nunca se dispara solo en una corrida normal | TASK-001 |
| BACKEND_HIGIENE | importar `pool.js` y `migrar.js` | no importan firebase, no abren puertos, no escuchan HTTP y no tienen efectos al importarse | TASK-001 accept |

---

## Estado por adaptador

| Invariante | Firestore (actual) | Postgres (nuevo) |
|---|---|---|
| FALLO_INTERMEDIO | **known-failing** (R1) | debe pasar |
| CONCURRENCIA | **known-failing** (R1) | debe pasar |
| DOBLE_ENVIO | **known-failing** por el TOCTOU de 1.6 | debe pasar |
| NUMERACION_CORTE | **known-failing**: los contadores queman números (R10) | debe pasar |
| FECHA_OPERACION_LOCAL | **known-failing**: `normalizarFecha` corre el día por UTC | **pasa** (TASK-002) |
| IVA_DISCRIMINADO | pasa: el código ya lo hace | **pasa** (TASK-002) |
| IMPUTACION_PAGOS | pasa: `cuentaParaDestinoTesoreria` ya rutea | **pasa** (TASK-002) |
| Bloque C completo | **no aplica**: la funcionalidad no existe en Firestore | debe pasar |
| resto del bloque A | por verificar en FASE 1 | debe pasar |

**PROHIBIDO** modificar la implementación Firestore para conseguir una suite verde. Un
known-failing no es una regresión: es la razón de la migración.

## Qué NO se puede probar en esta PoC

- **Consistencia entre los pagos de una venta y los movimientos de Tesorería.** Tesorería queda
  fuera de la PoC por decisión del 2026-09-04: no hay movimientos que comparar. Se reemplaza por
  IMPUTACION_PAGOS, que verifica que cada pago vaya a la cuenta contable correcta según su
  destino. La invariante completa vuelve cuando se construya Tesorería.
- **Listas de precios.** P3 mantiene el comportamiento actual; solo se prueba que la venta guarde
  la referencia opcional a la lista.
- **Comprobantes fiscales.** ARCA queda apagado y fuera de alcance.

## Estado actual de la suite

109 tests en el repositorio (actualizado 2026-09-04, TASK-002), todos en verde.

Unitarios (`npm test`): 41 = 13 de `backend-pool-entorno` + 10 de `backend-higiene` +
4 de contabilidad + 5 de facturación + **9 de `iva-redondeo`** (aritmética exacta del IVA:
suma de redondeados contra redondeo al final, y verificación de la identidad
`Σ round(neto_i) = total − Σ round(iva_i)`).

Integración: 68 = 21 de invariantes contra PostgreSQL
(`tests/integration/postgres/invariantes.test.js`), **25 de IVA, destino de pago y fecha local**
(`tests/integration/postgres/iva_destino_y_fecha.test.js`), 18 del migrador
(`tests/integration/postgres/migrador.test.js`) y 4 de aislamiento contra el emulador
(los 4 en verde desde TASK-011).

Cubierto hasta ahora: VENTA_NORMAL, STOCK_INSUFICIENTE, FALLO_INTERMEDIO, DOBLE_ENVIO,
CONTABILIDAD, PAGOS_VENTA, PENDIENTE_CON_CLIENTE, RESERVAS_CONSISTENTES, NO_VENDER_RESERVADO,
NO_CONSUMIR_DE_MAS, CONCURRENCIA, ORDEN_DE_BLOQUEO, INTEGRIDAD_GLOBAL, **IVA_DISCRIMINADO**,
**IMPUTACION_PAGOS**, **FECHA_OPERACION_LOCAL** y la parte de IVA de **HISTORICO_INMUTABLE**.

Falta escribir el resto del bloque B (COMBO_CASCADA, REVERSA_NC, REVERSA_NC_UNICA,
NUMERACION_CORTE), la mayor parte del C y todo el D.

**Nota de método, de TASK-002:** en IVA_DISCRIMINADO, Debe = Haber **no** es verificación
suficiente. Con el neto calculado como residuo el asiento cierra igual aunque el centavo esté
mal repartido; hay que comparar el importe imputado a **2.1.2** contra el cálculo por línea
hecho por una vía independiente. Demostrado con la mutación de un centavo de 2.1.2 a 4.1: el
asiento sigue balanceado y el test se pone rojo igual. Ver TEST_RESULTS.md, TASK-002 punto 1.
