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

## Regla permanente: los archivos se editan con Edit, nunca por shell

Vale para **todos** los roles, incluido el director. Nada de `python -c`, `sed -i`, `cp`,
redirecciones ni heredocs para modificar archivos del repositorio. Si el archivo existe, se edita
con **Edit**; si es nuevo, con **Write**.

**Excepción por herramientas, no por criterio:** el rol **auditor** no tiene `Edit` en su conjunto
de herramientas — solo `Read`, `Grep`, `Glob`, `Bash` y `Write`. Para archivos nuevos usa `Write`;
para agregar al final de uno existente, la shell es su única vía. Eso es aceptable **solo para
agregar**, nunca para reescribir líneas previas, y el commit tiene que mostrarlo (`N insertions,
0 deletions`). Detectado el 2026-09-05: la regla se había escrito para todos los roles sin
verificar que todos pudieran cumplirla.

Tres motivos, y los tres son consecuencia de cosas que ya pasaron acá:

1. **Le saca al guard su única señal.** Una escritura por shell sobre una ruta protegida no se
   distingue de una maliciosa: el hook ve un comando de shell, no una edición de archivo. Un guard
   que se elude cambiando de herramienta no es una barrera.
2. **Le saca a Gastón el diff.** Editar por shell le quita la posibilidad de ver qué cambia antes
   de aprobarlo. La revisión deja de ser revisión.
3. **Vacía los permisos de contenido.** El 2026-09-04 se levantó el `deny` de
   `scripts/seed-emulator.mjs` **precisamente** para que el implementador pudiera usar `Edit`. Si
   igual lo edita por shell, el permiso no cambió nada: el archivo se modifica por un canal que el
   sistema de permisos no mira.

Aplica también a los archivos de `migration/`, que son del director. Estuvo mal hecho hasta el
2026-09-04 y se corrige desde acá.

## Aprobación completa vs. aprobación con salvedades

Una auditoría que no llegó a verificar todo **no vale lo mismo** que una completa, y la diferencia
tiene que verse en el **estado de la tarea**, no solo en el texto del archivo. Regla, decidida el
2026-09-04:

| Resultado del auditor | Archivo que escribe | Estado | ¿Merge? | ¿DONE? |
|---|---|---|---|---|
| Verificó todo | `TASK-NNN.approved` | APPROVED → DONE | sí | sí |
| Verificó parte | `TASK-NNN.approved-parcial.md` | **APPROVED, y ahí se queda** | sí | **no** |
| Rechaza | `TASK-NNN.rejected-N.md` | REJECTED | no | no |

**Esto es una barrera, no una convención.** El hook bloquea DONE con un `Test-Path` exacto sobre
`migration/approvals/TASK-NNN.approved`; un archivo llamado `.approved-parcial.md` no lo
satisface, así que el intento de marcar DONE **falla solo**, sin depender de que alguien se
acuerde. Es el mismo principio que venimos aplicando: si se puede eludir olvidándolo, no es una
barrera.

Con salvedades, además: el director **crea en el acto** una tarea de verificación que enumera
**qué quedó sin reproducir**, con `depends:` de la tarea original, y la tarea original queda en
APPROVED —mergeada pero visiblemente incompleta— hasta que el auditor escriba el `.approved`
definitivo. Se permite el merge porque la cadena es lineal y frenarla entera por una verificación
pendiente cuesta más de lo que protege; lo que no se permite es que la tarea **parezca** cerrada.

Este es el **primer lote de FASE 1**: cubre los pasos 1 a 3 del plan maestro (backend mínimo,
esquema al día, servicios de dominio en la base). Las tareas de API, adaptador y shadow se
escriben cuando este lote esté aprobado, para no planificar sobre un esquema que todavía puede
cambiar.

Los tests los escribe el tester en `tests/`, así que `tests/` no aparece en ningún `files:`.
Excepciones: TASK-011, TASK-016 y TASK-017, cuyo entregable **es** un test y por eso sí lo
declaran.

**Por qué TASK-016A/B/C y TASK-017 están separadas de la tarea del servicio que prueban** (decisión
Nivel 2 del 2026-09-04, argumento completo en DECISIONS.md): sus invariantes se prueban **entre**
operaciones, no dentro de una. **No las juntes con la tarea del servicio**: la obligación de
implementar el orden de bloqueo y el guard sigue estando en TASK-005 y TASK-007; lo que se movió es
dónde se prueba que funcionan bajo concurrencia.

