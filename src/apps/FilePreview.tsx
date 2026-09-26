import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { liveUser, useLiveEvent } from '../utils/live';
import { displayName, useProfiles } from '../utils/profiles';
import { fileUrl, shell, toolbar, button, statusBar } from './TeamFiles';
import { fileIcon, fileKind, isTouch, lightAudio, lightImage, needsConversion } from './fileTypes';
import Avatar from './Avatar';
import MediaControls from '../components/MediaControls';
import { useWindowManager } from '../wm/manager';
import { dialog } from '../utils/dialog';
import { sharedAudio } from '../utils/sound';
import { tempoAndKey } from '../utils/audioAnalysis';
import { Term } from '../utils/glossary';

interface FilePreviewProps {
  app: string;
  dir: string[];
  name: string;
  siblings: string[]; // files in the same folder, for prev/next
}
interface Comment {
  id: string;
  user: string;
  at: string;
  t: number | null;
  text: string;
  ask?: { to: string[]; due: string | null; heard: Record<string, string> }; // a feedback request
}

const WAVEFORM_MAX_BYTES = 80 * 1024 * 1024; // bigger files play fine, they just skip the waveform
const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const OFFICE_MAX_BYTES = 30 * 1024 * 1024; // Word/spreadsheet files are converted in the browser
const SHEET_MAX_ROWS = 2000;
// Photos RapidRAW can edit (camera RAW formats too)
const EDITABLE_PHOTO = /\.(jpe?g|png|tiff?|webp|dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|srw|3fr|iiq|erf|kdc|mrw|x3f)$/i;
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Previews a team file (images, audio with waveform, video, PDF, text) with a live comment thread. */
const FilePreview: React.FC<FilePreviewProps> = ({ app, dir, name: initialName, siblings }) => {
  const { getToken } = useAuth();
  const { openWindow } = useWindowManager();
  const [name, setName] = useState(initialName);
  const [token, setToken] = useState('');
  const media = useRef<HTMLMediaElement | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [videoNote, setVideoNote] = useState('');
  const [prefs, setPrefsState] = useState<PlayerPrefs>(() => {
    try {
      return { listen: 'stereo', rate: 1, autoNext: false, ...JSON.parse(localStorage.getItem('sk_player') || '{}') };
    } catch {
      return { listen: 'stereo', rate: 1, autoNext: false };
    }
  });
  const setPrefs = (p: PlayerPrefs) => {
    setPrefsState(p);
    try {
      localStorage.setItem('sk_player', JSON.stringify(p));
    } catch {}
  };
  const playerKeys = useRef<((e: React.KeyboardEvent) => boolean) | null>(null);
  const [commentHere, setCommentHere] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  // Earlier versions (kept each time the file is replaced): pick one to hear/see it in place, or restore it
  const api = useApi();
  const [versions, setVersions] = useState<{ name: string; modified: string }[]>([]);
  const [ver, setVer] = useState('');
  const [fresh, setFresh] = useState(0); // bumped after a restore so the browser fetches the file again
  const index = siblings.indexOf(name);
  const kind = fileKind(name);
  const src = token
    ? `${fileUrl(app, [...dir, name])}?t=${token}${ver ? `&version=${encodeURIComponent(ver)}` : ''}${fresh ? `&r=${fresh}` : ''}`
    : '';
  const path = [...dir, name].join('/');

  useEffect(() => {
    let live = true;
    setVideoNote('');
    getToken().then((t) => live && setToken(t || ''));
    return () => {
      live = false;
    };
  }, [name, getToken]);

  const loadVersions = () =>
    api(`${fileUrl(app, [...dir, name])}?versions`).then(
      (list: { name: string; modified: string }[]) => setVersions(list.sort((a, b) => b.modified.localeCompare(a.modified))),
      () => setVersions([]),
    );
  useEffect(() => {
    setVer('');
    setVersions([]);
    if (token) loadVersions();
  }, [name, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const restoreVersion = async () => {
    const when = new Date(versions.find((v) => v.name === ver)!.modified).toLocaleString();
    if (!(await dialog.confirm(`Make the version from ${when} the current ${name}?\nThe current file is kept as a version too.`))) return;
    try {
      await api(`${fileUrl(app, [...dir, name])}?restore=${encodeURIComponent(ver)}`, { method: 'POST' });
      setVer('');
      setFresh(Date.now());
      loadVersions();
    } catch (e) {
      dialog.alert((e as Error).message, { icon: 'error' });
    }
  };

  const step = (d: number) => {
    if (siblings.length < 2) return;
    setAutoPlay(false);
    setName(siblings[(index + d + siblings.length) % siblings.length]);
  };
  // "Play next": the next audio file in the folder starts by itself (stops at the end of the folder)
  const playNext = () => {
    const next = siblings.slice(index + 1).find((n) => fileKind(n) === 'audio');
    if (!prefs.autoNext || !next) return;
    setAutoPlay(true);
    setName(next);
  };
  const seek = (t: number) => {
    if (media.current) {
      media.current.currentTime = t;
      media.current.play();
    }
  };

  return (
    <div
      style={shell}
      tabIndex={0}
      onKeyDown={(e) => {
        if (['TEXTAREA', 'INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
        if (kind === 'audio') {
          // the player's keys first (arrows seek); N / P move between files
          if (playerKeys.current?.(e)) return e.preventDefault();
          if (e.key === 'n' || e.key === 'p') step(e.key === 'n' ? 1 : -1);
          return;
        }
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
      }}
    >
      <div style={toolbar}>
        {siblings.length > 1 && (
          <button style={button} onClick={() => step(-1)}>
            ◀ Prev
          </button>
        )}
        {siblings.length > 1 && (
          <button style={button} onClick={() => step(1)}>
            Next ▶
          </button>
        )}
        <button style={button} disabled={!token} onClick={() => window.open(`${src}&download`, '_blank')}>
          Download
        </button>
        {versions.length > 0 && (
          <select
            value={ver}
            onChange={(e) => setVer(e.target.value)}
            title="Earlier versions are kept every time this file is replaced: pick one to hear or see it"
          >
            <option value="">Current version</option>
            {versions.map((v, i) => (
              <option key={v.name} value={v.name}>
                Version {versions.length - i} · {new Date(v.modified).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </option>
            ))}
          </select>
        )}
        {ver && (
          <button style={{ ...button, fontWeight: 700 }} onClick={restoreVersion} title="Needs edit rights on this folder">
            Restore this version
          </button>
        )}
        {(kind === 'pdf' || kind === 'image') && (
          <button style={button} disabled={!token} onClick={() => window.open(needsConversion(name) ? `${src}&preview` : src, '_blank')}>
            Open in new tab
          </button>
        )}
        {EDITABLE_PHOTO.test(name) && (
          <button
            style={button}
            title="Open in the RapidRAW photo editor (runs on the Sanktuary server)"
            onClick={() =>
              openWindow({
                id: `rapidraw-${app}-${path}`,
                title: `RapidRAW - ${name}`,
                icon: '/images/icons/paint-16x16.png',
                appType: 'iframe',
                appProps: {
                  src: `/apps/rapidraw/?file=${encodeURIComponent(`sk://${app}/${[...dir, name].map(encodeURIComponent).join('/')}`)}`,
                },
                width: 1100,
                height: 720,
              })
            }
          >
            Edit photo
          </button>
        )}
        {lightImage(name) && (
          <button
            style={button}
            title="Film looks: bleach bypass, cross process, B&W..."
            onClick={() =>
              openWindow({
                id: `darkroom-${app}-${path}`,
                title: `Darkroom - ${name}`,
                icon: '/images/icons/kodak-imaging-16x16.png',
                appType: 'darkroom',
                appProps: { app, dir, name },
                width: 900,
                height: 600,
              })
            }
          >
            Film look
          </button>
        )}
        <span style={{ marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 700 }}>
          {name}
        </span>
      </div>
      <div style={stage}>
        {!src ? null : kind === 'image' ? (
          <img
            key={src}
            src={lightImage(name) ? `${src}&preview` : src}
            alt={name}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : kind === 'audio' ? (
          <AudioPreview
            key={src}
            src={lightAudio(name) ? `${src}&preview` : src}
            infoUrl={`${src}&audioinfo`}
            name={name}
            media={media}
            comments={comments}
            onSeek={seek}
            prefs={prefs}
            setPrefs={setPrefs}
            keys={playerKeys}
            autoPlay={autoPlay}
            onEnded={playNext}
            onComment={() => setCommentHere((n) => n + 1)}
          />
        ) : kind === 'video' ? (
          <div
            key={src}
            style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, boxSizing: 'border-box' }}
          >
            <div
              style={{
                flex: 1,
                minHeight: isTouch ? 220 : 0, // small phone windows mustn't squash the video to nothing
                background: '#000',
                border: '2px inset #808080',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <video
                ref={(el) => {
                  media.current = el;
                }}
                // Phones get their own player (tap to play, full screen, AirPlay...); computers the Win98 one
                src={isTouch ? `${src}#t=0.001` : src}
                controls={isTouch}
                playsInline
                preload="metadata"
                onClick={isTouch ? undefined : (e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())}
                onError={() => setVideoNote("This device can't play this video's format. Use Download to open it in another app.")}
                style={{ maxWidth: '100%', maxHeight: '100%', width: isTouch ? '100%' : undefined }}
              />
            </div>
            {videoNote && <div style={{ color: '#a00000' }}>{videoNote}</div>}
            {!isTouch && <MediaControls media={media} src={src} />}
          </div>
        ) : kind === 'pdf' ? (
          <iframe key={src} src={src} title={name} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
        ) : kind === 'doc' ? (
          <OfficePreview key={src} src={src} render={docToHtml} />
        ) : kind === 'sheet' ? (
          <OfficePreview key={src} src={src} render={sheetsToHtml} />
        ) : kind === 'text' ? (
          <TextPreview key={src} src={src} />
        ) : (
          <NoPreview name={name} />
        )}
      </div>
      <Comments
        key={path}
        app={app}
        path={path}
        comments={comments}
        setComments={setComments}
        media={media}
        timed={kind === 'audio' || kind === 'video'}
        onSeek={seek}
        focusSignal={commentHere}
      />
      <div style={statusBar}>
        {siblings.length > 1 ? `${index + 1} of ${siblings.length} — use ◀ ▶ or ${kind === 'audio' ? 'N / P' : 'arrow keys'}` : name}
      </div>
    </div>
  );
};

/** Live comment thread for one file. On audio/video each comment is pinned to the playback time. */
const Comments: React.FC<{
  app: string;
  path: string;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  media: React.MutableRefObject<HTMLMediaElement | null>;
  timed: boolean;
  onSeek: (t: number) => void;
  focusSignal?: number; // changes when someone presses C in the player
}> = ({ app, path, comments, setComments, media, timed, onSeek, focusSignal = 0 }) => {
  const api = useApi();
  const { byName, profiles } = useProfiles();
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false); // "Ask for feedback" mode: pick people, optional due date
  const [askTo, setAskTo] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const heardSent = useRef(new Set<string>());
  const [open, setOpen] = useState(!isTouch); // phones: collapsed so the picture/video gets the room
  const [err, setErr] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusSignal) return;
    setOpen(true);
    setTimeout(() => box.current?.focus());
  }, [focusSignal]);
  const q = `space=${encodeURIComponent(app)}&path=${encodeURIComponent(path)}`;

  useEffect(() => {
    api(`/api/comments?${q}`).then(setComments, () => setComments([]));
  }, [api, q, setComments]);
  useLiveEvent(
    'comment',
    (d) =>
      d.space === app &&
      d.path === path &&
      setComments((prev) =>
        prev.some((c) => c.id === d.comment.id) ? prev.map((c) => (c.id === d.comment.id ? d.comment : c)) : [...prev, d.comment],
      ),
  );
  useLiveEvent('uncomment', (d) => d.space === app && d.path === path && setComments((prev) => prev.filter((c) => c.id !== d.id)));

  const post = async () => {
    if (!text.trim()) return;
    const t = timed && media.current ? media.current.currentTime : null;
    if (asking && !askTo.length) return setErr('Pick who to ask.');
    try {
      const body = asking ? { text, t: t || null, ask: { to: askTo, due: due || null } } : { text, t };
      const c: Comment = await api(`/api/comments?${q}`, { method: 'POST', body: JSON.stringify(body) });
      setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
      setText('');
      setAsking(false);
      setAskTo([]);
      setDue('');
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = (id: string) => api(`/api/comments?${q}&id=${id}`, { method: 'DELETE' }).catch((e) => setErr(e.message));
  const sorted = [...comments].sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.at.localeCompare(b.at));
  const me = liveUser();

  // Asked for feedback on this file: once you've heard 30 s (or half a short track), it's marked listened
  useEffect(() => {
    const mine = comments.filter((c) => c.ask?.to.includes(me) && !c.ask.heard[me] && !heardSent.current.has(c.id));
    if (!timed || !mine.length) return;
    const timer = setInterval(() => {
      const m = media.current;
      // ponytail: judged by playhead position, so jumping ahead counts; track real listening time if that matters
      if (!m || (m.currentTime < Math.min(30, (m.duration || 60) / 2) && !m.ended)) return;
      clearInterval(timer);
      for (const c of mine) {
        heardSent.current.add(c.id);
        api(`/api/comments?${q}&heard&id=${c.id}`, { method: 'POST' }).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [comments, timed, me, api, q, media]);
  const replied = (c: Comment, u: string) => comments.some((x) => x.user === u && x.at > c.at);

  return (
    <div
      style={{
        borderTop: '1px solid #808080',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: open ? '40%' : undefined,
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
        <button style={{ ...button, padding: '0 6px' }} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Comments ({comments.length})
        </button>
        {err && <span style={{ color: '#a00000' }}>{err}</span>}
      </div>
      {open && (
        <>
          <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: '0 2px', minHeight: 40 }}>
            {!sorted.length && (
              <div style={{ padding: 6, color: '#777' }}>
                {timed
                  ? 'No feedback yet. Play the track, pause where something needs work, and comment: it gets pinned to that moment.'
                  : 'No comments yet.'}
              </div>
            )}
            {sorted.map((c) => (
              <div
                key={c.id}
                style={{ display: 'flex', gap: 6, padding: '3px 6px', borderBottom: '1px solid #eee', alignItems: 'flex-start' }}
              >
                <Avatar username={c.user} avatar={byName[c.user]?.avatar} size={18} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {c.t !== null && (
                    <button
                      onClick={() => onSeek(c.t!)}
                      style={{ ...button, padding: '0 4px', marginRight: 4, color: '#000080', fontWeight: 700 }}
                      title="Jump to this moment"
                    >
                      {clock(c.t)}
                    </button>
                  )}
                  <b>{displayName(byName[c.user], c.user)}</b> <span style={{ whiteSpace: 'pre-wrap' }}>{c.text}</span>
                  {c.ask && (
                    <div style={{ background: '#ffffe1', border: '1px solid #808080', padding: '2px 4px', marginTop: 2 }}>
                      Asked for feedback{c.ask.due ? ` by ${c.ask.due}` : ''}:{' '}
                      {c.ask.to.map((u) => (
                        <span key={u} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                          {displayName(byName[u], u)}{' '}
                          {replied(c, u) ? (
                            <span style={{ color: '#006000' }}>✓ replied</span>
                          ) : c.ask!.heard[u] ? (
                            <span style={{ color: '#000080' }}>✓ listened</span>
                          ) : (
                            <span style={{ color: '#808080' }}>○ not yet</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <span style={{ color: '#999', fontSize: 10, marginLeft: 6 }}>{new Date(c.at).toLocaleString()}</span>
                </div>
                {c.user === me && (
                  <button
                    onClick={() => remove(c.id)}
                    style={{ border: 'none', background: 'none', color: '#aaa', cursor: 'pointer' }}
                    title="Delete"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {asking && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 4px 0' }}>
              Ask:
              {profiles
                .filter((p) => p.username !== me)
                .map((p) => (
                  <label key={p.username} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={askTo.includes(p.username)}
                      onChange={(e) => setAskTo(e.target.checked ? [...askTo, p.username] : askTo.filter((u) => u !== p.username))}
                    />
                    {displayName(p, p.username)}
                  </label>
                ))}
              <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                by <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, padding: 4 }}>
            <textarea
              ref={box}
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
                if (e.key === 'Escape') e.currentTarget.closest<HTMLElement>('[tabindex]')?.focus(); // back to the player keys
              }}
              placeholder={
                asking
                  ? 'What should they listen for? e.g. is the vocal too loud at the chorus?'
                  : timed
                    ? 'Comment at the current playback time...'
                    : 'Add a comment...'
              }
              style={{ flex: 1, resize: 'none', fontFamily: 'Arial, sans-serif', fontSize: 12, border: '2px inset #808080', padding: 3 }}
            />
            {app !== 'me' && (
              <button
                style={button}
                onClick={() => setAsking(!asking)}
                title="Ask people for feedback on this file: they get a notification with a link"
              >
                {asking ? 'Cancel ask' : 'Ask for feedback...'}
              </button>
            )}
            <button style={{ ...button, fontWeight: 700 }} onClick={post}>
              {asking ? 'Send request' : timed ? 'Comment @ now' : 'Comment'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/** Measured on the original file by the server (?audioinfo): format, resolution and loudness. */
interface AudioFacts {
  codec: string;
  lossless: boolean;
  rate: number | null;
  channels: string | null;
  bits: number | null;
  float: boolean;
  bitrate: number | null;
  duration: number | null;
  lufs: number | null;
  lra: number | null;
  truePeak: number | null;
}
type Listen = 'stereo' | 'mono' | 'L' | 'R';
/** How the player is set up; kept by the preview window while you move between files. */
interface PlayerPrefs {
  listen: Listen;
  rate: number;
  autoNext: boolean;
}
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

/**
 * The audio player: waveform with comment marks, time ruler and hover time, drag to loop a section, the file's
 * facts (format, loudness, true peak, BPM, key), mono / left / right checks and speed. Keys (when the window
 * has focus): Space play/pause, ←/→ 5 s, Home start, L loop on/off, Esc clear loop, M mono, C comment here.
 */
const AudioPreview: React.FC<{
  src: string;
  infoUrl: string;
  name: string;
  media: React.MutableRefObject<HTMLMediaElement | null>;
  comments: Comment[];
  onSeek: (t: number) => void;
  prefs: PlayerPrefs;
  setPrefs: (p: PlayerPrefs) => void;
  keys: React.MutableRefObject<((e: React.KeyboardEvent) => boolean) | null>;
  autoPlay: boolean;
  onEnded: () => void;
  onComment: () => void;
}> = ({ src, infoUrl, name, media, comments, onSeek, prefs, setPrefs, keys, autoPlay, onEnded, onComment }) => {
  const api = useApi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [note, setNote] = useState('Drawing waveform...');
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hover, setHover] = useState<number | null>(null); // seconds under the pointer
  const [loop, setLoop] = useState<{ a: number; b: number } | null>(null);
  const [looping, setLooping] = useState(false);
  const [facts, setFacts] = useState<AudioFacts | null>(null);
  const [musical, setMusical] = useState<{ bpm: number | null; key: string | null } | null>(null);
  const press = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const graph = useRef<{ source: MediaElementAudioSourceNode; nodes: AudioNode[] } | null>(null);

  // Waveform (and tempo and key from the same decoded audio)
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch(src, { signal: abort.signal });
        if (Number(res.headers.get('content-length')) > WAVEFORM_MAX_BYTES) {
          abort.abort();
          return setNote('File is large — waveform skipped.');
        }
        const audio = await sharedAudio()!.decodeAudioData(await res.arrayBuffer());
        const data = audio.getChannelData(0);
        const buckets = 600;
        const size = Math.floor(data.length / buckets) || 1;
        const out: number[] = [];
        for (let b = 0; b < buckets; b++) {
          let max = 0;
          for (let i = b * size; i < (b + 1) * size && i < data.length; i += 16) max = Math.max(max, Math.abs(data[i]));
          out.push(max);
        }
        setPeaks(out);
        setNote('');
        const tk = await tempoAndKey(audio);
        if (!abort.signal.aborted) setMusical({ bpm: tk.tempo?.bpm ?? null, key: tk.key ? `${tk.key.name} (${tk.key.camelot})` : null });
      } catch {
        if (!abort.signal.aborted) setNote('No waveform for this format.');
      }
    })();
    return () => abort.abort();
  }, [src]);

  // Format, loudness and true peak, measured on the original by the server (cached after the first time)
  useEffect(() => {
    let live = true;
    api(infoUrl).then(
      (f: AudioFacts) => live && setFacts(f),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, infoUrl]);

  // Draw: waveform, played part, loop region, comment marks, time ruler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    const ruler = 14 * devicePixelRatio;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    const x = (t: number) => (duration ? (t / duration) * w : 0);
    if (loop) {
      g.fillStyle = looping ? '#ffff80' : '#f0f0d0';
      g.fillRect(x(loop.a), 0, x(loop.b) - x(loop.a), h - ruler);
    }
    const top = Math.max(...peaks) || 1;
    const bar = w / peaks.length;
    const wave = h - ruler;
    const played = duration ? now / duration : 0;
    peaks.forEach((p, i) => {
      const bh = Math.max(1, (p / top) * wave * 0.9);
      g.fillStyle = i / peaks.length < played ? '#000080' : '#a0a0a0';
      g.fillRect(i * bar, (wave - bh) / 2, Math.max(1, bar - 1), bh);
    });
    if (!duration) return;
    g.fillStyle = '#008080';
    for (const c of comments) if (c.t !== null) g.fillRect(x(c.t) - devicePixelRatio, 0, 2 * devicePixelRatio, wave);
    // Ruler: a tick about every 60 px, labelled m:ss
    const step = RULER_STEPS.find((s) => (s / duration) * w >= 60 * devicePixelRatio) || 600;
    g.fillStyle = '#c0c0c0';
    g.fillRect(0, wave, w, ruler);
    g.fillStyle = '#000';
    g.font = `${10 * devicePixelRatio}px Arial`;
    for (let t = 0; t <= duration; t += step) {
      g.fillRect(x(t), wave, devicePixelRatio, 4 * devicePixelRatio);
      g.fillText(clock(t), x(t) + 3 * devicePixelRatio, h - 3 * devicePixelRatio);
    }
  }, [peaks, now, comments, duration, loop, looping]);

  // Loop: jump back to the start of the section when the playhead passes its end
  useEffect(() => {
    if (!looping || !loop) return;
    let frame = 0;
    const tick = () => {
      const el = media.current;
      if (el && !el.paused && (el.currentTime >= loop.b || el.currentTime < loop.a - 0.25)) el.currentTime = loop.a;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [looping, loop, media]);

  // Listen as: stereo, mono (L+R folded down), left only or right only, through the shared audio engine. The
  // element is only routed through it once something other than stereo is picked (and then stays routed).
  useEffect(() => {
    const el = media.current as HTMLAudioElement | null;
    const ctx = sharedAudio();
    if (!el || !ctx || (prefs.listen === 'stereo' && !graph.current)) return;
    if (!graph.current) graph.current = { source: ctx.createMediaElementSource(el), nodes: [] };
    const { source } = graph.current;
    source.disconnect();
    graph.current.nodes.forEach((n) => n.disconnect());
    if (prefs.listen === 'stereo') {
      source.connect(ctx.destination);
      graph.current.nodes = [];
    } else if (prefs.listen === 'mono') {
      const fold = ctx.createGain();
      fold.channelCount = 1;
      fold.channelCountMode = 'explicit';
      fold.channelInterpretation = 'speakers'; // stereo -> mono is (L + R) / 2
      source.connect(fold).connect(ctx.destination);
      graph.current.nodes = [fold];
    } else {
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      const side = prefs.listen === 'L' ? 0 : 1;
      source.connect(split);
      split.connect(merge, side, 0);
      split.connect(merge, side, 1);
      merge.connect(ctx.destination);
      graph.current.nodes = [split, merge];
    }
    ctx.resume().catch(() => {});
  }, [prefs.listen, media]);

  const setSpeed = (el: HTMLMediaElement | null) => {
    if (!el) return;
    el.playbackRate = prefs.rate;
    el.preservesPitch = true; // slower or faster, same key
  };
  useEffect(() => setSpeed(media.current), [prefs.rate]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration));
  };
  // Click to jump; drag across to loop that section
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, t: timeAt(e), moved: false };
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const t = timeAt(e);
    setHover(t);
    const p = press.current;
    if (p && (p.moved || Math.abs(e.clientX - p.x) > 4)) {
      p.moved = true;
      setLoop({ a: Math.min(p.t, t), b: Math.max(p.t, t) });
    }
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || !duration) return;
    if (!p.moved) return onSeek(timeAt(e));
    const t = timeAt(e);
    const a = Math.min(p.t, t);
    const b = Math.max(p.t, t);
    if (b - a < 0.2) return setLoop(null);
    setLoop({ a, b });
    setLooping(true);
    onSeek(a);
  };

  const toggle = () => {
    const el = media.current;
    if (!el) return;
    if (el.paused) {
      sharedAudio()
        ?.resume()
        .catch(() => {});
      el.play().catch(() => {}); // a quick second press pauses before playback starts: fine
    } else el.pause();
  };
  keys.current = (e) => {
    const el = media.current;
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ') toggle();
    else if (k === 'ArrowLeft' || k === 'ArrowRight')
      el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + (k === 'ArrowLeft' ? -5 : 5) / (e.shiftKey ? 5 : 1)));
    else if (k === 'Home') el.currentTime = loop && looping ? loop.a : 0;
    else if (k === 'l' && loop) setLooping(!looping);
    else if (k === 'Escape' && loop) (setLoop(null), setLooping(false));
    else if (k === 'm') setPrefs({ ...prefs, listen: prefs.listen === 'mono' ? 'stereo' : 'mono' });
    else if (k === 'c') (el.pause(), onComment());
    else return false;
    return true;
  };

  // e.g. "WAV/AIFF · 24-bit · 48 kHz · stereo" or "MP3 · 320 kbps · 44.1 kHz · stereo"
  const facts1 = facts && [
    facts.codec.startsWith('pcm') ? 'WAV/AIFF' : facts.codec.toUpperCase(),
    facts.lossless
      ? facts.bits
        ? `${facts.bits}-bit${facts.float ? ' float' : ''}`
        : null
      : facts.bitrate
        ? `${facts.bitrate} kbps`
        : null,
    facts.rate ? `${(facts.rate / 1000).toFixed(facts.rate % 1000 ? 1 : 0)} kHz` : null,
    facts.channels,
  ];
  const hot = facts?.truePeak != null && facts.truePeak > -1; // streaming services ask for -1 dBTP or lower
  const cell: React.CSSProperties = { padding: '1px 6px', borderRight: '1px solid #808080', whiteSpace: 'nowrap' };
  const pick = (on: boolean): React.CSSProperties => ({
    ...button,
    padding: '1px 6px',
    ...(on
      ? {
          borderTop: '1px solid #000',
          borderLeft: '1px solid #000',
          borderRight: '1px solid #fff',
          borderBottom: '1px solid #fff',
          background: '#d8d8d8',
        }
      : {}),
  });

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        boxSizing: 'border-box',
        background: '#c0c0c0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={fileIcon(name, false, 32)} alt="" style={{ width: 32, height: 32 }} />
        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      </div>
      {/* The facts: what you'd otherwise open a DAW or a meter for */}
      <div
        style={{ display: 'flex', flexWrap: 'wrap', background: '#fff', border: '2px inset #808080', fontSize: 11 }}
        title="Format and loudness are measured on the original file; BPM and key are estimates"
      >
        {facts1 ? (
          facts1.filter(Boolean).map((f) => (
            <span key={f!} style={cell}>
              {f}
            </span>
          ))
        ) : (
          <span style={cell}>Measuring...</span>
        )}
        {facts?.lufs != null && (
          <span style={cell}>
            <b>{facts.lufs.toFixed(1)}</b> <Term>LUFS</Term>
          </span>
        )}
        {facts?.truePeak != null && (
          <span
            style={{ ...cell, color: hot ? '#a00000' : undefined }}
            title={hot ? 'Above -1 dBTP: may distort after MP3/AAC encoding on streaming services' : 'True peak'}
          >
            <b>{facts.truePeak.toFixed(1)}</b> <Term>dBTP</Term>
            {facts.truePeak >= 0 ? ' · clipping' : hot ? ' · hot' : ''}
          </span>
        )}
        {facts?.lra != null && (
          <span style={cell}>
            <Term>LRA</Term> {facts.lra.toFixed(1)}
          </span>
        )}
        {musical?.bpm && <span style={cell}>≈ {Math.round(musical.bpm)} BPM</span>}
        {musical?.key && <span style={cell}>{musical.key}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 70, border: '2px inset #808080', background: '#fff', position: 'relative' }}>
        {peaks && (
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={() => setHover(null)}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'text', touchAction: 'none' }}
            title="Click to jump · drag across to loop a section · teal lines are comments"
          />
        )}
        {hover !== null && duration > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 14,
              left: `${(hover / duration) * 100}%`,
              borderLeft: '1px dashed #000080',
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: 3,
                background: '#ffffe1',
                border: '1px solid #000',
                padding: '0 3px',
                fontSize: 11,
              }}
            >
              {clock(hover)}
            </span>
          </div>
        )}
        {note && (
          <div
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000080' }}
          >
            {note}
          </div>
        )}
      </div>
      <audio
        ref={(el) => {
          media.current = el;
        }}
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        onLoadedMetadata={(e) => (setDuration(e.currentTarget.duration || 0), setSpeed(e.currentTarget))}
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onEnded={() => !looping && onEnded()}
        onError={() => setNote("This browser can't play this format — use Download.")}
      />
      <MediaControls media={media} src={src} />
      {/* Checks and tools */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['stereo', 'mono', 'L', 'R'] as const).map((l) => (
          <button
            key={l}
            style={pick(prefs.listen === l)}
            onClick={() => setPrefs({ ...prefs, listen: l })}
            title={
              {
                stereo: 'Normal',
                mono: 'Fold to mono: how it sounds on a phone speaker or a club system (M)',
                L: 'Left channel only',
                R: 'Right channel only',
              }[l]
            }
          >
            {{ stereo: 'Stereo', mono: 'Mono', L: 'L', R: 'R' }[l]}
          </button>
        ))}
        <span style={{ width: 8 }} />
        Speed
        <select value={prefs.rate} onChange={(e) => setPrefs({ ...prefs, rate: +e.target.value })} title="Slower or faster, same pitch">
          {[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        {loop && (
          <button style={pick(looping)} onClick={() => setLooping(!looping)} title="Loop the highlighted section (L) · Esc clears it">
            Loop {clock(loop.a)}–{clock(loop.b)}
          </button>
        )}
        <label
          style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}
          title="When a file ends, play the next one in the folder"
        >
          <input type="checkbox" checked={prefs.autoNext} onChange={(e) => setPrefs({ ...prefs, autoNext: e.target.checked })} />
          Play next
        </label>
      </div>
      {!isTouch && (
        <div style={{ color: '#555', fontSize: 11 }}>
          Space play/pause · ←/→ 5 s (Shift: 1 s) · Home start · drag the waveform to loop, L on/off · M mono · C comment here · N/P
          next/previous file
        </div>
      )}
    </div>
  );
};

/** Word (.docx) -> HTML. Libraries load only when such a file is opened. */
async function docToHtml(data: ArrayBuffer): Promise<{ tabs: [string, string][] }> {
  const mammoth = (await import('mammoth/mammoth.browser')).default;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: data });
  return { tabs: [['Document', value]] };
}

