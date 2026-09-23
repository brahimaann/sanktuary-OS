import React, { useEffect, useRef, useState } from 'react';
import { useAuth, UserButton } from '@clerk/react';
import { useWindowManager } from '../wm/manager';
import { useApi, useMe } from '../utils/api';
import { liveUser } from '../utils/live';
import { displayName, Profile as P, useProfiles } from '../utils/profiles';
import { dmId } from './Chat';
import Avatar from './Avatar';
import { formatSize } from './fileTypes';
import { LogOn, shell, button, statusBar } from './TeamFiles';

const FIELDS: [keyof P, string, string][] = [
  ['displayName', 'Display name', 'How your name shows to the team'],
  ['status', 'Status / away message', 'e.g. in the studio till 9'],
  ['role', 'Role', 'e.g. producer, designer, photographer'],
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/...'],
  ['instagram', 'Instagram', '@handle'],
  ['website', 'Website', 'https://...'],
];

/** Your profile (editable) or another member's info card. */
const Profile: React.FC<{ username?: string }> = ({ username }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Profile" />;
  return <ProfileCard username={username} />;
};

const ProfileCard: React.FC<{ username?: string }> = ({ username }) => {
  const api = useApi();
  const { me } = useMe();
  const { byName } = useProfiles();
  const { openWindow } = useWindowManager();
  const self = me?.username || liveUser();
  const who = username || self;
  const editable = !username || username === self;
  const p = byName[who];
  const [draft, setDraft] = useState<Partial<P>>({});
  const [msg, setMsg] = useState('');
  const picInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (p) setDraft(p); }, [p?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      await api('/api/profiles/me', { method: 'PUT', body: JSON.stringify(Object.fromEntries([...FIELDS.map(([k]) => k), 'bio'].map((k) => [k, draft[k as keyof P] ?? '']))) });
      setMsg('Saved.');
    } catch (e) { setMsg((e as Error).message); }
  };
  const uploadPic = async (file?: File) => {
    if (!file) return;
    try {
      const res = await fetch('/api/profiles/me/avatar', { method: 'PUT', body: file });
      if (!res.ok) throw new Error(await res.text());
      setMsg('Picture updated.');
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!who) return <div style={{ ...shell, padding: 16 }}>Loading...</div>;

  if (!editable) {
    return (
      <div style={shell}>
        <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Avatar username={who} avatar={p?.avatar} size={64} online={p?.online} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{displayName(p, who)}</div>
              <div style={{ color: '#444' }}>@{who}{p?.admin ? ' · admin' : ''}{p?.role ? ` · ${p.role}` : ''}</div>
              <div style={{ color: '#444' }}>{p?.online ? 'Online now' : p?.lastSignIn ? `Last seen ${new Date(p.lastSignIn).toLocaleDateString()}` : 'Offline'}</div>
            </div>
          </div>
          {p?.status && <div style={{ fontStyle: 'italic', background: '#ffffe1', border: '1px solid #808080', padding: 6 }}>{p.status}</div>}
          {p?.bio && <div style={{ whiteSpace: 'pre-wrap', background: '#fff', border: '2px inset #808080', padding: 6 }}>{p.bio}</div>}
          {(['soundcloud', 'instagram', 'website'] as const).map((k) => p?.[k] && (
            <div key={k}><b>{k[0].toUpperCase() + k.slice(1)}:</b> <a href={linkFor(k, p[k]!)} target="_blank" rel="noopener noreferrer">{p[k]}</a></div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 6 }}>
          <button style={{ ...button, fontWeight: 700 }} onClick={() => openWindow({ id: `chat-${dmId(self, who)}`, title: `${displayName(p, who)} — Instant Message`, icon: '/images/icons/outlook-express-16x16.png', appType: 'chat', appProps: { channel: dmId(self, who) }, width: 460, height: 420 })}>Send message</button>
        </div>
      </div>
    );
  }

  const mySpace = me?.spaces.find((s) => s.id === 'me');
  return (
    <div style={shell}>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span onClick={() => picInput.current?.click()} style={{ cursor: 'pointer' }} title="Change picture"><Avatar username={who} avatar={p?.avatar} size={64} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>@{who}{me?.admin ? ' · admin' : ''}</div>
            <button style={{ ...button, marginTop: 4 }} onClick={() => picInput.current?.click()}>Change picture...</button>
            <input ref={picInput} type="file" accept="image/*" hidden onChange={(e) => { uploadPic(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div title="Account, access code and sign out"><UserButton /></div>
        </div>
        {FIELDS.map(([k, label, hint]) => (
          <label key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: 6 }}>
            {label}
            <input value={(draft[k] as string) ?? ''} placeholder={hint} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={input} />
          </label>
        ))}
        <label style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 6 }}>
          About me
          <textarea value={draft.bio ?? ''} rows={4} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} style={{ ...input, resize: 'vertical' }} />
        </label>
        {mySpace && (
          <div style={{ border: '2px groove #fff', padding: 6 }}>
            <b>My Space</b>: {mySpace.online ? `${formatSize(mySpace.used || 0)} of ${mySpace.quota ? formatSize(mySpace.quota) : 'unlimited'} used` : 'drive offline'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 6, alignItems: 'center' }}>
        <div style={{ ...statusBar, flex: 1, margin: 0 }}>{msg || 'Your profile shows in Teams, chats and the planner.'}</div>
        <button style={{ ...button, fontWeight: 700 }} onClick={save}>Save</button>
      </div>
    </div>
  );
};

const linkFor = (k: string, v: string) =>
  /^https?:\/\//.test(v) ? v : k === 'instagram' ? `https://instagram.com/${v.replace(/^@/, '')}` : k === 'soundcloud' ? `https://soundcloud.com/${v}` : `https://${v}`;

const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, padding: '2px 4px', border: '2px inset #808080', minWidth: 0 };

export default Profile;
