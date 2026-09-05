# Riesgos

Escribe el auditor (más las entradas iniciales de la FASE -1 y las correcciones del director,
que quedan como base). Es una convención de trabajo, no una barrera técnica: ver R12.
Orden: severidad descendente.

Numeración: el 2026-09-04 se renumeró R12–R17 → R6–R11. El salto original de R5 a R12 suponía
seis riesgos previos que estaban en un documento que nunca llegó al repositorio: R6–R11 en su
sentido viejo nunca existieron. R18 tampoco: el commit 9d3c14e dice haberlo agregado y su diff
sobre este archivo agrega una sola cabecera, R17. Los identificadores actuales corren de R1 a
R31 sin huecos y son los definitivos: R1–R12 vienen de FASE -1 y FASE 0, R13–R15 los registró el
auditor en TASK-001, R16 el director, R17-R19 el auditor en TASK-011, R20 el director, R21-R22 el
auditor en la confirmación de TASK-011, R23-R25 el auditor en la aprobación de TASK-002, y
R26-R27 el director con datos de Gastón, R28 el director en TASK-003 y R29-R31 el auditor en la
aprobación de TASK-003, todos el 2026-09-04. R21 en adelante se agregan al final por orden de
registro, no por severidad.

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

## R8 — [MEDIA] ARCA WSFEv1 completo y apagado; desplegado en homologación desde 2026-09-04
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

**RESUELTO el 2026-09-04 por Gastón.** Verificó la lista completa de Cloud Functions en Firebase
Console: `arcaAutorizarComprobante` **no estaba desplegada** — las 25 que había no la incluían.
La duda queda cerrada con un dato, no con una suposición, y la versión retirada más arriba
resultó ser correcta en el fondo aunque no tuviera respaldo en su momento.

Estado real al 2026-09-04, informado por Gastón:
- Certificado de homologación obtenido por WSASS, alias `DelfinoERP`, CUIT del certificado
  20107859951.
- Autorización creada para el servicio `ws://wsfe`, CUIT representado 33712451039.
- `AFIP_CERT_HOMO`, `AFIP_KEY_HOMO` y `AFIP_CUIT_HOMO` cargados en Secret Manager con valores
  reales.
- `arcaAutorizarComprobante` **ahora sí desplegada**, en `southamerica-east1`. Las funciones
  desplegadas pasan de 25 a 26.
- **`arcaActivo` sigue en `false`. No se tocó.**

Lo que cambia y lo que no: ya no hay incertidumbre sobre qué está desplegado, así que el riesgo
deja de ser "no sabemos". Lo que **no** cambia es que sigue existiendo código de facturación
fiscal real a un flag de distancia, ahora con credenciales de homologación cargadas y la función
en línea. Activar ARCA sigue siendo **Nivel 3 explícito**, y `arcaActivo` no lo toca ningún
agente. El ambiente `produccion` no se usa nunca.

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

## R14 — [MITIGADO 2026-09-05] Un flag mal tipeado del migrador cae en el modo que aplica

**ESTADO: MITIGADO — 2026-09-05, TASK-012, verificado contra Postgres local.**
`migrar.js` valida los argumentos en `interpretarArgumentos()` **antes de crear el pool**: un
argumento que no este en `FLAGS_VALIDOS` aborta con exit 1, lista los flags validos y no abre
conexion. Verificado en base limpia con todo pendiente: `node backend/src/db/migrar.js --estad`
sale 1 y deja la base con **0 tablas** —ni siquiera `schema_migrations`—. Probado igual con
`--marcar-aplicada`, `--estado=1`, `-e`, `--ayuda` y un argumento posicional suelto. `--estado` y
`--marcar-aplicadas` juntos tambien abortan. `--marcar-aplicadas` sigue exigiendo el string
exacto y no tiene abreviatura.

La contradiccion del README se resolvio **del lado de la documentacion**, no del codigo:
`--estado` sigue creando las tablas de control con `create table if not exists` y las deja
vacias, y `backend/README.md` ahora lo dice textualmente en "Que escribe cada modo". Se eligio
asi porque `tests/integration/postgres/migrador.test.js:485` consulta `schema_migrations`
despues de `--estado` sobre una base limpia y espera 0 filas: si el flag dejara de crear la
tabla, esa consulta fallaria y el test —que es del tester, no del implementador— se pondria
rojo. Crear una tabla de control vacia no es aplicar esquema de la aplicacion, que es lo que el
riesgo pedia evitar; los 18 tests del migrador de TASK-001 siguen en verde sin tocarlos.

Texto original del riesgo:

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

## R16 — [MITIGADO 2026-09-04] El seed siembra en `demo-delfino` mientras el emulador corre en `delfino-hogar-erp`

**ESTADO: MITIGADO — 2026-09-04, TASK-013, verificado contra los emuladores por REST.**
El proyecto ya no está escrito dos veces: `scripts/seed-emulator.mjs` lo lee de
`js/firebase-config.js`, que es lo que el ERP realmente usa, y si ese archivo dejara de declarar
exactamente un `projectId` el seed **aborta** en vez de adivinar. El default pasó de
`demo-delfino` a `delfino-hogar-erp` por esa vía, no por una constante nueva que pueda volver a
divergir. Si `GCLOUD_PROJECT` o `GOOGLE_CLOUD_PROJECT` fuerzan otro proyecto, el seed aborta con
exit 1 nombrando **los dos valores** y qué hacer en cada caso. Las barreras de emulador local no
se tocaron y siguen corriendo antes que el chequeo de proyecto.

Se mitiga y no se elimina porque la clase de falla —el emulador crea cualquier namespace al
vuelo y no hay API que diga cuál corre— sigue existiendo: lo que se eliminó es que ocurra en
silencio.

Verificado el 2026-09-04: `npm run seed` con las variables de agente aborta con exit 1;
con `GCLOUD_PROJECT=delfino-hogar-erp` siembra y deja `admin@delfino.local` (uid
`HfH7fg2RWwLBI6Lacotphm3rM1H9`) con login 200 contra el emulador de Auth y su perfil
`usuarios/{uid}` con `rol: administrador` en `delfino-hogar-erp`, leído por REST; dos corridas
seguidas dejan el inventario byte a byte igual; sin las variables de emulador sigue abortando.

**El agente que corra `npm run seed` va a ver un aborto, y eso es correcto, no un bug.**
`.claude/settings.json:8-9` fija `GCLOUD_PROJECT=demo-delfino` a propósito (decisión de Gastón
del 2026-09-04): los agentes no siembran el namespace real. El mensaje de aborto lo dice.

**Limpieza de `demo-delfino`: HECHA el 2026-09-04.** El script incorporó dos modos explícitos,
`--reporte-demo` y `--limpiar-demo-delfino`, que nunca se disparan al sembrar. El namespace va
fijo en el código y validado contra una lista de permitidos de un solo elemento, con un chequeo
extra de que no coincide con el proyecto del ERP; el borrado usa los endpoints `/emulator/v1/`
—que no existen fuera de un emulador— con el proyecto en la URL, así que su alcance no depende de
ninguna variable de entorno. Imprime lo que va a borrar antes de borrarlo. Resultado medido por
REST: `demo-delfino` pasó de 10 colecciones / 35 docs a **0 colecciones / 0 docs**, y
`delfino-hogar-erp` quedó **idéntico** al inventario previo (10 colecciones, 35 docs, 1 usuario de
Auth), comparado byte a byte antes y después. Segunda corrida: "Nada que borrar". Queda un flanco
conocido, no del script: el emulador se levanta con `--import ./emulator-data`, así que si ese
export todavía contiene `demo-delfino`, el namespace reaparece en el próximo arranque hasta que
se re-exporte. `emulator-data/` no es de esta tarea.

Lo que sigue es el registro original del riesgo, que se conserva porque explica el modo de falla:

`scripts/seed-emulator.mjs:28` inicializaba el Admin SDK con
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

