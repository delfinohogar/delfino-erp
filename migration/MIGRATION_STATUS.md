# Estado de la migración

Fase actual: **1 en curso. 9 tareas cerradas, la suite en verde y CI también.**
Rama de trabajo: `migration/postgresql`
Última tarea cerrada: **TASK-020**, aprobada y mergeada el 2026-09-05
Tareas bloqueadas: —
Pendientes de Gastón: 2, en DECISIONS.md § PENDIENTE DE GASTÓN

## Qué se hizo

FASE -1 quedó cerrada: emuladores, PostgreSQL local, barreras de git y Netlify, 34 tests.

FASE 0, el 2026-09-04:

- **Relevamiento completo** del ERP sobre el master actual, en ARCHITECTURE.md. Reemplaza el
  borrador anterior, cuyos conteos no eran válidos.
- **Se repararon tres afirmaciones falsas** que el repositorio daba por buenas: las decisiones
  P1–P12 y Q1–Q4 no estaban en DECISIONS.md (se incorporaron, textuales); R6–R11 y R18 nunca
  existieron (los riesgos se renumeraron y corren de R1 a R12 sin huecos); y el IVA en ventas no
  está "calculado en $0" como decía CLAUDE.md, sino discriminado e imputado a 2.1.2. Esa línea de
  CLAUDE.md la corrigió Gastón el 2026-09-04 en el commit `29eacb0`.
- **Gastón resolvió tres decisiones de Nivel 3**: el IVA se calcula (corrige la premisa de P6),
  Tesorería queda fuera de la PoC pero se conserva el destino contable en `venta_pagos`, y solo
  los comprobantes conservan numeración en el corte (cierra P7).
- **TEST_MATRIX.md** con 43 invariantes en cinco bloques, cada una con su origen: 11 de venta,
  7 nuevas de esta fase, 16 de pedidos/reservas/entregas, 8 del trigger contable y 1 global.
- **MASTER_PLAN.md** y las **10 tareas del primer lote de FASE 1** en TASKS.md.

FASE 1, el 2026-09-04, antes de escribir código: se cerraron dos huecos del plan. El cambio 8 de
ARCHITECTURE §2.3 —`fecha_operacion` como `date` local— no tenía tarea y entró como criterio de
TASK-002; y la contradicción entre ARCHITECTURE y TASK-004 sobre si los contadores arrancan en 0
o en 1 se unificó en la formulación verificable.

**TASK-001 cerrada** el 2026-09-04: `backend/` tiene por primera vez código de servidor. Cliente
`pg` (`pool.js`) y migrador versionado (`migrar.js`) que aplica las migraciones en orden
alfabético, cada una en su transacción junto con su registro en `schema_migrations`, bajo
`pg_advisory_lock`. Sin HTTP, sin puertos, sin Firebase. **Sin baseline silencioso**: con el
esquema ya aplicado por otra vía falla con un mensaje que explica las dos salidas, y marcar sin
ejecutar exige el flag explícito `--marcar-aplicadas`. 39 tests nuevos; el repo pasa de 34 a 75.
La atomicidad se verificó **por mutación**, tester y auditor por separado: con el `INSERT` fuera
de la transacción los tests se ponen en rojo, así que discriminan de verdad.

**TASK-011 cerrada** el 2026-09-04, con un rechazo intermedio. La suite quedó **en verde por
primera vez**: 43/43 integración y 32/32 unitarios, sin rojos crónicos. `firestore.rules` no se
tocó. Dejó tres cosas que valen más que el fix:

- **R20**: el test de aislamiento de FASE -1 **no podía detectar lo que decía detectar**. Leía de
  vuelta con el mismo cliente que escribía, así que contra otro Firestore pasaba igual. El rojo
  por `PERMISSION_DENIED` lo venía tapando. Ahora el assert que discrimina es la lectura REST
  contra `127.0.0.1` con token `owner`, que producción nunca respondería.
