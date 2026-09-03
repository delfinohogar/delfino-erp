// Contabilidad por partida doble: plan de cuentas simple pero correcto para Delfino Hogar, y un
// motor de asientos que ventas.js/compras.js/cobros.js/pagos.js llaman después de cada operación
// real — así el Libro Diario nunca se desincroniza de lo que pasa en el resto del sistema.
//
// Simplificaciones conocidas de este alcance v1 (documentadas, no escondidas):
// - No hay asiento de apertura de capital: Patrimonio Neto queda en 0 hasta que se cargue a mano.
// - Sin ajuste por inflación (RT6/FACPCE) ni centros de costo — quedan para más adelante si hacen falta.
import { db, collection, doc, getDoc, getDocs, setDoc, addDoc, query, where, orderBy, limit, startAfter, serverTimestamp, runTransaction } from "./firebase.js";

// { codigo, nombre, tipo: activo|pasivo|patrimonio|ingreso|egreso, padre, imputable }
// imputable=false son agrupadoras (no reciben movimientos directos, solo ordenan el árbol).
export const PLAN_DE_CUENTAS = [
  { codigo: "1", nombre: "Activo", tipo: "activo", padre: null, imputable: false },
  { codigo: "1.1", nombre: "Activo Corriente", tipo: "activo", padre: "1", imputable: false },
  { codigo: "1.1.1", nombre: "Caja y Bancos", tipo: "activo", padre: "1.1", imputable: true },
  { codigo: "1.1.2", nombre: "Deudores por Ventas", tipo: "activo", padre: "1.1", imputable: true },
  { codigo: "1.1.3", nombre: "Bienes de Cambio", tipo: "activo", padre: "1.1", imputable: true },
  { codigo: "1.1.4", nombre: "IVA Crédito Fiscal", tipo: "activo", padre: "1.1", imputable: true },
  // Plata ya cobrada al cliente pero que todavía no está disponible: tarjeta de crédito, Mercado
  // Pago, GoCuotas, Boston Cred. Es la contraparte contable de /cuentasPorCobrar en Tesorería —
  // antes esto se debitaba a Caja y Bancos, que sobrestimaba el disponible.
  { codigo: "1.1.5", nombre: "Deudores por Tarjetas y Acreditaciones", tipo: "activo", padre: "1.1", imputable: true },
  { codigo: "2", nombre: "Pasivo", tipo: "pasivo", padre: null, imputable: false },
  { codigo: "2.1", nombre: "Pasivo Corriente", tipo: "pasivo", padre: "2", imputable: false },
  { codigo: "2.1.1", nombre: "Proveedores", tipo: "pasivo", padre: "2.1", imputable: true },
  // El IVA que se cobró en cada venta — se le debe a AFIP, no es ingreso propio. Antes de esto,
  // ventas.js debitaba el total (con IVA adentro) directo a "Ventas", así que el ingreso quedaba
  // sobrestimado por el IVA de cada venta. Ver discriminarIva() más abajo.
  { codigo: "2.1.2", nombre: "IVA Débito Fiscal", tipo: "pasivo", padre: "2.1", imputable: true },
  // Retenciones que Delfino, como agente de retención, le practica a un proveedor al cargar su
  // factura de compra — no es plata que se le vaya a pagar al proveedor, sino que hay que depositarla
  // en AFIP/ARBA a su nombre. Ver js/compras.js: crearCompra.
  { codigo: "2.1.3", nombre: "Retención de IVA a depositar", tipo: "pasivo", padre: "2.1", imputable: true },
  { codigo: "2.1.4", nombre: "Retención de Ganancias a depositar", tipo: "pasivo", padre: "2.1", imputable: true },
  { codigo: "2.1.5", nombre: "Retención de IIBB a depositar", tipo: "pasivo", padre: "2.1", imputable: true },
  { codigo: "3", nombre: "Patrimonio Neto", tipo: "patrimonio", padre: null, imputable: false },
  { codigo: "3.1", nombre: "Capital", tipo: "patrimonio", padre: "3", imputable: true },
  { codigo: "3.2", nombre: "Resultados Acumulados", tipo: "patrimonio", padre: "3", imputable: true },
  { codigo: "4", nombre: "Ingresos", tipo: "ingreso", padre: null, imputable: false },
  { codigo: "4.1", nombre: "Ventas", tipo: "ingreso", padre: "4", imputable: true },
  { codigo: "5", nombre: "Egresos", tipo: "egreso", padre: null, imputable: false },
  { codigo: "5.1", nombre: "Costo de Mercadería Vendida", tipo: "egreso", padre: "5", imputable: true },
  { codigo: "5.2", nombre: "Gastos Generales", tipo: "egreso", padre: "5", imputable: true },
];

