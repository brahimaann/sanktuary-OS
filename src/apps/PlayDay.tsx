import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { uploadFiles } from '../utils/upload';
import { FileRef } from '../components/FilePicker';
import { FOOTAGE_FOLDERS } from './ShotContent';
import { useWindowManager } from '../wm/manager';

/**
 * The day of a play (a shoot, a show, a session), made for a phone in your hand: the checklist as big rows to tap,
 * what's next, a camera button on each line that uploads straight into the project's Shoots folder, and everyone on
 * the crew sees the ticks as they land. It reads and writes the same `shots` list as the calendar entry.
 * Open it from the entry, or with a crew link: /?play=<entry id>.
 */
interface Shot {
  id: string;
  text: string;
  got: boolean;
  note: string;
  for?: string | null;
}
interface Entry {
  id: string;
  title: string;
  kind: string;
  start: string;
  time?: string;
  location?: string;
  people?: string[];
  folder?: FileRef | null;
  release?: string | null;
  shots?: Shot[];
}

export const openPlayDay = (openWindow: ReturnType<typeof useWindowManager.getState>['openWindow'], id: string, title = 'Play day') =>
  openWindow({
    id: `play-day-${id}`,
    title,
    icon: '/images/icons/video-16x16.png?v=2',
    appType: 'play-day',
    appProps: { id },
    width: 420,
    height: 640,
  });

