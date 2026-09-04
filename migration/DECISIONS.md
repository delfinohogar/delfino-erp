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
