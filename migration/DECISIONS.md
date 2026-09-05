# Decisiones

Append-only. Escribe solo el director. Formato: una entrada por decisión, con fecha.
Las decisiones de Nivel 3 las responde Gastón y quedan acá como regla para todos los agentes.

---

## 2026-09-03 — [GASTÓN] localhost es siempre emulador
El ERP servido desde localhost/127.0.0.1 se conecta SIEMPRE a los emuladores, sin flag de
escape. Para operar producción desde la PC de Gastón se usa el sitio de Netlify o un hostname
alternativo mapeado en el archivo hosts. Motivo: eliminar la posibilidad de escribir en
Firestore de producción desde el entorno de desarrollo.

## 2026-09-03 — [NIVEL 2] Emulator Suite en vez de proyecto Firebase de desarrollo
Se usa Firebase Emulator Suite, no un segundo proyecto Firebase. Motivo: la conexión es a
127.0.0.1, no requiere login ni IAM, y ningún error de configuración puede hacer que apunte a
producción. Un proyecto dev separado reintroduce el riesgo de `firebase use` equivocado.

## 2026-09-03 — [NIVEL 2] Vitest como framework de tests
Motivo decisivo: `resolve.alias` mapea los imports por URL de gstatic.com al paquete npm
firebase@10.13.0, lo que permite importar los módulos del ERP desde Node sin modificar su
código. node:test no puede hacerlo sin un loader propio. Verificado: 7 tests corriendo contra
js/facturacion.js y js/contabilidad.js sin tocar una línea del ERP.

## 2026-09-03 — [NIVEL 2] El push lo hace Gastón
Los agentes commitean y mergean localmente. El push a GitHub lo ejecuta Gastón con
DELFINO_PUSH_OK=1. Motivo: elimina toda la superficie de deploy y de GitHub del lado de los
agentes con una barrera física, no con una instrucción.

---

## PENDIENTE DE GASTÓN
(el director escribe acá las preguntas de Nivel 3 antes de hacerlas)

### 2026-09-04 — TASK-013 espera UNA edición de Gastón: sacar `.claude/settings.json:88`
RESPONDIDO el 2026-09-04. Gastón elige **levantar solo el `deny`** y dejar
`GCLOUD_PROJECT=demo-delfino` como está. La separación es deliberada: los agentes siembran —o
más bien, no siembran— en el namespace de juguete, y `delfino-hogar-erp` queda para Gastón. Con
el chequeo que va a poner TASK-013, un agente que intente sembrar **aborta ruidosamente** en vez
de ensuciar en silencio, que es exactamente el comportamiento buscado.

ACCIÓN PENDIENTE, la hace Gastón: borrar la línea 88 de `.claude/settings.json`,
`"Edit(scripts/seed-emulator.mjs)",`. Ningún agente puede tocar ese archivo. Apenas esté hecho,
TASK-013 sale de BLOCKED_TECNICO y se retoma con el implementador desde donde quedó.

El detalle del bloqueo, que se conserva porque explica el porqué:

1. **`.claude/settings.json:88`** tiene `"Edit(scripts/seed-emulator.mjs)"` en `deny`. Es el único
   archivo de TASK-013, así que la tarea no se puede implementar. El implementador lo reportó y
   **no buscó ninguna vía alternativa** —node fs, sed, cp— para saltear la regla, que es el
   comportamiento correcto: una regla `deny` que se puede eludir con otra herramienta no es una
   barrera.
2. **`.claude/settings.json:8-9`** fuerzan `GCLOUD_PROJECT=demo-delfino` y
   `GOOGLE_CLOUD_PROJECT=demo-delfino` en toda sesión de agente. El Admin SDK las obedece, así que
   aunque el default del script pase a `delfino-hogar-erp`, cualquier agente que corra
   `npm run seed` seguiría sembrando en el namespace equivocado. Con el chequeo de la tarea puesto
   abortaría ruidosamente, que es mejor que hoy, pero ningún agente podría sembrar.

Puede que la línea 2 sea deliberada: mandar a los agentes a un namespace de juguete y dejar
`delfino-hogar-erp` para Gastón es una separación razonable. Si es así, no hay nada que corregir
ahí y alcanza con levantar el `deny`; el bug que Gastón sufrió es el del **default del script**,
que le pega cuando corre `npm run seed` a mano, sin el entorno de agente.

Inventario medido por REST en los dos namespaces del emulador (no por lo que imprime el script):
- `delfino-hogar-erp`: Auth 1 usuario (`admin@delfino.local`), Firestore 10 colecciones / 35 docs.
- `demo-delfino`: Auth **0 usuarios**, Firestore **el mismo set exacto**, 10 colecciones / 35 docs,
  incluido el perfil duplicado `usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9`.

El duplicado es solo de Firestore: el usuario de Auth existe una sola vez.

Los tres ítems siguientes se movieron desde MIGRATION_STATUS.md el 2026-09-04, a pedido de
Gastón: dependen de él y este es el lugar donde los va a buscar. Ninguno bloquea TASK-001 a
TASK-010.

### 2026-09-04 — Punto de venta de PRODUCCIÓN para ARCA: ¿compartido con GBP o exclusivo?
ABIERTA. No bloquea homologación ni la PoC; se resuelve antes de facturar en producción.

Dato verificado por Gastón el 2026-09-04: existen tres puntos de venta de tipo "RECE para
aplicativo y web services" — el **4** (Av. 24 4464), el **5** (Av. 24 4560) y el **6**
(Lirio 863). **Para homologación no hace falta crear ninguno**, así que esa parte del checklist
ya está resuelta.

Lo que queda abierto es producción: si Delfino emite por los **mismos** puntos de venta que usa
GBP —con numeración intercalada entre los dos sistemas— o por **uno nuevo exclusivo**.

Es Nivel 3 por partida doble: es criterio fiscal (la numeración de comprobantes por punto de
venta debe ser correlativa y sin huecos) y toca la relación con GBP, que es un sistema en
producción que hoy factura. Con numeración intercalada, los dos sistemas comparten un correlativo
que ninguno de los dos controla entero, y un hueco o un salto no se puede atribuir sin cruzar los
dos. Con un punto de venta exclusivo, Delfino controla su propia serie de punta a punta.

No la toma ningún agente. TASK-014 puede juntar los datos que ayuden a decidirla —cómo numera GBP
hoy, qué implica intercalar— pero no la resuelve ni la asume.

### 2026-09-04 — El adaptador necesita `js/firebase.js`, que solo modifica Gastón
El punto de interposición natural entre la UI y la persistencia es `js/firebase.js`, único acceso
al SDK, y está en la lista de archivos que solo modifica Gastón. Además las páginas cargan desde
`dist/`, así que ningún cambio ahí tiene efecto sin `npm run build`. El adaptador se diseña y se
prueba sin tocar ese archivo; la conexión final es una acción de Gastón. Hay que resolverlo antes
del paso 5 del plan maestro.

---

## 2026-09-04 — [GASTÓN] El test de aislamiento se autentica; `firestore.rules` no se toca
El test `_safety` de `tests/integration/safety.test.js` fallaba con `PERMISSION_DENIED` porque
escribía sin autenticar en una colección que las reglas no contemplan. Había dos salidas:
agregar `match /_safety/{id}` a `firestore.rules`, o que el test se autentique.