**SIGUE VIVO — 2026-09-04. TASK-013 no pudo corregirlo: el implementador no tiene permiso de
escritura sobre el único archivo de la tarea.** `.claude/settings.json:88` lista
`"Edit(scripts/seed-emulator.mjs)"` en `deny`, y una regla `deny` no se levanta pidiendo permiso.
El archivo quedó tal cual, con el default `"demo-delfino"` intacto. Solo Gastón puede tocar
`.claude/`.

**Segundo vector, descubierto al intentar la corrección: el default del script no es la única
causa.** `.claude/settings.json:8-9` define `GCLOUD_PROJECT=demo-delfino` y
`GOOGLE_CLOUD_PROJECT=demo-delfino` para **toda sesión de agente**. El Admin SDK obedece esas
variables, así que aunque el default del script pase a `delfino-hogar-erp`, cualquier agente que
corra `npm run seed` sigue sembrando en `demo-delfino`. Corregir el script sin corregir esas dos
variables convierte el bug silencioso en un aborto ruidoso —una mejora— pero deja a los agentes
sin poder sembrar. Las dos correcciones van juntas.

Inventario del daño acumulado, medido por REST contra los emuladores el 2026-09-04 (token
`owner`, canal independiente del Admin SDK):

    delfino-hogar-erp   Auth: 1 usuario, admin@delfino.local, uid HfH7fg2RWwLBI6Lacotphm3rM1H9
                        Firestore: 10 colecciones, 35 docs
    demo-delfino        Auth: 0 usuarios
                        Firestore: 10 colecciones, 35 docs — el mismo set exacto, incluido
                        usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9

~~El perfil `usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9` está duplicado en los dos namespaces~~ —
**AFIRMACIÓN RETIRADA el 2026-09-05, ver R35.** No había ningún duplicado: `singleProjectMode`
hacía que el emulador espejara a `demo-delfino` los documentos importados de `delfino-hogar-erp`.
El auditor lo confirmó con tres pruebas independientes: el export importado tiene 35 apariciones
de `delfino-hogar-erp` y **cero** de `demo-delfino`; el perfil "duplicado" tenía el **mismo uid**,
cuando un sembrado real habría creado otro; y 35 documentos con **cero** usuarios de Auth es un
estado que el seed no puede producir.

Lo que sí es cierto y no se toca: el usuario de Auth existe una sola vez, en `delfino-hogar-erp`
—Auth **no** espeja—, y **el bug de R16 es real**, verificado por otras vías y confirmado por
Gastón, que recuperó el login. Lo que se retira es **una evidencia**, no la conclusión.

Es el segundo caso en este proyecto —después de R8— en que una afirmación cómoda no resiste al
verificarla. Se retira en vez de dejarla, porque una evidencia falsa dentro de un riesgo real es
peor que ninguna: se cita después sin volver a mirarla.

La limpieza de `demo-delfino` que autorizó Gastón el 2026-09-04 está **hecha** (TASK-013).

(Fin del registro original. Los dos bloqueos de arriba están resueltos: Gastón levantó el `deny`
y TASK-013 se implementó el 2026-09-04; la limpieza está hecha. Ver el encabezado del riesgo.)

## R17 — [ELIMINADO 2026-09-04] `afterAll` de `safety.test.js` puede borrar el perfil del admin de desarrollo

**ESTADO: ELIMINADO (no mitigado) — 2026-09-04, verificado contra el emulador.**
`tests/integration/safety.test.js` ya no toma prestado ningún usuario del entorno: crea el suyo
(`safety-<uuid>@test.local`) y borra exclusivamente lo que creó esa corrida. No queda ninguna
rama que pueda borrar un perfil ajeno, porque no hay estado previo que restaurar. Demostrado con
las cuatro inyecciones de "falla a la mitad" del `beforeAll` (antes de `createUser`, justo
después, después de escribir el perfil y después del `signIn`): en las cuatro, la cuenta de
desarrollo siguió existiendo, su perfil conservó `rol: administrador`, el login documentado
respondió **200** contra el emulador de Auth con el mismo uid, y no quedó ningún
`clientes/safety-check-*`. Evidencia completa en `migration/TEST_RESULTS.md` (TASK-011,
corrección 2026-09-04). Se descarta el flag `perfilLeido`: mitigaba la ventana, no la clase.

Texto histórico del riesgo, para trazabilidad:

`tests/integration/safety.test.js:88-93` asigna `uid = usuario.uid` **antes** de leer
`existiaPerfil = snapPerfil.exists`. Si algo lanza en esa ventana de una sola sentencia (el
`refPerfil.get()`), `afterAll` corre con `uid` seteado y `existiaPerfil = false`, y toma la rama
`else await dbAdmin.collection("usuarios").doc(uid).delete()` (línea 121): **borra** el perfil que
nunca llegó a leer.

Verificado por inyección el 2026-09-04 (auditoría de TASK-011): con un `throw` inyectado justo
después de `uid = usuario.uid`, el documento `usuarios/HfH7fg2RWwLBI6Lacotphm3rM1H9` quedó en 404
en el emulador. Se restauró a mano.

Severidad BAJA: la ventana exige que el `get()` falle y el `delete()` posterior funcione, y el
efecto es sobre el emulador, nunca sobre Firestore de producción. Pero la recuperación está rota
mientras viva R16 (`npm run seed` puede resembrar en otro namespace), así que el síntoma sería
"el login local dejó de andar" sin causa aparente. Se cierra con un flag `perfilLeido` que sólo
habilite la restauración cuando el estado previo se conoce de verdad. En el camino de falla
normal (un `it` en rojo) la restauración sí es correcta: verificado.

**VÍA ELEGIDA: ELIMINAR DE RAÍZ, NO MITIGAR (2026-09-04, decisión de Gastón, auditor de acuerdo).**
Queda descartado el cierre por flag `perfilLeido` que proponía el párrafo anterior: mitiga la
ventana, no elimina la clase de defecto. La causa real es que el test toma prestado un recurso
compartido y mutable del entorno —el usuario `admin@delfino.local`— y después tiene que
devolverlo. La corrección es que no lo tome: el test crea su propio usuario efímero
`safety-<uuid>@test.local` con perfil de rol mínimo, lo usa y lo borra. Sin estado previo no hay
restauración, y una restauración que no existe no puede fallar a la mitad. R17 desaparece; no se
mitiga.

Verificado que la vía es viable: `firestore.rules:29` (`puedeVender()`) sólo mira
`/usuarios/{uid}.rol`; no hay custom claims ni allowlist de correos, así que un uid efímero pasa
exactamente la misma regla por el mismo camino, y ningún poder probatorio del test depende de qué
principal esté autenticado.

**BLOQUEANTE para cerrar TASK-011** (no tarea aparte): TASK-012 y TASK-013 dependen de TASK-011 y
se verifican corriendo la suite de integración una y otra vez, así que diferirlo significa ejecutar
el test defectuoso justo en la ventana en que más se corre. Criterios de verificación en
`migration/approvals/TASK-011.approved`, sección ADDENDUM 2026-09-04. Riesgo nuevo a controlar
allí: usuarios huérfanos si el proceso muere sin `afterAll` (acotado por un barrido al inicio;
`emulators:exec` no exporta al salir, pero `npm run emulators` sí, con `--export-on-exit`).


## R18 — [ELIMINADO 2026-09-04] `safety.test.js` le pisa la contraseña al usuario de desarrollo y no la restaura

**ESTADO: ELIMINADO (no mitigado) — 2026-09-04, verificado contra el emulador.**
El test ya no llama a `updateUser` ni a `getUserByEmail`, y no nombra la cuenta de desarrollo en
ninguna parte: `grep -n "admin@delfino.local\|updateUser\|getUserByEmail"` sobre
`tests/integration/safety.test.js` no devuelve ninguna coincidencia. Usa una identidad propia por
corrida con **password aleatoria** (`randomBytes(24).toString("hex")`), que no coincide con
ninguna password documentada. Sin `updateUser` sobre la cuenta compartida no hay password que
pisar. Verificado además de forma directa: después de las cuatro inyecciones y de las dos
mutaciones, el login documentado sigue respondiendo 200 contra el emulador de Auth.

