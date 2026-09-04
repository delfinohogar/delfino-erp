// Transferencias internas: mover dinero de un lugar a otro del propio negocio (caja→banco,
// caja→caja de otra sucursal, etc.) — NO es venta ni gasto, así que genera un egreso en el origen y
// un ingreso en el destino con medio "Transferencia interna", marcados con origen.tipo="transferencia"
// para que Tesorería los excluya de "ingresos/egresos del negocio" (ver js/tesoreria.js).
import { db, collection, getDocs, addDoc, query, orderBy, limit, serverTimestamp } from "./firebase.js";
import { registrarMovimientoCaja } from "./cajas.js";
import { registrarMovimientoBancario } from "./bancos.js";

// origen/destino: { tipo: "caja"|"banco", id, nombre, sesionId? (obligatorio si tipo:"caja") }
export async function crearTransferenciaInterna({ fecha, origen, destino, importe, concepto }, usuario) {
  if (!(importe > 0)) throw new Error("El importe tiene que ser mayor a cero.");
  if (origen.tipo === destino.tipo && origen.id === destino.id) throw new Error("El origen y el destino no pueden ser el mismo.");
  if (origen.tipo === "caja" && !origen.sesionId) throw new Error(`${origen.nombre} tiene que estar abierta para transferir desde ahí.`);
  if (destino.tipo === "caja" && !destino.sesionId) throw new Error(`${destino.nombre} tiene que estar abierta para recibir la transferencia.`);

  const ref = await addDoc(collection(db, "transferenciasInternas"), {
    fecha: fecha || new Date().toISOString().slice(0, 10),
    origen: { tipo: origen.tipo, id: origen.id, nombre: origen.nombre },
    destino: { tipo: destino.tipo, id: destino.id, nombre: destino.nombre },
    importe: Math.round(importe * 100) / 100,
    concepto: concepto?.trim() || `Transferencia interna: ${origen.nombre} → ${destino.nombre}`,
    estado: "registrado",
    usuario: usuario.uid,
    usuarioNombre: usuario.nombre || usuario.email,
    creadoEn: serverTimestamp(),
  });

  const origenMov = { tipo: "transferencia", id: ref.id };
  const conceptoMov = `Transferencia a ${destino.nombre}`;
  const conceptoMovDestino = `Transferencia desde ${origen.nombre}`;

  if (origen.tipo === "caja") {
    await registrarMovimientoCaja({ cajaId: origen.id, sesionId: origen.sesionId, tipo: "egreso", concepto: conceptoMov, importe, medio: "Transferencia interna", origen: origenMov }, usuario);
  } else {
    await registrarMovimientoBancario({ cuentaId: origen.id, fecha, tipo: "egreso", concepto: conceptoMov, importe, origen: origenMov }, usuario);
  }

  if (destino.tipo === "caja") {
    await registrarMovimientoCaja({ cajaId: destino.id, sesionId: destino.sesionId, tipo: "ingreso", concepto: conceptoMovDestino, importe, medio: "Transferencia interna", origen: origenMov }, usuario);
  } else {
    await registrarMovimientoBancario({ cuentaId: destino.id, fecha, tipo: "ingreso", concepto: conceptoMovDestino, importe, origen: origenMov }, usuario);
  }

  return { id: ref.id };
}

export async function listarTransferenciasInternas(maxResultados = 100) {
  const snap = await getDocs(query(collection(db, "transferenciasInternas"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
