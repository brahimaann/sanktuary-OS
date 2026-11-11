import React, { lazy, Suspense, useState } from 'react';
import { button, shell } from './fileTypes';

// Darkroom workspace: assets and review in one window. Photos (the Darkroom editor), SANKTUARY RAW, the video
// editor, Team Files, moodboards and notes. Each tab is the full app it replaces; a tab stays loaded once opened,
// so switching back keeps what you were doing. Opening a single photo from a file still opens the plain editor.
const Darkroom = lazy(() => import('./Darkroom'));
const VideoEditor = lazy(() => import('./VideoEditor'));
const Network = lazy(() => import('./Network'));
const Boards = lazy(() => import('./Boards'));
const Notepad = lazy(() => import('./Notepad'));

export type DarkroomTab = 'photos' | 'raw' | 'video' | 'files' | 'moodboards' | 'notes';
const TABS: [DarkroomTab, string][] = [
  ['photos', 'Photos'],
  ['raw', 'RAW'],
  ['video', 'Video'],
  ['files', 'Team Files'],
  ['moodboards', 'Moodboards'],
  ['notes', 'Notes'],
];

const pane = (id: DarkroomTab) =>
  id === 'photos' ? (
    <Darkroom />
  ) : id === 'raw' ? (
    <iframe src="/apps/rapidraw/" title="SANKTUARY RAW" className="w-full h-full border-none bg-white" />
  ) : id === 'video' ? (
    <VideoEditor />
  ) : id === 'files' ? (
    <Network />
  ) : id === 'moodboards' ? (
    <Boards />
  ) : (
    <Notepad />
  );

const DarkroomWorkspace: React.FC<{ tab?: DarkroomTab }> = ({ tab = 'photos' }) => {
  const [active, setActive] = useState<DarkroomTab>(tab);
  const [opened, setOpened] = useState<Set<DarkroomTab>>(new Set([tab]));
  const show = (t: DarkroomTab) => {
    setActive(t);
    setOpened((o) => new Set(o).add(t));
  };
  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0', flexWrap: 'wrap' }}>
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
                  {pane(id)}
                </div>
              ),
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default DarkroomWorkspace;
