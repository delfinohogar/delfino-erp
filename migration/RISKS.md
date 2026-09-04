# Riesgos

Escribe el auditor (más las entradas iniciales de la FASE -1 y las correcciones del director,
que quedan como base). Es una convención de trabajo, no una barrera técnica: ver R12.
Orden: severidad descendente.

Numeración: el 2026-09-04 se renumeró R12–R17 → R6–R11. El salto original de R5 a R12 suponía
seis riesgos previos que estaban en un documento que nunca llegó al repositorio: R6–R11 en su
sentido viejo nunca existieron. R18 tampoco: el commit 9d3c14e dice haberlo agregado y su diff
sobre este archivo agrega una sola cabecera, R17. Los identificadores actuales corren de R1 a
R16 sin huecos y son los definitivos: R1–R12 vienen de FASE -1 y FASE 0, R13–R15 los registró el
auditor en TASK-001 y R16 el director el 2026-09-04.

---

## R1 — [ALTA] La venta actual no es atómica
`js/ventas.js → crearVenta()` hace seis escrituras separadas: contador de ventas, una
transacción por ítem para descontar stock, `addDoc` de la venta, un `addDoc` por cobro,
contador de asientos y `addDoc` del asiento. Si el navegador se cierra o falla cualquier paso
intermedio, Firestore queda con stock descontado sin venta, o venta sin asiento, o asiento sin
cobro. Lo mismo aplica a `js/compras.js`.

Consecuencia para la migración: las invariantes FALLO_INTERMEDIO y CONCURRENCIA **van a fallar**
contra el adaptador Firestore. Eso es esperado y se marca como `known-failing`: no es una
regresión, es la razón de la migración. Prohibido "corregir" el backend Postgres para replicar
este comportamiento.

Consecuencia para el shadow: pueden aparecer diferencias de reconciliación causadas por
operaciones parciales ya existentes en Firestore. Se clasifican como tipo B (Firestore
inconsistente) y se documentan; no se arreglan desde Postgres.

## R2 — [ALTA, mitigada en FASE -1] El entorno local apuntaba a producción
`js/firebase-config.js` apunta al proyecto `delfino-hogar-erp` y `js/firebase.js` no tenía
wiring de emuladores. Cualquiera que sirviera el ERP en localhost operaba sobre datos reales.
Mitigado en FASE -1: localhost va siempre a emuladores, sin flag de escape.

## R3 — [MEDIA, mitigada en FASE -1] Netlify podía publicar ramas de migración
Un branch deploy o deploy preview de `migration/postgresql` publicaría un frontend conectado a
Firestore de producción en una URL pública. Mitigado por doble vía: configuración del sitio en
Netlify y contextos en `netlify.toml` que hacen fallar esos builds.

## R4 — [MEDIA] `git config core.hooksPath` es configuración local
Se pierde en cada clon nuevo del repositorio. Si Gastón clona el repo en otra máquina y no lo
vuelve a correr, las barreras de push y de commit no están activas. La protección de rama en
GitHub sigue vigente y es la que realmente protege `master`.

## R5 — [BAJA] Las Cloud Functions no se emulan
Mercado Pago, ARCA y las funciones de IA no funcionan en el entorno local de FASE -1. Ninguna
interviene en la PoC (clientes, productos, venta). Si hiciera falta, se agrega el emulador de
Functions con un `.secret.local` de valores inventados.

## R6 — [ALTA] Sesión de administrador abierta en el navegador
Una sesión autenticada del ERP en el navegador saltea TODAS las barreras técnicas: protección
de rama, reglas de deny de Claude Code, filtro de publicación. Desde ahí se escribe directo en
Firestore de producción con permisos de administrador, y las Firestore Rules no lo impiden
porque el usuario es legítimo.
Descubierto el 2026-09-04: había una sesión de delfinohogar@gmail.com abierta en el navegador
que usaban las pruebas automatizadas. Se cerró y se verificó.
Mitigación obligatoria: ninguna sesión de admin abierta mientras trabajen agentes.

