// Importar proveedores desde el Grid Export de GBP (Excel que se descarga directo desde la pantalla
// de Proveedores en GBP — no depende del webservice, que no tiene ningún método para proveedores).
// Mismas columnas que trae ese export tal cual, sin plantilla propia — se sube el archivo de GBP
// directo, se previsualiza y se confirma. Upsert por identificadorExterno (el ID de GBP), igual
// criterio que la importación de clientes: nunca duplica si se vuelve a subir el mismo archivo.
import { db, collection, getDocs, doc, writeBatch, query, where } from "./firebase.js";

// GBP tiene esta fila fija para pagos que no son a un proveedor real (fletes/gastos varios
// cargados históricamente como si fueran un "proveedor") — nunca se importa como proveedor.
const EXCLUIR_NOMBRE = /no usar como proveedor/i;

// Lee las filas ya parseadas del Grid Export (XLSX.utils.sheet_to_json) y las valida — no escribe nada.
export function prepararImportacionProveedores(filas) {
  const validos = [];
  const excluidos = [];
  const sinDatos = [];
  filas.forEach((fila, i) => {
    const nombre = String(fila["Nombre"] ?? "").trim();
    const idExterno = String(fila["ID"] ?? "").trim();
    const cuit = String(fila["Nro Documento"] ?? "").trim();

    if (EXCLUIR_NOMBRE.test(nombre)) {
      excluidos.push({ fila: i + 2, nombre });
      return;
    }
    if (!idExterno || !nombre || !cuit) {
      sinDatos.push({ fila: i + 2, nombre: nombre || "(sin nombre)" });
      return;
    }
    validos.push({
      identificadorExterno: idExterno,
      razonSocial: nombre,
      cuit,
      condicionIva: String(fila["Clase Fiscal"] ?? "").trim() || null,
      domicilioFiscal: String(fila["Direccion"] ?? "").trim() || null,
      localidad: String(fila["Ciudad"] ?? "").trim() || null,
      codigoPostal: String(fila["Codigo Postal"] ?? "").trim() || null,
      provincia: String(fila["Provincia"] ?? "").trim() || null,
      telefono: String(fila["Telefono"] ?? "").trim() || null,
      email: String(fila["email"] ?? "").trim() || null,
    });
  });
  return { validos, excluidos, sinDatos };
}

// Crea o actualiza (upsert por identificadorExterno) — nunca duplica: si ya existe un proveedor con
// ese ID de GBP, lo actualiza en vez de crear uno nuevo (mismo criterio que confirmarImportacionClientes).
export async function confirmarImportacionProveedores(proveedoresValidos, onProgreso = () => {}) {
  onProgreso("Revisando proveedores ya vinculados…");
  const existentesSnap = await getDocs(query(collection(db, "proveedores"), where("identificadorExterno", "!=", null)));
  const idPorExterno = new Map();
  existentesSnap.forEach((d) => {
    const idExt = d.data().identificadorExterno;
    if (idExt) idPorExterno.set(String(idExt), d.id);
  });

  let creados = 0;
  let actualizados = 0;
  const TAMANO_TANDA = 400;
  for (let i = 0; i < proveedoresValidos.length; i += TAMANO_TANDA) {
    onProgreso(`Guardando ${Math.min(i + TAMANO_TANDA, proveedoresValidos.length)} de ${proveedoresValidos.length}…`);
    const batch = writeBatch(db);
    for (const p of proveedoresValidos.slice(i, i + TAMANO_TANDA)) {
      const datos = {
        razonSocial: p.razonSocial,
        razonSocialLower: p.razonSocial.toLowerCase(),
        cuit: p.cuit,
        condicionIva: p.condicionIva,
        domicilioFiscal: p.domicilioFiscal,
        localidad: p.localidad,
        codigoPostal: p.codigoPostal,
        provincia: p.provincia,
        telefono: p.telefono,
        email: p.email,
        fuenteDatos: "gbp",
        identificadorExterno: p.identificadorExterno,
        activo: true,
      };
      const idExistente = idPorExterno.get(p.identificadorExterno);
      if (idExistente) {
        batch.set(doc(db, "proveedores", idExistente), datos, { merge: true });
        actualizados++;
      } else {
        batch.set(doc(collection(db, "proveedores")), datos);
        creados++;
      }
    }
    await batch.commit();
  }
  onProgreso("");
  return { creados, actualizados };
}
