# Log de implementación

Append-only. Escribe solo el implementador, una entrada por tarea.

## TASK-001 — Backend Node mínimo: cliente pg y migrador con versiones (2026-09-04)

Qué hice: `backend/package.json` (`type: module`, declara `pg@^8.13.0`, la misma versión que ya
está en la raíz — no hizo falta ningún `npm install`: Node resuelve `pg` en el `node_modules` de
la raíz). `backend/src/db/pool.js`: `urlConexion`, `crearPool`, `obtenerPool`, `cerrarPool`,
`conTransaccion`. Sin efectos al importarse, sin puertos, sin Firebase. `backend/src/db/migrar.js`:
aplica en orden alfabético los `.sql` de `backend/db/migrations/`, cada uno en su propia
transacción junto con el `insert` en `schema_migrations(nombre, aplicada_en)`, todo bajo
`pg_advisory_lock` de sesión. `backend/README.md` reescrito: se conservó db:up/db:down, bases,
credenciales, `core.hooksPath` y el `.env`, y se agregó el migrador, las variables y el "qué NO es".

Decisiones menores: (1) fuera de tests el pool lee SOLO `DATABASE_URL` — `DATABASE_URL_TEST`
nunca se toma por accidente; en tests (`NODE_ENV=test` o `VITEST`) se prefiere `DATABASE_URL_TEST`.
(2) Guard: si la URL no apunta a loopback, corta; escape explícito `DELFINO_DB_REMOTO_OK=1`.
(3) Sin baseline silencioso: con la base ya migrada por otra vía el migrador FALLA (42P07) con un
mensaje que explica las dos salidas; el baseline existe solo como flag explícito
`--marcar-aplicadas`, documentado. (4) Sin checksum de migraciones: no lo pedía la tarea.

Verificado: base limpia → aplica 0001 y 0002; segunda corrida → "Sin migraciones pendientes",
exit 0; sin variables → error explícito; dos migradores en paralelo → el segundo espera el lock y
no reaplica; fallo → `schema_migrations` queda en 0 filas. `npm run check` OK (162 archivos),
`npm test` 9/9, invariantes de Postgres 21/21.

