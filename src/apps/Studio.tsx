import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useWindowManager } from '../wm/manager';
import { button, shell } from './TeamFiles';

// Studio: songs (Tracks), the calendar (Timeline), to-do boards (Planner) and opportunities (grants, calls, gigs)
// in one window. Each tab is the
// full app it replaces; a tab stays loaded once opened, so switching back keeps what you were doing.
const Tracks = lazy(() => import('./Tracks'));
const Timeline = lazy(() => import('./Timeline'));
const Boards = lazy(() => import('./Boards'));
const Opportunities = lazy(() => import('./Opportunities'));

export type StudioTab = 'songs' | 'calendar' | 'boards' | 'opportunities';
const TABS: [StudioTab, string][] = [
  ['songs', 'Songs'],
  ['calendar', 'Calendar'],
  ['boards', 'Boards'],
  ['opportunities', 'Opportunities'],
];

/** Opens Studio on a tab (switching the tab if Studio is already open). */
export function openStudio(openWindow: ReturnType<typeof useWindowManager.getState>['openWindow'], tab: StudioTab = 'songs') {
  window.dispatchEvent(new CustomEvent('sk:studio-tab', { detail: tab }));
  openWindow({
    id: 'studio',
    title: 'Studio',
    icon: '/images/icons/media-player-16x16.png',
    appType: 'studio',
    appProps: { tab },
    width: 960,
    height: 620,
  });
}

const Studio: React.FC<{ tab?: StudioTab }> = ({ tab = 'songs' }) => {
  const [active, setActive] = useState<StudioTab>(tab);
  const [opened, setOpened] = useState<Set<StudioTab>>(new Set([tab]));
  const show = (t: StudioTab) => {
    setActive(t);
    setOpened((o) => new Set(o).add(t));
  };
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<StudioTab>).detail);
    window.addEventListener('sk:studio-tab', on);
    return () => window.removeEventListener('sk:studio-tab', on);
  }, []);
  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0' }}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => show(id)}
            style={{ ...button, fontWeight: active === id ? 700 : 400, position: 'relative', top: active === id ? 1 : 0 }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid #fff', display: 'flex' }}>
        <Suspense fallback={<div style={{ padding: 12 }}>Loading...</div>}>
          {TABS.map(
            ([id]) =>
              opened.has(id) && (
                <div key={id} style={{ flex: 1, minWidth: 0, display: active === id ? 'flex' : 'none', flexDirection: 'column' }}>
                  {id === 'songs' ? (
                    <Tracks />
                  ) : id === 'calendar' ? (
                    <Timeline />
                  ) : id === 'boards' ? (
                    <Boards kind="kanban" />
                  ) : (
                    <Opportunities />
                  )}
                </div>
              ),
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default Studio;
