# Deploy local de la app con poca RAM (máquina de 6 GB). Envuelve scripts/cf-deploy.sh.
#
# Uso (desde la raíz del proyecto, en PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1               # build + subida
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1 -SoloSubir    # reusa .open-next si es del commit
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1 -CerrarApps   # cierra Chrome, Wispr, etc.
#
# Qué hace:
#   1. Cierra builds huérfanos (next build / opennext / wrangler / esbuild / workerd de este proyecto).
#   2. Con -CerrarApps cierra apps pesadas que no hacen falta para desplegar.
#   3. Exige memoria libre mínima (por defecto 2200 MB) y aborta si no alcanza.
#   4. Corre cf-deploy.sh con IPv4 forzado y reintentos de subida; el log queda en %TEMP%\deploy-app.log.
#   5. Verifica que .env.local siga y que producción responda.
# Lo más liviano es no compilar acá: ver .github/workflows/deploy-app.yml (build en GitHub).
param(
  [switch]$SoloSubir,
  [switch]$CerrarApps,
  [int]$MinimoMB = 2200
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Get-LibreMB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }

if (-not (Test-Path ".env.local")) { throw "No está .env.local; no despliego." }

# 1. Builds huérfanos de corridas cortadas (solo procesos de este proyecto).
$raiz = (Get-Location).Path
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='esbuild.exe' OR Name='workerd.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($raiz) -and $_.CommandLine -match 'next|opennext|wrangler|esbuild|workerd' } |
  ForEach-Object { Write-Host "Cierro build huérfano $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2. Apps pesadas (solo si se pide).
if ($CerrarApps) {
  foreach ($n in 'chrome', 'msedge', 'Wispr Flow', 'Teams', 'ms-teams', 'Spotify', 'Discord', 'slack') {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 3
}

# 3. Memoria mínima (con -SoloSubir alcanza mucho menos: no hay build).
$minimo = if ($SoloSubir) { 600 } else { $MinimoMB }
$libre = Get-LibreMB
Write-Host "Memoria libre: $libre MB (mínimo $minimo MB)"
if ($libre -lt $minimo) {
  throw "Memoria insuficiente ($libre MB). Cerrá apps o corré con -CerrarApps, o desplegá desde GitHub (Actions → Deploy app)."
}

# 4. Deploy.
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"
if ($SoloSubir) { $env:SOLO_SUBIR = "1" } else { Remove-Item Env:SOLO_SUBIR -ErrorAction SilentlyContinue }
$log = Join-Path $env:TEMP "deploy-app.log"
& "C:\Program Files\Git\bin\bash.exe" scripts/cf-deploy.sh *> $log
$codigo = $LASTEXITCODE
Get-Content $log | Select-String -Pattern "SOLO_SUBIR|Uploaded opsyn-dely|Current Version ID|falló|No se pudo|ERROR" | Select-Object -Last 6 | ForEach-Object { Write-Host $_.Line }

# 5. Verificación.
if (-not (Test-Path ".env.local")) { throw "ALERTA: falta .env.local después del deploy." }
if ($codigo -ne 0) { throw "El deploy falló (código $codigo). Log: $log" }
$estado = (Invoke-WebRequest -Uri "https://opsyndely.la-gambeta.com/" -UseBasicParsing -TimeoutSec 30).StatusCode
Write-Host "Producción responde: $estado"
Write-Host "Deploy OK. Memoria libre ahora: $(Get-LibreMB) MB"
