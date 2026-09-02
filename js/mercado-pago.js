// Cliente de Mercado Pago (Point/Orders API, pagos presenciales) — el Access Token vive
// exclusivamente en las Cloud Functions (functions/mercadoPago.js); acá solo hay llamadas
// httpsCallable, nunca ninguna credencial secreta.
import { db, doc, getDoc, setDoc, functions, httpsCallable } from "./firebase.js";

const REF = () => doc(db, "configuracion", "mercadoPago");

export async function obtenerConfigMercadoPago() {
  const snap = await getDoc(REF());
  return snap.exists() ? snap.data() : { modo: "test", habilitado: false };
}

export async function guardarConfigMercadoPago({ modo, terminalId }) {
  const cambios = {};
  if (modo !== undefined) cambios.modo = modo;
  if (terminalId !== undefined) cambios.terminalId = terminalId || null;
  await setDoc(REF(), cambios, { merge: true });
}

export async function probarConexionMercadoPago(modo = "test") {
  const fn = httpsCallable(functions, "mpProbarConexion");
  const res = await fn({ modo });
  return res.data; // { ok, cantidadMediosPago }
}

export async function listarTerminales() {
  const fn = httpsCallable(functions, "mpListarTerminales");
  const res = await fn({});
  return res.data.terminales; // [{ id, pos_id, store_id, operating_mode }]
}

// Crea (o reutiliza) tienda + caja de prueba y activa el modo PDV en la terminal — paso previo
// obligatorio antes de poder crear una orden (si no, Mercado Pago devuelve 403 "Unauthorized").
export async function configurarPuntoDeVenta(terminalId) {
  const fn = httpsCallable(functions, "mpConfigurarPuntoDeVenta");
  const res = await fn({ terminalId });
  return res.data; // { ok, storeId, posId, pasos }
}

export async function crearOrdenPrueba(terminalId) {
  const fn = httpsCallable(functions, "mpCrearOrdenPrueba");
  const res = await fn({ terminalId });
  return res.data; // { orderId, status }
}

// estado: "processed" | "failed" | "refunded" | "canceled" — SOLO tiene efecto en sandbox, hace
// las veces del terminal físico reportando el resultado.
export async function simularEventoOrden(orderId, estado) {
  const fn = httpsCallable(functions, "mpSimularEventoOrden");
  const res = await fn({ orderId, estado });
  return res.data;
}

export async function consultarPago(orderId) {
  const fn = httpsCallable(functions, "mpConsultarPago");
  const res = await fn({ orderId });
  return res.data;
}

export async function crearDevolucion(orderId, monto) {
  const fn = httpsCallable(functions, "mpCrearDevolucion");
  const res = await fn({ orderId, monto });
  return res.data; // { estado }
}

// --- Cobro real de una venta (Nueva Venta) ------------------------------------------------------

async function crearOrdenVenta(terminalId, monto) {
  const fn = httpsCallable(functions, "mpCrearOrdenVenta");
  const res = await fn({ terminalId, monto });
  return res.data; // { orderId, status }
}

async function cancelarOrden(orderId) {
  const fn = httpsCallable(functions, "mpCancelarOrden");
  const res = await fn({ orderId });
  return res.data; // { estado, estadoDetalle }
}

export async function vincularVentaAOrden(orderId, ventaId) {
  const fn = httpsCallable(functions, "mpVincularVenta");
  await fn({ orderId, ventaId });
}

// Máquina de estados de un cobro con Point, para usar desde el modal de pago (venta-pago-modal.js).
// Estados: CREANDO → ESPERANDO → APROBADO / RECHAZADO / CANCELADO.
//
// Nunca se da un cobro por aprobado solo porque se creó la Order — únicamente al ver
// estado:"processed" + acreditado:true por polling (mpConsultarPago), cada 2s.
//
// Protección contra la carrera "cancelar justo cuando ya se aprobó": tanto el polling como
// cancelar() chequean `estado === "ESPERANDO"` antes de escribir un estado nuevo, y una vez que
// cualquiera de los dos mueve el estado a algo terminal, el otro ya no puede pisarlo. Además,
// cancelar() nunca asume que canceló de verdad — usa el estado que Mercado Pago devuelve después
// del intento (ver mpCancelarOrden): si para entonces la orden ya está "processed", el cobro queda
// en APROBADO igual, nunca en CANCELADO, aunque el cajero haya tocado el botón.
export function iniciarCobroMercadoPago({ terminalId, monto }) {
  let estado = "CREANDO";
  let orderId = null;
  let detenido = false;
  const listeners = new Set();

  function emitir() {
    listeners.forEach((l) => l(estado, { orderId }));
  }

  async function iniciar() {
    try {
      const res = await crearOrdenVenta(terminalId, monto);
      orderId = res.orderId;
      estado = "ESPERANDO";
      emitir();
      polling();
    } catch (err) {
      estado = "RECHAZADO";
      detenido = true;
      emitir();
      throw err;
    }
  }

  async function polling() {
    while (!detenido && estado === "ESPERANDO") {
      await new Promise((r) => setTimeout(r, 2000));
      if (detenido || estado !== "ESPERANDO") return;
      let pago;
      try {
        pago = await consultarPago(orderId);
      } catch {
        continue; // un error de red al consultar no corta el cobro — reintenta en el próximo tick
      }
      if (detenido || estado !== "ESPERANDO") return; // pudo cambiar mientras esperábamos la consulta
      if (pago.estado === "processed" && pago.acreditado) {
        estado = "APROBADO";
        detenido = true;
        emitir();
      } else if (pago.estado === "failed") {
        estado = "RECHAZADO";
        detenido = true;
        emitir();
      } else if (pago.estado === "canceled") {
        estado = "CANCELADO";
        detenido = true;
        emitir();
      }
    }
  }

  async function cancelar() {
    if (estado !== "ESPERANDO") return; // ya está en un estado terminal (incluido APROBADO) — no-op
    const res = await cancelarOrden(orderId);
    if (estado !== "ESPERANDO") return; // pudo cambiar mientras esperábamos la respuesta del cancel
    // La fuente de verdad es lo que Mercado Pago devolvió, no el hecho de haber tocado "Cancelar".
    estado = res.estado === "processed" ? "APROBADO" : "CANCELADO";
    detenido = true;
    emitir();
  }

  function onCambio(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    iniciar,
    cancelar,
    onCambio,
    get estado() {
      return estado;
    },
    get orderId() {
      return orderId;
    },
  };
}
