# FASE -1 — Segunda barrera de aprobacion.
# Corre en el evento TaskCompleted (lista de tareas interna de Claude Code) y bloquea el
# cierre de cualquier tarea que no tenga la aprobacion del auditor en disco.
# Es redundante con el veto sobre migration/TASKS.md del guard: a proposito.
$ErrorActionPreference = "Stop"

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { [Console]::Error.WriteLine("task-completed: sin input"); exit 2 }
try { $d = $raw | ConvertFrom-Json } catch { [Console]::Error.WriteLine("task-completed: input no es JSON"); exit 2 }

$texto = "$($d.task_subject) $($d.task_description)"
$m = [regex]::Match($texto, 'TASK-\d+')
if (-not $m.Success) {
    [Console]::Error.WriteLine("La tarea no tiene un ID TASK-NNN en su titulo o descripcion. El director debe nombrarlas 'TASK-NNN — titulo'.")
    exit 2
}

$id = $m.Value
$cwd = [string]$d.cwd
$aprobacion = Join-Path $cwd "migration/approvals/$id.approved"

if (-not (Test-Path $aprobacion)) {
    [Console]::Error.WriteLine("$id no puede cerrarse: falta la aprobacion del auditor en migration/approvals/$id.approved")
    exit 2
}

$entrada = @{
    ts      = (Get-Date).ToString("o")
    task    = $id
    event   = "completed"
    by      = $d.teammate_name
    session = $d.session_id
} | ConvertTo-Json -Compress

Add-Content -Path (Join-Path $cwd "migration/AUDIT_LOG.jsonl") -Value $entrada -Encoding UTF8
exit 0
