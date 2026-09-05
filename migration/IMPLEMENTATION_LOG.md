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

