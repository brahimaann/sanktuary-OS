import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { RANK, useApi, useMe } from '../utils/api';
import { parseWhen, describeWhen } from '../utils/when';
import { uploadFiles } from '../utils/upload';
import { useWindowManager } from '../wm/manager';
import { openStudio } from './Studio';
import { LogOn, shell, button } from './TeamFiles';
import FilePicker, { FileRef } from '../components/FilePicker';
import { IconLabel, IconName } from '../components/RetroIcon';
import { useOpenRef } from '../utils/refs';

type Kind = 'release' | 'song' | 'session' | 'article' | 'Shoot' | 'Artwork' | 'Video' | 'Event' | 'Drop' | 'post';

const KINDS: { id: Kind; label: string; icon: IconName; hint: string }[] = [
  { id: 'release', label: 'Release', icon: 'archive', hint: 'Album, EP or single, with its folders' },
  { id: 'song', label: 'Song', icon: 'note', hint: 'A track, with its bounce' },
  { id: 'session', label: 'Studio Scratch', icon: 'note', hint: 'Walk-in session with scratch folder & tags' },
  { id: 'article', label: 'Article / Draft', icon: 'link', hint: 'Native blog post or essay draft' },
  { id: 'Shoot', label: 'Shoot', icon: 'calendar', hint: 'Photo or video shoot' },
  { id: 'Artwork', label: 'Artwork', icon: 'calendar', hint: 'Cover, visuals, merch design (or moodboard link)' },
  { id: 'Video', label: 'Video', icon: 'play', hint: 'Music video, visualizer, video link' },
  { id: 'Event', label: 'Show / event', icon: 'bell', hint: 'Show, session, release party' },
  { id: 'Drop', label: 'Drop', icon: 'upload', hint: 'Merch or content drop' },
  { id: 'post', label: 'Substack post', icon: 'external', hint: 'External Substack publish' },
];

const FOLDER_BY_DEFAULT: Kind[] = ['Shoot', 'Artwork', 'Video', 'session'];
const SUBSTACK_NEW_POST = 'https://boroma.substack.com/publish/post';

