// Serves the built site, the team file API and the admin API. Runs directly on Windows (not in Docker)
// so drives can be plugged in and out at any time; the Cloudflare tunnel container reaches it as web:3080.
// Everything is configured from the admin panel and stored in data/config.json:
//   drives  - which external drives are connected (by volume id; the current letter comes from status.json)
//   spaces  - shared folders on those drives, with per-member rights: none < view < upload < edit
//   members - each member's personal space (drive + size limit)
//   admins  - usernames that can open the admin panel (always "edit" everywhere)
// drive-watch.ps1 writes data/status.json (drives + letters, PC, Docker, Tailscale) every minute.
import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { verifyToken } from '@clerk/backend';
import sharp from 'sharp';
import webpush from 'web-push';
import { initializeCanvas, readPsd } from 'ag-psd';
import ffmpegPath from 'ffmpeg-static';

// ag-psd needs a pixel-buffer factory on the server (there's no canvas); we only read raw composite pixels.
initializeCanvas(
  () => {
    throw new Error('no canvas on the server');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

const PORT = Number(process.env.PORT || 3080);
const DIST = resolve(new URL('../dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_DIR || resolve(DIST, '../data');
const LOCAL_CACHE = process.env.THUMB_CACHE || resolve(DIST, '../cache/thumbs'); // on the SSD; used when the cache drive is unplugged
const TUNNEL_READY = process.env.TUNNEL_READY || 'http://127.0.0.1:2000/ready';
const SITE_ORIGINS = (process.env.SITE_ORIGINS || '').split(',').filter(Boolean);
const CLERK = process.env.CLERK_API_URL || 'https://api.clerk.com/v1'; // overridable so tests can use a fake Clerk
const RANK = { none: 0, view: 1, upload: 2, edit: 3 };
const FAT32_MAX = 4 * 1024 ** 3 - 1;
const started = Date.now();

const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4', // QuickTime is MP4's parent format; Firefox refuses to play video/quicktime
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.webmanifest': 'application/manifest+json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/pdf',
  '.logicx': 'application/x-apple-logicx',
};
// Camera RAW files: previewed from the JPEG inside them (rawPreview)
const RAW_PHOTO = new Set('.cr2 .cr3 .nef .nrw .arw .srf .sr2 .dng .raf .orf .rw2 .pef .srw .3fr .erf .kdc .iiq'.split(' '));
const RAW_MAX = 300 * 1024 ** 2;
const THUMBABLE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.psd', '.ai', ...RAW_PHOTO]);
const PSD_MAX = 400 * 1024 ** 2; // flattening reads the whole file into memory
// User files that are safe to show in the browser. Anything else (HTML, SVG, scripts, unknown) is served as a
// sandboxed download, so an uploaded page can never run as the viewer on sanktuary.studio.
const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|avif|tiff|x-icon)|audio\/|video\/|application\/pdf|text\/plain)/;
const HIDDEN = /^(\.|desktop\.ini$|thumbs\.db$|\$recycle\.bin$|system volume information$|found\.\d+$)/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
/** db[id] for an id from a request, only if db really holds it: "__proto__" or "constructor" must never reach the prototype. */
const own = (db, id) => (db && typeof id === 'string' && Object.hasOwn(db, id) ? db[id] : undefined);

// ── Config & status files ──────────────────────────────────────────────
// Only a missing file means "start empty": any other read error (a lock from antivirus or OneDrive) must not
// load an empty store that the next save would write over the real data
const readJson = async (file, fallback) =>
  JSON.parse(
    (await readFile(join(DATA, file), 'utf8').catch((e) => (e.code === 'ENOENT' ? 'null' : Promise.reject(e)))).replace(/^﻿/, ''), // PowerShell may write a BOM
  ) ?? fallback;
const loadConfig = () => readJson('config.json', { admins: [], drives: {}, spaces: [], members: {}, backup: { drive: null, hour: 3 } });
async function saveJson(file, value) {
  await writeFile(join(DATA, file + '.tmp'), JSON.stringify(value, null, 2));
  await rename(join(DATA, file + '.tmp'), join(DATA, file));
}

// ── Auth ───────────────────────────────────────────────────────────────
const clerk = (path, init = {}) =>
  fetch(CLERK + path, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json', ...init.headers },
  });

const usernames = new Map(); // clerk user id -> { username, at }
async function usernameOf(userId) {
  const hit = usernames.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.username;
  const res = await clerk(`/users/${userId}`);
  if (res.status === 404) fail(401, 'Account no longer exists');
  const username = res.ok ? (await res.json()).username || userId : userId;
  usernames.set(userId, { username, at: Date.now() });
  return username;
}

// Candidates in order: Authorization header, ?t= (short-lived, for links), then Clerk's __session cookie,
// which Clerk keeps fresh on our domain so long <audio>/<video> streams keep working after ?t= expires.
function sessionTokens(req, url) {
  const cookies = (req.headers.cookie || '').split(/;\s*/).filter((c) => /^__session(_\w+)?=/.test(c));
  return [
    req.headers.authorization?.replace(/^Bearer /, ''),
    url.searchParams.get('t'),
    ...cookies.map((c) => c.slice(c.indexOf('=') + 1)),
  ].filter(Boolean);
}

// CLERK_JWT_KEY (Clerk dashboard > API keys > JWT public key) lets tokens be checked without a call to Clerk;
// without it, Clerk's published keys are fetched as before.
const clerkVerifyOptions = () => ({
  secretKey: process.env.CLERK_SECRET_KEY,
  jwtKey: process.env.CLERK_JWT_KEY || undefined,
  authorizedParties: SITE_ORIGINS.length ? SITE_ORIGINS : undefined,
});

async function currentUser(req, url, cfg) {
  const asUser = async (sub) => {
    const username = await usernameOf(sub);
    count('member', username);
    return { id: sub, username, admin: cfg.admins.includes(username) };
  };
  for (const token of sessionTokens(req, url)) {
    try {
      const { sub } = await verifyToken(token, clerkVerifyOptions());
      return await asUser(sub);
    } catch (err) {
      if (err instanceof HttpError) throw err;
    }
  }
  const sub = cookieUserId(req);
  if (sub) return asUser(sub);
  fail(401, 'Sign in required');
}

// Our own signed cookie, set by /api/me after a Clerk-verified request. It keeps <img>/<audio>/<video> tags
// and the live feed (EventSource can't send headers) authorised without putting tokens in URLs.
const COOKIE = 'sk_session';
const COOKIE_HOURS = 8;
const sign = (payload) => createHmac('sha256', process.env.CLERK_SECRET_KEY).update(payload).digest('base64url');

function sessionCookie(req, user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + COOKIE_HOURS * 3.6e6 })).toString('base64url');
  const secure = /https/.test(req.headers['cf-visitor'] || '') ? '; Secure' : '';
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_HOURS * 3600}${secure}`;
}

function cookieUserId(req) {
  const raw =
    (req.headers.cookie || '')
      .split(/;\s*/)
      .find((c) => c.startsWith(COOKIE + '='))
      ?.slice(COOKIE.length + 1) || '';
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  if (expected.length !== Buffer.byteLength(sig) || !timingSafeEqual(expected, Buffer.from(sig))) return null;
  const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return exp > Date.now() ? sub : null;
}

async function logout(req, res) {
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return json(res, { ok: true });
}

// ── Spaces ─────────────────────────────────────────────────────────────
/** Root of an enabled, plugged-in drive ("G:\"), or null. Letters can change; the volume id can't. */
function driveDir(cfg, status, driveId) {
  const letter = cfg.drives[driveId]?.enabled && status.drives.find((d) => d.id === driveId)?.letter;
  return letter && existsSync(letter + sep) ? letter + sep : null;
}

/** A space's folders: [{ drive, path, label? }]. Older spaces have a single drive + path. */
const foldersOf = (s) => (Array.isArray(s.folders) && s.folders.length ? s.folders : [{ drive: s.drive, path: s.path || '' }]);

/** What a member may do in a space: their own setting if they have one, else the best of Everyone and their groups. */
function rightsIn(user, cfg, s) {
  if (user.admin) return 'edit';
  if (s.access?.[user.username]) return s.access[user.username];
  let best = s.everyone || 'none';
  for (const [g, r] of Object.entries(s.groups || {}))
    if (cfg.groups?.[g]?.members?.includes(user.username) && RANK[r] > RANK[best]) best = r;
  return best;
}

/** How each folder of a combined space is named inside it: its label, else its folder name (made unique). */
function folderLabels(folders, cfg) {
  const seen = new Set();
  return folders.map((f) => {
    const base = String(f.label || f.path?.split(/[\\/]/).filter(Boolean).pop() || cfg.drives[f.drive]?.name || 'Drive').slice(0, 60);
    let label = base;
    for (let n = 2; seen.has(label.toLowerCase()); n++) label = `${base} (${n})`;
    seen.add(label.toLowerCase());
    return label;
  });
}

/** Every space this user can see, including their personal space ("me"). A space with several folders
 * ("combined") shows each folder as a top-level folder inside it; see partOf(). */
function spacesFor(user, cfg, status) {
  const list = cfg.spaces.map((s) => ({ ...s, rights: rightsIn(user, cfg, s) })).filter((s) => RANK[s.rights] > 0);
  const mine = cfg.members[user.username];
  if (mine?.drive) {
    list.unshift({
      id: 'me',
      name: `My Space (${user.username})`,
      drive: mine.drive,
      rights: 'edit',
      quotaGB: mine.quotaGB,
      folders: [{ drive: mine.drive, path: join('Sanktuary Members', user.username) }],
    });
  }
  return list.map((s) => {
    const folders = foldersOf(s);
    const labels = folderLabels(folders, cfg);
    const sources = folders.map((f, i) => {
      const dir = driveDir(cfg, status, f.drive);
      return {
        label: labels[i],
        drive: f.drive,
        sub: f.path || '',
        online: !!dir,
        driveRoot: dir,
        root: dir ? join(dir, f.path || '') : null,
      };
    });
    if (sources.length === 1) {
      const [f] = sources;
      return { ...s, drive: f.drive, sub: f.sub, online: f.online, driveRoot: f.driveRoot, root: f.root, sources: undefined };
    }
    return { ...s, drive: null, sub: null, online: sources.some((f) => f.online), driveRoot: null, root: null, sources };
  });
}

/** One folder of a combined space, as an ordinary single-folder space (same id and rights). */
function partOf(space, label) {
  const src = space.sources.find((f) => f.label === label) || fail(404, 'No such folder');
  if (!src.online) fail(503, `${src.label} is on a drive that isn't connected`);
  return { ...space, drive: src.drive, sub: src.sub, driveRoot: src.driveRoot, root: src.root, online: true, sources: undefined, label };
}

/** Where a file lives on its drive: { drive, dpath } (works for combined spaces too). */
function onDrive(space, file) {
  const src = space.sources?.find((f) => f.root && inside(resolve(f.root), file)) || space;
  return { drive: src.drive, dpath: relative(src.driveRoot, file).split(sep).join('/') };
}

// Folder sizes (personal-space quotas, zip progress) are cached for a minute and dropped on any write, so
// refreshing the desktop doesn't re-walk every file on the drive each time.
const sizeCache = new Map(); // dir -> { size, at }
const forgetSizes = () => (sizeCache.clear(), kindCache.clear()); // also which subfolders are projects (see listedKind)
async function folderSize(dir) {
  const hit = sizeCache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return hit.size;
  const walk = async (d) => {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    const sizes = await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? walk(join(d, e.name))
          : stat(join(d, e.name)).then(
              (x) => x.size,
              () => 0,
            ),
      ),
    );
    return sizes.reduce((a, b) => a + b, 0);
  };
  const size = await walk(dir);
  sizeCache.set(dir, { size, at: Date.now() });
  return size;
}

async function spaceInfo(s) {
  const info = { id: s.id, name: s.name, rights: s.rights, online: s.online, driveName: null, free: null, total: null };
  if (!s.online) return info;
  const fs = s.driveRoot && (await statfs(s.driveRoot).catch(() => null)); // a combined space has no single drive (statfs(null) aborts Node)
  if (fs) Object.assign(info, { free: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize });
  if (s.id === 'me') {
    await mkdir(s.root, { recursive: true });
    Object.assign(info, { used: await folderSize(s.root), quota: (s.quotaGB || 0) * 1024 ** 3 });
  }
  return info;
}

// ── File API ───────────────────────────────────────────────────────────
const loadStatus = () => readJson('status.json', { drives: [] });

async function files(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const status = await loadStatus();
  const [, , , spaceId, ...rest] = url.pathname.split('/'); // /api/files/<space>/<path...>
  const whole = spacesFor(user, cfg, status).find((s) => s.id === spaceId) || fail(404, 'No such space');
  if (!whole.online) fail(503, 'Drive offline');
  if (whole.id === 'me') await mkdir(whole.root, { recursive: true });
  const q = url.searchParams;

  let parts = rest.map(decodeURIComponent);
  if (parts.some((p) => /[:\x00-\x1f]/.test(p))) fail(400, 'Bad path');
  // A combined space: its top level lists its folders; below that, everything happens in one folder on one drive
  let space = whole;
  let label = null;
  if (whole.sources) {
    parts = parts.filter(Boolean);
    if (!parts.length) {
      if (req.method === 'GET' && q.has('list')) {
        const now = new Date().toISOString();
        return json(res, {
          rights: whole.rights,
          combined: true,
          entries: whole.sources.map((f) => ({ name: f.label, isDir: true, size: 0, modified: now, offline: !f.online })),
        });
      }
      fail(400, 'Open one of the folders in this space first');
    }
    label = parts[0];
    if (!whole.sources.some((f) => f.label === label))
      fail(req.method === 'GET' ? 404 : 400, req.method === 'GET' ? 'No such folder' : 'Put files inside one of the folders in this space');
    space = partOf(whole, label);
    parts = parts.slice(1);
  }
  const root = resolve(space.root);
  const target = resolve(root, ...parts);
  if (!inside(root, target)) fail(400, 'Bad path');
  const rel = relative(root, target);
  const need = (level) => RANK[space.rights] >= RANK[level] || fail(403, `You need ${level} rights here`);
  /** A path as the member sees it in the space (with the folder's name first in a combined space). */
  const shown = (p) => [label, p.split(sep).join('/')].filter(Boolean).join('/');

  // Downloads of projects say why: view only / playground copy / check-out
  const purpose = { view: ' (view only)', playground: ' (playground copy)', checkout: ' (checked out)' }[q.get('purpose')] || '';
  const transfer = (action, bytes, path = rel) => logTransfer(req, user, action + purpose, space, shown(path), bytes);
  if (req.method !== 'GET') forgetSizes(); // any change to files: cached folder sizes and project kinds are stale
  if (req.method === 'GET') {
    need('view');
    if (q.has('list')) {
      const all = await loadProjects();
      const entries = await listDir(target);
      // Subfolders are checked for a project file 12 at a time (was one after another; all at once would queue
      // thousands of disk reads ahead of everyone else's downloads on a huge folder)
      let next = 0;
      const check = async () => {
        while (next < entries.length) {
          const e = entries[next++];
          const abs = join(target, e.name);
          const p = all[ownerKey(space, abs)];
          const kind = p?.kind || (await listedKind(abs, e.isDir));
          if (kind) e.project = p ? projectView(p, user.username) : { kind, status: 'Not started', lock: null, turn: null, queue: [] };
        }
      };
      await Promise.all(Array.from({ length: 12 }, check));
      const lock = Object.entries(all).find(([k, p]) => p.lock && (ownerKey(space, target) + '/').startsWith(k + '/'))?.[1];
      return json(res, {
        rights: space.rights,
        entries,
        lockedBy: lock && lock.lock.user !== user.username ? { user: lock.lock.user, project: lock.name } : null,
        ...(space.id === 'me' ? { used: await folderSize(root), quota: (space.quotaGB || 0) * 1024 ** 3 } : {}),
      });
    }
    if (q.has('versions')) return json(res, await listDir(join(root, '.sk-versions', rel), true));
    // ?version=<name>: an earlier version of this file, which previews, measures and downloads like the current one
    const file = q.has('version') ? join(root, '.sk-versions', rel, safeName(q.get('version'))) : target;
    if (q.has('thumb')) return thumb(res, file);
    if (q.has('audioinfo')) return json(res, await audioInfo(file));
    if (q.has('preview') && AUDIO_PREVIEW[extname(file).toLowerCase()])
      return stream(req, res, new URLSearchParams(), await audioPreviewFile(file));
    if (q.has('preview')) return thumb(res, file, [800, 1600].includes(Number(q.get('preview'))) ? Number(q.get('preview')) : 2400);
    if (file !== target) return stream(req, res, q, file, transfer);
    if (q.has('zip')) return zipFolder(res, target, target === root ? space.name : basename(target), transfer);
    return stream(req, res, q, target, transfer);
  }
  const log = (action, extra = {}) =>
    space.id !== 'me' && logActivity(user, action, { space: space.id, spaceName: space.name, ...extra, path: shown(extra.path ?? rel) });
  if (req.method === 'PUT' && q.has('stage')) {
    // Check-in upload: goes to a hidden staging folder beside the project; POST /api/projects?action=checkin swaps it in
    const { abs: proj } = locateIn(whole, q.get('project'));
    if (!inside(root, proj)) fail(400, 'Bad check-in upload');
    if ((await loadProjects())[ownerKey(space, proj)]?.lock?.user !== user.username)
      fail(423, 'Check the project out before checking it in');
    if (!/^[\w-]{8,64}$/.test(q.get('stage')) || !inside(proj, target) || proj === root) fail(400, 'Bad check-in upload');
    const stageDir = join(dirname(proj), `.sk-checkin-${q.get('stage')}`);
    const staged = target === proj ? join(stageDir, basename(proj)) : join(stageDir, relative(proj, target));
    return upload(req, res, q, { status, space, root, target: staged, need, log, user, transfer, staged: true });
  }
  if (req.method !== 'GET') await assertUnlocked(space, target, user.username);
  if (req.method === 'POST' && q.has('mkdir')) {
    need('upload');
    if (q.has('parents')) {
      // Whole path at once (the New... window's folders); fine if it's already there. Every level made is theirs.
      const made = (await mkdir(target, { recursive: true }))?.replace(/^\\\\\?\\/, ''); // Windows: \\?\C:\...
      for (let d = target; made && inside(made, d); d = dirname(d)) await setOwner(space, d, user);
      log('made folder');
      return json(res, { ok: true });
    }
    await mkdir(target);
    await setOwner(space, target, user);
    log('made folder');
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && q.has('rename')) {
    need('edit');
    const to = join(dirname(target), safeName(q.get('rename')));
    if (existsSync(to)) fail(409, 'Already exists');
    await rename(target, to);
    await moveOwners(space, target, to);
    await moveProjects(space, target, to);
    autoScan(space, to, user.username).catch(console.error);
    log('renamed', { to: q.get('rename') });
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && q.has('move')) {
    // Drag and drop into another folder of the same space. ?move=<folder, "/"-separated; "" = the space's top>
    need('upload');
    if (target === root) fail(400, "Can't move the space itself");
    let into = q.get('move').split('/').filter(Boolean);
    if (label) {
      // Each folder of a combined space can be on a different drive: moves stay within one folder
      if (into[0] !== label) fail(400, `Files can only be moved within "${label}" here (the other folders are on other drives)`);
      into = into.slice(1);
    }
    const dest = resolve(root, ...into.map(safeName));
    if (!inside(root, dest) || inside(target, dest)) fail(400, "Can't move a folder into itself");
    if (!(await stat(dest).catch(() => null))?.isDirectory()) fail(404, 'No such folder');
    if (RANK[space.rights] < RANK.edit && !(await ownsAll(space, target, user.username)))
      fail(403, 'You can only move things you added. Ask an admin to move this.');
    const to = join(dest, basename(target));
    if (existsSync(to)) fail(409, `There's already a "${basename(target)}" in that folder`);
    await assertUnlocked(space, dest, user.username, false); // moving into a folder that merely contains one is fine
    await rename(target, to);
    await moveOwners(space, target, to);
    await moveProjects(space, target, to);
    autoScan(space, to, user.username).catch(console.error);
    log('moved', { to: shown(relative(root, to)) });
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && q.has('restore')) {
    need('edit');
    const version = join(root, '.sk-versions', rel, safeName(q.get('restore')));
    if (!existsSync(version)) fail(404, 'No such version');
    await keepVersion(root, target);
    await cp(version, target);
    log('restored an older version of');
    return json(res, { ok: true });
  }
  if (req.method === 'DELETE') {
    need('upload');
    if (target === root) fail(400, "Can't delete the space itself");
    // Members can only bin what they added themselves; admins and personal spaces are unrestricted
    if (!user.admin && space.id !== 'me' && !(await ownsAll(space, target, user.username)))
      fail(403, 'You can only delete things you added. Ask an admin to remove this.');
    const bin = join(root, '.sk-trash', stamp(), rel); // recoverable: nothing is ever really deleted
    await mkdir(dirname(bin), { recursive: true });
    await rename(target, bin);
    await moveProjects(space, target, null);
    log('deleted');
    return json(res, { ok: true });
  }
  if (req.method === 'PUT') return upload(req, res, q, { status, space, root, target, need, log, user, transfer });
  fail(405, 'Not allowed');
}

// ── Who added what: data/owners.json, "<drive id>|<path on drive>" -> username ──
// Keyed by drive + path (not space) so two spaces over the same folder agree, and letters can change.
// Files that were already on the drive have no owner, so only admins can delete them.
let owners = null;
let ownersSaved = Promise.resolve();
const ownerKey = (space, file) => {
  const { drive, dpath } = onDrive(space, file);
  return `${drive}|${dpath.toLowerCase()}`;
};
const loadOwners = async () => (owners ??= await readJson('owners.json', {}));
const saveOwners = () => (ownersSaved = ownersSaved.then(() => saveJson('owners.json', owners)).catch(console.error));

async function setOwner(space, file, user) {
  (await loadOwners())[ownerKey(space, file)] = user.username;
  return saveOwners();
}

async function moveOwners(space, from, to) {
  const o = await loadOwners();
  const [a, b] = [ownerKey(space, from), ownerKey(space, to)];
  for (const k of Object.keys(o))
    if (k === a || k.startsWith(a + '/')) {
      o[b + k.slice(a.length)] = o[k];
      delete o[k];
    }
  return saveOwners();
}

/** Did this member add the file, or the folder and every file in it? (Windows/Sanktuary clutter is ignored.) */
async function ownsAll(space, target, username) {
  const o = await loadOwners();
  if (o[ownerKey(space, target)] !== username) return false;
  if (!(await stat(target)).isDirectory()) return true;
  for (const e of await readdir(target, { withFileTypes: true, recursive: true })) {
    const file = join(e.parentPath, e.name);
    if (
      e.isDirectory() ||
      relative(target, file)
        .split(sep)
        .some((p) => HIDDEN.test(p))
    )
      continue;
    if (o[ownerKey(space, file)] !== username) return false;
  }
  return true;
}

// ── Transfer log: data/transfers.jsonl, every upload and download (Admin Panel > Log) ──
// ── Usage: small daily counts for Admin Panel > Usage (data/usage.json, last 120 days) ──
// Who was active (usernames only), uploads, downloads, share-link opens, story and release-page views. No IPs,
// no visitor tracking: public views are plain counters.
let usageDb = null;
let usageTimer = null;
let usageSaved = Promise.resolve();
const loadUsage = async () => (usageDb ??= await readJson('usage.json', { days: {} }));
/** Counting never gets in the way of a request: it can't throw or be awaited by accident. */
const count = (what, key) => void countNow(what, key).catch(console.error);
async function countNow(what, key) {
  const db = await loadUsage();
  const d = (db.days[localDate()] ??= { members: [], uploads: 0, downloads: 0, linkOpens: 0, views: {} });
  if (what === 'member') {
    if (!key || d.members.includes(key)) return;
    d.members.push(key);
  } else if (what === 'view') d.views[key] = (d.views[key] || 0) + 1;
  else d[what] = (d[what] || 0) + 1;
  usageTimer ??= setTimeout(() => {
    usageTimer = null;
    db.days = Object.fromEntries(
      Object.keys(db.days)
        .sort()
        .slice(-120)
        .map((k) => [k, db.days[k]]),
    );
    usageSaved = usageSaved.then(() => saveJson('usage.json', db)).catch(console.error);
  }, 5000).unref();
}

/** Week by week (Monday first), the last 8 weeks. */
async function usageReport() {
  const db = await loadUsage();
  const monday = (d) => {
    const x = new Date(`${d}T12:00:00`);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.toLocaleDateString('en-CA');
  };
  const weeks = new Map();
  for (const [day, d] of Object.entries(db.days)) {
    const w = weeks.get(monday(day)) || { week: monday(day), members: new Set(), uploads: 0, downloads: 0, linkOpens: 0, views: {} };
    d.members.forEach((m) => w.members.add(m));
    w.uploads += d.uploads;
    w.downloads += d.downloads;
    w.linkOpens += d.linkOpens;
    for (const [k, n] of Object.entries(d.views)) w.views[k] = (w.views[k] || 0) + n;
    weeks.set(w.week, w);
  }
  const list = [...weeks.values()]
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, 8)
    .map((w) => ({ ...w, active: w.members.size, members: [...w.members].sort() }));
  const tdb = await loadTracks();
  const content = {
    releases: Object.values(tdb.releases).filter((r) => !r.deleted).length,
    tracks: Object.values(tdb.tracks).filter((t) => !t.deleted).length,
    withBounce: Object.values(tdb.tracks).filter((t) => !t.deleted && t.bounce).length,
    timeline: Object.keys((await loadTimeline()).items).length,
    stories: Object.values((await loadStories()).stories).filter((st) => st.public && !st.deleted).length,
    products: Object.values((await loadShop()).products).filter((p) => p.active && !p.deleted).length,
  };
  return { weeks: list, content };
}

function logTransfer(req, user, action, space, path, bytes) {
  if (action.startsWith('uploaded')) count('uploads');
  else if (action.startsWith('downloaded')) count('downloads');
  const entry = {
    at: new Date().toISOString(),
    user: user.username,
    action,
    space: space.name,
    path,
    bytes,
    ip: req.headers['cf-connecting-ip'] || req.socket.remoteAddress,
  };
  appendFile(join(DATA, 'transfers.jsonl'), JSON.stringify(entry) + '\n').catch(console.error);
}

// A folder as one .zip (e.g. an Ableton project with its Samples), streamed by Windows' own tar so nothing
// is staged on disk. Stored, not compressed: audio barely shrinks and this keeps it fast.
// Windows' tar.exe is bsdtar (libarchive); elsewhere (test CI) the same tool is installed as bsdtar
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
async function zipFolder(res, dir, name, transfer) {
  if (!(await stat(dir).catch(() => null))?.isDirectory()) fail(404, 'Not a folder');
  const items = (await readdir(dir)).filter((n) => !HIDDEN.test(n));
  if (!items.length) fail(404, 'This folder is empty');
  // Start sending straight away; the size is only for the progress bar, so wait at most 0.4 s for it
  const sizing = folderSize(dir);
  const size = await Promise.race([sizing, new Promise((r) => setTimeout(() => r(0), 400))]);
  // "./name" so a file called e.g. "--use-compress-program=..." can never be read as a tar option
  const tar = spawn(TAR, [
    '--format',
    'zip',
    '--options',
    'zip:compression=store',
    '--exclude',
    '.sk-*',
    '-cf',
    '-',
    '-C',
    dir,
    ...items.map((n) => `./${n}`),
  ]);
  tar.stderr.resume();
  tar.on('error', (e) => res.destroy(e)); // tar missing: end this download, don't crash the whole server
  res.on('close', () => tar.kill());
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.zip')}`,
    ...(size ? { 'x-total-bytes': size } : {}),
  });
  sizing.then((bytes) => transfer('downloaded folder (zip)', bytes));
  return pipeline(tar.stdout, res);
}

// ── Projects: check-out / check-in, turns and followers — data/projects.json ──
// A project is a folder holding an Ableton / FL Studio / Premiere / After Effects project file, or a single
// Photoshop / Illustrator file. Checking out locks it: everyone can still view and download it, nobody else can
// change it. Checking in uploads the new version to a hidden staging folder, checks it, then swaps it in and
// keeps the old one in .sk-versions. The next person in the queue then gets a turn to claim it.
// Keyed like owners.json (drive + path) so every space over the same folder agrees.
const PROJECT_FILES = {
  '.als': 'Ableton Live',
  '.flp': 'FL Studio',
  '.prproj': 'Premiere Pro',
  '.aep': 'After Effects',
  '.aepx': 'After Effects',
  '.logicx': 'Logic Pro',
};
const PROJECT_SINGLE = { '.psd': 'Photoshop', '.psb': 'Photoshop', '.ai': 'Illustrator', '.logicx': 'Logic Pro' };
const STATUSES = ['Not started', 'In progress', 'In review', 'Done'];
const TURN_HOURS = 24;
const REMIND_HOURS = 48;
let projects = null;
let projectsSaved = Promise.resolve();
const loadProjects = async () => (projects ??= await readJson('projects.json', {}));
const saveProjects = () => (projectsSaved = projectsSaved.then(() => saveJson('projects.json', projects)).catch(console.error));

/** "Ableton Live", "Photoshop", "Logic Pro"... or null if this isn't a project. */
async function projectKind(abs, isDir) {
  if (abs.toLowerCase().endsWith('.logicx')) return 'Logic Pro';
  if (!isDir) return PROJECT_SINGLE[extname(abs).toLowerCase()] || null;
  for (const n of await readdir(abs).catch(() => []))
    if (PROJECT_FILES[extname(n).toLowerCase()]) return PROJECT_FILES[extname(n).toLowerCase()];
  return null;
}

// Whether a subfolder is a project, remembered for a minute so moving around a folder doesn't re-read every
// subfolder each time. Dropped with forgetSizes() on every write through Sanktuary; the minute covers changes made
// on the drive directly (a folder's modified time can't be trusted for that: FAT32 USB drives never update it).
const kindCache = new Map(); // folder -> { at, kind }
async function listedKind(abs, isDir) {
  if (!isDir) return projectKind(abs, false);
  const hit = kindCache.get(abs);
  if (hit && Date.now() - hit.at < 60_000) return hit.kind;
  const kind = await projectKind(abs, true);
  if (kindCache.size > 50_000) kindCache.clear();
  kindCache.set(abs, { at: Date.now(), kind });
  return kind;
}

/** The project's record, created on first use. */
async function projectAt(space, abs) {
  const all = await loadProjects();
  const key = ownerKey(space, abs);
  if (!all[key]) {
    const s = (await stat(abs).catch(() => null)) || fail(404, 'Not found');
    const kind =
      (await projectKind(abs, s.isDirectory())) ||
      fail(400, "This isn't a project (no Ableton, Logic Pro, FL Studio, Premiere or After Effects file inside, or not a PSD/AI file)");
    all[key] = {
      kind,
      name: basename(abs),
      ...onDrive(space, abs),
      status: 'Not started',
      lock: null,
      turn: null,
      queue: [],
      followers: [],
      history: [],
    };
  }
  return all[key];
}

const pushHistory = (p, user, action, note) =>
  (p.history = [{ at: new Date().toISOString(), user, action, ...(note ? { note } : {}) }, ...p.history].slice(0, 100));

/** Where this project shows up for a member: { space, dir, name, isDir } in a space they can see, or null. */
function locate(username, p, cfg, status) {
  const admin = cfg.admins.includes(username);
  for (const s of spacesFor({ username, admin }, cfg, status))
    for (const f of s.sources || [{ drive: s.drive, sub: s.sub, label: null }]) {
      if (f.drive !== p.drive) continue;
      const sub = f.sub.split(/[\\/]/).filter(Boolean);
      const parts = p.dpath.split('/');
      if (sub.every((x, i) => x.toLowerCase() === parts[i]?.toLowerCase()) && parts.length > sub.length) {
        const rel = [...(f.label ? [f.label] : []), ...parts.slice(sub.length)];
        return { space: s.id, spaceName: s.name, rights: s.rights, dir: rel.slice(0, -1), name: rel[rel.length - 1] };
      }
    }
  return null;
}

/** Tell everyone attached to a project (followers, queue, holder) what happened, except whoever did it. */
async function notifyProject(p, actor, text) {
  const [cfg, status] = [await loadConfig(), await loadStatus()];
  for (const u of new Set([...p.followers, ...p.queue, p.lock?.user, p.turn?.user].filter(Boolean)))
    if (u !== actor) {
      const at = locate(u, p, cfg, status);
      if (at) await notify(u, text, { project: p.name, where: at });
    }
}

/** Offer the project to the next person in the queue, if anyone is waiting. */
async function passTurn(p) {
  const next = p.queue.shift();
  p.turn = next ? { user: next, until: new Date(Date.now() + TURN_HOURS * 3.6e6).toISOString() } : null;
  if (next) {
    const at = locate(next, p, await loadConfig(), await loadStatus());
    if (at)
      await notify(next, `It's your turn on ${p.name}. Check it out within ${TURN_HOURS} hours or it passes to the next person.`, {
        project: p.name,
        where: at,
        turn: true,
      });
  }
}

/** Unclaimed turns expire; long-held locks get a reminder. Runs hourly and whenever a project is looked at. */
async function tickProject(p) {
  if (p.turn && Date.parse(p.turn.until) < Date.now()) {
    pushHistory(p, p.turn.user, "didn't claim their turn");
    const at = locate(p.turn.user, p, await loadConfig(), await loadStatus());
    if (at) await notify(p.turn.user, `Your turn on ${p.name} ran out.`, { project: p.name, where: at });
    await passTurn(p);
    saveProjects();
  }
  if (p.lock && !p.lock.reminded && Date.now() - Date.parse(p.lock.at) > REMIND_HOURS * 3.6e6) {
    p.lock.reminded = true;
    const at = locate(p.lock.user, p, await loadConfig(), await loadStatus());
    if (at)
      await notify(
        p.lock.user,
        `You've had ${p.name} checked out for over ${REMIND_HOURS} hours. Check it in (or release it) so others can work on it.`,
        { project: p.name, where: at },
      );
    saveProjects();
  }
}
setInterval(async () => {
  for (const p of Object.values(await loadProjects())) await tickProject(p).catch(console.error);
}, 3.6e6).unref();

/** Refuse changes inside a project someone else has checked out (or, with around, to a folder holding one). */
async function assertUnlocked(space, abs, username, around = true) {
  const k = ownerKey(space, abs);
  for (const [pk, p] of Object.entries(await loadProjects()))
    if (p.lock && p.lock.user !== username && (k === pk || k.startsWith(pk + '/') || (around && pk.startsWith(k + '/'))))
      fail(423, `${p.name} is checked out by ${p.lock.user}. You can view and download it, but not change it until it's checked back in.`);
}

/** Project records and share links follow renames and moves; deleting ends them. */
async function moveProjects(space, from, to) {
  const all = await loadProjects();
  const [a, b] = [ownerKey(space, from), to && ownerKey(space, to)];
  for (const k of Object.keys(all))
    if (k === a || k.startsWith(a + '/')) {
      if (b)
        all[b + k.slice(a.length)] = {
          ...all[k],
          name: k === a ? basename(to) : all[k].name,
          dpath: onDrive(space, to).dpath + all[k].dpath.slice(onDrive(space, from).dpath.length),
        };
      delete all[k];
    }
  saveProjects();
  const { drive: fromDrive, dpath: fromD } = onDrive(space, from);
  for (const l of Object.values(await loadLinks()))
    if (
      l.drive === fromDrive &&
      (l.dpath.toLowerCase() === fromD.toLowerCase() || l.dpath.toLowerCase().startsWith(fromD.toLowerCase() + '/'))
    ) {
      if (!to)
        l.revoked = true; // deleted: the link stops working
      else {
        const toD = onDrive(space, to).dpath;
        if (l.dpath.length === fromD.length) l.name = basename(to);
        l.dpath = toD + l.dpath.slice(fromD.length);
      }
    }
  saveLinks();
}

// Files a project points at that aren't inside it, i.e. what would come up "missing" on someone else's computer.
// Reliable for Ableton and Premiere (paths in gzipped XML); best effort for FL Studio, After Effects,
// Photoshop linked smart objects and Illustrator linked images (paths inside binary files).
const MEDIA_REF =
  /(?:[A-Za-z]:[\\/]|\/(?:Users|Volumes)\/)[^\x00-\x1f"<>|*?]{1,300}?\.(?:wav|aiff?|mp3|flac|ogg|m4a|rx2|rex|mid|mp4|mov|mxf|avi|m4v|png|jpe?g|tiff?|psd|psb|ai|eps|pdf|svg|gif|exr|dng|cr[23]|nef|arw)(?![\w])/gi;
const LIBRARY = /Ableton|Core Library|Program Files|Image-Line|FL Studio|Native Instruments|Splice/i; // everyone has their own copy
const SCAN_MAX = 300 * 1024 ** 2;

async function missingFiles(dir) {
  const all = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
  const have = new Set(all.map((e) => e.name.toLowerCase()));
  const missing = new Set();
  for (const e of all) {
    const ext = extname(e.name).toLowerCase();
    if (!PROJECT_FILES[ext] && !PROJECT_SINGLE[ext]) continue;
    const file = join(e.parentPath, e.name);
    if ((await stat(file)).size > SCAN_MAX) continue;
    let buf = await readFile(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf); // .als and .prproj are gzipped XML
    for (const text of [buf.toString('latin1'), buf.toString('utf16le'), buf.subarray(1).toString('utf16le')])
      for (const [ref] of text.matchAll(MEDIA_REF)) {
        const name = decodeXml(ref).split(/[\\/]/).pop(); // .als is XML: & arrives as &amp;
        if (!LIBRARY.test(ref) && !have.has(name.toLowerCase())) missing.add(name);
      }
  }
  return [...missing].slice(0, 50);
}

// "Add the missing files": the files someone picked were uploaded into the project's Samples/Imported folder;
// point every Ableton sample reference with the same file name at them (project-relative), which is what
// Live's own "Collect All and Save" writes. Live 11 / 12 .als files; the untouched set goes to Backup/ first.
async function relinkAbleton(stageDir) {
  const imported = join(stageDir, 'Samples', 'Imported');
  const have = new Set((await readdir(imported).catch(() => [])).map((n) => n.toLowerCase()));
  if (!have.size) return 0;
  let changed = 0;
  for (const name of await readdir(stageDir)) {
    if (extname(name).toLowerCase() !== '.als') continue;
    const file = join(stageDir, name);
    const raw = await readFile(file);
    const xml = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
    let n = 0;
    const next = xml.replace(/<FileRef>[\s\S]*?<\/FileRef>/g, (ref) => {
      const path = ref.match(/<Path Value="([^"]*)"/)?.[1] || '';
      const base = decodeXml(path).split(/[\\/]/).pop();
      if (!base || !have.has(base.toLowerCase()) || /<RelativePath Value="Samples\/Imported\//.test(ref)) return ref;
      n++;
      const rel = `Samples/Imported/${base.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}`;
      return ref
        .replace(/<RelativePathType Value="\d+"\s*\/>/, '<RelativePathType Value="3" />')
        .replace(/<RelativePath Value="[^"]*"\s*\/>/, `<RelativePath Value="${rel}" />`);
    });
    if (!n) continue;
    await mkdir(join(stageDir, 'Backup'), { recursive: true });
    await writeFile(join(stageDir, 'Backup', `${basename(name, '.als')} [before Sanktuary relink ${stamp()}].als`), raw);
    await writeFile(file, gzipSync(Buffer.from(next, 'utf8')));
    changed += n;
  }
  return changed;
}

// ── Notifications: data/notifications/<user>.jsonl, shown in Profile > My Projects and the tray,
// and pushed to every phone/computer the member turned notifications on for ──
async function notify(username, text, extra = {}) {
  if (!/^[\w.-]{1,64}$/.test(username)) return;
  const n = { id: randomUUID().slice(0, 12), at: new Date().toISOString(), text, ...extra };
  await mkdir(join(DATA, 'notifications'), { recursive: true });
  await appendFile(join(DATA, 'notifications', `${username}.jsonl`), JSON.stringify(n) + '\n');
  emit('notify', n, (u) => u.username === username);
  push(username, { title: extra.turn ? "Sanktuary: it's your turn" : 'Sanktuary', body: text, tag: extra.project }).catch(console.error);
}

// ── Push notifications (Web Push): data/push.json holds each member's subscribed devices ──
// Keys are made once and kept in data/vapid.json; the public half goes to browsers when they subscribe.
let pushSubs = null;
let pushSaved = Promise.resolve();
const loadPush = async () => (pushSubs ??= await readJson('push.json', {}));
const savePush = () => (pushSaved = pushSaved.then(() => saveJson('push.json', pushSubs)).catch(console.error));
let vapid = null;
async function vapidKeys() {
  if (vapid) return vapid;
  vapid = await readJson('vapid.json', null);
  if (!vapid) {
    vapid = webpush.generateVAPIDKeys();
    await mkdir(DATA, { recursive: true });
    await saveJson('vapid.json', vapid);
  }
  webpush.setVapidDetails('https://sanktuary.studio', vapid.publicKey, vapid.privateKey);
  return vapid;
}

/** Sends to every device the member subscribed; devices that unsubscribed or expired are dropped. */
async function push(username, payload) {
  const devices = (await loadPush())[username];
  if (!devices?.length) return;
  await vapidKeys();
  const body = JSON.stringify({ url: '/', ...payload });
  const results = await Promise.all(
    devices.map((d) =>
      webpush.sendNotification(d, body, { TTL: 24 * 3600 }).then(
        () => true,
        (err) => ![404, 410].includes(err.statusCode), // gone: forget it; anything else: keep and retry next time
      ),
    ),
  );
  if (results.includes(false)) {
    pushSubs[username] = devices.filter((_, i) => results[i]);
    savePush();
  }
}

async function pushApi(req, res, url) {
  const user = await currentUser(req, url, await loadConfig());
  const action = url.pathname.split('/')[3];
  if (req.method === 'GET' && action === 'key') return json(res, { key: (await vapidKeys()).publicKey });
  const all = await loadPush();
  const mine = (all[user.username] ||= []);
  if (req.method === 'POST' && action === 'subscribe') {
    const { subscription: s } = await jsonBody(req);
    const ok = s && /^https:\/\//.test(s.endpoint) && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
    if (!ok) fail(400, 'Bad subscription');
    all[user.username] = [
      ...mine.filter((d) => d.endpoint !== s.endpoint),
      { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
    ].slice(-10);
    savePush();
    return json(res, { ok: true, devices: all[user.username].length });
  }
  if (req.method === 'POST' && action === 'unsubscribe') {
    const { endpoint } = await jsonBody(req);
    all[user.username] = mine.filter((d) => d.endpoint !== endpoint);
    savePush();
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && action === 'test') {
    if (!mine.length) fail(400, 'Turn notifications on first');
    await push(user.username, { title: 'Sanktuary', body: 'Notifications are working on this device.' });
    return json(res, { ok: true });
  }
  fail(404, 'Unknown push action');
}

/** Resolve "a/b/c" inside a space, refusing anything that escapes it. */
function locateIn(space, relPath) {
  let parts = String(relPath || '')
    .split('/')
    .filter(Boolean);
  if (parts.some((p) => /[:\x00-\x1f]/.test(p) || p === '..')) fail(400, 'Bad path');
  if (space.sources) {
    if (!parts.length) fail(400, 'Pick one of the folders in this space');
    space = partOf(space, parts[0]);
    parts = parts.slice(1);
  }
  const root = resolve(space.root);
  const abs = resolve(root, ...parts);
  if (!inside(root, abs)) fail(400, 'Bad path');
  return { root, abs };
}

// ── /api/projects ──────────────────────────────────────────────────────
async function projectsApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const status = await loadStatus();
  const q = url.searchParams;

  if (req.method === 'GET' && q.has('notifications')) {
    const lines = (await readFile(join(DATA, 'notifications', `${user.username}.jsonl`), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean);
    return json(
      res,
      lines
        .slice(-50)
        .map((l) => JSON.parse(l))
        .reverse(),
    );
  }
  if (req.method === 'GET' && q.has('mine')) {
    const list = [];
    for (const p of Object.values(await loadProjects())) {
      const u = user.username;
      const owner = (await loadOwners())[`${p.drive}|${p.dpath.toLowerCase()}`] === u;
      if (!(owner || p.followers.includes(u) || p.queue.includes(u) || p.lock?.user === u || p.turn?.user === u)) continue;
      const at = locate(u, p, cfg, status);
      if (!at) continue;
      await tickProject(p);
      list.push({ ...projectView(p, u), owner, at });
    }
    return json(res, list);
  }

  const space = spacesFor(user, cfg, status).find((s) => s.id === q.get('space')) || fail(404, 'No such space');
  if (!space.online) fail(503, 'Drive offline');
  const { root, abs } = locateIn(space, q.get('path'));
  if (abs === root) fail(400, 'Pick a project');
  const need = (level) => RANK[space.rights] >= RANK[level] || fail(403, `You need ${level} rights here`);
  need('view');
  const p = await projectAt(space, abs);
  await tickProject(p);
  if (req.method === 'GET') return json(res, { ...projectView(p, user.username), history: p.history });

  const action = q.get('action');
  const me = user.username;
  const owner = (await loadOwners())[ownerKey(space, abs)] === me;
  const note = String(q.get('note') || '').slice(0, 300);
  const done = async (text) => {
    saveProjects();
    if (text) await notifyProject(p, me, text);
    return json(res, projectView(p, me));
  };

  if (action === 'follow' || action === 'unfollow') {
    p.followers = p.followers.filter((u) => u !== me).concat(action === 'follow' ? [me] : []);
    return done();
  }
  need('upload');
  if (action === 'checkout') {
    if (p.lock) fail(409, `Already checked out by ${p.lock.user}`);
    if (p.turn && p.turn.user !== me)
      fail(409, `It's ${p.turn.user}'s turn until ${new Date(p.turn.until).toLocaleString()}. Join the queue to go next.`);
    await assertUnlocked(space, abs, me); // nothing inside or around it is checked out by someone else
    p.lock = { user: me, at: new Date().toISOString() };
    p.turn = null;
    p.queue = p.queue.filter((u) => u !== me);
    if (!p.followers.includes(me)) p.followers.push(me);
    pushHistory(p, me, 'checked out', note);
    return done(`${me} checked out ${p.name}.`);
  }
  if (action === 'queue') {
    if (!p.lock && !p.turn) fail(409, 'Nobody has it: check it out instead');
    if (p.lock?.user === me || p.turn?.user === me) fail(409, "You're already up");
    if (!p.queue.includes(me)) p.queue.push(me);
    if (!p.followers.includes(me)) p.followers.push(me);
    pushHistory(p, me, 'joined the queue');
    return done();
  }
  if (action === 'unqueue') {
    p.queue = p.queue.filter((u) => u !== me);
    if (p.turn?.user === me) {
      pushHistory(p, me, 'passed on their turn');
      await passTurn(p);
    }
    return done();
  }
  if (action === 'status') {
    if (p.lock?.user !== me && !owner && !user.admin)
      fail(403, 'Only whoever has it checked out, its owner or an admin can change the status');
    p.status = STATUSES.includes(q.get('status')) ? q.get('status') : fail(400, 'Bad status');
    pushHistory(p, me, `set the status to ${p.status}`, note);
    return done(`${p.name} is now "${p.status}"${note ? `: ${note}` : ''} (${me}).`);
  }
  if (action === 'release') {
    if (!p.lock) fail(409, "It isn't checked out");
    const forced = p.lock.user !== me;
    if (forced && !owner && !user.admin) fail(403, "Only its owner or an admin can release someone else's check-out");
    const was = p.lock.user;
    p.lock = null;
    pushHistory(p, me, forced ? `force-released ${was}'s check-out` : 'released it without changes', note);
    if (forced) {
      const at = locate(was, p, cfg, status);
      if (at)
        await notify(was, `${me} released your check-out of ${p.name}. Your local changes weren't uploaded.`, {
          project: p.name,
          where: at,
        });
    }
    await passTurn(p);
    return done(forced ? `${me} released ${was}'s check-out of ${p.name}.` : `${p.name} is free again (${me} released it).`);
  }
  if (action === 'checkin') {
    if (p.lock?.user !== me) fail(423, 'Check it out before checking it in');
    const stage = q.get('stage') || '';
    if (!/^[\w-]{8,64}$/.test(stage)) fail(400, 'Bad check-in');
    const stageDir = join(dirname(abs), `.sk-checkin-${stage}`);
    if (!existsSync(stageDir)) fail(400, 'Nothing was uploaded for this check-in');
    const isDir = (await stat(abs)).isDirectory();
    const staged = (await readdir(stageDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());
    if (staged.some((e) => e.name.startsWith('.sk-upload-'))) fail(409, "Some files haven't finished uploading. Try the check-in again.");
    if (staged.length !== Number(q.get('files')))
      fail(409, `Only ${staged.length} of ${q.get('files')} files arrived. Try the check-in again.`);
    const incoming = isDir ? stageDir : join(stageDir, basename(abs));
    if (isDir && !(await projectKind(stageDir, true)))
      fail(400, `There's no ${p.kind} project file at the top of what you picked. Pick the project folder itself.`);
    if (!isDir && !existsSync(incoming)) fail(400, `Upload ${p.name} itself`);
    // Files added through "Add the missing files" landed in Samples/Imported: repoint the set at them first
    if (q.has('relink') && p.kind === 'Ableton Live') await relinkAbleton(stageDir);
    if (!q.has('force')) {
      const missing = await missingFiles(stageDir);
      if (missing.length) return json(res, { ok: false, missing });
    }
    // Swap: current version into .sk-versions, staged one into place (undone if the second step fails)
    const versions = join(root, '.sk-versions', relative(root, abs));
    await mkdir(versions, { recursive: true });
    const old = join(versions, stamp() + (isDir ? '' : extname(abs)));
    try {
      await rename(abs, old);
    } catch {
      fail(409, "Some of the project's files are open right now (maybe someone is previewing them). Try again in a minute.");
    }
    try {
      await rename(incoming, abs);
    } catch (err) {
      await rename(old, abs);
      throw err;
    }
    if (!isDir) await rm(stageDir, { recursive: true, force: true });
    p.lock = null;
    pushHistory(p, me, 'checked in a new version', note);
    const text = `${me} checked in a new version of ${p.name}${note ? `: ${note}` : '.'}`;
    await notifyProject(p, me, text);
    await passTurn(p);
    saveProjects();
    logActivity(user, 'checked in', { space: space.id, spaceName: space.name, path: relative(root, abs).split(sep).join('/'), text: note });
    return json(res, { ok: true, ...projectView(p, me) });
  }
  fail(400, 'Unknown project action');
}

// ── Share links: sanktuary.studio/s/<token> for people without an account — data/links.json ──
// 192-bit random tokens, optional expiry and password (scrypt), revocable, downloads on or off. Views and
// downloads are counted; only whoever made the link, the item's owner and admins can see the counts.
// A link points at drive + path, so it survives spaces being rearranged and follows renames/moves.
let links = null;
let linksSaved = Promise.resolve();
const loadLinks = async () => (links ??= await readJson('links.json', {}));
const saveLinks = () => (linksSaved = linksSaved.then(() => saveJson('links.json', links)).catch(console.error));
const hashPassword = (pw, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
const passwordOk = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(String(pw), salt, 32), Buffer.from(hash, 'hex'));
};
const LINK_DAYS = [1, 7, 30, 90, 0]; // 0 = never expires
const unlockTries = new Map(); // "<token>|<ip>" -> { n, since }

async function canManageLink(l, user) {
  return user.admin || l.createdBy === user.username || (await loadOwners())[`${l.drive}|${l.dpath.toLowerCase()}`] === user.username;
}
const linkView = (token, l) => ({
  token,
  url: `/s/${token}`,
  name: l.name,
  isDir: l.isDir,
  createdBy: l.createdBy,
  created: l.created,
  expires: l.expires,
  password: !!l.password,
  download: l.download,
  revoked: !!l.revoked,
  views: l.views,
  downloads: l.downloads,
  lastOpened: l.lastOpened || null,
});

async function linksApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const status = await loadStatus();
  const all = await loadLinks();
  const token = url.pathname.split('/')[3];

  if (token && req.method === 'DELETE') {
    const l = own(all, token) || fail(404, 'No such link');
    if (!(await canManageLink(l, user))) fail(403, 'Only whoever made the link, the owner or an admin can turn it off');
    l.revoked = true;
    saveLinks();
    return json(res, linkView(token, l));
  }
  if (req.method === 'GET' && url.searchParams.has('mine')) {
    const list = [];
    for (const [t, l] of Object.entries(all)) if (await canManageLink(l, user)) list.push(linkView(t, l));
    return json(res, list.reverse());
  }

  const q = req.method === 'POST' ? await jsonBody(req) : Object.fromEntries(url.searchParams);
  const space = spacesFor(user, cfg, status).find((s) => s.id === q.space) || fail(404, 'No such space');
  if (!space.online) fail(503, 'Drive offline');
  const { root, abs } = locateIn(space, q.path);
  if (abs === root) fail(400, 'Share a folder or file inside the space');
  const key = ownerKey(space, abs);

  if (req.method === 'GET') {
    const list = [];
    for (const [t, l] of Object.entries(all))
      if (`${l.drive}|${l.dpath.toLowerCase()}` === key && (await canManageLink(l, user))) list.push(linkView(t, l));
    return json(res, list.reverse());
  }
  if (req.method === 'POST') {
    if (RANK[space.rights] < RANK.upload) fail(403, 'You need upload rights in this space to share it outside the team');
    const s = (await stat(abs).catch(() => null)) || fail(404, 'Not found');
    const days = LINK_DAYS.includes(Number(q.days)) ? Number(q.days) : fail(400, 'Bad expiry');
    const password = String(q.password || '');
    if (password && password.length < 4) fail(400, 'Use a password of at least 4 characters');
    const t = randomBytes(24).toString('base64url');
    all[t] = {
      ...onDrive(space, abs),
      name: basename(abs),
      isDir: s.isDirectory(),
      createdBy: user.username,
      created: new Date().toISOString(),
      expires: days ? new Date(Date.now() + days * 864e5).toISOString() : null,
      password: password ? hashPassword(password) : null,
      download: !!q.download,
      views: 0,
      downloads: 0,
    };
    saveLinks();
    logActivity(user, 'made a share link for', { space: space.id, spaceName: space.name, path: relative(root, abs).split(sep).join('/') });
    return json(res, linkView(t, all[t]));
  }
  fail(405, 'Not allowed');
}

// Public side. Everything under /s/<token> is reachable without an account, so every request re-checks the
// link (exists, not revoked, not expired, unlocked if it has a password) and keeps paths inside it.
const SHARE_PAGE = new URL('./share.html', import.meta.url);
async function publicShare(req, res, url) {
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  res.setHeader('referrer-policy', 'no-referrer'); // the token is in the URL
  const [, , token = '', action = ''] = url.pathname.split('/'); // /s/<token>/<info|unlock|list|file|zip|thumb>
  if (!action) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-src 'self'",
    });
    return pipeline(createReadStream(SHARE_PAGE), res);
  }
  const l = (/^[\w-]{32}$/.test(token) && (await loadLinks())[token]) || fail(404, 'This link does not exist');
  if (l.revoked) fail(410, 'This link has been turned off');
  if (l.expires && Date.parse(l.expires) < Date.now()) fail(410, 'This link has expired');
  const cookieName = `sk_link_${token.slice(0, 10)}`;
  const pass = l.password ? createHmac('sha256', process.env.CLERK_SECRET_KEY).update(`${token}:${l.password}`).digest('base64url') : null;
  const unlocked = !l.password || (req.headers.cookie || '').split(/;\s*/).includes(`${cookieName}=${pass}`);
  const saved = () => saveLinks();

  if (action === 'info') {
    if (unlocked) {
      count('linkOpens');
      l.views++;
      l.lastOpened = new Date().toISOString();
      saved();
    }
    // A password-protected link shows nothing about what it holds until it's unlocked
    if (!unlocked)
      return json(res, { name: 'Protected link', locked: true, sharedBy: l.createdBy, expires: l.expires, download: l.download });
    return json(res, { name: l.name, isDir: l.isDir, download: l.download, locked: false, sharedBy: l.createdBy, expires: l.expires });
  }
  if (action === 'unlock' && req.method === 'POST') {
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const k = `${token}|${ip}`;
    const t = unlockTries.get(k);
    const tries = t && Date.now() - t.since < 15 * 60_000 ? t : { n: 0, since: Date.now() };
    if (tries.n >= 10) fail(429, 'Too many wrong passwords. Try again in 15 minutes.');
    if (!l.password || !passwordOk((await jsonBody(req)).password || '', l.password)) {
      unlockTries.set(k, { ...tries, n: tries.n + 1 });
      fail(403, 'Wrong password');
    }
    unlockTries.delete(k);
    const secure = /https/.test(req.headers['cf-visitor'] || '') ? '; Secure' : '';
    res.setHeader('set-cookie', `${cookieName}=${pass}; Path=/s/${token}; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}${secure}`);
    return json(res, { ok: true });
  }
  if (!unlocked) fail(401, 'This link needs a password');

  const cfg = await loadConfig();
  const driveRoot = driveDir(cfg, await loadStatus(), l.drive) || fail(503, 'The drive this is on is offline right now. Try again later.');
  const base = resolve(driveRoot, ...l.dpath.split('/'));
  if (!existsSync(base)) fail(404, 'This item no longer exists');
  const parts = String(url.searchParams.get('path') || '')
    .split('/')
    .filter(Boolean);
  if (parts.some((p) => /[:\x00-\x1f]/.test(p) || p === '..' || HIDDEN.test(p)) || (!l.isDir && parts.length)) fail(400, 'Bad path');
  const target = resolve(base, ...parts);
  if (!inside(base, target)) fail(400, 'Bad path');
  const who = { username: `link by ${l.createdBy}` };
  const transfer = (action, bytes) => logTransfer(req, who, action, { name: 'Share link' }, [l.name, ...parts].join('/'), bytes);

  if (action === 'list') {
    if (!l.isDir) fail(400, 'Not a folder');
    return json(res, await listDir(target));
  }
  if (action === 'thumb') return thumb(res, target);
  if (action === 'preview' && AUDIO_PREVIEW[extname(target).toLowerCase()])
    return stream(req, res, new URLSearchParams(), await audioPreviewFile(target));
  if (action === 'preview') return thumb(res, target, 2400); // lighter images, and PSD / TIFF which browsers can't show
  if (action === 'zip') {
    if (!l.download || !l.isDir) fail(403, 'Downloads are turned off for this link');
    l.downloads++;
    saved();
    return zipFolder(res, target, basename(target), transfer);
  }
  if (action === 'file') {
    const q = url.searchParams;
    const inlineOk = SAFE_INLINE.test(MIME[extname(target).toLowerCase()] || '');
    if ((q.has('download') || !inlineOk) && !l.download) fail(403, 'Downloads are turned off for this link');
    if (q.has('download') && !/^bytes=[1-9]/.test(req.headers.range || '')) {
      l.downloads++;
      saved();
    }
    return stream(req, res, q, target, transfer);
  }
  fail(404, 'Not found');
}

// ── /api/tracks: releases (album / EP / single) and their track pages — data/tracks.json ──
// A track points at files in the spaces (current bounce, project folder, stems folder) rather than holding
// them, so playing or opening them still goes through the normal space rights. Releases are open to every
// member unless `members` lists who may see them (owner + admins always can), like boards.
const TRACK_STATUSES = ['Idea', 'Writing', 'Recording', 'Mixing', 'Mastering', 'Done'];
const RELEASE_KINDS = ['Album', 'EP', 'Single'];
// A song's BMI work-registration sheet (and split sheet): only the song's team sees it, never public pages.
// Identifiers are checked for shape here; shares adding up to 100% is checked in the app (drafts may not yet).
const PROS = ['BMI', 'ASCAP', 'SESAC', 'GMR', 'SOCAN', 'PRS', 'Other', 'None'];
/** A release's usual songwriters (names, PRO, IPIs...), the starting point for each song's BMI sheet. */
const releaseWriters = (list) => cleanBmi({ writers: Array.isArray(list) ? list.filter((w) => String(w?.name ?? '').trim()) : [] }).writers;
function cleanBmi(v) {
  if (v === null) return null;
  const s = (x, max) =>
    String(x ?? '')
      .trim()
      .slice(0, max);
  const digits = (x, what) => {
    const d = s(x, 20).replace(/\D/g, '');
    if (d && !/^\d{9,11}$/.test(d)) fail(400, `${what} IPI numbers are 9 to 11 digits`);
    return d;
  };
  const isrc = s(v?.isrc, 20).toUpperCase().replace(/-/g, '');
  if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) fail(400, 'ISRCs look like US-ABC-26-00001');
  const iswc = s(v?.iswc, 20)
    .toUpperCase()
    .replace(/[^T\d]/g, '');
  if (iswc && !/^T\d{10}$/.test(iswc)) fail(400, 'ISWCs look like T-123.456.789-0');
  const workId = s(v?.workId, 20).replace(/\D/g, '');
  return {
    altTitle: s(v?.altTitle, 120),
    artist: s(v?.artist, 120),
    duration: /^\d{1,2}:\d{2}$/.test(s(v?.duration, 8)) ? s(v.duration, 8) : '',
    isrc,
    iswc: iswc && `T-${iswc.slice(1, 4)}.${iswc.slice(4, 7)}.${iswc.slice(7, 10)}-${iswc.slice(10)}`,
    samples: s(v?.samples, 1000),
    workId,
    registered: v?.registered ? dateOrNull(v.registered) : null,
    writers: (Array.isArray(v?.writers) ? v.writers : []).slice(0, 12).map((w) => ({
      name: s(w?.name, 80),
      pro: PROS.includes(w?.pro) ? w.pro : 'BMI',
      ipi: digits(w?.ipi, 'Writer'),
      share: Math.round(Math.max(0, Math.min(100, Number(w?.share) || 0)) * 100) / 100,
      publisher: s(w?.publisher, 80),
      publisherIpi: digits(w?.publisherIpi, 'Publisher'),
    })),
  };
}

// ── The label side: a release's UPC and readiness; per song explicit flag, registrations, master splits ──
// The composition (songwriters, BMI sheet) and the recording (the master: artist, producers, label) are separate
// rights with separate splits. Master splits are signed off in the app by the members on them; a sign-off holds a
// hash of the splits it agreed to, so changing the splits leaves the old sign-offs visibly out of date.
const REGISTRATIONS = ['mlc', 'soundexchange', 'contentId']; // BMI is on the BMI sheet
const MASTER_ROLES = ['Artist', 'Featured artist', 'Producer', 'Co-producer', 'Engineer', 'Label', 'Other'];
/** UPC-A (12 digits) or EAN-13, with a correct check digit, or '' for none. */
function upcOrEmpty(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (!/^\d{12,13}$/.test(d)) fail(400, 'UPCs are 12 digits (EANs 13)');
  const n = d.padStart(13, '0').split('').map(Number);
  const sum = n.slice(0, 12).reduce((t, x, i) => t + x * (i % 2 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== n[12]) fail(400, "That UPC's last digit doesn't check out: look for a typo");
  return d;
}
const cents = (x) => Math.round(Math.max(0, Math.min(100, Number(x) || 0)) * 100) / 100;
const shareSum = (rows = []) => Math.round(rows.reduce((t, r) => t + (Number(r.share) || 0), 0) * 100) / 100;
function cleanMaster(list) {
  const splits = (Array.isArray(list) ? list : [])
    .slice(0, 16)
    .map((x) => ({
      name: String(x?.name ?? '')
        .trim()
        .slice(0, 80),
      role: MASTER_ROLES.includes(x?.role) ? x.role : 'Other',
      share: cents(x?.share),
      member: /^[\w.-]{1,64}$/.test(x?.member || '') ? x.member : '', // their Sanktuary account, if they have one
    }))
    .filter((x) => x.name);
  return { splits, hash: createHash('sha1').update(JSON.stringify(splits)).digest('hex').slice(0, 16) };
}
/** Members on the master split who haven't signed off on the splits as they are now. */
const unsigned = (t) =>
  (t.master?.splits || []).filter(
    (x) => x.member && !(t.master.signoffs || []).some((s) => s.user === x.member && s.hash === t.master.hash),
  );

/** Everything a release needs before it goes to the distributor, and the registrations to do once it's out. */
async function releaseReadiness(db, r) {
  const checks = [];
  // step: which part of the release it belongs to (Studio's guided strip); track: the song to open
  const add = (ok, text, step, t = null, later = false) =>
    checks.push({ ok: !!ok, text, step, song: t && `${t.n}. ${t.title}`, track: t?.id || null, later });
  add(r.artist, 'Artist name', 'artist');
  add(r.date, 'Release date', 'artist');
  add(r.upc, 'UPC (your distributor gives you one)', 'artwork');
  const cover = await releaseFile(r.cover);
  const m =
    cover &&
    (await sharp(cover)
      .metadata()
      .catch(() => null));
  add(
    m && m.width >= 3000 && m.width === m.height,
    !r.cover
      ? 'Cover art, 3000 × 3000 px'
      : m
        ? `Cover art 3000 × 3000 square (this one is ${m.width} × ${m.height})`
        : 'Cover art that can be read',
    'artwork',
  );
  const tracks = Object.values(db.tracks)
    .filter((t) => t.release === r.id && !t.deleted)
    .sort((a, b) => a.n - b.n);
  add(tracks.length, 'At least one song', 'songs');
  const out = !!r.date && r.date <= new Date().toISOString().slice(0, 10);
  for (const t of tracks) {
    const isrc = t.bmi?.isrc;
    const clash = isrc && Object.values(db.tracks).find((o) => o !== t && !o.deleted && o.bmi?.isrc === isrc);
    add(t.bounce, 'Master audio chosen', 'songs', t);
    add(isrc && !clash, clash ? `ISRC ${isrc} is also on "${clash.title}": each recording needs its own` : 'ISRC', 'credits', t);
    add(t.explicit !== undefined && t.explicit !== null, 'Explicit or clean marked', 'credits', t);
    add(t.bmi?.writers?.length && shareSum(t.bmi.writers) === 100, 'Songwriter splits add up to 100% (BMI sheet)', 'splits', t);
    add(t.master?.splits?.length && shareSum(t.master.splits) === 100, 'Master splits add up to 100%', 'splits', t);
    const waiting = unsigned(t);
    add(
      t.master?.splits?.length && !waiting.length,
      waiting.length ? `Master split sign-off from ${waiting.map((x) => x.name).join(', ')}` : 'Master splits signed off',
      'splits',
      t,
    );
    // Once it's out: the registrations that collect money DSP payouts don't include
    add(t.bmi?.workId || t.bmi?.registered, 'Registered with BMI', 'register', t, true);
    add(t.regs?.mlc, 'Registered with The MLC (mechanicals)', 'register', t, true);
    add(t.regs?.soundexchange, 'Registered with SoundExchange (digital radio)', 'register', t, true);
    add(t.regs?.contentId, 'YouTube Content ID set up (through your distributor)', 'register', t, true);
  }
  const now = checks.filter((c) => !c.later);
  return { checks, ready: now.filter((c) => c.ok).length, of: now.length, out };
}

const TRACK_TEXT = { title: 80, bpm: 10, key: 20, credits: 2000, notes: 4000 };
const TRACK_LINKS = ['bandlab', 'untitled', 'soundcloud', 'other'];
let tracksDb = null;
let tracksSaved = Promise.resolve();
const loadTracks = async () => (tracksDb ??= await readJson('tracks.json', { releases: {}, tracks: {} }));
const saveTracks = () => (tracksSaved = tracksSaved.then(() => saveJson('tracks.json', tracksDb)).catch(console.error));
const canSeeRelease = (user, r) =>
  !r.deleted && (!r.members || user.admin || r.owner === user.username || r.members.includes(user.username));
const fileRef = (v) =>
  v === null
    ? null
    : v && typeof v.space === 'string' && typeof v.path === 'string' && !v.path.split('/').includes('..')
      ? { space: v.space.slice(0, 64), path: v.path.slice(0, 500) }
      : fail(400, 'Bad file link');
/** Today as YYYY-MM-DD in the server's own time zone (the home PC's), not UTC, so evening dates don't jump a day. */
const localDate = (d = new Date()) => d.toLocaleDateString('en-CA');
const dateOrNull = (v) => (v === null || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail(400, 'Dates look like 2027-06-01'));

async function tracksApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const db = await loadTracks();
  const [, , , what, id] = url.pathname.split('/'); // /api/tracks/<release|track>/<id>
  const me = user.username;
  const changed = (release) => {
    saveTracks();
    emit('tracks', { release: release.id }, (u) =>
      canSeeRelease({ username: u.username, admin: cfg.admins.includes(u.username) }, release),
    );
  };

  if (req.method === 'GET' && !what) {
    const releases = Object.values(db.releases)
      .filter((r) => canSeeRelease(user, r))
      .map(({ folderKey, ...r }) => r); // folderKey: internal (drive id + path)
    const ids = new Set(releases.map((r) => r.id));
    const tracks = Object.values(db.tracks)
      .filter((t) => !t.deleted && ids.has(t.release))
      .map((t) => ({ ...t, following: t.followers.includes(me), followers: t.followers.length }));
    return json(res, { releases, tracks, statuses: TRACK_STATUSES, kinds: RELEASE_KINDS });
  }

  if (what === 'release') {
    if (req.method === 'POST' && !id) {
      const input = await jsonBody(req);
      const title =
        String(input.title || '')
          .trim()
          .slice(0, 80) || fail(400, 'Give the release a title');
      const r = {
        id: randomUUID().slice(0, 10),
        title,
        kind: RELEASE_KINDS.includes(input.kind) ? input.kind : 'Album',
        date: dateOrNull(input.date ?? null),
        // Asked first when a release is made; every song's BMI sheet starts from these
        artist: String(input.artist ?? '')
          .trim()
          .slice(0, 120),
        writers: releaseWriters(input.writers),
        cover: null,
        members: null,
        owner: me,
        created: new Date().toISOString(),
      };
      // Optional folder: an existing one to read from, or (setup) a new one with Bounces / Stems / Projects / Artwork
      if (input.folder) await linkReleaseFolder(r, input.folder, user, cfg, !!input.setup);
      db.releases[r.id] = r;
      const found = r.folder ? await scanRelease(r, me) : null;
      changed(r);
      return json(res, { ...r, folderKey: undefined, found });
    }
    const r = (own(db.releases, id) && canSeeRelease(user, db.releases[id]) && db.releases[id]) || fail(404, 'No such release');
    if (req.method === 'GET' && url.searchParams.has('ready')) return json(res, await releaseReadiness(db, r));
    if (req.method === 'POST' && url.searchParams.has('scan')) {
      if (!r.folder) fail(400, 'Link the release to a folder first');
      await releaseSpace(r.folder.space, user, cfg); // still allowed to see that folder?
      const found = await scanRelease(r, me);
      changed(r);
      return json(res, found);
    }
    if (req.method === 'PATCH') {
      const input = await jsonBody(req);
      if (input.folder !== undefined) {
        if (r.owner !== me && !user.admin) fail(403, 'Only whoever made the release or an admin can change its folder');
        if (input.folder === null) r.folder = r.folderKey = null;
        else await linkReleaseFolder(r, input.folder, user, cfg, !!input.setup);
      }
      if (input.title !== undefined) r.title = String(input.title).trim().slice(0, 80) || r.title;
      if (input.kind !== undefined) r.kind = RELEASE_KINDS.includes(input.kind) ? input.kind : fail(400, 'Bad kind');
      if (input.date !== undefined) r.date = dateOrNull(input.date);
      if (input.cover !== undefined) r.cover = fileRef(input.cover);
      if (input.public !== undefined) r.public = !!input.public; // announced on the public Welcome window (title, kind, date)
      if (r.public) giveSlug(db, r);
      if (input.blurb !== undefined) r.blurb = String(input.blurb ?? '').slice(0, 3000);
      if (input.artist !== undefined)
        r.artist = String(input.artist ?? '')
          .trim()
          .slice(0, 120);
      if (input.writers !== undefined) r.writers = releaseWriters(input.writers);
      if (input.upc !== undefined) r.upc = upcOrEmpty(input.upc);
      if (input.stores !== undefined) {
        const stores = {};
        for (const k of RELEASE_STORES) {
          const v = String(input.stores?.[k] ?? '').trim();
          if (!v) continue;
          if (!/^https:\/\/[^\s"<>]{3,500}$/.test(v)) fail(400, 'Store links must be full https:// links');
          stores[k] = v;
        }
        r.stores = stores;
      }
      if (input.pageUntil !== undefined) r.pageUntil = dateOrNull(input.pageUntil);
      if (input.video !== undefined)
        r.videoId = input.video
          ? youtubeId(input.video) || fail(400, 'Paste a YouTube link (youtube.com/watch?v=... or youtu.be/...)')
          : null;
      if (input.story !== undefined) r.story = input.story ? String(input.story).slice(0, 80) : null; // a Story as its visual world
      if (input.members !== undefined) {
        if (r.owner !== me && !user.admin) fail(403, 'Only whoever made the release or an admin can change who sees it');
        r.members = Array.isArray(input.members) ? [...new Set(input.members.map(String).filter((u) => /^[\w.-]{1,64}$/.test(u)))] : null;
      }
      const found = input.folder ? await scanRelease(r, me) : null;
      changed(r);
      return json(res, { ...r, folderKey: undefined, found });
    }
    if (req.method === 'DELETE') {
      if (r.owner !== me && !user.admin) fail(403, 'Only whoever made the release or an admin can delete it');
      r.deleted = new Date().toISOString(); // kept in the file, just hidden: recoverable
      changed(r);
      return json(res, { ok: true });
    }
  }

  if (what === 'track') {
    if (req.method === 'POST' && !id) {
      const input = await jsonBody(req);
      const r =
        (own(db.releases, input.release) && canSeeRelease(user, db.releases[input.release]) && db.releases[input.release]) ||
        fail(404, 'No such release');
      const t = newTrack(db, r, input.title, me, 'added the track');
      changed(r);
      return json(res, t);
    }
    const t = own(db.tracks, id);
    const r =
      (t && !t.deleted && own(db.releases, t.release) && canSeeRelease(user, db.releases[t.release]) && db.releases[t.release]) ||
      fail(404, 'No such track');
    if (req.method === 'POST' && url.searchParams.has('signoff')) {
      // "I agree to these master splits": only the members on the split, only for splits that add up
      if (!t.master?.splits?.some((x) => x.member === me)) fail(403, "You're not on this song's master split");
      if (shareSum(t.master.splits) !== 100) fail(400, 'The master splits need to add up to 100% first');
      const at = new Date().toISOString();
      t.master.signoffs = [...(t.master.signoffs || []).filter((x) => x.user !== me), { user: me, at, hash: t.master.hash }];
      t.history = [{ at, user: me, action: 'signed off on the master splits' }, ...t.history].slice(0, 100);
      changed(r);
      return json(res, { ...t, following: t.followers.includes(me), followers: t.followers.length });
    }
    if (req.method === 'PATCH') {
      const input = await jsonBody(req);
      const log = (action) => (t.history = [{ at: new Date().toISOString(), user: me, action }, ...t.history].slice(0, 100));
      const news = [];
      for (const [k, max] of Object.entries(TRACK_TEXT)) if (input[k] !== undefined) t[k] = String(input[k] ?? '').slice(0, max);
      if (input.bmi !== undefined) {
        t.bmi = cleanBmi(input.bmi);
        log('updated the BMI sheet');
      }
      if (input.explicit !== undefined) t.explicit = input.explicit === null ? null : !!input.explicit;
      if (input.regs !== undefined)
        t.regs = Object.fromEntries(REGISTRATIONS.map((k) => [k, input.regs?.[k] ? dateOrNull(input.regs[k]) : null]).filter(([, v]) => v));
      if (input.master !== undefined) {
        const next = cleanMaster(input.master);
        if (next.hash !== t.master?.hash) {
          t.master = { ...next, signoffs: t.master?.signoffs || [] }; // old sign-offs stay, marked out of date by the hash
          log('changed the master splits');
        }
      }
      if (input.onPage !== undefined) t.onPage = !!input.onPage; // shown on the release's public page (title, credits, links)
      if (input.previewAt !== undefined)
        // 30 seconds of the bounce from here are public on that page (null: no preview); never the whole bounce
        t.previewAt = input.previewAt === null ? null : Math.max(0, Math.min(3600, Math.round(Number(input.previewAt)) || 0));
      if (input.n !== undefined) t.n = Math.max(1, Math.min(99, Number(input.n) || t.n));
      if (input.deadline !== undefined) {
        t.deadline = dateOrNull(input.deadline);
        t.alerted = null;
        log(t.deadline ? `set the deadline to ${t.deadline}` : 'cleared the deadline');
      }
      if (input.status !== undefined && input.status !== t.status) {
        t.status = TRACK_STATUSES.includes(input.status) ? input.status : fail(400, 'Bad status');
        log(`moved it to ${t.status}`);
        news.push(`${t.title} is now "${t.status}" (${me}).`);
      }
      for (const k of ['bounce', 'project', 'stems'])
        if (input[k] !== undefined) {
          t[k] = fileRef(input[k]);
          log(t[k] ? `set the ${k} to ${t[k].path}` : `removed the ${k}`);
          if (k === 'bounce' && t[k]) news.push(`New bounce of ${t.title}: ${t[k].path.split('/').pop()} (${me}).`);
        }
      if (input.links !== undefined) {
        for (const k of TRACK_LINKS) {
          const v = String(input.links?.[k] ?? '').trim();
          if (v && !/^https:\/\//i.test(v)) fail(400, 'Links must start with https://');
          if (v) t.links[k] = v.slice(0, 300);
          else delete t.links[k];
        }
      }
      if (input.follow !== undefined) t.followers = t.followers.filter((u) => u !== me).concat(input.follow ? [me] : []);
      t.updated = new Date().toISOString();
      t.updatedBy = me;
      changed(r);
      for (const text of news) for (const u of t.followers) if (u !== me) await notify(u, text, { track: t.id });
      if (input.deadline) await trackDeadlines(); // a deadline set 1-3 days out warns right away
      return json(res, { ...t, following: t.followers.includes(me), followers: t.followers.length });
    }
    if (req.method === 'DELETE') {
      if (r.owner !== me && !user.admin) fail(403, 'Only whoever made the release or an admin can remove tracks');
      t.deleted = new Date().toISOString();
      changed(r);
      return json(res, { ok: true });
    }
  }
  fail(404, 'Unknown tracks action');
}

function newTrack(db, r, title, by, action) {
  const live = Object.values(db.tracks).filter((t) => t.release === r.id && !t.deleted);
  const n = live.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  const now = new Date().toISOString();
  const t = {
    id: randomUUID().slice(0, 10),
    release: r.id,
    n,
    title:
      String(title || '')
        .trim()
        .slice(0, 80) || `Track ${n}`,
    status: 'Idea',
    bpm: '',
    key: '',
    credits: '',
    notes: '',
    deadline: null,
    bounce: null,
    project: null,
    stems: null,
    links: {},
    followers: [by],
    history: [{ at: now, user: by, action }],
    updated: now,
    updatedBy: by,
  };
  db.tracks[t.id] = t;
  return t;
}

// ── Release folders: the files fill Tracks in ──
// A release can point at a folder in a team space. Scanning it (when it's linked, on "Scan folder", and a few
// seconds after anyone uploads, moves or renames something into it) turns audio files into tracks
// ("03 Summer I Missed You v4.wav" -> track 3 "Summer I Missed You", that file as the current bounce; a v5 later
// becomes the new current bounce and followers hear about it), links project folders and stems whose names match a
// song, reads the BPM from Ableton sets, and uses an image in Artwork as the cover. A scan only fills what's empty
// or what an earlier scan set from inside the folder, so nothing picked by hand is replaced. Personal spaces can't
// be used: "me" is a different folder for every member.
const RELEASE_SUBFOLDERS = ['Bounces', 'Stems', 'Projects', 'Artwork'];
const BOUNCE_EXT = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.ogg']);
const LOSSLESS_EXT = new Set(['.wav', '.aif', '.aiff', '.flac']);
const ART_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.psd', '.ai']);
const SONG_NOISE = new Set(
  'master mastered mix mixed mixdown bounce bounced final rough demo wip ref reference project stems stem version v'.split(' '),
);
const SONG_VARIANT = /\b(?:instrumental|inst|a ?capp?ella|acc?apella|clean|tv track|radio edit|sped up|slowed)\b/gi;
const SCAN_LIMIT = 4000; // entries walked per scan
const WINDOWS_NAME = /^[^<>:"|?*\\/\x00-\x1f]+$/;

/** "03 - Summer I Missed You (v4) master.wav" -> { key: "summer i missed you", title, n: 3, version: 4, variant } */
function songName(name, isFile = true) {
  let base = isFile ? name.slice(0, name.length - extname(name).length) : name;
  const n = Number(base.match(/^(\d{1,2})(?=[\s._)-])/)?.[1]) || null;
  base = base.replace(/^\d{1,2}[\s._)-]+/, '');
  const version = Number(base.match(/(?:^|[^a-z])v(?:ersion)?[\s._]*(\d{1,3})(?!\d)/i)?.[1]) || 0;
  const plain = base.replace(/_/g, ' ');
  const variant = new RegExp(SONG_VARIANT.source, 'i').test(plain);
  const words = plain
    .replace(SONG_VARIANT, ' ')
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);
  const kept = words.filter((w, i) => {
    const l = w.toLowerCase();
    if (SONG_NOISE.has(l) || /^v\d{1,3}$/.test(l) || /^\d{6,8}$/.test(l)) return false; // noise, v4, 20260924
    return !(/^\d{1,3}$/.test(l) && /^(v|version)$/i.test(words[i - 1] || '')); // the 4 of "version 4"
  });
  return { key: kept.join(' ').toLowerCase(), title: kept.join(' ').slice(0, 80), n, version, variant };
}

/** The BPM an Ableton set was saved at ("" if it can't be read). */
async function alsTempo(file) {
  try {
    if ((await stat(file)).size > 50 * 1024 ** 2) return '';
    const raw = await readFile(file);
    const xml = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: 512 * 1024 ** 2 }) : raw).toString('utf8');
    const v = Number(xml.match(/<Tempo>[\s\S]{0,2000}?<Manual Value="([\d.]+)"/)?.[1]);
    return v > 20 && v < 999 ? String(Math.round(v * 100) / 100) : '';
  } catch {
    return '';
  }
}

/** The member's view of a team space for a release folder: needs `level` rights there. */
async function releaseSpace(spaceId, user, cfg, level = 'view') {
  if (spaceId === 'me') fail(400, 'Use a team space for a release folder (My Space looks different to everyone else)');
  const space = spacesFor(user, cfg, await loadStatus()).find((s) => s.id === spaceId) || fail(404, 'No such space');
  if (!space.online) fail(503, 'Drive offline');
  if (RANK[space.rights] < RANK[level]) fail(403, `You need ${level} rights in ${space.name}`);
  return space;
}

async function linkReleaseFolder(r, ref, user, cfg, setup) {
  const f = fileRef(ref) || fail(400, 'Pick a folder');
  const space = await releaseSpace(f.space, user, cfg, setup ? 'upload' : 'view');
  const { root, abs } = locateIn(space, f.path);
  if (setup) {
    if (abs === root) fail(400, 'Pick a folder inside the space');
    if (f.path.split('/').some((p) => p && (!WINDOWS_NAME.test(p) || /[. ]$/.test(p))))
      fail(400, 'Folder names can\'t use < > : " | ? * or end in a dot');
    await assertUnlocked(space, abs, user.username);
    for (const d of [abs, ...RELEASE_SUBFOLDERS.map((n) => join(abs, n))])
      if (!existsSync(d)) {
        await mkdir(d, { recursive: true });
        await setOwner(space, d, user);
      }
    forgetSizes();
  } else if (!(await stat(abs).catch(() => null))?.isDirectory()) fail(404, 'No such folder');
  r.folder = { space: f.space, path: relative(root, abs).split(sep).join('/') };
  r.folderKey = ownerKey(space, abs);
}

const scanning = new Map(); // release id -> running scan (one at a time per release)
function scanRelease(r, by) {
  const run = (scanning.get(r.id) || Promise.resolve()).then(() => scanReleaseNow(r, by));
  const tail = run.catch(() => {});
  scanning.set(r.id, tail);
  tail.then(() => scanning.get(r.id) === tail && scanning.delete(r.id));
  return run;
}

async function scanReleaseNow(r, by) {
  const found = { added: [], bounces: [], projects: 0, stems: 0, bpm: 0, cover: false, skipped: 0 };
  const cfg = await loadConfig();
  // The folder is read as the server (not as whoever triggered the scan); what members then open from a track
  // still goes through their own space rights.
  const space = spacesFor({ username: '', admin: true }, cfg, await loadStatus()).find((s) => s.id === r.folder?.space);
  if (!space?.online || space.id === 'me') return { ...found, offline: true };
  const { abs: dir } = locateIn(space, r.folder.path);

  const bounces = []; // { rel, name, mtime }
  const projects = []; // { rel, keys: Set, als: [abs] }
  const stems = []; // { rel, key }
  const art = []; // rel
  let walked = 0;
  const walk = async (d, rel, depth, zone) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (++walked > SCAN_LIMIT) return;
      if (HIDDEN.test(e.name)) continue;
      const abs = join(d, e.name);
      const r2 = rel ? `${rel}/${e.name}` : e.name;
      const ext = extname(e.name).toLowerCase();
      if (e.isDirectory()) {
        if (/^(samples|backup|ableton project info)$/i.test(e.name)) continue;
        const kind = await projectKind(abs, true);
        if (kind) {
          const inner = (await readdir(abs).catch(() => [])).filter((n) => PROJECT_FILES[extname(n).toLowerCase()]);
          const keys = new Set([songName(e.name, false).key, ...inner.map((n) => songName(n).key)].filter(Boolean));
          projects.push({ rel: r2, keys, als: inner.filter((n) => /\.als$/i.test(n)).map((n) => join(abs, n)) });
          continue;
        }
        const isStems = /\bstems?\b/i.test(e.name);
        if (zone === 'stems-list' || (isStems && songName(e.name, false).key)) {
          stems.push({ rel: r2, key: songName(e.name, false).key }); // "Stems/Summer" or "Summer Stems"
          continue;
        }
        const next = isStems
          ? 'stems-list'
          : /^projects?$/i.test(e.name)
            ? 'projects'
            : /^(artwork|art|covers?|visuals?|photos?)$/i.test(e.name)
              ? 'art'
              : zone;
        if (depth < 4) await walk(abs, r2, depth + 1, next);
        continue;
      }
      if (zone === 'stems-list' && ext === '.zip') stems.push({ rel: r2, key: songName(e.name).key });
      else if (zone === 'art' && ART_EXT.has(ext)) art.push(r2);
      else if (zone === 'bounces' && BOUNCE_EXT.has(ext)) {
        const s = await stat(abs).catch(() => null);
        if (s) bounces.push({ rel: r2, name: e.name, mtime: s.mtimeMs });
      }
    }
  };
  await walk(dir, '', 0, 'bounces');
  if (walked > SCAN_LIMIT) found.skipped = walked - SCAN_LIMIT;

  const ref = (rel) => ({ space: r.folder.space, path: [r.folder.path, rel].filter(Boolean).join('/') });
  const fromFolder = (x) => !!x && x.space === r.folder.space && (!r.folder.path || x.path.startsWith(r.folder.path + '/'));
  const songs = new Map(); // key -> { title, n, files }
  for (const b of bounces) {
    const s = songName(b.name);
    if (!s.key) continue;
    const g = songs.get(s.key) || { title: s.title, n: s.n, files: [] };
    g.n ??= s.n;
    g.files.push({ ...b, ...s });
    songs.set(s.key, g);
  }

  const db = await loadTracks();
  const live = () => Object.values(db.tracks).filter((t) => t.release === r.id && !t.deleted);
  const byKey = new Map(live().map((t) => [songName(t.title, false).key, t]));
  const byBounce = new Map(live().flatMap((t) => (t.bounce ? [[`${t.bounce.space}|${t.bounce.path}`, t]] : [])));
  const now = new Date().toISOString();
  const log = (t, action) => {
    t.history = [{ at: now, user: by, action }, ...t.history].slice(0, 100);
    t.updated = now;
    t.updatedBy = by;
  };
  const news = [];
  const ordered = [...songs.entries()].sort(([, a], [, b]) => (a.n ?? 99) - (b.n ?? 99) || a.title.localeCompare(b.title));
  for (const [key, g] of ordered) {
    // A track whose bounce is one of these files owns the song, whatever its title ("sn_final3.wav" picked for
    // "Summer Nights" keeps getting its newer versions instead of becoming a track called "sn").
    let t = g.files.map((f) => byBounce.get(`${r.folder.space}|${ref(f.rel).path}`)).find(Boolean) || byKey.get(key);
    if (!t) {
      t = newTrack(db, r, g.title, by, 'added it from the release folder');
      if (g.n && !live().some((x) => x !== t && x.n === g.n)) t.n = g.n;
      byKey.set(key, t);
      found.added.push(t.title);
    }
    const best = g.files.sort(
      (a, b) =>
        a.variant - b.variant ||
        b.version - a.version ||
        b.mtime - a.mtime ||
        LOSSLESS_EXT.has(extname(b.name).toLowerCase()) - LOSSLESS_EXT.has(extname(a.name).toLowerCase()),
    )[0];
    const next = ref(best.rel);
    if ((!t.bounce || fromFolder(t.bounce)) && t.bounce?.path !== next.path) {
      const first = !t.bounce;
      t.bounce = next;
      log(t, `set the bounce to ${next.path} (from the release folder)`);
      found.bounces.push(best.name);
      if (!first) news.push([t, `New bounce of ${t.title}: ${best.name} (${by}).`]);
    }
  }
  for (const t of live()) {
    const key = songName(t.title, false).key;
    if (!key) continue;
    const p = projects.find((x) => x.keys.has(key));
    if (p && !t.project) {
      t.project = ref(p.rel);
      log(t, `linked the project ${p.rel.split('/').pop()}`);
      found.projects++;
    }
    if (p && !t.bpm && p.als.length) {
      const set = p.als.find((f) => songName(basename(f)).key === key) || p.als[0];
      const bpm = await alsTempo(set);
      if (bpm) {
        t.bpm = bpm;
        log(t, `read ${bpm} BPM from ${basename(set)}`);
        found.bpm++;
      }
    }
    const s = stems.find((x) => x.key === key);
    if (s && !t.stems) {
      t.stems = ref(s.rel);
      log(t, `linked the stems ${s.rel.split('/').pop()}`);
      found.stems++;
    }
  }
  if (!r.cover && art.length) {
    r.cover = ref(art.find((a) => /cover|front|final/i.test(a.split('/').pop())) || art[0]);
    found.cover = true;
  }
  const any = found.added.length || found.bounces.length || found.projects || found.stems || found.bpm || found.cover;
  if (any) {
    saveTracks();
    emit('tracks', { release: r.id }, (u) => canSeeRelease({ username: u.username, admin: cfg.admins.includes(u.username) }, r));
  }
  for (const [t, text] of news) for (const u of t.followers) if (u !== by) await notify(u, text, { track: t.id });
  return found;
}

/** After an upload / move / rename: if it landed in a release's folder, rescan that release (debounced, so a
 * folder of 40 files is one scan). Runs in the background; the upload has already answered. */
const autoScans = new Map(); // release id -> timer
async function autoScan(space, abs, by) {
  if (space.id === 'me') return;
  const k = ownerKey(space, abs);
  for (const r of Object.values((await loadTracks()).releases)) {
    if (r.deleted || !r.folderKey || !(k + '/').startsWith(r.folderKey + '/')) continue;
    clearTimeout(autoScans.get(r.id));
    autoScans.set(
      r.id,
      setTimeout(() => {
        autoScans.delete(r.id);
        scanRelease(r, by).catch(console.error);
      }, AUTO_SCAN_MS).unref(),
    );
  }
}
const AUTO_SCAN_MS = Number(process.env.AUTO_SCAN_MS || 3000);

// ── /api/opportunities: grants, calls, gigs and jobs posted for the team — data/opportunities.json ──
// Any member posts one (link, deadline, amount, who it's for, what it asks for); everyone is told. Each member
// marks their own status (interested / applying / applied / not for me) and sees who else is going for it.
// Interested and applying members are reminded 7 days and 1 day before the deadline; deadlines show on the calendar.
const OPP_FIELDS = ['Music', 'Visual art', 'Film & video', 'Photography', 'Writing', 'Design & fashion', 'Tech', 'Any'];
const OPP_KINDS = ['Grant', 'Residency', 'Open call', 'Competition', 'Gig', 'Job', 'Other'];
const OPP_STATUSES = ['interested', 'applying', 'applied', 'no'];
const OPP_TEXT = { title: 120, org: 120, amount: 60, notes: 4000 };
const MN_STARTER = [
  [
    'Minnesota State Arts Board',
    'State of Minnesota',
    'https://www.arts.state.mn.us',
    ['Any'],
    'State grants for individual artists and arts projects across Minnesota.',
  ],
  [
    'Metropolitan Regional Arts Council',
    'MRAC (Twin Cities metro)',
    'https://mrac.org',
    ['Any'],
    'Grants for artists and community arts in the seven-county Twin Cities metro.',
  ],
  [
    'McKnight Artist Fellowships',
    'The McKnight Foundation',
    'https://www.mcknight.org',
    ['Music', 'Visual art', 'Writing', 'Photography'],
    'Fellowships for mid-career Minnesota artists, including musicians and visual artists.',
  ],
  [
    'Jerome Foundation',
    'Jerome Foundation',
    'https://www.jeromefdn.org',
    ['Any'],
    'Support for early-career artists in Minnesota and New York City.',
  ],
  [
    'Springboard for the Arts',
    'Springboard for the Arts',
    'https://springboardforthearts.org',
    ['Any'],
    'Artist resources, workshops, and emergency relief funds for Minnesota artists.',
  ],
  [
    'Forecast Public Art',
    'Forecast Public Art',
    'https://forecastpublicart.org',
    ['Visual art', 'Design & fashion'],
    'Grants and support for public art and artists working in public space.',
  ],
];
const GRANT_OUTLINE = [
  'Application checklist:',
  '- Artist statement: what you make and why (the portfolio page has it)',
  '- Project: what you will do, why now, who it is for, what changes because of it',
  '- Timeline: start, milestones, finish (the Timeline can hold them)',
  '- Budget: fees, studio, gear rental, marketing; match what the grant allows',
  '- Work samples: sanktuary.studio/portfolio (Copy portfolio link)',
  '- Bio: short and long versions',
].join('\n');
let oppsDb = null;
let oppsSaved = Promise.resolve();
const loadOpps = async () => (oppsDb ??= await readJson('opportunities.json', { items: {} }));
const saveOpps = () => (oppsSaved = oppsSaved.then(() => saveJson('opportunities.json', oppsDb)).catch(console.error));

async function opportunitiesApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const me = user.username;
  const db = await loadOpps();
  const id = url.pathname.split('/')[3];
  const view = (o) => ({ ...o, mine: o.people[me] || null });
  const changed = () => {
    saveOpps();
    emit('opportunities', {}, () => true);
  };
  const apply = (o, input) => {
    for (const [k, max] of Object.entries(OPP_TEXT))
      if (input[k] !== undefined)
        o[k] = String(input[k] ?? '')
          .trim()
          .slice(0, max);
    if (input.link !== undefined) {
      const v = String(input.link || '').trim();
      o.link = !v ? '' : /^https:\/\/\S+$/i.test(v) && v.length <= 500 ? v : fail(400, 'The link must start with https://');
    }
    if (input.deadline !== undefined) {
      o.deadline = dateOrNull(input.deadline);
      o.reminded = {};
    }
    if (input.kind !== undefined) o.kind = OPP_KINDS.includes(input.kind) ? input.kind : fail(400, 'Bad kind');
    if (input.fields !== undefined)
      o.fields = [...new Set((Array.isArray(input.fields) ? input.fields : []).filter((f) => OPP_FIELDS.includes(f)))];
  };

  if (req.method === 'GET' && !id)
    return json(res, {
      items: Object.values(db.items)
        .filter((o) => !o.archived)
        .map(view),
      fields: OPP_FIELDS,
      kinds: OPP_KINDS,
    });

  if (req.method === 'POST' && !id && url.searchParams.has('starter')) {
    // Admins: the Minnesota funders worth knowing, once each (no deadlines: they change every year)
    if (!user.admin) fail(403, 'Administrators only');
    const have = new Set(Object.values(db.items).map((o) => o.link)); // taken-down ones too: they stay down
    let added = 0;
    for (const [title, org, link, fields, what] of MN_STARTER) {
      if (have.has(link)) continue;
      const o = {
        id: randomUUID().slice(0, 10),
        title,
        org,
        amount: '',
        link,
        deadline: null,
        kind: 'Grant',
        fields,
        people: {},
        by: me,
        created: new Date().toISOString(),
      };
      o.notes = `${what}\nCheck their site for this year's programs and deadlines, then set the deadline here so the team gets reminders.\n\n${GRANT_OUTLINE}`;
      db.items[o.id] = o;
      added++;
    }
    if (added) changed();
    return json(res, { added });
  }
  if (req.method === 'POST' && !id) {
    const input = await jsonBody(req);
    const o = {
      id: randomUUID().slice(0, 10),
      title: '',
      org: '',
      amount: '',
      notes: '',
      link: '',
      deadline: null,
      kind: 'Grant',
      fields: [],
      people: {},
      by: me,
      created: new Date().toISOString(),
    };
    apply(o, input);
    if (!o.title) fail(400, 'Give it a name');
    db.items[o.id] = o;
    changed();
    // Tell the team (everyone but whoever posted it)
    const text = `New ${o.kind.toLowerCase()}: ${o.title}${o.org ? ` (${o.org})` : ''}${o.deadline ? `, due ${o.deadline}` : ''}. Posted by ${me}.`;
    for (const u of await currentMembers()) if (u !== me) await notify(u, text, { opportunity: o.id });
    return json(res, view(o));
  }

  const o = (own(db.items, id) && !db.items[id].archived && db.items[id]) || fail(404, 'No such opportunity');
  if (req.method === 'PATCH') {
    const input = await jsonBody(req);
    // Anyone sets their own status; only whoever posted it (or an admin) edits the details
    if (input.status !== undefined) {
      if (input.status === null) delete o.people[me];
      else o.people[me] = OPP_STATUSES.includes(input.status) ? input.status : fail(400, 'Bad status');
    }
    const edits = Object.keys(input).filter((k) => k !== 'status');
    if (edits.length) {
      if (o.by !== me && !user.admin) fail(403, 'Only whoever posted it or an admin can change the details');
      apply(o, input);
      if (!o.title) fail(400, 'Give it a name');
    }
    changed();
    await opportunityDeadlines(); // marked interested inside the last week: the reminder comes now
    return json(res, view(o));
  }
  if (req.method === 'DELETE') {
    if (o.by !== me && !user.admin) fail(403, 'Only whoever posted it or an admin can take it down');
    o.archived = new Date().toISOString(); // kept in the file, just hidden
    changed();
    return json(res, { ok: true });
  }
  fail(404, 'Unknown opportunities action');
}

// ── /api/outreach: who we pitch (radio, playlists, press, venues, brands) and where each pitch stands — data/outreach.json ──
// Shared by the team so two people never pitch the same curator twice. Marking one "Pitched" starts a clock: after
// 7 days with no reply, whoever pitched is reminded to follow up.
const OUT_KINDS = ['Radio', 'Playlist', 'Blog / press', 'Venue', 'Brand / sponsor', 'Other'];
const OUT_STATUSES = ['To pitch', 'Pitched', 'Replied', 'Yes', 'No'];
const OUT_TEXT = { name: 100, outlet: 120, email: 200, notes: 2000 };
let outDb = null;
let outSaved = Promise.resolve();
const loadOutreach = async () => (outDb ??= await readJson('outreach.json', { items: {} }));
const saveOutreach = () => (outSaved = outSaved.then(() => saveJson('outreach.json', outDb)).catch(console.error));

async function outreachApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const me = user.username;
  const db = await loadOutreach();
  const id = url.pathname.split('/')[3];
  const changed = () => {
    saveOutreach();
    emit('outreach', {}, () => true);
  };
  const apply = (o, input) => {
    for (const [k, max] of Object.entries(OUT_TEXT))
      if (input[k] !== undefined)
        o[k] = String(input[k] ?? '')
          .trim()
          .slice(0, max);
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) fail(400, 'That email address looks wrong');
    if (input.link !== undefined) {
      const v = String(input.link || '').trim();
      o.link = !v ? '' : /^https:\/\/\S+$/i.test(v) && v.length <= 500 ? v : fail(400, 'The link must start with https://');
    }
    if (input.kind !== undefined) o.kind = OUT_KINDS.includes(input.kind) ? input.kind : fail(400, 'Bad kind');
    if (input.status !== undefined && input.status !== o.status) {
      o.status = OUT_STATUSES.includes(input.status) ? input.status : fail(400, 'Bad status');
      if (o.status === 'Pitched') Object.assign(o, { pitchedAt: localDate(), pitchedBy: me, reminded: null });
    }
    if (input.pitchedAt !== undefined && o.status === 'Pitched') {
      // logging a pitch sent earlier: the follow-up clock starts from that day
      const d = dateOrNull(input.pitchedAt);
      if (!d || d > localDate()) fail(400, 'Pick the day it was pitched (not in the future)');
      if (d !== o.pitchedAt) Object.assign(o, { pitchedAt: d, reminded: null });
    }
  };

  if (req.method === 'GET' && !id)
    return json(res, { items: Object.values(db.items).filter((o) => !o.deleted), kinds: OUT_KINDS, statuses: OUT_STATUSES });
  if (req.method === 'POST' && !id) {
    const input = await jsonBody(req);
    const o = {
      id: randomUUID().slice(0, 10),
      name: '',
      outlet: '',
      email: '',
      link: '',
      notes: '',
      kind: 'Playlist',
      status: 'To pitch',
      pitchedAt: null,
      pitchedBy: null,
      by: me,
      created: new Date().toISOString(),
    };
    apply(o, input);
    if (!o.name && !o.outlet) fail(400, 'Give it a name or an outlet');
    db.items[o.id] = o;
    changed();
    return json(res, o);
  }
  const o = (own(db.items, id) && !db.items[id].deleted && db.items[id]) || fail(404, 'No such contact');
  if (req.method === 'PATCH') {
    const next = { ...o }; // a refused change leaves the contact as it was
    apply(next, await jsonBody(req));
    if (!next.name && !next.outlet) fail(400, 'Give it a name or an outlet');
    Object.assign(o, next, { updated: new Date().toISOString() });
    changed();
    await outreachFollowUps(); // logged a pitch from over a week ago: the reminder comes now
    return json(res, o);
  }
  if (req.method === 'DELETE') {
    if (o.by !== me && !user.admin) fail(403, 'Only whoever added it or an admin can remove it');
    o.deleted = new Date().toISOString(); // kept in the file, just hidden
    changed();
    return json(res, { ok: true });
  }
  fail(404, 'Unknown outreach action');
}

/** A pitch with no answer after 7 days: whoever sent it is reminded once to follow up. */
async function outreachFollowUps() {
  const db = await loadOutreach();
  const today = localDate();
  for (const o of Object.values(db.items)) {
    if (o.deleted || o.status !== 'Pitched' || !o.pitchedAt || o.reminded === o.pitchedAt || !o.pitchedBy) continue;
    if ((Date.parse(today) - Date.parse(o.pitchedAt)) / 864e5 < 7) continue;
    o.reminded = o.pitchedAt;
    saveOutreach();
    await notify(
      o.pitchedBy,
      `Follow up with ${o.name || o.outlet}${o.outlet && o.name ? ` (${o.outlet})` : ''}: you pitched on ${o.pitchedAt} and there's no reply yet.`,
      {},
    );
  }
}
setInterval(() => outreachFollowUps().catch(console.error), 3.6e6).unref();

/** Deadline reminders: 7 days and 1 day before, to each person interested or applying (not once they've applied).
 * Kept per person, so someone who marks it later still gets the reminder that's due. */
async function opportunityDeadlines() {
  const db = await loadOpps();
  const today = localDate();
  for (const o of Object.values(db.items)) {
    if (o.archived || !o.deadline) continue;
    const days = Math.round((Date.parse(o.deadline) - Date.parse(today)) / 864e5);
    const stage = days < 0 ? null : days <= 1 ? 'd1' : days <= 7 ? 'd7' : null;
    if (!stage) continue;
    o.reminded ??= {};
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    for (const [u, st] of Object.entries(o.people)) {
      const done = o.reminded[u];
      if (!['interested', 'applying'].includes(st) || done === `${stage}:${o.deadline}` || (stage === 'd7' && done === `d1:${o.deadline}`))
        continue;
      o.reminded[u] = `${stage}:${o.deadline}`;
      saveOpps();
      await notify(u, `${o.title} is due ${when} (${o.deadline}). You marked it "${st}".`, { opportunity: o.id });
    }
  }
}
setInterval(() => opportunityDeadlines().catch(console.error), 3.6e6).unref();

/** Deadline reminders: 3 days before and on the day before, to everyone following the track. */
async function trackDeadlines() {
  const db = await loadTracks();
  const today = localDate();
  for (const t of Object.values(db.tracks)) {
    if (t.deleted || !t.deadline || t.status === 'Done' || !db.releases[t.release] || db.releases[t.release].deleted) continue;
    const days = Math.round((Date.parse(t.deadline) - Date.parse(today)) / 864e5);
    const stage = days <= 1 ? 'd1' : days <= 3 ? 'd3' : null;
    if (!stage || t.alerted === `${stage}:${t.deadline}` || (stage === 'd3' && t.alerted === `d1:${t.deadline}`) || days < 0) continue;
    t.alerted = `${stage}:${t.deadline}`;
    const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    for (const u of t.followers) await notify(u, `${t.title} is due ${when} (${t.deadline}). Status: ${t.status}.`, { track: t.id });
    saveTracks();
  }
}
setInterval(() => trackDeadlines().catch(console.error), 3.6e6).unref();

// ── /api/timeline: visual projects and events on one calendar — data/timeline.json ──
// Shoots, artwork, videos, shows, drops... with dates, people, status and a linked folder. Release dates and
// track deadlines from Tracks are merged in (read-only) so there is one timeline for everything.
// Entries are open to every member unless `members` lists who may see them (owner + admins always can).
const TIMELINE_KINDS = ['Shoot', 'Artwork', 'Video', 'Event', 'Drop', 'Other'];
const TIMELINE_STATUSES = ['Planned', 'In progress', 'Done', 'Cancelled'];
const TIMELINE_TEXT = { title: 100, location: 200, notes: 4000 };
let timelineDb = null;
let timelineSaved = Promise.resolve();
const loadTimeline = async () => (timelineDb ??= await readJson('timeline.json', { items: {} }));
const saveTimeline = () => (timelineSaved = timelineSaved.then(() => saveJson('timeline.json', timelineDb)).catch(console.error));
const usernameList = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((u) => /^[\w.-]{1,64}$/.test(u)))].slice(0, 30);

async function timelineApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const db = await loadTimeline();
  const me = user.username;
  const id = url.pathname.split('/')[3];
  const view = (i) => ({ ...i, following: i.followers.includes(me) });
  // An entry can only be tied to a release you can see; a private release's entries get its people (else null)
  // ponytail: copied when tied; people added to the release later don't see older entries until someone re-ties them
  const releasePrivacy = async (id) => {
    const r = own((await loadTracks()).releases, String(id));
    if (!r || r.deleted || !canSeeRelease(user, r)) fail(404, 'No such release');
    return r.members ? usernameList([...r.members, r.owner]) : null;
  };
  const changed = (i) => {
    saveTimeline();
    emit('timeline', { id: i.id }, (u) => canSeeRelease({ username: u.username, admin: cfg.admins.includes(u.username) }, i));
  };

  if (req.method === 'GET' && !id) {
    const items = Object.values(db.items)
      .filter((i) => canSeeRelease(user, i))
      .map(view);
    // Dates from Tracks: release days and track deadlines, for the releases this member can see
    const tdb = await loadTracks();
    const fromTracks = [];
    for (const r of Object.values(tdb.releases))
      if (canSeeRelease(user, r) && r.date)
        fromTracks.push({
          id: `release-${r.id}`,
          source: 'tracks',
          kind: 'Release',
          title: `${r.title} (${r.kind}) out`,
          start: r.date,
          release: r.id,
        });
    for (const t of Object.values(tdb.tracks)) {
      const r = tdb.releases[t.release];
      if (!t.deleted && t.deadline && r && canSeeRelease(user, r))
        fromTracks.push({
          id: `track-${t.id}`,
          source: 'tracks',
          kind: 'Track due',
          title: `${t.title} due (${t.status})`,
          start: t.deadline,
          release: r.id,
          track: t.id,
          done: t.status === 'Done',
        });
    }
    // Opportunity deadlines too (read-only here)
    for (const o of Object.values((await loadOpps()).items))
      if (!o.archived && o.deadline)
        fromTracks.push({
          id: `opp-${o.id}`,
          source: 'opportunities',
          kind: 'Deadline',
          title: `${o.title} due (${o.kind})`,
          start: o.deadline,
          done: o.people[me] === 'applied',
        });
    return json(res, { items: [...items, ...fromTracks], kinds: TIMELINE_KINDS, statuses: TIMELINE_STATUSES });
  }

  const apply = (i, input) => {
    for (const [k, max] of Object.entries(TIMELINE_TEXT)) if (input[k] !== undefined) i[k] = String(input[k] ?? '').slice(0, max);
    if (input.kind !== undefined) i.kind = TIMELINE_KINDS.includes(input.kind) ? input.kind : fail(400, 'Bad kind');
    if (input.status !== undefined) i.status = TIMELINE_STATUSES.includes(input.status) ? input.status : fail(400, 'Bad status');
    if (input.start !== undefined) {
      i.start = dateOrNull(input.start) || fail(400, 'An entry needs a date');
      i.alerted = null;
    }
    if (input.end !== undefined) i.end = dateOrNull(input.end);
    if (input.time !== undefined)
      i.time = !input.time ? '' : /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : fail(400, 'Times look like 20:00');
    if (i.end && i.end < i.start) fail(400, "The end date can't be before the start");
    if (input.people !== undefined) i.people = usernameList(input.people);
    if (input.folder !== undefined) i.folder = fileRef(input.folder);
    if (input.release !== undefined) i.release = input.release ? String(input.release).slice(0, 20) : null;
    if (input.public !== undefined) i.public = !!input.public; // shown on the public Welcome window
    if (input.link !== undefined) {
      const v = String(input.link || '').trim();
      if (v && !/^https:\/\//i.test(v)) fail(400, 'Links must start with https://');
      i.link = v.slice(0, 300);
    }
  };

  if (req.method === 'POST' && !id) {
    const input = await jsonBody(req);
    const i = {
      id: randomUUID().slice(0, 10),
      title: '',
      kind: 'Other',
      status: 'Planned',
      start: null,
      end: null,
      time: '',
      people: [me],
      location: '',
      notes: '',
      link: '',
      folder: null,
      release: null,
      members: null,
      owner: me,
      followers: [me],
      created: new Date().toISOString(),
    };
    apply(i, input);
    i.title = i.title.trim() || fail(400, 'Give it a title');
    if (!i.start) fail(400, 'An entry needs a date');
    const m = i.release && (await releasePrivacy(i.release));
    if (m) i.members = m.filter((u) => u !== me);
    db.items[i.id] = i;
    changed(i);
    for (const u of i.people) if (u !== me) await notify(u, `${me} put you on "${i.title}" (${i.kind}, ${i.start}).`, { timeline: i.id });
    await timelineAlerts();
    return json(res, view(i));
  }

  const i = (own(db.items, id) && canSeeRelease(user, db.items[id]) && db.items[id]) || fail(404, 'No such entry');
  if (req.method === 'PATCH') {
    const input = await jsonBody(req);
    const before = { status: i.status, start: i.start, people: [...i.people] };
    if (input.members !== undefined) {
      if (i.owner !== me && !user.admin) fail(403, 'Only whoever made it or an admin can change who sees it');
      i.members = Array.isArray(input.members) ? usernameList(input.members) : null;
    }
    if (input.follow !== undefined) i.followers = i.followers.filter((u) => u !== me).concat(input.follow ? [me] : []);
    const m = input.release && (await releasePrivacy(input.release)); // checked before anything changes
    apply(i, input);
    if (m) Object.assign(i, { members: m.filter((u) => u !== i.owner), public: false }); // moved onto a private release
    changed(i);
    const told = new Set([...i.people, ...i.followers].filter((u) => u !== me));
    const news = [];
    if (i.status !== before.status) news.push(`"${i.title}" is now ${i.status} (${me}).`);
    if (i.start !== before.start) news.push(`"${i.title}" moved to ${i.start}${i.end ? ` – ${i.end}` : ''} (${me}).`);
    for (const text of news) for (const u of told) await notify(u, text, { timeline: i.id });
    for (const u of i.people)
      if (!before.people.includes(u) && u !== me)
        await notify(u, `${me} put you on "${i.title}" (${i.kind}, ${i.start}).`, { timeline: i.id });
    await timelineAlerts();
    return json(res, view(i));
  }
  if (req.method === 'DELETE') {
    if (i.owner !== me && !user.admin) fail(403, 'Only whoever made it or an admin can delete it');
    delete db.items[id];
    changed(i);
    return json(res, { ok: true });
  }
  fail(405, 'Not allowed');
}

/** Reminders 3 days before, the day before and on the day, to the people on it and its followers. */
async function timelineAlerts() {
  const db = await loadTimeline();
  const today = localDate();
  for (const i of Object.values(db.items)) {
    if (!i.start || ['Done', 'Cancelled'].includes(i.status)) continue;
    const days = Math.round((Date.parse(i.start) - Date.parse(today)) / 864e5);
    const stage = days === 0 ? 'd0' : days === 1 ? 'd1' : days <= 3 && days > 0 ? 'd3' : null;
    if (!stage || i.alerted === `${stage}:${i.start}`) continue;
    if (stage === 'd3' && i.alerted?.endsWith(`:${i.start}`)) continue; // already warned closer in
    i.alerted = `${stage}:${i.start}`;
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    for (const u of new Set([...i.people, ...i.followers]))
      await notify(u, `${i.kind}: "${i.title}" is ${when} (${i.start})${i.location ? ` at ${i.location}` : ''}.`, { timeline: i.id });
    saveTimeline();
  }
}
setInterval(() => timelineAlerts().catch(console.error), 3.6e6).unref();

// ── /api/business: the private business portal — data/business/ ──
// Clients, jobs, invoices and documents, for admins only, and only with:
//   • a real Clerk session token in the Authorization header (the long-lived site cookie isn't enough),
//   • two-step verification switched on for the account (and not skipped this session, when Clerk says so).
// Every request is written to data/business/audit.jsonl. Documents marked "vault" only open when the request
// did not come through the public Cloudflare tunnel (i.e. over Tailscale, or on the PC itself).
const BIZ = () => join(DATA, 'business');
const BIZ_KINDS = {
  clients: { text: { name: 100, company: 100, email: 200, phone: 50, notes: 4000 }, status: ['Lead', 'Active', 'Past'] },
  jobs: { text: { title: 150, notes: 4000 }, status: ['Quote', 'In progress', 'Delivered', 'Paid', 'Cancelled'] },
  invoices: { text: { notes: 2000, billTo: 500 }, status: ['Draft', 'Sent', 'Paid', 'Void'] },
};
const twoStep = new Map(); // clerk user id -> { on, at }
let bizDb = null;
let bizSaved = Promise.resolve();
const loadBiz = async () =>
  (bizDb ??= await readJson('business/business.json', { clients: {}, jobs: {}, invoices: {}, docs: {}, nextInvoice: {} }));
const saveBiz = () =>
  (bizSaved = bizSaved
    .then(() => mkdir(BIZ(), { recursive: true }).then(() => saveJson('business/business.json', bizDb)))
    .catch(console.error));
const viaTunnel = (req) => !!req.headers['cf-ray']; // Cloudflare adds this to everything it forwards
const money = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : fail(400, 'Amounts must be numbers'));

async function businessUser(req, url) {
  const cfg = await loadConfig();
  const token = req.headers.authorization?.replace(/^Bearer /, '') || fail(401, 'Sign in to open the business portal');
  let claims;
  try {
    claims = await verifyToken(token, clerkVerifyOptions());
  } catch {
    fail(401, 'Your sign-in expired. Sign in again.');
  }
  const username = await usernameOf(claims.sub);
  if (!cfg.admins.includes(username)) fail(403, 'The business portal is for admins only');
  let t = twoStep.get(claims.sub);
  if (!t || Date.now() - t.at > 5 * 60_000) {
    const r = await clerk(`/users/${claims.sub}`);
    t = { on: r.ok && !!(await r.json()).two_factor_enabled, at: Date.now() };
    twoStep.set(claims.sub, t);
  }
  if (!t.on)
    fail(428, 'Turn on two-step verification first: Account settings > Security > add an authenticator app. Then sign out and back in.');
  if (Array.isArray(claims.fva) && claims.fva[1] === -1)
    fail(428, 'Sign out and back in with your two-step code to open the business portal.');
  return { username, admin: true };
}

async function audit(req, user, action, what = '') {
  await mkdir(BIZ(), { recursive: true });
  const entry = {
    at: new Date().toISOString(),
    user: user.username,
    action,
    what,
    ip: req.headers['cf-connecting-ip'] || req.socket.remoteAddress,
    via: viaTunnel(req) ? 'internet' : 'tailscale/local',
  };
  await appendFile(join(BIZ(), 'audit.jsonl'), JSON.stringify(entry) + '\n');
}

async function businessApi(req, res, url) {
  const user = await businessUser(req, url);
  const db = await loadBiz();
  const [, , , kind, id, sub] = url.pathname.split('/'); // /api/business/<clients|jobs|invoices|docs|overview|audit>/<id>/<file>
  const me = user.username;

  if (req.method === 'GET' && kind === 'overview') {
    await audit(req, user, 'opened the portal');
    const inv = Object.values(db.invoices).filter((i) => !i.deleted);
    const total = (i) => i.items.reduce((n, it) => n + it.qty * it.rate, 0);
    const today = localDate();
    const year = today.slice(0, 4);
    return json(res, {
      owed: inv.filter((i) => i.status === 'Sent').reduce((n, i) => n + total(i), 0),
      overdue: inv
        .filter((i) => i.status === 'Sent' && i.due && i.due < today)
        .map((i) => ({ id: i.id, number: i.number, due: i.due, total: total(i), client: i.client })),
      paidThisYear: inv.filter((i) => i.status === 'Paid' && (i.paidOn || '').startsWith(year)).reduce((n, i) => n + total(i), 0),
      activeJobs: Object.values(db.jobs).filter((j) => !j.deleted && ['Quote', 'In progress', 'Delivered'].includes(j.status)).length,
      clients: Object.values(db.clients).filter((c) => !c.deleted && c.status !== 'Past').length,
      viaTunnel: viaTunnel(req),
    });
  }
  if (req.method === 'GET' && kind === 'audit') {
    const lines = (await readFile(join(BIZ(), 'audit.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
    return json(
      res,
      lines
        .slice(-300)
        .map((l) => JSON.parse(l))
        .reverse(),
    );
  }

  if (kind === 'settings') {
    // What goes at the top and bottom of an invoice
    db.settings ||= { name: '', address: '', email: '', payment: '' };
    if (req.method === 'PATCH') {
      const input = await jsonBody(req);
      for (const [k, max] of Object.entries({ name: 100, address: 500, email: 200, payment: 1000 }))
        if (input[k] !== undefined) db.settings[k] = String(input[k] ?? '').slice(0, max);
      saveBiz();
      await audit(req, user, 'changed invoice details');
    }
    return json(res, db.settings);
  }
  if (kind === 'docs') return businessDocs(req, res, url, user, db, id, sub);
  if (kind === 'revenue') return businessRevenue(req, res, url, user, db, id);
  if (kind === 'orders') {
    // Shop orders live here (not the Admin Panel) because they carry customers' names and addresses
    const shop = await loadShop();
    if (req.method === 'GET') {
      await audit(req, user, 'listed shop orders');
      return json(
        res,
        Object.values(shop.orders)
          .filter((o) => o.paid) // real money only: not open, abandoned or replaced checkouts
          .sort((a, b) => (b.paid || '').localeCompare(a.paid || '')),
      );
    }
    if (req.method === 'PATCH' && own(shop.orders, id)) {
      const { status, note } = await jsonBody(req);
      if (status !== undefined)
        shop.orders[id].status = (shop.orders[id].status === 'Oversold'
          ? ['Refunded']
          : ['Paid', 'Shipped', 'Delivered', 'Refunded']
        ).includes(status)
          ? status
          : fail(400, shop.orders[id].status === 'Oversold' ? 'An oversold order can only be marked Refunded' : 'Bad status');
      if (note !== undefined) shop.orders[id].note = String(note).slice(0, 500);
      saveShop();
      await audit(req, user, `set order ${id} to ${shop.orders[id].status}`);
      return json(res, shop.orders[id]);
    }
    fail(404, 'No such order');
  }

  const spec = own(BIZ_KINDS, kind) || fail(404, 'Unknown section');
  const coll = db[kind];
  if (req.method === 'GET' && !id) {
    await audit(req, user, `listed ${kind}`);
    return json(
      res,
      Object.values(coll).filter((x) => !x.deleted),
    );
  }
  const apply = (x, input) => {
    for (const [k, max] of Object.entries(spec.text)) if (input[k] !== undefined) x[k] = String(input[k] ?? '').slice(0, max);
    if (input.status !== undefined) x.status = spec.status.includes(input.status) ? input.status : fail(400, 'Bad status');
    if (input.client !== undefined)
      x.client = input.client && own(db.clients, input.client) ? input.client : input.client ? fail(400, 'No such client') : null;
    if (kind === 'jobs') {
      if (input.amount !== undefined) x.amount = money(input.amount || 0);
      if (input.due !== undefined) x.due = dateOrNull(input.due);
    }
    if (kind === 'invoices') {
      if (input.job !== undefined) x.job = input.job && own(db.jobs, input.job) ? input.job : null;
      for (const k of ['issued', 'due', 'paidOn']) if (input[k] !== undefined) x[k] = dateOrNull(input[k]);
      if (input.items !== undefined)
        x.items = (Array.isArray(input.items) ? input.items : []).slice(0, 50).map((it) => ({
          desc: String(it?.desc || '').slice(0, 300),
          qty: money(it?.qty ?? 1),
          rate: money(it?.rate ?? 0),
        }));
      if (x.status === 'Paid' && !x.paidOn) x.paidOn = localDate();
    }
  };

  if (req.method === 'POST' && !id) {
    const input = await jsonBody(req);
    const x = { id: randomUUID().slice(0, 10), status: spec.status[0], client: null, created: new Date().toISOString(), createdBy: me };
    for (const k of Object.keys(spec.text)) x[k] = '';
    if (kind === 'invoices') {
      // Numbered per year: INV-2026-001, INV-2026-002...
      const year = localDate().slice(0, 4);
      db.nextInvoice[year] = (db.nextInvoice[year] || 0) + 1;
      Object.assign(x, {
        number: `INV-${year}-${String(db.nextInvoice[year]).padStart(3, '0')}`,
        items: [],
        issued: localDate(),
        due: null,
        paidOn: null,
        job: null,
      });
    }
    if (kind === 'jobs') Object.assign(x, { amount: 0, due: null });
    apply(x, input);
    if (kind === 'clients' && !x.name.trim()) fail(400, 'Give the client a name');
    if (kind === 'jobs' && !x.title.trim()) fail(400, 'Give the job a title');
    coll[x.id] = x;
    saveBiz();
    await audit(req, user, `added ${kind.slice(0, -1)}`, x.name || x.title || x.number);
    return json(res, x);
  }
  const x = (own(coll, id) && !coll[id].deleted && coll[id]) || fail(404, 'Not found');
  if (req.method === 'GET') {
    await audit(req, user, `opened ${kind.slice(0, -1)}`, x.name || x.title || x.number);
    return json(res, x);
  }
  if (req.method === 'PATCH') {
    apply(x, await jsonBody(req));
    x.updated = new Date().toISOString();
    saveBiz();
    await audit(req, user, `changed ${kind.slice(0, -1)}`, x.name || x.title || x.number);
    return json(res, x);
  }
  if (req.method === 'DELETE') {
    x.deleted = new Date().toISOString(); // kept in the file, hidden: nothing here is ever really deleted
    saveBiz();
    await audit(req, user, `removed ${kind.slice(0, -1)}`, x.name || x.title || x.number);
    return json(res, { ok: true });
  }
  fail(405, 'Not allowed');
}

// ── Revenue: money in and out, per release, and net-profit statements from the master splits ──
// Lines are typed in (tickets, sponsorships, costs...) or imported from a distributor's CSV (DistroKid and most
// others: a sale month, a store, a title/ISRC and an earnings column). Paid shop orders count by themselves.
// A release's statement: its income minus its costs. Each song's earnings are shared by that song's master splits,
// money for the release as a whole (tickets, sponsorship) by the average of its songs' splits; everyone's part of
// the income is then their part of the net profit. A loss is "still to recoup": costs come out of income first.
const REV_SOURCES = {
  income: ['Streaming', 'Tickets', 'Sponsorship', 'Sync & licensing', 'Performance fees', 'Grants', 'Other'], // Shop: automatic
  cost: ['Recording', 'Mixing & mastering', 'Artwork & video', 'Marketing', 'Distribution', 'Travel', 'Equipment', 'Other'],
};
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * A CSV, semicolon or tab-separated file as rows of cells (quotes, "" escapes, newlines inside quotes, CRLF).
 * The separator is whichever of tab ; , the header row uses most (outside quotes). `rows.sep` says which.
 */
function parseCsv(text) {
  const first = text.split('\n', 1)[0].replace(/"[^"]*"/g, '');
  const count = (ch) => first.split(ch).length - 1;
  const sep = ['\t', ';', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c !== '"') f += c;
      else if (text[i + 1] === '"') ((f += '"'), i++);
      else q = false;
    } else if (c === '"') q = true;
    else if (c === sep) (row.push(f), (f = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      (row.push(f), rows.push(row), (row = []), (f = ''));
    } else f += c;
  }
  if (f || row.length) (row.push(f), rows.push(row));
  return Object.assign(
    rows.filter((r) => r.some((x) => x.trim())),
    { sep },
  );
}

/**
 * A money cell: "$1,234.56", "1.234,56", "3,50", "0,0041", "(1.50)" or "-1.50" (negative), "USD 2.00".
 * A cell with no digits ("", "-", "N/A") is 0; anything else unreadable is NaN.
 */
function parseMoney(v, decimalComma = false) {
  const n = readMoney(v, decimalComma);
  return Number.isFinite(n) && Math.abs(n) < 1e9 ? n : NaN; // "1e400" or a billion on one row is a broken file
}
function readMoney(v, decimalComma) {
  const s = String(v ?? '').trim();
  if (!/\d/.test(s)) return 0;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) && !decimalComma) return Number(s); // plain, or Excel's 4.1E-05
  // Scientific notation anywhere else ("4,1E-05" from Excel in Europe, "$4.1E-05"): read the number itself, never
  // strip the E; anything odd around it is refused rather than guessed
  const sci = s.match(/^\(?\s*([^\d\s(+-]*)\s*([-+]?)(\d+(?:[.,]\d+)?)e([-+]?\d+)\s*\)?$/i);
  if (sci) {
    if (sci[1] && !/^([a-z]{3}|[$€£¥])$/i.test(sci[1])) return NaN;
    const n = Number(`${sci[3].replace(',', '.')}e${sci[4]}`);
    return /^\(.*\)$/.test(s) || sci[2] === '-' ? -n : n;
  }
  if (/\de[-+]?\d/i.test(s)) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^[^\d]*-/.test(s) || /-[^\d]*$/.test(s); // (1.50), -1.50, $-1.50, 1.50-
  let t = s.replace(/[^\d.,]/g, '');
  // thousands only in groups of three: "1,2,3" is a mistake, not 123
  if (!(decimalComma ? /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/ : /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/).test(t)) return NaN;
  t = decimalComma ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
/**
 * Whether a file writes money with a decimal comma (1.234,56 / 3,50 / 0,0041), decided once for the whole file from
 * the cells that can only mean one thing: semicolon-separated files are European too. A file with nothing to go on
 * is read the US way (1,234.56).
 */
function decimalCommaFile(cells, sep) {
  if (sep === ';') return true;
  for (const c of cells) {
    if (/\d,\d+e[-+]?\d/i.test(c)) return true; // 4,1E-05
    if (/\de[-+]?\d/i.test(c)) continue; // 4.1E-05 says nothing about the others
    const t = String(c).replace(/[^\d.,]/g, '');
    if (/^0,\d/.test(t) || /,\d{1,2}$/.test(t) || /,\d{4,}$/.test(t) || /\.\d{3},\d/.test(t)) return true; // comma is the decimal
    if (/^0\.\d/.test(t) || /\.\d{1,2}$/.test(t) || /\.\d{4,}$/.test(t) || /,\d{3}\.\d/.test(t)) return false; // dot is the decimal
  }
  return false;
}

/** A sale month: "2026-07", "2026-07-15", "07/2026", US "7/15/2026", "Jul 2026", "July 2026". Else null. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseMonth(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  const ym = (y, m) => (+m >= 1 && +m <= 12 ? `${y}-${String(+m).padStart(2, '0')}` : null);
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})\b/))) return ym(m[1], m[2]);
  if ((m = s.match(/^(\d{1,2})\/(\d{4})\b/))) return ym(m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})\b/))) return ym(m[2], m[1]); // US distributors: month first
  if ((m = s.match(/^([a-z]{3})[a-z]*\.?[\s-]+(\d{4})\b/))) return MONTHS.includes(m[1]) ? ym(m[2], MONTHS.indexOf(m[1]) + 1) : null;
  return null;
}

/** One song's master splits if they add up to exactly 100%, else null. */
const songSplits = (t) => {
  const s = (t?.master?.splits || []).filter((x) => String(x.name || '').trim());
  const total = s.reduce((n, x) => n + (Number(x.share) || 0), 0);
  return s.length && Math.abs(total - 100) < 0.01 ? s.map((x) => ({ name: String(x.name).trim(), share: Number(x.share) || 0 })) : null;
};
/** A release's splits: the average of its songs' complete splits ([] if none have any). */
function releaseSplits(tdb, releaseId) {
  const all = Object.values(tdb.tracks)
    .filter((t) => t.release === releaseId && !t.deleted)
    .map(songSplits)
    .filter(Boolean);
  const by = new Map();
  for (const splits of all) for (const s of splits) by.set(s.name, (by.get(s.name) || 0) + s.share / all.length);
  return [...by].map(([name, share]) => ({ name, share }));
}
/** Shares out a sum in cents so the parts add up exactly (largest remainder). */
function allocate(cents, weights) {
  const exact = weights.map((w) => cents * w);
  const out = exact.map(Math.floor);
  let left = cents - out.reduce((a, b) => a + b, 0);
  for (const i of exact
    .map((e, i) => [e - out[i], i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i)) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

async function businessRevenue(req, res, url, user, db, id) {
  const q = url.searchParams;
  db.revenue ??= {};
  // ponytail: one ~50-byte entry per imported row, kept in business.json; move to its own file past ~100k rows
  db.revenueRows ??= {}; // every imported row, by a hash of its cells -> the line it went into
  const tdb = await loadTracks();
  if (req.method === 'POST' && q.has('import')) {
    // A distributor's CSV. Every row is remembered, so importing the full history again only adds rows that are
    // new (late earnings for an old month included); new rows become one line per song, month and store.
    const rows = parseCsv((await body(req, 20e6)).replace(/^﻿/, '')); // Excel starts files with a BOM
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    const col = (...res) => {
      for (const re of res) {
        const i = head.findIndex((h) => re.test(h));
        if (i >= 0) return i;
      }
      return -1;
    };
    const cEarn = col(/earnings/, /net (revenue|amount|payable)/, /^(amount|revenue|royalties)\b/, /revenue/, /amount/);
    const cMonth = col(/sale month/, /sales? period/, /^month/, /period/, /month/, /date/);
    const cStore = col(/^store$/, /store|service|platform|retailer|dsp/);
    const cIsrc = col(/isrc/);
    const cTitle = col(/^title$/, /^(track|song)( title| name)?$/, /title/);
    if (cEarn < 0 || cMonth < 0) fail(400, "Couldn't find the earnings and month columns in that file (it needs a header row)");
    const comma = decimalCommaFile(
      rows.map((r) => r[cEarn] ?? ''),
      rows.sep,
    );
    // ISRCs (from the BMI sheets) and unique song titles point a line at its song and release
    const byIsrc = new Map();
    const byTitle = new Map();
    for (const t of Object.values(tdb.tracks)) {
      if (t.deleted) continue;
      const isrc = (t.bmi?.isrc || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (isrc) byIsrc.set(isrc, t);
      const k = t.title.trim().toLowerCase();
      byTitle.set(k, byTitle.has(k) ? null : t); // two songs with one title: can't tell which
    }
    const seen = new Map(); // identical rows in one file are separate sales: count them
    const fresh = [];
    const bad = [];
    let already = 0;
    rows.forEach((r, i) => {
      const cells = r.map((x) => x.trim());
      const base = createHash('sha1').update(cells.join('\u0001')).digest('hex').slice(0, 24);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const key = `${base}.${n}`;
      const amount = parseMoney(cells[cEarn], comma);
      const month = parseMonth(cells[cMonth]);
      if (Number.isNaN(amount) || (amount && !month)) return bad.push(i + 2); // +2: the header, and counting from 1
      if (!amount) return;
      if (own(db.revenueRows, key)) return already++;
      fresh.push({ key, amount, month, cells });
    });
    if (bad.length)
      fail(
        400,
        `${bad.length} row(s) have an earnings amount or sale month that can't be read (first: row ${bad[0]}). Nothing was imported.`,
      );
    const batch = randomUUID().slice(0, 8);
    const sums = new Map();
    for (const f of fresh) {
      const isrc = cIsrc >= 0 ? f.cells[cIsrc].replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
      const title = cTitle >= 0 ? f.cells[cTitle].slice(0, 120) : '';
      const store = cStore >= 0 ? f.cells[cStore].slice(0, 60) : '';
      const k = `${isrc || title.toLowerCase()}|${f.month}|${store.toLowerCase()}`;
      // summed in millionths: distributors pay per stream in fractions of a cent, rounded once per line
      const s = sums.get(k) || { month: f.month, isrc, title, store, micro: 0, keys: [] };
      s.micro += Math.round(f.amount * 1e6);
      s.keys.push(f.key);
      sums.set(k, s);
    }
    let unmatched = 0;
    for (const s of sums.values()) {
      const t = byIsrc.get(s.isrc) || byTitle.get(s.title.toLowerCase()) || null;
      if (!t) unmatched++;
      const l = {
        id: randomUUID().slice(0, 10),
        batch,
        date: `${s.month}-01`,
        type: 'income',
        source: 'Streaming',
        amount: s.micro / 1e6, // kept to the millionth; totals are rounded to cents once
        release: t?.release || null,
        track: t?.id || null, // its song: shared by that song's splits
        note: [s.store, s.title, s.isrc].filter(Boolean).join(' · ').slice(0, 300),
        by: user.username,
      };
      db.revenue[l.id] = l;
      for (const key of s.keys) db.revenueRows[key] = l.id;
    }
    saveBiz();
    await audit(req, user, 'imported distributor earnings', `${fresh.length} new row(s), batch ${batch}`);
    return json(res, { added: sums.size, rows: fresh.length, skipped: already, unmatched, batch });
  }
  if (req.method === 'POST' && !id) {
    const input = await jsonBody(req);
    const type = input.type === 'cost' ? 'cost' : 'income';
    const l = {
      id: randomUUID().slice(0, 10),
      date: dateOrNull(input.date) || fail(400, 'Pick the date'),
      type,
      source: REV_SOURCES[type].includes(input.source) ? input.source : fail(400, 'Pick where it came from'),
      amount: money(input.amount),
      release: input.release ? (own(tdb.releases, String(input.release)) ? String(input.release) : fail(400, 'No such release')) : null,
      note: String(input.note ?? '').slice(0, 300),
      by: user.username,
    };
    if (!(l.amount > 0)) fail(400, 'The amount must be more than 0');
    db.revenue[l.id] = l;
    saveBiz();
    await audit(req, user, `added ${type}`, `${l.source} ${l.amount}`);
    return json(res, l);
  }
  if (req.method === 'DELETE') {
    // One line, or a whole import (?batch=) to undo it (its rows can then be imported again)
    const batch = q.get('batch');
    const gone = batch
      ? Object.values(db.revenue).filter((l) => l.batch && l.batch === batch)
      : [own(db.revenue, id) || fail(404, 'No such line')];
    for (const l of gone) delete db.revenue[l.id];
    const ids = new Set(gone.map((l) => l.id)); // their rows can be imported again
    for (const [k, lineId] of Object.entries(db.revenueRows)) if (ids.has(lineId)) delete db.revenueRows[k];
    saveBiz();
    await audit(req, user, 'removed revenue lines', String(gone.length));
    return json(res, { removed: gone.length });
  }
  if (req.method !== 'GET') fail(405, 'Not allowed');

  // The picture for a period (default: this year)
  const from = dateOrNull(q.get('from') || '') || `${localDate().slice(0, 4)}-01-01`;
  const to = dateOrNull(q.get('to') || '') || localDate();
  const inRange = (d) => d >= from && d <= to;
  const lines = Object.values(db.revenue).filter((l) => inRange(l.date));
  const shop = Object.values((await loadShop()).orders).filter(
    (o) => ['Paid', 'Shipped', 'Delivered'].includes(o.status) && o.paid && inRange(localDate(new Date(o.paid))), // paid is UTC; the period is in local days
  );
  const all = [...lines, ...shop.map((o) => ({ type: 'income', source: 'Shop', amount: o.amount, release: null }))];
  const cents = (xs) => Math.round(xs.reduce((n, l) => n + Math.round(l.amount * 1e6), 0) / 1e4); // summed exactly, rounded once
  const bySource = {};
  for (const l of all) bySource[`${l.type}:${l.source}`] = (bySource[`${l.type}:${l.source}`] || 0) + Math.round(l.amount * 1e6);
  for (const k in bySource) bySource[k] = Math.round(bySource[k] / 1e4) / 100; // summed exactly like the totals
  const releases = Object.values(tdb.releases)
    .filter((r) => !r.deleted && lines.some((l) => l.release === r.id))
    .map((r) => {
      const mine = lines.filter((l) => l.release === r.id);
      const inc = mine.filter((l) => l.type === 'income');
      const income = cents(inc);
      const net = income - cents(mine.filter((l) => l.type === 'cost'));
      const whole = releaseSplits(tdb, r.id);
      // Each person's part of the income (song lines by the song's splits, the rest by the release's), names
      // matched without case ("Hima" and "HIMA" are one person)
      const weight = new Map();
      const add = (name, w) => {
        const k = name.toLowerCase();
        const x = weight.get(k) || { name, w: 0 };
        x.w += w;
        weight.set(k, x);
      };
      for (const l of inc) for (const s of songSplits(own(tdb.tracks, l.track)) || whole) add(s.name, (l.amount * s.share) / 100);
      let parts = [...weight.values()].filter((p) => p.w > 0);
      const total = parts.reduce((n, p) => n + p.w, 0);
      if (!(total > 0)) parts = whole.map((s) => ({ name: s.name, w: s.share })); // no income yet: the plain splits
      const sumW = parts.reduce((n, p) => n + p.w, 0);
      const amounts = allocate(
        Math.max(0, net),
        parts.map((p) => p.w / sumW),
      );
      return {
        id: r.id,
        title: r.title,
        artist: r.artist || '',
        income: income / 100,
        costs: (income - net) / 100,
        net: net / 100,
        toRecoup: net < 0 ? -net / 100 : 0,
        parties: parts.map((p, i) => ({ name: p.name, share: round2((p.w / sumW) * 100), amount: amounts[i] / 100 })),
      };
    });
  await audit(req, user, 'opened revenue', `${from} to ${to}`);
  const tin = cents(all.filter((l) => l.type === 'income'));
  const tout = cents(all.filter((l) => l.type === 'cost'));
  return json(res, {
    from,
    to,
    income: tin / 100,
    costs: tout / 100,
    bySource,
    releases,
    lines: lines.sort((a, b) => b.date.localeCompare(a.date)),
    shopOrders: shop.length,
    sources: REV_SOURCES,
    allReleases: Object.values(tdb.releases)
      .filter((r) => !r.deleted)
      .map((r) => ({ id: r.id, title: r.title })),
  });
}

/** Contracts, briefs, receipts... stored on the PC itself (data/business/files), never on a USB space. */
async function businessDocs(req, res, url, user, db, id, sub) {
  const q = url.searchParams;
  if (req.method === 'GET' && !id) {
    await audit(req, user, 'listed documents');
    return json(
      res,
      Object.values(db.docs).filter((d) => !d.deleted),
    );
  }
  if (req.method === 'PUT' && !id) {
    // One request per file (contracts and receipts are small; Cloudflare's 100 MB cap applies)
    const name = safeName(q.get('name'));
    const d = {
      id: randomUUID().slice(0, 12),
      name,
      client: q.get('client') && own(db.clients, q.get('client')) ? q.get('client') : null,
      vault: q.get('vault') === '1',
      size: 0,
      added: new Date().toISOString(),
      addedBy: user.username,
    };
    await mkdir(join(BIZ(), 'files'), { recursive: true });
    const file = join(BIZ(), 'files', d.id + extname(name).toLowerCase());
    await pipeline(req, createWriteStream(file));
    d.size = (await stat(file)).size;
    db.docs[d.id] = d;
    saveBiz();
    await audit(req, user, `uploaded${d.vault ? ' to the vault' : ''}`, name);
    return json(res, d);
  }
  const d = (own(db.docs, id) && !db.docs[id].deleted && db.docs[id]) || fail(404, 'No such document');
  const file = join(BIZ(), 'files', d.id + extname(d.name).toLowerCase());
  if (req.method === 'GET' && sub === 'file') {
    if (d.vault && viaTunnel(req)) {
      await audit(req, user, 'was refused a vault document over the internet', d.name);
      fail(403, 'Vault documents only open over Tailscale. Turn Tailscale on and use the Tailscale address.');
    }
    await audit(req, user, 'opened document', d.name);
    return stream(req, res, q, file);
  }
  if (req.method === 'PATCH') {
    const input = await jsonBody(req);
    if (input.vault !== undefined) d.vault = !!input.vault;
    if (input.client !== undefined) d.client = input.client && own(db.clients, input.client) ? input.client : null;
    saveBiz();
    await audit(req, user, 'changed document', d.name);
    return json(res, d);
  }
  if (req.method === 'DELETE') {
    d.deleted = new Date().toISOString(); // file kept on disk
    saveBiz();
    await audit(req, user, 'removed document', d.name);
    return json(res, { ok: true });
  }
  fail(405, 'Not allowed');
}

// ── /api/blog: public blog — Substack writers pulled in live, plus our own posts — data/blog.json ──
// Anyone can read it (no account). Admins manage the writers and posts from the Admin Panel.
// Substack posts show title, picture and opening lines and link out for the full piece, so no outside HTML
// ever runs on sanktuary.studio. Feeds refresh every 10 minutes.
let blogDb = null;
let blogSaved = Promise.resolve();
// Starts with Boroma's own Substack; more writers are added in the Admin Panel
const loadBlog = async () =>
  (blogDb ??= await readJson('blog.json', {
    feeds: [{ url: 'https://boroma.substack.com/feed', name: 'Boroma', added: '2026-09-23T00:00:00.000Z' }],
    posts: {},
  }));
const saveBlog = () => (blogSaved = blogSaved.then(() => saveJson('blog.json', blogDb)).catch(console.error));
const feedCache = new Map(); // feed url -> { at, items, error }
const FEED_MINUTES = 10;

/** "hima", "hima.substack.com" or any Substack / RSS URL -> the feed URL. */
function feedUrl(input) {
  const v = String(input || '').trim();
  if (/^[\w-]{1,60}$/.test(v)) return `https://${v}.substack.com/feed`;
  const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  const pub = u.hostname === 'open.substack.com' && u.pathname.match(/^\/pub\/([\w-]+)/)?.[1]; // open.substack.com/pub/<name>
  if (pub) return `https://${pub}.substack.com/feed`;
  if (u.protocol !== 'https:') fail(400, 'Feeds must be https');
  // Only public websites: never the PC itself, the home network or Tailscale addresses
  if (/^(localhost|[\d.]+|\[.*\]|.*\.(local|lan|internal|ts\.net))$/i.test(u.hostname)) fail(400, 'Feeds must be public websites');
  if (!/\/feed\/?$/.test(u.pathname) && !/\.(xml|rss)$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/feed');
  return u.href;
}

const decodeXml = (s = '') =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
const plainText = (html = '') =>
  decodeXml(html.replace(/<!\[CDATA\[|\]\]>/g, ''))
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const slugify = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

// Substack post HTML, cut down to plain formatting before it's shown on our site: every tag not on this list is
// dropped (its text kept), scripts/iframes/forms are removed with their contents, and only https links and
// pictures survive as attributes. Nothing from the feed can run code on sanktuary.studio.
const CLEAN_TAGS = {
  p: [],
  br: [],
  hr: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  sup: [],
  sub: [],
  blockquote: [],
  ul: [],
  ol: [],
  li: [],
  pre: [],
  code: [],
  figure: [],
  figcaption: [],
  a: ['href'],
  img: ['src', 'alt'],
};
const escAttr = (v) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function cleanHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(script|style|iframe|object|embed|noscript|svg|math|form|template|button|select|textarea|video|audio)\b[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g, (whole, name, attrs) => {
      const t = name.toLowerCase();
      if (!CLEAN_TAGS[t]) return '';
      if (whole.startsWith('</')) return ['br', 'hr', 'img'].includes(t) ? '' : `</${t}>`;
      let out = '';
      for (const a of CLEAN_TAGS[t]) {
        const m = attrs.match(new RegExp(`\\s${a}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
        const v = m ? decodeXml(m[1] ?? m[2]).trim() : '';
        if (a === 'alt' ? v : /^https:\/\//i.test(v)) out += ` ${a}="${escAttr(v)}"`;
      }
      if (t === 'a') out += ' target="_blank" rel="noopener noreferrer nofollow"';
      if (t === 'img') out += ' loading="lazy" referrerpolicy="no-referrer"';
      return `<${t}${out}>`;
    });
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? '';
const httpsOnly = (u) => (/^https:\/\//i.test(u || '') ? u : null);

async function readFeed(feed) {
  const hit = feedCache.get(feed.url);
  if (hit && Date.now() - hit.at < FEED_MINUTES * 60_000) return hit;
  try {
    const r = await fetch(feed.url, {
      headers: { 'user-agent': 'Sanktuary blog reader (sanktuary.studio)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const xml = (await r.text()).slice(0, 5_000_000);
    const publication = plainText(tag(tag(xml, 'channel').split('<item')[0], 'title')) || feed.name;
    // On-site address: /blog/<publication>/<post slug>, e.g. /blog/boroma/what-does-change-look-like
    const pubSlug = slugify(new URL(feed.url).hostname.replace(/\.substack\.com$/i, '').replace(/^www\./, '')) || slugify(publication);
    const raw = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].slice(0, 20).map(([item]) => {
      const content = decodeXml(tag(item, 'content:encoded') || tag(item, 'description'));
      const link = httpsOnly(plainText(tag(item, 'link')));
      return {
        item,
        content,
        link,
        cover: httpsOnly(
          decodeXml(
            item.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="image/i)?.[1] || item.match(/<media:content[^>]+url="([^"]+)"/i)?.[1] || '',
          ),
        ),
        firstImage: httpsOnly(decodeXml(content.match(/<img[^>]+src="([^"]+)"/i)?.[1] || '')),
      };
    });
    // Substack falls back to the writer's profile picture when a post has no header image; a "cover" shared
    // by several posts is that fallback, so those posts get no picture (the title takes the space instead)
    const seen = raw.reduce((m, r) => m.set(r.cover, (m.get(r.cover) || 0) + 1), new Map());
    const items = raw.map(({ item, content, link, cover, firstImage }) => {
      const slug =
        slugify(new URL(link || 'https://x/').pathname.replace(/^\/p\//, '')) || createHash('sha1').update(item).digest('hex').slice(0, 10);
      return {
        id: `ss-${pubSlug}-${slug}`,
        source: 'substack',
        title: plainText(tag(item, 'title')).slice(0, 200),
        excerpt: (plainText(tag(item, 'description')) || plainText(content)).slice(0, 400),
        image: (cover && seen.get(cover) === 1 ? cover : null) || firstImage || null,
        url: `/blog/${pubSlug}/${slug}`,
        external: link,
        html: cleanHtml(content),
        author: plainText(tag(item, 'dc:creator')) || publication,
        publication,
        date: new Date(plainText(tag(item, 'pubDate')) || Date.now()).toISOString(),
      };
    });
    const fresh = { at: Date.now(), items: items.filter((i) => i.external && i.title), error: null };
    feedCache.set(feed.url, fresh);
    return fresh;
  } catch (err) {
    const stale = { at: Date.now(), items: hit?.items || [], error: err.message };
    feedCache.set(feed.url, stale);
    return stale;
  }
}

// Substack Notes (the short posts) aren't in RSS; they come from Substack's public profile feed, per writer.
// Not an official API, so it's read gently (cached like the feeds) and a failure just leaves the wall empty.
// Only plain text, pictures from Substack's own image hosts and links back to Substack are passed on.
const notesCache = new Map(); // substack user id -> { at, items }
const writerIds = new Map(); // feed url -> [user ids] (the publication's bylines)
const SUBSTACK_IMAGE = /^https:\/\/(substack-post-media\.s3\.amazonaws\.com|substackcdn\.com)\//;
const substackGet = (u) =>
  fetch(u, { headers: { 'user-agent': 'Sanktuary blog reader (sanktuary.studio)' }, signal: AbortSignal.timeout(10_000) }).then((r) =>
    r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
  );

async function readNotes(feed) {
  const host = new URL(feed.url).hostname;
  if (!host.endsWith('.substack.com')) return [];
  try {
    if (!writerIds.has(feed.url)) {
      const archive = await substackGet(`https://${host}/api/v1/archive?limit=5`);
      const ids = [...new Set(archive.flatMap((p) => (p.publishedBylines || []).map((b) => b.id)))].filter(Number.isInteger);
      writerIds.set(feed.url, ids.slice(0, 3));
    }
    const lists = await Promise.all(
      writerIds.get(feed.url).map(async (id) => {
        const hit = notesCache.get(id);
        if (hit && Date.now() - hit.at < FEED_MINUTES * 60_000) return hit.items;
        const items = await substackGet(`https://substack.com/api/v1/reader/feed/profile/${id}?types%5B%5D=note`)
          .then((d) =>
            (d.items || [])
              .map((it) => it.comment)
              .filter((c) => c && !c.ancestor_path && /^[\w-]{1,60}$/.test(c.handle || '') && Number.isInteger(c.id))
              .slice(0, 20)
              .map((c) => ({
                id: `note-${c.id}`,
                author: String(c.name || c.handle).slice(0, 80),
                publication: feed.name,
                avatar: SUBSTACK_IMAGE.test(c.photo_url || '') ? c.photo_url : null,
                body: String(c.body || '').slice(0, 5000),
                date: new Date(c.date || Date.now()).toISOString(),
                likes: Number(c.reaction_count) || 0,
                restacks: Number(c.restacks) || 0,
                images: (c.attachments || [])
                  .filter((a) => a.type === 'image' && SUBSTACK_IMAGE.test(a.imageUrl || ''))
                  .map((a) => a.imageUrl)
                  .slice(0, 4),
                post:
                  (c.attachments || [])
                    .filter((a) => a.type === 'post' && httpsOnly(a.post?.canonical_url))
                    .map((a) => ({ title: String(a.post.title || '').slice(0, 200), url: a.post.canonical_url }))[0] || null,
                external: `https://substack.com/@${c.handle}/note/c-${c.id}`,
              })),
          )
          .catch(() => hit?.items || []);
        notesCache.set(id, { at: Date.now(), items });
        return items;
      }),
    );
    return lists.flat();
  } catch {
    return [];
  }
}

const ownPostView = (p, full) => ({
  id: p.id,
  source: 'sanktuary',
  title: p.title,
  excerpt: p.body.replace(/\s+/g, ' ').slice(0, 400),
  image: p.image || null,
  url: `/blog/${p.slug || p.id}`,
  author: p.author,
  publication: 'Sanktuary',
  date: p.published || p.created,
  ...(full ? { body: p.body } : {}),
});

async function blogApi(req, res, url) {
  const db = await loadBlog();
  const [, , , what, id] = url.pathname.split('/'); // /api/blog/<post|images|admin|feeds|posts>/<id>

  // Public reading
  if (req.method === 'GET' && !what) {
    const own = Object.values(db.posts)
      .filter((p) => p.published && !p.deleted)
      .map((p) => ownPostView(p));
    const fromFeeds = (await Promise.all(db.feeds.map(readFeed))).flatMap((f) => f.items);
    const posts = [...own, ...fromFeeds.map(({ html, ...rest }) => rest)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
    res.setHeader('cache-control', 'public, max-age=60');
    return json(res, { posts, writers: db.feeds.map((f) => f.name) });
  }
  if (req.method === 'GET' && what === 'notes') {
    const byId = new Map((await Promise.all(db.feeds.map(readNotes))).flat().map((n) => [n.id, n])); // a writer on two feeds shows once
    const notes = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
    res.setHeader('cache-control', 'public, max-age=60');
    return json(res, { notes: notes.slice(0, 80) });
  }
  if (req.method === 'GET' && what === 'post') {
    // /api/blog/post/<our slug or id>  or  /api/blog/post/<substack publication>/<post slug>
    const second = url.pathname.split('/')[5];
    if (second) {
      const want = `/blog/${id}/${second}`;
      const hit = (await Promise.all(db.feeds.map(readFeed))).flatMap((f) => f.items).find((i) => i.url === want);
      return hit ? json(res, hit) : fail(404, 'No such post');
    }
    const p = Object.values(db.posts).find((x) => x.published && !x.deleted && (x.slug === id || x.id === id)) || fail(404, 'No such post');
    return json(res, ownPostView(p, true));
  }
  if (req.method === 'GET' && what === 'images') return stream(req, res, url.searchParams, join(DATA, 'blog', 'images', safeName(id)));

  // Managing: admins only
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  if (!user.admin) fail(403, 'Only admins can manage the blog');
  if (req.method === 'GET' && what === 'admin') {
    const feeds = await Promise.all(
      db.feeds.map(async (f) => ({ ...f, ...(({ error, items }) => ({ error, posts: items.length }))(await readFeed(f)) })),
    );
    return json(res, {
      feeds,
      posts: Object.values(db.posts)
        .filter((p) => !p.deleted)
        .sort((a, b) => b.created.localeCompare(a.created)),
    });
  }
  if (what === 'feeds' && req.method === 'POST') {
    const input = await jsonBody(req);
    const u = feedUrl(input.url);
    if (db.feeds.some((f) => f.url === u)) fail(409, 'Already added');
    feedCache.delete(u);
    const feed = {
      url: u,
      name:
        String(input.name || '')
          .trim()
          .slice(0, 80) || new URL(u).hostname.replace(/\.substack\.com$/, ''),
      added: new Date().toISOString(),
    };
    const check = await readFeed(feed);
    if (check.error && !check.items.length) fail(400, `Couldn't read that feed (${check.error}). Check the name or link.`);
    db.feeds.push(feed);
    saveBlog();
    return json(res, { ...feed, posts: check.items.length });
  }
  if (what === 'feeds' && req.method === 'DELETE') {
    const u = url.searchParams.get('url');
    db.feeds = db.feeds.filter((f) => f.url !== u);
    saveBlog();
    return json(res, { ok: true });
  }
  if (what === 'images' && req.method === 'PUT') {
    const name = safeName(url.searchParams.get('name'));
    if (!THUMBABLE.has(extname(name).toLowerCase())) fail(400, 'Cover images must be pictures');
    await mkdir(join(DATA, 'blog', 'images'), { recursive: true });
    const id = randomUUID().slice(0, 12);
    const original = join(DATA, 'blog', 'images', `${id}-original${extname(name).toLowerCase()}`); // kept as uploaded
    await pipeline(req, createWriteStream(original));
    const img = await imageInput(original, (await stat(original)).size).catch(() => fail(400, "That picture couldn't be read"));
    await img
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(DATA, 'blog', 'images', `${id}.webp`));
    return json(res, { url: `/api/blog/images/${id}.webp` });
  }
  if (what === 'posts') {
    const input = req.method === 'POST' || req.method === 'PATCH' ? await jsonBody(req) : {};
    const apply = (p) => {
      if (input.title !== undefined) p.title = String(input.title).trim().slice(0, 200) || p.title;
      if (input.body !== undefined) p.body = String(input.body).slice(0, 100_000);
      if (input.author !== undefined) p.author = String(input.author).trim().slice(0, 80) || p.author;
      if (input.image !== undefined) p.image = input.image && /^\/api\/blog\/images\/[\w-]+\.webp$/.test(input.image) ? input.image : null;
      if (input.published !== undefined) p.published = input.published ? p.published || new Date().toISOString() : null;
      // A readable address, fixed once published so shared links keep working: /blog/why-culture-matters
      if (p.published && !p.slug) {
        const base = slugify(p.title) || p.id;
        const taken = new Set([...Object.values(db.posts).map((x) => x.slug), 'notes']); // /blog/notes is the notes wall
        p.slug = taken.has(base) ? `${base}-${p.id.slice(0, 4)}` : base;
      }
      p.updated = new Date().toISOString();
    };
    if (req.method === 'POST' && !id) {
      const p = {
        id: randomUUID().slice(0, 10),
        title: 'Untitled',
        body: '',
        author: user.username,
        image: null,
        published: null,
        created: new Date().toISOString(),
      };
      apply(p);
      db.posts[p.id] = p;
      saveBlog();
      return json(res, p);
    }
    const p = (own(db.posts, id) && !db.posts[id].deleted && db.posts[id]) || fail(404, 'No such post');
    if (req.method === 'PATCH') {
      apply(p);
      saveBlog();
      return json(res, p);
    }
    if (req.method === 'DELETE') {
      p.deleted = new Date().toISOString(); // hidden, kept in the file
      saveBlog();
      return json(res, { ok: true });
    }
  }
  fail(404, 'Unknown blog action');
}

// ── /api/public: the front door for visitors without an account — data/front.json ──
// The Welcome window shows the intro (edited in the Admin Panel), the latest writing, upcoming timeline entries
// and releases that were explicitly marked public, and a "Join the Village" form. Nothing is public by default.
let frontDb = null;
let frontSaved = Promise.resolve();
const loadFront = async () =>
  (frontDb ??= await readJson('front.json', {
    intro:
      'Sanktuary is a creative home out of the Twin Cities: music, art, fashion and film, built with the people around us. Have a look around, read what we are writing, and if you want in, join the Village.',
    joins: {},
  }));
const saveFront = () => (frontSaved = frontSaved.then(() => saveJson('front.json', frontDb)).catch(console.error));
const joinTries = new Map(); // ip -> { n, since }
const JOIN_STATUSES = ['New', 'Contacted', 'Agreement sent', 'Signed', 'Event done', 'Joined', 'Archived'];

async function latestPosts(n) {
  const blog = await loadBlog();
  const own = Object.values(blog.posts)
    .filter((p) => p.published && !p.deleted)
    .map((p) => ownPostView(p));
  const fromFeeds = (await Promise.all(blog.feeds.map(readFeed))).flatMap((f) => f.items);
  return [...own, ...fromFeeds].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
}

/** A profile link as a safe http(s) URL ("@hima" -> https://instagram.com/hima), or null. */
// Where artists keep their work: a full link, or for these a bare handle ("@name" or "name") after the prefix
const PROFILE_LINKS = {
  spotify: '',
  appleMusic: '',
  youtube: 'https://youtube.com/@',
  soundcloud: 'https://soundcloud.com/',
  bandcamp: '',
  audiomack: 'https://audiomack.com/',
  bandlab: 'https://bandlab.com/',
  tiktok: 'https://tiktok.com/@',
  instagram: 'https://instagram.com/',
  x: 'https://x.com/',
  website: '',
};
function publicLink(kind, v) {
  v = String(v || '').trim();
  if (!v) return null;
  const u = /^https?:\/\//i.test(v) ? v : PROFILE_LINKS[kind] ? PROFILE_LINKS[kind] + v.replace(/^@/, '') : `https://${v}`;
  try {
    const x = new URL(u);
    return ['https:', 'http:'].includes(x.protocol) ? x.href : null;
  } catch {
    return null;
  }
}

// Current members (from Clerk), cached so the public directory doesn't ask Clerk on every visit. A profile
// left behind by someone who was removed never shows, even if it was marked listed.
let membersCache = { at: 0, names: new Set() };
async function currentMembers() {
  if (Date.now() - membersCache.at < 5 * 60_000) return membersCache.names;
  const r = await clerk('/users?limit=100&order_by=-created_at').catch(() => null);
  if (!r?.ok) return membersCache.names; // Clerk unreachable: keep the last list
  membersCache = { at: Date.now(), names: new Set((await r.json()).map((u) => u.username).filter(Boolean)) };
  return membersCache.names;
}

/** Everyone who chose "Show me in the public directory": name, role, bio, links and whether there's a picture. */
async function listedPeople() {
  const members = await currentMembers();
  const files = (await readdir(join(DATA, 'profiles')).catch(() => [])).filter((f) => f.endsWith('.json'));
  const people = [];
  for (const f of files) {
    const username = f.slice(0, -5);
    if (!members.has(username)) continue;
    const p = await readJson(`profiles/${f}`, {});
    if (p.listed !== true) continue;
    people.push({
      username,
      displayName: p.displayName || username,
      role: p.role || '',
      bio: p.bio || '',
      links: Object.fromEntries(
        Object.keys(PROFILE_LINKS)
          .map((k) => [k, publicLink(k, p[k])])
          .filter(([, v]) => v),
      ),
      avatar: !!p.avatar && existsSync(join(DATA, 'profiles', 'avatars', `${username}.webp`)),
      bookable: p.bookable === true, // "Take bookings through Sanktuary": a Book button on their public card
    });
  }
  return people.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function publicApi(req, res, url) {
  const front = await loadFront();
  const [, , , what, who] = url.pathname.split('/');
  // The public directory (My Computer): only what was explicitly made public, plus the shop and writing
  if (req.method === 'GET' && what === 'story') return storyPublic(req, res, url);
  if (req.method === 'GET' && what === 'release') return releasePublic(req, res, url);
  if (req.method === 'GET' && what === 'portfolio') return portfolioPublic(req, res);
  if (req.method === 'GET' && what === 'directory') {
    const today = localDate();
    const tdb = await publicTracks();
    const count = (r) => Object.values(tdb.tracks).filter((t) => t.release === r.id && !t.deleted).length;
    const events = Object.values((await loadTimeline()).items)
      .filter((i) => i.public && !i.members && i.status !== 'Cancelled')
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((i) => ({
        title: i.title,
        kind: i.kind,
        start: i.start,
        end: i.end,
        time: i.time || '',
        location: i.location,
        link: i.link || null,
        past: (i.end || i.start) < today,
      }));
    res.setHeader('cache-control', 'public, max-age=60');
    return json(res, {
      intro: front.intro,
      people: await listedPeople(),
      releases: Object.values(tdb.releases)
        .filter((r) => r.public && !r.deleted && !r.members)
        .map((r) => ({ title: r.title, kind: r.kind, date: r.date, tracks: count(r), slug: r.slug || null }))
        .sort((a, b) => (b.date || '9').localeCompare(a.date || '9')),
      events: [
        ...events.filter((e) => !e.past),
        ...events
          .filter((e) => e.past)
          .reverse()
          .slice(0, 10),
      ],
      posts: await latestPosts(12),
      products: Object.values((await loadShop()).products)
        .filter((p) => p.active && !p.deleted)
        .map((p) => productView(p)),
      pools: Object.values((await loadPools()).pools)
        .filter((p) => p.public && p.open && !p.deleted)
        .map((p) => (({ slug, title, goal, raised, supporters }) => ({ slug, title, goal, raised, supporters }))(poolView(p))),
      stories: Object.values((await loadStories()).stories)
        .filter((st) => st.public && !st.deleted)
        .map((st) => ({ slug: st.slug, title: st.title, subtitle: st.subtitle, count: st.items.filter((i) => !i.hidden).length })),
    });
  }
  if (req.method === 'GET' && what === 'avatar') {
    const name = /^[\w.-]{1,64}$/.test(who || '') ? who : fail(404, 'Not found');
    if (!(await listedPeople()).some((p) => p.username === name && p.avatar)) fail(404, 'Not found');
    res.setHeader('cache-control', 'public, max-age=300');
    return stream(req, res, url.searchParams, join(DATA, 'profiles', 'avatars', `${name}.webp`));
  }
  if (req.method === 'GET' && !what) {
    const today = localDate();
    const posts = await latestPosts(3);
    const events = Object.values((await loadTimeline()).items)
      .filter((i) => i.public && !i.members && i.status !== 'Cancelled' && (i.end || i.start) >= today)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 6)
      .map((i) => ({ title: i.title, kind: i.kind, start: i.start, end: i.end, location: i.location, link: i.link || null }));
    const releases = Object.values((await loadTracks()).releases)
      .filter((r) => r.public && !r.deleted && !r.members)
      .map((r) => ({ title: r.title, kind: r.kind, date: r.date }))
      .sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    const pools = Object.values((await loadPools()).pools)
      .filter((p) => p.public && p.open && !p.deleted)
      .map((p) => (({ slug, title, goal, raised, supporters }) => ({ slug, title, goal, raised, supporters }))(poolView(p)));
    res.setHeader('cache-control', 'public, max-age=60');
    return json(res, { intro: front.intro, posts, events, releases, pools });
  }
  // Visitor forms (join, book): 5 an hour per address and form, a hidden honeypot field, a name and a real-looking email
  const visitor = async (form) => {
    // cf-connecting-ip can be trusted because the server only listens on 127.0.0.1, behind the Cloudflare tunnel
    const ip = `${form}:${req.headers['cf-connecting-ip'] || req.socket.remoteAddress}`;
    const t = joinTries.get(ip);
    const tries = t && Date.now() - t.since < 60 * 60_000 ? t : { n: 0, since: Date.now() };
    if (tries.n >= 5) fail(429, 'Thanks! We already got your note. Try again later if you need to.');
    if (joinTries.size > 5000) for (const [k, x] of joinTries) if (Date.now() - x.since > 60 * 60_000) joinTries.delete(k);
    joinTries.set(ip, { ...tries, n: tries.n + 1 });
    const input = await jsonBody(req);
    if (input.website) return null; // honeypot: people never fill the hidden field, bots do
    const name =
      String(input.name || '')
        .trim()
        .slice(0, 100) || fail(400, 'Tell us your name');
    const email = String(input.email || '')
      .trim()
      .slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'That email address looks wrong');
    return { input, name, email };
  };
  if (req.method === 'POST' && what === 'book') {
    // "Book [artist]": a booking request for someone listed publicly who takes bookings, to the agency (admins) and them
    const v = await visitor('book');
    if (!v) return json(res, { ok: true });
    const { input, name, email } = v;
    const artist = (await listedPeople()).find((p) => p.bookable && p.username === input.artist) || fail(400, 'Pick who you want to book');
    const text = (k, max) =>
      String(input[k] || '')
        .trim()
        .slice(0, max);
    const b = {
      id: randomUUID().slice(0, 10),
      artist: artist.username,
      name,
      email,
      // a real calendar day (not "2026-02-30"), today or later
      date:
        typeof input.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(input.date) &&
        !isNaN(Date.parse(`${input.date}T00:00:00Z`)) &&
        new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) === input.date &&
        input.date >= localDate()
          ? input.date
          : null,
      event: text('event', 200),
      location: text('location', 200),
      budget: text('budget', 60),
      message: text('message', 2000),
      at: new Date().toISOString(),
      status: 'New',
    };
    front.bookings ??= {};
    // A flood aimed at one artist (many addresses at once) is still kept, but only the first 10 a day notify anyone
    const today = Object.values(front.bookings).filter((x) => x.artist === artist.username && Date.now() - Date.parse(x.at) < 864e5).length;
    front.bookings[b.id] = b;
    saveFront();
    if (today >= 10) return json(res, { ok: true });
    const cfg = await loadConfig();
    const note = `Booking request for ${artist.displayName} from ${name}${b.date ? ` for ${b.date}` : ''}${b.event ? `: ${b.event}` : ''}${b.location ? ` in ${b.location}` : ''}.`;
    for (const u of cfg.admins) await notify(u, `${note} See Admin Panel > Front page.`, {});
    if (!cfg.admins.includes(artist.username))
      await notify(artist.username, `${note} The Sanktuary team has the details and will follow up with you.`, {});
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && what === 'join') {
    const v = await visitor('join');
    if (!v) return json(res, { ok: true });
    const { input, name, email } = v;
    const j = {
      id: randomUUID().slice(0, 10),
      name,
      email,
      role: String(input.role || '').slice(0, 60),
      links: String(input.links || '').slice(0, 300),
      message: String(input.message || '').slice(0, 2000),
      artwork: String(input.artwork || '').slice(0, 2000),
      needs: String(input.needs || '').slice(0, 1000),
      availability: String(input.availability || '').slice(0, 500),
      at: new Date().toISOString(),
      status: 'New',
    };
    front.joins[j.id] = j;
    saveFront();
    const cfg = await loadConfig();
    for (const a of cfg.admins)
      await notify(a, `${name} wants to join the Village${j.role ? ` (${j.role})` : ''}. See Admin Panel > Front page.`, {});
    return json(res, { ok: true });
  }
  // Admins: edit the intro, read and answer join requests
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  if (!user.admin) fail(403, 'Administrators only');
  if (req.method === 'GET' && what === 'admin')
    return json(res, {
      intro: front.intro,
      portfolio: front.portfolio || {},
      welcome: front.welcome || { subject: '', body: '' },
      mail: mailReady(),
      joins: Object.values(front.joins).sort((a, b) => b.at.localeCompare(a.at)),
      bookings: Object.values(front.bookings || {}).sort((a, b) => b.at.localeCompare(a.at)),
    });
  if (req.method === 'PATCH' && what === 'admin') {
    const input = await jsonBody(req);
    if (input.intro !== undefined) front.intro = String(input.intro).slice(0, 3000);
    if (input.portfolio && typeof input.portfolio === 'object') {
      const limits = { name: 100, tagline: 200, statement: 6000, bio: 6000, contact: 300, links: 2000 };
      front.portfolio = Object.fromEntries(
        Object.entries(limits).map(([k, max]) => [k, String(input.portfolio[k] ?? front.portfolio?.[k] ?? '').slice(0, max)]),
      );
    }
    if (input.welcome && typeof input.welcome === 'object')
      front.welcome = { subject: String(input.welcome.subject ?? '').slice(0, 150), body: String(input.welcome.body ?? '').slice(0, 6000) };
    // Artist onboarding: hello -> agreement -> signed (the welcome email goes out once) -> event day
    const j = input.join && own(front.joins, input.join.id) && front.joins[input.join.id];
    if (j && input.join.event !== undefined) j.event = String(input.join.event).slice(0, 200);
    if (j && input.join.eventDate !== undefined) j.eventDate = /^\d{4}-\d{2}-\d{2}$/.test(input.join.eventDate) ? input.join.eventDate : '';
    if (j && JOIN_STATUSES.includes(input.join.status)) j.status = input.join.status;
    let welcome = null;
    if (j && j.status === 'Signed' && !j.welcomed && front.welcome?.body?.trim()) {
      const fill = (t) =>
        t
          .replace(/\{event\}/g, j.event || 'the event')
          .replace(/\{date\}/g, j.eventDate || 'the date we agreed')
          .replace(/\{name\}/g, j.name.split(' ')[0]);
      j.welcomed = new Date().toISOString(); // before the send, so a double click never mails twice
      welcome = mailReady()
        ? await sendMail(
            { email: j.email, name: j.name.split(' ')[0] },
            fill(front.welcome.subject || 'Welcome to Sanktuary'),
            fill(front.welcome.body),
            siteOrigin(req),
          )
            .then(() => 'sent')
            .catch((e) => (delete j.welcomed, e.message))
        : (delete j.welcomed, 'Email isn’t set up on the server yet (RESEND_API_KEY / MAIL_FROM)');
    }
    const booking = input.booking && own(front.bookings, input.booking.id);
    if (booking && ['New', 'Contacted', 'Confirmed', 'Declined', 'Archived'].includes(input.booking.status))
      booking.status = input.booking.status;
    saveFront();
    return json(res, { ok: true, welcome });
  }
  fail(404, 'Not found');
}

// ── Stripe (payments for the pool, and later the shop) ─────────────────
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env. Card details only ever go to Stripe's own Checkout
// page; money is counted only when Stripe's signed webhook confirms the payment. No Stripe library: two calls.
const STRIPE = process.env.STRIPE_API_URL || 'https://api.stripe.com/v1'; // overridable so tests can use a fake
const stripeReady = () => !!process.env.STRIPE_SECRET_KEY;
async function stripe(path, form) {
  const body = new URLSearchParams();
  const add = (prefix, v) =>
    v !== null && typeof v === 'object'
      ? Object.entries(v).forEach(([k, x]) => add(prefix ? `${prefix}[${k}]` : k, x))
      : v !== undefined && body.append(prefix, String(v));
  add('', form);
  const r = await fetch(STRIPE + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const out = await r.json();
  if (!r.ok) fail(502, `Stripe: ${out.error?.message || r.status}`);
  return out;
}
/** Stripe-Signature: t=<time>,v1=<hmac of "t.body"> — refuse anything unsigned, forged or older than 5 minutes. */
function stripeEvent(raw, header) {
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((kv) => kv.split('=')),
  );
  const expected = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET || '')
    .update(`${parts.t}.${raw}`)
    .digest('hex');
  const ok = parts.v1 && parts.v1.length === expected.length && timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  if (!process.env.STRIPE_WEBHOOK_SECRET || !ok || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) fail(400, 'Bad signature');
  return JSON.parse(raw);
}
const siteOrigin = (req) => (SITE_ORIGINS[0] || `http://${req.headers.host}`).replace(/\/$/, '');

// ── /api/pools: the team money pool — data/pools.json ──
// Goals the team (and fans, when public) put money toward: a challenge, an event, gear. Public counter and
// progress bar; supporters can stay anonymous. Admins can add cash / Zelle contributions by hand.
let poolsDb = null;
let poolsSaved = Promise.resolve();
const loadPools = async () => (poolsDb ??= await readJson('pools.json', { pools: {}, handled: [] }));
const savePools = () => (poolsSaved = poolsSaved.then(() => saveJson('pools.json', poolsDb)).catch(console.error));
const poolView = (p, admin) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  goal: p.goal,
  deadline: p.deadline,
  public: p.public,
  open: p.open,
  raised: p.contributions.reduce((n, c) => n + c.amount, 0),
  supporters: p.contributions.length,
  recent: p.contributions
    .slice(-12)
    .reverse()
    .map((c) => ({
      name: c.anonymous ? 'Anonymous' : c.name,
      amount: c.amount,
      message: c.message,
      at: c.at,
      ...(admin ? { how: c.how } : {}),
    })),
  payments: stripeReady(),
});

async function poolsApi(req, res, url) {
  const db = await loadPools();
  const [, , , id, action] = url.pathname.split('/'); // /api/pools/<id|slug>/<give>
  const cfg = await loadConfig();
  let user = null;
  try {
    user = await currentUser(req, url, cfg);
  } catch {} // visitors can see and give to public pools

  const find = (key) =>
    Object.values(db.pools).find((p) => !p.deleted && (p.id === key || p.slug === key) && (p.public || user)) || fail(404, 'No such pool');
  if (req.method === 'GET' && !id) {
    return json(
      res,
      Object.values(db.pools)
        .filter((p) => !p.deleted && (p.public || user))
        .map((p) => poolView(p, user?.admin)),
    );
  }
  if (req.method === 'GET' && id) return json(res, poolView(find(id), user?.admin));

  if (req.method === 'POST' && action === 'give') {
    const p = find(id);
    if (!p.open) fail(409, 'This pool is closed');
    if (!stripeReady()) fail(503, "Payments aren't set up yet");
    const input = await jsonBody(req);
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount >= 1 && amount <= 10000)) fail(400, 'Give between $1 and $10,000');
    const session = await stripe('/checkout/sessions', {
      mode: 'payment',
      line_items: {
        0: {
          quantity: 1,
          price_data: { currency: 'usd', unit_amount: Math.round(amount * 100), product_data: { name: `Sanktuary pool: ${p.title}` } },
        },
      },
      success_url: `${siteOrigin(req)}/pool/${p.slug}?thanks=1`,
      cancel_url: `${siteOrigin(req)}/pool/${p.slug}`,
      metadata: {
        pool: p.id,
        name: String(input.name || user?.username || '').slice(0, 60),
        anonymous: input.anonymous ? '1' : '',
        message: String(input.message || '').slice(0, 200),
      },
    });
    return json(res, { url: session.url });
  }

  if (!user?.admin) fail(user ? 403 : 401, 'Only admins can set up pools');
  if (req.method === 'POST' && !id) {
    const input = await jsonBody(req);
    const title =
      String(input.title || '')
        .trim()
        .slice(0, 100) || fail(400, 'Give the pool a name');
    const base = slugify(title) || randomUUID().slice(0, 6);
    const slug = Object.values(db.pools).some((x) => x.slug === base) ? `${base}-${randomUUID().slice(0, 4)}` : base;
    const p = {
      id: randomUUID().slice(0, 10),
      slug,
      title,
      description: '',
      goal: 0,
      deadline: null,
      public: false,
      open: true,
      contributions: [],
      created: new Date().toISOString(),
      createdBy: user.username,
    };
    db.pools[p.id] = p;
    savePools();
    return json(res, poolView(p, true));
  }
  const p = find(id);
  if (req.method === 'PATCH') {
    const input = await jsonBody(req);
    if (input.title !== undefined) p.title = String(input.title).trim().slice(0, 100) || p.title;
    if (input.description !== undefined) p.description = String(input.description).slice(0, 3000);
    if (input.goal !== undefined) p.goal = Math.max(0, money(input.goal));
    if (input.deadline !== undefined) p.deadline = dateOrNull(input.deadline);
    if (input.public !== undefined) p.public = !!input.public;
    if (input.open !== undefined) p.open = !!input.open;
    savePools();
    return json(res, poolView(p, true));
  }
  if (req.method === 'POST' && action === 'manual') {
    // Cash, Zelle, Venmo... given outside Stripe, so the counter stays honest
    const input = await jsonBody(req);
    const amount = money(input.amount);
    if (!(amount > 0)) fail(400, 'Amount must be more than 0');
    p.contributions.push({
      amount,
      name: String(input.name || 'Someone').slice(0, 60),
      anonymous: !!input.anonymous,
      message: String(input.message || '').slice(0, 200),
      at: new Date().toISOString(),
      how: `added by ${user.username}`,
    });
    savePools();
    return json(res, poolView(p, true));
  }
  if (req.method === 'DELETE') {
    p.deleted = new Date().toISOString(); // hidden, contributions kept
    savePools();
    return json(res, { ok: true });
  }
  fail(404, 'Unknown pool action');
}

/** Stripe calls this after a payment. Only signed events count, and each payment only once. */
async function stripeWebhook(req, res) {
  const raw = await body(req);
  const event = stripeEvent(raw, req.headers['stripe-signature']);
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const db = await loadPools();
    const p = s.metadata?.pool && db.pools[s.metadata.pool];
    if (p && s.payment_status === 'paid' && !db.handled.includes(s.id)) {
      db.handled.push(s.id);
      const amount = (s.amount_total || 0) / 100;
      const name = s.metadata.name || s.customer_details?.name || 'Someone';
      p.contributions.push({
        amount,
        name,
        anonymous: !!s.metadata.anonymous,
        message: s.metadata.message || '',
        at: new Date().toISOString(),
        how: 'stripe',
        session: s.id,
      });
      savePools();
      const cfg = await loadConfig();
      for (const a of cfg.admins) await notify(a, `${s.metadata.anonymous ? 'Someone' : name} put $${amount} into "${p.title}".`, {});
    }
    if (s.metadata?.order) await shopPaid(s); // the shop (below)
  }
  if (event.type === 'checkout.session.expired' && event.data.object.metadata?.order) {
    // An abandoned checkout: its hold ends now (needs "checkout.session.expired" ticked on the Stripe webhook)
    const o = own((await loadShop()).orders, event.data.object.metadata.order);
    if (o?.status === 'Pending') {
      o.status = 'Expired';
      saveShop();
    }
  }
  return json(res, { received: true });
}

// ── /api/shop: merch and digital products — data/shop.json ──
// Physical items: Stripe collects the shipping address; orders show in the Business portal to fulfil.
// Digital items: the file (or folder) in a space is delivered as a private download link (the share-link
// system: 7 days, shown on the thank-you page). Stock counts down on each paid order.
let shopDb = null;
let shopSaved = Promise.resolve();
const loadShop = async () => (shopDb ??= await readJson('shop.json', { products: {}, orders: {} }));
const saveShop = () => (shopSaved = shopSaved.then(() => saveJson('shop.json', shopDb)).catch(console.error));
// What the shop sells; the storefront filters by these (labels live in store.html and the Admin Panel)
const SHOP_CATEGORIES = ['merch', 'presets', 'vocal-chains', 'samples', 'software', 'courses', 'other'];
// Capsule drops: a product can go on sale at a set time (a countdown until then), belong to a named capsule, and
// retire to The Vault (a public gallery of past pieces, not for sale) when it sells out or is retired by hand.
// Checkout holds: an unpaid Stripe checkout holds its items for HOLD_MS (the session expires then), so a limited
// drop can't be oversold by people paying at the same time.
// Stripe stops taking payment at 31 minutes; the extra 14 are for a payment made at the last moment whose webhook
// is slow. An expired checkout ends its hold at once (checkout.session.expired); a late payment that finds the
// stock gone is marked Oversold for an admin to refund (shopPaid).
const HOLD_MS = 45 * 60_000;
const buyTries = new Map(); // hashed address -> { n, since }
/**
 * An address for limits: IPv4 as is; IPv6 cut to its /64 (one household or phone gets a whole /64), with "::"
 * expanded first so "2001:db8::a:b:c:d" and "2001:db8::1" are the same network.
 */
function net64(addr) {
  const a = addr
    .replace(/%.*$/, '')
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
    .toLowerCase();
  if (!a.includes(':')) return a;
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}
const held = (db, p) =>
  Object.values(db.orders)
    .filter((o) => o.product === p.id && o.status === 'Pending' && Date.now() - Date.parse(o.created) < HOLD_MS)
    .reduce((n, o) => n + o.qty, 0);
const productView = (p, admin, db = shopDb) => {
  const left = p.stock === null ? null : Math.max(0, p.stock - (db ? held(db, p) : 0));
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    price: p.price,
    kind: p.kind,
    category: p.category || (p.kind === 'digital' ? 'other' : 'merch'),
    image: p.image,
    soldOut: p.stock !== null && p.stock <= 0,
    left: admin || (left !== null && left <= 10) ? left : null, // "Only 3 left" (the public only sees it when it's low)
    dropAt: p.dropAt || null, // on sale from this moment (ISO); a countdown until then
    capsule: p.capsule || '',
    vault: !!p.vault || (p.stock !== null && p.stock <= 0), // in The Vault: shown, never sold
    ...(admin
      ? { stock: p.stock, active: p.active, retired: !!p.vault, file: p.file ? { space: p.file.space, path: p.file.path } : null }
      : {}),
  };
};

async function shopApi(req, res, url) {
  const db = await loadShop();
  const [, , , a, b] = url.pathname.split('/'); // /api/shop/<slug|order|admin|images|products>/<id>
  if (req.method === 'GET' && !a)
    return json(res, {
      products: Object.values(db.products)
        .filter((p) => p.active && !p.deleted)
        .map((p) => productView(p)),
      payments: stripeReady(),
    });
  if (req.method === 'GET' && a === 'images') return stream(req, res, url.searchParams, join(DATA, 'shop', 'images', safeName(b)));
  if (req.method === 'GET' && a === 'order') {
    // The thank-you page looks its order up by Stripe's session id (unguessable, only the buyer has it)
    const o = Object.values(db.orders).find((x) => x.session === b) || fail(404, 'No such order');
    const links = await loadLinks();
    const dl =
      o.download && links[o.download] && !links[o.download].revoked
        ? { url: `/s/${o.download}`, expires: links[o.download].expires }
        : null;
    return json(res, {
      status: o.status,
      oversold: !!o.oversold, // sold out while they paid (stays true once refunded)
      title: o.title,
      qty: o.qty,
      amount: o.amount,
      kind: o.kind,
      download: o.status !== 'Pending' ? dl : null,
    });
  }
  if (req.method === 'POST' && b === 'buy') {
    const p =
      Object.values(db.products).find((x) => (x.id === a || x.slug === a) && x.active && !x.deleted) || fail(404, 'No such product');
    if (!stripeReady()) fail(503, "The shop isn't taking payments yet");
    const asked = Math.max(1, Math.min(10, Math.floor(Number((await jsonBody(req)).qty) || 1)));
    const qty = p.kind === 'digital' ? 1 : asked; // one download link per order
    if (p.vault) fail(409, 'This piece is in The Vault: no longer for sale');
    if (p.dropAt && Date.parse(p.dropAt) > Date.now()) fail(409, `This drops ${new Date(p.dropAt).toUTCString()}`);
    // Holds can't be hoarded: 20 checkouts an hour per address, and one open checkout per address per item
    // (starting a new one releases the last). ponytail: many addresses at once can still tie up a drop for 45 min.
    const who = createHash('sha256')
      .update(net64(String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress)))
      .digest('hex')
      .slice(0, 16);
    const t = buyTries.get(who);
    const tries = t && Date.now() - t.since < 60 * 60_000 ? t : { n: 0, since: Date.now() };
    if (tries.n >= 20) fail(429, 'Too many checkouts from here. Try again in an hour.');
    if (buyTries.size > 5000) for (const [k, x] of buyTries) if (Date.now() - x.since > 60 * 60_000) buyTries.delete(k);
    buyTries.set(who, { ...tries, n: tries.n + 1 });
    // This buyer's own open checkout for it doesn't count against them: the new one replaces it once it exists
    const mine = Object.values(db.orders).filter((o) => o.product === p.id && o.status === 'Pending' && o.who === who);
    const left = p.stock === null ? Infinity : p.stock - held(db, p) + mine.reduce((n, o) => n + o.qty, 0);
    if (left < qty)
      fail(
        409,
        left > 0 ? `Only ${left} left` : p.stock > 0 ? 'All left are in checkouts right now. Try again in half an hour.' : 'Sold out',
      );
    const order = {
      id: randomUUID().slice(0, 10),
      product: p.id,
      title: p.title,
      kind: p.kind,
      qty,
      amount: p.price * qty,
      status: 'Pending',
      created: new Date().toISOString(),
      who, // a hash of the buyer's address, only to limit open checkouts
    };
    db.orders[order.id] = order; // held from now, before waiting on Stripe, so two buyers can't take the same last one
    const session = await stripe('/checkout/sessions', {
      mode: 'payment',
      line_items: {
        0: { quantity: qty, price_data: { currency: 'usd', unit_amount: Math.round(p.price * 100), product_data: { name: p.title } } },
      },
      ...(p.kind === 'physical' ? { shipping_address_collection: { allowed_countries: { 0: 'US', 1: 'CA' } } } : {}),
      success_url: `${siteOrigin(req)}/shop/thanks?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin(req)}/shop/${p.slug}`,
      metadata: { order: order.id },
      expires_at: Math.floor((Date.now() + 31 * 60_000) / 1000), // before the hold ends (Stripe's minimum is 30 min)
    }).catch((e) => {
      delete db.orders[order.id];
      throw e;
    });
    order.session = session.id;
    for (const o of mine) {
      // the old checkout stops holding stock, and Stripe closes it so it can't be paid any more
      if (o.status !== 'Pending') continue; // paid while we waited on Stripe: it's a real order now
      o.status = 'Replaced';
      if (o.session) await stripe(`/checkout/sessions/${encodeURIComponent(o.session)}/expire`, {}).catch(() => {});
    }
    saveShop();
    return json(res, { url: session.url });
  }

  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  if (!user.admin) fail(403, 'Only admins can manage the shop');
  if (a === 'images' && req.method === 'PUT') {
    const name = safeName(url.searchParams.get('name'));
    if (!THUMBABLE.has(extname(name).toLowerCase())) fail(400, 'Product images must be pictures');
    await mkdir(join(DATA, 'shop', 'images'), { recursive: true });
    const id = randomUUID().slice(0, 12);
    const original = join(DATA, 'shop', 'images', `${id}-original${extname(name).toLowerCase()}`); // kept as uploaded
    await pipeline(req, createWriteStream(original));
    const img = await imageInput(original, (await stat(original)).size).catch(() => fail(400, "That picture couldn't be read"));
    await img
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join(DATA, 'shop', 'images', `${id}.webp`));
    return json(res, { url: `/api/shop/images/${id}.webp` });
  }
  if (a === 'admin' && req.method === 'GET')
    return json(
      res,
      Object.values(db.products)
        .filter((p) => !p.deleted)
        .map((p) => productView(p, true)),
    );
  if (a === 'products') {
    const input = req.method === 'POST' || req.method === 'PATCH' ? await jsonBody(req) : {};
    const apply = async (p) => {
      if (input.title !== undefined) p.title = String(input.title).trim().slice(0, 120) || p.title;
      if (input.description !== undefined) p.description = String(input.description).slice(0, 4000);
      if (input.price !== undefined) p.price = Math.max(0.5, money(input.price));
      if (input.kind !== undefined) p.kind = input.kind === 'digital' ? 'digital' : 'physical';
      if (input.category !== undefined)
        p.category = SHOP_CATEGORIES.includes(input.category) ? input.category : fail(400, 'Unknown category');
      if (input.stock !== undefined)
        p.stock = input.stock === null || input.stock === '' ? null : Math.max(0, Math.floor(Number(input.stock) || 0));
      if (input.active !== undefined) p.active = !!input.active;
      if (input.dropAt !== undefined)
        p.dropAt = !input.dropAt
          ? null
          : !isNaN(Date.parse(input.dropAt))
            ? new Date(input.dropAt).toISOString()
            : fail(400, 'Pick a drop date and time');
      if (input.capsule !== undefined)
        p.capsule = String(input.capsule ?? '')
          .trim()
          .slice(0, 60);
      if (input.vault !== undefined) p.vault = !!input.vault;
      if (input.image !== undefined) p.image = input.image && /^\/api\/shop\/images\/[\w-]+\.webp$/.test(input.image) ? input.image : null;
      if (input.file !== undefined) {
        // Digital product: remember where the file is on its drive, so the delivery link survives spaces changing
        if (!input.file) p.file = null;
        else {
          const ref = fileRef(input.file);
          const space = spacesFor(user, cfg, await loadStatus()).find((s) => s.id === ref.space) || fail(404, 'No such space');
          if (!space.online) fail(503, 'Drive offline');
          const { abs } = locateIn(space, ref.path);
          const s = (await stat(abs).catch(() => null)) || fail(404, 'That file is gone');
          p.file = { ...ref, ...onDrive(space, abs), isDir: s.isDirectory() };
        }
      }
    };
    if (req.method === 'POST' && !b) {
      const title =
        String(input.title || '')
          .trim()
          .slice(0, 120) || fail(400, 'Give the product a name');
      const base = slugify(title) || randomUUID().slice(0, 6);
      const p = {
        id: randomUUID().slice(0, 10),
        slug: Object.values(db.products).some((x) => x.slug === base) ? `${base}-${randomUUID().slice(0, 4)}` : base,
        title,
        description: '',
        price: 20,
        kind: 'physical',
        stock: null,
        image: null,
        file: null,
        active: false,
        created: new Date().toISOString(),
      };
      await apply(p);
      db.products[p.id] = p;
      saveShop();
      return json(res, productView(p, true));
    }
    const p = (own(db.products, b) && !db.products[b].deleted && db.products[b]) || fail(404, 'No such product');
    if (req.method === 'PATCH') {
      await apply(p);
      if (p.active && p.kind === 'digital' && !p.file) fail(400, 'Pick the file to deliver before putting a digital product on sale');
      saveShop();
      return json(res, productView(p, true));
    }
    if (req.method === 'DELETE') {
      p.deleted = new Date().toISOString(); // hidden, kept with its orders
      saveShop();
      return json(res, { ok: true });
    }
  }
  fail(404, 'Unknown shop action');
}

/** Called from the Stripe webhook when an order is paid: mark it, count stock down, deliver digital files. */
async function shopPaid(s) {
  const db = await loadShop();
  const o = own(db.orders, s.metadata.order);
  // Money really arrived: a replaced or expired checkout that was paid anyway still counts
  if (!o || !['Pending', 'Replaced', 'Expired'].includes(o.status) || s.payment_status !== 'paid') return;
  const p = own(db.products, o.product);
  if (p && p.stock !== null && p.stock < o.qty) {
    // Paid after its hold ran out and someone else got the last ones: never counted as sold, flagged to refund
    Object.assign(o, { status: 'Oversold', oversold: true, paid: new Date().toISOString(), amount: (s.amount_total || 0) / 100 });
    saveShop();
    for (const a of (await loadConfig()).admins)
      await notify(
        a,
        `Oversold: an order for ${o.qty} × ${o.title} was paid after the last ones sold. Refund it in Stripe (Business > Orders).`,
        {},
      );
    return;
  }
  o.status = o.kind === 'digital' ? 'Delivered' : 'Paid';
  o.paid = new Date().toISOString();
  o.amount = (s.amount_total || 0) / 100;
  o.customer = {
    name: s.customer_details?.name || '',
    email: s.customer_details?.email || '',
    address: s.shipping_details?.address || s.customer_details?.address || null,
    shipTo: s.shipping_details?.name || null,
  };
  if (p && p.stock !== null) p.stock = Math.max(0, p.stock - o.qty);
  if (p?.kind === 'digital' && p.file) {
    const token = randomBytes(24).toString('base64url');
    (await loadLinks())[token] = {
      drive: p.file.drive,
      dpath: p.file.dpath,
      name: p.file.dpath.split('/').pop(),
      isDir: p.file.isDir,
      createdBy: 'shop',
      created: new Date().toISOString(),
      expires: new Date(Date.now() + 7 * 864e5).toISOString(),
      password: null,
      download: true,
      views: 0,
      downloads: 0,
      order: o.id,
    };
    saveLinks();
    o.download = token;
  }
  saveShop();
  const cfg = await loadConfig();
  for (const a of cfg.admins)
    await notify(
      a,
      `New order: ${o.qty} × ${o.title} ($${o.amount})${o.kind === 'physical' ? ' — ship it from Business > Orders' : ' (delivered automatically)'}.`,
      {},
    );
}

// The public pool and shop pages (no account): /pool/<slug>, /shop, /shop/<product>, /shop/thanks
const STORE_PAGE = new URL('./store.html', import.meta.url);
function storePage(req, res, url) {
  if (!/^\/(pool|shop)(\/[\w-]+)?\/?$/.test(url.pathname)) return staticFile(req, res, url);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'content-security-policy':
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'",
  });
  return pipeline(createReadStream(STORE_PAGE), res);
}

// ── /api/raw: the RapidRAW photo editor, running on this PC (github.com/brahimaann/rapidraw-sanktuary) ──
// The editor UI is served at /apps/rapidraw/ and talks to /api/raw/*; this passes a fixed list of editing
// commands to the RapidRAW engine's bridge on 127.0.0.1 (RAPIDRAW_BRIDGE, token RAPIDRAW_TOKEN).
// The browser only ever sees Sanktuary paths ("sk://<space>/<path>"): each one is checked against the member's
// rights and turned into a real path on the way in, and real paths are turned back on the way out.
// RapidRAW edits one image at a time, so one member edits at a time (10 minutes idle frees it).
const RAW_BRIDGE = process.env.RAPIDRAW_BRIDGE || 'http://127.0.0.1:3091';
const RAW_UI = process.env.RAPIDRAW_UI || 'C:\\homeserver\\rapidraw\\ui';
const RAW_IDLE = 10 * 60_000;
let rawSession = null; // { user, at }
// command -> which arguments are paths, and the rights each needs
const RAW_COMMANDS = {
  load_image: { path: 'view' },
  load_metadata: { path: 'view' },
  get_image_dimensions: { path: 'view' },
  list_images_in_dir: { path: 'view' },
  save_metadata_and_update_thumbnail: { path: 'upload' }, // writes the edit next to the photo (.rrdata)
  export_images: { paths: 'view', outputFolderOrFile: 'upload', baseOriginFolders: 'view', currentEditPath: 'view' },
  apply_adjustments: {},
  generate_uncropped_preview: {},
  calculate_auto_adjustments: {},
  get_supported_file_types: {},
  load_settings: {},
  load_presets: {},
};

async function rawApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const status = await loadStatus();
  const spaces = spacesFor(user, cfg, status).filter((s) => s.online);
  const action = url.pathname.split('/')[3]; // /api/raw/<invoke|events|file|status>/<command>

  // sk://space/a/b -> checked real path (the spaces used are preferred when mapping answers back)
  const used = new Set();
  const toReal = (value, level) => {
    const m = /^sk:\/\/([\w-]+)\/?(.*)$/.exec(String(value || '')) || fail(400, 'Paths must be Sanktuary paths (sk://...)');
    const space = spaces.find((s) => s.id === m[1]) || fail(404, 'No such space');
    used.add(space.id);
    if (RANK[space.rights] < RANK[level]) fail(403, `You need ${level} rights in ${space.name}`);
    return locateIn(space, decodeURIComponent(m[2])).abs;
  };
  // real paths in answers -> sk://space/...
  // Deepest root first; among spaces over the same folder, the one this request used
  // [real root, sk path prefix, space id]; each folder of a combined space is its own root ("space/Label")
  const roots = () =>
    spaces
      .flatMap((s) =>
        s.sources
          ? s.sources.filter((f) => f.online).map((f) => [resolve(f.root).toLowerCase(), `${s.id}/${f.label}`, s.id])
          : [[resolve(s.root).toLowerCase(), s.id, s.id]],
      )
      .sort((a, b) => b[0].length - a[0].length || used.has(b[2]) - used.has(a[2]));
  const toSk = (v) => {
    if (typeof v === 'string' && (process.platform === 'win32' ? /^[a-z]:[\\/]/i : /^\//).test(v)) {
      const l = v.toLowerCase();
      // whole folders only: D:\team must not claim D:\teamx
      const hit = roots().find(([r]) => l.startsWith(r) && (l.length === r.length || /[\\/]$/.test(r) || /[\\/]/.test(l[r.length])));
      return hit
        ? `sk://${hit[1]}/${v
            .slice(hit[0].length)
            .replace(/^[\\/]+/, '')
            .split(/[\\/]/)
            .join('/')}`
        : '(outside Sanktuary)';
    }
    if (Array.isArray(v)) return v.map(toSk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toSk(x)]));
    return v;
  };
  const claim = () => {
    if (rawSession && rawSession.user !== user.username && Date.now() - rawSession.at < RAW_IDLE)
      fail(423, `The photo editor is in use by ${rawSession.user}. Try again in a few minutes.`);
    rawSession = { user: user.username, at: Date.now() };
  };
  const bridge = (path, init = {}) =>
    fetch(RAW_BRIDGE + path, {
      ...init,
      headers: { 'x-bridge-token': process.env.RAPIDRAW_TOKEN || '', 'content-type': 'application/json', ...init.headers },
    }).catch(() => fail(503, "The photo editor isn't running on the server right now"));

  if (req.method === 'GET' && action === 'status') {
    const up = await fetch(RAW_BRIDGE + '/invoke/get_supported_file_types', {
      method: 'POST',
      headers: { 'x-bridge-token': process.env.RAPIDRAW_TOKEN || '' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => r.ok)
      .catch(() => false);
    const busy = rawSession && Date.now() - rawSession.at < RAW_IDLE && rawSession.user !== user.username ? rawSession.user : null;
    return json(res, { running: up, installed: existsSync(join(RAW_UI, 'index.html')), busyBy: busy });
  }
  if (req.method === 'GET' && action === 'file') return stream(req, res, url.searchParams, toReal(url.searchParams.get('path'), 'view'));
  if (req.method === 'GET' && action === 'events') {
    claim();
    const r = await bridge('/events');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
    req.on('close', () => r.body?.cancel().catch(() => {}));
    for await (const chunk of r.body)
      res.write(
        Buffer.from(chunk)
          .toString('utf8')
          .replace(/[a-z]:\\\\[^"]*/gi, (p) => toSk(p.replace(/\\\\/g, '\\'))),
      );
    return res.end();
  }
  if (req.method === 'POST' && action === 'invoke') {
    const command = url.pathname.split('/')[4];
    const spec = RAW_COMMANDS[command] || fail(403, `${command} isn't available in the Sanktuary editor`);
    const args = await jsonBody(req);
    const original = String(args.path || ''); // sk://space/... as the member sent it
    if (command === 'export_images') {
      // The engine builds export names from these and joins them onto folders without checking: no climbing
      // out with "..", no drive letters, no separators in the name. "Next to the originals" writes into the
      // photos' own folders, so it needs upload rights there, not just on the chosen destination.
      const s = args.exportSettings || {};
      if (s.filenameTemplate != null && (typeof s.filenameTemplate !== 'string' || /[\\/:]|\.\./.test(s.filenameTemplate)))
        fail(400, 'File name templates cannot contain / \\ : or ..');
      if (s.subfolder != null && (typeof s.subfolder !== 'string' || /:|(^|[\\/])\.\.([\\/]|$)/.test(s.subfolder)))
        fail(400, 'Export subfolders cannot contain .. or a drive letter');
      if (s.destinationType === 'originalFolder') for (const p of [].concat(args.paths || [])) toReal(p, 'upload');
    }
    for (const [key, level] of Object.entries(spec)) {
      if (args[key] == null) continue;
      args[key] = Array.isArray(args[key]) ? args[key].map((v) => toReal(v, level)) : toReal(args[key], level);
    }
    claim(); // only once the request is known to be allowed
    const r = await bridge(`/invoke/${command}`, { method: 'POST', body: JSON.stringify(args) });
    if (!r.ok)
      fail(
        r.status === 401 ? 503 : 400,
        (await r.text()).replace(/[a-z]:[\\/][^\s"']*/gi, (p) => toSk(p)),
      );
    if (command === 'save_metadata_and_update_thumbnail') {
      const [, , space, ...rest] = original.split('/');
      const s = spaces.find((x) => x.id === space);
      if (s && s.id !== 'me')
        logActivity(user, 'edited the photo', { space: s.id, spaceName: s.name, path: decodeURIComponent(rest.join('/')) });
    }
    if ((r.headers.get('content-type') || '').includes('json')) return json(res, toSk(await r.json()));
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
    return pipeline(r.body, res);
  }
  fail(404, 'Not found');
}

const RAPIDRAW_HOMEPAGE_INJECTION = `
<style id="sk-rr-clean-home">
  /* RapidRAW Simplified Homepage: Only Open Folder & Settings buttons, centered */
  .w-1\\/2.hidden.md\\:block,
  div:has(> * > img[alt="Splash screen background"]),
  img[alt="Splash screen background"],
  img[src*="-ambient"],
  .absolute.inset-0.-z-10 {
    display: none !important;
  }
  .w-full.md\\:w-1\\/2 {
    width: 100% !important;
    max-width: 100% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: #c0c0c0 !important;
  }
  div:has(> .w-1\\/2.hidden.md\\:block),
  .flex-1.flex.h-full.p-2.bg-transparent > div {
    background: #c0c0c0 !important;
    border: none !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100% !important;
  }
  .my-auto.text-left > div:not(.flex.flex-col),
  .my-auto.text-left > p,
  .my-auto.text-left > span,
  .my-auto.text-left > h1,
  .my-auto.text-left > h2,
  .my-auto.text-left > h3 {
    display: none !important;
  }
  .absolute.bottom-8,
  .absolute.bottom-8 * {
    display: none !important;
  }
  .my-auto.text-left {
    margin: auto !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100% !important;
    max-width: 340px !important;
    padding: 20px !important;
  }
  .my-auto.text-left > .flex.flex-col {
    align-items: center !important;
    justify-content: center !important;
    margin: 0 auto !important;
    width: 100% !important;
  }
  .my-auto.text-left button {
    background: #c0c0c0 !important;
    color: #000000 !important;
    border: 2px outset #ffffff !important;
    border-radius: 0px !important;
    font-family: Tahoma, 'MS Sans Serif', sans-serif !important;
    font-weight: bold !important;
    box-shadow: 1px 1px 0px #000000 !important;
    cursor: pointer !important;
  }
  .my-auto.text-left button:active {
    border: 2px inset #ffffff !important;
    box-shadow: none !important;
  }
</style>
<script>
window.__rapidraw_open_dialog = function() {
  return new Promise(async (resolve) => {
    let root = document.getElementById('sk-rr-dialog-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'sk-rr-dialog-root';
      root.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999999;display:flex;align-items:center;justify-content:center;font-family:Tahoma,sans-serif;font-size:12px;color:#000;';
      root.innerHTML = \`
        <div style="width:min(440px,94vw);background:#c0c0c0;border:2px outset #fff;box-shadow:2px 2px 8px rgba(0,0,0,0.5);display:flex;flex-direction:column;">
          <div style="background:linear-gradient(90deg,#000080,#1084d0);color:#fff;font-weight:bold;padding:4px 6px;display:flex;justify-content:space-between;align-items:center;font-size:11px;">
            <span>Open Folder - SANKTUARY</span>
            <button id="sk-rr-close" style="background:#c0c0c0;border:1px outset #fff;font-weight:bold;font-size:10px;line-height:1;padding:1px 4px;cursor:pointer;">✕</button>
          </div>
          <div style="padding:10px;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:55px;font-weight:500;">Look in:</label>
              <select id="sk-rr-space-select" style="flex:1;background:#fff;border:2px inset #dfdfdf;padding:3px 4px;font-size:12px;outline:none;">
              </select>
            </div>
            <div id="sk-rr-dir-list" style="background:#fff;border:2px inset #808080;height:180px;overflow-y:auto;padding:4px;display:flex;flex-direction:column;gap:2px;">
              <div style="color:#666;padding:4px;">Loading spaces...</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:55px;font-weight:500;">Folder:</label>
              <input id="sk-rr-path-input" style="flex:1;background:#fff;border:2px inset #dfdfdf;padding:3px 4px;font-size:12px;outline:none;" value="sk://drive" />
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
              <button id="sk-rr-btn-open" style="background:#c0c0c0;border:2px outset #fff;font-weight:bold;padding:4px 18px;min-width:75px;cursor:pointer;">Open</button>
              <button id="sk-rr-btn-cancel" style="background:#c0c0c0;border:2px outset #fff;padding:4px 18px;min-width:75px;cursor:pointer;">Cancel</button>
            </div>
          </div>
        </div>
      \`;
      document.body.appendChild(root);
    } else {
      root.style.display = 'flex';
    }

    const spaceSelect = root.querySelector('#sk-rr-space-select');
    const dirList = root.querySelector('#sk-rr-dir-list');
    const pathInput = root.querySelector('#sk-rr-path-input');
    const btnOpen = root.querySelector('#sk-rr-btn-open');
    const btnCancel = root.querySelector('#sk-rr-btn-cancel');
    const btnClose = root.querySelector('#sk-rr-close');

    let currentSpace = '';
    let currentDir = [];

    const closeDialog = (val) => {
      root.style.display = 'none';
      resolve(val);
    };

    btnCancel.onclick = () => closeDialog(null);
    btnClose.onclick = () => closeDialog(null);
    btnOpen.onclick = () => {
      const p = pathInput.value.trim();
      closeDialog(p || ('sk://' + (currentSpace || 'drive')));
    };

    pathInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnOpen.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        btnCancel.click();
      }
    };

    const updatePath = () => {
      const p = 'sk://' + currentSpace + (currentDir.length ? '/' + currentDir.join('/') : '');
      pathInput.value = p;
    };

    const loadDir = async () => {
      dirList.innerHTML = '<div style="color:#666;padding:4px;">Loading folders...</div>';
      updatePath();
      try {
        const url = '/api/files/' + currentSpace + '/' + currentDir.map(encodeURIComponent).join('/') + '?list';
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to list directory');
        const data = await res.json();
        dirList.innerHTML = '';

        if (currentDir.length > 0) {
          const upRow = document.createElement('div');
          upRow.style.cssText = 'padding:3px 6px;cursor:pointer;display:flex;align-items:center;gap:6px;';
          upRow.innerHTML = '📁 <b>.. (Up)</b>';
          upRow.onclick = () => {
            currentDir.pop();
            loadDir();
          };
          dirList.appendChild(upRow);
        }

        const folders = (data.entries || []).filter(e => e.isDir);
        if (folders.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'color:#888;padding:8px;font-style:italic;';
          empty.textContent = '(No subfolders - click Open to select this folder)';
          dirList.appendChild(empty);
        } else {
          folders.forEach(f => {
            const row = document.createElement('div');
            row.style.cssText = 'padding:3px 6px;cursor:pointer;display:flex;align-items:center;gap:6px;';
            row.textContent = '📁 ' + f.name; // text, never HTML: folder names come from the drive
            row.onmouseover = () => { row.style.background = '#000080'; row.style.color = '#fff'; };
            row.onmouseout = () => { row.style.background = ''; row.style.color = '#000'; };
            row.onclick = () => {
              pathInput.value = 'sk://' + currentSpace + '/' + [...currentDir, f.name].join('/');
            };
            row.ondblclick = () => {
              currentDir.push(f.name);
              loadDir();
            };
            dirList.appendChild(row);
          });
        }
      } catch (err) {
        dirList.innerHTML = '<div style="color:#c00;padding:4px;"></div>';
        dirList.firstChild.textContent = 'Error: ' + err.message;
      }
    };

    try {
      const meRes = await fetch('/api/me', { credentials: 'include' });
      const me = meRes.ok ? await meRes.json() : null;
      const spaces = (me?.spaces || []).filter(s => s.online);
      spaceSelect.innerHTML = '';
      if (spaces.length === 0) {
        spaceSelect.innerHTML = '<option value="drive">Drive</option>';
        currentSpace = 'drive';
      } else {
        spaces.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name || s.id;
          spaceSelect.appendChild(opt);
        });
        currentSpace = spaces[0].id;
      }
      spaceSelect.onchange = () => {
        currentSpace = spaceSelect.value;
        currentDir = [];
        loadDir();
      };
      await loadDir();
    } catch {
      currentSpace = 'drive';
      updatePath();
    }
  });
};
</script>
`;

/** The editor's own page and scripts, from the folder ops/rapidraw/setup.ps1 builds them into. */
function rawUi(req, res, url) {
  if (!existsSync(join(RAW_UI, 'index.html'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(
      '<body style="font:13px Tahoma,sans-serif;background:#c0c0c0;padding:16px"><b>The photo editor isn\'t installed on the server yet.</b><p>An admin runs <code>ops\\rapidraw\\setup.ps1</code> on the home server PC.</p></body>',
    );
  }
  const rel = decodeURIComponent(url.pathname.replace(/^\/apps\/rapidraw\/?/, ''));
  const file = resolve(RAW_UI, rel || 'index.html');
  const target =
    inside(resolve(RAW_UI), file) && existsSync(file) && !statSyncSafe(file)?.isDirectory() ? file : join(RAW_UI, 'index.html');
  res.writeHead(200, {
    'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
    'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (target.endsWith('index.html')) {
    const rawHtml = readFileSync(target, 'utf8');
    const injected = rawHtml.replace('</head>', `${RAPIDRAW_HOMEPAGE_INJECTION}</head>`);
    return res.end(injected);
  }
  return pipeline(createReadStream(target), res);
}
const statSyncSafe = (f) => {
  try {
    return statSync(f);
  } catch {
    return null;
  }
};

// The public blog page: sanktuary.studio/blog (and /blog/<post>), no account needed
const BLOG_PAGE = new URL('./blog.html', import.meta.url);
function blogPage(req, res, url) {
  if (!/^\/blog(\/[\w-]+){0,2}\/?$/.test(url.pathname)) return staticFile(req, res, url);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' https: data:",
  });
  return pipeline(createReadStream(BLOG_PAGE), res);
}

// ── Stories: a folder of photos and videos told as a full-screen guided story at /story/<slug> ──
// (the first one: Heart of the Cities). Admins pick the folder in Admin Panel > Stories; each subfolder becomes a
// chapter, "photo.txt" next to "photo.jpg" is its caption, and captions / order / hiding are edited there. The story
// points at drive + path so it survives spaces changing. Visitors only ever get resized pictures (never the
// original files), and only the files the story lists, from inside its folder.
const STORY_PAGE = new URL('./story.html', import.meta.url);
const STORY_IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff']);
const STORY_VIDEO = new Set(['.mp4', '.m4v', '.webm', '.mov']);
const STORY_WIDTHS = [800, 1600, 2400];
let storiesDb = null;
let storiesSaved = Promise.resolve();
const loadStories = async () => (storiesDb ??= await readJson('stories.json', { stories: {} }));
const saveStories = () => (storiesSaved = storiesSaved.then(() => saveJson('stories.json', storiesDb)).catch(console.error));

/** The story's folder right now (drive letters can change), or null while its drive is unplugged. */
async function storyRoot(st) {
  const dir = driveDir(await loadConfig(), await loadStatus(), st.drive);
  return dir ? join(dir, st.dpath) : null;
}

/** Photos and videos in name order; one level of subfolders become chapters; "name.txt" is a caption. */
async function scanStory(root) {
  const items = [];
  const add = async (dir, chapter) => {
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((e) => !HIDDEN.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const names = new Set(entries.map((e) => e.name.toLowerCase()));
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!chapter) await add(join(dir, e.name), e.name.slice(0, 100));
        continue;
      }
      const ext = extname(e.name).toLowerCase();
      const kind = STORY_IMAGE.has(ext) ? 'image' : STORY_VIDEO.has(ext) ? 'video' : null;
      if (!kind || items.length >= 500) continue;
      const base = e.name.slice(0, e.name.length - ext.length);
      const caption = names.has(`${base}.txt`.toLowerCase())
        ? (await readFile(join(dir, `${base}.txt`), 'utf8').catch(() => '')).trim().slice(0, 1000)
        : '';
      items.push({ file: relative(root, join(dir, e.name)).split(sep).join('/'), kind, chapter, caption, hidden: false });
    }
  };
  await add(root, '');
  return items;
}

async function storiesApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  if (!user.admin) fail(403, 'Administrators only');
  const db = await loadStories();
  const slug = url.pathname.split('/')[3];
  const now = new Date().toISOString();
  if (req.method === 'GET' && !slug)
    return json(
      res,
      Object.values(db.stories).filter((st) => !st.deleted),
    );
  if (req.method === 'POST' && !slug) {
    const input = await jsonBody(req);
    const title =
      String(input.title || '')
        .trim()
        .slice(0, 100) || fail(400, 'Give the story a title');
    const ref = fileRef(input.folder) || fail(400, 'Pick the folder with the photos and videos');
    const space = spacesFor(user, cfg, await loadStatus()).find((x) => x.id === ref.space) || fail(404, 'No such space');
    const { abs } = locateIn(space, ref.path);
    if (!(await stat(abs).catch(() => null))?.isDirectory()) fail(404, 'No such folder');
    const items = await scanStory(abs);
    if (!items.length) fail(400, 'There are no photos or videos in that folder');
    const base = slugify(title) || 'story';
    let id = base;
    for (let n = 2; own(db.stories, id) || id in Object.prototype; n++) id = `${base}-${n}`;
    const st = {
      slug: id,
      title,
      subtitle: '',
      intro: '',
      ...onDrive(space, abs),
      folderName: basename(abs),
      public: false,
      items,
      created: now,
      updated: now,
    };
    db.stories[id] = st;
    saveStories();
    return json(res, st);
  }
  const st = (own(db.stories, slug) && !db.stories[slug].deleted && db.stories[slug]) || fail(404, 'No such story');
  if (req.method === 'PATCH') {
    const input = await jsonBody(req);
    for (const [k, max] of Object.entries({ title: 100, subtitle: 200, intro: 4000 }))
      if (input[k] !== undefined) st[k] = String(input[k] ?? '').slice(0, max);
    if (!st.title.trim()) fail(400, 'Give the story a title');
    if (input.public !== undefined) st.public = !!input.public;
    if (Array.isArray(input.items)) {
      // Reorder, caption and hide: only files the story already lists (the server found them, not the browser)
      const known = new Map(st.items.map((i) => [i.file, i]));
      const next = [];
      for (const i of input.items) {
        const k = known.get(i?.file);
        if (!k || next.some((x) => x.file === k.file)) continue;
        next.push({ ...k, caption: String(i.caption ?? k.caption).slice(0, 1000), hidden: !!i.hidden });
      }
      st.items = [...next, ...st.items.filter((i) => !next.some((x) => x.file === i.file))];
    }
    if (input.rescan) {
      // New files are added at the end, removed ones drop out; order and captions of the rest stay
      const root = (await storyRoot(st)) || fail(503, "The story's drive isn't connected");
      const found = await scanStory(root);
      const still = new Set(found.map((i) => i.file));
      const had = new Set(st.items.map((i) => i.file));
      st.items = [...st.items.filter((i) => still.has(i.file)), ...found.filter((i) => !had.has(i.file))];
    }
    st.updated = now;
    saveStories();
    return json(res, st);
  }
  if (req.method === 'DELETE') {
    st.deleted = now; // kept in the file, just hidden; the photos themselves are never touched
    st.public = false;
    saveStories();
    return json(res, { ok: true });
  }
  fail(404, 'Unknown story action');
}

/** /api/public/story/<slug> (the story) and /api/public/story/<slug>/<n>?w= (its n-th picture or video). */
async function storyPublic(req, res, url) {
  const [, , , , slug, n] = url.pathname.split('/');
  const st = own((await loadStories()).stories, slug);
  let ok = !!st && !st.deleted && st.public;
  if (st && !st.deleted && !ok) {
    // Admins can look at a story before it's public
    const user = await currentUser(req, url, await loadConfig()).catch(() => null);
    ok = !!user?.admin;
  }
  if (!ok) fail(404, 'No such story');
  const shown = st.items.filter((i) => !i.hidden);
  if (n === undefined || n === '') {
    if (st.public) count('view', `story:${st.slug}`);
    res.setHeader('cache-control', st.public ? 'public, max-age=60' : 'no-store');
    return json(res, {
      title: st.title,
      subtitle: st.subtitle,
      intro: st.intro,
      items: shown.map((i, k) => ({ n: k, kind: i.kind, chapter: i.chapter, caption: i.caption })),
    });
  }
  const item = (/^\d{1,4}$/.test(n) && shown[Number(n)]) || fail(404, 'Not found');
  const root = (await storyRoot(st)) || fail(503, 'This story is offline right now');
  const abs = resolve(root, ...item.file.split('/'));
  if (!inside(resolve(root), abs)) fail(400, 'Bad path');
  if (item.kind === 'image') {
    const w = Number(url.searchParams.get('w'));
    return thumb(res, abs, STORY_WIDTHS.includes(w) ? w : 1600);
  }
  return stream(req, res, new URLSearchParams(), abs);
}

function storyPage(req, res, url) {
  if (!/^\/story\/[\w-]{1,80}\/?$/.test(url.pathname)) fail(404, 'No such story');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
    'content-security-policy':
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'",
  });
  return pipeline(createReadStream(STORY_PAGE), res);
}

// ── Public release pages (/release/<slug>) and the portfolio (/portfolio) ──
// A release is public when "Announce publicly" is ticked and it isn't private to some members. Its page shows
// only the songs ticked "Show on the public page": title, credits, links, and (if a preview start is set) a
// 30-second clip. Covers are resized pictures. Full bounces and file names never leave the server.
const RELEASE_PAGE = new URL('./release.html', import.meta.url);
const PORTFOLIO_PAGE = new URL('./portfolio.html', import.meta.url);
// A page can be temporary (like a pre-release landing page): after "page ends on" it's gone, lists included
const publicRelease = (r) =>
  r && r.public && !r.deleted && !r.members && r.slug && !(r.pageUntil && r.pageUntil < new Date().toISOString().slice(0, 10));
// Where a release can be heard or pre-saved; shown as big buttons on its page (https links only)
const RELEASE_STORES = [
  'presave',
  'spotify',
  'appleMusic',
  'youtubeMusic',
  'tidal',
  'amazonMusic',
  'deezer',
  'soundcloud',
  'bandcamp',
  'audiomack',
];

/** A public release's page address, /release/<slug>: given once, then fixed so shared links keep working. */
function giveSlug(db, r) {
  if (r.slug) return;
  const base = slugify(r.title) || 'release';
  let slug = base;
  for (let n = 2; Object.values(db.releases).some((x) => x !== r && x.slug === slug); n++) slug = `${base}-${n}`;
  r.slug = slug;
  saveTracks();
}
/** Releases made public before pages existed get their address the first time anything public is read. */
async function publicTracks() {
  const db = await loadTracks();
  for (const r of Object.values(db.releases)) if (r.public && !r.deleted && !r.members) giveSlug(db, r);
  return db;
}

/** A file a release points at, as the server (not a member) sees it; null if its space or drive is gone. */
async function releaseFile(ref) {
  if (!ref || ref.space === 'me') return null;
  const space = spacesFor({ username: '', admin: true }, await loadConfig(), await loadStatus()).find((x) => x.id === ref.space);
  if (!space?.online) return null;
  try {
    return locateIn(space, ref.path).abs;
  } catch {
    return null;
  }
}

async function releaseView(r) {
  const tdb = await loadTracks();
  const st = r.story && (await loadStories()).stories[r.story];
  const tracks = Object.values(tdb.tracks)
    .filter((t) => t.release === r.id && !t.deleted && t.onPage)
    .sort((a, b) => a.n - b.n)
    .map((t) => ({
      id: t.id,
      n: t.n,
      title: t.title,
      slug: slugify(t.title) || t.id,
      credits: t.credits || '',
      links: Object.fromEntries(Object.entries(t.links || {}).filter(([, v]) => /^https:\/\//.test(v))),
      preview: t.previewAt !== null && t.previewAt !== undefined && !!t.bounce,
    }));
  return {
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    date: r.date,
    artist: r.artist || '',
    blurb: r.blurb || '',
    stores: r.stores || {},
    video: r.videoId || null, // a YouTube video id, embedded from youtube-nocookie.com
    cover: !!r.cover,
    story: st && st.public && !st.deleted ? { slug: st.slug, title: st.title } : null,
    tracks,
  };
}

async function releasePublic(req, res, url) {
  const [, , , , slug, part, id] = url.pathname.split('/'); // /api/public/release/<slug>[/cover | /preview/<track>]
  const tdb = await publicTracks();
  const r = Object.values(tdb.releases).find((x) => x.slug === slug && publicRelease(x)) || fail(404, 'No such release');
  if (!part) {
    count('view', `release:${r.slug}`);
    res.setHeader('cache-control', 'public, max-age=60');
    return json(res, await releaseView(r));
  }
  if (part === 'cover') {
    const file = (await releaseFile(r.cover)) || fail(404, 'No cover');
    const w = Number(url.searchParams.get('w'));
    return thumb(res, file, [400, 800, 1600].includes(w) ? w : 800);
  }
  if (part === 'preview') {
    const t = own(tdb.tracks, id);
    if (!t || t.deleted || t.release !== r.id || !t.onPage || t.previewAt === null || t.previewAt === undefined) fail(404, 'No preview');
    const file = (await releaseFile(t.bounce)) || fail(404, 'No preview');
    res.setHeader('cache-control', 'public, max-age=3600');
    return stream(req, res, new URLSearchParams(), await audioClipFile(file, t.previewAt));
  }
  fail(404, 'Not found');
}

/** The portfolio: statement, bio and contact (Admin Panel > Front page), and everything that's public. */
async function portfolioPublic(req, res) {
  const front = await loadFront();
  const pf = front.portfolio || {};
  const tdb = await publicTracks();
  const today = localDate();
  const releases = await Promise.all(
    Object.values(tdb.releases)
      .filter(publicRelease)
      .sort((a, b) => (b.date || '9').localeCompare(a.date || '9'))
      .map(releaseView),
  );
  const stories = Object.values((await loadStories()).stories)
    .filter((st) => st.public && !st.deleted)
    .map((st) => ({ slug: st.slug, title: st.title, subtitle: st.subtitle, count: st.items.filter((i) => !i.hidden).length }));
  const events = Object.values((await loadTimeline()).items)
    .filter((i) => i.public && !i.members && i.status !== 'Cancelled')
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((i) => ({
      title: i.title,
      kind: i.kind,
      start: i.start,
      end: i.end,
      location: i.location,
      link: i.link || null,
      past: (i.end || i.start) < today,
    }));
  count('view', 'portfolio');
  res.setHeader('cache-control', 'public, max-age=60');
  return json(res, {
    name: pf.name || 'Sanktuary',
    tagline: pf.tagline || '',
    statement: pf.statement || '',
    bio: pf.bio || '',
    contact: pf.contact || '',
    links: String(pf.links || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https:\/\/\S+$/.test(l))
      .slice(0, 12),
    releases,
    stories,
    events,
    people: await listedPeople(),
  });
}

function htmlPage(file) {
  return (req, res, url) => {
    if (!/^\/(release|portfolio)(\/[\w-]{1,80}){0,2}\/?$/.test(url.pathname)) fail(404, 'Not found');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-security-policy':
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-src https://www.youtube-nocookie.com",
    });
    return pipeline(createReadStream(file), res);
  };
}

/** What the file window and Profile need to show about a project. */
const projectView = (p, me) => ({
  kind: p.kind,
  name: p.name,
  status: p.status,
  lock: p.lock && { user: p.lock.user, at: p.lock.at },
  turn: p.turn,
  queue: p.queue,
  following: p.followers.includes(me),
  followers: p.followers.length,
});

/** Is path p the folder root or somewhere under it? (A drive root like G:\ already ends in a separator.) */
const inside = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const safeName = (name) => (/^[^/\\:\x00-\x1f]+$/.test(name || '') && name !== '..' && name !== '.' ? name : fail(400, 'Bad name'));

async function listDir(dir, includeHidden = false) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return includeHidden ? [] : fail(404, 'Not found');
  // stat every entry at once: ~8x faster than one at a time on a spinning USB drive
  const stats = await Promise.all(
    entries.map((e) => (!includeHidden && HIDDEN.test(e.name) ? null : stat(join(dir, e.name)).catch(() => null))),
  );
  return entries.flatMap((e, i) =>
    stats[i] ? [{ name: e.name, isDir: stats[i].isDirectory(), size: stats[i].size, modified: stats[i].mtime.toISOString() }] : [],
  );
}

/** Moves the current file into .sk-versions/<path>/<timestamp><ext> so a replace never loses work. */
async function keepVersion(root, file) {
  if (!existsSync(file)) return;
  const dir = join(root, '.sk-versions', relative(root, file));
  await mkdir(dir, { recursive: true });
  await rename(file, join(dir, stamp() + extname(file)));
}

// Unused name in dir: "mix.wav" -> "mix (2).wav" so uploads never overwrite someone's work by accident.
function freeName(dir, name) {
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base} (${n})${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}

// Uploads arrive in chunks (Cloudflare caps a request at 100 MB), several at once for speed. Each chunk is written
// at its own offset in a hidden part file next to the destination; when every chunk has landed the part file is
// renamed into place. ?replace=1 (edit rights) swaps the new file in and keeps the old one as a version.
// ponytail: abandoned .sk-upload-* parts are never cleaned up; sweep old ones if they start piling up.
const MAX_CHUNK = 95 * 1024 ** 2;
const uploads = new Map(); // upload id -> { got: Set<chunk>, done: boolean }
const BIG_BUFFER = { highWaterMark: 1024 * 1024 }; // 1 MB disk reads/writes instead of 64 KB

async function upload(req, res, q, { status, space, root, target, need, log, user, transfer, staged }) {
  need(q.get('replace') ? 'edit' : 'upload');
  const id = q.get('upload') || '';
  const chunk = Number(q.get('chunk') || 0);
  const chunks = Number(q.get('chunks') || 1);
  const size = Number(q.get('size') || 0);
  const chunkSize = Number(q.get('chunkSize') || size);
  const ok = /^[\w-]{8,64}$/.test(id) && Number.isInteger(chunk) && chunk >= 0 && chunk < chunks && chunkSize > 0 && chunkSize <= MAX_CHUNK;
  if (!ok || (size && Math.ceil(size / chunkSize) !== chunks)) fail(400, 'Bad upload');

  const dir = dirname(target);
  const part = join(dir, `.sk-upload-${id}`);
  if (!uploads.has(id)) {
    // First chunk to arrive (any order) registers the upload straight away (no await before this, so chunks
    // arriving together can't each start their own), then checks space and creates the part file.
    const ready = (async () => {
      const fs = status.drives.find((d) => d.id === space.drive)?.fs;
      if (/^FAT/i.test(fs || '') && size > FAT32_MAX) fail(413, `This drive is ${fs}, which can't hold files over 4 GB`);
      if (space.id === 'me' && space.quotaGB && (await folderSize(root)) + size > space.quotaGB * 1024 ** 3)
        fail(413, `Your space is full (${space.quotaGB} GB limit)`);
      const made = await mkdir(dir, { recursive: true }); // folder uploads create their subfolders
      await writeFile(part, '', { flag: 'a' });
      if (made) await setOwner(space, made.replace(/^\\\\\?\\/, ''), user); // Windows returns it as \\?\C:\...
    })();
    uploads.set(id, { got: new Set(), done: false, ready });
    ready.catch(() => uploads.delete(id)); // refused: a retry starts fresh
  }
  const up = uploads.get(id);
  await up.ready; // every chunk waits until the part file exists
  await pipeline(req, createWriteStream(part, { flags: 'r+', start: chunk * chunkSize, ...BIG_BUFFER }));
  up.got.add(chunk);
  if (up.got.size < chunks || up.done) return json(res, { ok: true });
  up.done = true;
  uploads.delete(id);

  let name = target.split(sep).pop();
  if (staged) {
    await rename(part, target); // check-in files land exactly where they belong in the staging folder
    forgetSizes();
    transfer('uploaded (check-in)', size, relative(root, target));
    return json(res, { ok: true, name });
  }
  if (q.get('replace')) await keepVersion(root, target);
  else name = freeName(dir, name);
  await rename(part, join(dir, name));
  forgetSizes();
  warmAudioPreview(join(dir, name));
  if (!q.get('replace')) await setOwner(space, join(dir, name), user);
  autoScan(space, join(dir, name), user.username).catch(console.error); // landed in a release folder? update Tracks
  log(q.get('replace') ? 'replaced' : 'uploaded', { path: relative(root, join(dir, name)).split(sep).join('/') });
  transfer(q.get('replace') ? 'replaced' : 'uploaded', size, relative(root, join(dir, name)));
  return json(res, { ok: true, name });
}

// ── Light audio previews: a 256 kbps MP3 of each WAV/AIFF/FLAC (~1/5 the size), made once and cached ──
// The input format is forced from the extension and only local files are allowed, so a crafted file can't
// make ffmpeg probe it as something else (e.g. a playlist that reads other files). At most 2 run at once.
const AUDIO_PREVIEW = { '.wav': 'wav', '.aif': 'aiff', '.aiff': 'aiff', '.flac': 'flac' };
const previewJobs = new Map(); // cache file -> Promise
let transcoding = 0;
const transcodeQueue = [];

async function audioPreviewFile(file) {
  const format = AUDIO_PREVIEW[extname(file).toLowerCase()] || fail(415, 'No audio preview for this type');
  const s = (await stat(file).catch(() => null)) || fail(404, 'Not found');
  const out = join(await cacheDir(), createHash('sha1').update(`${file}|${s.size}|${s.mtimeMs}|mp3`).digest('hex') + '.mp3');
  if (existsSync(out)) return out;
  if (!previewJobs.has(out))
    previewJobs.set(
      out,
      transcode(file, format, out).finally(() => previewJobs.delete(out)),
    );
  await previewJobs.get(out);
  return out;
}

async function transcode(file, format, out, clip = null) {
  if (transcoding >= 2) await new Promise((r) => transcodeQueue.push(r));
  transcoding++;
  try {
    await mkdir(dirname(out), { recursive: true });
    const tmp = out + '.part';
    const seek = clip ? ['-ss', String(clip.at)] : [];
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', ...seek, '-f', format, '-i', file];
    // A public preview: 30 s, faded in and out, lighter bitrate
    const cut = clip ? ['-t', '30', '-af', 'afade=t=in:d=0.5,afade=t=out:st=28.5:d=1.5'] : [];
    const code = await new Promise((resolve) => {
      const ff = spawn(ffmpegPath, [...args, '-vn', ...cut, '-c:a', 'libmp3lame', '-b:a', clip ? '160k' : '256k', '-f', 'mp3', '-y', tmp], {
        windowsHide: true,
      });
      const timer = setTimeout(() => ff.kill(), 10 * 60_000);
      ff.stderr.resume();
      ff.on('error', () => resolve(-1));
      ff.on('close', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    if (code !== 0) {
      await rm(tmp, { force: true });
      fail(415, "Couldn't make a preview of this audio — use Download");
    }
    await rename(tmp, out);
    pruneCache(dirname(out));
  } finally {
    transcoding--;
    transcodeQueue.shift()?.();
  }
}

/** 30 seconds of a bounce from `at` (for public release pages), made once and cached. */
const CLIP_FORMATS = { ...AUDIO_PREVIEW, '.mp3': 'mp3', '.m4a': 'mov', '.ogg': 'ogg' };

/**
 * What an engineer checks first, measured on the original file (not the MP3 preview) and cached: format, sample
 * rate, bit depth, channels, duration, and EBU R128 loudness (integrated LUFS, loudness range, true peak).
 * Same safety as transcode: format forced from the extension, local files only, in the same 2-at-a-time queue.
 */
async function audioInfo(file) {
  const format = CLIP_FORMATS[extname(file).toLowerCase()] || fail(415, 'No audio info for this type');
  const s = (await stat(file).catch(() => null)) || fail(404, 'Not found');
  const out = join(await cacheDir(), createHash('sha1').update(`${file}|${s.size}|${s.mtimeMs}|info3`).digest('hex') + '.json');
  const cached = await readFile(out, 'utf8').then(JSON.parse, () => null);
  if (cached) return cached;
  if (!previewJobs.has(out))
    previewJobs.set(
      out,
      measureAudio(file, format, out).finally(() => previewJobs.delete(out)),
    );
  return previewJobs.get(out);
}

/**
 * Spots worth a listen, second by second: clipping (true peak at 0 dBTP or more), hot (above -1 dBTP, may distort
 * once streaming services encode it) and phase (left and right cancel when played in mono). Neighbouring seconds of
 * the same kind become one range; the loudest / worst value is kept for the explanation.
 */
function mixHints(peak, phase) {
  const flags = [];
  for (const [sec, v] of peak) if (v > -1) flags.push({ from: sec, kind: v >= -0.05 ? 'clip' : 'hot', value: v });
  for (const [sec, [sum, n]] of phase) if (n && sum / n < 0) flags.push({ from: sec, kind: 'phase', value: sum / n });
  flags.sort((a, b) => a.kind.localeCompare(b.kind) || a.from - b.from);
  const out = [];
  for (const f of flags) {
    const last = out[out.length - 1];
    if (last && last.kind === f.kind && f.from <= last.to + 1) {
      last.to = f.from + 1;
      last.value = f.kind === 'phase' ? Math.min(last.value, f.value) : Math.max(last.value, f.value);
    } else out.push({ kind: f.kind, from: f.from, to: f.from + 1, value: Math.round(f.value * 100) / 100 });
  }
  for (const h of out) h.value = Math.round(h.value * 100) / 100;
  return out.sort((a, b) => a.from - b.from).slice(0, 40);
}

async function measureAudio(file, format, out) {
  if (transcoding >= 2) await new Promise((r) => transcodeQueue.push(r));
  transcoding++;
  try {
    // One pass: loudness on the original channels, and a stereo copy through the phase meter. The per-moment lines
    // (true peak every 100 ms, phase every few ms) are read as they stream, so only the head (stream info) and tail
    // (summary) of the log are kept.
    const args = ['-nostdin', '-hide_banner', '-protocol_whitelist', 'file', '-f', format, '-i', file, '-vn'];
    const graph =
      '[0:a]asplit[a][b];[a]ebur128=peak=true:framelog=info[x];' +
      '[b]aformat=channel_layouts=stereo,aphasemeter=video=0,ametadata=mode=print:key=lavfi.aphasemeter.phase[y]';
    let head = '';
    let tail = '';
    let rest = '';
    let pts = 0;
    const peak = new Map(); // second -> loudest true peak in it (dBTP)
    const phase = new Map(); // second -> [sum, count] of the phase meter (1 = mono-safe, -1 = cancels in mono)
    const line = (l) => {
      const f = l.match(/\] t: ([\d.]+) .*FTPK:((?:\s+(?:-?[\d.]+|-inf))+) dBFS/);
      if (f) {
        const v = Math.max(
          ...f[2]
            .trim()
            .split(/\s+/)
            .map((x) => (x === '-inf' ? -Infinity : Number(x))),
        );
        const sec = Math.floor(Number(f[1]) - 0.05); // each line covers the 100 ms before t
        peak.set(sec, Math.max(peak.get(sec) ?? -Infinity, v));
        return;
      }
      const t = l.match(/pts_time:([\d.]+)/);
      if (t) return void (pts = Number(t[1]));
      const ph = l.match(/aphasemeter\.phase=(-?[\d.]+)/);
      if (ph) {
        const a = phase.get(Math.floor(pts)) || [0, 0];
        phase.set(Math.floor(pts), [a[0] + Number(ph[1]), a[1] + 1]);
      }
    };
    const code = await new Promise((resolve) => {
      const ff = spawn(ffmpegPath, [...args, '-filter_complex', graph, '-map', '[x]', '-map', '[y]', '-f', 'null', '-'], {
        windowsHide: true,
      });
      const timer = setTimeout(() => ff.kill(), 10 * 60_000);
      ff.stderr.on('data', (d) => {
        const text = String(d);
        if (head.length < 20_000) head += text;
        tail = (tail + text).slice(-20_000);
        const lines = (rest + text).split(/\r?\n/);
        rest = lines.pop();
        lines.forEach(line);
      });
      ff.on('error', () => resolve(-1));
      ff.on('close', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    if (code !== 0) fail(415, "Couldn't measure this audio");
    const log = head + tail;
    const num = (re) => {
      const m = log.match(re);
      return m ? Number(m[1]) : null;
    };
    const stream = log.match(/Audio: (\w+)[^,\n]*, (\d+) Hz, ([^,\n]+), (\w+)(?: \((\d+) bit\))?/);
    const dur = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const codec = stream?.[1] || '';
    const summary = log.slice(log.lastIndexOf('Summary:'));
    const fromSummary = (re) => {
      const v = summary.match(re)?.[1];
      return v === undefined || v === '-inf' ? null : Number(v);
    };
    const info = {
      codec,
      lossless: /^(pcm_|flac|alac)/.test(codec),
      rate: stream ? Number(stream[2]) : null,
      // "stereo", "mono", "5.1"...; untagged WAVs just say "2 channels"
      channels: (stream?.[3]?.trim() || '').replace(/^1 channels?$/, 'mono').replace(/^2 channels$/, 'stereo') || null,
      bits: stream?.[5] ? Number(stream[5]) : Number(codec.match(/^pcm_[su](\d+)/)?.[1]) || (/^pcm_f32/.test(codec) ? 32 : null),
      float: /^pcm_f/.test(codec),
      bitrate: /^(pcm_|flac|alac)/.test(codec) ? null : num(/bitrate: (\d+) kb\/s/),
      duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
      // From the end-of-file summary; silence reads as "-inf" (null here)
      lufs: fromSummary(/I:\s+(-?[\d.]+|-inf) LUFS/),
      lra: fromSummary(/LRA:\s+(-?[\d.]+|-inf) LU/),
      truePeak: fromSummary(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
      hints: mixHints(peak, phase),
    };
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(info));
    return info;
  } finally {
    transcoding--;
    transcodeQueue.shift()?.();
  }
}

async function audioClipFile(file, at) {
  const format = CLIP_FORMATS[extname(file).toLowerCase()] || fail(415, 'No preview for this type');
  const s = (await stat(file).catch(() => null)) || fail(404, 'Not found');
  const out = join(await cacheDir(), createHash('sha1').update(`${file}|${s.size}|${s.mtimeMs}|clip${at}`).digest('hex') + '.mp3');
  if (existsSync(out)) return out;
  if (!previewJobs.has(out))
    previewJobs.set(
      out,
      transcode(file, format, out, { at }).finally(() => previewJobs.delete(out)),
    );
  await previewJobs.get(out);
  return out;
}

/** Makes the audio preview in the background right after an upload, so it's ready before anyone presses play. */
const warmAudioPreview = (file) => AUDIO_PREVIEW[extname(file).toLowerCase()] && audioPreviewFile(file).catch(() => {});

/**
 * Where previews and thumbnails are cached: a hidden .sanktuary-cache folder on the drive picked in
 * Admin Panel > Drives (cacheDrive), or the SSD while that drive is unplugged or none is picked.
 */
async function cacheDir() {
  const cfg = await loadConfig();
  const letter = cfg.cacheDrive && (await loadStatus()).drives.find((d) => d.id === cfg.cacheDrive)?.letter;
  return letter && existsSync(letter + sep) ? join(letter + sep, '.sanktuary-cache') : LOCAL_CACHE;
}

// Keeps a cache folder under 20 GB by removing the least recently used previews.
const lastPrune = new Map(); // dir -> time
async function pruneCache(dir, limit = 20 * 1024 ** 3) {
  if (Date.now() - (lastPrune.get(dir) || 0) < 10 * 60_000) return;
  lastPrune.set(dir, Date.now());
  const names = await readdir(dir).catch(() => []);
  const files = (
    await Promise.all(
      names.map((n) =>
        stat(join(dir, n)).then(
          (st) => ({ p: join(dir, n), st }),
          () => null,
        ),
      ),
    )
  ).filter(Boolean);
  let total = files.reduce((a, f) => a + f.st.size, 0);
  if (total <= limit) return;
  for (const f of files.sort((a, b) => Math.max(a.st.atimeMs, a.st.mtimeMs) - Math.max(b.st.atimeMs, b.st.mtimeMs))) {
    if (total <= limit * 0.75) break;
    await rm(f.p, { force: true });
    total -= f.st.size;
  }
}

async function stream(req, res, q, file, transfer) {
  const s = await stat(file).catch(() => null);
  if (!s || s.isDirectory()) fail(404, 'Not found');
  // Log each download/open once: players re-request ranges further into the file while seeking
  if (transfer && !/^bytes=[1-9]/.test(req.headers.range || '')) transfer(q.has('download') ? 'downloaded' : 'opened', s.size);
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'last-modified': s.mtime.toUTCString() };
  if (q.has('download') || !SAFE_INLINE.test(type)) {
    headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(q.get('name') || file.split(sep).pop())}`;
  }
  if (!SAFE_INLINE.test(type)) headers['content-security-policy'] = "sandbox; default-src 'none'";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && s.size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, s.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), s.size - 1) : s.size - 1;
    if (start > end) fail(416, 'Bad range');
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${s.size}`, 'content-length': end - start + 1 });
    return pipeline(createReadStream(file, { start, end, ...BIG_BUFFER }), res);
  }
  res.writeHead(200, { ...headers, 'content-length': s.size });
  return pipeline(createReadStream(file, BIG_BUFFER), res);
}

/** Opens an image for sharp. Photoshop files are flattened from the composite image they store. */
/**
 * Camera RAW: the JPEG the camera rendered and tucked inside the file (full size on most cameras). TIFF-based
 * raws (CR2, NEF, ARW, DNG, ORF, RW2, PEF...) list theirs in their IFDs; RAF points at it from its header; CR3
 * keeps one in a PRVW box. The biggest one sharp can read wins, turned the way the camera held it.
 */
async function rawPreview(file, size) {
  if (size > RAW_MAX) fail(413, 'This RAW file is too large to preview');
  const b = await readFile(file); // ponytail: reads the whole file; seek to the IFDs if 100 MB raws get common
  const found = []; // [offset, length]
  let orientation = 1;
  const le = b[0] === 0x49; // "II" little-endian, "MM" big-endian
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  try {
    if ((le && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) {
      const seen = new Set();
      const walk = (ifd, depth) => {
        for (; ifd > 0 && ifd + 2 <= b.length && !seen.has(ifd) && depth < 8;) {
          seen.add(ifd);
          const n = u16(ifd);
          if (ifd + 2 + n * 12 + 4 > b.length) return;
          const tags = {};
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            const type = u16(e + 2);
            const count = u32(e + 4);
            const val = type === 3 && count === 1 ? u16(e + 8) : u32(e + 8);
            tags[u16(e)] = { val, count, at: e + 8 };
          }
          if (depth === 0 && tags[0x0112]) orientation = tags[0x0112].val;
          if (tags[0x0201] && tags[0x0202]) found.push([tags[0x0201].val, tags[0x0202].val]); // JPEGInterchangeFormat
          if ([6, 7].includes(tags[0x0103]?.val) && tags[0x0111]?.count === 1 && tags[0x0117])
            found.push([tags[0x0111].val, tags[0x0117].val]); // one JPEG strip
          const sub = tags[0x014a]; // SubIFDs: one offset inline, or a list of them
          if (sub) for (let i = 0; i < Math.min(sub.count, 8); i++) walk(sub.count === 1 ? sub.val : u32(sub.val + i * 4), depth + 1);
          ifd = u32(ifd + 2 + n * 12);
        }
      };
      walk(u32(4), 0);
    } else if (b.toString('latin1', 0, 8) === 'FUJIFILM') {
      found.push([b.readUInt32BE(84), b.readUInt32BE(88)]);
    } else {
      const prvw = b.indexOf('PRVW'); // CR3
      if (prvw > 4) {
        const soi = b.indexOf(Buffer.from([0xff, 0xd8, 0xff]), prvw);
        if (soi > 0) found.push([soi, prvw - 4 + b.readUInt32BE(prvw - 4) - soi]);
      }
    }
  } catch {} // a damaged file: use whatever was found before the damage
  const jpegs = found
    .filter(([o, l]) => o > 0 && l > 0 && o + l <= b.length && b[o] === 0xff && b[o + 1] === 0xd8)
    .sort((x, y) => y[1] - x[1]);
  for (const [o, l] of jpegs) {
    const jpeg = b.subarray(o, o + l);
    if (
      !(
        await sharp(jpeg)
          .metadata()
          .catch(() => null)
      )?.width
    )
      continue; // e.g. DNG lossless-JPEG raw data
    const deg = { 3: 180, 6: 90, 8: 270 }[orientation];
    if (!deg) return sharp(jpeg);
    const { data, info } = await sharp(jpeg).rotate(deg).raw().toBuffer({ resolveWithObject: true });
    return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  }
  fail(415, 'No preview inside this RAW file — use Edit photo or Download');
}

async function imageInput(file, size) {
  const ext = extname(file).toLowerCase();
  if (RAW_PHOTO.has(ext)) return rawPreview(file, size);
  if (ext === '.ai') {
    try {
      return sharp(file, { page: 0 });
    } catch {
      fail(415, 'This Illustrator file cannot be previewed (save with Create PDF Compatible File enabled)');
    }
  }
  if (ext !== '.psd') return sharp(file, { animated: false });
  if (size > PSD_MAX) fail(413, 'This Photoshop file is too large to preview');
  const psd = readPsd(await readFile(file), { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
  if (!psd.imageData) fail(415, 'This PSD has no preview image (save it with "Maximize compatibility" on)');
  const { width, height, data } = psd.imageData;
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
}

/** Cached WebP rendering of an image: 256 px thumbnails, or larger previews for formats browsers can't show (PSD, TIFF). */
async function thumb(res, file, max = 256) {
  if (!THUMBABLE.has(extname(file).toLowerCase())) fail(415, 'No thumbnail');
  const s = (await stat(file).catch(() => null)) || fail(404, 'Not found');
  const dir = await cacheDir();
  const cached = join(dir, createHash('sha1').update(`${file}|${s.size}|${s.mtimeMs}|${max}`).digest('hex') + '.webp');
  if (!existsSync(cached)) {
    await mkdir(dir, { recursive: true });
    const img = await imageInput(file, s.size);
    const webp = await img
      .rotate()
      .resize(max, max, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: max > 256 ? 85 : 70 })
      .toBuffer()
      .catch(() => fail(415, "Couldn't read this image — use Download")); // damaged or unsupported file
    await writeFile(cached, webp);
    pruneCache(dir);
  }
  res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'private, max-age=86400' });
  return pipeline(createReadStream(cached), res);
}

// ── /api/me: who am I + my spaces ──────────────────────────────────────
async function me(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const visible = spacesFor(user, cfg, await loadStatus());
  // Favourite folders: kept per person on the server (so they follow you between devices), never shown to others;
  // one in a space you've lost access to just isn't listed
  const prefsFile = `prefs/${user.username}.json`;
  if (req.method === 'PUT') {
    const input = await jsonBody(req);
    const favorites = (Array.isArray(input.favorites) ? input.favorites : []).slice(0, 40).map((f) => {
      const space = String(f?.space || '');
      const path = String(f?.path ?? '');
      if (!/^[\w.-]{1,64}$/.test(space) || path.length > 500 || /[\x00-\x1f:]/.test(path) || path.split('/').includes('..'))
        fail(400, 'Bad favourite');
      return { space, path, name: String(f?.name || '').slice(0, 100), spaceName: String(f?.spaceName || '').slice(0, 100) };
    });
    await mkdir(join(DATA, 'prefs'), { recursive: true });
    await saveJson(prefsFile, { ...(await readJson(prefsFile, {})), favorites });
    return json(res, { favorites: favorites.filter((f) => visible.some((s) => s.id === f.space)) });
  }
  const spaces = await Promise.all(visible.map(spaceInfo));
  for (const s of spaces)
    s.driveName = cfg.drives[(cfg.spaces.find((x) => x.id === s.id) || cfg.members[user.username])?.drive]?.name || null;
  const favorites = ((await readJson(prefsFile, {})).favorites || []).filter((f) => visible.some((s) => s.id === f.space));
  res.setHeader('set-cookie', sessionCookie(req, user));
  return json(res, { username: user.username, admin: user.admin, spaces, favorites });
}

// ── /api/boards: infinite canvas boards, edited live by the whole team ──
// Each board lives in data/boards/<id>/ (board.json + assets/) on the PC's SSD, so boards work even with
// every USB drive unplugged. Edits are per-item last-writer-wins: a client sends the whole item it changed,
// the server stores it and forwards it to everyone else on the board over server-sent events.
// ponytail: no undo history or conflict merging inside one item; add a CRDT (Yjs) if people fight over the same note.
const ITEM_TYPES = new Set(['note', 'text', 'image', 'file', 'link', 'edge']); // edge: arrow from one item to another
const CURSOR_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324'];
const openBoards = new Map(); // id -> { meta, items: Map, clients: Map<conn, { res, user, color }>, timer }

/** Boards are open to every member unless meta.members lists who may see them (owner + admins always can). */
const canSeeBoard = (user, meta) => !meta.members || user.admin || meta.owner === user.username || meta.members.includes(user.username);

async function loadBoard(id) {
  if (!/^[\w-]{1,60}$/.test(id)) fail(400, 'Bad board id');
  let b = openBoards.get(id);
  if (!b) {
    const saved = (await readJson(`boards/${id}/board.json`, null)) || fail(404, 'No such board');
    b = { meta: saved.meta, items: new Map(saved.items.map((i) => [i.id, i])), clients: new Map(), timer: null };
    openBoards.set(id, b);
  }
  return b;
}

function saveBoardSoon(id, b) {
  clearTimeout(b.timer);
  b.timer = setTimeout(
    () => saveJson(`boards/${id}/board.json`, { meta: b.meta, items: [...b.items.values()] }).catch(console.error),
    1000,
  );
}

function broadcast(b, event, data, exceptConn) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [conn, c] of b.clients) if (conn !== exceptConn) c.res.write(msg);
}

const safeLink = (v) => v === undefined || (typeof v === 'string' && /^https?:\/\//i.test(v));
const ownFile = (v) => v === undefined || (typeof v === 'string' && v.startsWith('/api/'));
const validItem = (kind, i) =>
  i &&
  /^[\w-]{1,64}$/.test(i.id) &&
  safeLink(i.url) &&
  ownFile(i.src) &&
  (kind === 'kanban'
    ? Number.isFinite(i.order) && typeof i.title === 'string' && (i.type === 'column' || (i.type === 'card' && typeof i.col === 'string'))
    : ITEM_TYPES.has(i.type) && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(i[k])));

async function boardsApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const [, , , id, sub, file] = url.pathname.split('/'); // /api/boards/<id>/<live|ops|assets>/<file>

  if (!id && req.method === 'GET') {
    await mkdir(join(DATA, 'boards'), { recursive: true });
    const list = [];
    for (const e of await readdir(join(DATA, 'boards'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const b = openBoards.get(e.name) || (await readJson(`boards/${e.name}/board.json`, null));
      if (b && (b.meta.kind || 'canvas') === (url.searchParams.get('kind') || 'canvas') && canSeeBoard(user, b.meta))
        list.push({ ...b.meta, items: b.items.size ?? b.items.length, online: openBoards.get(e.name)?.clients.size || 0 });
    }
    return json(
      res,
      list.sort((a, b) => b.updated.localeCompare(a.updated)),
    );
  }
  if (!id && req.method === 'POST') {
    const input = await jsonBody(req);
    const name =
      String(input.name || '')
        .trim()
        .slice(0, 80) || fail(400, 'Give the board a name');
    const kind = input.kind === 'kanban' ? 'kanban' : 'canvas';
    const newId =
      (name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'board') +
      '-' +
      randomUUID().slice(0, 6);
    const now = new Date().toISOString();
    const meta = { id: newId, name, kind, owner: user.username, created: now, updated: now, updatedBy: user.username };
    const items =
      kind === 'kanban'
        ? ['To do', 'Doing', 'Done'].map((title, order) => ({ id: randomUUID().slice(0, 12), type: 'column', title, order }))
        : [];
    await mkdir(join(DATA, 'boards', newId, 'assets'), { recursive: true });
    await saveJson(`boards/${newId}/board.json`, { meta, items });
    logActivity(user, kind === 'kanban' ? 'started the plan' : 'started the moodboard', {
      board: newId,
      boardKind: kind,
      title: name,
      boardMembers: null,
    });
    return json(res, meta);
  }

  const b = await loadBoard(id);
  if (!canSeeBoard(user, b.meta)) fail(404, 'No such board');

  if (!sub && req.method === 'PATCH') {
    const input = await jsonBody(req);
    if (input.name !== undefined) b.meta.name = String(input.name).trim().slice(0, 80) || b.meta.name;
    if (input.members !== undefined) {
      if (b.meta.owner !== user.username && !user.admin) fail(403, 'Only the creator or an admin can change who sees a board');
      b.meta.members = Array.isArray(input.members)
        ? [...new Set(input.members.map(String).filter((u) => /^[\w.-]{1,64}$/.test(u)))]
        : null;
      // Anyone who just lost access is disconnected from the board
      const cfg = await loadConfig();
      for (const [conn, c] of b.clients) {
        if (!canSeeBoard({ username: c.user.username, admin: cfg.admins.includes(c.user.username) }, b.meta)) {
          c.res.write('event: deleted\ndata: {}\n\n');
          c.res.end();
          b.clients.delete(conn);
        }
      }
    }
    saveBoardSoon(id, b);
    broadcast(b, 'meta', b.meta);
    return json(res, b.meta);
  }
  if (!sub && req.method === 'DELETE') {
    if (b.meta.owner !== user.username && !user.admin) fail(403, 'Only the creator or an admin can delete a board');
    clearTimeout(b.timer);
    broadcast(b, 'deleted', {});
    for (const c of b.clients.values()) c.res.end();
    openBoards.delete(id);
    await mkdir(join(DATA, 'boards-trash'), { recursive: true });
    await rename(join(DATA, 'boards', id), join(DATA, 'boards-trash', `${id}-${stamp()}`)); // recoverable
    logActivity(user, 'deleted the board', { title: b.meta.name, boardMembers: b.meta.members ? [b.meta.owner, ...b.meta.members] : null });
    return json(res, { ok: true });
  }

  if (sub === 'live' && req.method === 'GET') {
    const conn = randomUUID();
    const color = CURSOR_COLORS[[...b.clients.values()].length % CURSOR_COLORS.length];
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const peers = [...b.clients.entries()].map(([c, v]) => ({ conn: c, user: v.user.username, color: v.color }));
    res.write(
      `event: init\ndata: ${JSON.stringify({ meta: b.meta, items: [...b.items.values()], you: { conn, color, user: user.username }, peers })}\n\n`,
    );
    b.clients.set(conn, { res, user, color });
    broadcast(b, 'join', { conn, user: user.username, color }, conn);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000); // Cloudflare drops idle streams after 100 s
    req.on('close', () => {
      clearInterval(ping);
      b.clients.delete(conn);
      broadcast(b, 'leave', { conn });
    });
    return;
  }

  if (sub === 'ops' && req.method === 'POST') {
    const input = await jsonBody(req);
    const ops = Array.isArray(input.ops) ? input.ops : [];
    const cursor = input.cursor;
    const conn = b.clients.get(input.conn)?.user.username === user.username ? input.conn : null; // no spoofing others
    const applied = [];
    for (const op of ops) {
      if (op.put && validItem(b.meta.kind || 'canvas', op.put)) {
        const before = b.items.get(op.put.id);
        if (op.put.type === 'card' && before?.col !== op.put.col && /done/i.test(b.items.get(op.put.col)?.title || '')) {
          logActivity(user, 'finished', {
            board: id,
            boardKind: 'kanban',
            title: b.meta.name,
            card: op.put.title,
            boardMembers: b.meta.members ? [b.meta.owner, ...b.meta.members] : null,
          });
        }
        b.items.set(op.put.id, op.put);
        applied.push({ put: op.put });
      } else if (op.del && b.items.delete(op.del)) {
        applied.push({ del: op.del });
      }
    }
    if (applied.length) {
      Object.assign(b.meta, { updated: new Date().toISOString(), updatedBy: user.username });
      saveBoardSoon(id, b);
      broadcast(b, 'ops', { conn, ops: applied }, conn);
    }
    if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
      broadcast(b, 'cursor', { conn, user: user.username, color: b.clients.get(conn)?.color, x: cursor.x, y: cursor.y }, conn);
    }
    return json(res, { ok: true });
  }

  if (sub === 'assets' && req.method === 'PUT') {
    const name = safeName(url.searchParams.get('name'));
    const ext = extname(name).toLowerCase();
    const uuid = randomUUID();
    const dir = join(DATA, 'boards', id, 'assets');
    await mkdir(dir, { recursive: true });
    // Pictures are shown from a compressed WebP (max 2400 px); the original is kept beside it, untouched.
    // GIFs stay as they are so animations keep playing.
    if (THUMBABLE.has(ext) && ext !== '.gif') {
      const original = join(dir, `${uuid}-original${ext}`);
      await pipeline(req, createWriteStream(original, BIG_BUFFER));
      try {
        const img = await imageInput(original, (await stat(original)).size);
        await img
          .rotate()
          .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(join(dir, `${uuid}.webp`));
        return json(res, {
          src: `/api/boards/${id}/assets/${uuid}.webp`,
          original: `/api/boards/${id}/assets/${uuid}-original${ext}`,
          name,
        });
      } catch {
        return json(res, { src: `/api/boards/${id}/assets/${uuid}-original${ext}`, name }); // unreadable picture: show the file as it is
      }
    }
    await pipeline(req, createWriteStream(join(dir, uuid + ext), BIG_BUFFER));
    return json(res, { src: `/api/boards/${id}/assets/${uuid}${ext}`, name });
  }
  if (sub === 'assets' && req.method === 'GET') {
    const asset = join(DATA, 'boards', id, 'assets', safeName(file));
    // ?view: a cached 1600 px WebP for boards made before uploads were compressed
    if (url.searchParams.has('view') && THUMBABLE.has(extname(asset).toLowerCase()) && !asset.endsWith('.gif'))
      return thumb(res, asset, 1600);
    return stream(req, res, url.searchParams, asset);
  }
  fail(404, 'Unknown board action');
}

// ── /api/admin/*: admin panel ──────────────────────────────────────────
async function admin(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  if (!user.admin) fail(403, 'Administrators only');
  const action = url.pathname.split('/')[3];

  if (req.method === 'GET' && action === 'state') {
    const r = await clerk('/users?limit=100&order_by=-created_at');
    const users = r.ok
      ? (await r.json()).map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email_addresses?.[0]?.email_address || null,
          hasPassword: u.password_enabled,
          lastSignIn: u.last_sign_in_at,
          created: u.created_at,
        }))
      : [];
    return json(res, { config: cfg, status: await readJson('status.json', null), backup: await readJson('backup.json', null), users });
  }
  if (req.method === 'GET' && action === 'health') return json(res, await health());
  if (req.method === 'GET' && action === 'usage') return json(res, await usageReport());
  if (req.method === 'GET' && action === 'log') {
    const lines = (await readFile(join(DATA, 'transfers.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
    return json(
      res,
      lines
        .slice(-500)
        .map((l) => JSON.parse(l))
        .reverse(),
    );
  }
  if (req.method === 'GET' && action === 'folders') {
    // Browse a connected drive's folders, to pick which part of it a space shares
    const root = driveDir(cfg, await loadStatus(), url.searchParams.get('drive')) || fail(503, 'That drive is not connected');
    const path = url.searchParams.get('path') || '';
    const dir = resolve(root, path);
    if (/[:\x00-\x1f]/.test(path) || !inside(resolve(root), dir)) fail(400, 'Bad path');
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => null)) || fail(404, 'No such folder');
    return json(res, {
      folders: entries
        .filter((e) => e.isDirectory() && !HIDDEN.test(e.name))
        .map((e) => e.name)
        .sort(),
    });
  }
  if (req.method === 'PUT' && action === 'config') {
    const next = validateConfig(await jsonBody(req), user);
    await saveJson('config.json', next);
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && action === 'users') {
    const { username, password, email } = await jsonBody(req);
    const r = await clerk('/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, ...(email ? { email_address: [email] } : {}) }),
    });
    const out = await r.json();
    if (!r.ok) fail(400, out.errors?.[0]?.long_message || out.errors?.[0]?.message || 'Clerk refused');
    return json(res, { ok: true, id: out.id });
  }
  if (req.method === 'POST' && action === 'backup') {
    await writeFile(join(DATA, 'backup-now'), '');
    return json(res, { ok: true });
  }
  fail(404, 'Unknown admin action');
}

function validateConfig(c, user) {
  const ok = (cond, msg) => cond || fail(400, msg);
  ok(c && Array.isArray(c.admins) && c.admins.includes(user.username), "You can't remove yourself as an admin");
  ok(c.drives && typeof c.drives === 'object' && Array.isArray(c.spaces) && c.members && typeof c.members === 'object', 'Bad config');
  const ids = new Set();
  for (const s of c.spaces) {
    ok(/^[a-z0-9-]{1,40}$/.test(s.id) && s.id !== 'me' && !ids.has(s.id), `Bad or duplicate space id "${s.id}"`);
    ids.add(s.id);
    const folders = foldersOf(s);
    ok(
      s.name && folders.length <= 20 && folders.every((f) => c.drives[f.drive]),
      `Space "${s.name || s.id}" needs a name and known drives`,
    );
    for (const f of folders) {
      ok(
        !String(f.path || '')
          .split(/[\\/]/)
          .includes('..') && !/[:\x00-\x1f]/.test(f.path || ''),
        `Bad folder path in "${s.name}"`,
      );
      ok(!f.label || (/^[^\\/:*?"<>|\x00-\x1f]{1,60}$/.test(f.label) && !/^\.+$/.test(f.label)), `Bad folder name in "${s.name}"`);
    }
    ok(
      RANK[s.everyone || 'none'] !== undefined &&
        Object.values(s.access || {}).every((r) => RANK[r] !== undefined) &&
        Object.entries(s.groups || {}).every(([g, r]) => c.groups?.[g] && RANK[r] !== undefined),
      `Bad rights in "${s.name}"`,
    );
  }
  for (const [id, g] of Object.entries(c.groups || {}))
    ok(
      /^[a-z0-9-]{1,40}$/.test(id) &&
        typeof g.name === 'string' &&
        g.name.length <= 60 &&
        Array.isArray(g.members) &&
        g.members.every((u) => /^[\w.-]{1,64}$/.test(u)),
      `Bad group "${id}"`,
    );
  for (const [name, m] of Object.entries(c.members)) ok(!m.drive || c.drives[m.drive], `Unknown drive for ${name}`);
  ok(c.backup && Number.isInteger(c.backup.hour) && c.backup.hour >= 0 && c.backup.hour < 24, 'Backup hour must be 0-23');
  ok(!c.cacheDrive || c.drives[c.cacheDrive], 'Unknown drive for the preview cache');
  return c;
}

/** GET /healthz: 200 when the server can read its data (ops/deploy.ps1 checks it after each deploy; outside uptime
 * monitors can watch it too). Says nothing else about the server. */
async function healthz(req, res) {
  await loadConfig();
  res.setHeader('cache-control', 'no-store');
  return json(res, { ok: true });
}

// ── Alerts: admins get a notification (and a push) once per problem, instead of finding out by accident ──
// A deploy that failed or was rolled back, a backup more than 30 hours old, the photo editor's engine not answering.
// data/alerts.json remembers what was already sent, so restarts don't repeat them.
async function checkAlerts() {
  const cfg = await loadConfig();
  const sent = await readJson('alerts.json', {});
  const alert = async (key, text) => {
    if (sent[key]) return;
    sent[key] = new Date().toISOString();
    await saveJson('alerts.json', sent);
    for (const a of cfg.admins) await notify(a, text, {});
  };
  const deploy = await readJson('deploy.json', null);
  if (deploy && !deploy.ok) alert(`deploy:${deploy.commit}`, `Sanktuary: ${String(deploy.message).split(/\r?\n/)[0].slice(0, 200)}`);
  if (cfg.backup?.drive) {
    const b = await readJson('backup.json', null);
    const last = Date.parse(b?.finished || b?.started || 0);
    if (Date.now() - last > 30 * 3.6e6)
      alert(`backup:${localDate()}`, 'Sanktuary: the nightly backup is more than 30 hours old. Is the backup drive plugged in?');
    else if (b?.results?.some((r) => !r.ok))
      alert(`backup-failed:${b.finished}`, 'Sanktuary: the last backup had problems. See Admin Panel > Backups.');
  }
  if (existsSync(join(RAW_UI, 'index.html'))) {
    const raw = await rawHealth();
    if (!raw.ok && !/updating/.test(raw.note)) alert(`rapidraw:${localDate()}`, `Sanktuary: the photo editor isn't working (${raw.note}).`);
  }
}
setTimeout(() => checkAlerts().catch(console.error), 60_000).unref(); // a minute after start (lets a deploy settle)
setInterval(() => checkAlerts().catch(console.error), 5 * 60_000).unref();

/** Admin Panel > Health: is the photo editor's engine answering, which fork commit is built, is an update running. */
async function rawHealth() {
  const home = dirname(RAW_UI);
  const read = (f) =>
    readFile(join(home, f), 'utf8').then(
      (t) => t.trim(),
      () => '',
    );
  const [built, tried, log] = await Promise.all([read('built.txt'), read('update-tried.txt'), read('update.log')]);
  const up = await fetch(RAW_BRIDGE + '/invoke/get_supported_file_types', {
    method: 'POST',
    headers: { 'x-bridge-token': process.env.RAPIDRAW_TOKEN || '' },
    body: '{}',
    signal: AbortSignal.timeout(3000),
  }).then(
    (r) => r.ok,
    () => false,
  );
  const updating = !!tried && tried !== built;
  const lastLine = log.split(/\r?\n/).filter(Boolean).pop() || '';
  const note = !existsSync(join(RAW_UI, 'index.html'))
    ? 'not installed: run ops\\rapidraw\\setup.ps1 on this PC'
    : `${up ? 'engine answers' : 'engine not answering'}${built ? ` · built ${built.slice(0, 7)}` : ' · build date unknown (run setup once)'}${
        updating ? ` · updating to ${tried.slice(0, 7)}: ${lastLine.slice(0, 120)}` : ''
      }`;
  return { ok: up && !updating, note };
}

async function health() {
  const check = async (fn) => {
    const t = Date.now();
    try {
      const extra = await fn();
      return { ok: true, ms: Date.now() - t, ...extra };
    } catch (e) {
      return { ok: false, ms: Date.now() - t, note: e.message };
    }
  };
  const timeout = { signal: AbortSignal.timeout(8000) };
  const [clerkApi, tunnel, publicSite] = await Promise.all([
    check(async () => {
      const r = await clerk('/users?limit=1', timeout);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return {};
    }),
    check(async () => {
      const r = await (await fetch(TUNNEL_READY, timeout)).json();
      if (!r.readyConnections) throw new Error('no connections to Cloudflare');
      return { note: `${r.readyConnections} connections` };
    }),
    check(async () => {
      const r = await fetch('https://sanktuary.studio/manifest.webmanifest', timeout);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return {};
    }),
  ]);
  const status = await readJson('status.json', null);
  return {
    server: { ok: true, uptimeHours: +((Date.now() - started) / 3.6e6).toFixed(1), memMB: Math.round(process.memoryUsage().rss / 1048576) },
    clerk: clerkApi,
    tunnel,
    publicSite,
    watcher: { ok: !!status && Date.now() - Date.parse(status.updated) < 3 * 60_000, lastSeen: status?.updated || null },
    deploy: await readJson('deploy.json', null),
    rapidraw: await rawHealth(),
    host: os.hostname(),
  };
}

// ── Plumbing ───────────────────────────────────────────────────────────
// The request body as text, at most `max` bytes: past that nothing more is kept (the rest is read and thrown away,
// so the "Too large" answer still reaches the sender; Cloudflare caps a request at 100 MB). Decoded once at the
// end, so an é split between two chunks stays an é.
function body(req, max = 1e6) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= max) return chunks.push(c);
      chunks = [];
      reject(new HttpError(413, 'Too large'));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  try {
    return JSON.parse((await body(req)) || '{}');
  } catch {
    fail(400, 'Bad JSON');
  }
}

function staticFile(req, res, url) {
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(normalize(DIST))) fail(403, 'Forbidden');
  if (!existsSync(file) || !url.pathname.includes('.')) file = join(DIST, 'index.html'); // SPA fallback
  // The page is always re-checked so browsers pick up new builds; built assets have content hashes in their
  // names, so they can be cached forever; icons, sounds etc. for a day.
  const cache =
    file.endsWith('index.html') || file.endsWith('sw.js')
      ? 'no-cache'
      : url.pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400';
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': cache });
  return pipeline(createReadStream(file), res);
}

function json(res, value) {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function send(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(text);
}

// ── /api/live: one server-sent event stream per browser tab ────────────
// Carries presence (who's online), chat messages, typing, profile changes, comments and activity.
const liveClients = new Map(); // conn -> { res, user }
const tabs = new Map(); // username -> open tabs

function emit(event, data, canSee = () => true) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of liveClients.values()) if (canSee(c.user)) c.res.write(msg);
}
const onlineList = () => [...tabs.keys()];

async function live(req, res, url) {
  const user = await currentUser(req, url, await loadConfig());
  const conn = randomUUID();
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  liveClients.set(conn, { res, user });
  tabs.set(user.username, (tabs.get(user.username) || 0) + 1);
  res.write(`event: hello\ndata: ${JSON.stringify({ you: user.username, online: onlineList() })}\n\n`);
  if (tabs.get(user.username) === 1) emit('presence', { online: onlineList() });
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000); // Cloudflare drops idle streams after 100 s
  req.on('close', () => {
    clearInterval(ping);
    liveClients.delete(conn);
    const left = tabs.get(user.username) - 1;
    if (left > 0) tabs.set(user.username, left);
    else {
      tabs.delete(user.username);
      emit('presence', { online: onlineList() });
    }
  });
}

// ── Activity feed: data/activity.jsonl ─────────────────────────────────
// ponytail: whole file is re-read for the feed; rotate it if it ever grows past a few MB.
/** Can this member see this activity entry? (space rights, private boards) */
function activityVisible(entry, username, cfg) {
  const admin = cfg.admins.includes(username);
  if (entry.boardMembers && !admin && !entry.boardMembers.includes(username)) return false;
  return !entry.space || spacesFor({ username, admin }, cfg, { drives: [] }).some((s) => s.id === entry.space);
}

async function logActivity(user, action, details = {}) {
  const entry = { id: randomUUID().slice(0, 12), at: new Date().toISOString(), user: user.username, action, ...details };
  await appendFile(join(DATA, 'activity.jsonl'), JSON.stringify(entry) + '\n').catch(console.error);
  const cfg = await loadConfig();
  emit('activity', entry, (u) => activityVisible(entry, u.username, cfg));
}

async function activity(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const lines = (await readFile(join(DATA, 'activity.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const entries = lines.map((l) => JSON.parse(l)).filter((e) => activityVisible(e, user.username, cfg));
  return json(res, entries.slice(-150).reverse());
}

// ── /api/chat: channels + DMs, stored as data/chat/<id>.jsonl ──────────
// DM ids are "dm~<user>~<user>" (sorted), readable only by those two. Channels are public unless private,
// in which case only their members (creator included) can see them.
const CHAT = () => join(DATA, 'chat');
const REF_KINDS = new Set(['file', 'folder', 'board', 'plan', 'attachment']); // attachment: uploaded into the chat itself
const canRead = (channel, username, channels = []) => {
  if (channel.startsWith('dm~')) return channel.split('~').slice(1).includes(username);
  const c = channels.find((x) => x.id === channel);
  return !!c && (!c.private || c.members?.includes(username));
};
const cleanMembers = (list, creator) =>
  [...new Set([creator, ...(Array.isArray(list) ? list : []).map(String)])].filter((u) => /^[\w.-]{1,64}$/.test(u));

async function loadChannels() {
  const saved = await readJson('chat/channels.json', null);
  if (saved) return saved;
  const first = {
    channels: [{ id: 'general', name: 'general', topic: 'Everything Sanktuary', createdBy: 'system', created: new Date().toISOString() }],
  };
  await mkdir(CHAT(), { recursive: true });
  await saveJson('chat/channels.json', first);
  return first;
}

async function readMessages(channel) {
  const lines = (await readFile(join(CHAT(), `${channel}.jsonl`), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const deleted = new Set();
  const msgs = [];
  for (const l of lines) {
    const m = JSON.parse(l);
    if (m.del) deleted.add(m.del);
    else msgs.push(m);
  }
  return msgs.filter((m) => !deleted.has(m.id));
}

async function chat(req, res, url) {
  const user = await currentUser(req, url, await loadConfig());
  const [, , , channel, sub, file] = url.pathname.split('/'); // /api/chat/<channel>/<typing|msgId|files>/<file>
  const { channels } = await loadChannels();

  if (!channel && req.method === 'GET') {
    await mkdir(CHAT(), { recursive: true });
    const files = await readdir(CHAT()).catch(() => []);
    const last = async (id) => {
      const s = await stat(join(CHAT(), `${id}.jsonl`)).catch(() => null);
      return s ? s.mtime.toISOString() : null;
    };
    const dms = files
      .filter((f) => f.startsWith('dm~') && f.endsWith('.jsonl'))
      .map((f) => f.slice(0, -6))
      .filter((id) => canRead(id, user.username));
    return json(res, {
      channels: await Promise.all(
        channels.filter((c) => canRead(c.id, user.username, channels)).map(async (c) => ({ ...c, lastAt: await last(c.id) })),
      ),
      dms: await Promise.all(
        dms.map(async (id) => ({
          id,
          with:
            id
              .split('~')
              .slice(1)
              .find((n) => n !== user.username) || user.username,
          lastAt: await last(id),
        })),
      ),
    });
  }
  if (!channel && req.method === 'POST') {
    const { name, topic, private: isPrivate, members } = await jsonBody(req);
    const id =
      String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || fail(400, 'Give the channel a name');
    if (channels.some((c) => c.id === id)) fail(409, 'That channel already exists');
    const c = {
      id,
      name: id,
      topic: String(topic || '').slice(0, 200),
      createdBy: user.username,
      created: new Date().toISOString(),
      ...(isPrivate ? { private: true, members: cleanMembers(members, user.username) } : {}),
    };
    const all = [...channels, c];
    await saveJson('chat/channels.json', { channels: all });
    emit('channel', c, (u) => canRead(c.id, u.username, all));
    return json(res, c);
  }

  const isDm = channel?.startsWith('dm~');
  if (isDm) {
    const names = channel.split('~').slice(1);
    if (names.length !== 2 || !names.every((n) => /^[\w.-]{1,64}$/.test(n)) || [...names].sort().join('~') !== names.join('~'))
      fail(400, 'Bad DM id');
    if (!names.includes(user.username)) fail(403, 'Not your conversation');
  } else if (!canRead(channel, user.username, channels)) fail(404, 'No such channel');
  const audience = (u) => canRead(channel, u.username, channels);

  // Files sent from a phone or computer straight into the conversation (data/chat/files/<channel>/).
  // Only people who can read the conversation can fetch them. Pictures get a compressed copy to show.
  if (sub === 'files') {
    const dir = join(CHAT(), 'files', channel);
    if (req.method === 'GET' && file) return stream(req, res, url.searchParams, join(dir, safeName(file)));
    if (req.method === 'PUT' && !file) {
      if (Number(req.headers['content-length'] || 0) > MAX_CHUNK)
        fail(413, 'Files sent in chat must be under 95 MB: put bigger ones in a space and share that');
      const name = safeName(url.searchParams.get('name'));
      const ext = extname(name).toLowerCase();
      const id = randomUUID();
      await mkdir(dir, { recursive: true });
      const saved = join(dir, id + (/^\.\w{1,8}$/.test(ext) ? ext : ''));
      await pipeline(req, createWriteStream(saved, BIG_BUFFER));
      const base = `/api/chat/${channel}/files/`;
      if (THUMBABLE.has(ext) && ext !== '.gif') {
        try {
          const img = await imageInput(saved, (await stat(saved)).size);
          await img
            .rotate()
            .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(join(dir, `${id}-view.webp`));
          return json(res, { url: `${base}${id}-view.webp`, original: base + basename(saved), name, image: true });
        } catch {} // not a readable picture: send it as a plain file
      }
      return json(res, { url: base + basename(saved), name, image: ext === '.gif' });
    }
    fail(405, 'Not allowed');
  }

  if (!sub && req.method === 'PATCH' && !isDm) {
    const c = channels.find((x) => x.id === channel);
    if (c.createdBy !== user.username && !user.admin) fail(403, 'Only the creator or an admin can change this channel');
    const input = await jsonBody(req);
    if (input.topic !== undefined) c.topic = String(input.topic).slice(0, 200);
    if (input.members !== undefined && c.private) c.members = cleanMembers(input.members, c.createdBy);
    await saveJson('chat/channels.json', { channels });
    emit('channel', c, (u) => canRead(c.id, u.username, channels));
    return json(res, c);
  }

  if (!sub && req.method === 'GET') {
    const before = url.searchParams.get('before');
    const msgs = (await readMessages(channel)).filter((m) => !before || m.at < before);
    return json(res, msgs.slice(-100));
  }
  if (!sub && req.method === 'POST') {
    const input = await jsonBody(req);
    const text = String(input.text || '').slice(0, 4000);
    const refs = (Array.isArray(input.refs) ? input.refs : [])
      .slice(0, 10)
      .filter((r) => r && REF_KINDS.has(r.kind))
      .map((r) => ({
        kind: r.kind,
        title: String(r.title || '').slice(0, 200),
        app: r.app,
        dir: Array.isArray(r.dir) ? r.dir.map(String) : undefined,
        name: r.name,
        boardId: r.boardId,
        // Only this conversation's own uploads can be attached, so a message can't point anywhere else
        ...(r.kind === 'attachment' &&
        typeof r.url === 'string' &&
        new RegExp(`^/api/chat/${channel.replace(/[^\w~-]/g, '')}/files/[\\w-]+\\.\\w{1,8}$`).test(r.url)
          ? { url: r.url, image: !!r.image }
          : {}),
      }))
      .filter((r) => r.kind !== 'attachment' || r.url);
    if (!text.trim() && !refs.length) fail(400, 'Empty message');
    const msg = { id: randomUUID().slice(0, 12), channel, user: user.username, at: new Date().toISOString(), text, refs };
    await mkdir(CHAT(), { recursive: true });
    await appendFile(join(CHAT(), `${channel}.jsonl`), JSON.stringify(msg) + '\n');
    emit('message', msg, audience);
    // A DM also reaches the other person's phone when they don't have Sanktuary open
    const other =
      isDm &&
      channel
        .split('~')
        .slice(1)
        .find((n) => n !== user.username);
    if (other && !tabs.has(other))
      push(other, { title: `Message from ${user.username}`, body: text.slice(0, 200) || 'Sent you a file', tag: channel }).catch(
        console.error,
      );
    return json(res, msg);
  }
  if (sub === 'typing' && req.method === 'POST') {
    emit('typing', { channel, user: user.username }, (u) => audience(u) && u.username !== user.username);
    return json(res, { ok: true });
  }
  if (sub && req.method === 'DELETE') {
    const msg = (await readMessages(channel)).find((m) => m.id === sub) || fail(404, 'No such message');
    if (msg.user !== user.username) fail(403, 'You can only delete your own messages');
    await appendFile(
      join(CHAT(), `${channel}.jsonl`),
      JSON.stringify({ del: sub, by: user.username, at: new Date().toISOString() }) + '\n',
    );
    emit('unmessage', { channel, id: sub }, audience);
    return json(res, { ok: true });
  }
  fail(404, 'Unknown chat action');
}

// ── /api/profiles: display name, status (away message), role, bio, links, avatar ──
const PROFILE_FIELDS = {
  displayName: 60,
  status: 140,
  role: 60,
  bio: 1000,
  pro: 80, // roster: "BMI · IPI 123456789" (members only, never public)
  rates: 1000, // roster: rate card / availability (members only, never public)
  ...Object.fromEntries(Object.keys(PROFILE_LINKS).map((k) => [k, 200])),
};

async function profiles(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const [, , , who, sub] = url.pathname.split('/'); // /api/profiles/<username|me>/<avatar>

  if (!who && req.method === 'GET') {
    const r = await clerk('/users?limit=100&order_by=-created_at');
    const users = r.ok ? (await r.json()).filter((u) => u.username) : [];
    const online = new Set(onlineList());
    return json(
      res,
      await Promise.all(
        users.map(async (u) => ({
          username: u.username,
          admin: cfg.admins.includes(u.username),
          online: online.has(u.username),
          lastSignIn: u.last_sign_in_at,
          ...(await readJson(`profiles/${u.username}.json`, {})),
        })),
      ),
    );
  }
  const name = who === 'me' ? user.username : who;
  if (!/^[\w.-]{1,64}$/.test(name || '')) fail(400, 'Bad username');

  if (sub === 'avatar' && req.method === 'GET')
    return stream(req, res, url.searchParams, join(DATA, 'profiles', 'avatars', `${name}.webp`));
  if (who !== 'me') fail(403, 'You can only change your own profile');

  if (sub === 'avatar' && req.method === 'PUT') {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 10 * 1024 * 1024) fail(413, 'Picture must be under 10 MB');
      chunks.push(c);
    }
    await mkdir(join(DATA, 'profiles', 'avatars'), { recursive: true });
    await writeFile(
      join(DATA, 'profiles', 'avatars', `${name}.webp`),
      await sharp(Buffer.concat(chunks)).rotate().resize(160, 160, { fit: 'cover' }).webp({ quality: 80 }).toBuffer(),
    );
    const profile = { ...(await readJson(`profiles/${name}.json`, {})), avatar: Date.now() };
    await mkdir(join(DATA, 'profiles'), { recursive: true });
    await saveJson(`profiles/${name}.json`, profile);
    emit('profile', { username: name, ...profile });
    return json(res, profile);
  }
  if (!sub && req.method === 'PUT') {
    const input = await jsonBody(req);
    const profile = { ...(await readJson(`profiles/${name}.json`, {})) };
    for (const [k, max] of Object.entries(PROFILE_FIELDS)) if (k in input) profile[k] = String(input[k] ?? '').slice(0, max);
    if ('listed' in input) profile.listed = input.listed === true; // shown in the public directory (My Computer)
    if ('bookable' in input) profile.bookable = input.bookable === true;
    profile.updated = new Date().toISOString();
    await mkdir(join(DATA, 'profiles'), { recursive: true });
    await saveJson(`profiles/${name}.json`, profile);
    emit('profile', { username: name, ...profile });
    return json(res, profile);
  }
  fail(404, 'Unknown profile action');
}

// ── /api/comments: timestamped feedback on team files (e.g. "vocals clip at 1:32") ──
// Keyed by space + path, stored in data/comments/<sha1>.json.
// ponytail: comments follow the path, so renaming/moving a file leaves its thread behind.
async function comments(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const q = url.searchParams;
  const space = spacesFor(user, cfg, { drives: [] }).find((s) => s.id === q.get('space')) || fail(404, 'No such space');
  const path = String(q.get('path') || '');
  if (!path || path.split('/').includes('..')) fail(400, 'Bad path');
  const key = space.id === 'me' ? `me:${user.username}|${path}` : `${space.id}|${path}`;
  const file = `comments/${createHash('sha1').update(key).digest('hex')}.json`;
  const thread = await readJson(file, { key, comments: [] });
  const audience = (u) => (space.id === 'me' ? u.username === user.username : true);

  if (req.method === 'GET') return json(res, thread.comments);
  if (req.method === 'POST' && q.has('heard')) {
    // Someone asked for feedback has listened (the player reports it after 30 s)
    const c = thread.comments.find((x) => x.id === q.get('id') && x.ask?.to.includes(user.username)) || fail(404, 'No such request');
    if (!c.ask.heard[user.username]) {
      c.ask.heard[user.username] = new Date().toISOString();
      await saveJson(file, thread);
      emit('comment', { space: space.id, path, comment: c }, (u) => audience(u));
    }
    return json(res, c);
  }
  if (req.method === 'POST') {
    const input = await jsonBody(req);
    const text =
      String(input.text || '')
        .trim()
        .slice(0, 2000) || fail(400, 'Empty comment');
    const t = Number.isFinite(input.t) && input.t >= 0 ? Math.round(input.t * 10) / 10 : null;
    const c = { id: randomUUID().slice(0, 12), user: user.username, at: new Date().toISOString(), t, text };
    // A feedback request: "listen by Friday: is the vocal too loud?" to named people who can open this file.
    // They're notified with a link to the file; their comments are the answers; listening is recorded (?heard).
    if (input.ask && space.id !== 'me') {
      const [members, status] = [await currentMembers(), await loadStatus()];
      const canOpen = (u) =>
        u !== user.username &&
        members.has(u) &&
        spacesFor({ username: u, admin: cfg.admins.includes(u) }, cfg, status).some((s) => s.id === space.id);
      const to = [...new Set((Array.isArray(input.ask.to) ? input.ask.to : []).map(String))].filter(canOpen).slice(0, 20);
      if (!to.length) fail(400, 'Pick at least one person who can open this file');
      c.ask = { to, due: input.ask.due ? dateOrNull(input.ask.due) : null, heard: {} };
    }
    thread.comments.push(c);
    await mkdir(join(DATA, 'comments'), { recursive: true });
    await saveJson(file, thread);
    emit('comment', { space: space.id, path, comment: c }, (u) => audience(u));
    if (space.id !== 'me') logActivity(user, 'commented on', { space: space.id, spaceName: space.name, path, text: text.slice(0, 120), t });
    const parts = path.split('/');
    for (const u of c.ask?.to || [])
      await notify(
        u,
        `${user.username} asks for your ears on ${parts[parts.length - 1]}${c.ask.due ? ` (by ${c.ask.due})` : ''}: "${text.slice(0, 140)}"`,
        {
          open: { space: space.id, dir: parts.slice(0, -1), name: parts[parts.length - 1] },
        },
      );
    return json(res, c);
  }
  if (req.method === 'DELETE') {
    const c = thread.comments.find((x) => x.id === q.get('id')) || fail(404, 'No such comment');
    if (c.user !== user.username && !user.admin) fail(403, 'You can only delete your own comments');
    thread.comments = thread.comments.filter((x) => x.id !== c.id);
    await saveJson(file, thread);
    emit('uncomment', { space: space.id, path, id: c.id }, (u) => audience(u));
    return json(res, { ok: true });
  }
  fail(405, 'Not allowed');
}

// ── /api/video: the quick video editor's renders ──
// The editor (in the browser) sends: a clip and an optional song from the drives, the part to use, a format, how the
// clip fills it, a look, and its captions already drawn as transparent PNGs (so they match the preview exactly).
// ffmpeg renders an MP4 into the chosen folder, one render at a time, and the editor of it gets a notification.
// Only fixed filter snippets and checked numbers go into the ffmpeg command; nothing typed by a person does.
const VIDEO_FORMATS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const VIDEO_IN = { '.mp4': 'mov', '.m4v': 'mov', '.mov': 'mov', '.webm': 'matroska' };
const VIDEO_LOOKS = {
  none: 'null',
  lux: 'eq=contrast=1.12:saturation=1.5,unsharp=7:7:1.0,colorbalance=rs=0.06:gs=0.02:bs=-0.08:rm=0.05:bm=-0.07,vignette=PI/4',
  faded: "curves=all='0/0.12 1/0.93',eq=saturation=0.9,colorbalance=rh=0.05:bh=-0.05",
  bw: 'hue=s=0,eq=contrast=1.3',
  cold: "colorbalance=rs=-0.1:bs=0.14:rm=-0.08:bm=0.1,eq=contrast=0.88:saturation=0.6,curves=all='0/0.1 1/0.9',noise=alls=6:allf=t",
  tungsten: 'eq=brightness=-0.06:saturation=0.75:gamma=0.85,colorbalance=rs=0.15:gs=0.02:bs=-0.2:rm=0.12:bm=-0.15,vignette=PI/3.2',
  club: 'colorbalance=rs=0.04:gs=-0.08:bs=0.16,eq=contrast=1.15:saturation=1.2,vignette=PI/4',
};
const videoJobs = new Map(); // id -> job (until the server restarts)
let videoQueue = Promise.resolve();

async function videoApi(req, res, url) {
  const cfg = await loadConfig();
  const user = await currentUser(req, url, cfg);
  const [, , , what] = url.pathname.split('/');
  if (req.method === 'GET' && !what)
    return json(
      res,
      [...videoJobs.values()]
        .filter((j) => j.by === user.username)
        .slice(-10)
        .reverse(),
    );
  if (!(req.method === 'POST' && what === 'render')) fail(404, 'Unknown video action');

  // captions come as pictures: a bigger request than usual
  const raw = await body(req, 40e6);
  let input;
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    fail(400, 'Bad JSON');
  }
  const spaces = spacesFor(user, cfg, await loadStatus());
  const file = (ref, kinds, level = 'view') => {
    const space = spaces.find((s) => s.id === String(ref?.space || '')) || fail(404, 'No such space');
    if (!space.online) fail(503, 'Drive offline');
    if (RANK[space.rights] < RANK[level]) fail(403, `You need ${level} rights in ${space.name}`);
    const { abs } = locateIn(space, ref.path);
    const fmt = kinds[extname(abs).toLowerCase()];
    return { space, abs, fmt };
  };
  const clip = file(input.clip, VIDEO_IN);
  if (!clip.fmt) fail(400, 'Pick a video (MP4, MOV, M4V or WebM)');
  if (!(await stat(clip.abs).catch(() => null))?.isFile()) fail(404, 'That video is gone');
  const song = input.song ? file(input.song, CLIP_FORMATS) : null;
  if (song && !song.fmt) fail(400, 'Pick a song (WAV, AIFF, FLAC, MP3, M4A or OGG)');
  if (song && !(await stat(song.abs).catch(() => null))?.isFile()) fail(404, 'That song is gone');
  const num = (v, min, max, name) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1000) / 1000 : fail(400, `Bad ${name}`);
  };
  const start = num(input.start ?? 0, 0, 36000, 'start');
  const duration = num(input.duration, 1, 180, 'length (up to 3 minutes)');
  const songAt = song ? num(input.songAt ?? 0, 0, 36000, 'song start') : 0;
  const [W, H] = own(VIDEO_FORMATS, input.format) || fail(400, 'Pick a format');
  const fit = ['crop', 'fit', 'stretch', 'duo'].includes(input.fit) ? input.fit : fail(400, 'Pick how the clip fills the frame');
  const look = own(VIDEO_LOOKS, input.look) || fail(400, 'Pick a look');
  const captions = (Array.isArray(input.captions) ? input.captions : []).slice(0, 80).map((c) => {
    const png = Buffer.from(String(c?.png || '').replace(/^data:image\/png;base64,/, ''), 'base64');
    if (png.length > 3e6 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(400, 'Captions must be PNG pictures');
    const from = num(c.start, 0, duration, 'caption start');
    return { png, from, to: num(c.end, from, duration, 'caption end') };
  });
  // Where it goes: a folder you can add to, named after the clip unless you say otherwise
  const out = file({ space: input.out?.space, path: input.out?.dir ?? '' }, { '': true }, 'upload');
  if (!(await stat(out.abs).catch(() => null))?.isDirectory()) fail(404, 'That folder is gone');
  const name = freeName(
    out.abs,
    `${safeName(
      String(input.name || basename(clip.abs, extname(clip.abs)) + ' edit')
        .replace(/\.mp4$/i, '')
        .slice(0, 100),
    )}.mp4`,
  );
  if ([...videoJobs.values()].filter((j) => j.by === user.username && ['Waiting', 'Rendering'].includes(j.status)).length >= 3)
    fail(429, 'You already have 3 videos rendering. Wait for one to finish.');

  const job = { id: randomUUID().slice(0, 10), by: user.username, name, status: 'Waiting', pct: 0, error: null, space: out.space.id };
  videoJobs.set(job.id, job);
  const outDir = relative(resolve(out.space.root), out.abs).split(sep).filter(Boolean);
  videoQueue = videoQueue.then(async () => {
    job.status = 'Rendering';
    const tmp = await mkdtemp(join(os.tmpdir(), 'sk-render-'));
    const part = join(out.abs, `.sk-render-${job.id}.mp4`);
    try {
      const caps = [];
      for (const [i, c] of captions.entries()) {
        const p = join(tmp, `c${i}.png`);
        await writeFile(p, c.png);
        caps.push({ ...c, p });
      }
      const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-protocol_whitelist', 'file'];
      args.push('-ss', String(start), '-t', String(duration), '-f', clip.fmt, '-i', clip.abs);
      if (song) args.push('-ss', String(songAt), '-t', String(duration), '-f', song.fmt, '-i', song.abs);
      for (const c of caps) args.push('-f', 'image2', '-loop', '1', '-t', String(duration), '-i', c.p);
      const fitChain =
        fit === 'crop'
          ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
          : fit === 'fit'
            ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`
            : fit === 'stretch'
              ? `scale=${W}:${H}`
              : `scale=${W / 2}:${H},setsar=1,split[d1][d2];[d1][d2]hstack=inputs=2`; // the "stretch duo"
      const graph = [`[0:v]${fitChain}[f]`, `[f]setsar=1,fps=30,${look}[v0]`];
      const first = song ? 2 : 1;
      caps.forEach((c, i) => graph.push(`[v${i}][${first + i}:v]overlay=0:0:enable='between(t,${c.from},${c.to})'[v${i + 1}]`));
      graph.push(`[v${caps.length}]format=yuv420p[vout]`);
      args.push('-filter_complex', graph.join(';'), '-map', '[vout]', '-map', song ? '1:a:0' : '0:a:0?');
      args.push('-af', `afade=t=out:st=${Math.max(0, duration - 1)}:d=1`);
      args.push('-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k');
      args.push('-movflags', '+faststart', '-f', 'mp4', '-y', part);
      const code = await new Promise((done) => {
        const ff = spawn(ffmpegPath, args, { windowsHide: true });
        const timer = setTimeout(() => ff.kill(), 15 * 60_000);
        let err = '';
        ff.stderr.on('data', (d) => (err = (err + d).slice(-400)));
        ff.stdout.on('data', (d) => {
          const us = Number(String(d).match(/out_time_us=(\d+)/)?.[1]);
          if (us) job.pct = Math.min(99, Math.floor(us / 1e4 / duration));
        });
        ff.on('error', () => done(-1));
        ff.on('close', (c) => {
          clearTimeout(timer);
          if (c) job.error = err.trim().split('\n').pop()?.slice(0, 200) || null;
          done(c);
        });
      });
      if (code !== 0) throw new Error(job.error || "The render didn't finish");
      await rename(part, join(out.abs, name));
      forgetSizes();
      await setOwner(out.space, join(out.abs, name), user);
      Object.assign(job, { status: 'Done', pct: 100 });
      await notify(user.username, `Your video "${name}" is ready.`, { open: { space: out.space.id, dir: outDir, name } });
    } catch (e) {
      await rm(part, { force: true });
      Object.assign(job, { status: 'Failed', error: String(e.message || e).slice(0, 200) });
      await notify(user.username, `The video "${name}" didn't render: ${job.error}`, {}).catch(() => {});
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
  res.writeHead(202, { 'content-type': 'application/json' });
  return res.end(JSON.stringify(job));
}

// ── /api/mail: the mailing list (Resend) — data/mail.json ──
// Double opt-in: signing up sends a confirmation link; only confirmed people get mail. Every email has a one-click
// unsubscribe link (and List-Unsubscribe headers mail apps show as a button) and the postal address the law asks for;
// nothing sends until that address is set. Drips: day-N emails after someone confirms. Broadcasts: one email to all.
// Needs RESEND_API_KEY and MAIL_FROM ("Sanktuary <hello@sanktuary.studio>", a domain verified in Resend).
const RESEND = process.env.RESEND_API_URL || 'https://api.resend.com';
const mailReady = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
let mailDb = null;
let mailSaved = Promise.resolve();
const loadMail = async () =>
  (mailDb ??= await readJson('mail.json', {
    subscribers: {},
    sequence: [],
    broadcasts: [],
    settings: {
      address: '',
      offerTitle: 'Free guides from Sanktuary',
      offerText: 'Mixing tips, release checklists and first looks at new music. Straight to your inbox, now and then.',
    },
  }));
const saveMail = () => (mailSaved = mailSaved.then(() => saveJson('mail.json', mailDb)).catch(console.error));
const mailTries = new Map(); // address -> { n, since }
const unsubSig = (id) => sign(`unsub:${id}`);
const mailEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small page for the confirm / unsubscribe links (no scripts). */
function mailPage(res, title, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  });
  res.end(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${mailEsc(title)}</title>` +
      `<body style="font:16px/1.5 Arial,sans-serif;background:#008080;margin:0;padding:40px 16px"><div style="max-width:460px;margin:auto;background:#c0c0c0;border:2px outset #fff;padding:20px">` +
      `<h1 style="font-size:20px;margin:0 0 10px">${mailEsc(title)}</h1>${body}<p><a href="/">Go to Sanktuary</a></p></div>`,
  );
}

/** One email through Resend: plain text plus a simple HTML copy, with the unsubscribe link and the postal address. */
async function sendMail(sub, subject, text, origin) {
  const settings = (await loadMail()).settings;
  // No subscriber id = a one-to-one email (an artist's welcome), not list mail: no unsubscribe footer
  const unsub = sub.id && `${origin}/api/mail/unsubscribe?id=${sub.id}&sig=${unsubSig(sub.id)}`;
  const body = String(text).replace(/\{name\}/g, sub.name || 'there');
  const foot = unsub ? `\n\n—\nYou get this because you signed up at ${origin}.\nUnsubscribe: ${unsub}\n${settings.address}` : '';
  const html =
    `<div style="font:15px/1.55 Arial,sans-serif;color:#111;max-width:560px">${mailEsc(body).replace(/\n/g, '<br>')}` +
    (unsub
      ? `<p style="color:#777;font-size:12px;margin-top:28px">You get this because you signed up at ${mailEsc(origin)}.<br>` +
        `<a href="${mailEsc(unsub)}">Unsubscribe</a> · ${mailEsc(settings.address)}</p>`
      : '') +
    `</div>`;
  const r = await fetch(`${RESEND}/emails`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [sub.email],
      subject: String(subject)
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 150),
      text: body + foot,
      html,
      headers: unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
    }),
  });
  if (!r.ok) throw new Error(`Resend refused the email (${r.status})`);
}

/** Sends due drip emails (each step only to people who reach it after the step existed), paced for Resend's limits. */
let mailRunning = false;
async function mailDrips(origin) {
  if (mailRunning || !mailReady()) return;
  const db = await loadMail();
  if (!db.settings.address) return;
  mailRunning = true;
  try {
    let n = 0;
    for (const sub of Object.values(db.subscribers)) {
      if (sub.status !== 'confirmed') continue;
      for (const step of [...db.sequence].sort((a, b) => a.day - b.day)) {
        const due = Date.parse(sub.confirmed) + step.day * 864e5;
        if (sub.sent?.[step.id] || due > Date.now() || due < Date.parse(step.created) - 864e5) continue;
        if (n++ >= 100) return; // the rest go next hour
        (sub.sent ??= {})[step.id] = new Date().toISOString();
        saveMail();
        await sendMail(sub, step.subject, step.body, origin).catch((e) => console.error('drip', e.message));
        await new Promise((r) => setTimeout(r, 550));
      }
    }
  } finally {
    mailRunning = false;
  }
}
setInterval(() => mailDrips(SITE_ORIGINS[0] || 'https://sanktuary.studio').catch(console.error), 3.6e6).unref();

async function mailApi(req, res, url) {
  const [, , , what, id] = url.pathname.split('/');
  const db = await loadMail();
  const q = url.searchParams;
  const origin = siteOrigin(req);
  if (req.method === 'GET' && !what) return json(res, { open: mailReady(), title: db.settings.offerTitle, text: db.settings.offerText });

  if (req.method === 'POST' && what === 'subscribe') {
    // Visitors: 5 tries an hour per address, a honeypot, a real-looking email and a ticked consent box
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const t = mailTries.get(ip);
    const tries = t && Date.now() - t.since < 60 * 60_000 ? t : { n: 0, since: Date.now() };
    if (tries.n >= 5) fail(429, 'Too many tries. Try again in an hour.');
    if (mailTries.size > 5000) for (const [k, x] of mailTries) if (Date.now() - x.since > 60 * 60_000) mailTries.delete(k);
    mailTries.set(ip, { ...tries, n: tries.n + 1 });
    const input = await jsonBody(req);
    const done = () => json(res, { ok: true }); // the same answer whether or not they were already on the list
    if (input.website) return done();
    if (!mailReady()) fail(503, 'The mailing list opens soon.');
    const email = String(input.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 200);
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) fail(400, 'That email address looks wrong');
    if (input.consent !== true) fail(400, 'Tick the box to say we can email you');
    let sub = Object.values(db.subscribers).find((s) => s.email === email);
    if (sub?.status === 'confirmed') return done();
    if (sub && sub.status === 'pending' && Date.now() - Date.parse(sub.asked || 0) < 10 * 60_000) return done();
    sub ??= { id: randomUUID().slice(0, 12), email, created: new Date().toISOString() };
    Object.assign(sub, {
      name: String(input.name || '')
        .trim()
        .slice(0, 60),
      source: String(input.source || 'site').slice(0, 40),
      status: 'pending',
      token: randomBytes(24).toString('base64url'),
      asked: new Date().toISOString(),
      consent: new Date().toISOString(), // when they ticked the box (kept as the record of consent)
    });
    db.subscribers[sub.id] = sub;
    saveMail();
    await sendMail(
      sub,
      'Confirm you want Sanktuary emails',
      `Hi {name},\n\nConfirm your email to get ${db.settings.offerTitle.toLowerCase()}:\n${origin}/api/mail/confirm?token=${sub.token}\n\nIf this wasn't you, ignore this email and nothing happens.`,
      origin,
    ).catch((e) => console.error('confirm mail', e.message));
    return done();
  }
  if (req.method === 'GET' && what === 'confirm') {
    const sub = Object.values(db.subscribers).find((s) => s.token && s.token === q.get('token'));
    if (!sub) return mailPage(res, 'That link has expired', '<p>Sign up again on the site to get a fresh one.</p>');
    Object.assign(sub, { status: 'confirmed', confirmed: sub.confirmed || new Date().toISOString(), token: null });
    saveMail();
    mailDrips(origin).catch(console.error); // the welcome email goes now
    return mailPage(res, "You're in", '<p>Thanks for confirming. The first email is on its way.</p>');
  }
  if (what === 'unsubscribe') {
    // The link from every email: GET shows a button (link scanners never unsubscribe anyone), POST unsubscribes
    // (mail apps' one-click unsubscribe POSTs here too)
    const sub = own(db.subscribers, q.get('id') || '');
    const sig = String(q.get('sig') || '');
    const okSig =
      !!sub &&
      Buffer.byteLength(sig) === Buffer.byteLength(unsubSig(sub.id)) &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(unsubSig(sub.id)));
    if (!okSig) return mailPage(res, 'That link is broken', '<p>Reply to any of our emails and we will take you off the list.</p>');
    if (req.method === 'POST') {
      req.resume();
      Object.assign(sub, { status: 'unsubscribed', unsub: new Date().toISOString() });
      saveMail();
      return mailPage(res, "You're unsubscribed", `<p>${mailEsc(sub.email)} won't get any more emails from us.</p>`);
    }
    return mailPage(
      res,
      'Unsubscribe?',
      `<p>Stop emails to ${mailEsc(sub.email)}?</p><form method="post"><button style="font:inherit;padding:6px 16px">Unsubscribe</button></form>`,
    );
  }

  // Admins: the list, the drip sequence, broadcasts and settings
  const user = await currentUser(req, url, await loadConfig());
  if (!user.admin) fail(403, 'Administrators only');
  if (req.method === 'GET' && what === 'admin') {
    const subs = Object.values(db.subscribers);
    return json(res, {
      configured: mailReady(),
      settings: db.settings,
      counts: Object.fromEntries(['confirmed', 'pending', 'unsubscribed'].map((s) => [s, subs.filter((x) => x.status === s).length])),
      subscribers: subs
        .map(({ id, email, name, status, source, created, confirmed }) => ({ id, email, name, status, source, created, confirmed }))
        .sort((a, b) => b.created.localeCompare(a.created)),
      sequence: [...db.sequence].sort((a, b) => a.day - b.day),
      broadcasts: db.broadcasts.slice(-20).reverse(),
    });
  }
  if (req.method === 'PATCH' && what === 'settings') {
    const input = await jsonBody(req);
    for (const [k, max] of Object.entries({ address: 300, offerTitle: 80, offerText: 400 }))
      if (input[k] !== undefined) db.settings[k] = String(input[k] ?? '').slice(0, max);
    saveMail();
    return json(res, db.settings);
  }
  if (req.method === 'PUT' && what === 'sequence') {
    const input = await jsonBody(req);
    const steps = (Array.isArray(input.sequence) ? input.sequence : []).slice(0, 20).map((s) => {
      const old = s?.id && db.sequence.find((x) => x.id === s.id);
      const day = Math.floor(Number(s?.day));
      if (!(day >= 0 && day <= 365)) fail(400, 'Days go from 0 to 365');
      const subject =
        String(s?.subject || '')
          .replace(/[\r\n]+/g, ' ')
          .trim()
          .slice(0, 150) || fail(400, 'Every email needs a subject');
      return {
        id: old?.id || randomUUID().slice(0, 8),
        day,
        subject,
        body: String(s?.body || '').slice(0, 10000),
        created: old?.created || new Date().toISOString(),
      };
    });
    db.sequence = steps;
    saveMail();
    return json(res, steps);
  }
  if (req.method === 'POST' && what === 'broadcast') {
    const input = await jsonBody(req);
    if (!mailReady()) fail(503, 'Email isn’t set up on the server yet (RESEND_API_KEY / MAIL_FROM)');
    if (!db.settings.address) fail(400, 'Add the postal address first (the law asks for it in every email)');
    const subject =
      String(input.subject || '')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 150) || fail(400, 'Give it a subject');
    const text = String(input.body || '').slice(0, 20000) || fail(400, 'Write something');
    if (input.testTo) {
      const to = String(input.testTo).trim().toLowerCase();
      if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to)) fail(400, 'That test address looks wrong');
      await sendMail({ id: 'test', email: to, name: user.username }, `[Test] ${subject}`, text, origin);
      return json(res, { test: true });
    }
    const to = Object.values(db.subscribers).filter((s) => s.status === 'confirmed');
    const b = { id: randomUUID().slice(0, 8), subject, by: user.username, at: new Date().toISOString(), to: to.length, sent: 0, failed: 0 };
    db.broadcasts.push(b);
    saveMail();
    (async () => {
      for (const sub of to) {
        if (sub.status !== 'confirmed') continue; // unsubscribed while it was going out
        await sendMail(sub, subject, text, origin).then(
          () => b.sent++,
          () => b.failed++,
        );
        saveMail();
        await new Promise((r) => setTimeout(r, 550));
      }
      await notify(user.username, `Email "${subject}" sent to ${b.sent} people${b.failed ? ` (${b.failed} failed)` : ''}.`, {});
    })().catch(console.error);
    return json(res, b);
  }
  if (req.method === 'DELETE' && what === 'subscribers') {
    // Someone asked to be forgotten: removed completely (not just unsubscribed)
    own(db.subscribers, id || '') || fail(404, 'No such subscriber');
    delete db.subscribers[id];
    saveMail();
    return json(res, { ok: true });
  }
  fail(404, 'Unknown mail action');
}

// ── /api/youtube: post videos from the drives straight to the Sanktuary YouTube channel ──
// An admin connects the channel once (Google's own consent screen); the server keeps only the refresh token, in
// data/youtube.json, and never sends it to a browser. Uploads stream from the drive to YouTube in the background and
// the admin gets a notification with the link; with a release, the video goes on its public page.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google Cloud > YouTube Data API v3 > OAuth client, web app,
// redirect URI https://sanktuary.studio/api/youtube/callback). The URLs can be pointed elsewhere for tests.
const GOOGLE_AUTH = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const YT_API = process.env.YOUTUBE_API_URL || 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD = process.env.YOUTUBE_UPLOAD_URL || 'https://www.googleapis.com/upload/youtube/v3/videos';
const ytReady = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const ytStates = new Map(); // one-time state for the consent screen -> { user, exp }
const ytJobs = new Map(); // upload id -> progress (kept until the server restarts)
const YT_VIDEO = new Set(['.mp4', '.m4v', '.mov', '.webm']);

/** The 11-character id from a YouTube link (or a bare id), else null. */
function youtubeId(v) {
  const s = String(v || '').trim();
  const m =
    s.match(/^[\w-]{11}$/) ||
    s.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/);
  return m ? m[1] || m[0] : null;
}

async function ytToken() {
  const saved = await readJson('youtube.json', null);
  if (!saved?.refresh_token) fail(409, 'Connect the YouTube channel first (Admin Panel > Front page)');
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: saved.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) fail(502, 'YouTube refused the saved connection: connect the channel again');
  return t.access_token;
}

async function youtubeApi(req, res, url) {
  const [, , , what] = url.pathname.split('/');
  const cfg = await loadConfig();
  if (what === 'callback') {
    // Google sends the admin back here with a one-time code: swap it for a refresh token and remember the channel
    const q = url.searchParams;
    const st = ytStates.get(q.get('state') || '');
    ytStates.delete(q.get('state') || '');
    const user = await currentUser(req, url, cfg).catch(() => null);
    const back = (ok) => (res.writeHead(303, { location: `/?youtube=${ok ? 'connected' : 'failed'}` }), res.end());
    if (!st || st.exp < Date.now() || !user || user.username !== st.user || !user.admin || !q.get('code')) return back(false);
    const r = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.get('code'),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${siteOrigin(req)}/api/youtube/callback`,
        grant_type: 'authorization_code',
      }),
    }).catch(() => null);
    const t = r?.ok ? await r.json().catch(() => ({})) : {};
    if (!t.refresh_token || !t.access_token) return back(false);
    const ch = await fetch(`${YT_API}/channels?part=snippet&mine=true`, { headers: { authorization: `Bearer ${t.access_token}` } })
      .then((x) => (x.ok ? x.json() : {}))
      .catch(() => ({}));
    const c = ch.items?.[0];
    await saveJson('youtube.json', {
      refresh_token: t.refresh_token,
      channel: c ? { id: String(c.id).slice(0, 40), title: String(c.snippet?.title || '').slice(0, 100) } : null,
      by: user.username,
      at: new Date().toISOString(),
    });
    return back(true);
  }
  const user = await currentUser(req, url, cfg);
  if (!user.admin) fail(403, 'Only admins post to the YouTube channel');
  if (req.method === 'GET' && !what) {
    const saved = await readJson('youtube.json', null);
    return json(res, {
      configured: ytReady(),
      connected: !!saved?.refresh_token,
      channel: saved?.channel || null,
      jobs: [...ytJobs.values()]
        .filter((j) => j.by === user.username)
        .slice(-10)
        .reverse(),
    });
  }
  if (req.method === 'GET' && what === 'connect') {
    if (!ytReady()) fail(503, 'YouTube isn’t set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)');
    const state = randomBytes(24).toString('base64url');
    for (const [k, v] of ytStates) if (v.exp < Date.now()) ytStates.delete(k);
    ytStates.set(state, { user: user.username, exp: Date.now() + 10 * 60_000 });
    const to = new URL(GOOGLE_AUTH);
    to.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${siteOrigin(req)}/api/youtube/callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
    res.writeHead(302, { location: to.href });
    return res.end();
  }
  if (req.method === 'DELETE' && !what) {
    await rm(join(DATA, 'youtube.json'), { force: true });
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && what === 'upload') {
    const input = await jsonBody(req);
    const space = spacesFor(user, cfg, await loadStatus()).find((s) => s.id === String(input.space || '')) || fail(404, 'No such space');
    if (!space.online) fail(503, 'Drive offline');
    const { abs } = locateIn(space, input.path);
    if (!YT_VIDEO.has(extname(abs).toLowerCase())) fail(400, 'Only videos (MP4, MOV, M4V, WebM) go to YouTube');
    const s = (await stat(abs).catch(() => null)) || fail(404, 'That file is gone');
    if (!s.isFile()) fail(400, 'Pick a video file');
    const title =
      String(input.title || basename(abs, extname(abs)))
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, 100) || fail(400, 'Give it a title');
    const description = String(input.description || '')
      .replace(/[<>]/g, '')
      .slice(0, 4900);
    const privacy = ['private', 'unlisted', 'public'].includes(input.privacy) ? input.privacy : 'unlisted';
    const tdb = await loadTracks();
    const rel = input.release ? own(tdb.releases, String(input.release)) : null;
    if (input.release && (!rel || rel.deleted || !canSeeRelease(user, rel))) fail(404, 'No such release');
    const access = await ytToken(); // fails now (not in the background) if the channel isn't connected
    const job = {
      id: randomUUID().slice(0, 10),
      by: user.username,
      file: basename(abs),
      title,
      status: 'Uploading',
      pct: 0,
      url: null,
      error: null,
    };
    ytJobs.set(job.id, job);
    // ponytail: one straight upload; a dropped connection means starting again (YouTube supports resuming if needed)
    (async () => {
      const init = await fetch(`${YT_UPLOAD}?uploadType=resumable&part=snippet,status`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': 'video/*',
          'x-upload-content-length': String(s.size),
        },
        body: JSON.stringify({
          snippet: { title, description, categoryId: '10' }, // Music
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
        }),
      });
      const where = init.headers.get('location');
      if (!init.ok || !where) throw new Error(`YouTube refused the upload (${init.status})`);
      const file = createReadStream(abs, BIG_BUFFER);
      let sent = 0;
      file.on('data', (c) => (job.pct = Math.floor(((sent += c.length) / s.size) * 100)));
      const up = await fetch(where, {
        method: 'PUT',
        headers: { 'content-length': String(s.size), 'content-type': 'video/*' },
        body: Readable.toWeb(file),
        duplex: 'half',
      });
      const v = await up.json().catch(() => ({}));
      if (!up.ok || !v.id) throw new Error(`YouTube didn't accept the video (${up.status})`);
      Object.assign(job, { status: 'Done', pct: 100, url: `https://youtu.be/${v.id}` });
      if (rel) {
        rel.videoId = v.id;
        saveTracks();
      }
      await notify(user.username, `On YouTube (${privacy}): "${title}" ${job.url}${rel ? ` · now on the ${rel.title} page` : ''}`, {});
    })().catch(async (e) => {
      Object.assign(job, { status: 'Failed', error: String(e.message).slice(0, 200) });
      await notify(user.username, `YouTube upload of "${title}" failed: ${job.error}`, {}).catch(() => {});
    });
    res.writeHead(202, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(job));
  }
  fail(404, 'Unknown YouTube action');
}

const routes = [
  ['/healthz', healthz],
  ['/api/files/', files],
  ['/api/me', me],
  ['/api/admin/', admin],
  ['/api/boards', boardsApi],
  ['/api/logout', logout],
  ['/api/live', live],
  ['/api/chat', chat],
  ['/api/profiles', profiles],
  ['/api/comments', comments],
  ['/api/activity', activity],
  ['/api/projects', projectsApi],
  ['/api/links', linksApi],
  ['/api/push', pushApi],
  ['/api/tracks', tracksApi],
  ['/api/timeline', timelineApi],
  ['/api/opportunities', opportunitiesApi],
  ['/api/outreach', outreachApi],
  ['/api/youtube', youtubeApi],
  ['/api/mail', mailApi],
  ['/api/video', videoApi],
  ['/api/business', businessApi],
  ['/api/blog', blogApi],
  ['/api/public', publicApi],
  ['/api/raw/', rawApi],
  ['/apps/rapidraw', rawUi],
  ['/api/pools', poolsApi],
  ['/api/shop', shopApi],
  ['/api/stripe/webhook', stripeWebhook],
  ['/pool/', storePage],
  ['/shop', storePage],
  ['/blog', blogPage],
  ['/story/', storyPage],
  ['/release/', htmlPage(RELEASE_PAGE)],
  ['/portfolio', htmlPage(PORTFOLIO_PAGE)],
  ['/api/stories', storiesApi],
  ['/s/', publicShare],
  // Normally the service worker answers the phone's "Share to Sanktuary"; if it wasn't running, say so instead of 404
  ['/share-target', (req, res) => (req.resume(), res.writeHead(303, { location: '/?share=missed' }).end())],
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    if (/https/.test(req.headers['cf-visitor'] || '')) res.setHeader('strict-transport-security', 'max-age=31536000');
    const handler = routes.find(([prefix]) => url.pathname.startsWith(prefix))?.[1] || staticFile;
    // new Promise catches handlers that throw synchronously too (a plain function calling fail())
    new Promise((ok) => ok(handler(req, res, url))).catch((err) => {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // viewer closed/seeked a media stream
      if (err instanceof URIError) err = Object.assign(new Error('Bad address'), { status: 400 }); // malformed %-escapes
      const status = err.status || { EEXIST: 409, ENOENT: 404, ENOTEMPTY: 409 }[err.code] || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent)
        send(res, status, status === 500 ? 'Server error' : err.status ? err.message : { 409: 'Already exists', 404: 'Not found' }[status]);
      else res.destroy();
    });
  })
  .listen(PORT, HOST, () => console.log(`${new Date().toISOString()} sanktuary-os on ${HOST}:${PORT}`));
