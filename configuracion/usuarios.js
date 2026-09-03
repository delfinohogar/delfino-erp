import { requireAuth } from "/js/auth.js";
import { renderConfigShell } from "/js/configuracion-shell.js";
import { listarUsuarios, crearUsuarioCompleto, actualizarPerfilUsuario, listarAuditoriaRoles, ROLES } from "/js/usuarios.js";
import { listarSucursalesActivas } from "/js/sucursales.js";
import { formatFechaHora } from "/js/formato.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = "";
  location.href = "/productos/";
  throw new Error("solo administrador");
}

const content = renderConfigShell({ activeItem: "usuarios", titulo: "Usuarios", usuario });

const ROL_LABEL = {
  administrador: "Administrador",
  administrativo: "Administrativo",
  vendedor: "Vendedor",
};

// La sucursal del usuario decide a qué caja va el efectivo que cobra (ver js/ventas.js) — sin
// asignar, el sistema cae a la primera sucursal activa y avisa en la pantalla de venta.
const sucursales = await listarSucursalesActivas();

content.innerHTML = `
  <div class="toolbar">
    <button type="button" id="btn-nuevo" class="primary">+ Nuevo usuario</button>
  </div>

  <div class="card" id="form-card" style="display:none; padding:20px; margin-bottom:16px; max-width:480px">
    <div class="section-title" id="form-titulo">Nuevo usuario</div>
    <div class="hint" style="margin-bottom:12px" id="form-hint"></div>
    <form id="form-usuario">
      <div class="field">
        <label for="f-nombre">Nombre</label>
        <input type="text" id="f-nombre" required />
      </div>
      <div class="field">
        <label for="f-email">Email</label>
        <input type="email" id="f-email" required />
      </div>
      <div class="field" id="campo-password">
        <label for="f-password">Contraseña inicial</label>
        <input type="text" id="f-password" placeholder="Mínimo 6 caracteres — se la pasás vos a la persona" minlength="6" />
        <div class="hint">La puede cambiar ella misma después iniciando sesión.</div>
      </div>
      <div class="field">
        <label for="f-rol">Rol</label>
        <select id="f-rol">
          ${ROLES.map((r) => `<option value="${r}">${ROL_LABEL[r]}</option>`).join("")}
        </select>
        <button type="button" id="btn-historial-rol" class="link-btn" style="display:none; margin-top:4px">Ver historial de rol</button>
      </div>
      <div class="field">
        <label for="f-sucursal">Sucursal</label>
        <select id="f-sucursal">
          <option value="">Sin asignar (usa la primera sucursal activa al vender)</option>
          ${sucursales.map((s) => `<option value="${s.id}" data-nombre="${s.nombre}">${s.nombre}</option>`).join("")}
        </select>
      </div>
      <div class="toolbar">
        <button type="submit" class="primary">Guardar</button>
        <button type="button" id="btn-cancelar">Cancelar</button>
      </div>
    </form>
  </div>

  <div class="card">
    <div class="table-scroll">
      <table class="table-clickable">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Sucursal</th>
          </tr>
        </thead>
        <tbody id="tabla-body"></tbody>
      </table>
    </div>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay usuarios cargados.</div>
  </div>
`;

const formCard = document.getElementById("form-card");
const formTitulo = document.getElementById("form-titulo");
const formHint = document.getElementById("form-hint");
const campoPassword = document.getElementById("campo-password");
const form = document.getElementById("form-usuario");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

let editandoUid = null;

function abrirFormulario(u) {
  editandoUid = u?.id || null;
  formTitulo.textContent = u ? "Editar usuario" : "Nuevo usuario";
  formHint.textContent = u ? "" : "Esto crea el login y el perfil juntos — la persona ya puede entrar con este email y contraseña.";
  campoPassword.style.display = u ? "none" : "block";
  document.getElementById("f-password").required = !u;
  document.getElementById("f-password").value = "";
  document.getElementById("f-nombre").value = u?.nombre || "";
  document.getElementById("f-email").value = u?.email || "";
  document.getElementById("f-rol").value = u?.rol || "vendedor";
  document.getElementById("f-sucursal").value = u?.sucursalId || "";
  document.getElementById("btn-historial-rol").style.display = u ? "inline" : "none";
  formCard.style.display = "block";
  document.getElementById(u ? "f-nombre" : "f-nombre").focus();
}

document.getElementById("btn-historial-rol").addEventListener("click", async () => {
  if (!editandoUid) return;
  const historial = await listarAuditoriaRoles(editandoUid);
  if (historial.length === 0) {
    alert("Este usuario no tiene cambios de rol registrados.");
    return;
  }
  const texto = historial
    .map((h) => `${formatFechaHora(h.fecha)} — ${h.valorAnterior || "(sin rol)"} → ${h.valorNuevo}, por ${h.usuarioNombre}`)
    .join("\n");
  alert(`Historial de rol:\n\n${texto}`);
});

function cerrarFormulario() {
  formCard.style.display = "none";
  editandoUid = null;
  form.reset();
}

function pintar(usuarios) {
  tablaBody.innerHTML = "";
  emptyState.style.display = usuarios.length === 0 ? "block" : "none";
  usuarios.forEach((u) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.nombre || ""}</td>
      <td>${u.email || ""}</td>
      <td>${ROL_LABEL[u.rol] || u.rol}</td>
      <td>${u.sucursalNombre || '<span class="hint">Sin asignar</span>'}</td>
    `;
    tr.addEventListener("click", () => abrirFormulario(u));
    tablaBody.appendChild(tr);
  });
}

async function cargar() {
  const usuarios = await listarUsuarios();
  pintar(usuarios);
}

document.getElementById("btn-nuevo").addEventListener("click", () => abrirFormulario(null));
document.getElementById("btn-cancelar").addEventListener("click", cerrarFormulario);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  if (errorEl) errorEl.style.display = "none";
  const sucSel = document.getElementById("f-sucursal");
  const datos = {
    nombre: document.getElementById("f-nombre").value.trim(),
    email: document.getElementById("f-email").value.trim(),
    rol: document.getElementById("f-rol").value,
    sucursalId: sucSel.value || null,
    sucursalNombre: sucSel.value ? sucSel.selectedOptions[0].dataset.nombre : null,
  };
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    if (editandoUid) {
      await actualizarPerfilUsuario(editandoUid, datos, usuario);
    } else {
      const password = document.getElementById("f-password").value;
      await crearUsuarioCompleto({ ...datos, password });
    }
    cerrarFormulario();
    cargar();
  } catch (err) {
    alert(err?.message || "No se pudo guardar el usuario.");
  } finally {
    submitBtn.disabled = false;
  }
});

cargar();
