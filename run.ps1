<#
.SYNOPSIS
    Sets up and runs SkillSync on Windows with one command.

.DESCRIPTION
    Creates the Python virtualenv, installs the backend and frontend dependencies,
    then starts the API on :8000 and the web app on :5173.

    A Gemini key in api\.env switches the model on. Without one the app runs in
    demo mode: skills are matched from a built-in list instead of the model.

.EXAMPLE
    .\run.ps1
    .\run.ps1 -Cases
    .\run.ps1 -Tests
    .\run.ps1 -Mock
    .\run.ps1 -Gemini
#>
param(
    [switch]$Cases,
    [switch]$Tests,
    [switch]$Gemini,
    [switch]$Mock
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiDir = Join-Path $root "api"
$webDir = Join-Path $root "web"
$venvDir = Join-Path $apiDir ".venv"
$python = Join-Path $venvDir "Scripts\python.exe"

function Write-Step($message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python 3.11+ is required: https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $python)) {
    Write-Step "Creating the virtualenv in api\.venv"
    python -m venv $venvDir
}

Write-Step "Installing backend dependencies"
& $python -m pip install --quiet --disable-pip-version-check -r (Join-Path $apiDir "requirements-dev.txt")

$envFile = Join-Path $apiDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Step "Creating api\.env from .env.example (GEMINI_API_KEY stays empty)"
    Copy-Item (Join-Path $root ".env.example") $envFile
}

if ($Cases) {
    Write-Step "Running every CV case"
    & $python (Join-Path $apiDir "scripts\run_cases.py") --extractor mock
    exit $LASTEXITCODE
}

if ($Tests) {
    Write-Step "Running the backend test suite"
    Push-Location $apiDir
    & $python -m pytest -q
    $code = $LASTEXITCODE
    Pop-Location
    exit $code
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js 20+ is required: https://nodejs.org/" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $webDir "node_modules"))) {
    Write-Step "Installing frontend dependencies"
    Push-Location $webDir
    npm install
    Pop-Location
}

if ($Gemini) {
    $env:SKILLSYNC_EXTRACTOR = "gemini"
} elseif ($Mock) {
    $env:SKILLSYNC_EXTRACTOR = "mock"
} else {
    Remove-Item Env:\SKILLSYNC_EXTRACTOR -ErrorAction SilentlyContinue
}

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Port 8000 is already in use. Stop the other process and run again." -ForegroundColor Red
    exit 1
}



Write-Step "Starting the API on http://localhost:8000"
$apiProcess = Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" `
    -WorkingDirectory $apiDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "api.log") `
    -RedirectStandardError (Join-Path $logDir "api.err.log")

$ready = $false
foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 250
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", 8000)
        $ready = $true
        break
    } catch {
        if ($apiProcess.HasExited) { break }
    } finally {
        $client.Dispose()
    }
}

if ($apiProcess.HasExited) { $ready = $false }

$health = $null
if ($ready) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 10
    } catch {
        $ready = $false
    }
}

if (-not $ready) {
    Write-Host "The API did not start. Its log says:" -ForegroundColor Red
    $errLog = Join-Path $logDir "api.err.log"
    if (Test-Path $errLog) { Get-Content $errLog -Tail 10 }
    Write-Host "  cd api"
    Write-Host "  .venv\Scripts\python -m uvicorn app.main:app --port 8000"
    if (-not $apiProcess.HasExited) { taskkill /T /F /PID $apiProcess.Id | Out-Null }
    exit 1
}

Write-Step "Starting the web app on http://localhost:5173"
$webProcess = Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $webDir -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 3

Write-Host "  web  http://localhost:5173"
Write-Host "  api  http://127.0.0.1:8000/docs"
Write-Host "  mode $($health.extractor)"
Write-Host ""
Write-Host "Press Enter to stop both servers."
[void](Read-Host)

foreach ($port in 8000, 5173) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { taskkill /T /F /PID $_.OwningProcess 2>$null | Out-Null }
}
