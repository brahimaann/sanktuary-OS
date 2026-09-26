import React, { useCallback, useEffect, useRef, useState } from 'react';
import RetroIcon, { IconLabel } from '../components/RetroIcon';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { droppedItems, uploadFiles } from '../utils/upload';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { useOpenRef } from '../utils/refs';
import { useWindowManager } from '../wm/manager';
import { fileKind } from './fileTypes';
import { fileUrl, LogOn, shell, toolbar, button, statusBar } from './TeamFiles';
import MediaControls from '../components/MediaControls';
import FilePicker, { FileRef } from '../components/FilePicker';
import MembersPicker from './MembersPicker';
import { ProjectInfo } from './ProjectPanel';

interface Release {
  id: string;
  title: string;
  kind: string;
  date: string | null;
  members: string[] | null;
  owner: string;
  public?: boolean;
  folder?: FileRef | null;
  slug?: string; // its public page: /release/<slug>
  blurb?: string;
  story?: string | null;
  stores?: Record<string, string>; // where to listen / pre-save (https links), shown as buttons on the page
  pageUntil?: string | null; // a temporary page: gone after this day
}
const STORES: [string, string][] = [
  ['presave', 'Pre-save link (shown until release day)'],
  ['spotify', 'Spotify'],
  ['appleMusic', 'Apple Music'],
  ['youtubeMusic', 'YouTube Music'],
  ['tidal', 'Tidal'],
  ['amazonMusic', 'Amazon Music'],
  ['deezer', 'Deezer'],
  ['soundcloud', 'SoundCloud'],
  ['bandcamp', 'Bandcamp'],
  ['audiomack', 'Audiomack'],
];
type PageBody = { blurb: string; story: string | null; stores: Record<string, string>; pageUntil: string | null };
interface Found {
  added: string[];
  bounces: string[];
  projects: number;
  stems: number;
  bpm: number;
  cover: boolean;
  offline?: boolean;
}
/** "Found 2 new track(s), 1 bounce(s)..." or "Nothing new in the folder." */
const foundText = (f: Found) => {
  if (f.offline) return "The release's drive is offline.";
  const bits = [
    f.added.length && `${f.added.length} new track(s)`,
    f.bounces.length && `${f.bounces.length} bounce(s)`,
    f.projects && `${f.projects} project(s)`,
    f.stems && `${f.stems} stems folder(s)`,
    f.bpm && `${f.bpm} BPM`,
    f.cover && 'the cover',
  ].filter(Boolean);
  return bits.length ? `Found ${bits.join(', ')}.` : 'Nothing new in the folder.';
};
interface Track {
  id: string;
  release: string;
  n: number;
  title: string;
  status: string;
  bpm: string;
  key: string;
  credits: string;
  notes: string;
  deadline: string | null;
  bounce: FileRef | null;
  project: FileRef | null;
  stems: FileRef | null;
  links: Partial<Record<'bandlab' | 'untitled' | 'soundcloud' | 'other', string>>;
  following: boolean;
  followers: number;
  history: { at: string; user: string; action: string }[];
  updated: string;
  updatedBy: string;
  onPage?: boolean; // shown on the release's public page
  previewAt?: number | null; // a 30-second public preview starts here (seconds)
  bmi?: Bmi | null; // BMI work registration / split sheet (team only)
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const seconds = (v: string) => {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$|^(\d{1,4})$/);
  return m ? (m[3] !== undefined ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2])) : null;
};

const STATUS_COLORS: Record<string, string> = {
  Idea: '#808080',
  Writing: '#800080',
  Recording: '#a05000',
  Mixing: '#000080',
  Mastering: '#008080',
  Done: '#008000',
};
const LINKS: [keyof Track['links'], string][] = [
  ['bandlab', 'BandLab'],
  ['untitled', 'Untitled'],
  ['soundcloud', 'SoundCloud'],
  ['other', 'Other'],
];
const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(new Date().toLocaleDateString('en-CA'))) / 864e5);
const due = (d: string) => {
  const n = daysUntil(d);
  return n < 0 ? `${-n} day(s) late` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
};

/** Album / EP / single tracker: every song's bounce, project, stems, links, status and deadline in one place. */
const Tracks: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Tracks" />;
  return <TracksApp />;
};