Gastón decide la segunda, y el motivo vale como regla general: **agregar una regla a producción
para que pase un test es la salida equivocada**. `firestore.rules` describe qué puede hacer el
ERP real; relajarlo para acomodar un test invierte la relación entre el sistema y su prueba.

Además el test mejora: autenticándose con `admin@delfino.local` contra el emulador de Auth
—igual que hace el ERP real— pasa a probar lo que dice probar, que la escritura va al emulador,
en vez de probar que las reglas dejan escribir sin usuario, que no era la propiedad buscada y
que además es falsa.

Se implementa en TASK-011, que va antes que TASK-002: la suite tiene que estar verde antes de
tocar reglas de negocio.

## 2026-09-04 — [NIVEL 3 · GASTÓN] El neto absorbe el centavo de redondeo, no el IVA
Con alícuotas mixtas —21 % y 10,5 % en la misma venta— neto e IVA por línea no suman exactamente
el total y alguien tiene que absorber el resto. Como es una imputación a una cuenta fiscal, se
preguntó antes de implementar en vez de deducirla.

DECISIÓN: **el IVA queda exacto y el neto absorbe la diferencia.** El IVA se calcula y se redondea
por línea, se suman las líneas, y el neto de la venta se obtiene como residuo:

    iva_linea  = round(subtotal − subtotal / (1 + alicuota))
    iva_total  = round(SUM(iva_linea))
    neto_total = round(total − iva_total)      ← residuo

Imputación: `total` al debe entre 1.1.1 / 1.1.5 / 1.1.2 según destino; `neto_total` al haber en
4.1 Ventas; `iva_total` al haber en 2.1.2 IVA Débito Fiscal.

Motivos:
1. **Es lo que el ERP hace hoy**, verificado en `js/ventas.js:412-413`: `ivaVenta` se suma por
   línea y `ventaNeta = redondear(total − ivaVenta)`. La PoC no introduce un cambio contable
   silencioso, y el shadow no arrastra diferencias artificiales.
2. **La cuenta fiscal queda exacta.** El centavo cae en 4.1 Ventas, una cuenta de resultado
   propia, y no en 2.1.2, que es lo que se declara.
3. **El asiento no puede desbalancearse por redondeo**, porque el neto es el tapón:
   Debe = total, Haber = (total − iva) + iva = total. Vale con cualquier combinación de alícuotas.

Consecuencia para TASK-002, contraintuitiva y que hay que decir en voz alta: el error de redondeo
con alícuotas mixtas **no puede aparecer** si el neto se calcula como residuo. Aparece solo si
alguien calcula el neto por línea y lo suma. Eso es exactamente lo que la implementación tiene que
evitar y lo que el test tiene que ser capaz de cazar: la invariante Debe = Haber no alcanza para
detectarlo, porque una implementación que reparta mal el centavo puede cerrar igual. El test tiene
que verificar además **el monto imputado a 2.1.2**, línea por línea.

## 2026-09-04 — [GASTÓN] ARCA queda desplegada en homologación, y `arcaActivo` sigue en false
Cierra el pendiente de R8 con un dato verificado en Firebase Console, no con una suposición:
`arcaAutorizarComprobante` **no estaba desplegada** — de las 25 funciones que había, ninguna era
esa. Ahora sí lo está, en `southamerica-east1`, y las desplegadas pasan a 26.

Estado: certificado de homologación por WSASS (alias `DelfinoERP`, CUIT del certificado
20107859951), autorización para `ws://wsfe` con CUIT representado 33712451039, y
`AFIP_CERT_HOMO` / `AFIP_KEY_HOMO` / `AFIP_CUIT_HOMO` en Secret Manager con valores reales.

**`arcaActivo` sigue en `false` y no lo toca ningún agente. El ambiente `produccion` no se usa
nunca.** La primera prueba se hace en `ambiente: "testing"`, contra homologación, y su objetivo
es llegar a un CAE **o a un error entendido y documentado** — las dos cosas son un resultado
válido; lo que no es válido es un intento sin diagnóstico.

Consecuencia que conviene tener presente: antes había código fiscal a un flag de distancia; ahora
hay código fiscal a un flag de distancia **con credenciales cargadas y la función en línea**. La
barrera sigue siendo la misma —`arcaActivo`— pero lo que hay del otro lado es más real.

## 2026-09-04 — [GASTÓN] Los archivos se editan con Edit, nunca por shell. Para todos los roles
Gastón rechazó un comando del implementador que editaba `scripts/seed-emulator.mjs` con
`python -c`. Lo eleva de corrección puntual a **regla permanente**, y con razón: ya lo había
marcado horas antes para `TASKS.md` y el patrón reapareció en otro rol y otro archivo.

REGLA: nada de `python -c`, `sed -i`, `cp`, redirecciones ni heredocs para modificar archivos del
repositorio. Archivo existente → `Edit`. Archivo nuevo → `Write`. Sin excepciones y **sin excepción
para el director**, que fue el primero en romperla.

Los tres motivos, todos observados en este proyecto:

1. **Le saca al guard su única señal.** Una escritura por shell sobre una ruta protegida no se
   distingue de una maliciosa: el hook ve un comando, no una edición. Es el mismo principio por el
   que se prohibió pasar `-c core.hooksPath=.githooks` en los commits: una barrera que se elude
   cambiando de herramienta no es una barrera.
2. **Le saca a Gastón el diff**, es decir, la posibilidad de ver qué cambia antes de aprobarlo.
3. **Vacía los permisos de contenido.** Éste es el argumento nuevo y el más filoso. El `deny` de
   `scripts/seed-emulator.mjs` se levantó **para que el implementador pudiera usar `Edit`**. Si
   igual lo edita por shell, el permiso no cambió nada: el archivo se modifica por un canal que el
   sistema de permisos no mira. El levantamiento del `deny` habría sido teatro.

Deuda propia reconocida: el director siguió usando `sed -i` y `python -` sobre `migration/*.md`
—RISKS, MIGRATION_STATUS, DECISIONS— después de haber aceptado la regla para `TASKS.md`. Corregido
desde el 2026-09-04. La regla no se cumple porque esté escrita; se cumple porque se aplica también
a quien la escribe.

## 2026-09-04 — [NIVEL 2] Aprobación con salvedades: se mergea, no se cierra
A pedido de Gastón, tras el corte del auditor en TASK-003. Un `.approved` que diga "no llegué a
reproducir la mutación X" **no es lo mismo** que uno completo y no puede pasar a DONE como si lo
fuera. La diferencia tiene que verse en el estado de la tarea, no solo en el texto del archivo.

DECISIÓN: el auditor que no llegó a verificar todo escribe
`migration/approvals/TASK-NNN.approved-parcial.md` en vez de `.approved`. La tarea queda en
**APPROVED** y **ahí se queda**: se permite el merge, no el DONE. El director crea en el acto una
tarea de verificación que enumera qué quedó sin reproducir. Cuando esa tarea cierra, el auditor
escribe el `.approved` definitivo y recién entonces la original pasa a DONE.

