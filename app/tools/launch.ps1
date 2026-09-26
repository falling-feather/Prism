$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $appRoot '.venv/Scripts/python.exe'
Set-Location -LiteralPath $appRoot
$health = $null
try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 2
} catch { }
if ($health) {
    if ($health.version -eq '0.3.1') { Start-Process 'http://127.0.0.1:8765'; exit }
    throw 'Port 8765 is running an older service. Close that service after saving your project, then launch again.'
}
if (-not (Test-Path -LiteralPath $pythonPath)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment setup failed.' }
}
& $pythonPath -c 'import playwright' 2>$null
if ($LASTEXITCODE -ne 0) {
    & $pythonPath -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Export dependencies could not be installed.' }
}
$workPath = Join-Path $appRoot '.work'
if (-not (Test-Path -LiteralPath $workPath)) { New-Item -ItemType Directory -Path $workPath | Out-Null }
Start-Process -FilePath $pythonPath -ArgumentList @('-X','utf8','tools/server.py','--open') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workPath 'launcher.log') -RedirectStandardError (Join-Path $workPath 'launcher-error.log')
