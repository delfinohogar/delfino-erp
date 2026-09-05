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
| LISTA_PRECIO_OPCIONAL | venta sin lista, venta con lista, y dos líneas de la misma venta con listas distintas | la venta sin lista da **exactamente** el mismo resultado que antes de 0004; con lista se guarda la referencia por línea y **no** se deriva el precio de ella; una lista inactiva no bloquea la venta y una lista ya usada no se puede borrar | P3 |
| HISTORIAL_COSTOS_INMUTABLE | UPDATE, DELETE y TRUNCATE sobre `historial_costos`, por SQL directo | los tres se rechazan en la base (triggers BEFORE); las filas quedan idénticas. También se rechaza el UPDATE que no cambia ningún valor | P5 |
| COSTO_MAESTRO_NO_AUTOMATICO | se registra un costo de compra distinto al del maestro | `productos.costo_referencia` **sigue valiendo lo mismo**, con los dos números en el assert; en modo `promedio` tampoco se pondera; nada toca stock, ventas ni asientos | P5, divergencia deliberada con `js/compras.js` |

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
| MIGRADOR_REPETIBLES_ATOMICIDAD | una repetible de `db/functions/` falla en su segunda sentencia | NO queda registrada en `schema_repetibles`, no deja efectos, las posteriores no se aplican y el reintento la vuelve a intentar (sale != 0 otra vez, no "sin cambios") | TASK-012 accept |
| MIGRADOR_REPETIBLES_HASH_CRLF | la misma repetible pasa de LF a CRLF y de CRLF a LF | el hash no cambia, no hay reaplicación, `aplicada_en` intacto y `prosrc`/`pg_get_functiondef` no contienen `\r` (R32/R33) | TASK-012 accept |
| MIGRADOR_REPETIBLES_REAPLICACION | dos corridas sin cambios; después cambia un byte de una sola repetible | la segunda corrida no reaplica nada; el cambio reaplica **solo** ese archivo y las demás conservan hash y `aplicada_en` | TASK-012 accept |
| MIGRADOR_REPETIBLES_ORDEN | una repetible consulta una tabla que crea la última numerada | se aplica sin error: las repetibles corren siempre después de todas las numeradas, y entre sí en orden alfabético, solo `.sql` | TASK-012 accept |
| MIGRADOR_REPETIBLES_DIRECTORIO | `db/functions/` no existe, y `db/functions/` vacío | el migrador sale 0 en los dos casos, informa "Repetibles: sin cambios" y crea `schema_repetibles` vacía | TASK-012 accept |
| MIGRADOR_REPETIBLES_CONCURRENCIA | cuatro migradores en paralelo con repetibles pendientes | todos salen 0; `schema_repetibles` queda con una fila por archivo y en total se aplica cada una **una sola vez** (mismo `pg_advisory_lock` que las numeradas) | TASK-012 accept |
| MIGRADOR_FLAGS | `--estad`, `--marcar-aplicada`, `--estado=1`, `-e`, `--ayuda`, un posicional suelto, `--Estado`, argumento vacío, y `--estado --marcar-aplicadas` juntos | exit 1, lista los flags válidos, dice que no aplicó nada y **no crea ni una relación** en la base; `--estado` solo crea las dos tablas de control vacías, que es lo que declara `backend/README.md` (R14) | TASK-012 accept |
| MIGRADOR_REPETIBLES_CONVENCIONES | `--marcar-aplicadas` con repetibles pendientes; una repetible borrada del disco | el baseline registra nombre y hash sin ejecutar el SQL; la borrada deja fila huérfana que `--estado` reporta y el migrador no falla ni borra la función | TASK-012, convenciones a confirmar |

---

## Bloque G — El seed del emulador (TASK-013, R16)

Tampoco son invariantes de negocio: son propiedades de `scripts/seed-emulator.mjs`. La razón de
que existan es que R16 fue un borrado de datos de hecho —el ERP local dejó de tener con qué
loguearse porque el seed sembraba en un namespace que el ERP no mira— y porque la tarea agrega un
modo que **borra**.

Cómo se miden, para que se pueda auditar sin repetir el trabajo: el seed se corre como proceso
hijo con el entorno armado a mano, y los modos que hablan por REST se corren contra un **emulador
falso** (`tests/herramientas/emulador-falso.mjs`) que anota cada pedido. Como el projectId viaja
en la **ruta** de cada llamada, la lista de URLs *es* el alcance de lo que el seed puede tocar: no
hay que borrar nada para saber qué habría borrado.