const TracksApp: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const [data, setData] = useState<{ releases: Release[]; tracks: Track[]; statuses: string[]; kinds: string[] } | null>(null);
  const [releaseId, setReleaseId] = useState<string>(() => {
    try {
      return localStorage.getItem('sk_tracks_release') || '';
    } catch {
      return '';
    }
  });
  const [trackId, setTrackId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [sharing, setSharing] = useState(false);
  const [pageSetup, setPageSetup] = useState(false);
  const [linking, setLinking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const { getToken } = useAuth();
  const { openWindow } = useWindowManager();
  const openRef = useOpenRef();
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 620));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [!!data]);

  const load = useCallback(() => api('/api/tracks').then(setData, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('tracks', load);
  useEffect(() => {
    // The New... window just made or added to a release: show it
    const show = (e: Event) => pickRelease((e as CustomEvent<string>).detail);
    window.addEventListener('sk:tracks-release', show);
    return () => window.removeEventListener('sk:tracks-release', show);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const releases = data?.releases || [];
  const release = releases.find((r) => r.id === releaseId) || releases[0];
  const tracks = (data?.tracks || []).filter((t) => t.release === release?.id).sort((a, b) => a.n - b.n);
  const track = tracks.find((t) => t.id === trackId) || null;
  const pickRelease = (id: string) => {
    setReleaseId(id);
    setTrackId(null);
    try {
      localStorage.setItem('sk_tracks_release', id);
    } catch {}
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setMsg('');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const newRelease = () =>
    openWindow({
      id: 'new',
      title: 'New',
      icon: '/images/icons/file-32x32.png',
      appType: 'new',
      width: 460,
      height: 420,
      appProps: { kind: 'release' },
    });
  const scan = () =>
    run(async () => {
      const f: Found = await api(`/api/tracks/release/${release!.id}?scan`, { method: 'POST' });
      setTimeout(() => setMsg(foundText(f))); // after run() clears the message
    });

  // Drop files or folders on Tracks: they go into the release's folder (loose audio into Bounces, folders as they
  // are, so "Stems" / "Projects" folders land where the scan looks), then the folder is scanned.
  // A single folder dropped with no release selected (or on request) becomes a new release of its own.
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const items = await droppedItems(e.dataTransfer); // reads the drop's entries before its first await
    if (!items.length) return;
    const tops = new Set(items.map((i) => i.sub?.[0] ?? ''));
    const oneFolder = tops.size === 1 && !tops.has('') ? [...tops][0] : null;
    let target = release;
    if (
      oneFolder &&
      (!release || (await dialog.confirm(`Make "${oneFolder}" a new release?`, { ok: 'New release', cancel: `Add to ${release.title}` })))
    ) {
      const spaces = (me?.spaces || []).filter((s) => s.online && s.id !== 'me' && ['upload', 'edit'].includes(s.rights));
      let last = '';
      try {
        last = localStorage.getItem('sk_new_space') || '';
      } catch {}
      const space = spaces.find((s) => s.id === last) || spaces[0];
      if (!space) return setMsg("You can't add files to any team space. Ask an admin for upload rights.");
      const name =
        oneFolder
          .replace(/[<>:"|?*\\/\x00-\x1f]/g, '')
          .trim()
          .replace(/[. ]+$/, '') || 'New release';
      try {
        target = await api('/api/tracks/release', {
          method: 'POST',
          body: JSON.stringify({ title: name, folder: { space: space.id, path: `Releases/${name}` }, setup: true }),
        });
      } catch (err) {
        return setMsg((err as Error).message);
      }
      items.forEach((i) => (i.sub = i.sub!.slice(1))); // the folder's contents go straight into the release folder
      pickRelease(target!.id);
    }
    if (!target?.folder) return setMsg('Link this release to a folder first (Folder... in the toolbar), then drop files on it.');
    const f = target.folder;
    items.forEach((i) => !i.sub?.length && /\.(wav|aiff?|flac|mp3|m4a|ogg)$/i.test(i.name) && (i.sub = ['Bounces']));
    setBusy(true);
    try {
      await uploadFiles(getToken, f.space, f.path.split('/'), items, (s, n) =>
        setMsg(`Uploading ${items.length} file(s) to ${target!.title}... ${Math.round((s / n) * 100)}%`),
      );
      const found: Found = await api(`/api/tracks/release/${target.id}?scan`, { method: 'POST' });
      await load();
      setMsg(`Uploaded ${items.length} file(s). ${foundText(found)}`);
    } catch (err) {
      setMsg(`Upload stopped: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const addTrack = async () => {
    if (!release) return;
    const title = (await dialog.prompt('Track title:', '', { title: `Add a track to ${release.title}` }))?.trim();
    if (!title) return;
    run(async () => {
      const t = await api('/api/tracks/track', { method: 'POST', body: JSON.stringify({ release: release.id, title }) });
      setTrackId(t.id);
    });
  };
  const patchRelease = (body: object) =>
    run(() => api(`/api/tracks/release/${release!.id}`, { method: 'PATCH', body: JSON.stringify(body) }));

  if (!data) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;
  const done = tracks.filter((t) => t.status === 'Done').length;

  return (
    <div style={shell}>
      <div style={toolbar}>
        {releases.length > 0 && (
          <select value={release?.id} onChange={(e) => pickRelease(e.target.value)} style={input}>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.kind})
              </option>
            ))}
          </select>
        )}
        <button style={button} onClick={newRelease}>
          <IconLabel icon="plus">New release...</IconLabel>
        </button>
        {release && (
          <>
            <button style={{ ...button, fontWeight: 700 }} onClick={addTrack}>
              <IconLabel icon="note">Add track...</IconLabel>
            </button>
            <select value={release.kind} onChange={(e) => patchRelease({ kind: e.target.value })} style={input} title="Kind of release">
              {data.kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <label title="Release date">
              Out{' '}
              <input
                type="date"
                value={release.date || ''}
                onChange={(e) => patchRelease({ date: e.target.value || null })}
                style={input}
              />
            </label>
            {release.folder ? (
              <>
                <button
                  style={button}
                  title={`Open ${release.folder.path}`}
                  onClick={() => {
                    const parts = release.folder!.path.split('/');
                    openRef({
                      kind: 'folder',
                      title: parts[parts.length - 1],
                      app: release.folder!.space,
                      dir: parts.slice(0, -1),
                      name: parts[parts.length - 1],
                    });
                  }}
                >
                  <IconLabel icon="external">Folder</IconLabel>
                </button>
                <button
                  style={button}
                  disabled={busy}
                  onClick={scan}
                  title="Look for new bounces, projects, stems and artwork in the folder"
                >
                  <IconLabel icon="refresh">Scan</IconLabel>
                </button>
              </>
            ) : (
              (release.owner === me?.username || me?.admin) && (
                <button
                  style={button}
                  onClick={() => setLinking(true)}
                  title="Point this release at a folder: its files fill the tracks in"
                >
                  <IconLabel icon="link">Folder...</IconLabel>
                </button>
              )
            )}
            <button style={button} onClick={() => setSharing(true)} title="Who can see this release">
              {release.members ? `🔒 ${release.members.length + 1} people` : 'Everyone'}...
            </button>
            <label
              style={{ display: 'flex', gap: 3, alignItems: 'center' }}
              title="Announce it in the Welcome window visitors see (title, kind and release date only)"
            >
              <input
                type="checkbox"
                checked={!!release.public}
                disabled={!!release.members}
                onChange={(e) => patchRelease({ public: e.target.checked })}
              />
              Announce publicly
            </label>
            {release.public && !release.members && (
              <>
                <button style={button} onClick={() => setPageSetup(true)} title="What the public page says: blurb and its story">
                  Public page...
                </button>
                {release.slug && (
                  <a href={`/release/${release.slug}`} target="_blank" rel="noopener noreferrer" title="Open the public page">
                    /release/{release.slug}
                  </a>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div
        ref={box}
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
          gap: 4,
          padding: '0 2px',
          position: 'relative',
          outline: dragging ? '2px dashed #000080' : undefined,
          outlineOffset: -2,
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
        onDrop={drop}
      >
        {!release ? (
          <div style={{ ...listBox, padding: 16 }}>
            No releases yet. Click <b>New release...</b> to start one (an album, EP or single), or drop a folder of bounces here.
          </div>
        ) : (
          <div style={{ ...listBox, flex: track && !narrow ? '0 0 42%' : 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['#', 'Title', 'Status', 'BPM', 'Key', 'Due'].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setTrackId(t.id === trackId ? null : t.id)}
                    style={t.id === trackId ? { background: '#000080', color: '#fff' } : undefined}
                  >
                    <td style={td}>{t.n}</td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      {t.title}
                      {t.bounce ? ' ♪' : ''}
                    </td>
                    <td style={td}>
                      <StatusChip s={t.status} />
                    </td>
                    <td style={td}>{t.bpm}</td>
                    <td style={td}>{t.key}</td>
                    <td
                      style={{
                        ...td,
                        color: t.deadline && daysUntil(t.deadline) <= 3 && t.status !== 'Done' && t.id !== trackId ? '#a00000' : undefined,
                      }}
                    >
                      {t.deadline ? due(t.deadline) : ''}
                    </td>
                  </tr>
                ))}
                {!tracks.length && (
                  <tr>
                    <td style={td} colSpan={6}>
                      No tracks yet. Click <b>Add track...</b>
                      {release.folder ? ', or drop bounces here ("03 Song v2.wav" becomes track 3).' : ''}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {track && (
          <TrackPage
            key={track.id}
            track={track}
            statuses={data.statuses}
            canRemove={!!me && (release!.owner === me.username || me.admin)}
            overlay={narrow}
            onChange={load}
            onClose={() => setTrackId(null)}
            setMsg={setMsg}
          />
        )}
        {linking && release && (
          <FilePicker
            title={`Folder for ${release.title}`}
            mode="folder"
            onPick={(r) => {
              setLinking(false);
              if (r)
                run(async () => {
                  const x = await api(`/api/tracks/release/${release.id}`, { method: 'PATCH', body: JSON.stringify({ folder: r }) });
                  if (x.found) setTimeout(() => setMsg(foundText(x.found)));
                });
            }}
          />
        )}
        {pageSetup && release && (
          <PageSetup
            release={release}
            onSave={(body) => {
              setPageSetup(false);
              patchRelease(body);
            }}
            onClose={() => setPageSetup(false)}
          />
        )}
        {sharing && release && (
          <MembersPicker
            title={`Who can see ${release.title}`}
            members={release.members}
            always={release.owner}
            note="Everyone = every member. Pick people to keep it private (you and admins always see it)."
            onSave={(m) => patchRelease({ members: m && m.filter((u) => u !== release.owner) })}
            onClose={() => setSharing(false)}
          />
        )}
      </div>
      <div style={statusBar}>
        {msg ||
          (release
            ? `${release.title} · ${tracks.length} track(s), ${done} done${release.date ? ` · out ${due(release.date)} (${release.date})` : ''}`
            : '')}
      </div>
    </div>
  );
};

const StatusChip: React.FC<{ s: string }> = ({ s }) => (
  <span style={{ background: STATUS_COLORS[s] || '#808080', color: '#fff', padding: '0 5px', fontSize: 10, whiteSpace: 'nowrap' }}>
    {s}
  </span>
);

/** One song: bounce player, project check-out state, stems, links, credits, notes, deadline, history. */
const TrackPage: React.FC<{
  track: Track;
  statuses: string[];
  canRemove: boolean;
  overlay: boolean; // narrow window: cover the track list instead of sitting beside it
  onChange: () => void;
  onClose: () => void;
  setMsg: (m: string) => void;
}> = ({ track: t, statuses, canRemove, overlay, onChange, onClose, setMsg }) => {
  const api = useApi();
  const openRef = useOpenRef();
  const { openWindow } = useWindowManager();
  const { getToken } = useAuth();
  const [draft, setDraft] = useState(t);
  const [picking, setPicking] = useState<null | 'bounce' | 'project' | 'stems'>(null);
  const [token, setToken] = useState('');
  const [versions, setVersions] = useState<{ name: string; modified: string }[]>([]);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [bmiOpen, setBmiOpen] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);

  useEffect(() => setDraft(t), [t]);
  useEffect(() => {
    getToken().then((x) => setToken(x || ''));
  }, [getToken, t.bounce?.path]);
  useEffect(() => {
    setVersions([]);
    if (t.bounce) api(`${fileUrl(t.bounce.space, t.bounce.path.split('/'))}?versions`).then(setVersions, () => {});
  }, [api, t.bounce?.space, t.bounce?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setProject(null);
    if (t.project)
      api(`/api/projects?space=${encodeURIComponent(t.project.space)}&path=${encodeURIComponent(t.project.path)}`).then(
        setProject,
        () => {},
      );
  }, [api, t.project?.space, t.project?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body: Partial<Track> | { follow: boolean }) => {
    try {
      await api(`/api/tracks/track/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg('');
      onChange();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  // Text fields save when you leave them, only if they changed
  const text = (k: 'title' | 'bpm' | 'key' | 'credits' | 'notes') => ({
    value: draft[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: e.target.value }),
    onBlur: () => draft[k] !== t[k] && save({ [k]: draft[k] }),
  });
  const openFolder = (r: FileRef) => {
    const parts = r.path.split('/');
    openRef({ kind: 'folder', title: parts[parts.length - 1], app: r.space, dir: parts.slice(0, -1), name: parts[parts.length - 1] });
  };
  const bounceSrc = t.bounce && token ? `${fileUrl(t.bounce.space, t.bounce.path.split('/'))}?t=${token}` : '';

  return (
    <div
      style={{
        ...listBox,
        flex: 1,
        background: '#c0c0c0',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...(overlay ? { position: 'absolute', inset: 0, zIndex: 5 } : {}),
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          style={{ ...input, width: 34 }}
          type="number"
          min={1}
          value={draft.n}
          onChange={(e) => setDraft({ ...draft, n: Number(e.target.value) })}
          onBlur={() => draft.n !== t.n && save({ n: draft.n })}
          title="Track number"
        />
        <input style={{ ...input, flex: 1, fontWeight: 700, fontSize: 13 }} {...text('title')} />
        <button style={button} onClick={onClose} title="Close the track page">
          <RetroIcon name="close" />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        Status
        <select value={t.status} onChange={(e) => save({ status: e.target.value })} style={input}>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        BPM <input style={{ ...input, width: 44 }} {...text('bpm')} />
        Key <input style={{ ...input, width: 60 }} placeholder="e.g. F#m" {...text('key')} />
        Due
        <input type="date" value={t.deadline || ''} onChange={(e) => save({ deadline: e.target.value || null })} style={input} />
        <label
          style={{ display: 'flex', gap: 3, alignItems: 'center' }}
          title="Get notified about status changes, new bounces and the deadline"
        >
          <input type="checkbox" checked={t.following} onChange={(e) => save({ follow: e.target.checked })} />
          Follow
        </label>
      </div>

      <Section title="Current bounce">
        {t.bounce ? (
          <>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.bounce.path.split('/').pop()}
              </b>
              <button
                style={button}
                onClick={() => {
                  const parts = t.bounce!.path.split('/');
                  openWindow({
                    id: `preview-${t.bounce!.space}-${t.bounce!.path}`,
                    title: parts[parts.length - 1],
                    icon: '/images/icons/media-player-16x16.png',
                    appType: 'file-preview',
                    appProps: {
                      app: t.bounce!.space,
                      dir: parts.slice(0, -1),
                      name: parts[parts.length - 1],
                      siblings: [parts[parts.length - 1]],
                    },
                    width: 720,
                    height: 520,
                  });
                }}
                title="Waveform with timestamped comments"
              >
                <IconLabel icon="chat">Comments...</IconLabel>
              </button>
              <button style={button} onClick={() => setPicking('bounce')}>
                Change...
              </button>
            </div>
            {bounceSrc && fileKind(t.bounce.path) === 'audio' && (
              <>
                <audio ref={(el) => void (media.current = el)} src={bounceSrc} preload="metadata" />
                <MediaControls media={media} src={bounceSrc} />
              </>
            )}
            {versions.length > 0 && (
              <details>
                <summary>Earlier bounces ({versions.length})</summary>
                {versions
                  .sort((a, b) => b.name.localeCompare(a.name))
                  .map((v) => (
                    <div key={v.name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ flex: 1 }}>{new Date(v.modified).toLocaleString()}</span>
                      <button
                        style={button}
                        onClick={() => {
                          if (!media.current) return;
                          media.current.src = `${fileUrl(t.bounce!.space, t.bounce!.path.split('/'))}?version=${encodeURIComponent(v.name)}&t=${token}`;
                          media.current.play();
                        }}
                      >
                        Play
                      </button>
                    </div>
                  ))}
              </details>
            )}
          </>
        ) : (
          <button style={button} onClick={() => setPicking('bounce')}>
            <IconLabel icon="note">Choose the bounce...</IconLabel>
          </button>
        )}
      </Section>

      <Section title="Project and stems">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ minWidth: 48 }}>Project</span>
          {t.project ? (
            <>
              <span style={{ flex: 1 }}>
                <b>{t.project.path.split('/').pop()}</b>
                {project && (
                  <span style={{ color: '#444' }}>
                    {' '}
                    · {project.kind} ·{' '}
                    {project.lock ? `🔒 checked out by ${project.lock.user}` : project.turn ? `${project.turn.user}'s turn` : 'free'}
                  </span>
                )}
              </span>
              <button style={button} onClick={() => openFolder(t.project!)}>
                <IconLabel icon="external">Open</IconLabel>
              </button>
            </>
          ) : (
            <span style={{ flex: 1, color: '#666' }}>none</span>
          )}
          <button style={button} onClick={() => setPicking('project')}>
            {t.project ? 'Change...' : 'Choose...'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ minWidth: 48 }}>Stems</span>
          <span style={{ flex: 1 }}>{t.stems ? <b>{t.stems.path.split('/').pop()}</b> : <span style={{ color: '#666' }}>none</span>}</span>
          {t.stems && (
            <button style={button} onClick={() => openFolder(t.stems!)}>
              <IconLabel icon="external">Open</IconLabel>
            </button>
          )}
          <button style={button} onClick={() => setPicking('stems')}>
            {t.stems ? 'Change...' : 'Choose...'}
          </button>
        </div>
      </Section>

      <Section title="Public page">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={!!t.onPage} onChange={(e) => save({ onPage: e.target.checked })} />
          Show on the release's public page (title, credits, links)
        </label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', opacity: t.onPage ? 1 : 0.5 }}>
          <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <input
              type="checkbox"
              disabled={!t.onPage || !t.bounce}
              checked={t.previewAt !== null && t.previewAt !== undefined}
              onChange={(e) => save({ previewAt: e.target.checked ? 30 : null })}
            />
            30-second preview, starting at
          </label>
          <input
            key={t.previewAt ?? 'none'}
            style={{ ...input, width: 52 }}
            disabled={t.previewAt === null || t.previewAt === undefined}
            defaultValue={mmss(t.previewAt ?? 30)}
            onBlur={(e) => {
              const v = seconds(e.target.value);
              if (v === null) setMsg('Preview start looks like 1:15');
              else if (v !== t.previewAt) save({ previewAt: v });
            }}
            title="Minutes:seconds into the bounce"
          />
          {!t.bounce && <span style={{ color: '#666' }}>(needs a bounce)</span>}
        </div>
        <div style={{ color: '#555' }}>Visitors only ever hear the 30 seconds; the bounce itself stays private.</div>
      </Section>

      <Section title="Links">
        {LINKS.map(([k, label]) => (
          <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ minWidth: 70 }}>{label}</span>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="https://..."
              value={draft.links[k] || ''}
              onChange={(e) => setDraft({ ...draft, links: { ...draft.links, [k]: e.target.value } })}
              onBlur={() => (draft.links[k] || '') !== (t.links[k] || '') && save({ links: draft.links })}
            />
            {t.links[k] && (
              <a href={t.links[k]} target="_blank" rel="noopener noreferrer" style={{ ...button, textDecoration: 'none', color: '#000' }}>
                <IconLabel icon="external">Open</IconLabel>
              </a>
            )}
          </div>
        ))}
      </Section>

      <Section title="BMI registration">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{bmiStatus(t.bmi)}</span>
          <button style={button} onClick={() => setBmiOpen(true)}>
            BMI sheet...
          </button>
        </div>
      </Section>
      {bmiOpen && (
        <BmiSheet
          track={t}
          onClose={() => setBmiOpen(false)}
          onSave={async (bmi) => {
            try {
              await api(`/api/tracks/track/${t.id}`, { method: 'PATCH', body: JSON.stringify({ bmi }) });
              onChange();
              return true;
            } catch (e) {
              setMsg((e as Error).message);
              return false;
            }
          }}
        />
      )}

      <Section title="Credits">
        <textarea
          rows={3}
          style={{ ...input, width: '100%', resize: 'vertical' }}
          placeholder="Produced by..., vocals..., mixed by..."
          {...text('credits')}
        />
      </Section>
      <Section title="Notes">
        <textarea
          rows={4}
          style={{ ...input, width: '100%', resize: 'vertical' }}
          placeholder="Lyrics, ideas, what's left to do..."
          {...text('notes')}
        />
      </Section>

      <details>
        <summary>History</summary>
        {t.history.map((h, i) => (
          <div key={i}>
            <span style={{ color: '#666' }}>{new Date(h.at).toLocaleString()}</span> <b>{h.user}</b> {h.action}
          </div>
        ))}
      </details>
      {canRemove && (
        <div>
          <button
            style={button}
            onClick={async () =>
              (await dialog.confirm(`Remove "${t.title}" from the release? Its files are not touched.`, { icon: 'warning' })) &&
              api(`/api/tracks/track/${t.id}`, { method: 'DELETE' }).then(
                () => (onClose(), onChange()),
                (e) => setMsg(e.message),
              )
            }
          >
            <IconLabel icon="close">Remove track</IconLabel>
          </button>
        </div>
      )}

      {picking && (
        <FilePicker
          title={
            picking === 'bounce'
              ? 'Choose the current bounce'
              : picking === 'project'
                ? 'Choose the project folder'
                : 'Choose the stems folder'
          }
          mode={picking === 'bounce' ? 'file' : 'folder'}
          accept={picking === 'bounce' ? (n) => ['audio', 'video'].includes(fileKind(n)) : undefined}
          start={t[picking]}
          onPick={(r) => {
            const k = picking;
            setPicking(null);
            if (r) save({ [k]: r });
          }}
        />
      )}
    </div>
  );
};

interface BmiWriter {
  name: string;
  pro: string;
  ipi: string;
  share: number;
  publisher: string;
  publisherIpi: string;
}
interface Bmi {
  altTitle: string;
  artist: string;
  duration: string;
  isrc: string;
  iswc: string;
  samples: string;
  workId: string;
  registered: string | null;
  writers: BmiWriter[];
}
const PROS = ['BMI', 'ASCAP', 'SESAC', 'GMR', 'SOCAN', 'PRS', 'Other', 'None'];
const NEW_WRITER: BmiWriter = { name: '', pro: 'BMI', ipi: '', share: 0, publisher: '', publisherIpi: '' };
const emptyBmi = (): Bmi => ({
  altTitle: '',
  artist: '',
  duration: '',
  isrc: '',
  iswc: '',
  samples: '',
  workId: '',
  registered: null,
  writers: [{ ...NEW_WRITER, share: 100 }],
});
const shareTotal = (b: Bmi) => Math.round(b.writers.reduce((n, w) => n + (Number(w.share) || 0), 0) * 100) / 100;
/** What's missing before it can go into BMI's work registration. */
const bmiChecks = (b: Bmi) => {
  const out: string[] = [];
  const total = shareTotal(b);
  if (total !== 100) out.push(`Writer shares add up to ${total}%, not 100%.`);
  b.writers.forEach((w, i) => {
    const who = w.name || `Writer ${i + 1}`;
    if (!w.name) out.push(`Writer ${i + 1} has no name.`);
    if (w.pro !== 'None' && !w.ipi) out.push(`${who}: add their IPI/CAE number (on their ${w.pro} account).`);
    if (w.publisher && !w.publisherIpi) out.push(`${who}'s publisher ${w.publisher}: add its IPI number.`);
  });
  if (!b.duration) out.push('Add the duration (m:ss).');
  return out;
};

/** "Registered: BMI work #...", "Draft: 2 thing(s) to fill in" or "Not started." */
const bmiStatus = (b?: Bmi | null) => {
  if (!b) return 'Not started.';
  if (b.workId) return `Registered: BMI work #${b.workId}${b.registered ? ` (${b.registered})` : ''}.`;
  const n = bmiChecks({ ...emptyBmi(), ...b }).length;
  return n ? `Draft: ${n} thing(s) to fill in.` : 'Ready to register.';
};

/** The song's BMI work registration, laid out in the order BMI's form asks, plus a printable split sheet. */
const BmiSheet: React.FC<{ track: Track; onSave: (bmi: Bmi) => Promise<boolean>; onClose: () => void }> = ({ track, onSave, onClose }) => {
  const [b, setB] = useState<Bmi>({ ...emptyBmi(), ...track.bmi });
  const [note, setNote] = useState('');
  const set = (k: keyof Bmi, v: string) => setB({ ...b, [k]: v });
  const setW = (i: number, k: keyof BmiWriter, v: string | number) =>
    setB({ ...b, writers: b.writers.map((w, j) => (j === i ? { ...w, [k]: v } : w)) });
  const checks = bmiChecks(b);
  const asText = () =>
    [
      `Title: ${track.title}`,
      b.altTitle ? `Alternate title: ${b.altTitle}` : null,
      `Duration: ${b.duration}`,
      b.artist ? `Performing artist: ${b.artist}` : null,
      b.isrc ? `ISRC: ${b.isrc}` : null,
      b.iswc ? `ISWC: ${b.iswc}` : null,
      '',
      ...b.writers.map(
        (w) =>
          `Writer: ${w.name} | ${w.pro}${w.ipi ? ` IPI ${w.ipi}` : ''} | ${w.share}%` +
          (w.publisher ? ` | Publisher: ${w.publisher}${w.publisherIpi ? ` IPI ${w.publisherIpi}` : ''}` : ' | no publisher'),
      ),
      b.samples ? `\nSamples / interpolations: ${b.samples}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n');
  const splitSheet = () => {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const rows = b.writers
      .map(
        (w) =>
          `<tr><td>${esc(w.name)}</td><td>${esc(w.pro)}</td><td>${esc(w.ipi)}</td><td>${w.share}%</td><td>${esc(w.publisher || '-')}${
            w.publisherIpi ? `<br><small>IPI ${esc(w.publisherIpi)}</small>` : ''
          }</td><td class="sig"></td><td class="sig"></td></tr>`,
      )
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Split sheet - ${esc(track.title)}</title>
<style>body{font:14px Arial,sans-serif;margin:32px}h1{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:16px}
td,th{border:1px solid #000;padding:6px;text-align:left;vertical-align:top}.sig{width:140px;height:40px}p{margin:2px 0}</style>
<h1>Split sheet</h1><p><b>Song:</b> ${esc(track.title)}${b.altTitle ? ` (${esc(b.altTitle)})` : ''}</p>
${b.artist ? `<p><b>Artist:</b> ${esc(b.artist)}</p>` : ''}${b.duration ? `<p><b>Duration:</b> ${esc(b.duration)}</p>` : ''}
${b.isrc ? `<p><b>ISRC:</b> ${esc(b.isrc)}</p>` : ''}${b.iswc ? `<p><b>ISWC:</b> ${esc(b.iswc)}</p>` : ''}
<table><tr><th>Writer</th><th>PRO</th><th>IPI/CAE</th><th>Share</th><th>Publisher</th><th>Signature</th><th>Date</th></tr>${rows}
<tr><th colspan="3">Total</th><th>${shareTotal(b)}%</th><th colspan="3"></th></tr></table>
${b.samples ? `<p style="margin-top:12px"><b>Samples / interpolations:</b> ${esc(b.samples)}</p>` : ''}
<p style="margin-top:24px;color:#555">Everyone signing agrees to these writer shares of the composition.</p>`;
    const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })));
    if (w) w.onload = () => w.print();
  };
  const field = (k: keyof Bmi, label: string, hint = '') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label}
      <input style={input} value={(b[k] as string) || ''} placeholder={hint} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
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
      <div style={{ width: 'min(720px, 98%)', maxHeight: '96%', overflow: 'auto', background: '#c0c0c0', border: '2px outset #fff' }}>
        <div style={{ background: 'linear-gradient(90deg,#000080,#1084d0)', color: '#fff', fontWeight: 700, padding: '3px 6px' }}>
          BMI sheet: {track.title}
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Section title="The work">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
              {field('altTitle', 'Alternate title')}
              {field('duration', 'Duration', '3:25')}
              {field('artist', 'Performing artist')}
              {field('isrc', 'ISRC (recording)', 'US-ABC-26-00001')}
              {field('iswc', 'ISWC (if BMI gave one)', 'T-123.456.789-0')}
            </div>
          </Section>
          <Section title={`Writers and publishers (shares: ${shareTotal(b)}%)`}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th>Writer</th>
                    <th>PRO</th>
                    <th>IPI/CAE #</th>
                    <th>Share %</th>
                    <th>Publisher</th>
                    <th>Publisher IPI</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {b.writers.map((w, i) => (
                    <tr key={i}>
                      <td>
                        <input style={{ ...input, width: 120 }} value={w.name} onChange={(e) => setW(i, 'name', e.target.value)} />
                      </td>
                      <td>
                        <select style={input} value={w.pro} onChange={(e) => setW(i, 'pro', e.target.value)}>
                          {PROS.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input style={{ ...input, width: 100 }} value={w.ipi} onChange={(e) => setW(i, 'ipi', e.target.value)} />
                      </td>
                      <td>
                        <input
                          style={{ ...input, width: 56 }}
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={w.share}
                          onChange={(e) => setW(i, 'share', +e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          style={{ ...input, width: 110 }}
                          value={w.publisher}
                          placeholder="(none)"
                          onChange={(e) => setW(i, 'publisher', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          style={{ ...input, width: 100 }}
                          value={w.publisherIpi}
                          onChange={(e) => setW(i, 'publisherIpi', e.target.value)}
                        />
                      </td>
                      <td>
                        <button style={button} title="Remove" onClick={() => setB({ ...b, writers: b.writers.filter((_, j) => j !== i) })}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={button}
                disabled={b.writers.length >= 12}
                onClick={() => setB({ ...b, writers: [...b.writers, { ...NEW_WRITER }] })}
              >
                Add writer
              </button>
              <button
                style={button}
                disabled={!b.writers.length}
                title="Split 100% evenly between everyone listed"
                onClick={() => setB({ ...b, writers: b.writers.map((w) => ({ ...w, share: Math.round(10000 / b.writers.length) / 100 })) })}
              >
                Split evenly
              </button>
            </div>
          </Section>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            Samples or interpolations (what, whose, cleared?)
            <textarea
              rows={2}
              style={{ ...input, resize: 'vertical' }}
              value={b.samples}
              onChange={(e) => set('samples', e.target.value)}
            />
          </label>
          <Section title="Registered">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              BMI work #
              <input style={{ ...input, width: 110 }} value={b.workId} onChange={(e) => set('workId', e.target.value)} />
              on
              <input type="date" style={input} value={b.registered || ''} onChange={(e) => set('registered', e.target.value)} />
            </div>
          </Section>
          <div style={{ background: checks.length ? '#ffffe1' : '#e0ffe0', border: '1px solid #808080', padding: 6 }}>
            {checks.length
              ? checks.map((c) => <div key={c}>• {c}</div>)
              : 'Ready to register at BMI (Online Services > Works > Register a work).'}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
            {note && <span style={{ marginRight: 'auto' }}>{note}</span>}
            <button
              style={button}
              onClick={() =>
                navigator.clipboard.writeText(asText()).then(
                  () => setNote('Copied: paste it next to the BMI form.'),
                  () => setNote('Could not copy.'),
                )
              }
            >
              Copy for BMI
            </button>
            <button style={button} onClick={splitSheet} title="A split sheet everyone can sign">
              Print split sheet
            </button>
            <button style={button} onClick={onClose}>
              Close
            </button>
            <button
              style={{ ...button, fontWeight: 700 }}
              onClick={async () => {
                if (await onSave(b)) setNote('Saved.');
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/** A release's public page: a few lines about it, and the Story that is its visual world. */
const PageSetup: React.FC<{ release: Release; onSave: (body: PageBody) => void; onClose: () => void }> = ({ release, onSave, onClose }) => {
  const api = useApi();
  const { me } = useMe();
  const [blurb, setBlurb] = useState(release.blurb || '');
  const [story, setStory] = useState(release.story || '');
  const [stores, setStores] = useState<Record<string, string>>(release.stores || {});
  const [pageUntil, setPageUntil] = useState(release.pageUntil || '');
  const [stories, setStories] = useState<{ slug: string; title: string }[]>([]);
  useEffect(() => {
    // Stories are listed publicly once published (and admins can pick drafts)
    (me?.admin ? api('/api/stories') : api('/api/public/directory').then((d) => d.stories || [])).then(setStories, () => {});
  }, [api, me?.admin]);
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
      <div style={{ width: 'min(460px, 96%)', background: '#c0c0c0', border: '2px outset #fff' }}>
        <div style={{ background: 'linear-gradient(90deg,#000080,#1084d0)', color: '#fff', fontWeight: 700, padding: '3px 6px' }}>
          Public page for {release.title}
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          About it
          <textarea
            rows={5}
            style={{ ...input, resize: 'vertical' }}
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            placeholder="A few lines about the record: what it is, who made it, what it sounds like."
          />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Its story
            <select style={input} value={story} onChange={(e) => setStory(e.target.value)}>
              <option value="">(none)</option>
              {stories.map((st) => (
                <option key={st.slug} value={st.slug}>
                  {st.title}
                </option>
              ))}
            </select>
          </label>
          <div style={{ color: '#555' }}>
            The story (e.g. Heart of the Cities) gets an "Enter the world" button on the page once it's published.
          </div>
          <Section title="Where to listen (paste the links from your distributor)">
            <div
              style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 4, alignItems: 'center', maxHeight: 180, overflow: 'auto' }}
            >
              {STORES.map(([k, label]) => (
                <React.Fragment key={k}>
                  <span>{label}</span>
                  <input
                    style={input}
                    value={stores[k] || ''}
                    placeholder="https://..."
                    onChange={(e) => setStores((s) => ({ ...s, [k]: e.target.value }))}
                  />
                </React.Fragment>
              ))}
            </div>
            <div style={{ color: '#555' }}>
              Before the release date the page counts down and shows only Pre-save; from release day it shows the rest.
            </div>
          </Section>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Page ends on
            <input type="date" style={input} value={pageUntil} onChange={(e) => setPageUntil(e.target.value)} />
            <span style={{ color: '#555' }}>(optional: for a temporary page)</span>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={button} onClick={onClose}>
              Cancel
            </button>
            <button
              style={{ ...button, fontWeight: 700 }}
              onClick={() => onSave({ blurb, story: story || null, stores, pageUntil: pageUntil || null })}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <fieldset style={{ border: '2px groove #fff', margin: 0, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
    <legend>{title}</legend>
    {children}
  </fieldset>
);

const listBox: React.CSSProperties = { overflow: 'auto', background: '#fff', border: '2px inset #808080', minWidth: 0 };
const th: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  textAlign: 'left',
  fontWeight: 400,
  padding: '1px 6px',
  background: '#c0c0c0',
  borderRight: '1px solid #808080',
  borderBottom: '1px solid #808080',
};
const td: React.CSSProperties = { padding: '3px 6px', whiteSpace: 'nowrap', cursor: 'default', borderBottom: '1px solid #eee' };
const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default Tracks;
