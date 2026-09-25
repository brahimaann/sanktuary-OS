import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, Rights } from '../utils/api';
import { formatSize } from './fileTypes';
import { dialog } from '../utils/dialog';
import { LogOn, shell, button, statusBar } from './TeamFiles';
import FilePicker from '../components/FilePicker';

interface Space {
  id: string;
  name: string;
  folders?: { drive: string; path: string; label?: string }[]; // one or more folders, from any drives
  drive?: string; // older spaces: a single folder
  path?: string;
  everyone: Rights;
  groups?: Record<string, Rights>;
  access: Record<string, Rights>;
}
interface Config {
  admins: string[];
  drives: Record<string, { name: string; enabled: boolean }>;
  spaces: Space[];
  members: Record<string, { drive?: string; quotaGB?: number }>;
  backup: { drive: string | null; hour: number };
  cacheDrive?: string | null;
  groups?: Record<string, { name: string; members: string[] }>;
}

/** Older spaces (one drive + path) as a list of folders, so the Spaces tab only deals with one shape. */
const normalize = (c: Config): Config => ({
  ...c,
  groups: c.groups || {},
  spaces: c.spaces.map(({ drive, path, ...s }) => ({
    ...s,
    folders: s.folders?.length ? s.folders : drive ? [{ drive, path: path || '' }] : [],
  })),
});
interface Drive {
  id: string;
  letter: string;
  label: string;
  fs: string;
  sizeBytes: number;
  freeBytes: number;
}
interface State {
  config: Config;
  status: null | {
    updated: string;
    dockerOk: boolean;
    drives: Drive[];
    containers: { name: string; state: string; status: string }[];
    pc: { cpuPct: number; memUsedPct: number; uptimeHours: number; cFreeGB: number };
    tailscale: { state: string; online: boolean };
  };
  backup: null | { state: string; started: string; finished: string | null; results: { name: string; ok: boolean; note: string }[] };
  users: { id: string; username: string | null; email: string | null; hasPassword: boolean; lastSignIn: number | null }[];
}
type Check = { ok: boolean; ms?: number; note?: string };
interface Health {
  server: { uptimeHours: number; memMB: number };
  clerk: Check;
  tunnel: Check;
  publicSite: Check;
  watcher: { ok: boolean; lastSeen: string | null };
  deploy: { at: string; ok: boolean; commit: string; message: string } | null;
  rapidraw?: Check;
}

const TABS = ['Health', 'Usage', 'Drives', 'Spaces', 'Members', 'Backups', 'Front page', 'Blog', 'Stories', 'Shop & pool', 'Log'] as const;

