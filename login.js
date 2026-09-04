import { auth, signInWithEmailAndPassword } from "/js/firebase.js";

const params = new URLSearchParams(location.search);
const errorText = document.getElementById("error-text");
if (params.get("error") === "sin-perfil") {
  errorText.textContent = "Tu usuario no tiene un perfil asignado en el sistema. Pedile a un administrador que lo cree.";
  errorText.classList.remove("hidden");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("submit-btn");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  submitBtn.disabled = true;
  submitBtn.textContent = "Ingresando…";
  errorText.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    const next = params.get("next") || "/dashboard.html";
    location.href = next;
  } catch (err) {
    errorText.textContent = "Email o contraseña incorrectos.";
    errorText.classList.remove("hidden");
    submitBtn.disabled = false;
    submitBtn.textContent = "Ingresar";
  }
});
