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
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { appendFile, cp, mkdir, readdir, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { verifyToken } from '@clerk/backend';
import sharp from 'sharp';
import { initializeCanvas, readPsd } from 'ag-psd';

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
const THUMBS = process.env.THUMB_CACHE || resolve(DIST, '../cache/thumbs');
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

async function currentUser(req, url, cfg) {
  const asUser = async (sub) => {
    const username = await usernameOf(sub);
    return { id: sub, username, admin: cfg.admins.includes(username) };
  };
  for (const token of sessionTokens(req, url)) {
    try {
      const { sub } = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        authorizedParties: SITE_ORIGINS.length ? SITE_ORIGINS : undefined,
      });
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

async function folderSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await folderSize(p) : (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
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

  const transfer = (action, bytes, path = rel) => logTransfer(req, user, action, space, path.split(sep).join('/'), bytes);
  if (req.method === 'GET') {
    need('view');
    if (q.has('list'))
      return json(res, {
        rights: space.rights,
        entries: await listDir(target),
        ...(space.id === 'me' ? { used: await folderSize(root), quota: (space.quotaGB || 0) * 1024 ** 3 } : {}),
      });
    if (q.has('versions')) return json(res, await listDir(join(root, '.sk-versions', rel), true));
    if (q.has('version')) return stream(req, res, q, join(root, '.sk-versions', rel, safeName(q.get('version'))), transfer);
    if (q.has('thumb')) return thumb(res, target);
    if (q.has('preview')) return thumb(res, target, 2400);
    if (q.has('zip')) return zipFolder(res, target, target === root ? space.name : basename(target), transfer);
    return stream(req, res, q, target, transfer);
  }
  const log = (action, extra = {}) =>
    space.id !== 'me' && logActivity(user, action, { space: space.id, spaceName: space.name, path: rel.split(sep).join('/'), ...extra });
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
    await rename(target, to);
    await moveOwners(space, target, to);
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
  const size = await folderSize(dir); // the zip's size is only known at the end; this is close enough for a progress bar
  const tar = spawn(TAR, ['--format', 'zip', '--options', 'zip:compression=store', '--exclude', '.sk-*', '-cf', '-', '-C', dir, ...items]);
  tar.stderr.resume();
  res.on('close', () => tar.kill());
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name + '.zip')}`,
    'x-total-bytes': size,
  });
  transfer('downloaded folder (zip)', size);
  return pipeline(tar.stdout, res);
}

/** Is path p the folder root or somewhere under it? (A drive root like G:\ already ends in a separator.) */
const inside = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const safeName = (name) => (/^[^/\\:\x00-\x1f]+$/.test(name || '') && name !== '..' && name !== '.' ? name : fail(400, 'Bad name'));

async function listDir(dir, includeHidden = false) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return includeHidden ? [] : fail(404, 'Not found');
  const list = [];
  for (const e of entries) {
    if (!includeHidden && HIDDEN.test(e.name)) continue;
    const s = await stat(join(dir, e.name)).catch(() => null);
    if (s) list.push({ name: e.name, isDir: s.isDirectory(), size: s.size, modified: s.mtime.toISOString() });
  }
  return list;
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

async function upload(req, res, q, { status, space, root, target, need, log, user, transfer }) {
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
    // First chunk to arrive (any order): check space, then create the part file
    const fs = status.drives.find((d) => d.id === space.drive)?.fs;
    if (/^FAT/i.test(fs || '') && size > FAT32_MAX) fail(413, `This drive is ${fs}, which can't hold files over 4 GB`);
    if (space.id === 'me' && space.quotaGB && (await folderSize(root)) + size > space.quotaGB * 1024 ** 3)
      fail(413, `Your space is full (${space.quotaGB} GB limit)`);
    uploads.set(id, { got: new Set(), done: false });
    const made = await mkdir(dir, { recursive: true }); // folder uploads create their subfolders
    await writeFile(part, '', { flag: 'a' }); // create without truncating chunks that raced ahead
    if (made) await setOwner(space, made.replace(/^\\\\\?\\/, ''), user); // Windows returns it as \\?\C:\...
  }
  const up = uploads.get(id);
  await pipeline(req, createWriteStream(part, { flags: 'r+', start: chunk * chunkSize, ...BIG_BUFFER }));
  up.got.add(chunk);
  if (up.got.size < chunks || up.done) return json(res, { ok: true });
  up.done = true;
  uploads.delete(id);

  let name = target.split(sep).pop();
  if (q.get('replace')) await keepVersion(root, target);
  else name = freeName(dir, name);
  await rename(part, join(dir, name));
  if (!q.get('replace')) await setOwner(space, join(dir, name), user);
  log(q.get('replace') ? 'replaced' : 'uploaded', { path: relative(root, join(dir, name)).split(sep).join('/') });
  transfer(q.get('replace') ? 'replaced' : 'uploaded', size, relative(root, join(dir, name)));
  return json(res, { ok: true, name });
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
  const cached = join(THUMBS, createHash('sha1').update(`${file}|${s.size}|${s.mtimeMs}|${max}`).digest('hex') + '.webp');
  if (!existsSync(cached)) {
    await mkdir(THUMBS, { recursive: true });
    const img = await imageInput(file, s.size);
    await writeFile(
      cached,
      await img
        .rotate()
        .resize(max, max, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: max > 256 ? 85 : 70 })
        .toBuffer(),
    );
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
    const stored = randomUUID() + extname(name).toLowerCase();
    await mkdir(join(DATA, 'boards', id, 'assets'), { recursive: true });
    await pipeline(req, createWriteStream(join(DATA, 'boards', id, 'assets', stored), BIG_BUFFER));
    return json(res, { src: `/api/boards/${id}/assets/${stored}`, name });
  }
  if (sub === 'assets' && req.method === 'GET') {
    return stream(req, res, url.searchParams, join(DATA, 'boards', id, 'assets', safeName(file)));
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
  const cache = file.endsWith('index.html')
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
const REF_KINDS = new Set(['file', 'folder', 'board', 'plan']);
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
  const [, , , channel, sub] = url.pathname.split('/'); // /api/chat/<channel>/<typing|msgId>
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
      }));
    if (!text.trim() && !refs.length) fail(400, 'Empty message');
    const msg = { id: randomUUID().slice(0, 12), channel, user: user.username, at: new Date().toISOString(), text, refs };
    await mkdir(CHAT(), { recursive: true });
    await appendFile(join(CHAT(), `${channel}.jsonl`), JSON.stringify(msg) + '\n');
    emit('message', msg, audience);
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