- **R17 y R18 ELIMINADOS, no mitigados**: el test ya no toca `admin@delfino.local`. Creaba el
  riesgo de borrarle el perfil a Gastón —lo demostró el auditor por inyección— justo cuando la
  recuperación por `npm run seed` está rota por R16. Ahora usa una identidad efímera propia.
- La regla de trabajo que sale de todo esto: **un test verde que no discrimina es peor que no
  tener test**. Toda tarea con tests exige demostrar que el test puede fallar, y el auditor lo
  reproduce por su cuenta.

**TASK-002 cerrada** el 2026-09-04, la primera con resultado contable. La migración 0003 discrimina
el IVA por línea a 2.1.2, imputa el destino contable del pago y arregla la fecha local. Da **el
mismo centavo que el ERP**, no uno equivalente: el auditor comparó 34.136 casos contra el cuerpo
literal de `discriminarIva()` y 400 asientos completos contra una réplica de `js/ventas.js`, con
cero divergencias.

Dos cosas que conviene no olvidar:

- **Dónde estaba el centavo.** No en "neto por línea vs residuo" —eso es demostrablemente
  imposible con 21 % y 10,5 %— sino en el **orden de redondeo del IVA**: redondear por línea y
  sumar da 648,68; sumar y redondear al final da 648,67. Las dos cierran Debe = Haber.
- **R20 en acción, con evidencia.** Con el centavo movido de 2.1.2 a 4.1, `asientosDesbalanceados()`
  devolvió `[]`: el balance no detecta nada. El test lo caza igual porque verifica el monto
  imputado a la cuenta fiscal. Un test que solo mirara Debe = Haber habría aprobado un peso mal
  imputado.

**TASK-003 cerrada** el 2026-09-04, con dos cortes por límite de turnos en el camino: se cortaron
el tester y el auditor, y es la primera tarea donde pasa. La migración 0004 agrega listas de
precios e historial de costos inmutable.

Lo que la distingue: **acá el criterio era divergir del ERP a propósito**, al revés de TASK-002.
`js/compras.js` pisa el costo maestro en cada compra; P5 decide que no. Se probó por
comportamiento y no por ausencia de mecanismo —costo 600000, se registra una compra a 715000,
sigue 600000— y el auditor reprodujo las tres mutaciones, incluida la que **mete el `UPDATE` real
de `js/compras.js` dentro de `registrar_costo()`** para comprobar que el test detecta esa
divergencia concreta. La inmutabilidad se verificó por ocho vías distintas, todas 23001.

De la tarea salieron tres decisiones de método que valen más que la migración:

- **Aprobación con salvedades**: un `.approved-parcial.md` mergea pero no cierra, y el hook lo
  bloquea solo porque busca el `.approved` exacto. Barrera, no convención.
- **Las invariantes de concurrencia van en tarea propia** (TASK-016, TASK-017): se prueban entre
  operaciones, así que dependen de que las dos existan.
- **R28**: `crear_venta()` estaba copiada en tres migraciones. Se cierra con migraciones
  repetibles (TASK-012 + TASK-018) antes de TASK-007.

**TASK-013 y TASK-019 cerradas** el 2026-09-05, de madrugada y sin intervención de Gastón.
**269 tests en verde.** TASK-019 cerró R32 —los tests que comparan texto ya no dependen de los
finales de línea— y TASK-013 cerró R16: el seed lee el `projectId` de `js/firebase-config.js` como
fuente única y aborta si no coincide con el proyecto forzado.

Dos cosas que valen más que las tareas:

- **R35: `singleProjectMode` hace ilusorio el aislamiento entre namespaces de Firestore.** El
  emulador espeja a cualquier namespace virgen lo que entró por `--import`, y reescribe el campo
  `name` con el `projectId` pedido. Auth no espeja. **Consecuencia: se retiró la evidencia del
  "perfil duplicado" que se había citado en R16** — no había duplicado, era el espejo. El bug de
  R16 sigue siendo real y verificado por otras vías; lo que cayó fue una de sus pruebas. Segundo
  caso, después de R8, de una afirmación cómoda que no resiste.
