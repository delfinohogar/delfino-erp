// Las propiedades de TASK-013, escritas UNA sola vez y como funciones que tiran error.
//
// Por que asi y no como `expect(...)` sueltos en cada test: R20 exige demostrar que cada test
// puede fallar. Eso solo vale si el mutante se evalua con EXACTAMENTE la misma verificacion que
// el codigo real, no con una parecida escrita al lado. Aca cada propiedad es una funcion:
//   - el test real hace   expect(() => verificarX(...)).not.toThrow()
//   - el test de R20 hace expect(() => verificarX(...)).toThrow()
// Si alguien afloja una verificacion, se afloja en los dos lados a la vez y el mutante deja de
// ser detectado: el rojo de R20 aparece solo.

/** Proyecto que el ERP y los tests miran de verdad. Ningun borrado puede alcanzarlo. */
export const PROYECTO_PROTEGIDO = "delfino-hogar-erp";
/** Unico namespace que el barrido tiene permitido tocar. */
export const NAMESPACE_BASURA = "demo-delfino";

/**
 * Codigo de salida 0xC0000409 con la asercion de libuv.
 *
 * Node 24.19 en Windows aborta con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 * file src\win\async.c, line 94` cuando un proceso llama `process.exit(0)` con sockets de `fetch`
 * todavia cerrandose. Medido en esta maquina: 12 de 12 corridas contra el emulador FALSO, y
 * 0 de 15 contra el emulador de verdad. Es del runtime, no del seed: se reproduce con un script
 * de tres lineas que solo hace `await fetch(...)` y `process.exit(0)`.
 *
 * Se normaliza SOLO para los tests contra el emulador falso. Los tests de integracion, que corren
 * contra el emulador de verdad, exigen 0 pelado.
 */
export const SALIDA_ABORTO_LIBUV = 3221226505;

export function codigoContraEmuladorFalso(r) {
  if (r.codigo === SALIDA_ABORTO_LIBUV && /UV_HANDLE_CLOSING/.test(r.error)) return 0;
  return r.codigo;
}

function fallar(mensaje, r) {
  const cola = r ? `\n--- codigo ${r.codigo}${r.expiro ? " (expiro el tiempo)" : ""} ---\n${r.todo.trim()}\n` : "";
  throw new Error(`${mensaje}${cola}`);
}

/**
 * El seed aborta porque una variable de entorno fuerza un proyecto distinto al del ERP.
 * Exige: codigo 1 exacto, la palabra ABORTADO, LOS DOS valores nombrados, la variable culpable
 * nombrada, y CERO pedidos al emulador (la barrera corre antes de tocar nada).
 */
export function verificarAbortaPorProyectoForzado(r, { proyectoErp, proyectoForzado, variable, peticiones }) {
  if (r.codigo !== 1) fallar(`se esperaba codigo de salida 1 y salio ${r.codigo}`, r);
  if (!/ABORTADO/.test(r.error)) fallar("el mensaje no dice ABORTADO", r);
  if (!new RegExp(`proyecto del ERP\\s+${escapar(proyectoErp)}\\b`).test(r.error)) {
    fallar(`el mensaje no nombra "${proyectoErp}" como proyecto del ERP`, r);
  }
  if (!new RegExp(`proyecto forzado\\s+${escapar(proyectoForzado)}\\b`).test(r.error)) {
    fallar(`el mensaje no nombra "${proyectoForzado}" como proyecto forzado`, r);
  }
  if (variable && !r.error.includes(variable)) fallar(`el mensaje no nombra la variable ${variable}`, r);
  if (peticiones && peticiones.length) {
    fallar(`el seed abortó DESPUES de hablar con el emulador: ${peticiones.length} pedidos (${peticiones.map((p) => p.url).join(", ")})`, r);
  }
}

