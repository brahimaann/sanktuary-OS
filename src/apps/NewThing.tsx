import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { RANK, useApi, useMe } from '../utils/api';
import { parseWhen, describeWhen } from '../utils/when';
import { uploadFiles } from '../utils/upload';
import { useWindowManager } from '../wm/manager';
import { LogOn, shell, button } from './TeamFiles';
import FilePicker, { FileRef } from '../components/FilePicker';
import { IconLabel, IconName } from '../components/RetroIcon';

// "New..." from the Start menu: the few questions each kind of thing needs, and the rest is done for you.
// A release gets its folders (Bounces / Stems / Projects / Artwork) so files dropped there fill Tracks in;
// a shoot or video gets a folder for its files; dates are typed the way people say them ("next sat 8pm").
type Kind = 'release' | 'song' | 'Shoot' | 'Artwork' | 'Video' | 'Event' | 'Drop' | 'post';
const KINDS: { id: Kind; label: string; icon: IconName; hint: string }[] = [
  { id: 'release', label: 'Release', icon: 'archive', hint: 'Album, EP or single, with its folders' },
  { id: 'song', label: 'Song', icon: 'note', hint: 'A track, with its bounce' },
  { id: 'Shoot', label: 'Shoot', icon: 'calendar', hint: 'Photo or video shoot' },
  { id: 'Artwork', label: 'Artwork', icon: 'calendar', hint: 'Cover, visuals, merch design' },
  { id: 'Video', label: 'Video', icon: 'play', hint: 'Music video, visualizer, content' },
  { id: 'Event', label: 'Show / event', icon: 'bell', hint: 'Show, session, release party' },
  { id: 'Drop', label: 'Drop', icon: 'upload', hint: 'Merch or content drop' },
  { id: 'post', label: 'Blog post', icon: 'external', hint: 'Write it on Substack' },
];
const FOLDER_BY_DEFAULT: Kind[] = ['Shoot', 'Artwork', 'Video'];
const SUBSTACK_NEW_POST = 'https://boroma.substack.com/publish/post';

interface Release {
  id: string;
  title: string;
  kind: string;
  folder?: FileRef | null;
}

