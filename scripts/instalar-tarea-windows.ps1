# Instala la vigilancia de mcp-compra-agil como tarea programada de Windows
# (2.9.0, R10.3): arranca al iniciar sesión, se reinicia si se cae y no tiene
# límite de tiempo. No necesita permisos de administrador.
#
# Uso (PowerShell, desde la carpeta del proyecto, después de npm run build):
#   powershell -ExecutionPolicy Bypass -File scripts\instalar-tarea-windows.ps1
# Para quitarla: scripts\quitar-tarea-windows.ps1
#
# El ticket y los canales se leen del .env del proyecto: este script no los
# toca ni los pide. El log queda en vigilancia.log de la carpeta de datos.
#
# -Node y -Entrada: los usa la herramienta activar_vigilancia cuando el
# servidor corre como extensión de Claude Desktop, que trae su propio Node.

param(
    [string]$Node = '',
    [string]$Entrada = ''
)

$ErrorActionPreference = 'Stop'
$Nombre = 'mcp-compra-agil-vigilancia'
$Proyecto = Split-Path -Parent $PSScriptRoot
if (-not $Entrada) { $Entrada = Join-Path $Proyecto 'dist\index.js' }
$Proyecto = Split-Path -Parent (Split-Path -Parent $Entrada)

if (-not (Test-Path $Entrada)) {
    Write-Error "No existe $Entrada. Corre primero: npm install && npm run build"
}
if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $Node) {
    Write-Error 'No se encontró node en el PATH. Instala Node.js 20.16+ o 22.3+.'
}

# Antes de instalar, el diagnóstico: si algo falla, no se instala a ciegas.
& $Node $Entrada --check
if ($LASTEXITCODE -ne 0) {
    Write-Error 'mcp-compra-agil --check encontró problemas (ver arriba). Corrígelos y vuelve a intentar.'
}

$Accion = New-ScheduledTaskAction -Execute $Node -Argument "`"$Entrada`" --vigilar" -WorkingDirectory $Proyecto
$Disparador = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Ajustes = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew -StartWhenAvailable

# Si ya estaba instalada y corriendo, se detiene: la vigilancia lee el .env al
# arrancar, y así toma la configuración nueva (por ejemplo, tras --configurar).
if (Get-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue
}
Register-ScheduledTask -TaskName $Nombre -Action $Accion -Trigger $Disparador -Settings $Ajustes `
    -Description 'Vigilancia de Compra Ágil (mcp-compra-agil --vigilar): lee los procesos nuevos y avisa por los canales del .env.' `
    -Force | Out-Null
Start-ScheduledTask -TaskName $Nombre

Write-Host "Tarea '$Nombre' instalada y en marcha."
Write-Host 'Comprueba en un par de minutos con: node dist\index.js --check  (debe decir «Vigilancia activa»).'
