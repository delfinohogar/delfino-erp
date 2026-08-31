import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarProductos } from "/js/productos.js";
import {
  listarListasPrecios,
  obtenerPrecioProductoLista,
  listarDepositos,
  listarStockPorDeposito,
  calcularPrecioLista,
} from "/js/catalogo.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "precios", titulo: "Precios", usuario });

content.innerHTML = `
  <div id="sin-listas" class="card empty-state" style="display:none">
    Todavía no creaste ninguna lista de precios. Andá a Configuración → Listas de Precios para crear la primera
    (ej. "Venta presencial", con su margen y regla de redondeo).
  </div>
  <div class="card" id="card-tabla" style="display:none">
    <div class="table-scroll">
      <table>
        <thead>
          <tr id="thead-row"></tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
  </div>
`;

const sinListas = document.getElementById("sin-listas");
const cardTabla = document.getElementById("card-tabla");
const theadRow = document.getElementById("thead-row");
const tablaBody = document.getElementById("tabla-body");

async function pintarTabla(listas, productos, depositos) {
  const colspan = 2 + listas.length + Math.max(depositos.length, 1);
  tablaBody.innerHTML = `<tr><td colspan="${colspan}" class="hint">Cargando…</td></tr>`;

  const filas = await Promise.all(
    productos.map(async (p) => {
      const precios = await Promise.all(
        listas.map(async (lista) => {
          const override = await obtenerPrecioProductoLista(p.id, lista.id);
          return override?.precioManual ?? calcularPrecioLista(p, lista);
        })
      );
      const stockPorDeposito = depositos.length > 0 ? await listarStockPorDeposito(p.id) : null;
      return { producto: p, precios, stockPorDeposito };
    })
  );

  tablaBody.innerHTML = "";
  if (filas.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="${colspan}" class="hint">No hay productos cargados todavía.</td></tr>`;
    return;
  }

  filas.forEach(({ producto: p, precios, stockPorDeposito }) => {
    const tr = document.createElement("tr");
    const celdasPrecio = precios.map((precio) => `<td>${precio.toLocaleString("es-AR")}</td>`).join("");
    const celdasStock =
      depositos.length > 0
        ? depositos.map((d) => `<td>${stockPorDeposito?.[d.id] ?? 0}</td>`).join("")
        : `<td>${p.stockTotal ?? 0}</td>`;
    tr.innerHTML = `
      <td>${p.sku || ""}</td>
      <td>${p.descripcion || ""}</td>
      ${celdasPrecio}
      ${celdasStock}
    `;
    tablaBody.appendChild(tr);
  });
}

async function cargar() {
  const [listasTodas, productos, depositos] = await Promise.all([
    listarListasPrecios(),
    listarProductos(200),
    listarDepositos(),
  ]);
  const listas = listasTodas.filter((l) => l.activa);

  if (listas.length === 0) {
    sinListas.style.display = "block";
    cardTabla.style.display = "none";
    return;
  }

  sinListas.style.display = "none";
  cardTabla.style.display = "block";

  theadRow.innerHTML = `
    <th>SKU</th>
    <th>Producto</th>
    ${listas.map((l) => `<th>${l.nombre}</th>`).join("")}
    ${depositos.length > 0 ? depositos.map((d) => `<th>Stock ${d.nombre}</th>`).join("") : "<th>Stock</th>"}
  `;

  await pintarTabla(listas, productos, depositos);
}

cargar();
