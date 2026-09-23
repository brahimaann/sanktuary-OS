import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useWindowManager } from '../wm/manager';
import { useApi } from '../utils/api';
import { liveUser, useLiveEvent } from '../utils/live';
import { displayName, Profile, useProfiles } from '../utils/profiles';
import { useOpenRef } from '../utils/refs';
import { dmId, lastRead, Message } from './Chat';
import Avatar from './Avatar';
import { isTouch } from './fileTypes';
import { LogOn, shell, button, statusBar } from './TeamFiles';

interface Channel { id: string; name: string; topic?: string; lastAt: string | null }
interface Dm { id: string; with: string; lastAt: string | null }
interface Activity { id: string; at: string; user: string; action: string; space?: string; spaceName?: string; path?: string; to?: string; board?: string; boardKind?: string; title?: string; card?: string; text?: string; t?: number | null }

const TABS = ['Buddies', 'Channels', 'Activity'] as const;

/** Sanktuary Teams: AIM-style buddy list, channels + DMs, and the team activity feed. */
const Teams: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Sanktuary Teams" />;
  return <BuddyList />;
};

const BuddyList: React.FC = () => {
  const api = useApi();
  const { openWindow } = useWindowManager();
  const { profiles, byName } = useProfiles();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Buddies');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Dm[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const me = liveUser();
  const mine = byName[me];

  const loadChat = useCallback(() => {
    api('/api/chat').then((d) => { setChannels(d.channels); setDms(d.dms); }, () => {});
  }, [api]);
  useEffect(loadChat, [loadChat]);
  useLiveEvent('channel', loadChat);
  useLiveEvent('message', (m: Message) => {
    if (m.channel.startsWith('dm~') && !dms.some((d) => d.id === m.channel)) return loadChat();
    setChannels((cs) => cs.map((c) => (c.id === m.channel ? { ...c, lastAt: m.at } : c)));
    setDms((ds) => ds.map((d) => (d.id === m.channel ? { ...d, lastAt: m.at } : d)));
  });

  const openChat = (channel: string, title: string) =>
    openWindow({ id: `chat-${channel}`, title, icon: '/images/icons/outlook-express-16x16.png', appType: 'chat', appProps: { channel }, width: 460, height: 420 });
  const openDm = (p: Profile) => openChat(dmId(me, p.username), `${displayName(p)} — Instant Message`);
  const openProfile = (username?: string) =>
    openWindow({ id: `profile-${username || 'me'}`, title: username && username !== me ? `${displayName(byName[username], username)} — Info` : 'My Profile', icon: '/images/icons/my-documents-16x16.png', appType: 'profile', appProps: { username }, width: 420, height: 520 });

  const saveStatus = async () => {
    if (statusMsg === null || statusMsg === (mine?.status || '')) return setStatusMsg(null);
    await api('/api/profiles/me', { method: 'PUT', body: JSON.stringify({ status: statusMsg }) }).catch(() => {});
    setStatusMsg(null);
  };

  const newChannel = async () => {
    const name = window.prompt('New channel name (e.g. music, artwork, merch):')?.trim();
    if (!name) return;
    try { const c = await api('/api/chat', { method: 'POST', body: JSON.stringify({ name }) }); loadChat(); openChat(c.id, `#${c.name}`); } catch (e) { window.alert((e as Error).message); }
  };

  const unread = (id: string, lastAt: string | null) => !!lastAt && lastAt > lastRead(id);
  const others = profiles.filter((p) => p.username !== me);
  const online = others.filter((p) => p.online);
  const offline = others.filter((p) => !p.online);
  const open = (fn: () => void) => ({ onClick: () => isTouch && fn(), onDoubleClick: fn });

  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, borderBottom: '1px solid #808080' }}>
        <Avatar username={me || '?'} avatar={mine?.avatar} size={36} online />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{displayName(mine, me)}</div>
          <input
            value={statusMsg ?? mine?.status ?? ''}
            placeholder="Set a status / away message..."
            onChange={(e) => setStatusMsg(e.target.value)}
            onBlur={saveStatus}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 11, fontStyle: 'italic', border: '2px inset #808080', padding: '1px 3px' }}
          />
        </div>
        <button style={button} onClick={() => openProfile()}>Profile</button>
      </div>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...button, fontWeight: tab === t ? 700 : 400 }}>
            {t}{t === 'Channels' && [...channels, ...dms].some((c) => unread(c.id, c.lastAt)) ? ' •' : ''}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: 2 }}>
        {tab === 'Buddies' && (
          <>
            <Group title={`Online (${online.length})`}>
              {online.map((p) => <Buddy key={p.username} p={p} {...open(() => openDm(p))} onInfo={() => openProfile(p.username)} />)}
            </Group>
            <Group title={`Offline (${offline.length})`}>
              {offline.map((p) => <Buddy key={p.username} p={p} {...open(() => openDm(p))} onInfo={() => openProfile(p.username)} />)}
            </Group>
            {others.length === 0 && <div style={{ padding: 8, color: '#666' }}>No other members yet. Admins can add members in the Admin Panel.</div>}
          </>
        )}
        {tab === 'Channels' && (
          <>
            <Group title="Channels">
              {channels.map((c) => (
                <Row key={c.id} {...open(() => openChat(c.id, `#${c.name}`))} bold={unread(c.id, c.lastAt)}>
                  <b>#</b>&nbsp;{c.name}{c.topic && <span style={{ color: '#666', marginLeft: 6 }}>{c.topic}</span>}
                </Row>
              ))}
            </Group>
            <Group title="Direct messages">
              {dms.map((d) => (
                <Row key={d.id} {...open(() => openChat(d.id, `${displayName(byName[d.with], d.with)} — Instant Message`))} bold={unread(d.id, d.lastAt)}>
                  <Avatar username={d.with} avatar={byName[d.with]?.avatar} size={16} online={byName[d.with]?.online} />&nbsp;{displayName(byName[d.with], d.with)}
                </Row>
              ))}
              {dms.length === 0 && <div style={{ padding: '2px 8px', color: '#666' }}>Double-click a buddy to start one.</div>}
            </Group>
          </>
        )}
        {tab === 'Activity' && <ActivityFeed byName={byName} />}
      </div>
      <div style={{ display: 'flex', gap: 4, padding: 4 }}>
        {tab === 'Channels' && <button style={button} onClick={newChannel}>New channel...</button>}
        <div style={{ ...statusBar, flex: 1, margin: 0 }}>{online.length} buddy(s) online</div>
      </div>
    </div>
  );
};

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div style={{ padding: '3px 6px', fontWeight: 700, background: '#e8e8e8', borderBottom: '1px solid #ccc' }}>{title}</div>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode; bold?: boolean; onClick?: () => void; onDoubleClick?: () => void }> = ({ children, bold, ...handlers }) => (
  <div {...handlers} style={{ display: 'flex', alignItems: 'center', padding: isTouch ? '8px' : '3px 8px', cursor: 'default', userSelect: 'none', fontWeight: bold ? 700 : 400 }}>{children}</div>
);

