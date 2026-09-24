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
writeFileSync(join(drive, 'team', 'old.txt'), 'was on the drive before Sanktuary');
writeFileSync(join(drive, 'team', 'loose.txt'), 'also already there');
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
  const { gzipSync } = await import('node:zlib');
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