interface Release {
  id: string;
  title: string;
  kind: string;
  folder?: FileRef | null;
}

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
  const openRef = useOpenRef();

  const [kind, setKind] = useState<Kind | null>(initial || null);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [releaseKind, setReleaseKind] = useState('Album');
  const [trackCount, setTrackCount] = useState(7);

  // Multi-artist and Multi-writer Chip States
  const [artistInput, setArtistInput] = useState('');
  const [artists, setArtists] = useState<string[]>(() => {
    const saved = remembered('sk_new_artist');
    return saved ? saved.split(',').map((s) => s.trim()).filter(Boolean) : [];
  });

  const [writerInput, setWriterInput] = useState('');
  const [writersList, setWritersList] = useState<string[]>(() => {
    const saved = remembered('sk_new_writers');
    return saved ? saved.split(',').map((s) => s.trim()).filter(Boolean) : [];
  });

  const [link, setLink] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [articleBody, setArticleBody] = useState('');

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

  // Adjust default track counts when release kind changes
  useEffect(() => {
    if (releaseKind === 'Album') setTrackCount(10);
    else if (releaseKind === 'EP') setTrackCount(5);
    else if (releaseKind === 'Single') setTrackCount(1);
  }, [releaseKind]);

  const spaces = (me?.spaces || []).filter((s) => s.online && s.id !== 'me' && RANK[s.rights] >= RANK.upload);
  const spaceId = spaces.some((s) => s.id === space) ? space : spaces[0]?.id || '';
  const spaceName = spaces.find((s) => s.id === spaceId)?.name || '';
  const parsed = useMemo(() => parseWhen(when), [when]);
  const release = releases.find((r) => r.id === releaseId);
  const isTimeline = !!kind && ['Shoot', 'Artwork', 'Video', 'Event', 'Drop'].includes(kind);

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
    openStudio(openWindow, 'songs');
  };

  const openTimeline = (id: string) => {
    window.dispatchEvent(new CustomEvent('sk:timeline-entry', { detail: id }));
    openStudio(openWindow, 'calendar');
  };

  const reset = () => {
    setTitle('');
    setWhen('');
    setWhere('');
    setFile(null);
    setExisting(null);
    setLink('');
    setSessionNotes('');
    setArticleBody('');
  };

  const post = (url: string, body: object, method = 'POST') => api(url, { method, body: JSON.stringify(body) });

  const credits = () => {
    const artistStr = artists.length > 0 ? artists.join(', ') : artistInput.trim();
    const allWriters = [...writersList];
    if (writerInput.trim() && !allWriters.includes(writerInput.trim())) {
      allWriters.push(writerInput.trim());
    }
    remember('sk_new_artist', artistStr);
    remember('sk_new_writers', allWriters.join(', '));
    return {
      artist: artistStr,
      writers: allWriters.map((name) => ({ name, pro: 'BMI' })),
    };
  };

  const addArtist = () => {
    const val = artistInput.trim();
    if (val && !artists.includes(val)) {
      setArtists([...artists, val]);
      setArtistInput('');
    }
  };

  const removeArtist = (idx: number) => {
    setArtists(artists.filter((_, i) => i !== idx));
  };

  const addWriter = () => {
    const val = writerInput.trim();
    if (val && !writersList.includes(val)) {
      setWritersList([...writersList, val]);
      setWriterInput('');
    }
  };

  const removeWriter = (idx: number) => {
    setWritersList(writersList.filter((_, i) => i !== idx));
  };

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
          ...credits(),
        });

        // Dynamic track expander: generate placeholder tracks if count > 0 and not Single
        if (releaseKind !== 'Single' && trackCount > 0) {
          setBusy(`Generating ${trackCount} tracks...`);
          for (let i = 1; i <= trackCount; i++) {
            await post('/api/tracks/track', { release: r.id, title: `Track ${i}` });
          }
        }

        setMsg(`Created ${r.title} with ${trackCount} track(s).`);
        openTracks(r.id);
      } else if (kind === 'song') {
        let r = release;
        if (!r) {
          setBusy('Making the single...');
          const folder = spaceId ? { space: spaceId, path: `Releases/${folderName(name)}` } : null;
          r = await post('/api/tracks/release', { title: name, kind: 'Single', folder, setup: !!folder, ...credits() });
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
      } else if (kind === 'session') {
        // Walk-in studio scratch logger
        setBusy('Creating scratch session workspace...');
        const dateTag = parsed?.date || new Date().toISOString().slice(0, 10);
        const sessDirName = folderName(`${dateTag} ${name}`);
        const sessionPath = `Sessions/${sessDirName}`;
        if (spaceId) {
          await api(`/api/files/${spaceId}/${sessionPath.split('/').map(encodeURIComponent).join('/')}?mkdir&parents`, {
            method: 'POST',
          });
        }
        // Save scratch session notes if provided
        if (sessionNotes.trim() && spaceId) {
          const noteBlob = new Blob([sessionNotes], { type: 'text/plain' });
          await uploadFiles(getToken, spaceId, ['Sessions', sessDirName], [{ file: noteBlob as File, name: 'session-notes.txt' }]);
        }
        setMsg(`Created scratch workspace in ${spaceName} › ${sessionPath}`);
        if (spaceId) {
          openRef({
            kind: 'folder',
            title: sessDirName,
            app: spaceId,
            dir: ['Sessions'],
            name: sessDirName,
          });
        }
      } else if (kind === 'article') {
        // Native blog article authoring
        setBusy('Creating draft article...');
        const p = await post('/api/blog/posts', {
          title: name,
          body: articleBody.trim() || sessionNotes.trim(),
        });
        setMsg(`Draft article "${p.title}" created. Finish it on /write (Write for CITIES); an admin publishes it from Admin Panel > CITIES.`);
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
          ...(link.trim() ? { link: link.trim() } : {}),
          ...(sessionNotes.trim() ? { notes: sessionNotes.trim() } : {}),
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
  const cap: React.CSSProperties = { width: 75, flexShrink: 0, fontWeight: 700 };

  return (
    <div style={{ ...shell, padding: 10, gap: 8, overflow: 'auto', position: 'relative' }}>
      <div style={row}>
        <button style={button} onClick={() => (setKind(null), setMsg(''))}>
          ‹ Back
        </button>
        <b style={{ fontSize: 13 }}>New {label.toLowerCase()}</b>
      </div>

      {/* Multi-Artist Tag/Chip Row */}
      {(kind === 'release' || (kind === 'song' && !release)) && (
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <span style={{ ...cap, marginTop: 4 }}>Artists</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {artists.map((a, i) => (
                <span
                  key={a}
                  style={{
                    background: '#e0e0e0',
                    border: '1px solid #808080',
                    padding: '1px 6px',
                    borderRadius: 2,
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {a}
                  <span
                    onClick={() => removeArtist(i)}
                    style={{ cursor: 'pointer', fontWeight: 700, color: '#a00000', fontSize: 10 }}
                  >
                    ×
                  </span>
                </span>
              ))}
              <input
                style={{ ...field, width: 140 }}
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addArtist();
                  }
                }}
                placeholder="+ Add artist (Enter)"
              />
              <button style={{ ...button, padding: '1px 6px', fontSize: 10 }} onClick={addArtist}>
                Add
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#666' }}>Multi-artist credits will be saved to track metadata.</div>
          </div>
        </div>
      )}

      {/* Title */}
      <label style={row}>
        <span style={cap}>{kind === 'release' ? 'Title' : kind === 'song' ? 'Song title' : 'What'}</span>
        <input
          autoFocus
          style={{ ...field, flex: 1, minWidth: 160 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
          placeholder={
            kind === 'release'
              ? 'The Summer I Missed You'
              : kind === 'song'
                ? 'Summer Nights'
                : kind === 'session'
                  ? 'Late Night Vocal Scratch'
                  : kind === 'article'
                    ? 'Reflections on the Suburbs'
                    : 'Cover shoot with Amara'
          }
        />
      </label>

      {/* Multi-Writer Tag/Chip Row */}
      {(kind === 'release' || (kind === 'song' && !release)) && (
        <div style={{ ...row, alignItems: 'flex-start' }} title="For the BMI sheets.">
          <span style={{ ...cap, marginTop: 4 }}>Writers</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              {writersList.map((w, i) => (
                <span
                  key={w}
                  style={{
                    background: '#e0e0e0',
                    border: '1px solid #808080',
                    padding: '1px 6px',
                    borderRadius: 2,
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {w}
                  <span
                    onClick={() => removeWriter(i)}
                    style={{ cursor: 'pointer', fontWeight: 700, color: '#a00000', fontSize: 10 }}
                  >
                    ×
                  </span>
                </span>
              ))}
              <input
                style={{ ...field, width: 140 }}
                value={writerInput}
                onChange={(e) => setWriterInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addWriter();
                  }
                }}
                placeholder="+ Add songwriter (Enter)"
              />
              <button style={{ ...button, padding: '1px 6px', fontSize: 10 }} onClick={addWriter}>
                Add
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#666' }}>Songwriters for BMI split registration.</div>
          </div>
        </div>
      )}

      {/* Release Kind & Dynamic Track Expander */}
      {kind === 'release' && (
        <>
          <label style={row}>
            <span style={cap}>Kind</span>
            <select style={field} value={releaseKind} onChange={(e) => setReleaseKind(e.target.value)}>
              {['Album', 'EP', 'Single'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          {releaseKind !== 'Single' && (
            <div style={row}>
              <span style={cap}>Tracks</span>
              <button
                style={{ ...button, padding: '1px 6px', fontSize: 11 }}
                onClick={() => setTrackCount((c) => Math.max(1, c - 1))}
              >
                -
              </button>
              <b style={{ minWidth: 24, textAlign: 'center' }}>{trackCount}</b>
              <button
                style={{ ...button, padding: '1px 6px', fontSize: 11 }}
                onClick={() => setTrackCount((c) => Math.min(30, c + 1))}
              >
                +
              </button>
              <span style={{ fontSize: 10, color: '#666' }}>Will automatically create Track 1..{trackCount} in Tracks.</span>
            </div>
          )}
        </>
      )}

      {/* Moodboard or Video URL Link Picker */}
      {(kind === 'Artwork' || kind === 'Video') && (
        <label style={row}>
          <span style={cap}>{kind === 'Artwork' ? 'Moodboard' : 'Video Link'}</span>
          <input
            style={{ ...field, flex: 1, minWidth: 160 }}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={
              kind === 'Artwork'
                ? 'https://... (Pinterest, Are.na, Figma, moodboard link)'
                : 'https://... (YouTube, Vimeo, Frame.io video link)'
            }
          />
        </label>
      )}

      {/* When / 16-bit Retro Calendar */}
      {kind !== 'article' && (
        <div style={row}>
          <span style={cap}>{kind === 'release' ? 'Out' : kind === 'song' ? 'Due' : 'When'}</span>
          <input
            style={{ ...field, width: 150 }}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
            placeholder={isTimeline ? 'next sat 8pm' : 'optional: oct 12'}
          />
          <div style={{ display: 'flex', gap: 2 }}>
            {['today', 'tomorrow', 'fri 8pm', 'next week'].map((quick) => (
              <button
                key={quick}
                style={{ ...button, fontSize: 10, padding: '1px 4px' }}
                onClick={() => setWhen(quick)}
              >
                {quick}
              </button>
            ))}
          </div>
          <span style={{ color: when && !parsed ? '#a00000' : '#000080', fontSize: 11 }}>
            {parsed
              ? `→ ${describeWhen(kind === 'release' || kind === 'song' ? { ...parsed, time: '' } : parsed)}`
              : when
                ? "can't read that yet"
                : ''}
          </span>
        </div>
      )}

      {/* Where / Studio Location */}
      {isTimeline && (
        <div style={row}>
          <span style={cap}>Where</span>
          <input
            style={{ ...field, flex: 1, minWidth: 160 }}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="Studio, venue, address..."
          />
          <div style={{ display: 'flex', gap: 2 }}>
            {['Studio A', 'Vocal Booth B', 'Warehouse', 'Online'].map((loc) => (
              <button
                key={loc}
                style={{ ...button, fontSize: 10, padding: '1px 4px' }}
                onClick={() => setWhere(loc)}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notes / Walk-in Session Scratch Notes */}
      {(kind === 'session' || kind === 'article' || isTimeline) && (
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <span style={{ ...cap, marginTop: 4 }}>{kind === 'article' ? 'Body' : 'Notes'}</span>
          <textarea
            style={{ ...field, flex: 1, minHeight: 60, fontFamily: 'inherit', resize: 'vertical' }}
            value={kind === 'article' ? articleBody : sessionNotes}
            onChange={(e) => (kind === 'article' ? setArticleBody(e.target.value) : setSessionNotes(e.target.value))}
            placeholder={
              kind === 'article'
                ? 'Write your post here (blank line = new paragraph)...'
                : 'Session scratch ideas, gear used, tempo, scratch lyric tags...'
            }
          />
        </div>
      )}

      {/* Release Selection for Songs or Timeline */}
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

      {/* Song Bounce Upload */}
      {kind === 'song' && (
        <div style={row}>
          <span style={cap}>Bounce</span>
          {!release || release.folder ? (
            <>
              <input type="file" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <span style={{ color: '#444', fontSize: 11 }}>optional; goes in the release's Bounces folder</span>
            </>
          ) : (
            <span style={{ color: '#444', fontSize: 11 }}>{release.title} has no folder yet: link one in Tracks to add files here.</span>
          )}
        </div>
      )}

      {/* Release Folders */}
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
        </fieldset>
      )}

      {/* Scratch Session Space */}
      {kind === 'session' && (
        <div style={row}>
          <span style={cap}>Space</span>
          <span>Save session workspace in </span>
          <SpaceSelect spaces={spaces} value={spaceId} onChange={setSpace} />
          <span style={{ color: '#666', fontSize: 11 }}>› Sessions</span>
        </div>
      )}

      {/* Timeline Folder */}
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

      {/* Submit Button */}
      <div style={{ ...row, marginTop: 4 }}>
        <button style={{ ...button, fontWeight: 700, padding: '4px 16px' }} disabled={!!busy} onClick={create}>
          {kind === 'article' ? 'Create Draft' : kind === 'session' ? 'Start Session' : 'Create'}
        </button>
        <span style={{ fontSize: 11 }}>{busy || msg}</span>
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