**Es barrera, no convención**, y esto es lo que hace que la regla valga: el hook veta DONE con un
`Test-Path` **exacto** sobre `migration/approvals/TASK-NNN.approved`
(`.claude/hooks/guard.ps1:139-141`). Un archivo llamado `.approved-parcial.md` no satisface ese
test, así que el intento de marcar DONE **falla solo**. No depende de que el director se acuerde
de la diferencia dos semanas después. No hizo falta tocar `.claude/` —que además no lo puede tocar
ningún agente—: la barrera ya existía y solo había que elegir un nombre de archivo que cayera del
lado correcto.

Por qué se permite el merge y no se frena todo: la cadena TASK-001 → TASK-010 es lineal, así que
bloquear el merge por una verificación pendiente detiene el proyecto entero. Lo que hay que evitar
no es avanzar, es que una tarea **parezca** cerrada sin estarlo. Se elige visibilidad sobre
bloqueo.

## 2026-09-04 — [NIVEL 2] Las funciones de dominio pasan a migraciones repetibles
Cierra R28. Decidido antes de TASK-004, a pedido de Gastón, con el margen que da haber
verificado que **TASK-004 no toca `crear_venta()`**: la función llama a `siguiente_numero('ventas')`
por nombre y esa firma no cambia. La próxima que sí la toca es TASK-007.

PROBLEMA: `crear_venta()` está copiada entera en 0002, 0003 y 0004. El patrón `CREATE OR REPLACE`
por migración es correcto en su motivo —no se editan migraciones aplicadas, porque rompe
`schema_migrations`— pero copia ~90 líneas para cambiar tres, y cada cambio futuro suma una copia.

DECISIÓN: **migraciones repetibles**, el patrón que Flyway llama `R__`. Se agrega
`backend/db/functions/`, cuyos archivos el migrador **reaplica cuando cambia su hash**, siempre
después de las migraciones numeradas. `crear_venta()` se muda ahí y pasa a tener **una sola copia
canónica**. Las migraciones numeradas dejan de redefinirla; si una necesita cambiarla, edita el
archivo de la función.

Se implementa en dos pasos, y el primero aprovecha que TASK-012 ya es dueña de `migrar.js`:
- **TASK-012** suma el soporte de repetibles a lo que ya hacía (R14, validación de flags). Mismo
  archivo, mismo dueño: evita que dos tareas declaren `backend/src/db/migrar.js` en `files:`.
- **TASK-018** mueve `crear_venta()` a `backend/db/functions/crear_venta.sql`.
Y **TASK-007 pasa a depender de TASK-018**, para que la conversión de pedido en venta no genere
la cuarta copia.

### Alternativas evaluadas y por qué no
- **Dejarlo como está con el comparador de textos del tester.** Es lo que hay hoy. Rechazado por
  Gastón: no escala. El costo de revisar N copias crece más rápido que N.
- **Factorizar el cuerpo en funciones chicas que `crear_venta()` llame.** Ayudaría si los cambios
  fueran locales, pero los de 0004 fueron tres `INSERT` distintos dentro del cuerpo: no se aíslan
  sin partir la función por donde no tiene junta natural.
- **Un test que exija una sola definición en todo el repo.** Rompe el patrón sin reemplazarlo: no
  habría forma legítima de cambiar la función.

### Lo que acota el riesgo mientras tanto, y hay que decirlo
El comparador de textos **no es el único centinela**. Los tests de TASK-002 corren contra la
función **viva**, así que una copia futura que rompa el IVA, la imputación de pagos o la fecha
local sale en rojo sin que nadie compare textos. Lo que no cubre es una divergencia de
comportamiento que ningún test mire — y ése es exactamente el caso que aparece en producción y no
en la suite. Por eso se cierra, y no se acepta como residual.

## 2026-09-04 — [NIVEL 2] Las invariantes de concurrencia van en tarea propia, no en la del servicio
**Si en el futuro alguien ve una tarea de tests separada de su implementación y quiere
"arreglarla" juntándolas: leé esto antes. La separación es deliberada.**

DECISIÓN: las invariantes que se prueban **entre** operaciones salen de la tarea de cada servicio
y viven en tareas propias — TASK-016 (concurrencia) y TASK-017 (integridad global). Las
invariantes que se prueban **dentro** de una operación se quedan donde estaban.

### Por qué, tres razones

**1. Es la regla que ya usamos, no una nueva.** "Dos tareas nunca comparten archivos en `files:`"
y "cada tarea cabe en 30-90 minutos". `ORDEN_DE_BLOQUEO` necesita dos transacciones cruzadas sobre
dos productos; `FACTURAR_VS_MODIFICAR` necesita facturar y modificar el mismo pedido en paralelo.
Ninguna de las dos pertenece al archivo de un solo servicio, porque **no se puede escribir hasta
que existan los dos lados**. Meterlas en la tarea del primer servicio obliga a esa tarea a
esperar al segundo, o a escribir un test que todavía no puede correr.

**2. Son otro tipo de test, no un test más largo.** Probar concurrencia exige dos conexiones,
sincronización entre ellas, y verificar que **no** pasó algo —un deadlock, una doble reserva— en
vez de que pasó. El armado no se parece al de un test de operación y no se reutiliza; mezclarlos
hace que el archivo de un servicio cargue infraestructura que solo usan dos de sus tests.

**3. R20 multiplica el trabajo del tester Y DEL AUDITOR, y hay que dimensionarlo.** Ésta es la
parte que se descubrió midiendo, no razonando. En TASK-003 se cortaron **los dos**: el tester con
35 tests escritos y sin commitear, y después el auditor sin dejar veredicto. Es la primera tarea
donde pasa, y la carga era comparable — al auditor se le pidió reproducir tres mutaciones propias
más verificar tres copias de `crear_venta()`.

Consecuencia que hay que mirar de frente: **el problema no es solo del tester.** La regla de que
el auditor reproduce por su cuenta en vez de creerle al reporte es la que sostiene R20 —sin ella
la demostración de falla es una afirmación más— pero le da al auditor una carga del mismo orden
que la del tester. Partir TASK-016 y TASK-017 alivia al tester y **no hace nada por el auditor**,
que igual tiene que reproducir todo lo de la tarea que audita. Queda anotado como pregunta abierta
para el próximo corte: si el auditor necesita un equivalente —auditar por bloques, o un veredicto
en dos pasadas— o si alcanza con priorizar y permitir la aprobación con salvedades, que es lo que
se probó primero. La causa no es que 35 tests sean muchos: es que exigir la
demostración de que cada test **puede fallar** multiplica el trabajo. El tester no solo escribe —
levanta la base, corre, diagnostica, **planta la mutación, verifica el rojo, la revierte** y
vuelve a correr. TASK-002 fueron 34 tests con dos mutaciones y entró justo; TASK-003 fueron 35 con
más mutaciones y no entró.

La conclusión **no** es aflojar R20. Es lo que más valor dio hasta ahora: descubrió que el test de
aislamiento no discriminaba (R20), que el balance contable no detecta un centavo mal imputado
(TASK-002), y que el migrador registraba migraciones fallidas si el INSERT salía de la transacción
(TASK-001). Ninguna de esas tres aparece sin la mutación. **Se sigue pagando.** Lo que cambia es
que ahora sabemos cuánto cuesta, y el tamaño de las tareas se calcula contando mutaciones, no
tests.

