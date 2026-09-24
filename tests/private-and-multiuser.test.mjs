// Multi-user test for private boards, private channels, arrows and activity visibility.
// Runs the real server against temp data and a fake Clerk with three users.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = process.argv[2] || fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const SECRET = 'sk_test_fake_secret_for_tests';
const USERS = ['alice', 'bob', 'carol'];

// ── Fake Clerk ──
const clerk = http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const m = req.url.match(/^\/users\/user_(\w+)/);
    if (m) return res.end(JSON.stringify({ id: `user_${m[1]}`, username: m[1] }));
    if (req.url.startsWith('/users'))
      return res.end(JSON.stringify(USERS.map((u) => ({ id: `user_${u}`, username: u, email_addresses: [], password_enabled: true }))));
    res.statusCode = 404;
    res.end('{}');
  })
  .listen(3197);

// ── Server on temp data ──
const dir = mkdtempSync(join(tmpdir(), 'sk-priv-'));
mkdirSync(join(dir, 'data'));
writeFileSync(
  join(dir, 'data', 'config.json'),
  JSON.stringify({ admins: ['alice'], drives: {}, spaces: [], members: {}, backup: { drive: null, hour: 3 } }),
);
writeFileSync(join(dir, 'data', 'status.json'), JSON.stringify({ drives: [] }));
const srv = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: '3196',
    DATA_DIR: join(dir, 'data'),
    THUMB_CACHE: join(dir, 'cache'), // never touch the real preview cache
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
const call = async (u, path, method = 'GET', body) => {
  const r = await fetch(B + path, {
    method,
    headers: { cookie: cookie(u), 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data };
};
/** Opens an SSE stream and collects its text until closed. */
const stream = (u, path) => {
  const ctrl = new AbortController();
  const s = { text: '', ended: false, close: () => ctrl.abort() };
  fetch(B + path, { headers: { cookie: cookie(u) }, signal: ctrl.signal })
    .then(async (r) => {
      s.status = r.status;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        s.text += Buffer.from(value).toString();
      }
      s.ended = true;
    })
    .catch(() => {
      s.ended = true;
    });
  return s;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0,
  failN = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : failN++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
};

try {
  // ── Private boards ──
  const board = (await call('bob', '/api/boards', 'POST', { name: 'Bob Board' })).data;
  const carolLive = stream('carol', `/api/boards/${board.id}/live`);
  await wait(300);
  check('public board: carol can open it', carolLive.status === 200);
  check('non-owner, non-admin cannot restrict', (await call('carol', `/api/boards/${board.id}`, 'PATCH', { members: [] })).status === 403);
  check('owner restricts to alice', (await call('bob', `/api/boards/${board.id}`, 'PATCH', { members: ['alice'] })).status === 200);
  await wait(300);
  check('carol is disconnected when she loses access', carolLive.ended && carolLive.text.includes('event: deleted'));
  const list = async (u) => (await call(u, '/api/boards')).data.map((b) => b.id);
  check('bob (owner) still sees it', (await list('bob')).includes(board.id));
  check('alice (member + admin) sees it', (await list('alice')).includes(board.id));
  check('carol does not see it in the list', !(await list('carol')).includes(board.id));
  check('carol cannot open live', (await call('carol', `/api/boards/${board.id}/live`)).status === 404);
  check('carol cannot send edits', (await call('carol', `/api/boards/${board.id}/ops`, 'POST', { conn: 'x', ops: [] })).status === 404);
  check('carol cannot fetch its images', (await call('carol', `/api/boards/${board.id}/assets/x.png`)).status === 404);

  // ── Arrows on a canvas, rejected on a plan ──
  const bobLive = stream('bob', `/api/boards/${board.id}/live`);
  await wait(300);
  const conn = JSON.parse(
    bobLive.text
      .split('\n')
      .find((l) => l.startsWith('data:'))
      .slice(5),
  ).you.conn;
  await call('bob', `/api/boards/${board.id}/ops`, 'POST', {
    conn,
    ops: [
      { put: { id: 'a', type: 'note', x: 0, y: 0, w: 100, h: 100, z: 1 } },
      { put: { id: 'b', type: 'note', x: 300, y: 0, w: 100, h: 100, z: 2 } },
      { put: { id: 'e', type: 'edge', from: 'a', to: 'b', x: 0, y: 0, w: 0, h: 0, z: 0 } },
    ],
  });
  await wait(1300);
  const saved = JSON.parse((await import('node:fs')).readFileSync(join(dir, 'data', 'boards', board.id, 'board.json'), 'utf8'));
  check(
    'arrow saved on the canvas',
    saved.items.some((i) => i.type === 'edge' && i.from === 'a' && i.to === 'b'),
  );
  bobLive.close();

  // ── Private plan: activity only visible to its people ──
  const plan = (await call('bob', '/api/boards', 'POST', { name: 'Secret Plan', kind: 'kanban' })).data;
  await call('bob', `/api/boards/${plan.id}`, 'PATCH', { members: [] }); // bob only (+ admins)
  const planLive = stream('bob', `/api/boards/${plan.id}/live`);
  const carolFeed = stream('carol', '/api/live');
  await wait(400);
  const init = JSON.parse(
    planLive.text
      .split('\n')
      .find((l) => l.startsWith('data:'))
      .slice(5),
  );
  const done = init.items.find((i) => i.title === 'Done').id;
  await call('bob', `/api/boards/${plan.id}/ops`, 'POST', {
    conn: init.you.conn,
    ops: [{ put: { id: 'c1', type: 'card', col: done, order: 1, title: 'Top secret task' } }],
  });
  await wait(400);
  const feed = async (u) => (await call(u, '/api/activity')).data.map((a) => a.card).filter(Boolean);
  check('bob sees "finished" on his private plan', (await feed('bob')).includes('Top secret task'));
  check('alice (admin) sees it too', (await feed('alice')).includes('Top secret task'));
  check('carol does not see it in the feed', !(await feed('carol')).includes('Top secret task'));
  check('carol did not get it live', !carolFeed.text.includes('Top secret task'));
  await call('bob', `/api/boards/${plan.id}/ops`, 'POST', {
    conn: init.you.conn,
    ops: [{ put: { id: 'e2', type: 'edge', from: 'x', to: 'y', x: 0, y: 0, w: 0, h: 0 } }],
  });
  await wait(1300);
  const planSaved = JSON.parse((await import('node:fs')).readFileSync(join(dir, 'data', 'boards', plan.id, 'board.json'), 'utf8'));
  check(
    'edge items rejected on a plan (not saved)',
    !planSaved.items.some((i) => i.id === 'e2') && planSaved.items.some((i) => i.id === 'c1'),
  );
  planLive.close();

  // ── Private channels ──
  const bobFeed = stream('bob', '/api/live');
  await wait(300);
  const ch = (await call('alice', '/api/chat', 'POST', { name: 'Secret Room', private: true, members: ['bob'] })).data;
  check(
    'private channel created with alice + bob',
    ch.private && ch.members.includes('alice') && ch.members.includes('bob'),
    JSON.stringify(ch.members),
  );
  const chans = async (u) => (await call(u, '/api/chat')).data.channels.map((c) => c.id);
  check('bob sees it', (await chans('bob')).includes(ch.id));
  check('carol does not see it', !(await chans('carol')).includes(ch.id));
  check('carol cannot read it', (await call('carol', `/api/chat/${ch.id}`)).status === 404);
  check('carol cannot post to it', (await call('carol', `/api/chat/${ch.id}`, 'POST', { text: 'hi' })).status === 404);
  await call('bob', `/api/chat/${ch.id}`, 'POST', { text: 'psst secret' });
  await wait(300);
  check('bob gets the message live', bobFeed.text.includes('psst secret'));
  check('carol does not get it live', !carolFeed.text.includes('psst secret'));
  check(
    'bob (not creator/admin) cannot change members',
    (await call('bob', `/api/chat/${ch.id}`, 'PATCH', { members: ['bob', 'carol'] })).status === 403,
  );
  check('alice adds carol', (await call('alice', `/api/chat/${ch.id}`, 'PATCH', { members: ['bob', 'carol'] })).status === 200);
  check(
    'now carol can read the history',
    (await call('carol', `/api/chat/${ch.id}`)).data.some?.((m) => m.text === 'psst secret'),
  );
  check('public #general still visible to carol', (await chans('carol')).includes('general'));
  bobFeed.close();
  carolFeed.close();
} finally {
  srv.kill();
  clerk.close();
  const errors = srvOut.split('\n').filter((l) => l && !l.includes('sanktuary-os on'));
  console.log(`\n${pass} passed, ${failN} failed${errors.length ? '\nserver log:\n' + errors.join('\n') : ''}`);
  rmSync(dir, { recursive: true, force: true });
}
