# Plan maestro

Escribe solo el director. Completado en FASE 0 el 2026-09-04.

## Objetivo

Determinar, con evidencia y no con opinión, si Delfino ERP debe pasar de Firestore a PostgreSQL.
La pregunta no es si PostgreSQL "funciona": es si reproduce el comportamiento comercial aprobado
**y** resuelve los cuatro problemas que motivan la migración —atomicidad, concurrencia, doble
envío e integridad— que hoy el ERP no puede resolver porque escribe directo desde el navegador.

## Fases

**FASE -1 — Aislamiento del entorno.** ✅ Cerrada.
Emuladores de Firebase, PostgreSQL local en Docker, barreras de git, GitHub y Netlify, suite de
tests, configuración de agentes. Nada migrado.

**FASE 0 — Relevamiento y diseño.** ✅ Cerrada el 2026-09-04.
Relevamiento del ERP sobre el master actual (ARCHITECTURE.md), incorporación de las 30 decisiones
que se habían tomado fuera del repositorio, renumeración de riesgos, matriz de invariantes y
tareas de Fase 1. Sin código.

**FASE 1 — PoC.** ⬅ siguiente.
Dos alcances evaluados por separado, cada uno con su GO / ADJUST / NO-GO en POC_REPORT.md, más
una conclusión general:

- **Alcance A — migración.** Clientes, productos y venta completa contra PostgreSQL local. Se
  valida por reconciliación contra Firestore donde exista contraparte.
- **Alcance B — módulo nuevo.** Pedidos, Reservas y Entregas completos. No existe en Firestore:
  se valida contra DECISIONS.md, las invariantes de TEST_MATRIX.md y las pruebas del auditor.

Un problema del módulo nuevo no invalida la evaluación técnica de PostgreSQL, ni un buen
resultado de la migración aprueba un módulo de reservas defectuoso.

**FASE 2+** — solo si hay GO. Se planifica después.

## Orden de trabajo dentro de la FASE 1

Infraestructura antes que lógica, y base antes que API:

1. **Backend mínimo** — cliente `pg`, migrador con tabla de versiones. Hoy no existe ni una línea
   de servidor en `backend/`.
2. **Esquema al día** — las ocho correcciones que ARCHITECTURE.md §2.3 deriva de las decisiones.
3. **Servicios de dominio en la base** — `crear_pedido`, `modificar_pedido`, `facturar_pedido`,
   `crear_entrega`. Hoy solo existe `crear_venta`.
4. **API HTTP** — sobre los servicios ya probados.
5. **Adaptador** — la frontera que ya está casi entera en `js/firebase.js`.
6. **Shadow y reconciliación** — comparar comportamiento, no resultados cosméticos.
7. **POC_REPORT.md** — métricas y recomendación.

## Criterios de la evaluación final

- Las invariantes de TEST_MATRIX.md pasan en PostgreSQL, incluidas las que Firestore no puede
  pasar (marcadas known-failing, que son la razón de la migración).
- Las diferencias del shadow se clasifican: tipo A esperadas por cambios ya aprobados, tipo B
  causadas por inconsistencias preexistentes de Firestore (R1). Ninguna de las dos es un error de
  la PoC; ambas se documentan.
- El auditor rechaza todo lo que corresponda. **No hay objetivo de porcentaje de rechazo.**
- Las estimaciones de tokens sirven para planificar y nunca condicionan el comportamiento de
  ningún agente.

## Fuera de alcance de la PoC

Tesorería (solo se conserva el destino contable en `venta_pagos`), listas de precios completas,
compras, comprobantes fiscales, ARCA, usuarios y roles, Mercado Pago, Tiendanube y GBP. Cloud SQL
queda postergado por P12: la PoC corre sobre PostgreSQL local en Docker, y no se decide instancia
ni costos hasta que haya GO.
