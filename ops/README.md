# ops: scripts that run on the home server PC

These run from `C:\homeserver\nextcloud\` on the server. The copies here are the backup / source of truth:
after editing one here, copy it back to `C:\homeserver\nextcloud\` (or the other way round).

| File | What it does |
|---|---|
| `nextcloud/drive-watch.ps1` | Every minute: reports drives + PC/Docker/Tailscale health to `data/status.json`, keeps Nextcloud on the Seagate (restarts Docker Desktop if it can't see it), restarts the Sanktuary server if it stops answering, starts backups. |
| `nextcloud/sanktuary-backup.ps1` | Copies every space to `<backup drive>\Sanktuary Backup` with `robocopy /E /XO` (never deletes from the backup). |
| `nextcloud/docker-compose.yml` | Nextcloud + Postgres, reachable only on the Tailscale IP. |
| `nextcloud/.env.example` | Copy to `.env` and set a database password. |

Paths are hard-coded for this PC: `C:\homeserver\nextcloud`, `C:\Users\brahi\Desktop\sanktuary-OS`, and the
Seagate's volume ID in `drive-watch.ps1`. Update them if anything moves.

## Setting up a fresh PC

1. Install Node.js, Docker Desktop (WSL2), Tailscale, Git.
2. Clone this repo to `C:\Users\brahi\Desktop\sanktuary-OS`, create `.env` from `.env.example`, then
   `npm install`, `cd server && npm install`, `cd .. && npm run build`, and `docker compose up -d` (tunnel).
3. Copy `ops/nextcloud/*` to `C:\homeserver\nextcloud\`, create its `.env`, run `docker compose up -d` there.
4. Register the two scheduled tasks (PowerShell, as your user):

```powershell
# Sanktuary OS server: starts at login, restarts itself if it crashes
$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '--headless cmd.exe /c "C:\Users\brahi\Desktop\sanktuary-OS\server\start.cmd"' -WorkingDirectory 'C:\Users\brahi\Desktop\sanktuary-OS'
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Sanktuary OS server' -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings $s

# Drive watcher: every minute, starting at login
$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\homeserver\nextcloud\drive-watch.ps1"'
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$t1.Repetition = $t2.Repetition
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'Nextcloud drive watch' -Action $a -Trigger @($t1, $t2) -Settings $s
```

5. Power plan: High performance, never sleep, never turn off hard disks; Docker Desktop "start when you sign in".
