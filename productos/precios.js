import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarProductosActivos, filtrarProductosLocal } from "/js/productos.js";
import { listarListasPrecios, obtenerPrecioProductoLista, listarDepositos, listarStockPorDeposito, calcularPrecioLista } from "/js/catalogo.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

// El costo es sensible (revela margen) — solo administrador lo ve. Es un ocultamiento de pantalla,
// no un límite real de Firestore (el mismo doc de "productos" que lee cualquier vendedor para vender
// ya trae costoReferencia) — ver la conversación de diseño de este módulo para el detalle.
const puedeVerCosto = usuario.rol === "administrador";

const content = renderShell({ active: "precios", titulo: "Precios", usuario });

content.innerHTML = `
  <div id="sin-listas" class="card empty-state" style="display:none">
    Todavía no creaste ninguna lista de precios. Andá a Configuración → Listas de Precios para crear la primera
    (ej. "Venta presencial", con su margen y regla de redondeo).
  </div>
  <div id="card-precios" style="display:none">
    <div class="card mb-16" style="padding:16px 20px">
      <input type="text" id="precios-buscar" placeholder="Buscar por SKU o descripción…" autocomplete="off" />
    </div>
    <div class="card">
      <div class="table-scroll">
        <table>
          <thead>
            <tr id="thead-row"></tr>
          </thead>
          <tbody id="tabla-body"></tbody>
        </table>
      </div>
    </div>
  </div>
`;

const sinListas = document.getElementById("sin-listas");
const cardPrecios = document.getElementById("card-precios");
const theadRow = document.getElementById("thead-row");
const tablaBody = document.getElementById("tabla-body");
const buscarInput = document.getElementById("precios-buscar");

let listas = [];
let depositos = [];
let productosTodos = [];
let colspan = 1;

// El precio (y el costo, si corresponde) se calculan solo para lo que se está mostrando, no para
// todo el catálogo activo de una — con ~1100 SKUs, traer el override de cada lista de cada producto
// de una sería miles de lecturas a Firestore en cada carga. Por eso la tabla arranca vacía y solo se
// llena al buscar (máximo 20 resultados a la vez, igual que el resto del ERP).
async function pintarTabla(productos) {
  if (productos.length === 0) {
    tablaBody.innerHTML = `<tr><td colspan="${colspan}" class="hint">Sin resultados.</td></tr>`;
    return;
  }
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
  filas.forEach(({ producto: p, precios, stockPorDeposito }) => {
    const tr = document.createElement("tr");
    // Con IVA, no el costo neto — es lo que de verdad sale reponer la unidad, que es lo que le
    // importa a quien mira el margen (calcularPrecioLista de catalogo.js parte del mismo costoConIva).
    const costoConIva = (p.costoReferencia ?? 0) * (1 + (p.iva ?? 0) / 100);
    const celdaCosto = puedeVerCosto ? `<td>${Math.round(costoConIva).toLocaleString("es-AR")}</td>` : "";
    const celdasPrecio = precios.map((precio) => `<td>${precio.toLocaleString("es-AR")}</td>`).join("");
    const celdasStock =
      depositos.length > 0
        ? depositos.map((d) => `<td>${stockPorDeposito?.[d.id] ?? 0}</td>`).join("")
        : `<td>${p.stockTotal ?? 0}</td>`;
    tr.innerHTML = `
      <td>${p.sku || ""}</td>
      <td>${p.descripcion || ""}</td>
      ${celdaCosto}
      ${celdasPrecio}
      ${celdasStock}
    `;
    tablaBody.appendChild(tr);
  });
}

buscarInput.addEventListener("input", () => {
  const texto = buscarInput.value.trim();
  if (!texto) {
    tablaBody.innerHTML = `<tr><td colspan="${colspan}" class="hint">Buscá un producto por SKU o descripción para ver sus precios.</td></tr>`;
    return;
  }
  pintarTabla(filtrarProductosLocal(productosTodos, texto, 20));
});

async function cargar() {
  const [listasTodas, productos, depositosCargados] = await Promise.all([
    listarListasPrecios(),
    listarProductosActivos(),
    listarDepositos(),
  ]);
  listas = listasTodas.filter((l) => l.activa);
  productosTodos = productos;
  depositos = depositosCargados;

  if (listas.length === 0) {
    sinListas.style.display = "block";
    cardPrecios.style.display = "none";
    return;
  }

  sinListas.style.display = "none";
  cardPrecios.style.display = "block";

  colspan = 2 + (puedeVerCosto ? 1 : 0) + listas.length + Math.max(depositos.length, 1);
  theadRow.innerHTML = `
    <th>SKU</th>
    <th>Producto</th>
    ${puedeVerCosto ? "<th>Costo (c/IVA)</th>" : ""}
    ${listas.map((l) => `<th>${l.nombre}</th>`).join("")}
    ${depositos.length > 0 ? depositos.map((d) => `<th>Stock ${d.nombre}</th>`).join("") : "<th>Stock</th>"}
  `;
  tablaBody.innerHTML = `<tr><td colspan="${colspan}" class="hint">Buscá un producto por SKU o descripción para ver sus precios.</td></tr>`;
}

cargar();