**Y por qué sus `depends:` no van todos al final de la cadena** (corrección de Gastón, 2026-09-05):
una tarea de test transversal depende de **las tareas cuyo cruce prueba**, no de la última que
roza. Por eso TASK-016 se partió en tres, cada una con su dependencia real: **016A con TASK-005**,
**016B con TASK-006 y TASK-007**, **016C con TASK-008**. La versión anterior las colgaba a todas de
TASK-008, que era inercia del director y no una restricción: la cadena lineal es correcta para las
**migraciones numeradas**, porque cada una necesita el esquema de la anterior, y no para los tests
transversales.

**Las dependencias dicen qué es posible; el orden de ejecución dice qué se elige.** Gastón decidió
el 2026-09-05 **ejecutar en serie igual**, aunque 016B pueda correr en paralelo con TASK-008. Su
motivo no es técnico: dos agentes a la vez son dos ciclos de tester y auditor superpuestos y dos
merges en paralelo para aprobar — más superficie para que algo se pase, en las tareas más
delicadas del proyecto. El `git worktree` queda como **opción disponible, no activada**; se
enciende si el ritmo lo justifica. Que las dependencias sean verdaderas sirve igual sin
paralelizar: dicen qué se puede reordenar si una tarea se traba, y qué queda libre si una se
bloquea.

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

### TASK-012 — Validación de flags del migrador (R14) y migraciones repetibles (R28)
status: DONE
owner: implementador
depends: TASK-011
files:
- backend/src/db/migrar.js
- backend/README.md
accept:
- **migraciones repetibles (R28)**: el migrador aplica, siempre **después** de las numeradas, los archivos de `backend/db/functions/*.sql`, y los **reaplica solo cuando cambia su hash**. El hash y la fecha quedan registrados, en `schema_migrations` con una marca que los distinga o en una tabla propia
- una repetible que falla **no queda registrada** y no deja efectos: misma propiedad transaccional que TASK-001 exigió para las numeradas
- correr el migrador dos veces seguidas sin cambios no reaplica ninguna repetible
- cambiar un byte de un archivo de `functions/` hace que se reaplique en la corrida siguiente, y solo ese
- las repetibles corren bajo el mismo `pg_advisory_lock` que las numeradas: dos migradores en paralelo no las aplican dos veces
- el directorio `backend/db/functions/` puede estar vacío o no existir sin que el migrador falle
- las migraciones numeradas ya aplicadas **no se modifican** y `schema_migrations` no pierde su historia
- un argumento desconocido o mal tipeado **aborta con exit distinto de 0** y lista los flags válidos; nunca cae silenciosamente en el modo que aplica migraciones
- caso concreto que hoy falla: `node backend/src/db/migrar.js --estad` no debe aplicar nada
- `--estado` no crea la tabla `schema_migrations`, o el README deja de afirmar que "no escribe esquema": el código y la documentación tienen que coincidir
- `--marcar-aplicadas` sigue exigiendo el string exacto y sigue sin tener abreviatura
- las migraciones existentes no se modifican y los tests de TASK-001 siguen en verde
- se actualiza R14 en RISKS.md como mitigado, con la fecha

### TASK-013 — El seed apunta al proyecto del emulador, o falla claro (R16)
status: DONE
owner: implementador
depends: TASK-003
nota: Gastón **ya levantó** el `deny` de `scripts/seed-emulator.mjs` el 2026-09-04, en el commit
  `14c234d`. Pero ese commit está en la rama `task/TASK-003`, así que la regla sigue vigente en
  `migration/postgresql` hasta que TASK-003 se mergee. De ahí el `depends: TASK-003`, que no es
  una dependencia de contenido sino de disponibilidad del permiso: si se arranca antes, el
  implementador se vuelve a topar con el `deny`.
  `GCLOUD_PROJECT=demo-delfino` (`.claude/settings.json:8-9`) **se deja como está**: la separación
  es deliberada y, con el chequeo que agrega esta tarea, un agente que intente sembrar aborta
  ruidosamente en vez de ensuciar en silencio.
files:
- scripts/seed-emulator.mjs
accept:
- el default de `projectId` es `delfino-hogar-erp`, el mismo que usan `npm run emulators`, `npm run test:integration` y `js/firebase-config.js`; ya no `demo-delfino`
- si el proyecto que va a usar el seed **no coincide** con el del emulador al que se conecta, aborta con un mensaje que nombre los dos valores y explique qué hacer; nunca siembra en silencio en un namespace que el ERP no mira
- el seed sigue abortando si las variables de emulador no están o no son locales: esa barrera no se toca
- correrlo deja el usuario `admin@delfino.local` y su perfil en `/usuarios/{uid}` **visibles para el ERP local**, que es el síntoma que originó R16
- correrlo dos veces seguidas sigue siendo idempotente
- **reporta qué quedó sembrado en `demo-delfino`**: usuarios de Auth, perfiles y colecciones con su conteo. El namespace equivocado ya tiene datos de corridas anteriores y hay perfiles duplicados en los dos
- puede además limpiar `demo-delfino` (autorizado por Gastón el 2026-09-04), con estas condiciones: la limpieza es **explícita**, nunca automática al sembrar; solo alcanza al namespace `demo-delfino`; **jamás** puede tocar `delfino-hogar-erp`; y aborta si las variables de emulador no están o no son locales. Si el barrido no puede garantizar eso, se entrega solo el reporte
- R16 queda actualizado en RISKS.md como mitigado, con la fecha

