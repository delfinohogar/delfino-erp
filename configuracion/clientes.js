import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { pedirClienteModal } from "/js/cliente-modal.js";
import { crearCliente, buscarClientesTexto } from "/js/clientes.js";
import { escapeHtml } from "/js/escape-html.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "config-clientes", titulo: "Clientes", usuario });

content.innerHTML = `
  <div class="toolbar">
    <input type="text" id="buscador" placeholder="Buscar por nombre o CUIT/DNI…" style="min-width:280px" />
    <button type="button" id="btn-nuevo" class="primary">+ Nuevo cliente</button>
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Nombre / Razón social</th>
            <th>CUIT</th>
            <th>Condición IVA</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state">Escribí un nombre o CUIT/DNI arriba para buscar.</div>
  </div>
`;

const buscador = document.getElementById("buscador");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

function origenBadge(fuente) {
  if (fuente === "arca") return '<span class="badge success">ARCA</span>';
  if (fuente === "gbp") return '<span class="badge warning">GBP</span>';
  return '<span class="badge muted">Manual</span>';
}

function pintar(lista, mensajeVacio) {
  tablaBody.innerHTML = "";
  emptyState.style.display = lista.length === 0 ? "block" : "none";
  emptyState.textContent = mensajeVacio;
  lista.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.razonSocial || "")}</td>
      <td>${escapeHtml(c.cuit || "-")}</td>
      <td>${escapeHtml(c.condicionIva || "-")}</td>
      <td>${origenBadge(c.fuenteDatos)}</td>
    `;
    tr.addEventListener("click", () => {
      location.href = `/configuracion/cliente-ficha.html?id=${c.id}`;
    });
    tablaBody.appendChild(tr);
  });
}

// Búsqueda bajo demanda (Firestore, prefijo por nombre o CUIT/DNI) en vez de traer TODOS los
// clientes al entrar y filtrar en memoria — funcionaba con los clientes de prueba, pero con miles
// reales (migración de GBP) la pantalla directamente dejaba de responder. Debounce de 200ms para no
// disparar una consulta por cada tecla, y un id de búsqueda para no pintar una respuesta vieja que
// llegó tarde si mientras tanto se siguió escribiendo (mismo criterio que js/cliente-picker.js).
let busquedaId = 0;
async function buscar() {
  const texto = buscador.value.trim();
  if (!texto) {
    pintar([], "Escribí un nombre o CUIT/DNI arriba para buscar.");
    return;
  }
  const idActual = ++busquedaId;
  const resultados = await buscarClientesTexto(texto);
  if (idActual !== busquedaId) return;
  pintar(resultados, "Sin resultados.");
}

// "Buscando…" se pinta ANTES del debounce, no después — sin esto, mientras viaja la consulta (más en
// una conexión lenta) quedaban a la vista los resultados de la búsqueda ANTERIOR, dando la impresión
// de que el buscador no filtraba lo recién escrito cuando en realidad solo estaba tardando.
let debounceTimer = null;
buscador.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  if (buscador.value.trim()) pintar([], "Buscando…");
  debounceTimer = setTimeout(buscar, 200);
});

document.getElementById("btn-nuevo").addEventListener("click", async () => {
  const datos = await pedirClienteModal("");
  if (!datos) return;
  await crearCliente(datos.razonSocial, datos.cuit, datos.datosArca, datos.datosContacto);
  buscador.value = datos.razonSocial;
  await buscar();
});
