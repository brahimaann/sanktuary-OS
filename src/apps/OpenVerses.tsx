import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { displayName, useProfiles } from '../utils/profiles';
import { useApi } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { uploadFiles } from '../utils/upload';
import { dialog } from '../utils/dialog';
import { fileUrl, button } from './TeamFiles';
import { lightAudio } from './fileTypes';
import MediaControls from '../components/MediaControls';
import { FileRef } from '../components/FilePicker';

// Open verses: the artists' group chat, moved in. Post a song with an open slot; someone hops on (which claims it, so
// two people don't record the same verse), uploads a take, and the poster picks one. The picked take becomes a song in
// the tracker. No splits or Ledger rows are made here: those come later, when the song is published.
export interface Verse {
  id: string;
  title: string;
  bpm: string;
  key: string;
  length: string;
  notes: string;
  deadline: string | null;
  beat: FileRef;
  slots: { id: string; label: string; by: string | null; at: string | null; take: FileRef | null }[];
  picked: string | null;
  track: string | null;
  by: string;
  created: string;
}
export type VerseSlot = Verse['slots'][number];

/** A notice about an open verse: Music opens on the board (now, or when it next opens). */
let wantVerses = false;
export const showVerses = () => {
  wantVerses = true;
  window.dispatchEvent(new Event('sk:open-verses'));
};
export const takeVersesWish = () => {
  const w = wantVerses;
  wantVerses = false;
  return w;
};

const AUDIO = 'audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a';
const dueIn = (d: string) => {
  const n = Math.round((Date.parse(d) - Date.parse(new Date().toLocaleDateString('en-CA'))) / 864e5);
  return n < 0 ? `${-n} day(s) late` : n === 0 ? 'due today' : n === 1 ? 'due tomorrow' : `due in ${n} days`;
};
const folderSafe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .slice(0, 60);

/** One <audio> + the shared Media Player controls, for a beat or a take. */
const Player: React.FC<{ file: FileRef }> = ({ file }) => {
  const { getToken } = useAuth();
  const media = useRef<HTMLMediaElement | null>(null);
  const [src, setSrc] = useState('');
  useEffect(() => {
    getToken().then((t) => setSrc(`${fileUrl(file.space, file.path.split('/'))}?${lightAudio(file.path) ? 'preview&' : ''}t=${t}`));
  }, [file.space, file.path, getToken]);
  if (!src) return null;
  return (
    <>
      <audio ref={(el) => void (media.current = el)} src={src} preload="metadata" />
      <MediaControls media={media} src={src} />
    </>
  );
};

