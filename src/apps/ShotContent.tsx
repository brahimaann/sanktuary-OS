import React, { useState } from 'react';
import { useApi } from '../utils/api';
import { useOpenRef } from '../utils/refs';
import FilePicker, { FileRef } from '../components/FilePicker';
import { button, fileKind } from './fileTypes';

/**
 * Shot content: the clips, reels, videos and photos made for a song, or for a whole project, each with where it's at
 * (To shoot, Shot, Edited, Posted) and its file in a team space. ContentList edits one list; ContentBoard shows every
 * project's progress, song by song, with what's left to do.
 */
export interface ContentItem {
  id: string;
  kind: string;
  title: string;
  status: string;
  file: FileRef | null;
  due: string | null;
}
interface Song {
  id: string;
  release: string;
  n: number;
  title: string;
  content?: ContentItem[];
}
interface Project {
  id: string;
  title: string;
  kind: string;
  content?: ContentItem[];
}

const KINDS = ['Clip', 'Reel', 'Video', 'Visualizer', 'BTS', 'Photos', 'Other'];
export const CONTENT_STEPS = ['To shoot', 'Shot', 'Edited', 'Posted'];
const NEXT: Record<string, string> = { 'To shoot': 'shoot', Shot: 'edit', Edited: 'post' };
const newId = () => Math.random().toString(36).slice(2, 10);
const media = (n: string) => ['video', 'image'].includes(fileKind(n));

/** Done share of a list: To shoot 0, Shot 1/3, Edited 2/3, Posted all of it. */
const progress = (items: ContentItem[]) =>
  items.length ? items.reduce((t, x) => t + CONTENT_STEPS.indexOf(x.status), 0) / (items.length * 3) : 0;

/** A 1-bit bar of ten cells, filled as far as the content has come. */
export const ContentBar: React.FC<{ items: ContentItem[]; width?: number }> = ({ items, width = 100 }) => {
  const p = progress(items);
  const filled = Math.round(p * 10);
  return (
    <span
      title={`${Math.round(p * 100)}% done: ${CONTENT_STEPS.map((s) => `${items.filter((x) => x.status === s).length} ${s.toLowerCase()}`).join(', ')}`}
      style={{ display: 'inline-flex', gap: 1, border: '1px solid #000', padding: 1, width, verticalAlign: 'middle' }}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} style={{ flex: 1, height: 8, background: i < filled ? '#000' : '#fff' }} />
      ))}
    </span>
  );
};

/** "2 to shoot · 3 shot · 1 posted" */
const counts = (items: ContentItem[]) =>
  CONTENT_STEPS.map((s) => [s, items.filter((x) => x.status === s).length] as const)
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(' · ') || 'nothing yet';

