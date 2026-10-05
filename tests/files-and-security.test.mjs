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
// The server finds a drive by its letter (e.g. C:); off Windows, the first folder of the path stands in for it
const [letter, rel] =
  process.platform === 'win32'
    ? [drive.slice(0, 2), drive.slice(3).split('\\').join('/')]
    : ['/' + drive.split('/')[1], drive.split('/').slice(2).join('/')];
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
const stripeHook = (object, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000), type = 'checkout.session.completed') => {
  const raw = JSON.stringify({ type, data: { object } });
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

// A fake Google: consent codes, tokens, the channel, and a resumable YouTube upload
const ytCalls = [];
const fakeGoogle = http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      ytCalls.push({
        method: req.method,
        path: req.url,
        auth: req.headers.authorization,
        size: raw.length,
        body: raw.toString().slice(0, 500),
      });
      const j = (code, o, h = {}) => res.writeHead(code, { 'content-type': 'application/json', ...h }).end(JSON.stringify(o));
      if (req.url === '/token') {
        const f = new URLSearchParams(raw.toString());
        if (f.get('client_secret') !== 'gsecret') return j(401, {});
        if (f.get('grant_type') === 'authorization_code' && f.get('code') === 'good')
          return j(200, { access_token: 'at1', refresh_token: 'rt1' });
        if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === 'rt1') return j(200, { access_token: 'at2' });
        return j(400, { error: 'invalid_grant' });
      }
      // A fake song.link: a single by bob, on SoundCloud and Audiomack
      if (req.url.startsWith('/odesli?'))
        return j(200, {
          entityUniqueId: 'S1',
          entitiesByUniqueId: { S1: { type: 'song', title: 'Open', artistName: 'bob & carol' } },
          linksByPlatform: {
            soundcloud: { url: 'https://soundcloud.com/bob-music/open' },
            audiomack: { url: 'https://audiomack.com/bob-music/song/open' },
          },
        });
      if (req.url.startsWith('/yt/channels')) return j(200, { items: [{ id: 'UC123', snippet: { title: 'Sanktuary TV' } }] });
      if (req.url.startsWith('/upload?') && req.headers.authorization === 'Bearer at2')
        return j(200, {}, { location: 'http://127.0.0.1:3192/upload-session/1' });
      if (req.url === '/upload-session/1') return j(200, { id: 'abcdefghijk' });
      j(404, {});
    });
  })
  .listen(3192);

