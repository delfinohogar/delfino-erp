// Emulador de Firebase FALSO: un servidor HTTP en 127.0.0.1 que habla lo justo del protocolo REST
// del emulador (listCollectionIds, listado de documentos, accounts:batchGet y los dos endpoints
// /emulator/v1/ de borrado) y que ANOTA CADA PEDIDO que recibe.
//
// Por que existe: la pregunta central de TASK-013 es "?a que namespace puede llegar el barrido?".
// Contra el emulador de verdad esa pregunta solo se puede contestar borrando cosas. Contra este
// servidor se contesta leyendo la lista de URLs que el seed pidio, sin poner en riesgo ni un dato:
// el proyecto viaja en la ruta de cada llamada, asi que la lista de URLs ES el alcance real.
//
// Que NO es: no habla gRPC, asi que el Admin SDK de Firestore no funciona contra el. Solo sirve
// para los modos --reporte-demo y --limpiar-demo-delfino, que van por REST. El camino feliz del
// seed se prueba contra el emulador de verdad, en tests/integration/.
//
// Escucha en el puerto 0 (efimero) y en 127.0.0.1: pasa la barrera "el emulador tiene que ser
// local" del seed sin que haya que aflojarla, y no depende de ningun servicio externo.
import { createServer } from "node:http";

/** Estado inicial de un namespace del emulador falso. */
export function namespaceFalso({ colecciones = {}, usuarios = [] } = {}) {
  return { colecciones: structuredClone(colecciones), usuarios: structuredClone(usuarios) };
}

/**
 * Levanta el emulador falso.
 *
 * `opciones.despuesDeResponder(metodo, url, estado)` se invoca DENTRO del mismo pedido, despues de
 * calcular la respuesta y antes de mandarla. Sirve para simular emuladores que se portan mal —por
 * ejemplo uno que acepta el DELETE pero no lo aplica— de forma DETERMINISTA. Simular eso con un
 * `setInterval` que repone el estado por afuera es una carrera: si el temporizador no llega a
 * dispararse entre el borrado y el re-inventario del seed, el test pasa por casualidad. Medido en
 * TASK-013: con temporizador, 2 de 6 corridas en rojo; con este gancho, 0 de N.
 *
 * @param {Record<string, {colecciones: Record<string, Array<{id: string, fields?: object}>>, usuarios: Array<object>}>} estadoInicial
 * @param {{despuesDeResponder?: (metodo: string, url: string, estado: object) => void}} opciones
 * @returns {Promise<{host: string, peticiones: Array<{metodo: string, url: string}>, estado: object, cerrar: () => Promise<void>}>}
 */
export async function levantarEmuladorFalso(estadoInicial = {}, { despuesDeResponder } = {}) {
  const estado = structuredClone(estadoInicial);
  /** @type {Array<{metodo: string, url: string}>} */
  const peticiones = [];

  const servidor = createServer((req, res) => {
    peticiones.push({ metodo: req.method, url: req.url });
    req.resume();
    req.on("end", () => {
      const { status, cuerpo } = responder(req.method, req.url, estado);
      if (despuesDeResponder) despuesDeResponder(req.method, req.url, estado);
      // `Connection: close` a proposito. Con keep-alive, el pool de undici del proceso hijo se
      // queda con sockets vivos contra este servidor y el `process.exit(0)` del seed dispara en
      // Windows/Node 24 la asercion de libuv `!(handle->flags & UV_HANDLE_CLOSING)`, que
      // convierte una corrida exitosa en un codigo de salida 3221226505. Medido: 12 de 12
      // corridas con keep-alive, 0 de 12 sin el. Contra el emulador de verdad no pasa (0 de 5).
      // Es un artefacto de este servidor de prueba, no del seed, y aca se elimina en vez de
      // dejar que ensucie los asserts de codigo de salida.
      res.writeHead(status, { "Content-Type": "application/json", Connection: "close" });
      res.end(JSON.stringify(cuerpo));
    });
  });

  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  const { port } = servidor.address();

  return {
    host: `127.0.0.1:${port}`,
    peticiones,
    estado,
    /** Todos los proyectos que aparecieron en alguna URL, en orden de aparicion. */
    proyectosTocados() {
      const vistos = [];
      for (const p of peticiones) {
        const m = p.url.match(/\/projects\/([^/?]+)/);
        if (m && !vistos.includes(m[1])) vistos.push(decodeURIComponent(m[1]));
      }
      return vistos;
    },
    /** Solo los pedidos que borran algo. */
    borrados() {
      return peticiones.filter((p) => p.metodo === "DELETE");
    },
    cerrar: () => new Promise((listo) => servidor.close(listo)),
  };
}

function responder(metodo, url, estado) {
  const ruta = url.split("?")[0];

  const proyecto = decodeURIComponent(ruta.match(/\/projects\/([^/]+)/)?.[1] ?? "");
  const ns = (estado[proyecto] ??= { colecciones: {}, usuarios: [] });

  // --- borrado (solo existe en los emuladores) ---
  if (metodo === "DELETE" && /^\/emulator\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents$/.test(ruta)) {
    ns.colecciones = {};
    return { status: 200, cuerpo: {} };
  }
  if (metodo === "DELETE" && /^\/emulator\/v1\/projects\/[^/]+\/accounts$/.test(ruta)) {
    ns.usuarios = [];
    return { status: 200, cuerpo: {} };
  }

  // --- Auth ---
  if (/\/identitytoolkit\.googleapis\.com\/v1\/projects\/[^/]+\/accounts:batchGet$/.test(ruta)) {
    return { status: 200, cuerpo: { users: ns.usuarios } };
  }

  // --- Firestore ---
  if (metodo === "POST" && ruta.endsWith("/documents:listCollectionIds")) {
    return { status: 200, cuerpo: { collectionIds: Object.keys(ns.colecciones) } };
  }
  const listado = ruta.match(/\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/([^/]+)$/);
  if (metodo === "GET" && listado) {
    const coleccion = decodeURIComponent(listado[1]);
    const documentos = (ns.colecciones[coleccion] ?? []).map((d) => ({
      name: `projects/${proyecto}/databases/(default)/documents/${coleccion}/${d.id}`,
      fields: d.fields ?? {},
    }));
    return { status: 200, cuerpo: { documents: documentos } };
  }

  return { status: 200, cuerpo: {} };
}
