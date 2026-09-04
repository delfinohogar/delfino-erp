// Configuración ya no es una pantalla propia con tarjetas — es el menú lateral interno (ver
// js/configuracion-shell.js), que vive en cada página de configuración. Entrar acá (el link del
// sidebar principal) manda directo a una sección real y siempre accesible, con el menú ya armado.
import { requireAuth } from "/js/auth.js";

const usuario = await requireAuth();
if (!usuario) throw new Error("redirecting to login");

location.replace("/configuracion/general.html");