/** El seed aborta porque faltan las variables de emulador. Cero pedidos. */
export function verificarAbortaSinVariablesDeEmulador(r, { peticiones } = {}) {
  if (r.codigo !== 1) fallar(`se esperaba codigo de salida 1 y salio ${r.codigo}`, r);
  if (!/ABORTADO: faltan/.test(r.error)) fallar("el mensaje no es el de variables de emulador faltantes", r);
  if (!/FIREBASE_AUTH_EMULATOR_HOST/.test(r.error) || !/FIRESTORE_EMULATOR_HOST/.test(r.error)) {
    fallar("el mensaje no nombra las dos variables", r);
  }
  if (peticiones && peticiones.length) fallar(`abortó DESPUES de hablar con el emulador: ${peticiones.length} pedidos`, r);
}

/** El seed aborta porque un host de emulador no es local. Cero pedidos. */
export function verificarAbortaPorEmuladorNoLocal(r, { valor, peticiones } = {}) {
  if (r.codigo !== 1) fallar(`se esperaba codigo de salida 1 y salio ${r.codigo}`, r);
  if (!/ABORTADO: el emulador de (auth|firestore) apunta a/.test(r.error)) {
    fallar("el mensaje no es el de emulador no local", r);
  }
  if (!/no es local/.test(r.error)) fallar('el mensaje no dice "no es local"', r);
  if (valor && !r.error.includes(valor)) fallar(`el mensaje no nombra el host rechazado "${valor}"`, r);
  if (peticiones && peticiones.length) fallar(`abortó DESPUES de hablar con el emulador: ${peticiones.length} pedidos`, r);
}

/** El seed aborta porque js/firebase-config.js no declara exactamente un projectId. */
export function verificarAbortaPorConfigAmbigua(r, { cantidad, peticiones } = {}) {
  if (r.codigo !== 1) fallar(`se esperaba codigo de salida 1 y salio ${r.codigo}`, r);
  if (!/ABORTADO: js\/firebase-config\.js declara/.test(r.error)) {
    fallar("el mensaje no es el de projectId ambiguo en js/firebase-config.js", r);
  }
  if (cantidad !== undefined && !new RegExp(`declara ${cantidad} projectId`).test(r.error)) {
    fallar(`el mensaje no dice que encontró ${cantidad} projectId`, r);
  }
  if (peticiones && peticiones.length) fallar(`abortó DESPUES de hablar con el emulador: ${peticiones.length} pedidos`, r);
}

/**
 * El projectId que el seed usa sale de js/firebase-config.js y de ningun otro lado.
 * Se mide contra una COPIA del arbol con un projectId inventado: si el seed lo nombra, lo leyo
 * del archivo; si nombra otra cosa, lo tiene hardcodeado o lo saca del entorno.
 */
export function verificarProyectoLeidoDelArchivo(r, valorEsperado) {
  if (!new RegExp(`proyecto del ERP\\s+${escapar(valorEsperado)}\\b`).test(r.error)) {
    fallar(`el seed no tomó el projectId de js/firebase-config.js: se esperaba "${valorEsperado}"`, r);
  }
}

/**
 * LA verificacion central de la tarea: el alcance real de lo que el seed le pidio al emulador.
 *
 * El proyecto viaja en la ruta de cada llamada REST, asi que la lista de URLs es el alcance, sin
 * interpretacion. Se exige, todo junto:
 *   1. ninguna URL menciona `delfino-hogar-erp` (ni como prefijo de otra cosa: se busca subcadena)
 *   2. todo `/projects/X` que aparezca tiene X = demo-delfino
 *   3. los DELETE son exactamente los dos endpoints de demo-delfino, y ninguno mas
 *   4. el estado del namespace protegido en el emulador falso quedo igual que antes
 */