### Dependencias: se prueba entre operaciones, así que depende de las dos
Marcado por Gastón: `FACTURAR_VS_MODIFICAR` no se puede probar hasta que `facturar_pedido` **y**
`modificar_pedido` estén las dos hechas. Por eso TASK-016 depende de TASK-008 —el último servicio
cuya concurrencia cubre— y no de TASK-005. Y TASK-017, que verifica integridad global tras N
operaciones exitosas y M fallidas, depende de TASK-010: no existe "el sistema entero" hasta que
existan todas las operaciones.

### Qué NO cambia
El requisito de **implementación** se queda en la tarea del servicio: `crear_pedido` sigue
obligada a bloquear con `SELECT … FOR UPDATE` ordenado por `(producto_id, deposito_id)`, y
`facturar_pedido` sigue obligada a tener el guard. Lo que se mueve es **dónde se prueba que eso
funciona bajo concurrencia**, no la obligación de hacerlo.

## 2026-09-04 — [GASTÓN] CLAUDE.md corregido: el IVA no se calcula en $0
Corregido por Gastón en el commit `29eacb0`. La línea decía "El IVA en ventas está preparado pero
calculado en $0" y era falsa: `js/ventas.js` lo discrimina desde hace tiempo. La afirmación venía
del propio archivo de instrucciones del proyecto, así que **todo agente que lo leyera partía de
una premisa equivocada** sobre el dominio que TASK-002 implementa.

El texto nuevo no se limita a desmentirla: documenta la regla de redondeo —IVA redondeado por
línea y sumado, neto como residuo, el centavo cae en 4.1 y nunca en la cuenta fiscal— porque es
justo lo que hace falta saber para no reimplementarla al revés, y ya costó una consulta de
Nivel 3. Y deja explícito que esto **no** es facturación fiscal: `arcaActivo` sigue en `false`.

Vale como precedente: las tres afirmaciones falsas que FASE 0 encontró en el repositorio no eran
descuido de nadie, eran documentación que envejeció al lado de código que cambió. La corrección
sirve si además explica lo suficiente como para que la próxima persona no tenga que ir a leer el
código para creerle.

## 2026-09-04 — [GASTÓN] La primera invocación de ARCA la ejecuta Gastón, no un agente
El director marcó que "ambiente `testing`" limita el riesgo del lado de ARCA —no se emite un
comprobante fiscal válido— pero **no** del lado de Firebase: invocar `arcaAutorizarComprobante`
significa llamar a una **función real, en el proyecto real, con secretos reales** de Secret
Manager. Eso choca con dos reglas vigentes: ningún agente toca producción, y ninguna sesión
autenticada mientras trabajen agentes.

Gastón corrige el encuadre y la corrección es la parte que importa: *"dije «nunca ambiente
producción» pensando en ARCA y no vi que del lado de Firebase sí es producción"*. Y decide
ejecutar él la invocación **no como excepción a esas reglas, sino porque es exactamente el caso
que esas reglas existen para cubrir**. Textual: *"la primera llamada de facturación fiscal del
sistema la aprieto yo"*.

El trabajo se parte en dos, y la frontera es dónde termina lo que un agente puede hacer sin tocar
producción:

- **TASK-014, relevamiento.** Solo lectura sobre `functions/` y el repositorio. Termina en un
  **checklist accionable**: qué verificar o configurar en ARCA, en qué orden, y **cómo se sabe que
  cada cosa está lista**. Un checklist sin criterio de verificación no sirve.
- **TASK-015, el guion.** Deja escrito qué llamada exacta se hace, con qué datos, qué respuesta se
  espera y cómo distinguir un CAE de un error entendido. Lo **revisa el auditor antes** de que
  Gastón lo ejecute. Ningún agente lo corre.

Un CAE y un error entendido y documentado son **los dos** resultados válidos. Lo que no es válido
es un intento sin diagnóstico.

`arcaActivo` sigue en `false` y no lo toca ningún agente. El ambiente `produccion` de ARCA no se
usa nunca.

## 2026-09-04 — [GASTÓN] Un test verde que no discrimina es peor que no tener test
LECCIÓN GENERAL, aplica a toda la suite que viene, no solo al caso que la originó.

Hallazgo de TASK-011: el test de aislamiento escribía un documento y lo leía de vuelta **con el
mismo cliente**. Cuando el tester forzó el escenario de aislamiento roto —un segundo Firestore en
otro puerto— el `getDoc` de vuelta **pasó igual**: si el cliente apunta al lugar equivocado,
escribe ahí y lee ahí, y el test da verde. El assert no discriminaba nada. El auditor lo confirmó
reproduciéndolo por su cuenta.

O sea que el test que existía desde FASE -1 para detectar una fuga a producción no podía
detectarla. Estuvo así todo el tiempo, y el rojo por `PERMISSION_DENIED` lo venía tapando: se
leía como "problema de reglas", no como "este test no prueba nada".

Regla para todas las tareas siguientes: **un test verde que no discrimina es peor que no tener
test, porque da confianza falsa.** Un test que no puede fallar es un test que no existe, con el
costo agregado de que nadie lo revisa. En consecuencia:

- Todo test de una invariante tiene que venir con la demostración de que **puede fallar**: se
  rompe deliberadamente la propiedad y se muestra el rojo. Ya se exigió en TASK-001 (mutación del
  migrador) y en TASK-011 (segundo emulador), y en los dos casos apareció algo que no se sabía.
- El auditor no da por buena esa demostración: la reproduce por su cuenta o inventa otra.
- Sospechar en particular de las verificaciones que usan **el mismo canal** que la operación que
  quieren verificar. El assert que sirve es el que llega por una vía independiente — en TASK-011,
  la lectura REST contra `127.0.0.1` con token `owner`, que producción nunca respondería.

Queda como R20 en RISKS.md para que aparezca también en la lista de riesgos.

## 2026-09-04 — [GASTÓN] El desfasaje de `projectId` del seed es un bug, y se corrige
Relevando TASK-011 apareció que `scripts/seed-emulator.mjs` usa
`GCLOUD_PROJECT || "demo-delfino"` mientras el emulador corre con `--project delfino-hogar-erp`.
Se había anotado como trampa a esquivar en el test. Gastón corrige el encuadre: **es un bug
real, no una particularidad del entorno de tests.** Ya causó un problema concreto el 2026-09-04
—el login local no encontraba el perfil del usuario, porque el usuario estaba sembrado en otro
proyecto— y el seed no advierte nada: termina con éxito.

Queda como R16 [MEDIA] y se corrige en TASK-013: el default apunta a `delfino-hogar-erp`, o el
seed aborta con un mensaje claro si no coincide con el proyecto del emulador.

Lección que vale más allá del caso: un hallazgo que aparece mientras se relevan las condiciones
de un test puede ser un defecto del sistema, no del test. Anotarlo solo como "trampa" lo habría
dejado vivo.

## 2026-09-04 — [NIVEL 2] R14 se corrige en TASK-012, no se acepta como riesgo residual
El auditor registró R14 [BAJA]: `migrar.js` decide el modo con `argv.includes()` sin validar
argumentos desconocidos, así que `--estad` no informa nada y **aplica las migraciones de verdad**.
Gastón lo saca de la lista de riesgos aceptados y lo manda a corregir: que un flag mal tipeado
ejecute SQL cuando el operador creía estar solo consultando es el tipo de cosa que muerde un
domingo. Queda como TASK-012, después de TASK-011 y antes o después de TASK-002 según convenga:
no bloquea el esquema.

