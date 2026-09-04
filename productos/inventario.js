import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";

const usuario = await requireAuth();
if (usuario) {
  const content = renderShell({ active: "inventario", titulo: "Inventario", usuario });
  content.innerHTML = `
    <div class="card empty-state">
      Vista de stock por depósito/sucursal — pendiente de implementar.
    </div>
  `;
}
