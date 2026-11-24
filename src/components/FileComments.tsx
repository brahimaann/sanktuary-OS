import React, { useEffect, useRef, useState } from 'react';
import { useApi } from '../utils/api';
import { liveUser, useLiveEvent } from '../utils/live';
import { displayName, useProfiles } from '../utils/profiles';
import { button } from '../apps/TeamFiles';
import { isTouch } from '../apps/fileTypes';
import Avatar from '../apps/Avatar';

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export interface Comment {
  id: string;
  user: string;
  at: string;
  t: number | null;
  text: string;
  ask?: { to: string[]; due: string | null; heard: Record<string, string> }; // a feedback request
}

/** Live comment thread for one file. On audio/video each comment is pinned to the playback time. */
export const Comments: React.FC<{
  app: string;
  path: string;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  media: React.MutableRefObject<HTMLMediaElement | null>;
  timed: boolean;
  onSeek: (t: number) => void;
  focusSignal?: number; // changes when someone presses C in the player
}> = ({ app, path, comments, setComments, media, timed, onSeek, focusSignal = 0 }) => {
  const api = useApi();
  const { byName, profiles } = useProfiles();
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false); // "Ask for feedback" mode: pick people, optional due date
  const [askTo, setAskTo] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const heardSent = useRef(new Set<string>());
  const [open, setOpen] = useState(!isTouch); // phones: collapsed so the picture/video gets the room
  const [err, setErr] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusSignal) return;
    setOpen(true);
    setTimeout(() => box.current?.focus());
  }, [focusSignal]);
  const q = `space=${encodeURIComponent(app)}&path=${encodeURIComponent(path)}`;

  useEffect(() => {
    api(`/api/comments?${q}`).then(setComments, () => setComments([]));
  }, [api, q, setComments]);
  useLiveEvent(
    'comment',
    (d) =>
      d.space === app &&
      d.path === path &&
      setComments((prev) =>
        prev.some((c) => c.id === d.comment.id) ? prev.map((c) => (c.id === d.comment.id ? d.comment : c)) : [...prev, d.comment],
      ),
  );
  useLiveEvent('uncomment', (d) => d.space === app && d.path === path && setComments((prev) => prev.filter((c) => c.id !== d.id)));

  const post = async () => {
    if (!text.trim()) return;
    const t = timed && media.current?.currentTime ? media.current.currentTime : null; // not played yet: a note on the whole thing
    if (asking && !askTo.length) return setErr('Pick who to ask.');
    try {
      const body = asking ? { text, t: t || null, ask: { to: askTo, due: due || null } } : { text, t };
      const c: Comment = await api(`/api/comments?${q}`, { method: 'POST', body: JSON.stringify(body) });
      setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
      setText('');
      setAsking(false);
      setAskTo([]);
      setDue('');
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = (id: string) => api(`/api/comments?${q}&id=${id}`, { method: 'DELETE' }).catch((e) => setErr(e.message));
  const sorted = [...comments].sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.at.localeCompare(b.at));
  const me = liveUser();

  // Asked for feedback on this file: once you've heard 30 s (or half a short track), it's marked listened
  useEffect(() => {
    const mine = comments.filter((c) => c.ask?.to.includes(me) && !c.ask.heard[me] && !heardSent.current.has(c.id));
    if (!timed || !mine.length) return;
    const timer = setInterval(() => {
      const m = media.current;
      // ponytail: judged by playhead position, so jumping ahead counts; track real listening time if that matters
      if (!m || (m.currentTime < Math.min(30, (m.duration || 60) / 2) && !m.ended)) return;
      clearInterval(timer);
      for (const c of mine) {
        heardSent.current.add(c.id);
        api(`/api/comments?${q}&heard&id=${c.id}`, { method: 'POST' }).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [comments, timed, me, api, q, media]);
  const replied = (c: Comment, u: string) => comments.some((x) => x.user === u && x.at > c.at);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 2px' }}>
        <button className="sk-tool" onClick={() => setOpen(!open)}>
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
                      style={{ ...button, padding: '0 4px', marginRight: 4, color: '#000', fontWeight: 700 }}
                      title="Jump to this moment"
                    >
                      {clock(c.t)}
                    </button>
                  )}
                  <b>{displayName(byName[c.user], c.user)}</b> <span style={{ whiteSpace: 'pre-wrap' }}>{c.text}</span>
                  {c.ask && (
                    <div style={{ background: '#ffffe1', border: '1px solid #808080', padding: '2px 4px', marginTop: 2 }}>
                      Asked for feedback{c.ask.due ? ` by ${c.ask.due}` : ''}:{' '}
                      {c.ask.to.map((u) => (
                        <span key={u} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                          {displayName(byName[u], u)}{' '}
                          {replied(c, u) ? (
                            <span style={{ color: '#006000' }}>✓ replied</span>
                          ) : c.ask!.heard[u] ? (
                            <span style={{ color: '#000' }}>✓ listened</span>
                          ) : (
                            <span style={{ color: '#808080' }}>○ not yet</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
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
          {asking && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '4px 4px 0' }}>
              Ask:
              {profiles
                .filter((p) => p.username !== me)
                .map((p) => (
                  <label key={p.username} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={askTo.includes(p.username)}
                      onChange={(e) => setAskTo(e.target.checked ? [...askTo, p.username] : askTo.filter((u) => u !== p.username))}
                    />
                    {displayName(p, p.username)}
                  </label>
                ))}
              <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                by <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, padding: 4 }}>
            <textarea
              ref={box}
              value={text}
              rows={1}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
                if (e.key === 'Escape') e.currentTarget.closest<HTMLElement>('[tabindex]')?.focus(); // back to the player keys
              }}
              placeholder={
                asking
                  ? 'What should they listen for? e.g. is the vocal too loud at the chorus?'
                  : timed
                    ? 'Comment at the current playback time...'
                    : 'Add a comment...'
              }
              style={{ flex: 1, resize: 'none', fontFamily: 'Arial, sans-serif', fontSize: 12, border: '2px inset #808080', padding: 3 }}
            />
            {app !== 'me' && (
              <button
                style={button}
                onClick={() => setAsking(!asking)}
                title="Ask people for feedback on this file: they get a notification with a link"
              >
                {asking ? 'Cancel ask' : 'Ask for feedback...'}
              </button>
            )}
            <button style={{ ...button, fontWeight: 700 }} onClick={post}>
              {asking ? 'Send request' : timed ? 'Comment @ now' : 'Comment'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
