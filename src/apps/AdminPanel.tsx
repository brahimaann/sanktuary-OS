import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, Rights } from '../utils/api';
import { formatSize } from './fileTypes';
import { dialog } from '../utils/dialog';
import { LogOn, shell, button, statusBar } from './TeamFiles';

interface Space {
  id: string;
  name: string;
  drive: string;
  path: string;
  everyone: Rights;
  access: Record<string, Rights>;
}
interface Config {
  admins: string[];
  drives: Record<string, { name: string; enabled: boolean }>;
  spaces: Space[];
  members: Record<string, { drive?: string; quotaGB?: number }>;
  backup: { drive: string | null; hour: number };
}
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
}

const TABS = ['Health', 'Drives', 'Spaces', 'Members', 'Backups', 'Blog', 'Log'] as const;
const RIGHTS: Rights[] = ['none', 'view', 'upload', 'edit'];

/** Admin panel: server health, which drives are connected, who can reach what, members, backups. */
const AdminPanel: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  const api = useApi();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Health');
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [msg, setMsg] = useState('');
  const [picking, setPicking] = useState<number | null>(null); // space whose folder is being browsed

  const load = useCallback(async () => {
    try {
      const s: State = await api('/api/admin/state');
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
          </>
        )}

        {tab === 'Spaces' && (
          <>
            <p style={hint}>
              A space is a folder on a connected drive that you share with the team. Rights: <b>view</b> (browse, preview, download) ·{' '}
              <b>upload</b> (+ add files and folders) · <b>edit</b> (+ replace, rename). Members can only delete (to trash) what they added
              themselves; admins can delete anything. Removing a space never deletes files.
            </p>
            {draft.spaces.map((s, i) => (
              <fieldset key={i} style={fieldset}>
                <legend>{s.name || 'New space'}</legend>
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
                  <label>
                    Drive{' '}
                    <select
                      style={input}
                      value={s.drive}
                      onChange={(e) =>
                        edit((c) => {
                          c.spaces[i].drive = e.target.value;
                        })
                      }
                    >
                      {driveIds.map((id) => (
                        <option key={id} value={id}>
                          {driveName(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Folder{' '}
                    <input
                      style={input}
                      value={s.path}
                      placeholder="(whole drive)"
                      onChange={(e) =>
                        edit((c) => {
                          c.spaces[i].path = e.target.value;
                        })
                      }
                    />
                  </label>
                  <button style={button} onClick={() => setPicking(i)}>
                    Browse...
                  </button>
                  <label>
                    Everyone{' '}
                    <RightsSelect
                      value={s.everyone}
                      onChange={(r) =>
                        edit((c) => {
                          c.spaces[i].everyone = r;
                        })
                      }
                    />
                  </label>
                  <button
                    style={button}
                    onClick={async () =>
                      (await dialog.confirm(`Remove the space "${s.name}"?\nFiles on the drive are not touched.`, { icon: 'warning' })) &&
                      edit((c) => {
                        c.spaces.splice(i, 1);
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                <div style={{ ...row, marginTop: 6 }}>
                  {usernames
                    .filter((u) => !draft.admins.includes(u))
                    .map((u) => (
                      <label key={u}>
                        {u}{' '}
                        <RightsSelect
                          value={s.access[u] || 'default'}
                          allowDefault
                          onChange={(r) =>
                            edit((c) => {
                              if (r === 'default') delete c.spaces[i].access[u];
                              else c.spaces[i].access[u] = r;
                            })
                          }
                        />
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}
            <button
              style={button}
              onClick={async () => {
                const name = (await dialog.prompt('Name of the new space:'))?.trim();
                if (name)
                  edit((c) => {
                    const id =
                      name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '') || 'space';
                    c.spaces.push({
                      id: c.spaces.some((x) => x.id === id) ? `${id}-${c.spaces.length}` : id,
                      name,
                      drive: driveIds.find((d) => c.drives[d]?.enabled) || driveIds[0],
                      path: '',
                      everyone: 'none',
                      access: {},
                    });
                  });
              }}
            >
              Add space...
            </button>
            {picking !== null && draft.spaces[picking] && (
              <FolderPicker
                drive={draft.spaces[picking].drive}
                driveName={driveName(draft.spaces[picking].drive)}
                start={draft.spaces[picking].path}
                onPick={(path) => {
                  if (path !== null)
                    edit((c) => {
                      c.spaces[picking].path = path;
                    });
                  setPicking(null);
                }}
              />
            )}
          </>
        )}

        {tab === 'Log' && <LogTab />}
        {tab === 'Blog' && <BlogTab />}

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

const RightsSelect: React.FC<{ value: string; allowDefault?: boolean; onChange: (r: any) => void }> = ({
  value,
  allowDefault,
  onChange,
}) => (
  <select style={input} value={value} onChange={(e) => onChange(e.target.value)}>
    {allowDefault && <option value="default">(everyone)</option>}
    {RIGHTS.map((r) => (
      <option key={r} value={r}>
        {r}
      </option>
    ))}
  </select>
);

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
