# Tareas

Formato obligatorio. Un hook parsea `status:`, `owner:` y `files:`, así que no lo cambies.

    ### TASK-NNN — título
    status: PENDING | IN_PROGRESS | TESTED | IN_REVIEW | REJECTED | APPROVED | DONE | BLOCKED_NIVEL3 | BLOCKED_TECNICO
    owner: implementador
    depends: TASK-…
    files:
    - ruta/o/glob
    accept:
    - criterio verificable

Reglas: una sola tarea IN_PROGRESS por owner; dos tareas nunca comparten archivos en `files:`;
ninguna tarea pasa a DONE sin `migration/approvals/TASK-NNN.approved`.

---

Todavía no hay tareas. Las escribe el director al final de la FASE 0.

### TASK-000 — Ejemplo (no ejecutar, es solo la plantilla de referencia)
status: PENDING
owner: implementador
depends:
files:
- backend/src/ejemplo.js
accept:
- este bloque existe solo para mostrar el formato; el director lo borra al escribir las tareas reales