### TASK-002 — Migración 0003: IVA discriminado, destino de pago y fecha local
status: DONE
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
- el centavo de redondeo lo absorbe el **neto**, no el IVA: `iva_total = round(SUM(iva_linea))` y `neto_total = round(total − iva_total)` como residuo, igual que `js/ventas.js:412-413` (decisión Nivel 3 del 2026-09-04). El neto **no** se calcula por línea ni se suma
- Debe = Haber NO alcanza como verificación: con el neto como tapón el asiento cierra igual aunque el centavo esté mal repartido. Hay que verificar el monto imputado a **2.1.2** contra el cálculo por línea
- invariantes IVA_DISCRIMINADO e IMPUTACION_PAGOS de TEST_MATRIX.md
- si algún test existente asumía IVA en cero, el implementador lo reporta y NO lo modifica: los tests son del tester
- `ventas.fecha_operacion` es `date` en hora local, nunca derivada de `toISOString()`: una venta registrada a las 21:00 hora Argentina queda con la fecha de ese día y no con la del día siguiente (cambio 8 de ARCHITECTURE §2.3, P8 + bug de UTC)

### TASK-003 — Migración 0004: lista de precios en la venta e historial de costos
status: DONE
nota para el auditor: el diff de esta rama incluye **dos commits de Gastón** sobre archivos que
  los agentes tienen prohibido tocar, y **no** son violación de alcance: `14c234d`
  (`.claude/settings.json`, levanta el `deny` de `seed-emulator.mjs` para desbloquear TASK-013) y
  `29eacb0` (`CLAUDE.md`, corrige la línea que decía que el IVA se calcula en $0). Lo que sí hay
  que verificar es lo contrario: que el implementador y el tester **no** los hayan tocado.
segunda nota, error del director: el commit `1948cdd` dice
  "MIGRATION_STATUS: el tercer pendiente es el PdV de producción para ARCA" pero **también
  contiene un cambio a `tests/integration/postgres/migrador.test.js`** (el centinela de 3 a 4).
  Ese cambio lo estaba escribiendo el tester en el árbol y el director se lo llevó puesto con un
  `git commit -am`. El cambio es correcto y el tester lo verificó corriéndolo, pero **el commit
  está mal etiquetado**: su mensaje no menciona el archivo de test. No se reescribe la historia
  —es peor el remedio— pero queda anotado para que el auditor no lo lea como una modificación
  encubierta de un test por parte del director. Lección: `git commit -am` con un subagente
  trabajando en el mismo árbol barre su trabajo en curso.
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
- **DIVERGENCIA DELIBERADA CON EL ERP, no la "corrijas" hacia el código.** `js/compras.js` hoy **sí** actualiza el costo maestro solo al registrar una compra. P5 decide lo contrario: una compra puede registrar un costo distinto en `historial_costos` sin modificar el maestro, y el cambio del maestro requiere **aceptación explícita**. Acá la decisión le gana al código actual. Si algo parece un bug porque no coincide con `js/compras.js`, no lo es: es esta decisión
- el test tiene que demostrar la divergencia, no solo la ausencia de trigger: registrar una compra con un costo distinto y verificar que `productos.costo` **no cambió** y que quedó la fila en `historial_costos`

### TASK-018 — `crear_venta()` pasa a tener una sola copia canónica (R28)
status: DONE
desbloqueo: el directorio de repetibles se renombra de `backend/db/functions/` a
  **`backend/db/repetibles/`** (decisión de Gastón, 2026-09-05). El `deny` de `functions/**` matchea
  en cualquier nivel y `./` no ancla —ver R39—, así que en vez de agujerear la barrera se sale de
  su alcance. Además el nombre viejo era ambiguo entre funciones de Postgres y Cloud Functions, y
  esa ambigüedad fue la causa del bloqueo. **No revertir a `functions/`.**
