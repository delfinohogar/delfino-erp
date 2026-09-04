# Delfino ERP

ERP de Delfino Hogar (San Francisco Solano, Quilmes). Frontend JavaScript vanilla con módulos
ES, empaquetado con esbuild (`build.js`). Firestore como base. Cloud Functions en `functions/`
(padrón ARCA, ARCA WSFEv1 **apagado**, Mercado Pago en modo TEST, sincronización con GBP, IA).
Deploy estático en Netlify por CLI.

No hay backend para las operaciones de negocio: la lógica de venta, stock, cobros y asientos
vive en `js/*.js` y escribe directo en Firestore desde el navegador.

## Build y deploy

`npm run build` arma los bundles y la carpeta `publicar/`, que es **lista de permitidos**: solo
contiene HTML, `css/`, `dist/` y `js/vendor/xlsx.full.min.js`. Todo lo demás queda fuera del
sitio público. Si agregás una carpeta al repo, no se publica salvo que `build.js` la copie
explícitamente. Eso es a propósito.

`netlify.toml` tiene `publish = "publicar"`. Correr `npm run build` antes de cada
`netlify deploy --prod`, siempre.

## Entorno de desarrollo (FASE -1)

**El ERP servido desde localhost va SIEMPRE a los emuladores de Firebase.** No hay flag para
saltearlo. Si el emulador no está corriendo, el ERP falla al conectar — es intencional: nunca
cae de vuelta a producción.

**Importante por el bundling:** las páginas cargan desde `dist/`, así que el wiring de
emuladores en `js/firebase.js` **solo tiene efecto después de `npm run build`**. Si probás en
local sin rebuildear, seguís usando el bundle viejo.

    npm run db:up          # Postgres local en 127.0.0.1:5432
    npm run emulators      # Firestore 8080, Auth 9099, UI 4000
    npm run seed           # datos mínimos en el emulador
    npm run build          # OBLIGATORIO antes de probar en localhost
    npm test               # tests unitarios (sin red)
    npm run test:integration
    npm run check          # chequeo de sintaxis de los módulos fuente

Login de desarrollo: `admin@delfino.local` / `delfino-dev`.

## Proyecto de migración a PostgreSQL (rama `migration/postgresql`)

Estado y decisiones en `migration/`. Leé `MIGRATION_STATUS.md`, `TASKS.md` y `DECISIONS.md`
antes de trabajar en cualquier tarea de migración.

### Reglas para TODOS los agentes, sin excepción

- Rama de trabajo: `migration/postgresql` y ramas `task/TASK-NNN`. `master` es intocable.
- Nadie hace push, remote, tag, deploy, netlify, gcloud ni firebase (salvo `emulators`).
  El push y el deploy los hace Gastón a mano.
- Nadie ejecuta `dev-server.py` ni abre el ERP contra producción.
- **Ninguna sesión de administrador abierta en el navegador mientras trabajen agentes.** Una
  sesión autenticada saltea todas las barreras: escribe en Firestore de producción con
  permisos de admin y las reglas no lo impiden.
- Firestore de producción permanece intacto.
- `functions/` es producción desplegada: no se toca. El backend nuevo va en `backend/`.
- `js/firebase.js`, `js/firebase-config.js`, `build.js`, `.claude/`, `.github/`, `.githooks/`,
  `firestore.rules`, `firebase.json` y `netlify.toml` solo los modifica Gastón.
- `publicar/` y `dist/` son salida de build: nadie los edita a mano.
- Ningún agente aprueba su propio trabajo. Solo el auditor escribe `migration/approvals/`.
- Un commit por tarea, mensaje `TASK-NNN: …`.
- Decisión comercial, contable, fiscal, de producción o irreversible: no la tomes. Anotala en
  tu log como `BLOQUEADO NIVEL 3` y devolvela al director.

## Convenciones del código existente

- Dinero: `Math.round(x * 100) / 100`.
- Fechas: ventas, compras y `facturasGbp` usan string `"YYYY-MM-DD"`; cobros y pagos usan
  `Date`. Inconsistencia conocida, normalizada en `contabilidad.js → normalizarFecha`.
- Contadores: `contadores/{ventas|asientos|comprobantes}`, campo `ultimo`. Se incrementan en
  transacción propia, así que una venta fallida quema el número.
- Asientos: `movimientos: [{cuenta, debe, haber}]`, validados Debe = Haber antes de escribir.
- El IVA en ventas está preparado pero calculado en $0.
- Reportes: `ventasUnificadasEnRango` mezcla `/ventas` con `facturasGbp` sincronizadas.
  `reportePosicionIva` queda deliberadamente afuera (evita doble conteo fiscal).
