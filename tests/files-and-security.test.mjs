// Regression + security tests for the file API and boards, against temp data and a fake Clerk.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = process.argv[2] || fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const SECRET = 'sk_test_fake_secret_for_tests';
const USERS = ['alice', 'bob', 'carol'];
const clerk = http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const m = req.url.match(/^\/users\/user_(\w+)/);
    if (m) return res.end(JSON.stringify({ id: `user_${m[1]}`, username: m[1] }));
    if (req.url.startsWith('/users')) return res.end(JSON.stringify(USERS.map((u) => ({ id: `user_${u}`, username: u }))));
    res.statusCode = 404;
    res.end('{}');
  })
  .listen(3197);

const dir = mkdtempSync(join(tmpdir(), 'sk-sec-'));
const drive = join(dir, 'drive');
mkdirSync(join(dir, 'data'));
mkdirSync(join(drive, 'team', 'docs'), { recursive: true });
writeFileSync(join(drive, 'team', 'docs', 'song.txt'), 'v1');
writeFileSync(join(drive, 'team', 'evil.html'), '<script>alert(1)</script>');
writeFileSync(join(drive, 'team', 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
writeFileSync(join(drive, 'team', 'pic.png'), Buffer.from('89504e47', 'hex'));
const letter = drive.slice(0, 2); // e.g. C:
const rel = drive.slice(3).split('\\').join('/');
writeFileSync(
  join(dir, 'data', 'config.json'),
  JSON.stringify({
    admins: ['alice'],
    drives: { d: { name: 'D', enabled: true }, off: { name: 'Off', enabled: false } },
    spaces: [
      { id: 'view', name: 'View', drive: 'd', path: `${rel}/team`, everyone: 'view', access: {} },
      { id: 'up', name: 'Up', drive: 'd', path: `${rel}/team`, everyone: 'none', access: { bob: 'upload' } },
      { id: 'ed', name: 'Ed', drive: 'd', path: `${rel}/team`, everyone: 'none', access: { bob: 'edit' } },
      { id: 'off', name: 'Off', drive: 'off', path: `${rel}/team`, everyone: 'edit', access: {} },
    ],
    members: {},
    backup: { drive: null, hour: 3 },
  }),
);
writeFileSync(
  join(dir, 'data', 'status.json'),
  JSON.stringify({
    drives: [
      { id: 'd', letter, fs: 'NTFS' },
      { id: 'off', letter, fs: 'NTFS' },
    ],
  }),
);

const srv = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: '3196',
    DATA_DIR: join(dir, 'data'),
    CLERK_SECRET_KEY: SECRET,
    CLERK_API_URL: 'http://127.0.0.1:3197',
    SITE_ORIGINS: '',
  },
});
let srvOut = '';
srv.stdout.on('data', (d) => (srvOut += d));
srv.stderr.on('data', (d) => (srvOut += d));
await new Promise((r) => setTimeout(r, 1500));

const B = 'http://127.0.0.1:3196';
const cookie = (u) => {
  const p = Buffer.from(JSON.stringify({ sub: `user_${u}`, exp: Date.now() + 600000 })).toString('base64url');
  return `sk_session=${p}.${createHmac('sha256', SECRET).update(p).digest('base64url')}`;
};
const call = async (u, path, method = 'GET', body, raw = false) => {
  const r = await fetch(B + path, { method, headers: u ? { cookie: cookie(u) } : {}, body: raw ? body : body && JSON.stringify(body) });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
let pass = 0,
  failN = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : failN++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
};
const up = (u, space, path, data, extra = '') =>
  call(
    u,
    `/api/files/${space}/${path}?upload=abcdefgh${Math.random().toString(36).slice(2, 8)}&chunk=0&chunks=1&size=${data.length}${extra}`,
    'PUT',
    data,
    true,
  );

