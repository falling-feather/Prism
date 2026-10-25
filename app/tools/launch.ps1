$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $appRoot '.venv/Scripts/python.exe'
Set-Location -LiteralPath $appRoot
$launchPort = $null
foreach ($prismPort in 8765..8774) {
    $health = $null
    try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$prismPort/api/health" -TimeoutSec 2 } catch { }
    if ($health.version -eq '0.4.2') { Start-Process "http://127.0.0.1:$prismPort"; exit }
    if ($null -eq $launchPort) {
        $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $prismPort)
        try { $probe.Start(); $launchPort = $prismPort } catch { } finally { $probe.Stop() }
    }
}
if ($null -eq $launchPort) { throw 'No free local Prism port in 8765-8774. Save and close an unused service, then launch again.' }
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
Start-Process -FilePath $pythonPath -ArgumentList @('-X','utf8','tools/server.py','--port',"$launchPort",'--open') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workPath "launcher-$launchPort.log") -RedirectStandardError (Join-Path $workPath "launcher-$launchPort-error.log")