## R7 — [RESUELTO 2026-09-04] Código fuente público en Netlify
`netlify.toml` tenía `publish = "."`, que sube el directorio de trabajo completo. Un
`.netlifyignore` presente en el repo NO tenía ningún efecto: Netlify nunca lee ese archivo, y
dejó de aplicar `.gitignore` al publish en 2020. Estuvieron públicos `functions/index.js`
(incluida la integración ARCA y Mercado Pago), `firestore.rules`, `firebase.json`,
`firestore.indexes.json`, `dev-server.py`, `build.js` y todo el código fuente de las pantallas.
Sin credenciales expuestas (viven en Secret Manager), pero sí la lógica de negocio y la
estructura exacta de las reglas de seguridad.
Resuelto con `build.js` armando una carpeta `publicar/` curada (lista de permitidos) y
`publish = "publicar"`. Verificado: las 9 rutas dan 404 y el control positivo da 200.

## R8 — [MEDIA] ARCA WSFEv1 completo y apagado; qué está desplegado es DESCONOCIDO
El commit 902ef3c agregó la integración fiscal con ARCA (WSFEv1): determinación de tipo de
comprobante, cálculo de IVA y solicitud de CAE. Queda inactiva por `arcaActivo = false` y sin
UI para activarla. Existe código de facturación fiscal real a un flag de distancia. Activar
ARCA es Nivel 3 explícito y requiere revisión previa completa.

Qué está efectivamente desplegado NO se sabe, y no se puede saber leyendo el repositorio.
`functions/index.js:49` **exporta** `arcaAutorizarComprobante`, pero exportada no es lo mismo
que desplegada: los deploys se hacen con `firebase deploy --only <función>` —hoy solo
`gbpSincronizarFacturas`— así que cada función puede estar o no en Firebase según lo que se
haya desplegado en sesiones anteriores.

Una versión previa de este riesgo afirmaba que el backend (`functions/arcaFacturacion.js`,
`arcaWsfe.js`) NO estaba desplegado. Esa afirmación no tenía respaldo verificable y se retira.

PENDIENTE DE VERIFICACIÓN: el inventario de Cloud Functions realmente desplegadas se consulta
en Firebase Console. Lo hace Gastón; ningún agente toca producción. Hasta entonces, el estado
de `arcaAutorizarComprobante` se asume DESCONOCIDO y se planifica como si pudiera existir.

## R9 — [MEDIA] Líneas de GBP sin artículo, con importe
De 2.181 líneas en `facturasGbp`, 117 llegan sin `item_id`. De esas, 8 tienen precio real (una
de $1.404.958) y `costoUnitario: 0`, por lo que contaban como margen puro: inflaban el margen
bruto en $2.155.983 sobre el período completo. El filtro las excluye del detalle; el total de
la factura las sigue incluyendo. Queda como cuestión abierta: son ventas reales sin artículo
asociado que no figuran en ningún reporte por producto.
Distinto de las 497 líneas con `item_id` válido pero sin producto catalogado en Delfino: esas
son ventas legítimas de artículos no importados todavía y NO se filtran (decisión de Gastón,
2026-09-03).

## R10 — [BAJA] Contadores fuera de transacción queman números
`js/ventas.js` incrementa `contadores/ventas` en una transacción propia antes de escribir la
venta. Una venta que falla después deja un hueco en la numeración. En el diseño PostgreSQL el
contador vive dentro de la misma transacción y hace rollback — verificado empíricamente.

## R11 — [BAJA] Órdenes de Tiendanube durante la reconciliación shadow
Un pedido de Tiendanube que entre durante la ventana de reconciliación aparece como diferencia,
porque la PoC corre en local y no lo ve. No es un error: se excluyen esas órdenes del alcance
de comparación o se marcan como diferencia esperada.

## R12 — [MEDIA] Los guards de rol no aplican fuera de las sesiones con `--agent`
Las notas "Escribe solo el director" en los archivos de `migration/` son convención de texto, no
barrera técnica. El hook `guard.ps1` vive en el frontmatter de las definiciones de agente y solo
corre cuando la sesión arranca con `claude --agent <rol>`. Una sesión normal escribe esos
archivos sin ningún control. Verificado el 2026-09-04.