owner: implementador
depends: TASK-012
files:
- backend/db/repetibles/crear_venta.sql
- backend/db/migrations/0006_crear_venta_repetible.sql
- backend/src/db/migrar.js
- backend/README.md
tres tests que va a haber que actualizar, y son del TESTER, no del implementador: `migrador.test.js:73`
  (centinela `toBe(4)`, sube a 5 con la migración 0006), `migrador.test.js:445` (se va a poner rojo
  en cuanto exista `crear_venta.sql`) y `migrador_repetibles.test.js:925` (afirma la convención
  vieja de `--marcar-aplicadas`, que el endurecimiento de R37 revierte a propósito). El
  implementador los detectó y **no los tocó**, que es lo correcto. El tercero es el más delicado:
  no es un test que se rompe, es un test que **afirmaba lo contrario de lo que ahora se exige**.
nota sobre `files:`: `migrar.js` estaba declarado en TASK-012 y se agrega acá porque el cierre de
  R37 —que `--marcar-aplicadas` falle si lo baselineado no está en la base— vive en ese archivo.
  **No hay conflicto**: TASK-012 está DONE y mergeada, así que las dos tareas no lo tocan a la vez.
  La regla que prohíbe compartir `files:` existe para evitar que dos tareas se pisen en paralelo,
  no para impedir que una tarea posterior toque un archivo ya cerrado.
accept:
- `backend/db/functions/crear_venta.sql` contiene **la definición vigente**, la de `0004_precios_y_costos.sql:241`, sin cambios de comportamiento. Esta tarea **muda**, no refactoriza: si algo se comporta distinto, es un bug de la tarea
- la migración numerada acompañante deja constancia del corte y no redefine la función: a partir de acá, `crear_venta()` vive en `functions/`
- **las definiciones de 0002, 0003 y 0004 NO se borran ni se editan.** Son historia aplicada; borrarlas rompería `schema_migrations` y la posibilidad de reconstruir la base desde cero
- después del cambio, `pg_get_functiondef('crear_venta')` devuelve la de `functions/`, verificado
- **los tests de TASK-002 y TASK-003 siguen verdes sin tocarlos**: IVA a 2.1.2 = 648,68, imputación caja/banco→1.1.1, cuentaPorCobrar→1.1.5, pendiente→1.1.2, fecha local estable en varios husos, y la venta sin lista de precios sigue funcionando (P3). Ésa es la prueba de que la mudanza no cambió comportamiento
- reconstruir la base desde cero con el migrador da el mismo esquema que aplicar las migraciones sobre una base existente
- **CRLF: hay que normalizar LOS DOS LADOS, no uno (R33).** Medido por el auditor en TASK-019 sobre `delfino_test`: `pg_get_functiondef('crear_venta')` conserva **163 CRLF** adentro, porque `recrearEsquema()` carga las migraciones crudas. Comparar base contra archivo da `true` **hoy por coincidencia**, con los dos lados en CRLF. Normalizando los dos: `true`. **Normalizando solo el archivo —que es la receta de una línea de TASK-019— da `false`.** O sea que copiar ese arreglo a medias **rompe activamente** la comparación en vez de arreglarla. Esta tarea tiene que normalizar el archivo **y** lo desplegado, normalizar también `recrearEsquema()`, y demostrarlo con la matriz LF/CRLF más una mutación de contenido que confirme que sigue discriminando
- **`recrearEsquema()` en `tests/integration/postgres/_helpers.mjs:22` aplica HOY solo `backend/db/migrations/*.sql`.** Si no se actualiza para aplicar también `backend/db/functions/`, después de esta tarea los tests dejarían viva la copia de 0004 y **la suite quedaría verde probando la función equivocada**. Lo detectó el auditor en TASK-003. Ese archivo es del tester: la tarea NO se cierra sin que esté hecho, y el auditor tiene que verificar que la función que corre en los tests es la de `functions/`, con `pg_get_functiondef()`
- **`--marcar-aplicadas` FALLA si lo que baselinea no existe en la base — no avisa, falla.** Cierra **R37**, y la clase entera, no solo el caso: el auditor demostró que un `DROP FUNCTION` a mano llega al mismo estado —fila al día, función ausente, migrador diciendo `Repetibles: sin cambios` y `--estado` diciendo `al dia`—. La raíz es que **`schema_repetibles` declara el estado de la base en vez de observarlo**; el chequeo tiene que mirar la base (`to_regprocedure` / `pg_proc`) y no la tabla. **Documentarlo NO alcanza**: esa salida quedó descartada por Gastón. Es el agujero que encontró el tester en TASK-012: ese flag también baselinea repetibles, y hoy, tras usarlo, la función puede **no existir** mientras la corrida siguiente informa `Repetibles: sin cambios`. La asimetría es lo grave: con una migración numerada un baseline mal hecho revienta solo más adelante; **con una repetible deja `crear_venta()` vieja o ausente en silencio**. Severidad MEDIA por decisión de Gastón (2026-09-05), con el mismo criterio que R30: *"un `crear_venta()` equivocado corriendo en silencio no aparece en un test, aparece en una venta"*. Un aviso no alcanza: el flag ya es explícito y peligroso, y un aviso en esa salida se lee tarde
- R28 queda marcado como cerrado en RISKS.md, con la fecha

