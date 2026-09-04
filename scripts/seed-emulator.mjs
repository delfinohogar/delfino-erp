// Carga datos minimos en los EMULADORES para poder usar el ERP en local.
// Todos los datos son inventados. Nunca toca produccion: si las variables de emulador
// no estan puestas, aborta antes de hacer nada.
//
//   Terminal 1:  npm run emulators
//   Terminal 2:  npm run seed
//   Terminal 3:  python dev-server.py 8090   ->  http://localhost:8090
//   Login:       admin@delfino.local / delfino-dev
import admin from "firebase-admin";

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;

if (!AUTH || !FIRESTORE) {
  console.error(
    "\nABORTADO: faltan FIREBASE_AUTH_EMULATOR_HOST y/o FIRESTORE_EMULATOR_HOST.\n" +
      "Este script solo puede correr contra los emuladores.\n" +
      "Levantalos con: npm run emulators\n" +
      "Si corres a mano fuera de Claude Code, cargá las variables de backend/.env.example.\n"
  );
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

// Plan de cuentas: se toma del codigo real para que no se desincronice del ERP.
async function planDeCuentas() {
  const { PLAN_DE_CUENTAS } = await import("../js/contabilidad.js");
  const batch = db.batch();
  for (const cuenta of PLAN_DE_CUENTAS) batch.set(db.collection("cuentasContables").doc(cuenta.codigo), cuenta);
  await batch.commit();
  return PLAN_DE_CUENTAS.length;
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
    { sku: "DEV-001", descripcion: "Heladera de prueba", precio: 850000, costoReferencia: 600000, stockTotal: 5 },
    { sku: "DEV-002", descripcion: "Lavarropas de prueba", precio: 620000, costoReferencia: 430000, stockTotal: 1 },
    { sku: "DEV-003", descripcion: "Microondas de prueba", precio: 190000, costoReferencia: 130000, stockTotal: 0 },
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
    { nombre: "Cliente de prueba", documento: "20111111112", email: "cliente@delfino.local", ...base }
  );

  await db.collection("contadores").doc("ventas").set({ ultimo: 0 });
  await db.collection("contadores").doc("asientos").set({ ultimo: 0 });
  await db.collection("contadores").doc("comprobantes").set({ ultimo: 0 });

  return productos.length;
}

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
