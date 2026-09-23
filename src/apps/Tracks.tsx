import React, { useCallback, useEffect, useRef, useState } from 'react';
import RetroIcon, { IconLabel } from '../components/RetroIcon';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
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
}
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
}

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
const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5);
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

  const newRelease = async () => {
    const title = (await dialog.prompt('Name of the album, EP or single:', '', { title: 'New release' }))?.trim();
    if (!title) return;
    run(async () => {
      const r = await api('/api/tracks/release', { method: 'POST', body: JSON.stringify({ title }) });
      pickRelease(r.id);
    });
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
            <button style={button} onClick={() => setSharing(true)} title="Who can see this release">
              {release.members ? `🔒 ${release.members.length + 1} people` : 'Everyone'}...
            </button>
          </>
        )}
      </div>
      <div ref={box} style={{ flex: 1, display: 'flex', minHeight: 0, gap: 4, padding: '0 2px', position: 'relative' }}>
        {!release ? (
          <div style={{ ...listBox, padding: 16 }}>
            No releases yet. Click <b>New release...</b> to start one (an album, EP or single), then add its tracks.
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