### TASK-019 — Los tests que comparan texto son insensibles a CRLF (R32)
status: DONE
owner: tester
depends: TASK-003
files:
- tests/integration/postgres/precios_y_costos.test.js
nota: el `depends` decía TASK-013 y era un error del director — el archivo que arregla es de
  TASK-003 y no toca nada de TASK-013. Corregido el 2026-09-05, porque con el valor viejo la tarea
  no podía correr antes que TASK-013, que es justo el orden pedido.
  Lineaje de ramas: `task/TASK-019` sale de `task/TASK-013` para que el tester de TASK-013 tenga
  la suite en verde, y **se mergea de vuelta a `task/TASK-013`**, no a `migration/postgresql`. Las
  dos llegan juntas a la rama base, cada una con su commit y su aprobación por separado.
accept:
- los 2 tests en rojo vuelven a verde **normalizando los finales de línea antes de comparar**, no cambiando lo que comparan ni relajando el assert
- **NO se agrega `.gitattributes`**: cambia el checkout de todo el repositorio y es una decisión global con radio mucho mayor que el problema. Si se quiere igual, es decisión aparte de Gastón
- el resto de los tests del archivo no se toca
- **la prueba de que el arreglo sirve**: los tests pasan con el archivo en LF **y** en CRLF. Demostralo convirtiendo una copia y corriéndolos contra las dos, no razonando que debería andar
- se revisa si hay otras comparaciones de texto de archivos en `tests/` con el mismo problema, y se reportan aunque no se arreglen acá
- R32 queda cerrado en RISKS.md con la fecha

### TASK-020 — La suite no depende del estado del emulador de Gastón (R43)
status: DONE
owner: tester
depends: TASK-018
files:
- tests/integration/seed-emulator.test.js
accept:
- **CI en verde en una máquina limpia**, con el emulador arrancando vacío y **sin que nadie corra `npm run seed`**. Ése es el criterio, no que pase en la máquina de Gastón
- el `it` de `seed-emulator.test.js:168` deja de exigir que `admin@delfino.local` ya exista en `delfino-hogar-erp`
- **la regla de oro del archivo no se toca**: el seed **nunca** se corre sobre `delfino-hogar-erp`, que solo se lee, y las dos huellas se siguen comparando enteras
- **barrido del resto de `tests/`**: cualquier otro test que dependa del estado previo del emulador se reporta, y se arregla si entra en este archivo. Si está en otro, se anota y no se toca
- R43 queda cerrado en RISKS.md con la fecha

decisión sobre la salida, la toma el tester con este análisis del director:
- **Gastón se inclina por que el test se siembre a sí mismo**, como hizo TASK-011 con el usuario efímero, *"porque no depende del CI"*. Ese criterio es el correcto y ya está probado en este repo.
- **Pero acá hay un problema propio**: sembrar `admin@delfino.local` en `delfino-hogar-erp` es exactamente lo que la regla de oro del archivo prohíbe. Y sembrarlo en un namespace efímero **ya lo hace `SEED_USUARIO_VISIBLE`**, que corre el seed sobre una copia del árbol y verifica que el admin queda donde el ERP lo mira. O sea que la versión auto-sembrada de este `it` **sería un duplicado** del que está veinte líneas más arriba.
- **Lo que ese `it` aporta hoy no es una propiedad del código, es un dato sobre una máquina**: que en la de Gastón el seed ya se corrió. Eso es cierto y está verificado —él recuperó el login—, pero es evidencia de una sola corrida manual, no una invariante. **Ese tipo de evidencia va a MIGRATION_STATUS, no a la suite.**
- Por eso la salida que el director recomienda es **borrar el `it`**, no auto-sembrarlo, y dejar constancia en `TEST_RESULTS.md` de por qué se retira. **La tercera opción —sembrar desde el workflow de CI— queda descartada**: haría que la suite pase en CI y siga sin poder correr en un clon limpio a mano, que es el problema de fondo.
- **El tester puede estar en desacuerdo.** Si encuentra una propiedad real que ese `it` cubra y ningún otro test verifique, que la conserve y lo argumente; queda registrado.