/** One song's (or project's) content: add, rename, move along, link the file. Saves every change. */
export const ContentList: React.FC<{ items: ContentItem[]; onSave: (items: ContentItem[]) => void; readOnly?: boolean }> = ({
  items,
  onSave,
  readOnly,
}) => {
  const api = useApi();
  const openRef = useOpenRef();
  const [picking, setPicking] = useState<null | { id: string; folder: boolean } | 'many'>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const set = (id: string, patch: Partial<ContentItem>) => onSave(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const open = (r: FileRef) => {
    const parts = r.path.split('/');
    const name = parts[parts.length - 1];
    openRef({ kind: name.includes('.') ? 'file' : 'folder', title: name, app: r.space, dir: parts.slice(0, -1), name });
  };
  // Every clip and picture in a folder becomes one Shot item (the shoot's card dump, say)
  const addFolder = async (r: FileRef) => {
    const d = await api(`/api/files/${r.space}/${r.path.split('/').map(encodeURIComponent).join('/')}?list`);
    const have = new Set(items.map((x) => x.file && `${x.file.space}/${x.file.path}`));
    const added: ContentItem[] = (d.entries as { name: string; isDir: boolean }[])
      .filter((e) => !e.isDir && media(e.name) && !have.has(`${r.space}/${r.path}/${e.name}`))
      .map((e) => ({
        id: newId(),
        kind: fileKind(e.name) === 'image' ? 'Photos' : 'Clip',
        title: e.name.replace(/\.[^.]+$/, ''),
        status: 'Shot',
        file: { space: r.space, path: `${r.path}/${e.name}` },
        due: null,
      }));
    if (added.length) onSave([...items, ...added]);
  };
  const field: React.CSSProperties = {
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '1px 3px',
    border: '1px solid #000',
    background: '#fff',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <ContentBar items={items} />
        <span>{counts(items)}</span>
        {!readOnly && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              style={button}
              onClick={() => onSave([...items, { id: newId(), kind: 'Clip', title: '', status: 'To shoot', file: null, due: null }])}
              title="Something to shoot, or something already shot"
            >
              + Add
            </button>
            <button style={button} onClick={() => setPicking('many')} title="Every clip and picture in a folder, marked Shot">
              From a folder...
            </button>
          </span>
        )}
      </div>
      {!!items.length && (
        <div>
          {items.map((x) => (
            <div
              key={x.id}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', padding: '2px 0', borderBottom: '1px solid #ddd' }}
            >
              <span style={{ display: 'flex', gap: 2 }}>
                <select style={field} value={x.kind} disabled={readOnly} onChange={(e) => set(x.id, { kind: e.target.value })}>
                  {KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </span>
              <span style={{ flex: '1 1 160px', minWidth: 0 }}>
                <input
                  style={{ ...field, width: '100%', boxSizing: 'border-box' }}
                  placeholder="What it is (e.g. hook in the car, 15 s)"
                  disabled={readOnly}
                  value={names[x.id] ?? x.title}
                  onChange={(e) => setNames({ ...names, [x.id]: e.target.value })}
                  onBlur={() => names[x.id] !== undefined && names[x.id] !== x.title && set(x.id, { title: names[x.id] })}
                />
              </span>
              <span style={{ display: 'flex', gap: 2 }}>
                <select
                  style={{ ...field, fontWeight: x.status === 'Posted' ? 400 : 700 }}
                  value={x.status}
                  disabled={readOnly}
                  onChange={(e) => set(x.id, { status: e.target.value })}
                >
                  {CONTENT_STEPS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </span>
              <span style={{ display: 'flex', gap: 2 }}>
                <input
                  type="date"
                  style={field}
                  title="Due"
                  disabled={readOnly}
                  value={x.due || ''}
                  onChange={(e) => set(x.id, { due: e.target.value || null })}
                />
              </span>
              <span style={{ display: 'flex', gap: 2 }}>
                {x.file && (
                  <button style={button} onClick={() => open(x.file!)} title={x.file.path}>
                    Open
                  </button>
                )}
                {!readOnly && (
                  <button
                    style={button}
                    onClick={() => setPicking({ id: x.id, folder: x.kind === 'Photos' })}
                    title={x.kind === 'Photos' ? 'The folder of photos' : 'The clip or video in Files'}
                  >
                    {x.file ? 'File...' : 'Link file...'}
                  </button>
                )}
                {!readOnly && (
                  <button style={button} title="Remove" onClick={() => onSave(items.filter((y) => y.id !== x.id))}>
                    ✕
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {picking && (
        <FilePicker
          title={picking === 'many' ? 'The folder with the clips' : picking.folder ? 'The folder of photos' : 'The clip or video'}
          mode={picking === 'many' || picking.folder ? 'folder' : 'file'}
          accept={media}
          start={picking !== 'many' ? items.find((x) => x.id === picking.id)?.file : null}
          onPick={(r) => {
            const p = picking;
            setPicking(null);
            if (!r) return;
            if (p === 'many') return void addFolder(r);
            const x = items.find((y) => y.id === p.id);
            set(p.id, {
              file: r,
              title:
                x?.title ||
                r.path
                  .split('/')
                  .pop()!
                  .replace(/\.[^.]+$/, ''),
              status: x?.status === 'To shoot' ? 'Shot' : x?.status,
            });
          }}
        />
      )}
    </div>
  );
};

/** Every project's content, song by song: a bar each, what's left, and the list to edit right there. */
export const ContentBoard: React.FC<{
  releases: Project[];
  tracks: Song[];
  onSaveSong: (t: Song, items: ContentItem[]) => void;
  onSaveProject: (r: Project, items: ContentItem[]) => void;
  onOpenSong: (t: Song) => void;
}> = ({ releases, tracks, onSaveSong, onSaveProject, onOpenSong }) => {
  const [open, setOpen] = useState<string | null>(null); // a song id, or 'p:' + a project id
  const [showEmpty, setShowEmpty] = useState(false);
  const projects = releases
    .filter((r) => r.kind !== 'Playlist')
    .map((r) => {
      const songs = tracks.filter((t) => t.release === r.id).sort((a, b) => a.n - b.n);
      const all = [...(r.content || []), ...songs.flatMap((t) => t.content || [])];
      return { r, songs, all };
    })
    .sort((a, b) => Number(!a.all.length) - Number(!b.all.length) || a.r.title.localeCompare(b.r.title));
  const shown = projects.filter((p) => showEmpty || p.all.length);
  const left = (items: ContentItem[]) => {
    const todo = items.filter((x) => x.status !== 'Posted');
    if (!todo.length) return items.length ? 'All posted ✓' : '';
    const by = (s: string) => todo.filter((x) => x.status === s).length;
    return CONTENT_STEPS.slice(0, 3)
      .filter((s) => by(s))
      .map((s) => `${NEXT[s]} ${by(s)}`)
      .join(', ');
  };
  const row = (key: string, label: React.ReactNode, items: ContentItem[], save: (items: ContentItem[]) => void, song?: Song) => (
    <React.Fragment key={key}>
      <tr onClick={() => setOpen(open === key ? null : key)} style={{ cursor: 'pointer' }} title="Show and edit its content">
        <td style={td}>
          {open === key ? '▼' : '►'} {label}
        </td>
        <td style={td}>
          <ContentBar items={items} width={80} />
        </td>
        <td style={{ ...td, whiteSpace: 'normal' }}>{counts(items)}</td>
        <td style={{ ...td, whiteSpace: 'normal', fontWeight: 700 }}>{left(items)}</td>
      </tr>
      {open === key && (
        <tr>
          <td colSpan={4} style={{ padding: '4px 8px 8px 20px', borderBottom: '1px solid #000' }}>
            <ContentList items={items} onSave={save} />
            {song && (
              <button style={{ ...button, marginTop: 4 }} onClick={() => onOpenSong(song)}>
                Song page
              </button>
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  );
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Clips, reels, videos and photos shot for each song, and what's left: shoot, edit, post.</span>
        <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Projects with nothing yet
        </label>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', minWidth: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {shown.map(({ r, songs, all }) => (
              <React.Fragment key={r.id}>
                <tr style={{ background: '#000', color: '#fff' }}>
                  <td style={{ ...td, fontWeight: 700, borderBottom: 0 }}>
                    {r.title} <span style={{ fontWeight: 400 }}>({r.kind})</span>
                  </td>
                  <td style={{ ...td, borderBottom: 0 }}>
                    <span style={{ background: '#fff', display: 'inline-block' }}>
                      <ContentBar items={all} width={80} />
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'normal', borderBottom: 0 }}>{counts(all)}</td>
                  <td style={{ ...td, whiteSpace: 'normal', borderBottom: 0, fontWeight: 700 }}>{left(all)}</td>
                </tr>
                {row(`p:${r.id}`, <i>Whole project</i>, r.content || [], (items) => onSaveProject(r, items))}
                {songs.map((t) => row(t.id, t.title, t.content || [], (items) => onSaveSong(t, items), t))}
              </React.Fragment>
            ))}
            {!shown.length && (
              <tr>
                <td style={td}>Nothing tracked yet. Tick "Projects with nothing yet", open a song and click + Add or From a folder...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const td: React.CSSProperties = { padding: '3px 6px', whiteSpace: 'nowrap', borderBottom: '1px solid #eee', verticalAlign: 'middle' };