## 2026-09-04 — [NIVEL 2] El cambio 8 del esquema entra en TASK-002, no en una tarea nueva
`fecha_operacion` como `date` local sin `toISOString()` (cambio 8 de ARCHITECTURE §2.3, P8 más el
bug de UTC) era el único de los ocho cambios obligatorios que no tenía tarea asignada en el primer
lote de FASE 1. Se agrega como criterio de aceptación de TASK-002, que ya toca la misma migración
y el mismo dominio —cómo se registra la venta—, en lugar de crear una TASK-011. Motivo, decidido
por Gastón: una tarea más en una cadena lineal de diez es un paso más de camino crítico sin ganar
nada. El título de TASK-002 se ajustó para reflejar el alcance real.

## 2026-09-04 — [NIVEL 2] Los contadores arrancan en 0 y la primera operación obtiene el 1
ARCHITECTURE §2.3 decía que `ventas` y `asientos` "arrancan en 1" y TASK-004 decía que "arrancan
en 0, de modo que la primera operación obtiene el número 1". El resultado buscado es el mismo,
pero la contradicción literal habría sido marcada por el auditor. Se corrige ARCHITECTURE para que
diga lo de TASK-004, que es la formulación verificable: describe el estado inicial de la fila y el
número observable de la primera operación, no una intención.

## 2026-09-04 — [NIVEL 2] La cadena lineal TASK-001 → TASK-010 se acepta como está
El primer lote de FASE 1 no admite paralelismo: son migraciones SQL numeradas y servicios que
dependen del esquema anterior. Diez tareas en un único camino crítico, donde un rechazo en
TASK-002 frena todo. Se evaluó y Gastón lo aceptó: el orden es real, no arbitrario, y es preferible
un camino crítico honesto a un paralelismo inventado que rompa el orden de las migraciones.

## 2026-09-04 — [P9 · GASTÓN] Tesorería: no se migran saldos, sí hay saldo inicial
Los saldos y movimientos actuales de cajas, bancos y cuentas financieras son datos de prueba y
NO se migran. Postgres arranca sin ellos.

Debe existir un mecanismo para cargar manualmente un SALDO INICIAL por caja, banco o cuenta
antes de la puesta en producción. Ese saldo tiene que quedar registrado como un MOVIMIENTO DE
APERTURA a partir del cual continúa la operatoria, nunca como una modificación invisible del
saldo.

Diseño que lo garantiza: el saldo NO se almacena como campo, se deriva de la suma de los
movimientos. El saldo inicial es un movimiento con motivo 'apertura' y fecha de corte. Con eso,
modificar un saldo sin dejar rastro es estructuralmente imposible, no solo está prohibido.
Mismo principio que `movimientos_stock` y que las reservas.

No se implementa ahora. Solo queda verificado que el diseño no lo impide.

## 2026-09-04 — [P9 · GASTÓN] Delfino ERP es la fuente de verdad de productos, precios y stock
REGLA ARQUITECTÓNICA. Las plataformas externas RECIBEN esa información desde Delfino ERP.

Una plataforma externa puede ORIGINAR una operación comercial —un pedido de Tiendanube— pero esa
operación ingresa al ERP y es el ERP quien determina sus efectos sobre stock, pedidos, ventas y
demás módulos internos.

No se cambia esta regla sin elevarlo como decisión arquitectónica.

Direcciones:
- Productos: Delfino ERP → Tiendanube. Tiendanube no modifica el producto maestro.
- Precios: Delfino ERP → Tiendanube. Un cambio manual en Tiendanube no sobrescribe el maestro.
- Stock: Delfino ERP → Tiendanube. El ERP calcula la disponibilidad y la publica.
- Pedidos: Tiendanube → Delfino ERP, y es el único flujo que empieza afuera. Tiendanube informa
  que hay un pedido; no manda stock. Con idempotencia para que el mismo webhook no genere dos
  pedidos internos.

Flujo objetivo: pedido en Tiendanube → webhook al backend del ERP → el ERP registra el pedido →
afecta o reserva stock según las reglas de Pedidos → Postgres queda con el stock verdadero → el
ERP sincroniza disponibilidad hacia Tiendanube.

Prohibido explícitamente: que Tiendanube modifique stock en Firestore mientras el ERP lo
modifica en Postgres. Dos fuentes de verdad.

VERIFICADO CONTRA EL CÓDIGO ACTUAL (2026-09-04): `tnWebhook` en `functions/tiendanube.js` NO
escribe stock. Solo registra el pedido en `ordenesTiendaNube`, usando el id externo como id del
documento —idempotente por diseño— y deja un log. La regla ya se cumple hoy; queda documentada
para que no se rompa.

## 2026-09-04 — [P9 · GASTÓN] Firestore durante la transición
Durante la PoC no se rompe ni se reemplaza la integración productiva existente.
La arquitectura objetivo contempla que, cuando Postgres sea la base operativa: Firestore deja de
ser fuente de verdad de stock; el webhook de Tiendanube no escribe stock operativo en Firestore;
los pedidos entran al backend del ERP; el ERP determina la afectación de stock; el ERP publica
stock y precios hacia Tiendanube.
No habrá dos caminos operativos paralelos después del corte.

---

## Procedencia de las decisiones que siguen

Las 30 entradas de abajo se tomaron el 2026-09-03 en una conversación que nunca se versionó, y
se incorporaron textualmente al repositorio el 2026-09-04. Hasta ese día `MIGRATION_STATUS.md`
las daba por presentes en este archivo y no lo estaban.

Componen: P1–P12 (12), Q1–Q4 (4), 8 entradas [GASTÓN] sin numerar, 5 [NIVEL 2] y 1 [ALCANCE].

Aviso de rótulo: P9 aparece dos veces con significados distintos. La P9 del 2026-09-03 es
"Corte limpio: solo maestros y stock". Las tres entradas del 2026-09-04 más arriba usan
[P9 · GASTÓN] como marca de sesión, no como número de decisión. Ambas se preservan tal cual.

---

## 2026-09-03 — [P1 · GASTÓN] Stock por depósito desde el inicio
La fuente de verdad es el stock por producto y depósito. Cualquier total general se deriva de
ahí. `stockTotal` NO puede ser una segunda fuente de verdad independiente. Durante la PoC puede
existir un único depósito principal. El modelo distingue stock físico, reservas y disponible.
CONTRADICCIÓN CON EL CÓDIGO: hoy la venta descuenta solo `productos.stockTotal` y nunca toca
`productos/{id}/stockPorDeposito`, que se edita a mano. Los dos valores pueden desincronizarse.
Prevalece esta decisión.

## 2026-09-03 — [P2 · GASTÓN] No hay saldo pendiente sin cliente
`monto_pendiente > 0` exige `cliente_id`. Validado en tres capas: UI, backend y constraint en
PostgreSQL. No se admite deuda anónima en Deudores por Ventas.
NOTA: la UI ya lo aplica (`js/venta-pago-modal.js` filtra "Pendiente de pago" sin cliente). Esta
decisión formaliza la regla en backend y base, donde hoy no existe.

