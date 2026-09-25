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

# The watcher and backup scripts run from C:\homeserver\nextcloud; keep those copies in step with the repo
foreach ($f in 'drive-watch.ps1', 'sanktuary-backup.ps1') {
  $src = Join-Path $proj "ops\nextcloud\$f"; $dst = "C:\homeserver\nextcloud\$f"
  if ((Test-Path $src) -and (Test-Path (Split-Path $dst)) -and (-not (Test-Path $dst) -or (Get-FileHash $src).Hash -ne (Get-FileHash $dst).Hash)) {
    if (Test-Path $dst) { Copy-Item $dst "$dst.bak" -Force } # keep the previous copy, in case it had local edits
    Copy-Item $src $dst -Force
    Log "updated $dst"
  }
}

# RapidRAW (Edit photo): once ops\rapidraw\setup.ps1 has installed it, rebuild it in the background whenever the
# fork's "sanktuary" branch has a new commit. One attempt per commit (a failed build isn't retried every 2 minutes);
# progress in C:\homeserver\rapidraw\update.log, status in Admin Panel > Health.
$rr = 'C:\homeserver\rapidraw'
if (Test-Path "$rr\src\.git") {
  $want = ((git ls-remote https://github.com/brahimaann/rapidraw-sanktuary.git refs/heads/sanktuary 2>$null) -split '\s')[0]
  $built = if (Test-Path "$rr\built.txt") { (Get-Content "$rr\built.txt" -Raw).Trim() } else { '' }
  $tried = if (Test-Path "$rr\update-tried.txt") { (Get-Content "$rr\update-tried.txt" -Raw).Trim() } else { '' }
  $busy = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object CommandLine -like '*rapidraw\setup.ps1*'
  if ($want -and $want -ne $built -and $want -ne $tried -and -not $busy) {
    Set-Content "$rr\update-tried.txt" $want
    Log "RapidRAW: rebuilding at $($want.Substring(0, 7)) in the background"
    # cmd does the redirect: redirected inside PowerShell, the first stderr line from npm/vite/cargo kills setup.ps1
    Start-Process cmd -WindowStyle Hidden -ArgumentList '/c', "powershell -NoProfile -ExecutionPolicy Bypass -File `"$proj\ops\rapidraw\setup.ps1`" > `"$rr\update.log`" 2>&1"
  }
}

git fetch --quiet origin main 2>$null
if ($LASTEXITCODE -ne 0) { exit } # offline; try again next time
$remote = (git rev-parse origin/main).Trim()
$last = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw | ConvertFrom-Json) } else { $null }
if ($last -and $last.commit -eq $remote) { exit } # already live (or already failed on this commit)

$short = $remote.Substring(0, 7)
$prev = (git rev-parse HEAD).Trim() # what's live now: put back if the new version doesn't come up
$port = ((Get-Content (Join-Path $proj '.env') -ErrorAction SilentlyContinue) -match '^PORT=' -replace '^PORT=', '' | Select-Object -First 1)
if (-not $port) { $port = 3080 }
function Up {
  # The new server answers /healthz within a minute, or it's a bad deploy
  foreach ($i in 1..30) {
    Start-Sleep 2
    # /healthz is the server; / is the site itself (a missing build folder still passes /healthz)
    try {
      if ((Invoke-WebRequest "http://127.0.0.1:$port/healthz" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 -and
        (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return $true }
    } catch {}
  }
  return $false
}
# Fresh build files can be locked for a moment (antivirus scanning them): retry, and fail loudly rather than
# carry on with no site folder (ErrorActionPreference is Continue, so a failed Rename-Item wouldn't stop us)
function Move-Folder($from, $to) {
  foreach ($i in 1..10) {
    try { Rename-Item $from $to -ErrorAction Stop; return } catch { Start-Sleep 2 }
  }
  throw "Couldn't rename $from to $to (files in use?)"
}
function StopServer {
  Stop-ScheduledTask -TaskName 'Sanktuary OS server'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*server\index.mjs*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep 1
}
try {
  Log "deploying $short"
  Run 'git pull' { git pull --ff-only --quiet origin main }
  Run 'npm install' { npm install --no-audit --no-fund }
  Run 'npm install (server)' { npm install --prefix server --no-audit --no-fund }
  Run 'tests' { npm test }
  if (Test-Path dist-next) { Remove-Item dist-next -Recurse -Force }
  Run 'build' { npm run build -- --outDir dist-next --emptyOutDir }

  # Swap the new build in while the server is stopped (Windows won't rename folders with open files)
  StopServer
  if (Test-Path dist-old) { Remove-Item dist-old -Recurse -Force }
  if (Test-Path dist) { Move-Folder dist dist-old }
  Move-Folder dist-next dist
  Start-ScheduledTask -TaskName 'Sanktuary OS server'

  if (-not (Up)) {
    # Tests passed but the live server won't start: go back to the version that was running
    Log "ROLLBACK $short -- no answer on /healthz, restoring $($prev.Substring(0, 7))"
    StopServer
    if (Test-Path dist-bad) { Remove-Item dist-bad -Recurse -Force }
    Rename-Item dist dist-bad
    Rename-Item dist-old dist
    git reset --hard --quiet $prev
    npm install --prefix server --no-audit --no-fund 2>&1 | Out-Null
    Start-ScheduledTask -TaskName 'Sanktuary OS server'
    $back = if (Up) { 'the previous version is live again' } else { 'the previous version did not come back either: check the server PC' }
    Save $false $remote "Deploy of $short didn't start (no answer on /healthz); rolled back, $back."
    Log "rolled back: $back"
    exit
  }

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
