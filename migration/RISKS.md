# Riesgos

Escribe solo el auditor (más las entradas iniciales de la FASE -1, que quedan como base).
Orden: severidad descendente.

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

---

## R12 — [ALTA] Sesión de administrador abierta en el navegador
Una sesión autenticada del ERP en el navegador saltea TODAS las barreras técnicas: protección
de rama, reglas de deny de Claude Code, filtro de publicación. Desde ahí se escribe directo en
Firestore de producción con permisos de administrador, y las Firestore Rules no lo impiden
porque el usuario es legítimo.
Descubierto el 2026-09-04: había una sesión de delfinohogar@gmail.com abierta en el navegador
que usaban las pruebas automatizadas. Se cerró y se verificó.
Mitigación obligatoria: ninguna sesión de admin abierta mientras trabajen agentes.

## R13 — [RESUELTO 2026-09-04] Código fuente público en Netlify
`netlify.toml` tenía `publish = "."`, que sube el directorio de trabajo completo. Un
`.netlifyignore` presente en el repo NO tenía ningún efecto: Netlify nunca lee ese archivo, y
dejó de aplicar `.gitignore` al publish en 2020. Estuvieron públicos `functions/index.js`
(incluida la integración ARCA y Mercado Pago), `firestore.rules`, `firebase.json`,
`firestore.indexes.json`, `dev-server.py`, `build.js` y todo el código fuente de las pantallas.
Sin credenciales expuestas (viven en Secret Manager), pero sí la lógica de negocio y la
estructura exacta de las reglas de seguridad.
Resuelto con `build.js` armando una carpeta `publicar/` curada (lista de permitidos) y
`publish = "publicar"`. Verificado: las 9 rutas dan 404 y el control positivo da 200.

## R14 — [MEDIA] ARCA WSFEv1 completo y apagado, con frontend en producción
El commit 902ef3c agregó la integración fiscal con ARCA (WSFEv1): determinación de tipo de
comprobante, cálculo de IVA y solicitud de CAE. Queda inactiva por `arcaActivo = false` y sin
UI para activarla. El frontend (`js/arca-facturacion.js`, `js/facturacion.js`) SÍ está
desplegado en producción; el backend (`functions/arcaFacturacion.js`, `arcaWsfe.js`) NO.
Consecuencia: existe código de facturación fiscal real a un flag de distancia. Activar ARCA es
Nivel 3 explícito y requiere revisión previa completa.

## R15 — [MEDIA] Líneas de GBP sin artículo, con importe
De 2.181 líneas en `facturasGbp`, 117 llegan sin `item_id`. De esas, 8 tienen precio real (una
de $1.404.958) y `costoUnitario: 0`, por lo que contaban como margen puro: inflaban el margen
bruto en $2.155.983 sobre el período completo. El filtro las excluye del detalle; el total de
la factura las sigue incluyendo. Queda como cuestión abierta: son ventas reales sin artículo
asociado que no figuran en ningún reporte por producto.
Distinto de las 497 líneas con `item_id` válido pero sin producto catalogado en Delfino: esas
son ventas legítimas de artículos no importados todavía y NO se filtran (decisión de Gastón,
2026-09-03).

## R16 — [BAJA] Contadores fuera de transacción queman números
`js/ventas.js` incrementa `contadores/ventas` en una transacción propia antes de escribir la
venta. Una venta que falla después deja un hueco en la numeración. En el diseño PostgreSQL el
contador vive dentro de la misma transacción y hace rollback — verificado empíricamente.
