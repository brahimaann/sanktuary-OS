import React, { useCallback, useEffect, useState } from 'react';
import { useApi, useMe } from '../utils/api';
import { liveUser, useLiveEvent } from '../utils/live';
import { useOpenRef } from '../utils/refs';
import { useWindowManager } from '../wm/manager';
import { openStudio } from '../apps/Studio';
import RetroIcon from './RetroIcon';

/**
 * Bottom-right notification centre for the taskbar tray:
 *   • pop-up balloons (blinking Win98 title bar) for new messages and updates while you're in the app,
 *   • a bell with an unread count that opens the log of everything: project / track / timeline updates
 *     (kept on the server) and messages that arrived (kept in this browser).
 */
interface Note {
  id: string;
  at: string;
  title: string;
  text: string;
  channel?: string; // message: open this chat
  where?: { space: string; dir: string[]; name: string }; // project update: open its folder
  track?: string;
  timeline?: string;
  opportunity?: string;
}

const SEEN = 'sk_notif_seen';
const MESSAGES = 'sk_notif_messages';
const read = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) || '') as T;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const NotificationTray: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const openRef = useOpenRef();
  const { windows, openWindow } = useWindowManager();
  const [server, setServer] = useState<Note[]>([]);
  const [messages, setMessages] = useState<Note[]>(() => read(MESSAGES, []));
  const [seen, setSeen] = useState<string>(() => read(SEEN, ''));
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Note[]>([]);

  const load = useCallback(
    () =>
      api('/api/projects?notifications').then(
        (list: any[]) =>
          setServer(
            list.map((n) => ({
              ...n,
              title: n.turn ? "It's your turn" : n.track ? 'Tracks' : n.timeline ? 'Timeline' : n.opportunity ? 'Opportunity' : 'Update',
            })),
          ),
        () => {},
      ),
    [api],
  );
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const toast = (n: Note) => {
    setToasts((t) => [...t.filter((x) => x.id !== n.id), n].slice(-3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
    new Audio('/audio/NOTIFY.WAV').play().catch(() => {});
  };

  useLiveEvent('notify', (n: any) => {
    const note = {
      ...n,
      title: n.turn ? "It's your turn" : n.track ? 'Tracks' : n.timeline ? 'Timeline' : n.opportunity ? 'Opportunity' : 'Update',
    };
    setServer((s) => [note, ...s].slice(0, 50));
    toast(note);
  });
  useLiveEvent('message', (m: { id: string; channel: string; user: string; text: string; at: string; refs?: unknown[] }) => {
    if (m.user === liveUser()) return;
    const w = windows.find((x) => x.id === `chat-${m.channel}`);
    if (w && w.focused && !w.isMinimized && document.hasFocus()) return; // already reading it
    const note: Note = {
      id: `msg-${m.id}`,
      at: m.at,
      title: m.channel.startsWith('dm~') ? `Message from ${m.user}` : `#${m.channel}`,
      text: m.text ? (m.channel.startsWith('dm~') ? m.text : `${m.user}: ${m.text}`) : `${m.user} sent a file`,
      channel: m.channel,
    };
    setMessages((prev) => {
      const next = [note, ...prev].slice(0, 50);
      write(MESSAGES, next);
      return next;
    });
    toast(note);
  });

  const all = [...server, ...messages].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  const unread = all.filter((n) => n.at > seen).length;
  const markSeen = () => {
    const now = new Date().toISOString();
    setSeen(now);
    write(SEEN, now);
  };

  const go = (n: Note) => {
    setToasts((t) => t.filter((x) => x.id !== n.id));
    if (n.channel) {
      const dm = n.channel.startsWith('dm~');
      openWindow({
        id: `chat-${n.channel}`,
        title: dm ? `${n.channel.split('~').find((u) => u !== liveUser()) || 'Chat'} — Instant Message` : `#${n.channel}`,
        icon: '/images/icons/outlook-express-16x16.png',
        appType: 'chat',
        appProps: { channel: n.channel },
        width: 460,
        height: 420,
      });
    } else if (n.where) {
      const w = n.where;
      openRef({
        kind: 'folder',
        title: w.name,
        app: w.space,
        dir: /\.(psd|psb|ai)$/i.test(w.name) ? w.dir.slice(0, -1) : w.dir,
        name: /\.(psd|psb|ai)$/i.test(w.name) ? w.dir[w.dir.length - 1] : w.name,
      });
    } else if (n.track) {
      openStudio(openWindow, 'songs');
    } else if (n.timeline) {
      openStudio(openWindow, 'calendar');
    } else if (n.opportunity) {
      openStudio(openWindow, 'opportunities');
    } else {
      openWindow({
        id: 'profile-me',
        title: 'My Profile',
        icon: '/images/icons/my-documents-16x16.png',
        appType: 'profile',
        appProps: {},
        width: 420,
        height: 520,
      });
    }
  };

  if (!me) return null;
  return (
    <>
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) markSeen();
        }}
        title={unread ? `${unread} new` : 'Notifications'}
        className="mr-2 cursor-pointer border-none bg-transparent outline-none flex items-center gap-1"
      >
        <span className={unread ? 'sk-bell-ring' : undefined} style={{ display: 'inline-flex' }}>
          <RetroIcon name="bell" size={15} />
        </span>
        {unread > 0 && <b style={{ color: '#000080' }}>{unread}</b>}
      </button>
      {/* Anchored to the taskbar (the tray's positioned parent), so it stays on the CRT screen, just above the clock */}
      {
        <div
          style={{
            position: 'absolute',
            right: 6,
            bottom: 'calc(100% + 6px)',
            zIndex: 100001,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'flex-end',
            pointerEvents: 'none',
          }}
        >
          {!open &&
            toasts.map((n) => (
              <div key={n.id} className="sk-toast" style={{ ...win, width: 260, pointerEvents: 'auto' }} onClick={() => go(n)}>
                <div className="sk-toast-title" style={titleBar}>
                  <RetroIcon name={n.channel ? 'chat' : 'bell'} size={12} />
                  <span style={{ flex: 1 }}>{n.title}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setToasts((t) => t.filter((x) => x.id !== n.id));
                    }}
                    style={{ cursor: 'pointer', padding: '0 3px' }}
                  >
                    ×
                  </span>
                </div>
                <div
                  style={{
                    padding: '6px 8px',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {n.text}
                </div>
              </div>
            ))}
          {open && (
            <div
              style={{
                ...win,
                width: 'min(340px, calc(100vw - 12px))',
                maxHeight: '60vh',
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'auto',
              }}
            >
              <div style={titleBar}>
                <RetroIcon name="bell" size={12} />
                <span style={{ flex: 1 }}>Notifications</span>
                <span onClick={() => setOpen(false)} style={{ cursor: 'pointer', padding: '0 3px' }}>
                  ×
                </span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: 4 }}>
                {all.length === 0 && (
                  <div style={{ padding: 8, color: '#666' }}>
                    Nothing yet. Messages, project updates, your turns and deadlines show up here.
                  </div>
                )}
                {all.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => (go(n), setOpen(false))}
                    style={{
                      padding: '5px 8px',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      background: n.at > seen ? '#e8e8ff' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <RetroIcon name={n.channel ? 'chat' : 'bell'} size={12} />
                      <b style={{ flex: 1 }}>{n.title}</b>
                      <span style={{ color: '#888', fontSize: 10 }}>
                        {new Date(n.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.text}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px 4px' }}>
                <button
                  style={btn}
                  onClick={() => {
                    setMessages([]);
                    write(MESSAGES, []);
                  }}
                  title="Clears the message log in this browser (project updates stay in your profile)"
                >
                  Clear messages
                </button>
                <button style={btn} onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      }
    </>
  );
};

const win: React.CSSProperties = {
  background: '#c0c0c0',
  border: '2px outset #fff',
  boxShadow: '2px 2px 0 rgba(0,0,0,0.5)',
  font: '11px "MS Sans Serif", Arial, sans-serif',
  color: '#000',
  cursor: 'default',
};
const titleBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 4px',
  color: '#fff',
  fontWeight: 700,
  background: 'linear-gradient(90deg, #000080, #1084d0)',
};
const btn: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 8px',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #000',
  borderBottom: '1px solid #000',
};

export default NotificationTray;