/** Admin panel: server health, which drives are connected, who can reach what, members, backups. */
const AdminPanel: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  const api = useApi();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Health');
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const s: State = await api('/api/admin/state');
      s.config = normalize(s.config);
      setState(s);
      setDraft(structuredClone(s.config));
      setMsg('');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }, [api]);

  const loadHealth = useCallback(() => {
    api('/api/admin/health').then(setHealth, (err) => setMsg(err.message));
    api('/api/admin/state').then(
      (s: State) => setState((prev) => (prev ? { ...prev, status: s.status, backup: s.backup } : s)),
      () => {},
    );
  }, [api]);

  useEffect(() => {
    if (!isSignedIn) return;
    load();
    loadHealth();
    const t = setInterval(loadHealth, 30_000);
    return () => clearInterval(t);
  }, [isSignedIn, load, loadHealth]);

  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Admin Panel" />;
  if (!state || !draft) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.config);
  const edit = (fn: (c: Config) => void) =>
    setDraft((d) => {
      const c = structuredClone(d!);
      fn(c);
      return c;
    });
  const save = async () => {
    try {
      await api('/api/admin/config', { method: 'PUT', body: JSON.stringify(draft) });
      setMsg('Saved. Drive changes take effect within a minute.');
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const attached = state.status?.drives || [];
  const driveIds = [...new Set([...Object.keys(draft.drives), ...attached.map((d) => d.id)])];
  const driveName = (id: string | null | undefined) =>
    (id && draft.drives[id]?.name) || attached.find((d) => d.id === id)?.label || id?.slice(0, 8) || '—';
  const usernames = state.users.map((u) => u.username).filter(Boolean) as string[];

  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...button,
              borderBottom: tab === t ? 'none' : button.borderBottom,
              fontWeight: tab === t ? 700 : 400,
              position: 'relative',
              top: tab === t ? 1 : 0,
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={page}>
        {tab === 'Health' && <HealthTab state={state} health={health} refresh={loadHealth} />}

        {tab === 'Drives' && (
          <>
            <p style={hint}>
              Every external drive this PC has seen. Tick <b>Connected</b> to make it available to Sanktuary; untick to take it offline for
              everyone. Unplugging is always safe: it comes back by itself.
            </p>
            <table style={table}>
              <thead>
                <tr>
                  {['Connected', 'Name', 'Letter', 'Label', 'Format', 'Size', 'Free', 'State'].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {driveIds.map((id) => {
                  const live = attached.find((d) => d.id === id);
                  const cfg = draft.drives[id];
                  return (
                    <tr key={id}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={!!cfg?.enabled}
                          onChange={(e) =>
                            edit((c) => {
                              c.drives[id] = { name: c.drives[id]?.name || live?.label || 'Drive', enabled: e.target.checked };
                            })
                          }
                        />
                      </td>
                      <td style={td}>
                        <input
                          style={input}
                          value={cfg?.name ?? live?.label ?? ''}
                          onChange={(e) =>
                            edit((c) => {
                              c.drives[id] = { enabled: !!c.drives[id]?.enabled, name: e.target.value };
                            })
                          }
                        />
                      </td>
                      <td style={td}>{live?.letter || ''}</td>
                      <td style={td}>{live?.label || ''}</td>
                      <td style={td}>
                        {live?.fs || ''}
                        {/^FAT/i.test(live?.fs || '') ? ' (4 GB file limit)' : ''}
                      </td>
                      <td style={td}>{live ? formatSize(live.sizeBytes) : ''}</td>
                      <td style={td}>{live ? formatSize(live.freeBytes) : ''}</td>
                      <td style={td}>
                        {live ? <Dot ok /> : <Dot ok={false} />} {live ? 'plugged in' : 'unplugged'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ ...hint, marginTop: 10 }}>
              Preview cache (light MP3s of WAVs, image previews and thumbnails, up to 20 GB):{' '}
              <select
                style={input}
                value={draft.cacheDrive || ''}
                onChange={(e) =>
                  edit((c) => {
                    c.cacheDrive = e.target.value || null;
                  })
                }
              >
                <option value="">This PC's SSD</option>
                {driveIds.map((id) => (
                  <option key={id} value={id}>
                    {driveName(id)}
                  </option>
                ))}
              </select>{' '}
              — kept in a hidden <b>.sanktuary-cache</b> folder; while that drive is unplugged the SSD is used.
            </p>
          </>
        )}

        {tab === 'Spaces' && <SpacesTab draft={draft} edit={edit} driveIds={driveIds} driveName={driveName} usernames={usernames} />}

        {tab === 'Log' && <LogTab />}
        {tab === 'Blog' && <BlogTab />}
        {tab === 'Front page' && <FrontTab />}
        {tab === 'Usage' && <UsageTab />}
        {tab === 'Stories' && <StoriesTab />}
        {tab === 'Shop & pool' && <ShopTab />}

        {tab === 'Members' && (
          <MembersTab state={state} draft={draft} edit={edit} driveIds={driveIds} driveName={driveName} reload={load} setMsg={setMsg} />
        )}

        {tab === 'Backups' && (
          <>
            <p style={hint}>
              Copies every space and member space to <b>&lt;backup drive&gt;\Sanktuary Backup</b>. It only adds and updates files, and never
              deletes anything from the backup. Pick a drive that isn't holding the spaces themselves.
            </p>
            <div style={row}>
              <label>
                Backup drive{' '}
                <select
                  style={input}
                  value={draft.backup.drive || ''}
                  onChange={(e) =>
                    edit((c) => {
                      c.backup.drive = e.target.value || null;
                    })
                  }
                >
                  <option value="">(backups off)</option>
                  {driveIds.map((id) => (
                    <option key={id} value={id}>
                      {driveName(id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Every day at{' '}
                <select
                  style={input}
                  value={draft.backup.hour}
                  onChange={(e) =>
                    edit((c) => {
                      c.backup.hour = Number(e.target.value);
                    })
                  }
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
              <button
                style={button}
                disabled={dirty || !state.config.backup.drive}
                title={dirty ? 'Save first' : ''}
                onClick={() =>
                  api('/api/admin/backup', { method: 'POST' }).then(
                    () => setMsg('Backup will start within a minute.'),
                    (e) => setMsg(e.message),
                  )
                }
              >
                Back up now
              </button>
            </div>
            {/^FAT/i.test(attached.find((d) => d.id === draft.backup.drive)?.fs || '') && (
              <p style={{ ...hint, color: '#a00000' }}>This drive is FAT32: files over 4 GB can't be backed up to it.</p>
            )}
            <h4 style={{ margin: '10px 0 4px' }}>Last backup</h4>
            {!state.backup ? (
              <div>None yet.</div>
            ) : (
              <div>
                <div>
                  {state.backup.state === 'running' ? 'Running since' : 'Finished'}{' '}
                  {new Date(state.backup.finished || state.backup.started).toLocaleString()}
                </div>
                {state.backup.results.map((r) => (
                  <div key={r.name}>
                    <Dot ok={r.ok} /> {r.name}: {r.note}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 4 }}>
        <div style={{ ...statusBar, flex: 1, margin: 0 }}>{msg || (dirty ? 'You have unsaved changes.' : 'No changes.')}</div>
        <button style={button} disabled={!dirty} onClick={() => setDraft(structuredClone(state.config))}>
          Discard
        </button>
        <button style={{ ...button, fontWeight: 700 }} disabled={!dirty} onClick={save}>
          Save changes
        </button>
      </div>
    </div>
  );
};

const HealthTab: React.FC<{ state: State; health: Health | null; refresh: () => void }> = ({ state, health, refresh }) => {
  const st = state.status;
  const rows: [string, boolean | null, string][] = [
    ['Web server', health ? true : null, health ? `up ${health.server.uptimeHours} h · ${health.server.memMB} MB memory` : 'checking...'],
    [
      'Clerk (logins)',
      health?.clerk.ok ?? null,
      health ? (health.clerk.ok ? `reachable · ${health.clerk.ms} ms` : health.clerk.note || 'down') : '',
    ],
    ['Cloudflare Tunnel', health?.tunnel.ok ?? null, health?.tunnel.note || ''],
    [
      'sanktuary.studio (public)',
      health?.publicSite.ok ?? null,
      health ? (health.publicSite.ok ? `loads · ${health.publicSite.ms} ms` : health.publicSite.note || 'down') : '',
    ],
    [
      'Drive watcher',
      health?.watcher.ok ?? null,
      health?.watcher.lastSeen
        ? `last report ${new Date(health.watcher.lastSeen).toLocaleTimeString()}`
        : 'no reports: is the scheduled task running?',
    ],
    [
      'Auto-deploy (GitHub main)',
      health?.deploy ? health.deploy.ok : null,
      health?.deploy ? `${health.deploy.message.split(/\r?\n/)[0]} · ${new Date(health.deploy.at).toLocaleString()}` : 'no deploys yet',
    ],
    ['Photo editor (RapidRAW)', health?.rapidraw?.ok ?? null, health?.rapidraw?.note || ''],
    [
      'Docker',
      st ? st.dockerOk : null,
      st
        ? st.dockerOk
          ? `${st.containers.filter((c) => c.state === 'running').length}/${st.containers.length} containers running`
          : 'Docker Desktop is not running'
        : '',
    ],
    ['Tailscale', st ? st.tailscale.online : null, st ? `${st.tailscale.state || 'unknown'}${st.tailscale.online ? ' · online' : ''}` : ''],
    [
      'PC',
      st ? st.pc.cFreeGB > 10 : null,
      st ? `CPU ${st.pc.cpuPct}% · RAM ${st.pc.memUsedPct}% · up ${st.pc.uptimeHours} h · C: ${st.pc.cFreeGB} GB free` : '',
    ],
  ];
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={hint}>Refreshes every 30 seconds.</p>
        <button style={button} onClick={refresh}>
          Refresh now
        </button>
      </div>
      <table style={table}>
        <tbody>
          {rows.map(([name, ok, note]) => (
            <tr key={name}>
              <td style={td}>
                <Dot ok={ok} /> <b>{name}</b>
              </td>
              <td style={td}>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st && (
        <>
          <h4 style={{ margin: '10px 0 4px' }}>Containers</h4>
          <table style={table}>
            <tbody>
              {st.containers.map((c) => (
                <tr key={c.name}>
                  <td style={td}>
                    <Dot ok={c.state === 'running'} /> {c.name}
                  </td>
                  <td style={td}>{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 style={{ margin: '10px 0 4px' }}>Drives plugged in</h4>
          <table style={table}>
            <tbody>
              {st.drives.map((d) => (
                <tr key={d.id}>
                  <td style={td}>
                    <Dot ok={!!state.config.drives[d.id]?.enabled} /> {d.letter} {state.config.drives[d.id]?.name || d.label}
                  </td>
                  <td style={td}>
                    {formatSize(d.freeBytes)} free of {formatSize(d.sizeBytes)} ·{' '}
                    {state.config.drives[d.id]?.enabled ? 'connected' : 'not connected'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
};

const MembersTab: React.FC<{
  state: State;
  draft: Config;
  edit: (fn: (c: Config) => void) => void;
  driveIds: string[];
  driveName: (id?: string | null) => string;
  reload: () => void;
  setMsg: (m: string) => void;
}> = ({ state, draft, edit, driveIds, driveName, reload, setMsg }) => {
  const api = useApi();
  const add = async () => {
    const username = (await dialog.prompt('New member nickname (their operator ID):', '', { title: 'Add member' }))?.trim();
    if (!username) return;
    const email = (
      await dialog.prompt(`Email for ${username}.\nClerk emails them a code the first time they log in on a new device.`, '', {
        title: 'Add member',
      })
    )?.trim();
    if (email === undefined || email === null) return;
    const password = await dialog.prompt(
      `Access code (password) for ${username} — at least 8 characters.\nTell them in person or by DM.`,
      '',
      { title: 'Add member', password: true },
    );
    if (!password) return;
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, password, email }) });
      setMsg(`${username} can now log on.`);
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <>
      <p style={hint}>
        Members log on with their nickname and access code. A personal space is a private folder (<b>Sanktuary Members\&lt;name&gt;</b>) on
        the drive you pick, with a size limit.
      </p>
      <table style={table}>
        <thead>
          <tr>
            {['Member', 'Admin', 'Personal space drive', 'Limit (GB)', 'Access code set', 'Last logon'].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.users.map((u) => {
            const name = u.username;
            if (!name)
              return (
                <tr key={u.id}>
                  <td style={td} colSpan={6}>
                    {u.email || u.id} (no nickname: set one in Clerk)
                  </td>
                </tr>
              );
            const m = draft.members[name] || {};
            return (
              <tr key={u.id}>
                <td style={td}>
                  <b>{name}</b>
                </td>
                <td style={td}>
                  <input
                    type="checkbox"
                    checked={draft.admins.includes(name)}
                    onChange={(e) =>
                      edit((c) => {
                        c.admins = e.target.checked ? [...c.admins, name] : c.admins.filter((a) => a !== name);
                      })
                    }
                  />
                </td>
                <td style={td}>
                  <select
                    style={input}
                    value={m.drive || ''}
                    onChange={(e) =>
                      edit((c) => {
                        c.members[name] = { ...c.members[name], drive: e.target.value || undefined };
                      })
                    }
                  >
                    <option value="">(none)</option>
                    {driveIds.map((id) => (
                      <option key={id} value={id}>
                        {driveName(id)}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={td}>
                  <input
                    style={{ ...input, width: 70 }}
                    type="number"
                    min={0}
                    value={m.quotaGB ?? ''}
                    placeholder="no limit"
                    onChange={(e) =>
                      edit((c) => {
                        c.members[name] = { ...c.members[name], quotaGB: e.target.value ? Number(e.target.value) : undefined };
                      })
                    }
                  />
                </td>
                <td style={td}>{u.hasPassword ? 'yes' : 'no'}</td>
                <td style={td}>{u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString() : 'never'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button style={{ ...button, marginTop: 8 }} onClick={add}>
        Add member...
      </button>
    </>
  );
};

/** Walk a connected drive's folders and pick the one a space shares. onPick(null) = cancel. */
const FolderPicker: React.FC<{ drive: string; driveName: string; start: string; onPick: (path: string | null) => void }> = ({
  drive,
  driveName,
  start,
  onPick,
}) => {
  const api = useApi();
  const [path, setPath] = useState<string[]>(start.split(/[\\/]/).filter(Boolean));
  const [folders, setFolders] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setFolders(null);
    api(`/api/admin/folders?drive=${encodeURIComponent(drive)}&path=${encodeURIComponent(path.join('/'))}`).then(
      (r) => {
        setFolders(r.folders);
        setErr('');
      },
      (e) => setErr(e.message),
    );
  }, [api, drive, path]);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: '#c0c0c0',
          border: '2px outset #fff',
          padding: 8,
          width: 360,
          maxWidth: '90%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <b>Choose the folder to share</b>
        <div style={{ ...input, marginLeft: 0 }}>
          {driveName}:\{path.join('\\')}
        </div>
        <div style={{ height: 240, overflow: 'auto', background: '#fff', border: '2px inset #808080' }}>
          {path.length > 0 && (
            <div style={pickRow} onClick={() => setPath(path.slice(0, -1))}>
              ⬑ ..
            </div>
          )}
          {err && <div style={{ padding: 6, color: '#a00000' }}>{err}</div>}
          {!err && !folders && <div style={{ padding: 6 }}>Loading...</div>}
          {folders?.map((f) => (
            <div key={f} style={pickRow} onClick={() => setPath([...path, f])}>
              📁 {f}
            </div>
          ))}
          {folders?.length === 0 && <div style={{ padding: 6, color: '#666' }}>No folders inside.</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button style={button} onClick={() => onPick(null)}>
            Cancel
          </button>
          <button style={{ ...button, fontWeight: 700 }} disabled={!!err} onClick={() => onPick(path.join('/'))}>
            {path.length ? 'Share this folder' : 'Share the whole drive'}
          </button>
        </div>
      </div>
    </div>
  );
};

type Transfer = { at: string; user: string; action: string; space: string; path: string; bytes: number; ip?: string };

/** Console-style log of every upload and download, newest first. */
type Pool = {
  id: string;
  slug: string;
  title: string;
  description: string;
  goal: number;
  deadline: string | null;
  public: boolean;
  open: boolean;
  raised: number;
  supporters: number;
  payments: boolean;
};
type Product = {
  id: string;
  slug: string;
  title: string;
  description: string;
  price: number;
  kind: 'physical' | 'digital';
  image: string | null;
  stock: number | null;
  active: boolean;
  soldOut: boolean;
  file: { space: string; path: string } | null;
};

/** Money pools (public counter at sanktuary.studio/pool/...) and the shop's products. Orders are in Business > Orders. */
// ── Stories: a folder of photos and videos told as a full-screen guided story (e.g. Heart of the Cities) ──
interface StoryItem {
  file: string;
  kind: 'image' | 'video';
  chapter: string;
  caption: string;
  hidden: boolean;
}
interface Story {
  slug: string;
  title: string;
  subtitle: string;
  intro: string;
  public: boolean;
  folderName: string;
  items: StoryItem[];
}

const StoriesTab: React.FC = () => {
  const api = useApi();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [open, setOpen] = useState<Story | null>(null); // the story being edited (a draft)
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/stories').then(setStories, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);

  const create = async (folder: { space: string; path: string }) => {
    const title = (await dialog.prompt('Title of the story:', folder.path.split('/').pop() || ''))?.trim();
    if (!title) return;
    try {
      const st: Story = await api('/api/stories', { method: 'POST', body: JSON.stringify({ title, folder }) });
      await load();
      setOpen(st);
      setMsg(`Made "${st.title}" with ${st.items.length} photos and videos. Add captions, then tick Published.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const save = async (extra: object = {}) => {
    if (!open) return;
    try {
      const st: Story = await api(`/api/stories/${open.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: open.title,
          subtitle: open.subtitle,
          intro: open.intro,
          public: open.public,
          items: open.items,
          ...extra,
        }),
      });
      setOpen(st);
      await load();
      setMsg('Saved.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const set = (patch: Partial<Story>) => setOpen((o) => (o ? { ...o, ...patch } : o));
  const setItem = (j: number, patch: Partial<StoryItem>) =>
    set({ items: open!.items.map((it, k) => (k === j ? { ...it, ...patch } : it)) });
  const move = (j: number, by: number) => {
    const items = [...open!.items];
    const k = j + by;
    if (k < 0 || k >= items.length) return;
    [items[j], items[k]] = [items[k], items[j]];
    set({ items });
  };

  if (open) {
    // Picture previews use the story's public numbering, which counts only the items that aren't hidden
    let shown = -1;
    return (
      <>
        <div style={row}>
          <button style={button} onClick={() => (setOpen(null), setMsg(''))}>
            ‹ All stories
          </button>
          <a
            href={`/story/${open.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...button, textDecoration: 'none', color: '#000' }}
          >
            Open the story
          </a>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={open.public} onChange={(e) => set({ public: e.target.checked })} />
            <b>Published</b> (anyone with the link, and My Computer)
          </label>
          <button style={button} onClick={() => save({ rescan: true })} title="Add photos and videos put in the folder since">
            Look for new files
          </button>
          <button style={{ ...button, fontWeight: 700 }} onClick={() => save()}>
            Save
          </button>
          <span>{msg}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6, margin: '8px 0', alignItems: 'center' }}>
          Title
          <input style={input} value={open.title} onChange={(e) => set({ title: e.target.value })} />
          Subtitle
          <input
            style={input}
            value={open.subtitle}
            placeholder="e.g. Minneapolis & Saint Paul, 2026"
            onChange={(e) => set({ subtitle: e.target.value })}
          />
          <span style={{ alignSelf: 'start' }}>Intro</span>
          <textarea style={{ ...input, resize: 'vertical' }} rows={3} value={open.intro} onChange={(e) => set({ intro: e.target.value })} />
        </div>
        <p style={hint}>
          From <b>{open.folderName}</b>. Subfolders are chapters. A caption can also come from a text file named like the photo ("01
          corner.txt" for "01 corner.jpg"). Hidden items stay in the folder but leave the story.
        </p>
        {open.items.map((it, j) => {
          if (!it.hidden) shown++;
          return (
            <div
              key={it.file}
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: '1px solid #a0a0a0',
                opacity: it.hidden ? 0.5 : 1,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <button style={{ ...button, padding: '0 6px' }} onClick={() => move(j, -1)} title="Earlier">
                  ▲
                </button>
                <button style={{ ...button, padding: '0 6px' }} onClick={() => move(j, 1)} title="Later">
                  ▼
                </button>
              </div>
              {it.kind === 'image' && !it.hidden ? (
                <img
                  src={`/api/public/story/${open.slug}/${shown}?w=800`}
                  alt=""
                  style={{ width: 72, height: 54, objectFit: 'cover', border: '1px solid #808080' }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 54,
                    background: '#000',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                  }}
                >
                  {it.kind === 'video' ? '▶ video' : 'hidden'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: '#444', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.chapter ? `${it.chapter} · ` : ''}
                  {it.file.split('/').pop()}
                </span>
                <input
                  style={input}
                  value={it.caption}
                  placeholder="Caption (optional)"
                  onChange={(e) => setItem(j, { caption: e.target.value })}
                />
              </div>
              <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="checkbox" checked={it.hidden} onChange={(e) => setItem(j, { hidden: e.target.checked })} />
                Hide
              </label>
            </div>
          );
        })}
        <p style={{ ...hint, marginTop: 6 }}>Previews appear after saving when you show a hidden item or reorder.</p>
      </>
    );
  }

  return (
    <>
      <p style={hint}>
        A story tells a folder of photos and videos as a full-screen, scroll-through experience at <b>sanktuary.studio/story/…</b> (for
        example Heart of the Cities). Visitors only ever get resized pictures, never the original files.
      </p>
      {!stories ? (
        <div>{msg || 'Loading...'}</div>
      ) : (
        stories.map((st) => (
          <div key={st.slug} style={{ ...row, marginBottom: 6 }}>
            <b style={{ minWidth: 180 }}>{st.title}</b>
            <span>
              {st.items.filter((i) => !i.hidden).length} items · {st.public ? 'published' : 'draft'}
            </span>
            <button style={button} onClick={() => setOpen(st)}>
              Edit...
            </button>
            <a href={`/story/${st.slug}`} target="_blank" rel="noopener noreferrer">
              /story/{st.slug}
            </a>
            <button
              style={button}
              onClick={async () =>
                (await dialog.confirm(`Take down "${st.title}"? The photos and videos are not touched.`, { icon: 'warning' })) &&
                api(`/api/stories/${st.slug}`, { method: 'DELETE' }).then(load, (e) => setMsg(e.message))
              }
            >
              Take down
            </button>
          </div>
        ))
      )}
      <button style={{ ...button, fontWeight: 700 }} onClick={() => setPicking(true)}>
        New story from a folder...
      </button>
      {msg && <p style={hint}>{msg}</p>}
      {picking && (
        <FilePicker
          title="Folder with the story's photos and videos"
          mode="folder"
          onPick={(r) => {
            setPicking(false);
            if (r) create(r);
          }}
        />
      )}
    </>
  );
};

// ── Usage: is anyone using it, and is there anything on it? ──
interface Usage {
  weeks: {
    week: string;
    active: number;
    members: string[];
    uploads: number;
    downloads: number;
    linkOpens: number;
    views: Record<string, number>;
  }[];
  content: { releases: number; tracks: number; withBounce: number; timeline: number; stories: number; products: number };
}
const UsageTab: React.FC = () => {
  const api = useApi();
  const [u, setU] = useState<Usage | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/admin/usage').then(setU, (e) => setErr(e.message));
  }, [api]);
  if (!u) return <div>{err || 'Loading...'}</div>;
  const c = u.content;
  const views = (w: Usage['weeks'][number], prefix: string) =>
    Object.entries(w.views)
      .filter(([k]) => k.startsWith(prefix))
      .reduce((n, [, v]) => n + v, 0);
  const gaps = [
    !c.withBounce && 'no song has a bounce yet (Studio > Songs)',
    !c.timeline && 'the calendar is empty',
    !c.stories && 'no story is published (Stories tab)',
    !c.products && 'the shop has nothing in it',
  ].filter(Boolean);
  return (
    <>
      <p style={hint}>
        On the site: <b>{c.releases}</b> release(s), <b>{c.tracks}</b> song(s) ({c.withBounce} with a bounce), <b>{c.timeline}</b> calendar
        entries, <b>{c.stories}</b> published stor{c.stories === 1 ? 'y' : 'ies'}, <b>{c.products}</b> product(s).
        {gaps.length > 0 && <span style={{ color: '#a00000' }}> Still empty: {gaps.join('; ')}.</span>}
      </p>
      <table style={table}>
        <thead>
          <tr>
            {['Week of', 'Active members', 'Uploads', 'Downloads', 'Share-link opens', 'Story views', 'Release page views'].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {u.weeks.map((w) => (
            <tr key={w.week}>
              <td style={td}>{new Date(`${w.week}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
              <td style={td} title={w.members.join(', ')}>
                {w.active}
              </td>
              <td style={td}>{w.uploads}</td>
              <td style={td}>{w.downloads}</td>
              <td style={td}>{w.linkOpens}</td>
              <td style={td}>{views(w, 'story:')}</td>
              <td style={td}>{views(w, 'release:')}</td>
            </tr>
          ))}
          {!u.weeks.length && (
            <tr>
              <td style={td} colSpan={7}>
                Counting starts now: numbers appear as people use the site.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ ...hint, marginTop: 8 }}>
        Hover a number of active members to see who. Only members' usernames are kept (for 120 days); visitors are plain counts.
      </p>
    </>
  );
};

const ShopTab: React.FC = () => {
  const api = useApi();
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [openPool, setOpenPool] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    api('/api/pools').then(setPools, (e) => setMsg(e.message));
    api('/api/shop/admin').then(setProducts, (e) => setMsg(e.message));
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  const run = (p: Promise<unknown>) =>
    p.then(
      () => (setMsg(''), load()),
      (e) => setMsg(e.message),
    );
  const patchPool = (id: string, body: object) => run(api(`/api/pools/${id}`, { method: 'PATCH', body: JSON.stringify(body) }));
  const patchProduct = (id: string, body: object) => run(api(`/api/shop/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }));
  const pool = pools?.find((p) => p.id === openPool);
  const product = products.find((p) => p.id === openProduct);
  const usd = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  if (!pools) return <div>{msg || 'Loading...'}</div>;
  const payments = pools[0]?.payments ?? true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!payments && (
        <p style={{ ...hint, background: '#ffffe1', padding: 6, border: '1px solid #808080' }}>
          Payments aren't switched on yet. In your Stripe dashboard: copy the <b>secret key</b>, and add a webhook for{' '}
          <b>checkout.session.completed</b> pointing at <b>https://sanktuary.studio/api/stripe/webhook</b>. Then put{' '}
          <b>STRIPE_SECRET_KEY</b> and <b>STRIPE_WEBHOOK_SECRET</b> in the server's .env yourself and restart it. Everything else works
          already.
        </p>
      )}
      <fieldset style={fieldset}>
        <legend>Pools</legend>
        <div style={{ marginBottom: 6 }}>
          <button
            style={button}
            onClick={async () => {
              const title = (await dialog.prompt('What is the pool for? (e.g. "Studio monitors")', '', { title: 'New pool' }))?.trim();
              if (title)
                api('/api/pools', { method: 'POST', body: JSON.stringify({ title }) }).then(
                  (p: Pool) => (setOpenPool(p.id), load()),
                  (e) => setMsg(e.message),
                );
            }}
          >
            New pool...
          </button>
        </div>
        {pools.map((p) => (
          <div
            key={p.id}
            onClick={() => setOpenPool(p.id === openPool ? null : p.id)}
            style={{ ...pickRow, background: p.id === openPool ? '#000080' : '#fff', color: p.id === openPool ? '#fff' : '#000' }}
          >
            <b>{p.title}</b> · {usd(p.raised)}
            {p.goal ? ` of ${usd(p.goal)}` : ''} · {p.supporters} supporters · {p.public ? 'public' : 'members only'}
            {p.open ? '' : ' · closed'}
          </div>
        ))}
        {pool && (
          <div key={pool.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center', marginTop: 8 }}>
            Title
            <input
              style={input}
              defaultValue={pool.title}
              onBlur={(e) => e.target.value !== pool.title && patchPool(pool.id, { title: e.target.value })}
            />
            About
            <textarea
              style={{ ...input, resize: 'vertical' }}
              rows={3}
              defaultValue={pool.description}
              onBlur={(e) => e.target.value !== pool.description && patchPool(pool.id, { description: e.target.value })}
            />
            Goal ($)
            <input
              style={{ ...input, width: 110 }}
              type="number"
              min={0}
              defaultValue={pool.goal || ''}
              onBlur={(e) => Number(e.target.value) !== pool.goal && patchPool(pool.id, { goal: e.target.value || 0 })}
            />
            Until
            <input
              style={{ ...input, width: 150 }}
              type="date"
              defaultValue={pool.deadline || ''}
              onChange={(e) => patchPool(pool.id, { deadline: e.target.value || null })}
            />
            <span />
            <span style={row}>
              <label>
                <input type="checkbox" checked={pool.public} onChange={(e) => patchPool(pool.id, { public: e.target.checked })} /> Public
                (fans can put in too)
              </label>
              <label>
                <input type="checkbox" checked={pool.open} onChange={(e) => patchPool(pool.id, { open: e.target.checked })} /> Open
              </label>
              <a href={`/pool/${pool.slug}`} target="_blank" rel="noopener noreferrer">
                Open its page
              </a>
            </span>
            <span />
            <span style={row}>
              <button
                style={button}
                onClick={async () => {
                  const amount = await dialog.prompt('Amount given outside Stripe (cash, Zelle...):', '', { title: 'Add a contribution' });
                  if (!amount) return;
                  const name =
                    (await dialog.prompt('From (name, or leave empty for anonymous):', '', { title: 'Add a contribution' })) ?? '';
                  run(
                    api(`/api/pools/${pool.id}/manual`, {
                      method: 'POST',
                      body: JSON.stringify({ amount, name: name || 'Anonymous', anonymous: !name }),
                    }),
                  );
                }}
              >
                Add cash / Zelle...
              </button>
              <button
                style={button}
                onClick={async () =>
                  (await dialog.confirm(`Remove the pool "${pool.title}"? Its record is kept.`, { icon: 'warning' })) &&
                  run(api(`/api/pools/${pool.id}`, { method: 'DELETE' }).then(() => setOpenPool(null)))
                }
              >
                Remove
              </button>
            </span>
          </div>
        )}
      </fieldset>

      <fieldset style={fieldset}>
        <legend>Shop</legend>
        <div style={{ ...row, marginBottom: 6 }}>
          <button
            style={button}
            onClick={async () => {
              const title = (await dialog.prompt('Product name:', '', { title: 'New product' }))?.trim();
              if (title)
                api('/api/shop/products', { method: 'POST', body: JSON.stringify({ title }) }).then(
                  (p: Product) => (setOpenProduct(p.id), load()),
                  (e) => setMsg(e.message),
                );
            }}
          >
            New product...
          </button>
          <a href="/shop" target="_blank" rel="noopener noreferrer">
            Open the shop
          </a>
        </div>
        {products.map((p) => (
          <div
            key={p.id}
            onClick={() => setOpenProduct(p.id === openProduct ? null : p.id)}
            style={{ ...pickRow, background: p.id === openProduct ? '#000080' : '#fff', color: p.id === openProduct ? '#fff' : '#000' }}
          >
            <b>{p.title}</b> · {usd(p.price)} · {p.kind} · {p.stock === null ? 'unlimited' : `${p.stock} left`} ·{' '}
            {p.active ? 'on sale' : 'hidden'}
          </div>
        ))}
        {product && (
          <div key={product.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center', marginTop: 8 }}>
            Name
            <input
              style={input}
              defaultValue={product.title}
              onBlur={(e) => e.target.value !== product.title && patchProduct(product.id, { title: e.target.value })}
            />
            About
            <textarea
              style={{ ...input, resize: 'vertical' }}
              rows={3}
              defaultValue={product.description}
              onBlur={(e) => e.target.value !== product.description && patchProduct(product.id, { description: e.target.value })}
            />
            Price ($)
            <input
              style={{ ...input, width: 110 }}
              type="number"
              min={0.5}
              step="0.01"
              defaultValue={product.price}
              onBlur={(e) => Number(e.target.value) !== product.price && patchProduct(product.id, { price: e.target.value })}
            />
            Kind
            <select
              style={{ ...input, width: 200 }}
              value={product.kind}
              onChange={(e) => patchProduct(product.id, { kind: e.target.value })}
            >
              <option value="physical">Physical (shipped)</option>
              <option value="digital">Digital (download)</option>
            </select>
            Stock
            <input
              style={{ ...input, width: 110 }}
              type="number"
              min={0}
              placeholder="unlimited"
              defaultValue={product.stock ?? ''}
              onBlur={(e) => patchProduct(product.id, { stock: e.target.value === '' ? null : e.target.value })}
            />
            Picture
            <span style={row}>
              {product.image ? <img src={product.image} alt="" style={{ height: 48, border: '1px solid #808080' }} /> : 'none'}
              <label style={{ ...button, display: 'inline-block' }}>
                Choose picture...
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try {
                      const { url } = await api(`/api/shop/images?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f });
                      patchProduct(product.id, { image: url });
                    } catch (err) {
                      setMsg((err as Error).message);
                    }
                  }}
                />
              </label>
            </span>
            {product.kind === 'digital' && (
              <>
                Delivers
                <span style={row}>
                  {product.file ? <b>{product.file.path}</b> : <span style={{ color: '#a00000' }}>pick the file or folder buyers get</span>}
                  <button style={button} onClick={() => setPicking(true)}>
                    Choose...
                  </button>
                </span>
              </>
            )}
            <span />
            <span style={row}>
              <label>
                <input type="checkbox" checked={product.active} onChange={(e) => patchProduct(product.id, { active: e.target.checked })} />{' '}
                On sale
              </label>
              <a href={`/shop/${product.slug}`} target="_blank" rel="noopener noreferrer">
                Open its page
              </a>
              <span style={{ flex: 1 }} />
              <button
                style={button}
                onClick={async () =>
                  (await dialog.confirm(`Remove "${product.title}" from the shop? Its orders are kept.`, { icon: 'warning' })) &&
                  run(api(`/api/shop/products/${product.id}`, { method: 'DELETE' }).then(() => setOpenProduct(null)))
                }
              >
                Remove
              </button>
            </span>
          </div>
        )}
      </fieldset>
      {picking && product && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000 }}>
          <FilePicker
            title="What do buyers download?"
            mode="file"
            onPick={(r) => {
              setPicking(false);
              if (r) patchProduct(product.id, { file: r });
            }}
          />
        </div>
      )}
      {msg && <div style={{ color: '#a00000' }}>{msg}</div>}
    </div>
  );
};

type Join = { id: string; name: string; email: string; role: string; links: string; message: string; at: string; status: string };

/** What visitors see in the Welcome window, and the "Join the Village" requests. */
const FrontTab: React.FC = () => {
  const api = useApi();
  const [d, setD] = useState<{ intro: string; portfolio: Record<string, string>; joins: Join[] } | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/public/admin').then(setD, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  const save = (body: object) =>
    api('/api/public/admin', { method: 'PATCH', body: JSON.stringify(body) }).then(load, (e) => setMsg(e.message));
  if (!d) return <div>{msg || 'Loading...'}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={hint}>
        The Welcome window opens for anyone who isn't logged in. It shows this intro, the latest blog posts, and the timeline entries and
        releases you've ticked <b>Show publicly</b> (in Timeline and Tracks).
      </p>
      <fieldset style={fieldset}>
        <legend>Intro</legend>
        <textarea
          key={d.intro}
          style={{ ...input, width: '100%', minHeight: 90, resize: 'vertical' }}
          defaultValue={d.intro}
          onBlur={(e) => e.target.value !== d.intro && save({ intro: e.target.value })}
        />
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Portfolio</legend>
        <p style={hint}>
          <a href="/portfolio" target="_blank" rel="noopener noreferrer">
            sanktuary.studio/portfolio
          </a>{' '}
          is a work sample page for grant applications and press: this text, then every public release (with previews), published story,
          public event and listed member. Open it and press <b>Save as PDF</b> to attach it to an application.
        </p>
        {(
          [
            ['name', 'Name', 'HIMA', 1],
            ['tagline', 'One line', 'Artist, producer and visual storyteller, Twin Cities', 1],
            ['contact', 'Contact', 'email address', 1],
            ['statement', 'Artist statement', 'What you make and why (grant panels read this first)', 6],
            ['bio', 'Bio', 'Where you come from, what you have done, who you work with', 6],
            ['links', 'Links', 'One https:// link per line (Spotify, Instagram, Substack...)', 3],
          ] as const
        ).map(([k, label, ph, rows]) => (
          <label key={k} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, marginBottom: 6, alignItems: 'start' }}>
            {label}
            {rows === 1 ? (
              <input
                key={d.portfolio[k] || ''}
                style={input}
                placeholder={ph}
                defaultValue={d.portfolio[k] || ''}
                onBlur={(e) => e.target.value !== (d.portfolio[k] || '') && save({ portfolio: { [k]: e.target.value } })}
              />
            ) : (
              <textarea
                key={d.portfolio[k] || ''}
                rows={rows}
                style={{ ...input, resize: 'vertical' }}
                placeholder={ph}
                defaultValue={d.portfolio[k] || ''}
                onBlur={(e) => e.target.value !== (d.portfolio[k] || '') && save({ portfolio: { [k]: e.target.value } })}
              />
            )}
          </label>
        ))}
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Join requests ({d.joins.filter((j) => j.status === 'New').length} new)</legend>
        {!d.joins.length && <div style={{ color: '#555' }}>None yet.</div>}
        {d.joins.map((j) => (
          <div
            key={j.id}
            style={{ background: j.status === 'New' ? '#ffffe1' : '#fff', border: '1px solid #808080', padding: 6, marginBottom: 6 }}
          >
            <div style={row}>
              <b>{j.name}</b>
              <a href={`mailto:${j.email}`}>{j.email}</a>
              {j.role && <span>· {j.role}</span>}
              <span style={{ color: '#555' }}>· {new Date(j.at).toLocaleDateString()}</span>
              <span style={{ flex: 1 }} />
              <select style={input} value={j.status} onChange={(e) => save({ join: { id: j.id, status: e.target.value } })}>
                {['New', 'Contacted', 'Joined', 'Archived'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {j.links && <div style={{ wordBreak: 'break-all' }}>{j.links}</div>}
            {j.message && <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{j.message}</div>}
          </div>
        ))}
      </fieldset>
      {msg && <div style={{ color: '#a00000' }}>{msg}</div>}
    </div>
  );
};

type BlogPost = {
  id: string;
  title: string;
  body: string;
  author: string;
  image: string | null;
  published: string | null;
  created: string;
};
type Feed = { url: string; name: string; posts: number; error: string | null };

/** Substack writers pulled onto sanktuary.studio/blog, and our own posts (plain text; blank line = new paragraph). */
const BlogTab: React.FC = () => {
  const api = useApi();
  const [data, setData] = useState<{ feeds: Feed[]; posts: BlogPost[] } | null>(null);
  const [feed, setFeed] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/blog/admin').then(setData, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  const run = (p: Promise<unknown>) => p.then(load, (e) => setMsg(e.message));
  const post = data?.posts.find((p) => p.id === openId);
  const patch = (body: object) => run(api(`/api/blog/posts/${openId}`, { method: 'PATCH', body: JSON.stringify(body) }));
  const cover = async (file?: File) => {
    if (!file) return;
    try {
      const { url } = await api(`/api/blog/images?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
      patch({ image: url });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!data) return <div>{msg || 'Loading...'}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={hint}>
        Everything here shows on{' '}
        <a href="/blog" target="_blank" rel="noopener noreferrer">
          sanktuary.studio/blog
        </a>{' '}
        (public, no account needed) and in the Blog icon on the desktop. Substack posts refresh every 10 minutes and link back to Substack
        for the full piece.
      </p>
      <fieldset style={fieldset}>
        <legend>Substack writers</legend>
        {data.feeds.map((f) => (
          <div key={f.url} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <Dot ok={!f.error} /> <b>{f.name}</b>
            <span style={{ color: '#555', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.error ? `can't read it right now (${f.error})` : `${f.posts} posts`} · {f.url}
            </span>
            <button style={button} onClick={() => run(api(`/api/blog/feeds?url=${encodeURIComponent(f.url)}`, { method: 'DELETE' }))}>
              Remove
            </button>
          </div>
        ))}
        <div style={row}>
          <input
            style={{ ...input, flex: 1, minWidth: 200 }}
            placeholder="Substack name or link, e.g. boroma or open.substack.com/pub/boroma"
            value={feed}
            onChange={(e) => setFeed(e.target.value)}
          />
          <button
            style={button}
            disabled={!feed.trim()}
            onClick={() => {
              setMsg('Checking the feed...');
              run(api('/api/blog/feeds', { method: 'POST', body: JSON.stringify({ url: feed }) }).then(() => (setFeed(''), setMsg(''))));
            }}
          >
            Add writer
          </button>
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Our posts</legend>
        <div style={{ marginBottom: 6 }}>
          <button
            style={button}
            onClick={() =>
              api('/api/blog/posts', { method: 'POST', body: JSON.stringify({ title: 'Untitled' }) }).then(
                (p: BlogPost) => {
                  setOpenId(p.id);
                  load();
                },
                (e) => setMsg(e.message),
              )
            }
          >
            New post
          </button>
        </div>
        {data.posts.map((p) => (
          <div
            key={p.id}
            onClick={() => setOpenId(p.id === openId ? null : p.id)}
            style={{
              padding: '3px 6px',
              cursor: 'default',
              background: p.id === openId ? '#000080' : '#fff',
              color: p.id === openId ? '#fff' : '#000',
              borderBottom: '1px solid #eee',
            }}
          >
            <b>{p.title}</b> · {p.author} · {p.published ? `published ${new Date(p.published).toLocaleDateString()}` : 'draft'}
          </div>
        ))}
        {!data.posts.length && <div style={{ color: '#555' }}>No posts yet.</div>}
      </fieldset>
      {post && (
        <fieldset key={post.id} style={fieldset}>
          <legend>Editing: {post.title}</legend>
          <label style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            Title
            <input
              style={input}
              defaultValue={post.title}
              onBlur={(e) => e.target.value !== post.title && patch({ title: e.target.value })}
            />
            Author
            <input
              style={input}
              defaultValue={post.author}
              onBlur={(e) => e.target.value !== post.author && patch({ author: e.target.value })}
            />
            Cover
            <span style={row}>
              {post.image ? <img src={post.image} alt="" style={{ height: 48, border: '1px solid #808080' }} /> : 'none'}
              <label style={{ ...button, display: 'inline-block' }}>
                Choose picture...
                <input type="file" accept="image/*" hidden onChange={(e) => (cover(e.target.files?.[0]), (e.target.value = ''))} />
              </label>
              {post.image && (
                <button style={button} onClick={() => patch({ image: null })}>
                  Remove
                </button>
              )}
            </span>
          </label>
          <textarea
            style={{
              ...input,
              width: '100%',
              minHeight: 220,
              resize: 'vertical',
              fontFamily: 'Georgia, serif',
              fontSize: 14,
              lineHeight: 1.5,
            }}
            defaultValue={post.body}
            placeholder="Write here. Leave a blank line between paragraphs. https:// links become clickable."
            onBlur={(e) => e.target.value !== post.body && patch({ body: e.target.value })}
          />
          <div style={{ ...row, marginTop: 6 }}>
            <button style={{ ...button, fontWeight: 700 }} onClick={() => patch({ published: !post.published })}>
              {post.published ? 'Unpublish (back to draft)' : 'Publish'}
            </button>
            {post.published && (
              <a
                href={`/blog/${post.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...button, textDecoration: 'none', color: '#000' }}
              >
                View on the blog
              </a>
            )}
            <span style={{ flex: 1 }} />
            <button
              style={button}
              onClick={async () =>
                (await dialog.confirm(`Remove "${post.title}"? It's hidden, not destroyed.`, { icon: 'warning' })) &&
                run(api(`/api/blog/posts/${post.id}`, { method: 'DELETE' }).then(() => setOpenId(null)))
              }
            >
              Remove post
            </button>
          </div>
        </fieldset>
      )}
      {msg && <div style={{ color: '#a00000' }}>{msg}</div>}
    </div>
  );
};

const LogTab: React.FC = () => {
  const api = useApi();
  const [log, setLog] = useState<Transfer[] | null>(null);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/api/admin/log').then(setLog, (e) => setErr(e.message)), [api]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);
  const f = filter.toLowerCase();
  const lines = (log || []).filter((e) => !f || `${e.user} ${e.action} ${e.space} ${e.path}`.toLowerCase().includes(f));
  return (
    <>
      <div style={{ ...row, marginBottom: 8 }}>
        <span style={{ flex: 1 }}>Every upload and download (last 500). Refreshes every 10 seconds.</span>
        <input style={input} placeholder="Filter: name, file, space..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button style={button} onClick={load}>
          Refresh
        </button>
      </div>
      <div
        style={{
          background: '#000',
          color: '#c0c0c0',
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 12,
          padding: 8,
          border: '2px inset #808080',
          height: 'calc(100% - 40px)',
          minHeight: 200,
          overflow: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {err && <div style={{ color: '#ff5555' }}>{err}</div>}
        {!log && !err && 'Loading...'}
        {log && !lines.length && 'Nothing logged yet.'}
        {lines.map((e, i) => (
          <div key={i}>
            <span style={{ color: '#808080' }}>{new Date(e.at).toLocaleString()}</span>{' '}
            <span style={{ color: '#ffff55' }}>{e.user.padEnd(12)}</span>{' '}
            <span style={{ color: /upload|replace/.test(e.action) ? '#55ff55' : '#55ffff' }}>{e.action.padEnd(12)}</span> {e.space} \{' '}
            {e.path.split('/').join('\\')}{' '}
            <span style={{ color: '#808080' }}>
              ({formatSize(e.bytes)}
              {e.ip ? ` · ${e.ip}` : ''})
            </span>
          </div>
        ))}
      </div>
    </>
  );
};

// ── Spaces: what members see in Team Files, made of one or more folders, and who can use each ──
const ACCESS: [Rights, string][] = [
  ['none', 'No access'],
  ['view', 'Can view & download'],
  ['upload', 'Can add files'],
  ['edit', 'Full access (rename, replace)'],
];
const accessName = (r: Rights) => ACCESS.find(([k]) => k === r)?.[1] || r;
const AccessSelect: React.FC<{ value: Rights | ''; empty?: string; onChange: (r: Rights | '') => void }> = ({ value, empty, onChange }) => (
  <select style={input} value={value} onChange={(e) => onChange(e.target.value as Rights | '')}>
    {empty && <option value="">{empty}</option>}
    {ACCESS.map(([k, label]) => (
      <option key={k} value={k}>
        {label}
      </option>
    ))}
  </select>
);
const RANKS: Record<Rights, number> = { none: 0, view: 1, upload: 2, edit: 3 };
const slug = (name: string, taken: string[]) => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'item';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
};
const leaf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || '';

/** Who ends up with what in a space, and why (the same rule the server uses). */
function effective(s: Space, groups: Config['groups'], username: string): { r: Rights; why: string } {
  if (s.access?.[username]) return { r: s.access[username], why: 'own setting' };
  let r: Rights = s.everyone || 'none';
  let why = 'everyone';
  for (const [g, gr] of Object.entries(s.groups || {}))
    if (groups?.[g]?.members.includes(username) && RANKS[gr] > RANKS[r]) {
      r = gr;
      why = groups[g].name;
    }
  return { r, why };
}

const SpacesTab: React.FC<{
  draft: Config;
  edit: (fn: (c: Config) => void) => void;
  driveIds: string[];
  driveName: (id?: string | null) => string;
  usernames: string[];
}> = ({ draft, edit, driveIds, driveName, usernames }) => {
  // Folder being chosen: in space i, folder j (or a new one), on a drive
  const [picking, setPicking] = useState<{ i: number; j: number | null; drive: string } | null>(null);
  const groups = draft.groups || {};
  const people = usernames.filter((u) => !draft.admins.includes(u));
  const firstDrive = driveIds.find((d) => draft.drives[d]?.enabled) || driveIds[0];

  return (
    <>
      <p style={hint}>
        A <b>space</b> is what members see in Team Files. It can be one folder, or several folders from different drives shown together (for
        example four video folders as one <i>Videos</i> space). Removing a space or a folder never deletes files.
      </p>

      <fieldset style={fieldset}>
        <legend>
          <b>Groups</b>
        </legend>
        <p style={hint}>
          Give access to a group once instead of person by person: add people to Editors and every space open to Editors opens for them.
        </p>
        {Object.entries(groups).map(([id, g]) => (
          <div key={id} style={{ ...row, marginBottom: 6 }}>
            <input
              style={{ ...input, width: 120, fontWeight: 700 }}
              value={g.name}
              onChange={(e) =>
                edit((c) => {
                  c.groups![id].name = e.target.value;
                })
              }
            />
            {people.map((u) => (
              <label key={u} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={g.members.includes(u)}
                  onChange={(e) =>
                    edit((c) => {
                      const m = c.groups![id].members.filter((x) => x !== u);
                      c.groups![id].members = e.target.checked ? [...m, u] : m;
                    })
                  }
                />
                {u}
              </label>
            ))}
            <button
              style={button}
              onClick={async () =>
                (await dialog.confirm(`Remove the group "${g.name}"? Its members lose what the group gave them.`, { icon: 'warning' })) &&
                edit((c) => {
                  delete c.groups![id];
                  for (const s of c.spaces) if (s.groups) delete s.groups[id];
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          style={button}
          onClick={async () => {
            const name = (await dialog.prompt('Name of the group (e.g. Editors, Artists, Engineers):'))?.trim();
            if (name)
              edit((c) => {
                c.groups ??= {};
                c.groups[slug(name, Object.keys(c.groups))] = { name, members: [] };
              });
          }}
        >
          New group...
        </button>
      </fieldset>

      {draft.spaces.map((s, i) => {
        const folders = s.folders || [];
        const who = people
          .map((u) => ({ u, ...effective(s, groups, u) }))
          .filter((x) => x.r !== 'none')
          .map((x) => `${x.u} (${accessName(x.r).toLowerCase()}${x.why === 'everyone' ? '' : `, ${x.why}`})`);
        return (
          <fieldset key={s.id} style={fieldset}>
            <legend>
              <b>{s.name || 'New space'}</b>
            </legend>
            <div style={row}>
              <label>
                Name{' '}
                <input
                  style={input}
                  value={s.name}
                  onChange={(e) =>
                    edit((c) => {
                      c.spaces[i].name = e.target.value;
                    })
                  }
                />
              </label>
              <button
                style={button}
                onClick={async () =>
                  (await dialog.confirm(`Remove the space "${s.name}"?\nFiles on the drives are not touched.`, { icon: 'warning' })) &&
                  edit((c) => {
                    c.spaces.splice(i, 1);
                  })
                }
              >
                Remove space
              </button>
            </div>

            <div style={{ margin: '8px 0 4px', fontWeight: 700 }}>Folders</div>
            {folders.map((f, j) => (
              <div key={j} style={{ ...row, marginBottom: 4 }}>
                <span style={{ minWidth: 200 }}>
                  <b>{driveName(f.drive)}</b> \ {f.path || '(whole drive)'}
                </span>
                {folders.length > 1 && (
                  <label title="How this folder is named inside the space">
                    shown as{' '}
                    <input
                      style={{ ...input, width: 130 }}
                      value={f.label ?? ''}
                      placeholder={leaf(f.path) || driveName(f.drive)}
                      onChange={(e) =>
                        edit((c) => {
                          c.spaces[i].folders![j].label = e.target.value.replace(/[\\/:*?"<>|]/g, '') || undefined;
                        })
                      }
                    />
                  </label>
                )}
                <button style={button} onClick={() => setPicking({ i, j, drive: f.drive })}>
                  Change...
                </button>
                {folders.length > 1 && (
                  <button
                    style={button}
                    onClick={() =>
                      edit((c) => {
                        c.spaces[i].folders!.splice(j, 1);
                      })
                    }
                  >
                    Take out
                  </button>
                )}
              </div>
            ))}
            <div style={row}>
              <label>
                Add a folder from{' '}
                <select style={input} value="" onChange={(e) => e.target.value && setPicking({ i, j: null, drive: e.target.value })}>
                  <option value="">(choose a drive)</option>
                  {driveIds
                    .filter((d) => draft.drives[d]?.enabled)
                    .map((d) => (
                      <option key={d} value={d}>
                        {driveName(d)}
                      </option>
                    ))}
                </select>
              </label>
              {folders.length > 1 && <span style={{ color: '#444' }}>Each folder shows as its own folder inside the space.</span>}
            </div>

            <div style={{ margin: '10px 0 4px', fontWeight: 700 }}>Who can use it</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content max-content', gap: '4px 10px', alignItems: 'center' }}>
              <span>Everyone</span>
              <AccessSelect
                value={s.everyone}
                onChange={(r) =>
                  edit((c) => {
                    c.spaces[i].everyone = (r || 'none') as Rights;
                  })
                }
              />
              {Object.entries(groups).map(([gid, g]) => (
                <React.Fragment key={gid}>
                  <span>
                    {g.name} <span style={{ color: '#666' }}>({g.members.length})</span>
                  </span>
                  <AccessSelect
                    value={s.groups?.[gid] || ''}
                    empty="(same as everyone)"
                    onChange={(r) =>
                      edit((c) => {
                        c.spaces[i].groups ??= {};
                        if (r) c.spaces[i].groups![gid] = r;
                        else delete c.spaces[i].groups![gid];
                      })
                    }
                  />
                </React.Fragment>
              ))}
              {Object.entries(s.access || {}).map(([u, r]) => (
                <React.Fragment key={u}>
                  <span>
                    {u} <span style={{ color: '#666' }}>(just this person)</span>
                  </span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <AccessSelect
                      value={r}
                      onChange={(v) =>
                        edit((c) => {
                          c.spaces[i].access[u] = (v || 'none') as Rights;
                        })
                      }
                    />
                    <button
                      style={button}
                      onClick={() =>
                        edit((c) => {
                          delete c.spaces[i].access[u];
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                </React.Fragment>
              ))}
            </div>
            <div style={{ ...row, marginTop: 6 }}>
              <label>
                Set one person differently{' '}
                <select
                  style={input}
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    edit((c) => {
                      c.spaces[i].access[e.target.value] = effective(s, groups, e.target.value).r;
                    })
                  }
                >
                  <option value="">(choose)</option>
                  {people
                    .filter((u) => !s.access?.[u])
                    .map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p style={{ ...hint, marginTop: 6, color: '#000080' }}>
              {who.length ? `Gets in: ${who.join(', ')}.` : 'Nobody but admins gets in yet.'} Admins always have full access.
            </p>
          </fieldset>
        );
      })}

      <button
        style={button}
        onClick={async () => {
          const name = (await dialog.prompt('Name of the new space:'))?.trim();
          if (!name) return;
          const i = draft.spaces.length;
          edit((c) => {
            c.spaces.push({
              id: slug(
                name,
                c.spaces.map((x) => x.id),
              ),
              name,
              folders: [],
              everyone: 'none',
              access: {},
            });
          });
          if (firstDrive) setPicking({ i, j: null, drive: firstDrive });
        }}
      >
        Add space...
      </button>
      <p style={{ ...hint, marginTop: 8 }}>
        Members can bin (to a recoverable trash) only what they added themselves; admins can remove anything. Files can be moved within a
        folder, not between the folders of a combined space (they can be on different drives).
      </p>

      {picking && draft.spaces[picking.i] && (
        <FolderPicker
          drive={picking.drive}
          driveName={driveName(picking.drive)}
          start={picking.j !== null ? draft.spaces[picking.i].folders![picking.j].path : ''}
          onPick={(path) => {
            if (path !== null)
              edit((c) => {
                const fs = (c.spaces[picking.i].folders ??= []);
                if (picking.j === null) fs.push({ drive: picking.drive, path });
                else fs[picking.j] = { ...fs[picking.j], drive: picking.drive, path };
              });
            setPicking(null);
          }}
        />
      )}
    </>
  );
};

const Dot: React.FC<{ ok: boolean | null }> = ({ ok }) => (
  <span
    style={{
      display: 'inline-block',
      width: 9,
      height: 9,
      borderRadius: '50%',
      marginRight: 4,
      border: '1px solid #404040',
      background: ok === null ? '#c0c0c0' : ok ? '#00c000' : '#e00000',
    }}
  />
);

const page: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #404040',
  borderBottom: '1px solid #404040',
  margin: '0 4px',
  padding: 10,
};
const hint: React.CSSProperties = { margin: '0 0 8px', lineHeight: 1.4 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#fff', border: '2px inset #808080' };
const th: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 400,
  padding: '2px 6px',
  background: '#c0c0c0',
  borderRight: '1px solid #808080',
  borderBottom: '1px solid #808080',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '3px 6px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' };
const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
  marginLeft: 4,
};
const fieldset: React.CSSProperties = { border: '2px groove #fff', margin: '0 0 8px', padding: '4px 8px 8px' };
const pickRow: React.CSSProperties = { padding: '3px 6px', cursor: 'pointer', borderBottom: '1px solid #eee' };
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' };

export default AdminPanel;
