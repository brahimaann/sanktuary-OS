import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useWindowManager } from '../wm/manager';
import { button, shell } from './fileTypes';

// Operations (the Studio window) has three desks instead of eight tabs:
// - Board: the wall (what needs someone, this week, songs in play), then the Calendar, To-dos (Planner) and Leads
//   (Opportunities, Outreach) as folded sections under it.
// - Music: songs, bounces, open verses and footage, then the Library (books, Renaissance Radio, our archive) folded under it.
// - Shoots: the shoot location map.
// Each part is the full app it replaces; once opened it stays loaded, so switching desks keeps what you were doing.
// openStudio() still takes the old tab names: they open the right desk and unfold that section.
const OpsBoard = lazy(() => import('./OpsBoard'));
const Tracks = lazy(() => import('./Tracks'));
const Timeline = lazy(() => import('./Timeline'));
const Boards = lazy(() => import('./Boards'));
const Opportunities = lazy(() => import('./Opportunities'));
const Library = lazy(() => import('./Library'));
const Outreach = lazy(() => import('./Outreach'));
const Locations = lazy(() => import('./Locations'));

export type StudioTab = 'board' | 'music' | 'calendar' | 'locations' | 'boards' | 'opportunities' | 'outreach' | 'library';
type Desk = 'board' | 'music' | 'shoots';
const DESKS: [Desk, string][] = [
  ['board', 'Board'],
  ['music', 'Music'],
  ['shoots', 'Shoots'],
];
// Each desk: its main part, then the folded sections under it
const PARTS: Record<Desk, { main: StudioTab; sections: [StudioTab, string][] }> = {
  board: {
    main: 'board',
    sections: [
      ['calendar', 'Calendar'],
      ['boards', 'To-dos'],
      ['opportunities', 'Leads: opportunities (grants, calls, gigs)'],
      ['outreach', 'Leads: outreach (who we pitch)'],
    ],
  },
  music: { main: 'music', sections: [['library', 'Library (books, Renaissance Radio, archive)']] },
  shoots: { main: 'locations', sections: [] },
};
const deskOf = (t: StudioTab): Desk =>
  (Object.keys(PARTS) as Desk[]).find((d) => PARTS[d].main === t || PARTS[d].sections.some(([id]) => id === t))!;

const part = (id: StudioTab) =>
  id === 'board' ? (
    <OpsBoard />
  ) : id === 'music' ? (
    <Tracks />
  ) : id === 'calendar' ? (
    <Timeline />
  ) : id === 'locations' ? (
    <Locations />
  ) : id === 'boards' ? (
    <Boards kind="kanban" />
  ) : id === 'opportunities' ? (
    <Opportunities />
  ) : id === 'outreach' ? (
    <Outreach />
  ) : (
    <Library />
  );

/** Opens Studio on a tab (switching the tab if Studio is already open). */
export function openStudio(openWindow: ReturnType<typeof useWindowManager.getState>['openWindow'], tab: StudioTab = 'calendar') {
  window.dispatchEvent(new CustomEvent('sk:studio-tab', { detail: tab }));
  openWindow({
    id: 'studio',
    title: 'Operations',
    icon: '/images/icons/media-player-16x16.png?v=2',
    appType: 'studio',
    appProps: { tab },
    width: 960,
    height: 620,
  });
}

/** Opens Studio on Music: the team's music projects (releases, songs, bounces). */
export const openMusic = (openWindow: ReturnType<typeof useWindowManager.getState>['openWindow']) => openStudio(openWindow, 'music');

const Studio: React.FC<{ tab?: StudioTab }> = ({ tab = 'calendar' }) => {
  const [desk, setDesk] = useState<Desk>(deskOf(tab));
  const [unfolded, setUnfolded] = useState<Set<StudioTab>>(new Set([tab]));
  const [seen, setSeen] = useState<Set<Desk>>(new Set([deskOf(tab)]));
  const refs = useRef<Partial<Record<StudioTab, HTMLDetailsElement | null>>>({});
  const show = (t: StudioTab) => {
    const d = deskOf(t);
    setDesk(d);
    setSeen((o) => new Set(o).add(d));
    if (PARTS[d].main !== t) {
      setUnfolded((o) => new Set(o).add(t));
      setTimeout(() => refs.current[t]?.scrollIntoView({ block: 'start' }), 50);
    }
  };
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<StudioTab>).detail);
    window.addEventListener('sk:studio-tab', on);
    return () => window.removeEventListener('sk:studio-tab', on);
  }, []);
  const fold = (t: StudioTab, open: boolean) =>
    setUnfolded((o) => {
      const n = new Set(o);
      if (open) n.add(t);
      else n.delete(t);
      return n;
    });
  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0' }}>
        {DESKS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => show(PARTS[id].main)}
            style={{ ...button, fontWeight: desk === id ? 700 : 400, position: 'relative', top: desk === id ? 1 : 0 }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid #fff', display: 'flex' }}>
        <Suspense fallback={<div style={{ padding: 12 }}>Loading...</div>}>
          {DESKS.map(
            ([d]) =>
              seen.has(d) && (
                <div key={d} style={{ flex: 1, minWidth: 0, overflow: 'auto', display: desk === d ? 'block' : 'none' }}>
                  <div style={{ height: d === 'board' ? 'auto' : '100%', display: 'flex', flexDirection: 'column' }}>
                    {part(PARTS[d].main)}
                  </div>
                  {PARTS[d].sections.map(([id, label]) => (
                    <details
                      key={id}
                      ref={(el) => {
                        refs.current[id] = el;
                      }}
                      open={unfolded.has(id)}
                      onToggle={(e) => fold(id, (e.currentTarget as HTMLDetailsElement).open)}
                      style={{ borderTop: '1px solid currentColor' }}
                    >
                      <summary style={{ padding: '4px 6px', fontWeight: 700, cursor: 'pointer' }}>{label}</summary>
                      {unfolded.has(id) && (
                        <div style={{ height: 'min(560px, 80vh)', display: 'flex', flexDirection: 'column' }}>{part(id)}</div>
                      )}
                    </details>
                  ))}
                </div>
              ),
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default Studio;