| ID | Caso | Resultado esperado | Origen |
|---|---|---|---|
| SEED_PROYECTO_UNICO | `js/firebase-config.js` con uno, con ninguno, con dos distintos, con dos iguales, y ausente | con exactamente uno lo usa; con ninguno o con dos aborta nombrando cuántos encontró; con dos iguales no hay ambigüedad; ausente aborta nombrando el archivo. El valor **no** está hardcodeado: con un projectId inventado en una copia, el seed nombra ese | TASK-013 accept |
| SEED_PROYECTO_COINCIDE | `GCLOUD_PROJECT` o `GOOGLE_CLOUD_PROJECT` fuerzan otro proyecto | aborta con exit 1, nombra **los dos** valores y la variable culpable, explica qué hacer, y no le manda **ni un pedido** al emulador | TASK-013 accept |
| SEED_BARRERA_EMULADOR | sin variables de emulador, con una sola, y con 13 hosts no locales, en los tres modos | aborta con exit 1 en los 3×15 casos y con cero pedidos. El orden es argumentos → emulador → proyecto, verificado por cuál mensaje sale | TASK-013 accept ("esa barrera no se toca") |
| SEED_BARRIDO_ACOTADO | 23 intentos de apuntar el barrido a `delfino-hogar-erp`: como argumento, con `=`, con `:`, con espacios, en mayúsculas, con sufijos, con travesía de rutas, con homoglifo cirílico, y por cuatro variables de entorno inventadas | **ninguna** URL emitida menciona `delfino-hogar-erp`; todo `/projects/X` tiene X = `demo-delfino`; los únicos DELETE son los dos endpoints de `demo-delfino`. Si `js/firebase-config.js` dijera `demo-delfino`, la limpieza aborta en vez de borrar | TASK-013 accept, punto crítico |
| SEED_LIMPIEZA_NO_AUTOMATICA | sembrar y `--reporte-demo` | cero DELETE emitidos; `demo-delfino` queda como estaba | TASK-013 accept ("nunca automática al sembrar") |
| SEED_REPORTE_DEMO | `demo-delfino` con usuarios de Auth, perfiles y colecciones | informa las tres cosas con su conteo y marca los perfiles sin usuario de Auth, que es el síntoma de R16 | TASK-013 accept |
| SEED_REPORTE_FIEL | `--reporte-demo` contra un namespace **espejado**: `demo-delfino` devuelve los documentos del ERP y CERO usuarios de Auth, que es exactamente lo que ve el script cuando el emulador espeja | el reporte **advierte** en vez de reclamarlos: sale con 0, dice que esos documentos no se pueden dar por propios, nombra la causa (`singleProjectMode`), señala la firma del espejo (N documentos con cero usuarios de Auth), pone el aviso **después** del conteo y **antes** de cualquier invitación a borrar, y no usa ninguna frase que dé lo listado por propio de `demo-delfino` | TASK-013, reapuntada por decisión del director del 2026-09-05 |
| SEED_USUARIO_VISIBLE | sembrar un namespace propio y efímero | quedan `admin@delfino.local` en Auth y `/usuarios/{uid}` con el **mismo uid**, rol administrador, más plan de cuentas, maestros y contadores en 0 | TASK-013 accept |
| SEED_IDEMPOTENTE | dos corridas seguidas | mismo estado, comparado documento por documento salvo el `serverTimestamp` `creadoEn`; mismo uid, sin perfiles duplicados, sin colecciones de más | TASK-013 accept |
| SEED_LIMPIEZA_REAL | `--limpiar-demo-delfino` contra el emulador de verdad, con marcadores propios en `demo-delfino` | `demo-delfino` queda vacío, `delfino-hogar-erp` queda **byte a byte** igual y el namespace efímero del tester sobrevive | TASK-013 accept |
| SEED_SALIDA_LIMPIA | una corrida que hizo su trabajo | tiene que salir con 0. **Hoy `--reporte-demo` con contenido sale 3221226505** (12 de 12 en la medición, y reproducido en las 3 corridas de la suite del 2026-09-05), así que `npm run seed -- --reporte-demo` se ve como una falla aunque el reporte sea correcto | TASK-013, hallazgo del tester |
| SEED_ERP_INTACTO | toda la suite de TASK-013 | la huella completa de `delfino-hogar-erp` —documentos, campos, `createTime`, `updateTime` y usuarios de Auth— es idéntica antes y después | consigna del director |

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

269 tests en el repositorio (corridos y medidos el 2026-09-05, TASK-013, dos corridas seguidas de
cada suite). **269 en verde, 0 en rojo.** Los dos rojos anteriores se cerraron: SEED_SALIDA_LIMPIA
por corrección del implementador (`--reporte-demo` sale 0) y SEED_REPORTE_FIEL por reapuntado de la
invariante —el enunciado viejo medía una propiedad del emulador (`singleProjectMode`), no del seed;
ver DECISIONS.md 2026-09-05 y R35—. Ningún rojo de infraestructura: el emulador y Postgres
respondieron en todas las corridas. Ver TEST_RESULTS.md.

Unitarios (`npm test`): 152 = 41 anteriores + **111 de TASK-013** (71 de
`seed-emulator-barreras`, 31 de `seed-emulator-barrido`, 7 de `seed-emulator-r20` y 2 de
`seed-emulator-reporte-fiel`). Los 111 no tocan la red ni ningún servicio externo: levantan su
propio emulador falso en 127.0.0.1 con puerto efímero.

