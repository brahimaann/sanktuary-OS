// Look at the site signed in, without Clerk: real server on temp data + a fake Clerk API, the Vite dev server
// with FAKE_CLERK=1 (tests/fake-clerk.js), and a headless browser holding a signed sk_session cookie.
//   NODE_PATH=$(npm root -g) node tests/signed-in.mjs [admin|member] [path] [screenshot.png]
// KEEP=1 leaves everything running and saves the browser state to signed-in-state.json, for your own
// Playwright scripts: browser.newContext({ storageState: 'signed-in-state.json' }), then http://localhost:3001.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [as = 'admin', path = '/', shot = 'signed-in.png'] = process.argv.slice(2);
const USERS = ['admin', 'member'];
const SECRET = 'sk_test_' + randomBytes(16).toString('hex'); // throwaway: cookies minted here mean nothing elsewhere
const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');

// ── Fake Clerk API (the server only asks it for usernames and member lists) ──
http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const m = req.url.match(/^\/users\/user_(\w+)/);
    if (m) return res.end(JSON.stringify({ id: `user_${m[1]}`, username: m[1] }));
    if (req.url.startsWith('/users'))
      return res.end(JSON.stringify(USERS.map((u) => ({ id: `user_${u}`, username: u, email_addresses: [], password_enabled: true }))));
    res.statusCode = 404;
    res.end('{}');
  })
  .listen(3198);

// ── Server on temp data (admin is an admin) + Vite ──
const dir = mkdtempSync(join(tmpdir(), 'sk-signed-in-'));
mkdirSync(join(dir, 'data'));
writeFileSync(
  join(dir, 'data', 'config.json'),
  JSON.stringify({ admins: ['admin'], drives: {}, spaces: [], members: {}, backup: { drive: null, hour: 3 } }),
);
const env = { ...process.env, PORT: '3080', DATA_DIR: join(dir, 'data'), THUMB_CACHE: join(dir, 'cache'), SITE_ORIGINS: '' };
const kids = [
  spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...env, CLERK_SECRET_KEY: SECRET, CLERK_API_URL: 'http://127.0.0.1:3198' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '3001', '--strictPort'], {
    cwd: root,
    env: { ...env, FAKE_CLERK: '1' },
  }),
];
const ready = (p, text) => new Promise((r) => p.stdout.on('data', (d) => String(d).includes(text) && r()));
await Promise.all([ready(kids[0], 'sanktuary-os on'), ready(kids[1], 'Local:')]);

// ── Browser, signed in as `as` ──
const payload = Buffer.from(JSON.stringify({ sub: `user_${as}`, exp: Date.now() + 8 * 3.6e6 })).toString('base64url');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addCookies([
  {
    name: 'sk_session',
    value: `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`,
    url: 'http://localhost:3001',
  },
  { name: 'sk_fake_user', value: as, url: 'http://localhost:3001' },
]);
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto('http://localhost:3001' + path);
await page.waitForTimeout(4000); // boot loader + first API calls
await page.screenshot({ path: shot });
console.log(`signed in as ${as}: ${shot}`);

if (process.env.KEEP) {
  await context.storageState({ path: 'signed-in-state.json' });
  console.log('Still running on http://localhost:3001 with signed-in-state.json. Ctrl-C to stop.');
} else {
  await browser.close();
  kids.forEach((k) => k.kill());
  process.exit(0);
}
