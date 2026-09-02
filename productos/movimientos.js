import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { obtenerMovimientosRecientes } from "/js/productos.js";
import { db, doc, getDoc } from "/js/firebase.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

const content = renderShell({ active: "movimientos", titulo: "Movimientos", usuario });

content.innerHTML = `
  <div class="hint" style="margin-bottom:12px">
    Incluye cambios de catálogo y movimientos de stock (compras, ventas) — derivado del log de auditoría de cada producto.
  </div>
  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Producto</th>
            <th>Campo</th>
            <th>Cambio</th>
            <th>Usuario</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay movimientos registrados.</div>
  </div>
`;

const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

const NOMBRES_CAMPO = {
  sku: "SKU",
  codigoBarras: "Código de barras",
  descripcion: "Descripción",
  marcaId: "Marca",
  categoriaId: "Categoría",
  subcategoriaId: "Subcategoría",
  identificadorExterno: "Identificador externo",
  proveedorPrincipalId: "Proveedor principal",
  codigoProveedorPrincipal: "Código de proveedor",
  costoReferencia: "Costo de referencia",
  iva: "IVA",
  costoModo: "Modo de costeo",
  modoPrecio: "Modo de precio",
  margenObjetivo: "Margen objetivo",
  margenMinimo: "Margen mínimo",
  stockMinimo: "Stock mínimo",
  stockTotal: "Stock",
  estado: "Estado",
  visibilidad: "Visibilidad",
  "*": "Alta de producto",
};

async function resolverNombresUsuarios(uids) {
  const cache = new Map();
  await Promise.all(
    Array.from(uids).map(async (uid) => {
      if (!uid) return;
      const snap = await getDoc(doc(db, "usuarios", uid));
      cache.set(uid, snap.exists() ? snap.data().nombre || snap.data().email : uid);
    })
  );
  return cache;
}

function formatFecha(fecha) {
  if (!fecha || !fecha.toDate) return "-";
  return fecha.toDate().toLocaleString("es-AR");
}

function formatValor(v) {
  if (v === null || v === undefined) return "-";
  return String(v);
}

async function cargar() {
  const movimientos = await obtenerMovimientosRecientes(100);
  emptyState.style.display = movimientos.length === 0 ? "block" : "none";

  const uids = new Set(movimientos.map((m) => m.usuario));
  const nombresUsuarios = await resolverNombresUsuarios(uids);

  tablaBody.innerHTML = "";
  movimientos.forEach((m) => {
    const tr = document.createElement("tr");
    const esAlta = m.campo === "*";
    const cambioHtml = esAlta
      ? '<span class="badge success">Producto creado</span>'
      : `${formatValor(m.valorAnterior)} → ${formatValor(m.valorNuevo)}${m.motivo ? ` <span class="hint">(${m.motivo})</span>` : ""}`;

    tr.innerHTML = `
      <td>${formatFecha(m.fecha)}</td>
      <td>${m.productoSku ? `${m.productoSku} — ${m.productoDescripcion || ""}` : m.productoDescripcion || ""}</td>
      <td>${NOMBRES_CAMPO[m.campo] || m.campo}</td>
      <td>${cambioHtml}</td>
      <td>${nombresUsuarios.get(m.usuario) || m.usuario || ""}</td>
    `;
    if (m.productoId) {
      tr.addEventListener("click", () => {
        location.href = `/productos/form.html?id=${m.productoId}`;
      });
    }
    tablaBody.appendChild(tr);
  });
}

cargar();
