# Estado de la migración

Fase actual: **-1 (aislamiento del entorno)**. Nada migrado, nada implementado.
Rama de trabajo: `migration/postgresql`
Última tarea cerrada: —
Tareas bloqueadas: —
Pendientes de Gastón: ver DECISIONS.md

## Antes de FASE 0

La FASE 0 (relevamiento y arquitectura) tiene que rehacerse **desde cero** sobre el master
actual. El borrador previo se hizo sobre un master que no incluía el bundling con esbuild, la
sincronización con GBP (`facturasGbp`, `clientesGbp`), la integración ARCA WSFEv1 ni la carpeta
`publicar/`. Los conteos de superficie de UI, módulos y líneas de ese borrador no son válidos.

Lo que sí sigue vigente y NO hay que rehacer: las decisiones P1–P12 y Q1–Q4 de DECISIONS.md,
el esquema SQL de `backend/db/migrations/` (validado contra PostgreSQL 16.15) y la suite de
invariantes de `tests/integration/postgres/` (21 tests en verde).

## Cómo leer esto
Resumen de una pantalla. El detalle está en TASKS.md (qué falta), DECISIONS.md (qué se decidió
y por qué), RISKS.md (qué puede salir mal) y ARCHITECTURE.md (cómo es el sistema).
