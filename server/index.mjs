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
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
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
  '.mov': 'video/quicktime',
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
};
const THUMBABLE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.tif', '.tiff', '.psd']);
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

// ── Config & status files ──────────────────────────────────────────────
const readJson = async (file, fallback) =>
  JSON.parse((await readFile(join(DATA, file), 'utf8').catch(() => 'null')).replace(/^﻿/, '')) ?? fallback; // PowerShell may write a BOM
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

/** Every space this user can see, including their personal space ("me"). */
function spacesFor(user, cfg, status) {
  const list = cfg.spaces
    .map((s) => ({ ...s, rights: user.admin ? 'edit' : s.access?.[user.username] || s.everyone || 'none', sub: s.path || '' }))
    .filter((s) => RANK[s.rights] > 0);
  const mine = cfg.members[user.username];
  if (mine?.drive) {
    list.unshift({
      id: 'me',
      name: `My Space (${user.username})`,
      drive: mine.drive,
      rights: 'edit',
      quotaGB: mine.quotaGB,
      sub: join('Sanktuary Members', user.username),
    });
  }
  return list.map((s) => {
    const dir = driveDir(cfg, status, s.drive);
    return { ...s, online: !!dir, driveRoot: dir, root: dir ? join(dir, s.sub) : null };
  });
}

