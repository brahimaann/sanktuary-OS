# Development

## Apps on the desktop

| Desktop icon | What it is |
|---|---|
| Sanktuary Network | Team spaces (folders on external drives) with previews, audio waveforms, timestamped comments, versions, drag & drop uploads |
| Moodboards | Infinite canvas boards, edited live with named cursors |
| Planner | Kanban boards (to do / doing / done), live |
| Sanktuary Teams | AIM-style buddy list, channels, DMs, file/folder/board links, activity feed |
| Admin Panel (admins only) | Server health, drives, spaces + per-member rights, members, backups |

Members sign in with a nickname + access code (Clerk) from Log On in the taskbar or any team window; a signed-in
device stays signed in.

## Running it

```
npm install && (cd server && npm install)
cp .env.example .env  # fill in your own keys; never commit .env
npm run dev           # front end (Vite)
npm test              # server tests on temp data with a fake Clerk (see tests/README.md)
npm run format        # Prettier
npm run format:check
npm run build         # type check + build
```

Every push and pull request runs the same gate on GitHub (`.github/workflows/ci.yml`): format, type check, build,
tests. On Linux the tests need `bsdtar` for folder zips (`apt install libarchive-tools`).

**AI coding agents:** `AGENTS.md` sets the house rules (Ponytail). Claude Code also loads
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) from `.claude/settings.json` (trust the folder when asked);
other agents can add it with `npx skills add addyosmani/agent-skills`. When the two disagree, `AGENTS.md` wins.

`docs/notes/` holds older design and research notes; `docs/brand/` holds full-quality originals (the site serves the
compressed copies).

## How it's hosted

- `server/index.mjs` serves the site and API, listening on 127.0.0.1 only. A Cloudflare Tunnel
  (`docker-compose.yml`) publishes it to the internet.
- Data lives in `data/` (not in git); team files live on the server's drives.
- Pushing to `main` deploys automatically (`ops/deploy.ps1`): pull, install, test, build, swap in, restart. If any
  step fails, the current site stays live.
- Server-side scripts and setup for a fresh machine: `ops/README.md`.

## Security

- Every API call needs a Clerk sign-in (or the signed session cookie it issues); rights are checked per space,
  board and channel on the server. Private boards and channels are enforced on lists, live feeds and the activity feed.
- User files are served inline only for safe types (images, audio, video, PDF, plain text); anything else downloads
  inside a CSP sandbox. Board links must be http(s).
- Paths can't leave a space (`..`, absolute paths and NTFS `name:stream` are rejected). Nothing is deleted outright:
  files go to `.sk-trash`, replaced files to `.sk-versions`, boards to `data/boards-trash`.
- Sign-up is restricted, and new devices are confirmed by an emailed code.

Found a security issue? Please contact us privately rather than opening a public issue.
