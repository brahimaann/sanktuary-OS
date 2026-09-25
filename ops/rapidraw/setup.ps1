# Installs / updates the RapidRAW photo engine that powers "Edit photo" in Sanktuary.
# Run on the home server PC, as the user that runs Sanktuary, from the Sanktuary repo:
#     powershell -ExecutionPolicy Bypass -File ops\rapidraw\setup.ps1
# Safe to run again: it pulls the latest fork, rebuilds, and restarts the engine.
#
# What it does
#   1. Makes sure Rust (rustup) and the Visual C++ build tools are installed (asks winget if they're missing)
#   2. Clones / updates github.com/brahimaann/rapidraw-sanktuary (branch "sanktuary") into C:\homeserver\rapidraw\src
#   3. Builds the browser editor (SANKTUARY=1) into C:\homeserver\rapidraw\ui  (Sanktuary serves it at /apps/rapidraw/)
#   4. Builds the engine (cargo build --release; the first build takes a while and downloads a lot)
#   5. Creates RAPIDRAW_TOKEN in Sanktuary's .env (once) and a hidden "Sanktuary RapidRAW" task that starts at logon
#   6. Starts it, checks it answers, and restarts Sanktuary so it picks up the token
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent        # the Sanktuary repo
$home_ = 'C:\homeserver\rapidraw'
$src = Join-Path $home_ 'src'
$ui = Join-Path $home_ 'ui'
$port = 3091
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Need($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
New-Item -ItemType Directory -Force $home_ | Out-Null

Step 'Tools'
if (-not (Need rustup)) {
  Write-Host 'Installing Rust (rustup)...'
  winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVc = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasVc) {
  Write-Host 'Installing the Visual C++ build tools (needed to compile Rust on Windows; a few GB)...'
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements `
    --override '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
}
foreach ($t in 'git', 'node', 'npm', 'cargo') { if (-not (Need $t)) { throw "$t is missing. Install it, open a new PowerShell, and run this again." } }

Step 'Source (brahimaann/rapidraw-sanktuary, branch sanktuary)'
if (Test-Path (Join-Path $src '.git')) {
  git -C $src fetch --quiet origin sanktuary
  git -C $src checkout --quiet sanktuary
  git -C $src reset --quiet --hard origin/sanktuary      # this folder only ever holds the published fork
} else {
  git clone --quiet --branch sanktuary https://github.com/brahimaann/rapidraw-sanktuary.git $src
}
Write-Host "at $(git -C $src log --oneline -1)"

Step 'Browser editor (npm run build with SANKTUARY=1)'
Push-Location $src
npm ci --no-audit --no-fund
$env:SANKTUARY = '1'
npm run build
Remove-Item Env:SANKTUARY
if (Test-Path $ui) { Rename-Item $ui "$ui-old-$(Get-Date -Format yyyyMMddHHmmss)" }   # previous build kept, not deleted
Copy-Item (Join-Path $src 'dist') $ui -Recurse
Pop-Location

Step 'Engine (cargo build --release; first time is slow)'
Push-Location (Join-Path $src 'src-tauri')
# The running engine locks its .exe, but Windows lets it be renamed: move it aside so cargo can write the new one
Get-ChildItem target\release\*.exe -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item "$($_.FullName).old" -Force -ErrorAction SilentlyContinue
  Rename-Item $_.FullName "$($_.Name).old"
}
cargo build --release
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'The engine did not build. Send the errors above to Claude.' }
$exe = Get-ChildItem target\release\*.exe | Where-Object Name -notmatch 'build-script' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Pop-Location
if (-not $exe) { throw 'Built, but no .exe found in target\release' }
Write-Host "engine: $($exe.FullName)"

Step 'Token and start-up task'
$envFile = Join-Path $repo '.env'
$found = Select-String -Path $envFile -Pattern '^RAPIDRAW_TOKEN=(.+)$' -ErrorAction SilentlyContinue
$token = if ($found) { $found.Matches[0].Groups[1].Value }
$newToken = -not $token
if ($newToken) {
  $token = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')   # GUIDs come from the system's secure random source
  Add-Content $envFile "`nRAPIDRAW_TOKEN=$token"
  Write-Host 'Added RAPIDRAW_TOKEN to .env'
}
$start = Join-Path $home_ 'start.cmd'
Set-Content $start -Encoding ascii -Value @"
@echo off
rem Started by the "Sanktuary RapidRAW" task: the photo engine for Sanktuary's browser editor (window hidden).
set SANKTUARY_BRIDGE_PORT=$port
set SANKTUARY_BRIDGE_TOKEN=$token
"$($exe.FullName)" >> "$home_\engine.log" 2>&1
"@
# The task runs start.cmd, so later rebuilds (including the automatic ones from ops\deploy.ps1, which may not
# have admin rights) only rewrite start.cmd and don't need to touch the task.
if (-not (Get-ScheduledTask -TaskName 'Sanktuary RapidRAW' -ErrorAction SilentlyContinue)) {
  $a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless cmd.exe /c `"$start`""
  $t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName 'Sanktuary RapidRAW' -Action $a -Trigger $t -Settings $s | Out-Null
}

Step 'Start and check'
Stop-ScheduledTask -TaskName 'Sanktuary RapidRAW' # else the task still counts as running and Start is ignored (IgnoreNew)
Get-CimInstance Win32_Process -Filter "Name='$($exe.Name)'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'Sanktuary RapidRAW'
$ok = $false
foreach ($i in 1..30) {
  Start-Sleep 2
  try {
    Invoke-WebRequest "http://127.0.0.1:$port/invoke/get_supported_file_types" -Method Post -Body '{}' -Headers @{ 'x-bridge-token' = $token } -UseBasicParsing -TimeoutSec 3 | Out-Null
    $ok = $true; break
  } catch {}
}
if (-not $ok) { throw "The engine didn't answer on 127.0.0.1:$port. See $home_\engine.log" }
Write-Host 'The engine answers.' -ForegroundColor Green
Set-Content (Join-Path $home_ 'built.txt') (git -C $src rev-parse HEAD) # auto-deploy compares this with the fork

if ($newToken) {
  Step 'Restarting Sanktuary so it reads the new token'
  Stop-ScheduledTask -TaskName 'Sanktuary OS server'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*server\index.mjs*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-ScheduledTask -TaskName 'Sanktuary OS server'
}
Write-Host "`nDone. In Sanktuary: open a photo in a team folder > Edit photo." -ForegroundColor Green
