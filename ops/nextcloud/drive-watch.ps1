# Runs every minute from the "Nextcloud drive watch" scheduled task. It:
#  1. Keeps Nextcloud pointed at the Seagate (by volume ID), or at an empty ./offline folder while it is unplugged.
#  2. Reports external drives (with their current letters) + PC/Docker/Tailscale health to Sanktuary OS
#     (data/status.json). The Sanktuary OS server reads drives straight from those letters.
#  3. Restarts the Sanktuary OS server if it stopped answering.
#  4. Starts sanktuary-backup.ps1 at the scheduled hour, or when the admin panel asks (data/backup-now).
param([string]$SeagateId = '\\?\Volume{f04f6122-a539-4877-8b36-164bc5d21647}\')

$proj = 'C:\Users\brahi\Desktop\sanktuary-OS'
$data = Join-Path $proj 'data'
$log = Join-Path $PSScriptRoot 'drive-watch.log'
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$ErrorActionPreference = 'Continue'
function Log($msg) { Add-Content $log "$(Get-Date -Format s)  $msg" }
New-Item -ItemType Directory -Force $data | Out-Null

& $docker info *> $null
$dockerOk = $LASTEXITCODE -eq 0
function Running($name) { (& $docker inspect -f '{{.State.Running}}' $name 2>$null) -eq 'true' }

# ── External drives: removable volumes, or anything on a USB disk (the Seagate reports as a fixed disk) ──
$usbVols = @(Get-Disk | Where-Object BusType -eq 'USB' | Get-Partition | ForEach-Object { $_.AccessPaths } | Where-Object { $_ -like '\\?\Volume*' })
$drives = @(Get-CimInstance Win32_Volume | Where-Object { $_.DriveLetter -and ($_.DriveType -eq 2 -or $usbVols -contains $_.DeviceID) } | ForEach-Object {
  [ordered]@{
    id = $_.DeviceID -replace '^\\\\\?\\Volume\{|\}\\$', ''
    letter = $_.DriveLetter; label = $_.Label; fs = $_.FileSystem
    sizeBytes = [int64]$_.Capacity; freeBytes = [int64]$_.FreeSpace
  }
})
$cfg = if (Test-Path "$data\config.json") { Get-Content "$data\config.json" -Raw | ConvertFrom-Json }

if ($dockerOk) {
  # ── 1. Nextcloud keeps the Seagate ──
  $nc = 'C:\homeserver\nextcloud'
  $vol = Get-CimInstance Win32_Volume | Where-Object DeviceID -eq $SeagateId
  if ($vol -and $vol.DriveLetter) { $src = "$($vol.DriveLetter)/"; $dst = '/mnt/h' } else { $src = './offline'; $dst = '/mnt/offline' }
  $lines = @(Get-Content "$nc\.env")
  $current = ($lines | Where-Object { $_ -like 'DATA_SRC=*' }) -replace '^DATA_SRC=', ''
  # Docker Desktop only sees drives that were plugged in when it started. If the Seagate came back under a
  # letter Docker hasn't mounted, restart Docker Desktop (at most every 30 min so a stuck drive can't loop it).
  if ($dst -eq '/mnt/h' -and $current -ne $src) {
    $l = $vol.DriveLetter.Substring(0, 1).ToLower()
    $mounted = & $docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -- sh -c "grep -c ' /run/desktop/mnt/host/$l ' /proc/mounts" 2>$null
    $last = "$data\docker-restart.txt"
    $recent = (Test-Path $last) -and ((Get-Date) - (Get-Item $last).LastWriteTime).TotalMinutes -lt 30
    if ([int]$mounted -eq 0 -and -not $recent) {
      Set-Content $last (Get-Date -Format s)
      Log "nextcloud: seagate at $src is not visible to Docker -> restarting Docker Desktop"
      Log ((& $docker desktop restart 2>&1) -join ' | ')
      exit
    }
  }
  if ($current -ne $src -or -not (Running 'nextcloud-app-1')) {
    $lines = @($lines | Where-Object { $_ -notlike 'DATA_SRC=*' -and $_ -notlike 'DATA_DST=*' })
    Set-Content "$nc\.env" -Encoding ascii -Value ($lines + @("DATA_SRC=$src", "DATA_DST=$dst"))
    Log "nextcloud: seagate $(if ($dst -eq '/mnt/h') { "at $src" } else { 'not found' }) -> recreating"
    Log ((& $docker compose --project-directory $nc up -d --no-deps app 2>&1) -join ' | ')
  }

}

# ── 3. Sanktuary OS server (runs on Windows, not Docker) ──
try { Invoke-WebRequest 'http://127.0.0.1:3080/manifest.webmanifest' -UseBasicParsing -TimeoutSec 10 | Out-Null }
catch {
  Log "server not answering ($($_.Exception.Message)) -> starting 'Sanktuary OS server' task"
  Start-ScheduledTask -TaskName 'Sanktuary OS server'
}

# ── 4. Backups ──
$b = $cfg.backup
if ($b -and $b.drive) {
  $state = if (Test-Path "$data\backup.json") { Get-Content "$data\backup.json" -Raw | ConvertFrom-Json }
  $busy = $state -and $state.state -eq 'running' -and (Get-Process -Id $state.pid -EA SilentlyContinue)
  $due = (Test-Path "$data\backup-now") -or ((Get-Date).Hour -eq [int]$b.hour -and (-not $state -or $state.date -ne (Get-Date -Format 'yyyy-MM-dd')))
  if ($due -and -not $busy) {
    Remove-Item "$data\backup-now" -EA SilentlyContinue
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSScriptRoot\sanktuary-backup.ps1`"" | Out-Null
    Log 'backup started'
  }
}

# ── 2. Health report for the admin panel ──
$os = Get-CimInstance Win32_OperatingSystem
$c = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$containers = if ($dockerOk) { @(& $docker ps -a --format '{{json .}}' | ForEach-Object { $j = $_ | ConvertFrom-Json; [ordered]@{ name = $j.Names; state = $j.State; status = $j.Status } }) } else { @() }
$ts = try { tailscale status --json | ConvertFrom-Json } catch { $null }
$status = [ordered]@{
  updated = (Get-Date).ToUniversalTime().ToString('o')
  dockerOk = $dockerOk
  containers = $containers
  drives = $drives
  pc = [ordered]@{
    cpuPct = [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
    memUsedPct = [int](100 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize * 100)
    uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    cFreeGB = [math]::Round($c.FreeSpace / 1GB, 1)
  }
  tailscale = [ordered]@{ state = $ts.BackendState; online = [bool]$ts.Self.Online }
}
$tmp = "$data\status.json.tmp"
[IO.File]::WriteAllText($tmp, ($status | ConvertTo-Json -Depth 5))
Move-Item -Force $tmp "$data\status.json"
