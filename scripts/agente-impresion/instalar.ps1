# Instalador del agente de impresión para WINDOWS — Portal Farmalasa.
#
# El gemelo de instalar.sh para una caja que se reemplazó por una computadora
# con Windows (usuario, 2026-11-04: «estemos listos para Windows por cualquier
# cosa»). Se abre con doble clic en `instalar.cmd`, que lo corre como
# administrador. Lo único que hay que tener a mano es el código de 8 letras.
#
# Hace lo mismo que el de Linux, con las piezas de Windows:
#   · Python            → lo instala con winget si falta
#   · la ticketera      → la busca en las impresoras de Windows
#   · el servicio       → una tarea programada que arranca con la computadora,
#                         como SYSTEM, sin ventana y sin límite de tiempo
#   · la prueba         → una hoja por el MISMO camino que van a usar los tickets
#
# Escrito para Windows PowerShell 5.1 (el que trae Windows 10/11): nada de
# operadores de PowerShell 7. Va guardado con BOM: sin él, PowerShell 5.1 lee
# el archivo como ANSI y cada tilde sale rota en pantalla.

$ErrorActionPreference = 'Stop'

# ── Estos dos NO son secretos (ver instalar.sh) ─────────────────────────────
$URL  = 'https://sacecdkdmsdvgqnrsett.supabase.co'
$ANON = 'sb_publishable_cdFHhrbNAqfoA7FIsEgL3A_COHXzBoz'

$DESTINO = Join-Path $env:ProgramData 'Farmalasa\agente-impresion'
$TAREA   = 'Farmalasa - agente de impresion'
$AQUI    = Split-Path -Parent $MyInvocation.MyCommand.Path

function Verde($t) { Write-Host $t -ForegroundColor Green }
function Rojo($t)  { Write-Host $t -ForegroundColor Red }
function Gris($t)  { Write-Host $t -ForegroundColor DarkGray }
function Titulo($t){ Write-Host ''; Write-Host $t -ForegroundColor White }
function Morir($t) { Rojo "  x $t"; Write-Host ''; Read-Host 'Enter para cerrar' | Out-Null; exit 1 }

# ── 0. Como administrador ────────────────────────────────────────────────────
# La tarea corre como SYSTEM y la carpeta queda cerrada a los demás usuarios:
# las dos cosas piden administrador. Si no lo es, se vuelve a abrir pidiéndolo.
$yo = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $yo.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"")
    exit 0
}

# PowerShell 5.1 negocia TLS 1.0 por defecto y el portal no lo acepta.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Titulo 'Agente de impresión · Portal Farmalasa (Windows)'
Gris 'Esta computadora va a imprimir lo que se le mande desde el portal.'

# ── 1. ¿Sirve esta computadora? ──────────────────────────────────────────────
Titulo '1) Revisando la computadora'

