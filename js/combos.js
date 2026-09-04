// Combos: productos "compuestos" por otros productos (ej. colchón + sommier) — un combo es un
// producto más (mismo SKU, aparece en Nueva Venta como cualquier otro), pero con precio, costo y
// stock CALCULADOS a partir de sus componentes, nunca cargados a mano:
//   - precioVenta = suma de (precioVenta de cada componente × cantidad que necesita)
//   - costoReferencia = igual, con costoReferencia (para que el margen siga siendo correcto)
//   - stockTotal = mínimo entre (stock de cada componente ÷ cantidad que necesita), redondeado abajo
//     (si tengo 5 colchones y 2 sommiers, el combo "1 colchón + 1 sommier" tiene stock 2, no 5)
//
// El cálculo se hace acá al crear/editar un combo, y se vuelve a hacer SOLO cada vez que cambia el
// stock/precio/costo de cualquier componente — ver functions/combosSync.js (trigger de Firestore) —
// así el combo nunca queda desactualizado aunque nadie lo vuelva a abrir. Ver también
// js/ventas.js (crearVenta): vender un combo descuenta el stock de SUS COMPONENTES, nunca un
// stockTotal propio del combo (ese campo es un valor calculado, no la fuente de verdad).
//
// Un combo NUNCA puede tener otro combo como componente (evita ciclos en el trigger de recálculo,
// y GBP tampoco modela combos-de-combos en los ejemplos que compartió el usuario) — se valida acá
// y de nuevo del lado del trigger, por las dudas.
import { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, serverTimestamp } from "./firebase.js";

export async function calcularDerivadosCombo(componentes) {
  if (!componentes || componentes.length === 0) throw new Error("Un combo necesita al menos un componente.");
  const idsVistos = new Set();
  let precioVenta = 0;
  let costoReferencia = 0;
  let stockTotal = Infinity;
  const detalle = [];
  for (const c of componentes) {
    if (!(c.cantidad > 0)) throw new Error("La cantidad de cada componente tiene que ser mayor a 0.");
    if (idsVistos.has(c.productoId)) throw new Error("El mismo producto está dos veces en la lista de componentes — sumá la cantidad en una sola línea.");
    idsVistos.add(c.productoId);

    const snap = await getDoc(doc(db, "productos", c.productoId));
    if (!snap.exists()) throw new Error(`No se encontró el producto ${c.productoId}.`);
    const p = snap.data();
    if (p.tipoProducto === "combo") throw new Error(`"${p.descripcion}" es un combo — un combo no puede tener otro combo como componente.`);

    precioVenta += (p.precioVenta ?? 0) * c.cantidad;
    costoReferencia += (p.costoReferencia ?? 0) * c.cantidad;
    stockTotal = Math.min(stockTotal, Math.floor((p.stockTotal ?? 0) / c.cantidad));
    detalle.push({ productoId: c.productoId, sku: p.sku || "", descripcion: p.descripcion || "", cantidad: c.cantidad });
  }
  return {
    precioVenta: Math.round(precioVenta),
    costoReferencia: Math.round(costoReferencia),
    stockTotal: stockTotal === Infinity ? 0 : stockTotal,
    componentes: detalle,
  };
}

async function obtenerProductoPorSku(sku) {
  const snap = await getDocs(query(collection(db, "productos"), where("sku", "==", sku)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// datos: { sku, descripcion, componentes: [{ productoId, cantidad }] }
export async function crearCombo(datos, usuario) {
  if (!datos.sku?.trim()) throw new Error("El combo necesita un SKU.");
  if (!datos.descripcion?.trim()) throw new Error("El combo necesita una descripción.");
  const existente = await obtenerProductoPorSku(datos.sku.trim());
  if (existente) throw new Error(`Ya existe un producto con el SKU "${datos.sku.trim()}".`);

  const derivados = await calcularDerivadosCombo(datos.componentes);
  const ahora = serverTimestamp();
  const ref = await addDoc(collection(db, "productos"), {
    sku: datos.sku.trim(),
    descripcion: datos.descripcion.trim(),
    tipoProducto: "combo",
    componentes: derivados.componentes,
    componenteIds: derivados.componentes.map((c) => c.productoId),
    precioVenta: derivados.precioVenta,
    costoReferencia: derivados.costoReferencia,
    stockTotal: derivados.stockTotal,
    // Un combo puede mezclar componentes con distinta alícuota de IVA — no hay un único "IVA (%)"
    // que lo represente. Queda en null a propósito (ver arcaFacturacion.js: cuando ARCA esté activo,
    // facturar un combo va a necesitar desglosarlo en sus componentes para el detalle de IVA, igual
    // que ya hace crearVenta con el stock — no implementado todavía porque ARCA sigue inactivo).
    iva: null,
    activo: true,
    creadoPor: usuario.uid,
    creadoEn: ahora,
    modificadoPor: usuario.uid,
    modificadoEn: ahora,
  });
  return { id: ref.id };
}

export async function actualizarComponentesCombo(comboId, componentes, usuario) {
  const derivados = await calcularDerivadosCombo(componentes);
  await updateDoc(doc(db, "productos", comboId), {
    componentes: derivados.componentes,
    componenteIds: derivados.componentes.map((c) => c.productoId),
    precioVenta: derivados.precioVenta,
    costoReferencia: derivados.costoReferencia,
    stockTotal: derivados.stockTotal,
    modificadoPor: usuario.uid,
    modificadoEn: serverTimestamp(),
  });
}

export async function listarCombos() {
  const snap = await getDocs(query(collection(db, "productos"), where("tipoProducto", "==", "combo")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.descripcion || "").localeCompare(b.descripcion || ""));
}