/** Spreadsheets -> one HTML table per sheet (capped so huge sheets stay responsive). */
async function sheetsToHtml(data: ArrayBuffer): Promise<{ tabs: [string, string][] }> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(data, { type: 'array', sheetRows: SHEET_MAX_ROWS + 1 });
  return { tabs: book.SheetNames.map((n) => [n, XLSX.utils.sheet_to_html(book.Sheets[n], { header: '', footer: '' })]) };
}

const DOC_CSS =
  'body{font:14px/1.5 Georgia,serif;margin:24px;color:#111;background:#fff}img{max-width:100%}' +
  'table{border-collapse:collapse;font:12px Arial,sans-serif}td,th{border:1px solid #c0c0c0;padding:2px 6px;white-space:nowrap}' +
  'tr:first-child td{background:#e8e8e8;font-weight:bold;position:sticky;top:0}';

/**
 * Converts an office file in the browser and shows it in a sandboxed frame (no scripts, no network),
 * so nothing inside a document can run or reach out.
 */
const OfficePreview: React.FC<{ src: string; render: (data: ArrayBuffer) => Promise<{ tabs: [string, string][] }> }> = ({
  src,
  render,
}) => {
  const [tabs, setTabs] = useState<[string, string][] | null>(null);
  const [tab, setTab] = useState(0);
  const [note, setNote] = useState('Opening...');

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch(src, { signal: abort.signal });
        if (Number(res.headers.get('content-length')) > OFFICE_MAX_BYTES) {
          abort.abort();
          return setNote('File is too large to preview — use Download.');
        }
        setTabs((await render(await res.arrayBuffer())).tabs);
        setNote('');
      } catch {
        if (!abort.signal.aborted) setNote("Couldn't read this file — use Download.");
      }
    })();
    return () => abort.abort();
  }, [src, render]);

  if (!tabs) return <div style={{ color: '#fff' }}>{note}</div>;
  const page = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>${DOC_CSS}</style>${tabs[tab]?.[1] || ''}`;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 2, padding: 2, background: '#c0c0c0', overflowX: 'auto' }}>
          {tabs.map(([n], i) => (
            <button key={n} style={{ ...button, fontWeight: i === tab ? 700 : 400 }} onClick={() => setTab(i)}>
              {n}
            </button>
          ))}
        </div>
      )}
      <iframe title="Document preview" sandbox="" srcDoc={page} style={{ flex: 1, width: '100%', border: 0, background: '#fff' }} />
    </div>
  );
};

const TextPreview: React.FC<{ src: string }> = ({ src }) => {
  const [text, setText] = useState('Loading...');
  useEffect(() => {
    fetch(src).then(async (res) =>
      setText(
        Number(res.headers.get('content-length')) > TEXT_MAX_BYTES ? 'File is too large to preview — use Download.' : await res.text(),
      ),
    );
  }, [src]);
  return (
    <pre
      style={{
        margin: 0,
        padding: 8,
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: '#fff',
        whiteSpace: 'pre-wrap',
        fontFamily: 'Fixedsys Excelsior, monospace',
        fontSize: 13,
        boxSizing: 'border-box',
      }}
    >
      {text}
    </pre>
  );
};

const NoPreview: React.FC<{ name: string }> = ({ name }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#000' }}>
    <img src={fileIcon(name, false, 32)} alt="" style={{ width: 32, height: 32 }} />
    <div>No preview for this kind of file. Use Download to open it.</div>
  </div>
);

const stage: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#808080',
  border: '2px inset #808080',
  margin: '0 2px',
  overflow: 'hidden',
};

export default FilePreview;
