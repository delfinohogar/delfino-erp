// Lectura del emulador de Firebase por REST, con el token "owner" que solo el emulador acepta.
//
// Por que REST y no el Admin SDK: el proyecto viaja en la URL, asi que lo que se lee queda
// acotado al namespace nombrado y NO depende de GCLOUD_PROJECT ni de ninguna otra variable de
// entorno. Es el canal independiente que usan los tests de TASK-013 para medir el estado del
// emulador sin que la medicion comparta ninguna capa con lo que se esta midiendo.
//
// Este modulo SOLO LEE. No tiene ninguna funcion que borre nada, a proposito: el unico borrado
// que hacen los tests es el de su propio namespace efimero, y esta escrito aparte y a la vista.

const CABECERAS = { Authorization: "Bearer owner", "Content-Type": "application/json" };

export function urlBase(host) {
  if (!host) throw new Error("[INFRAESTRUCTURA] falta el host del emulador");
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}

async function pedir(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { ...CABECERAS, ...(opciones.headers || {}) } });
  if (!r.ok) throw new Error(`${opciones.method || "GET"} ${url} -> ${r.status} ${await r.text()}`);
  const texto = await r.text();
  return texto ? JSON.parse(texto) : {};
}

/** Ordena las claves de un objeto recursivamente, para que JSON.stringify sea estable. */
export function ordenarProfundo(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarProfundo);
  if (valor && typeof valor === "object") {
    const salida = {};
    for (const clave of Object.keys(valor).sort()) salida[clave] = ordenarProfundo(valor[clave]);
    return salida;
  }
  return valor;
}

async function documentosDe(baseFirestore, proyecto, rutaPadre, coleccion) {
  const documentos = [];
  let pageToken;
  do {
    const url =
      `${baseFirestore}/v1/projects/${proyecto}/databases/(default)/documents` +
      `${rutaPadre}/${encodeURIComponent(coleccion)}?pageSize=300` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const pagina = await pedir(url);
    documentos.push(...(pagina.documents ?? []));
    pageToken = pagina.nextPageToken;
  } while (pageToken);
  return documentos;
}

async function idsDeColeccion(baseFirestore, proyecto, rutaPadre) {
  const url =
    `${baseFirestore}/v1/projects/${proyecto}/databases/(default)/documents${rutaPadre}` +
    `:listCollectionIds`;
  const { collectionIds = [] } = await pedir(url, { method: "POST", body: "{}" });
  return [...collectionIds].sort();
}

/**
 * Inventario COMPLETO y determinista de un namespace del emulador: usuarios de Auth, colecciones,
 * documentos con todos sus campos y sus createTime/updateTime, y subcolecciones (un nivel).
 *
 * Los tiempos se incluyen a proposito: si el seed reescribe un documento con el mismo contenido,
 * el contenido no cambia pero `updateTime` si. Sin ellos, "no lo toque" seria indistinguible de
 * "lo reescribi igual", y la consigna es dejar `delfino-hogar-erp` como estaba.
 */
export async function inventarioNamespace(baseFirestore, baseAuth, proyecto) {
  const colecciones = [];
  for (const nombre of await idsDeColeccion(baseFirestore, proyecto, "")) {
    const documentos = await documentosDe(baseFirestore, proyecto, "", nombre);
    const docs = [];
    for (const d of documentos) {
      const id = d.name.split("/").pop();
      const subNombres = await idsDeColeccion(baseFirestore, proyecto, `/${nombre}/${id}`);
      const subcolecciones = [];
      for (const sub of subNombres) {
        const subDocs = await documentosDe(baseFirestore, proyecto, `/${nombre}/${id}`, sub);
        subcolecciones.push({
          nombre: sub,
          docs: subDocs
            .map((s) => ({
              id: s.name.split("/").pop(),
              fields: s.fields ?? {},
              createTime: s.createTime ?? null,
              updateTime: s.updateTime ?? null,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        });
      }
      docs.push({
        id,
        fields: d.fields ?? {},
        createTime: d.createTime ?? null,
        updateTime: d.updateTime ?? null,
        subcolecciones,
      });
    }
    docs.sort((a, b) => a.id.localeCompare(b.id));
    colecciones.push({ nombre, docs });
  }

  const usuarios = [];
  let nextPageToken;
  do {
    const url =
      `${baseAuth}/identitytoolkit.googleapis.com/v1/projects/${proyecto}/accounts:batchGet` +
      `?maxResults=500` + (nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "");
    const pagina = await pedir(url);
    usuarios.push(...(pagina.users ?? []));
    nextPageToken = pagina.nextPageToken;
  } while (nextPageToken);
  usuarios.sort((a, b) => String(a.localId).localeCompare(String(b.localId)));

  return ordenarProfundo({
    proyecto,
    usuariosAuth: usuarios,
    colecciones,
    totalDocs: colecciones.reduce((n, c) => n + c.docs.length, 0),
  });
}

/** Huella textual estable de un inventario: dos huellas iguales = mismo estado. */
export function huella(inventario) {
  return JSON.stringify(inventario, null, 1);
}

/**
 * Campos de Auth que el emulador cambia solo con leerlos o con el paso del tiempo.
 * Se excluyen unicamente para el assert de idempotencia, NUNCA para la comparacion de
 * `delfino-hogar-erp`, que se compara entera.
 */
export const CAMPOS_AUTH_VOLATILES = ["lastLoginAt", "lastRefreshAt", "createdAt", "validSince", "passwordUpdatedAt", "passwordHash", "salt"];
