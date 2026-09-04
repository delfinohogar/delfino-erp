# Estado de la migración

Fase actual: **0 (relevamiento y diseño)**. Relevamiento del código terminado; arquitectura y
tareas todavía sin escribir. Nada migrado, nada implementado.
Rama de trabajo: `migration/postgresql`
Última tarea cerrada: — (todavía no hay tareas en TASKS.md)
Tareas bloqueadas: —
Pendientes de Gastón: ver la sección PENDIENTE DE GASTÓN en DECISIONS.md

## Qué se hizo el 2026-09-04

Relevamiento completo del ERP sobre el master actual y reparación del registro de decisiones y
riesgos, que estaba describiendo cosas que el repositorio no contenía.

## Antes de FASE 0

La FASE 0 se rehace **desde cero** sobre el master actual. El borrador previo se hizo sobre un
master que no incluía el bundling con esbuild, la sincronización con GBP (`facturasGbp`,
`clientesGbp`), la integración ARCA WSFEv1 ni la carpeta `publicar/`. Los conteos de superficie
de UI, módulos y líneas de ese borrador no son válidos: el relevamiento del 2026-09-04 los
reemplaza.

## Qué hay hoy en el repositorio, con precisión

- **Decisiones:** 37 entradas en DECISIONS.md. Las 30 de la sesión del 2026-09-03 (P1–P12,
  Q1–Q4, 8 [GASTÓN], 5 [NIVEL 2], 1 [ALCANCE]) se incorporaron textualmente el 2026-09-04.
  Hasta ese día este archivo las daba por presentes y **no estaban**: se habían tomado en una
  conversación que nunca se versionó. Están vigentes y no hay que volver a decidirlas.
- **Esquema SQL:** `backend/db/migrations/0001_esquema_poc.sql` y `0002_venta_servicio.sql`
  existen y su cabecera declara validación empírica contra PostgreSQL 16.15. No hay que
  reescribirlos, pero **no están aprobados**: la propia cabecera dice "NO es esquema aprobado:
  falta la verificación del Director y del Auditor". Esa verificación sigue pendiente. Además
  no cubren IVA en `crear_venta()`, listas de precios ni Tesorería.
- **Invariantes:** `tests/integration/postgres/invariantes.test.js` tiene **21 tests**
  (9 `describe`), confirmado por conteo. Con safety (4), contabilidad (4) y facturación (5),
  el repositorio tiene 34 tests.
- **Backend:** no existe. `backend/` son tres archivos de configuración y tres `.sql`. No hay
  servidor Node, ni rutas HTTP, ni cliente `pg` de aplicación, ni migrador.
- **Riesgos:** 12, corridos de R1 a R12. Se renumeró R12–R17 → R6–R11; el salto original
  suponía seis riesgos de un documento que nunca llegó al repositorio. R18 nunca existió.

## Qué sigue

Escribir ARCHITECTURE.md con el modelo real y el modelo relacional propuesto, después
TEST_MATRIX.md, MASTER_PLAN.md y las tareas de Fase 1 en TASKS.md.

## Cómo leer esto
Resumen de una pantalla. El detalle está en TASKS.md (qué falta), DECISIONS.md (qué se decidió
y por qué), RISKS.md (qué puede salir mal) y ARCHITECTURE.md (cómo es el sistema).