## 2026-09-03 — [P3 · GASTÓN] Precio en la PoC: comportamiento actual, modelo preparado
La PoC conserva el precio basado en `producto.precioVenta`, editable en la línea según permisos.
La PoC NO reimplementa listas de precios. El modelo queda preparado para determinar precios por
lista, cliente o sucursal sin migración destructiva: la venta guarda una referencia opcional a la
lista utilizada.

## 2026-09-03 — [P4 · GASTÓN] Precio y costo congelados en la línea de venta
Cada línea conserva permanentemente: precio unitario, costo unitario, descuento, IVA cuando
corresponda, subtotal, y todo valor necesario para reconstruir el resultado económico. Los
cambios posteriores sobre el producto NO modifican una venta histórica. Es la invariante
HISTORICO_INMUTABLE.

## 2026-09-03 — [P5 · GASTÓN] El costo maestro no se actualiza solo
Método de costeo por producto: `ultimo` o `promedio`. Default para producto nuevo: `ultimo`.
Separación obligatoria:
- COSTO DE COMPRA: el costo real registrado en una factura puntual.
- COSTO MAESTRO: el costo vigente que el ERP usa para precios, márgenes y operaciones futuras.
Una factura puede registrar un costo distinto SIN modificar el maestro.
El maestro cambia solo por: (1) modificación manual de un usuario autorizado, o (2) aceptación
explícita de una actualización propuesta desde una factura. Si el usuario no acepta, la compra se
registra a su costo real y el maestro no cambia. Al aceptar: `ultimo` → el maestro pasa a ser el
costo aceptado; `promedio` → se recalcula el ponderado. Nunca en silencio.
Todo cambio de costo maestro genera historial inmutable con: producto, costo anterior, costo
nuevo, fecha/hora, usuario, origen (manual | factura_compra), compra relacionada, método de
costeo, motivo. Los cambios futuros nunca alteran compras ni ventas históricas.
CONTRADICCIÓN CON EL CÓDIGO: hoy `js/compras.js → crearCompra()` actualiza `costoReferencia`
automáticamente en cada compra, sin intervención del usuario. Prevalece esta decisión. Es un
cambio funcional visible en el flujo de compras.

## 2026-09-03 — [P6 · GASTÓN] IVA en ventas: estructura sí, lógica fiscal no
Las líneas de venta almacenan `iva_pct` e `iva_monto` desde ahora, aunque queden en cero según el
funcionamiento actual. Preparación estructural para ARCA/WSFE, NO activación de facturación
fiscal.

## 2026-09-03 — [P7 · GASTÓN] Continuidad de numeración en el corte
Las numeraciones que deban conservar continuidad continúan desde su último valor válido. No se
reinician en silencio por cambiar de base de datos.
TAREA DEL DIRECTOR: determinar y documentar cuáles necesitan continuidad real. La continuidad
importa aunque no se migre historial (P9), porque existen comprobantes ya impresos y entregados.

## 2026-09-03 — [P8 · GASTÓN] Dos fechas, nunca mezcladas
`fecha_operacion date`: el día comercial/contable al que pertenece la operación.
`creado_en timestamptz`: el momento real de creación. Dato de auditoría inmutable.
CONTRADICCIÓN CON EL CÓDIGO: hoy ventas, compras y `facturasGbp` guardan `fecha` como string
"YYYY-MM-DD", cobros y pagos la guardan como Date, y `contabilidad.js → normalizarFecha` las
unifica al vuelo. Prevalece esta decisión.

## 2026-09-03 — [P9 · GASTÓN] Corte limpio: solo maestros y stock. DEFINITIVO.
Se migran EXCLUSIVAMENTE: artículos/productos, stock vigente al corte, clientes, proveedores.
NO se migran, y la decisión es definitiva: ventas, compras, cobros, pagos, cuentas corrientes,
deudas de clientes, deudas con proveedores, saldos de caja, saldos bancarios, asientos contables,
comprobantes, movimientos históricos de stock, reservas históricas, entregas pendientes
históricas, historial de costos, historial de precios, logs históricos, auditorías históricas.
PostgreSQL comienza su propio historial operativo desde cero. El stock trasladado es el stock
inicial: no se reconstruye reproduciendo compras ni ventas anteriores.
Firestore puede quedar como consulta histórica, pero NO sigue siendo fuente operacional después
del corte. La reconciliación del corte se limita a: artículos + stock + clientes + proveedores.
Delfino Histórico (GBP) es un proyecto separado y no entra acá.

## 2026-09-03 — [P10 · GASTÓN] Las reservas surgen de operaciones, no de un campo manual
El concepto de stock reservado se conserva, pero no como un campo editable a mano. La reserva
surge de operaciones concretas y trazables: pedidos y ventas pendientes de entrega/retiro.

## 2026-09-03 — [P11 · GASTÓN] Stock físico, reservas y disponible; ciclo Pedido → Venta → Entrega
Definiciones:
- STOCK FÍSICO: mercadería que está en el depósito.
- RESERVADO: mercadería que sigue físicamente en el depósito pero está comprometida por un pedido
  o una venta pendiente de entrega/retiro.
- DISPONIBLE = físico − reservas activas. No se almacenan tres saldos independientes.

Venta con retiro inmediato: se genera la venta, se descuenta el físico, no queda reserva.
Venta pendiente de entrega: se genera la venta, se genera reserva, el físico no cambia; al
entregar se consume la reserva y se descuenta el físico.
Cancelación antes de la entrega: se libera la reserva, el físico no se modifica.

PEDIDOS: un pedido confirmado reserva stock sin generar venta ni descontar físico. Otro vendedor
no puede vender unidades ya comprometidas.

FACTURAR (en el contexto de Pedidos) significa CONVERTIR UN PEDIDO EN UNA VENTA REGISTRADA en
Delfino ERP. NO significa emitir un comprobante fiscal ante ARCA: no implica CAE, ni Factura
A/B/C, ni comunicación con ARCA. Dos procesos conceptualmente separados:
  conversión comercial: Pedido → Venta
  emisión fiscal futura: Venta → Comprobante fiscal ARCA
La conversión Pedido → Venta NO puede depender de que ARCA esté activo.

REGLA CRÍTICA al convertir: la mercadería del pedido YA está reservada. Al facturar NO se crea
una segunda reserva, NO se vuelve a bajar el disponible, NO se descuenta dos veces el físico.
  físico 10, pedido 2 → físico 10, reservado 2, disponible 8
  se factura, sigue pendiente de entrega → físico 10, reservado 2, disponible 8  (NO 4 / 6)
  se entrega → físico 8, reservado 0, disponible 8
Si al facturar la mercadería también se retira: se consume la reserva y se descuenta el físico,
todo en una única transacción.

TRAZABILIDAD de cada reserva: producto, depósito, cantidad, estado, origen, pedido relacionado,
venta relacionada, usuario, fecha de creación, fecha de consumo/liberación, motivo de cierre.

El sistema debe impedir: reservar más que el disponible; vender unidades reservadas por otra
operación; doble reserva al convertir pedido en venta; doble descuento físico; consumir dos veces
una reserva; liberar una reserva ya consumida; entregar más unidades que las correspondientes;
dejar reservas activas de pedidos cancelados; perder la relación Pedido → Venta → Reserva →
Entrega. Todo probado también bajo concurrencia.

## 2026-09-03 — [P12 · GASTÓN] Cloud SQL postergado
La PoC corre sobre PostgreSQL local en Docker. No se decide tamaño de instancia ni configuración
ni costos hasta que haya GO.

