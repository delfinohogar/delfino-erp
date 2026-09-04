# FASE -1/0 — Guard de propiedad de archivos por rol.
# Se ejecuta como hook PreToolUse de cada agente. Recibe el JSON del evento por stdin.
# Politica: FALLA CERRADO dentro del repo. Cualquier error, formato inesperado o rol
# desconocido => exit 2 (bloquea). Las rutas FUERA del repo no son asunto de este guard.
#
# exit 0 = permitido, exit 2 = bloqueado (el mensaje de stderr vuelve al agente).
#
# Correcciones del 2026-09-04, sobre falsos positivos detectados en la primera sesion real:
#   1. El director puede escribir RISKS.md. La regla anterior lo reservaba al auditor, que no
#      existe hasta la PoC: en FASE 0 el director es el unico que puede mantenerlo.
#   2. Los comandos de git (add, commit, checkout, merge, diff, log...) ya no se tratan como
#      escrituras sobre rutas protegidas. Versionar un archivo no es modificarlo, y el deny
#      de settings.json ya cubre push, remote, reset --hard y demas.
#   3. Las rutas fuera del directorio del repo se permiten sin analisis: el guard gobierna el
#      proyecto, no el disco. Antes bloqueaba cosas como ~/.claude/plans/*.md.

param([Parameter(Mandatory = $true)][string]$Role)

$ErrorActionPreference = "Stop"

function Deny([string]$mensaje) {
    [Console]::Error.WriteLine("guard[$Role]: $mensaje")
    exit 2
}

trap { Deny "error interno del guard: $($_.Exception.Message)" }

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { Deny "no llego input por stdin" }

try { $evento = $raw | ConvertFrom-Json } catch { Deny "el input no es JSON valido" }

$tool = [string]$evento.tool_name
$cwd = ([string]$evento.cwd) -replace '\\', '/'
$cwd = $cwd.TrimEnd('/')

# Devuelve la ruta relativa al repo, o $null si el archivo esta fuera del repo.
function Normalizar([string]$ruta) {
    if ([string]::IsNullOrWhiteSpace($ruta)) { return "" }
    $r = $ruta -replace '\\', '/'
    if (-not $cwd) { return $r.TrimStart('/') }
    if ($r.ToLower().StartsWith($cwd.ToLower())) {
        return $r.Substring($cwd.Length).TrimStart('/')
    }
    # Ruta absoluta que no cuelga del repo: fuera de alcance.
    if ($r -match '^[A-Za-z]:/' -or $r.StartsWith('/')) { return $null }
    return $r.TrimStart('/')
}

