# Copies every Sanktuary space (and member spaces) to "<backup drive>\Sanktuary Backup".
# Started by drive-watch.ps1. robocopy /E /XO only adds and updates: nothing is ever deleted from the backup.
$data = 'C:\Users\brahi\Desktop\sanktuary-OS\data'
$cfg = Get-Content "$data\config.json" -Raw | ConvertFrom-Json
$drives = @((Get-Content "$data\status.json" -Raw | ConvertFrom-Json).drives)
function Letter($id) { ($drives | Where-Object id -eq $id).letter }
function Save($state) { [IO.File]::WriteAllText("$data\backup.json", ($state | ConvertTo-Json -Depth 4)) }

$state = [ordered]@{ state = 'running'; pid = $PID; date = (Get-Date -Format 'yyyy-MM-dd'); started = (Get-Date).ToUniversalTime().ToString('o'); finished = $null; results = @() }
Save $state

$target = Letter $cfg.backup.drive
$jobs = @()
foreach ($s in $cfg.spaces) {
  if ($s.drive -ne $cfg.backup.drive) { $jobs += , @($s.name, $s.drive, $s.path) }
}
foreach ($d in @($cfg.members.PSObject.Properties.Value | ForEach-Object { $_.drive } | Sort-Object -Unique)) {
  if ($d -and $d -ne $cfg.backup.drive) { $jobs += , @('Members', $d, 'Sanktuary Members') }
}

foreach ($j in $jobs) {
  $name, $drive, $path = $j
  $src = Letter $drive
  if (-not $target) { $state.results += [ordered]@{ name = $name; ok = $false; note = 'backup drive not connected' }; continue }
  if (-not $src) { $state.results += [ordered]@{ name = $name; ok = $false; note = 'drive not connected' }; continue }
  $from = Join-Path "$src\" $path
  $to = Join-Path "$target\Sanktuary Backup" $name
  robocopy $from $to /E /XO /XD .sk-trash /R:1 /W:1 /NP /NFL /NDL /LOG+:"$data\backup.log" | Out-Null
  $code = $LASTEXITCODE
  $state.results += [ordered]@{ name = $name; ok = $code -lt 8; note = if ($code -lt 8) { 'ok' } else { "robocopy error $code (see data/backup.log)" } }
  Save $state
}

# Sanktuary's own data (settings, check-outs, share links, tracks, timeline, business portal, chat) lives on the
# PC, not on a space: copy it too. Tip: turn on BitLocker To Go for the backup drive, since business records go there.
if ($target) {
  robocopy $data "$target\Sanktuary Backup\_Sanktuary data" /E /XO /XF *.tmp *.log /R:1 /W:1 /NP /NFL /NDL /LOG+:"$data\backup.log" | Out-Null
  $code = $LASTEXITCODE
  $state.results += [ordered]@{ name = 'Sanktuary data'; ok = $code -lt 8; note = if ($code -lt 8) { 'ok' } else { "robocopy error $code (see data/backup.log)" } }
  Save $state
}

$state.state = 'done'
$state.finished = (Get-Date).ToUniversalTime().ToString('o')
Save $state