try {
  // Auth + rights
  check('no login -> 401', (await call(null, '/api/files/view/?list')).status === 401);
  check(
    'forged cookie -> 401',
    (
      await fetch(B + '/api/files/view/?list', {
        headers: { cookie: 'sk_session=eyJzdWIiOiJ1c2VyX2FsaWNlIiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.bad' },
      })
    ).status === 401,
  );
  check('view: can read', (await call('carol', '/api/files/view/docs/song.txt')).text === 'v1');
  check('view: cannot upload', (await up('carol', 'view', 'x.txt', 'x')).status === 403);
  check('no access -> space hidden', (await call('carol', '/api/files/up/?list')).status === 404);
  check('upload: can add', (await up('bob', 'up', 'docs/new.txt', 'new')).status === 200);
  check('upload: cannot replace', (await up('bob', 'up', 'docs/song.txt', 'v2', '&replace=1')).status === 403);
  check('upload: cannot delete', (await call('bob', '/api/files/up/docs/new.txt', 'DELETE')).status === 403);
  check(
    'edit: replace keeps version',
    (await up('bob', 'ed', 'docs/song.txt', 'v2', '&replace=1')).status === 200 &&
      readFileSync(join(drive, 'team', 'docs', 'song.txt'), 'utf8') === 'v2' &&
      readdirSync(join(drive, 'team', '.sk-versions', 'docs', 'song.txt')).length === 1,
  );
  check(
    'edit: delete goes to trash',
    (await call('bob', '/api/files/ed/docs/new.txt', 'DELETE')).status === 200 && existsSync(join(drive, 'team', '.sk-trash')),
  );
  check('disabled drive -> offline', (await call('alice', '/api/files/off/?list')).status === 503);

  // Path safety
  check('../ escape blocked', (await call('alice', '/api/files/view/..%2F..%2Fdata%2Fconfig.json')).status === 400);
  check('absolute path blocked', (await call('alice', `/api/files/view/${encodeURIComponent(letter + '\\Windows')}`)).status === 400);
  check('NTFS stream name blocked', (await up('alice', 'ed', 'docs/song.txt%3Ahidden', 'x')).status === 400);
  check('rename to stream name blocked', (await call('alice', '/api/files/ed/docs/song.txt?rename=a%3Ab', 'POST')).status === 400);

  // Serving user files safely
  const html = await call('alice', '/api/files/view/evil.html');
  check(
    'HTML served as sandboxed download',
    /attachment/.test(html.headers.get('content-disposition') || '') && /sandbox/.test(html.headers.get('content-security-policy') || ''),
  );
  const svg = await call('alice', '/api/files/view/evil.svg');
  check(
    'SVG served as sandboxed download',
    /attachment/.test(svg.headers.get('content-disposition') || '') && /sandbox/.test(svg.headers.get('content-security-policy') || ''),
  );
  const png = await call('alice', '/api/files/view/pic.png');
  check('PNG still shows inline', !png.headers.get('content-disposition') && !png.headers.get('content-security-policy'));
  check(
    'nosniff + frame + referrer headers',
    png.headers.get('x-content-type-options') === 'nosniff' &&
      png.headers.get('x-frame-options') === 'SAMEORIGIN' &&
      png.headers.get('referrer-policy') === 'same-origin',
  );

  // Boards: unsafe links rejected, connection spoofing ignored, bad JSON is a 400
  const board = JSON.parse((await call('alice', '/api/boards', 'POST', { name: 'Sec' })).text);
  const ctrl = new AbortController();
  let live = '';
  fetch(`${B}/api/boards/${board.id}/live`, { headers: { cookie: cookie('alice') }, signal: ctrl.signal })
    .then(async (r) => {
      for await (const c of r.body) live += Buffer.from(c).toString();
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const aliceConn = JSON.parse(
    live
      .split('\n')
      .find((l) => l.startsWith('data:'))
      .slice(5),
  ).you.conn;
  await call('alice', `/api/boards/${board.id}/ops`, 'POST', {
    conn: aliceConn,
    ops: [
      { put: { id: 'ok', type: 'link', x: 0, y: 0, w: 1, h: 1, z: 1, url: 'https://example.com' } },
      { put: { id: 'js', type: 'link', x: 0, y: 0, w: 1, h: 1, z: 1, url: 'javascript:alert(1)' } },
      { put: { id: 'ext', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, src: 'https://tracker.example/x.png' } },
    ],
  });
  await new Promise((r) => setTimeout(r, 1300));
  const saved = JSON.parse(readFileSync(join(dir, 'data', 'boards', board.id, 'board.json'), 'utf8')).items.map((i) => i.id);
  check('https link card kept', saved.includes('ok'));
  check('javascript: link card rejected', !saved.includes('js'));
  check('outside image source rejected', !saved.includes('ext'));
  const before = live.length;
  await call('bob', `/api/boards/${board.id}/ops`, 'POST', {
    conn: aliceConn,
    ops: [{ put: { id: 'b1', type: 'note', x: 0, y: 0, w: 1, h: 1, z: 1 } }],
  });
  await new Promise((r) => setTimeout(r, 300));
  check("spoofing alice's connection doesn't hide the edit from her", live.slice(before).includes('"b1"'));
  ctrl.abort();
  check('malformed JSON -> 400', (await call('alice', '/api/boards', 'POST', '{not json', true)).status === 400);
  check(
    'admin config lockout still blocked',
    (await call('alice', '/api/admin/config', 'PUT', { admins: [], drives: {}, spaces: [], members: {}, backup: { hour: 3 } })).status ===
      400,
  );
  check('non-admin blocked from admin API', (await call('bob', '/api/admin/state')).status === 403);
} finally {
  srv.kill();
  clerk.close();
  const errors = srvOut.split('\n').filter((l) => l && !l.includes('sanktuary-os on'));
  console.log(`\n${pass} passed, ${failN} failed${errors.length ? '\nserver log:\n' + errors.join('\n') : ''}`);
  rmSync(dir, { recursive: true, force: true });
}