export function verificarBarridoAcotado({ peticiones, estadoProtegidoAntes, estadoProtegidoDespues, seEsperaBorrado = true }) {
  const urls = peticiones.map((p) => `${p.metodo} ${p.url}`);

  const mencionan = urls.filter((u) => u.toLowerCase().includes(PROYECTO_PROTEGIDO));
  if (mencionan.length) {
    throw new Error(`ALCANCE ROTO: ${mencionan.length} pedidos mencionan "${PROYECTO_PROTEGIDO}":\n  ${mencionan.join("\n  ")}`);
  }

  const proyectos = [...new Set(peticiones.map((p) => p.url.match(/\/projects\/([^/?]+)/)?.[1]).filter(Boolean).map(decodeURIComponent))];
  const ajenos = proyectos.filter((p) => p !== NAMESPACE_BASURA);
  if (ajenos.length) {
    throw new Error(`ALCANCE ROTO: el seed le pidió al emulador proyectos que no son "${NAMESPACE_BASURA}": ${ajenos.join(", ")}\n  ${urls.join("\n  ")}`);
  }

  const permitidos = [
    `DELETE /emulator/v1/projects/${NAMESPACE_BASURA}/databases/(default)/documents`,
    `DELETE /emulator/v1/projects/${NAMESPACE_BASURA}/accounts`,
  ];
  const borrados = urls.filter((u) => u.startsWith("DELETE "));
  const borradosProhibidos = borrados.filter((u) => !permitidos.includes(u));
  if (borradosProhibidos.length) {
    throw new Error(`ALCANCE ROTO: hubo borrados fuera de los dos endpoints de "${NAMESPACE_BASURA}":\n  ${borradosProhibidos.join("\n  ")}`);
  }
  if (seEsperaBorrado && borrados.length !== 2) {
    throw new Error(`se esperaban los 2 borrados de "${NAMESPACE_BASURA}" y hubo ${borrados.length}:\n  ${borrados.join("\n  ")}`);
  }

  if (estadoProtegidoAntes !== undefined) {
    const antes = JSON.stringify(estadoProtegidoAntes);
    const despues = JSON.stringify(estadoProtegidoDespues);
    if (antes !== despues) {
      throw new Error(`ALCANCE ROTO: el namespace "${PROYECTO_PROTEGIDO}" cambió.\nantes:   ${antes}\ndespues: ${despues}`);
    }
  }
}

/** Ningun pedido borra nada. Se usa para "la limpieza nunca es automatica". */
export function verificarQueNoBorroNada(peticiones) {
  const borrados = peticiones.filter((p) => p.metodo === "DELETE");
  if (borrados.length) {
    throw new Error(`se esperaba CERO borrados y hubo ${borrados.length}:\n  ${borrados.map((p) => p.url).join("\n  ")}`);
  }
}

/** El reporte informa usuarios de Auth, perfiles de /usuarios y colecciones con su conteo. */
export function verificarReporte(r, { usuariosAuth, perfiles, colecciones, docsPorColeccion }) {
  const texto = r.salida;
  if (!new RegExp(`Namespace "${NAMESPACE_BASURA}"`).test(texto)) fallar(`el reporte no nombra el namespace "${NAMESPACE_BASURA}"`, r);
  if (!new RegExp(`Usuarios de Auth: ${usuariosAuth}\\b`).test(texto)) fallar(`el reporte no informa ${usuariosAuth} usuarios de Auth`, r);
  if (!new RegExp(`Perfiles en /usuarios: ${perfiles}\\b`).test(texto)) fallar(`el reporte no informa ${perfiles} perfiles en /usuarios`, r);
  if (!new RegExp(`Colecciones: ${colecciones}, documentos: \\d+`).test(texto)) fallar(`el reporte no informa ${colecciones} colecciones`, r);
  for (const [nombre, cantidad] of Object.entries(docsPorColeccion ?? {})) {
    if (!new RegExp(`${escapar(nombre)}\\s+${cantidad} docs`).test(texto)) fallar(`el reporte no informa "${nombre}" con ${cantidad} docs`, r);
  }
}

function escapar(texto) {
  return String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
