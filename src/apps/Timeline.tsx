import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { useOpenRef } from '../utils/refs';
import { useWindowManager } from '../wm/manager';
import { LogOn, shell, toolbar, button, statusBar } from './TeamFiles';
import FilePicker, { FileRef } from '../components/FilePicker';
import MembersPicker from './MembersPicker';
import RetroIcon, { IconLabel } from '../components/RetroIcon';

interface Entry {
  id: string;
  source?: 'tracks'; // release days and track deadlines, read-only here
  title: string;
  kind: string;
  status?: string;
  start: string;
  end?: string | null;
  people?: string[];
  location?: string;
  notes?: string;
  link?: string;
  folder?: FileRef | null;
  release?: string | null;
  members?: string[] | null;
  owner?: string;
  following?: boolean;
  done?: boolean;
}

const KIND_COLORS: Record<string, string> = {
  Shoot: '#a05000',
  Artwork: '#800080',
  Video: '#000080',
  Event: '#008080',
  Drop: '#a00000',
  Other: '#808080',
  Release: '#008000',
  'Track due': '#404040',
};
const today = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, not UTC
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
const monthLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });

/** One calendar for visual projects and events (shoots, artwork, videos, shows, drops), plus album dates from Tracks. */
const Timeline: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Timeline" />;
  return <TimelineApp />;
};

