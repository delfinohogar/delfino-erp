// Historial de clientes de GBP que ya quedaron importados a Delfino — junta las dos formas en que
// puede haber pasado eso: clientes reales de Delfino vinculados por CUIT/DNI (Config → Clientes,
// con identificadorExterno) y fichas livianas (clientesGbp, solo para reportes). Ver
// gbp-top-clientes.js para el ranking de compras y facturas-gbp.js para el "van a importar"
// (previsualización de "Vincular clientes").
import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarClientesGbpLiviano } from "/js/gbp-facturas.js";
import { listarClientesTodos } from "/js/clientes.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = `<div class="empty-state">Esta sección es solo para administradores.</div>`;
  throw new Error("sin permiso");
}

const content = renderShell({ active: "gbp-clientes-importados", titulo: "Clientes GBP importados", usuario });

content.innerHTML = `
  <div class="card mb-16" style="padding:16px 20px">
    <div class="hint" style="max-width:64ch; margin:0 0 12px">
      Clientes de GBP que ya quedaron cargados en Delfino, de las dos formas posibles: como cliente real
      vinculado (aparece en Nueva Venta y Cuenta Corriente) o como ficha liviana (solo para mostrar el
      nombre en reportes, ver Top Clientes GBP).
    </div>
    <input type="text" id="buscar" placeholder="Buscar por nombre o CUIT/DNI…" autocomplete="off" />
  </div>
  <div class="card">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>CUIT/DNI</th>
            <th>Ciudad</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no se importó ningún cliente de GBP.</div>
  </div>
`;

const buscarInput = document.getElementById("buscar");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

let todos = [];

function pintar(filtro) {
  const texto = filtro.trim().toLowerCase();
  const filtrados = texto
    ? todos.filter((c) => c.nombreLower.includes(texto) || (c.cuit || "").includes(texto))
    : todos;

  emptyState.style.display = filtrados.length === 0 ? "block" : "none";
  tablaBody.innerHTML = filtrados
    .map(
      (c) => `
    <tr>
      <td>${c.nombre}</td>
      <td>${c.cuit || "-"}</td>
      <td>${c.ciudad || "-"}</td>
      <td>${c.tipo === "real" ? '<span class="badge success">Cliente vinculado</span>' : '<span class="badge muted">Ficha liviana</span>'}</td>
    </tr>`
    )
    .join("");
}

async function cargar() {
  const [clientesGbpLivianos, clientesDelfino] = await Promise.all([listarClientesGbpLiviano(), listarClientesTodos()]);

  const livianos = clientesGbpLivianos.map((c) => ({
    nombre: c.nombre || `Cliente GBP #${c.id}`,
    nombreLower: (c.nombre || "").toLowerCase(),
    cuit: c.cuit,
    ciudad: c.ciudad,
    tipo: "liviano",
  }));
  const reales = clientesDelfino
    .filter((c) => c.identificadorExterno)
    .map((c) => ({
      nombre: c.razonSocial,
      nombreLower: c.razonSocialLower || (c.razonSocial || "").toLowerCase(),
      cuit: c.cuit,
      ciudad: c.provincia,
      tipo: "real",
    }));

  todos = [...reales, ...livianos].sort((a, b) => a.nombreLower.localeCompare(b.nombreLower));
  pintar(buscarInput.value);
}

buscarInput.addEventListener("input", () => pintar(buscarInput.value));

cargar();
