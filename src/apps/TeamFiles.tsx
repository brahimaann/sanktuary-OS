import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UserButton, useAuth } from '@clerk/react';
import { useWindowManager } from '../wm/manager';
import { getCookie } from '../utils/cookies';
import { useTeamLogin } from '../utils/teamLogin';
import { fileIcon, formatSize, hasThumb, isTouch } from './fileTypes';
import { RANK, Rights } from '../utils/api';
import { dialog } from '../utils/dialog';
import { DRAG_FILE, Ref } from '../utils/refs';
import ShareDialog from './ShareDialog';

interface TeamFilesProps {
  app: string; // space id from the admin panel ("me" = personal space)
  name: string; // shown in the title/address bar
  initialPath?: string[]; // open straight into a subfolder (links from chat/activity)
}

interface Entry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface Upload {
  file: File;
  rel: string[]; // path under the current folder, e.g. ['stems', 'kick.wav'] for folder drops
  replace?: boolean; // edit rights: swap in and keep the old file as a version
}

const CHUNK = 32 * 1024 * 1024; // Cloudflare rejects request bodies over 100 MB
const PARALLEL_FILES = 3;
const PARALLEL_CHUNKS = 3;

/** Runs worker over items with at most `n` running at once; rejects on the first failure. */
async function pool<T>(items: T[], n: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

export const fileUrl = (app: string, parts: string[]) => `/api/files/${app}/${parts.map(encodeURIComponent).join('/')}`;

/**
 * Win98 Explorer-style window onto a team folder on the home server.
 * Requires a Clerk sign-in; the server checks it and reads the drive directly.
 */
const TeamFiles: React.FC<TeamFilesProps> = ({ app, name, initialPath }) => {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { openWindow } = useWindowManager();
  const [path, setPath] = useState<string[]>(initialPath || []);
  const [sharing, setSharing] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [token, setToken] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState<Rights>('view');
  const [quota, setQuota] = useState<{ used: number; quota: number } | null>(null);
  const [versions, setVersions] = useState<{ file: string; list: Entry[] } | null>(null);
  const [view, setView] = useState<'list' | 'icons'>(() => {
    try {
      return localStorage.getItem('sk_files_view') === 'icons' ? 'icons' : 'list';
    } catch {
      return 'list';
    }
  });
  const uploadRef = useRef<HTMLInputElement>(null);

  const url = (parts: string[]) => fileUrl(app, parts);
  const can = (level: Rights) => RANK[rights] >= RANK[level];
  const call = async (target: string, method: string) => {
    const res = await fetch(target, { method, headers: { Authorization: `Bearer ${await getToken()}` } });
    if (!res.ok) throw new Error(await res.text());
    return res;
  };

  const load = useCallback(async () => {
    setStatus('Loading...');
    const t = (await getToken()) || '';
    setToken(t);
    const res = await fetch(`${url(path)}?list`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) {
      setEntries([]);
      setStatus(res.status === 401 ? 'Access denied.' : res.status === 503 ? 'Drive offline — try again soon.' : await res.text());
      return;
    }
    const data = await res.json();
    const list: Entry[] = data.entries;
    setRights(data.rights);
    setQuota(data.quota ? { used: data.used, quota: data.quota } : null);
    list.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    setEntries(list);
    setSelected(null);
    setStatus('');
  }, [app, path, getToken]);

  useEffect(() => {
    if (isSignedIn) load();
  }, [isSignedIn, load]);

  const setViewMode = (v: 'list' | 'icons') => {
    setView(v);
    try {
      localStorage.setItem('sk_files_view', v);
    } catch {}
  };

  const open = (e: Entry) => {
    if (e.isDir) return setPath([...path, e.name]);
    openWindow({
      id: `preview-${app}-${[...path, e.name].join('/')}`,
      title: e.name,
      icon: fileIcon(e.name, false),
      appType: 'file-preview',
      appProps: { app, dir: path, name: e.name, siblings: entries.filter((x) => !x.isDir).map((x) => x.name) },
      width: 720,
      height: 520,
    });
  };

  // One chunk via XHR so we get upload progress (fetch can't report it).
  const putChunk = (target: string, body: Blob, onProgress: (loaded: number) => void) =>
    new Promise<void>(async (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', target);
      xhr.setRequestHeader('Authorization', `Bearer ${await getToken()}`);
      xhr.upload.onprogress = (ev) => onProgress(ev.loaded);
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(body);
    });

  const uploadAll = async (items: Upload[]) => {
    if (!items.length || busy) return;
    // Same name already here? Editors choose: replace (old one kept as a version) or keep both.
    const clashes = items.filter((u) => u.rel.length === 1 && entries.some((e) => !e.isDir && e.name === u.rel[0]));
    if (
      clashes.length &&
      can('edit') &&
      (await dialog.confirm(
        `${clashes.length} file(s) already exist here:\n${clashes
          .map((u) => u.rel[0])
          .slice(0, 8)
          .join('\n')}\n\nReplace them? The old versions are kept.`,
        { title: 'Confirm File Replace', icon: 'warning', ok: 'Replace', cancel: 'Keep both' },
      ))
    ) {
      clashes.forEach((u) => (u.replace = true));
    }
    setBusy(true);
    const total = items.reduce((n, u) => n + u.file.size, 0) || 1;
    const sent = new Map<string, number>(); // bytes sent per in-flight chunk, for one combined progress figure
    let filesDone = 0;
    const progress = () => {
      const bytes = [...sent.values()].reduce((a, b) => a + b, 0);
      setStatus(`Uploading ${filesDone}/${items.length} done — ${Math.floor((bytes / total) * 100)}%`);
    };
    try {
      // Several files at once, and several chunks of each big file at once: one connection through
      // Cloudflare is often throttled, parallel ones fill the line.
      await pool(items, PARALLEL_FILES, async ({ file, rel, replace }) => {
        const id = crypto.randomUUID();
        const chunks = Math.max(1, Math.ceil(file.size / CHUNK));
        const base = `${url([...path, ...rel])}?upload=${id}&chunks=${chunks}&size=${file.size}&chunkSize=${CHUNK}${replace ? '&replace=1' : ''}`;
        await pool([...Array(chunks).keys()], PARALLEL_CHUNKS, (c) =>
          putChunk(`${base}&chunk=${c}`, file.slice(c * CHUNK, (c + 1) * CHUNK), (loaded) => {
            sent.set(`${id}:${c}`, loaded);
            progress();
          }),
        );
        filesDone++;
        progress();
      });
      setStatus('');
    } catch (err) {
      setStatus(`Upload stopped: ${(err as Error).message}`);
    }
    setBusy(false);
    load();
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const roots = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[];
    const items: Upload[] = [];
    const walk = async (entry: FileSystemEntry, rel: string[]): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
        items.push({ file, rel: [...rel, entry.name] });
        return;
      }
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        // readEntries returns results in batches of ~100
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, [...rel, entry.name]);
      } while (batch.length);
    };
    setStatus('Reading dropped files...');
    for (const r of roots) await walk(r, []);
    uploadAll(items);
  };

  const newFolder = async () => {
    const folder = (await dialog.prompt('New folder name:', 'New Folder', { title: 'New Folder' }))?.trim();
    if (!folder) return;
    const res = await fetch(`${url([...path, folder])}?mkdir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    res.ok ? load() : setStatus(res.status === 409 ? 'A folder with that name already exists.' : `Couldn't create folder (${res.status}).`);
  };

  const pick = entries.find((e) => e.name === selected);

  const renameSelected = async () => {
    const to = pick && (await dialog.prompt('Rename to:', pick.name, { title: 'Rename' }))?.trim();
    if (!pick || !to || to === pick.name) return;
    try {
      await call(`${url([...path, pick.name])}?rename=${encodeURIComponent(to)}`, 'POST');
      load();
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const deleteSelected = async () => {
    if (
      !pick ||
      !(await dialog.confirm(
        `Are you sure you want to delete "${pick.name}"?\n\nIt goes to the space's trash (.sk-trash) and can be recovered by an admin.`,
        { title: 'Confirm File Delete', icon: 'warning' },
      ))
    )
      return;
    try {
      await call(url([...path, pick.name]), 'DELETE');
      load();
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const showVersions = async () => {
    if (!pick || pick.isDir) return;
    try {
      const list: Entry[] = await (await call(`${url([...path, pick.name])}?versions`, 'GET')).json();
      setVersions({ file: pick.name, list: list.sort((a, b) => b.name.localeCompare(a.name)) });
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const restore = async (version: string) => {
    if (
      !versions ||
      !(await dialog.confirm(`Restore this version of "${versions.file}"?\nThe current file is kept as a version too.`, {
        title: 'Restore',
      }))
    )
      return;
    try {
      await call(`${url([...path, versions.file])}?restore=${encodeURIComponent(version)}`, 'POST');
      setVersions(null);
      load();
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name={name} />;

  const rowProps = (e: Entry) => ({
    onClick: () => (isTouch ? open(e) : setSelected(e.name)),
    onDoubleClick: () => open(e),
    draggable: true,
    onDragStart: (ev: React.DragEvent) =>
      ev.dataTransfer.setData(DRAG_FILE, JSON.stringify({ app, dir: path, name: e.name, isDir: e.isDir })),
  });

  return (
    <div
      style={shell}
      onDragOver={(e) => {
        e.preventDefault();
        if (can('upload')) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => (can('upload') ? onDrop(e) : e.preventDefault())}
    >
      <div style={toolbar}>
        <button style={button} disabled={!path.length} onClick={() => setPath(path.slice(0, -1))}>
          Up
        </button>
        {can('upload') && (
          <button style={button} disabled={busy} onClick={() => uploadRef.current?.click()}>
            Upload...
          </button>
        )}
        {can('upload') && (
          <button style={button} onClick={newFolder}>
            New Folder
          </button>
        )}
        {can('edit') && (
          <button style={button} disabled={!pick} onClick={renameSelected}>
            Rename
          </button>
        )}
        {can('upload') && (
          <button style={button} disabled={!pick} onClick={deleteSelected} title="You can delete what you added">
            Delete
          </button>
        )}
        <button
          style={button}
          disabled={!pick}
          title="Folders download as a .zip"
          onClick={async () =>
            pick && window.open(`${url([...path, pick.name])}?${pick.isDir ? 'zip' : 'download'}&t=${await getToken()}`, '_blank')
          }
        >
          Download
        </button>
        <button style={button} disabled={!pick || pick.isDir} onClick={showVersions}>
          Versions
        </button>
        <button style={button} disabled={!pick} onClick={() => setSharing(true)}>
          Share...
        </button>
        <button style={button} onClick={load}>
          Refresh
        </button>
        <button style={button} onClick={() => setViewMode(view === 'list' ? 'icons' : 'list')}>
          {view === 'list' ? 'Icons' : 'Details'}
        </button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            uploadAll([...(e.target.files || [])].map((file) => ({ file, rel: [file.name] })));
            e.target.value = '';
          }}
        />
        <div style={{ flex: 1 }} />
        <UserButton />
      </div>
      <div style={address}>
        <span style={{ color: '#444', marginRight: 6 }}>Address</span>
        <div style={addressBox}>\\SANKTUARY\{[name, ...path].join('\\')}</div>
      </div>
      <div style={{ ...listBox, position: 'relative' }}>
        {view === 'list' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Size', 'Modified'].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.name} {...rowProps(e)} style={selected === e.name ? selectedStyle : undefined}>
                  <td style={td}>
                    <img
                      src={fileIcon(e.name, e.isDir)}
                      alt=""
                      style={{ width: 16, height: 16, verticalAlign: 'middle', marginRight: 4 }}
                    />
                    {e.name}
                  </td>
                  <td style={td}>{e.isDir ? '' : formatSize(e.size)}</td>
                  <td style={td}>{new Date(e.modified).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={grid}>
            {entries.map((e) => (
              <div key={e.name} {...rowProps(e)} style={tile} title={e.name}>
                <div style={thumbBox}>
                  {!e.isDir && hasThumb(e.name) && token ? (
                    <img
                      src={`${url([...path, e.name])}?thumb&t=${token}`}
                      alt=""
                      loading="lazy"
                      style={{ maxWidth: '100%', maxHeight: '100%' }}
                      onError={(ev) => {
                        (ev.target as HTMLImageElement).src = fileIcon(e.name, false, 32);
                      }}
                    />
                  ) : (
                    <img src={fileIcon(e.name, e.isDir, 32)} alt="" style={{ width: 32, height: 32 }} />
                  )}
                </div>
                <div style={{ ...tileLabel, ...(selected === e.name ? selectedStyle : {}) }}>{e.name}</div>
              </div>
            ))}
          </div>
        )}
        {dragging && <div style={dropOverlay}>Drop files or folders to upload to {[name, ...path].join(' \\ ')}</div>}
        {sharing && pick && (
          <ShareDialog
            item={{ kind: pick.isDir ? 'folder' : 'file', title: pick.name, app, dir: path, name: pick.name } as Ref}
            onClose={(sent) => {
              setSharing(false);
              if (sent) setStatus(`Shared ${pick.name} to ${sent}.`);
            }}
          />
        )}
        {versions && (
          <div
            style={{
              position: 'absolute',
              inset: 8,
              background: '#c0c0c0',
              border: '2px outset #fff',
              display: 'flex',
              flexDirection: 'column',
              padding: 8,
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 700 }}>Earlier versions of {versions.file}</div>
            <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080' }}>
              {versions.list.length === 0 && (
                <div style={{ padding: 6 }}>No earlier versions yet. Versions are saved when a file is replaced.</div>
              )}
              {versions.list.map((v) => (
                <div
                  key={v.name}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderBottom: '1px solid #eee' }}
                >
                  <span style={{ flex: 1 }}>
                    {new Date(v.modified).toLocaleString()} · {formatSize(v.size)}
                  </span>
                  <button
                    style={button}
                    onClick={async () =>
                      window.open(
                        `${url([...path, versions.file])}?version=${encodeURIComponent(v.name)}&download&name=${encodeURIComponent(versions.file)}&t=${await getToken()}`,
                        '_blank',
                      )
                    }
                  >
                    Download
                  </button>
                  {can('edit') && (
                    <button style={button} onClick={() => restore(v.name)}>
                      Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={button} onClick={() => setVersions(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      <div style={statusBar}>
        {status ||
          `${entries.length} object(s) · ${{ none: '', view: 'view only', upload: 'you can upload and delete your own files', edit: 'full edit' }[rights]}${quota ? ` · ${formatSize(quota.used)} of ${formatSize(quota.quota)} used` : ''} — ${isTouch ? 'tap' : 'double-click'} to open${can('upload') ? ' · drag files here to upload' : ''}`}
      </div>
    </div>
  );
};

/** Win98 "Enter Network Password" style log-on dialog. */
export const LogOn: React.FC<{ name: string }> = ({ name }) => {
  const { login, verify } = useTeamLogin();
  const [nickname, setNickname] = useState(getCookie('hq_os_username') || '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (needCode) {
      setError((await verify(code)) || '');
    } else {
      const r = await login(nickname.trim(), password);
      setError(r.error || '');
      setNeedCode(r.needCode || '');
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} style={{ ...shell, padding: 16, gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <img src="/images/icons/network-32x32.png" alt="" style={{ width: 32, height: 32 }} />
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Enter Network Password</div>
          <div>{name} is for the Sanktuary team. Log on with your operator ID and access code.</div>
        </div>
      </div>
      <label style={field}>
        Operator ID:
        <input
          style={inputBox}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
        />
      </label>
      <label style={field}>
        Access code:
        <input
          style={inputBox}
          type="password"
          value={password}
          disabled={!!needCode}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {needCode && (
        <>
          <div style={{ color: '#000080' }}>{needCode}</div>
          <label style={field}>
            Code:
            <input
              style={inputBox}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
            />
          </label>
        </>
      )}
      {error && <div style={{ color: '#a00000' }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={button} type="submit" disabled={busy || !nickname.trim() || !password || (!!needCode && !code.trim())}>
          {busy ? 'Checking...' : needCode ? 'Confirm' : 'OK'}
        </button>
      </div>
    </form>
  );
};

/* ── Styles ── */
export const shell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#c0c0c0',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11,
  overflow: 'hidden',
};
export const toolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 4px',
  borderBottom: '1px solid #808080',
  flexWrap: 'wrap',
};
export const button: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 8px',
  background: '#c0c0c0',
  minHeight: isTouch ? 32 : undefined,
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #000',
  borderBottom: '1px solid #000',
};
const address: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '3px 4px' };
const addressBox: React.CSSProperties = {
  flex: 1,
  background: '#fff',
  border: '2px inset #808080',
  padding: '1px 4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};
const listBox: React.CSSProperties = { flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: '0 2px' };
const th: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  textAlign: 'left',
  fontWeight: 400,
  padding: '1px 6px',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #808080',
  borderBottom: '1px solid #808080',
};
const td: React.CSSProperties = { padding: isTouch ? '8px 6px' : '1px 6px', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none' };
const selectedStyle: React.CSSProperties = { background: '#000080', color: '#fff' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, padding: 8 };
const tile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  cursor: 'default',
  userSelect: 'none',
};
const thumbBox: React.CSSProperties = { width: 88, height: 88, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const tileLabel: React.CSSProperties = { maxWidth: 96, textAlign: 'center', wordBreak: 'break-word', lineHeight: 1.2, padding: '0 2px' };
const dropOverlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 16,
  background: 'rgba(0,0,128,0.15)',
  border: '2px dashed #000080',
  color: '#000080',
  fontWeight: 700,
  pointerEvents: 'none',
};
const field: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 6 };
const inputBox: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: isTouch ? 16 : 11,
  padding: '2px 4px',
  background: '#fff',
  border: '2px inset #808080',
  minWidth: 0,
};
export const statusBar: React.CSSProperties = {
  padding: '2px 6px',
  border: '1px inset #808080',
  margin: 2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export default TeamFiles;