const TimelineApp: React.FC = () => {
  const api = useApi();
  const { openWindow } = useWindowManager();
  const [data, setData] = useState<{ items: Entry[]; kinds: string[]; statuses: string[] } | null>(null);
  const [kind, setKind] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const todayRow = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api('/api/timeline').then(setData, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('timeline', load);
  useLiveEvent('tracks', load);
  useEffect(() => {
    todayRow.current?.scrollIntoView({ block: 'start' });
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;

  const now = today();
  const items = data.items
    .filter((i) => !kind || i.kind === kind)
    .filter((i) => showClosed || !(i.status === 'Cancelled' || (i.status === 'Done' && (i.end || i.start) < now)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const entry = data.items.find((i) => i.id === openId && !i.source);
  const upcoming = items.filter((i) => (i.end || i.start) >= now).length;

  const add = async () => {
    const title = (await dialog.prompt('What is it? (e.g. "Cover shoot", "Release party")', '', { title: 'New timeline entry' }))?.trim();
    if (!title) return;
    try {
      const e = await api('/api/timeline', {
        method: 'POST',
        body: JSON.stringify({ title, start: now, kind: kind && data.kinds.includes(kind) ? kind : 'Other' }),
      });
      await load();
      setOpenId(e.id);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const openTracks = () =>
    openWindow({ id: 'tracks', title: 'Tracks', icon: '/images/icons/media-player-16x16.png', appType: 'tracks', width: 900, height: 600 });

  // Rows grouped by month, with a "Today" marker between past and upcoming
  const rows: React.ReactNode[] = [];
  let month = '';
  let markedToday = false;
  for (const i of items) {
    if (!markedToday && (i.end || i.start) >= now) {
      markedToday = true;
      rows.push(<TodayLine key="today" refEl={todayRow} />);
    }
    const m = monthLabel(i.start);
    if (m !== month) {
      month = m;
      rows.push(
        <div key={`m-${m}`} style={monthHead}>
          {m}
        </div>,
      );
    }
    const past = (i.end || i.start) < now;
    rows.push(
      <div
        key={i.id}
        onClick={() => (i.source ? openTracks() : setOpenId(i.id === openId ? null : i.id))}
        style={{
          ...row,
          ...(i.id === openId ? { background: '#000080', color: '#fff' } : {}),
          opacity: past || i.status === 'Cancelled' || i.done ? 0.55 : 1,
        }}
        title={i.source ? 'From Tracks: click to open Tracks' : undefined}
      >
        <span style={{ width: 88, flexShrink: 0 }}>
          {dayLabel(i.start)}
          {i.end && i.end !== i.start ? ` – ${dayLabel(i.end)}` : ''}
        </span>
        <span style={{ ...chip, background: KIND_COLORS[i.kind] || '#808080' }}>{i.kind}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b style={{ textDecoration: i.status === 'Cancelled' ? 'line-through' : undefined }}>{i.title}</b>
          {i.location ? ` · ${i.location}` : ''}
          {i.people?.length ? ` · ${i.people.join(', ')}` : ''}
        </span>
        {i.status && i.status !== 'Planned' && <span style={{ whiteSpace: 'nowrap' }}>{i.status}</span>}
        {i.members && '🔒'}
      </div>,
    );
  }
  if (!markedToday) rows.push(<TodayLine key="today" refEl={todayRow} />);

  return (
    <div style={shell}>
      <div style={toolbar}>
        <button style={{ ...button, fontWeight: 700 }} onClick={add}>
          <IconLabel icon="plus">New entry...</IconLabel>
        </button>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={input}>
          <option value="">All kinds</option>
          {[...data.kinds, 'Release', 'Track due'].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show done and cancelled
        </label>
        <button style={button} onClick={() => todayRow.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <IconLabel icon="calendar">Today</IconLabel>
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', padding: '0 2px', gap: 4 }}>
        <div style={{ ...listBox, flex: 1 }}>
          {items.length === 0 && (
            <div style={{ padding: 16 }}>
              Nothing on the timeline yet. Click <b>New entry...</b> for a shoot, artwork, video, show or drop. Release dates and track
              deadlines from Tracks show up here by themselves.
            </div>
          )}
          {items.length > 0 && rows}
        </div>
        {entry && (
          <EntryPanel
            key={entry.id}
            entry={entry}
            kinds={data.kinds}
            statuses={data.statuses}
            onChange={load}
            onClose={() => setOpenId(null)}
            setMsg={setMsg}
          />
        )}
      </div>
      <div style={statusBar}>{msg || `${upcoming} coming up · ${data.items.filter((i) => i.source).length} dates from Tracks`}</div>
    </div>
  );
};

const TodayLine: React.FC<{ refEl: React.RefObject<HTMLDivElement | null> }> = ({ refEl }) => (
  <div
    ref={refEl}
    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', color: '#000080', fontWeight: 700, scrollMarginTop: 24 }}
  >
    <RetroIcon name="forward" />
    Today, {new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
    <span style={{ flex: 1, borderTop: '2px solid #000080' }} />
  </div>
);

/** Edit one entry. Covers the list; everything saves as you go. */
const EntryPanel: React.FC<{
  entry: Entry;
  kinds: string[];
  statuses: string[];
  onChange: () => void;
  onClose: () => void;
  setMsg: (m: string) => void;
}> = ({ entry: e, kinds, statuses, onChange, onClose, setMsg }) => {
  const api = useApi();
  const { me } = useMe();
  const openRef = useOpenRef();
  const [draft, setDraft] = useState(e);
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState<null | 'people' | 'members'>(null);
  const [releases, setReleases] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => setDraft(e), [e]);
  useEffect(() => {
    api('/api/tracks').then(
      (d) => setReleases(d.releases),
      () => {},
    );
  }, [api]);

  const save = async (body: object) => {
    try {
      await api(`/api/timeline/${e.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg('');
      onChange();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const text = (k: 'title' | 'location' | 'notes' | 'link') => ({
    value: draft[k] || '',
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: ev.target.value }),
    onBlur: () => (draft[k] || '') !== (e[k] || '') && save({ [k]: draft[k] || '' }),
  });
  const canManage = !!me && (e.owner === me.username || me.admin);

  return (
    <div
      style={{
        ...listBox,
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        background: '#c0c0c0',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input style={{ ...input, flex: 1, fontWeight: 700, fontSize: 13 }} {...text('title')} />
        <button style={button} onClick={onClose} title="Back to the timeline">
          <RetroIcon name="close" />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={e.kind} onChange={(ev) => save({ kind: ev.target.value })} style={input}>
          {kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={e.status} onChange={(ev) => save({ status: ev.target.value })} style={input}>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        From <input type="date" value={e.start} onChange={(ev) => ev.target.value && save({ start: ev.target.value })} style={input} />
        to
        <input
          type="date"
          value={e.end || ''}
          min={e.start}
          onChange={(ev) => save({ end: ev.target.value || null })}
          style={input}
          title="Leave empty for a single day"
        />
        <label style={{ display: 'flex', gap: 3, alignItems: 'center' }} title="Get reminders and updates">
          <input type="checkbox" checked={!!e.following} onChange={(ev) => save({ follow: ev.target.checked })} />
          Follow
        </label>
      </div>
      <fieldset style={fieldset}>
        <legend>Who and where</legend>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ minWidth: 60 }}>People</span>
          <span style={{ flex: 1 }}>{e.people?.length ? e.people.join(', ') : <span style={{ color: '#666' }}>nobody yet</span>}</span>
          <button style={button} onClick={() => setChoosing('people')}>
            <IconLabel icon="plus">Choose...</IconLabel>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ minWidth: 60 }}>Location</span>
          <input style={{ ...input, flex: 1 }} placeholder="Studio, venue, address..." {...text('location')} />
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Files and links</legend>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ minWidth: 60 }}>Folder</span>
          <span style={{ flex: 1 }}>
            {e.folder ? <b>{e.folder.path.split('/').pop()}</b> : <span style={{ color: '#666' }}>none</span>}
          </span>
          {e.folder && (
            <button
              style={button}
              onClick={() => {
                const parts = e.folder!.path.split('/');
                openRef({
                  kind: 'folder',
                  title: parts[parts.length - 1],
                  app: e.folder!.space,
                  dir: parts.slice(0, -1),
                  name: parts[parts.length - 1],
                });
              }}
            >
              <IconLabel icon="external">Open</IconLabel>
            </button>
          )}
          <button style={button} onClick={() => setPicking(true)}>
            {e.folder ? 'Change...' : 'Choose...'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ minWidth: 60 }}>Link</span>
          <input style={{ ...input, flex: 1 }} placeholder="https://... (tickets, moodboard, brief)" {...text('link')} />
          {e.link && (
            <a href={e.link} target="_blank" rel="noopener noreferrer" style={{ ...button, textDecoration: 'none', color: '#000' }}>
              <IconLabel icon="external">Open</IconLabel>
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ minWidth: 60 }}>Release</span>
          <select value={e.release || ''} onChange={(ev) => save({ release: ev.target.value || null })} style={input}>
            <option value="">(not tied to a release)</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Notes</legend>
        <textarea
          rows={5}
          style={{ ...input, width: '100%', resize: 'vertical' }}
          placeholder="Brief, shot list, run of show..."
          {...text('notes')}
        />
      </fieldset>
      {canManage && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={button} onClick={() => setChoosing('members')}>
            {e.members ? `🔒 ${e.members.length + 1} people can see this` : 'Everyone can see this'}...
          </button>
          <span style={{ flex: 1 }} />
          <button
            style={button}
            onClick={async () =>
              (await dialog.confirm(`Delete "${e.title}" from the timeline?`, { icon: 'warning' })) &&
              api(`/api/timeline/${e.id}`, { method: 'DELETE' }).then(
                () => (onClose(), onChange()),
                (err) => setMsg(err.message),
              )
            }
          >
            <IconLabel icon="close">Delete</IconLabel>
          </button>
        </div>
      )}
      {picking && (
        <FilePicker
          title="Choose the folder for this"
          mode="folder"
          start={e.folder}
          onPick={(r) => {
            setPicking(false);
            if (r) save({ folder: r });
          }}
        />
      )}
      {choosing === 'people' && (
        <MembersPicker
          title={`Who's on "${e.title}"`}
          members={e.people || []}
          allowEveryone={false}
          note="They get reminders 3 days before, the day before and on the day."
          onSave={(m) => save({ people: m || [] })}
          onClose={() => setChoosing(null)}
        />
      )}
      {choosing === 'members' && (
        <MembersPicker
          title={`Who can see "${e.title}"`}
          members={e.members ?? null}
          always={e.owner}
          note="Everyone = every member. Pick people to keep it private (you and admins always see it)."
          onSave={(m) => save({ members: m && m.filter((u) => u !== e.owner) })}
          onClose={() => setChoosing(null)}
        />
      )}
    </div>
  );
};

const listBox: React.CSSProperties = { overflow: 'auto', background: '#fff', border: '2px inset #808080', minWidth: 0 };
const monthHead: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  background: '#c0c0c0',
  padding: '2px 6px',
  fontWeight: 700,
  borderBottom: '1px solid #808080',
  zIndex: 1,
};
const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 6px',
  borderBottom: '1px solid #eee',
  cursor: 'default',
};
const chip: React.CSSProperties = { color: '#fff', fontSize: 10, padding: '0 5px', whiteSpace: 'nowrap', flexShrink: 0 };
const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
};
const fieldset: React.CSSProperties = {
  border: '2px groove #fff',
  margin: 0,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export default Timeline;
