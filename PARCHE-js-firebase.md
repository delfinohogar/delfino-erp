# Parche manual: `js/firebase.js`

**No incluyo el archivo completo a propósito.** Tu `js/firebase.js` cambió con el bundling y no
lo tengo a la vista; si te mandara mi versión, te pisaría lo que hayas agregado desde entonces.
Son tres ediciones chicas.

## 1. Agregar tres imports

Buscá los tres bloques de import del SDK y agregá una línea a cada uno:

En el import de `firebase-firestore.js`, agregá al final de la lista: `connectFirestoreEmulator`
En el import de `firebase-auth.js`, agregá: `connectAuthEmulator`
En el import de `firebase-functions.js`, agregá: `connectFunctionsEmulator`

## 2. Agregar el bloque de emuladores

Justo después de la línea que exporta `functions` (la del `getFunctions(app, "southamerica-east1")`),
pegá esto:

```js
// --- Aislamiento del entorno de desarrollo (FASE -1) ---------------------------------------
// Regla fija y sin excepciones: si esto se sirve desde localhost/127.0.0.1, va SIEMPRE a los
// emuladores. No hay flag para saltearlo. Si el emulador no esta corriendo, el ERP falla al
// conectar — que es lo que queremos: nunca cae de vuelta a produccion por descuido.
// Para operar produccion desde esta PC, usar el sitio de Netlify, nunca localhost.
// OJO: las paginas cargan desde dist/, asi que esto solo tiene efecto DESPUES de npm run build.
// Los tests en Node no pasan por aca: no hay `location`, y ademas usan FIRESTORE_EMULATOR_HOST.
const EMULADORES = { firestore: 8080, auth: 9099, functions: 5001 };
const enLocalhost =
  typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

if (enLocalhost) {
  connectFirestoreEmulator(db, "127.0.0.1", EMULADORES.firestore);
  connectAuthEmulator(auth, `http://127.0.0.1:${EMULADORES.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", EMULADORES.functions);
  console.warn(
    `[Delfino] Entorno LOCAL: Firestore/Auth/Functions apuntan a los emuladores en 127.0.0.1. ` +
      `NO se esta usando el proyecto de produccion (${firebaseConfig.projectId}).`
  );
}
```

## 3. Verificar

`npm run build` tiene que seguir andando. Después, con los emuladores levantados, servir el
sitio en localhost y confirmar en la consola del navegador que aparece el aviso `[Delfino]
Entorno LOCAL`, y que en la pestaña Network no hay ninguna llamada a `firestore.googleapis.com`.
