import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useWindowManager } from '../wm/manager';
import { button, shell } from './fileTypes';

// Operations (the Studio window): Music (songs, bounces, beat handoff, All songs status), the calendar (Timeline), shoot locations, to-do boards (Planner),
// opportunities (grants, calls, gigs), outreach and the Library (books, Renaissance Radio, our archive) in one window.
// Each tab is the full app it replaces; a tab stays loaded once opened, so switching back keeps what you were doing.
const Tracks = lazy(() => import('./Tracks'));
const Timeline = lazy(() => import('./Timeline'));
const Boards = lazy(() => import('./Boards'));
const Opportunities = lazy(() => import('./Opportunities'));
const Library = lazy(() => import('./Library'));
const Outreach = lazy(() => import('./Outreach'));
const Locations = lazy(() => import('./Locations'));

export type StudioTab = 'music' | 'calendar' | 'locations' | 'boards' | 'opportunities' | 'outreach' | 'library';
const TABS: [StudioTab, string][] = [
  ['music', 'Music'],
  ['calendar', 'Calendar'],
  ['locations', 'Locations'],
  ['boards', 'Planner'],
  ['opportunities', 'Opportunities'],
  ['outreach', 'Outreach'],
  ['library', 'Library'],
];

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '4px 4px 0' }}>
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
                  {id === 'music' ? (
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
