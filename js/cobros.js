// Cobros a cliente: la contraparte de pagosProveedores. La mayoría se generan solos al confirmar una
// venta (ver ventas.js) — este módulo también permite registrar un cobro después, contra una venta
// que quedó total o parcialmente "Pendiente de pago".
import { db, collection, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";
import { generarAsiento, CUENTA } from "./contabilidad.js";
import { listarSucursalesActivas } from "./sucursales.js";
import { listarCajasPorSucursal, sesionAbiertaDeCaja, registrarMovimientoCaja } from "./cajas.js";
import { listarCuentasBancariasActivas, registrarMovimientoBancario } from "./bancos.js";

export const MEDIOS_COBRO = ["Efectivo", "Débito", "Transferencia", "Otro"];

// datos: { clienteId, clienteNombre, ventaId, numeroVenta, monto, fecha, medioPago, referencia, notas,
//          destino?: { tipo: "caja"|"banco", id, nombre, sesionId? } }
// Nota contable: el cobro AUTOMÁTICO que genera una venta pagada en el momento no pasa por acá (va
// directo a addDoc en ventas.js, y su asiento ya lo cubre la venta) — esta función es la del cobro
// manual posterior (contra un saldo "Pendiente de pago"), que sí necesita su propio asiento (mueve
// de Deudores a Caja) y, como cualquier plata que entra, también tiene que quedar en Tesorería.
export async function crearCobro(datos, usuario) {
  const ref = await addDoc(collection(db, "cobros"), {
    clienteId: datos.clienteId,
    clienteNombre: datos.clienteNombre,
    ventaId: datos.ventaId,
    numeroVenta: datos.numeroVenta,
    monto: datos.monto,
    fecha: datos.fecha,
    medioPago: datos.medioPago,
    referencia: datos.referencia || "",
    notas: datos.notas || "",
    usuario: usuario.uid,
    creadoEn: serverTimestamp(),
  });

  await generarAsiento(
    {
      fecha: datos.fecha,
      descripcion: `Cobro — ${datos.clienteNombre} (venta #${datos.numeroVenta})`,
      origen: { tipo: "cobro", id: ref.id },
      movimientos: [
        { cuenta: CUENTA.CAJA, debe: Math.round(datos.monto * 100) / 100, haber: 0 },
        { cuenta: CUENTA.DEUDORES_VENTAS, debe: 0, haber: Math.round(datos.monto * 100) / 100 },
      ],
    },
    usuario
  );

  const routeo = await routearCobroATesoreria(datos, ref.id, usuario);
  return { id: ref.id, routeoTesoreria: routeo };
}

// Mismo criterio que routearPagoATesoreria en ventas.js — si el destino se especifica (UI con
// selector de caja/cuenta), se usa ese; si no, cae al mismo default (caja/cuenta principal de la
// primera sucursal activa). Débito/Transferencia van a banco, Efectivo/Otro a caja.
async function routearCobroATesoreria(datos, cobroId, usuario) {
  if (!(datos.monto > 0)) return { ruteado: false, motivo: "Importe inválido." };
  const esBanco = datos.medioPago === "Débito" || datos.medioPago === "Transferencia";

  if (datos.destino?.id) {
    if (datos.destino.tipo === "caja") {
      await registrarMovimientoCaja(
        { cajaId: datos.destino.id, sesionId: datos.destino.sesionId, tipo: "ingreso", concepto: `Cobro venta #${datos.numeroVenta}`, importe: datos.monto, medio: datos.medioPago, ventaId: datos.ventaId, clienteId: datos.clienteId, clienteNombre: datos.clienteNombre, origen: { tipo: "cobro", id: cobroId } },
        usuario
      );
    } else {
      await registrarMovimientoBancario(
        { cuentaId: datos.destino.id, fecha: datos.fecha, tipo: "ingreso", concepto: `Cobro venta #${datos.numeroVenta}`, importe: datos.monto, ventaId: datos.ventaId, clienteId: datos.clienteId, clienteNombre: datos.clienteNombre, origen: { tipo: "cobro", id: cobroId } },
        usuario
      );
    }
    return { ruteado: true, destino: datos.destino.tipo, id: datos.destino.id };
  }

  const sucursal = (await listarSucursalesActivas())[0] || null;
  if (esBanco) {
    const cuenta = (await listarCuentasBancariasActivas())[0];
    if (!cuenta) return { ruteado: false, motivo: "No hay ninguna cuenta bancaria configurada (Tesorería → Bancos)." };
    await registrarMovimientoBancario(
      { cuentaId: cuenta.id, fecha: datos.fecha, tipo: "ingreso", concepto: `Cobro venta #${datos.numeroVenta}`, importe: datos.monto, ventaId: datos.ventaId, clienteId: datos.clienteId, clienteNombre: datos.clienteNombre, origen: { tipo: "cobro", id: cobroId } },
      usuario
    );
    return { ruteado: true, destino: "banco", id: cuenta.id };
  }

  if (!sucursal) return { ruteado: false, motivo: "No hay ninguna sucursal configurada." };
  const cajas = await listarCajasPorSucursal(sucursal.id);
  const caja = cajas.find((c) => c.tipo === "Principal" && c.activa !== false) || cajas.find((c) => c.activa !== false);
  if (!caja) return { ruteado: false, motivo: `${sucursal.nombre} todavía no tiene ninguna caja creada.` };
  const sesion = await sesionAbiertaDeCaja(caja.id);
  if (!sesion) return { ruteado: false, motivo: `${caja.nombre} está cerrada.` };
  await registrarMovimientoCaja(
    { cajaId: caja.id, sesionId: sesion.id, sucursalId: sucursal.id, tipo: "ingreso", concepto: `Cobro venta #${datos.numeroVenta}`, importe: datos.monto, medio: datos.medioPago, ventaId: datos.ventaId, clienteId: datos.clienteId, clienteNombre: datos.clienteNombre, origen: { tipo: "cobro", id: cobroId } },
    usuario
  );
  return { ruteado: true, destino: "caja", id: caja.id };
}

export async function listarCobros(maxResultados = 200) {
  const snap = await getDocs(query(collection(db, "cobros"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCobrosPorCliente(clienteId) {
  const snap = await getDocs(query(collection(db, "cobros"), where("clienteId", "==", clienteId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarCobrosPorVenta(ventaId) {
  const snap = await getDocs(query(collection(db, "cobros"), where("ventaId", "==", ventaId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
