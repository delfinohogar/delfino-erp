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

---

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
