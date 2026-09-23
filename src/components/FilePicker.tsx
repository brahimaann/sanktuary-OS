import React, { useEffect, useState } from 'react';
import { useApi, useMe } from '../utils/api';
import { fileIcon } from '../apps/fileTypes';

export interface FileRef {
  space: string;
  path: string; // "folder/sub/file.wav", relative to the space
}

/** Win98 "Open" dialog over a team space: pick a file (optionally filtered) or a folder. */
const FilePicker: React.FC<{
  title: string;
  mode: 'file' | 'folder';
  accept?: (name: string) => boolean;
  start?: FileRef | null;
  onPick: (ref: FileRef | null) => void; // null = cancelled
}> = ({ title, mode, accept, start, onPick }) => {
  const api = useApi();
  const { me } = useMe();
  const spaces = (me?.spaces || []).filter((s) => s.online);
  const [space, setSpace] = useState(start?.space || '');
  const [dir, setDir] = useState<string[]>(start ? start.path.split('/').slice(0, mode === 'file' ? -1 : undefined) : []);
  const [entries, setEntries] = useState<{ name: string; isDir: boolean }[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(mode === 'file' && start ? start.path.split('/').pop()! : null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!space && spaces[0]) setSpace(spaces[0].id);
  }, [space, spaces]);
  useEffect(() => {
    if (!space) return;
    setEntries(null);
    api(`/api/files/${space}/${dir.map(encodeURIComponent).join('/')}?list`).then(
      (d) => {
        setEntries(
          d.entries.sort(
            (a: any, b: any) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }),
          ),
        );
        setErr('');
      },
      (e) => setErr(e.message),
    );
  }, [api, space, dir]);

  const shown = (entries || []).filter((e) => e.isDir || (mode === 'file' && (!accept || accept(e.name))));
  const ok = mode === 'folder' ? dir.length > 0 : !!chosen;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div style={{ width: 'min(420px, 96%)', background: '#c0c0c0', border: '2px outset #fff', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: 'linear-gradient(90deg,#000080,#1084d0)', color: '#fff', fontWeight: 700, padding: '3px 6px' }}>
          {title}
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Look in
            <select
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setDir([]);
                setChosen(null);
              }}
              style={field}
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button style={btn} disabled={!dir.length} onClick={() => (setDir(dir.slice(0, -1)), setChosen(null))}>
              Up
            </button>
          </div>
          <div style={{ ...field, padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            \{dir.join('\\')}
          </div>
          <div style={{ height: 220, overflow: 'auto', background: '#fff', border: '2px inset #808080' }}>
            {err && <div style={{ padding: 6, color: '#a00000' }}>{err}</div>}
            {!err && !entries && <div style={{ padding: 6 }}>Loading...</div>}
            {entries && !shown.length && <div style={{ padding: 6, color: '#666' }}>Nothing to pick here.</div>}
            {shown.map((e) => (
              <div
                key={e.name}
                onClick={() => (e.isDir ? (setDir([...dir, e.name]), setChosen(null)) : setChosen(e.name))}
                style={{
                  display: 'flex',
                  gap: 4,
                  alignItems: 'center',
                  padding: '3px 6px',
                  cursor: 'default',
                  ...(chosen === e.name ? { background: '#000080', color: '#fff' } : {}),
                }}
              >
                <img src={fileIcon(e.name, e.isDir)} alt="" style={{ width: 16, height: 16 }} />
                {e.name}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={btn} onClick={() => onPick(null)}>
              Cancel
            </button>
            <button
              style={{ ...btn, fontWeight: 700 }}
              disabled={!ok}
              onClick={() => onPick({ space, path: [...dir, ...(mode === 'file' ? [chosen!] : [])].join('/') })}
            >
              {mode === 'folder' ? 'Use this folder' : 'Open'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const field: React.CSSProperties = { fontFamily: 'inherit', fontSize: 11, background: '#fff', border: '2px inset #808080' };
const btn: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 10px',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #000',
  borderBottom: '1px solid #000',
};

export default FilePicker;
