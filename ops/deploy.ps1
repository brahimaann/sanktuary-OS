# Auto-deploy for the live site. Runs every 2 minutes from the "Sanktuary OS auto-deploy" scheduled task.
# When GitHub main has a commit that isn't live yet: pull (fast-forward only), install, test, build into a
# separate folder, then swap it in and restart the server. Any failure leaves the current site running.
# Log: data\deploy.log   Last result (shown in Admin Panel > Health): data\deploy.json
$ErrorActionPreference = 'Continue' # native tools write progress to stderr; failures are detected by exit code
$proj = Split-Path $PSScriptRoot -Parent
Set-Location $proj
$data = Join-Path $proj 'data'
$stateFile = Join-Path $data 'deploy.json'
function Log($msg) { Add-Content (Join-Path $data 'deploy.log') "$(Get-Date -Format s)  $msg" }
function Save($ok, $commit, $msg) {
  $state = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); ok = $ok; commit = $commit; message = $msg }
  [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json))
}
function Run($what, [scriptblock]$cmd) {
  $out = & $cmd 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "$what failed:`n$($out.Trim() -split "`n" | Select-Object -Last 15 | Out-String)" }
}

git fetch --quiet origin main 2>$null
if ($LASTEXITCODE -ne 0) { exit } # offline; try again next time
$remote = (git rev-parse origin/main).Trim()
$last = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw | ConvertFrom-Json) } else { $null }
if ($last -and $last.commit -eq $remote) { exit } # already live (or already failed on this commit)

$short = $remote.Substring(0, 7)
try {
  Log "deploying $short"
  Run 'git pull' { git pull --ff-only --quiet origin main }
  Run 'npm install' { npm install --no-audit --no-fund }
  Run 'npm install (server)' { npm install --prefix server --no-audit --no-fund }
  Run 'tests' { npm test }
  if (Test-Path dist-next) { Remove-Item dist-next -Recurse -Force }
  Run 'build' { npm run build -- --outDir dist-next --emptyOutDir }

  # Swap the new build in while the server is stopped (Windows won't rename folders with open files)
  Stop-ScheduledTask -TaskName 'Sanktuary OS server'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*server\index.mjs*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep 1
  if (Test-Path dist-old) { Remove-Item dist-old -Recurse -Force }
  if (Test-Path dist) { Rename-Item dist dist-old }
  Rename-Item dist-next dist
  Start-ScheduledTask -TaskName 'Sanktuary OS server'

  Save $true $remote "Deployed $short"
  Log "deployed $short"
} catch {
  Save $false $remote "Deploy of $short failed; the previous version is still live. $_"
  Log "FAILED $short -- $_"
  # If the server was stopped mid-swap, bring it back
  if (-not (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*server\index.mjs*')) {
    if (-not (Test-Path dist) -and (Test-Path dist-old)) { Rename-Item dist-old dist }
    Start-ScheduledTask -TaskName 'Sanktuary OS server'
  }
}
