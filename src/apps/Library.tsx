import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { LogOn, shell, button, statusBar } from './TeamFiles';
import { IconLabel } from '../components/RetroIcon';
import Archive from './Archive';

/**
 * Library: the team's shared culture. Books we read and recommend, Renaissance Radio (our own tracks, uploaded and
 * played here, one after another) and our archive of old and scrapped projects. Every entry carries a blurb on why it's here; others co-sign what they back.
 */
interface Entry {
  id: string;
  kind: 'Book' | 'Classic' | 'Archive';
  title: string;
  by: string;
  year: string;
  blurb: string;
  link: string;
  cosigns: string[];
  addedBy: string;
  created: string;
  audio?: string;
  updated?: string;
}

const SECTIONS: [Entry['kind'], string, string][] = [
  ['Book', 'Books', 'Books we read and recommend, and why. Also shown on CITIES > Library.'],
  ['Classic', 'Renaissance Radio', 'Our tracks: upload a song and it plays here, one after another. Also shown on CITIES > Library.'],
  ['Archive', 'Archive', 'Our own history: old work and scrapped projects worth keeping. Team only.'],
];
const PLACEHOLDER = {
  Book: { title: 'Book title', by: 'Author', blurb: 'Why we recommend it' },
  Classic: { title: 'Song', by: 'Artist', blurb: 'The story behind it' },
  Archive: { title: 'Project', by: 'Who made it', blurb: 'What it was, and why it stopped' },
};
const AUDIO = '.mp3,.m4a,.wav,.ogg';

const Library: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Library" />;
  return <LibraryApp />;
};