const PlayDay: React.FC<{ id: string }> = ({ id }) => {
  const api = useApi();
  const { getToken } = useAuth();
  const [e, setE] = useState<Entry | null>(null);
  const [dest, setDest] = useState<FileRef | null>(null); // where captures go
  const [songs, setSongs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const shotFor = useRef<string | null>(null);

  const load = useCallback(
    () =>
      api('/api/timeline').then(
        (d: { items: Entry[] }) => {
          const x = d.items.find((i) => i.id === id);
          if (!x) return setMsg("This play isn't on the calendar any more, or you're not on it.");
          setE(x);
          setNotes({});
        },
        (err) => setMsg(err.message),
      ),
    [api, id],
  );
  useEffect(() => void load(), [load]);
  useLiveEvent('timeline', load);
  useEffect(() => {
    if (!e) return;
    api('/api/tracks').then(
      (d: { releases: { id: string; folder?: FileRef | null }[]; tracks: { id: string; title: string }[] }) => {
        setSongs(Object.fromEntries(d.tracks.map((t) => [t.id, t.title])));
        // The entry's own folder first, then the project's Shoots folder
        const r = d.releases.find((x) => x.id === e.release);
        setDest(e.folder || (r?.folder ? { space: r.folder.space, path: `${r.folder.path}/${FOOTAGE_FOLDERS.raw}` } : null));
      },
      () => {},
    );
  }, [api, e?.release, e?.folder]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e) return <div style={{ padding: 12 }}>{msg || 'Loading...'}</div>;
  const shots = e.shots || [];
  const got = shots.filter((s) => s.got).length;
  const next = shots.find((s) => !s.got);

  const put = async (list: Shot[]) => {
    setE({ ...e, shots: list }); // show it now; the live update confirms
    try {
      await api(`/api/timeline/${e.id}`, { method: 'PATCH', body: JSON.stringify({ shots: list }) });
    } catch (err) {
      setMsg((err as Error).message);
      load();
    }
  };
  const tick = (s: Shot, on: boolean) => {
    const list = shots.map((x) => (x.id === s.id ? { ...x, got: on } : x));
    put(list);
    if (!on) return;
    if (list.every((x) => x.got)) dialog.win(`Every shot captured. Next: edit.`);
    else dialog.done('Captured.');
  };
  const capture = async (files: FileList | null) => {
    const s = shots.find((x) => x.id === shotFor.current);
    if (!files?.length || !dest || !s) return;
    const day = `${e.start} ${e.title || e.kind}`.replace(/[<>:"|?*\\/]/g, '-').trim();
    const dir = [...dest.path.split('/').filter(Boolean), day];
    try {
      await uploadFiles(
        getToken,
        dest.space,
        dir,
        Array.from(files).map((f) => ({ file: f, name: `${String(shots.indexOf(s) + 1).padStart(2, '0')} ${f.name}` })),
        (n, of) => setMsg(`Uploading... ${Math.round((n / of) * 100)}%`),
      );
      setMsg('');
      const note = [s.note, `${files.length} file${files.length === 1 ? '' : 's'} in ${day}`].filter(Boolean).join(' · ');
      const list = shots.map((x) => (x.id === s.id ? { ...x, got: true, note } : x));
      put(list);
      if (list.every((x) => x.got)) dialog.win('Every shot captured. Next: edit.');
      else dialog.done('Filed.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const add = () => {
    const text = adding.trim();
    if (!text) return;
    setAdding('');
    put([...shots, { id: Math.random().toString(36).slice(2, 10), text, got: false, note: '' }]);
  };
  const when = new Date(`${e.start}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div
      className="play-day"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', color: '#000', fontSize: 15 }}
    >
      <div style={{ background: '#000', color: '#fff', padding: '10px 12px' }}>
        <div style={{ fontFamily: "'Silkscreen', monospace", fontSize: 11, letterSpacing: 1 }}>
          {e.kind === 'Shoot' ? 'FIELD OP' : e.kind.toUpperCase()} · {when}
          {e.time ? ` · ${e.time}` : ''}
        </div>
        <div style={{ fontFamily: "'Pixelify Sans', sans-serif", fontVariantLigatures: 'none', fontSize: 22, margin: '2px 0' }}>
          {e.title || e.kind}
        </div>
        {(e.location || e.people?.length) && (
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {[e.location, e.people?.length ? `Crew: ${e.people.join(', ')}` : ''].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {/* One cell per line: filled when it's captured */}
      <div style={{ padding: '8px 12px', borderBottom: '2px solid #000' }}>
        <div style={{ display: 'flex', gap: 3 }} aria-label={`${got} of ${shots.length} captured`}>
          {shots.map((s) => (
            <span key={s.id} style={{ flex: 1, height: 12, border: '2px solid #000', background: s.got ? 'var(--sk-signal)' : '#fff' }} />
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 13 }}>
          {!shots.length ? (
            'No checklist yet. Add the first line below.'
          ) : next ? (
            <>
              <b>Next:</b> {next.text}
            </>
          ) : (
            <b>All captured. Next: edit.</b>
          )}
          <span style={{ float: 'right', fontFamily: "'Silkscreen', monospace", fontSize: 11 }}>
            {got}/{shots.length}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {shots.map((s, i) => (
          <div key={s.id} style={{ borderBottom: '1px solid #000', padding: '8px 12px', background: s === next ? '#f2f2f2' : undefined }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
              <button
                onClick={() => tick(s, !s.got)}
                aria-pressed={s.got}
                aria-label={s.got ? `Un-tick ${s.text}` : `Captured: ${s.text}`}
                style={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  border: '2px solid #000',
                  background: s.got ? 'var(--sk-signal)' : '#fff',
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {s.got ? '✓' : ''}
              </button>
              <div style={{ flex: 1, minWidth: 0 }} onClick={() => tick(s, !s.got)}>
                <div style={{ textDecoration: s.got ? 'line-through' : undefined }}>
                  {i + 1}. {s.text}
                </div>
                {s.for && songs[s.for] && <div style={{ fontSize: 11, opacity: 0.7 }}>For {songs[s.for]}</div>}
              </div>
              {dest && (
                <button
                  title="Upload photos or video for this line into the project's Shoots folder"
                  onClick={() => {
                    shotFor.current = s.id;
                    file.current?.click();
                  }}
                  style={{ height: 40, padding: '0 10px', border: '2px solid #000', background: '#fff', cursor: 'pointer', flexShrink: 0 }}
                >
                  ⇪ Add
                </button>
              )}
            </div>
            <input
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginTop: 6,
                padding: '6px 8px',
                border: '1px solid #000',
                fontSize: 14,
                fontFamily: 'inherit',
              }}
              placeholder="Take, card, or what to redo"
              value={notes[s.id] ?? s.note}
              onChange={(ev) => setNotes({ ...notes, [s.id]: ev.target.value })}
              onBlur={() =>
                notes[s.id] !== undefined &&
                notes[s.id] !== s.note &&
                put(shots.map((x) => (x.id === s.id ? { ...x, note: notes[s.id] } : x)))
              }
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, padding: 12 }}>
          <input
            style={{ flex: 1, minWidth: 0, padding: '8px', border: '2px solid #000', fontSize: 15, fontFamily: 'inherit' }}
            placeholder="Add a line (e.g. wide of the car)"
            value={adding}
            onChange={(ev) => setAdding(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && add()}
          />
          <button onClick={add} disabled={!adding.trim()} style={{ padding: '0 14px', border: '2px solid #000', background: '#fff' }}>
            Add
          </button>
        </div>
      </div>

      <div style={{ borderTop: '2px solid #000', padding: '6px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ flex: 1 }}>
          {msg ||
            (dest
              ? `Uploads go to ${dest.path.split('/').slice(-2).join('/')}`
              : 'Tie this play to a project with a folder to upload from here.')}
        </span>
        <button
          title="Copy a link the crew can open on their phones"
          style={{ border: '1px solid #000', background: '#fff', padding: '4px 8px' }}
          onClick={() =>
            navigator.clipboard.writeText(`${location.origin}/?play=${e.id}`).then(
              () => dialog.done('Crew link copied.'),
              () => setMsg(`${location.origin}/?play=${e.id}`),
            )
          }
        >
          Crew link
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(ev) => (capture(ev.target.files), (ev.target.value = ''))}
      />
    </div>
  );
};

export default PlayDay;