const OpenVerses: React.FC<{
  me?: string;
  admin?: boolean;
  space: () => { id: string } | undefined;
  onPick: (v: Verse, s: VerseSlot) => Promise<string>; // makes the song in the tracker; returns its id
  onOpenTrack: (id: string) => void;
  setMsg: (m: string) => void;
}> = ({ me, admin, space, onPick, onOpenTrack, setMsg }) => {
  const api = useApi();
  const { getToken } = useAuth();
  const [items, setItems] = useState<Verse[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { byName } = useProfiles();
  const who = (u: string) => displayName(byName[u], u);
  const [show, setShow] = useState<'open' | 'all'>('open');
  const load = useCallback(
    () =>
      api('/api/verses').then(
        (d) => setItems(d.items),
        (e) => setMsg(e.message),
      ),
    [api, setMsg],
  );
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('verses', load);

  const upload = async (file: File, dir: string[]) => {
    const s = space();
    if (!s) throw new Error("You can't add files to any team space. Ask an admin for upload rights.");
    const [saved] = await uploadFiles(getToken, s.id, dir, [{ file, name: file.name }], (n, of) =>
      setMsg(`Uploading ${file.name}... ${Math.round((n / of) * 100)}%`),
    );
    return { space: s.id, path: [...dir, saved].join('/') };
  };
  const act = async (fn: () => Promise<unknown>, done = '') => {
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (v: Verse, body: object) => api(`/api/verses/${v.id}`, { method: 'PATCH', body: JSON.stringify(body) });

  if (!items) return <div style={{ flex: 1, padding: 8 }}>Loading...</div>;
  const openCount = (v: Verse) => (v.picked ? 0 : v.slots.filter((s) => !s.by).length);
  const shown = items.filter((v) => show === 'all' || (!v.picked && v.slots.some((s) => !s.by || s.by === me || v.by === me)));
  const v = items.find((x) => x.id === sel);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="sk-signal" style={{ ...button, fontWeight: 700 }} onClick={() => setPosting(true)} disabled={busy}>
          Post a song...
        </button>
        {(['open', 'all'] as const).map((k) => (
          <button
            key={k}
            style={{ ...button, ...(show === k ? { border: '2px inset #fff', fontWeight: 700 } : {}) }}
            onClick={() => setShow(k)}
          >
            {k === 'open' ? 'Open' : 'All'} ({k === 'open' ? items.filter((x) => openCount(x)).length : items.length})
          </button>
        ))}
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>Hop on to claim a slot. Everyone hears about new posts.</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 0, overflow: 'auto' }}>
        <div style={{ ...box, flex: v ? '1 1 300px' : 1, maxHeight: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Song', 'By', 'BPM / key', 'Open', 'Due'].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr
                  key={x.id}
                  onClick={() => setSel(x.id === sel ? null : x.id)}
                  className={x.id === sel ? 'sk-signal' : undefined}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ ...td, fontWeight: 700 }}>{x.title}</td>
                  <td style={td}>{who(x.by)}</td>
                  <td style={td}>{[x.bpm && `${x.bpm} BPM`, x.key].filter(Boolean).join(' · ')}</td>
                  <td style={td}>
                    {x.picked
                      ? 'Picked ✓'
                      : openCount(x)
                        ? x.slots
                            .filter((s) => !s.by)
                            .map((s) => s.label)
                            .join(', ')
                        : 'All claimed'}
                  </td>
                  <td style={td}>{x.deadline ? dueIn(x.deadline) : ''}</td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td style={td} colSpan={5}>
                    {items.length ? 'Nothing open right now.' : 'No open verses yet. Post a song with a verse for someone to hop on.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {v && (
          <div style={{ ...box, flex: '1 1 300px', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, whiteSpace: 'normal' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <b style={{ fontSize: 14 }}>{v.title}</b>
              <span style={{ opacity: 0.7 }}>posted by {who(v.by)}</span>
              {(v.by === me || admin) && (
                <button
                  style={{ ...button, marginLeft: 'auto' }}
                  disabled={busy}
                  onClick={async () =>
                    (await dialog.confirm(`Take "${v.title}" down?`, { ok: 'Take down' })) &&
                    act(() => api(`/api/verses/${v.id}`, { method: 'DELETE' }).then(() => setSel(null)), 'Taken down.')
                  }
                >
                  Take down
                </button>
              )}
            </div>
            <div>
              {[v.bpm && `${v.bpm} BPM`, v.key, v.length, v.deadline && `${dueIn(v.deadline)} (${v.deadline})`].filter(Boolean).join(' · ')}
            </div>
            {v.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
            <Player file={v.beat} />
            {v.slots.map((s) => (
              <fieldset key={s.id} style={{ border: '2px groove #fff', margin: 0, padding: '4px 8px 8px' }}>
                <legend>
                  {s.label}: {v.picked === s.id ? `${who(s.by!)}'s take, picked ✓` : s.by ? `${who(s.by)} hopped on` : 'open'}
                </legend>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!s.by && !v.picked && (
                    <button
                      className="sk-signal"
                      style={{ ...button, fontWeight: 700 }}
                      disabled={busy}
                      onClick={() =>
                        act(() => patch(v, { hop: s.id }), `You're on the ${s.label.toLowerCase()}. Upload your take when it's done.`)
                      }
                    >
                      Hop on
                    </button>
                  )}
                  {s.by === me && !v.picked && (
                    <label style={{ ...button, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                      {s.take ? 'Replace my take...' : 'Upload my take...'}
                      <input
                        type="file"
                        accept={AUDIO}
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f)
                            act(
                              async () => {
                                const take = await upload(f, ['Open verses', folderSafe(v.title) || v.id, 'Takes', me]);
                                await patch(v, { slot: s.id, take });
                              },
                              `Take sent to ${who(v.by)}.`,
                            );
                        }}
                      />
                    </label>
                  )}
                  {s.by && !v.picked && (s.by === me || v.by === me || admin) && (
                    <button style={button} disabled={busy} onClick={() => act(() => patch(v, { drop: s.id }), 'The slot is open again.')}>
                      {s.by === me ? 'Step off' : 'Reopen slot'}
                    </button>
                  )}
                  {s.take && !v.picked && (v.by === me || admin) && (
                    <button
                      className="sk-signal"
                      style={{ ...button, fontWeight: 700 }}
                      disabled={busy}
                      title="Makes the song in the tracker (New songs) with this take. Splits come later, when it's published."
                      onClick={() =>
                        act(
                          async () => {
                            const track = await onPick(v, s);
                            await patch(v, { pick: s.id, track });
                          },
                          `Picked ${who(s.by!)}'s take. "${v.title}" is in your songs now.`,
                        )
                      }
                    >
                      Pick this take
                    </button>
                  )}
                  {v.picked === s.id && v.track && (
                    <button style={button} onClick={() => onOpenTrack(v.track!)}>
                      Open the song
                    </button>
                  )}
                  {s.by && !s.take && <span style={{ opacity: 0.7 }}>No take yet.</span>}
                </div>
                {s.take && (
                  <div style={{ marginTop: 4 }}>
                    <Player file={s.take} />
                  </div>
                )}
              </fieldset>
            ))}
          </div>
        )}
      </div>
      {posting && (
        <PostForm
          blocked={!space()}
          busy={busy}
          onClose={() => setPosting(false)}
          onPost={(f, body) =>
            act(async () => {
              const beat = await upload(f, ['Open verses', folderSafe(body.title) || 'Untitled']);
              const made: Verse = await api('/api/verses', { method: 'POST', body: JSON.stringify({ ...body, beat }) });
              setPosting(false);
              setSel(made.id);
            }, 'Posted. Everyone on the team was told.')
          }
        />
      )}
    </div>
  );
};

