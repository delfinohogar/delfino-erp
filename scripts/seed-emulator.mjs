// Carga datos minimos en los EMULADORES para poder usar el ERP en local.
// Todos los datos son inventados. Nunca toca produccion: si las variables de emulador
// no estan puestas, aborta antes de hacer nada.
//
//   Terminal 1:  npm run emulators
//   Terminal 2:  npm run seed
//   Terminal 3:  npm run build  y despues  python dev-server.py 8090
//   Login:       admin@delfino.local / delfino-dev
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "firebase-admin";

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;

if (!AUTH || !FIRESTORE) {
  console.error("\nABORTADO: faltan FIREBASE_AUTH_EMULATOR_HOST y/o FIRESTORE_EMULATOR_HOST.\n");
  process.exit(1);
}
for (const [nombre, valor] of [["auth", AUTH], ["firestore", FIRESTORE]]) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(valor.replace(/^https?:\/\//, ""))) {
    console.error(`\nABORTADO: el emulador de ${nombre} apunta a "${valor}", que no es local.\n`);
    process.exit(1);
  }
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-delfino" });
const db = admin.firestore();
const auth = admin.auth();

const EMAIL = "admin@delfino.local";
const PASSWORD = "delfino-dev";

async function usuarioAdmin() {
  let user;
  try {
    user = await auth.getUserByEmail(EMAIL);
  } catch {
    user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: "Admin de desarrollo" });
  }
  await db.collection("usuarios").doc(user.uid).set(
    { nombre: "Admin de desarrollo", email: EMAIL, rol: "administrador", activo: true },
    { merge: true }
  );
  return user.uid;
}

// El plan de cuentas se toma del codigo real para que no se desincronice del ERP. No se puede
// importar js/contabilidad.js directo: ese modulo importa Firebase desde una URL de gstatic y
// Node no resuelve URLs en un import (solo el navegador, o vitest via alias). Asi que se lee el
// archivo como texto y se extrae el array literal.
function leerPlanDeCuentas() {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const fuente = readFileSync(join(aqui, "..", "js", "contabilidad.js"), "utf8");
  const inicio = fuente.indexOf("export const PLAN_DE_CUENTAS");
  if (inicio === -1) throw new Error("No se encontro PLAN_DE_CUENTAS en js/contabilidad.js");
  const desdeCorchete = fuente.indexOf("[", inicio);
  let nivel = 0, fin = -1;
  for (let i = desdeCorchete; i < fuente.length; i++) {
    if (fuente[i] === "[") nivel++;
    else if (fuente[i] === "]") { nivel--; if (nivel === 0) { fin = i + 1; break; } }
  }
  if (fin === -1) throw new Error("No se pudo delimitar el array PLAN_DE_CUENTAS");
  return new Function(`return ${fuente.slice(desdeCorchete, fin)};`)();
}

async function planDeCuentas() {
  const cuentas = leerPlanDeCuentas();
  const batch = db.batch();
  for (const cuenta of cuentas) batch.set(db.collection("cuentasContables").doc(cuenta.codigo), cuenta);
  await batch.commit();
  return cuentas.length;
}

async function maestros(uid) {
  const ahora = admin.firestore.FieldValue.serverTimestamp();
  const base = { creadoPor: uid, creadoEn: ahora };

  await db.collection("sucursales").doc("solano").set({ nombre: "Solano", direccion: "Av. Juan Domingo Perón 4464", ...base });
  await db.collection("depositos").doc("principal").set({ nombre: "Depósito principal", sucursalId: "solano", ...base });
  await db.collection("listasPrecios").doc("presencial").set({ nombre: "Venta presencial", porDefecto: true, ...base });
  await db.collection("marcas").doc("generica").set({ nombre: "Genérica", nombreLower: "genérica", ...base });
  await db.collection("categorias").doc("electro").set({ nombre: "Electrodomésticos", nombreLower: "electrodomésticos", nivel: 1, parentId: null, ...base });

  const productos = [
    { sku: "DEV-001", descripcion: "Heladera de prueba", precioVenta: 850000, costoReferencia: 600000, stockTotal: 5 },
    { sku: "DEV-002", descripcion: "Lavarropas de prueba", precioVenta: 620000, costoReferencia: 430000, stockTotal: 1 },
    { sku: "DEV-003", descripcion: "Microondas de prueba", precioVenta: 190000, costoReferencia: 130000, stockTotal: 0 },
  ];
  for (const p of productos) {
    await db.collection("productos").doc(p.sku).set({
      ...p,
      descripcionLower: p.descripcion.toLowerCase(),
      marcaNombre: "Genérica",
      categoriaId: "electro",
      estado: "activo",
      ...base,
    });
  }

  await db.collection("clientes").doc("cliente-dev").set(
    { razonSocial: "Cliente de prueba", razonSocialLower: "cliente de prueba", cuit: "20111111112", email: "cliente@delfino.local", activo: true, ...base }
  );

  await db.collection("contadores").doc("ventas").set({ ultimo: 0 });
  await db.collection("contadores").doc("asientos").set({ ultimo: 0 });
  await db.collection("contadores").doc("comprobantes").set({ ultimo: 0 });

  return productos.length;
}

try {
  const uid = await usuarioAdmin();
  const cuentas = await planDeCuentas();
  const cantProductos = await maestros(uid);

  console.log(`
Emulador cargado.
  usuario     ${EMAIL} / ${PASSWORD}  (rol administrador, uid ${uid})
  cuentas     ${cuentas} del plan de cuentas real
  maestros    1 sucursal, 1 depósito, 1 lista de precios, 1 marca, 1 categoría, ${cantProductos} productos, 1 cliente
  contadores  ventas, asientos y comprobantes en 0

  Stock preparado para probar invariantes:
    DEV-001 stock 5  -> VENTA_NORMAL
    DEV-002 stock 1  -> CONCURRENCIA / STOCK_INSUFICIENTE
    DEV-003 stock 0  -> STOCK_INSUFICIENTE

  UI del emulador: http://127.0.0.1:4000
`);
  process.exit(0);
} catch (err) {
  console.error("\nFALLO EL SEED:", err?.message || err);
  console.error(err?.stack || "");
  process.exit(1);
}