- **Cualquier verificación que se apoye en "este dato está en el namespace X y no en el Y" no es
  válida** mientras `singleProjectMode` esté activo. Afecta al shadow. Sacarlo o no es decisión de
  Gastón, con R35 sobre la mesa.

**TASK-012 y TASK-018 cerradas** el 2026-09-05, completando el lote de cuatro de la madrugada.
**152 tests de integración y 152 unitarios, todos en verde.**

- **TASK-012** construyó las **migraciones repetibles** (patrón `R__` de Flyway): archivos que se
  reaplican cuando cambia su hash, bajo el mismo advisory lock y cada uno en su transacción junto
  al registro. El hash es del contenido **normalizado a LF**: sin eso, un `git checkout` reaplicaría
  todas las funciones y `prosrc` dependería del checkout.
- **TASK-018** mudó `crear_venta()` a `backend/db/repetibles/crear_venta.sql`. **Cierra R28**: se
  acabaron las tres copias. El auditor verificó la mudanza por comparación **binaria** —mismo
  SHA-256 en los dos lados, 168 líneas— y la neutralidad por la vía correcta: `invariantes`,
  `iva_destino_y_fecha` y `precios_y_costos` quedaron verdes **sin aparecer en el diff**.
- **`recrearEsquema()` ahora aplica las repetibles.** Sin ese cambio la suite habría quedado verde
  probando la copia de `0004`. Hoy son idénticas, así que no mentía **todavía** — ése era el
  punto.
- **R37 cerrado**: `--marcar-aplicadas` **falla** si lo que baselinea no está en la base, mirando
  `pg_proc` y no la tabla. Gastón descartó la salida de solo documentarlo.

El directorio se llama `repetibles/` y **no `functions/`**: el `deny` de `functions/**` matchea en
cualquier nivel (R39) y el nombre viejo era ambiguo entre funciones de Postgres y Cloud Functions.
**No revertir.**

**TASK-020 cerrada** el 2026-09-05: **CI vuelve a verde**. Estuvo rojo desde el push del lote de
cuatro, en su primera corrida sobre una máquina limpia, y encontró algo que la suite **no podía
detectar corriendo siempre contra el emulador de Gastón**: un `it` que exigía que
`admin@delfino.local` ya estuviera sembrado. No probaba una propiedad del código, **afirmaba un
dato sobre una máquina** — y encima uno que ningún agente podía producir, porque desde TASK-013 el
seed aborta si lo corre un agente.

Se borró en vez de auto-sembrarlo: la versión auto-sembrada habría duplicado el test vecino o
violado la regla de oro del archivo. El auditor verificó **eslabón por eslabón** que las tres
pruebas deterministas que quedan cubren lo mismo, y no encontró ninguna propiedad huérfana.

**La lección quedó como R43**, y vale para todo lo que viene: **CI es el oráculo de esta clase de
defecto.** Un barrido a ojo encuentra los que uno imagina; CI encuentra los que hay. Tester y
auditor lo confirmaron por separado sobre emuladores vacíos propios: 151/151, con
`delfino-hogar-erp` en 0 documentos y 0 usuarios después de toda la suite.

## Qué sigue

**TASK-004** (contadores del corte) retoma la cadena del esquema, hasta TASK-010. Antes de tocar
`crear_venta()` en **TASK-007**, leer **R41**: `CREATE OR REPLACE` no cambia la firma, así que
agregarle un parámetro crea una **sobrecarga** y deja la vieja viva, con los llamadores viejos
corriendo el cuerpo viejo sin ningún aviso. Ya está en el `accept:` de esa tarea, con la
verificación obligatoria: `count(*)` en `pg_proc` tiene que dar **1**.

Después, **TASK-014** (relevamiento de ARCA) y **TASK-015** (guion de invocación), que no dependen
del esquema.

