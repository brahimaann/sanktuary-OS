// Regression + security tests for the file API and boards, against temp data and a fake Clerk.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { statSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const SERVER = process.argv[2] || fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const SECRET = 'sk_test_fake_secret_for_tests';
const USERS = ['alice', 'bob', 'carol'];
const clerk = http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const m = req.url.match(/^\/users\/user_(\w+)/);
    if (m) return res.end(JSON.stringify({ id: `user_${m[1]}`, username: m[1], two_factor_enabled: m[1] === 'alice' }));
    if (req.url.startsWith('/users')) return res.end(JSON.stringify(USERS.map((u) => ({ id: `user_${u}`, username: u }))));
    res.statusCode = 404;
    res.end('{}');
  })
  .listen(3197);

const dir = mkdtempSync(join(tmpdir(), 'sk-sec-'));
const drive = join(dir, 'drive');
mkdirSync(join(dir, 'data'));
mkdirSync(join(drive, 'team', 'docs'), { recursive: true });
mkdirSync(join(drive, 'vid2'), { recursive: true });
writeFileSync(join(drive, 'team', 'docs', 'song.txt'), 'v1');
writeFileSync(join(drive, 'team', 'evil.html'), '<script>alert(1)</script>');
writeFileSync(join(drive, 'team', 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
writeFileSync(join(drive, 'team', 'pic.png'), Buffer.from('89504e47', 'hex'));
writeFileSync(join(drive, 'team', 'old.txt'), 'was on the drive before Sanktuary');
writeFileSync(join(drive, 'team', 'loose.txt'), 'also already there');
const letter = drive.slice(0, 2); // e.g. C:
const rel = drive.slice(3).split('\\').join('/');
writeFileSync(
  join(dir, 'data', 'config.json'),
  JSON.stringify({
    admins: ['alice', 'dave'], // dave: an admin without two-step verification
    drives: { d: { name: 'D', enabled: true }, off: { name: 'Off', enabled: false } },
    spaces: [
      { id: 'view', name: 'View', drive: 'd', path: `${rel}/team`, everyone: 'view', access: {} },
      { id: 'up', name: 'Up', drive: 'd', path: `${rel}/team`, everyone: 'none', access: { bob: 'upload' } },
      { id: 'ed', name: 'Ed', drive: 'd', path: `${rel}/team`, everyone: 'none', access: { bob: 'edit' } },
      { id: 'off', name: 'Off', drive: 'off', path: `${rel}/team`, everyone: 'edit', access: {} },
      // A combined space: two folders shown as one, open to the Editors group
      {
        id: 'vids',
        name: 'Videos',
        folders: [
          { drive: 'd', path: `${rel}/team/docs`, label: 'Docs' },
          { drive: 'd', path: `${rel}/vid2` },
          { drive: 'off', path: `${rel}/team`, label: 'Unplugged' },
        ],
        everyone: 'none',
        groups: { editors: 'upload' },
        access: {},
      },
      // Group says edit, carol's own setting says view: her own setting wins
      { id: 'grp', name: 'Grp', drive: 'd', path: `${rel}/team`, everyone: 'none', groups: { editors: 'edit' }, access: { carol: 'view' } },
    ],
    groups: { editors: { name: 'Editors', members: ['carol'] } },
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

writeFileSync(join(dir, 'data', 'blog.json'), JSON.stringify({ feeds: [], posts: {} })); // no Substack fetches during tests

// Clerk-style session tokens (RS256), for the parts that insist on a real sign-in token (business portal)
const jwtKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwt = (u, extra = {}) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'test' })}.${enc({ sub: `user_${u}`, iat: now, nbf: now - 5, exp: now + 600, ...extra })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(jwtKeys.privateKey, 'base64url')}`;
};

// A fake Stripe: records Checkout requests and hands back a session
const stripeCalls = [];
const fakeStripe = http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const form = new URLSearchParams(raw);
      stripeCalls.push({ path: req.url, auth: req.headers.authorization, form });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `cs_test_${stripeCalls.length}`, url: `https://checkout.stripe.test/${stripeCalls.length}` }));
    });
  })
  .listen(3195);
const WEBHOOK_SECRET = 'whsec_test_secret';
const stripeHook = (object, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => {
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object } });
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
};

// A fake RapidRAW engine: echoes what it was sent, answers with real paths like the real one would
const rawCalls = [];
const fakeRaw = http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const command = req.url.split('/').pop();
      rawCalls.push({ command, token: req.headers['x-bridge-token'], args: raw ? JSON.parse(raw) : {} });
      if (req.headers['x-bridge-token'] !== 'raw-token-for-tests-123') return res.writeHead(401).end('bad token');
      if (command === 'apply_adjustments')
        return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([1, 2, 3]));
      const args = raw ? JSON.parse(raw) : {};
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ path: args.path, width: 6000, sidecar: args.path ? args.path + '.rrdata' : null }));
    });
  })
  .listen(3193);