function Buscar-Python {
    # `py` es el lanzador oficial; `python` puede ser el atajo de la Tienda de
    # Microsoft (WindowsApps), que no es Python: abre la Tienda y no devuelve nada.
    # (Dos intentos escritos a mano y no un bucle sobre @(@(...), @(...)): en
    # PowerShell @() aplana los arreglos de adentro y el bucle vería tres.)
    $codigo = 'import sys; print(sys.executable)'
    $rutas = @()
    try { $rutas += @(& py -3 -c $codigo 2>$null) } catch { }
    try { $rutas += @(& python -c $codigo 2>$null) } catch { }
    foreach ($ruta in $rutas) {
        $ruta = "$ruta".Trim()
        if ($ruta -and ($ruta -notmatch 'WindowsApps') -and (Test-Path $ruta)) { return $ruta }
    }
    foreach ($r in (Get-ChildItem "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue)) {
        return $r.FullName
    }
    return $null
}

$PY = Buscar-Python
if (-not $PY) {
    Rojo '  ! Falta Python 3.'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $ok = Read-Host '  ¿Lo instalo ahora? [S/n]'
        if ($ok -match '^[nN]') { Morir 'Sin Python no se puede seguir.' }
        Gris '  Instalando Python (unos minutos)…'
        # --scope machine: para TODOS los usuarios, porque la tarea corre como
        # SYSTEM y no vería un Python instalado sólo en la carpeta de alguien.
        winget install --id Python.Python.3.12 --scope machine --silent `
            --accept-package-agreements --accept-source-agreements | Out-Null
        $PY = Buscar-Python
    }
    if (-not $PY) {
        Morir ('Instalá Python 3 desde python.org marcando «Install for all users» ' +
               'y «Add python.exe to PATH», y volvé a abrir este instalador.')
    }
}
Verde "  ✓ Python ($PY)"

# Las mismas dos preguntas que instalar.sh, por separado: ¿llegó la red? y
# ¿la aceptaron? Confundirlas manda a revisar el cable cuando es la llave.
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 `
        -Uri "$URL/rest/v1/branches?select=id&limit=1" `
        -Headers @{ apikey = $ANON; Authorization = "Bearer $ANON" }
    if ($r.StatusCode -ne 200) { Morir "El portal rechazó a esta computadora (código $($r.StatusCode)). Pedí una copia nueva de esta carpeta." }
} catch {
    if ($_.Exception.Response) {
        Morir "Hay internet y el portal contestó, pero rechazó a esta computadora ($([int]$_.Exception.Response.StatusCode)). Pedí una copia nueva de esta carpeta."
    }
    Morir 'Esta computadora no llega al portal. Revisá la conexión a internet.'
}
Verde '  ✓ Llega al portal'

# ── 2. ¿Cuál es la ticketera? ────────────────────────────────────────────────
Titulo '2) Buscando la ticketera'

try   { $impresoras = @(Get-Printer | Select-Object Name, DriverName, PortName) }
catch { $impresoras = @(Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName) }
if ($impresoras.Count -eq 0) { Morir 'No hay ninguna impresora instalada en Windows. Instalá la ticketera primero.' }

$IMPRESORA = $null
foreach ($p in $impresoras) {
    if ("$($p.Name) $($p.DriverName)" -match '(?i)pos|tick|tm-|zj|rp\d|xprinter|thermal|t[eé]rmica|80mm|58mm') {
        $IMPRESORA = $p; break
    }
}
if ($IMPRESORA) {
    Verde "  ✓ Encontrada: $($IMPRESORA.Name)"
    $ok = Read-Host '  ¿Es ésa la ticketera? [S/n]'
    if ($ok -match '^[nN]') { $IMPRESORA = $null }
}
if (-not $IMPRESORA) {
    Write-Host '  Impresoras de esta computadora:'
    for ($i = 0; $i -lt $impresoras.Count; $i++) { Write-Host "    $($i + 1)) $($impresoras[$i].Name)" }
    $n = Read-Host '  ¿Cuál es la ticketera? (número)'
    $i = 0; [void][int]::TryParse("$n", [ref]$i)
    $IMPRESORA = if ($i -ge 1 -and $i -le $impresoras.Count) { $impresoras[$i - 1] } else { $null }
    if (-not $IMPRESORA) { Morir 'No se eligió ninguna impresora.' }
}
# Una impresora «de red» conectada por un usuario (\\otra-pc\ticketera) no la
# ve SYSTEM, que es quien corre la tarea: el papel no saldría nunca.
if ("$($IMPRESORA.Name)$($IMPRESORA.PortName)" -match '^\\\\') {
    Rojo '  ! Esa impresora es una conexión de red de este usuario; el agente no la va a ver.'
    Gris '    Lo seguro es enchufar la ticketera por USB a esta computadora e instalarla ahí.'
    $ok = Read-Host '  ¿Seguir igual? [s/N]'
    if ($ok -notmatch '^[sS]') { Morir 'Instalá la ticketera en esta computadora y volvé a correr esto.' }
}
$NOMBRE_IMPRESORA = $IMPRESORA.Name

# ── 3. El código del portal ──────────────────────────────────────────────────
Titulo '3) Vinculando con el portal'
Gris '  En el portal: Sistema → Prueba de impresión → Cajas de las salas'
Gris '  Ahí sale un código de 8 letras. Dura 15 minutos.'
Write-Host ''

$vinculo = $null
for ($intento = 1; $intento -le 3; $intento++) {
    $codigo = ((Read-Host '  Código') -replace '[\s-]', '').ToUpper()
    $cuerpo = @{ p_codigo = $codigo; p_equipo = $env:COMPUTERNAME; p_impresora = $NOMBRE_IMPRESORA } | ConvertTo-Json
    try {
        $resp = Invoke-RestMethod -Method Post -TimeoutSec 20 -Uri "$URL/rest/v1/rpc/canjear_codigo_de_vinculacion" `
            -Headers @{ apikey = $ANON; Authorization = "Bearer $ANON" } `
            -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo))
        $fila = @($resp)[0]
        if ($fila.device_id -and $fila.device_token) { $vinculo = $fila; break }
    } catch { }
    Rojo '  x Ese código no sirvió. Puede haber vencido o ya haberse usado.'
}
if (-not $vinculo) { Morir 'Generá un código nuevo en el portal y volvé a correr esto.' }
$SALA = $vinculo.sala
Verde "  ✓ Vinculada a $SALA"

# ── 4. Dejarla lista ─────────────────────────────────────────────────────────
Titulo '4) Instalando'

# Si ya había un agente (reinstalación), se para antes de tocar sus archivos.
if (Get-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agente.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $DESTINO | Out-Null
Copy-Item -Force (Join-Path $AQUI 'agente.py') $DESTINO
Unblock-File (Join-Path $DESTINO 'agente.py') -ErrorAction SilentlyContinue

# Sin BOM: agente.py lee el archivo como UTF-8 y un BOM se pegaría a la primera clave.
$sinBom = New-Object Text.UTF8Encoding $false
$conf = @"
# Escrito por instalar.ps1 — no hace falta editarlo a mano.
SUPABASE_URL=$URL
SUPABASE_ANON_KEY=$ANON
DEVICE_ID=$($vinculo.device_id)
DEVICE_TOKEN=$($vinculo.device_token)
# El nombre de la ticketera en Windows. Si se reinstala con otro nombre, se
# corrige acá y se reinicia la computadora (o la tarea programada).
IMPRESORA=$NOMBRE_IMPRESORA
# CORTAR=1   # el ticket ya trae su corte; esto agrega un segundo, y total
"@
[IO.File]::WriteAllText((Join-Path $DESTINO 'agente.conf'), $conf, $sinBom)
[IO.File]::WriteAllText((Join-Path $DESTINO 'python.txt'), $PY, $sinBom)

# El vigilante. Python sale con 0 cuando se actualizó solo (en Linux lo levanta
# systemd); acá lo levanta este bucle a los diez segundos con el archivo nuevo.
# La espera es con `ping` y no con `timeout`: `timeout` exige una consola de
# entrada, y una tarea de SYSTEM no la tiene — fallaría al instante y el bucle
# daría vueltas sin pausa.
$vigilante = @"
@echo off
cd /d "%~dp0"
:otra
for %%F in (agente.log) do if %%~zF GTR 5000000 move /y agente.log agente.log.1 >nul
"$PY" -u agente.py >> agente.log 2>&1
ping -n 11 127.0.0.1 >nul
goto otra
"@
# Con CRLF: un .cmd con saltos de Unix rompe los `goto` y el bucle no vuelve.
$vigilante = $vigilante -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $DESTINO 'iniciar.cmd'), $vigilante, [Text.Encoding]::ASCII)

# El archivo lleva el token: sólo lo leen SYSTEM y los administradores. Por SID
# y no por nombre: en un Windows en español el grupo se llama «Administradores».
icacls $DESTINO /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /Q | Out-Null
Verde '  ✓ Configuración escrita'

# Una tarea programada y no un servicio: un servicio de Windows exige un
# programa que hable con el administrador de servicios, y esto no lo necesita.
# Los ajustes que importan: sin límite de tiempo (el de fábrica es de 72 horas
# y la mataría al tercer día), que arranque aunque la luz haya vuelto tarde, y
# que no se detenga con batería.
$accion   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$DESTINO\iniciar.cmd`"" -WorkingDirectory $DESTINO
$cuando   = New-ScheduledTaskTrigger -AtStartup
$quien    = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TAREA -Action $accion -Trigger $cuando -Principal $quien `
    -Settings $ajustes -Force | Out-Null

# ── 5. La prueba de verdad es el papel ───────────────────────────────────────
Titulo '5) Probando'
# Por el MISMO camino que van a usar los tickets: la cola de Windows, en crudo.
$salida = & $PY (Join-Path $DESTINO 'agente.py') --hoja-de-prueba $SALA 2>&1
if ($LASTEXITCODE -eq 0) { Verde '  ✓ Se mandó una hoja de prueba' }
else { Rojo "  x No se pudo imprimir la prueba: $salida"; Gris '    (el agente igual queda instalado)' }

Start-ScheduledTask -TaskName $TAREA
Start-Sleep -Seconds 8
$log = Join-Path $DESTINO 'agente.log'
if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'en marcha' -Quiet)) {
    Verde '  ✓ El agente quedó encendido (se prende solo al reiniciar)'
} else {
    Rojo '  x El agente no arrancó. Lo que dejó escrito:'
    if (Test-Path $log) { Get-Content $log -Tail 15 }
    Morir 'Revisá el mensaje de arriba.'
}

Titulo 'Listo.'
Write-Host "  Sala:      $SALA"
Write-Host "  Ticketera: $NOMBRE_IMPRESORA"
Write-Host ''
Gris '  ¿Salió el papel de prueba? Entonces ya está.'
Gris "  Lo que va haciendo queda en: $log"
Write-Host ''
Read-Host 'Enter para cerrar' | Out-Null
