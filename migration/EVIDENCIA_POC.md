# Evidencia para el POC_REPORT

Escribe solo el director. Abierto el 2026-09-05 a pedido de Gastón.

Acá se acumula **evidencia medida** de que PostgreSQL resuelve problemas que el ERP actual no
resuelve. Es el insumo del paso 7 del plan maestro, el `POC_REPORT.md` con el GO / ADJUST / NO-GO.

**Criterio de admisión, y es estricto:** entra lo **demostrado**, no lo argumentado. Cada entrada
tiene que decir qué se midió, con qué números, quién lo verificó y dónde está el test que lo
sostiene. Una afirmación sobre cómo *debería* comportarse el diseño no es evidencia: este proyecto
ya tuvo que retirar dos afirmaciones cómodas —R8 y el perfil duplicado de R16— por no distinguir
eso a tiempo.

**No entra acá** lo que salió bien sin comparación contra el comportamiento actual. La pregunta del
PoC no es si PostgreSQL funciona: es si **resuelve los cuatro problemas que motivan la migración**
—atomicidad, concurrencia, doble envío e integridad— que el ERP no puede resolver porque escribe
directo desde el navegador.

---

## E1 — El contador no quema números cuando la operación falla
**Problema que resuelve: atomicidad.** Primera evidencia medida de una mejora concreta sobre el ERP
actual, marcada como tal por Gastón el 2026-09-05.

**Cómo se comporta el ERP hoy (R10):** `js/ventas.js` incrementa `contadores/ventas` en una
**transacción propia**, antes de escribir la venta. Una venta que falla después **deja un hueco en
la numeración**: el número se quemó y no vuelve.

**Cómo se comporta PostgreSQL:** el contador vive **dentro de la transacción de la operación**, así
que un `ROLLBACK` **devuelve el número**. Medido por el implementador de TASK-004 sobre la base
real, no razonado sobre el diseño.

**Medición adicional del mismo mecanismo:** dos sesiones estrenando el mismo contador obtienen
**1 y 2** —la segunda bloquea hasta el commit de la primera—, así que la exclusión tampoco depende
de la suerte del scheduling.

**Estado de la evidencia:** medida por el implementador, **pendiente de fijarse como test** y de
verificación independiente del auditor. Hasta que eso ocurra es una medición, no una invariante.
Se actualiza esta entrada cuando cierre TASK-004.

**Por qué importa más de lo que parece:** la correlatividad de comprobantes es una obligación
fiscal. Un hueco no es una molestia estética, hay que justificarlo. Que el mecanismo lo impida
**por construcción** —y no por cuidado del programador— es exactamente la clase de argumento que
justifica una migración.

---

## Cómo se usa este archivo
Cada entrada nueva lleva un identificador `E-N`, el problema de los cuatro que ataca, la
comparación contra el comportamiento actual con su riesgo `RN` de referencia, la medición con
números, y **el estado de la evidencia**: medida, fijada como test, o verificada por el auditor.
Solo las verificadas por el auditor entran al `POC_REPORT.md` sin salvedad.
