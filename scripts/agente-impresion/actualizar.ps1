# Pone al dia el agente de impresion de ESTA caja con Windows.
#
# El gemelo de actualizar.sh. Se corre una sola vez por computadora, desde un
# PowerShell abierto como administrador, de una linea:
#
#   irm https://portal.farmasalud.lat/agente-impresion/actualizar.ps1 | iex
#
# De ahi en adelante el agente se actualiza solo. NO toca `agente.conf`.
#
# Va en ASCII a proposito: `irm | iex` lo baja como texto, y sin BOM PowerShell
# 5.1 romperia cualquier tilde.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PORTAL  = 'https://portal.farmasalud.lat'
$DESTINO = Join-Path $env:ProgramData 'Farmalasa\agente-impresion'
$AGENTE  = Join-Path $DESTINO 'agente.py'
$LOG     = Join-Path $DESTINO 'agente.log'

function Morir($t) { Write-Host "x $t" -ForegroundColor Red; return }

$yo = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $yo.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Morir 'Hay que abrir PowerShell como administrador (clic derecho > Ejecutar como administrador).'; return
}
if (-not (Test-Path $AGENTE)) {
    Morir "Aca no hay ningun agente instalado ($DESTINO). Para instalarlo se usa instalar.cmd."; return
}
$PY = (Get-Content (Join-Path $DESTINO 'python.txt') -Raw).Trim()

$tmp = Join-Path $env:TEMP ('agente-' + [guid]::NewGuid().ToString('N') + '.py')
Write-Host 'Bajando la version publicada...' -ForegroundColor DarkGray
Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri "$PORTAL/agente-impresion/agente.py" -OutFile $tmp
$esperado = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri "$PORTAL/agente-impresion/agente.sha256").Content
if ($esperado -is [byte[]]) { $esperado = [Text.Encoding]::ASCII.GetString($esperado) }
$esperado = "$esperado".Trim().Substring(0, 64).ToLower()

# El hash se comprueba SIEMPRE: un despliegue a medias sirve un archivo que no
# corresponde a su firma, y eso no se ve leyendo el archivo.
$bajado = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
if ($bajado -ne $esperado) { Remove-Item $tmp; Morir 'Lo que se bajo no coincide con su firma. No se instala nada.'; return }

$actual = (Get-FileHash -Algorithm SHA256 $AGENTE).Hash.ToLower()
if ($actual -eq $esperado) {
    Remove-Item $tmp
    Write-Host "OK - Esta caja ya estaba al dia ($($esperado.Substring(0,12)))." -ForegroundColor Green; return
}

# Que ARRANQUE, no solo que compile (ver instalar_version_nueva en agente.py).
Push-Location $DESTINO
& $PY $tmp --autoprueba 2>&1 | Out-Null
$arranca = ($LASTEXITCODE -eq 0)
Pop-Location
if (-not $arranca) { Remove-Item $tmp; Morir 'La version publicada no arranca. No se instala nada.'; return }

Copy-Item -Force $AGENTE "$AGENTE.anterior"
Copy-Item -Force $tmp $AGENTE
Remove-Item $tmp
Write-Host "OK - Programa actualizado ($($actual.Substring(0,12)) -> $($esperado.Substring(0,12)))" -ForegroundColor Green

# Basta con cerrar el Python que corre: el vigilante (iniciar.cmd) lo vuelve a
# abrir a los diez segundos con el archivo nuevo.
$antes = if (Test-Path $LOG) { (Get-Item $LOG).Length } else { 0 }
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
    Where-Object { $_.CommandLine -like '*agente.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 15

$nuevo = ''
if (Test-Path $LOG) {
    $fs = [IO.File]::Open($LOG, 'Open', 'Read', 'ReadWrite')
    try { $fs.Seek([Math]::Min($antes, $fs.Length), 'Begin') | Out-Null; $nuevo = (New-Object IO.StreamReader $fs).ReadToEnd() }
    finally { $fs.Close() }
}
if ($nuevo -match 'en marcha') {
    Write-Host 'OK - El agente volvio a arrancar' -ForegroundColor Green
} else {
    Write-Host 'x El agente no arranco. Volviendo a la version anterior.' -ForegroundColor Red
    Copy-Item -Force "$AGENTE.anterior" $AGENTE
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
        Where-Object { $_.CommandLine -like '*agente.py*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "Se dejo la version de antes. Lo que paso queda en $LOG" -ForegroundColor Red
}