// A fake Resend: records every email
const mails = [];
const fakeResend = http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer re_test') return res.writeHead(401).end();
      mails.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `m${mails.length}` }));
    });
  })
  .listen(3191);

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
    RESEND_API_URL: 'http://127.0.0.1:3191',
    RESEND_API_KEY: 're_test',
    MAIL_FROM: 'Sanktuary <hello@sanktuary.test>',
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    GOOGLE_AUTH_URL: 'http://127.0.0.1:3192/auth',
    GOOGLE_TOKEN_URL: 'http://127.0.0.1:3192/token',
    YOUTUBE_API_URL: 'http://127.0.0.1:3192/yt',
    ODESLI_API_URL: 'http://127.0.0.1:3192/odesli',
    YOUTUBE_UPLOAD_URL: 'http://127.0.0.1:3192/upload',
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
  {
    // Earlier versions: listed, previewed like the current file, never a way out of the folder, restore needs edit
    const vList = JSON.parse((await call('bob', '/api/files/ed/docs/song.txt?versions')).text);
    const vName = vList[0]?.name;
    const vFile = readFileSync(join(drive, 'team', '.sk-versions', 'docs', 'song.txt', vName), 'utf8');
    check('versions are listed', vList.length === 1 && !!vName);
    check(
      'an earlier version downloads as it was',
      (await call('bob', `/api/files/ed/docs/song.txt?version=${encodeURIComponent(vName)}`)).text === vFile,
    );
    for (const bad of ['../../../secret.txt', '..', 'a/b', 'C:\Windows'])
      check(
        `version name cannot escape: ${bad}`,
        (await call('bob', `/api/files/ed/docs/song.txt?version=${encodeURIComponent(bad)}`)).status >= 400,
      );
    check(
      'view rights cannot restore a version',
      (await call('carol', `/api/files/view/docs/song.txt?restore=${encodeURIComponent(vName)}`, 'POST')).status === 403,
    );
  }
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
  const songZ = async () => JSON.parse((await call('bob', '/api/files/up/?list')).text).entries.find((e) => e.name === 'Song Z');
  mkdirSync(join(drive, 'team', 'Song Z'));
  check('plain folder is not a project', !(await songZ()).project);
  await up('bob', 'up', 'Song%20Z/Song%20Z.als', als([]));
  check('remembered "not a project" is dropped once a set is uploaded into the folder', (await songZ())?.project?.kind === 'Ableton Live');
  rmSync(join(drive, 'team', 'Song Z'), { recursive: true });
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
  // Engineer facts, measured on the original: format, rate, bit depth, loudness and true peak (the sine peaks at 8000/32768)
  const infoRes = await call('alice', '/api/files/view/bounce.wav?audioinfo');
  const info = infoRes.status === 200 ? JSON.parse(infoRes.text) : {};
  check(
    'audio facts: 44.1 kHz 16-bit stereo WAV, 5 s',
    info.lossless && info.rate === 44100 && info.bits === 16 && info.channels === 'stereo' && Math.abs(info.duration - 5) < 0.05,
    infoRes.text,
  );
  check(
    'audio facts: loudness and true peak measured',
    info.lufs < -5 && info.lufs > -25 && Math.abs(info.truePeak + 12.2) < 0.5,
    infoRes.text,
  );
  {
    // Mix check: a hard clip at 2-3 s and left/right out of phase at 4-5 s are found where they are
    const rate = 44100;
    const n = 6 * rate;
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
      const sec = i / rate;
      const s = Math.sin(sec * 2 * Math.PI * 220);
      const l = sec >= 2 && sec < 3 ? Math.max(-32767, Math.min(32767, Math.round(s * 90000))) : Math.round(s * 6000);
      b.writeInt16LE(l, 44 + i * 4);
      b.writeInt16LE(sec >= 4 && sec < 5 ? -l : l, 46 + i * 4);
    }
    writeFileSync(join(drive, 'team', 'mixcheck.wav'), b);
    const hints = JSON.parse((await call('alice', '/api/files/view/mixcheck.wav?audioinfo')).text).hints || [];
    check(
      'mix check finds the clip where it is',
      hints.some((h) => h.kind === 'clip' && h.from <= 2 && h.to >= 3) && !hints.some((h) => h.kind === 'clip' && (h.from > 3 || h.to < 2)),
      JSON.stringify(hints),
    );
    check(
      'mix check finds the out-of-phase part where it is',
      hints.some((h) => h.kind === 'phase' && h.from <= 4 && h.to >= 5 && h.value < 0),
      JSON.stringify(hints),
    );
    check('a clean file has nothing flagged', (info.hints || []).length === 0, JSON.stringify(info.hints));
  }
  check('audio facts are cached', JSON.parse((await call('alice', '/api/files/view/bounce.wav?audioinfo')).text).lufs === info.lufs);
  check('audio facts need access to the space', (await call('carol', '/api/files/ed/song.txt?audioinfo')).status >= 400);
  // Comments on a file, and feedback requests ("listen by Friday: is the vocal too loud?")
  const cq = '/api/comments?space=view&path=bounce.wav';
  const plain = JSON.parse((await call('carol', cq, 'POST', { text: 'kick is great at 0:12', t: 12 })).text);
  check('a timestamped comment is kept', plain.t === 12 && plain.user === 'carol');
  check(
    'a feedback request needs someone who can open the file',
    (await call('alice', cq, 'POST', { text: 'thoughts?', ask: { to: ['mallory', 'alice'] } })).status === 400,
  );
  const ask = JSON.parse(
    (
      await call('alice', cq, 'POST', {
        text: 'Is the vocal too loud at the chorus?',
        ask: { to: ['bob', 'carol', 'mallory', 'alice'], due: '2026-12-01' },
      })
    ).text,
  );
  check(
    'feedback request goes to the right people only',
    ask.ask?.to.join() === 'bob,carol' && ask.ask.due === '2026-12-01',
    JSON.stringify(ask),
  );
  const bobNotes = JSON.parse((await call('bob', '/api/projects?notifications')).text);
  check(
    'the people asked are notified, with a link to the file',
    bobNotes.some((n) => /asks for your ears on bounce\.wav/.test(n.text) && n.open?.space === 'view' && n.open?.name === 'bounce.wav'),
    JSON.stringify(bobNotes.slice(-2)),
  );
  check('only people asked can mark it listened', (await call('alice', `${cq}&heard&id=${ask.id}`, 'POST')).status === 404);
  const heardByBob = JSON.parse((await call('bob', `${cq}&heard&id=${ask.id}`, 'POST')).text);
  check('listening is recorded', !!heardByBob.ask.heard.bob && !heardByBob.ask.heard.carol);
  const thread = JSON.parse((await call('carol', cq)).text);
  check(
    'everyone on the file sees the request and who listened',
    thread.some((c) => c.id === ask.id && c.ask.heard.bob),
  );
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

  // CITIES (the blog): public reading, members' drafts, admin publishing, drafts hidden, feeds limited to public websites
  check('blog reads without an account', (await fetch(B + '/api/blog')).status === 200);
  check('CITIES page is public', (await fetch(B + '/cities')).status === 200 && (await fetch(B + '/cities/abc123')).status === 200);
  const oldLink = await fetch(B + '/blog/abc123?x=1', { redirect: 'manual' });
  check('old /blog links forward to /cities', oldLink.status === 301 && oldLink.headers.get('location') === '/cities/abc123?x=1');
  check('the writing page needs no account to load', (await fetch(B + '/write')).status === 200);
  check('but drafts need a sign-in', (await call(null, '/api/blog/mine')).status === 401);
  const bobDraft = JSON.parse((await call('bob', '/api/blog/posts', 'POST', { title: 'Lyric', line: 'heart', kind: 'profile' })).text);
  check('members can start a draft', bobDraft.owner === 'bob' && bobDraft.kind === 'profile' && !bobDraft.published);
  await call('bob', `/api/blog/posts/${bobDraft.id}`, 'PATCH', { published: true, preface: 'Singing since she was two.', line: 'nope' });
  const bobMine = JSON.parse((await call('bob', '/api/blog/mine')).text);
  check(
    'members cannot publish, and a bad section falls back to Heart',
    bobMine.length === 1 && !bobMine[0].published && bobMine[0].line === 'heart' && bobMine[0].preface === 'Singing since she was two.',
  );
  check('others only see their own drafts', JSON.parse((await call('carol', '/api/blog/mine')).text).length === 0);
  check(
    "members cannot touch someone else's draft",
    (await call('carol', `/api/blog/posts/${bobDraft.id}`, 'PATCH', { title: 'x' })).status === 403,
  );
  check('members cannot manage writers', (await call('bob', '/api/blog/feeds', 'POST', { url: 'boroma' })).status === 403);
  check('members cannot read the admin list', (await call('bob', '/api/blog/admin')).status === 403);
  await call('bob', `/api/blog/posts/${bobDraft.id}`, 'PATCH', { submitted: true });
  check(
    'sending a draft in tells the admins',
    JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) => /bob sent a draft for CITIES: "Lyric"/.test(n.text)),
  );
  await call('alice', `/api/blog/posts/${bobDraft.id}`, 'PATCH', { published: true });
  check(
    "admins publish members' drafts",
    (await (await fetch(B + '/api/blog')).json()).posts.some((p) => p.id === bobDraft.id),
  );
  check(
    'a published post is locked for its writer',
    (await call('bob', `/api/blog/posts/${bobDraft.id}`, 'PATCH', { title: 'x' })).status === 403,
  );
  const shared = await (await fetch(B + '/cities/lyric')).text();
  check(
    'a shared post link shows its title and preface',
    shared.includes('<meta property="og:title" content="Lyric · CITIES" />') &&
      shared.includes('<meta property="og:description" content="Singing since she was two." />'),
  );
  check(
    'section pages have their own title',
    (await (await fetch(B + '/cities/heart')).text()).includes('<title>Heart of the Cities · CITIES</title>'),
  );
  const heartTitled = JSON.parse((await call('alice', '/api/blog/posts', 'POST', { title: 'Heart' })).text);
  await call('alice', `/api/blog/posts/${heartTitled.id}`, 'PATCH', { published: true });
  check(
    'a post called "Heart" does not take over /cities/heart',
    JSON.parse((await call('alice', '/api/blog/admin')).text).posts.find((p) => p.id === heartTitled.id).slug !== 'heart',
  );
  await call('alice', `/api/blog/posts/${heartTitled.id}`, 'DELETE');
  const vids = await fetch(B + '/api/blog/videos');
  check('videos read without an account', vids.status === 200 && Array.isArray((await vids.json()).videos));
  check(
    'a channel needs a channel link or handle',
    (await call('alice', '/api/blog/channels', 'POST', { url: 'not a channel!' })).status === 400,
  );
  const draft = JSON.parse(
    (await call('alice', '/api/blog/posts', 'POST', { title: 'Why culture', body: 'First line.\n\nSecond https://example.com' })).text,
  );
  check('drafts stay hidden', !(await (await fetch(B + '/api/blog')).json()).posts.some((p) => p.id === draft.id));
  check('draft post page is not public', (await fetch(B + `/api/blog/post/${draft.id}`)).status === 404);
  await call('alice', `/api/blog/posts/${draft.id}`, 'PATCH', { published: true });
  const publicPosts = (await (await fetch(B + '/api/blog')).json()).posts;
  check(
    'published post gets a readable address',
    publicPosts.some((p) => p.id === draft.id && p.source === 'sanktuary' && p.url === '/cities/why-culture'),
  );
  check('post readable by its address', (await (await fetch(B + '/api/blog/post/why-culture')).json()).title === 'Why culture');
  check('two-part blog addresses load the page', (await fetch(B + '/cities/boroma/what-does-change-look-like')).status === 200);
  const notesWall = await fetch(B + '/api/blog/notes');
  check('notes wall reads without an account', notesWall.status === 200 && Array.isArray((await notesWall.json()).notes));
  const titledNotes = JSON.parse((await call('alice', '/api/blog/posts', 'POST', { title: 'Notes', body: 'x' })).text);
  await call('alice', `/api/blog/posts/${titledNotes.id}`, 'PATCH', { published: true });
  check(
    'a post called "Notes" does not take over /cities/notes',
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
  check(
    'finding streaming links needs an https link',
    (await call('alice', `/api/tracks/release/${ep.id}?links`, 'POST', { url: 'http://example.com/album' })).status === 400,
  );
  const found = JSON.parse(
    (await call('alice', `/api/tracks/release/${ep.id}?links`, 'POST', { url: 'https://soundcloud.com/bob-music/open' })).text,
  );
  check(
    "streaming links fill the release and its artist's empty profile links",
    found.stores.soundcloud === 'https://soundcloud.com/bob-music/open' &&
      found.profile?.username === 'bob' &&
      JSON.parse((await call('bob', '/api/profiles')).text).find((u) => u.username === 'bob').audiomack ===
        'https://audiomack.com/bob-music',
  );
  check(
    'profile links already there are kept',
    JSON.parse((await call('alice', `/api/tracks/release/${ep.id}?links`, 'POST', { url: 'https://soundcloud.com/bob-music/open' })).text)
      .profile === null,
  );
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
  // Campaign entries for a private release are private from the moment they're made, and its owner still sees them
  const single = JSON.parse(
    (await call('bob', '/api/timeline', 'POST', { title: 'Single 1: Unreleased', kind: 'Drop', start: day(20), release: album.id })).text,
  );
  const sees = async (u) => JSON.parse((await call(u, '/api/timeline')).text).items.some((i) => i.id === single.id);
  check(
    'a private release’s timeline entry is private from the start',
    !(await sees('carol')) && (await sees('alice')) && (await sees('bob')),
  );
  check(
    'entries can only be tied to a release you can see',
    (await call('carol', '/api/timeline', 'POST', { title: 'x', start: day(20), release: album.id })).status === 404,
  );
  const openShoot = JSON.parse((await call('bob', '/api/timeline', 'POST', { title: 'Open shoot', start: day(21), public: true })).text);
  const moved = JSON.parse((await call('bob', `/api/timeline/${openShoot.id}`, 'PATCH', { release: album.id })).text);
  check('moving an entry onto a private release makes it private and not public', !!moved.members && moved.public === false);
  const onEp = JSON.parse((await call('bob', '/api/timeline', 'POST', { title: 'EP video', start: day(22), release: ep.id })).text);
  check('entries tied to an open release stay open to everyone', onEp.members === null);

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
  check('only admins add the Minnesota funders', (await call('bob', '/api/opportunities?starter', 'POST')).status === 403);
  const starter = JSON.parse((await call('alice', '/api/opportunities?starter', 'POST')).text);
  const starter2 = JSON.parse((await call('alice', '/api/opportunities?starter', 'POST')).text);
  const funders = JSON.parse((await call('carol', '/api/opportunities')).text).items.filter(
    (o) => o.title === 'Metropolitan Regional Arts Council',
  );
  check(
    'Minnesota funders are added once, with https links and a checklist',
    starter.added === 6 &&
      starter2.added === 0 &&
      funders.length === 1 &&
      /^https:\/\//.test(funders[0].link) &&
      /Application checklist/.test(funders[0].notes),
  );
  await call('alice', `/api/opportunities/${funders[0].id}`, 'DELETE');
  check('a funder you took down stays down', JSON.parse((await call('alice', '/api/opportunities?starter', 'POST')).text).added === 0);

  // Outreach: shared pitch list, 7-day follow-up reminder to whoever pitched
  check('outreach is for members only', (await fetch(B + '/api/outreach')).status === 401);
  check('an outreach contact needs a name', (await call('bob', '/api/outreach', 'POST', { kind: 'Radio' })).status === 400);
  check(
    'outreach links must be https',
    (await call('bob', '/api/outreach', 'POST', { name: 'X', link: 'javascript:alert(1)' })).status === 400,
  );
  check('outreach emails must look real', (await call('bob', '/api/outreach', 'POST', { name: 'X', email: 'nope' })).status === 400);
  const radio = JSON.parse(
    (await call('bob', '/api/outreach', 'POST', { name: 'DJ Sam', outlet: 'Radio K', kind: 'Radio', email: 'sam@radiok.example' })).text,
  );
  check('a member adds a contact', radio.status === 'To pitch' && radio.by === 'bob');
  const pitched = JSON.parse((await call('bob', `/api/outreach/${radio.id}`, 'PATCH', { status: 'Pitched' })).text);
  check(
    'marking Pitched records who and when',
    pitched.pitchedBy === 'bob' && pitched.pitchedAt === new Date().toLocaleDateString('en-CA'),
  );
  check(
    'a refused change leaves the contact as it was',
    (await call('carol', `/api/outreach/${radio.id}`, 'PATCH', { email: 'bad', notes: 'x' })).status === 400 &&
      JSON.parse((await call('bob', '/api/outreach')).text).items.find((o) => o.id === radio.id).notes === '',
  );
  check(
    'a pitch date cannot be in the future',
    (await call('bob', `/api/outreach/${radio.id}`, 'PATCH', { pitchedAt: '2999-01-01' })).status === 400,
  );
  const weekAgo = new Date(Date.now() - 8 * 864e5).toLocaleDateString('en-CA');
  await call('bob', `/api/outreach/${radio.id}`, 'PATCH', { pitchedAt: weekAgo });
  await call('bob', `/api/outreach/${radio.id}`, 'PATCH', { notes: 'sent the single' }); // no second reminder
  await call('bob', `/api/outreach/${radio.id}`, 'PATCH', { pitchedAt: weekAgo }); // same day saved again: still none
  const followUpNotes = JSON.parse((await call('bob', '/api/projects?notifications')).text).filter((n) =>
    /Follow up with DJ Sam \(Radio K\)/.test(n.text),
  );
  check('no reply after a week: whoever pitched is reminded once', followUpNotes.length === 1);
  // Ids from the address never reach JavaScript's shared prototype ("__proto__", "constructor")
  const polluters = [
    ['bob', '/api/outreach/__proto__', { name: 'x', status: 'Yes' }],
    ['bob', '/api/outreach/constructor', { name: 'x' }],
    ['bob', '/api/tracks/release/__proto__', { title: 'x' }],
    ['bob', '/api/tracks/track/__proto__', { title: 'x' }],
    ['bob', '/api/opportunities/__proto__', { status: 'interested' }],
    ['alice', '/api/opportunities/__proto__', { title: 'x' }],
    ['bob', '/api/timeline/__proto__', { title: 'x' }],
    ['alice', '/api/stories/__proto__', { title: 'x' }],
    ['alice', '/api/links/__proto__', undefined, 'DELETE'],
  ];
  const pollution = [];
  for (const [u, path, body, method = 'PATCH'] of polluters) pollution.push((await call(u, path, method, body)).status);
  check(
    '"__proto__" and "constructor" ids are just not found',
    pollution.every((s) => s === 404),
    pollution.join(),
  );
  check('the server is fine afterwards', JSON.parse((await call('bob', '/api/outreach')).text).items.length > 0);

  // Favourite folders: per person, saved on the server, only for spaces they can still see
  const favSaved = await call('bob', '/api/me', 'PUT', {
    favorites: [
      { space: 'up', path: 'docs', name: 'docs', spaceName: 'Up' },
      { space: 'secret-space', path: 'x', name: 'x' },
    ],
  });
  check('favourites are saved', favSaved.status === 200);
  check(
    'favourites come back with your account, minus spaces you cannot see',
    JSON.stringify(JSON.parse((await call('bob', '/api/me')).text).favorites) ===
      JSON.stringify([{ space: 'up', path: 'docs', name: 'docs', spaceName: 'Up' }]),
  );
  check('favourites are private to each person', (JSON.parse((await call('carol', '/api/me')).text).favorites || []).length === 0);
  check(
    'a favourite cannot point outside a space',
    (await call('bob', '/api/me', 'PUT', { favorites: [{ space: 'up', path: 'docs/../../etc' }] })).status === 400,
  );
  check('only whoever added it or an admin removes it', (await call('carol', `/api/outreach/${radio.id}`, 'DELETE')).status === 403);
  check(
    'removed contacts disappear',
    (await call('alice', `/api/outreach/${radio.id}`, 'DELETE')).status === 200 &&
      !JSON.parse((await call('bob', '/api/outreach')).text).items.some((o) => o.id === radio.id),
  );

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

  // The label side: UPC with its check digit, master splits signed off in the app, readiness before release
  check('UPC: a typo in the check digit is caught', (await call('alice', epUrl, 'PATCH', { upc: '036000291453' })).status === 400);
  check(
    'UPC: a real one is kept',
    JSON.parse((await call('alice', epUrl, 'PATCH', { upc: '0 36000 29145 2' })).text).upc === '036000291452',
  );
  const splitsV1 = [
    { name: 'Bob B', role: 'Artist', share: 50, member: 'bob' },
    { name: 'Sanktuary', role: 'Label', share: 50 },
  ];
  await call('alice', openingUrl, 'PATCH', { master: splitsV1, explicit: false, regs: { mlc: '2026-10-01', madeUp: '2026-10-01' } });
  const openingNow = () => call('alice', '/api/tracks').then((r) => JSON.parse(r.text).tracks.find((x) => x.id === opening.id));
  const o1 = await openingNow();
  check('registrations: only known ones kept', o1.regs.mlc === '2026-10-01' && !('madeUp' in o1.regs), JSON.stringify(o1.regs));
  check('only people on the master split can sign it off', (await call('carol', `${openingUrl}?signoff`, 'POST')).status === 403);
  check('someone on the split signs off', (await call('bob', `${openingUrl}?signoff`, 'POST')).status === 200);
  const readyUrl = `/api/tracks/release/${ep.id}?ready`;
  const song1 = (rd) => rd.checks.filter((c) => c.song?.includes('Opening'));
  let ready = JSON.parse((await call('alice', readyUrl)).text);
  check(
    'readiness: signed master splits and ISRC count as done',
    song1(ready).some((c) => c.ok && c.text === 'Master splits signed off') && song1(ready).some((c) => c.ok && c.text === 'ISRC'),
    JSON.stringify(song1(ready)),
  );
  await call('alice', openingUrl, 'PATCH', {
    master: [
      { ...splitsV1[0], share: 60 },
      { ...splitsV1[1], share: 40 },
    ],
  });
  ready = JSON.parse((await call('alice', readyUrl)).text);
  check(
    'changing the splits needs a new sign-off',
    song1(ready).some((c) => !c.ok && c.text === 'Master split sign-off from Bob B'),
    JSON.stringify(song1(ready)),
  );
  await call('alice', `/api/tracks/track/${unannounced.id}`, 'PATCH', { bmi: { isrc: 'USABC2600001' } });
  ready = JSON.parse((await call('alice', readyUrl)).text);
  check(
    'readiness: the same ISRC on two songs is caught',
    ready.checks.some((c) => !c.ok && /also on/.test(c.text)),
    JSON.stringify(ready.checks),
  );
  check(
    'readiness items say which step and song they belong to (for the guided path)',
    ready.checks.every((c) => ['artist', 'songs', 'credits', 'splits', 'artwork', 'register'].includes(c.step)) &&
      ready.checks.every((c) => !c.song || c.track === opening.id || c.track === unannounced.id),
  );
  check('readiness counts only what is due before release', ready.of > 0 && ready.ready < ready.of && ready.checks.some((c) => c.later));
  const pagedLabel = JSON.stringify(await (await fetch(B + rp)).json());
  check('splits, UPC and registrations stay off the public page', !pagedLabel.includes('036000291452') && !pagedLabel.includes('signoffs'));
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

  // Roster + "Book [artist]": booking requests only for listed members who take bookings; rates and PRO stay private
  const book = (body) => fetch(B + '/api/public/book', { method: 'POST', body: JSON.stringify(body) });
  const gigDay = new Date(Date.now() + 40 * 864e5).toLocaleDateString('en-CA');
  const req1 = { artist: 'bob', name: 'Venue Co', email: 'booker@example.com', event: 'Friday show', date: gigDay, budget: '$500' };
  check('cannot book someone who does not take bookings', (await book(req1)).status === 400);
  await call('bob', '/api/profiles/me', 'PUT', { pro: 'BMI · IPI 123456789', rates: 'Verse $300', bookable: true });
  await call('carol', '/api/profiles/me', 'PUT', { bookable: true }); // not listed publicly
  const bobPublic = (await (await fetch(B + '/api/public/directory')).json()).people.find((p) => p.username === 'bob');
  check('bookable shows on the public card', bobPublic?.bookable === true);
  check('rates and PRO never go public', !JSON.stringify(bobPublic).includes('Verse') && !JSON.stringify(bobPublic).includes('IPI'));
  check(
    'members see the roster fields',
    JSON.parse((await call('carol', '/api/profiles')).text).find((p) => p.username === 'bob')?.rates === 'Verse $300',
  );
  check('cannot book someone who is not listed publicly', (await book({ ...req1, artist: 'carol' })).status === 400);
  check('booking needs a real email', (await book({ ...req1, email: 'x' })).status === 400);
  check('booking works', (await book(req1)).status === 200);
  await book({ ...req1, name: 'Spam Bot', website: 'http://spam' });
  const bookings = JSON.parse((await call('alice', '/api/public/admin')).text).bookings;
  const b1 = bookings.find((b) => b.name === 'Venue Co');
  check(
    'booking reaches admins with its details',
    b1?.artist === 'bob' && b1.date === gigDay && b1.budget === '$500' && b1.status === 'New',
  );
  check('bots filling the hidden booking field are dropped', !bookings.some((b) => b.name === 'Spam Bot'));
  check(
    'the artist is told about the booking request',
    JSON.parse((await call('bob', '/api/projects?notifications')).text).some((n) =>
      /Booking request for Bob B from Venue Co.*team has the details/.test(n.text),
    ),
  );
  await call('alice', '/api/public/admin', 'PATCH', { booking: { id: b1.id, status: 'Confirmed' } });
  await call('alice', '/api/public/admin', 'PATCH', { booking: { id: b1.id, status: '<b>hax' } });
  check(
    'admins update booking status (known statuses only)',
    JSON.parse((await call('alice', '/api/public/admin')).text).bookings.find((b) => b.id === b1.id)?.status === 'Confirmed',
  );
  for (let i = 0; i < 6; i++) await book(req1);
  check('booking form is rate limited', (await book(req1)).status === 429);
  check(
    'the join form has its own limit',
    (await fetch(B + '/api/public/join', { method: 'POST', body: JSON.stringify({ name: 'Zed', email: 'zed@example.com' }) })).status ===
      200,
  );
  await fetch(B + '/api/public/book', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '198.51.100.7' },
    body: JSON.stringify({ ...req1, name: 'Time Traveller', date: '2020-01-01' }),
  });
  check(
    'booking dates in the past are dropped',
    JSON.parse((await call('alice', '/api/public/admin')).text).bookings.find((b) => b.name === 'Time Traveller')?.date === null,
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
  check('checkouts expire before their hold ends', Number(teeCall.form.get('expires_at')) > Date.now() / 1000 + 29 * 60);

  // Capsule drops: on sale from a set time, checkout holds so a limited drop can't oversell, The Vault
  const cap = JSON.parse((await call('alice', '/api/shop/products', 'POST', { title: 'Capsule Hoodie', price: 80, stock: 3 })).text);
  check(
    'a drop time must be a real time',
    (await call('alice', `/api/shop/products/${cap.id}`, 'PATCH', { dropAt: 'soon' })).status === 400,
  );
  const dropSoon = new Date(Date.now() + 864e5).toISOString();
  await call('alice', `/api/shop/products/${cap.id}`, 'PATCH', { active: true, dropAt: dropSoon, capsule: 'Capsule 01: TSIMY' });
  const capView = async () => (await (await fetch(B + '/api/shop')).json()).products.find((p) => p.id === cap.id);
  // each buyer from their own address (one open checkout per address per item)
  const capBuy = (qty, ip = '203.0.113.1') =>
    fetch(B + `/api/shop/${cap.slug}/buy`, { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ qty }) });
  const pre = await capView();
  check(
    'visitors see the drop time, capsule and how many are left',
    pre.dropAt === dropSoon && pre.capsule === 'Capsule 01: TSIMY' && pre.left === 3,
  );
  check('nothing sells before the drop', (await capBuy(1)).status === 409);
  await call('alice', `/api/shop/products/${cap.id}`, 'PATCH', { dropAt: new Date(Date.now() - 1000).toISOString() });
  check('the drop opens on time', (await capBuy(2, '203.0.113.1')).status === 200);
  const checkouts = () => stripeCalls.filter((c) => c.path.endsWith('/checkout/sessions'));
  const firstHold = checkouts().at(-1);
  check('an open checkout holds its items', (await capView()).left === 1);
  const oversell = await capBuy(2, '203.0.113.2');
  check('a limited drop cannot be oversold', oversell.status === 409 && /Only 1 left/.test(await oversell.text()));
  check(
    'a new checkout from the same buyer releases their last one',
    (await capBuy(1, '203.0.113.1')).status === 200 && (await capView()).left === 2,
  );
  const replacedOrder = firstHold.form.get('metadata[order]');
  await capBuy(2, '203.0.113.3');
  const heldUp = await capBuy(1, '203.0.113.4');
  check('when the rest are in checkouts, buyers are told to come back', heldUp.status === 409 && /checkouts/.test(await heldUp.text()));
  // All three checkouts get paid (the replaced one too: that money is real), 5 items of 3: the last one to arrive is flagged
  await stripeHook({
    id: 'cs_late',
    payment_status: 'paid',
    amount_total: 16000,
    customer_details: { name: 'Late', email: 'l@example.com' },
    metadata: { order: replacedOrder },
  });
  check(
    'a replaced checkout is closed at Stripe',
    stripeCalls.some((c) => /\/checkout\/sessions\/cs_test_\d+\/expire$/.test(c.path)),
  );
  const lastCalls = checkouts().slice(-2);
  const lastHolds = lastCalls.map((c) => c.form.get('metadata[order]'));
  for (const [i, order] of lastHolds.entries())
    await stripeHook({
      id: `cs_ok_${i}`,
      payment_status: 'paid',
      amount_total: 8000,
      customer_details: { name: 'B', email: 'b@example.com' },
      metadata: { order },
    });
  const capOrders = JSON.parse((await biz('alice', '/orders')).text).filter((o) => o.product === cap.id);
  check(
    'a payment that finds the stock gone is flagged Oversold, never counted as sold',
    capOrders.filter((o) => o.status === 'Paid').length === 2 && capOrders.some((o) => o.status === 'Oversold'),
    JSON.stringify(capOrders.map((o) => o.status)),
  );
  check(
    'admins are told to refund an oversold order',
    JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) => /Oversold/.test(n.text)),
  );
  const oversoldSession = `cs_test_${stripeCalls.indexOf(lastCalls[1]) + 1}`;
  check(
    'the buyer of an oversold order is told it sold out (thank-you page)',
    (await (await fetch(B + `/api/shop/order/${oversoldSession}`)).json()).oversold === true,
  );
  // Compressed IPv6 in one /64 is one buyer: the second checkout replaces the first
  const v6 = JSON.parse((await call('alice', '/api/shop/products', 'POST', { title: 'V6 Tee', price: 10, stock: 5 })).text);
  await call('alice', `/api/shop/products/${v6.id}`, 'PATCH', { active: true });
  const v6buy = (ip) => fetch(B + `/api/shop/${v6.slug}/buy`, { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: '{"qty":3}' });
  await v6buy('2001:db8::a:b:c:d');
  await v6buy('2001:db8:0:0:1:2:3:4');
  check(
    'IPv6 addresses in one /64 count as one buyer',
    (await (await fetch(B + '/api/shop')).json()).products.find((p) => p.id === v6.id).left === 2,
  );
  check('abandoned checkouts are not in the orders list', !JSON.parse((await biz('alice', '/orders')).text).some((o) => !o.paid));
  // An expired checkout gives its hold back at once
  const oneOff = JSON.parse((await call('alice', '/api/shop/products', 'POST', { title: 'One Off', price: 10, stock: 1 })).text);
  await call('alice', `/api/shop/products/${oneOff.id}`, 'PATCH', { active: true });
  await fetch(B + `/api/shop/${oneOff.slug}/buy`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' }, body: '{"qty":1}' });
  const expOrder = checkouts().at(-1).form.get('metadata[order]');
  await stripeHook({ id: 'cs_exp', metadata: { order: expOrder } }, undefined, undefined, 'checkout.session.expired');
  check(
    'an expired checkout frees its hold',
    (await (await fetch(B + '/api/shop')).json()).products.find((p) => p.id === oneOff.id).left === 1,
  );
  let limited = 0;
  for (let i = 0; i < 21; i++)
    limited = (
      await fetch(B + `/api/shop/${oneOff.slug}/buy`, {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.50' },
        body: '{"qty":1}',
      })
    ).status;
  check('checkouts are rate limited per address', limited === 429);
  check(
    'plenty in stock: visitors are not told the exact number',
    (await (await fetch(B + '/api/shop')).json()).products.every((p) => p.left === null || p.left <= 10),
  );
  await call('alice', `/api/shop/products/${cap.id}`, 'PATCH', { vault: true });
  check(
    'retired pieces go to The Vault and are never sold',
    (await capView()).vault === true && (await capBuy(1, '203.0.113.7')).status === 409,
  );
  check(
    'sold-out pieces are in The Vault too',
    (await (await fetch(B + '/api/shop')).json()).products.find((p) => p.id === tee.id).vault === true,
  );
  check('The Vault page loads', (await fetch(B + '/shop?c=vault')).status === 200);

  // Revenue: distributor CSV import (row by row, never counted twice), manual lines, shop sales, statements
  check('revenue is in the business portal only', (await call('alice', '/api/business/revenue')).status === 401);
  check(
    'revenue changes need the portal too',
    (await call('alice', '/api/business/revenue?import', 'POST', 'a')).status === 401 &&
      (await biz('bob', '/revenue', 'POST', { amount: 1 })).status === 403,
  );
  const revRel = JSON.parse((await call('alice', '/api/tracks/release', 'POST', { title: 'Revenue EP', kind: 'EP' })).text);
  const revSong = JSON.parse((await call('alice', '/api/tracks/track', 'POST', { release: revRel.id, title: 'Money Song' })).text);
  await call('alice', `/api/tracks/track/${revSong.id}`, 'PATCH', {
    bmi: { isrc: 'USXYZ2600009' },
    master: [
      { name: 'HIMA', role: 'Artist', share: 50, member: '' },
      { name: 'Sanktuary', role: 'Label', share: 50, member: '' },
    ],
  });
  const thisYear = new Date().getFullYear();
  const header =
    'Reporting Date\tSale Month\tStore\tArtist\tTitle\tISRC\tUPC\tQuantity\tTeam Percentage\tSong/Album\tCountry of Sale\tSongwriter Royalties Withheld\tEarnings (USD)';
  const rowsV1 = [
    `${thisYear}-03-05\t${thisYear}-01\tSpotify\tHIMA\tMoney Song\tUS-XYZ-26-00009\t\t1000\t100\tSong\tUS\t0\t3.50`,
    `${thisYear}-03-05\t${thisYear}-01\tSpotify\tHIMA\tMoney Song\tUS-XYZ-26-00009\t\t500\t100\tSong\tCA\t0\t1.50`,
    `${thisYear}-03-05\t${thisYear}-01\tApple Music\tHIMA\t"Other, Song"\t\t\t10\t100\tSong\tUS\t0\t0.25`,
  ];
  const period0 = `/revenue?from=${thisYear}-01-01&to=${thisYear}-12-31`;
  const importCsv = async (lines) =>
    JSON.parse((await biz('alice', '/revenue?import', 'POST', '﻿' + [header, ...lines].join('\r\n'), {}, true)).text);
  const imp = await importCsv(rowsV1);
  check(
    'distributor rows become one line per song, month and store',
    imp.added === 2 && imp.rows === 3 && imp.unmatched === 1,
    JSON.stringify(imp),
  );
  const imp2 = await importCsv(rowsV1);
  check('importing the same file again adds nothing', imp2.added === 0 && imp2.skipped === 3);
  // The next download has the whole history plus late earnings for January: only the new row is added
  const imp3 = await importCsv([
    ...rowsV1,
    `${thisYear}-04-05\t${thisYear}-01\tSpotify\tHIMA\tMoney Song\tUS-XYZ-26-00009\t\t160\t100\tSong\tUS\t0\t0.80`,
  ]);
  check('late earnings for an old month are added, not lost', imp3.added === 1 && imp3.rows === 1 && imp3.skipped === 3);
  const odd = await biz(
    'alice',
    '/revenue?import',
    'POST',
    [header, `x\t${thisYear}-01\tSpotify\tA\tT\t\t\t1\t100\tSong\tUS\t0\t1,2,3`].join('\n'),
    {},
    true,
  );
  check('an unreadable amount stops the import (nothing half-imported)', odd.status === 400 && /row 2/.test(odd.text));
  check(
    'absurd amounts (1e400, a billion on one row) stop the import',
    (await biz('alice', '/revenue?import', 'POST', `Sale Month,Title,Earnings (USD)\n${thisYear}-01,T,1e400`, {}, true)).status === 400 &&
      (await biz('alice', '/revenue?import', 'POST', `Sale Month,Title,Earnings (USD)\n${thisYear}-01,T,2000000000`, {}, true)).status ===
        400,
  );
  // Per-stream earnings are fractions of a cent: 1000 rows of $0.0041 are $4.10, not 0
  const tiny = JSON.parse(
    (
      await biz(
        'alice',
        '/revenue?import',
        'POST',
        [
          'Sale Month,Store,Title,Earnings (USD)',
          ...Array.from({ length: 1000 }, (_, i) => `${thisYear}-03,Store${i % 3},Tiny Song,0.0041`),
        ].join('\n'),
        {},
        true,
      )
    ).text,
  );
  const tinyLines = JSON.parse((await biz('alice', period0)).text).lines.filter((l) => l.batch === tiny.batch);
  check(
    'fractions of a cent add up',
    Math.round(tinyLines.reduce((n, l) => n + l.amount, 0) * 100) === 410,
    JSON.stringify(tinyLines.map((l) => l.amount)),
  );
  const tinyRev = JSON.parse((await biz('alice', period0)).text);
  const streamed = JSON.parse((await biz('alice', period0)).text).lines.filter((l) => l.source === 'Streaming');
  check(
    '"where it came from" adds up exactly like the totals',
    tinyRev.bySource['income:Streaming'] === Math.round(streamed.reduce((n, l) => n + Math.round(l.amount * 1e6), 0) / 1e4) / 100,
    JSON.stringify(tinyRev.bySource),
  );
  await biz('alice', `/revenue?batch=${tiny.batch}`, 'DELETE');
  // Excel in Europe writes tiny values as 4,1E-05; with a currency sign too
  const euSci = JSON.parse(
    (
      await biz(
        'alice',
        '/revenue?import',
        'POST',
        `Month;Title;Amount\n${thisYear}-03;Sci EU;4,1E-05\n${thisYear}-03;Sci EU;€2,5E+00`,
        {},
        true,
      )
    ).text,
  );
  const euSciLine = JSON.parse((await biz('alice', period0)).text).lines.find((l) => l.batch === euSci.batch);
  check(
    'scientific notation with a decimal comma or currency is read right',
    Math.abs(euSciLine?.amount - 2.500041) < 1e-9,
    JSON.stringify(euSciLine),
  );
  await biz('alice', `/revenue?batch=${euSci.batch}`, 'DELETE');
  const sci = JSON.parse(
    (
      await biz(
        'alice',
        '/revenue?import',
        'POST',
        `Sale Month,Store,Title,Earnings (USD)
${thisYear}-03,Spotify,Sci Song,4.1E-05
${thisYear}-03,Spotify,Sci Song,2.5`,
        {},
        true,
      )
    ).text,
  );
  const sciLine = JSON.parse((await biz('alice', period0)).text).lines.find((l) => l.batch === sci.batch);
  check(
    "Excel's scientific notation (4.1E-05) is a tiny amount, not a debt",
    Math.abs(sciLine?.amount - 2.500041) < 1e-9,
    JSON.stringify(sciLine),
  );
  await biz('alice', `/revenue?batch=${sci.batch}`, 'DELETE');
  const cents3 = JSON.parse(
    (
      await biz(
        'alice',
        '/revenue?import',
        'POST',
        `Month;Title;Amount
${thisYear}-03;Comma Song;0,123
${thisYear}-03;Comma Song;0,456`,
        {},
        true,
      )
    ).text,
  );
  const c3 = JSON.parse((await biz('alice', period0)).text).lines.find((l) => l.batch === cents3.batch);
  check('"0,123" in a European file is 12 cents, not $123', c3?.amount === 0.579, JSON.stringify(c3));
  await biz('alice', `/revenue/${c3.id}`, 'DELETE');
  check(
    'a single removed line can be imported again',
    JSON.parse(
      (
        await biz(
          'alice',
          '/revenue?import',
          'POST',
          `Month;Title;Amount
${thisYear}-03;Comma Song;0,123
${thisYear}-03;Comma Song;0,456`,
          {},
          true,
        )
      ).text,
    ).rows === 2,
  );
  await biz(
    'alice',
    `/revenue?batch=${JSON.parse((await biz('alice', period0)).text).lines.find((l) => /Comma Song/.test(l.note)).batch}`,
    'DELETE',
  );
  const euro = JSON.parse(
    (
      await biz(
        'alice',
        '/revenue?import',
        'POST',
        `Month;Store;Title;Amount\n${thisYear}-02;Deezer;Money Song;1.234,50\n"Jul ${thisYear}";Tidal;Money Song;(0,50)`,
        {},
        true,
      )
    ).text,
  );
  check('European numbers, semicolons, month names and (negative) amounts read right', euro.added === 2, JSON.stringify(euro));
  check(
    'a file without earnings and month columns is refused',
    (await biz('alice', '/revenue?import', 'POST', 'a,b\n1,2', {}, true)).status === 400,
  );
  await biz('alice', `/revenue?batch=${euro.batch}`, 'DELETE');
  check(
    'manual lines need a known source and a positive amount',
    (await biz('alice', '/revenue', 'POST', { date: `${thisYear}-02-01`, type: 'cost', source: 'Yachts', amount: 5 })).status === 400 &&
      (await biz('alice', '/revenue', 'POST', { date: `${thisYear}-02-01`, type: 'cost', source: 'Recording', amount: -5 })).status === 400,
  );
  check(
    'shop sales cannot be typed in too (they count by themselves)',
    (await biz('alice', '/revenue', 'POST', { date: `${thisYear}-02-01`, type: 'income', source: 'Shop', amount: 5 })).status === 400,
  );
  await biz('alice', '/revenue', 'POST', { date: `${thisYear}-02-01`, type: 'cost', source: 'Recording', amount: 2, release: revRel.id });
  await biz('alice', '/revenue', 'POST', {
    date: `${thisYear}-02-10`,
    type: 'income',
    source: 'Tickets',
    amount: 10.5,
    release: revRel.id,
  });
  const period = `/revenue?from=${thisYear}-01-01&to=${thisYear}-12-31`;
  const epRev = JSON.parse((await biz('alice', period)).text).releases.find((r) => r.id === revRel.id);
  check(
    'a release statement: income, costs, net, split by its master splits',
    epRev?.income === 16.3 && epRev.costs === 2 && epRev.net === 14.3 && epRev.parties.find((p) => p.name === 'HIMA')?.amount === 7.15,
    JSON.stringify(epRev),
  );
  // A second song that's all X's and earned nothing: X only shares in the release-wide money (the tickets)
  const xSong = JSON.parse((await call('alice', '/api/tracks/track', 'POST', { release: revRel.id, title: 'X Song' })).text);
  await call('alice', `/api/tracks/track/${xSong.id}`, 'PATCH', { master: [{ name: 'X', role: 'Artist', share: 100, member: '' }] });
  const ep2 = JSON.parse((await biz('alice', period)).text).releases.find((r) => r.id === revRel.id);
  const partsSum = Math.round(ep2.parties.reduce((n, p) => n + p.amount * 100, 0));
  const xPart = ep2.parties.find((p) => p.name === 'X');
  check(
    "each song's earnings follow that song's splits, and the parts add up to the cent",
    partsSum === 1430 && xPart && Math.abs(xPart.amount - (14.3 * (10.5 * 0.5)) / 16.3) < 0.011,
    JSON.stringify(ep2.parties),
  );
  const rev = JSON.parse((await biz('alice', period)).text);
  check('paid shop orders count as income by themselves', rev.bySource['income:Shop'] > 0 && rev.shopOrders >= 2);
  await biz('alice', '/revenue', 'POST', { date: `${thisYear}-02-11`, type: 'cost', source: 'Marketing', amount: 100, release: revRel.id });
  const lossy = JSON.parse((await biz('alice', period)).text).releases.find((r) => r.id === revRel.id);
  check(
    'a loss pays nobody and shows what is still to recoup',
    lossy.net < 0 && lossy.toRecoup === 85.7 && lossy.parties.every((p) => p.amount === 0),
    JSON.stringify(lossy),
  );
  const undo = JSON.parse((await biz('alice', `/revenue?batch=${imp.batch}`, 'DELETE')).text);
  check('an import can be undone as a whole', undo.removed === 2);
  check('once undone, its rows can be imported again', (await importCsv(rowsV1)).rows === 3);
  check('revenue lines ids cannot reach the prototype', (await biz('alice', '/revenue/__proto__', 'DELETE')).status === 404);

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

  // YouTube: admins connect the channel (Google's consent screen), then post videos from the drive in the background
  const noFollow = (u, path) => fetch(B + path, { headers: { cookie: cookie(u) }, redirect: 'manual' });
  check('only admins use YouTube', (await call('bob', '/api/youtube')).status === 403);
  const yt0 = JSON.parse((await call('alice', '/api/youtube')).text);
  check('YouTube shows as set up but not connected', yt0.configured === true && yt0.connected === false);
  const consent = await noFollow('alice', '/api/youtube/connect');
  const to = new URL(consent.headers.get('location'));
  check(
    'connecting goes to Google with an offline, upload-only request',
    consent.status === 302 &&
      to.origin === 'http://127.0.0.1:3192' &&
      to.searchParams.get('access_type') === 'offline' &&
      /youtube\.upload/.test(to.searchParams.get('scope')),
  );
  const state = to.searchParams.get('state');
  check(
    'a made-up state is refused',
    /failed/.test((await noFollow('alice', `/api/youtube/callback?state=nope&code=good`)).headers.get('location')),
  );
  check(
    'someone else cannot use your state',
    /failed/.test((await noFollow('bob', `/api/youtube/callback?state=${state}&code=good`)).headers.get('location')),
  );
  const consent2 = new URL((await noFollow('alice', '/api/youtube/connect')).headers.get('location')).searchParams.get('state');
  check(
    'the channel connects',
    /connected/.test((await noFollow('alice', `/api/youtube/callback?state=${consent2}&code=good`)).headers.get('location')),
  );
  check(
    'a state works only once',
    /failed/.test((await noFollow('alice', `/api/youtube/callback?state=${consent2}&code=good`)).headers.get('location')),
  );
  const yt1 = JSON.parse((await call('alice', '/api/youtube')).text);
  check(
    'the channel name shows, the token never does',
    yt1.connected && yt1.channel?.title === 'Sanktuary TV' && !JSON.stringify(yt1).includes('rt1'),
  );
  writeFileSync(join(drive, 'team', 'promo.mp4'), Buffer.alloc(20000, 7));
  writeFileSync(join(drive, 'team', 'notes.txt'), 'x');
  check(
    'only videos go to YouTube',
    (await call('alice', '/api/youtube/upload', 'POST', { space: 'up', path: 'notes.txt' })).status === 400,
  );
  check(
    'paths stay inside the space',
    (await call('alice', '/api/youtube/upload', 'POST', { space: 'up', path: '../../x.mp4' })).status === 400,
  );
  const ytRel = JSON.parse((await call('alice', '/api/tracks/release', 'POST', { title: 'Video EP', kind: 'EP' })).text);
  const ytJob = await call('alice', '/api/youtube/upload', 'POST', {
    space: 'up',
    path: 'promo.mp4',
    title: 'Promo <b>',
    privacy: 'unlisted',
    release: ytRel.id,
  });
  check('an upload starts in the background', ytJob.status === 202);
  for (let i = 0; i < 40 && JSON.parse((await call('alice', '/api/youtube')).text).jobs[0]?.status === 'Uploading'; i++)
    await new Promise((r) => setTimeout(r, 100));
  const done = JSON.parse((await call('alice', '/api/youtube')).text).jobs[0];
  const put = ytCalls.find((c) => c.path === '/upload-session/1');
  check(
    'the whole file reaches YouTube',
    done?.status === 'Done' && done.url === 'https://youtu.be/abcdefghijk' && put?.size === 20000,
    JSON.stringify(done),
  );
  check('titles lose < and >', /"title":"Promo b"/.test(ytCalls.find((c) => c.path.startsWith('/upload?'))?.body || ''));
  const relNow = JSON.parse((await call('alice', '/api/tracks')).text).releases.find((r) => r.id === ytRel.id);
  check('the video goes on its release', relNow?.videoId === 'abcdefghijk');
  check(
    'release video links are checked',
    (await call('alice', `/api/tracks/release/${ytRel.id}`, 'PATCH', { video: 'https://evil.example/watch?v=abcdefghijk' })).status ===
      400 &&
      JSON.parse((await call('alice', `/api/tracks/release/${ytRel.id}`, 'PATCH', { video: 'https://youtu.be/ZYXWVUTSRQP?t=3' })).text)
        .videoId === 'ZYXWVUTSRQP',
  );
  check(
    'the uploader is told',
    JSON.parse((await call('alice', '/api/projects?notifications')).text).some((n) => /youtu\.be\/abcdefghijk/.test(n.text)),
  );
  check(
    'disconnecting forgets the channel',
    (await call('alice', '/api/youtube', 'DELETE')).status === 200 && !JSON.parse((await call('alice', '/api/youtube')).text).connected,
  );

  // Mailing list: double opt-in, one-click unsubscribe, the postal address, drips and broadcasts
  const mailSub = (body, ip = '198.51.100.20') =>
    fetch(B + '/api/mail/subscribe', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
  check('the list is open when email is set up', (await (await fetch(B + '/api/mail')).json()).open === true);
  check('signing up needs the consent box', (await mailSub({ email: 'fan@example.com' })).status === 400);
  check('signing up needs a real email', (await mailSub({ email: 'nope', consent: true })).status === 400);
  await mailSub({ email: 'bot@example.com', consent: true, website: 'x' });
  check('bots filling the hidden field get no email', !mails.some((m) => m.to[0] === 'bot@example.com'));
  check('only admins manage the list', (await call('bob', '/api/mail/admin')).status === 403);
  check(
    'every email needs a subject; days 0 to 365',
    (await call('alice', '/api/mail/sequence', 'PUT', { sequence: [{ day: 400, subject: 'x' }] })).status === 400 &&
      (await call('alice', '/api/mail/sequence', 'PUT', { sequence: [{ day: 0, subject: '' }] })).status === 400,
  );
  await call('alice', '/api/mail/sequence', 'PUT', {
    sequence: [
      { day: 0, subject: 'Welcome\r\nBcc: evil@example.com', body: 'Hi {name}, here are your guides: <script>x</script>' },
      { day: 3, subject: 'Day three', body: 'later' },
    ],
  });
  check(
    'a broadcast waits for the postal address',
    (await call('alice', '/api/mail/broadcast', 'POST', { subject: 'News', body: 'hi' })).status === 400,
  );
  await call('alice', '/api/mail/settings', 'PATCH', { address: 'Sanktuary, 123 Main St, Minneapolis MN' });
  check('signing up works', (await mailSub({ email: 'Fan@Example.com', name: 'Ama', consent: true, source: 'popup' })).status === 200);
  const confirmMail = mails.find((m) => m.to[0] === 'fan@example.com');
  const confirmLink = confirmMail?.text.match(/\/api\/mail\/confirm\?token=[\w-]+/)?.[0];
  check(
    'a confirmation email goes out first (no welcome yet)',
    !!confirmLink && mails.filter((m) => m.to[0] === 'fan@example.com').length === 1,
  );
  await mailSub({ email: 'fan@example.com', consent: true });
  check('signing up twice in a row sends one email', mails.filter((m) => m.to[0] === 'fan@example.com').length === 1);
  check(
    'the same answer whether or not someone is on the list',
    (await mailSub({ email: 'fan@example.com', consent: true }, '198.51.100.21')).status === 200,
  );
  const confirmed = await fetch(B + confirmLink);
  check('the confirm link says so', confirmed.status === 200 && /You(&#39;|')re in/.test(await confirmed.text()));
  await new Promise((r) => setTimeout(r, 900));
  const welcome = mails.find((m) => m.to[0] === 'fan@example.com' && /^Welcome/.test(m.subject));
  check('the day-0 email follows the confirmation', !!welcome && !mails.some((m) => m.subject === 'Day three'));
  check('subjects cannot add headers', welcome && !/[\r\n]/.test(welcome.subject));
  check(
    "the reader's name is filled in, and HTML in emails is escaped",
    /Hi Ama/.test(welcome?.text) && !welcome?.html.includes('<script>'),
  );
  check(
    'every email has the unsubscribe link, the one-click header and the postal address',
    /unsubscribe\?id=/.test(welcome?.text) &&
      /Minneapolis/.test(welcome?.text) &&
      welcome?.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
  );
  const unsubUrl = welcome.headers['List-Unsubscribe'].slice(1, -1).replace(/^https?:\/\/[^/]+/, B);
  const unsubPage = await fetch(unsubUrl);
  check(
    'opening the unsubscribe link only asks (link scanners never unsubscribe anyone)',
    /Unsubscribe\?/.test(await unsubPage.text()) && JSON.parse((await call('alice', '/api/mail/admin')).text).counts.confirmed === 1,
  );
  check('a forged unsubscribe link does nothing', /broken/.test(await (await fetch(unsubUrl.replace(/sig=[\w-]+/, 'sig=forged'))).text()));
  check('prototype ids too', /broken/.test(await (await fetch(B + '/api/mail/unsubscribe?id=__proto__&sig=x', { method: 'POST' })).text()));
  const test = JSON.parse(
    (await call('alice', '/api/mail/broadcast', 'POST', { subject: 'News', body: 'hi', testTo: 'me@example.com' })).text,
  );
  check(
    'a test email goes only to the test address',
    test.test && mails.at(-1).to[0] === 'me@example.com' && /^\[Test\]/.test(mails.at(-1).subject),
  );
  await mailSub({ email: 'second@example.com', consent: true }, '198.51.100.22'); // pending: never confirmed
  const b = JSON.parse((await call('alice', '/api/mail/broadcast', 'POST', { subject: 'Big news', body: 'hi all' })).text);
  await new Promise((r) => setTimeout(r, 900));
  check(
    'a broadcast goes only to confirmed people',
    b.to === 1 &&
      mails
        .filter((m) => m.subject === 'Big news')
        .map((m) => m.to[0])
        .join() === 'fan@example.com',
  );
  await fetch(unsubUrl, { method: 'POST' });
  check('one-click unsubscribe works', JSON.parse((await call('alice', '/api/mail/admin')).text).counts.unsubscribed === 1);
  const who = JSON.parse((await call('alice', '/api/mail/admin')).text).subscribers.find((s) => s.email === 'second@example.com');
  check(
    'someone can be removed completely',
    (await call('alice', `/api/mail/subscribers/${who.id}`, 'DELETE')).status === 200 &&
      !JSON.parse((await call('alice', '/api/mail/admin')).text).subscribers.some((s) => s.email === 'second@example.com'),
  );

  // Video editor renders: a real ffmpeg render of a tiny clip + song + caption, and what it refuses
  const ffmpegBin = (await import(new URL('../server/node_modules/ffmpeg-static/index.js', import.meta.url))).default;
  const { spawnSync } = await import('node:child_process');
  spawnSync(ffmpegBin, [
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-y',
    join(drive, 'team', 'clip.mp4'),
  ]);
  spawnSync(ffmpegBin, ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-y', join(drive, 'team', 'beat.wav')]);
  // A clip the browser can't decode (an iPhone HEVC .mov) gets an H.264 MP4 preview copy for the editor
  spawnSync(ffmpegBin, [
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:duration=1',
    '-c:v',
    'libx265',
    '-tag:v',
    'hvc1',
    '-y',
    join(drive, 'team', 'phone.mov'),
  ]);
  const proxy = await getBin('alice', '/api/files/view/phone.mov?preview');
  const proxyInfo = spawnSync(ffmpegBin, ['-hide_banner', '-i', 'pipe:0'], { input: proxy.bytes }).stderr.toString();
  check('HEVC .mov preview is an H.264 MP4', proxy.type === 'video/mp4' && /Video: h264/.test(proxyInfo), `${proxy.status} ${proxy.type}`);
  const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const renderJob = (u, over = {}) =>
    call(u, '/api/video/render', 'POST', {
      clip: { space: 'up', path: 'clip.mp4' },
      song: { space: 'up', path: 'beat.wav' },
      songAt: 0.5,
      start: 0,
      duration: 2,
      format: '9:16',
      fit: 'duo',
      look: 'lux',
      captions: [{ start: 0, end: 1, png: PNG1 }],
      out: { space: 'up', dir: '' },
      name: 'drill edit',
      ...over,
    });
  check('renders need a login', (await fetch(B + '/api/video/render', { method: 'POST', body: '{}' })).status === 401);
  check('only known looks', (await renderJob('bob', { look: 'curves=all=0/1' })).status === 400);
  check('only known formats (prototype names too)', (await renderJob('bob', { format: '__proto__' })).status === 400);
  check(
    'captions must be PNG pictures',
    (await renderJob('bob', { captions: [{ start: 0, end: 1, png: 'data:image/png;base64,PHN2Zz4=' }] })).status === 400,
  );
  check('only videos as clips', (await renderJob('bob', { clip: { space: 'up', path: 'notes.txt' } })).status === 400);
  check('paths stay inside the space', (await renderJob('bob', { clip: { space: 'up', path: '../../x.mp4' } })).status === 400);
  check('three minutes at most', (await renderJob('bob', { duration: 500 })).status === 400);
  check(
    'the result needs a folder you can add to',
    (await renderJob('carol', { clip: { space: 'view', path: 'clip.mp4' }, song: null, out: { space: 'view', dir: '' } })).status === 403,
  );
  check('a render starts', (await renderJob('bob')).status === 202);
  let renderStatus;
  for (let i = 0; i < 300; i++) {
    renderStatus = JSON.parse((await call('bob', '/api/video')).text)[0];
    if (!['Waiting', 'Rendering'].includes(renderStatus?.status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const renderedFile = join(drive, 'team', 'drill edit.mp4');
  const renderInfo = existsSync(renderedFile) ? spawnSync(ffmpegBin, ['-hide_banner', '-i', renderedFile]).stderr.toString() : '';
  check(
    'the video renders at 1080x1920 with sound',
    renderStatus?.status === 'Done' && /1080x1920/.test(renderInfo) && /Audio: aac/.test(renderInfo),
    renderStatus?.error || renderInfo.slice(-300),
  );
  check('no half-finished files are left behind', !readdirSync(join(drive, 'team')).some((n) => n.startsWith('.sk-render-')));
  check(
    'the editor is told where it is',
    JSON.parse((await call('bob', '/api/projects?notifications')).text).some(
      (n) => /drill edit\.mp4" is ready/.test(n.text) && n.open?.name === 'drill edit.mp4',
    ),
  );
} finally {
  srv.kill();
  clerk.close();
  fakeStripe.close();
  fakeRaw.close();
  fakeGoogle.close();
  fakeResend.close();
  const errors = srvOut.split('\n').filter((l) => l && !l.includes('sanktuary-os on'));
  console.log(`\n${pass} passed, ${failN} failed${errors.length ? '\nserver log:\n' + errors.join('\n') : ''}`);
  rmSync(dir, { recursive: true, force: true });
}
