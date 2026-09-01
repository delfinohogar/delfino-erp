// Cobros a cliente: la contraparte de pagosProveedores. La mayoría se generan solos al confirmar una
// venta (ver ventas.js) — este módulo también permite registrar un cobro después, contra una venta
// que quedó total o parcialmente "Pendiente de pago".
import { db, collection, doc, getDocs, setDoc, query, where, orderBy, limit, serverTimestamp } from "./firebase.js";
import { generarAsiento, CUENTA, cuentaParaDestinoTesoreria, normalizarFecha } from "./contabilidad.js";
import { resolverSucursalUsuario } from "./sucursales.js";
import { listarCajasPorSucursal, sesionAbiertaDeCaja, registrarMovimientoCaja } from "./cajas.js";
import { listarCuentasBancariasActivas, registrarMovimientoBancario } from "./bancos.js";
import { listarMediosPagoActivos, obtenerMedioPagoPorNombre } from "./medios-pago.js";

// Los medios con los que se puede saldar una cuenta corriente salen del mismo catálogo que usa
// Nueva Venta (Configuración → Medios de pago) — antes era una lista fija acá, que se desincronizaba:
// no se podía cobrar con Crédito/Mercado Pago, y un medio desactivado seguía apareciendo.
export async function mediosCobroDisponibles() {
  const medios = await listarMediosPagoActivos();
  return medios.map((m) => m.nombre);
}

// datos: { clienteId, clienteNombre, ventaId, numeroVenta, monto, fecha, medioPago, referencia, notas,
//          destino?: { tipo: "caja"|"banco", id, nombre, sesionId? } }
// Nota contable: el cobro AUTOMÁTICO que genera una venta pagada en el momento no pasa por acá (va
// directo a addDoc en ventas.js, y su asiento ya lo cubre la venta) — esta función es la del cobro
// manual posterior (contra un saldo "Pendiente de pago"), que sí necesita su propio asiento (mueve
// de Deudores a Caja) y, como cualquier plata que entra, también tiene que quedar en Tesorería.
export async function crearCobro(datos, usuario) {
  // Toda fecha que se guarda se normaliza a string "YYYY-MM-DD", igual que ventas/compras. Si acá
  // entrara un Date (como hacía la pantalla de cobro manual), el movimiento quedaba fuera de los
  // filtros por fecha de Tesorería, que comparan strings (ver js/tesoreria.js).
  const fecha = normalizarFecha(datos.fecha);

  // Mismo criterio que crearVenta en ventas.js: el ID se genera antes de escribir para poder rutear
  // primero y guardar el resultado en el cobro mismo — cobros también es inmutable (allow update:
  // if false), así que si no queda acá, el aviso de "sin ubicar" se pierde para siempre.
  const ref = doc(collection(db, "cobros"));

  // Rutear primero: el asiento se arma con el destino real, no suponiendo que todo entra a Caja.
  const routeo = await routearCobroATesoreria({ ...datos, fecha }, ref.id, usuario);

  await setDoc(ref, {
    clienteId: datos.clienteId,
    clienteNombre: datos.clienteNombre,
    ventaId: datos.ventaId,
    numeroVenta: datos.numeroVenta,
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

  // Un cobro que no se pudo ubicar queda en Deudores por Ventas (sigue siendo un crédito a resolver)
  // en vez de fingir que entró a Caja.
  const cuentaDebe = routeo.ruteado ? cuentaParaDestinoTesoreria(routeo.destino) || CUENTA.DEUDORES_VENTAS : CUENTA.DEUDORES_VENTAS;
  if (cuentaDebe !== CUENTA.DEUDORES_VENTAS) {
    await generarAsiento(
      {
        fecha,
        descripcion: `Cobro — ${datos.clienteNombre} (venta #${datos.numeroVenta})`,
        origen: { tipo: "cobro", id: ref.id },
        movimientos: [
          { cuenta: cuentaDebe, debe: Math.round(datos.monto * 100) / 100, haber: 0 },
          { cuenta: CUENTA.DEUDORES_VENTAS, debe: 0, haber: Math.round(datos.monto * 100) / 100 },
        ],
      },
      usuario
    );
  }
  // Si no se pudo rutear, no se genera asiento: el crédito del cliente sigue igual que antes y no se
  // inventa un movimiento contable. Queda informado en routeoTesoreria para que la pantalla avise.

  return { id: ref.id, routeoTesoreria: routeo };
}

// Mismo criterio que routearPagoATesoreria en ventas.js — si el destino se especifica (UI con
// selector de caja/cuenta), se usa ese; si no, se resuelve por el `destino` del medio configurado
// en Configuración → Medios de pago, cayendo a la caja/cuenta de la primera sucursal activa.
async function routearCobroATesoreria(datos, cobroId, usuario) {
  if (!(datos.monto > 0)) return { ruteado: false, motivo: "Importe inválido." };

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

  const config = await obtenerMedioPagoPorNombre(datos.medioPago);
  if (!config) return { ruteado: false, motivo: `El medio "${datos.medioPago}" no está en Configuración → Medios de pago, así que no se sabe a dónde va la plata.` };
  if (!config.destino) return { ruteado: false, motivo: `"${datos.medioPago}" no tiene un destino de Tesorería configurado.` };

  // Un cobro de cuenta corriente que cae en "cuenta por cobrar" (ej. el cliente salda con tarjeta)
  // no se soporta todavía: implicaría encadenar una cuenta por cobrar nueva desde otra deuda. Se
  // avisa en vez de ubicar la plata en cualquier lado.
  if (config.destino === "cuentaPorCobrar") {
    return { ruteado: false, motivo: `Saldar una cuenta corriente con "${datos.medioPago}" todavía no está soportado — usá un medio que entre a caja o banco.` };
  }

  // Misma sucursal que resolvería una venta de este usuario (Configuración → Usuarios) — antes caía
  // siempre a la primera sucursal activa, así que un cobro manual de la Sucursal 2 podía terminar en
  // la caja/banco de la Sucursal 1 sin ningún aviso (mismo bug que routearPagoATesoreria en ventas.js).
  const { sucursal } = await resolverSucursalUsuario(usuario);
  if (config.destino === "banco") {
    const cuentas = await listarCuentasBancariasActivas();
    const cuenta = (sucursal ? cuentas.find((c) => c.sucursalId === sucursal.id) : null) || cuentas[0];
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

// Cobros manuales que Tesorería no pudo ubicar — misma idea que listarVentasConPagoSinUbicar.
export async function listarCobrosConPagoSinUbicar() {
  const snap = await getDocs(query(collection(db, "cobros"), where("tieneSinUbicar", "==", true)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
}
