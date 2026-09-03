// Exportar/importar clientes de GBP vía Excel — para poder revisar y corregir los datos a mano
// antes de subirlos como clientes reales de Delfino (en vez de aplicar directo lo que trae GBP).
// Mismas columnas en export e import, así lo que se descarga es directamente la plantilla de vuelta.
import { db, collection, getDocs, doc, writeBatch, query, where, functions, httpsCallable } from "./firebase.js";
import { exportarExcel } from "./report-engine.js";
import { capitalizarDireccion, keywordsDeTextos } from "./texto.js";
import { dniDesdeCuit } from "./cuit.js";

const COLUMNAS = [
  { titulo: "ID GBP (no editar)", clave: "identificadorExterno" },
  { titulo: "Razón social", clave: "razonSocial" },
  { titulo: "CUIT/DNI", clave: "cuit" },
  { titulo: "Condición IVA", clave: "condicionIva" },
  { titulo: "Domicilio de entrega", clave: "domicilioEntrega" },
  { titulo: "Código postal", clave: "codigoPostalEntrega" },
  { titulo: "Localidad", clave: "localidadEntrega" },
  { titulo: "Provincia", clave: "provinciaEntrega" },
  { titulo: "País", clave: "paisEntrega" },
  { titulo: "WhatsApp", clave: "whatsapp" },
  { titulo: "Email", clave: "email" },
];

// Fichas livianas (clientesGbp) todavía no son clientes reales — son exactamente las que hay que
// revisar/corregir antes de subir. Devuelve cuántas se exportaron.
export async function exportarClientesGbpParaRevisar() {
  const snap = await getDocs(collection(db, "clientesGbp"));
  const filas = snap.docs.map((d) => {
    const c = d.data();
    return {
      identificadorExterno: d.id,
      razonSocial: c.nombre || "",
      cuit: c.cuit || "",
      condicionIva: "",
      domicilioEntrega: c.domicilio || "",
      codigoPostalEntrega: c.codigoPostal || "",
      localidadEntrega: c.ciudad || "",
      provinciaEntrega: "Buenos Aires",
      paisEntrega: "Argentina",
      whatsapp: c.telefono || "",
      email: c.email || "",
    };
  });
  exportarExcel("Delfino_Clientes_GBP_para_revisar.xlsx", COLUMNAS, filas);
  return filas.length;
}

// Universo COMPLETO de GBP (~31.000, no solo los que ya compraron recientemente) — la Cloud Function
// trae y mapea las filas (necesita las credenciales de GBP, que solo existen del lado del servidor);
// el .xlsx en sí se arma acá con el mismo motor que exportarClientesGbpParaRevisar, misma plantilla.
// Devuelve cuántas filas se exportaron.
export async function exportarTodosLosClientesGbp() {
  const fn = httpsCallable(functions, "gbpExportarTodosLosClientes", { timeout: 280000 });
  const { data } = await fn();
  exportarExcel("Delfino_Clientes_GBP_completo.xlsx", COLUMNAS, data.filas);
  return data.total;
}

// Lee las filas ya parseadas de la hoja (XLSX.utils.sheet_to_json) y las valida — no escribe nada.
export function prepararImportacionClientes(filas) {
  const claves = {
    "ID GBP (no editar)": "identificadorExterno",
    "Razón social": "razonSocial",
    "CUIT/DNI": "cuit",
    "Condición IVA": "condicionIva",
    "Domicilio de entrega": "domicilioEntrega",
    "Código postal": "codigoPostalEntrega",
    Localidad: "localidadEntrega",
    Provincia: "provinciaEntrega",
    País: "paisEntrega",
    WhatsApp: "whatsapp",
    Email: "email",
  };
  const validas = [];
  const sinId = [];
  const sinNombre = [];
  filas.forEach((fila, i) => {
    const c = {};
    for (const [colTitulo, campo] of Object.entries(claves)) {
      c[campo] = String(fila[colTitulo] ?? "").trim();
    }
    if (!c.identificadorExterno) {
      sinId.push({ fila: i + 2 });
      return;
    }
    if (!c.razonSocial) {
      sinNombre.push({ fila: i + 2, identificadorExterno: c.identificadorExterno });
      return;
    }
    // GBP guarda domicilio/localidad en mayúsculas — se capitaliza acá, en el último paso antes de
    // escribir, para que quede bien sin importar de qué exportación haya salido el Excel (misma
    // función que ya usa la carga manual de clientes, ver js/clientes.js).
    c.domicilioEntrega = capitalizarDireccion(c.domicilioEntrega);
    c.localidadEntrega = capitalizarDireccion(c.localidadEntrega);
    validas.push(c);
  });
  return { validas, sinId, sinNombre };
}

// Crea o actualiza (upsert por identificadorExterno) — nunca duplica: si ya existe un cliente con
// ese ID de GBP, lo actualiza en vez de crear uno nuevo (mismo criterio que el resto de la
// integración). Devuelve { creados, actualizados }.
export async function confirmarImportacionClientes(clientesValidos, onProgreso = () => {}) {
  onProgreso("Revisando clientes ya vinculados…");
  const existentesSnap = await getDocs(query(collection(db, "clientes"), where("identificadorExterno", "!=", null)));
  const idPorExterno = new Map();
  existentesSnap.forEach((d) => {
    const idExt = d.data().identificadorExterno;
    if (idExt) idPorExterno.set(String(idExt), d.id);
  });

  let creados = 0;
  let actualizados = 0;
  const TAMANO_TANDA = 400;
  for (let i = 0; i < clientesValidos.length; i += TAMANO_TANDA) {
    onProgreso(`Guardando ${Math.min(i + TAMANO_TANDA, clientesValidos.length)} de ${clientesValidos.length}…`);
    const batch = writeBatch(db);
    for (const c of clientesValidos.slice(i, i + TAMANO_TANDA)) {
      const datos = {
        razonSocial: c.razonSocial,
        razonSocialLower: c.razonSocial.toLowerCase(),
        searchKeywords: keywordsDeTextos(c.razonSocial),
        cuit: c.cuit || "",
        dni: dniDesdeCuit(c.cuit),
        condicionIva: c.condicionIva || null,
        domicilioEntrega: c.domicilioEntrega || null,
        codigoPostalEntrega: c.codigoPostalEntrega || null,
        localidadEntrega: c.localidadEntrega || null,
        provinciaEntrega: c.provinciaEntrega || "Buenos Aires",
        paisEntrega: c.paisEntrega || "Argentina",
        whatsapp: c.whatsapp || null,
        email: c.email || null,
        fuenteDatos: "gbp",
        identificadorExterno: c.identificadorExterno,
        activo: true,
      };
      const idExistente = idPorExterno.get(c.identificadorExterno);
      if (idExistente) {
        batch.set(doc(db, "clientes", idExistente), datos, { merge: true });
        actualizados++;
      } else {
        batch.set(doc(collection(db, "clientes")), datos);
        creados++;
      }
    }
    await batch.commit();
  }
  onProgreso("");
  return { creados, actualizados };
}
