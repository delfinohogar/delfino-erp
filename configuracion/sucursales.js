import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { pedirCamposModal } from "/js/modal.js";
import { listarSucursales, crearSucursal, actualizarSucursal } from "/js/sucursales.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "config-sucursales", titulo: "Sucursales", usuario });

content.innerHTML = `
  <div class="hint" style="margin-bottom:12px; max-width:64ch">
    Cada sucursal tiene su propio punto de venta interno — es lo que separa la numeración de
    comprobantes de una sucursal de otra (ej. Sucursal 1 → 0001, Sucursal 2 → 0002). Esta numeración
    es interna, sin validez fiscal, hasta que se conecte ARCA.
  </div>
  <div class="toolbar">
    <button type="button" id="btn-nueva" class="primary">+ Nueva sucursal</button>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Punto de venta</th><th>Nombre</th><th>Estado</th><th></th></tr></thead>
      <tbody id="tabla-body"></tbody>
    </table>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay sucursales cargadas.</div>
  </div>
`;

const tbody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

async function cargar() {
  const sucursales = await listarSucursales();
  emptyState.style.display = sucursales.length === 0 ? "block" : "none";
  tbody.innerHTML = sucursales
    .map(
      (s) => `
    <tr>
      <td><code>${s.puntoVenta}</code></td>
      <td>${s.nombre}</td>
      <td>${s.activa !== false ? '<span class="badge success">Activa</span>' : '<span class="badge muted">Inactiva</span>'}</td>
      <td style="width:1%; white-space:nowrap">
        <button type="button" data-editar="${s.id}">✎ Editar</button>
        <button type="button" data-toggle="${s.id}" data-activa="${s.activa !== false}">${s.activa !== false ? "Desactivar" : "Activar"}</button>
      </td>
    </tr>
  `
    )
    .join("");

  tbody.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sucursal = sucursales.find((s) => s.id === btn.dataset.editar);
      const datos = await pedirCamposModal("Editar sucursal", [
        { name: "nombre", label: "Nombre", value: sucursal.nombre, required: true },
        { name: "puntoVenta", label: "Punto de venta (4 dígitos)", value: sucursal.puntoVenta, required: true },
      ]);
      if (!datos) return;
      await actualizarSucursal(sucursal.id, { ...datos, activa: sucursal.activa });
      cargar();
    });
  });

  tbody.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sucursal = sucursales.find((s) => s.id === btn.dataset.toggle);
      await actualizarSucursal(sucursal.id, { nombre: sucursal.nombre, puntoVenta: sucursal.puntoVenta, activa: !(sucursal.activa !== false) });
      cargar();
    });
  });
}

document.getElementById("btn-nueva").addEventListener("click", async () => {
  const datos = await pedirCamposModal("Nueva sucursal", [
    { name: "nombre", label: "Nombre", required: true },
    { name: "puntoVenta", label: "Punto de venta (4 dígitos)", value: "0001", required: true },
  ]);
  if (!datos) return;
  await crearSucursal(datos);
  cargar();
});

cargar();
