// Pagos a proveedor, siempre atados a una factura de compra puntual (permite saber qué facturas
// están pagas/parciales/pendientes, y armar la cuenta corriente por proveedor).
import { db, collection, doc, getDocs, setDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";
import { generarAsiento, CUENTA, cuentaParaDestinoTesoreria, normalizarFecha } from "./contabilidad.js";
import { resolverSucursalUsuario } from "./sucursales.js";
import { listarCajasPorSucursal, sesionAbiertaDeCaja, registrarMovimientoCaja } from "./cajas.js";
import { listarCuentasBancariasActivas, registrarMovimientoBancario } from "./bancos.js";
import { obtenerMedioPagoPorNombre } from "./medios-pago.js";

export const MEDIOS_PAGO = ["Efectivo", "Transferencia", "Cheque", "Otro"];

// Antes crearPago solo escribía el doc de pagosProveedores y un asiento que SIEMPRE debitaba
// CUENTA.CAJA — nunca llamaba a registrarMovimientoCaja/registrarMovimientoBancario. Resultado real:
// pagar cualquier factura en efectivo hacía que Contabilidad creyera que salió plata de Caja y Bancos,
// pero Tesorería (que deriva su saldo solo de movimientosCaja/movimientosBancarios) nunca se enteraba
// — el arqueo de caja quedaba por encima de la realidad en el monto exacto de cada pago a proveedor,
// para siempre, sin ningún aviso. Mismo criterio de ruteo que ya usa crearCobro (cobros.js) — que sí
// tocaba Tesorería correctamente — pero en sentido egreso, y si no se puede ubicar un destino real
// (medio no configurado, sucursal sin caja abierta), el pago queda igual registrado pero marcado
// "sin ubicar" en vez de fingir un movimiento que no pasó (mismo patrón que ventas/cobros).
async function routearPagoATesoreria(datos, pagoId, usuario) {
  if (!(datos.monto > 0)) return { ruteado: false, motivo: "Importe inválido." };

  const config = await obtenerMedioPagoPorNombre(datos.medioPago);
  if (!config) return { ruteado: false, motivo: `El medio "${datos.medioPago}" no está en Configuración → Medios de pago, así que no se sabe de dónde sale la plata.` };
  if (!config.destino) return { ruteado: false, motivo: `"${datos.medioPago}" no tiene un destino de Tesorería configurado.` };
  if (config.destino === "cuentaPorCobrar") {
    return { ruteado: false, motivo: `"${datos.medioPago}" es un destino de cobro, no de pago — no se puede pagar un proveedor con eso.` };
  }

  const { sucursal } = await resolverSucursalUsuario(usuario);

  if (config.destino === "banco") {
    const cuentas = await listarCuentasBancariasActivas();
    const cuenta = (sucursal ? cuentas.find((c) => c.sucursalId === sucursal.id) : null) || cuentas[0];
    if (!cuenta) return { ruteado: false, motivo: "No hay ninguna cuenta bancaria configurada (Tesorería → Bancos)." };
    await registrarMovimientoBancario(
      { cuentaId: cuenta.id, fecha: datos.fecha, tipo: "egreso", concepto: `Pago — ${datos.proveedorNombre} (${datos.compraNumero})`, importe: datos.monto, origen: { tipo: "pago", id: pagoId } },
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
    { cajaId: caja.id, sesionId: sesion.id, sucursalId: sucursal.id, tipo: "egreso", concepto: `Pago — ${datos.proveedorNombre} (${datos.compraNumero})`, importe: datos.monto, medio: datos.medioPago, origen: { tipo: "pago", id: pagoId } },
    usuario
  );
  return { ruteado: true, destino: "caja", id: caja.id };
}

// datos: { proveedorId, proveedorNombre, compraId, compraNumero, monto, fecha, medioPago, referencia, notas }
export async function crearPago(datos, usuario) {
  // Antes guardaba lo que llegara en datos.fecha tal cual — si era un Date (como manda
  // productos/pagos-nueva.js) quedaba como Timestamp en vez del string "YYYY-MM-DD" que usa el
  // resto del ERP, y el pago quedaba fuera de los filtros por fecha de Tesorería (compara strings).
  const fecha = normalizarFecha(datos.fecha);

  // Mismo criterio que crearVenta/crearCobro: el ID se genera antes de escribir para poder rutear
  // primero y guardar el resultado en el pago mismo — pagosProveedores también es inmutable.
  const ref = doc(collection(db, "pagosProveedores"));
  const routeo = await routearPagoATesoreria({ ...datos, fecha }, ref.id, usuario);

  await setDoc(ref, {
    proveedorId: datos.proveedorId,
    proveedorNombre: datos.proveedorNombre,
    compraId: datos.compraId,
    compraNumero: datos.compraNumero,
    monto: datos.monto,
    fecha,
    medioPago: datos.medioPago,
    referencia: datos.referencia || "",
    notas: datos.notas || "",
    routeoTesoreria: routeo,
    tieneSinUbicar: !routeo.ruteado,
    usuario: usuario.uid,
    creadoEn: serverTimestamp(),
  });

  // Si no se pudo ubicar de dónde sale la plata, no se inventa un asiento contra Caja — el pago
  // queda igual registrado (la deuda con el proveedor baja, que es real) pero sin mover Tesorería,
  // y marcado sin ubicar para resolverlo a mano (ver tesoreria/pagos-sin-ubicar.html).
  if (routeo.ruteado) {
    const cuentaHaber = cuentaParaDestinoTesoreria(routeo.destino) || CUENTA.CAJA;
    await generarAsiento(
      {
        fecha,
        descripcion: `Pago — ${datos.proveedorNombre} (${datos.compraNumero})`,
        origen: { tipo: "pago", id: ref.id },
        movimientos: [
          { cuenta: CUENTA.PROVEEDORES, debe: Math.round(datos.monto * 100) / 100, haber: 0 },
          { cuenta: cuentaHaber, debe: 0, haber: Math.round(datos.monto * 100) / 100 },
        ],
      },
      usuario
    );
  }

  return { id: ref.id, routeoTesoreria: routeo };
}

export async function listarPagos(maxResultados = 200) {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), orderBy("creadoEn", "desc"), limit(maxResultados)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarPagosPorProveedor(proveedorId) {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), where("proveedorId", "==", proveedorId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listarPagosPorCompra(compraId) {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), where("compraId", "==", compraId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Pagos a proveedor que Tesorería no pudo ubicar solos — misma idea que listarVentasConPagoSinUbicar
// / listarCobrosConPagoSinUbicar, para que aparezcan también en Tesorería → Pagos sin ubicar.
export async function listarPagosProveedorConPagoSinUbicar() {
  const snap = await getDocs(query(collection(db, "pagosProveedores"), where("tieneSinUbicar", "==", true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