### TASK-016A — ORDEN_DE_BLOQUEO: dos transacciones cruzadas sin deadlock
status: PENDING
owner: tester
depends: TASK-005
files:
- tests/integration/postgres/concurrencia_orden_bloqueo.test.js
accept:
- dos transacciones cruzadas sobre dos productos no producen deadlock, porque ambas bloquean `stock` por `(producto_id, deposito_id)` ascendente
- **mutación (R20)**: invertir el orden de bloqueo en una de las dos **tiene que producir deadlock**. Si el test pasa con el orden bien y con el orden mal, no prueba nada
- la corrida es determinista o se repite N veces: un test de concurrencia que pasa por timing no prueba nada, y es la forma más traicionera de R20 porque el verde parece ganado
- no modifica `backend/`: si la invariante falla, es bug del servicio y se reporta

### TASK-016B — FACTURAR_VS_MODIFICAR: el lock solo no alcanza, hace falta el guard
status: PENDING
owner: tester
depends: TASK-006, TASK-007
files:
- tests/integration/postgres/concurrencia_facturar_modificar.test.js
accept:
- facturar y modificar el mismo pedido en paralelo: la modificación sobre un pedido ya facturado se rechaza
- **el test distingue el lock del guard**: con el lock puesto y el guard sacado, la modificación tiene que pasar y el test ponerse rojo. Ésa es la única forma de probar que el guard hace falta, y está verificado empíricamente que el lock solo no alcanza
- **mutación (R20)**: quitar el guard deja pasar la modificación y el test lo caza
- determinista o repetida N veces
- no modifica `backend/`

### TASK-016C — Concurrencia de entregas: no consumir más de lo reservado
status: PENDING
owner: tester
depends: TASK-008
files:
- tests/integration/postgres/concurrencia_entregas.test.js
accept:
- dos entregas simultáneas sobre la misma reserva no consumen más de lo reservado
- **mutación (R20)**: sacar el bloqueo de la reserva permite el sobreconsumo y el test lo caza
- determinista o repetida N veces
- no modifica `backend/`

### TASK-017 — Integridad global tras operaciones exitosas y fallidas
status: PENDING
owner: tester
depends: TASK-010
files:
- tests/integration/postgres/integridad_global.test.js
accept:
- INTEGRIDAD_GLOBAL: tras N operaciones exitosas y M fallidas, cero asientos huérfanos, cero ventas sin ítems, cero ventas sin asiento, cero desbalances y cero inconsistencias de reserva
- las M fallidas fallan por causas distintas —stock insuficiente, pendiente sin cliente, destino de pago inválido, asiento desbalanceado— no todas por la misma
- la verificación es una consulta que se puede correr sobre cualquier base, no una lista de asserts atada a los datos del test
- **mutación (R20)**: con una operación parcial inyectada a mano, la verificación tiene que encontrarla
- no modifica `backend/`

### TASK-014 — Relevamiento de ARCA homologación: checklist accionable
status: PENDING
owner: implementador
depends: TASK-018
nota: la dependencia es de **secuencia, no de contenido** — ARCA no depende del esquema. Gastón
  decidió el 2026-09-04 no abrir un segundo hilo en el mismo árbol de trabajo mientras corren
  TASK-013, TASK-012 y TASK-018, después del incidente del `git commit -am` que barrió trabajo en
  curso de un subagente. Un solo hilo por vez.
