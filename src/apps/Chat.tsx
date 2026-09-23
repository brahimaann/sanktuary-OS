import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { liveUser, useLiveEvent } from '../utils/live';
import { displayName, useProfiles } from '../utils/profiles';
import { Ref, refFromDrop, refIcon, useOpenRef } from '../utils/refs';
import Avatar from './Avatar';
import { LogOn, shell, button, statusBar } from './TeamFiles';

export interface Message { id: string; channel: string; user: string; at: string; text: string; refs: Ref[] }

export const markRead = (channel: string) => { try { localStorage.setItem(`sk_read_${channel}`, new Date().toISOString()); } catch {} };
export const lastRead = (channel: string) => { try { return localStorage.getItem(`sk_read_${channel}`) || ''; } catch { return ''; } };
export const dmId = (a: string, b: string) => `dm~${[a, b].sort().join('~')}`;

/** An instant-message window for a channel (#general) or a DM, AIM style. */
const Chat: React.FC<{ channel: string; title: string }> = ({ channel, title }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name={title} />;
  return <Conversation channel={channel} />;
};

const Conversation: React.FC<{ channel: string }> = ({ channel }) => {
  const api = useApi();
  const openRef = useOpenRef();
  const { byName } = useProfiles();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [refs, setRefs] = useState<Ref[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('');
  const [more, setMore] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const me = liveUser();

  const scrollDown = () => setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 0);

  useEffect(() => {
    api(`/api/chat/${channel}`).then((m: Message[]) => { setMsgs(m); setMore(m.length === 100); markRead(channel); scrollDown(); }, (e) => setStatus(e.message));
  }, [api, channel]);

  useLiveEvent('message', (m: Message) => {
    if (m.channel !== channel) return;
    setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    setTyping((t) => { const n = { ...t }; delete n[m.user]; return n; });
    if (document.hasFocus()) markRead(channel);
    scrollDown();
  });
  useLiveEvent('unmessage', ({ channel: c, id }) => c === channel && setMsgs((prev) => prev.filter((m) => m.id !== id)));
  useLiveEvent('typing', ({ channel: c, user }) => c === channel && setTyping((t) => ({ ...t, [user]: Date.now() })));

  // Forget "is typing" after 4 s of silence
  useEffect(() => {
    const t = setInterval(() => setTyping((prev) => Object.fromEntries(Object.entries(prev).filter(([, at]) => Date.now() - at < 4000))), 1000);
    return () => clearInterval(t);
  }, []);

  const loadOlder = async () => {
    const older: Message[] = await api(`/api/chat/${channel}?before=${encodeURIComponent(msgs[0]?.at || '')}`);
    setMore(older.length === 100);
    setMsgs((prev) => [...older, ...prev]);
  };

  const send = async () => {
    if (!text.trim() && !refs.length) return;
    try {
      const m: Message = await api(`/api/chat/${channel}`, { method: 'POST', body: JSON.stringify({ text, refs }) });
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setText('');
      setRefs([]);
      markRead(channel);
      scrollDown();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      api(`/api/chat/${channel}/typing`, { method: 'POST' }).catch(() => {});
    }
  };

  const remove = useCallback((id: string) => {
    if (window.confirm('Delete this message for everyone?')) api(`/api/chat/${channel}/${id}`, { method: 'DELETE' }).catch((e) => setStatus(e.message));
  }, [api, channel]);

  const onDrop = (e: React.DragEvent) => {
    const r = refFromDrop(e.dataTransfer);
    if (!r) return;
    e.preventDefault();
    setRefs((prev) => [...prev, r].slice(0, 10));
  };

  const typers = Object.keys(typing).filter((u) => u !== me);

  return (
    <div style={shell} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onFocus={() => markRead(channel)}>
      <div ref={logRef} style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: 2, padding: 6, fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.45 }}>
        {more && msgs.length > 0 && <div style={{ textAlign: 'center', marginBottom: 6 }}><button style={button} onClick={loadOlder}>Load older messages</button></div>}
        {msgs.length === 0 && <div style={{ color: '#888' }}>No messages yet. Say hi, or drag files, folders and boards in here to share them.</div>}
        {msgs.map((m, i) => {
          const mine = m.user === me;
          const showDay = i === 0 || new Date(msgs[i - 1].at).toDateString() !== new Date(m.at).toDateString();
          return (
            <React.Fragment key={m.id}>
              {showDay && <div style={{ textAlign: 'center', color: '#888', fontSize: 11, margin: '6px 0' }}>— {new Date(m.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} —</div>}
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '1px 0' }} className="sk-msg">
                <Avatar username={m.user} avatar={byName[m.user]?.avatar} size={20} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: mine ? '#0000c0' : '#c00000', fontWeight: 700 }}>{displayName(byName[m.user], m.user)}</span>
                  <span style={{ color: '#999', fontSize: 10, marginLeft: 6 }}>{new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  {mine && <button onClick={() => remove(m.id)} title="Delete" style={{ marginLeft: 6, border: 'none', background: 'none', color: '#aaa', cursor: 'pointer', fontSize: 11 }}>×</button>}
                  {m.text && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{linkify(m.text)}</div>}
                  {m.refs?.map((r, j) => <RefChip key={j} r={r} onOpen={() => openRef(r)} />)}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ height: 16, padding: '0 6px', color: '#444', fontStyle: 'italic' }}>
        {typers.length > 0 && `${typers.map((u) => displayName(byName[u], u)).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing...`}
      </div>
      {refs.length > 0 && (
        <div style={{ padding: '0 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {refs.map((r, i) => <RefChip key={i} r={r} onRemove={() => setRefs(refs.filter((_, j) => j !== i))} />)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, padding: 4 }}>
        <textarea
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message. Enter sends, Shift+Enter for a new line. Drag files, folders or boards here to share them."
          rows={2}
          style={{ flex: 1, resize: 'none', fontFamily: 'Arial, sans-serif', fontSize: 13, border: '2px inset #808080', padding: 4 }}
        />
        <button style={{ ...button, minWidth: 60, fontWeight: 700 }} onClick={send}>Send</button>
      </div>
      <div style={statusBar}>{status || 'Tip: drag a file from a team space, or a board from Moodboards/Planner, into this window to link it.'}</div>
    </div>
  );
};

export const RefChip: React.FC<{ r: Ref; onOpen?: () => void; onRemove?: () => void }> = ({ r, onOpen, onRemove }) => (
  <span
    onClick={onOpen}
    title={r.kind === 'file' || r.kind === 'folder' ? `${r.app}/${[...(r.dir || []), r.name].join('/')}` : r.kind}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '2px 4px 2px 0', padding: '1px 6px', background: '#c0c0c0', borderTop: '1px solid #fff', borderLeft: '1px solid #fff', borderRight: '1px solid #000', borderBottom: '1px solid #000', cursor: onOpen ? 'pointer' : 'default', fontSize: 11, fontFamily: '"MS Sans Serif", Arial, sans-serif', maxWidth: 260 }}
  >
    <img src={refIcon(r)} alt="" style={{ width: 16, height: 16 }} />
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
    {onRemove && <span onClick={onRemove} style={{ cursor: 'pointer', marginLeft: 2 }}>×</span>}
  </span>
);

/** Turns URLs in a message into links. */
function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part
  );
}

export default Chat;
