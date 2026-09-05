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

---

# La otra cara: lo que NO salió como esperábamos

Sección pedida por Gastón el 2026-09-05, con este argumento: **"si el informe solo tiene evidencia
a favor, un lector razonable va a desconfiar de todo el resto. Y yo tengo que poder decidir el GO
viendo las dos caras."**

Es una obligación del informe, no un gesto de humildad: **un PoC que solo produce buenas noticias
no está midiendo, está confirmando.** Lo que va acá no invalida las mejoras de arriba — las hace
creíbles.

## C1 — El ERP ya discriminaba el IVA. La migración replica, no mejora
La decisión **P6** partía de una premisa **falsa**, tomada de `CLAUDE.md`: que el IVA en ventas
estaba "preparado pero calculado en $0". El código real lo discrimina desde hace tiempo —
`discriminarIva()` resta hacia atrás, el asiento imputa el neto a 4.1 y el IVA a 2.1.2 — y esa
premisa se corrigió recién el 2026-09-04.

**Qué significa para el PoC:** TASK-002 **no arregló nada**. Reprodujo un comportamiento que ya
existía, y el criterio de éxito fue justamente ése: dar **el mismo centavo**, no uno mejor. El
auditor lo verificó con 34.136 comparaciones contra el cuerpo literal de `discriminarIva()` y 400
asientos completos contra una réplica de `js/ventas.js`, **cero divergencias**.

Es trabajo necesario para migrar, pero **no es un argumento a favor de migrar**. Y la línea falsa
de `CLAUDE.md` estuvo ahí lo suficiente como para que una decisión se construyera sobre ella: eso
también es un dato sobre el estado del proyecto.

## C2 — La UI ya impedía la venta con pendiente sin cliente
**P2** formaliza en el esquema una regla que **ya se cumplía**. Verificado por el director el
2026-09-05 en `js/venta-pago-modal.js:30`: el medio "Pendiente de pago" **solo aparece en la lista
si hay un cliente seleccionado**, y el comentario del archivo lo dice explícitamente — *"no tiene
sentido dejarle una deuda a Consumidor final"*.

**Qué significa:** el `CHECK` de PostgreSQL convierte una convención de la interfaz en una
**garantía estructural**, lo cual es una mejora real de robustez — pero **no cierra un agujero
alcanzable hoy**. Nadie podía producir ese estado desde la UI.

La distinción importa para el GO: es distinto "esto arregla algo que está pasando" de "esto impide
algo que hoy no puede pasar, pero dependería de que nadie toque la UI".

## C3 — El costo: 6 de 9 tareas cerradas no estaban en el plan
Dato firme, de `METRICAS.md`. El primer lote de FASE 1 planificó diez tareas. De las **nueve
cerradas** al 2026-09-05, **seis no estaban en el plan**: TASK-011, 012, 013, 018, 019 y 020.
Además: **11 ciclos** para 9 tareas, **3 cortes** de agentes por límite de turnos, **3 bloqueos**
que necesitaron intervención de Gastón, y **22 riesgos nuevos**.

**Qué significa para el GO:** el plan original **predice 3 de cada 9 tareas reales**. Cualquier
estimación de lo que falta —TASK-005 a TASK-010 y la fase de API, adaptador y shadow— tiene que
contar con eso.

**El matiz que evita proyectar de más**, y también el que evita subestimar: la mitad de esa deuda
era **preexistente** y se agota; la otra mitad la **generó el propio trabajo** y no se agota. Y las
tres propias salieron de tareas que estaban haciendo las cosas bien: TASK-018 existe porque
TASK-002 y TASK-003 usaron el patrón correcto de no editar migraciones aplicadas. **No es deuda por
descuido, es deuda por construcción**, y ésa es la que hay que presupuestar.

---

## Cómo se usa este archivo
Cada entrada **a favor** lleva un identificador `E-N`, el problema de los cuatro que ataca, la
comparación contra el comportamiento actual con su riesgo `RN` de referencia, la medición con
números, y **el estado de la evidencia**: medida, fijada como test, o verificada por el auditor.
Solo las verificadas por el auditor entran al `POC_REPORT.md` sin salvedad.

Cada entrada **en contra** lleva `C-N` y el mismo estándar de prueba. **No se admite una entrada
`E` sin buscar activamente su contraparte `C`**: si una mejora se mide solo donde conviene, no está
medida. Al cerrar cada tarea se revisan las dos listas, no solo la primera.

**Señal de alarma para el propio director:** si en algún momento las entradas `E` superan mucho a
las `C`, lo más probable no es que el PoC vaya espectacular — es que se dejó de buscar la otra
cara. Al 2026-09-05 van **1 a favor y 3 en contra**, y eso es sano, no preocupante.
