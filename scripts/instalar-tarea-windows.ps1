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

$ErrorActionPreference = 'Stop'
$Nombre = 'mcp-compra-agil-vigilancia'
$Proyecto = Split-Path -Parent $PSScriptRoot
$Entrada = Join-Path $Proyecto 'dist\index.js'

if (-not (Test-Path $Entrada)) {
    Write-Error "No existe $Entrada. Corre primero: npm install && npm run build"
}
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
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

Register-ScheduledTask -TaskName $Nombre -Action $Accion -Trigger $Disparador -Settings $Ajustes `
    -Description 'Vigilancia de Compra Ágil (mcp-compra-agil --vigilar): lee los procesos nuevos y avisa por los canales del .env.' `
    -Force | Out-Null
Start-ScheduledTask -TaskName $Nombre

Write-Host "Tarea '$Nombre' instalada y en marcha."
Write-Host 'Comprueba en un par de minutos con: node dist\index.js --check  (debe decir «Vigilancia activa»).'