const PostForm: React.FC<{
  blocked: boolean;
  busy: boolean;
  onClose: () => void;
  onPost: (
    f: File,
    body: { title: string; bpm: string; key: string; length: string; deadline: string | null; notes: string; slots: string[] },
  ) => void;
}> = ({ blocked, busy, onClose, onPost }) => {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: '', bpm: '', key: '', length: '16 bars', deadline: '', notes: '', slots: 'Verse' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const row = (label: string, el: React.ReactNode) => (
    <label style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', alignItems: 'center', gap: 6 }}>
      {label}
      {el}
    </label>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.25)', display: 'grid', placeItems: 'center', zIndex: 5 }}>
      <form
        className="window"
        style={{
          width: 340,
          maxWidth: 'calc(100% - 16px)',
          boxSizing: 'border-box',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: '#fff',
          border: '2px solid #000',
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (file && f.title.trim())
            onPost(file, {
              ...f,
              title: f.title.trim(),
              deadline: f.deadline || null,
              slots: f.slots
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            });
        }}
      >
        <b>Post a song with an open verse</b>
        {blocked && (
          <div style={{ padding: '3px 6px', background: '#000', color: '#fff' }}>
            You can't post yet: you have no team space to upload to. Ask an admin for upload rights.
          </div>
        )}
        {row(
          'Song or beat',
          <input
            type="file"
            style={{ maxWidth: '100%' }}
            accept={AUDIO}
            required
            onChange={(e) => {
              const x = e.target.files?.[0] || null;
              setFile(x);
              if (x && !f.title) setF({ ...f, title: x.name.replace(/\.[^.]+$/, '') });
            }}
          />,
        )}
        {row('Title', <input style={input} required value={f.title} onChange={set('title')} />)}
        {row(
          'BPM / key',
          <span style={{ display: 'flex', gap: 4 }}>
            <input style={{ ...input, width: 60 }} placeholder="140" value={f.bpm} onChange={set('bpm')} />
            <input style={{ ...input, flex: 1 }} placeholder="F# minor" value={f.key} onChange={set('key')} />
          </span>,
        )}
        {row('Open', <input style={input} title="Comma-separated, e.g. Verse 2, Bridge" value={f.slots} onChange={set('slots')} />)}
        {row('Length', <input style={input} placeholder="16 bars" value={f.length} onChange={set('length')} />)}
        {row('Due', <input style={input} type="date" value={f.deadline} onChange={set('deadline')} />)}
        {row(
          'Notes',
          <textarea style={{ ...input, height: 48 }} placeholder="The vibe, what you want on it" value={f.notes} onChange={set('notes')} />,
        )}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <button type="button" style={button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sk-signal" style={{ ...button, fontWeight: 700 }} disabled={busy || blocked || !file}>
            Post
          </button>
        </div>
      </form>
    </div>
  );
};

const box: React.CSSProperties = { overflow: 'auto', background: '#fff', border: '2px inset #808080', minWidth: 0 };
const th: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  textAlign: 'left',
  fontWeight: 400,
  padding: '1px 6px',
  background: '#fff',
  borderRight: '1px solid #808080',
  borderBottom: '1px solid #808080',
};
const td: React.CSSProperties = { padding: '3px 6px', whiteSpace: 'nowrap', borderBottom: '1px solid #eee' };
const input: React.CSSProperties = {
  maxWidth: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default OpenVerses;