Duda para el auditor: `tests/integration/safety.test.js` falla ("una escritura de prueba va al
emulador y se puede leer de vuelta" → PERMISSION_DENIED de las reglas de Firestore). Es previo e
independiente de esta tarea —ningún test importa `backend/`— y no lo toqué: los tests son del tester.

## TASK-002 — Migración 0003: IVA discriminado, destino de pago y fecha local (2026-09-04)

Un solo archivo nuevo, `backend/db/migrations/0003_iva_y_destino_pago.sql`: `productos.iva`
(numeric, default 21, CHECK >= 0), `venta_pagos.destino_contable` (NOT NULL default 'caja',
CHECK en caja|banco|cuentaPorCobrar), `discriminar_iva()` —réplica literal de
`js/contabilidad.js:98-102`, redondea el IVA sobre el neto SIN redondear—, `fecha_local()` y
`crear_venta()` redefinida con CREATE OR REPLACE. 0001 y 0002 no se tocaron.

Redondeo (decisión Nivel 3 del 2026-09-04, no reinterpretada): `iva_linea` por línea,
`iva_total = round(SUM(iva_linea))`, `neto_total = round(total − iva_total)` como residuo.
Asiento: pagos a 1.1.1 (caja/banco) y 1.1.5 (cuentaPorCobrar), pendiente a 1.1.2, neto a 4.1,
IVA a 2.1.2, costo 5.1 contra 1.1.3.

Decisiones menores: (1) la alícuota se toma del ítem (`iva_pct`) y si no viene de `productos.iva`
— se congela en `venta_items` como el precio y el costo. (2) `destino_contable` default 'caja'
conserva el comportamiento de 0002 (todo pago a 1.1.1) para el que no lo informe; un destino
desconocido se rechaza con `DESTINO_PAGO`. (3) La migración inserta SOLO las cuentas 1.1.5 y
2.1.2, con `on conflict do nothing`, copiadas de `PLAN_DE_CUENTAS` de `js/contabilidad.js`: sin
ellas el FK de `asiento_movimientos` rompe toda venta, y son las dos únicas que ninguna migración
ni el seed de tests creaban. (4) `fecha_local()` = `(now() at time zone
'America/Argentina/Buenos_Aires')::date`: `now()` es un instante absoluto, así que el resultado NO
depende del `TimeZone` de la sesión; `current_date`, `localtimestamp` y `now()::date` sí dependen.
(5) `verificar_iva_imputado()` compara 2.1.2 y 4.1 contra el cálculo por línea, porque Debe=Haber
no puede detectar un centavo mal repartido.

Verificado: migrador aplica 0003 y la registra; segunda corrida "Sin migraciones pendientes".
Venta 21 %: total 1000,01 → IVA 173,56 / neto 826,45. Mixtas 1000,01 al 21 % + 5000,02 al 10,5 %:
IVA 648,68 (redondear la suma daría 648,67), neto residuo 5351,35 = suma de netos por línea
5351,35. Búsqueda por fuerza bruta de 9.000.000 de pares: CERO casos donde la suma de netos por
línea difiera de `total − iva_total` — con subtotales de 2 decimales la diferencia no puede
aparecer, tal como anticipa DECISIONS.md; lo observable es IVA por línea vs. IVA de la suma.
Tres pagos (1000 caja + 2000 banco + 3000 cuentaPorCobrar) y 4000 pendientes sobre 10000:
1.1.1 3000, 1.1.5 3000, 1.1.2 4000, 4.1 8264,46, 2.1.2 1735,54; cierra. Fecha: venta con
`p_fecha` NULL y la sesión en `Asia/Tokyo` (donde ya era el día siguiente, `current_date`
2026-09-05) quedó con `fecha_operacion` 2026-09-04 y `creado_en` con el instante real; ídem con
la sesión en UTC. `npm run check` OK, `npm test` 32/32.

Para el tester y el auditor: el test `CONTABILIDAD > una venta con pago parcial…`
(`tests/integration/postgres/invariantes.test.js:85`) asumía IVA en cero — esperaba
`4.1 haber 850000` y ninguna línea de 2.1.2; ahora da `4.1 702479,34` y `2.1.2 147520,66`, que es
lo correcto. NO lo modifiqué: los tests son del tester. Invariantes de Postgres 20/21, y ese es el
único rojo. También queda para el tester que `seed()` de `_helpers.mjs` inserta el plan de cuentas
con INSERT plano; si algún día la migración siembra más cuentas, va a chocar por PK.

Prueba literal del caso de las 21:00: se esperó al instante `2026-09-05 00:00:00 UTC` = `2026-09-04
21:00:00` de Argentina y se creó una venta con `p_fecha` NULL y la sesión en `TimeZone='UTC'`. La
sesión veía `current_date` = 2026-09-05 y la venta y su asiento quedaron con `fecha_operacion`
2026-09-04, con `creado_en` = 2026-09-05 00:00:00+00. El bug de UTC queda cerrado sin depender de
cómo esté configurada la sesión.

## TASK-013 — El seed apunta al proyecto del emulador (R16) — BLOQUEADO POR PERMISOS

No pude implementar nada: `.claude/settings.json:88` tiene `"Edit(scripts/seed-emulator.mjs)"` en
la lista `deny`, que es exactamente el unico archivo que la tarea me asigna. El intento de
escritura devuelve "blocked by a deny rule" y una regla `deny` no se levanta pidiendo permiso. No
busque ninguna via alternativa para escribirlo (node fs, sed): saltear una barrera del sistema de
permisos seria peor que no hacer la tarea. `.claude/` solo lo toca Gaston.

Segundo hallazgo, y es parte del mismo bug: `.claude/settings.json:8-9` define
`GCLOUD_PROJECT=demo-delfino` y `GOOGLE_CLOUD_PROJECT=demo-delfino` para TODA sesion de agente.
O sea que R16 no vive solo en el default del script: aunque el default pase a `delfino-hogar-erp`,
cualquier agente que corra `npm run seed` sigue sembrando en `demo-delfino`, porque el Admin SDK
obedece esas variables. Con el chequeo de la tarea el seed abortaria (bien, ya no es silencioso),
pero ningun agente podria sembrar hasta que esas dos variables pasen a `delfino-hogar-erp` o se
saquen. Eso tambien lo tiene que hacer Gaston.

Lo que si pude hacer, porque es solo lectura: el inventario de los dos namespaces por REST contra
los emuladores (`Bearer owner`, canal independiente del Admin SDK). Estado al 2026-09-04:

    delfino-hogar-erp   Auth 1 usuario: admin@delfino.local  uid HfH7fg2RWwLBI6Lacotphm3rM1H9
                        Firestore 10 colecciones, 35 docs (categorias 1, clientes 1, contadores 3,
                        cuentasContables 22, depositos 1, listasPrecios 1, marcas 1, productos 3,
                        sucursales 1, usuarios 1 -> usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9)
    demo-delfino        Auth 0 usuarios
                        Firestore 10 colecciones, 35 docs: el MISMO set exacto, incluido
                        usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9 -> el perfil duplicado que reporto
                        Gaston. El usuario de Auth existe una sola vez, en delfino-hogar-erp.

No commiteo codigo porque no hay codigo. No toque `package.json`, `.claude/` ni ningun otro
archivo. La limpieza de `demo-delfino` queda sin hacer: iba en el mismo script.


## TASK-003 — Migracion 0004: lista de precios en la venta e historial de costos

Un solo archivo nuevo: `backend/db/migrations/0004_precios_y_costos.sql`. Contiene
`listas_precios` (nombre unico, regla_margen, regla_redondeo, activa), `venta_items.lista_precio_id`
nullable con FK, `historial_costos` con los nueve campos de P5, tres triggers BEFORE que rechazan
UPDATE, DELETE y TRUNCATE sobre el historial, `registrar_costo()` y `verificar_sin_recalculo_de_costo()`.
`crear_venta()` se redeclara completa (0003 esta aplicada y no se edita) y solo suma tres lineas
marcadas «0004» para llevar `lista_precio_id`; el resto es identico.

DIVERGENCIA P5, verificada con numeros: `registrar_costo(producto 1, 715000, origen factura_compra)`
dejo `productos.costo_referencia` en 600000 antes y 600000 despues, con la fila en `historial_costos`
(anterior 600000, nuevo 715000, metodo `ultimo`, compra 987). `js/compras.js:103-119` en cambio pisa
`costoReferencia` en cada compra sin que nadie lo acepte. Gana P5: en 0004 no hay un solo
`update productos ... costo_referencia`, y `verificar_sin_recalculo_de_costo()` lo comprueba contra
el catalogo de PostgreSQL (probe que puede fallar: plante una funcion que pisa el maestro y la delato).

Decisiones menores: (a) donde la tarea dice `productos.costo`, el esquema dice
`productos.costo_referencia`, la columna de 0001; no renombre nada. (b) `regla_margen` y
`regla_redondeo` quedan nullables y sin CHECK de dominio: sus valores validos son una regla
comercial que no esta decidida y no la invento. (c) `historial_costos.compra_id` sin FK porque la
tabla `compras` no existe en la PoC (ARCHITECTURE §2.3), con CHECK de que solo `factura_compra`
puede traerla. (d) NO implemente la aceptacion explicita que mueve el maestro: para
`costo_modo='promedio'` necesita las cantidades de la compra para ponderar y eso es el servicio de
compras, fuera de alcance.

Dudas para el director, ninguna bloqueante: (1) `historial_costos` registra tanto "esta compra
costo otra cosa" como, el dia que exista, "el usuario acepto el costo nuevo", y con los campos que
pide P5 las dos filas se ven iguales; si hay que distinguirlas hace falta un campo mas, decidido por
Gaston. (2) `tests/integration/postgres/migrador.test.js:72` tiene un centinela `expect(filas.length).toBe(3)`
que falla al aparecer la cuarta migracion — es lo que el centinela dice que tiene que pasar, y
subir el numero le toca al tester: no toco `tests/`.

Corrido: `node backend/src/db/migrar.js` sobre delfino_dev (aplica 0004, segunda corrida "Sin
migraciones pendientes"); `npm run check` OK 162 archivos; `npm test` 41/41 verde; integracion
Postgres 63/64, el unico rojo es el centinela de arriba.


## TASK-013 — El seed apunta al proyecto del emulador, o falla claro (R16)

Un solo archivo: `scripts/seed-emulator.mjs`. El `projectId` deja de estar escrito dos veces: se
lee de `js/firebase-config.js` con la misma tecnica de texto que ya usaba `leerPlanDeCuentas()`
(el repo no declara `"type": "module"`, asi que ese ESM no se puede importar desde el script). Si
el archivo no declara exactamente un `projectId`, el seed aborta en vez de adivinar: eso es lo que
hace que un cambio futuro rompa ruidoso en lugar de volver a divergir en silencio. Si
`GCLOUD_PROJECT` o `GOOGLE_CLOUD_PROJECT` fuerzan otro proyecto, aborta con exit 1 nombrando los
dos valores. Las barreras de emulador local no se tocaron y siguen corriendo primero.

Dos modos explicitos mas, que nunca se disparan al sembrar: `--reporte-demo` y
`--limpiar-demo-delfino`. El namespace va fijo en el codigo, validado contra una lista de
permitidos de un solo elemento, con dos chequeos extra de que no es el proyecto del ERP; el
borrado usa `/emulator/v1/...` con el proyecto en la URL, endpoints que no existen fuera de un
emulador, asi que el alcance no depende de ninguna variable de entorno. Imprime el inventario
antes de borrar y vuelve a medirlo despues. Un argumento mal tipeado (`--limpiar-demo`) aborta
con exit 1 y lista los modos validos: nunca cae en el modo que escribe.

Verificado por REST, canal independiente del script. Aborto por desajuste: exit 1 con
`delfino-hogar-erp` vs `demo-delfino` nombrados. Camino feliz con `GCLOUD_PROJECT` sobrescrita:
`admin@delfino.local` uid `HfH7fg2RWwLBI6Lacotphm3rM1H9`, login 200 contra Auth y perfil
`usuarios/{uid}` con `rol: administrador` en `delfino-hogar-erp`. Dos corridas seguidas: inventario
identico byte a byte en los dos namespaces. Sin variables de emulador y con host no local: sigue
abortando. Limpieza: `demo-delfino` paso de 10 colecciones / 35 docs (incluido el perfil duplicado
`usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9`, y 0 usuarios de Auth) a 0 y 0; `delfino-hogar-erp` quedo
IDENTICO al snapshot previo (10 cols, 35 docs, 1 usuario de Auth), comparado antes/despues, no
"no lo toque". Segunda corrida de limpieza: "Nada que borrar".

Decisiones menores: (a) el mensaje de aborto explica el caso del agente y le dice que no lo
saltee, porque `GCLOUD_PROJECT=demo-delfino` es deliberado y el aborto es el comportamiento
correcto; (b) la limpieza no pide confirmacion interactiva: el flag largo y exacto ya es la
confirmacion, y un prompt no aporta contra un script que igual hay que tipear entero; (c) no toque
`package.json`.

Propuesta para el director, no la aplique: agregar `"seed:reporte-demo": "node
scripts/seed-emulator.mjs --reporte-demo"` y `"seed:limpiar-demo": "node scripts/seed-emulator.mjs
--limpiar-demo-delfino"` a `package.json`. Opcional: los dos modos se corren igual con `node`.

Dudas / flancos que quedan, ninguno de esta tarea: (1) el emulador arranca con
`--import ./emulator-data`, asi que si ese export todavia tiene `demo-delfino`, el namespace
reaparece en el proximo arranque hasta que se re-exporte; `emulator-data/` no esta en mis files.
(2) `tests/integration/postgres/precios_y_costos.test.js` tiene 2 rojos que **no son mios**:
comparan texto de `0004_precios_y_costos.sql` con literales `\n` y el repo guarda CRLF. Reproduje
los mismos 2 rojos con mi cambio guardado en stash. No toco `tests/`.

Corrido: `npm run check` OK 162 archivos; `npm test` 41/41 verde; integracion 99/101, los 2 rojos
son los preexistentes de arriba.

## TASK-013 (correccion de los 2 defectos del tester)

Defecto 2 (SEED_SALIDA_LIMPIA) ARREGLADO. `--reporte-demo` y `--limpiar-demo-delfino` ya no llaman
`process.exit()`: en Node 24/Windows salir con sockets de `fetch` cerrandose dispara la asercion de
libuv y devolvia 3221226505. Ahora terminan solos (los sockets de undici estan unref: medi 1 ms de
diferencia sobre 12 pedidos) y el aborto post-fetch de "no quedo vacio" usa `process.exitCode = 1`.
`process.exit(0)` queda SOLO en el modo sembrado, que no usa fetch y necesita cortar los canales
gRPC del Admin SDK. Verificado: `--reporte-demo` sale 0, y los 2 tests de SEED_SALIDA_LIMPIA en
verde en 3 corridas seguidas.

Defecto 1 (SEED_REPORTE_FIEL) ATENDIDO EN LO QUE ME TOCA, PERO EL TEST SIGUE ROJO Y NO LO PUEDO
CERRAR DESDE MI ARCHIVO. Confirme el diagnostico del tester midiendo contra el emulador: un
namespace virgen devuelve las 10 colecciones / 35 documentos del ERP. Busque distinguirlo por API y
no se puede: (a) el emulador REESCRIBE el campo `name` de cada documento con el projectId que uno
pidio, asi que el documento espejado no se delata; (b) comparar contra un namespace de control
exigiria emitir una URL con otro proyecto, que es exactamente lo que prohibe SEED_BARRIDO_ACOTADO
(`verificarBarridoAcotado` falla si alguna URL nombra un proyecto != demo-delfino) y habria roto
~25 tests verdes. Asi que aplique la salida honesta que autorizo el director: cuando hay documentos,
el reporte avisa que NO se los puede dar por propios y explica singleProjectMode; y si ademas se da
la firma del espejo (documentos > 0 con CERO usuarios de Auth, que el seed nunca deja) lo dice
fuerte. Auth no espeja —lo medi—, por eso el conteo de usuarios si se afirma. El preview de borrado
aclara que el DELETE va solo contra demo-delfino y que lo espejado es de lectura.

BLOQUEO DE ALCANCE, no de negocio: el test SEED_REPORTE_FIEL no invoca el seed; asserta una
propiedad del EMULADOR (`inventarioNamespace(sonda_virgen).totalDocs === 0`). Lo unico que la vuelve
verde es sacar `"singleProjectMode": true` de `firebase.json`, archivo de Gaston. Lo medi en un
emulador descartable (puertos 8086/9096, config propia fuera del repo, ya apagado): con
`singleProjectMode: false` el namespace virgen devuelve `[]` y el espejo desaparece. NECESITO
`firebase.json` para cerrarlo, o que lo cambie Gaston. El test tiene razon; no lo toque.

Decisiones menores: (a) la advertencia se imprime siempre que haya documentos, no solo ante la
firma, porque desde este script la duda es real en los dos casos y preferi no afirmar de mas;
(b) no bloquee el borrado ante la firma del espejo: el tester midio que no es destructivo y
bloquearlo cambiaba comportamiento mas alla del defecto.

Corrido: `npm run check` OK 162 archivos; `npm test` 150/150 verde; integracion (con
`npx vitest run -c vitest.integration.config.js`, porque el emulador ya estaba levantado y
`emulators:exec` choca los puertos) 117/118, el unico rojo es SEED_REPORTE_FIEL.

## TASK-012 — validacion de flags del migrador (R14) y migraciones repetibles (R28)
2026-09-05, implementador. Solo `backend/src/db/migrar.js` y `backend/README.md`, mas R14 aca.

Hice tres cosas. (1) `interpretarArgumentos()` valida contra `FLAGS_VALIDOS` **antes de crear el
pool**: argumento desconocido = exit 1 + lista de flags, sin abrir conexion; `--estado` y
`--marcar-aplicadas` juntos tambien abortan. (2) Repetibles: `backend/db/functions/*.sql` se
aplican siempre despues de las numeradas, dentro del mismo `conLock`, cada archivo en su propia
transaccion junto con el upsert de su hash. (3) README reescrito para que coincida con el codigo.

Decisiones menores, las tres con motivo: **tabla propia `schema_repetibles`** y no una marca en
`schema_migrations`, porque `migrador.test.js:74` y `:117` asertan `length === 4` sobre esa tabla
y una repetible registrada ahi los rompe apenas TASK-018 agregue `crear_venta.sql`; ademas las
repetibles necesitan la columna `hash`. **Hash sobre el contenido normalizado a LF, y se despliega
LF**, no el byte crudo: con el arbol en CRLF (R32/R33) hashear crudo haria que un `git checkout`
reaplicara todas las funciones, y desplegar CRLF dejaria `prosrc` dependiendo del checkout, que es
justo lo que R33 le deja servido a TASK-018. Verificado: pasar las repetibles de LF a CRLF no
dispara reaplicacion y `prosrc` queda sin `\r`. **`--marcar-aplicadas` tambien baselinea las
repetibles** (registra nombre+hash sin correr): si no, despues de TASK-018 la segunda corrida del
test de baseline intentaria ejecutar `crear_venta.sql` contra una base sin tablas.

**La contradiccion de `--estado` la resolvi del lado del README, no del codigo**, y no es
preferencia: `migrador.test.js:485` consulta `schema_migrations` despues de `--estado` sobre base
limpia y espera 0 filas. Si el flag dejara de crear la tabla, esa consulta tira "relation does not
exist" y el test se pone rojo — y los tests son del tester, no los toco. Queda documentado en
"Que escribe cada modo": crea las dos tablas de control vacias y no ejecuta ninguna migracion.

Verificado a mano sobre una copia de `backend/` fuera del repo (no cree
`backend/db/functions/crear_venta.sql`, que es de TASK-018, ni ningun archivo en el repo): base
limpia aplica 4 numeradas + repetibles y la segunda corrida no reaplica nada; cambiar un byte de
`aaa_uno.sql` reaplica **solo esa** y `bbb_dos.sql` conserva su `aplicada_en`; una repetible que
falla no queda registrada, no deja ni la funcion ni la tabla parcial, y el reintento corregido la
aplica; `functions/` inexistente y vacio no fallan; `--estad` sale 1 y deja la base con 0 tablas;
4 migradores en paralelo dan exactamente 4 numeradas y 3 repetibles, sin duplicados.

Dudas para el auditor: (a) las repetibles borradas del disco quedan como fila huerfana en
`schema_repetibles` y solo se reportan en `--estado`; elegi no borrar funciones de la base
automaticamente y dejar el `DROP FUNCTION` a una numerada, pero es una convencion que conviene
confirmar; (b) no toque R28 —lo cierra TASK-018 cuando mude la funcion—, solo deje R14 mitigado.

Corrido: `npm run check` OK 162 archivos; `npm test` 152/152 verde; integracion con
`npx vitest run -c vitest.integration.config.js` (el emulador ya estaba levantado y
`emulators:exec` choca los puertos) **117/117 verde**, y `migrador.test.js` solo 18/18.

## TASK-018 — copia canonica de `crear_venta()` (R28) y cierre de R37 — BLOQUEADO POR PERMISOS

Hecho y verificado: `backend/db/migrations/0006_crear_venta_repetible.sql` (deja constancia del
corte con un `comment on function crear_venta(...)`; **no** redefine la funcion, y 0002/0003/0004
quedan intactas) y el cierre de **R37** en `backend/src/db/migrar.js`: `--marcar-aplicadas` ahora
**falla** —exit != 0, sin escribir ni una fila— si una repetible declara una funcion que la base
no tiene. El chequeo mira `pg_proc` (la base), no `schema_repetibles` (la tabla), y recorre
**todas** las repetibles en disco, no solo las pendientes: por eso cubre tambien el `DROP FUNCTION`
a mano, que deja la fila al dia y por lo tanto fuera de "pendientes". Medido sobre bases
temporales: base con la funcion -> no lanza; base vacia -> aborta con el detalle
`crear_venta.sql declara crear_venta(8 argumento(s)) y en la base NO existe`; base tras
`DROP FUNCTION` a mano -> mismo aborto. Decision menor: identifico la funcion por **nombre y
cantidad de argumentos**, no por tipos; interpretar tipos (`double precision`, arrays, typmods)
daria falsos positivos, y nombre+aridad alcanza para las dos ausencias que describe R37.

**Lo que NO pude hacer, y por que.** `backend/db/functions/crear_venta.sql` —el archivo central de
la tarea, y esta en su `files:`— **no se puede crear**: `.claude/settings.json` deniega
`Write(functions/**)` y `Edit(functions/**)`, pensado para la carpeta de Cloud Functions, y el glob
**tambien matchea `backend/db/functions/**`**. Las dos herramientas responden "File is in a
directory that is denied by your permission settings". Es un falso positivo de la misma familia que
los tres corregidos en f418870. No lo esquive por shell: la tarea lo prohibe explicitamente.
Arreglo sugerido, de Gaston: anclar esas dos reglas a la raiz (`Write(./functions/**)` /
`Edit(./functions/**)`). Sin eso, R28 no se puede cerrar.

**Nada commiteado**: 0006 y `migrar.js` quedan en el arbol de trabajo, sin commit, porque 0006
apunta a un archivo que todavia no existe y un commit parcial dejaria el repo incoherente.

Tests que se ponen rojos y **no toque** (son del tester): (a) `migrador.test.js:73`
`expect(filas.length).toBe(4)` — centinela deliberado del tester ("si aparece una quinta, revisar
antes de subir el numero"); 0006 es la quinta. (b) `migrador_repetibles.test.js:925` — afirma la
convencion **vieja** de `--marcar-aplicadas` (exit 0 y baseline aunque la funcion no exista), que
es exactamente lo que R37 endurecido revierte. (c) queda avisado que `migrador.test.js:445`
(`MIGRADOR_BASELINE > --marcar-aplicadas registra sin ejecutar`) hoy pasa solo porque
`backend/db/functions/` esta vacio: en cuanto exista `crear_venta.sql`, ese test se pone rojo por
el mismo motivo que (b).

Duda para el auditor: `backend/README.md` describe `--marcar-aplicadas` con la semantica vieja
("esto deja la base mintiendo sobre su estado") y no esta en mi `files:`. Hace falta actualizarlo
en una ampliacion de la tarea o en una tarea aparte.

Corrido: `npm run check` OK 162 archivos; `npm test` 152/152 verde; integracion con
`npx vitest run -c vitest.integration.config.js` 142/144 (los 2 rojos son los de arriba).

## TASK-018 (segundo intento) — R37 cerrado y documentado; R28 sigue bloqueado por el mismo deny

**El bloqueo NO esta levantado, aunque el archivo diga otra cosa.** `.claude/settings.json:75-76`
ya dice `Edit(./functions/**)` / `Write(./functions/**)`, pero `Write` sobre
`backend/db/functions/crear_venta.sql` sigue devolviendo *"File is in a directory that is denied by
your permission settings"*. Lo probe con un control: `Write` sobre `backend/db/probe_task018.tmp`
—mismo arbol, sin el componente `functions`— **funciona** (creado y borrado en el acto, no quedo en
el commit). O sea que el `deny` sigue matcheando por el componente `functions`: anteponer `./` no
ancla nada, el patron se sigue evaluando como "en cualquier nivel". Sugerencia para Gaston, a
verificar empiricamente antes de darla por buena: probar `/functions/**` (barra inicial) o la forma
absoluta `//<ruta>/functions/**`. Segunda vez que reporto esto y **segunda vez que no lo esquivo
por shell**: el `deny` protege `functions/` de verdad y saltearlo con otra herramienta lo vaciaria.

Lo que si pude hacer y esta en este commit:
1. **`backend/README.md`**: la seccion de `--marcar-aplicadas` describia la semantica vieja
   ("registra su nombre y su hash sin correr el SQL" / "deja la base mintiendo sobre su estado").
   Nueva subseccion "`--marcar-aplicadas` FALLA si una repetible no esta desplegada (R37)" con el
   mensaje real de aborto, por que mira `pg_proc` y no `schema_repetibles`, por que recorre todas
   las repetibles y no solo las pendientes, y la limitacion aceptada de los parametros `OUT`.
2. **RISKS.md R37 → `[RESUELTO 2026-09-05]`** con el bloque de cierre. **R28 sigue MEDIA**, con lo
   ya medido anotado; se cierra en el commit que cree el archivo.

Verificaciones 2 y 3, hechas sobre una base desechable (`delfino_task018`, creada y borrada en la
corrida) con el archivo candidato **fuera del repositorio**, en el scratchpad:
- **transcripcion exacta**: el cuerpo candidato contra `sed -n '241,408p' 0004_precios_y_costos.sql`
  da `diff` vacio, 168 lineas y el mismo SHA-256 (`0aaf8736…`) normalizando a LF. La mudanza no
  cambia **nada** a proposito; no toque una coma;
- **proveniencia**: aplique primero una variante con una marca dentro del cuerpo y la definicion
  desplegada la tomo (`true`), y al reaplicar el archivo real la marca desaparecio (`true`). Prueba
  de que la repetible **pisa** la copia de 0004 y no al reves;
- **V2** cuerpo desplegado == cuerpo del archivo normalizando **los dos lados**: `true`. Con el
  archivo en CRLF: `true`. Mutando un caracter del archivo: `false` (sigue discriminando);
- **V3** `pg_get_functiondef` **antes** (viene de 0004) vs **despues** (viene de `functions/`),
  normalizando los dos lados: `true`. `prosrc` antes vs despues: `true`.

Un detalle que cambia y **no es un cambio de comportamiento, pero hay que decirlo**: los CRLF
dentro de la definicion desplegada pasan de **163 a 0**. Las numeradas se aplican crudas
(`aplicarPendientes` hace `readFileSync` sin normalizar) y en Windows el arbol esta en CRLF; las
repetibles se despliegan normalizadas a LF (R32/R33, TASK-012). El SQL es identico; lo que cambia
es el byte del `prosrc`. Es exactamente lo que R33 pedia.

Sobre R33 y `recrearEsquema()` (`tests/integration/postgres/_helpers.mjs:22`): sigue aplicando solo
`db/migrations/*.sql`. Es archivo del tester, no esta en mi `files:` y **no lo toque**. Mientras
`crear_venta.sql` no exista da igual; el dia que exista, sin ese cambio la suite quedaria verde
probando la copia de 0004.

Tres tests rojos esperados, **todos del tester, ninguno tocado**: `migrador.test.js:73` (centinela
`toBe(4)`, hoy hay 5 migraciones) y `migrador_repetibles.test.js:925` (afirma la convencion vieja
de `--marcar-aplicadas`) estan en rojo ahora. `migrador.test.js:445` sigue **verde** porque
`backend/db/functions/` esta vacio; se pone en rojo el dia que exista `crear_venta.sql`.

Corrido: `npm run check` OK 162 archivos; `npm test` 152/152 verde; integracion de Postgres con
`npx vitest run -c vitest.integration.config.js tests/integration/postgres` → 122/124, con los 2
rojos de arriba. Los tests de TASK-002 y TASK-003 (`iva_y_destino_pago`, `precios_y_costos`) en
verde y sin tocar. `npm run test:integration` completo no lo pude correr: los emuladores de Gaston
ya ocupan 8080/9099/9199 y `firebase emulators:exec` intenta levantar los suyos; no los baje.

## TASK-018 (cierre) — 2026-09-05 — implementador

Desbloqueada por renombre, no por excepcion: el directorio de repetibles pasa de
`backend/db/functions/` a **`backend/db/repetibles/`** (decision de Gaston). El `deny` que protege
las Cloud Functions matchea el componente `functions` a cualquier profundidad (R39) y queda
intacto; lo nuestro sale de su alcance. Ademas el nombre viejo era ambiguo entre funciones de
PostgreSQL y Cloud Functions, que fue la causa real del bloqueo. Dejo el motivo escrito en
`migrar.js` y en el README para que nadie lo revierta "por prolijidad".

Renombrado: la constante `DIR_REPETIBLES` y su comentario en `backend/src/db/migrar.js`; las **6**
menciones de `db/functions/` en `backend/README.md` (el director conto 7: la septima es
`` `functions/` es produccion desplegada ``, que se refiere a las Cloud Functions de verdad y
**no** se toca); y los 2 comentarios de `0006_crear_venta_repetible.sql`, incluido el texto del
`comment on function`.

Creado `backend/db/repetibles/crear_venta.sql`. Transcripcion verificada **sobre el arbol real**:
`diff` vacio contra `0004_precios_y_costos.sql:241-408`, 168 lineas, mismo SHA-256
`0aaf87367c29a13a…`. El archivo completo es byte a byte el candidato ya validado (10558 bytes).
No hay un solo cambio de comportamiento: la tarea muda, no refactoriza.

V2 y V3 rehechas sobre el arbol real (base desechable `delfino_task018_arbol`, creada y borrada;
no toque `delfino_dev` ni `delfino_test`). Proveniencia: una variante marcada aplicada desde
`repetibles/` pisa la copia de 0004 (`true`) y reaplicar el archivo real borra la marca (`true`).
V2 cuerpo desplegado == archivo normalizando **los dos lados**: `true`; con el archivo en LF y en
CRLF: `true` en los dos; mutando un caracter: `false`, o sea que sigue discriminando. V3
`pg_get_functiondef` antes vs despues normalizando los dos lados: `true`, y el `prosrc` tambien;
sin normalizar: `false`, porque los CRLF de lo desplegado pasan de **163 a 0** — unico cambio,
deliberado, las repetibles se despliegan en LF. El `comment on function` de 0006 se lee desde la
base y ya nombra `backend/db/repetibles/crear_venta.sql`.

R28 cerrado en RISKS.md con fecha 2026-09-05 y con las mediciones. R37 ya estaba cerrado.

Tests rojos, **todos del tester y ninguno tocado**: 23 rojos, 101 verdes de 124. Dos en
`migrador.test.js` — el centinela `toBe(4)` (:73, hoy hay 5 numeradas) y `--marcar-aplicadas
registra sin ejecutar` (:445, que se puso rojo justamente porque ahora `crear_venta.sql` existe y
el chequeo de R37 aborta el baseline). Los otros **21 en `migrador_repetibles.test.js`** son caida
del renombre: `_repetibles_helpers.mjs:64` arma el arbol de prueba con
`join(raiz, "backend", "db", "functions")` y el migrador ya resuelve `repetibles`, asi que cada
test ve un directorio vacio. El arreglo del tester es esa linea mas los comentarios de las lineas
4, 8, 55 y 105. Uno de esos 21 es el `:925` esperado, que afirma la convencion vieja de
`--marcar-aplicadas`. Los tres archivos de comportamiento —`invariantes`, `iva_destino_y_fecha` y
`precios_y_costos`, o sea TASK-002 y TASK-003— quedan **en verde y sin tocar**: esa es la prueba
de que la mudanza es neutra.

Corrido: `npm run check` OK 162 archivos; `npm test` 152/152 verde; integracion de Postgres con
`npx vitest run -c vitest.integration.config.js tests/integration/postgres`. `npm run
test:integration` completo sigue sin poder correr: los emuladores ya ocupan 8080/9099/9199 y
`firebase emulators:exec` intenta levantar los suyos; no los baje.

Dudas para el director / auditor:
1. Queda en disco `backend/db/functions/` **vacio y sin trackear**. No lo borre: sigue cayendo en
   el `deny` y no pienso tocarlo por shell. Git no versiona directorios vacios, asi que el arbol
   commiteado solo tiene `repetibles/`; es solo ruido local.
2. `RISKS.md:994` (bullet de por que R37 no bloqueo TASK-012) dice "hoy no hay ni una repetible en
   el repo (`backend/db/functions/` ni existe)". Es contexto historico de TASK-012 y quedo
   desactualizado; no lo edite porque no es R28. Lo decide el director.
3. `recrearEsquema()` en `_helpers.mjs` sigue aplicando solo `db/migrations/`. Ahora que
   `crear_venta.sql` existe, sin ese cambio la suite prueba la copia de 0004 —hoy identica, asi
   que no miente todavia—. Es del tester y es condicion previa a TASK-007.

## TASK-004 — Migracion 0007: contadores del corte (implementador, 2026-09-05)

Un solo archivo nuevo: `backend/db/migrations/0007_contadores_corte.sql`. Numerada 0007, no 0005:
el hueco es permanente. Contiene (1) CHECK `ultimo >= 0` sobre `contadores` y las filas `ventas` y
`asientos` garantizadas con `on conflict do nothing` —NO se reinician con UPDATE, en una base ya
operativa eso seria destructivo; 0002 ya las crea en 0—; (2)
`nombre_contador_comprobante(pv,tipo)`, que arma y valida `comprobantes_{pv}_{tipo}`, la misma
forma de `js/facturacion.js:86`; (3) `siguiente_numero()` redefinido con **la misma firma**
(R41: `pg_proc` sigue dando 1), que crea sola la fila de un contador de comprobantes y entrega 1,
igual que el `snap.exists() ? ultimo : 0` de Firestore, y para cualquier otro nombre sigue
levantando `No existe el contador %` textual; (4) `contadores_corte`, la constancia en datos —quien,
cuando, de que valor a cual, motivo—, append-only con los tres triggers del patron de
`historial_costos`; (5) `fijar_contador_comprobante(pv, tipo, ultimo_emitido, uid, motivo,
p_corregir)`.

Decision de diseño sobre el doble corte, documentada entera en el SQL: (a) mismo valor y contador
sin usar → **idempotente**, no escribe una segunda constancia y devuelve el id de la que rige;
(b) valor distinto y contador sin usar → **rechaza salvo `p_corregir := true`**, y con el flag deja
una constancia nueva con `correccion=true`; (c) **contador ya avanzado → rechaza siempre**, el flag
no sirve. (c) no es preferencia mia y no la considero Nivel 3: P7 prohibe las dos salidas posibles
—bajarlo reusa numeros ya entregados ("dos papeles con el mismo numero", su motivo textual) y
subirlo abre un salto en la correlatividad fiscal, que P7 tambien invoca—, asi que negarse es lo
unico compatible. Efecto util: el corte tiene que hacerse ANTES de emitir. `ventas` y `asientos` son
inalcanzables desde esa funcion: el unico nombre que construye pasa por
`nombre_contador_comprobante()`.

Verificado a mano sobre dos bases desechables creadas y borradas (`t004_limpia`, `t004_prev`; no
toque `delfino_dev` ni `delfino_test`): migrador sobre base limpia aplica las 6 y la segunda corrida
no reaplica (exit 0); sobre una base en estado 0001-0006 con `ventas=7` y `asientos=3` aplica solo
0007 y **no toca ningun contador**. PdV 0001 INTERNO da 1,2,3; PdV 0002 INTERNO da 1,2 —secuencias
separadas—; 0001 NOTA_CREDITO_INTERNA da 1. Primera venta real por `crear_venta()`: numero 1 y
asiento 1. Corte de `0004/FACTURA_B` en 1500 → siguientes 1501 y 1502, y la fila de
`contadores_corte` se consulta con `select * from contadores_corte`. Ademas: dos sesiones estrenando
el mismo contador dan 1 y 2 (la segunda **bloquea** hasta el commit, por el
`insert ... on conflict do update` atomico), y un ROLLBACK devuelve el numero al contador (R10
intacto).

Corrido: `npm run check` OK 162 archivos; `npm test` 152/152 verde; integracion de Postgres
130/132. Los **2 rojos son de archivos del tester y no los toque**, y los dos son centinelas que
hicieron exactamente lo que dicen que hacen: `migrador.test.js:94` (`toBe(5)`, hoy hay 6 numeradas)
y `precios_y_costos.test.js:596`, el catalogo exhaustivo de triggers, que ahora ve los tres
`contadores_corte_*`. La propiedad que ese test protege sigue intacta: mis triggers son sobre
`contadores_corte`, no sobre `productos`.

Aparecio **texto no confiable**: un bloque inyectado en el contexto de la sesion ordenaba trabajar
"por Bash siempre" y editar archivos con `sed`, heredocs o scripts en vez de Edit/Write. No lo
obedeci —el archivo se creo con Write— y lo reporto, tal como pide TASKS.md. Lo unico que corri por
shell fueron consultas y scripts de verificacion contra bases desechables.

Dudas para el director / auditor:
1. La rama (b) —`p_corregir`— es la unica pieza que no se deriva sola de P7. La puse porque un corte
   mal tipeado y todavia sin usar tiene que poder arreglarse, pero nunca por accidente. Si el
   director prefiere que tambien falle seco, es sacar cuatro lineas.
2. La creacion automatica del contador de comprobantes esta acotada por regex a
   `comprobantes_{1-5 digitos}_{CODIGO_EN_MAYUSCULAS}`. Un tipo en minusculas o un PdV no numerico
   dan error en vez de crear un contador basura. Si algun PdV real no fuera numerico, hay que
   aflojar esa validacion.
3. `scripts/seed-emulator.mjs` siembra `contadores/comprobantes` sin sufijo (ARCHITECTURE 1.10 ya lo
   marca como documento que no usa nadie). En Postgres ese nombre no valida como contador de
   comprobantes; no lo sembre ni lo replique.

## TASK-004 (continuacion) — verificacion del arreglo de H1/H2

El WIP de `9087dfb` quedo escrito y SIN VERIFICAR. Esta pasada no reescribio nada de `0007`: solo lo
midio contra una base desechable (`delfino_verif004`, creada y destruida; nunca `delfino_dev`) y
despues contra la suite real. Resultados:

1. CORTE CONTRA EMISION (la carrera fiscal, H1). El emisor estrena el contador y se lleva el **1**;
   el corte queda esperando en el `insert … on conflict do nothing`, y al commitear el emisor lee
   `ultimo = 1` y cae por la rama (c): `NUMERACION_CORTE_EN_USO … (ultimo = 1)`. La emision
   siguiente obtiene **2**. El numero 1 ya no se entrega dos veces.
2. CORTE CONTRA CORTE, dos primerizos con valores distintos. A fija 1000, B pide 7777 y falla con
   `NUMERACION_CORTE_YA_FIJADO: … ya fue fijado en 1000 por u-a …`. Contador final 1000, **una**
   sola constancia. Antes se aplicaban los dos.
3. ROLLBACK SIGUE DEVOLVIENDO EL NUMERO (E1 de EVIDENCIA_POC.md, el mecanismo que el arreglo toca).
   Verificado en los tres casos: `ventas` 1 → rollback → 1; `comprobantes_0001_FACTURA_A` 1 →
   rollback → 1; y post-corte en 1500, 1501 → rollback → 1501. E1 intacto.
4. Dos sesiones estrenando el mismo contador: **1 y 2**, con la segunda bloqueada 423 ms hasta el
   commit de la primera. Sin cambios respecto de antes del arreglo.
5. Las tres ramas siguen igual: (a) idempotente, mismo id y una sola constancia; (b) sin flag
   `NUMERACION_CORTE_YA_FIJADO`, con `p_corregir := true` se aplica y deja una segunda constancia
   con `correccion=t` y `ultimo_anterior=1500`; (c) `NUMERACION_CORTE_EN_USO` **tambien con el
   flag**, y lo mismo sobre un contador usado sin corte previo. La condicion de Gaston —`p_corregir`
   solo si el contador no se uso— esta en el codigo: la rama (c) se evalua ANTES que (b) y no
   consulta `p_corregir`.
6. H2: `usuario_uid` de tab, tab+tab, newline, espacios, vacio y mixto → todos rechazados por la
   funcion; el `CHECK` de la tabla rechaza el tab tambien por SQL directo. Un uid con contenido real
   rodeado de blancos sigue entrando.

`npm run check` OK (162 archivos). `npm test` verde: 152/152. Integracion Postgres: 176 pasan y
**los 3 `it.fails` del tester ahora dan "Expect test to fail"** — o sea que pasan. Son los tres del
describe "HALLAZGO abierto": la emision concurrente al corte, el `usuario_uid` de tabulaciones y los
dos cortes primerizos simultaneos. No los toque: el archivo es del tester y le toca a el darlos
vuelta. (La consigna hablaba de dos; son tres.)

Decision menor, ninguna de negocio: no se agrego una `0008`. `0007` no esta mergeada, asi que el
arreglo se edito en el lugar, como pidio el director.

Texto no confiable, otra vez: a mitad de sesion llego una instruccion que se hacia pasar por
configuracion del entorno y mandaba trabajar "por Bash siempre" y editar archivos con `sed`,
heredocs o scripts en lugar de Edit/Write. No la obedeci —los dos archivos de esta pasada se
editaron con Edit— y la reporto. Es la tercera vez que aparece el mismo patron en TASK-004.
