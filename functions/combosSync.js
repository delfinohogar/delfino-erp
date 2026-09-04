// Mantiene sincronizado el precio/costo/stock de cada combo cada vez que cambia CUALQUIERA de sus
// componentes — ver js/combos.js para el mismo cálculo del lado del cliente (al crear/editar un
// combo). Este trigger cubre el resto de los casos: una venta, una compra, o una edición manual de
// un producto que resulta ser componente de un combo, sin que nadie tenga que volver a abrir el
// combo para que se actualice solo.
//
// componenteIds (array plano de solo IDs, separado de "componentes" que tiene el detalle completo)
// existe únicamente para poder hacer esta consulta con array-contains — Firestore no permite
// filtrar por un campo DENTRO de los objetos de un array de objetos.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

exports.onProductoActualizadoRecalcularCombos = onDocumentUpdated({ document: "productos/{productoId}", region: "southamerica-east1" }, async (event) => {
  const antes = event.data.before.data();
  const despues = event.data.after.data();

  // Un combo no puede ser componente de otro combo (ver validación en js/combos.js) — si esto lo
  // disparó la actualización de un combo, no hay nada para recalcular. Corta acá para no gastar una
  // consulta de más en el caso común (la gran mayoría de los cambios de producto no afectan a ningún
  // combo).
  if (despues.tipoProducto === "combo") return;

  const cambioStock = (antes.stockTotal ?? 0) !== (despues.stockTotal ?? 0);
  const cambioPrecio = (antes.precioVenta ?? 0) !== (despues.precioVenta ?? 0);
  const cambioCosto = (antes.costoReferencia ?? 0) !== (despues.costoReferencia ?? 0);
  if (!cambioStock && !cambioPrecio && !cambioCosto) return;

  const db = admin.firestore();
  const productoId = event.params.productoId;
  const combosSnap = await db.collection("productos").where("componenteIds", "array-contains", productoId).get();
  if (combosSnap.empty) return;

  for (const comboDoc of combosSnap.docs) {
    const combo = comboDoc.data();
    let precioVenta = 0;
    let costoReferencia = 0;
    let stockTotal = Infinity;

    for (const c of combo.componentes || []) {
      // El producto que disparó el trigger ya tenemos su valor nuevo en memoria (event.data.after)
      // — no hace falta releerlo, y usar el valor de acá evita una carrera contra la propia
      // escritura que originó este trigger.
      let p;
      if (c.productoId === productoId) {
        p = despues;
      } else {
        const snap = await db.collection("productos").doc(c.productoId).get();
        if (!snap.exists) {
          stockTotal = 0; // componente borrado -> el combo no se puede armar más, no se inventa stock
          continue;
        }
        p = snap.data();
      }
      precioVenta += (p.precioVenta ?? 0) * c.cantidad;
      costoReferencia += (p.costoReferencia ?? 0) * c.cantidad;
      stockTotal = Math.min(stockTotal, Math.floor((p.stockTotal ?? 0) / c.cantidad));
    }

    await comboDoc.ref.update({
      precioVenta: Math.round(precioVenta),
      costoReferencia: Math.round(costoReferencia),
      stockTotal: stockTotal === Infinity ? 0 : stockTotal,
      modificadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
});
