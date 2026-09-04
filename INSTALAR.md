# FASE -1 — paquete rearmado contra el master actual (3645896)

**Nada aplicado. Nada ejecutado.** Este ZIP se descomprime sobre la raíz del repo, en la rama
`migration/postgresql`.

Reemplaza por completo al paquete anterior, que estaba hecho contra un master sin bundling y
habría pisado tu `package.json`.

## Qué cambia respecto del master actual

### Archivos que se MODIFICAN (3)

**`package.json`** — se agregan scripts y devDependencies. **Se conservan intactos**
`"build": "node build.js"`, `esbuild ^0.24.2` y la description. Verificado con assert.
Nuevos scripts: `test`, `test:watch`, `test:integration`, `emulators`, `seed`, `db:up`,
`db:down`, `check`. Nuevas devDependencies: `vitest`, `firebase@10.13.0`, `firebase-admin`, `pg`.

**`.gitignore`** — se AGREGAN 22 líneas al final. No se toca nada de lo que ya tenés
(`.netlify`, `functions/node_modules`, `node_modules`, `dist`, `publicar` quedan igual).
Lo que se suma: `emulator-data/`, logs de Firebase, `coverage/`, `.claude/settings.local.json`,
`.claude/worktrees/`, y el bloque de credenciales (`.env*`, `.firebaserc`, `serviceAccount*.json`,
`*.pem`, `*.key`, `*.p12`).

**`js/firebase.js`** — 24 líneas agregadas, cero borradas: wiring de emuladores cuando el
hostname es localhost. Ver la nota de abajo, importante por el bundling.

### `netlify.toml` NO se toca

Con `publish = "publicar"` ya resuelto, todo lo que agrega esta fase (`migration/`, `backend/`,
`tests/`, `scripts/`, `.claude/`, `.githooks/`, `emulator-data/`) queda fuera del sitio público
por defecto, porque `publicar/` es lista de permitidos. La versión anterior de este paquete
agregaba bloques `[context.*]`; ya no hacen falta y se sacaron.

### `.netlifyignore`

Si todavía existe en el repo, **borralo**. Está comprobado que Netlify no lo lee y da una
sensación falsa de protección. Lo real es `publicar/`.

### Archivos NUEVOS (36)

`.claude/settings.json` · `.claude/agents/{director,implementador,tester,auditor}.md` ·
`.claude/hooks/{guard,task-completed}.ps1` · `.githooks/{pre-push,pre-commit}` ·
`.github/workflows/checks.yml` · `CLAUDE.md` ·
`backend/{docker-compose.yml,.env.example,README.md}` · `backend/db/init/01_bases.sql` ·
`backend/db/migrations/{0001_esquema_poc,0002_venta_servicio}.sql` ·
`scripts/{seed-emulator,safety-prod-denied,check-sintaxis}.mjs` ·
`tests/unit/{facturacion,contabilidad}.test.js` ·
`tests/integration/{setup.mjs,safety.test.js}` ·
`tests/integration/postgres/{_helpers.mjs,invariantes.test.js}` ·
`vitest.config.js` · `vitest.integration.config.js` ·
`migration/*.md` + `migration/approvals/`

## Adaptaciones específicas al bundling

1. **El wiring de emuladores solo tiene efecto después de `npm run build`.** Las páginas cargan
   desde `dist/`, no desde `js/`. Si probás en localhost sin rebuildear, seguís con el bundle
   viejo apuntando a producción. Está documentado en `CLAUDE.md`.
2. **`scripts/check-sintaxis.mjs` excluye `dist/`, `publicar/`, `tests/` y `scripts/`.** Solo
   chequea el código fuente de la app.
3. **`vitest.config.js` excluye `dist/` y `publicar/`** para no testear bundles.
4. **El alias CDN→npm sigue funcionando** porque `build.js` deja el SDK de Firebase fuera del
   bundle a propósito. Verificado con 7 tests en verde contra `js/facturacion.js` y
   `js/contabilidad.js`.
5. **`settings.json` protege lo nuevo**: `build.js`, `publicar/**` y `dist/**` en deny, más
   `netlify deploy` explícito. `npm run build` queda en `ask`, no en `allow`.
6. **CI usa Node 24**, para igualar tu máquina.

## Qué se verificó, y qué no

Verificado ejecutándolo: el `package.json` fusionado preserva build/esbuild/description
(assert); los tres configs pasan chequeo de sintaxis; el workflow es YAML válido y no usa
secretos; el esquema SQL levanta en PostgreSQL 16.15 y los 21 tests de invariantes pasan;
los git hooks bloquean los 5 escenarios de push y el commit con `.env`.

**No verificado**: la ejecución real de los `.ps1` (no hay PowerShell en el sandbox) y que el
alias de vitest siga funcionando contra el `js/` actual, que cambió con el bundling. Eso se
comprueba con `npm test` en el paso 6 de abajo.

## Orden de aplicación

1. `git checkout master && git pull` (confirmá que estás en `3645896` o posterior)
2. `git checkout -b migration/postgresql`
3. Descomprimir este ZIP en la raíz, sobrescribiendo
4. Borrar `.netlifyignore` si existe
5. `git config core.hooksPath .githooks` · `copy backend\.env.example backend\.env`
6. `npm install` · `npm run check` · `npm test` → tienen que dar verde
7. `npm run build` → tiene que seguir andando igual que antes
8. `git add -A && git commit -m "FASE -1: aislamiento del entorno de desarrollo"`
9. `git push` → **tiene que ser rechazado por el hook**
10. `$env:DELFINO_PUSH_OK=1; git push -u origin migration/postgresql`

Si el paso 6 o el 7 fallan, **pará** y avisá antes de seguir.
