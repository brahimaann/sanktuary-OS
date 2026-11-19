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
  owner?: string;
  owners?: string[];
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
  location?: string;
  shots?: { id: string; text: string; got: boolean; for?: string | null }[];
}

type Level = 'block' | 'act';
interface Lamp {
  key: string;
  level: Level;
  label: string;
  sub: string;
  to: string; // where the lamp takes you
  go: () => void;
}

const STEP = ['To shoot', 'Shot', 'Edited', 'Approved', 'Posted'];
const PLAY_KINDS = ['Shoot', 'Show', 'Session'];
/** Week-strip tag per footage kind (the calendar entry's title starts with the kind). */
const FOOTAGE_TAG: Record<string, string> = { Video: 'VIDEO', Photos: 'PHOTO', Visualizer: 'VIZ', BTS: 'BTS' };
const NEXT: Record<string, string> = { 'To shoot': 'Shoot', Shot: 'Edit', Edited: 'Get the OK on', Approved: 'Post' };
const today = () => new Date().toLocaleDateString('en-CA');
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00`);
  t.setDate(t.getDate() + n);
  return t.toLocaleDateString('en-CA');
};
const daysLate = (d: string) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SEEN_KEY = 'sk:board-seen';
/** The tag a calendar entry gets in a day cell on the wall. */
const dayTag = (e: { kind: string; title: string }) =>
  e.kind === 'Release'
    ? 'OUT'
    : e.kind === 'Verse due'
      ? 'VERSE'
      : e.kind === 'Footage due'
        ? FOOTAGE_TAG[e.title.split(':')[0].split(' ')[0]] || 'CLIP'
        : e.kind === 'Task'
          ? 'TASK'
          : e.kind === 'Track due'
            ? 'DUE'
            : e.kind.toUpperCase().slice(0, 7);

const ink = 'var(--sk-ink)';
const paper = 'var(--sk-paper)';
const dim = '#888';
const label: React.CSSProperties = { fontFamily: 'Silkscreen, monospace', fontSize: 10, letterSpacing: 0.5 };
const panel: React.CSSProperties = { border: `2px solid ${ink}`, background: paper, padding: 8 };

/** One cell per footage item: empty = to shoot, light dots = shot, dense dots = edited, half = OK'd, solid = posted. */
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
          i === 4
            ? ink
            : i === 3
              ? `linear-gradient(to top, ${ink} 50%, transparent 50%)`
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
        to: 'the song',
        level: 'block',
        label: plural(lateSongs.length, 'song') + ' late',
        sub: `${lateSongs[0].t.title} · ${daysLate(lateSongs[0].t.deadline!)}d past due`,
        go: () => goSong(lateSongs[0].t.release, lateSongs[0].t.id),
      });
    const lateFootage = rows.filter((x) => x.lateFootage.length);
    if (lateFootage.length)
      out.push({
        key: 'footage',
        to: "the song's footage",
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
        to: 'open verses',
        level: 'act',
        label: 'Takes to pick',
        sub: `${toPick[0].title} · ${plural(toPick[0].slots.filter((s) => s.take).length, 'take')} in`,
        go: goVerses,
      });
    const myVerse = live.filter((v) => v.slots.some((s) => s.by === user && !s.take));
    if (myVerse.length)
      out.push({
        key: 'mine',
        to: 'open verses',
        level: myVerse.some((v) => v.deadline && v.deadline < now) ? 'block' : 'act',
        label: 'Your verse to record',
        sub: `${myVerse[0].title}${myVerse[0].deadline ? ` · due ${myVerse[0].deadline.slice(5)}` : ''}`,
        go: goVerses,
      });
    const open = live.filter((v) => v.by !== user && v.slots.some((s) => !s.by));
    if (open.length)
      out.push({
        key: 'open',
        to: 'open verses',
        level: 'act',
        label: plural(open.length, 'open verse'),
        sub: open[0].title,
        go: goVerses,
      });
    // A shoot that just wrapped (last 3 days): what's next. Most of the shot list captured: on to the edit.
    // Under half: plan a pickup shoot for the rest.
    const wrapped = entries.filter(
      (e) =>
        !e.source &&
        e.kind === 'Shoot' &&
        e.status !== 'Cancelled' &&
        e.status !== 'Done' &&
        (e.end || e.start) < now &&
        (e.end || e.start) >= addDays(now, -3) &&
        !!e.shots?.length &&
        (e.people?.includes(user) || !!me?.admin),
    );
    for (const e of wrapped.slice(0, 2)) {
      const shots = e.shots || [];
      const got = shots.filter((x) => x.got).length;
      const enough = got * 2 >= shots.length;
      out.push({
        key: `wrap-${e.id}`,
        to: enough ? 'the footage' : 'the shot list',
        level: 'act',
        label: enough ? 'Next: edit' : 'Next: pickup shoot',
        sub: `${e.title} wrapped · ${got} of ${shots.length} shots${enough ? '' : ' · plan the rest'}`,
        go: () => (enough && e.release ? goSong(e.release, shots.find((x) => x.for)?.for || undefined) : goCalendar(e.id)),
      });
    }
    // Edits waiting on your OK, on projects you own
    const toOk = rows.filter(
      (x) => x.r && (x.r.owner === user || x.r.owners?.includes(user) || !!me?.admin) && x.content.some((c) => c.status === 'Edited'),
    );
    if (toOk.length)
      out.push({
        key: 'ok',
        to: 'watch it, give the OK',
        level: 'act',
        label: `${plural(
          toOk.reduce((n, x) => n + x.content.filter((c) => c.status === 'Edited').length, 0),
          'edit',
        )} to OK`,
        sub: `${toOk[0].t.title} · watch it and give the OK`,
        go: () => goSong(toOk[0].t.release, toOk[0].t.id),
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
        to: 'the plan',
        level: late.length ? 'block' : 'act',
        label: late.length ? `${plural(late.length, 'task')} late` : plural(tasks.length, 'task') + ' on you',
        sub: `${first.title} · ${first.start === now ? 'today' : first.start.slice(5)}`,
        go: () => first.board && openWindow(planWindow(first.board, first.boardName || 'Plan')),
      });
    }
    const shoots = entries.filter(
      (e) =>
        !e.source &&
        PLAY_KINDS.includes(e.kind) &&
        e.status !== 'Done' &&
        e.status !== 'Cancelled' &&
        e.start >= now &&
        e.start <= addDays(now, 2) &&
        (!e.people?.length || e.people.includes(user) || !!me?.admin), // the Director hears about every shoot
    );
    if (shoots.length)
      out.push({
        key: 'shoot',
        to: 'the checklist',
        level: 'act',
        label: `${shoots[0].kind} in 48h`,
        sub: `${shoots[0].title} · ${shoots[0].start === now ? 'today' : shoots[0].start.slice(5)} · ${
          shoots[0].shots?.length
            ? `${shoots[0].shots.filter((x) => x.got).length} of ${shoots[0].shots.length} ticked`
            : 'no checklist yet'
        }`,
        go: () => goCalendar(shoots[0].id),
      });
    return out.slice(0, 5);
  }, [rows, verses, entries, user, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // The calendar on the wall: this week (seven days from today) or the month (five weeks from this week's Sunday).
  // The calendar already merges releases, song and footage dues, verses and plan cards.
  const [cal, setCal] = useState<'week' | 'month'>('week');
  const days = useMemo(() => {
    const first = cal === 'week' ? now : addDays(now, -new Date(`${now}T12:00:00`).getDay());
    return Array.from({ length: cal === 'week' ? 7 : 35 }, (_, i) => {
      const d = addDays(first, i);
      const on = entries.filter((e) => e.start === d || (e.end && e.start <= d && e.end >= d));
      return {
        d,
        day:
          cal === 'week'
            ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
            : String(Number(d.slice(8))),
        tags: [...new Set(on.map(dayTag))],
        titles: on.map((e) => e.title).join('\n'),
        out: on.some((e) => e.kind === 'Release'),
        first: on[0],
      };
    });
  }, [entries, now, cal]);

  if (!tracks) return <div style={{ padding: 12 }}>{msg || 'Loading the board...'}</div>;

  // The wall, left: this week's plays by site, on a radar (day = angle, kind = ring)
  const weekPlays = entries
    .filter((e) => !e.source && PLAY_KINDS.includes(e.kind) && e.status !== 'Cancelled' && e.start >= now && e.start <= addDays(now, 6))
    .sort((a, b) => a.start.localeCompare(b.start));
  // The wall, right: the next project out, counted down, with its footage, owners, plays and plan
  const nextOut = (tracks.releases || []).filter((r) => r.date && r.date >= now).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const campaign = nextOut && {
    r: nextOut,
    days: Math.round((Date.parse(nextOut.date!) - Date.parse(now)) / 864e5),
    footage: [...(nextOut.content || []), ...rows.filter((x) => x.t.release === nextOut.id).flatMap((x) => x.content)],
    owners: [nextOut.owner, ...(nextOut.owners || [])].filter(Boolean) as string[],
    play: entries.find(
      (e) => !e.source && e.release === nextOut.id && PLAY_KINDS.includes(e.kind) && e.start >= now && e.status !== 'Cancelled',
    ),
    plan: entries.filter((e) => e.source === 'planner' && e.release === nextOut.id),
  };
  const todos = entries
    .filter((e) => e.source === 'planner' && !e.done)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5);
  const leads = entries
    .filter((e) => e.source === 'opportunities' && !e.done && e.start >= now)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5);
  const needYou = lamps.filter((l) => l.key !== 'open').length;

  const lampStyle = (l: Lamp): React.CSSProperties => ({
    minHeight: 64,
    textAlign: 'left',
    padding: '6px 8px',
    cursor: 'pointer',
    border: `2px solid ${ink}`,
    background: l.level === 'block' ? ink : 'var(--sk-signal)',
    color: l.level === 'block' ? paper : '#000',
    font: 'inherit',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  });
  const head = (text: string, right?: React.ReactNode) => (
    <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 6, borderBottom: `2px solid ${ink}`, paddingBottom: 3 }}>
      <span style={{ flex: 1 }}>{text}</span>
      {right}
    </div>
  );
  const toggle = (on: boolean): React.CSSProperties => ({
    ...label,
    border: `2px solid ${ink}`,
    padding: '2px 8px',
    cursor: 'pointer',
    background: on ? ink : paper,
    color: on ? paper : ink,
  });
  const row: React.CSSProperties = {
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    width: '100%',
    border: 'none',
    borderTop: `1px solid ${dim}`,
    padding: '4px 0',
    background: paper,
    color: ink,
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
      <style>{`@keyframes sk-lamp{0%,49%{opacity:1}50%,100%{opacity:.2}}.sk-lamp-blink{animation:sk-lamp 1s steps(1) infinite}@keyframes sk-sweep{to{transform:rotate(360deg)}}.sk-sweep{transform-origin:70px 70px;animation:sk-sweep 4s steps(48) infinite}@media (prefers-reduced-motion:reduce){.sk-lamp-blink,.sk-sweep{animation:none}}`}</style>

      <div style={{ ...label, display: 'flex', gap: 8, letterSpacing: 1 }}>
        <span style={{ flex: 1 }}>THE WALL · WHAT'S NEXT</span>
        <span>
          {new Date(`${now}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
          {lamps.length ? ` · ${needYou} NEED YOU` : ' · ALL CLEAR'}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
        <div style={{ ...panel, flex: '1 1 170px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {head('PLAYS THIS WEEK')}
          <svg
            width="140"
            height="140"
            viewBox="0 0 140 140"
            style={{ alignSelf: 'center' }}
            role="img"
            aria-label="This week's plays by day"
          >
            <circle cx="70" cy="70" r="66" fill="none" stroke={ink} strokeWidth="2" />
            <circle cx="70" cy="70" r="44" fill="none" stroke={dim} strokeDasharray="3 4" />
            <circle cx="70" cy="70" r="22" fill="none" stroke={dim} strokeDasharray="3 4" />
            <line x1="4" y1="70" x2="136" y2="70" stroke={dim} />
            <line x1="70" y1="4" x2="70" y2="136" stroke={dim} />
            <g className="sk-sweep">
              <line x1="70" y1="70" x2="70" y2="6" stroke={ink} strokeWidth="2" />
            </g>
            {weekPlays.map((e) => {
              const day = Math.round((Date.parse(e.start) - Date.parse(now)) / 864e5);
              const a = ((day / 7) * 360 - 90) * (Math.PI / 180);
              const rad = [22, 44, 60][PLAY_KINDS.indexOf(e.kind)] ?? 52;
              const x = 70 + rad * Math.cos(a) - 5;
              const y = 70 + rad * Math.sin(a) - 5;
              return (
                <rect
                  key={e.id}
                  x={x}
                  y={y}
                  width="10"
                  height="10"
                  fill={day <= 2 ? 'var(--sk-signal)' : paper}
                  stroke={ink}
                  strokeWidth="2"
                  style={{ cursor: 'pointer' }}
                  onClick={() => goCalendar(e.id)}
                >
                  <title>{`${e.kind}: ${e.title} · ${e.start.slice(5)}${e.location ? ` · ${e.location}` : ''}`}</title>
                </rect>
              );
            })}
          </svg>
          {weekPlays.length ? (
            weekPlays.slice(0, 3).map((e) => (
              <button key={e.id} style={{ ...row, borderTop: 'none', padding: 0 }} onClick={() => goCalendar(e.id)}>
                {e.start === now ? 'Today' : new Date(`${e.start}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })} ·{' '}
                {e.location || e.title}
              </button>
            ))
          ) : (
            <span style={{ color: dim }}>No plays this week.</span>
          )}
        </div>

        <div style={{ ...panel, flex: '3 1 300px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {head('MASTER CAUTION · WHAT NEEDS SOMEONE')}
          {lamps.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
              {lamps.map((l) => (
                <button key={l.key} onClick={l.go} style={lampStyle(l)}>
                  <span className={l.level === 'block' ? 'sk-lamp-blink' : ''} style={label}>
                    {l.level === 'block' ? '■' : '●'} {l.label.toUpperCase()}
                  </span>
                  <span>{l.sub}</span>
                  <span style={{ opacity: 0.8 }}>→ {l.to}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ color: dim, padding: '6px 0' }}>· · All clear. Nothing is late and nothing is waiting on anyone.</div>
          )}
        </div>

        <div style={{ ...panel, flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {campaign ? (
            <>
              {head(
                `${campaign.r.title.toUpperCase()} · OUT ${new Date(`${campaign.r.date}T12:00:00`)
                  .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  .toUpperCase()}`,
              )}
              <button
                style={{ ...row, borderTop: 'none', display: 'flex', alignItems: 'baseline', gap: 6 }}
                onClick={() => goSong(campaign.r.id)}
              >
                <span style={{ fontSize: 28, lineHeight: 1 }}>{campaign.days === 0 ? 'Today' : `${campaign.days}d`}</span>
                <span style={{ color: dim }}>{campaign.r.kind}</span>
              </button>
              {campaign.footage.length ? (
                <>
                  <span style={{ display: 'flex', gap: 2 }}>
                    {campaign.footage.map((c) => (
                      <Cell key={c.id} status={c.status} title={`${c.kind}${c.title ? `: ${c.title}` : ''} · ${c.status}`} />
                    ))}
                  </span>
                  <span>
                    Footage:{' '}
                    {STEP.map((st) => [st, campaign.footage.filter((c) => c.status === st).length] as const)
                      .filter(([, n]) => n)
                      .map(([st, n]) => `${n} ${st === 'Approved' ? "OK'd" : st.toLowerCase()}`)
                      .join(' · ')}
                  </span>
                </>
              ) : (
                <span style={{ color: dim }}>No footage planned yet.</span>
              )}
              {!!campaign.owners.length && <span>Owners: {campaign.owners.join(' · ')}</span>}
              {campaign.play && (
                <button style={row} onClick={() => goCalendar(campaign.play!.id)}>
                  {campaign.play.kind} {campaign.play.start.slice(5)}:{' '}
                  {campaign.play.shots?.length
                    ? `${campaign.play.shots.filter((x) => x.got).length} of ${campaign.play.shots.length} ticked`
                    : 'no checklist yet'}
                </button>
              )}
              {!!campaign.plan.length && (
                <span>
                  Plan: {campaign.plan.filter((e) => e.done).length} of {campaign.plan.length} done
                </span>
              )}
            </>
          ) : (
            <>
              {head('NEXT OUT')}
              <span style={{ color: dim }}>No release date set. Give a project a date and it counts down here.</span>
            </>
          )}
        </div>
      </div>

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {head(
          cal === 'week'
            ? 'THIS WEEK'
            : new Date(`${now}T12:00:00`).toLocaleDateString('en-US', { month: 'long' }).toUpperCase() + ' · FIVE WEEKS',
          <>
            <button style={toggle(cal === 'week')} onClick={() => setCal('week')}>
              WEEK
            </button>
            <button style={toggle(cal === 'month')} onClick={() => setCal('month')}>
              MONTH
            </button>
          </>,
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
          {days.map((w) => {
            const isToday = w.d === now;
            const past = w.d < now;
            return (
              <button
                key={w.d}
                title={w.titles || 'Nothing on'}
                onClick={() =>
                  w.first &&
                  (w.first.source === 'planner' && w.first.board
                    ? openWindow(planWindow(w.first.board, w.first.boardName || 'Plan'))
                    : w.first.source
                      ? w.first.release
                        ? goSong(w.first.release, w.first.track)
                        : goVerses()
                      : goCalendar(w.first.id))
                }
                style={{
                  font: 'inherit',
                  cursor: w.first ? 'pointer' : 'default',
                  minHeight: cal === 'week' ? 52 : 40,
                  padding: '4px 2px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  opacity: past ? 0.45 : 1,
                  border: `2px ${w.tags.length || isToday ? 'solid' : 'dotted'} ${w.tags.length || isToday ? ink : dim}`,
                  background: isToday ? ink : paper,
                  color: isToday ? paper : ink,
                  outline: w.out ? '2px solid var(--sk-signal)' : 'none',
                  outlineOffset: 2,
                }}
              >
                <span>{isToday ? 'TODAY' : w.day}</span>
                {w.tags.slice(0, 2).map((t) => (
                  <span key={t} style={{ ...label, fontSize: 9 }}>
                    {t}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
        <div style={{ ...panel, flex: '3 1 360px', padding: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `2px solid ${ink}`, ...label }}>
            <span>SONGS IN PLAY · {rows.length}</span>
            <span>FOOTAGE · NEXT STEP</span>
          </div>
          {rows.length === 0 && <div style={{ padding: 8, color: dim }}>No songs in play. New songs show up here from Projects.</div>}
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
                <span style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <b>{t.title}</b>
                  <br />
                  <span style={{ color: dim }}>
                    {r?.title || ''} · {t.status}
                    {r?.date ? ` · out ${r.date.slice(5)}` : ''}
                  </span>
                </span>
                <span style={{ flex: '2 1 140px', display: 'flex', gap: 2, alignItems: 'center' }}>
                  {content.length ? (
                    content.map((c) => (
                      <Cell key={c.id} status={c.status} title={`${c.kind}${c.title ? `: ${c.title}` : ''} · ${c.status}`} />
                    ))
                  ) : (
                    <span style={{ color: dim }}>no footage planned</span>
                  )}
                </span>
                <span style={{ flex: '0 0 auto', minWidth: 40, textAlign: 'right' }}>
                  {content.length ? `${posted}/${content.length}` : ''}
                </span>
                <span style={{ flex: '1 1 180px', minWidth: 0 }}>
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
          <div style={{ padding: '4px 8px', color: dim }}>□ to shoot · ░ shot · ▒ edited · ▄ OK'd · ■ posted · click a song to open it</div>
        </div>

        <div style={{ ...panel, flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {head(`TO-DO · ${todos.length}`)}
          {todos.length ? (
            todos.map((e) => {
              const late = e.start < now;
              return (
                <button
                  key={e.id}
                  style={{ ...row, borderTop: 'none', border: `2px solid ${late ? ink : dim}`, padding: 6, marginTop: 4 }}
                  onClick={() => e.board && openWindow(planWindow(e.board, e.boardName || 'Plan'))}
                >
                  <span style={{ display: 'block' }}>{e.title}</span>
                  <span style={{ color: late ? ink : dim }}>
                    {e.people?.[0] || 'nobody yet'} · {late ? `was due ${e.start.slice(5)}` : e.start === now ? 'today' : e.start.slice(5)}
                  </span>
                </button>
              );
            })
          ) : (
            <span style={{ color: dim }}>No dated cards. Plans with due dates show up here.</span>
          )}
        </div>

        <div style={{ ...panel, flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {head(
            'LEADS',
            <button style={toggle(false)} onClick={() => openStudio(openWindow, 'opportunities')}>
              ALL
            </button>,
          )}
          {leads.length ? (
            leads.map((e) => (
              <button key={e.id} style={row} onClick={() => openStudio(openWindow, 'opportunities')}>
                <span style={{ display: 'block' }}>{e.title}</span>
                <span style={{ color: dim }}>due {e.start.slice(5)}</span>
              </button>
            ))
          ) : (
            <span style={{ color: dim }}>No open leads with a deadline. Add grants, calls and gigs under Leads.</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default OpsBoard;