Texto histórico del riesgo, para trazabilidad:

`tests/integration/safety.test.js:80` hace `authAdmin.updateUser(uid, { password: PASSWORD })`
sobre `admin@delfino.local` cada vez que corre la suite de integración, y `afterAll` no la
devuelve al valor anterior (sólo borra el usuario si el propio test lo creó).

Aceptado como riesgo residual: el valor que impone es exactamente el documentado en `CLAUDE.md`
y en `INSTALAR.md` (`delfino-dev`), y el usuario sólo existe en el emulador. Queda anotado porque
es un efecto colateral no restaurado sobre el entorno de Gastón: si alguna vez se decide que el
usuario de desarrollo tenga otra contraseña, este test se la va a pisar en silencio.

**VÍA ELEGIDA: ELIMINAR DE RAÍZ, NO MITIGAR (2026-09-04, decisión de Gastón, auditor de acuerdo).**
Se retira la aceptación como riesgo residual. La posición es: un test no puede dejar a Gastón sin
acceso a su entorno local, ni siquiera imponiéndole en silencio un valor que hoy coincide con el
documentado. Misma corrección que R17 y por la misma causa: el test no toca `admin@delfino.local`
en absoluto, crea su propio usuario efímero con password aleatoria por corrida. Sin `updateUser`
sobre la cuenta compartida no hay password que pisar. R18 desaparece; no se mitiga.

**BLOQUEANTE para cerrar TASK-011.** Criterios de verificación en
`migration/approvals/TASK-011.approved`, sección ADDENDUM 2026-09-04.


## R19 — [BAJA] Ningún test cubre el wiring de emuladores real de `js/firebase.js`
`tests/integration/safety.test.js` conecta el emulador **por su cuenta**
(`connectFirestoreEmulator` en la línea 101) y sólo importa `js/firebase-config.js`. La barrera
que de verdad protege al ERP —`js/firebase.js:60-66`, que enruta a los emuladores cuando
`location.hostname` es local— nunca se ejecuta en la suite, porque depende de `location` y los
tests corren en Node.

O sea: `safety.test.js` prueba que *una escritura de este test* aterriza en el emulador, no que
*el ERP* vaya al emulador. Si alguien rompiera la condición de `js/firebase.js`, la suite seguiría
en verde. Es una limitación **preexistente** (el test anterior a TASK-011 tenía la misma), no una
regresión introducida por la tarea. Se cierra el día que haya un test de `js/firebase.js` con
`location.hostname` simulado, que verifique que se llamó a los cuatro `connect*Emulator`.

## R20 — [MEDIA] Tests que pasan sin discriminar: confianza falsa en toda la suite
Riesgo transversal, no de un archivo. Registrado por el director el 2026-09-04 a partir del
hallazgo de TASK-011; la decisión completa está en DECISIONS.md.

El test de aislamiento de FASE -1 escribía un documento y lo leía de vuelta **con el mismo
cliente**. Contra un Firestore equivocado escribe ahí y lee ahí: el assert pasa igual. El test
que existía para detectar una fuga a producción no podía detectarla, y estuvo así desde que se
escribió. El rojo por `PERMISSION_DENIED` lo tapaba: se leía como problema de reglas, no como
"este test no prueba nada". Tester y auditor lo reprodujeron por separado.

Por qué MEDIA y transversal: la PoC se evalúa con las invariantes de TEST_MATRIX.md. Una
invariante cubierta por un test que no discrimina produce un GO apoyado en evidencia vacía, y el
modo de falla es silencioso — no hay rojo que avise.

Mitigación vigente: toda tarea con tests exige la demostración de que el test **puede fallar**
(romper la propiedad a propósito y mostrar el rojo); el auditor la reproduce por su cuenta o
inventa otra; y se sospecha de toda verificación que use el mismo canal que la operación
verificada. Aplicado en TASK-001 (mutación del migrador) y TASK-011 (segundo emulador): en los
dos casos apareció algo que no se sabía.


## R21 — [BAJA] Dos corridas simultáneas de la suite se pisan por el barrido de huérfanos
Registrado por el auditor el 2026-09-04, en la confirmación de TASK-011.

El barrido de huérfanos que pide el criterio 7 del ADDENDUM (`safety.test.js:111-145`) borra, al
empezar, TODA cuenta `safety-<uuid v4>@test.local` que encuentre en Auth — incluida la de otra
corrida que esté en marcha en ese mismo momento. Si dos invocaciones de la suite corren en
paralelo contra el mismo emulador, la que arranca segunda le borra el usuario y el perfil a la
primera, y la primera falla con `PERMISSION_DENIED` en su `setDoc`.

Por qué BAJA y por qué no bloquea: es estrictamente mejor que lo que había (antes las dos corridas
se peleaban por el usuario compartido del entorno; ahora sólo se alcanzan recursos que el propio
test creó, y ninguna cuenta ajena puede ser tocada). El escenario exige dos corridas simultáneas
sobre el mismo emulador, que no es el uso normal: `npm run test:integration` levanta su propio
emulador con `emulators:exec` y el segundo intento falla antes por "port taken". El efecto es un
rojo ruidoso en el emulador, nunca una pérdida de datos ni nada que toque producción.

Si alguna vez molesta, la salida es acotar el barrido por antigüedad (`metadata.creationTime` más
viejo que, digamos, una hora) en vez de barrer todo lo que matchea el patrón.

## R22 — [INFORMATIVO] `borrarUsuarioEfimero` borra el perfil sin re-verificar si `getUser` falla por otra causa
Registrado por el auditor el 2026-09-04, en la confirmación de TASK-011.

`safety.test.js:92-103` re-verifica contra Auth que el email de la cuenta siga el patrón efímero
antes de borrar nada. Si `authAdmin.getUser(uid)` lanza, el `catch` asume "ya no existe" y deja
`email = null`, y con `email === null` la función igual borra `/usuarios/{uid}`. Un fallo
transitorio del emulador —no un "user not found"— toma ese mismo camino.

Por qué INFORMATIVO y no un riesgo real: el uid que llega ahí es siempre propio (o el que devolvió
`createUser` de esta corrida, o uno cuyo email ya matcheó el patrón en el barrido), así que la
re-verificación es una segunda red, no la única. Ninguna cuenta ajena queda al alcance por este
camino. Se anota para que quede escrito que el `catch` es más ancho que su comentario.


## R23 — [MEDIA] Un pago sin destino informado se imputa en silencio a 1.1.1 Caja, no a 1.1.2
Registrado por el auditor el 2026-09-04, en la aprobación de TASK-002. Detectado y reportado antes
por el tester (TEST_RESULTS.md, observación 1).

`backend/db/migrations/0003_iva_y_destino_pago.sql` define
`destino_contable text not null default 'caja'` y, dentro de `crear_venta()`,
`destino := coalesce(pg->>'destino_contable', 'caja')`. Un pago cuyo JSON no trae
`destino_contable` (o lo trae en `null`) queda como `caja` y su importe se debita a **1.1.1**.

El ERP hace lo contrario y lo dice explícito. `js/contabilidad.js:67-71`:

    return null; // medio sin destino definido — el que llama decide qué hacer, no se asume Caja

y `js/ventas.js:404-405` manda esa plata a **1.1.2 Deudores por Ventas**, además de dejarla
visible en el aviso de "pago sin ubicar" del Centro de Pendientes.

Verificado por el auditor ejecutando los dos caminos: una venta de $100 pagada con el medio
"Tarjeta" sin `destino_contable` deja `venta_pagos.destino_contable = 'caja'` y `1.1.1 debe 100`
en Postgres; el mismo caso en la réplica de `js/ventas.js` imputa a `1.1.2`. La divergencia es
real, es de imputación contable y es silenciosa.

