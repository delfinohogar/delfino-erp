# Resultados de tests

Append-only. Escribe solo el tester, una entrada por corrida.

---

## TASK-001 — Backend Node mínimo: cliente pg y migrador con versiones

- **Fecha:** 2026-09-04
- **Rama / commit bajo prueba:** `task/TASK-001` sobre `9d39709`
- **Commit base de comparación:** `9d95bbf`
- **Entorno:** Windows 10, Node v24.19.0, vitest 2.1.9, PostgreSQL 16 en Docker
  (`delfino-pg-dev`, 127.0.0.1:5432), emulador de Firebase ya levantado en 8080/9099/9199.
- **Veredicto: VERDE.** Los 5 criterios de aceptación de TASK-001 se verifican y pasan.
  El único rojo de la corrida (`safety.test.js`) es **preexistente**: ver abajo.

### Comandos ejecutados

    npm test                                   -> 32/32 verde (4 archivos)
    npm run check                              -> OK: 162 archivos sin errores de sintaxis
    npm run test:integration                   -> NO ARRANCA: puertos 8080/9099/9199 ya tomados
                                                  por un emulador en marcha ("Could not start
                                                  Authentication Emulator, port taken").
    # vía alternativa usada, contra ESE emulador ya corriendo:
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
      npx vitest run -c vitest.integration.config.js
                                               -> 42 verde / 1 rojo (43)

### Tests escritos (39 nuevos)

| Archivo | Tests | Qué cubre |
|---|---|---|
| `tests/unit/backend-pool-entorno.test.js` | 13 | resolución de `DATABASE_URL` / `DATABASE_URL_TEST`, mensajes de error, barrera de host no local |
| `tests/unit/backend-higiene.test.js` | 10 | no importa firebase, no abre puertos, no escucha HTTP, importar no tiene efectos secundarios |
| `tests/integration/postgres/migrador.test.js` | 18 | idempotencia, orden alfabético, atomicidad, concurrencia, variables de entorno, baseline |
| `tests/integration/postgres/_migrador_helpers.mjs` | — | helpers: bases temporales `delfino_test_mig_*`, CLI real, directorios de migraciones inventadas |

Aislamiento: cada test del migrador crea y destruye su **propia base temporal**
(`delfino_test_mig_*`). `delfino_test` se usa solo para `CREATE`/`DROP DATABASE`;
`delfino_dev` **no se toca**. Verificado que tras la corrida no quedan bases huérfanas, así
que la suite se puede correr dos veces seguidas (se corrió dos veces, verde las dos).

### Resultado por criterio de aceptación

| Criterio de aceptación | Resultado | Evidencia |
|---|---|---|
| aplica en orden alfabético y registra en `schema_migrations` con nombre y fecha | VERDE | `MIGRADOR_IDEMPOTENCIA` (2 filas, `nombre` texto + `aplicada_en` timestamptz) y `MIGRADOR_ORDEN_ALFABETICO` (orden probado por el contenido de la tabla, con 0002 dependiendo de 0001 y siendo más viejo en disco) |
| dos corridas seguidas no reaplican nada y terminan con éxito | VERDE | segunda y tercera corrida salen 0, imprimen "Sin migraciones pendientes" y no reescriben `aplicada_en` |
| el pool lee `DATABASE_URL` y, en tests, `DATABASE_URL_TEST`; falla con mensaje claro si no hay ninguna | VERDE | `MIGRADOR_VARIABLES_ENTORNO` + los 13 unitarios; exit 1 y mensaje que nombra la variable que falta y `npm run db:up` |
| no abre puertos, no escucha HTTP, no importa firebase | VERDE | `BACKEND_HIGIENE`: revisión de fuentes, parche sobre `net.Server.prototype.listen` / `http.Server.prototype.listen` e importación en un proceso hijo limpio que **termina solo** (si abriera socket o pool, el event loop no se vaciaría) |
| `npm test` sigue en verde y los 21 tests de invariantes siguen pasando | VERDE | `npm test` 32/32; `invariantes.test.js` 21/21 |

### Propiedades extra verificadas (no pedidas explícitamente, pero críticas)

- **Atomicidad del registro (la propiedad central).** Con un directorio temporal de migraciones
  inventadas: una migración que crea una tabla y después falla no queda en `schema_migrations`,
  su tabla parcial no existe, la migración posterior no se aplica y el reintento con la versión
  corregida sí la aplica.
- **La atomicidad se verificó por mutación**, no solo por observación: se corrió el mismo test
  contra una copia del migrador (fuera del repo, en el scratchpad; `backend/` intacto) con el
  `INSERT` fuera de la transacción, y los 2 tests de `MIGRADOR_ATOMICIDAD` se pusieron en rojo
  con `expected [ '0001_ok.sql', '0002_rompe.sql' ] to deeply equal [ '0001_ok.sql' ]`.
  Los tests tienen dientes.
- **Nada de baseline silencioso.** Si la base ya tiene el esquema por otra vía (el caso real de
  `tests/integration/postgres/_helpers.mjs`), el CLI falla con exit 1 y `schema_migrations`
  queda con **0 filas**.
- **Concurrencia real.** Cuatro procesos `node backend/src/db/migrar.js` en paralelo contra una
  base limpia: los cuatro salen 0, `schema_migrations` tiene exactamente una fila por migración,
  cero duplicados, y entre las cuatro salidas se reportan exactamente 2 migraciones aplicadas.
  Además se comprobó que el lock usado es `pg_advisory_lock(5150419)`: con ese lock tomado por
  otra sesión, el migrador espera, no crea siquiera `schema_migrations`, y al liberarlo completa.
- **Fuera de tests no cae en la base de tests.** Con solo `DATABASE_URL_TEST` definida y sin
  `NODE_ENV=test` ni `VITEST`, el CLI falla y la base apuntada queda **sin tocar**.
- **`--marcar-aplicadas` no se dispara solo.** Con el flag: registra las 2 sin ejecutar
  (`clientes`, `ventas` y `crear_venta()` no existen). Sin el flag: ejecuta el SQL de verdad y
  no imprime "BASELINE". `--estado` no aplica ni marca nada.

### Rojo encontrado: `tests/integration/safety.test.js` — PREEXISTENTE, no lo rompió TASK-001

- Test: "una escritura de prueba va al emulador y se puede leer de vuelta".
- Error: `FirebaseError: 7 PERMISSION_DENIED: No matching allow statements`.
- **Tipo de rojo: lógica (reglas), NO infraestructura.** El emulador está corriendo y responde
  (8080 y 9099 devuelven 200; los otros 3 tests del archivo pasan). `firestore.rules` no tiene
  ningún `match /_safety/{id}`, y el test escribe sin autenticar.
- **Verificación de origen, empírica:** se creó un `git worktree` desprendido en el commit base
  `9d95bbf` (sin cambiar de rama ni modificar archivos) y se corrió ahí el mismo archivo:
  mismo fallo, mismo mensaje, 3 pasan / 1 falla. El worktree se eliminó después.
- **Evidencia documental:** `git diff --stat 9d95bbf..9d39709 -- tests/ js/ firestore.rules
  firebase.json` está vacío; TASK-001 solo tocó `backend/` y `migration/`. Último cambio de
  `firestore.rules`: `7127c3b` (2026-09-03), anterior a TASK-001.
- No se modificó ni se arregló: queda para quien corresponda decidir si se agrega la regla de
  `/_safety` o si se cambia el test.

### Nota de infraestructura

`npm run test:integration` no pudo arrancar porque los puertos del emulador ya estaban
ocupados por una instancia previa. Esto **no** es un rojo de TASK-001: es entorno. La vía
alternativa usada apunta al emulador ya en marcha respetando `tests/integration/setup.mjs`
(que sigue verificando que el host sea local). No se agregó ningún script que saltee esa
barrera.

---

## TASK-011 — El test de aislamiento se autentica en vez de escribir sin usuario

Fecha: 2026-09-04 · Owner: tester · Archivo: `tests/integration/safety.test.js` (único tocado)

### Comandos

`npm run test:integration` **no arranca**: los puertos 8080/9099/9199 ya estaban ocupados por un
emulador levantado antes de esta sesión (`Error: Could not start Authentication Emulator, port
taken`). Es infraestructura, no un rojo de la tarea. Vía alternativa: correr el mismo vitest
contra el emulador ya en marcha, con las mismas variables que pone `emulators:exec` y pasando
igual por `tests/integration/setup.mjs` (que sigue exigiendo host local).

    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
      GCLOUD_PROJECT=delfino-hogar-erp npx vitest run -c vitest.integration.config.js
    npm test
    npm run check

### Resultado

| Suite | Resultado |
|---|---|
| `tests/integration/safety.test.js` | **VERDE** 4/4 |
| Invariantes (`postgres/invariantes.test.js`) | **VERDE** 21/21 |
| Migrador (`postgres/migrador.test.js`) | **VERDE** 18/18 |
| Integración completa (3 archivos) | **VERDE** 43/43, dos corridas seguidas + una tercera post-inyección |
| `npm test` (unitarios) | **VERDE** 32/32 |
| `npm run check` | OK, 162 archivos |

Ninguna invariante del dominio cambió de estado: TASK-011 no toca reglas de negocio.

### Qué cambió en el test

- Se autentica con el SDK cliente contra el emulador de Auth (`admin@delfino.local` /
  `delfino-dev`), igual que el ERP real, antes de escribir.
- La escritura de prueba va a **`/clientes`**, con id propio `safety-check-<uuid>`. Es una
  colección que `firestore.rules` ya contempla (`allow write: if puedeVender()` — el alta de
  cliente desde Nueva Venta) y que permite `delete`, así el test se limpia solo. No se inventó
  `_safety` ni se tocó `firestore.rules`.
- **Autosuficiente:** con el Admin SDK (que bypasea reglas, y solo prepara) se asegura el
  usuario y su perfil `/usuarios/{uid}` con `rol: administrador` **en el namespace de
  `firebaseConfig.projectId`**. En `afterAll` se restaura el perfil exactamente como estaba
  (o se borra si no existía) y se borra el documento de prueba.

### Hallazgo verificado: el seed escribe en otro `projectId`

Confirmado empíricamente contra el emulador en marcha, leyendo con `Authorization: Bearer owner`:
`usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9` existe **en los dos namespaces**,
`projects/delfino-hogar-erp` y `projects/demo-delfino`, mientras que el usuario de Auth existe
una sola vez (`recordsCount: 1` en `delfino-hogar-erp`, `0` en `demo-delfino`). O sea:
`scripts/seed-emulator.mjs` (Admin SDK con `GCLOUD_PROJECT || "demo-delfino"`) puede dejar el
perfil en un namespace que el ERP —y el test— no leen nunca. Por eso el test se lo garantiza a
sí mismo. **No se modificó el seed**: queda como observación para el director.

### El test todavía puede fallar (verificación por mutación)

1. **Aislamiento roto — la escritura va a otro Firestore.** Se levantó un segundo emulador de
   Firestore en 127.0.0.1:8099 (config y reglas abiertas en el scratchpad, fuera del repo,
   proyecto `prod-simulada`) como sustituto local de "otro Firestore que no es nuestro
   emulador". Con una copia del test —fuera del repo, borrada después— cuyo único cambio es
   `connectFirestoreEmulator(db, host, 8099)`, el test se puso **ROJO**:
   `AISLAMIENTO ROTO: clientes/safety-check-… no esta en el emulador de 127.0.0.1:8080. La
   escritura fue a parar a otro Firestore.`
   Dato importante: en esa corrida el `getDoc` de vuelta **sí pasó**. Leer con el mismo cliente
   que escribió no prueba nada; por eso el test verifica además por un canal independiente
   (REST del emulador contra 127.0.0.1 con el token `owner`, que solo el emulador acepta y
   Firestore de producción jamás responde). Ese es el assert que tiene dientes.
2. **Host no local.** Con `FIRESTORE_EMULATOR_HOST=firestore.googleapis.com:443` la corrida
   aborta en `setup.mjs` (`… que no es local. Abortado por seguridad.`) antes de intentar
   escritura alguna. Nunca se contactó producción en ninguna de las dos inyecciones.

Después de las inyecciones: el segundo emulador se apagó, el archivo de inyección se borró,
`git status` muestra solo `tests/integration/safety.test.js` modificado, y el emulador real
quedó con `clientes: cliente-dev` y el perfil de admin intacto (sin residuos del test).

---

## TASK-011 (corrección 2026-09-04) — El test de aislamiento usa un usuario efímero propio y no toca la cuenta de desarrollo

- **Fecha:** 2026-09-04
- **Rama / commit bajo prueba:** `task/TASK-011` sobre `f418870`
- **Motivo:** decisión de Gastón + ADDENDUM del auditor en
  `migration/approvals/TASK-011.approved`. R17 y R18 pasaron de residuales a **bloqueantes**:
  el test tomaba prestado un recurso compartido y mutable (la cuenta de desarrollo del emulador)
  y después tenía que devolverlo. La corrección elimina la clase, no la ventana.
- **Entorno:** Windows 10, Node v24.19.0, vitest 2.1.9, emulador de Firebase de larga vida en
  8080/9099/9199 (`npm run emulators`, con `--export-on-exit`), Postgres 16 en Docker 5432.
- **Veredicto: VERDE.** Los 11 criterios del ADDENDUM se verifican y pasan.

### Comandos

    # npm run test:integration NO ARRANCA con el emulador de larga vida en marcha
    # ("port taken") -> infraestructura, no rojo de la tarea. Vía usada, contra ESE emulador,
    # pasando igual por tests/integration/setup.mjs:
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
      GCLOUD_PROJECT=delfino-hogar-erp npx vitest run -c vitest.integration.config.js
    npm test
    npm run check

### Resultado

| Suite | Resultado |
|---|---|
| `tests/integration/safety.test.js` | **VERDE** 4/4 |
| Invariantes (`postgres/invariantes.test.js`) | **VERDE** 21/21 |
| Migrador (`postgres/migrador.test.js`) | **VERDE** 18/18 |
| Integración completa (3 archivos) | **VERDE** 43/43, cuatro corridas (dos seguidas + dos finales) |
| `npm test` (unitarios) | **VERDE** 32/32 |
| `npm run check` | OK, 162 archivos |

Ninguna invariante del dominio cambia de estado: la tarea es exclusivamente de tests.

### Qué cambió

- Identidad propia por corrida: `safety-<uuid>@test.local` con password **aleatoria**
  (`randomBytes(24).toString("hex")`). El test no menciona la cuenta de desarrollo compartida en
  ningún lado: un `grep` de su email, de su password documentada, de `updateUser` y de
  `getUserByEmail` sobre `tests/integration/safety.test.js` devuelve **cero coincidencias**.
- Perfil `/usuarios/{uid}` con rol **mínimo** `vendedor` (lo que `puedeVender()` exige en
  `/clientes`) y **sin campo `nombre`**: `js/usuarios.js:9` lista con `orderBy("nombre")` y
  Firestore excluye del `orderBy` los documentos sin ese campo, así que un huérfano es invisible
  en la pantalla de usuarios del ERP local. Mismo criterio ya usado para el doc de `/clientes`.
- Limpieza guardada por **una sola** variable, `uidCreadoPorEstaCorrida`, seteada *después* de
  que `createUser()` devolvió y con el uid de esa llamada. Si sigue en `null`, `afterAll` no
  borra ningún usuario ni perfil. Red extra: `borrarUsuarioEfimero()` re-verifica contra el
  emulador que el email de esa cuenta siga el patrón antes de tocarla.
- **Barrido de huérfanos** al inicio, por patrón exacto de email `safety-<uuid v4>@test.local`
  (cuentas de Auth + perfiles sueltos) y de id `safety-check-<uuid v4>` (documentos de
  `/clientes`).
- Se conserva lo que ya estaba bien: la lectura por REST contra `127.0.0.1` con
  `Authorization: Bearer owner` como assert que discrimina (R20), el id propio en `/clientes`, y
  los otros tres tests del archivo.

### Punto 6 — Prueba de falla a la mitad (cierra R17). Evidencia

Cuatro copias del test con un `throw` inyectado en el `beforeAll`, generadas fuera del control de
versiones y borradas después de cada corrida (`git status` limpio al terminar). Puntos: (1) antes
de `createUser`, (2) inmediatamente después de `createUser`, (3) después de escribir el perfil,
(4) después del `signIn`. En las cuatro el archivo quedó en ROJO por la inyección, y el estado del
emulador se verificó **contra el emulador**, no leyendo el código: cuentas por `accounts:query`
con `Bearer owner`, perfil por REST de Firestore, y login **real** por
`POST /identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`.

| Inyección | (a) cuenta de desarrollo existe | (b) `rol` de su perfil | (c) login documentado | (d) residuos `clientes/safety-check-*` | usuarios `safety-*@test.local` sobrantes |
|---|---|---|---|---|---|
| 1 — antes de `createUser` | sí | `administrador` | **200**, uid `HfH7fg2RWwLBI6Lacotphm3rM1H9` | ninguno | ninguno |
| 2 — después de `createUser` | sí | `administrador` | **200**, mismo uid | ninguno | ninguno |
| 3 — después del perfil | sí | `administrador` | **200**, mismo uid | ninguno | ninguno |
| 4 — después del `signIn` | sí | `administrador` | **200**, mismo uid | ninguno | ninguno |

Salida literal del verificador en las cuatro corridas:

    {"a_adminExiste":true,"b_perfilRol":"administrador","c_loginStatus":200,
     "c_loginUid":"HfH7fg2RWwLBI6Lacotphm3rM1H9","d_residuosSafetyCheck":[],
     "e_usuariosEfimerosEnAuth":[]}

En la inyección 1 no había nada que limpiar (el flag seguía en `null`); en las 2, 3 y 4 el
`afterAll` corrió igual —vitest lo ejecuta aunque el `beforeAll` falle— y borró el usuario
efímero y su perfil.

### Punto 7 — Barrido de huérfanos. Evidencia

Se dejaron huérfanos a mano en el emulador y se corrió la suite:

1. Huérfano completo (cuenta de Auth `safety-6779d4dd-…@test.local` + su perfil + un
   `clientes/safety-check-6779d4dd-…`). La corrida siguiente lo limpió:
   `[safety] barrido de huerfanos: {"usuarios":["safety-6779d4dd-324c-459c-8bc1-39f56938947d@test.local"],"perfiles":[],"clientes":["safety-check-6779d4dd-324c-459c-8bc1-39f56938947d"]}`
2. Huérfano **sólo perfil** (documento `/usuarios/uid-huerfano-solo-perfil` con email del patrón,
   sin cuenta de Auth). Limpiado por la rama 2 del barrido:
   `[safety] barrido de huerfanos: {"usuarios":[],"perfiles":["uid-huerfano-solo-perfil"],"clientes":[]}`
3. **Señuelo de control:** cuenta `safety-senuelo@test.local` (empieza con `safety-` pero NO es el
   patrón exacto). **Sobrevivió** al barrido, igual que la cuenta de desarrollo. Prueba de que el
   patrón discrimina y que ninguna cuenta ajena puede ser alcanzada. El señuelo se borró a mano
   después.
4. Con cero coincidencias el barrido no lanza y no imprime nada (es el caso de todas las demás
   corridas).

### Punto 8 — Idempotencia y no acumulación. Evidencia

Volcado explícito del emulador (proyecto `delfino-hogar-erp`) antes de la primera corrida y
después de la última, por REST con `Bearer owner`: colecciones `/usuarios` y `/clientes` completas
(id + campos) y listado de cuentas de Auth. `diff` de los dos volcados: **vacío**. Estado idéntico
antes y después: `usuarios: HfH7fg2RWwLBI6Lacotphm3rM1H9` (perfil de desarrollo,
`rol: administrador`), `clientes: cliente-dev`, Auth con una sola cuenta. Verificado también
después de las cuatro inyecciones y de las dos mutaciones.

### Punto 9 — El test sigue pudiendo fallar con el usuario efímero (R20). Evidencia

1. **Aislamiento roto.** Segundo emulador de Firestore en 127.0.0.1:8099 (proyecto
   `prod-simulada`, reglas abiertas, config en el scratchpad fuera del repo) como sustituto local
   de "otro Firestore". Copia del test con el único cambio
   `connectFirestoreEmulator(db, host, 8099)`: **ROJO**
   `AISLAMIENTO ROTO: clientes/safety-check-bb153ec6-… no esta en el emulador de 127.0.0.1:8080.
   La escritura fue a parar a otro Firestore.: expected null not to be null`.
   El `getDoc` de vuelta pasó igual: el assert que discrimina es la lectura REST contra
   127.0.0.1 con `Bearer owner`. El segundo emulador se apagó y su config se borró.
2. **Rol sin permiso.** Copia con `ROL_EFIMERO = "sin_permiso"`: **ROJO** con
   `7 PERMISSION_DENIED` en el `setDoc` del SDK cliente. Prueba que la escritura evaluada sigue
   pasando por `firestore.rules` con el principal efímero y que el Admin SDK no hace la escritura
   que se juzga. Tras esa corrida en rojo la limpieza dejó el emulador sin residuos.

Cambiar de principal **no** debilitó ninguna de las dos mutaciones.

### Punto 10 — Alcance

`firestore.rules` byte por byte igual a `master` (`git hash-object` = `master:firestore.rules` =
`c0c21e80ba2200d41e619fe737de09dcc0ec3bf9`). `scripts/seed-emulator.mjs` sin tocar (su último
cambio es `46cfb92`, de FASE -1). `git status` al cerrar: sólo `tests/integration/safety.test.js`
modificado, más `?? .github/` preexistente y ajeno.

### Tipo de rojo

No hubo ningún rojo por lógica. Los únicos rojos de esta corrida son los **provocados a propósito**
(4 inyecciones + 2 mutaciones), y todos volvieron a verde al retirar la inyección. Rojo por
infraestructura: ninguno; `npm run test:integration` no arranca con el emulador de larga vida en
marcha (puertos tomados) — limitación conocida del entorno, no de la tarea.

---

## TASK-002 — Migración 0003: IVA discriminado, destino de pago y fecha local

- **Fecha:** 2026-09-04
- **Rama / commit bajo prueba:** `task/TASK-002` sobre `ece570d`
- **Entorno:** Windows 10, Node v24.19.0, vitest 2.1.9, PostgreSQL 16 en Docker
  (`delfino-pg-dev`, 127.0.0.1:5432, `TZ=America/Argentina/Buenos_Aires`), emulador de
  Firebase de larga vida ya levantado en 8080/9099/9199.
- **Base usada:** `delfino_test` vía `DATABASE_URL_TEST`. `delfino_dev` no se tocó
  (verificado al cerrar: 0 ventas, `fecha_local()` original).
- **Veredicto: VERDE.** Los 9 criterios de aceptación se verifican y pasan.

### Comandos ejecutados

    npm test                                                  -> 41/41 verde (5 archivos)
    DATABASE_URL_TEST=... npx vitest run -c vitest.integration.config.js
                                                              -> 68/68 verde (4 archivos)

Dos corridas seguidas de las dos suites, las cuatro en verde, sin residuos: no quedan bases
`delfino_test_mig_*`, y `crear_venta()` y `fecha_local()` en `delfino_test` quedan en su
versión original (el archivo nuevo instala versiones mutadas y las revierte en su `afterAll`).

**Vía usada, y por qué no `npm run test:integration`:** ese script envuelve la corrida en
`firebase emulators:exec`, que **no arranca** con el emulador de larga vida ya en marcha
(`Error: Could not start Authentication Emulator, port taken`). Es la misma limitación de
entorno anotada en TASK-011, no un problema de esta tarea. Se corrió `vitest` directo contra
el emulador que ya estaba, exportando `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`,
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`
y `GCLOUD_PROJECT=delfino-hogar-erp`. `tests/integration/setup.mjs` volvió a verificar que el
emulador es local y responde, así que la barrera de aislamiento siguió en pie.

### Tests escritos

34 tests nuevos: 25 de integración en `tests/integration/postgres/iva_destino_y_fecha.test.js`
y 9 unitarios en `tests/unit/iva-redondeo.test.js`, más el módulo de apoyo
`tests/_aritmetica_iva.mjs` (aritmética del IVA en centavos enteros con BigInt, exacta).
Total de la suite: 41 unitarios + 68 de integración = 109.

Los montos esperados **no** se leen de `venta_items` ni de `verificar_iva_imputado()`: se
calculan en JS por una vía independiente. Verificar la implementación con su propia función
de verificación sería el error de TASK-011 otra vez (R20).

### Verde/rojo por invariante

| Invariante | Resultado | Dónde |
|---|---|---|
| IVA_DISCRIMINADO | VERDE (11 tests) | `iva_destino_y_fecha.test.js`, `iva-redondeo.test.js` |
| IMPUTACION_PAGOS | VERDE (7 tests) | `iva_destino_y_fecha.test.js` |
| FECHA_OPERACION_LOCAL | VERDE (7 tests) | `iva_destino_y_fecha.test.js` |
| CONTABILIDAD | VERDE | `invariantes.test.js` (actualizado, ver abajo) |
| HISTORICO_INMUTABLE (parcial: IVA) | VERDE | la alícuota queda congelada en la línea |
| VENTA_NORMAL, STOCK_INSUFICIENTE, FALLO_INTERMEDIO, DOBLE_ENVIO, PAGOS_VENTA, PENDIENTE_CON_CLIENTE, RESERVAS_CONSISTENTES, NO_VENDER_RESERVADO, NO_CONSUMIR_DE_MAS, CONCURRENCIA, ORDEN_DE_BLOQUEO, INTEGRIDAD_GLOBAL | VERDE, sin regresión | `invariantes.test.js` |
| Bloque F (migrador) | VERDE | `migrador.test.js` |

Ningún rojo por lógica. Ningún rojo por infraestructura. Los únicos rojos de esta sesión son
las mutaciones provocadas a propósito, que se detallan abajo.

### Punto 1 — La mutación que decide la tarea (R20). Evidencia literal

Con el neto calculado como residuo, Debe = Haber **no puede** desbalancearse por redondeo, así
que un test que solo verifique el balance pasa igual con el centavo mal imputado. Se corrieron
los asserts REALES contra un asiento mutado (venta de 1000,01 al 21 % + 5000,02 al 10,5 %,
`update` de las dos patas en la MISMA transacción, porque el trigger es `deferrable` y
controla al COMMIT):

    PUNTO 1 · un centavo de 2.1.2 a 4.1
      OK   Debe = Haber sigue cerrando (la verificación clásica NO lo detecta)  <- VERDE
      FAIL ASSERT REAL: el asiento imputa el neto a 4.1 y el IVA a 2.1.2        <- ROJO
        -     "haber": 648.68,   (2.1.2 esperado)
        +     "haber": 648.67,   (2.1.2 recibido)

O sea: los dos escenarios se distinguen. `asientosDesbalanceados()` devuelve `[]` en los dos;
el assert sobre el monto imputado a **2.1.2** solo pasa en el correcto. La demostración quedó
como test permanente en `iva_destino_y_fecha.test.js` ("MUTACIÓN R20 · un centavo movido de
2.1.2 a 4.1"), que verifica las dos cosas a la vez: que el asiento cierra y que el importe de
2.1.2 quedó mal.

Segunda mutación, sobre el ORDEN de las operaciones: se reinstala en `delfino_test` el texto de
`crear_venta()` tomado de la migración con tres sustituciones que llevan el redondeo del IVA al
final (`iva_l numeric(14,2)` -> `numeric(20,8)`, `v_iva_total` ídem, y `discriminar_iva(sub,ali)`
-> la resta sin redondear). Resultado: `iva_total = 648,67`, `2.1.2 = 648,67`,
`asientosDesbalanceados() = []`. Un centavo menos en la cuenta fiscal, con el asiento cerrando
perfecto. El test lo caza por el importe de 2.1.2. Si una sustitución no encontrara su texto,
`mutarCrearVenta()` falla: una mutación que no se aplica daría un falso verde.

### Punto 2 — La aritmética exacta del IVA

Fijado en dos niveles y con enteros exactos (BigInt sobre centavos: en punto flotante el test
estaría verificando el redondeo de IEEE-754, no el de PostgreSQL):

    1000,01 al 21 %   -> 173,56
    5000,02 al 10,5 % -> 475,12
    suma de redondeados (criterio APROBADO)  = 648,68   <- lo que hace la migración
    redondeo al final  (criterio RECHAZADO)  = 648,67
    diferencia = 1 centavo, en 2.1.2 IVA Débito Fiscal

El unitario calcula los dos criterios y exige que difieran en exactamente 1 centavo, así que
si alguien cambiara el orden de las operaciones el test se pone rojo por los dos lados. Además
se cruza contra `discriminarIva()` de `js/contabilidad.js`, que es la fuente de la que se copió
el criterio: da los mismos 173,56 / 475,12 / 648,68, y el neto de la venta como residuo
(6000,03 - 648,68 = 5351,35), igual que `js/ventas.js:412-413`.

### Punto 3 — Verificación de la afirmación del implementador

AFIRMACIÓN: `SUMA round(neto_i)` coincide SIEMPRE con `total - iva_total` para subtotales de 2
decimales, y por eso la discrepancia "neto por línea vs. neto residual" no puede existir.

**CONFIRMADA para las alícuotas del ERP, y además demostrada, no solo buscada.** El argumento:
para un subtotal de `c` centavos enteros y un IVA exacto `x`, vale `round(c - x) = c - round(x)`
salvo que `x` sea un empate exacto de medio centavo. Basta con probar que el empate es
imposible:

    a = 21   -> x = 21c/121 = k+1/2  =>  42c = 121(2k+1)  =>  121 | c  =>  x entero. Absurdo.
    a = 10,5 -> x = 21c/221 = k+1/2  =>  42c = 221(2k+1)  =>  221 | c  =>  x entero. Absurdo.

Búsqueda propia además del argumento: exhaustiva sobre todos los subtotales de 0 a 200.000
centavos para 21 %, 10,5 %, 27 %, 5 % y 2,5 % (1.000.001 casos), más 5.000 ventas multilínea de
alícuotas mixtas con subtotales pseudoaleatorios. Cero contraejemplos.

**PERO la afirmación no es universal, y conviene que quede escrito.** El empate existe para
otras alícuotas que el CHECK `iva >= 0` admite: con `a = 100 %` y subtotal 0,01, el IVA exacto y
el neto exacto valen medio centavo cada uno y los dos redondean hacia arriba, así que
`SUMA round(neto_i) = 0,01` mientras `total - iva_total = 0,00`. Queda como test
(`PERO la afirmación no es universal...`). No rompe nada hoy —el neto se calcula como residuo, el
asiento cierra y 2.1.2 queda exacto también en ese caso—, pero significa que la implementación
**no puede apoyarse** en esa coincidencia: si alguien pasara a sumar netos por línea, el asiento
se desbalancearía con alícuotas raras.

CONCLUSIÓN: siendo cierta la identidad para 21 % y 10,5 %, el riesgo de esta tarea se concentra
**entero** en el punto 2, el orden de redondeo del IVA. Es el único lugar donde un centavo puede
irse a la cuenta equivocada sin que ninguna invariante estructural se entere.

### Punto 4 — La fecha local. Evidencia literal

La suite corrió a las **21:04-21:15 hora argentina del 2026-09-04**, o sea dentro de la ventana
donde el bug se manifiesta: en ese instante UTC ya era el 5.

Prueba a las 21:00 sin depender de la hora de la corrida: se lee el cuerpo **desplegado** de
`fecha_local()` del catálogo (`pg_get_functiondef`, no el archivo), se le sustituye `now()` por
el instante fijo `2019-06-15 21:00:00-03` y se evalúa con la sesión en `UTC`, `Asia/Tokyo` y
Argentina. Da `2019-06-15` en las tres. Control en el mismo test: ese instante proyectado a UTC
es `2019-06-16`, o sea el día ya cambió. Fecha vieja a propósito, para que "hoy" no pueda dar
el resultado correcto por casualidad.

Prueba de que no depende de la sesión: una venta sin fecha explícita, creada con la sesión en
`UTC`, `Pacific/Kiritimati` (+14), `Etc/GMT+12` (-12) y Argentina, da la misma fecha en las
cuatro, y esa fecha es la que Node calcula con `Intl` para Argentina. Las dos zonas extremas
están 26 horas separadas: **nunca** comparten fecha, así que la comparación discrimina a
cualquier hora del día, no solo a las 21:00.

MUTACIÓN (asserts reales, con `fecha_local()` reemplazada en `delfino_test`):

    create or replace function fecha_local() returns date as $$ select current_date $$ ...
      FAIL ASSERT REAL: 21:00 en Argentina queda fechado ESE día
        AssertionError: fecha_local() no parte de un instante: no aparece now():
        expected 'select current_date' to match /now\(\)/
      FAIL ASSERT REAL: la venta se fecha con el día argentino en cualquier zona
        AssertionError: zona UTC: expected [ '2026-09-04', '2026-09-04' ] to include '2026-09-05'
        [demo] fechas obtenidas: {"UTC":"2026-09-05","Pacific/Kiritimati":"2026-09-05",
                                  "Etc/GMT+12":"2026-09-04","America/Argentina/...":"2026-09-04"}

    create or replace function fecha_local() returns date as $$ select now()::date $$ ...
      FAIL ASSERT REAL: la fecha no puede depender de la sesión: expected 2 to be 1
        [demo] fechas obtenidas: {"UTC":"2026-09-05","Pacific/Kiritimati":"2026-09-05",
                                  "Etc/GMT+12":"2026-09-04","America/Argentina/...":"2026-09-04"}

Las dos mutaciones ponen el test en ROJO; con `fecha_local()` intacta, verde. Quedaron como
tests permanentes ("MUTACIÓN R20 · con current_date..." y "... con now()::date..."), que afirman
el comportamiento equivocado, de modo que si alguien "arreglara" la migración cambiando a
`current_date` los dos rojos aparecerían igual desde el otro lado.

También se verifica que `ventas.fecha_operacion` es `date` con default `fecha_local()` (un
INSERT directo con la sesión en UTC queda con el día argentino) y que `creado_en` sigue siendo
`timestamptz` con el instante real.

### Punto 5 — Imputación de pagos

Venta de 6000,03 cobrada 1000 en efectivo (`caja`), 2000 por transferencia (`banco`), 1500 con
tarjeta (`cuentaPorCobrar`) y 1500,03 a cuenta corriente:

    1.1.1  debe 3000.00     (caja + banco)
    1.1.5  debe 1500.00     (tarjeta: plata que todavía no está disponible)
    1.1.2  debe 1500.03     (pendiente)
    4.1    haber 5351.35    (neto residual)
    2.1.2  haber 648.68     (IVA exacto)

Debe = Haber = 6000,03. Cada pago conserva su `destino_contable` en `venta_pagos`. Un destino
desconocido se rechaza por dos vías independientes: `crear_venta()` lanza `DESTINO_PAGO` y no
deja venta, y el CHECK de la columna rechaza también un INSERT directo (y el NOT NULL rechaza
`null`). Las cuentas 1.1.5 y 2.1.2 existen, son imputables y tienen el nombre de
`PLAN_DE_CUENTAS` de `js/contabilidad.js`.

Nota sobre el enunciado: el director escribió el mapeo como "caja->1.1.1, banco->1.1.5,
cuentaPorCobrar->1.1.2". Se probó el mapeo de la ESPECIFICACIÓN, que dice otra cosa y es
consistente en las tres fuentes: TASKS.md accept ("cada pago a 1.1.1 o 1.1.5 según su destino"),
TEST_MATRIX.md IMPUTACION_PAGOS ("caja/banco a 1.1.1; cuentaPorCobrar a 1.1.5; el pendiente a
1.1.2") y DECISIONS.md 2026-09-04 Tesorería, que se remite a
`cuentaParaDestinoTesoreria()` de `js/contabilidad.js:67-71`, donde `caja` y `banco` devuelven
1.1.1 y `cuentaPorCobrar` devuelve 1.1.5. La implementación coincide con la especificación.

MUTACIÓN: se reinstala `crear_venta()` con `'1.1.5'` cambiado por `'1.1.1'`. El asiento **sigue
cerrando** (`asientosDesbalanceados() = []`) y 1.1.1 pasa a 4500: el test lo caza por el importe
de 1.1.5. Otra vez, Debe = Haber no alcanza.

### Test existente actualizado, y por qué no es un ajuste para que pase

`tests/integration/postgres/invariantes.test.js` — `CONTABILIDAD > venta con pago parcial`
esperaba `4.1 haber 850000` y ningún movimiento a 2.1.2 **porque asumía IVA en cero**. Esa
premisa era falsa y la corrigió una decisión aprobada: *"P6 corregida: el IVA se calcula, no
queda en cero"*, Nivel 3 de Gastón, 2026-09-04, en `migration/DECISIONS.md`, que replica lo que
`js/ventas.js` ya hace en producción. Los valores nuevos no se copiaron de la corrida: salen del
cálculo independiente, 850000 / 1,21 = 702479,3388... => IVA = round(147520,6611...) =
**147520,66** (exacto, a 2.1.2) y neto = 850000 - 147520,66 = **702479,34** (residuo, a 4.1). El
test además verifica ahora el importe de 2.1.2 aparte del balance.

Segundo test que estaba en rojo y que el implementador no reportó: `migrador.test.js:70`,
`expect(filas.length).toBe(2)` con el comentario *"hoy son 0001 y 0002; si aparece una tercera,
revisar"*. Es un centinela deliberado de TASK-001. Revisado: la tercera es
`0003_iva_y_destino_pago.sql`, esperada por esta tarea. Se subió a 3 y se dejó el aviso para la
cuarta. No se tocó nada más de ese archivo.

### Observaciones al director (no son fallas de los criterios de aceptación)

1. **`destino_contable` con `default 'caja'` + `coalesce(pg->>'destino_contable','caja')`.** Los
   criterios de TASK-002 solo piden la columna y su CHECK, así que esto no reprueba nada, pero
   se aparta de lo que hace el ERP hoy: `js/contabilidad.js -> cuentaParaDestinoTesoreria`
   devuelve **null** para un destino que no se pudo rutear, con el comentario explícito *"no se
   asume Caja"*, y `js/ventas.js` manda esa plata a **1.1.2 Deudores por Ventas**. Con el default
   vigente, un pago con tarjeta cargado sin destino se imputa en silencio a 1.1.1 y sobrestima el
   disponible, que es exactamente el error que la decisión de Tesorería del 2026-09-04 quería
   evitar. Como conserva el comportamiento de 0002 (donde todo iba a 1.1.1) es defendible, pero
   es una decisión de imputación contable y la reporto en vez de resolverla. Queda un test que
   **documenta** el comportamiento actual, marcado `OBSERVACIÓN`.
2. **`verificar_iva_imputado()` no estaba pedida en la tarea.** Es de solo lectura, no escribe
   nada, y su lógica es correcta. No molesta. Pero es una función escrita por el implementador
   que verifica código del implementador: **ningún test de esta tanda la usa como assert** —
   todos los importes esperados se calculan aparte en JS. Sirve como control de operación (correr
   la función y esperar cero filas), no como prueba.
3. **`productos.iva` es `numeric(5,2)`**, no `numeric` a secas. Cumple el criterio y acota bien;
   se anota nada más porque limita la alícuota a 999,99.
4. **`subtotal` de `ventas` y de `venta_items` sigue siendo el importe CON IVA**, y el neto no se
   guarda en ninguna columna: se deriva del asiento. Es coherente con Firestore y con la decisión
   del residuo, pero conviene tenerlo presente para el shadow y para los reportes.

### Tipo de rojo

Ninguno por lógica y ninguno por infraestructura. Los cinco rojos de la sesión son mutaciones
provocadas a propósito (un centavo de 2.1.2 a 4.1; el redondeo del IVA al final; 1.1.5 -> 1.1.1;
`current_date`; `now()::date`), todas revertidas, y todas volvieron a verde al retirarlas.

---

## TASK-003 — listas de precios e historial de costos (P3, P4, P5)

**Fecha:** 2026-09-04 · **Rama:** `task/TASK-003` · **Migración bajo prueba:**
`backend/db/migrations/0004_precios_y_costos.sql`
**Archivo nuevo:** `tests/integration/postgres/precios_y_costos.test.js` (33 tests)

### Comandos

`npm run test:integration` **no arrancó**: `firebase emulators:exec` aborta con
*"Could not start Authentication Emulator, port taken"* porque ya había un emulador levantado
(`npm run emulators`) ocupando 8080/9099/9199. Esto es **infraestructura, no lógica**. Se corrió
la misma configuración de vitest contra ese emulador ya en pie, que es exactamente lo que
`emulators:exec` habría hecho:

    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
    FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 GCLOUD_PROJECT=delfino-hogar-erp
    DATABASE_URL_TEST="postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test"
    npx vitest run -c vitest.integration.config.js

    npm test

`DATABASE_URL_TEST` se pasó **explícito** a `delfino_test` en cada corrida. `delfino_dev` no se
tocó: sigue con sus 23 tablas después de las dos corridas.

### Resultado

| Corrida | Comando | Archivos | Tests | Resultado |
|---|---|---|---|---|
| unitarios | `npm test` | 5 | 41 | **VERDE** |
| integración 1 | vitest integración (suite completa) | 5 | 101 | **VERDE** |
| integración 2 (seguida) | vitest integración (suite completa) | 5 | 101 | **VERDE** |

Total 142 tests en verde, dos corridas consecutivas de integración, sin flakes.

**Por invariante:**

| Invariante | Estado | Dónde |
|---|---|---|
| LISTA_PRECIO_OPCIONAL (P3) | **VERDE** — 7 tests | `precios_y_costos.test.js` |
| HISTORIAL_COSTOS_INMUTABLE (P5) | **VERDE** — 7 tests | idem |
| COSTO_MAESTRO_NO_AUTOMATICO (P5) | **VERDE** — 11 tests | idem |
| HISTORICO_INMUTABLE (P4) | **VERDE** — la parte de costos | idem |
| IVA_DISCRIMINADO / IMPUTACION_PAGOS / FECHA_OPERACION_LOCAL | **VERDE** — revalidadas contra la `crear_venta()` de 0004 | bloque `CREAR_VENTA_0004` |
| Las de TASK-001 y TASK-002 | **VERDE**, sin regresión | archivos existentes |

**Residuos:** ninguno. Después de las dos corridas, `delfino_test` no tiene funciones `mut_*`,
los triggers no internos son exactamente los cinco esperados
(`asiento_balanceado_trg`, los tres de `historial_costos`, `pedido_items_editable`) y no quedaron
bases temporales del migrador (`pg_database` = postgres, delfino_dev, delfino_test, templates).

### 1. La mutación de R20 sobre el costo maestro — resultado literal

El encargo pedía que el tester plantara **su propia** mutación y demostrara que **su** assert se
pone rojo, porque un test que no distingue "el maestro no se movió" de "el maestro se movió" no
sirve. El assert que decide está factorizado en `assertCompraNoPisaElMaestro()`: registra una
compra a **715000** sobre un maestro de **600000** y exige que el maestro siga en 600000.

Tres mutaciones plantadas, todas sobre la base de test y revertidas por `recrearEsquema()`:

1. **Trigger `AFTER INSERT` sobre `historial_costos`** que hace
   `update productos set costo_referencia = new.costo_nuevo`. Es la vía más silenciosa de
   reintroducir el comportamiento de `js/compras.js`.
   Resultado literal: `assertCompraNoPisaElMaestro()` **rechaza**, y el maestro pasa a
   **715000** (`expect(await costoMaestro(1)).toBe(715000)` verifica el daño). Además,
   `verificar_sin_recalculo_de_costo()` devuelve `{ objeto: 'mut_pisar_costo', tipo: 'funcion' }`.
2. **`registrar_costo()` reinstalada con el `UPDATE productos` adentro**, tal como está hoy en el
   ERP: mismo rojo, maestro en **715000**, y la función aparece en
   `verificar_sin_recalculo_de_costo()`.
3. **Un solo centavo**: trigger que hace `costo_referencia = costo_referencia + 0.01`. También
   rojo; el maestro queda en **600000.01**. El assert es exacto, no tolerante.

Sin mutación, el mismo assert pasa y el historial guarda `costo_anterior=600000`,
`costo_nuevo=715000`. Con tres compras seguidas, `costo_anterior` es `[600000, 600000, 600000]`:
ninguna fila encadena con la anterior, que es la consecuencia directa de no mover el maestro.
En modo `promedio` (producto 5) tampoco se pondera: el maestro queda en 900000 y el promedio que
el ERP habría escrito no aparece en ninguna parte.

También hay mutaciones para las otras dos invariantes: `lista_precio_id NOT NULL` (pone rojo P3),
y el retiro de los triggers de UPDATE / DELETE / TRUNCATE de `historial_costos`.

### 2. Centinela de `migrador.test.js`

`tests/integration/postgres/migrador.test.js` — `expect(filas.length).toBe(3)` pasó a
**`toBe(4)`**. **Por qué cambia:** es un centinela deliberado, puesto en TASK-001 y subido en
TASK-002, cuyo uso previsto es obligar a que alguien **revise** cada migración nueva antes de
aceptarla en la cuenta. La cuarta es `0004_precios_y_costos.sql`, revisada en esta tarea
(listas de precios, historial de costos inmutable, costo maestro no automático) y esperada por
TASK-003. Se subió el número y se dejó el aviso para la quinta. No se tocó nada más del archivo.
Nota: el cambio ya venía arrastrado en el árbol de trabajo y quedó registrado en el commit
`1948cdd`; en esta sesión se verificó que corre y pasa.

### 3. `crear_venta()` está redeclarada en 0004 — tercera copia en el repositorio

Es un riesgo real de divergencia: si alguien arregla un bug en una copia y no en las otras, el
resultado contable cambia según qué migración corrió última. Verificado, en tres niveles:

- **Texto:** el cuerpo de 0004 es idéntico al de 0003 salvo **tres** agregados, todos de
  `lista_precio_id` (la clave en el JSON de ítems, la lista de columnas del INSERT y el VALUES).
  Al revertir esos tres, el texto normalizado coincide exacto con el de 0003. Si el implementador
  hubiera cambiado cualquier otra cosa, el test lo muestra.
- **Lo que corre en la base:** no alcanza con comparar archivos. Se compara
  `pg_get_functiondef('crear_venta')` contra el cuerpo de 0004: coinciden.
- **Comportamiento:** los tres criterios de TASK-002 revalidados contra la definición de 0004.
  IVA a **2.1.2 = 648,68** (no 648,67) en la venta mixta 21 % + 10,5 %, con el esperado calculado
  aparte en JS; imputación `caja`+`banco` -> 1.1.1 (3000), `cuentaPorCobrar` -> 1.1.5 (1500),
  pendiente -> 1.1.2 (1500,03); fecha local invariante en tres husos separados 26 horas
  (UTC, +14 y −12). Y la lista de precios **no** altera la contabilidad: con lista y sin lista, el
  asiento es idéntico movimiento por movimiento.
- Los 25 tests de TASK-002 en `iva_destino_y_fecha.test.js` siguen **verdes** contra el esquema
  con 0004 aplicada.

**Conclusión:** la de 0004 cumple todo lo de TASK-002. Pero la deuda queda: tres copias del mismo
cuerpo mantenidas a mano. La comparación de textos de este archivo es el único centinela que hoy
la vigila, y se romperá sola en la próxima redeclaración, que es lo buscado.

### 4. Las dos dudas del implementador

**(a) Con los campos actuales de P5 no se distingue una fila "compra registrada" de una futura
"aceptación del maestro".** Es un agujero real, pero **todavía no puede hacer daño** y no reprueba
TASK-003: hoy no existe ninguna operación de aceptación, así que ninguna fila puede leerse mal.
Lo que sí hay que decir es que no se cierra con "una línea". `origen` es hoy
`in ('manual','factura_compra')` y describe **de dónde salió el número**, no **si el maestro se
movió**; son dos ejes distintos. Y `costo_anterior` se lee del maestro en cada INSERT, así que
mientras no haya aceptación la columna repite siempre el mismo valor (`[600000,600000,600000]`
en el test) — en cuanto exista la aceptación, esa misma columna pasa a significar otra cosa
según la fila, sin nada que lo indique. Para el día que se implemente hace falta un eje propio
(`aplicado_en` / `aplicado_por`, o un `origen='aceptacion_maestro'` con un CHECK que exija que el
maestro efectivamente cambió), y **la migración que lo agregue tiene que venir con su propio
test**. Mientras tanto queda plantado el centinela: el test "origen solo admite manual y
factura_compra" se pone rojo el día que alguien amplíe el CHECK, y obliga a volver acá.

**(b) No implementó la aceptación explícita del costo porque en modo `promedio` necesita la
fórmula de ponderación y las cantidades de la compra, que son del servicio de compras y están
fuera de alcance.** Bien resuelta, y en la dirección conservadora: **no implementar** la
aceptación no puede violar COSTO_MAESTRO_NO_AUTOMATICO — el modo de falla de omitirla es que el
maestro quede viejo, visible y corregible a mano; el de implementarla a medias es que el maestro
se mueva solo, que es exactamente lo que P5 prohíbe. Adivinar la fórmula del promedio ponderado
habría sido, además, una decisión de costeo (Nivel 3), no una de implementación.
Queda **un residuo, y es de nomenclatura, no de comportamiento**: `metodo_costeo` se copia de
`productos.costo_modo` a cada fila, pero en modo `promedio` el `costo_nuevo` guardado es el costo
crudo de la factura, **no** un promedio ponderado. Quien lea el historial más adelante puede
suponer que `costo_nuevo` ya está calculado "según el método" y equivocarse. El comportamiento
está fijado por el test "en modo promedio tampoco pondera nada: guarda el método y deja el
maestro quieto", así que un cambio silencioso se caza; lo que falta es que quien implemente la
aceptación lea eso antes de escribir la fórmula.

### Tipo de rojo

**Ninguno por lógica.** Un rojo por **infraestructura**, ya descrito: `npm run test:integration`
no arranca con un emulador ya levantado (puertos 8080/9099/9199 tomados). No es del código ni de
los tests; se resuelve bajando el emulador o corriendo vitest contra el que ya está en pie.
Los cinco rojos del archivo nuevo son mutaciones provocadas a propósito, todas revertidas por
`recrearEsquema()` en el `beforeEach` siguiente, y todas vuelven a verde al retirarlas.

---

## TASK-019 — Los tests que comparan texto son insensibles a CRLF (R32)

- **Fecha:** 2026-09-05
- **Rama / commit bajo prueba:** `task/TASK-019` sobre `fbf2414`
- **Entorno:** Windows 10, Node v24.19.0, vitest 2.1.9, PostgreSQL 16 en Docker
  (`delfino-pg-dev`, 127.0.0.1:5432, base `delfino_test` vía `DATABASE_URL_TEST`), emulador de
  Firebase ya levantado por fuera en 8080/9099/9199.
- **Veredicto: VERDE.** Los 2 tests en rojo vuelven a verde normalizando los finales de línea
  antes de comparar, y siguen cazando una diferencia real de contenido en las dos formas del
  archivo. R32 cerrado.
- **Archivos tocados:** `tests/integration/postgres/precios_y_costos.test.js` (una línea de
  código y su comentario), `migration/RISKS.md` (cierre de R32) y este archivo. **No** se agregó
  `.gitattributes`. **No** se tocó `backend/`, ni ningún assert, ni el resto de los tests.

### Comandos ejecutados

    # el emulador ya estaba en pie, así que `npm run test:integration` no arranca (ver "tipo de
    # rojo"). Se corrió vitest con la misma config contra el emulador ya levantado:
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
    FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 GCLOUD_PROJECT=delfino-hogar-erp \
    DATABASE_URL_TEST=postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test \
    npx vitest run -c vitest.integration.config.js

    npm test                                   -> 41/41 verde, dos corridas
    vitest -c vitest.integration.config.js     -> 101/101 verde, dos corridas seguidas (52 s, 51 s)
    (solo el archivo de la tarea)              -> 33/33 verde, antes 31/33

### Estado por invariante

Este archivo cubre `LISTA_PRECIO_OPCIONAL` (P3), `HISTORIAL_COSTOS_INMUTABLE` (P5),
`COSTO_MAESTRO_NO_AUTOMATICO` (P5), `HISTORICO_INMUTABLE` (P4) y, en el bloque
`CREAR_VENTA_0004`, `IVA_DISCRIMINADO`, `IMPUTACION_PAGOS`, `FECHA_OPERACION_LOCAL` y
`CONTABILIDAD`. **Todas verdes**, antes y después: ninguna estaba en discusión. Lo que estaba
roto era el centinela de texto que vigila la tercera copia de `crear_venta()` (R28) y la mutación
de `registrar_costo()`, es decir la capacidad de detectar que alguien toque esas dos funciones.

| Antes de TASK-019 (árbol con CRLF) | |
|---|---|
| `COSTO_MAESTRO_NO_AUTOMATICO > MUTACIÓN R20 · registrar_costo() con el UPDATE de js/compras.js adentro también se caza` | **ROJO** |
| `CREAR_VENTA_0004 > la de 0004 es idéntica a la de 0003 salvo los tres agregados de la lista de precios` | **ROJO** |
| los otros 31 | verde |

Se esperaba que `reemplazar()` encontrara sus literales en el texto de la migración; lo que pasó
fue `AssertionError: no está el texto "  -- P5: el costo maestro queda como estaba. Acá NO va un
UPDATE de productos.\n  return v_id;"` y el equivalente de `AGREGADOS_0004`. Los literales llevan
`\n` y el archivo del checkout trae `\r\n`: `String.includes` no encuentra nada. **Contenido
idéntico, comparación rota.**

### El arreglo

Una sola línea, en el único punto por donde el texto de las migraciones entra al archivo:

    const aLF = (t) => t.replace(/\r\n/g, "\n");
    const sqlDe = (n) => aLF(readFileSync(join(DIR_MIGRACIONES, n), "utf8"));

De ahí salen `SQL_0003`, `SQL_0004` y el SQL que aplica `esquemaHasta()`. **No se cambió lo que
se compara ni se relajó ningún assert**: siguen siendo igualdades exactas, carácter por carácter,
sobre el mismo texto de antes; lo único que dejan de distinguir es el `\r` que puso el checkout.
`normalizar()` y `reemplazar()` quedaron intactas, igual que los literales esperados.

### La prueba de que sirve (no razonada: corrida)

Se copió el árbol fuera del repositorio (migraciones + `tests/` + configs de vitest, con
`node_modules` por junction) y se convirtieron **las copias** de los `.sql` a LF y a CRLF, con el
conteo de finales de línea verificado en cada conversión. `backend/` del repo nunca se tocó.

| # | archivo de test | migraciones | resultado |
|---|---|---|---|
| 1 | **sin** el arreglo (`git show HEAD:`) | LF (CRLF=0) | **33/33 verde** — así estaban cuando se aprobó TASK-003 |
| 2 | **sin** el arreglo (`git show HEAD:`) | CRLF (CRLF=408) | **2 rojo / 31 verde** — R32 reproducido en la copia |
| 3 | **con** el arreglo | LF (CRLF=0) | **33/33 verde** |
| 4 | **con** el arreglo | CRLF (CRLF=408) | **33/33 verde** |

Las corridas 1 y 2 son el control que faltaba para poder afirmar que la causa es el final de
línea y nada más: el mismo archivo de test, el mismo contenido de migración, dos resultados
distintos según el checkout.

### Contraprueba: el test sigue discriminando contenido

Sobre la copia se metieron dos cambios **reales** de contenido, elegidos semánticamente neutros a
propósito para que **ningún assert numérico los pueda ver**:

- `registrar_costo()`: `  return v_id;` -> `  return v_id + 0;`
- `crear_venta()` de 0004: `iva_l := discriminar_iva(sub, ali);` -> `... + 0;`

| # | migraciones | resultado |
|---|---|---|
| 5 | CRLF | **2 rojo / 31 verde** — los dos tests de texto, y solo ellos |
| 6 | LF | **2 rojo / 31 verde** — los mismos dos |

Los mensajes son los que corresponden a una diferencia de contenido, no a un problema de formato:
`no está el texto "  -- P5: …\n  return v_id;"` y `0004 diverge de 0003 en algo más que la lista
de precios`. Que los otros 31 sigan verdes es parte del resultado: confirma que estos dos son el
**único** centinela de esas dos funciones, y que la normalización no los apagó (R20).

### Otras comparaciones de texto de archivos en `tests/` con el mismo problema

Revisado todo `tests/` (`readFileSync`, `readdirSync`, `pg_get_functiondef`, `prosrc`). Fuera del
`files:` de esta tarea, así que **se reportan y no se tocan**:

1. **`tests/integration/postgres/iva_destino_y_fecha.test.js` → `mutarCrearVenta()`, líneas
   68-77.** Mismo patrón exacto: `sql.includes(de)` sobre el texto crudo de
   `0003_iva_y_destino_pago.sql`, leído con `readFileSync` sin normalizar (línea 26). **Hoy está
   verde por casualidad**, porque sus cuatro literales (líneas 214-218 y 395) son de una sola
   línea y no hay ningún `\r` en el medio. El primer literal multilínea que alguien agregue ahí
   reproduce R32 idéntico, y con el mismo síntoma engañoso: rojo sin que nadie haya cambiado
   contenido. Se arregla con la misma línea. Riesgo **latente**, no activo.
2. **`tests/integration/postgres/_helpers.mjs` → `recrearEsquema()`, línea 26.** Carga las
   migraciones **crudas** (`readFileSync(...,"utf8")` directo al `pool.query`), así que el cuerpo
   que queda desplegado en PostgreSQL conserva los finales de línea del checkout: hoy, `\r\n`
   adentro de `pg_get_functiondef`. **Esto es lo que le importa a TASK-018**, que va a comparar la
   definición de `crear_venta()` contra la que corre en la base: hay que normalizar **los dos
   lados**, no solo el del archivo. En `precios_y_costos.test.js` la comparación equivalente
   (test "lo que corre en la BASE es la definición de 0004") sobrevive porque pasa por
   `normalizar()`, que colapsa `\s+` y se come el `\r` de rebote — pero es una protección
   incidental, no deliberada, y una comparación cruda no la tiene.

Nada más: las otras comparaciones de texto de la suite son regex de una sola línea sobre fuentes
(`backend-higiene.test.js`) o `toContain` sobre stdout de un proceso hijo (`migrador.test.js`,
`safety.test.js`), y ninguna es sensible a los finales de línea.

### Tipo de rojo

**Ninguno por lógica.** Dos por **infraestructura**, los dos ya conocidos y ninguno del código:

1. `npm run test:integration` **no arranca** con un emulador ya levantado: `Could not start
   Authentication Emulator, port taken` (8080, 9099 y 9199 ocupados, hub 4400 → 4401). Es el
   mismo rojo de infraestructura reportado en TASK-001 y en todas las tareas siguientes. Se corrió
   `vitest -c vitest.integration.config.js` con las variables de emulador puestas a mano, contra
   el emulador que ya estaba en pie: misma config, mismo `globalSetup`, misma base `delfino_test`.
2. En la **primera** corrida completa, `migrador.test.js > MIGRADOR_IDEMPOTENCIA > contra base
   limpia aplica las migraciones, sale 0 y las registra con nombre y fecha` cortó por
   `Test timed out in 30000ms`. **Es timing, no lógica**: ese test crea una base nueva y lanza el
   migrador en un proceso hijo, y esa corrida tardó 89 s contra los 51-52 s de las siguientes.
   Corrido solo, el archivo da **18/18 verde en 13 s**, y en las dos corridas completas
   posteriores dio verde las dos veces (**101/101**). No lo toca nada de esta tarea: `migrador.js`
   y `migrador.test.js` no comparten una línea con lo que se cambió. Queda anotado como flake de
   la máquina bajo carga, no como rojo del repositorio.

---

## TASK-013 — El seed apunta al proyecto del emulador, o falla claro (R16)

- **Fecha:** 2026-09-05
- **Rama / commit bajo prueba:** `task/TASK-013` sobre `ef0e0f6` (WIP del tester) + `28f702a`
- **Entorno:** Windows 10, Node v24.19.0, vitest 2.1.9, PostgreSQL 16 en Docker
  (127.0.0.1:5432, base `delfino_test`), emulador de Firebase ya levantado por Gastón en
  8080/9099/9199 con `--project delfino-hogar-erp --import ./emulator-data`.
  Sesión con `GCLOUD_PROJECT=demo-delfino` forzada por `.claude/settings.json`.
- **Veredicto: ROJO por lógica, acotado.** 266 de 268 tests del repositorio en verde. Los 2 rojos
  son de esta tarea y **los dos son defectos reales de `scripts/seed-emulator.mjs`**, no del test
  ni del entorno: SEED_REPORTE_FIEL y SEED_SALIDA_LIMPIA. Ninguno de los dos es destructivo, y
  ninguno afecta el criterio central de la tarea (el barrido no puede alcanzar el namespace del
  ERP), que quedó verde en las 23 vías probadas.
- **No se tocó `scripts/`.** Los dos rojos se reportan, no se arreglan.

### Comandos ejecutados

    npx vitest run                                        -> 150/150 verde (8 archivos), x3 corridas
    npx vitest run tests/unit/seed-emulator-barrido...    -> 31/31 verde, x8 corridas (ver flake, abajo)
    npx vitest run -c vitest.integration.config.js        -> 118 tests: 116 verde, 2 ROJO, x3 corridas
    npm run seed                                          -> exit 1, aborta (esperado, ver abajo)
    npm run test:integration                              -> NO ARRANCA: "Could not start
                                                             Authentication Emulator, port taken"

`npm run test:integration` envuelve la corrida en `firebase emulators:exec`, que intenta levantar
su propio emulador y choca con el que ya está en pie. Es el **mismo rojo de infraestructura**
reportado desde TASK-001. Se corrió `vitest -c vitest.integration.config.js` contra el emulador
levantado: misma config, mismo `globalSetup`, misma base. No es un rojo de esta tarea.

### Verde / rojo por invariante

| Invariante | Dónde | Resultado |
|---|---|---|
| SEED_PROYECTO_UNICO | `tests/unit/seed-emulator-barreras.test.js` | **VERDE** |
| SEED_PROYECTO_COINCIDE | `tests/unit/seed-emulator-barreras.test.js` | **VERDE** |
| SEED_BARRERA_EMULADOR | `tests/unit/seed-emulator-barreras.test.js` | **VERDE** |
| SEED_BARRIDO_ACOTADO | `tests/unit/seed-emulator-barrido.test.js` (31) | **VERDE** |
| SEED_LIMPIEZA_NO_AUTOMATICA | `tests/unit/seed-emulator-barrido.test.js` | **VERDE** |
| R20 (mutación por propiedad) | `tests/unit/seed-emulator-r20.test.js` (7) | **VERDE** |
| SEED_USUARIO_VISIBLE | `tests/integration/seed-emulator.test.js` | **VERDE** |
| SEED_IDEMPOTENTE | `tests/integration/seed-emulator.test.js` | **VERDE** |
| SEED_REPORTE_DEMO | `tests/integration/seed-emulator.test.js` | **VERDE** |
| SEED_LIMPIEZA_REAL | `tests/integration/seed-emulator.test.js` | **VERDE** |
| SEED_ERP_INTACTO | `tests/integration/seed-emulator.test.js` + REST fuera de vitest | **VERDE** |
| **SEED_REPORTE_FIEL** | `tests/integration/seed-emulator.test.js` | **ROJO (lógica)** |
| **SEED_SALIDA_LIMPIA** | `tests/integration/seed-emulator.test.js` | **ROJO (lógica)** |

Conteo: unitarios 150 = 41 anteriores + **109 de TASK-013** (barreras 71, barrido 31, R20 7).
Integración 118 = 101 anteriores + **17 de TASK-013**. Los "61 tests" del commit `ef0e0f6` eran
declaraciones `it`/`it.each` sin expandir; expandidos, TASK-013 aporta **126 tests**.

### 1. El barrido no alcanza `delfino-hogar-erp` por ninguna vía — VERDE

23 intentos hostiles, cada uno una corrida real del seed como proceso hijo contra un emulador
falso que anota cada pedido. Vías probadas: el namespace bueno como argumento suelto, como segundo
argumento, pegado con `=` y con `:`, con `--limpiar <bueno>`, con `--limpiar-delfino-hogar-erp`,
con una bandera `--proyecto` extra, en MAYÚSCULAS, capitalizado, con espacio adelante / atrás /
adentro, con salto de línea, con sufijos (`delfino-hogar-erp-x`, `delfino-x-hogar-erp`),
`demo-delfino-x`, travesía de rutas (`demo-delfino/../delfino-hogar-erp`), homoglifo cirílico en
"delfino", junto con `--reporte-demo`, **sin ningún argumento** (modo sembrar), y por las
variables `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` y tres más inventadas que suenan a
configuración (`NAMESPACE_BASURA`, `NAMESPACES_BORRABLES`, `SEED_PROYECTO`, `PROJECT_ID`,
`FIREBASE_PROJECT`). Los sufijos se probaron sobre la **bandera**, que es donde un parseo flojo se
rompe: `--limpiar-demo-delfino-x`, `--limpiar-demo-delfino-hogar-erp`,
`--limpiar-demo-delfino/../delfino-hogar-erp` y `--limpiar-demo-delfіno` con і cirílica.

Resultado literal, idéntico en 22 de los 23: **cero URLs emitidas mencionan `delfino-hogar-erp`**
(búsqueda por subcadena, insensible a mayúsculas); **todo `/projects/X` que aparece tiene
X = `demo-delfino`**; los únicos `DELETE` son exactamente
`DELETE /emulator/v1/projects/demo-delfino/databases/(default)/documents` y
`DELETE /emulator/v1/projects/demo-delfino/accounts`, y ninguno más.

El caso 23 —**sin ningún argumento, modo sembrar, con `GCLOUD_PROJECT=delfino-hogar-erp`**— se
verifica distinto **a propósito**: sembrar *sí* le habla a `delfino-hogar-erp`, que es exactamente
lo que tiene que hacer. Lo que no puede es borrar, y lo que se exige ahí es **cero `DELETE`**.
Cumplido. Lo mismo vale para `--reporte-demo`: cero `DELETE`, y `demo-delfino` queda como estaba.

El método vale porque el projectId viaja en la **ruta** de cada llamada REST: la lista de URLs *es*
el alcance, sin interpretación y sin borrar nada.

Candado interno verificado aparte: si `js/firebase-config.js` dijera `demo-delfino`, la limpieza
**aborta** en vez de borrar lo que el ERP mira.

### 2. `delfino-hogar-erp` antes y después — IDÉNTICO, byte a byte

Medido **fuera de vitest**, por REST, con el token `owner`, con un inventario completo: todas las
colecciones, todos los documentos con todos sus campos, `createTime` y `updateTime` de cada uno, y
los usuarios de Auth. Los tiempos van adentro a propósito: sin ellos, "no lo toqué" sería
indistinguible de "lo reescribí igual".

    ANTES   (previo a toda corrida)  sha256 f59a68ad31a0fb57826e2629bfa55931f441f9dc1ac2d1176b794cd84c031fce  19009 bytes
    DESPUES (tras la 1a integración) sha256 f59a68ad31a0fb57826e2629bfa55931f441f9dc1ac2d1176b794cd84c031fce  19009 bytes
    FINAL   (tras TODAS las corridas) sha256 f59a68ad31a0fb57826e2629bfa55931f441f9dc1ac2d1176b794cd84c031fce 19009 bytes

`cmp` byte a byte entre ANTES y FINAL: **idénticos**. Contenido en los tres puntos: 35 documentos
en 10 colecciones (categorias 1, clientes 1, contadores 3, cuentasContables 22, depositos 1,
listasPrecios 1, marcas 1, productos 3, sucursales 1, usuarios 1) y 1 usuario de Auth.

Entre ANTES y FINAL corrieron: 3 suites unitarias completas, 8 corridas del archivo de barrido,
3 suites de integración completas (que siembran, re-siembran, reportan y **borran**
`demo-delfino`), y el experimento del punto 4. El emulador quedó como se lo encontró:
`demo-delfino` en 0 documentos y 0 usuarios, y los namespaces efímeros `tester-task013-<uuid>`
borrados por el `afterAll`.

**Una cuarta lectura, de cierre, dio una única diferencia — y NO es de los tests.** Después de una
corrida más, `cmp` marcó un byte distinto, en la línea 881:

    -    "lastRefreshAt": "2026-09-05T03:49:04.087Z",
    +    "lastRefreshAt": "2026-09-05T04:44:04.109Z",

Los **35 documentos siguen idénticos**, campo por campo, con sus `createTime` y `updateTime`
intactos. Del usuario de Auth también quedan iguales `localId`, `email`, `lastLoginAt`
(`1788576843750`) y `validSince`. Lo único que se movió es `lastRefreshAt`, que es cuándo ese
usuario **renovó su token**, y las dos marcas están separadas por 55 minutos: es el refresco
horario de un cliente logueado, no una escritura.

Descartado que lo cause la medición: dos lecturas seguidas del inventario, sin correr ningún test
en el medio, dan archivos **idénticos**. Descartado que lo causen los tests: solo leen
`delfino-hogar-erp` por REST con el token `owner`, y el seed no puede sembrarlo desde esta sesión
(aborta, punto 3). **Para el director:** algo mantiene una sesión viva contra el emulador como
`admin@delfino.local` —lo más probable, una pestaña del ERP en localhost— y renueva el token cada
hora. No afectó nada de esta tarea, pero contradice la regla de "ninguna sesión de administrador
abierta mientras trabajen agentes" y conviene cerrarla.

### 3. `npm run seed` en una sesión de agente — aborta, y es lo correcto

    $ npm run seed
    proyecto del ERP        delfino-hogar-erp   (js/firebase-config.js)
    proyecto forzado        demo-delfino        (variable de entorno GOOGLE_CLOUD_PROJECT)
    ... exit 1

Nombra los dos valores, nombra la variable culpable, explica qué hacer en tres casos —incluido
"si sos un agente, esto es lo esperado"— y **no le manda ni un pedido al emulador**: la barrera
corre antes de tocar nada, verificado con el contador de pedidos del emulador falso en cero.

### 4. ROJO 1 — SEED_REPORTE_FIEL: el reporte de `demo-delfino` no es de `demo-delfino`

**Qué se esperaba:** leer un namespace del emulador al que nunca se le escribió devuelve 0
documentos, y por lo tanto `--reporte-demo` informa lo que hay en `demo-delfino` y nada más.

**Qué pasó:** el namespace virgen `sonda-nunca-escrita-7f2654ae` devolvió **35 documentos en 10
colecciones**, que son exactamente los de `delfino-hogar-erp`. `expected 35 to be +0`.

**Causa:** `firebase.json` declara `"singleProjectMode": true`. El emulador avisa por stderr
—`Multiple projectIds are not recommended in single project mode. Requested project ID
demo-delfino, but the emulator is configured for delfino-hogar-erp`— y sirve el dataset del
proyecto configurado a cualquier projectId al que todavía no se le haya escrito. Un `--import` de
`./emulator-data` deja el emulador exactamente en ese estado.

**Consecuencia real:** cada vez que se reinicia el emulador, `npm run seed -- --reporte-demo`
informa los 35 documentos y el perfil del admin del ERP **bajo el título `Namespace
"demo-delfino"`**, y `--limpiar-demo-delfino` imprime esa misma lista como preview de lo que va a
borrar. Es la misma confusión entre namespaces que originó R16, ahora en la herramienta que se
agregó para mitigarlo.

**Alcance medido — el defecto es de información, NO destructivo.** Verificado en un emulador
**descartable** (puertos 8085/9095, `firebase.json` propio, copia de `./emulator-data`, todo fuera
del repo; nunca contra el emulador de Gastón), con `demo-delfino` **virgen**:

    [1] delfino-hogar-erp ANTES  : 35 docs, 1 usuarios Auth
    [2] demo-delfino VIRGEN      : 35 docs   <- el alias
    [3] seed --limpiar-demo-delfino  (preview: lista los 35 documentos del ERP)
    [4] delfino-hogar-erp DESPUES: 35 docs, 1 usuarios Auth
    [5] demo-delfino DESPUES     : 0 docs, 0 usuarios
    VEREDICTO: el borrado NO alcanzo a delfino-hogar-erp (el alias es solo de LECTURA)

O sea: el `DELETE` del emulador sí está acotado al namespace de la URL. Lo que engaña es la
lectura. Queda en rojo porque el criterio de aceptación pide que el seed **reporte qué quedó
sembrado en `demo-delfino`**, y hoy ese reporte puede ser de otro namespace.

**Es de `scripts/seed-emulator.mjs`, no del test.** Arreglarlo es del implementador y sale de
`files:` de esta tarea. Una salida posible —no la decide el tester— es que el seed detecte el
alias antes de reportar o de borrar: escribir y borrar un documento centinela en `demo-delfino`
fuerza la creación del store real, y a partir de ahí lo que se lee es suyo.

### 5. ROJO 2 — SEED_SALIDA_LIMPIA: una corrida exitosa sale con código de error

**Qué se esperaba:** `--reporte-demo` hace su trabajo y el proceso sale con **0**.

**Qué pasó:** sale con **3221226505** (`0xC0000409`). `expected 3221226505 to be +0`. Reproducido
en las 3 corridas de integración de hoy, sobre las 12 de 12 ya medidas en la sesión anterior.

**Causa:** aserción de libuv `!(handle->flags & UV_HANDLE_CLOSING)` (`src\win\async.c`, línea 94)
al llamar `process.exit()` con sockets de `fetch` todavía cerrándose, en Node 24.19 sobre Windows.
Aparece cuando `demo-delfino` tiene contenido —o sea, cuando hubo pedidos de verdad—; con
`demo-delfino` vacío no aparece (0 de 15).

**Consecuencia real:** el reporte es correcto pero `npm run seed -- --reporte-demo` **se ve como
una falla**, y cualquier script o hook que mire el código de salida lo trata como error.

**Es del seed, no del entorno:** lo dispara el `process.exit()` explícito del script. El camino de
salida natural (dejar que el event loop se vacíe) no lo tiene. No se toca acá: es de
`scripts/seed-emulator.mjs`. Se distingue del rojo de infraestructura de `npm run test:integration`
en que este es determinista, reproducible y no depende de que ningún servicio esté caído.

Los dos modos que borran quedan cubiertos igual: el rojo determinista lo lleva `--reporte-demo`
(12 de 12). En `--limpiar-demo-delfino` el mismo defecto aparece 5 de 8 corridas, así que ese
assert acepta `0` o el código de aborto **a propósito**: un test que parpadea es peor que no
tenerlo, y el defecto ya está denunciado por el otro.

### 6. Un flake propio, encontrado y arreglado (es del tester, no del seed)

`seed-emulator-barrido.test.js > candados internos del barrido > si el emulador no vacia el
namespace, el seed lo denuncia en vez de decir que salio bien` fallaba **2 de cada 6 corridas**.
No era el seed: el test simulaba un emulador que ignora los `DELETE` reponiendo el estado desde
afuera con un `setInterval` de 5 ms, que es una carrera contra el re-inventario del seed. Si el
temporizador no llegaba a dispararse entre el borrado y la relectura, el seed veía el namespace
vacío, reportaba éxito, y el test caía.

Arreglado donde correspondía —en `tests/`, no en `scripts/`— haciéndolo determinista: se agregó el
gancho `despuesDeResponder(metodo, url, estado)` a `tests/herramientas/emulador-falso.mjs`, que
corre **dentro del mismo pedido**, después de calcular la respuesta y antes de mandarla. Ahora el
emulador falso acepta el `DELETE` con 200 y repone el estado en el mismo tick, sin carrera.
Medición: **8 de 8 corridas en verde** después del cambio, contra 4 de 6 antes. El test sigue
discriminando: sus rojos de antes son justamente la prueba de que detecta el caso que vigila.

### Tipo de rojo

**Los 2 rojos son por LÓGICA**, no por infraestructura: el emulador y Postgres respondieron en
todas las corridas, no faltó ninguna dependencia, y los dos rojos son deterministas y reproducibles
apuntando a defectos concretos de `scripts/seed-emulator.mjs`. El único rojo de infraestructura de
la sesión es el ya conocido `npm run test:integration` → "port taken", que no es de esta tarea.

**Criterios de TASK-013 no cubiertos por los tests:** ninguno de comportamiento. El último punto
del `accept` —marcar R16 como mitigado en `RISKS.md` con la fecha— es del implementador y ya está
hecho: `migration/RISKS.md:173` dice `## R16 — [MITIGADO 2026-09-04]`. Verificado por lectura, no
por test.
