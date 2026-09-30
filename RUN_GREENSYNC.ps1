$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host ''
Write-Host '==========================================' -ForegroundColor Green
Write-Host '        GreenSync Live - One Step         ' -ForegroundColor Green
Write-Host '==========================================' -ForegroundColor Green
Write-Host ''

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$iot = Join-Path $root 'iot'

if (-not (Test-Path $backend)) { throw "Backend folder not found: $backend" }
if (-not (Test-Path $frontend)) { throw "Frontend folder not found: $frontend" }

# Allow scripts only for this PowerShell process.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# -----------------------------
# 1) Python check
# -----------------------------
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $pythonCmd) {
    Write-Host 'Python was not found. Install Python 3.11+ and run this script again.' -ForegroundColor Red
    exit 1
}

$pythonExe = $pythonCmd.Source
Write-Host "Python found: $pythonExe" -ForegroundColor Cyan

# -----------------------------
# 2) Node/npm check and install
# -----------------------------
function Refresh-NodePath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($machinePath -or $userPath) {
        $env:Path = "$machinePath;$userPath"
    }
    $nodeDir = Join-Path ${env:ProgramFiles} 'nodejs'
    if (Test-Path $nodeDir) {
        if (-not (($env:Path -split ';') -contains $nodeDir)) {
            $env:Path = "$nodeDir;$env:Path"
        }
    }
}

Refresh-NodePath
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $nodeCmd -or -not $npmCmd) {
    Write-Host 'Node.js/npm not found. Attempting automatic LTS installation with winget...' -ForegroundColor Yellow
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Host ''
        Write-Host 'winget is not available on this PC, so Node.js cannot be installed automatically.' -ForegroundColor Red
        Write-Host 'Install Node.js LTS from https://nodejs.org/ and run this script again.' -ForegroundColor Yellow
        exit 1
    }

    & $winget.Source install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed to install Node.js. Exit code: $LASTEXITCODE"
    }

    Refresh-NodePath
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
}

if (-not $nodeCmd -or -not $npmCmd) {
    Write-Host 'Node.js was installed, but this PowerShell session still cannot find node/npm.' -ForegroundColor Red
    Write-Host 'Close this window, open a NEW PowerShell window, and run this same script again.' -ForegroundColor Yellow
    exit 1
}

Write-Host "Node: $(& $nodeCmd.Source -v)" -ForegroundColor Cyan
Write-Host "npm : $(& $npmCmd.Source -v)" -ForegroundColor Cyan

# -----------------------------
# 3) Backend virtual environment + deps
# -----------------------------
$venv = Join-Path $backend 'venv'
$backendPython = Join-Path $venv 'Scripts\python.exe'
$depsMarker = Join-Path $venv '.greensync_dependencies_installed'

if (-not (Test-Path $venv)) {
    Write-Host 'Creating Python virtual environment...' -ForegroundColor Yellow
    & $pythonExe -m venv $venv
}

if (-not (Test-Path $backendPython)) {
    throw "Could not create/find backend Python: $backendPython"
}

if (-not (Test-Path $depsMarker)) {
    Write-Host 'Installing backend dependencies. This can take a few minutes...' -ForegroundColor Yellow
    & $backendPython -m pip install --upgrade pip
    & $backendPython -m pip install -r (Join-Path $backend 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    New-Item -ItemType File -Path $depsMarker -Force | Out-Null
} else {
    Write-Host 'Backend dependencies already installed.' -ForegroundColor Cyan
}

# -----------------------------
# 4) Frontend npm dependencies
# -----------------------------
$nodeModules = Join-Path $frontend 'node_modules'
if (-not (Test-Path $nodeModules)) {
    Write-Host 'Installing frontend packages. This can take a few minutes...' -ForegroundColor Yellow
    Push-Location $frontend
    try {
        & $npmCmd.Source install
        if ($LASTEXITCODE -ne 0) { throw 'Frontend npm install failed.' }
    } finally {
        Pop-Location
    }
} else {
    Write-Host 'Frontend packages already installed.' -ForegroundColor Cyan
}

# -----------------------------
# 5) Optional YOLO model
# -----------------------------
if ($args -contains '-DownloadYOLO') {
    Write-Host 'Downloading yolov8n.pt...' -ForegroundColor Yellow
    Push-Location $backend
    try {
        & $backendPython download_yolo_model.py
        if ($LASTEXITCODE -ne 0) { Write-Host 'YOLO download failed; OpenCV fallback will still work.' -ForegroundColor Yellow }
    } finally {
        Pop-Location
    }
}

# -----------------------------
# 6) Start backend and frontend in separate windows
# -----------------------------
$backendCommand = "Set-Location -LiteralPath '$backend'; & '$backendPython' -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
$frontendCommand = "Set-Location -LiteralPath '$frontend'; & '$($npmCmd.Source)' run dev"

Write-Host 'Starting FastAPI backend in a new PowerShell window...' -ForegroundColor Green
Start-Process powershell.exe -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',$backendCommand | Out-Null

Start-Sleep -Seconds 4

Write-Host 'Starting React frontend in a new PowerShell window...' -ForegroundColor Green
Start-Process powershell.exe -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-Command',$frontendCommand | Out-Null

Write-Host ''
Write-Host '==========================================' -ForegroundColor Green
Write-Host 'GreenSync is starting.' -ForegroundColor Green
Write-Host 'Backend:  http://localhost:8000' -ForegroundColor Cyan
Write-Host 'API Docs: http://localhost:8000/docs' -ForegroundColor Cyan
Write-Host 'Frontend: http://localhost:5173' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Keep both new PowerShell windows open.' -ForegroundColor Yellow
Write-Host 'Open http://localhost:5173 in Chrome.' -ForegroundColor Yellow
Write-Host '==========================================' -ForegroundColor Green
Write-Host ''
