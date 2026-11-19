import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { useOpenRef } from '../utils/refs';
import { useWindowManager } from '../wm/manager';
import { openMusic, openStudio } from './Studio';
import { planWindow, showSong, takeEntryWish } from '../utils/songNav';
import { showVerses } from './OpenVerses';
import { openPlayDay } from './PlayDay';
import { LogOn, shell, toolbar, button, statusBar } from './TeamFiles';
import FilePicker, { FileRef } from '../components/FilePicker';
import MembersPicker from './MembersPicker';
import RetroIcon, { IconLabel } from '../components/RetroIcon';

interface Entry {
  id: string;
  source?: 'tracks' | 'opportunities' | 'verses' | 'planner'; // release days, track and footage deadlines, open verses, opportunity deadlines, plan cards: read-only here
  board?: string;
  boardName?: string;
  track?: string;
  title: string;
  kind: string;
  status?: string;
  start: string;
  end?: string | null;
  time?: string;
  people?: string[];
  location?: string;
  notes?: string;
  recap?: string;
  link?: string;
  folder?: FileRef | null;
  release?: string | null;
  place?: string | null; // a spot in Studio > Locations
  members?: string[] | null;
  owner?: string;
  following?: boolean;
  done?: boolean;
  public?: boolean;
  draft?: boolean; // only its owner sees it and nobody is told, until it goes live
  shots?: Shot[]; // a shoot's shot list
}
interface Shot {
  id: string;
  text: string;
  got: boolean;
  note: string;
  for?: string | null; // a song in the project (null: the whole project)
}