**Lo que quedó de la madrugada para Gastón**, ninguno urgente:
- **R39 [MEDIA]**: los patrones de `permissions` matchean en cualquier nivel y `./` no ancla. Vale
  para las 127 reglas; el riesgo real está en las **30 de `allow`**, porque un `allow` más amplio
  de lo previsto **no produce ningún error**. Gastón las revisa.
- **R40 [ALTA]**: los remitos generan asiento de compra con **IVA crédito fiscal**, que un remito no
  da, y si después llega la factura se duplica stock y asiento. Es del ERP en producción. La parte
  contable —qué hacer con lo ya registrado— la ve Gastón con su contador y **no la toca nadie de
  este proyecto**.
- Borrar `backend/db/functions/`, que quedó vacío en disco. Git no versiona directorios vacíos, así
  que no se mergeó; el riesgo que queda es humano: alguien deja un `.sql` ahí y el migrador nunca
  lo aplica, en silencio.

El lote cubre los pasos 1 a 3 del plan maestro. Las tareas de API, adaptador y shadow se escriben
cuando este lote esté aprobado, para no planificar sobre un esquema que todavía puede cambiar.
La cadena TASK-001 → TASK-010 es lineal por decisión: son migraciones numeradas y servicios que
dependen del esquema anterior.

## Qué está bloqueado o pendiente de Gastón

Los pendientes de Gastón viven en la sección **PENDIENTE DE GASTÓN de DECISIONS.md**, que es
donde él los busca. Quedan dos: el acceso a `js/firebase.js` que necesita el adaptador, y el
**punto de venta de producción para ARCA** —si
Delfino comparte los de GBP con numeración intercalada o usa uno exclusivo—, que es Nivel 3 por
fiscal y por tocar un sistema que hoy factura. Ninguno bloquea TASK-001 a TASK-010, y el de ARCA
tampoco bloquea homologación: los puntos de venta 4, 5 y 6 ya están habilitados para servicios
web y no hay que crear ninguno.

**R8 se cerró** el 2026-09-04: Gastón verificó en Firebase Console que `arcaAutorizarComprobante`
no estaba desplegada —las 25 que había no la incluían— y la desplegó en `southamerica-east1`, con
certificado de homologación y secretos cargados. **`arcaActivo` sigue en `false`.** Del deploy
salieron dos riesgos nuevos que no son de la PoC pero tienen fecha: **R26**, Node.js 20 se
decomisiona el **30 de octubre de 2026** y después no se puede desplegar sin migrar el runtime, y
**R27**, `firebase-functions` desactualizado con breaking changes. Afectan a las 26 funciones y se
planifican juntos.

El test `_safety` en rojo, que TASK-001 detectó como preexistente, dejó de ser un pendiente de
Gastón: lo resolvió el 2026-09-04 y quedó cerrado en TASK-011.

Menores, sin impacto en la PoC: `.github/` está sin commitear, así que puede no haber CI
corriendo; y `.netlifyignore` sigue en la raíz aunque INSTALAR.md manda borrarlo (R7 explica que
Netlify no lo lee).

## Cifras verificadas

83 módulos en `js/` (10.719 LOC), 75 pantallas (12.403 LOC), 74 páginas HTML. 41 colecciones raíz
y 6 subcolecciones. 32 módulos escriben en Firestore, con 140 call-sites, y **cero escrituras
fuera de `js/`**. 64 decisiones, 42 riesgos, 43 invariantes de negocio más las propiedades de
infraestructura, **304 tests** (152 unitarios y 152 de integración), **todos en verde**.

## Cómo leer esto
Resumen de una pantalla. El detalle está en TASKS.md (qué falta), DECISIONS.md (qué se decidió y
por qué), RISKS.md (qué puede salir mal), TEST_MATRIX.md (qué hay que probar) y ARCHITECTURE.md
(cómo es el sistema y cómo se propone que sea).
