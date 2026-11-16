# SPDX-License-Identifier: AGPL-3.0-or-later
# Starts the dev MQTT broker, portal API and device simulator, each in its own window.
# Usage (from anywhere):  .\tools\dev-up.ps1 [-Devices 6]
param([int]$Devices = 6)

$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Error "Python venv not found at $py. See server\README.md for one-time setup."
    exit 1
}
if (-not (Test-Path (Join-Path $root "server\portal-web\dist"))) {
    Write-Warning "Web app not built; run 'npm install; npm run build' in server\portal-web. The API will still run."
}

function Start-Window($title, $dir, $command) {
    $cmd = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; $command"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd | Out-Null
}

Start-Window "OpenComms broker" $root "& '$py' tools\dev-broker\broker.py"
Start-Sleep 2
Start-Window "OpenComms API" (Join-Path $root "server\portal-api") "& '$py' -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
Start-Sleep 4
Start-Window "OpenComms simulator" $root "& '$py' tools\device-sim\sim.py --count $Devices"

Write-Host "Portal: http://127.0.0.1:8000  (close the three windows to stop)"