const KIND_COLORS: Record<string, string> = {
  Shoot: '#a05000',
  Artwork: '#800080',
  Video: '#000',
  Event: '#008080',
  Drop: '#a00000',
  Other: '#808080',
  Release: '#008000',
  'Track due': '#404040',
  Deadline: '#806000',
  Task: '#004080',
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
  const [openId, setOpenId] = useState<string | null>(() => takeEntryWish());
  const [msg, setMsg] = useState('');
  const todayRow = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api('/api/timeline').then(setData, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('timeline', load);
  useLiveEvent('tracks', load);
  useEffect(() => {
    // The New... window just added an entry: open it
    const show = (ev: Event) => (setOpenId((ev as CustomEvent<string>).detail), takeEntryWish());
    window.addEventListener('sk:timeline-entry', show);
    return () => window.removeEventListener('sk:timeline-entry', show);
  }, []);
  useEffect(() => {
    todayRow.current?.scrollIntoView({ block: 'start' });
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;

  const now = today();
  const items = data.items
    .filter((i) => !kind || i.kind === kind)
    .filter((i) => showClosed || !(i.status === 'Cancelled' || ((i.status === 'Done' || i.done) && (i.end || i.start) < now)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const entry = data.items.find((i) => i.id === openId && !i.source);
  const upcoming = items.filter((i) => (i.end || i.start) >= now).length;

  // The New... window asks when in plain words ("next sat 8pm") and can make a folder for the files
  const add = () =>
    openWindow({
      id: 'new',
      title: 'New',
      icon: '/images/icons/file-32x32.png?v=2',
      appType: 'new',
      width: 460,
      height: 420,
      appProps: { kind: kind && kind !== 'Other' && data.kinds.includes(kind) ? kind : undefined },
    });
  const openTracks = () => openMusic(openWindow);

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
        onClick={() =>
          i.source === 'opportunities'
            ? openStudio(openWindow, 'opportunities')
            : i.source === 'verses'
              ? (showVerses(), openTracks())
              : i.source === 'planner' && i.board
                ? openWindow(planWindow(i.board, i.boardName || 'Plan'))
                : i.source
                  ? (i.release && showSong(i.release, i.track), openTracks())
                  : setOpenId(i.id === openId ? null : i.id)
        }
        style={{
          ...row,
          ...(i.id === openId ? { background: '#000', color: '#fff' } : {}),
          opacity: past || i.status === 'Cancelled' || i.done ? 0.55 : 1,
        }}
        title={
          i.source === 'opportunities'
            ? 'An opportunity: click to open Opportunities'
            : i.source === 'planner'
              ? 'A card on a plan: click to open the plan'
              : i.source
                ? 'From Music: click to open it'
                : undefined
        }
      >
        <span style={{ width: 88, flexShrink: 0 }}>
          {dayLabel(i.start)}
          {i.end && i.end !== i.start ? ` – ${dayLabel(i.end)}` : ''}
          {i.time ? ` ${i.time}` : ''}
        </span>
        <span style={{ ...chip, background: KIND_COLORS[i.kind] || '#808080' }}>{i.kind}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b style={{ textDecoration: i.status === 'Cancelled' ? 'line-through' : undefined }}>{i.title}</b>
          {i.location ? ` · ${i.location}` : ''}
          {i.people?.length ? ` · ${i.people.join(', ')}` : ''}
        </span>
        {i.draft && <i style={{ whiteSpace: 'nowrap' }}>Draft</i>}
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
          {[...data.kinds, 'Release', 'Track due', 'Footage due', 'Task'].map((k) => (
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
      <div style={statusBar}>
        {msg || `${upcoming} coming up · ${data.items.filter((i) => i.source).length} dates from Music, plans and verses`}
      </div>
    </div>
  );
};

const TodayLine: React.FC<{ refEl: React.RefObject<HTMLDivElement | null> }> = ({ refEl }) => (
  <div
    ref={refEl}
    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px', color: '#000', fontWeight: 700, scrollMarginTop: 24 }}
  >
    <RetroIcon name="forward" />
    Today, {new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
    <span style={{ flex: 1, borderTop: '2px solid #000' }} />
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
  const [releases, setReleases] = useState<{ id: string; title: string; kind?: string }[]>([]);
  const [songs, setSongs] = useState<Record<string, { id: string; title: string }[]>>({}); // release id -> its songs
  const [spots, setSpots] = useState<{ id: string; name: string; address: string }[]>([]);
  const { openWindow } = useWindowManager();
  useEffect(() => setDraft(e), [e]);
  useEffect(() => {
    const loadTracks = () =>
      api('/api/tracks').then(
        (d: { releases: { id: string; title: string; kind?: string }[]; tracks: { id: string; release: string; title: string }[] }) => {
          setReleases(d.releases);
          const bySong: Record<string, { id: string; title: string }[]> = {};
          d.tracks.forEach((t) => (bySong[t.release] ||= []).push({ id: t.id, title: t.title }));
          setSongs(bySong);
        },
        () => {},
      );
    loadTracks();
    api('/api/locations').then(
      (d) => setSpots(d.items),
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
  const text = (k: 'title' | 'location' | 'notes' | 'recap' | 'link') => ({
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
        background: '#fff',
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
        <input
          type="time"
          value={e.time || ''}
          onChange={(ev) => save({ time: ev.target.value })}
          style={input}
          title="Start time (optional)"
        />
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
        <label
          style={{ display: 'flex', gap: 3, alignItems: 'center' }}
          title="Show it on the public calendar visitors see (title, kind, date, place, link, and the recap once it's over)"
        >
          <input
            type="checkbox"
            checked={!!e.public}
            disabled={!!e.members || !!e.draft}
            onChange={(ev) => save({ public: ev.target.checked })}
          />
          Show publicly
        </label>
        {me?.username === e.owner && (
          <label
            style={{ display: 'flex', gap: 3, alignItems: 'center' }}
            title="Only you see a draft (admins too) and nobody gets told about it. Untick to make it live and tell the people on it."
          >
            <input type="checkbox" checked={!!e.draft} onChange={(ev) => save({ draft: ev.target.checked })} />
            Draft
          </label>
        )}
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ minWidth: 60 }}>Spot</span>
          <select
            value={e.place || ''}
            onChange={(ev) => {
              const p = spots.find((x) => x.id === ev.target.value);
              save({ place: p?.id || null, ...(p && !e.location ? { location: p.address || p.name } : {}) });
            }}
            style={input}
            title="A spot from the location library (Operations > Plays > Sites)"
          >
            <option value="">(not from the location library)</option>
            {spots.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {e.place && (
            <button style={button} onClick={() => openStudio(openWindow, 'locations')}>
              <IconLabel icon="pin">See on map</IconLabel>
            </button>
          )}
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
          <span style={{ minWidth: 60 }}>Project</span>
          <select value={e.release || ''} onChange={(ev) => save({ release: ev.target.value || null })} style={input}>
            <option value="">{e.kind === 'Shoot' ? '(this shoot is its own project)' : '(not tied to a project)'}</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
                {r.kind ? ` (${r.kind === 'Folder' ? 'project' : r.kind})` : ''}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <ShotList entry={e} songs={(e.release && songs[e.release]) || []} save={save} />
      <button
        style={{ ...button, alignSelf: 'flex-start' }}
        title="The checklist as big rows to tap on the day, with uploads into the project's Shoots folder"
        onClick={() => openPlayDay(openWindow, e.id, e.title || e.kind)}
      >
        On the day (phone view)
      </button>
      <fieldset style={fieldset}>
        <legend>Notes</legend>
        <textarea
          rows={5}
          style={{ ...input, width: '100%', resize: 'vertical' }}
          placeholder="Brief, shot list, run of show..."
          {...text('notes')}
        />
      </fieldset>
      {e.public && (
        <fieldset style={fieldset}>
          <legend>Recap for visitors</legend>
          <textarea
            rows={3}
            style={{ ...input, width: '100%', resize: 'vertical' }}
            placeholder="How it went. Visitors see this on the public calendar once it's over, until the next event passes."
            {...text('recap')}
          />
        </fieldset>
      )}
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
  background: '#fff',
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

/** Words for a play's checklist: a shoot has a shot list, a show a setup, a session a recipe. */
const PLAY_WORDS: Record<string, { list: string; item: string; done: string; hint: string; note: string }> = {
  Shoot: {
    list: 'Shot list',
    item: 'shot',
    done: 'captured',
    hint: 'Add a shot (e.g. wide of the car, hook, 10 s)',
    note: 'Take, card, or what to redo',
  },
  Show: { list: 'Setup', item: 'step', done: 'done', hint: 'Add a step (e.g. line check, merch table)', note: 'Who, or what is missing' },
  Session: {
    list: 'Session recipe',
    item: 'step',
    done: 'done',
    hint: 'Add a step (e.g. SM7B, gain to -12 dB)',
    note: 'Setting, or what to change',
  },
};
const playWords = (kind: string) => PLAY_WORDS[kind] || { list: 'Checklist', item: 'step', done: 'done', hint: 'Add a step', note: 'Note' };

interface PlayTemplate {
  id: string;
  name: string;
  kind: string;
  steps: string[];
  by: string;
}

/**
 * A play's checklist (a shoot's shot list, a show setup, a session recipe): plan every step before the day, tick each
 * one as it's done, note the take or what to redo. Start from a saved template, or save this one as a template.
 */
const ShotList: React.FC<{ entry: Entry; songs: { id: string; title: string }[]; save: (body: object) => Promise<void> }> = ({
  entry: e,
  songs,
  save,
}) => {
  const api = useApi();
  const shots = e.shots || [];
  const w = playWords(e.kind);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState('');
  const [templates, setTemplates] = useState<PlayTemplate[] | null>(null);
  const [tmsg, setTmsg] = useState('');
  useEffect(() => setNotes({}), [e.shots]);
  const loadTemplates = () =>
    api('/api/timeline/templates')
      .then((r: { templates: PlayTemplate[] }) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  useEffect(() => {
    loadTemplates();
  }, []);
  const put = (list: Shot[]) => save({ shots: list });
  const set = (id: string, patch: Partial<Shot>) => put(shots.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const newId = () => Math.random().toString(36).slice(2, 10);
  const add = () => {
    const text = adding.trim();
    if (!text) return;
    setAdding('');
    put([...shots, { id: newId(), text, got: false, note: '' }]);
  };
  const useTemplate = (id: string) => {
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    put([...shots, ...t.steps.map((text) => ({ id: newId(), text, got: false, note: '' }))]);
    setTmsg(`Added ${t.steps.length} from "${t.name}".`);
  };
  const saveTemplate = async () => {
    const name = await dialog.prompt(`Name this ${w.list.toLowerCase()} so anyone can reuse it`, e.title, { title: 'Save as a play' });
    if (!name?.trim()) return;
    try {
      await api('/api/timeline/templates', {
        method: 'POST',
        body: JSON.stringify({ name, kind: e.kind, steps: shots.map((x) => x.text) }),
      });
      setTmsg(`Saved "${name.trim()}". Anyone can start a play from it.`);
      loadTemplates();
    } catch (err) {
      setTmsg((err as Error).message);
    }
  };
  const mine = (templates || []).filter((t) => t.kind === e.kind);
  const others = (templates || []).filter((t) => t.kind !== e.kind);
  const got = shots.filter((x) => x.got).length;
  return (
    <fieldset style={fieldset}>
      <legend>
        {w.list}
        {shots.length ? ` · ${got} of ${shots.length} ${w.done}` : ''}
      </legend>
      {!!templates?.length && (
        <select
          style={{ ...input, alignSelf: 'flex-start' }}
          value=""
          title="Add the steps of a saved play"
          onChange={(ev) => useTemplate(ev.target.value)}
        >
          <option value="">Start from a saved play…</option>
          {[...mine, ...others].map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.kind}, {t.steps.length})
            </option>
          ))}
        </select>
      )}
      {shots.map((x, i) => (
        <div key={x.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label
            style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 200px', minWidth: 0 }}
            title={`Tick it once it's ${w.done}`}
          >
            <input type="checkbox" checked={x.got} onChange={(ev) => set(x.id, { got: ev.target.checked })} />
            <span style={{ textDecoration: x.got ? 'line-through' : undefined }}>
              {i + 1}. {x.text}
            </span>
          </label>
          {songs.length > 1 && (
            <select
              style={{ ...input, maxWidth: 160 }}
              value={x.for || ''}
              title="The song in this project the shot is for"
              onChange={(ev) => set(x.id, { for: ev.target.value || null })}
            >
              <option value="">Whole project</option>
              {songs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
          <input
            style={{ ...input, flex: '1 1 160px' }}
            placeholder={w.note}
            value={notes[x.id] ?? x.note}
            onChange={(ev) => setNotes({ ...notes, [x.id]: ev.target.value })}
            onBlur={() => notes[x.id] !== undefined && notes[x.id] !== x.note && set(x.id, { note: notes[x.id] })}
          />
          <button style={button} title={`Remove this ${w.item}`} onClick={() => put(shots.filter((y) => y.id !== x.id))}>
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={{ ...input, flex: 1 }}
          placeholder={`${w.hint} and press Enter`}
          value={adding}
          onChange={(ev) => setAdding(ev.target.value)}
          onKeyDown={(ev) => ev.key === 'Enter' && add()}
        />
        <button style={button} onClick={add} disabled={!adding.trim()}>
          Add
        </button>
        {!!shots.length && (
          <button style={button} onClick={saveTemplate} title="Save these steps so anyone can start a play from them">
            Save as a play…
          </button>
        )}
      </div>
      {tmsg && <div style={{ fontSize: 12 }}>{tmsg}</div>}
    </fieldset>
  );
};
