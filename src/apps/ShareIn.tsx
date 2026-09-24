import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { uploadFiles } from '../utils/upload';
import { readShared, clearShared, handOff, Shared } from '../utils/incoming';
import { useWindowManager } from '../wm/manager';
import { LogOn, shell, button } from './TeamFiles';
import FilePicker, { FileRef } from '../components/FilePicker';
import { fileKind } from './fileTypes';

// "Share to Sanktuary": what arrived from the phone's share menu (photos, bounces, voice notes, links), and
// where it goes: a song's bounce, a team folder, a moodboard or a chat.
type Dest = 'track' | 'folder' | 'board' | 'chat';
interface Release {
  id: string;
  title: string;
  kind: string;
  folder?: FileRef | null;
}
interface Track {
  id: string;
  release: string;
  n: number;
  title: string;
}
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);

const ShareIn: React.FC<{ missed?: boolean }> = ({ missed }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  // What was shared stays on the phone until it's put somewhere, so signing in first loses nothing
  if (!isSignedIn) return <LogOn name="Share to Sanktuary" />;
  return <ShareForm missed={missed} />;
};

const ShareForm: React.FC<{ missed?: boolean }> = ({ missed }) => {
  const api = useApi();
  const { getToken } = useAuth();
  const { openWindow, closeWindow } = useWindowManager();
  const [shared, setShared] = useState<Shared | null>(null);
  const [dest, setDest] = useState<Dest>('folder');
  const [releases, setReleases] = useState<Release[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [releaseId, setReleaseId] = useState('');
  const [trackId, setTrackId] = useState('');
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [chats, setChats] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState('');
  const [folder, setFolder] = useState<FileRef | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    readShared().then((s) => {
      setShared(s);
      const audio = s.files.some((f) => fileKind(f.name) === 'audio');
      const images = s.files.length > 0 && s.files.every((f) => fileKind(f.name) === 'image');
      setDest(audio ? 'track' : images ? 'board' : s.files.length ? 'folder' : 'chat');
    });
    api('/api/tracks').then(
      (d) => {
        setReleases(d.releases.filter((r: Release) => r.folder));
        setTracks(d.tracks);
      },
      () => {},
    );
    api('/api/boards?kind=canvas').then(setBoards, () => {});
    api('/api/chat').then(
      (d) =>
        setChats([
          ...d.channels.map((c: { id: string; name: string }) => ({ id: c.id, name: `#${c.name}` })),
          ...d.dms.map((m: { id: string; with: string }) => ({ id: m.id, name: `${m.with} (message)` })),
        ]),
      () => {},
    );
  }, [api]);

  const release = releases.find((r) => r.id === releaseId) || releases[0];
  const releaseTracks = tracks.filter((t) => t.release === release?.id).sort((a, b) => a.n - b.n);
  const files = shared?.files || [];
  const done = async (text: string) => {
    await clearShared();
    setShared({ files: [], text: '' });
    setMsg(text);
  };
  const progress = (s: number, n: number) => setBusy(`Uploading... ${Math.round((s / n) * 100)}%`);

  const send = async () => {
    if (!shared) return;
    setMsg('');
    try {
      if (dest === 'track') {
        if (!release?.folder) return setMsg('Pick a release (only releases with a folder can take files).');
        const f = release.folder;
        const dir = [...f.path.split('/'), 'Bounces'];
        const saved = await uploadFiles(
          getToken,
          f.space,
          dir,
          files.map((file) => ({ file, name: file.name })),
          progress,
        );
        const i = files.findIndex((x) => fileKind(x.name) === 'audio');
        if (trackId && i >= 0)
          await api(`/api/tracks/track/${trackId}`, {
            method: 'PATCH',
            body: JSON.stringify({ bounce: { space: f.space, path: [...dir, saved[i]].join('/') } }),
          });
        else await api(`/api/tracks/release/${release.id}?scan`, { method: 'POST' }); // new songs become tracks
        await done(`Put ${files.length} file(s) in ${release.title}.`);
      } else if (dest === 'folder') {
        if (!folder) return setPicking(true);
        await uploadFiles(
          getToken,
          folder.space,
          folder.path.split('/'),
          files.map((file) => ({ file, name: file.name })),
          progress,
        );
        await done(`Put ${files.length} file(s) in ${folder.path}.`);
      } else if (dest === 'board') {
        const b = boards.find((x) => x.id === target) || boards[0];
        if (!b) return setMsg('No moodboards yet: make one in Moodboards first.');
        handOff(`canvas:${b.id}`, shared);
        openWindow({
          id: `canvas-${b.id}`,
          title: b.name,
          icon: '/images/icons/paint-16x16.png',
          appType: 'canvas',
          appProps: { boardId: b.id, name: b.name },
          width: 1000,
          height: 680,
        });
        await done(`Adding to ${b.name}...`);
      } else {
        const c = chats.find((x) => x.id === target) || chats[0];
        if (!c) return setMsg('No conversations yet.');
        handOff(`chat:${c.id}`, shared);
        openWindow({
          id: `chat-${c.id}`,
          title: c.name,
          icon: '/images/icons/outlook-express-16x16.png',
          appType: 'chat',
          appProps: { channel: c.id },
          width: 460,
          height: 420,
        });
        await done(`Attached to ${c.name}: press Send there.`);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };
  if (!shared) return <div style={{ ...shell, padding: 16 }}>Opening what you shared...</div>;
  if (!files.length && !shared.text)
    return (
      <div style={{ ...shell, padding: 12, gap: 8 }}>
        {msg ? (
          <b>{msg}</b>
        ) : missed ? (
          <div>
            That share didn't come through: Sanktuary wasn't ready on this phone yet. Open Sanktuary from your home screen once, then share
            again.
          </div>
        ) : (
          <div>Nothing waiting to be shared. From your phone's Photos, Files or Voice Memos, tap Share and pick Sanktuary.</div>
        )}
        <div style={{ color: '#444' }}>
          Sanktuary shows up in the share menu on Android once it's installed (browser menu › Add to Home screen). iPhones don't let
          websites appear there; use New... or Add file... instead.
        </div>
      </div>
    );

  const radio = (d: Dest, label: string, disabled = false) => (
    <label style={{ ...row, opacity: disabled ? 0.5 : 1 }}>
      <input type="radio" checked={dest === d} disabled={disabled} onChange={() => setDest(d)} />
      {label}
    </label>
  );
  return (
    <div style={{ ...shell, padding: 10, gap: 8, overflow: 'auto', position: 'relative' }}>
      <b>Shared with Sanktuary</b>
      <div style={{ background: '#fff', border: '2px inset #808080', padding: 4, maxHeight: 110, overflow: 'auto' }}>
        {files.map((f, i) => (
          <div key={i}>
            {f.name} <span style={{ color: '#666' }}>({size(f.size)})</span>
          </div>
        ))}
        {shared.text && <div style={{ whiteSpace: 'pre-wrap', color: '#000080' }}>{shared.text}</div>}
      </div>
      <div>Put it in:</div>
      {radio('track', 'A song (bounce)', !files.length || !releases.length)}
      {dest === 'track' && release && (
        <div style={{ ...row, paddingLeft: 20 }}>
          <select style={field} value={release.id} onChange={(e) => (setReleaseId(e.target.value), setTrackId(''))}>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.kind})
              </option>
            ))}
          </select>
          <select style={field} value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            <option value="">New song, named from the file</option>
            {releaseTracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.n}. {t.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {radio('folder', 'A team folder', !files.length)}
      {dest === 'folder' && (
        <div style={{ ...row, paddingLeft: 20 }}>
          {folder ? <b>{folder.path || 'top of the space'}</b> : <span style={{ color: '#444' }}>no folder picked</span>}
          <button style={button} onClick={() => setPicking(true)}>
            Choose...
          </button>
        </div>
      )}
      {radio('board', 'A moodboard', !files.length || !boards.length)}
      {dest === 'board' && (
        <div style={{ ...row, paddingLeft: 20 }}>
          <select style={field} value={target} onChange={(e) => setTarget(e.target.value)}>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {radio('chat', 'A chat', !chats.length)}
      {dest === 'chat' && (
        <div style={{ ...row, paddingLeft: 20 }}>
          <select style={field} value={target} onChange={(e) => setTarget(e.target.value)}>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ ...row, marginTop: 4 }}>
        <button style={{ ...button, fontWeight: 700, padding: '4px 16px' }} disabled={!!busy} onClick={send}>
          Put it there
        </button>
        <button style={button} disabled={!!busy} onClick={() => clearShared().then(() => closeWindow('share-in'))}>
          Discard
        </button>
        <span>{busy || msg}</span>
      </div>
      {picking && (
        <FilePicker
          title="Put the files in..."
          mode="folder"
          start={folder}
          onPick={(r) => {
            setPicking(false);
            if (r) setFolder(r);
          }}
        />
      )}
    </div>
  );
};

const field: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default ShareIn;
