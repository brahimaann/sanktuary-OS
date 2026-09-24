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
  const index = siblings.indexOf(name);
  const kind = fileKind(name);
  const src = token ? `${fileUrl(app, [...dir, name])}?t=${token}` : '';
  const path = [...dir, name].join('/');

  useEffect(() => {
    let live = true;
    setVideoNote('');
    getToken().then((t) => live && setToken(t || ''));
    return () => {
      live = false;
    };
  }, [name, getToken]);

  const step = (d: number) => siblings.length > 1 && setName(siblings[(index + d + siblings.length) % siblings.length]);
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
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
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
            name={name}
            media={media}
            comments={comments}
            onSeek={seek}
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
      />
      <div style={statusBar}>{siblings.length > 1 ? `${index + 1} of ${siblings.length} — use ◀ ▶ or arrow keys` : name}</div>
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
}> = ({ app, path, comments, setComments, media, timed, onSeek }) => {
  const api = useApi();
  const { byName } = useProfiles();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(!isTouch); // phones: collapsed so the picture/video gets the room
  const [err, setErr] = useState('');
  const q = `space=${encodeURIComponent(app)}&path=${encodeURIComponent(path)}`;

  useEffect(() => {
    api(`/api/comments?${q}`).then(setComments, () => setComments([]));
  }, [api, q, setComments]);
  useLiveEvent(
    'comment',
    (d) =>
      d.space === app && d.path === path && setComments((prev) => (prev.some((c) => c.id === d.comment.id) ? prev : [...prev, d.comment])),
  );
  useLiveEvent('uncomment', (d) => d.space === app && d.path === path && setComments((prev) => prev.filter((c) => c.id !== d.id)));

  const post = async () => {
    if (!text.trim()) return;
    const t = timed && media.current ? media.current.currentTime : null;
    try {
      const c: Comment = await api(`/api/comments?${q}`, { method: 'POST', body: JSON.stringify({ text, t }) });
      setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
      setText('');
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = (id: string) => api(`/api/comments?${q}&id=${id}`, { method: 'DELETE' }).catch((e) => setErr(e.message));
  const sorted = [...comments].sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.at.localeCompare(b.at));
  const me = liveUser();

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
          <div style={{ display: 'flex', gap: 4, padding: 4 }}>
            <textarea
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
              }}
              placeholder={timed ? 'Comment at the current playback time...' : 'Add a comment...'}
              style={{ flex: 1, resize: 'none', fontFamily: 'Arial, sans-serif', fontSize: 12, border: '2px inset #808080', padding: 3 }}
            />
            <button style={{ ...button, fontWeight: 700 }} onClick={post}>
              {timed ? 'Comment @ now' : 'Comment'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/** Native audio player plus a clickable waveform with comment markers. */
const AudioPreview: React.FC<{
  src: string;
  name: string;
  media: React.MutableRefObject<HTMLMediaElement | null>;
  comments: Comment[];
  onSeek: (t: number) => void;
}> = ({ src, name, media, comments, onSeek }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [note, setNote] = useState('Drawing waveform...');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch(src, { signal: abort.signal });
        if (Number(res.headers.get('content-length')) > WAVEFORM_MAX_BYTES) {
          abort.abort();
          return setNote('File is large — waveform skipped.');
        }
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(await res.arrayBuffer());
        ctx.close();
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
      } catch {
        if (!abort.signal.aborted) setNote('No waveform for this format.');
      }
    })();
    return () => abort.abort();
  }, [src]);

  // Redraw when peaks, the playhead or comments change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    const top = Math.max(...peaks) || 1;
    const bar = w / peaks.length;
    peaks.forEach((p, i) => {
      const bh = Math.max(1, (p / top) * h * 0.9);
      g.fillStyle = i / peaks.length < progress ? '#000080' : '#a0a0a0';
      g.fillRect(i * bar, (h - bh) / 2, Math.max(1, bar - 1), bh);
    });
    if (duration) {
      g.fillStyle = '#008080';
      for (const c of comments) if (c.t !== null) g.fillRect((c.t / duration) * w - devicePixelRatio, 0, 2 * devicePixelRatio, h);
    }
  }, [peaks, progress, comments, duration]);

  const seekTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        boxSizing: 'border-box',
        background: '#c0c0c0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={fileIcon(name, false, 32)} alt="" style={{ width: 32, height: 32 }} />
        <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      </div>
      <div style={{ flex: 1, minHeight: 60, border: '2px inset #808080', background: '#fff', position: 'relative' }}>
        {peaks && (
          <canvas
            ref={canvasRef}
            onPointerDown={seekTo}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'pointer' }}
            title="Click to jump · teal lines are comments"
          />
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
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
        onError={() => setNote("This browser can't play this format — use Download.")}
      />
      <MediaControls media={media} src={src} />
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
