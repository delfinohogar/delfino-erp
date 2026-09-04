# Estado de la migración

Fase actual: **0 cerrada. Lista para empezar FASE 1.**
Rama de trabajo: `migration/postgresql`
Última tarea cerrada: — (TASK-001 todavía no arrancó)
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

## Qué sigue

TASK-001: backend Node mínimo, cliente `pg` y migrador con tabla de versiones. Hoy no existe ni
una línea de servidor en `backend/`: son tres archivos de configuración y seis `.sql`.

El lote cubre los pasos 1 a 3 del plan maestro. Las tareas de API, adaptador y shadow se escriben
cuando este lote esté aprobado, para no planificar sobre un esquema que todavía puede cambiar.

## Qué está bloqueado o pendiente de Gastón

Los tres pendientes de Gastón viven ahora en la sección **PENDIENTE DE GASTÓN de DECISIONS.md**,
que es donde él los busca: estado real de las Cloud Functions desplegadas (R8), la línea falsa de
CLAUDE.md sobre el IVA en $0, y el acceso a `js/firebase.js` que necesita el adaptador. Ninguno
bloquea TASK-001 a TASK-010.

Menores, sin impacto en la PoC: `.github/` está sin commitear, así que puede no haber CI
corriendo; y `.netlifyignore` sigue en la raíz aunque INSTALAR.md manda borrarlo (R7 explica que
Netlify no lo lee).

## Cifras verificadas

83 módulos en `js/` (10.719 LOC), 75 pantallas (12.403 LOC), 74 páginas HTML. 41 colecciones raíz
y 6 subcolecciones. 32 módulos escriben en Firestore, con 140 call-sites, y **cero escrituras
fuera de `js/`**. 40 decisiones, 12 riesgos, 43 invariantes, 34 tests.

## Cómo leer esto
Resumen de una pantalla. El detalle está en TASKS.md (qué falta), DECISIONS.md (qué se decidió y
por qué), RISKS.md (qué puede salir mal), TEST_MATRIX.md (qué hay que probar) y ARCHITECTURE.md
(cómo es el sistema y cómo se propone que sea).