**Por qué NO bloqueó TASK-002:**
1. Los criterios de aceptación de TASK-002 y la invariante IMPUTACION_PAGOS de TEST_MATRIX.md
   definen exactamente tres destinos (`caja`, `banco`, `cuentaPorCobrar`) y qué cuenta le toca a
   cada uno. El estado "pago sin destino" no existe en el esquema (la columna es NOT NULL con CHECK
   de tres valores), así que no es el mismo caso que el `ruteado:false` del ERP: no es una
   imputación distinta para la misma entrada, es una entrada que la PoC no modela.
2. La decisión Nivel 3 del 2026-09-04 sobre Tesorería dice que `venta_pagos` lleva "el destino
   contable **resuelto** en el momento de la venta". El ruteo, y por lo tanto la decisión de qué
   hacer con un medio sin destino configurado, pertenece a la capa que llama, y esa capa todavía
   no existe: `backend/src/` está vacío y `crear_venta()` no tiene ningún llamador. Hoy no se puede
   producir una imputación equivocada en ningún lado.
3. Para los tres destinos que sí son representables, la imputación fue verificada exhaustivamente
   por el auditor (400 ventas contra la réplica de `js/ventas.js`, 0 divergencias).

**Por qué igual es MEDIA y no informativo:** el default reintroduce, como comportamiento de
fallback, exactamente el error que el ERP corrigió en su día — "antes de ese cambio, una venta con
tarjeta sobrestimaba el disponible imputando todo a Caja" (DECISIONS.md, 2026-09-04, Tesorería).
Cuando exista el endpoint, un campo olvidado en el JSON no va a dar error: va a dar plata en Caja
que no está en la caja, venta por venta y sin ningún rojo que avise.

**Condición de cierre (obligatoria, no opcional).** La tarea que construya el primer llamador de
`crear_venta()` en `backend/src/` tiene que resolver esto en la misma tarea, con una de estas dos
salidas, y su auditor tiene que verificarlo:
- **Fallar fuerte (preferida):** sacar el `coalesce(…, 'caja')` de `crear_venta()` y levantar
  `DESTINO_PAGO: falta el destino contable del pago`, y sacar el `default 'caja'` de la columna una
  vez que no queden filas viejas que rellenar. La información faltante deja de convertirse en
  plata en Caja.
- **Replicar el ERP:** admitir un cuarto estado explícito (`sinUbicar`) que impute a 1.1.2, con su
  test propio. Es un cambio de esquema y de invariante: **decisión Nivel 3**, no la toma un agente.
Mientras tanto queda el test `OBSERVACIÓN · un pago sin destino explícito cae en 'caja' e imputa a
1.1.1` en `tests/integration/postgres/iva_destino_y_fecha.test.js`, que documenta el
comportamiento vigente. Ese test NO es una aprobación del comportamiento: si se cierra R23 por la
salida preferida, hay que darlo vuelta.

## R24 — [INFORMATIVO] `verificar_iva_imputado()` no la pide nadie, no la usa ningún test y comparte fuente con lo que verifica
Registrado por el auditor el 2026-09-04, en la aprobación de TASK-002.

`0003_iva_y_destino_pago.sql:286` agrega `verificar_iva_imputado()`, que no estaba en los criterios
de la tarea. Auditada: es de sólo lectura, no escribe nada, su lógica es correcta, y el auditor la
probó contra las dos mutaciones de R20 (centavo movido en los datos, y redondeo del IVA al final
en la implementación): devolvió 1 fila en los dos casos, o sea que detecta lo que dice detectar.
No molesta y sigue el patrón de `verificar_reservas_consistentes()` de 0001.

Lo que hay que tener escrito para que nadie la sobrevalore más adelante:
- **Ningún test de la suite la usa como assert.** Los importes esperados se calculan aparte, en JS
  con enteros exactos. Es un control de operación (correrla y esperar cero filas), no una prueba.
- **No es una vía totalmente independiente.** Compara `2.1.2` contra `SUM(venta_items.iva_monto)`,
  y las dos cosas las escribe la misma `crear_venta()` a partir del mismo `discriminar_iva()`. Si
  la fórmula de discriminación estuviera mal, las dos estarían mal igual y la función diría que
  está todo bien. Detecta un centavo mal repartido **entre 2.1.2 y 4.1**; no detecta un IVA mal
  calculado. La verificación que sí discrimina eso es la de `tests/_aritmetica_iva.mjs`.
- Consecuencia práctica: ninguna tarea futura puede citar "verificar_iva_imputado() devuelve cero
  filas" como demostración de que el IVA está bien calculado.

## R25 — [INFORMATIVO] El neto no se persiste y el subtotal se recalcula en la base: dos detalles para el shadow
Registrado por el auditor el 2026-09-04, en la aprobación de TASK-002.

1. `ventas.subtotal` y `venta_items.subtotal` siguen siendo el importe CON IVA (coherente con
   Firestore y con la decisión del residuo), y el neto imputado a 4.1 no se guarda en ninguna
   columna: se deriva del asiento. Cualquier reporte o comparación de shadow que quiera "ventas
   netas" tiene que leerlo del asiento, no de `ventas`.
2. `crear_venta()` recalcula `subtotal = round(cantidad · precio · (1 − desc/100), 2)` en `numeric`
   exacto, mientras el ERP recibe `it.subtotal` ya calculado por la UI en punto flotante
   (`js/ventas.js:149`). Como el subtotal alimenta el IVA de la línea, un empate exacto de medio
   centavo podría dar un centavo distinto entre las dos vías. El auditor buscó el caso: en 400
   ventas con descuentos 0/10/12,5/33,33 y en las comprobaciones puntuales de empate no apareció
   ninguna divergencia, y el criterio de redondeo es el mismo (medio hacia afuera del cero). Viene
   de 0002, no lo introdujo TASK-002. Se anota para que el shadow no atribuya a un bug lo que sea
   una diferencia de motor aritmético.

## R26 — [MEDIA] Node.js 20 se decomisiona el 30 de octubre de 2026 y afecta a las 26 funciones
Informado por Gastón el 2026-09-04, salido del deploy de `arcaAutorizarComprobante`.

Google decomisiona el runtime Node.js 20 el **30 de octubre de 2026**. Después de esa fecha
**no se puede desplegar** ninguna Cloud Function sin haber actualizado el runtime. Alcanza a las
26 funciones de `functions/`, incluidas `gbpSincronizarFacturas`, las de Mercado Pago y la recién
desplegada `arcaAutorizarComprobante`.

Por qué MEDIA y no BAJA: no rompe nada mientras no haya que desplegar, pero convierte cualquier
deploy urgente posterior a esa fecha en "primero migrá el runtime". Si el primer intento de
desplegar después del 30 de octubre es un arreglo de producción apurado, la migración de runtime
se hace en el peor momento posible.

Fuera del alcance de la PoC: `functions/` es producción desplegada y ningún agente la toca. Se
registra para que la fecha no aparezca de sorpresa. La actualización la planifica y ejecuta
Gastón.

## R27 — [MEDIA] `firebase-functions` desactualizado, con breaking changes al actualizar
Informado por Gastón el 2026-09-04, en el mismo deploy que R26.

La versión de `firebase-functions` que usan las 26 funciones está desactualizada y el aviso del
deploy advierte **breaking changes** al subir de versión. Combinado con R26 forma una sola tarea
real: el día que haya que tocar el runtime, además hay que absorber los cambios incompatibles de
la librería, en 26 funciones a la vez.

Igual que R26: fuera del alcance de la PoC, `functions/` no la toca ningún agente, y se registra
para que las dos cosas se planifiquen juntas y con tiempo, no bajo presión.

## R28 — [MEDIA] Tres copias de `crear_venta()` mantenidas a mano, y una cuarta en camino
Detectado por el tester en TASK-003 y elevado por Gastón el 2026-09-04.

`crear_venta()` está definida con `CREATE OR REPLACE` en `0002_venta_servicio.sql:46`,
`0003_iva_y_destino_pago.sql:112` y `0004_precios_y_costos.sql:241`. El patrón es **correcto** en
su motivo —no se editan migraciones ya aplicadas, porque eso rompe `schema_migrations`— pero cada
cambio copia el cuerpo entero para tocar unas pocas líneas. En 0004 fueron **tres** agregados de
`lista_precio_id` sobre ~90 líneas copiadas.

