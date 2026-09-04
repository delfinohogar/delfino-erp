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
