# sanktuary-OS

A Windows 98-style team workspace at **https://sanktuary.studio**, based on WindowsHQ, hosted on a home PC.

## Apps

| Desktop icon | What it is |
|---|---|
| Sanktuary Network | Team spaces (folders on external drives) with previews, audio waveforms, timestamped comments, versions, drag & drop uploads |
| Moodboards | Infinite canvas boards, edited live with named cursors |
| Planner | Kanban boards (to do / doing / done), live |
| Sanktuary Teams | AIM-style buddy list, channels, DMs, file/folder/board links, activity feed |
| Admin Panel (admins only) | Server health, drives, spaces + per-member rights, members, backups |

Team members log in with a nickname + access code (Clerk) in the boot terminal or any team window.

## How it runs

- **Site + API**: `server/index.mjs` runs directly on Windows (not Docker) so USB drives can be plugged in and out.
  Scheduled task **"Sanktuary OS server"** starts it at login (`server/start.cmd`), restarts it on crash. Logs: `data/server.log`.
- **Public access**: Cloudflare Tunnel container (`docker-compose.yml`) publishes `web:3080` → sanktuary.studio.
- **Drive watcher**: `C:\homeserver\nextcloud\drive-watch.ps1`, scheduled task **"Nextcloud drive watch"**, every minute:
  reports drives + PC/Docker/Tailscale health to `data/status.json`, keeps Nextcloud on the Seagate, restarts the server
  if it stops answering, runs backups (`sanktuary-backup.ps1`).
- **Data** (`data/`, not in git): `config.json` (admin panel settings), `boards/`, `chat/`, `profiles/`, `comments/`,
  `activity.jsonl`, `status.json`, `backup.json`. Deleted boards go to `data/boards-trash/`.
- **Files on drives**: deleted files go to `<space>/.sk-trash/`, replaced files to `<space>/.sk-versions/`.
- **Secrets**: `.env` (see `.env.example`), not in git.

## Updating

```
npm install
npm run build
```
then restart the server: Task Scheduler → "Sanktuary OS server" → End, then Run
(or it restarts within a minute if the process is killed).

Tunnel: `docker compose up -d` in this folder.

Don't move this folder without updating the two scheduled tasks and the paths in `drive-watch.ps1` / `sanktuary-backup.ps1`.