const Buddy: React.FC<{ p: Profile; onClick?: () => void; onDoubleClick?: () => void; onInfo: () => void }> = ({ p, onInfo, ...handlers }) => (
  <div {...handlers} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '8px' : '3px 8px', cursor: 'default', userSelect: 'none', opacity: p.online ? 1 : 0.6 }}>
    <Avatar username={p.username} avatar={p.avatar} size={24} online={p.online} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700 }}>{displayName(p)}{p.role && <span style={{ fontWeight: 400, color: '#666' }}> · {p.role}</span>}</div>
      {p.status && <div style={{ fontStyle: 'italic', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.status}</div>}
    </div>
    <button style={{ ...button, padding: '0 6px' }} onClick={(e) => { e.stopPropagation(); onInfo(); }} onDoubleClick={(e) => e.stopPropagation()}>Info</button>
  </div>
);

const ActivityFeed: React.FC<{ byName: Record<string, Profile> }> = ({ byName }) => {
  const api = useApi();
  const openRef = useOpenRef();
  const [items, setItems] = useState<Activity[]>([]);
  useEffect(() => { api('/api/activity').then(setItems, () => {}); }, [api]);
  useLiveEvent('activity', (a: Activity) => setItems((prev) => [a, ...prev].slice(0, 150)));

  const open = (a: Activity) => {
    if (a.board) return openRef({ kind: a.boardKind === 'kanban' ? 'plan' : 'board', title: a.title || '', boardId: a.board });
    if (a.space && a.path) {
      const parts = (a.to ? a.path.replace(/[^/]*$/, a.to) : a.path).split('/');
      const name = parts.pop()!;
      openRef({ kind: /\.[a-z0-9]{2,5}$/i.test(name) ? 'file' : 'folder', title: name, app: a.space, dir: parts, name });
    }
  };
  const fmtT = (t?: number | null) => (t == null ? '' : ` at ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

  if (!items.length) return <div style={{ padding: 8, color: '#666' }}>Nothing yet. Uploads, comments, new boards and finished tasks show up here.</div>;
  return (
    <>
      {items.map((a) => (
        <div key={a.id} onDoubleClick={() => open(a)} onClick={() => isTouch && open(a)} style={{ display: 'flex', gap: 6, padding: '4px 8px', borderBottom: '1px solid #eee', cursor: 'default' }} title="Double-click to open">
          <Avatar username={a.user} avatar={byName[a.user]?.avatar} size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{displayName(byName[a.user], a.user)}</b> {a.action}{' '}
            <b>{a.card || a.title || a.path}</b>
            {a.to && <> → <b>{a.to}</b></>}
            {a.spaceName && <span style={{ color: '#666' }}> in {a.spaceName}</span>}
            {a.board && a.card && <span style={{ color: '#666' }}> in {a.title}</span>}
            {a.text && <div style={{ fontStyle: 'italic', color: '#444' }}>“{a.text}”{fmtT(a.t)}</div>}
            <div style={{ color: '#999', fontSize: 10 }}>{new Date(a.at).toLocaleString()}</div>
          </div>
        </div>
      ))}
    </>
  );
};

export default Teams;