Qué protege hoy, y qué no:
- **Sí protege** la suite de comportamiento: los tests de TASK-002 corren contra la función
  **viva**, así que una copia futura que rompa el IVA, la imputación o la fecha local sale en
  rojo. El comparador de textos del tester **no** es el único centinela, y eso acota el riesgo.
- **No protege** contra una divergencia de comportamiento que ningún test cubra. Ahí el error no
  aparece en la suite: aparece en producción.
- **No escala**: cada migración que toque la función suma una copia, y el costo de revisarlas
  crece con el cuadrado de la cantidad, no con la cantidad.

Margen real: **TASK-004 NO la toca** —`crear_venta()` llama a `siguiente_numero('ventas')` por
nombre y esa firma no cambia—, así que no hay una cuarta copia inminente. La próxima que sí la va
a tocar es **TASK-007** (`facturar_pedido`, que convierte el pedido en venta).

**Condición de cierre (obligatoria, no opcional): antes de TASK-007.** Se cierra con
**migraciones repetibles** — TASK-012 agrega soporte en el migrador para un directorio
`backend/db/functions/` cuyos archivos se reaplican cuando cambia su hash, y TASK-018 mueve
`crear_venta()` ahí. A partir de entonces la función tiene **una sola copia canónica** y las
migraciones numeradas dejan de redefinirla. Detalle y alternativas descartadas en DECISIONS.md.

## R29 — [MEDIA] `historial_costos` no distingue "compra registrada" de "aceptación del maestro"
Registrado por el auditor el 2026-09-04, en la aprobación de TASK-003. Detectado antes por el
implementador (IMPLEMENTATION_LOG, duda 1) y evaluado por el tester (TEST_RESULTS, punto 4a).

`0004_precios_y_costos.sql:103-117` da a `historial_costos` los nueve campos que pide P5. Con
esos campos, la fila que dice "esta factura costó otra cosa" y la fila que el día de mañana diga
"un usuario autorizado aceptó el costo nuevo y el maestro se movió" se ven **idénticas**. `origen`
(`manual` | `factura_compra`) describe **de dónde salió el número**, no **si el maestro cambió**:
son dos ejes distintos. Y `costo_anterior` se lee de `productos.costo_referencia` en cada INSERT,
así que hoy repite siempre el mismo valor (`[600000, 600000, 600000]` en el test de tres compras
seguidas); en cuanto exista la aceptación, esa misma columna pasa a significar una cosa distinta
según la fila, sin nada que lo indique.

**Por qué NO bloqueó TASK-003:** los criterios de aceptación piden exactamente los campos de P5 y
están todos; la operación que vuelve ambigua la lectura no existe (`backend/src/` no tiene servicio
de compras y la aceptación explícita quedó deliberadamente sin implementar, ARCHITECTURE §2.3), así
que hoy ninguna fila puede leerse mal; y elegir el eje es una decisión de modelo contable, no de
implementación: no la toma un agente solo.

**Por qué es MEDIA y no informativo:** el historial de costos es la fuente de la que van a salir
los márgenes. Una lectura que confunda "el proveedor me cobró esto" con "esto es lo que el ERP usa
para costear" no da error: da un margen mal calculado, silencioso y hacia atrás.

**Condición de cierre (obligatoria, no opcional).** La tarea que implemente la **aceptación
explícita del costo maestro** tiene que agregar el eje en la misma tarea, y su auditor verificarlo:
- un eje propio (`aplicado_en` / `aplicado_por`, o un `origen='aceptacion_maestro'` con CHECK que
  exija que el maestro efectivamente cambió) — cuál de los dos es **decisión de Gastón**;
- su propio test, que distinga las dos clases de fila por comportamiento;
- y revisar el residuo de nomenclatura que dejó el tester: `metodo_costeo` se copia de
  `productos.costo_modo` a cada fila, pero en modo `promedio` el `costo_nuevo` guardado es el costo
  **crudo de la factura**, no un promedio ponderado. Quien escriba la fórmula tiene que leer eso
  antes, o va a suponer que el número ya viene calculado "según el método".
Mientras tanto queda plantado el centinela: el test `origen solo admite manual y factura_compra`
de `tests/integration/postgres/precios_y_costos.test.js` se pone rojo el día que alguien amplíe el
CHECK, y obliga a volver acá.

## R30 — [MEDIA] La inmutabilidad del historial se cae si el rol de la aplicación es dueño o superusuario
Registrado por el auditor el 2026-09-04 en la aprobación de TASK-003, como BAJA.
**Subido a MEDIA el 2026-09-04 por Gastón**, con este argumento: no es un detalle de
configuración, es una **restricción de provisionamiento**. Los roles y la propiedad de las tablas
se fijan al crear la instancia de Cloud SQL y al correr la primera migración; si se decide tarde,
**hay que recrear la base**. Un riesgo cuyo costo de corrección salta de "un `GRANT`" a "recrear
la instancia" según cuándo se lo mire no es BAJA.

Los tres triggers BEFORE de `0004_precios_y_costos.sql:142-159` rechazan **toda** la vía DML:
verificado por el auditor con SQL directo — UPDATE con y sin WHERE, UPDATE que no cambia nada,
DELETE con y sin WHERE, DELETE dentro de una CTE, DELETE desde una función plpgsql SECURITY
DEFINER, TRUNCATE y TRUNCATE CASCADE, los ocho con SQLSTATE 23001 y la fila intacta. La migración
ya dice que DROP TABLE no lo cubre ningún trigger y que eso es cuestión de permisos.

Lo que falta decir es que hay **dos vías más** de la misma clase, reproducidas por el auditor sobre
`delfino_test`: `SET session_replication_role = 'replica'` (requiere superusuario) y
`ALTER TABLE historial_costos DISABLE TRIGGER …` (requiere ser dueño de la tabla). Con cualquiera
de las dos, el UPDATE siguiente pasa y reescribe la fila. El rol `delfino` de la base local **es
superusuario**, así que hoy, en desarrollo, la inmutabilidad es una convención sostenida por que
nadie lo intente.

No bloquea la PoC: `backend/src/` está vacío, no hay ningún llamador y todavía no existe un rol de
aplicación.

**CONDICIÓN DE CIERRE OBLIGATORIA, atada a la tarea que provisione PostgreSQL en la nube.** Esa
tarea todavía no existe —Cloud SQL está postergado por P12 hasta que haya GO— así que la
condición queda escrita acá y repetida en TASKS.md, en la sección de condiciones de cierre sin
tarea asignada. Cuando la tarea se escriba, esto entra en su `accept:`:

- el rol de la aplicación **no es dueño de ninguna tabla y no es superusuario**, con permisos DML
  acotados; migraciones y despliegue corren con **otro** rol;
- hay un test que comprueba que **desde ese rol** fallan `ALTER TABLE historial_costos DISABLE
  TRIGGER …` y `SET session_replication_role = 'replica'`;
- el test corre contra la instancia provisionada, no solo contra la base local.

**Por qué no puede quedar para después:** la propiedad de las tablas la fija quien corre la
primera migración. Descubrirlo con datos adentro obliga a recrear la instancia o a una migración
de propiedad delicada. Es de las pocas decisiones de esta lista que **se abarata muchísimo si se
toma temprano y se encarece de golpe si no**.

Nota sobre hoy: el rol `delfino` de la base local **es superusuario**, así que en desarrollo la
inmutabilidad es una convención sostenida por que nadie lo intente. Eso es tolerable en el
emulador de trabajo y no lo es en la instancia que guarde datos reales.

## R31 — [INFORMATIVO] `verificar_sin_recalculo_de_costo()` es una heurística de texto y se puede evadir
Registrado por el auditor el 2026-09-04, en la aprobación de TASK-003.