Unitarios anteriores: 41 = 13 de `backend-pool-entorno` + 10 de `backend-higiene` +
4 de contabilidad + 5 de facturación + **9 de `iva-redondeo`** (aritmética exacta del IVA:
suma de redondeados contra redondeo al final, y verificación de la identidad
`Σ round(neto_i) = total − Σ round(iva_i)`).

Integración: 144 = 117 anteriores + **27 de TASK-012**
(`tests/integration/postgres/migrador_repetibles.test.js`: migraciones repetibles R28 y
validación de flags R14, con tres mutantes del migrador que verifican la propiedad transaccional
y la del hash/CRLF).

Integración anterior: 117 = 101 anteriores + **16 de TASK-013** (`tests/integration/seed-emulator.test.js`;
eran 17 hasta que SEED_REPORTE_FIEL se reapuntó y pasó a los unitarios, donde el espejo se fabrica
de forma determinista sobre el emulador falso).

Integración anterior: 101 = 21 de invariantes contra PostgreSQL
(`tests/integration/postgres/invariantes.test.js`), 25 de IVA, destino de pago y fecha local
(`tests/integration/postgres/iva_destino_y_fecha.test.js`), **33 de listas de precios e historial
de costos** (`tests/integration/postgres/precios_y_costos.test.js`), 18 del migrador
(`tests/integration/postgres/migrador.test.js`) y 4 de aislamiento contra el emulador
(los 4 en verde desde TASK-011).

Cubierto hasta ahora: VENTA_NORMAL, STOCK_INSUFICIENTE, FALLO_INTERMEDIO, DOBLE_ENVIO,
CONTABILIDAD, PAGOS_VENTA, PENDIENTE_CON_CLIENTE, RESERVAS_CONSISTENTES, NO_VENDER_RESERVADO,
NO_CONSUMIR_DE_MAS, CONCURRENCIA, ORDEN_DE_BLOQUEO, INTEGRIDAD_GLOBAL, **IVA_DISCRIMINADO**,
IMPUTACION_PAGOS, FECHA_OPERACION_LOCAL, **LISTA_PRECIO_OPCIONAL**,
**HISTORIAL_COSTOS_INMUTABLE**, **COSTO_MAESTRO_NO_AUTOMATICO** y **HISTORICO_INMUTABLE**
(la parte de IVA desde TASK-002; desde TASK-003, también que registrar un costo nuevo no
modifica la línea ya vendida).

Falta escribir el resto del bloque B (COMBO_CASCADA, REVERSA_NC, REVERSA_NC_UNICA,
NUMERACION_CORTE), la mayor parte del C y todo el D.

**Nota de método, de TASK-002:** en IVA_DISCRIMINADO, Debe = Haber **no** es verificación
suficiente. Con el neto calculado como residuo el asiento cierra igual aunque el centavo esté
mal repartido; hay que comparar el importe imputado a **2.1.2** contra el cálculo por línea
hecho por una vía independiente. Demostrado con la mutación de un centavo de 2.1.2 a 4.1: el
asiento sigue balanceado y el test se pone rojo igual. Ver TEST_RESULTS.md, TASK-002 punto 1.

**Nota de método, de TASK-013:** para probar el alcance de un borrado no hace falta borrar. El
seed le habla al emulador por REST y el projectId viaja en la **ruta**, así que la lista de URLs
que emitió *es* el alcance. Contra un emulador falso que anota los pedidos, "¿puede llegar a
`delfino-hogar-erp`?" se contesta leyendo, con 23 intentos hostiles y cero riesgo. Lo mismo vale
para "la barrera corre antes de tocar nada": no se afirma leyendo el orden de las líneas, se mide
con el contador de pedidos en cero. Ver TEST_RESULTS.md, TASK-013.

**Segunda nota de método, de TASK-013:** un test tiene que medir la unidad que dice medir. El
enunciado viejo de SEED_REPORTE_FIEL exigía que un namespace virgen del emulador diera vacío: eso
depende de `firebase.json` (`singleProjectMode`) y **ningún** cambio en el archivo bajo prueba
—`scripts/seed-emulator.mjs`— podía ponerlo verde ni rojo. Reapuntado a lo que el seed sí controla
(que ante esa entrada advierta en vez de reclamar los documentos como propios), la invariante se
prueba de forma determinista y **discrimina**: con la advertencia puesta pasa, sacada se pone roja.
El comportamiento del emulador no desapareció, se registró como riesgo (R35) en vez de esconderse
en un test rojo permanente. Ver TEST_RESULTS.md, TASK-013 (corrección del 2026-09-05).

**Nota de método, de TASK-003:** una divergencia deliberada con el ERP se prueba por
**comportamiento observable**, no por ausencia de mecanismo. "No hay trigger que pise el costo"
es fácil de fingir y fácil de romper sin que nadie se entere; lo que se fija es que después de
registrar una compra a 715000 el maestro **siga valiendo 600000**, con los dos números en el
assert. Demostrado con tres mutaciones: un trigger AFTER INSERT que pisa el maestro, el UPDATE
de `js/compras.js` metido dentro de `registrar_costo()`, y un solo centavo de más. Las tres
ponen rojo el mismo assert. Ver TEST_RESULTS.md, TASK-003.
