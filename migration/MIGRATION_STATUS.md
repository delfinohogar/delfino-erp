# Estado de la migración

Fase actual: **1 en curso. 1 de 10 tareas del primer lote cerrada.**
Rama de trabajo: `migration/postgresql`
Última tarea cerrada: **TASK-001**, aprobada y mergeada el 2026-09-04
Tareas bloqueadas: —
Pendientes de Gastón: 3, en DECISIONS.md § PENDIENTE DE GASTÓN

## Qué se hizo

FASE -1 quedó cerrada: emuladores, PostgreSQL local, barreras de git y Netlify, 34 tests.

FASE 0, el 2026-09-04:

- **Relevamiento completo** del ERP sobre el master actual, en ARCHITECTURE.md. Reemplaza el
  borrador anterior, cuyos conteos no eran válidos.
- **Se repararon tres afirmaciones falsas** que el repositorio daba por buenas: las decisiones
  P1–P12 y Q1–Q4 no estaban en DECISIONS.md (se incorporaron, textuales); R6–R11 y R18 nunca
  existieron (los riesgos se renumeraron y corren de R1 a R12 sin huecos); y el IVA en ventas no
  está "calculado en $0" como dice CLAUDE.md, sino discriminado e imputado a 2.1.2.
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

## Qué sigue

**TASK-011 primero, antes de TASK-002**: dejar la suite en verde. Gastón decidió que el test
`_safety` se autentique con `admin@delfino.local` contra el emulador de Auth, y que
`firestore.rules` **no se toque** — agregar una regla a producción para que pase un test es la
salida equivocada. El test además pasa a probar lo que dice probar.

Después **TASK-002**: migración 0003 — IVA discriminado por línea imputado a 2.1.2, destino
contable del pago (1.1.1 / 1.1.5 / 1.1.2) y `fecha_operacion` como fecha local. Es la primera
tarea que toca reglas de negocio, y la primera cuyo resultado es contable: el asiento tiene que
cerrar Debe = Haber también con alícuotas mixtas de 21 % y 10,5 %.

Dos correcciones más, ninguna bloqueante del esquema. **TASK-012** cierra R14: un flag mal
tipeado del migrador aplica migraciones en vez de avisar. **TASK-013** cierra R16: el seed usa
`demo-delfino` por defecto mientras el emulador corre en `delfino-hogar-erp`, así que siembra en
un namespace que el ERP no mira — ya rompió un login local. Ninguno de los dos se acepta como
riesgo residual.

El lote cubre los pasos 1 a 3 del plan maestro. Las tareas de API, adaptador y shadow se escriben
cuando este lote esté aprobado, para no planificar sobre un esquema que todavía puede cambiar.
La cadena TASK-001 → TASK-010 es lineal por decisión: son migraciones numeradas y servicios que
dependen del esquema anterior.

## Qué está bloqueado o pendiente de Gastón

Los tres pendientes de Gastón viven ahora en la sección **PENDIENTE DE GASTÓN de DECISIONS.md**,
que es donde él los busca: estado real de las Cloud Functions desplegadas (R8), la línea falsa de
CLAUDE.md sobre el IVA en $0, y el acceso a `js/firebase.js` que necesita el adaptador. Ninguno
bloquea TASK-001 a TASK-010.

El test `_safety` en rojo, que TASK-001 detectó como preexistente, ya no es un pendiente de
Gastón: lo resolvió el 2026-09-04 y se implementa en TASK-011.

Menores, sin impacto en la PoC: `.github/` está sin commitear, así que puede no haber CI
corriendo; y `.netlifyignore` sigue en la raíz aunque INSTALAR.md manda borrarlo (R7 explica que
Netlify no lo lee).

## Cifras verificadas

83 módulos en `js/` (10.719 LOC), 75 pantallas (12.403 LOC), 74 páginas HTML. 41 colecciones raíz
y 6 subcolecciones. 32 módulos escriben en Firestore, con 140 call-sites, y **cero escrituras
fuera de `js/`**. 45 decisiones, 16 riesgos, 43 invariantes de negocio más 7 propiedades de
infraestructura, **75 tests** (32 unitarios y 43 de integración), 1 de ellos en rojo conocido.

## Cómo leer esto
Resumen de una pantalla. El detalle está en TASKS.md (qué falta), DECISIONS.md (qué se decidió y
por qué), RISKS.md (qué puede salir mal), TEST_MATRIX.md (qué hay que probar) y ARCHITECTURE.md
(cómo es el sistema y cómo se propone que sea).
