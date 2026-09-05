# Estado de la migración

Fase actual: **1 en curso. 3 tareas cerradas, la suite en verde.**
Rama de trabajo: `migration/postgresql`
Última tarea cerrada: **TASK-002**, aprobada y mergeada el 2026-09-04
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

## Qué sigue

**TASK-012** cierra R14: un flag mal tipeado del migrador aplica migraciones en vez de avisar.
**TASK-013** cierra R16: el seed usa `demo-delfino` por defecto mientras el emulador corre en
`delfino-hogar-erp`, así que siembra en un namespace que el ERP no mira — ya rompió un login
local. Son independientes entre sí y ninguna bloquea el esquema.

Después sigue la cadena del esquema: **TASK-003** (listas de precios e historial de costos) hasta
TASK-010.

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
fuera de `js/`**. 50 decisiones, 27 riesgos, 43 invariantes de negocio más 7 propiedades de
infraestructura, **109 tests** (41 unitarios y 68 de integración), **todos en verde**.

## Cómo leer esto
Resumen de una pantalla. El detalle está en TASKS.md (qué falta), DECISIONS.md (qué se decidió y
por qué), RISKS.md (qué puede salir mal), TEST_MATRIX.md (qué hay que probar) y ARCHITECTURE.md
(cómo es el sistema y cómo se propone que sea).
