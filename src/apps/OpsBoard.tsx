import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { useWindowManager } from '../wm/manager';
import { openMusic, openStudio } from './Studio';
import { planWindow, showEntry, showSong } from '../utils/songNav';
import { showVerses, Verse } from './OpenVerses';
import { ContentItem } from './ShotContent';

/**
 * The Operations board: the instrument panel for the whole team, built only from data that already exists
 * (songs, their footage, open verses and the calendar). Dark-cockpit rules: things that are fine stay quiet,
 * a green lamp means "you can act on this", an inverted blinking ■ lamp means something is late or blocked.
 * Time is shown as a week strip and due dates, never on a dial. No money here (Ledger is parked).
 */
interface Track {
  id: string;
  release: string;
  title: string;
  status: string;
  deadline: string | null;
  content?: ContentItem[];
}
interface Release {
  id: string;
  title: string;
  kind: string;
  date: string | null;
  content?: ContentItem[];
}
interface Entry {
  id: string;
  kind: string;
  title: string;
  start: string;
  end?: string | null;
  status?: string;
  people?: string[];
  source?: string;
  release?: string;
  track?: string;
  done?: boolean;
  board?: string;
  boardName?: string;
  covers?: string[];
  shots?: { id: string; text: string; got: boolean }[];
}

type Level = 'block' | 'act';
interface Lamp {
  key: string;
  level: Level;
  label: string;
  sub: string;
  go: () => void;
}