// Folder sizes (personal-space quotas, zip progress) are cached for a minute and dropped on any write, so
// refreshing the desktop doesn't re-walk every file on the drive each time.
const sizeCache = new Map(); // dir -> { size, at }
const forgetSizes = () => sizeCache.clear();
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
  const fs = await statfs(s.driveRoot).catch(() => null);
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
  const space = spacesFor(user, cfg, status).find((s) => s.id === spaceId) || fail(404, 'No such space');
  if (!space.online) fail(503, 'Drive offline');
  if (space.id === 'me') await mkdir(space.root, { recursive: true });

  const root = resolve(space.root);
  const parts = rest.map(decodeURIComponent);
  if (parts.some((p) => /[:\x00-\x1f]/.test(p))) fail(400, 'Bad path');
  const target = resolve(root, ...parts);
  if (!inside(root, target)) fail(400, 'Bad path');
  const rel = relative(root, target);
  const need = (level) => RANK[space.rights] >= RANK[level] || fail(403, `You need ${level} rights here`);
  const q = url.searchParams;

  // Downloads of projects say why: view only / playground copy / check-out
  const purpose = { view: ' (view only)', playground: ' (playground copy)', checkout: ' (checked out)' }[q.get('purpose')] || '';
  const transfer = (action, bytes, path = rel) => logTransfer(req, user, action + purpose, space, path.split(sep).join('/'), bytes);
  if (req.method !== 'GET') forgetSizes(); // any change to files: cached folder sizes are stale
  if (req.method === 'GET') {
    need('view');
    if (q.has('list')) {
      const all = await loadProjects();
      const entries = await listDir(target);
      for (const e of entries) {
        const abs = join(target, e.name);
        const p = all[ownerKey(space, abs)];
        const kind = p?.kind || (await projectKind(abs, e.isDir));
        if (kind) e.project = p ? projectView(p, user.username) : { kind, status: 'Not started', lock: null, turn: null, queue: [] };
      }
      const lock = Object.entries(all).find(([k, p]) => p.lock && (ownerKey(space, target) + '/').startsWith(k + '/'))?.[1];
      return json(res, {
        rights: space.rights,
        entries,
        lockedBy: lock && lock.lock.user !== user.username ? { user: lock.lock.user, project: lock.name } : null,
        ...(space.id === 'me' ? { used: await folderSize(root), quota: (space.quotaGB || 0) * 1024 ** 3 } : {}),
      });
    }
    if (q.has('versions')) return json(res, await listDir(join(root, '.sk-versions', rel), true));
    if (q.has('version')) return stream(req, res, q, join(root, '.sk-versions', rel, safeName(q.get('version'))), transfer);
    if (q.has('thumb')) return thumb(res, target);
    if (q.has('preview') && AUDIO_PREVIEW[extname(target).toLowerCase()])
      return stream(req, res, new URLSearchParams(), await audioPreviewFile(target));
    if (q.has('preview')) return thumb(res, target, [800, 1600].includes(Number(q.get('preview'))) ? Number(q.get('preview')) : 2400);
    if (q.has('zip')) return zipFolder(res, target, target === root ? space.name : basename(target), transfer);
    return stream(req, res, q, target, transfer);
  }
  const log = (action, extra = {}) =>
    space.id !== 'me' && logActivity(user, action, { space: space.id, spaceName: space.name, path: rel.split(sep).join('/'), ...extra });
  if (req.method === 'PUT' && q.has('stage')) {
    // Check-in upload: goes to a hidden staging folder beside the project; POST /api/projects?action=checkin swaps it in
    const { abs: proj } = locateIn(space, q.get('project'));
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
    log('renamed', { to: q.get('rename') });
    return json(res, { ok: true });
  }
  if (req.method === 'POST' && q.has('move')) {
    // Drag and drop into another folder of the same space. ?move=<folder, "/"-separated; "" = the space's top>
    need('upload');
    if (target === root) fail(400, "Can't move the space itself");
    const dest = resolve(root, ...q.get('move').split('/').filter(Boolean).map(safeName));
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
    log('moved', { to: relative(root, to).split(sep).join('/') });
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
const ownerKey = (space, file) => `${space.drive}|${relative(space.driveRoot, file).split(sep).join('/').toLowerCase()}`;
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
function logTransfer(req, user, action, space, path, bytes) {
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
const TAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
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
};
const PROJECT_SINGLE = { '.psd': 'Photoshop', '.psb': 'Photoshop', '.ai': 'Illustrator' };
const STATUSES = ['Not started', 'In progress', 'In review', 'Done'];
const TURN_HOURS = 24;
const REMIND_HOURS = 48;
let projects = null;
let projectsSaved = Promise.resolve();
const loadProjects = async () => (projects ??= await readJson('projects.json', {}));
const saveProjects = () => (projectsSaved = projectsSaved.then(() => saveJson('projects.json', projects)).catch(console.error));

/** "Ableton Live", "Photoshop"... or null if this isn't a project. */
async function projectKind(abs, isDir) {
  if (!isDir) return PROJECT_SINGLE[extname(abs).toLowerCase()] || null;
  for (const n of await readdir(abs).catch(() => []))
    if (PROJECT_FILES[extname(n).toLowerCase()]) return PROJECT_FILES[extname(n).toLowerCase()];
  return null;
}

/** The project's record, created on first use. */
async function projectAt(space, abs) {
  const all = await loadProjects();
  const key = ownerKey(space, abs);
  if (!all[key]) {
    const s = (await stat(abs).catch(() => null)) || fail(404, 'Not found');
    const kind =
      (await projectKind(abs, s.isDirectory())) ||
      fail(400, "This isn't a project (no Ableton, FL Studio, Premiere or After Effects file inside, or not a PSD/AI file)");
    all[key] = {
      kind,
      name: basename(abs),
      drive: space.drive,
      dpath: relative(space.driveRoot, abs).split(sep).join('/'),
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
  for (const s of spacesFor({ username, admin }, cfg, status)) {
    if (s.drive !== p.drive) continue;
    const sub = s.sub.split(/[\\/]/).filter(Boolean);
    const parts = p.dpath.split('/');
    if (sub.every((x, i) => x.toLowerCase() === parts[i]?.toLowerCase()) && parts.length > sub.length) {
      const rel = parts.slice(sub.length);
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
          dpath: relative(space.driveRoot, to).split(sep).join('/') + all[k].dpath.slice(relative(space.driveRoot, from).length),
        };
      delete all[k];
    }
  saveProjects();
  const fromD = relative(space.driveRoot, from).split(sep).join('/');
  for (const l of Object.values(await loadLinks()))
    if (
      l.drive === space.drive &&
      (l.dpath.toLowerCase() === fromD.toLowerCase() || l.dpath.toLowerCase().startsWith(fromD.toLowerCase() + '/'))
    ) {
      if (!to)
        l.revoked = true; // deleted: the link stops working
      else {
        const toD = relative(space.driveRoot, to).split(sep).join('/');
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
  const root = resolve(space.root);
  const parts = String(relPath || '')
    .split('/')
    .filter(Boolean);
  if (parts.some((p) => /[:\x00-\x1f]/.test(p) || p === '..')) fail(400, 'Bad path');
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
    const l = all[token] || fail(404, 'No such link');
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
  const key = `${space.drive}|${relative(space.driveRoot, abs).split(sep).join('/').toLowerCase()}`;

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
      drive: space.drive,
      dpath: relative(space.driveRoot, abs).split(sep).join('/'),
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
    const releases = Object.values(db.releases).filter((r) => canSeeRelease(user, r));
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
        cover: null,
        members: null,
        owner: me,
        created: new Date().toISOString(),
      };
      db.releases[r.id] = r;
      changed(r);
      return json(res, r);
    }
    const r = (db.releases[id] && canSeeRelease(user, db.releases[id]) && db.releases[id]) || fail(404, 'No such release');
    if (req.method === 'PATCH') {
      const input = await jsonBody(req);
      if (input.title !== undefined) r.title = String(input.title).trim().slice(0, 80) || r.title;
      if (input.kind !== undefined) r.kind = RELEASE_KINDS.includes(input.kind) ? input.kind : fail(400, 'Bad kind');
      if (input.date !== undefined) r.date = dateOrNull(input.date);
      if (input.cover !== undefined) r.cover = fileRef(input.cover);
      if (input.public !== undefined) r.public = !!input.public; // announced on the public Welcome window (title, kind, date)
      if (input.members !== undefined) {
        if (r.owner !== me && !user.admin) fail(403, 'Only whoever made the release or an admin can change who sees it');
        r.members = Array.isArray(input.members) ? [...new Set(input.members.map(String).filter((u) => /^[\w.-]{1,64}$/.test(u)))] : null;
      }
      changed(r);
      return json(res, r);
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
        (db.releases[input.release] && canSeeRelease(user, db.releases[input.release]) && db.releases[input.release]) ||
        fail(404, 'No such release');
      const n = Object.values(db.tracks).filter((t) => t.release === r.id && !t.deleted).length + 1;
      const t = {
        id: randomUUID().slice(0, 10),
        release: r.id,
        n,
        title:
          String(input.title || '')
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
        followers: [me],
        history: [{ at: new Date().toISOString(), user: me, action: 'added the track' }],
        updated: new Date().toISOString(),
        updatedBy: me,
      };
      db.tracks[t.id] = t;
      changed(r);
      return json(res, t);
    }
    const t = db.tracks[id];
    const r =
      (t && !t.deleted && db.releases[t.release] && canSeeRelease(user, db.releases[t.release]) && db.releases[t.release]) ||
      fail(404, 'No such track');
    if (req.method === 'PATCH') {
      const input = await jsonBody(req);
      const log = (action) => (t.history = [{ at: new Date().toISOString(), user: me, action }, ...t.history].slice(0, 100));
      const news = [];
      for (const [k, max] of Object.entries(TRACK_TEXT)) if (input[k] !== undefined) t[k] = String(input[k] ?? '').slice(0, max);
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
    db.items[i.id] = i;
    changed(i);
    for (const u of i.people) if (u !== me) await notify(u, `${me} put you on "${i.title}" (${i.kind}, ${i.start}).`, { timeline: i.id });
    await timelineAlerts();
    return json(res, view(i));
  }

  const i = (db.items[id] && canSeeRelease(user, db.items[id]) && db.items[id]) || fail(404, 'No such entry');
  if (req.method === 'PATCH') {
    const input = await jsonBody(req);
    const before = { status: i.status, start: i.start, people: [...i.people] };
    if (input.members !== undefined) {
      if (i.owner !== me && !user.admin) fail(403, 'Only whoever made it or an admin can change who sees it');
      i.members = Array.isArray(input.members) ? usernameList(input.members) : null;
    }
    if (input.follow !== undefined) i.followers = i.followers.filter((u) => u !== me).concat(input.follow ? [me] : []);
    apply(i, input);
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
  if (kind === 'orders') {
    // Shop orders live here (not the Admin Panel) because they carry customers' names and addresses
    const shop = await loadShop();
    if (req.method === 'GET') {
      await audit(req, user, 'listed shop orders');
      return json(
        res,
        Object.values(shop.orders)
          .filter((o) => o.status !== 'Pending')
          .sort((a, b) => (b.paid || '').localeCompare(a.paid || '')),
      );
    }
    if (req.method === 'PATCH' && shop.orders[id]) {
      const { status, note } = await jsonBody(req);
      if (status !== undefined)
        shop.orders[id].status = ['Paid', 'Shipped', 'Delivered', 'Refunded'].includes(status) ? status : fail(400, 'Bad status');
      if (note !== undefined) shop.orders[id].note = String(note).slice(0, 500);
      saveShop();
      await audit(req, user, `set order ${id} to ${shop.orders[id].status}`);
      return json(res, shop.orders[id]);
    }
    fail(404, 'No such order');
  }

  const spec = BIZ_KINDS[kind] || fail(404, 'Unknown section');
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
      x.client = input.client && db.clients[input.client] ? input.client : input.client ? fail(400, 'No such client') : null;
    if (kind === 'jobs') {
      if (input.amount !== undefined) x.amount = money(input.amount || 0);
      if (input.due !== undefined) x.due = dateOrNull(input.due);
    }
    if (kind === 'invoices') {
      if (input.job !== undefined) x.job = input.job && db.jobs[input.job] ? input.job : null;
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
  const x = (coll[id] && !coll[id].deleted && coll[id]) || fail(404, 'Not found');
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
      client: q.get('client') && db.clients[q.get('client')] ? q.get('client') : null,
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
  const d = (db.docs[id] && !db.docs[id].deleted && db.docs[id]) || fail(404, 'No such document');
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
    if (input.client !== undefined) d.client = input.client && db.clients[input.client] ? input.client : null;
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
        const taken = new Set(Object.values(db.posts).map((x) => x.slug));
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
    const p = (db.posts[id] && !db.posts[id].deleted && db.posts[id]) || fail(404, 'No such post');
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

async function publicApi(req, res, url) {
  const front = await loadFront();
  const what = url.pathname.split('/')[3];
  if (req.method === 'GET' && !what) {
    const today = localDate();
    const blog = await loadBlog();
    const own = Object.values(blog.posts)
      .filter((p) => p.published && !p.deleted)
      .map((p) => ownPostView(p));
    const fromFeeds = (await Promise.all(blog.feeds.map(readFeed))).flatMap((f) => f.items);
    const posts = [...own, ...fromFeeds].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
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
  if (req.method === 'POST' && what === 'join') {
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const t = joinTries.get(ip);
    const tries = t && Date.now() - t.since < 60 * 60_000 ? t : { n: 0, since: Date.now() };
    if (tries.n >= 5) fail(429, 'Thanks! We already got your note. Try again later if you need to.');
    joinTries.set(ip, { ...tries, n: tries.n + 1 });
    const input = await jsonBody(req);
    if (input.website) return json(res, { ok: true }); // honeypot: people never fill the hidden field, bots do
    const name =
      String(input.name || '')
        .trim()
        .slice(0, 100) || fail(400, 'Tell us your name');
    const email = String(input.email || '')
      .trim()
      .slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'That email address looks wrong');
    const j = {
      id: randomUUID().slice(0, 10),
      name,
      email,
      role: String(input.role || '').slice(0, 60),
      links: String(input.links || '').slice(0, 300),
      message: String(input.message || '').slice(0, 2000),
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
    return json(res, { intro: front.intro, joins: Object.values(front.joins).sort((a, b) => b.at.localeCompare(a.at)) });
  if (req.method === 'PATCH' && what === 'admin') {
    const input = await jsonBody(req);
    if (input.intro !== undefined) front.intro = String(input.intro).slice(0, 3000);
    if (input.join && front.joins[input.join.id] && ['New', 'Contacted', 'Joined', 'Archived'].includes(input.join.status))
      front.joins[input.join.id].status = input.join.status;
    saveFront();
    return json(res, { ok: true });
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
const productView = (p, admin) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  description: p.description,
  price: p.price,
  kind: p.kind,
  image: p.image,
  soldOut: p.stock !== null && p.stock <= 0,
  ...(admin ? { stock: p.stock, active: p.active, file: p.file ? { space: p.file.space, path: p.file.path } : null } : {}),
});

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
    const qty = Math.max(1, Math.min(10, Math.floor(Number((await jsonBody(req)).qty) || 1)));
    if (p.stock !== null && p.stock < qty) fail(409, p.stock ? `Only ${p.stock} left` : 'Sold out');
    const order = {
      id: randomUUID().slice(0, 10),
      product: p.id,
      title: p.title,
      kind: p.kind,
      qty,
      amount: p.price * qty,
      status: 'Pending',
      created: new Date().toISOString(),
    };
    const session = await stripe('/checkout/sessions', {
      mode: 'payment',
      line_items: {
        0: { quantity: qty, price_data: { currency: 'usd', unit_amount: Math.round(p.price * 100), product_data: { name: p.title } } },
      },
      ...(p.kind === 'physical' ? { shipping_address_collection: { allowed_countries: { 0: 'US', 1: 'CA' } } } : {}),
      success_url: `${siteOrigin(req)}/shop/thanks?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin(req)}/shop/${p.slug}`,
      metadata: { order: order.id },
    });
    order.session = session.id;
    db.orders[order.id] = order;
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
      if (input.stock !== undefined)
        p.stock = input.stock === null || input.stock === '' ? null : Math.max(0, Math.floor(Number(input.stock) || 0));
      if (input.active !== undefined) p.active = !!input.active;
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
          p.file = { ...ref, drive: space.drive, dpath: relative(space.driveRoot, abs).split(sep).join('/'), isDir: s.isDirectory() };
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
    const p = (db.products[b] && !db.products[b].deleted && db.products[b]) || fail(404, 'No such product');
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
  const o = db.orders[s.metadata.order];
  if (!o || o.status !== 'Pending' || s.payment_status !== 'paid') return;
  const p = db.products[o.product];
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
  const roots = () =>
    spaces.map((s) => [resolve(s.root).toLowerCase(), s.id]).sort((a, b) => b[0].length - a[0].length || used.has(b[1]) - used.has(a[1]));
  const toSk = (v) => {
    if (typeof v === 'string' && /^[a-z]:[\\/]/i.test(v)) {
      const hit = roots().find(([r]) => v.toLowerCase().startsWith(r));
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

async function transcode(file, format, out) {
  if (transcoding >= 2) await new Promise((r) => transcodeQueue.push(r));
  transcoding++;
  try {
    await mkdir(dirname(out), { recursive: true });
    const tmp = out + '.part';
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-f', format, '-i', file];
    const code = await new Promise((resolve) => {
      const ff = spawn(ffmpegPath, [...args, '-vn', '-c:a', 'libmp3lame', '-b:a', '256k', '-f', 'mp3', '-y', tmp], { windowsHide: true });
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
async function imageInput(file, size) {
  if (extname(file).toLowerCase() !== '.psd') return sharp(file, { animated: false });
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
  const spaces = await Promise.all(spacesFor(user, cfg, await loadStatus()).map(spaceInfo));
  for (const s of spaces)
    s.driveName = cfg.drives[(cfg.spaces.find((x) => x.id === s.id) || cfg.members[user.username])?.drive]?.name || null;
  res.setHeader('set-cookie', sessionCookie(req, user));
  return json(res, { username: user.username, admin: user.admin, spaces });
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
    ok(s.name && c.drives[s.drive], `Space "${s.name || s.id}" needs a name and a known drive`);
    ok(
      !String(s.path || '')
        .split(/[\\/]/)
        .includes('..') && !/[:\x00-\x1f]/.test(s.path || ''),
      `Bad folder path in "${s.name}"`,
    );
    ok(
      RANK[s.everyone || 'none'] !== undefined && Object.values(s.access || {}).every((r) => RANK[r] !== undefined),
      `Bad rights in "${s.name}"`,
    );
  }
  for (const [name, m] of Object.entries(c.members)) ok(!m.drive || c.drives[m.drive], `Unknown drive for ${name}`);
  ok(c.backup && Number.isInteger(c.backup.hour) && c.backup.hour >= 0 && c.backup.hour < 24, 'Backup hour must be 0-23');
  ok(!c.cacheDrive || c.drives[c.cacheDrive], 'Unknown drive for the preview cache');
  return c;
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
    host: os.hostname(),
  };
}

// ── Plumbing ───────────────────────────────────────────────────────────
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new HttpError(413, 'Too large'));
    });
    req.on('end', () => resolve(data));
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
const PROFILE_FIELDS = { displayName: 60, status: 140, role: 60, bio: 1000, soundcloud: 200, instagram: 200, website: 200 };

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
  if (req.method === 'POST') {
    const input = await jsonBody(req);
    const text =
      String(input.text || '')
        .trim()
        .slice(0, 2000) || fail(400, 'Empty comment');
    const t = Number.isFinite(input.t) && input.t >= 0 ? Math.round(input.t * 10) / 10 : null;
    const c = { id: randomUUID().slice(0, 12), user: user.username, at: new Date().toISOString(), t, text };
    thread.comments.push(c);
    await mkdir(join(DATA, 'comments'), { recursive: true });
    await saveJson(file, thread);
    emit('comment', { space: space.id, path, comment: c }, (u) => audience(u));
    if (space.id !== 'me') logActivity(user, 'commented on', { space: space.id, spaceName: space.name, path, text: text.slice(0, 120), t });
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

const routes = [
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
  ['/s/', publicShare],
];

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    if (/https/.test(req.headers['cf-visitor'] || '')) res.setHeader('strict-transport-security', 'max-age=31536000');
    const handler = routes.find(([prefix]) => url.pathname.startsWith(prefix))?.[1] || staticFile;
    Promise.resolve(handler(req, res, url)).catch((err) => {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // viewer closed/seeked a media stream
      const status = err.status || { EEXIST: 409, ENOENT: 404, ENOTEMPTY: 409 }[err.code] || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent)
        send(res, status, status === 500 ? 'Server error' : err.status ? err.message : { 409: 'Already exists', 404: 'Not found' }[status]);
      else res.destroy();
    });
  })
  .listen(PORT, HOST, () => console.log(`${new Date().toISOString()} sanktuary-os on ${HOST}:${PORT}`));