// Códigos fijos que usan las funciones de asiento automático — un solo lugar para tocar si algún
// día cambia el plan de cuentas.
export const CUENTA = {
  CAJA: "1.1.1",
  DEUDORES_VENTAS: "1.1.2",
  BIENES_DE_CAMBIO: "1.1.3",
  IVA_CREDITO_FISCAL: "1.1.4",
  DEUDORES_TARJETAS: "1.1.5",
  PROVEEDORES: "2.1.1",
  IVA_DEBITO_FISCAL: "2.1.2",
  RETENCION_IVA: "2.1.3",
  RETENCION_GANANCIAS: "2.1.4",
  RETENCION_IIBB: "2.1.5",
  VENTAS: "4.1",
  COSTO_MERCADERIA_VENDIDA: "5.1",
  GASTOS_GENERALES: "5.2",
};

// A qué cuenta contable corresponde cada destino de Tesorería. Un solo lugar para que el asiento y
// el ruteo de la plata no se puedan contradecir (ver js/ventas.js: el asiento se arma con el mismo
// resultado del ruteo, no con una suposición aparte).
export function cuentaParaDestinoTesoreria(destino) {
  if (destino === "caja" || destino === "banco") return CUENTA.CAJA; // 1.1.1 es "Caja y Bancos"
  if (destino === "cuentaPorCobrar") return CUENTA.DEUDORES_TARJETAS;
  return null; // medio sin destino definido — el que llama decide qué hacer, no se asume Caja
}

// Idempotente (setDoc con merge) — se puede correr de nuevo sin duplicar ni pisar cuentas creadas
// a mano más adelante.
export async function sembrarPlanDeCuentas() {
  for (const cuenta of PLAN_DE_CUENTAS) {
    await setDoc(doc(db, "cuentasContables", cuenta.codigo), cuenta, { merge: true });
  }
}