`0004_precios_y_costos.sql:214-227` busca en `pg_proc.prosrc` con
`prosrc ~* 'update\s+productos'` **y** `prosrc ~* 'costo_referencia'`. Es una lectura del texto
fuente, no del plan: el auditor plantó una función con
`update public.productos set costo_referencia = …` en un trigger AFTER INSERT sobre
`historial_costos`; el maestro pasó de 600000 a 715000 y `verificar_sin_recalculo_de_costo()`
devolvió **vacío**. Un `update "productos"`, un alias o un `EXECUTE` armado por concatenación
tienen el mismo efecto.

No es un defecto que importe hoy, y por eso queda informativo: lo que decide la invariante es el
assert de comportamiento (`assertCompraNoPisaElMaestro`, que compara el número del maestro antes y
después), y el tester tiene además un test propio que enumera **todos** los triggers no internos
del esquema público contra una lista cerrada — ése sí caza la mutación evasiva. La función de la
migración es un control secundario y así la usan los tests.

**Qué no hacer:** usarla como única garantía, ni convertirla en el chequeo de un hook o de CI que
"demuestre" que nadie reintrodujo el recálculo. Para eso vale la enumeración de triggers y el
assert de comportamiento.

## R32 — [RESUELTO 2026-09-05] Tests que comparan texto de archivos se rompen al cambiar de rama, por CRLF
Registrado por el director el 2026-09-05, a partir de un hallazgo del implementador en TASK-013.
**Cerrado el 2026-09-05 por TASK-019** (tester). Ver el bloque "Cierre" al final del riesgo.

`tests/integration/postgres/precios_y_costos.test.js` tiene **2 tests en rojo** que comparan el
texto de `backend/db/migrations/0004_precios_y_costos.sql` contra literales con `\n`. El
repositorio **no tiene `.gitattributes`**, y en Windows el checkout convierte los finales de línea:
`file` confirma que hoy los dos archivos están en el árbol con **CRLF**. La comparación falla por
los `\r`, no por el contenido.

**Lo importante es cuándo apareció.** Esos tests estuvieron **verdes** para el tester y para el
auditor de TASK-003, que la aprobó. Se pusieron rojos **después**, cuando el árbol pasó por
`git checkout` y `git merge` al cerrar la tarea y abrir `task/TASK-013`: el agente los escribió con
LF y git los reescribió con CRLF. O sea que un test puede pasar la auditoría y romperse por una
operación de git que no toca su contenido.

Por qué MEDIA: no hay riesgo de datos ni de producción, pero **la suite deja de estar verde sin
que nadie haya cambiado nada**, y eso erosiona la señal igual que un rojo crónico — que es
exactamente lo que costó cerrar en TASK-011. Además es un modo de falla que **la aprobación no
puede detectar**, porque en el momento de auditar el problema no existe.

**Condición de cierre — TASK-019.** La salida elegida es normalizar en el test —comparar con los
finales de línea neutralizados— y **no** agregar `.gitattributes`: ese archivo cambia el checkout
de todo el repositorio y es una decisión de configuración global con radio de acción mucho mayor
que el problema. Si más adelante se quiere igual, es una decisión aparte y de Gastón.

Regla que se desprende, para las tareas que vienen: **un test que compara texto de archivos del
repositorio tiene que ser insensible a los finales de línea.** Vale para TASK-018, que va a
comparar la definición de `crear_venta()` con la que corre en la base.

### Cierre — 2026-09-05, TASK-019 (tester)

`tests/integration/postgres/precios_y_costos.test.js` pasa a LF el texto que ENTRA, en el único
punto por donde entra (`sqlDe`, que es de donde salen `SQL_0003` y `SQL_0004` y el SQL de
`esquemaHasta`). No se tocó ningún assert, ningún literal esperado y ningún otro test del
archivo. No se agregó `.gitattributes`.

Por qué no es relajar el assert: la comparación sigue siendo igualdad exacta carácter por
carácter, y lo único que deja de distinguir es el `\r` del checkout. Demostrado con una copia
del árbol fuera del repositorio, convirtiendo las migraciones a las dos formas y corriendo el
archivo de tests contra las dos:

| corrida | migraciones | tests | resultado |
|---|---|---|---|
| test SIN el arreglo (`git show HEAD:`) | LF | 33 | **33 verde** — así lo aprobó el auditor de TASK-003 |
| test SIN el arreglo (`git show HEAD:`) | CRLF | 33 | **2 rojo** / 31 verde — el modo de falla del riesgo |
| test CON el arreglo | LF | 33 | **33 verde** |
| test CON el arreglo | CRLF | 33 | **33 verde** |
| test CON el arreglo + cambio REAL de contenido | LF | 33 | **2 rojo** / 31 verde |
| test CON el arreglo + cambio REAL de contenido | CRLF | 33 | **2 rojo** / 31 verde |

El "cambio real de contenido" son dos ediciones semánticamente neutras del `0004` de la copia
(`return v_id;` → `return v_id + 0;` en `registrar_costo()`, y
`iva_l := discriminar_iva(sub, ali);` → `... + 0;` en `crear_venta()`): ningún assert numérico
las ve, y aun así los dos tests de texto se ponen rojos en las dos formas del archivo. Es decir
que siguen discriminando contenido y no quedaron apagados (R20).

**Queda vigente la regla, y hay dos lugares más donde aplica** (reportados, no arreglados acá,
por estar fuera del `files:` de la tarea):

1. `tests/integration/postgres/iva_destino_y_fecha.test.js` → `mutarCrearVenta()` (líneas 68-77)
   hace `sql.includes(de)` sobre el texto de `0003_iva_y_destino_pago.sql`. **Hoy está verde por
   casualidad**: sus cuatro literales son de una sola línea, así que no hay `\r` en el medio. El
   primer literal multilínea que alguien agregue ahí reproduce R32 exacto. Riesgo latente, mismo
   patrón, misma solución de una línea.
2. `tests/integration/postgres/_helpers.mjs` → `recrearEsquema()` (línea 26) carga las
   migraciones **crudas**, con los `\r` incluidos, así que el cuerpo que queda desplegado en
   PostgreSQL conserva los finales de línea del checkout. **Esto es lo que le importa a
   TASK-018**: comparar `pg_get_functiondef('crear_venta')` contra el archivo exige normalizar
   **los dos lados**, no solo el del archivo. En `precios_y_costos.test.js` esa comparación ya
   sobrevive porque pasa por `normalizar()`, que colapsa `\s+`; una comparación cruda no.

No se revisó nada más porque no hay más: las otras comparaciones de texto de la suite
(`backend-higiene.test.js`, `migrador.test.js`, `safety.test.js`) son regex de una línea o
`toContain` sobre stdout de un proceso, y ninguna es sensible a los finales de línea.

### Confirmación del auditor — 2026-09-05, auditoría de TASK-019

El cierre de arriba se verificó de forma independiente y quedó confirmado: la matriz de seis
corridas se reprodujo entera y los dos lugares que el tester reporta existen y son los que dice.
Se agrega en R33 la medición que faltaba, que es la que le sirve a TASK-018.

---

## R33 — [MEDIA] Después de TASK-019 el lado ARCHIVO está normalizado y el lado BASE no: TASK-018 no puede copiar la receta de una sola línea
Registrado por el auditor el 2026-09-05, durante la auditoría de TASK-019. No es un defecto de
TASK-019 —su arreglo es correcto y está dentro de su `files:`— sino la consecuencia que hereda la
tarea siguiente.

TASK-019 normaliza a LF el texto que entra por `sqlDe()` en `precios_y_costos.test.js:39`. El
otro extremo, `tests/integration/postgres/_helpers.mjs:26`, sigue cargando las migraciones
**crudas** al `pool.query`. Las dos mitades quedaron con criterios distintos.

**Medido, no razonado** (base `delfino_test`, árbol tal como está hoy, con `0003` y `0004` en
CRLF por `core.autocrlf=true`: `git ls-files --eol` da `i/lf  w/crlf` para los dos):

