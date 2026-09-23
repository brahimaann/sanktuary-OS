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

## Security

- Every API call needs a Clerk sign-in (or the signed `sk_session` cookie it issues); rights are checked per space,
  board and channel on the server. Private boards/channels are enforced on lists, live feeds and the activity feed.
- User files are served inline only for safe types (images, audio, video, PDF, plain text); anything else
  (HTML, SVG, scripts, unknown) downloads inside a CSP sandbox. Board links must be http(s).
- Paths can't leave a space (`..`, absolute paths and NTFS `name:stream` are rejected). Nothing is deleted:
  files go to `.sk-trash`, replaced files to `.sk-versions`, boards to `data/boards-trash`.
- The server listens on 127.0.0.1 only; the internet reaches it through the Cloudflare tunnel. Secrets live in `.env`.
- Clerk (production): sign-up is **Restricted**, new devices are confirmed by an emailed code.

## Development

```
npm test              # server tests on temp data with a fake Clerk (see tests/README.md)
npm run format        # Prettier
npm run format:check
npx tsc --noEmit      # type check
```

## Updating (auto-deploy)

Push to `main` on GitHub. Within ~2 minutes the server PC runs `ops/deploy.ps1` (scheduled task
**"Sanktuary OS auto-deploy"**): `git pull --ff-only`, `npm install` (site + server), `npm test`, build into
`dist-next/`, swap it in, restart the server. If any step fails, the current site stays live.
See `data/deploy.log`, or **Admin Panel → Health → Auto-deploy**.

Tunnel: `docker compose up -d` in this folder.

Don't move this folder without updating the three scheduled tasks and the paths in `ops/` (see `ops/README.md`).

## Credits

- Action icons (arrows, upload/download, share, lock, bell...): [Retro.Icons](https://retro-svg.vercel.app) by vetrisuriya.in, MIT licence. See `src/components/RetroIcon.tsx`.