function CoincideAlguno([string]$ruta, $patrones) {
    foreach ($p in $patrones) {
        if ([string]::IsNullOrWhiteSpace($p)) { continue }
        $pat = ($p -replace '\\', '/') -replace '\*\*/', '*' -replace '\*\*', '*'
        if ($ruta -like $pat) { return $true }
        if ($pat.EndsWith('/*') -and $ruta -like ($pat + '*')) { return $true }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Bash / PowerShell
# ---------------------------------------------------------------------------
if ($tool -eq "Bash" -or $tool -eq "PowerShell") {
    $cmd = [string]$evento.tool_input.command
    if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

    # CORRECCION 2: git no escribe archivos, los versiona. Las operaciones peligrosas de git
    # (push, remote, reset --hard, rebase, tag, --no-verify) ya estan en permissions.deny.
    # Sin esto, "git add migration/TASKS.md" disparaba el guard en cada commit.
    $sinCd = $cmd -replace '^\s*cd\s+"[^"]*"\s*&&\s*', '' -replace "^\s*cd\s+'[^']*'\s*&&\s*", ''
    if ($sinCd -match '^\s*git\s') { exit 0 }

    $protegidas = 'migration/approvals|migration/TASKS\.md|migration/AUDIT_LOG|\.claude/|\.github/|\.githooks/|functions/|firestore\.rules|firebase\.json|netlify\.toml|build\.js|js/firebase\.js|js/firebase-config\.js|backend/\.env|docker-compose\.yml'
    $escritura = '(>>?|\|\s*tee|Set-Content|Add-Content|Out-File|\bcp\b|\bmv\b|\brm\b|\bdel\b|Remove-Item|Copy-Item|Move-Item|\bsed\b\s+-i|\btruncate\b|\bchmod\b)'

    if ($sinCd -match $escritura -and $sinCd -match $protegidas) {
        Deny "comando de shell que escribe sobre una ruta protegida. Usa Edit/Write si tenes permiso, o pedile al director que amplie la tarea. Comando: $cmd"
    }
    if ($Role -ne "auditor" -and $sinCd -match 'migration/approvals') {
        Deny "solo el auditor puede tocar migration/approvals/"
    }
    if ($sinCd -match 'FIRESTORE_EMULATOR_HOST\s*=' -or $sinCd -match 'FIREBASE_AUTH_EMULATOR_HOST\s*=') {
        Deny "no se puede cambiar la configuracion de emuladores: es la barrera que impide tocar produccion"
    }
    exit 0
}

# ---------------------------------------------------------------------------
# Edit / Write
# ---------------------------------------------------------------------------
if ($tool -notin @("Edit", "Write", "MultiEdit", "NotebookEdit")) { exit 0 }

$ruta = Normalizar ([string]$evento.tool_input.file_path)

# CORRECCION 3: fuera del repo, el guard no opina. Antes bloqueaba ~/.claude/plans/*.md.
if ($null -eq $ruta) { exit 0 }
if ([string]::IsNullOrWhiteSpace($ruta)) { exit 0 }

# Prohibido para todos los roles, sin excepcion. Solo Gaston los modifica.
$nadie = @(
    ".claude/*", ".github/*", ".githooks/*", ".gitattributes", ".gitignore",
    "functions/*", "firestore.rules", "firebase.json", "firestore.indexes.json",
    "netlify.toml", ".netlifyignore", "build.js", "js/firebase.js", "js/firebase-config.js",
    "backend/docker-compose.yml", "backend/.env*",
    "scripts/seed-emulator.mjs", "scripts/safety-prod-denied.mjs", "scripts/check-sintaxis.mjs",
    "migration/AUDIT_LOG.jsonl", "dev-server.py", "publicar/*", "dist/*"
)
if (CoincideAlguno $ruta $nadie) {
    Deny "ruta protegida para todos los roles: $ruta (solo Gaston la modifica)"
}

switch ($Role) {

    "director" {
        # CORRECCION 1: RISKS.md entra aca. El auditor tambien puede escribirlo (ver mas abajo);
        # no es propiedad exclusiva de nadie, es el registro compartido de riesgos.
        $permitidas = @(
            "migration/MASTER_PLAN.md", "migration/ARCHITECTURE.md", "migration/TASKS.md",
            "migration/DECISIONS.md", "migration/MIGRATION_STATUS.md", "migration/POC_REPORT.md",
            "migration/RISKS.md", "migration/shadow/*", "CLAUDE.md", "README.md"
        )
        if (-not (CoincideAlguno $ruta $permitidas)) {
            Deny "el director no escribe $ruta. El codigo lo hace el implementador, los tests el tester, las aprobaciones el auditor."
        }

        # Veto: ninguna tarea pasa a DONE sin la aprobacion del auditor.
        if ($ruta -eq "migration/TASKS.md") {
            $texto = ""
            if ($tool -eq "Write") { $texto = [string]$evento.tool_input.content }
            else { $texto = [string]$evento.tool_input.new_string }

            if ($texto -match 'status:\s*DONE') {
                $ids = [regex]::Matches($texto, 'TASK-\d+') | ForEach-Object { $_.Value } | Select-Object -Unique
                if (-not $ids -or $ids.Count -eq 0) {
                    Deny "la edicion marca status: DONE pero no incluye el ID TASK-NNN. Inclui el encabezado de la tarea en la edicion para que se pueda verificar la aprobacion."
                }
                foreach ($id in $ids) {
                    $aprobacion = Join-Path $cwd "migration/approvals/$id.approved"
                    if (-not (Test-Path $aprobacion)) {
                        Deny "$id no puede pasar a DONE: falta migration/approvals/$id.approved. Solo el auditor escribe ese archivo. Pasa la tarea al auditor."
                    }
                }
            }
        }
        exit 0
    }

    "implementador" {
        if ($ruta -eq "migration/IMPLEMENTATION_LOG.md") { exit 0 }
        if ($ruta -like "migration/*") { Deny "el implementador solo escribe migration/IMPLEMENTATION_LOG.md dentro de migration/" }
        if ($ruta -like "tests/*") { Deny "los tests los escribe el tester, no vos" }

        $tasks = Join-Path $cwd "migration/TASKS.md"
        if (-not (Test-Path $tasks)) { Deny "no existe migration/TASKS.md" }
        $contenido = Get-Content $tasks -Raw -Encoding UTF8

        $bloques = [regex]::Split($contenido, '(?m)^###\s+')
        $archivos = @()
        $encontrada = 0
        foreach ($b in $bloques) {
            if (($b -match '(?m)^status:\s*IN_PROGRESS\s*$') -and ($b -match '(?m)^owner:\s*implementador\s*$')) {
                $encontrada++
                $enFiles = $false
                foreach ($linea in ($b -split "`r?`n")) {
                    if ($linea -match '^files:\s*$') { $enFiles = $true; continue }
                    if ($enFiles) {
                        if ($linea -match '^\s*-\s*(\S.*?)\s*$') { $archivos += $Matches[1] }
                        elseif ($linea -match '^\S') { $enFiles = $false }
                    }
                }
            }
        }
        if ($encontrada -eq 0) { Deny "no hay ninguna tarea con status IN_PROGRESS y owner implementador en TASKS.md" }
        if ($encontrada -gt 1) { Deny "hay $encontrada tareas IN_PROGRESS para implementador; solo puede haber una. El director tiene que corregir TASKS.md" }
        if ($archivos.Count -eq 0) { Deny "la tarea IN_PROGRESS no declara ningun archivo en files:" }

        if (-not (CoincideAlguno $ruta $archivos)) {
            Deny "$ruta no esta en files: de la tarea IN_PROGRESS. Archivos permitidos: $($archivos -join ', '). Si necesitas otro, devolve 'NECESITO: $ruta' al director."
        }
        exit 0
    }

    "tester" {
        $permitidas = @(
            "tests/*", "package.json", "package-lock.json",
            "vitest.config.js", "vitest.integration.config.js",
            "migration/TEST_MATRIX.md", "migration/TEST_RESULTS.md"
        )
        if (-not (CoincideAlguno $ruta $permitidas)) {
            Deny "el tester solo escribe tests/, la config de vitest, package.json y migration/TEST_*.md. Intentaste: $ruta"
        }
        exit 0
    }

    "auditor" {
        $permitidas = @("migration/approvals/*", "migration/RISKS.md")
        if (-not (CoincideAlguno $ruta $permitidas)) {
            Deny "el auditor solo escribe migration/approvals/ y migration/RISKS.md. Intentaste: $ruta"
        }
        exit 0
    }

    default { Deny "rol desconocido: '$Role'" }
}

Deny "no se pudo evaluar la operacion; se bloquea por precaucion"
