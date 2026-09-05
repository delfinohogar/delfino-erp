# Métricas por tarea

Escribe solo el director. Pedido por Gastón el 2026-09-05, con un objetivo concreto: **después de
TASK-007, poder proyectar las seis tareas restantes con números propios y no con una estimación.**
Y de paso poner a prueba la hipótesis del director: que **el costo de una tarea lo predicen las
verificaciones empíricas exigidas, no las líneas ni los archivos**.

## Cómo leer la confiabilidad de cada dato

| Marca | Qué significa |
|---|---|
| **[FIRME]** | Verificable en el repositorio: commits de `status:`, archivos en `migration/approvals/`, commits WIP, atribuciones en `RISKS.md`. |
| **[RECONSTRUIDO]** | Sale de la memoria de conversación del director, que **no es confiable**. Los prompts a los subagentes no quedan en el repositorio, así que la cantidad de verificaciones exigidas no se puede auditar hacia atrás. Son aproximaciones y están marcadas como tales. |

De TASK-004 en adelante **todo se cuenta en el momento**, así que todo va a ser [FIRME].

## Definiciones, para que los números signifiquen lo mismo siempre

- **Ciclos**: 1 si el auditor aprobó de entrada. 2 si hubo un rechazo o un rojo del tester que
  devolvió la tarea al implementador. Un aval condicionado que después se confirma cuenta como 2.
- **Cortes**: agentes que terminaron por **límite de turnos**, con el rol. **No** cuenta un agente
  frenado por un permiso: eso es *bloqueo*. **Tampoco cuenta una falla por límite de sesión de la
  API** (`rate_limit`, HTTP 429): eso es *interrupción de cuota*.
- **Interrupciones de cuota**: el agente muere por un límite de la cuenta, no por el trabajo.
  Se registran aparte y **no son evidencia ni a favor ni en contra de la hipótesis**: no dicen nada
  sobre el tamaño de la tarea. Distinción marcada por Gastón el 2026-09-05, tras la primera —el
  implementador de TASK-004 en su segundo ciclo, `rate_limit` con reset a las 13:00—. Contarla como
  corte habría inflado la evidencia a favor de la hipótesis con un dato que no la toca.
- **Bloqueos**: intervenciones de Gastón necesarias para desbloquear —editar `.claude/`, decidir
  algo que un agente no puede—. Se cuentan aparte de las decisiones de Nivel 3.
- **Nivel 3**: decisiones comerciales, contables, fiscales o de producción que solo toma Gastón.
- **Verificaciones exigidas**: comprobaciones **empíricas e independientes** pedidas en el prompt
  —correr algo y leer el resultado—, sumando tester y auditor. Es la variable de la hipótesis.
- **Origen**: `plan` si estaba en el lote original de FASE 1; `deuda` si apareció después.

---

## Las nueve cerradas

| Tarea | Origen | Ciclos | Cortes | Bloqueos | Nivel 3 | Verif. | Riesgos nuevos |
|---|---|---|---|---|---|---|---|
| TASK-001 | plan | 1 | 0 | 0 | 0 | ~12 | R13, R14, R15 |
| TASK-011 | deuda | **2** | 0 | 0 | **1** | ~15 | R17, R18, R19, R21, R22 |
| TASK-002 | plan | 1 | 0 | 0 | **1** | ~14 | R23, R24, R25 |
| TASK-003 | plan | 1 | **2** | 0 | 0 | ~16 | R29, R30, R31 |
| TASK-019 | deuda | 1 | 0 | 0 | 0 | ~6 | R33, R34 |
| TASK-013 | deuda | **2** | **1** | **1** | **1** | ~15 | R35, R36 |
| TASK-012 | deuda | 1 | 0 | 0 | **1** | ~13 | R37, R38 |
| TASK-018 | deuda | 1 | 0 | **2** | **1** | ~12 | R41, R42 |
| TASK-020 | deuda | 1 | 0 | 0 | 0 | ~7 | R44, R45, R46 |

**Totales:** 9 tareas, **11 ciclos**, **3 cortes**, **3 bloqueos**, **5 decisiones de Nivel 3**,
**~110 verificaciones**, **22 riesgos nuevos**.