export async function listarPlanDeCuentas() {
  const snap = await getDocs(query(collection(db, "cuentasContables"), orderBy("codigo")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ventas/compras guardan fecha como string "YYYY-MM-DD"; cobros/pagos la guardan como Date (por
// arrastre del patrón de pagosProveedores). Los asientos necesitan un formato único para que los
// rangos de fecha de Estado de Resultados comparen todo igual — se normaliza acá, una sola vez.
export function normalizarFecha(fecha) {
  if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
  return fecha;
}

// Los precios de venta al público ya incluyen el IVA (así se cargan en productos.js: campo `iva`,
// mismo criterio que usa el cálculo de margen ahí) — discriminarlo es "restar hacia atrás", no
// sumarlo. Usado por facturacion.js (comprobantes) y ventas.js (asiento) para que ambos calculen
// el mismo neto/IVA a partir del mismo monto, sin duplicar la fórmula en dos lugares.
export function discriminarIva(montoConIva, ivaPct) {
  const alicuota = ivaPct ?? 21;
  const neto = alicuota > 0 ? montoConIva / (1 + alicuota / 100) : montoConIva;
  return { neto: Math.round(neto * 100) / 100, iva: Math.round((montoConIva - neto) * 100) / 100 };
}

async function siguienteNumeroAsiento() {
  const contadorRef = doc(db, "contadores", "asientos");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(contadorRef);
    const ultimo = snap.exists() ? snap.data().ultimo || 0 : 0;
    const siguiente = ultimo + 1;
    tx.set(contadorRef, { ultimo: siguiente });
    return siguiente;
  });
}

// movimientos: [{ cuenta: codigo, debe, haber }] — se valida que sume balanceado (debe === haber)
// antes de escribir nada; un asiento que no cierra es un bug de quien lo generó, no algo a guardar.
export async function generarAsiento({ fecha, descripcion, origen, movimientos }, usuario) {
  const totalDebe = movimientos.reduce((acc, m) => acc + (m.debe || 0), 0);
  const totalHaber = movimientos.reduce((acc, m) => acc + (m.haber || 0), 0);
  if (Math.round((totalDebe - totalHaber) * 100) !== 0) {
    throw new Error(`Asiento no balanceado: Debe ${totalDebe} vs. Haber ${totalHaber} (${descripcion}).`);
  }

  const numero = await siguienteNumeroAsiento();
  await addDoc(collection(db, "asientosContables"), {
    numero,
    fecha: normalizarFecha(fecha),
    descripcion,
    origen,
    movimientos: movimientos.filter((m) => (m.debe || 0) > 0 || (m.haber || 0) > 0),
    usuario: usuario.uid,
    creadoEn: serverTimestamp(),
  });
}

export async function listarAsientos(maxResultados = 200) {
  const snap = await getDocs(query(collection(db, "asientosContables"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Una página de asientos para el Libro Diario, que se lee de a tandas en vez de traer todo.
// Devuelve el cursor para pedir la siguiente y si quedan más — así la pantalla puede ofrecer
// "Cargar más" en lugar de cortar en 200 sin decir nada (que era el bug).
export async function listarAsientosPagina({ cursor = null, tamanio = 100 } = {}) {
  const clausulas = [orderBy("creadoEn", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(tamanio + 1)];
  const snap = await getDocs(query(collection(db, "asientosContables"), ...clausulas));
  const docs = snap.docs.slice(0, tamanio);
  return {
    asientos: docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: docs.length > 0 ? docs[docs.length - 1] : null,
    hayMas: snap.docs.length > tamanio,
  };
}

// TODOS los asientos, paginando de a 500. Libro Mayor y Sumas y Saldos son acumulados históricos:
// si se truncan, los saldos quedan mal SIN avisar (era el bug: se pedían los últimos 1000 y listo).
// Es más caro que un limit fijo, pero es la única forma de que un balance sea correcto.
export async function listarTodosLosAsientos() {
  const TAMANIO_PAGINA = 500;
  const asientos = [];
  let ultimo = null;
  for (;;) {
    const clausulas = [orderBy("creadoEn", "desc"), ...(ultimo ? [startAfter(ultimo)] : []), limit(TAMANIO_PAGINA)];
    const snap = await getDocs(query(collection(db, "asientosContables"), ...clausulas));
    if (snap.empty) break;
    asientos.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (snap.docs.length < TAMANIO_PAGINA) break;
    ultimo = snap.docs[snap.docs.length - 1];
  }
  return asientos;
}

// Los asientos de una operación puntual (venta, compra, cobro, pago) — para mostrar "cómo impactó
// esto en la contabilidad" en la ficha de esa operación, sin tener que traer las 200/1000 últimas.
export async function listarAsientosPorOrigen(origenId) {
  const snap = await getDocs(query(collection(db, "asientosContables"), where("origen.id", "==", origenId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Movimientos de una cuenta puntual, en orden cronológico, con saldo corrido — el signo del saldo
// depende del tipo de cuenta (activo/egreso suman con el debe; pasivo/patrimonio/ingreso con el haber).
export async function obtenerLibroMayor(codigoCuenta) {
  const cuentaSnap = await getDoc(doc(db, "cuentasContables", codigoCuenta));
  const cuenta = cuentaSnap.exists() ? cuentaSnap.data() : null;
  const naturalezaDebe = cuenta ? ["activo", "egreso"].includes(cuenta.tipo) : true;

  const asientos = await listarTodosLosAsientos();
  const movimientos = [];
  asientos.forEach((a) => {
    (a.movimientos || []).forEach((m) => {
      if (m.cuenta !== codigoCuenta) return;
      movimientos.push({ fecha: a.fecha, descripcion: a.descripcion, numero: a.numero, debe: m.debe || 0, haber: m.haber || 0 });
    });
  });
  movimientos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.numero - b.numero));

  let saldo = 0;
  movimientos.forEach((m) => {
    saldo += naturalezaDebe ? m.debe - m.haber : m.haber - m.debe;
    m.saldo = Math.round(saldo * 100) / 100;
  });

  return { cuenta, movimientos };
}

// Sumas y saldos: para cada cuenta imputable, cuánto acumuló de debe/haber y su saldo, con el mismo
// criterio de naturaleza que el Libro Mayor. Las agrupadoras (imputable=false) muestran el subtotal
// de todas sus cuentas descendientes, para que el árbol también sirva como resumen por rubro.
export async function obtenerSumasYSaldos() {
  const [cuentas, asientos] = await Promise.all([listarPlanDeCuentas(), listarTodosLosAsientos()]);
  const totales = {};
  cuentas.forEach((c) => (totales[c.codigo] = { debe: 0, haber: 0 }));
  asientos.forEach((a) => {
    (a.movimientos || []).forEach((m) => {
      if (!totales[m.cuenta]) return;
      totales[m.cuenta].debe += m.debe || 0;
      totales[m.cuenta].haber += m.haber || 0;
    });
  });

  // Subtotales de agrupadoras: cada cuenta suma el debe/haber de toda cuenta cuyo código empieza
  // con "<código>." (sus descendientes directos e indirectos).
  cuentas
    .filter((c) => !c.imputable)
    .forEach((padre) => {
      cuentas
        .filter((c) => c.imputable && c.codigo.startsWith(padre.codigo + "."))
        .forEach((hijo) => {
          totales[padre.codigo].debe += totales[hijo.codigo].debe;
          totales[padre.codigo].haber += totales[hijo.codigo].haber;
        });
    });

  return cuentas.map((c) => {
    const t = totales[c.codigo];
    const naturalezaDebe = ["activo", "egreso"].includes(c.tipo);
    const saldo = naturalezaDebe ? t.debe - t.haber : t.haber - t.debe;
    return { ...c, debe: Math.round(t.debe * 100) / 100, haber: Math.round(t.haber * 100) / 100, saldo: Math.round(saldo * 100) / 100 };
  });
}

// Estado de resultados de un período: Ingresos - Egresos = Resultado. Solo mira asientos con fecha
// en el rango (a diferencia de Sumas y Saldos, que es acumulado histórico).
export async function obtenerEstadoResultados(desde, hasta) {
  const [cuentas, snap] = await Promise.all([
    listarPlanDeCuentas(),
    getDocs(query(collection(db, "asientosContables"), where("fecha", ">=", desde), where("fecha", "<=", hasta))),
  ]);
  const asientos = snap.docs.map((d) => d.data());
  const totales = {};
  cuentas
    .filter((c) => c.imputable && (c.tipo === "ingreso" || c.tipo === "egreso"))
    .forEach((c) => (totales[c.codigo] = { ...c, monto: 0 }));

  asientos.forEach((a) => {
    (a.movimientos || []).forEach((m) => {
      if (!totales[m.cuenta]) return;
      const cuenta = totales[m.cuenta];
      totales[m.cuenta].monto += cuenta.tipo === "ingreso" ? (m.haber || 0) - (m.debe || 0) : (m.debe || 0) - (m.haber || 0);
    });
  });

  const ingresos = Object.values(totales).filter((c) => c.tipo === "ingreso");
  const egresos = Object.values(totales).filter((c) => c.tipo === "egreso");
  const totalIngresos = ingresos.reduce((acc, c) => acc + c.monto, 0);
  const totalEgresos = egresos.reduce((acc, c) => acc + c.monto, 0);

  return {
    ingresos: ingresos.map((c) => ({ ...c, monto: Math.round(c.monto * 100) / 100 })),
    egresos: egresos.map((c) => ({ ...c, monto: Math.round(c.monto * 100) / 100 })),
    totalIngresos: Math.round(totalIngresos * 100) / 100,
    totalEgresos: Math.round(totalEgresos * 100) / 100,
    resultado: Math.round((totalIngresos - totalEgresos) * 100) / 100,
  };
}