- `pg_get_functiondef('crear_venta'::regproc)` devuelve el cuerpo **con 163 CRLF adentro**.
  PostgreSQL guarda `prosrc` tal cual se lo mandaron, finales de línea incluidos.
- comparación cruda base-contra-archivo, sin normalizar ningún lado: **`true`**. Pasa hoy, pero
  por coincidencia: los dos lados arrastran el mismo CRLF.
- normalizando `\r\n` → `\n` en **los dos** lados: **`true`**.
- normalizando **solo el lado archivo**, que es exactamente lo que hace `sqlDe()` hoy: **`false`**.

O sea: aplicar la receta de TASK-019 a un solo lado no es neutral, **rompe activamente** la
comparación archivo-contra-base. Y la comparación que ya existe en `precios_y_costos.test.js:692`
("lo que corre en la BASE es la definición de 0004") sobrevive **solo** porque pasa por
`normalizar()`, que colapsa `\s+` y se come el `\r` de rebote. Es una protección incidental, no
deliberada: el día que TASK-018 haga la comparación exacta que le corresponde, deja de haberla.

**Condición de cierre — va al `accept:` de TASK-018 antes de que arranque:**

1. La comparación entre la definición desplegada (`pg_get_functiondef` / `prosrc`) y el archivo de
   la función normaliza los finales de línea **en los dos lados**, no en uno.
2. `recrearEsquema()` de `_helpers.mjs` normaliza a LF lo que despliega, para que lo que corre en
   la base no dependa del checkout de quien lo corrió. Se suma a lo ya pedido en
   `TASK-003.approved`: que ese helper aplique además las migraciones repetibles.
3. El test de TASK-018 se demuestra con la misma matriz de TASK-019: verde con el árbol en LF y
   con el árbol en CRLF, y **rojo** ante un cambio real de contenido en las dos formas.

**Latente, misma familia, sin cerrar:** `tests/integration/postgres/iva_destino_y_fecha.test.js`
lee `SQL_0003` crudo (línea 26) y `mutarCrearVenta()` hace `sql.includes(de)` (líneas 68-77).
Verificado por el auditor: sus cuatro literales (214-218 y 395) son de una sola línea, así que hoy
está verde **por casualidad**. El primer literal multilínea que alguien agregue ahí reproduce R32
idéntico, con el mismo síntoma engañoso: rojo sin que nadie haya tocado contenido.

---

## R34 — [BAJA] El `testTimeout` de 30 s deja a `migrador.test.js` al borde del flake bajo carga
Registrado por el auditor el 2026-09-05, durante la auditoría de TASK-019.

`vitest.integration.config.js` fija `testTimeout: 30000` para toda la integración. El test
`MIGRADOR_IDEMPOTENCIA > contra base limpia aplica las migraciones, sale 0 y las registra con
nombre y fecha` crea una base nueva y lanza el migrador en un **proceso hijo**: su duración
depende de la carga de la máquina, no de la lógica. Al tester le cortó una vez por
`Test timed out in 30000ms`, en una corrida que tardó 89 s contra los 51-52 s habituales.

El auditor **no lo reprodujo**: dos corridas completas seguidas dieron 101/101 en 47,9 s y 49,0 s.
Queda como flake de infraestructura, no como rojo del repositorio. Lo que lo vuelve un riesgo y no
una anécdota es que un timeout se lee igual que un fallo de lógica en el log: si aparece en medio
de una tarea contable, cuesta una iteración distinguirlo. Cierre sugerido: subir el timeout de ese
archivo, o medir el margen y dejarlo escrito.

## R35 — [MEDIA] `singleProjectMode` hace ilusorio el aislamiento entre namespaces de Firestore
Registrado por el director el 2026-09-05, a partir de un hallazgo del tester y del implementador en
TASK-013.

`firebase.json:17` declara `"singleProjectMode": true`. Con esa opción, el emulador de Firestore
**sirve los documentos del proyecto principal a cualquier namespace virgen**: se le pida el
proyecto que se le pida, devuelve los mismos datos, y además **reescribe el campo `name`** de cada
documento con el `projectId` que se pidió. Medido por el implementador en un emulador descartable:
con `singleProjectMode: false` un namespace virgen devuelve `[]`; con `true`, devuelve los 35
documentos del ERP.

Auth **no** se comporta así: ahí los usuarios sí están separados por proyecto. Eso explica la
asimetría que se venía observando sin entenderla —`demo-delfino` con 0 usuarios de Auth pero 35
documentos de Firestore idénticos a los del ERP—.

**Consecuencia que hay que verificar, no dar por sentada:** el "perfil duplicado en los dos
namespaces" que se documentó en R16 y que se usó como evidencia del bug **pudo ser un artefacto de
`singleProjectMode`**, no un documento realmente almacenado dos veces. El bug de R16 en sí —el seed
apuntando al proyecto equivocado— es real, está verificado por otras vías y Gastón confirmó que el
login volvió a andar. Lo que queda en duda es **una** de las evidencias que se citaron, no la
conclusión.

Impacto más amplio: cualquier verificación futura que se apoye en "este dato está en el namespace
X y no en el Y" **no es válida** mientras `singleProjectMode` esté activo. Afecta al shadow y a
cualquier prueba de aislamiento por proyecto.

**No se resuelve tocando `firebase.json`**, que es archivo de Gastón, y menos de noche y sin
medir: esa opción probablemente esté puesta a propósito y cambiarla altera el comportamiento del
emulador para todo el proyecto. Queda para que Gastón decida si se saca, con esta información
sobre la mesa.

## R35 — nota del auditor, 2026-09-05 (TASK-013): confirmado, pero enunciado de mas
Reproducido por el auditor en un emulador descartable propio (puertos 18081/19100, `--project
delfino-hogar-erp`, `"singleProjectMode": true`, apagado al terminar). El espejo existe, y **solo
alcanza a los documentos que entraron por `--import`**:

- Emulador SIN `--import`. Se escriben 5 documentos en `delfino-hogar-erp` en vivo. Un namespace
  virgen (`demo-delfino`, `sonda-virgen-auditor`) devuelve **docs=0**. No hay espejo. Medido dos
  veces, la segunda con el seed real sembrando sus 35 documentos: `demo-delfino` siguio en 0.
- Mismo emulador levantado CON `--import` de ese estado. `delfino-hogar-erp` docs=35,
  `demo-delfino` docs=35, `sonda-virgen-auditor` docs=35, las tres con las mismas 10 colecciones y
  con el campo `name` reescrito con el projectId pedido
  (`projects/sonda-virgen-auditor/databases/(default)/documents/categorias/electro`).
- Auth **no** espeja en ninguno de los dos casos: `auth=1` en el proyecto principal, `auth=0` en
  los otros dos. Confirma la asimetria que R35 ya describia.

O sea: el mecanismo no es "namespace virgen ve el proyecto principal", es "los datos importados no
quedan atados a ningun projectId y se sirven a cualquiera que todavia no haya escrito". La
consecuencia practica de R35 se sostiene entera, porque `npm run emulators` siempre corre con
`--import ./emulator-data`, pero el enunciado importa para no perseguir el fantasma equivocado
cuando alguien intente reproducirlo sin import.

**Y el barrido de TASK-013 es seguro incluso con el espejo activo.** Medido en ese mismo emulador
con `demo-delfino` mostrando los 35 documentos espejados: despues de
`node scripts/seed-emulator.mjs --limpiar-demo-delfino` (exit 0), `delfino-hogar-erp` quedo en
docs=35 auth=1 —intacto— y `demo-delfino` en docs=0. El espejo es de lectura y el projectId viaja
en la URL del DELETE.

### La evidencia del "perfil duplicado" de R16 SE RETIRA
La sospecha del director era correcta. Tres mediciones independientes:

1. El export que `npm run emulators` importa —`emulator-data/firestore_export/all_namespaces/
   all_kinds/output-0`— contiene **35 apariciones de `delfino-hogar-erp` y CERO de
   `demo-delfino`**. No hay ningun documento almacenado bajo el namespace basura.