## 2026-09-03 — [GASTÓN] "Pendiente de pago" no es un medio de pago
`venta_pagos` contiene únicamente pagos reales: Efectivo, Transferencia, Tarjeta, Mercado Pago,
GoCuotas, BostonCred y otros medios configurados. La parte no cobrada se representa con
`monto_pendiente` y su tratamiento en cuenta corriente.
Debe cumplirse: sum(pagos reales) + monto_pendiente = total, salvo funcionalidades futuras
expresamente diseñadas para anticipos o saldos a favor.
CONTRADICCIÓN CON EL CÓDIGO: hoy `MEDIOS_PAGO_VENTA` incluye "Pendiente de pago" y se guarda como
una fila más de `pagos[]`. Además `js/reportes.js` lo cuenta como un medio de pago en los
reportes. Prevalece esta decisión. Impacta la UI de venta, el modal de pagos y los reportes.

## 2026-09-03 — [GASTÓN] PostgreSQL como última barrera
Arquitectura: UI → Adapter/Repository → Backend API → Servicio de dominio → Transacción
PostgreSQL → constraints/locks/invariantes → COMMIT.
La UI valida para experiencia. El backend revalida las reglas de negocio. PostgreSQL es la última
barrera para las invariantes que razonablemente puedan garantizarse a nivel de base. Una
operación crítica no puede quedar guardada a medias.

## 2026-09-03 — [GASTÓN] Atomicidad
Una venta completa es una única unidad transaccional: venta, ítems, pagos, cuenta corriente o
cobro, stock, reservas, movimientos de stock, asiento y movimientos contables. Falla una parte
crítica → ROLLBACK completo. Lo mismo para pedidos, conversión Pedido → Venta, entregas,
cancelaciones y compras.

## 2026-09-03 — [GASTÓN] Capa Repository/Adapter antes de reemplazar js/*.js
No se reemplaza directamente `js/ventas.js`, `js/clientes.js` ni `js/productos.js`. Primero se
establece una frontera clara entre UI y persistencia, con adaptadores intercambiables (Firestore,
Postgres/API, y shadow cuando corresponda). Los nombres exactos los define el Director.
PRINCIPIO OBLIGATORIO: la UI no debe necesitar conocer si la persistencia final es Firestore o
PostgreSQL.

## 2026-09-03 — [GASTÓN] El trigger de asiento balanceado no está aprobado como implementación
La REGLA queda aprobada: ningún asiento puede confirmarse con Debe ≠ Haber. La implementación
concreta en PostgreSQL debe revisarse específicamente. El Auditor debe probar como mínimo:
inserción en varias sentencias, asiento desbalanceado al COMMIT, rollback, modificación,
eliminación, múltiples asientos en una transacción, concurrencia, y comportamiento de las
restricciones diferidas.

## 2026-09-03 — [GASTÓN] Sin objetivos de porcentaje de rechazo
Queda eliminado de todo documento rector cualquier objetivo del tipo "30 % de rechazo del
Auditor". El Auditor rechaza todo lo que corresponda, sin porcentaje esperado. Las estimaciones
de tokens sirven para planificar y nunca condicionan el comportamiento de los agentes.

## 2026-09-03 — [GASTÓN] Shadow: qué se compara y qué no
La PoC ejecuta operaciones equivalentes contra Firestore y PostgreSQL para comparar
comportamiento: venta, ítems, pagos, deuda, stock, reservas, movimientos, asiento, totales y
errores esperados. El objetivo no es demostrar que PostgreSQL "funciona", sino que reproduce el
comportamiento empresarial aprobado Y resuelve atomicidad, concurrencia, doble envío e
integridad. Las diferencias que correspondan a cambios empresariales aprobados NO son errores de
reconciliación: se documentan como diferencias intencionales.

## 2026-09-03 — [GASTÓN] Firestore known-failing
FALLO_INTERMEDIO y CONCURRENCIA pueden fallar contra la implementación Firestore actual si
reproducen correctamente los problemas identificados. Se documentan como known-failing.
PROHIBIDO modificar la implementación Firestore para conseguir una suite verde.

## 2026-09-03 — [ALCANCE · GASTÓN] PoC con alcance (B): migración + módulo completo
La PoC incluye Pedidos, Reservas y Entregas completos, no tablas preparadas para después. Se
acepta conscientemente que la PoC es más grande. La prioridad no es acortarla, sino no aprobar
una arquitectura sin haber probado uno de sus cambios estructurales más importantes.

Los dos alcances se evalúan por separado y POC_REPORT.md informa GO/ADJUST/NO-GO para cada uno
más una conclusión general. Un problema menor del módulo nuevo no invalida la evaluación técnica
de PostgreSQL, ni un buen resultado de la migración aprueba un módulo de reservas defectuoso.

Alcance A se valida con reconciliación contra Firestore donde exista contraparte.
Alcance B no se valida contra Firestore —la funcionalidad no existe— sino contra DECISIONS.md,
las invariantes y las pruebas del Auditor.

Circuitos obligatorios en la PoC:
  Pedido → Reserva → FACTURAR → Venta → Entrega
  Pedido → Reserva → Cancelación → Liberación
  Venta pendiente de entrega → Reserva → Entrega

## 2026-09-03 — [Q1 · GASTÓN] Pedido confirmado editable hasta que se convierte en venta
Se pueden agregar y quitar productos, subir y bajar cantidades, y modificar precios y descuentos
según permisos comerciales, mientras el pedido no haya sido convertido en venta.

Toda modificación ajusta las reservas dentro de la MISMA transacción:
- disminuir una cantidad libera exactamente la diferencia, que vuelve al disponible en el acto;
- aumentar una cantidad o agregar un producto exige verificar y reservar el disponible adicional;
- si algún aumento o alta no tiene disponible, la modificación COMPLETA se rechaza y el pedido
  queda exactamente como estaba. No hay modificaciones parciales accidentales;
- quitar un producto libera por completo la cantidad pendiente de esa línea.

Pedido + ítems + reservas + stock.reservado es una única operación transaccional: falla una
parte, ROLLBACK completo.

## 2026-09-03 — [NIVEL 2] `reservas.cantidad` es acumulada, no vigente
Con el pedido editable, una línea puede bajar y volver a subir. `cantidad` solo crece: los
aumentos la incrementan, las reducciones incrementan `cantidad_liberada`, y `cantidad_pendiente`
(generada) es el número que retiene stock.
Motivo: preserva la historia completa de la reserva, mantiene exacta la fórmula
stock.reservado = suma de cantidad_pendiente, y conserva el significado auditable del CHECK
cantidad_consumida + cantidad_liberada <= cantidad.
Nomenclatura: `pedido_items.cantidad` es lo pedido AHORA; `reservas.cantidad` es lo reservado a
lo largo de la vida de la línea. Los une la invariante PEDIDO_RESERVA_COHERENTE.

## 2026-09-03 — [NIVEL 2] Las líneas de pedido no se borran
Quitar un producto marca `quitado_en` y libera su reserva; nunca borra la fila. Mismo criterio
que logAuditoria, historialCostos y compras en el ERP actual: el historial no se borra.
Cada reserva de pedido se vincula a `pedido_item_id`, no solo a `pedido_id`: sin eso, con dos
líneas del mismo producto no se sabe cuál liberar.