const srv = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: '3196',
    DATA_DIR: join(dir, 'data'),
    THUMB_CACHE: join(dir, 'cache'), // never touch the real preview cache
    CLERK_SECRET_KEY: SECRET,
    CLERK_API_URL: 'http://127.0.0.1:3197',
    CLERK_JWT_KEY: jwtKeys.publicKey.export({ type: 'spki', format: 'pem' }),
    SITE_ORIGINS: '',
    STRIPE_API_URL: 'http://127.0.0.1:3195',
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAPIDRAW_BRIDGE: 'http://127.0.0.1:3193',
    RAPIDRAW_TOKEN: 'raw-token-for-tests-123',
    RAPIDRAW_UI: join(dir, 'no-rapidraw-ui'),
    AUTO_SCAN_MS: '400', // long enough for a test to set a bounce by hand right after uploading it
  },
});
let srvOut = '';
srv.stdout.on('data', (d) => (srvOut += d));
srv.stderr.on('data', (d) => (srvOut += d));
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('sanktuary-os on') && r())); // wait until it's listening

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
  check("upload: cannot delete others' files", (await call('bob', '/api/files/up/docs/song.txt', 'DELETE')).status === 403);
  check("edit: cannot delete others' files either", (await call('bob', '/api/files/ed/docs/song.txt', 'DELETE')).status === 403);
  check("edit: cannot delete a folder holding others' files", (await call('bob', '/api/files/ed/docs', 'DELETE')).status === 403);
  await call('bob', '/api/files/up/mine?mkdir', 'POST');
  await up('bob', 'up', 'mine/a.txt', 'a');
  check('upload: can delete own folder', (await call('bob', '/api/files/up/mine', 'DELETE')).status === 200);
  await up('bob', 'up', 'drop/sub/b.txt', 'b'); // folder upload creates drop/sub for bob
  check('upload: can delete own uploaded folder', (await call('bob', '/api/files/up/drop', 'DELETE')).status === 200);
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
  check('admin: can delete anything', (await call('alice', '/api/files/ed/old.txt', 'DELETE')).status === 200);
  await up('bob', 'up', 'renamed-me.txt', 'r');
  await call('bob', '/api/files/ed/renamed-me.txt?rename=renamed.txt', 'POST');
  check('rename keeps ownership', (await call('bob', '/api/files/up/renamed.txt', 'DELETE')).status === 200);

  // Drag-and-drop moves
  await up('bob', 'up', 'mv.txt', 'm');
  check('upload: can move own file into a folder', (await call('bob', '/api/files/up/mv.txt?move=docs', 'POST')).status === 200);
  check('moved file landed', readFileSync(join(drive, 'team', 'docs', 'mv.txt'), 'utf8') === 'm');
  check('move keeps ownership', (await call('bob', '/api/files/up/docs/mv.txt?move=', 'POST')).status === 200);
  check("upload: cannot move others' files", (await call('bob', '/api/files/up/pic.png?move=docs', 'POST')).status === 403);
  check('edit: can move anything', (await call('bob', '/api/files/ed/loose.txt?move=docs', 'POST')).status === 200);
  check('cannot move a folder into itself', (await call('alice', '/api/files/ed/docs?move=docs', 'POST')).status === 400);
  check('move cannot escape the space', (await call('alice', '/api/files/ed/mv.txt?move=..', 'POST')).status === 400);
  check('move onto an existing name -> 409', (await call('alice', '/api/files/ed/docs/song.txt?move=docs', 'POST')).status === 409);

  // Projects: check-out, lock, queue, staged check-in with missing-sample check, turns
  const als = (refs) => gzipSync(`<Ableton>${refs.map((r) => `<FileRef><Path Value="${r}"/></FileRef>`).join('')}</Ableton>`);
  mkdirSync(join(drive, 'team', 'Song A', 'Samples'), { recursive: true });
  writeFileSync(join(drive, 'team', 'Song A', 'Song A.als'), als(['C:/Users/bob/Music/Samples/kick.wav']));
  writeFileSync(join(drive, 'team', 'Song A', 'Samples', 'kick.wav'), 'kick');
  const P = (u, space, action, extra = '') => call(u, `/api/projects?space=${space}&path=Song%20A&action=${action}${extra}`, 'POST');
  const listing = JSON.parse((await call('bob', '/api/files/up/?list')).text);
  check('listing marks Ableton project folders', listing.entries.find((e) => e.name === 'Song A')?.project?.kind === 'Ableton Live');
  check('view rights cannot check out', (await P('carol', 'view', 'checkout')).status === 403);
  check('upload rights can check out', (await P('bob', 'up', 'checkout')).status === 200);
  check('second check-out refused', (await P('alice', 'ed', 'checkout')).status === 409);
  check('locked project still viewable', (await call('alice', '/api/files/ed/Song%20A/Samples/kick.wav')).text === 'kick');
  check('locked project: admin cannot change it', (await up('alice', 'ed', 'Song%20A/x.txt', 'x')).status === 423);
  check(
    'locked project: cannot move its parent folder away',
    (await call('alice', '/api/files/ed/Song%20A?rename=B', 'POST')).status === 423,
  );
  check('others can queue', (await P('alice', 'ed', 'queue')).status === 200);
  const stageUp = (path, data, stage) => up('bob', 'up', `Song%20A/${path}`, data, `&stage=${stage}&project=Song%20A`);
  await stageUp(
    'Song%20A.als',
    als(['C:/Users/bob/Music/Samples/kick.wav', 'D:/Loops/snare.wav', 'C:/Users/bob/Music/Ableton/User Library/clap.wav']),
    'stage-one1',
  );
  await stageUp('Samples/kick.wav', 'kick v2', 'stage-one1');
  check('check-in needs every file to have arrived', (await P('bob', 'up', 'checkin', '&stage=stage-one1&files=3')).status === 409);
  const warn = JSON.parse((await P('bob', 'up', 'checkin', '&stage=stage-one1&files=2')).text);
  check('check-in warns about samples outside the project (not library ones)', warn.ok === false && warn.missing.join() === 'snare.wav');
  check(
    'only the holder can check in',
    (await call('alice', '/api/projects?space=ed&path=Song%20A&action=checkin&stage=stage-one1&files=2&force=1', 'POST')).status === 423,
  );
  const ci = await P('bob', 'up', 'checkin', '&stage=stage-one1&files=2&force=1&note=new%20kick');
  check(
    'check-in swaps the new version in',
    ci.status === 200 && readFileSync(join(drive, 'team', 'Song A', 'Samples', 'kick.wav'), 'utf8') === 'kick v2',
  );
  check('old version kept', readdirSync(join(drive, 'team', '.sk-versions', 'Song A')).length === 1);
  check('staging folder gone', !readdirSync(join(drive, 'team')).some((f) => f.startsWith('.sk-checkin')));
  const after = JSON.parse(ci.text);
  check('lock released and turn passed to the queue', after.lock === null && after.turn?.user === 'alice');
  check('bob cannot take it during alice’s turn', (await P('bob', 'up', 'checkout')).status === 409);
  const aliceNotes = JSON.parse((await call('alice', '/api/projects?notifications')).text);
  check(
    'next in line is told it is their turn',
    aliceNotes.some((n) => n.turn && n.where?.space),
  );
  check(
    "Profile 'mine' lists it",
    JSON.parse((await call('alice', '/api/projects?mine')).text).some((p) => p.name === 'Song A' && p.turn?.user === 'alice'),
  );
  check('alice claims her turn', (await P('alice', 'ed', 'checkout')).status === 200);
  check('only owner/admin can force-release', (await P('bob', 'up', 'release')).status === 403);
  check('holder releases', (await P('alice', 'ed', 'release')).status === 200);
  check('follow works for view rights', (await P('carol', 'view', 'follow')).status === 200);
  await call('alice', '/api/files/ed/Song%20A?rename=Song%20B', 'POST');
  check(
    'project record follows a rename',
    JSON.parse((await call('carol', '/api/projects?space=view&path=Song%20B')).text).following === true,
  );

  // Share links for people without an account
  const mk = async (u, space, path, opts) => {
    const r = await call(u, '/api/links', 'POST', { space, path, days: 7, download: true, ...opts });
    return { status: r.status, link: r.status === 200 ? JSON.parse(r.text) : null };
  };
  const anon = (path, init) => fetch(B + path, init);
  check('view rights cannot make public links', (await mk('carol', 'view', 'docs')).status === 403);
  const { link: open } = await mk('bob', 'up', 'docs');
  check('link token is long and random', /^\/s\/[\w-]{32}$/.test(open.url));
  check('public page loads without an account', (await anon(open.url)).status === 200);
  check('public page is not indexed', (await anon(open.url)).headers.get('x-robots-tag')?.includes('noindex'));
  const openInfo = await (await anon(`${open.url}/info`)).json();
  check('link shows what was shared', openInfo.name === 'docs' && openInfo.isDir && !openInfo.locked);
  check(
    'link lists its folder',
    (await (await anon(`${open.url}/list`)).json()).some((e) => e.name === 'song.txt'),
  );
  check('link streams a file', (await (await anon(`${open.url}/file?path=song.txt`)).text()) === 'v2');
  check('link cannot escape its folder', (await anon(`${open.url}/file?path=..%2Fpic.png`)).status === 400);
  check('link hides Sanktuary folders', (await anon(`${open.url}/list?path=.sk-versions`)).status === 400);
  await anon(`${open.url}/file?path=song.txt&download`);
  const counted = JSON.parse((await call('bob', '/api/links?space=up&path=docs')).text)[0];
  check('views and downloads counted', counted.views >= 1 && counted.downloads === 1);
  check('others cannot see link stats', JSON.parse((await call('carol', '/api/links?space=view&path=docs')).text).length === 0);
  check('carol cannot turn off bob’s link', (await call('carol', `/api/links/${open.token}`, 'DELETE')).status === 403);
  check('creator turns it off', (await call('bob', `/api/links/${open.token}`, 'DELETE')).status === 200);
  check('turned-off link is gone', (await anon(`${open.url}/info`)).status === 410);

  const { link: viewOnly } = await mk('bob', 'up', 'docs', { download: false });
  check('download off: can still stream', (await anon(`${viewOnly.url}/file?path=song.txt`)).status === 200);
  check('download off: no download', (await anon(`${viewOnly.url}/file?path=song.txt&download`)).status === 403);
  check('download off: no zip', (await anon(`${viewOnly.url}/zip`)).status === 403);

  const { link: locked } = await mk('bob', 'up', 'docs/song.txt', { password: 'hunter22' });
  const lockedInfo = await (await anon(`${locked.url}/info`)).json();
  check('password link hides its contents', lockedInfo.locked && lockedInfo.name === 'Protected link');
  check('password link blocks files', (await anon(`${locked.url}/file`)).status === 401);
  check('wrong password refused', (await anon(`${locked.url}/unlock`, { method: 'POST', body: '{"password":"nope"}' })).status === 403);
  const ok = await anon(`${locked.url}/unlock`, { method: 'POST', body: '{"password":"hunter22"}' });
  const linkCookie = ok.headers.get('set-cookie').split(';')[0];
  check(
    'right password unlocks',
    ok.status === 200 && (await (await anon(`${locked.url}/file`, { headers: { cookie: linkCookie } })).text()) === 'v2',
  );
  for (let i = 0; i < 10; i++) await anon(`${locked.url}/unlock`, { method: 'POST', body: '{"password":"guess"}' });
  check(
    'password guessing is rate-limited',
    (await anon(`${locked.url}/unlock`, { method: 'POST', body: '{"password":"hunter22"}' })).status === 429,
  );
  check('made-up token -> 404', (await anon('/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/info')).status === 404);

  // Push notifications
  const key = JSON.parse((await call('bob', '/api/push/key')).text).key;
  check('push key is a P-256 public key', typeof key === 'string' && Buffer.from(key, 'base64url').length === 65);
  check('push key is kept, not remade', JSON.parse((await call('carol', '/api/push/key')).text).key === key);
  check('push needs a login', (await call(null, '/api/push/key')).status === 401);
  check(
    'bad subscription refused',
    (await call('bob', '/api/push/subscribe', 'POST', { subscription: { endpoint: 'http://evil' } })).status === 400,
  );
  check('test before subscribing -> 400', (await call('bob', '/api/push/test', 'POST')).status === 400);
  const sub = { endpoint: 'https://127.0.0.1:9/push/bob', keys: { p256dh: 'BPk', auth: 'x' } };
  check('subscribe works', JSON.parse((await call('bob', '/api/push/subscribe', 'POST', { subscription: sub })).text).devices === 1);
  check(
    'same device twice stays one',
    JSON.parse((await call('bob', '/api/push/subscribe', 'POST', { subscription: sub })).text).devices === 1,
  );
  await new Promise((r) => setTimeout(r, 300));
  const devices = JSON.parse(readFileSync(join(dir, 'data', 'push.json'), 'utf8'));
  check('devices stored per member', devices.bob?.length === 1 && !devices.carol?.length);
  check('unsubscribe works', (await call('bob', '/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint })).status === 200);

  // Combined spaces and groups
  const top = JSON.parse((await call('carol', '/api/files/vids/?list')).text);
  check(
    'a combined space lists its folders at the top',
    top.combined && top.entries.map((e) => e.name).join(',') === 'Docs,vid2,Unplugged' && top.entries[2].offline === true,
    JSON.stringify(top),
  );
  check("group members get the group's rights", top.rights === 'upload');
  check('others do not see the space', (await call('bob', '/api/files/vids/?list')).status === 404);
  check('files open through their folder', (await call('carol', '/api/files/vids/Docs/song.txt')).status === 200);
  check(
    'uploads land in the right folder on disk',
    (await up('carol', 'vids', 'vid2/clip.txt', 'clip')).status === 200 && readFileSync(join(drive, 'vid2', 'clip.txt'), 'utf8') === 'clip',
  );
  check('nothing can be added at the top of a combined space', (await up('carol', 'vids', 'loose.txt', 'x')).status === 400);
  check('an unknown folder is not found', (await call('carol', '/api/files/vids/Nope/?list')).status === 404);
  check('a folder on an unplugged drive says so', (await call('carol', '/api/files/vids/Unplugged/?list')).status === 503);
  check(
    'paths cannot climb out of a folder',
    (await call('carol', '/api/files/vids/vid2/..%2F..%2Fteam%2Fevil.html')).status === 400 &&
      [400, 404].includes((await call('carol', '/api/files/vids/vid2/%2E%2E/team/old.txt')).status),
  );
  check('moves between the folders are refused', (await call('carol', '/api/files/vids/vid2/clip.txt?move=Docs', 'POST')).status === 400);
  await call('carol', '/api/files/vids/vid2/sub?mkdir', 'POST');
  check(
    'moves within one folder work',
    (await call('carol', '/api/files/vids/vid2/clip.txt?move=vid2/sub', 'POST')).status === 200 &&
      existsSync(join(drive, 'vid2', 'sub', 'clip.txt')),
  );
  check(
    'activity shows the path as members see it',
    JSON.parse((await call('carol', '/api/activity')).text).some((a) => a.space === 'vids' && a.path === 'vid2/clip.txt'),
  );
  check(
    'members can bin what they added in a combined space',
    (await call('carol', '/api/files/vids/vid2/sub/clip.txt', 'DELETE')).status === 200,
  );
  check('but not what others added', (await call('carol', '/api/files/vids/Docs/song.txt', 'DELETE')).status === 403);
  check("a person's own setting beats their group", (await up('carol', 'grp', 'g.txt', 'x')).status === 403);

  // Tracks: releases, track pages, private releases, notifications, deadlines
  const album = JSON.parse(
    (await call('alice', '/api/tracks/release', 'POST', { title: 'TSIMY', kind: 'Album', date: '2027-06-01' })).text,
  );
  const song = JSON.parse((await call('alice', '/api/tracks/track', 'POST', { release: album.id, title: 'Summer I Missed You' })).text);
  check('track created and numbered', song.n === 1 && song.status === 'Idea');
  const seen = JSON.parse((await call('bob', '/api/tracks')).text);
  check(
    'releases are open to members by default',
    seen.releases.some((r) => r.id === album.id) && seen.tracks.some((t) => t.id === song.id),
  );
  check('bad date refused', (await call('bob', `/api/tracks/track/${song.id}`, 'PATCH', { deadline: 'next week' })).status === 400);
  check(
    'only https links',
    (await call('bob', `/api/tracks/track/${song.id}`, 'PATCH', { links: { bandlab: 'javascript:alert(1)' } })).status === 400,
  );
  const edited = JSON.parse(
    (
      await call('bob', `/api/tracks/track/${song.id}`, 'PATCH', {
        status: 'Mixing',
        bpm: '102',
        bounce: { space: 'up', path: 'Song B/Samples/kick.wav' },
        links: { bandlab: 'https://www.bandlab.com/post/abc' },
      })
    ).text,
  );
  check(
    'members can edit a track',
    edited.status === 'Mixing' && edited.bpm === '102' && edited.links.bandlab && edited.bounce.path.endsWith('kick.wav'),
  );
  check(
    'file links cannot climb out',
    (await call('bob', `/api/tracks/track/${song.id}`, 'PATCH', { stems: { space: 'up', path: '../x' } })).status === 400,
  );
  const aliceTrackNotes = JSON.parse((await call('alice', '/api/projects?notifications')).text);
  check(
    'followers hear about status and new bounce',
    aliceTrackNotes.some((n) => /now "Mixing"/.test(n.text)) && aliceTrackNotes.some((n) => /New bounce/.test(n.text)),
  );
  const soon = new Date(Date.now() + 2 * 864e5).toLocaleDateString('en-CA');
  await call('alice', `/api/tracks/track/${song.id}`, 'PATCH', { deadline: soon });
  check(
    'deadline 2 days out warns followers',
    JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) => /is due in 2 days/.test(n.text)),
  );
  check('bob cannot hide alice’s release', (await call('bob', `/api/tracks/release/${album.id}`, 'PATCH', { members: [] })).status === 403);
  await call('alice', `/api/tracks/release/${album.id}`, 'PATCH', { members: ['bob'] });
  check(
    'private release hidden from others',
    !JSON.parse((await call('carol', '/api/tracks')).text).releases.some((r) => r.id === album.id),
  );
  check(
    'private release: carol cannot open its track',
    (await call('carol', `/api/tracks/track/${song.id}`, 'PATCH', { bpm: '1' })).status === 404,
  );
  check(
    'listed member still sees it',
    JSON.parse((await call('bob', '/api/tracks')).text).tracks.some((t) => t.id === song.id),
  );
  check('bob cannot delete alice’s release', (await call('bob', `/api/tracks/release/${album.id}`, 'DELETE')).status === 403);

  // Release folders: files fill Tracks in
  const albumDir = join(drive, 'team', 'Albums', 'Folder Album');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Scans run in the background after an upload: poll (up to 6 s) instead of guessing how long they take
  const until = async (fn, ms = 6000) => {
    for (const end = Date.now() + ms; ; await wait(100)) {
      const v = await fn();
      if (v || Date.now() > end) return v;
    }
  };
  const tracksWhen = (ok) =>
    until(async () => {
      const x = await tracksOf('bob', folderAlbum.id);
      return ok(x) ? x : null;
    });
  const tracksOf = async (u, rid) => JSON.parse((await call(u, '/api/tracks')).text).tracks.filter((t) => t.release === rid);
  const newRel = (u, body) => call(u, '/api/tracks/release', 'POST', body);
  check(
    'view rights cannot make a release folder',
    (await newRel('carol', { title: 'X', folder: { space: 'view', path: 'Albums/X' }, setup: true })).status === 403,
  );
  check(
    'a space you cannot see is refused',
    (await newRel('carol', { title: 'X', folder: { space: 'up', path: 'Albums/X' } })).status === 404,
  );
  check(
    'My Space cannot hold a release',
    (await newRel('bob', { title: 'X', folder: { space: 'me', path: 'X' }, setup: true })).status === 400,
  );
  check(
    'release folder cannot climb out',
    (await newRel('bob', { title: 'X', folder: { space: 'up', path: '../X' }, setup: true })).status === 400,
  );
  check(
    'release folder names are checked',
    (await newRel('bob', { title: 'X', folder: { space: 'up', path: 'Albums/X?' }, setup: true })).status === 400 &&
      (await newRel('bob', { title: 'X', folder: { space: 'up', path: 'Albums/X.' }, setup: true })).status === 400,
  );
  check('linking a missing folder is refused', (await newRel('bob', { title: 'X', folder: { space: 'up', path: 'nope' } })).status === 404);
  const folderAlbum = JSON.parse(
    (await newRel('bob', { title: 'Folder Album', folder: { space: 'up', path: 'Albums/Folder Album' }, setup: true })).text,
  );
  check(
    'new release sets up its folders',
    ['Bounces', 'Stems', 'Projects', 'Artwork'].every((n) => existsSync(join(albumDir, n))) &&
      folderAlbum.folder?.path === 'Albums/Folder Album' &&
      !('folderKey' in folderAlbum),
  );
  check(
    'folder key never reaches the browser',
    !JSON.parse((await call('bob', '/api/tracks')).text).releases.some((r) => 'folderKey' in r),
  );
  await up('bob', 'up', 'Albums/Folder Album/Bounces/03 Summer Nights v1.wav', 'RIFF1');
  let fts = (await tracksWhen((x) => x.length)) || [];
  check(
    'an uploaded bounce becomes a track',
    fts.length === 1 && fts[0].title === 'Summer Nights' && fts[0].n === 3 && fts[0].bounce?.path.endsWith('v1.wav'),
    JSON.stringify(fts.map((t) => [t.title, t.n, t.bounce?.path])),
  );
  await call('alice', `/api/tracks/track/${fts[0].id}`, 'PATCH', { follow: true });
  await up('bob', 'up', 'Albums/Folder Album/Bounces/Summer_Nights_v2_master.wav', 'RIFF2');
  await up('bob', 'up', 'Albums/Folder Album/Bounces/Summer Nights (Instrumental) v9.wav', 'RIFF9');
  await up('bob', 'up', 'Albums/Folder Album/Bounces/HIMA - Late Drive.mp3', 'ID3');
  fts =
    (await tracksWhen(
      (x) =>
        x.some((t) => t.title === 'HIMA Late Drive') && x.find((t) => t.title === 'Summer Nights')?.bounce?.path.endsWith('v2_master.wav'),
    )) || (await tracksOf('bob', folderAlbum.id));
  const nights = fts.find((t) => t.title === 'Summer Nights');
  check('a newer version becomes the current bounce', nights?.bounce?.path.endsWith('Summer_Nights_v2_master.wav'), nights?.bounce?.path);
  check('an instrumental does not take over', !/Instrumental/.test(nights?.bounce?.path || ''));
  check('each song is one track', fts.length === 2 && fts.some((t) => t.title === 'HIMA Late Drive'), fts.map((t) => t.title).join(','));
  check(
    'followers hear about the new bounce',
    JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) =>
      /New bounce of Summer Nights: Summer_Nights_v2/.test(n.text),
    ),
  );
  // Project, BPM, stems and cover, found by a manual scan
  mkdirSync(join(albumDir, 'Projects', 'Summer Nights Project'), { recursive: true });
  writeFileSync(
    join(albumDir, 'Projects', 'Summer Nights Project', 'Summer Nights.als'),
    gzipSync(
      '<Ableton><LiveSet><MasterTrack><DeviceChain><Mixer><Tempo><LomId Value="0" /><Manual Value="98.5" /></Tempo></Mixer></DeviceChain></MasterTrack></LiveSet></Ableton>',
    ),
  );
  mkdirSync(join(albumDir, 'Stems', 'Summer Nights'), { recursive: true });
  writeFileSync(join(albumDir, 'Stems', 'Summer Nights', 'kick.wav'), 'RIFF');
  writeFileSync(join(albumDir, 'Artwork', 'cover final.png'), Buffer.from('89504e47', 'hex'));
  check(
    'carol cannot scan a folder in a space she cannot see',
    (await call('carol', `/api/tracks/release/${folderAlbum.id}?scan`, 'POST')).status === 404,
  );
  const scan = JSON.parse((await call('bob', `/api/tracks/release/${folderAlbum.id}?scan`, 'POST')).text);
  fts = await tracksOf('bob', folderAlbum.id);
  const nights2 = fts.find((t) => t.title === 'Summer Nights');
  check(
    'scan links project, BPM and stems',
    nights2?.project?.path === 'Albums/Folder Album/Projects/Summer Nights Project' &&
      nights2.bpm === '98.5' &&
      nights2.stems?.path === 'Albums/Folder Album/Stems/Summer Nights' &&
      scan.projects === 1 &&
      scan.stems === 1,
    JSON.stringify(scan),
  );
  check('stems are not mistaken for songs', fts.length === 2);
  check(
    'artwork becomes the cover',
    JSON.parse((await call('bob', '/api/tracks')).text)
      .releases.find((r) => r.id === folderAlbum.id)
      ?.cover?.path.endsWith('cover final.png'),
  );
  // Something picked by hand stays
  const drive2 = fts.find((t) => t.title === 'HIMA Late Drive');
  await call('bob', `/api/tracks/track/${drive2.id}`, 'PATCH', { bounce: { space: 'up', path: 'docs/new.txt' } });
  await up('bob', 'up', 'Albums/Folder Album/Bounces/HIMA - Late Drive v2.mp3', 'ID3');
  await up('bob', 'up', 'docs/Elsewhere Song.wav', 'RIFF'); // outside the folder: not a track
  await wait(1500); // nothing should happen: give a scan time to (wrongly) run
  fts = await tracksOf('bob', folderAlbum.id);
  check('a bounce picked by hand is not replaced', fts.find((t) => t.id === drive2.id)?.bounce?.path === 'docs/new.txt');
  check('files outside the folder are ignored', !fts.some((t) => /Elsewhere/.test(t.title)));
  check(
    'a moved-in file is picked up',
    (await call('bob', '/api/files/up/docs/Elsewhere Song.wav?move=Albums/Folder Album/Bounces', 'POST')).status === 200 &&
      !!(await tracksWhen((x) => x.some((t) => t.title === 'Elsewhere Song'))),
  );
  const hand = JSON.parse((await call('bob', '/api/tracks/track', 'POST', { release: folderAlbum.id, title: 'Golden Hour' })).text);
  await up('bob', 'up', 'Albums/Folder Album/Bounces/gh_rough.wav', 'RIFF');
  await call('bob', `/api/tracks/track/${hand.id}`, 'PATCH', { bounce: { space: 'up', path: 'Albums/Folder Album/Bounces/gh_rough.wav' } });
  await up('bob', 'up', 'Albums/Folder Album/Bounces/gh v2.wav', 'RIFF');
  fts =
    (await tracksWhen((x) => x.find((t) => t.id === hand.id)?.bounce?.path.endsWith('gh v2.wav'))) ||
    (await tracksOf('bob', folderAlbum.id));
  check(
    'a bounce with an odd name stays with its track and gets its new versions',
    !fts.some((t) => t.title === 'gh') && fts.find((t) => t.id === hand.id)?.bounce?.path.endsWith('gh v2.wav'),
    fts.map((t) => `${t.title}=${t.bounce?.path}`).join(', '),
  );
  check(
    'mkdir with parents makes the whole path',
    (await call('bob', '/api/files/up/Timeline/2027-01-01 Shoot?mkdir&parents', 'POST')).status === 200 &&
      existsSync(join(drive, 'team', 'Timeline', '2027-01-01 Shoot')),
  );
  check(
    'mkdir with parents is fine when it exists',
    (await call('bob', '/api/files/up/Timeline/2027-01-01 Shoot?mkdir&parents', 'POST')).status === 200,
  );
  check('bob owns the folders he made', (await call('bob', '/api/files/up/Timeline', 'DELETE')).status === 200);
  check('view rights cannot mkdir', (await call('carol', '/api/files/view/Nope/Deep?mkdir&parents', 'POST')).status === 403);
  const missedShare = await fetch(B + '/share-target', { method: 'POST', body: 'x'.repeat(1000), redirect: 'manual' });
  check(
    'a share the service worker missed says so',
    missedShare.status === 303 && missedShare.headers.get('location') === '/?share=missed',
  );
  check(
    "only the release's owner or an admin changes its folder",
    (await call('carol', `/api/tracks/release/${folderAlbum.id}`, 'PATCH', { folder: null })).status === 403,
  );

  // Timeline: visual projects and events, with Tracks dates merged in
  const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA');
  check('entry needs a date', (await call('bob', '/api/timeline', 'POST', { title: 'Shoot' })).status === 400);
  check(
    'end cannot be before start',
    (await call('bob', '/api/timeline', 'POST', { title: 'X', start: day(5), end: day(2) })).status === 400,
  );
  const shoot = JSON.parse(
    (
      await call('bob', '/api/timeline', 'POST', {
        title: 'Cover shoot',
        kind: 'Shoot',
        start: day(1),
        people: ['bob', 'carol'],
        location: 'Studio A',
      })
    ).text,
  );
  check('entry created', shoot.kind === 'Shoot' && shoot.people.includes('carol'));
  const carolNotes = JSON.parse((await call('carol', '/api/projects?notifications')).text);
  check(
    'people put on it are told',
    carolNotes.some((n) => /put you on "Cover shoot"/.test(n.text)),
  );
  check(
    'day-before reminder goes out',
    carolNotes.some((n) => /"Cover shoot" is tomorrow/.test(n.text) && /Studio A/.test(n.text)),
  );
  const aliceView = JSON.parse((await call('alice', '/api/timeline')).text);
  check(
    'everyone sees open entries',
    aliceView.items.some((i) => i.id === shoot.id),
  );
  check(
    'Tracks dates are on the timeline',
    aliceView.items.some((i) => i.source === 'tracks' && /TSIMY.*out/.test(i.title)) && aliceView.items.some((i) => i.kind === 'Track due'),
  );
  check(
    'private release dates stay private',
    !JSON.parse((await call('carol', '/api/timeline')).text).items.some((i) => /TSIMY/.test(i.title)),
  );
  await call('carol', `/api/timeline/${shoot.id}`, 'PATCH', { status: 'In progress' });
  check(
    'status change reaches the others',
    JSON.parse((await call('bob', '/api/projects?notifications')).text).some((n) => /"Cover shoot" is now In progress/.test(n.text)),
  );
  check('carol cannot hide bob’s entry', (await call('carol', `/api/timeline/${shoot.id}`, 'PATCH', { members: [] })).status === 403);
  await call('bob', `/api/timeline/${shoot.id}`, 'PATCH', { members: [] }); // just bob (and admins)
  check('private entry hidden from others', !JSON.parse((await call('carol', '/api/timeline')).text).items.some((i) => i.id === shoot.id));
  check(
    'admins still see private entries',
    JSON.parse((await call('alice', '/api/timeline')).text).items.some((i) => i.id === shoot.id),
  );
  check('only https links', (await call('bob', `/api/timeline/${shoot.id}`, 'PATCH', { link: 'ftp://x' })).status === 400);
  check('carol cannot delete it', [403, 404].includes((await call('carol', `/api/timeline/${shoot.id}`, 'DELETE')).status)); // 404 once it's private
  check('owner deletes it', (await call('bob', `/api/timeline/${shoot.id}`, 'DELETE')).status === 200);

  // Business portal: admins only, real token only, two-step required, everything audited, vault stays off the tunnel
  const biz = async (u, path, method = 'GET', body, headers = {}, raw = false) => {
    const r = await fetch(B + '/api/business' + path, {
      method,
      headers: { ...(u ? { authorization: `Bearer ${typeof u === 'string' ? jwt(u) : u.token}` } : {}), ...headers },
      body: raw ? body : body && JSON.stringify(body),
    });
    return { status: r.status, text: await r.text() };
  };
  const bj = async (...a) => {
    const r = await biz(...a);
    return { status: r.status, body: r.status === 200 ? JSON.parse(r.text) : r.text };
  };
  check('portal: the site cookie alone is refused', (await call('alice', '/api/business/overview')).status === 401);
  check('portal: a forged token is refused', (await biz({ token: jwt('alice').slice(0, -4) + 'AAAA' }, '/overview')).status === 401);
  check('portal: non-admins are refused', (await biz('bob', '/overview')).status === 403);
  const noTwoStep = await biz('dave', '/overview');
  check('portal: admin without two-step is told to turn it on', noTwoStep.status === 428 && /two-step/.test(noTwoStep.text));
  check(
    'portal: a session that skipped the second step is refused',
    (await biz({ token: jwt('alice', { fva: [2, -1] }) }, '/overview')).status === 428,
  );
  check('portal: alice (admin + two-step) gets in', (await biz('alice', '/overview')).status === 200);
  const client = (await bj('alice', '/clients', 'POST', { name: 'Twin Cities Barber Co', email: 'hi@example.com' })).body;
  check('client added', client.status === 'Lead' && client.name === 'Twin Cities Barber Co');
  const job = (await bj('alice', '/jobs', 'POST', { title: 'Logo + website', client: client.id, amount: '1500' })).body;
  check('job added with amount', job.amount === 1500 && job.client === client.id);
  check('job needs a real client', (await biz('alice', '/jobs', 'POST', { title: 'x', client: 'nope' })).status === 400);
  const inv1 = (
    await bj('alice', '/invoices', 'POST', {
      client: client.id,
      items: [
        { desc: 'Logo', qty: 1, rate: 600 },
        { desc: 'Site', qty: 1, rate: 900 },
      ],
    })
  ).body;
  const inv2 = (await bj('alice', '/invoices', 'POST', { client: client.id })).body;
  const year = new Date().toLocaleDateString('en-CA').slice(0, 4);
  check('invoices are numbered per year', inv1.number === `INV-${year}-001` && inv2.number === `INV-${year}-002`);
  check(
    'bad amounts refused',
    (await biz('alice', `/invoices/${inv2.id}`, 'PATCH', { items: [{ desc: 'x', qty: 'lots', rate: 1 }] })).status === 400,
  );
  await biz('alice', `/invoices/${inv1.id}`, 'PATCH', { status: 'Sent', due: '2000-01-01' });
  const over = (await bj('alice', '/overview')).body;
  check('overview: owed and overdue', over.owed === 1500 && over.overdue.some((o) => o.number === inv1.number));
  await biz('alice', `/invoices/${inv1.id}`, 'PATCH', { status: 'Paid' });
  const paid = (await bj('alice', `/invoices/${inv1.id}`)).body;
  check('paying stamps the date', paid.paidOn === new Date().toLocaleDateString('en-CA'));
  check('overview: paid this year', (await bj('alice', '/overview')).body.paidThisYear === 1500);
  const doc = (await bj('alice', `/docs?name=contract.pdf&client=${client.id}&vault=1`, 'PUT', '%PDF-1.4 contract', {}, true)).body;
  check('document stored', doc.size === 17 && doc.vault === true);
  check('vault opens off the tunnel (Tailscale / on the PC)', (await biz('alice', `/docs/${doc.id}/file`)).text === '%PDF-1.4 contract');
  check(
    'vault refused through the public tunnel',
    (await biz('alice', `/docs/${doc.id}/file`, 'GET', undefined, { 'cf-ray': 'abc-MSP' })).status === 403,
  );
  await biz('alice', `/docs/${doc.id}`, 'PATCH', { vault: false });
  check(
    'normal documents open through the tunnel',
    (await biz('alice', `/docs/${doc.id}/file`, 'GET', undefined, { 'cf-ray': 'abc-MSP' })).status === 200,
  );
  check(
    'removing keeps the record hidden, not destroyed',
    (await biz('alice', `/clients/${client.id}`, 'DELETE')).status === 200 &&
      existsSync(join(dir, 'data', 'business', 'files', `${doc.id}.pdf`)),
  );
  const auditLog = JSON.parse((await biz('alice', '/audit')).text);
  check(
    'every access is audited',
    [
      'opened the portal',
      'added client',
      'uploaded to the vault',
      'opened document',
      'was refused a vault document over the internet',
    ].every((a) => auditLog.some((e) => e.action === a && e.user === 'alice')),
  );
  check('audit records the route', auditLog.some((e) => e.via === 'internet') && auditLog.some((e) => e.via === 'tailscale/local'));

  // "Add the missing files": samples from outside the project are added at check-in and the set is relinked
  const liveRef = (path, rel, type) =>
    `<FileRef><RelativePathType Value="${type}" /><RelativePath Value="${rel}" /><Path Value="${path}" /><Type Value="1" /></FileRef>`;
  mkdirSync(join(drive, 'team', 'Song C'), { recursive: true });
  const songC = `<Ableton>${liveRef('D:/Loops/snare &amp; clap.wav', '../../Loops/snare &amp; clap.wav', 1)}${liveRef('C:/Users/me/Music/Ableton/User Library/kit.adg', 'kit.adg', 5)}</Ableton>`;
  writeFileSync(join(drive, 'team', 'Song C', 'Song C.als'), gzipSync(songC));
  const PC = (action, extra = '') => call('bob', `/api/projects?space=up&path=Song%20C&action=${action}${extra}`, 'POST');
  await PC('checkout');
  const stageC = (path, data) => up('bob', 'up', `Song%20C/${path}`, data, '&stage=stage-relink1&project=Song%20C');
  await stageC('Song%20C.als', gzipSync(songC));
  const warnC = JSON.parse((await PC('checkin', '&stage=stage-relink1&files=1')).text);
  check('check-in lists the outside sample', warnC.ok === false && warnC.missing.includes('snare & clap.wav'));
  await stageC('Samples/Imported/snare%20%26%20clap.wav', 'SNARE');
  const relinked = await PC('checkin', '&stage=stage-relink1&files=2&relink=1');
  check('with the file added, check-in goes through', relinked.status === 200 && JSON.parse(relinked.text).ok === true);
  const liveXml = gunzipSync(readFileSync(join(drive, 'team', 'Song C', 'Song C.als'))).toString();
  check(
    'the set now points inside the project',
    liveXml.includes('<RelativePathType Value="3" /><RelativePath Value="Samples/Imported/snare &amp; clap.wav" />'),
  );
  check('library references are left alone', liveXml.includes('<RelativePathType Value="5" /><RelativePath Value="kit.adg" />'));
  check(
    'the untouched set is kept in Backup',
    readdirSync(join(drive, 'team', 'Song C', 'Backup')).some((n) => n.includes('before Sanktuary relink')),
  );
  check(
    'the added sample is in Samples/Imported',
    readFileSync(join(drive, 'team', 'Song C', 'Samples', 'Imported', 'snare & clap.wav'), 'utf8') === 'SNARE',
  );

  // Folder download as zip, transfer log, admin folder browser
  const zip = await fetch(B + '/api/files/view/docs?zip', { headers: { cookie: cookie('carol') } });
  const zipBytes = Buffer.from(await zip.arrayBuffer());
  check('folder downloads as zip', zip.status === 200 && zipBytes.subarray(0, 2).toString() === 'PK' && zipBytes.includes('song.txt'));
  await call('carol', '/api/files/view/docs/song.txt?download');
  const log = JSON.parse((await call('alice', '/api/admin/log')).text);
  check(
    'log has uploads and downloads',
    log.some((e) => e.user === 'bob' && e.action === 'uploaded') &&
      log.some((e) => e.user === 'carol' && e.action === 'downloaded' && e.path === 'docs/song.txt') &&
      log.some((e) => e.action === 'downloaded folder (zip)'),
  );
  check('non-admin blocked from log', (await call('bob', '/api/admin/log')).status === 403);
  const folders = JSON.parse((await call('alice', `/api/admin/folders?drive=d&path=${encodeURIComponent(rel + '/team')}`)).text).folders;
  check('admin can browse drive folders', folders.includes('docs') && !folders.some((f) => f.startsWith('.sk-')));
  check('folder browser blocks other drives', (await call('alice', '/api/admin/folders?drive=d&path=D%3A%2FWindows')).status === 400);
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

  // Parallel, out-of-order chunked upload (how the site uploads big files)
  const big = Buffer.alloc(250_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251;
  const cs = 100_000;
  const pid = 'parallel' + Date.now();
  const q = (c) => `/api/files/ed/stems/big.bin?upload=${pid}&chunk=${c}&chunks=3&size=${big.length}&chunkSize=${cs}`;
  const results = await Promise.all([2, 0, 1].map((c) => call('bob', q(c), 'PUT', big.subarray(c * cs, (c + 1) * cs), true)));
  check(
    '3 chunks sent at once, out of order',
    results.every((r) => r.status === 200),
  );
  check('file reassembled byte for byte', Buffer.compare(readFileSync(join(drive, 'team', 'stems', 'big.bin')), big) === 0);
  check('no leftover part files', !readdirSync(join(drive, 'team', 'stems')).some((f) => f.startsWith('.sk-upload')));
  check(
    'chunk offsets must line up',
    (await call('bob', `/api/files/ed/x.bin?upload=badchunk1&chunk=0&chunks=5&size=10&chunkSize=4`, 'PUT', 'x', true)).status === 400,
  );

  // Previews for formats browsers can't show
  const { writePsd } = await import(new URL('../server/node_modules/ag-psd/dist/index.js', import.meta.url).href);
  const px = new Uint8ClampedArray(120 * 80 * 4).fill(255);
  writeFileSync(
    join(drive, 'team', 'art.psd'),
    Buffer.from(
      writePsd({ width: 120, height: 80, imageData: { width: 120, height: 80, data: px }, children: [] }, { generateThumbnail: false }),
    ),
  );
  const psdThumb = await call('alice', '/api/files/view/art.psd?thumb');
  check('PSD thumbnail', psdThumb.status === 200 && psdThumb.headers.get('content-type') === 'image/webp');
  check('PSD preview', (await call('alice', '/api/files/view/art.psd?preview')).status === 200);
  check(
    'PSD itself downloads (not shown raw)',
    /attachment/.test((await call('alice', '/api/files/view/art.psd')).headers.get('content-disposition') || ''),
  );

  // Caching: page always re-checked, built assets cached forever
  check('page is no-cache', (await fetch(B + '/')).headers.get('cache-control') === 'no-cache');

  // Folder zips: a file named like a tar option must be zipped as a file, never run as an option
  mkdirSync(join(drive, 'team', 'optfolder'), { recursive: true });
  writeFileSync(join(drive, 'team', 'optfolder', '--version'), 'not an option');
  writeFileSync(join(drive, 'team', 'optfolder', 'song.txt'), 'la la');
  const optZip = await fetch(B + '/api/files/view/optfolder?zip', { headers: { cookie: cookie('alice') } });
  const zbytes = Buffer.from(await optZip.arrayBuffer());
  check(
    'zip treats "--version" as a file, not a tar option',
    zip.status === 200 && zbytes.subarray(0, 2).toString() === 'PK' && zbytes.includes('--version') && zbytes.includes('song.txt'),
  );

  // Light audio previews: WAV -> 256 kbps MP3, made once and cached; crafted files refused
  // stereo 16-bit 44.1 kHz, like a real bounce
  const wav = (secs, rate = 44100) => {
    const n = secs * rate;
    const b = Buffer.alloc(44 + n * 4);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + n * 4, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(2, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * 4, 28);
    b.writeUInt16LE(4, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(n * 4, 40);
    for (let i = 0; i < n; i++) {
      const v = Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000);
      b.writeInt16LE(v, 44 + i * 4);
      b.writeInt16LE(v, 46 + i * 4);
    }
    return b;
  };
  writeFileSync(join(drive, 'team', 'bounce.wav'), wav(5));
  const getBin = async (u, path) => {
    const t = Date.now();
    const r = await fetch(B + path, { headers: u ? { cookie: cookie(u) } : {} });
    return { status: r.status, type: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()), ms: Date.now() - t };
  };
  const mp3 = await getBin('alice', '/api/files/view/bounce.wav?preview');
  check('WAV preview is an MP3', mp3.status === 200 && mp3.type === 'audio/mpeg');
  check(
    'MP3 preview is much smaller than the WAV',
    mp3.bytes.length > 0 && mp3.bytes.length < statSync(join(drive, 'team', 'bounce.wav')).size / 4,
    `${mp3.bytes.length} bytes`,
  );
  const again = await getBin('alice', '/api/files/view/bounce.wav?preview');
  check('second request comes from the cache', again.status === 200 && again.bytes.equals(mp3.bytes) && again.ms <= mp3.ms);
  writeFileSync(join(drive, 'team', 'evil.wav'), ['#EXTM3U', '#EXTINF:1,', 'file:///C:/Windows/win.ini', ''].join('\n'));
  const evil = await getBin('alice', '/api/files/view/evil.wav?preview');
  check('a playlist disguised as .wav is refused, nothing leaked', evil.status === 415 && !evil.bytes.toString().includes('[fonts]'));
  const { link: audioLink } = await mk('bob', 'ed', 'bounce.wav');
  const shared = await getBin(null, `${audioLink.url}/preview`);
  check('share link plays the light MP3', shared.status === 200 && shared.type === 'audio/mpeg');
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  writeFileSync(join(drive, 'team', 'real.png'), Buffer.from(png1x1, 'base64'));
  const photo = await getBin('alice', '/api/files/view/real.png?preview');
  check('image preview is WebP', photo.status === 200 && photo.type === 'image/webp');
  check(
    'a damaged image says it cannot be previewed (not a server error)',
    (await getBin('alice', '/api/files/view/pic.png?preview')).status === 415,
  );

  // Camera RAW: previewed from the JPEG inside it, turned the way the camera was held
  {
    const { createRequire } = await import('node:module');
    const sh = createRequire(new URL('../server/package.json', import.meta.url))('sharp');
    const inner = await sh({ create: { width: 64, height: 48, channels: 3, background: '#36c' } })
      .jpeg()
      .toBuffer();
    const ifd = Buffer.alloc(54); // a TIFF-style raw (like CR2): IFD0 = orientation + one JPEG strip
    const tags = [
      [0x0103, 3, 6], // compression: JPEG
      [0x0111, 4, 62], // strip offset (8-byte header + this 54-byte IFD)
      [0x0112, 3, 6], // orientation: rotate 90
      [0x0117, 4, inner.length],
    ];
    ifd.writeUInt16LE(tags.length, 0);
    tags.forEach(([tag, type, val], i) => {
      ifd.writeUInt16LE(tag, 2 + i * 12);
      ifd.writeUInt16LE(type, 4 + i * 12);
      ifd.writeUInt32LE(1, 6 + i * 12);
      if (type === 3) ifd.writeUInt16LE(val, 10 + i * 12);
      else ifd.writeUInt32LE(val, 10 + i * 12);
    });
    writeFileSync(join(drive, 'team', 'shot.CR2'), Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), ifd, inner]));
    const rawShot = await getBin('alice', '/api/files/view/shot.CR2?preview');
    const rawMeta = rawShot.status === 200 ? await sh(rawShot.bytes).metadata() : {};
    check('RAW photo previews from its embedded JPEG, upright', rawMeta.format === 'webp' && rawMeta.width === 48 && rawMeta.height === 64);
    writeFileSync(join(drive, 'team', 'junk.NEF'), Buffer.from('MM\x00*\x00\x00\x00\x08garbage'));
    check(
      'a RAW with nothing inside says so (not a server error)',
      (await getBin('alice', '/api/files/view/junk.NEF?preview')).status === 415,
    );
  }

  // Preview cache location (Admin Panel > Drives): only known drives accepted
  const cfgNow = JSON.parse(readFileSync(join(dir, 'data', 'config.json'), 'utf8'));
  const badCfg = (patch) => call('alice', '/api/admin/config', 'PUT', { ...cfgNow, ...patch });
  check(
    'config: a space can only grant rights to groups that exist',
    (
      await badCfg({
        spaces: [...cfgNow.spaces, { id: 'x1', name: 'X', drive: 'd', path: '', everyone: 'none', access: {}, groups: { ghosts: 'view' } }],
      })
    ).status === 400,
  );
  check(
    'config: folder names cannot hold slashes',
    (
      await badCfg({
        spaces: [
          ...cfgNow.spaces,
          { id: 'x2', name: 'X', folders: [{ drive: 'd', path: '', label: 'a/b' }], everyone: 'none', access: {} },
        ],
      })
    ).status === 400,
  );
  check(
    'config: folders cannot climb',
    (
      await badCfg({
        spaces: [...cfgNow.spaces, { id: 'x3', name: 'X', folders: [{ drive: 'd', path: '../x' }], everyone: 'none', access: {} }],
      })
    ).status === 400,
  );
  check(
    'config: group members must be usernames',
    (await badCfg({ groups: { editors: { name: 'E', members: ['<script>'] } } })).status === 400,
  );
  check(
    'cache on an unknown drive is refused',
    (await call('alice', '/api/admin/config', 'PUT', { ...cfgNow, cacheDrive: 'nope' })).status === 400,
  );
  check(
    'previews were cached in the test cache, not the real one',
    existsSync(join(dir, 'cache')) && readdirSync(join(dir, 'cache')).length > 0,
  );

  // Boards: unsafe links rejected, connection spoofing ignored, bad JSON is a 400
  const board = JSON.parse((await call('alice', '/api/boards', 'POST', { name: 'Sec' })).text);

  // Moodboard pictures are stored compressed for display, with the original kept
  const { createRequire } = await import('node:module');
  const sharpLib = createRequire(new URL('../server/package.json', import.meta.url))('sharp');
  const bigPng = await sharpLib({ create: { width: 3000, height: 2000, channels: 3, background: '#c0c0c0' } })
    .png()
    .toBuffer();
  const asset = JSON.parse((await call('alice', `/api/boards/${board.id}/assets?name=cover.png`, 'PUT', bigPng, true)).text);
  check('dragged-on picture is shown as WebP', asset.src.endsWith('.webp') && asset.original.endsWith('-original.png'));
  const shownPic = Buffer.from(await (await fetch(B + asset.src, { headers: { cookie: cookie('alice') } })).arrayBuffer());
  const meta = await sharpLib(shownPic).metadata();
  check('shown copy is shrunk to 2400 px', meta.format === 'webp' && meta.width === 2400);
  check(
    'original kept untouched',
    (await fetch(B + asset.original, { headers: { cookie: cookie('alice') } }).then((r) => r.arrayBuffer())).byteLength === bigPng.length,
  );
  const gif = JSON.parse((await call('alice', `/api/boards/${board.id}/assets?name=spin.gif`, 'PUT', 'GIF89a', true)).text);
  check('GIFs stay as they are (animation)', gif.src.endsWith('.gif'));

  // Blog: public reading, admin-only writing, drafts hidden, feeds limited to public websites
  check('blog reads without an account', (await fetch(B + '/api/blog')).status === 200);
  check('blog page is public', (await fetch(B + '/blog')).status === 200 && (await fetch(B + '/blog/abc123')).status === 200);
  check('members cannot write posts', (await call('bob', '/api/blog/posts', 'POST', { title: 'x' })).status === 403);
  const draft = JSON.parse(
    (await call('alice', '/api/blog/posts', 'POST', { title: 'Why culture', body: 'First line.\n\nSecond https://example.com' })).text,
  );
  check('drafts stay hidden', !(await (await fetch(B + '/api/blog')).json()).posts.some((p) => p.id === draft.id));
  check('draft post page is not public', (await fetch(B + `/api/blog/post/${draft.id}`)).status === 404);
  await call('alice', `/api/blog/posts/${draft.id}`, 'PATCH', { published: true });
  const publicPosts = (await (await fetch(B + '/api/blog')).json()).posts;
  check(
    'published post gets a readable address',
    publicPosts.some((p) => p.id === draft.id && p.source === 'sanktuary' && p.url === '/blog/why-culture'),
  );
  check('post readable by its address', (await (await fetch(B + '/api/blog/post/why-culture')).json()).title === 'Why culture');
  check('two-part blog addresses load the page', (await fetch(B + '/blog/boroma/what-does-change-look-like')).status === 200);
  const notesWall = await fetch(B + '/api/blog/notes');
  check('notes wall reads without an account', notesWall.status === 200 && Array.isArray((await notesWall.json()).notes));
  const titledNotes = JSON.parse((await call('alice', '/api/blog/posts', 'POST', { title: 'Notes', body: 'x' })).text);
  await call('alice', `/api/blog/posts/${titledNotes.id}`, 'PATCH', { published: true });
  check(
    'a post called "Notes" does not take over /blog/notes',
    JSON.parse((await call('alice', '/api/blog/admin')).text).posts.find((p) => p.id === titledNotes.id).slug !== 'notes',
  );
  await call('alice', `/api/blog/posts/${titledNotes.id}`, 'DELETE');
  check('full post readable', (await (await fetch(B + `/api/blog/post/${draft.id}`)).json()).body.includes('Second'));
  check(
    'cover must be one of our images',
    (await call('alice', `/api/blog/posts/${draft.id}`, 'PATCH', { image: 'https://evil.example/x.png' })).status === 200 &&
      !JSON.parse((await call('alice', '/api/blog/admin')).text).posts.find((p) => p.id === draft.id).image,
  );
  for (const bad of [
    'http://blog.example/feed',
    'https://127.0.0.1/feed',
    'https://localhost/feed',
    'https://boroma.tailab8c2c.ts.net/feed',
  ])
    check(`feed refused: ${bad}`, (await call('alice', '/api/blog/feeds', 'POST', { url: bad })).status === 400);
  const cover = JSON.parse((await call('alice', `/api/blog/images?name=cover.png`, 'PUT', bigPng, true)).text);
  check(
    'cover image compressed to WebP',
    /^\/api\/blog\/images\/[\w-]+\.webp$/.test(cover.url) && (await fetch(B + cover.url)).status === 200,
  );

  // Front door: public Welcome data, join form
  const pub0 = await (await fetch(B + '/api/public')).json();
  check('welcome loads without an account', typeof pub0.intro === 'string' && pub0.posts.some((p) => p.id === draft.id));
  const gig = JSON.parse(
    (await call('bob', '/api/timeline', 'POST', { title: 'Listening party', kind: 'Event', start: day(10), location: 'Mpls' })).text,
  );
  const secret = JSON.parse((await call('bob', '/api/timeline', 'POST', { title: 'Secret shoot', kind: 'Shoot', start: day(10) })).text);
  await call('bob', `/api/timeline/${gig.id}`, 'PATCH', { public: true });
  const ep = JSON.parse((await call('alice', '/api/tracks/release', 'POST', { title: 'Open EP', kind: 'EP', date: day(30) })).text);
  // New releases ask who it's by and who wrote it first; songs' BMI sheets start from these
  const credited = JSON.parse(
    (
      await call('alice', '/api/tracks/release', 'POST', {
        title: 'Credited EP',
        kind: 'EP',
        artist: '  Sanktuary Collective ',
        writers: [{ name: 'HIMA', pro: 'BMI' }, { name: '  ' }, { name: 'Amara', pro: 'ASCAP' }],
      })
    ).text,
  );
  check(
    'a release keeps its artist and songwriters (blank names dropped)',
    credited.artist === 'Sanktuary Collective' && credited.writers.map((w) => `${w.name}/${w.pro}`).join(',') === 'HIMA/BMI,Amara/ASCAP',
    JSON.stringify(credited),
  );
  check(
    "a release's writers are checked like the BMI sheet's",
    (await call('alice', `/api/tracks/release/${credited.id}`, 'PATCH', { writers: [{ name: 'HIMA', ipi: '12' }] })).status === 400,
  );
  await call('alice', `/api/tracks/release/${ep.id}`, 'PATCH', { public: true });
  await call('alice', `/api/tracks/release/${album.id}`, 'PATCH', { public: true }); // still private (members list): must not leak
  const pub1 = await (await fetch(B + '/api/public')).json();
  check(
    'public events show',
    pub1.events.some((e) => e.title === 'Listening party' && e.location === 'Mpls'),
  );
  check('non-public events stay hidden', !pub1.events.some((e) => e.title === 'Secret shoot'));
  check(
    'public releases show (title and date only)',
    pub1.releases.some((r) => r.title === 'Open EP' && !('members' in r) && !('owner' in r)),
  );
  check('private releases never leak, even marked public', !pub1.releases.some((r) => r.title === 'TSIMY'));

  // Stories (Heart of the Cities): a folder told as a guided story, public only when published
  const hotc = join(drive, 'team', 'hotc');
  mkdirSync(join(hotc, 'Minneapolis'), { recursive: true });
  const jpg = await sharpLib({ create: { width: 64, height: 48, channels: 3, background: '#c33' } })
    .jpeg()
    .toBuffer();
  writeFileSync(join(hotc, 'Minneapolis', '01 corner.jpg'), jpg);
  writeFileSync(join(hotc, 'Minneapolis', '01 corner.txt'), 'Lake Street at dusk');
  writeFileSync(join(hotc, 'Minneapolis', '02 walk.mp4'), Buffer.alloc(4096, 1));
  writeFileSync(join(hotc, 'notes.docx'), 'not a photo'); // ignored
  const pub = (p, init) => fetch(B + p, init);
  check(
    'only admins make stories',
    (await call('bob', '/api/stories', 'POST', { title: 'X', folder: { space: 'up', path: 'hotc' } })).status === 403,
  );
  const story = JSON.parse(
    (await call('alice', '/api/stories', 'POST', { title: 'Heart of the Cities', folder: { space: 'view', path: 'hotc' } })).text,
  );
  check(
    'a story is made from the folder: chapters and captions',
    story.slug === 'heart-of-the-cities' &&
      story.items.length === 2 &&
      story.items[0].chapter === 'Minneapolis' &&
      story.items[0].caption === 'Lake Street at dusk' &&
      story.items[1].kind === 'video',
    JSON.stringify(story.items),
  );
  check(
    'a story needs photos or videos',
    (await call('alice', '/api/stories', 'POST', { title: 'Empty', folder: { space: 'view', path: 'docs' } })).status === 400,
  );
  const sp = '/api/public/story/heart-of-the-cities';
  check('an unpublished story is not public', (await pub(sp)).status === 404 && (await pub(sp + '/0')).status === 404);
  check('admins can preview it', (await call('alice', sp)).status === 200);
  await call('alice', '/api/stories/heart-of-the-cities', 'PATCH', { public: true, subtitle: 'Twin Cities, 2026' });
  const pubStory = await (await pub(sp)).json();
  check('a published story is public', pubStory.title === 'Heart of the Cities' && pubStory.items.length === 2);
  check(
    'file names and paths never reach visitors',
    !JSON.stringify(pubStory).includes('corner.jpg') && !JSON.stringify(pubStory).includes('hotc'),
  );
  const pic = await pub(sp + '/0?w=800');
  check('photos come as resized WebP, not the original', pic.status === 200 && pic.headers.get('content-type') === 'image/webp');
  const clip = await pub(sp + '/1', { headers: { range: 'bytes=0-99' } });
  check('videos stream with ranges', clip.status === 206 && clip.headers.get('content-type') === 'video/mp4');
  check(
    'only the story’s own items can be fetched',
    (await pub(sp + '/7')).status === 404 &&
      (await pub(sp + '/abc')).status === 404 &&
      (await pub('/api/public/story/..%2F..%2Fconfig/0')).status === 404,
  );
  await call('alice', '/api/stories/heart-of-the-cities', 'PATCH', {
    items: [
      { file: '../../../data/config.json', caption: 'x' },
      { file: 'Minneapolis/02 walk.mp4', caption: 'The walk' },
    ],
  });
  const afterSwap = JSON.parse((await call('alice', '/api/stories')).text).find((x) => x.slug === 'heart-of-the-cities');
  check(
    'items can be reordered and captioned but never swapped for other files',
    afterSwap.items.length === 2 && afterSwap.items[0].file === 'Minneapolis/02 walk.mp4' && afterSwap.items[0].caption === 'The walk',
    JSON.stringify(afterSwap.items),
  );
  await call('alice', '/api/stories/heart-of-the-cities', 'PATCH', { items: afterSwap.items.map((i, k) => ({ ...i, hidden: k === 0 })) });
  check('hidden items leave the story', (await (await pub(sp)).json()).items.length === 1);
  writeFileSync(join(hotc, '03 skyline.jpg'), jpg);
  const rescanned = JSON.parse((await call('alice', '/api/stories/heart-of-the-cities', 'PATCH', { rescan: true })).text);
  check('a rescan adds new photos at the end', rescanned.items.length === 3 && rescanned.items[2].file === '03 skyline.jpg');
  const page = await pub('/story/heart-of-the-cities');
  check(
    'the story page is served with a strict policy',
    page.status === 200 && /default-src 'self'/.test(page.headers.get('content-security-policy') || ''),
  );
  for (const bad of ['/%E0%A4%A', '/apps/rapidraw/%E0%A4%A', '/api/files/view/%E0%A4%A?list', '/story/%E0'])
    check(`a malformed address (${bad}) is refused without taking the server down`, (await pub(bad)).status < 500);
  check('the server is still up after malformed addresses', (await pub('/api/public/directory')).status === 200);
  check('odd story addresses are refused', (await pub('/story/a%2F..%2Fb')).status === 404);
  check(
    'the directory lists published stories',
    (await (await pub('/api/public/directory')).json()).stories.some((x) => x.slug === 'heart-of-the-cities'),
  );

  // Opportunities: grants and calls posted for the team
  const oppDue = new Date(Date.now() + 5 * 864e5).toLocaleDateString('en-CA');
  check(
    'opportunity links must be https',
    (await call('bob', '/api/opportunities', 'POST', { title: 'X', link: 'javascript:alert(1)' })).status === 400,
  );
  check('an opportunity needs a name', (await call('bob', '/api/opportunities', 'POST', { title: '  ' })).status === 400);
  const grant = JSON.parse(
    (
      await call('bob', '/api/opportunities', 'POST', {
        title: 'Creative Support for Individuals',
        org: 'Minnesota State Arts Board',
        kind: 'Grant',
        link: 'https://www.arts.state.mn.us/grants',
        deadline: oppDue,
        amount: 'up to $6,000',
        fields: ['Music', 'Nonsense'],
      })
    ).text,
  );
  check('a member posts an opportunity', grant.title === 'Creative Support for Individuals' && grant.fields.join() === 'Music');
  check(
    'the team hears about it',
    JSON.parse((await call('carol', '/api/projects?notifications')).text).some((n) => /New grant: Creative Support/.test(n.text)),
  );
  const carolMarks = JSON.parse((await call('carol', `/api/opportunities/${grant.id}`, 'PATCH', { status: 'interested' })).text);
  check('each person marks their own status', carolMarks.mine === 'interested' && carolMarks.people.carol === 'interested');
  check(
    'marking it interested inside the last week reminds you',
    JSON.parse((await call('carol', '/api/projects?notifications')).text).some((n) =>
      /Creative Support for Individuals is due in 5 days/.test(n.text),
    ),
  );
  await call('alice', `/api/opportunities/${grant.id}`, 'PATCH', { status: 'applied' });
  check(
    'people who already applied are not nagged',
    !JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) =>
      /Creative Support for Individuals is due/.test(n.text),
    ),
  );
  check(
    'only the poster or an admin edits the details',
    (await call('carol', `/api/opportunities/${grant.id}`, 'PATCH', { title: 'Mine now' })).status === 403,
  );
  check('a bad status is refused', (await call('carol', `/api/opportunities/${grant.id}`, 'PATCH', { status: 'maybe' })).status === 400);
  check(
    'opportunity deadlines are on the calendar',
    JSON.parse((await call('carol', '/api/timeline')).text).items.some(
      (i) => i.source === 'opportunities' && i.kind === 'Deadline' && i.start === oppDue,
    ),
  );
  check('only the poster or an admin takes it down', (await call('carol', `/api/opportunities/${grant.id}`, 'DELETE')).status === 403);
  check(
    'taken down opportunities disappear',
    (await call('bob', `/api/opportunities/${grant.id}`, 'DELETE')).status === 200 &&
      !JSON.parse((await call('carol', '/api/opportunities')).text).items.some((o) => o.id === grant.id),
  );
  check('opportunities are for members only', (await fetch(B + '/api/opportunities')).status === 401);

  // Health check and usage numbers
  const hz = await pub('/healthz');
  check('/healthz answers for deploy checks and uptime monitors', hz.status === 200 && (await hz.json()).ok === true);
  check('usage numbers are for admins only', (await call('bob', '/api/admin/usage')).status === 403);
  const usage = JSON.parse((await call('alice', '/api/admin/usage')).text);
  const thisWeek = usage.weeks[0];
  check(
    'usage counts active members, uploads and story views',
    thisWeek.members.includes('bob') &&
      thisWeek.members.includes('carol') &&
      thisWeek.uploads > 0 &&
      thisWeek.views['story:heart-of-the-cities'] >= 1,
    JSON.stringify({ ...thisWeek, members: thisWeek.members.length }),
  );
  check('usage shows how much real content there is', usage.content.stories === 1 && usage.content.tracks > 0);

  // Public directory (My Computer): only people who opted in, only what was made public
  await call('bob', '/api/profiles/me', 'PUT', {
    displayName: 'Bob B',
    role: 'Producer',
    instagram: '@bobmakesbeats',
    website: 'javascript:alert(1)',
    spotify: 'https://open.spotify.com/artist/abc123',
    tiktok: '@bobbeats',
    bandcamp: 'data:text/html,<script>alert(1)</script>',
    status: 'at the dentist',
    listed: true,
  });
  await call('carol', '/api/profiles/me', 'PUT', { displayName: 'Carol', listed: 'yes' }); // only a real true opts in
  writeFileSync(join(dir, 'data', 'profiles', 'mallory.json'), JSON.stringify({ displayName: 'Mallory', listed: true })); // not a member
  const dirView = await fetch(B + '/api/public/directory');
  const dirData = await dirView.json();
  const bobCard = dirData.people.find((p) => p.username === 'bob');
  check('directory works without an account', dirView.status === 200);
  check(
    'people who opted in are listed, with safe links',
    bobCard?.displayName === 'Bob B' && bobCard.links.instagram === 'https://instagram.com/bobmakesbeats' && !bobCard.links.website,
    JSON.stringify(bobCard),
  );
  check(
    'more places artists keep their work: Spotify, TikTok handles',
    bobCard?.links.spotify === 'https://open.spotify.com/artist/abc123' && bobCard.links.tiktok === 'https://tiktok.com/@bobbeats',
  );
  check(
    'profile links are only ever http(s)',
    Object.values(bobCard?.links || {}).every((l) => /^https?:\/\//.test(l)),
  );
  check('away messages stay private', !JSON.stringify(dirData.people).includes('dentist'));
  check('only people who opted in are listed', !dirData.people.some((p) => ['carol', 'alice', 'mallory'].includes(p.username)));
  check(
    'directory: public releases only',
    dirData.releases.some((r) => r.title === 'Open EP' && r.tracks === 0) && !dirData.releases.some((r) => r.title === 'TSIMY'),
  );
  check(
    'directory: public events only',
    dirData.events.some((e) => e.title === 'Listening party') && !dirData.events.some((e) => e.title === 'Secret shoot'),
  );
  check('directory never shows folders or owners', !/folder|owner|members/.test(JSON.stringify(dirData.releases)));
  check('avatar of someone not listed is not public', (await fetch(B + '/api/public/avatar/carol')).status === 404);
  check('avatar name cannot climb', (await fetch(B + '/api/public/avatar/..%2F..%2Fconfig')).status === 404);

  // Public release pages: only songs ticked for the page, 30-second previews, never the bounce itself
  const rate = 8000;
  const wavData = Buffer.alloc(rate * 40 * 2);
  for (let i = 0; i < rate * 40; i++) wavData.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  const wavHead = Buffer.alloc(44);
  wavHead.write('RIFF', 0);
  wavHead.writeUInt32LE(36 + wavData.length, 4);
  wavHead.write('WAVEfmt ', 8);
  wavHead.writeUInt32LE(16, 16);
  wavHead.writeUInt16LE(1, 20);
  wavHead.writeUInt16LE(1, 22);
  wavHead.writeUInt32LE(rate, 24);
  wavHead.writeUInt32LE(rate * 2, 28);
  wavHead.writeUInt16LE(2, 32);
  wavHead.writeUInt16LE(16, 34);
  wavHead.write('data', 36);
  wavHead.writeUInt32LE(wavData.length, 40);
  mkdirSync(join(drive, 'team', 'ep'), { recursive: true });
  writeFileSync(join(drive, 'team', 'ep', 'opening master.wav'), Buffer.concat([wavHead, wavData]));
  const rp = '/api/public/release/open-ep';
  const epPage = await (await fetch(B + rp)).json();
  check(
    'a public release has a page (slug given on first use)',
    epPage.title === 'Open EP' && Array.isArray(epPage.tracks) && epPage.tracks.length === 0,
  );
  const opening = JSON.parse((await call('alice', '/api/tracks/track', 'POST', { release: ep.id, title: 'Opening' })).text);
  const unannounced = JSON.parse((await call('alice', '/api/tracks/track', 'POST', { release: ep.id, title: 'Unannounced' })).text);
  await call('alice', `/api/tracks/track/${opening.id}`, 'PATCH', {
    bounce: { space: 'view', path: 'ep/opening master.wav' },
    credits: 'Produced by HIMA',
    links: { bandlab: 'https://www.bandlab.com/x' },
    onPage: true,
    previewAt: 5,
  });
  await call('alice', `/api/tracks/track/${unannounced.id}`, 'PATCH', {
    bounce: { space: 'view', path: 'ep/opening master.wav' },
    previewAt: 0,
  });
  const epPage2 = await (await fetch(B + rp)).json();
  check(
    'only songs ticked for the page appear, with credits and links',
    epPage2.tracks.length === 1 &&
      epPage2.tracks[0].title === 'Opening' &&
      epPage2.tracks[0].credits === 'Produced by HIMA' &&
      epPage2.tracks[0].preview,
    JSON.stringify(epPage2.tracks),
  );
  check('bounce paths never reach the page', !JSON.stringify(epPage2).includes('master.wav') && !JSON.stringify(epPage2).includes('team'));
  const clipRes = await fetch(B + `${rp}/preview/${opening.id}`);
  const clipBytes = Buffer.from(await clipRes.arrayBuffer());
  check(
    'the preview is a short MP3 clip, not the bounce',
    clipRes.status === 200 &&
      clipRes.headers.get('content-type') === 'audio/mpeg' &&
      clipBytes.length > 1000 &&
      clipBytes.length < wavData.length,
    `${clipRes.status} ${clipBytes.length}`,
  );
  check('songs not on the page have no preview', (await fetch(B + `${rp}/preview/${unannounced.id}`)).status === 404);
  check('a song from another release cannot be previewed here', (await fetch(B + `${rp}/preview/${song.id}`)).status === 404);
  check('private releases have no page even when marked public', (await fetch(B + '/api/public/release/tsimy')).status === 404);
  // Landing-page style: store buttons (https only) and a temporary page that ends on a date
  const epUrl = `/api/tracks/release/${ep.id}`;
  check('store links must be https', (await call('alice', epUrl, 'PATCH', { stores: { spotify: 'javascript:alert(1)' } })).status === 400);
  await call('alice', epUrl, 'PATCH', {
    stores: { spotify: 'https://open.spotify.com/album/x', presave: 'https://distrokid.com/hyperfollow/x', madeUp: 'https://evil.example' },
  });
  const storesShown = (await (await fetch(B + rp)).json()).stores;
  check(
    'the page lists where to listen / pre-save (known stores only)',
    storesShown.spotify === 'https://open.spotify.com/album/x' && storesShown.presave && !('madeUp' in storesShown),
  );
  await call('alice', epUrl, 'PATCH', { pageUntil: '2000-01-01' });
  check('a temporary page is gone after its end date', (await fetch(B + rp)).status === 404);
  await call('alice', epUrl, 'PATCH', { pageUntil: null });
  check('and back when the end date is cleared', (await fetch(B + rp)).status === 200);
  // BMI sheet: identifiers checked and tidied, shares kept in range, never on the public page
  const openingUrl = `/api/tracks/track/${opening.id}`;
  check(
    'BMI: IPI numbers must be 9-11 digits',
    (await call('alice', openingUrl, 'PATCH', { bmi: { writers: [{ name: 'H', ipi: '123' }] } })).status === 400,
  );
  check('BMI: ISRCs are checked', (await call('alice', openingUrl, 'PATCH', { bmi: { isrc: 'nope' } })).status === 400);
  const bmiSaved = JSON.parse(
    (
      await call('alice', openingUrl, 'PATCH', {
        bmi: {
          duration: '3:25',
          isrc: 'us-abc-26-00001',
          iswc: 'T-123.456.789-0',
          writers: [
            { name: 'HIMA', pro: 'BMI', ipi: '00123456789', share: 60, publisher: 'Sanktuary Songs', publisherIpi: '987654321' },
            { name: 'Guest', pro: 'Made up', ipi: '', share: 400 },
          ],
        },
      })
    ).text,
  ).bmi;
  check(
    'BMI: numbers tidied, unknown PRO becomes BMI, shares capped at 100',
    bmiSaved.isrc === 'USABC2600001' &&
      bmiSaved.iswc === 'T-123.456.789-0' &&
      bmiSaved.writers[0].ipi === '00123456789' &&
      bmiSaved.writers[1].pro === 'BMI' &&
      bmiSaved.writers[1].share === 100,
    JSON.stringify(bmiSaved),
  );
  const pagedAfterBmi = JSON.stringify(await (await fetch(B + rp)).json());
  check('BMI sheet never reaches the public page', !pagedAfterBmi.includes('00123456789') && !pagedAfterBmi.includes('bmi'));
  const relHtml = await fetch(B + '/release/open-ep/opening');
  check(
    'release and song pages are served with a strict policy',
    relHtml.status === 200 && /default-src 'self'/.test(relHtml.headers.get('content-security-policy') || ''),
  );
  check('odd release addresses are refused', (await fetch(B + '/release/a/b/c/d')).status === 404);
  check(
    'the directory links releases to their page',
    (await (await fetch(B + '/api/public/directory')).json()).releases.some((r) => r.slug === 'open-ep'),
  );

  // Portfolio (for grant applications): statement and bio from the Admin Panel, plus everything public
  check('only admins edit the portfolio', (await call('bob', '/api/public/admin', 'PATCH', { portfolio: { name: 'X' } })).status === 403);
  await call('alice', '/api/public/admin', 'PATCH', {
    portfolio: {
      name: 'HIMA',
      tagline: 'Artist, producer',
      statement: 'I make music about home.',
      contact: 'hima@example.com',
      links: 'https://ok.example/hima\njavascript:alert(1)\nhttp://plain.example',
    },
  });
  const pf = await (await fetch(B + '/api/public/portfolio')).json();
  check(
    'the portfolio shows the statement and contact',
    pf.name === 'HIMA' && pf.statement === 'I make music about home.' && pf.contact === 'hima@example.com',
  );
  check('portfolio links are https only', pf.links.length === 1 && pf.links[0] === 'https://ok.example/hima', JSON.stringify(pf.links));
  check(
    'the portfolio gathers releases, stories and collaborators',
    pf.releases.some((r) => r.slug === 'open-ep' && r.tracks.length === 1) &&
      pf.stories.some((x) => x.slug === 'heart-of-the-cities') &&
      pf.people.some((x) => x.username === 'bob'),
  );
  check('the portfolio never lists private releases', !pf.releases.some((r) => r.title === 'TSIMY'));
  check('the portfolio page is served', (await fetch(B + '/portfolio')).status === 200);
  const usage2 = JSON.parse((await call('alice', '/api/admin/usage')).text);
  check('release and portfolio views are counted', usage2.weeks[0].views['release:open-ep'] >= 1 && usage2.weeks[0].views.portfolio >= 1);
  check(
    'join needs a real email',
    (await fetch(B + '/api/public/join', { method: 'POST', body: JSON.stringify({ name: 'Amara', email: 'nope' }) })).status === 400,
  );
  check(
    'join works',
    (
      await fetch(B + '/api/public/join', {
        method: 'POST',
        body: JSON.stringify({ name: 'Amara', email: 'amara@example.com', role: 'Photographer' }),
      })
    ).status === 200,
  );
  await fetch(B + '/api/public/join', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bot', email: 'bot@example.com', website: 'http://spam' }),
  });
  const joins = JSON.parse((await call('alice', '/api/public/admin')).text).joins;
  check(
    'join request reaches admins',
    joins.some((j) => j.name === 'Amara' && j.status === 'New'),
  );
  check('bots filling the hidden field are dropped', !joins.some((j) => j.name === 'Bot'));
  check(
    'admins are notified of join requests',
    JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) => /Amara wants to join/.test(n.text)),
  );
  check(
    'visitors cannot read the join list',
    (await fetch(B + '/api/public/admin')).status === 401 && (await call('bob', '/api/public/admin')).status === 403,
  );

  // Pool: public counter, Stripe Checkout, signed webhooks only, each payment counted once
  check('members cannot create pools', (await call('bob', '/api/pools', 'POST', { title: 'x' })).status === 403);
  const pool = JSON.parse((await call('alice', '/api/pools', 'POST', { title: 'Studio monitors' })).text);
  await call('alice', `/api/pools/${pool.id}`, 'PATCH', { goal: 600 });
  check('private pool hidden from visitors', (await fetch(B + `/api/pools/${pool.slug}`)).status === 404);
  await call('alice', `/api/pools/${pool.id}`, 'PATCH', { public: true });
  check('public pool visible to visitors', (await (await fetch(B + `/api/pools/${pool.slug}`)).json()).goal === 600);
  check(
    'give amount limits',
    (await fetch(B + `/api/pools/${pool.slug}/give`, { method: 'POST', body: JSON.stringify({ amount: 0.2 }) })).status === 400,
  );
  const give = await (
    await fetch(B + `/api/pools/${pool.slug}/give`, { method: 'POST', body: JSON.stringify({ amount: 25, name: 'Amara', message: 'go!' }) })
  ).json();
  const giveCall = stripeCalls[stripeCalls.length - 1];
  check('give opens Stripe Checkout', give.url.startsWith('https://checkout.stripe.test/') && giveCall.auth === 'Bearer sk_test_fake');
  check(
    'Checkout gets the right amount',
    giveCall.form.get('line_items[0][price_data][unit_amount]') === '2500' && giveCall.form.get('metadata[pool]') === pool.id,
  );
  const paidSession = {
    id: 'cs_pool_1',
    payment_status: 'paid',
    amount_total: 2500,
    metadata: { pool: pool.id, name: 'Amara', message: 'go!' },
  };
  check(
    'unsigned webhook refused',
    (
      await fetch(B + '/api/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed', data: { object: paidSession } }),
      })
    ).status === 400,
  );
  check('forged webhook refused', (await stripeHook(paidSession, 'whsec_wrong')).status === 400);
  check('stale webhook refused', (await stripeHook(paidSession, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600)).status === 400);
  check('signed webhook accepted', (await stripeHook(paidSession)).status === 200);
  await stripeHook(paidSession); // Stripe retries: must not count twice
  await stripeHook({
    id: 'cs_pool_2',
    payment_status: 'paid',
    amount_total: 1000,
    metadata: { pool: pool.id, name: 'Shy', anonymous: '1' },
  });
  const poolNow = await (await fetch(B + `/api/pools/${pool.slug}`)).json();
  check('counter adds each payment once', poolNow.raised === 35 && poolNow.supporters === 2);
  check('anonymous stays anonymous', poolNow.recent.some((r) => r.name === 'Anonymous') && !poolNow.recent.some((r) => r.name === 'Shy'));
  await call('alice', `/api/pools/${pool.id}/manual`, 'POST', { amount: 40, name: 'Cash at the show' });
  check('admins can add cash by hand', (await (await fetch(B + `/api/pools/${pool.slug}`)).json()).raised === 75);
  check('public page loads', (await fetch(B + `/pool/${pool.slug}`)).status === 200);

  // Shop: digital delivery through a private download link, stock counts down, orders only in the portal
  check('members cannot add products', (await call('bob', '/api/shop/products', 'POST', { title: 'x' })).status === 403);
  const beat = JSON.parse((await call('alice', '/api/shop/products', 'POST', { title: 'Beat pack', kind: 'digital', price: 15 })).text);
  check(
    'digital product needs its file before going on sale',
    (await call('alice', `/api/shop/products/${beat.id}`, 'PATCH', { active: true })).status === 400,
  );
  await call('alice', `/api/shop/products/${beat.id}`, 'PATCH', { file: { space: 'ed', path: 'docs/song.txt' }, active: true });
  const tee = JSON.parse(
    (await call('alice', '/api/shop/products', 'POST', { title: 'Village tee', kind: 'physical', price: 30, stock: 2 })).text,
  );
  await call('alice', `/api/shop/products/${tee.id}`, 'PATCH', { active: true });
  const shopList = await (await fetch(B + '/api/shop')).json();
  check(
    'shop lists products to visitors',
    shopList.products.length === 2 && !('file' in shopList.products[0]) && !('stock' in shopList.products[0]),
  );
  check(
    'cannot buy more than in stock',
    (await fetch(B + `/api/shop/${tee.slug}/buy`, { method: 'POST', body: '{"qty":3}' })).status === 409,
  );
  await fetch(B + `/api/shop/${tee.slug}/buy`, { method: 'POST', body: '{"qty":2}' });
  const teeCall = stripeCalls[stripeCalls.length - 1];
  check('merch asks Stripe for a shipping address', teeCall.form.get('shipping_address_collection[allowed_countries][0]') === 'US');
  check(
    'shop categories must be known ones',
    (await call('alice', `/api/shop/products/${beat.id}`, 'PATCH', { category: '<script>' })).status === 400,
  );
  await call('alice', `/api/shop/products/${beat.id}`, 'PATCH', { category: 'vocal-chains' });
  const cats = Object.fromEntries((await (await fetch(B + '/api/shop')).json()).products.map((p) => [p.id, p.category]));
  check('products show their category (merch by default)', cats[beat.id] === 'vocal-chains' && cats[tee.id] === 'merch');
  await fetch(B + `/api/shop/${beat.slug}/buy`, { method: 'POST', body: '{"qty":5}' });
  check('a digital order is always one copy', stripeCalls[stripeCalls.length - 1].form.get('line_items[0][quantity]') === '1');
  const beatSession = `cs_test_${stripeCalls.length}`;
  const beatOrder = stripeCalls[stripeCalls.length - 1].form.get('metadata[order]');
  check('order is pending until Stripe confirms', (await (await fetch(B + `/api/shop/order/${beatSession}`)).json()).download === null);
  await stripeHook({
    id: beatSession,
    payment_status: 'paid',
    amount_total: 1500,
    customer_details: { name: 'Amara', email: 'amara@example.com' },
    metadata: { order: beatOrder },
  });
  const delivered = await (await fetch(B + `/api/shop/order/${beatSession}`)).json();
  check(
    'paid digital order gets a download link',
    delivered.status === 'Delivered' && /^\/s\/[\w-]{32}$/.test(delivered.download?.url || ''),
  );
  check('the download works', (await (await fetch(B + `${delivered.download.url}/file?download`)).text()) === 'v2');
  const teeSession = `cs_test_${stripeCalls.indexOf(teeCall) + 1}`;
  await stripeHook({
    id: teeSession,
    payment_status: 'paid',
    amount_total: 6000,
    customer_details: { name: 'Kofi', email: 'k@example.com' },
    shipping_details: { name: 'Kofi', address: { line1: '1 Main St', city: 'Minneapolis' } },
    metadata: { order: teeCall.form.get('metadata[order]') },
  });
  check('stock counts down', (await (await fetch(B + '/api/shop')).json()).products.find((p) => p.id === tee.id).soldOut === true);
  check('order lookup needs the exact session', (await fetch(B + '/api/shop/order/cs_guess')).status === 404);
  const orders = JSON.parse((await biz('alice', '/orders')).text);
  check(
    'orders with addresses show in the Business portal',
    orders.some((o) => o.customer?.address?.city === 'Minneapolis') && orders.length === 2,
  );
  check('orders are not in the open admin API', (await call('bob', '/api/business/orders')).status === 401);
  check('shop pages load', (await fetch(B + '/shop')).status === 200 && (await fetch(B + `/shop/${tee.slug}`)).status === 200);

  // RapidRAW editor proxy: allowlisted commands, Sanktuary paths only, rights checked, real paths never leak
  const raw = (u, command, args) => call(u, `/api/raw/invoke/${command}`, 'POST', args);
  check('editor needs a login', (await fetch(B + '/api/raw/invoke/load_image', { method: 'POST', body: '{}' })).status === 401);
  check('commands outside the editor are refused', (await raw('bob', 'delete_folder', { path: 'sk://ed/docs' })).status === 403);
  check('real paths are refused', (await raw('bob', 'load_image', { path: 'C:/Windows/win.ini' })).status === 400);
  check('paths cannot climb out of a space', (await raw('bob', 'load_image', { path: 'sk://ed/../../data/config.json' })).status === 400);
  check('spaces you cannot see are refused', (await raw('carol', 'load_image', { path: 'sk://ed/pic.png' })).status === 404);
  const opened = await raw('bob', 'load_image', { path: 'sk://ed/pic.png' });
  const sentPath = rawCalls[rawCalls.length - 1].args.path;
  check('the engine gets the real path', sentPath.toLowerCase().endsWith(join('drive', 'team', 'pic.png').toLowerCase()));
  check('the engine gets the token', rawCalls[rawCalls.length - 1].token === 'raw-token-for-tests-123');
  const openedBody = JSON.parse(opened.text);
  check(
    'real paths come back as Sanktuary paths',
    openedBody.path === 'sk://ed/pic.png' && openedBody.sidecar === 'sk://ed/pic.png.rrdata' && !opened.text.includes(drive.slice(3, 8)),
  );
  const preview = await fetch(B + '/api/raw/invoke/apply_adjustments', {
    method: 'POST',
    headers: { cookie: cookie('bob') },
    body: '{"jsAdjustments":{}}',
  });
  check('previews stream back as bytes', Buffer.from(await preview.arrayBuffer()).equals(Buffer.from([1, 2, 3])));
  check('one editor at a time', (await raw('alice', 'load_image', { path: 'sk://view/pic.png' })).status === 423);
  check(
    'view rights cannot save edits',
    (await raw('carol', 'save_metadata_and_update_thumbnail', { path: 'sk://view/pic.png', adjustments: {} })).status !== 200,
  );
  const exp = (u, exportSettings, extra = {}) =>
    raw(u, 'export_images', { paths: ['sk://ed/pic.png'], outputFolderOrFile: 'sk://ed/docs', exportSettings, ...extra });
  check('export name template cannot climb folders', (await exp('bob', { filenameTemplate: '../../evil' })).status === 400);
  check(
    'export subfolder cannot climb folders',
    (await exp('bob', { destinationType: 'originalFolder', subfolder: '..\\..\\x' })).status === 400,
  );
  check(
    'export subfolder cannot name a drive',
    (await exp('bob', { destinationType: 'originalFolder', subfolder: 'C:\\Windows' })).status === 400,
  );
  check(
    '"next to originals" needs upload rights on the photos',
    (
      await raw('carol', 'export_images', {
        paths: ['sk://view/pic.png'],
        outputFolderOrFile: 'sk://view/docs',
        exportSettings: { destinationType: 'originalFolder', subfolder: 'Exports' },
      })
    ).status === 403,
  );
  check(
    'a normal export still goes through',
    (await exp('bob', { destinationType: 'originalFolder', subfolder: 'Exports/Web', filenameTemplate: '{original_filename}_web' }))
      .status === 200,
  );
  const st = JSON.parse((await call('alice', '/api/raw/status')).text);
  check('status says who is editing', st.busyBy === 'bob' && st.installed === false);
  check('editor page explains when not installed', /isn't installed/.test(await (await fetch(B + '/apps/rapidraw/')).text()));

  // Chat attachments: files sent from a phone / computer straight into a conversation
  const dm = 'dm~alice~bob';
  const sent = JSON.parse((await call('alice', `/api/chat/${dm}/files?name=photo.png`, 'PUT', bigPng, true)).text);
  check(
    'chat picture gets a compressed copy to show',
    sent.image === true && sent.url.endsWith('-view.webp') && sent.original.endsWith('.png'),
  );
  check('the other person can open it', (await fetch(B + sent.url, { headers: { cookie: cookie('bob') } })).status === 200);
  check('outsiders cannot open it', (await fetch(B + sent.url, { headers: { cookie: cookie('carol') } })).status === 403);
  check('outsiders cannot upload into it', (await call('carol', `/api/chat/${dm}/files?name=x.txt`, 'PUT', 'x', true)).status === 403);
  const withFile = JSON.parse(
    (
      await call('alice', `/api/chat/${dm}`, 'POST', {
        text: 'cover idea',
        refs: [
          { kind: 'attachment', title: 'photo.png', url: sent.url, image: true },
          { kind: 'attachment', title: 'sneaky', url: '/api/chat/general/files/abc.png' },
        ],
      })
    ).text,
  );
  check('message carries its own attachment', withFile.refs.length === 1 && withFile.refs[0].url === sent.url && withFile.refs[0].image);
  check('attachments from other chats are dropped', !withFile.refs.some((r) => r.url?.includes('/general/')));
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
  fakeStripe.close();
  fakeRaw.close();
  const errors = srvOut.split('\n').filter((l) => l && !l.includes('sanktuary-os on'));
  console.log(`\n${pass} passed, ${failN} failed${errors.length ? '\nserver log:\n' + errors.join('\n') : ''}`);
  rmSync(dir, { recursive: true, force: true });
}