2. En el emulador de Gaston, el perfil que se veia en `demo-delfino/usuarios` tenia el **mismo uid**
   que el de `delfino-hogar-erp` (`HfH7fg2RWwLBI6Lacotphm3rM1H9`). Un sembrado real en otro
   namespace habria creado un usuario de Auth propio y por lo tanto un uid **distinto**.
3. `demo-delfino` mostraba 35 documentos con **cero usuarios de Auth**, y Auth no espeja. El seed
   nunca deja documentos sin dejar tambien el usuario admin. Esa asimetria es incompatible con un
   sembrado real y es exactamente la firma del espejo.

Se retira la evidencia, como se hizo con la version vieja de R8. **El bug de R16 no se toca**: el
default `|| "demo-delfino"` estaba en el codigo, es verificable leyendolo, y Gaston confirmo que el
login volvio a andar. Lo que se cae es una de las evidencias citadas, no la conclusion. Tambien hay
que releer bajo esta luz la frase de R16 "`demo-delfino` paso de 10 colecciones / 35 docs a 0
colecciones / 0 docs": el "paso a 0" es real, pero lo que habia antes era el espejo, no residuo; el
DELETE hizo que el namespace dejara de ser virgen y por eso dejo de espejar.

## R36 — [MEDIA] Un emulador descartable con el mismo `--project` puede ser alcanzado por el hub del que ya corre
Registrado por el auditor de TASK-013 el 2026-09-05, por algo que le paso a el.

Levante un emulador descartable en puertos propios (18081/19100, config propia fuera del repo) con
`firebase emulators:exec --project delfino-hogar-erp ... --export-on-exit <carpeta mia>`. El
emulador arranco bien y aviso `hub unable to start on port 4400, starting on 4401 instead`, porque
el hub del emulador de Gaston ya tenia el 4400. Al salir, el export que quedo en mi carpeta **no
era el de mi instancia** —no contenia los 5 documentos que yo habia escrito— sino los 35 del
emulador de Gaston: `--export-on-exit` resuelve el hub por el **archivo localizador del sistema,
indexado por projectId**, no por los puertos de la instancia.

En este caso fue inofensivo: un export es de solo lectura y verifique despues que el emulador de
Gaston seguia con sus 35 documentos y su usuario de Auth. Pero la misma resolucion por projectId
la usan otros comandos del CLI, y algunos **si** escriben. La leccion es la misma que R16 pero al
reves: aislarse cambiando de puerto **no alcanza**.

Regla practica para agentes, hasta que alguien la mejore: un emulador descartable se levanta con un
`--project` **distinto** del de Gaston (por ejemplo `auditor-descartable`), y no se usan
`--export-on-exit` ni comandos que hablen con el hub mientras haya otro emulador en pie.

## R37 — [MEDIA] `schema_repetibles` declara el estado de la base, no lo observa
Registrado por el auditor de TASK-012 el 2026-09-05. Lo detectó el tester para el caso de
`--marcar-aplicadas`; el auditor lo reprodujo y encontró que es una clase, no un caso.

El migrador decide qué repetibles aplicar comparando el hash del archivo contra la fila de
`schema_repetibles`. **Nunca mira si el objeto existe de verdad en la base.** Dos caminos llegan
al mismo estado incoherente —fila al día, función ausente o vieja, migrador informando
`Repetibles: sin cambios`—, los dos medidos por el auditor sobre bases temporales propias:

1. **`--marcar-aplicadas`**, que también baselinea repetibles: tras el baseline, `repet_a()`
   **no existe** y la corrida siguiente sale 0 con `Repetibles: sin cambios.` y `avisa=false`.
2. **Un `DROP FUNCTION` a mano** sobre una repetible ya aplicada: la corrida siguiente sale 0 con
   `Repetibles: sin cambios.`, la función sigue sin existir, y `--estado` la reporta como
   `repetible al dia`.

Por qué NO bloqueó TASK-012:
- ningún criterio de aceptación lo exige, y el que sí existe —`--marcar-aplicadas` con string
  exacto y sin abreviatura— está cumplido y verificado;
- `--marcar-aplicadas` es una acción explícita y deliberada; la validación de flags de R14, ya
  mitigada y verificada, hace imposible caer en ese modo por un typo;
- el comportamiento está documentado en `backend/README.md` ("esto deja la base mintiendo sobre su
  estado. Usarlo a conciencia.");
- es la semántica del patrón `R__` de Flyway: arreglarla bien es comparar la base contra el
  archivo, o sea un cambio de diseño, no un parche de esta tarea;
- hoy **no hay ni una repetible en el repo** (`backend/db/functions/` ni existe), así que el daño
  concreto no puede materializarse en este commit.

Por qué igual importa: con una migración numerada un baseline mal hecho revienta enseguida —la
tabla no está y todo falla—. Con una repetible **no revienta nada**: la base se queda con
`crear_venta()` vieja, o sin ella, y el migrador jura estar al día. A partir de TASK-018 eso es
una divergencia contable silenciosa, que es la clase de error que este proyecto no se puede
permitir.

**Condición de cierre (obligatoria): antes de que TASK-018 se mergee.** Alcanza con **una** de
las dos, y la primera es preferible:
- que `--marcar-aplicadas` **avise** cuando lo que baselinea no está en la base —para funciones,
  un `to_regprocedure`/`pg_proc` sobre lo que el archivo declara— y que la corrida normal o
  `--estado` puedan reportar "registrada pero ausente en la base"; o
- que `backend/README.md` lo diga **con todas las letras y para el caso de las repetibles**, no
  en la frase genérica de hoy: que baselinear una repetible que no está desplegada deja la función
  ausente o vieja **sin que nada lo avise nunca**, y que después de un `--marcar-aplicadas` hay
  que verificar `pg_get_functiondef()` a mano.

[MENOR] cosmético de la misma familia, sugerido por el tester y compartido por el auditor: la
línea de `--estado` para una repetible huérfana (`registrada pero NO esta en disco`) podría decir
qué hacer —"si ya no debe existir, el `DROP FUNCTION` va en una migración numerada"—. La
convención en sí es correcta y ya está en el README: el migrador **no** borra objetos de la base
porque desapareció un archivo, y hace bien.

## R38 — [BAJA] Una repetible con sentencias de control de transacción rompe la garantía en silencio
Registrado por el auditor de TASK-012 el 2026-09-05, midiéndolo.

`aplicarRepetibles()` envuelve cada archivo en `begin` … `commit` junto con su `UPSERT`. Si el
`.sql` trae adentro su propio `COMMIT`, la transacción del migrador se cierra en el medio y la
garantía se evapora. Medido con un archivo que hace `CREATE OR REPLACE FUNCTION` + `commit;` +
`select 1/0;`:

    exit=1   schema_repetibles=[]   funcion_quedo=true

El peor de los dos mundos: la función **quedó desplegada** y **no quedó registrada**. La corrida
siguiente la reaplica (el hash no coincide), así que el sistema se recompone solo, pero entre una
corrida y otra la base tiene un objeto que el migrador no sabe que puso.

`backend/README.md` ya declara el requisito ("tiene que poder correr dentro de una transacción.
Nada de `CREATE INDEX CONCURRENTLY` ni `VACUUM`") y el migrador no lo verifica. **No es una
regresión de TASK-012**: las migraciones numeradas tienen exactamente la misma propiedad desde
TASK-001 y así fueron aprobadas. Se registra porque a partir de TASK-018 el archivo alcanzado es
el de dominio, `crear_venta.sql`.

**Condición de cierre: en TASK-018, y es barata.** Verificar —a ojo alcanza, es un archivo con un
solo `CREATE OR REPLACE FUNCTION`— que la repetible no contenga `begin`, `commit` ni `rollback`
fuera del cuerpo de la función. Si en algún momento hay más de un archivo en
`backend/db/functions/`, conviene que el migrador rechace de entrada una repetible que traiga esas
palabras como sentencia de nivel superior.