const LibraryApp: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [kind, setKind] = useState<Entry['kind']>('Book');
  const [draft, setDraft] = useState({ title: '', by: '', year: '', link: '', blurb: '' });
  const [track, setTrack] = useState<File | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(
    () =>
      api('/api/library').then(
        (d) => setItems(d.items),
        (e) => setMsg(e.message),
      ),
    [api],
  );
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('library', load);
  if (!items) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;

  const call = (path: string, method: string, body?: object | File) =>
    api(path, { method, body: body instanceof File ? body : body && JSON.stringify(body) }).then(
      () => (setMsg(''), load()),
      (e) => {
        setMsg(e.message);
        throw e;
      },
    );
  const upload = (id: string, f: File) => {
    setMsg(`Uploading ${f.name}...`);
    return call(`/api/library/${id}/audio?name=${encodeURIComponent(f.name)}`, 'PUT', f);
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const o: Entry = await api('/api/library', { method: 'POST', body: JSON.stringify({ ...draft, kind }) });
      setDraft({ title: '', by: '', year: '', link: '', blurb: '' });
      setTrack(null);
      if (track && kind !== 'Book') await upload(o.id, track);
      else (setMsg(''), load());
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  // Radio: when a track ends, the next one with a track starts
  const playNext = (id: string) => {
    const rest = list.slice(list.findIndex((i) => i.id === id) + 1).find((i) => i.audio);
    if (rest) (document.getElementById(`lib-audio-${rest.id}`) as HTMLAudioElement | null)?.play();
  };
  const mine = (i: Entry) => !!me && (i.addedBy === me.username || me.admin);
  const list = items
    .filter((i) => i.kind === kind)
    .sort((a, b) => b.cosigns.length - a.cosigns.length || b.created.localeCompare(a.created));
  const ph = PLACEHOLDER[kind];

  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0', alignItems: 'center' }}>
        {SECTIONS.map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} style={{ ...button, fontWeight: kind === k ? 700 : 400 }}>
            {label} ({items.filter((i) => i.kind === k).length})
          </button>
        ))}
        <span style={{ marginLeft: 8, color: '#444' }}>{SECTIONS.find((s) => s[0] === kind)![2]}</span>
      </div>
      <form onSubmit={add} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: 4 }}>
        <input
          style={input}
          placeholder={ph.title}
          value={draft.title}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <input
          style={input}
          placeholder={ph.by}
          value={draft.by}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, by: e.target.value })}
        />
        <input
          style={{ ...input, width: 50 }}
          placeholder="Year"
          value={draft.year}
          maxLength={20}
          onChange={(e) => setDraft({ ...draft, year: e.target.value })}
        />
        <input
          style={input}
          placeholder="https:// link"
          value={draft.link}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
        />
        <textarea
          rows={2}
          style={{ ...input, flexBasis: '100%', resize: 'vertical' }}
          placeholder={ph.blurb}
          value={draft.blurb}
          maxLength={2000}
          onChange={(e) => setDraft({ ...draft, blurb: e.target.value })}
        />
        {kind !== 'Book' && (
          <label style={{ ...button, display: 'inline-flex', alignItems: 'center' }}>
            <IconLabel icon="upload">{track ? track.name : 'Track'}</IconLabel>
            <input type="file" accept={AUDIO} hidden onChange={(e) => setTrack(e.target.files?.[0] || null)} />
          </label>
        )}
        <button type="submit" style={{ ...button, fontWeight: 700 }} disabled={!draft.title.trim()}>
          <IconLabel icon="plus">Add</IconLabel>
        </button>
      </form>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: '0 4px' }}>
        {!list.length && (
          <div style={{ padding: 16, color: '#555' }}>Nothing here yet. Add the first one above, with a line on why it belongs.</div>
        )}
        {list.map((i) =>
          editing === i.id ? (
            <Editor
              key={i.id}
              entry={i}
              onCancel={() => setEditing(null)}
              onSave={(body) =>
                call(`/api/library/${i.id}`, 'PATCH', body).then(
                  () => setEditing(null),
                  () => {},
                )
              }
            />
          ) : (
            <div key={i.id} style={{ borderBottom: '1px solid #ddd', padding: '6px 8px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b>{i.title}</b>
                {i.by && <span style={{ color: '#444' }}>{i.by}</span>}
                {i.year && <span style={{ color: '#666' }}>· {i.year}</span>}
                {i.link && (
                  <a href={i.link} target="_blank" rel="noopener noreferrer">
                    {kind === 'Classic' ? 'listen' : 'link'}
                  </a>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ color: '#666' }}>
                  added by {i.addedBy}
                  {i.cosigns.length ? ` · co-signed by ${i.cosigns.join(', ')}` : ''}
                </span>
                {!!me && i.addedBy !== me.username && (
                  <button
                    style={button}
                    onClick={() => call(`/api/library/${i.id}`, 'PATCH', { cosign: !i.cosigns.includes(me.username) }).catch(() => {})}
                  >
                    {i.cosigns.includes(me.username) ? 'Co-signed' : 'Co-sign'}
                  </button>
                )}
                {mine(i) && (
                  <>
                    <button style={button} onClick={() => setEditing(i.id)}>
                      Edit
                    </button>
                    {kind !== 'Book' && (
                      <label style={button} title="Upload an MP3, M4A, WAV or OGG">
                        <IconLabel icon="upload">{i.audio ? 'Replace track' : 'Upload track'}</IconLabel>
                        <input
                          type="file"
                          accept={AUDIO}
                          hidden
                          onChange={(e) => e.target.files?.[0] && upload(i.id, e.target.files[0]).catch(() => {})}
                        />
                      </label>
                    )}
                    <button
                      style={button}
                      onClick={async () =>
                        (await dialog.confirm(`Remove "${i.title}" from the Library?`, { icon: 'warning' })) &&
                        call(`/api/library/${i.id}`, 'DELETE').catch(() => {})
                      }
                    >
                      <IconLabel icon="close">Remove</IconLabel>
                    </button>
                  </>
                )}
              </div>
              {i.blurb && <div style={{ marginTop: 3, whiteSpace: 'pre-wrap', color: '#222' }}>{i.blurb}</div>}
              {i.audio && (
                <audio
                  id={`lib-audio-${i.id}`}
                  src={`/api/library/${i.id}/audio?v=${encodeURIComponent(i.updated || '')}`}
                  controls
                  preload="none"
                  onEnded={() => playNext(i.id)}
                  style={{ display: 'block', width: '100%', maxWidth: 420, marginTop: 4 }}
                />
              )}
            </div>
          ),
        )}
        {kind === 'Archive' && (
          <div style={{ height: 260, display: 'flex', flexDirection: 'column', borderTop: '1px solid #808080' }}>
            <div style={{ padding: '4px 8px', fontWeight: 700 }}>From the vault: past releases and timeline</div>
            <Archive />
          </div>
        )}
      </div>
      <div style={statusBar}>{msg || `${items.length} entr${items.length === 1 ? 'y' : 'ies'} in the Library`}</div>
    </div>
  );
};

const Editor: React.FC<{ entry: Entry; onSave: (body: object) => void; onCancel: () => void }> = ({ entry, onSave, onCancel }) => {
  const [d, setD] = useState({ title: entry.title, by: entry.by, year: entry.year, link: entry.link, blurb: entry.blurb });
  return (
    <form
      onSubmit={(e) => (e.preventDefault(), onSave(d))}
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 8px', borderBottom: '1px solid #ddd' }}
    >
      <input style={input} value={d.title} maxLength={120} onChange={(e) => setD({ ...d, title: e.target.value })} />
      <input style={input} value={d.by} maxLength={120} onChange={(e) => setD({ ...d, by: e.target.value })} />
      <input style={{ ...input, width: 50 }} value={d.year} maxLength={20} onChange={(e) => setD({ ...d, year: e.target.value })} />
      <input
        style={input}
        placeholder="https:// link"
        value={d.link}
        maxLength={500}
        onChange={(e) => setD({ ...d, link: e.target.value })}
      />
      <textarea
        rows={3}
        style={{ ...input, flexBasis: '100%', resize: 'vertical' }}
        value={d.blurb}
        maxLength={2000}
        onChange={(e) => setD({ ...d, blurb: e.target.value })}
      />
      <button type="submit" style={{ ...button, fontWeight: 700 }} disabled={!d.title.trim()}>
        Save
      </button>
      <button type="button" style={button} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
};

const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
  minWidth: 0,
};

export default Library;