/** A title that works as a Windows folder name. */
const folderName = (s: string) =>
  s
    .replace(/[<>:"|?*\\/\x00-\x1f]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
const remembered = (k: string) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

const NewThing: React.FC<{ kind?: Kind }> = ({ kind }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="New" />;
  return <NewForm initial={kind} />;
};

const NewForm: React.FC<{ initial?: Kind }> = ({ initial }) => {
  const api = useApi();
  const { me } = useMe();
  const { getToken } = useAuth();
  const { openWindow } = useWindowManager();
  const [kind, setKind] = useState<Kind | null>(initial || null);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [releaseKind, setReleaseKind] = useState('Album');
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseId, setReleaseId] = useState(() => remembered('sk_tracks_release'));
  const [folderMode, setFolderMode] = useState<'new' | 'existing' | 'none'>('new');
  const [existing, setExisting] = useState<FileRef | null>(null);
  const [picking, setPicking] = useState(false);
  const [makeFolder, setMakeFolder] = useState(true);
  const [space, setSpace] = useState(() => remembered('sk_new_space'));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api('/api/tracks').then(
      (d) => setReleases(d.releases),
      () => {},
    );
  }, [api]);
  useEffect(() => {
    if (kind && kind !== 'release') setMakeFolder(FOLDER_BY_DEFAULT.includes(kind));
  }, [kind]);

  // Team spaces this member can add to (My Space is different for everyone, so shared work never goes there)
  const spaces = (me?.spaces || []).filter((s) => s.online && s.id !== 'me' && RANK[s.rights] >= RANK.upload);
  const spaceId = spaces.some((s) => s.id === space) ? space : spaces[0]?.id || '';
  const spaceName = spaces.find((s) => s.id === spaceId)?.name || '';
  const parsed = useMemo(() => parseWhen(when), [when]);
  const release = releases.find((r) => r.id === releaseId);
  const isTimeline = !!kind && !['release', 'song', 'post'].includes(kind);

  // Where a timeline entry's folder goes: inside its release's folder when it has one, else <space>/Timeline
  const entryFolder = (): FileRef | null => {
    if (!isTimeline || !makeFolder || !parsed) return null;
    const name = folderName(`${parsed.date} ${title}`);
    if (release?.folder) {
      const sub = kind === 'Video' ? 'Video' : kind === 'Shoot' || kind === 'Artwork' ? 'Artwork' : 'Events';
      return { space: release.folder.space, path: `${release.folder.path}/${sub}/${name}` };
    }
    return spaceId ? { space: spaceId, path: `Timeline/${name}` } : null;
  };
  const releaseFolder = (name: string): FileRef | null =>
    folderMode === 'existing'
      ? existing
      : folderMode === 'new' && spaceId
        ? { space: spaceId, path: `Releases/${folderName(name)}` }
        : null;

  const openTracks = (id: string) => {
    remember('sk_tracks_release', id);
    window.dispatchEvent(new CustomEvent('sk:tracks-release', { detail: id }));
    openWindow({ id: 'tracks', title: 'Tracks', icon: '/images/icons/media-player-16x16.png', appType: 'tracks', width: 900, height: 600 });
  };
  const openTimeline = (id: string) => {
    window.dispatchEvent(new CustomEvent('sk:timeline-entry', { detail: id }));
    openWindow({
      id: 'timeline',
      title: 'Timeline',
      icon: '/images/icons/task-scheduler-16x16.png',
      appType: 'timeline',
      width: 900,
      height: 600,
    });
  };
  const reset = () => {
    setTitle('');
    setWhen('');
    setWhere('');
    setFile(null);
    setExisting(null);
  };
  const post = (url: string, body: object, method = 'POST') => api(url, { method, body: JSON.stringify(body) });
  const foundText = (f?: { added: string[]; bounces: string[] } | null) =>
    f && (f.added.length || f.bounces.length) ? ` Found ${f.added.length} track(s) in the folder.` : '';

  const create = async () => {
    const name = title.trim();
    if (!name) return setMsg('Give it a title first.');
    if (when.trim() && !parsed) return setMsg(`Couldn't read "${when}" as a date. Try "fri", "oct 12" or "10/12".`);
    if (spaceId) remember('sk_new_space', spaceId);
    setMsg('');
    try {
      if (kind === 'release') {
        setBusy('Making the release...');
        const folder = releaseFolder(name);
        if (folderMode === 'existing' && !folder) return setMsg('Pick the folder first.');
        const r = await post('/api/tracks/release', {
          title: name,
          kind: releaseKind,
          date: parsed?.date ?? null,
          folder,
          setup: folderMode === 'new',
        });
        setMsg(`Made ${r.title}${folder ? ` with its folder in ${spaceName || folder.space}` : ''}.${foundText(r.found)}`);
        openTracks(r.id);
      } else if (kind === 'song') {
        let r = release;
        if (!r) {
          setBusy('Making the single...');
          const folder = spaceId ? { space: spaceId, path: `Releases/${folderName(name)}` } : null;
          r = await post('/api/tracks/release', { title: name, kind: 'Single', folder, setup: !!folder });
        }
        setBusy('Adding the track...');
        const t = await post('/api/tracks/track', { release: r!.id, title: name });
        if (parsed) await post(`/api/tracks/track/${t.id}`, { deadline: parsed.date }, 'PATCH');
        if (file && r!.folder) {
          const dir = [...r!.folder.path.split('/'), 'Bounces'];
          const [saved] = await uploadFiles(getToken, r!.folder.space, dir, [{ file, name: file.name }], (s, n) =>
            setBusy(`Uploading the bounce... ${Math.round((s / n) * 100)}%`),
          );
          await post(`/api/tracks/track/${t.id}`, { bounce: { space: r!.folder.space, path: [...dir, saved].join('/') } }, 'PATCH');
        }
        setMsg(`Added ${name} to ${r!.title}.`);
        openTracks(r!.id);
      } else if (isTimeline) {
        if (!parsed) return setMsg('When is it? e.g. "fri", "next sat 8pm", "oct 12".');
        setBusy('Adding it to the timeline...');
        const folder = entryFolder();
        if (folder)
          await api(`/api/files/${folder.space}/${folder.path.split('/').map(encodeURIComponent).join('/')}?mkdir&parents`, {
            method: 'POST',
          });
        const e = await post('/api/timeline', {
          title: name,
          kind,
          start: parsed.date,
          time: parsed.time,
          location: where.trim(),
          release: release?.id ?? null,
          folder,
        });
        setMsg(`Added "${e.title}" on ${describeWhen(parsed)}${folder ? `, with a folder for its files` : ''}.`);
        openTimeline(e.id);
      }
      reset();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (!kind || kind === 'post')
    return (
      <div style={{ ...shell, padding: 10, gap: 8, overflow: 'auto' }}>
        <div>What are you adding?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              style={{ ...button, padding: '8px 10px', textAlign: 'left', height: 'auto' }}
              onClick={() => (k.id === 'post' && window.open(SUBSTACK_NEW_POST, '_blank', 'noopener'), setKind(k.id))}
            >
              <IconLabel icon={k.icon}>
                <b>{k.label}</b>
              </IconLabel>
              <div style={{ color: '#444', fontSize: 10, marginTop: 2 }}>{k.hint}</div>
            </button>
          ))}
        </div>
        {kind === 'post' && <div>Substack opened in a new tab. Posts show up in the Blog on their own once they're published.</div>}
      </div>
    );

  const label = KINDS.find((k) => k.id === kind)!.label;
  const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };
  const cap: React.CSSProperties = { width: 70, flexShrink: 0 };
  return (
    <div style={{ ...shell, padding: 10, gap: 8, overflow: 'auto', position: 'relative' }}>
      <div style={row}>
        <button style={button} onClick={() => (setKind(null), setMsg(''))}>
          ‹ Back
        </button>
        <b style={{ fontSize: 13 }}>New {label.toLowerCase()}</b>
      </div>
      <label style={row}>
        <span style={cap}>{kind === 'release' ? 'Title' : kind === 'song' ? 'Song title' : 'What'}</span>
        <input
          autoFocus
          style={{ ...field, flex: 1, minWidth: 160 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
          placeholder={kind === 'release' ? 'The Summer I Missed You' : kind === 'song' ? 'Summer Nights' : 'Cover shoot with Amara'}
        />
      </label>
      {kind === 'release' && (
        <label style={row}>
          <span style={cap}>Kind</span>
          <select style={field} value={releaseKind} onChange={(e) => setReleaseKind(e.target.value)}>
            {['Album', 'EP', 'Single'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      )}
      <label style={row}>
        <span style={cap}>{kind === 'release' ? 'Out' : kind === 'song' ? 'Due' : 'When'}</span>
        <input
          style={{ ...field, width: 170 }}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
          placeholder={isTimeline ? 'next sat 8pm' : 'optional: oct 12'}
        />
        <span style={{ color: when && !parsed ? '#a00000' : '#000080' }}>
          {parsed
            ? `→ ${describeWhen(kind === 'release' || kind === 'song' ? { ...parsed, time: '' } : parsed)}`
            : when
              ? "can't read that yet"
              : ''}
        </span>
      </label>
      {isTimeline && (
        <label style={row}>
          <span style={cap}>Where</span>
          <input
            style={{ ...field, flex: 1, minWidth: 160 }}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="optional"
          />
        </label>
      )}
      {(kind === 'song' || isTimeline) && (
        <label style={row}>
          <span style={cap}>{kind === 'song' ? 'On' : 'For'}</span>
          <select style={field} value={release ? release.id : ''} onChange={(e) => setReleaseId(e.target.value)}>
            <option value="">{kind === 'song' ? 'A new single (its own release)' : 'No release'}</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.kind})
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'song' && (
        <div style={row}>
          <span style={cap}>Bounce</span>
          {!release || release.folder ? (
            <>
              <input type="file" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <span style={{ color: '#444' }}>optional; goes in the release's Bounces folder</span>
            </>
          ) : (
            <span style={{ color: '#444' }}>{release.title} has no folder yet: link one in Tracks to add files here.</span>
          )}
        </div>
      )}

      {kind === 'release' && (
        <fieldset
          style={{ border: '2px groove #fff', margin: 0, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <legend>Files</legend>
          <label style={row}>
            <input type="radio" checked={folderMode === 'new'} disabled={!spaces.length} onChange={() => setFolderMode('new')} />
            Make its folders in <SpaceSelect spaces={spaces} value={spaceId} onChange={setSpace} /> › Releases ›{' '}
            {folderName(title) || '...'}
          </label>
          <label style={row}>
            <input
              type="radio"
              checked={folderMode === 'existing'}
              onChange={() => (setFolderMode('existing'), !existing && setPicking(true))}
            />
            Use a folder that's already there
            {existing ? <b>{existing.path}</b> : null}
            <button style={button} onClick={() => (setFolderMode('existing'), setPicking(true))}>
              Choose...
            </button>
          </label>
          <label style={row}>
            <input type="radio" checked={folderMode === 'none'} onChange={() => setFolderMode('none')} />
            No folder for now
          </label>
          <div style={{ color: '#444' }}>
            Bounces, stems, Ableton projects and artwork put in the folder show up in Tracks by themselves: "03 Song v4.wav" becomes track 3
            with v4 as its current bounce.
          </div>
        </fieldset>
      )}
      {isTimeline && (
        <label style={row}>
          <input
            type="checkbox"
            checked={makeFolder}
            disabled={!release?.folder && !spaces.length}
            onChange={(e) => setMakeFolder(e.target.checked)}
          />
          Make a folder for its files
          {makeFolder && !release?.folder && spaces.length > 0 && (
            <>
              in <SpaceSelect spaces={spaces} value={spaceId} onChange={setSpace} /> › Timeline
            </>
          )}
          {makeFolder && release?.folder && <span style={{ color: '#444' }}>in {release.title}'s folder</span>}
        </label>
      )}
      <div style={{ ...row, marginTop: 4 }}>
        <button style={{ ...button, fontWeight: 700, padding: '4px 16px' }} disabled={!!busy} onClick={create}>
          Create
        </button>
        <span>{busy || msg}</span>
      </div>
      {picking && (
        <FilePicker
          title="Choose the release's folder"
          mode="folder"
          start={existing}
          onPick={(r) => {
            setPicking(false);
            if (r) setExisting(r);
            else if (!existing) setFolderMode(spaces.length ? 'new' : 'none');
          }}
        />
      )}
    </div>
  );
};

const SpaceSelect: React.FC<{ spaces: { id: string; name: string }[]; value: string; onChange: (id: string) => void }> = ({
  spaces,
  value,
  onChange,
}) => (
  <select style={field} value={value} onChange={(e) => onChange(e.target.value)}>
    {spaces.map((s) => (
      <option key={s.id} value={s.id}>
        {s.name}
      </option>
    ))}
  </select>
);

const field: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default NewThing;