files:
- migration/ARCA_HOMOLOGACION.md
accept:
- **solo lectura**: releva `functions/arcaFacturacion.js`, `functions/arcaWsfe.js`, `functions/index.js`, `js/facturacion.js` y `configuracion/empresa`. NO modifica `functions/` ni ningún código
- **no invoca nada**: no llama a `arcaAutorizarComprobante`, no se autentica contra Firebase, no toca producción. Si para responder algo hace falta invocar, eso se anota como pregunta para TASK-015, no se ejecuta
- produce un **checklist accionable** de lo que tiene que hacer Gastón, en orden, y para cada ítem **cómo sabe que está listo** — un checklist sin criterio de verificación no sirve
- **cada ítem marcado por dónde se verifica**, en dos grupos separados y visibles: `[ARCA]` los que Gastón puede resolver solo en la web de ARCA/AFIP sin depender de nadie, y `[CÓDIGO]` los que requieren mirar el repositorio o Firestore. El objetivo es que Gastón avance los suyos en paralelo mientras el equipo sigue con la cadena del esquema
- si un ítem necesita las dos cosas, va marcado `[ARCA+CÓDIGO]` y dice explícitamente qué mitad es de cada lado, para que Gastón sepa hasta dónde puede llegar solo
- cubre como mínimo: condición fiscal del emisor en `configuracion/empresa`; datos mínimos del comprobante que exige WSFEv1; y qué campos del ERP alimentan cada uno
- **el punto de venta ya está verificado por Gastón el 2026-09-04 y no hay que relevarlo**: existen tres de tipo "RECE para aplicativo y web services" — el **4** (Av. 24 4464), el **5** (Av. 24 4560) y el **6** (Lirio 863). Para homologación **no hace falta crear ninguno**. El checklist lo marca como resuelto y dice cuál se usa en la prueba; elegir cuál es parte del guion de TASK-015
- **NO decide el punto de venta de producción**: si Delfino usa los mismos que GBP con numeración intercalada, o uno nuevo exclusivo, es decisión **Nivel 3 de Gastón** y está abierta. El relevamiento puede juntar los datos que ayuden a decidirla —cómo numera GBP hoy, qué implica intercalar— pero no la resuelve ni la asume
- deja explícito qué parámetros toma `arcaAutorizarComprobante`, qué valida antes de llamar a ARCA, y qué devuelve en éxito y en error
- lista los modos de falla conocidos de WSFEv1 con su código, para poder distinguir "error entendido" de "algo salió mal"
- NO activa nada: `arcaActivo` sigue en `false`

### TASK-015 — Guion de la invocación en homologación, revisado antes de ejecutarse
status: PENDING
owner: implementador
depends: TASK-014
files:
- migration/ARCA_GUION_INVOCACION.md
accept:
- **lo ejecuta Gastón, no un agente** (decisión del 2026-09-04). El entregable es el guion, no la corrida
- dice la llamada exacta: función, región, parámetros, `ambiente: "testing"`, y el payload completo del comprobante de prueba con valores concretos
- dice **qué respuesta esperar**: cómo se ve un CAE devuelto, cómo se ve cada error conocido, y cómo distinguir un error de ARCA de un error de infraestructura
- incluye qué mirar después: logs de la función, `logIntegracionArca`, y qué NO debería haber cambiado en Firestore
- incluye el criterio de aborto: en qué caso Gastón debe parar y no reintentar
- **lo revisa el auditor antes de que Gastón lo ejecute**, y esa revisión es parte de la tarea
- es un documento, **no un ejecutable**: no se agrega ningún script a `scripts/` ni a `package.json`. Un archivo que golpea producción y se puede correr sin querer es peor que un instructivo. Si Gastón prefiere un script, lo pide y se agrega como cambio aparte
- `arcaActivo` no se toca, y el ambiente `produccion` no aparece en el guion ni como ejemplo

### TASK-004 — Migración 0007: contadores del corte
status: IN_PROGRESS
owner: implementador
depends: TASK-003
files:
- backend/db/migrations/0007_contadores_corte.sql
nota de numeración, decidida por el director el 2026-09-05 antes de arrancar: la tarea decía
  `0005_contadores_corte.sql`, y **`0005` nunca existió** — TASK-018 creó `0006` saltando el
  número. Si esta tarea usara `0005`, en una base nueva se aplicaría **antes** de `0006`, pero en
  la base de Gastón —que ya tiene `0006` registrada— se aplicaría **después**: el mismo repositorio
  produciría dos órdenes distintos según el estado de la base. Se usa **`0007`**, que es mayor que
  todo lo aplicado. **El hueco en `0005` es permanente y no se rellena**: rellenarlo reintroduce
  exactamente este problema.
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
- invariantes RESERVAS_CONSISTENTES, DISPONIBLE_DERIVADO y NO_VENDER_RESERVADO
- el orden de bloqueo ascendente es **obligación de esta tarea**, pero la invariante ORDEN_DE_BLOQUEO se **prueba en TASK-016**: necesita dos transacciones cruzadas y no pertenece al archivo de un solo servicio (decisión Nivel 2 del 2026-09-04)

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
depends: TASK-006, TASK-018
nota: depende de TASK-018 porque es la primera tarea que vuelve a tocar `crear_venta()`. Para
  entonces la función ya tiene una sola copia canónica en `backend/db/repetibles/`, así que esta
  tarea **no genera una cuarta copia**: edita el archivo de la función (R28, decisión Nivel 2 del
  2026-09-04).