const STEP = ['To shoot', 'Shot', 'Edited', 'Posted'];
/** Week-strip tag per footage kind (the calendar entry's title starts with the kind). */
const FOOTAGE_TAG: Record<string, string> = { Reel: 'REEL', Video: 'VIDEO', Photos: 'PHOTO', Visualizer: 'VIZ', BTS: 'BTS' };
const NEXT: Record<string, string> = { 'To shoot': 'Shoot', Shot: 'Edit', Edited: 'Post' };
const today = () => new Date().toLocaleDateString('en-CA');
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00`);
  t.setDate(t.getDate() + n);
  return t.toLocaleDateString('en-CA');
};
const daysLate = (d: string) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SEEN_KEY = 'sk:board-seen';

const ink = 'var(--sk-ink)';
const paper = 'var(--sk-paper)';
const dim = '#888';
const label: React.CSSProperties = { fontFamily: 'Silkscreen, monospace', fontSize: 10, letterSpacing: 0.5 };
const panel: React.CSSProperties = { border: `2px solid ${ink}`, background: paper, padding: 8 };
const plate: React.CSSProperties = { ...label, background: ink, color: paper, padding: '2px 6px', alignSelf: 'flex-start' };

/** One cell per footage item: empty = to shoot, light dots = shot, dense dots = edited, solid = posted. */
const Cell: React.FC<{ status: string; title: string }> = ({ status, title }) => {
  const i = STEP.indexOf(status);
  return (
    <span
      title={title}
      style={{
        flex: '1 1 0',
        minWidth: 6,
        maxWidth: 22,
        height: 16,
        border: `2px solid ${ink}`,
        background:
          i === 3
            ? ink
            : i > 0
              ? `radial-gradient(${ink} ${i === 1 ? 0.6 : 1.2}px, transparent ${i === 1 ? 0.9 : 1.4}px) 0 0 / 3px 3px`
              : 'transparent',
      }}
    />
  );
};

const OpsBoard: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const { openWindow } = useWindowManager();
  const [tracks, setTracks] = useState<{ releases: Release[]; tracks: Track[] } | null>(null);
  const [verses, setVerses] = useState<Verse[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [msg, setMsg] = useState('');

  const loadTracks = useCallback(() => api('/api/tracks').then(setTracks, (e) => setMsg(e.message)), [api]);
  const loadVerses = useCallback(
    () =>
      api('/api/verses').then(
        (d) => setVerses(d.items),
        () => {},
      ),
    [api],
  );
  const loadTimeline = useCallback(
    () =>
      api('/api/timeline').then(
        (d) => setEntries(d.items),
        () => {},
      ),
    [api],
  );
  useEffect(() => {
    loadTracks();
    loadVerses();
    loadTimeline();
  }, [loadTracks, loadVerses, loadTimeline]);
  useLiveEvent('tracks', () => (loadTracks(), loadTimeline()));
  useLiveEvent('verses', () => (loadVerses(), loadTimeline()));
  useLiveEvent('timeline', loadTimeline);

  // Footage posted per song at your last visit, so each row can say what changed since then
  const [seen] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const user = me?.username || '';
  const now = today();
  const releases = useMemo(() => new Map((tracks?.releases || []).map((r) => [r.id, r])), [tracks]);
  const goSong = (release: string, track?: string) => {
    showSong(release, track);
    openMusic(openWindow);
  };
  const goVerses = () => {
    showVerses();
    openMusic(openWindow);
  };
  const goCalendar = (id: string) => {
    showEntry(id);
    openStudio(openWindow, 'calendar');
  };

  // Songs still in play: not done, or done with footage left to post
  const rows = useMemo(() => {
    const list = (tracks?.tracks || []).map((t) => {
      const content = t.content || [];
      const posted = content.filter((c) => c.status === 'Posted').length;
      const lateFootage = content.filter((c) => c.due && c.due < now && c.status !== 'Posted');
      const late = !!t.deadline && t.deadline < now && t.status !== 'Done';
      // late items first, then whatever is due soonest (undated last)
      const next =
        lateFootage[0] || content.filter((c) => c.status !== 'Posted').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))[0];
      const r = releases.get(t.release);
      return { t, r, content, posted, lateFootage, late, next };
    });
    return list
      .filter((x) => x.t.status !== 'Done' || x.content.some((c) => c.status !== 'Posted'))
      .sort(
        (a, b) =>
          Number(b.late || b.lateFootage.length > 0) - Number(a.late || a.lateFootage.length > 0) ||
          (a.r?.date || '9999').localeCompare(b.r?.date || '9999') ||
          a.t.title.localeCompare(b.t.title),
      );
  }, [tracks, releases, now]);

  // Remember what you saw, a moment after the board shows it
  useEffect(() => {
    if (!tracks) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(rows.map((x) => [x.t.id, x.posted]))));
      } catch {
        /* private mode */
      }
    }, 4000);
    return () => clearTimeout(id);
  }, [tracks, rows]);

  // Master caution: at most five lamps, blockers first, only what needs someone
  const lamps = useMemo(() => {
    const out: Lamp[] = [];
    const lateSongs = rows.filter((x) => x.late);
    if (lateSongs.length)
      out.push({
        key: 'late',
        level: 'block',
        label: plural(lateSongs.length, 'song') + ' late',
        sub: `${lateSongs[0].t.title} · ${daysLate(lateSongs[0].t.deadline!)}d past due`,
        go: () => goSong(lateSongs[0].t.release, lateSongs[0].t.id),
      });
    const lateFootage = rows.filter((x) => x.lateFootage.length);
    if (lateFootage.length)
      out.push({
        key: 'footage',
        level: 'block',
        label: 'Footage late',
        sub: `${lateFootage[0].t.title} · ${plural(
          lateFootage.reduce((n, x) => n + x.lateFootage.length, 0),
          'item',
        )}`,
        go: () => goSong(lateFootage[0].t.release, lateFootage[0].t.id),
      });
    const live = verses.filter((v) => !v.picked);
    const toPick = live.filter((v) => v.by === user && v.slots.some((s) => s.take));
    if (toPick.length)
      out.push({
        key: 'pick',
        level: 'act',
        label: 'Takes to pick',
        sub: `${toPick[0].title} · ${plural(toPick[0].slots.filter((s) => s.take).length, 'take')} in`,
        go: goVerses,
      });
    const myVerse = live.filter((v) => v.slots.some((s) => s.by === user && !s.take));
    if (myVerse.length)
      out.push({
        key: 'mine',
        level: myVerse.some((v) => v.deadline && v.deadline < now) ? 'block' : 'act',
        label: 'Your verse to record',
        sub: `${myVerse[0].title}${myVerse[0].deadline ? ` · due ${myVerse[0].deadline.slice(5)}` : ''}`,
        go: goVerses,
      });
    const open = live.filter((v) => v.by !== user && v.slots.some((s) => !s.by));
    if (open.length)
      out.push({
        key: 'open',
        level: 'act',
        label: plural(open.length, 'open verse'),
        sub: open[0].title,
        go: goVerses,
      });
    // A shoot that's happened with footage it covered still "To shoot": someone on it should mark it Shot
    const toShoot = new Set<string>();
    for (const o of [...(tracks?.tracks || []), ...(tracks?.releases || [])])
      for (const c of o.content || []) if (c.status === 'To shoot') toShoot.add(`${o.id}:${c.id}`);
    const unmarked = entries.filter(
      (e) =>
        !e.source &&
        e.kind === 'Shoot' &&
        e.status !== 'Cancelled' &&
        (e.end || e.start) < now &&
        (e.people?.includes(user) || !!me?.admin) &&
        (e.covers || []).some((c) => toShoot.has(c)),
    );
    if (unmarked.length)
      out.push({
        key: 'shot',
        level: 'act',
        label: 'Mark footage shot',
        sub: `${unmarked[0].title} · ${(unmarked[0].covers || []).filter((c) => toShoot.has(c)).length} still "to shoot"`,
        go: () => goCalendar(unmarked[0].id),
      });
    // A shoot that's over with shots on its list never ticked: reshoot or note why
    const missed = entries.filter(
      (e) =>
        !e.source &&
        e.kind === 'Shoot' &&
        e.status !== 'Cancelled' &&
        (e.end || e.start) < now &&
        (e.people?.includes(user) || !!me?.admin) &&
        (e.shots || []).some((x) => !x.got),
    );
    if (missed.length)
      out.push({
        key: 'missed',
        level: 'block',
        label: 'Shots missed',
        sub: `${missed[0].title} · ${(missed[0].shots || []).filter((x) => !x.got).length} not captured`,
        go: () => goCalendar(missed[0].id),
      });
    // Plan cards on you: late ones block, ones due in the next 2 days are yours to act on
    const tasks = entries
      .filter((e) => e.source === 'planner' && !e.done && e.people?.includes(user) && e.start <= addDays(now, 2))
      .sort((a, b) => a.start.localeCompare(b.start));
    if (tasks.length) {
      const late = tasks.filter((e) => e.start < now);
      const first = late[0] || tasks[0];
      out.push({
        key: 'tasks',
        level: late.length ? 'block' : 'act',
        label: late.length ? `${plural(late.length, 'task')} late` : plural(tasks.length, 'task') + ' on you',
        sub: `${first.title} · ${first.start === now ? 'today' : first.start.slice(5)}`,
        go: () => first.board && openWindow(planWindow(first.board, first.boardName || 'Plan')),
      });
    }
    const shoots = entries.filter(
      (e) =>
        !e.source &&
        e.kind === 'Shoot' &&
        e.status !== 'Done' &&
        e.status !== 'Cancelled' &&
        e.start >= now &&
        e.start <= addDays(now, 2) &&
        (!e.people?.length || e.people.includes(user) || !!me?.admin), // the Director hears about every shoot
    );
    if (shoots.length)
      out.push({
        key: 'shoot',
        level: 'act',
        label: 'Shoot in 48h',
        sub: `${shoots[0].title} · ${shoots[0].start === now ? 'today' : shoots[0].start.slice(5)} · ${
          shoots[0].shots?.length ? plural(shoots[0].shots.length, 'shot') + ' planned' : 'no shot list yet'
        }`,
        go: () => goCalendar(shoots[0].id),
      });
    return out.slice(0, 5);
  }, [rows, verses, entries, user, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // This week: seven days from today, each with what lands on it (calendar already merges releases, song and footage dues, verses)
  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(now, i);
        const on = entries.filter((e) => e.start === d || (e.end && e.start <= d && e.end >= d));
        const tag = (e: Entry) =>
          e.kind === 'Release'
            ? 'OUT'
            : e.kind === 'Shoot'
              ? 'SHOOT'
              : e.kind === 'Verse due'
                ? 'VERSE'
                : e.kind === 'Footage due'
                  ? FOOTAGE_TAG[e.title.split(':')[0].split(' ')[0]] || 'CLIP'
                  : e.kind === 'Task'
                    ? 'TASK'
                    : e.kind === 'Track due'
                      ? 'DUE'
                      : e.kind.toUpperCase().slice(0, 5);
        return {
          d,
          day: new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
          tags: [...new Set(on.map(tag))],
          titles: on.map((e) => e.title).join('\n'),
          out: on.some((e) => e.kind === 'Release'),
          first: on[0],
        };
      }),
    [entries, now],
  );

  if (!tracks) return <div style={{ padding: 12 }}>{msg || 'Loading the board...'}</div>;

  const lampStyle = (l: Lamp): React.CSSProperties => ({
    flex: '1 1 160px',
    minHeight: 44,
    textAlign: 'left',
    padding: '6px 8px',
    cursor: 'pointer',
    border: `2px solid ${ink}`,
    background: l.level === 'block' ? ink : 'var(--sk-signal)',
    color: l.level === 'block' ? paper : '#000',
    font: 'inherit',
  });

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
      <style>{`@keyframes sk-lamp{0%,49%{opacity:1}50%,100%{opacity:.2}}.sk-lamp-blink{animation:sk-lamp 1s steps(1) infinite}@media (prefers-reduced-motion:reduce){.sk-lamp-blink{animation:none}}`}</style>

      <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <div style={{ ...label, width: '100%' }}>MASTER CAUTION · WHAT NEEDS SOMEONE</div>
        {lamps.length ? (
          lamps.map((l) => (
            <button key={l.key} onClick={l.go} style={lampStyle(l)}>
              <span className={l.level === 'block' ? 'sk-lamp-blink' : ''} style={{ ...label, display: 'block' }}>
                {l.level === 'block' ? '■' : '●'} {l.label.toUpperCase()}
              </span>
              <span>{l.sub}</span>
            </button>
          ))
        ) : (
          <div style={{ color: dim, padding: '6px 0' }}>· · All clear. Nothing is late and nothing is waiting on anyone.</div>
        )}
      </div>

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={plate}>THIS WEEK</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
          {week.map((w, i) => (
            <button
              key={w.d}
              title={w.titles || 'Nothing on'}
              onClick={() =>
                w.first &&
                (w.first.source ? (w.first.release ? goSong(w.first.release, w.first.track) : goVerses()) : goCalendar(w.first.id))
              }
              style={{
                font: 'inherit',
                cursor: w.first ? 'pointer' : 'default',
                minHeight: 52,
                padding: '4px 2px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                border: `2px ${w.tags.length || i === 0 ? 'solid' : 'dotted'} ${w.tags.length || i === 0 ? ink : dim}`,
                background: i === 0 ? ink : paper,
                color: i === 0 ? paper : ink,
                outline: w.out ? '2px solid var(--sk-signal)' : 'none',
                outlineOffset: 2,
              }}
            >
              <span>{i === 0 ? 'TODAY' : w.day}</span>
              {w.tags.slice(0, 2).map((t) => (
                <span key={t} style={{ ...label, fontSize: 9 }}>
                  {t}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...panel, padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `2px solid ${ink}`, ...label }}>
          <span>SONGS IN PLAY · {rows.length}</span>
          <span>FOOTAGE · NEXT STEP</span>
        </div>
        {rows.length === 0 && <div style={{ padding: 8, color: dim }}>No songs in play. New songs show up here from Music.</div>}
        {rows.map(({ t, r, content, posted, lateFootage, late, next }) => {
          const before = seen[t.id];
          const delta = before !== undefined && posted > before ? `▲${posted - before} since last visit` : '';
          return (
            <button
              key={t.id}
              onClick={() => goSong(t.release, t.id)}
              style={{
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                border: 'none',
                borderBottom: `1px solid ${ink}`,
                background: paper,
                color: ink,
              }}
            >
              <span style={{ flex: '1 1 160px', minWidth: 0 }}>
                <b>{t.title}</b>
                <br />
                <span style={{ color: dim }}>
                  {r?.title || ''} · {t.status}
                  {r?.date ? ` · out ${r.date.slice(5)}` : ''}
                </span>
              </span>
              <span style={{ flex: '2 1 180px', display: 'flex', gap: 2, alignItems: 'center' }}>
                {content.length ? (
                  content.map((c) => (
                    <Cell key={c.id} status={c.status} title={`${c.kind}${c.title ? `: ${c.title}` : ''} · ${c.status}`} />
                  ))
                ) : (
                  <span style={{ color: dim }}>no footage planned</span>
                )}
              </span>
              <span style={{ flex: '0 0 auto', minWidth: 48, textAlign: 'right' }}>
                {content.length ? `${posted}/${content.length}` : ''}
              </span>
              <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                {late ? (
                  <span className="sk-lamp-blink" style={{ ...label, background: ink, color: paper, padding: '2px 4px' }}>
                    ■ {daysLate(t.deadline!)}D LATE
                  </span>
                ) : lateFootage.length ? (
                  <span className="sk-lamp-blink" style={{ ...label, background: ink, color: paper, padding: '2px 4px' }}>
                    ■ FOOTAGE LATE
                  </span>
                ) : null}{' '}
                {next
                  ? `${NEXT[next.status]} ${next.kind.toLowerCase()}${next.title ? `: ${next.title}` : ''}`
                  : t.status === 'Done'
                    ? 'All posted'
                    : `${t.status}`}
                {delta && <span style={{ display: 'block', color: dim }}>{delta}</span>}
              </span>
            </button>
          );
        })}
        <div style={{ padding: '4px 8px', color: dim }}>□ to shoot · ░ shot · ▒ edited · ■ posted · click a song to open it</div>
      </div>
    </div>
  );
};

export default OpsBoard;