## R13 — [BAJA] El guard de loopback de `pool.js` es una baranda, no una barrera
`backend/src/db/pool.js:52-68` corta si la URL de PostgreSQL apunta a un host que no sea
loopback, con escape `DELFINO_DB_REMOTO_OK=1`. Es alcance no pedido por TASK-001, aceptado por
el auditor el 2026-09-04 porque va en la dirección de las reglas del proyecto. Sus límites:
el escape viaja por el mismo canal que `DATABASE_URL`, así que quien puede apuntar a un host
remoto también puede desactivar el guard; falla abierto con una URL no parseable (`catch` que
devuelve sin chequear) y con host vacío (`postgres:///base`), caso en el que `pg` cae en
`PGHOST`. Verificado que el primer caso no llega a ningún host remoto: `pg-connection-string`
no interpreta el formato `key=value` y la conexión falla. Ningún test cubre la rama del escape.
No es defensa contra un atacante; sirve contra el error de configuración, que es para lo que
está.

## R14 — [BAJA] Un flag mal tipeado del migrador cae en el modo que aplica
`backend/src/db/migrar.js:131-132` decide el modo con `argv.includes()` y no valida los
argumentos desconocidos. `node backend/src/db/migrar.js --estad` no informa: aplica las
migraciones de verdad. En la dirección peligrosa el riesgo es nulo (`--marcar-aplicada`, mal
escrito, aplica en vez de marcar), pero un typo en `--estado` ejecuta SQL que el operador creía
estar solo consultando. Además `--estado` sí crea la tabla `schema_migrations` si no existe
(`migrar.js:140`), mientras `backend/README.md:65` dice "informa, no escribe esquema".

**CORRECCIÓN PENDIENTE — TASK-012**, decidido por Gastón el 2026-09-04. No se acepta como riesgo
residual: que un flag mal tipeado ejecute SQL cuando el operador creía estar solo consultando es
el tipo de cosa que muerde un domingo. Se cierra validando los argumentos desconocidos y
alineando README y código sobre si `--estado` crea la tabla.

## R15 — [BAJA] Dos aserciones de los tests de TASK-001 podrían pasar de forma vacua
`tests/unit/backend-higiene.test.js:63-85` parchea `listen()` y después importa `pool.js` y
`migrar.js`: si el registro de módulos de Vitest ya los tuviera cacheados, el cuerpo no se
reejecuta y el conteo daría 0 sin probar nada. La propiedad igual está cubierta de verdad por
el bloque de proceso hijo limpio (líneas 88-123), que es el que manda.
`tests/integration/postgres/migrador.test.js:358-361` cuenta locks advisory no otorgados sin
filtrar por la clave 5150419, así que otro lock advisory del cluster lo satisfaría; las
aserciones vecinas (no existe `schema_migrations` mientras espera, existe después de liberar)
son las que sostienen el caso.

## R16 — [MEDIA] El seed siembra en `demo-delfino` mientras el emulador corre en `delfino-hogar-erp`
`scripts/seed-emulator.mjs:28` inicializa el Admin SDK con
`projectId: process.env.GCLOUD_PROJECT || "demo-delfino"`, pero `npm run emulators` y
`npm run test:integration` corren con `--project delfino-hogar-erp` (`package.json:9-10`) y
`js/firebase-config.js` declara ese mismo `projectId`. Si `GCLOUD_PROJECT` no está seteada —el
caso por defecto en un clon limpio— el seed escribe usuarios y datos en el namespace
`demo-delfino`, que el ERP y los tests **nunca miran**.

**No es hipotético: ya ocurrió.** Gastón lo reportó el 2026-09-04: el login local falló porque no
encontraba el perfil del usuario. El usuario existía, pero en otro proyecto. El síntoma es
especialmente engañoso porque el seed termina con éxito y no advierte nada.

Severidad MEDIA y no BAJA porque falla en silencio, el modo de falla apunta al lugar equivocado
—parece un problema de Auth o de reglas, no de configuración del seed— y afecta a cualquiera que
clone el repo y siga INSTALAR.md.

**CORRECCIÓN PENDIENTE — TASK-013.** El default tiene que ser `delfino-hogar-erp`, o el seed debe
abortar con un mensaje claro si el proyecto que usa no coincide con el del emulador.
