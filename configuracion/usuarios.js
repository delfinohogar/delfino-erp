import { requireAuth } from "/js/auth.js";
import { renderShell } from "/js/shell.js";
import { listarUsuarios, crearPerfilUsuario, actualizarPerfilUsuario, ROLES } from "/js/usuarios.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

if (usuario.rol !== "administrador") {
  document.body.innerHTML = "";
  location.href = "/productos/";
  throw new Error("solo administrador");
}

const content = renderShell({ active: "configuracion", titulo: "Usuarios", usuario });

const ROL_LABEL = {
  administrador: "Administrador",
  administrativo: "Administrativo",
  vendedor: "Vendedor",
};

content.innerHTML = `
  <div class="toolbar">
    <button type="button" id="btn-nuevo" class="primary">+ Nuevo usuario</button>
  </div>

  <div class="card" id="form-card" style="display:none; padding:20px; margin-bottom:16px; max-width:480px">
    <div class="section-title" id="form-titulo">Nuevo usuario</div>
    <div class="hint" style="margin-bottom:12px" id="form-hint"></div>
    <form id="form-usuario">
      <div class="field" id="campo-uid">
        <label for="f-uid">UID (de Firebase Authentication)</label>
        <input type="text" id="f-uid" placeholder="Lo copiás de Authentication en Firebase Console" required />
      </div>
      <div class="field">
        <label for="f-nombre">Nombre</label>
        <input type="text" id="f-nombre" required />
      </div>
      <div class="field">
        <label for="f-email">Email</label>
        <input type="email" id="f-email" required />
      </div>
      <div class="field">
        <label for="f-rol">Rol</label>
        <select id="f-rol">
          ${ROLES.map((r) => `<option value="${r}">${ROL_LABEL[r]}</option>`).join("")}
        </select>
      </div>
      <div class="toolbar">
        <button type="submit" class="primary">Guardar</button>
        <button type="button" id="btn-cancelar">Cancelar</button>
      </div>
    </form>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Email</th>
          <th>Rol</th>
        </tr>
      </thead>
      <tbody id="tabla-body"></tbody>
    </table>
    <div id="empty-state" class="empty-state" style="display:none">Todavía no hay usuarios cargados.</div>
  </div>
`;

const formCard = document.getElementById("form-card");
const formTitulo = document.getElementById("form-titulo");
const formHint = document.getElementById("form-hint");
const campoUid = document.getElementById("campo-uid");
const form = document.getElementById("form-usuario");
const tablaBody = document.getElementById("tabla-body");
const emptyState = document.getElementById("empty-state");

let editandoUid = null;

function abrirFormulario(u) {
  editandoUid = u?.id || null;
  formTitulo.textContent = u ? "Editar usuario" : "Nuevo usuario";
  formHint.textContent = u
    ? ""
    : "Primero creá el login (email + contraseña) en Firebase Console → Authentication → Add user, y pegá acá el UID que te da.";
  campoUid.style.display = u ? "none" : "block";
  document.getElementById("f-uid").required = !u;
  document.getElementById("f-uid").value = u?.id || "";
  document.getElementById("f-nombre").value = u?.nombre || "";
  document.getElementById("f-email").value = u?.email || "";
  document.getElementById("f-rol").value = u?.rol || "vendedor";
  formCard.style.display = "block";
  document.getElementById(u ? "f-nombre" : "f-uid").focus();
}

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
  const datos = {
    nombre: document.getElementById("f-nombre").value.trim(),
    email: document.getElementById("f-email").value.trim(),
    rol: document.getElementById("f-rol").value,
  };
  if (editandoUid) {
    await actualizarPerfilUsuario(editandoUid, datos);
  } else {
    const uid = document.getElementById("f-uid").value.trim();
    await crearPerfilUsuario({ uid, ...datos });
  }
  cerrarFormulario();
  cargar();
});

cargar();
