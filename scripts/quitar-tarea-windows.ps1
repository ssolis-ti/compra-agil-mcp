# Detiene y quita la tarea programada de la vigilancia de mcp-compra-agil.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\quitar-tarea-windows.ps1
# El estado (.vigilancia.json) y el log se conservan: al reinstalar, la
# vigilancia retoma desde el último lote revisado (hasta 48 h atrás).

$ErrorActionPreference = 'Stop'
$Nombre = 'mcp-compra-agil-vigilancia'
if (Get-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Nombre -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
    Write-Host "Tarea '$Nombre' quitada."
} else {
    Write-Host "No hay una tarea '$Nombre' instalada."
}