accept adicional — **R41, leelo antes de tocar `crear_venta()`**:
- **si esta tarea le cambia los parámetros a `crear_venta()`, `CREATE OR REPLACE` NO la reemplaza: crea una sobrecarga y deja la vieja viva.** Quedan dos en `pg_proc`, los llamadores con la aridad vieja siguen corriendo **el cuerpo viejo sin error y sin aviso**, y el chequeo de R37 la da por desplegada porque encuentra la aridad nueva. Detectado por el auditor en TASK-018
- si hace falta cambiar la firma, el archivo canónico tiene que traer un `drop function if exists` con la **firma vieja completa** antes del `create or replace`, y hay que actualizar el `comment on function` de `0006`, que hoy está anclado a la firma de 8 argumentos
- **verificación obligatoria**: después del cambio, `select count(*) from pg_proc where proname='crear_venta'` devuelve **1**. Si devuelve 2, hay una sobrecarga y la tarea está mal aunque todo lo demás pase
files:
- backend/db/migrations/0008_facturar_pedido.sql
accept:
- FACTURAR convierte el pedido en una venta registrada; **no** emite comprobante fiscal y **no** depende de ARCA (P11)
- la mercadería ya reservada NO se vuelve a reservar, NO baja de nuevo el disponible y NO se descuenta dos veces del físico
- caso probado: físico 10, pedido 2, se factura sin retirar → físico 10, reservado 2, disponible 8
- un pedido se convierte completo en una única venta; el segundo intento se rechaza por la constraint única sobre `pedidos.venta_id` (Q2)
- si al facturar también se retira, se consume la reserva y se descuenta el físico en la misma transacción
- bloquea la fila del pedido con `SELECT … FOR UPDATE` y el guard rechaza modificar un pedido ya facturado
- invariantes NO_DOBLE_RESERVA_AL_FACTURAR y UN_PEDIDO_UNA_VENTA
- el guard contra modificar un pedido facturado es **obligación de esta tarea**, pero la invariante FACTURAR_VS_MODIFICAR se **prueba en TASK-016**: exige facturar y modificar en paralelo, así que no se puede escribir hasta que existan los dos servicios (decisión Nivel 2 del 2026-09-04)

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

## Condiciones de cierre sin tarea asignada todavía

Se listan acá porque la tarea que las tiene que cumplir **no está escrita**. Cuando se escriba,
esto entra en su `accept:` — no se resuelven por acordarse.

**R30 — el rol de la aplicación no puede ser dueño de las tablas ni superusuario.** Va en la tarea
que **provisione PostgreSQL en la nube**, que hoy no existe porque Cloud SQL está postergado por
P12 hasta que haya GO. Con `DISABLE TRIGGER` o `session_replication_role='replica'` la
inmutabilidad de `historial_costos` se cae, y las dos vías fueron reproducidas por el auditor. Lo
que obliga a decidirlo temprano: **la propiedad de las tablas la fija quien corre la primera
migración**, así que descubrirlo con datos adentro cuesta recrear la instancia. Subido a MEDIA por
Gastón el 2026-09-04 por esa razón. Detalle y criterios verificables en R30.

**R29 — `historial_costos` no distingue "compra registrada" de "aceptación del maestro".** Va en
la tarea que implemente la aceptación explícita del costo. El eje —`aplicado_en`/`aplicado_por` o
`origen='aceptacion_maestro'` con CHECK— **lo decide Gastón**, no un agente.

## Condición de cierre obligatoria antes del paso 4 del plan maestro (API)

**R23 — el pago sin destino se imputa a 1.1.1 Caja, y el ERP lo manda a 1.1.2.** La tarea que
construya el primer llamador de `crear_venta()` en `backend/src/` tiene que cerrarlo **en la misma
tarea**, y su auditor verificarlo. Dos salidas y solo dos:

- **Fallar fuerte (preferida):** sacar el `coalesce(…, 'caja')` de `crear_venta()`, levantar
  `DESTINO_PAGO`, y sacar el `default 'caja'` de la columna. La información faltante deja de
  convertirse en plata en Caja.
- **Replicar el ERP:** cuarto estado explícito `sinUbicar` que impute a 1.1.2. Cambia el esquema y
  la invariante IMPUTACION_PAGOS: es **Nivel 3**, lo decide Gastón, no un agente.

No bloquea hoy porque el estado "sin destino" no es representable en el esquema y `crear_venta()`
todavía no tiene ningún llamador. Bloquea el día que exista el endpoint: un campo olvidado en el
JSON no daría error, daría plata en Caja que no está en la caja.

## Pendiente de resolver antes del paso 5 del plan maestro

El adaptador tiene que interponerse en `js/firebase.js`, que solo modifica Gastón, y las páginas
cargan desde `dist/`, así que nada tiene efecto sin `npm run build`. Se diseña y se prueba sin
tocar ese archivo; la conexión final es una acción de Gastón. No bloquea las tareas 001 a 010.