### Qué es firme y qué no, columna por columna
- **Origen, Ciclos, Cortes, Bloqueos, Riesgos: [FIRME].** Los ciclos salen de los commits de
  `status:` —`TASK-011: status REJECTED (rechazo 1 de 3)` y los dos `reintento 1`, más el rojo por
  lógica de TASK-013 que devolvió la tarea al implementador—. Los cortes salen de las
  notificaciones de límite de turnos y de los commits WIP. Los bloqueos, de los commits
  `BLOCKED_TECNICO` y del WIP de TASK-018. Los riesgos, de las atribuciones de `RISKS.md`.
- **Nivel 3: [FIRME]**, contra las entradas `[GASTÓN]` de `DECISIONS.md`.
- **Verificaciones: [RECONSTRUIDO].** Los prompts no se guardan. Los números son estimaciones del
  director con un error que puede ser de ±3, y **no deben usarse para concluir nada por sí solos**.
  Sirven como referencia gruesa hasta que haya datos firmes de TASK-004 en adelante.

---

## Lo que los datos firmes ya muestran

**1. Los tres cortes son de tester y auditor. Ninguno de implementador.** TASK-003 (tester y
auditor) y TASK-013 (tester). El implementador escribe una vez y verifica al final; tester y
auditor hacen **un ciclo completo de entorno por cada propiedad** —levantar, mutar, correr, leer,
revertir, correr de nuevo—. Es consistente con la hipótesis, pero **tres casos no la prueban**.

**2. La deuda superó al plan: 6 de 9 tareas no estaban en el lote original.** TASK-011, 012, 013,
018, 019 y 020 aparecieron durante el trabajo. Ninguna fue capricho: cada una cierra un riesgo que
se encontró verificando. Es el dato que más va a servir para proyectar, porque **el plan original
solo predice 3 de cada 9 tareas reales**.

### Matiz obligatorio antes de proyectar: la proporción 2 a 1 es un techo, no una ley
Señalado por Gastón el 2026-09-05: buena parte de esas seis fue **deuda acumulada saliendo a la
luz**, y **esa fuente se agota**. Correcto — pero al clasificar las seis, la mitad **no** es de esa
clase:

| Tarea | Clase de deuda | ¿Se agota? |
|---|---|---|
| TASK-011 | **preexistente** — el test de aislamiento de FASE -1 nunca probó lo que decía | sí |
| TASK-013 | **preexistente** — el default del seed venía de FASE -1 | sí |
| TASK-019 | **mixta** — la fragilidad de comparar texto era preexistente; la rotura la disparó un `checkout` nuestro | parcial |
| TASK-012 | **propia** — R14 nació en TASK-001; las repetibles, de un hallazgo de TASK-003 | **no** |
| TASK-018 | **propia** — las tres copias de `crear_venta()` las creamos nosotros en TASK-002 y TASK-003 | **no** |
| TASK-020 | **propia** — el test dependiente del entorno lo escribimos en TASK-013 | **no** |

O sea: **tres preexistentes, tres propias, una mixta.** La conclusión de Gastón se sostiene y hay
que agregarle la otra mitad: **la deuda preexistente se agota, la que genera el propio trabajo no.**
Y las tres propias salieron de tareas que estaban haciendo las cosas bien — TASK-018 existe porque
TASK-002 y TASK-003 usaron el patrón correcto de no editar migraciones aplicadas.

**Qué no sabemos, y es lo que importa para la proyección:** cuánta deuda propia generan los
servicios de dominio. No hay ningún caso todavía. Usar 2 a 1 como **techo razonable** es defendible;
usarlo como ley, no.

**3. Los bloqueos son todos de permisos, y todos de `.claude/`.** Tres, en dos tareas. Ninguno se
esquivó por shell.

**4. TASK-003 fue la más cara y no fue la más grande.** Dos cortes, ~16 verificaciones. TASK-018
tocó cuatro archivos y no se cortó nunca. Consistente con la hipótesis; insuficiente para
confirmarla.

## Contra qué se va a contrastar la hipótesis

Si el costo lo predicen las verificaciones, **TASK-005 a TASK-010 deberían ser las más caras del
proyecto**: cada servicio de dominio tiene tres o cuatro invariantes, y cada una con su mutación
son unos 8 ciclos de entorno por tarea, más lo mismo del lado del auditor.

**La predicción concreta, escrita antes de saberlo:** si la hipótesis es correcta, TASK-005 a
TASK-010 van a necesitar **más de un ciclo** o **cortarse al menos una vez cada una**, aunque
toquen un solo archivo de migración. Si resultan baratas, la hipótesis está mal y el costo lo
predice otra cosa.

Queda escrito acá para que no se pueda ajustar después.