## 2026-09-03 — [Q2 · GASTÓN] Un pedido se convierte completo en una única venta
No hay facturación parcial en la PoC: 1 pedido → 1 venta, garantizado por constraint única sobre
`pedidos.venta_id`. La necesidad de entregar de a poco se resuelve con ENTREGAS parciales.
Ejemplo: pedido de 5 → FACTURAR → venta de 5. El cliente retira 2: entregado 2, pendiente de
entrega 3, las 3 siguen reservadas. Después retira las 3 y se completa la entrega.
La arquitectura queda preparada para facturación parcial en el futuro (`ventas.pedido_id` ya
existe; habilitarla es caer la constraint única y agregar cantidad facturada por línea), pero NO
se implementa en esta PoC.

## 2026-09-03 — [Q3 · GASTÓN] `valido_hasta` informativo: el vencimiento no libera stock
Los pedidos tienen `valido_hasta` desde ahora, con carácter informativo y de gestión. Superada la
fecha, el pedido se muestra como vencido, aparece identificado en el listado y hay un filtro de
pedidos vencidos; un usuario autorizado decide si lo mantiene, lo modifica o lo cancela.
NINGÚN proceso libera una reserva automáticamente por llegar a `valido_hasta`. Cancelar el pedido
sí libera la cantidad pendiente.
Motivo: el ERP no puede volver disponible una mercadería que un vendedor tiene comprometida con
un cliente. "Vencido" es una condición derivada, no un estado almacenado.

## 2026-09-03 — [Q4 · GASTÓN] Dos orígenes de reserva, ninguno obligatorio
Una reserva nace de un pedido confirmado o de una venta pendiente de entrega/retiro. No hace
falta que exista un pedido para usar el sistema de reservas: el "Envío a domicilio" que ya existe
hoy es el segundo caso.

## 2026-09-03 — [NIVEL 2] Orden de bloqueo obligatorio
Toda transacción que toque stock o reservas bloquea primero las filas de `stock` con
SELECT ... FOR UPDATE ordenadas por (producto_id, deposito_id) ascendente, y recién después toca
`reservas`. Aplica a venta, pedido, FACTURAR, entrega y cancelación. Verificado empíricamente:
con orden inverso, PostgreSQL detecta deadlock y mata una transacción.

## 2026-09-03 — [NIVEL 2] El estado de entrega de la venta se deriva de sus reservas
`entregado` cuando ninguna reserva de la venta tiene cantidad pendiente; `pendiente` mientras
quede algo. Deja de ser un campo que alguien escribe.

## 2026-09-03 — [NIVEL 2] FACTURAR y modificar bloquean la fila del pedido, y hay un guard
Ambas operaciones hacen SELECT ... FOR UPDATE sobre `pedidos` al inicio, además del bloqueo de
`stock`. VERIFICADO EMPÍRICAMENTE: el lock solo NO alcanza — serializa las operaciones pero no
impide que la modificación se aplique sobre un pedido que quedó facturado mientras esperaba. Sin
un trigger que rechace modificar un pedido no confirmado, el resultado es una venta por 3
unidades con 1 sola unidad reservada, sin ningún error.

---

## 2026-09-04 — [NIVEL 3 · GASTÓN] P6 corregida: el IVA se calcula, no queda en cero
CORRIGE LA PREMISA DE P6. P6 dice "aunque queden en cero según el funcionamiento actual". Esa
premisa es FALSA y venía de CLAUDE.md, que afirma que el IVA está "preparado pero calculado en
$0". El código real lo discrimina desde hace tiempo: `js/ventas.js` calcula el IVA de cada línea
con `discriminarIva()` (resta hacia atrás, porque el precio ya lo incluye), resta el IVA del
total para obtener el neto imputado a 4.1 Ventas, e imputa el IVA a 2.1.2 IVA Débito Fiscal.
Hay 5 tests unitarios cubriendo el cálculo.

DECISIÓN: `crear_venta()` en PostgreSQL replica ese cálculo y esa imputación. `iva_pct` e
`iva_monto` se llenan con valores reales, no con cero, y el asiento incluye el movimiento a
2.1.2. La estructura que P6 pedía se mantiene; lo que se descarta es su supuesto de que quedaría
vacía.

Motivo: dejar el IVA en cero convertiría la PoC en una regresión contable respecto de lo que
Firestore ya hace bien, y haría incomparable el asiento en la reconciliación shadow.

Sigue vigente de P6: esto NO es activación de facturación fiscal. No implica ARCA, ni WSFE, ni
CAE. Es el mismo cálculo interno que ya corre hoy.

PENDIENTE: corregir la línea de CLAUDE.md que dice que el IVA se calcula en $0. Ese archivo lo
modifica Gastón.

## 2026-09-04 — [NIVEL 3 · GASTÓN] Tesorería fuera de la PoC, pero el destino contable se conserva
No se modelan cajas, bancos, cuentas por cobrar ni sus movimientos. `crear_venta()` no mueve
Tesorería.

Sí se conserva el DESTINO: cada pago de la venta guarda a qué destino habría ido
(caja | banco | cuentaPorCobrar), para que el asiento impute a la cuenta correcta —1.1.1 Caja y
Bancos, o 1.1.5 Deudores por Tarjetas y Acreditaciones— exactamente como hace hoy
`cuentaParaDestinoTesoreria()` en `js/contabilidad.js`.

Motivo: hoy el ruteo a Tesorería corre ANTES de armar el asiento justamente para que
contabilidad y Tesorería no se puedan contradecir (antes de ese cambio, una venta con tarjeta
sobrestimaba el disponible imputando todo a Caja). Descartar el destino haría que la PoC
imputara todo a una sola cuenta y perdería esa corrección. Guardarlo cuesta una columna.

Consecuencia para el diseño: `venta_pagos` lleva el destino contable resuelto en el momento de
la venta. Cuando Tesorería se construya después del GO, ese campo ya está y no hay migración
destructiva.

Consecuencia para los tests: la invariante de consistencia entre los pagos de una venta y los
movimientos de Tesorería NO se puede probar en esta PoC —no hay movimientos que comparar—. Se
reemplaza por una invariante de imputación: cada pago va a la cuenta contable que le corresponde
según su destino, y el asiento cierra.

## 2026-09-04 — [NIVEL 3 · GASTÓN] P7 resuelta: solo los comprobantes conservan numeración
De los tres contadores del sistema, solo uno necesita continuidad real en el corte:

- `contadores/comprobantes_{puntoVenta}_{tipo}` → CONTINÚA desde su último valor, por punto de
  venta y por tipo de comprobante. Motivo: ya hay comprobantes impresos y entregados a clientes;
  reiniciar generaría dos papeles con el mismo número. Es también lo que exige la numeración
  fiscal.
- `contadores/ventas` → ARRANCA EN 1.
- `contadores/asientos` → ARRANCA EN 1.

Motivo de los dos reinicios: coherencia con P9 (corte limpio). PostgreSQL empieza su propio
historial operativo; no se migran ventas ni asientos, así que un libro diario que arrancara en
un número alto no tendría asientos previos que lo respalden en la base nueva.

Esto cierra la TAREA DEL DIRECTOR que P7 dejaba abierta.
