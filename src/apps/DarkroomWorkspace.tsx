import React, { lazy, Suspense, useState } from 'react';
import { button, shell } from './fileTypes';

// Darkroom is editing only, as tabs: Photos (the Darkroom editor, whose RAW... button opens SANKTUARY RAW in place) and Video. A tab stays loaded once
// opened, so switching back keeps what you were doing. Opening a single photo from a file still opens the plain editor.
// Files has no tabs: one place list (Moodboards, Notes, then every team space); Moodboards and Notes open in the same
// window with a Back button, and stay loaded once opened.
const Darkroom = lazy(() => import('./Darkroom'));
const VideoEditor = lazy(() => import('./VideoEditor'));
const Network = lazy(() => import('./Network'));
const Boards = lazy(() => import('./Boards'));
const Notepad = lazy(() => import('./Notepad'));

export type DarkroomTab = 'photos' | 'raw' | 'video' | 'files' | 'moodboards' | 'notes';
const SETS: Record<'edit', [DarkroomTab, string][]> = {
  edit: [
    ['photos', 'Photos'],
    ['video', 'Video'],
  ],
};

const pane = (id: DarkroomTab, onRaw?: () => void) =>
  id === 'photos' ? (
    <Darkroom onRaw={onRaw} />
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

const I = (n: string) => `/images/icons/${n}-32x32.png?v=2`;

/** The Files window: places, not tabs. */
const FilesHome: React.FC<{ tab?: DarkroomTab }> = ({ tab }) => {
  const start = tab === 'moodboards' || tab === 'notes' ? tab : 'files';
  const [here, setHere] = useState<DarkroomTab>(start);
  const [opened, setOpened] = useState<Set<DarkroomTab>>(new Set([start]));
  const go = (t: DarkroomTab) => {
    setHere(t);
    setOpened((o) => new Set(o).add(t));
  };
  const name = here === 'moodboards' ? 'Moodboards' : 'Notes';
  return (
    <div style={shell}>
      {here !== 'files' && (
        <div style={{ display: 'flex', gap: 6, padding: 4, alignItems: 'center', justifyContent: 'flex-start' }}>
          <button style={button} onClick={() => setHere('files')} title="Back to Files">
            ← Files
          </button>
          <b>{name}</b>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Suspense fallback={<div style={{ padding: 12 }}>Loading...</div>}>
          {(['files', 'moodboards', 'notes'] as DarkroomTab[]).map(
            (id) =>
              opened.has(id) && (
                <div key={id} style={{ flex: 1, minWidth: 0, display: here === id ? 'flex' : 'none', flexDirection: 'column' }}>
                  {id === 'files' ? (
                    <Network
                      extras={[
                        { name: 'Moodboards', sub: 'Pictures, songs and notes on a wall', icon: I('paint'), open: () => go('moodboards') },
                        { name: 'Notes', sub: 'Your notes, saved to your account', icon: I('notepad'), open: () => go('notes') },
                      ]}
                    />
                  ) : (
                    pane(id)
                  )}
                </div>
              ),
          )}
        </Suspense>
      </div>
    </div>
  );
};

const DarkroomWorkspace: React.FC<{ set?: 'edit' | 'files'; tab?: DarkroomTab }> = ({ set = 'edit', tab }) => {
  if (set === 'files') return <FilesHome tab={tab} />;
  return <EditTabs tab={tab} />;
};

const EditTabs: React.FC<{ tab?: DarkroomTab }> = ({ tab }) => {
  const set = 'edit';
  const TABS = SETS[set];
  tab = tab || TABS[0][0];
  const [active, setActive] = useState<DarkroomTab>(tab);
  const [opened, setOpened] = useState<Set<DarkroomTab>>(new Set([tab]));
  const show = (t: DarkroomTab) => {
    setActive(t);
    setOpened((o) => new Set(o).add(t));
  };
  // RAW is part of Photos: the Photos tab stays lit while the RAW engine is open
  const on = (id: DarkroomTab) => active === id || (id === 'photos' && active === 'raw');
  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0', flexWrap: 'wrap' }}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => show(id)}
            style={{ ...button, fontWeight: on(id) ? 700 : 400, position: 'relative', top: on(id) ? 1 : 0 }}
          >
            {label}
          </button>
        ))}
        {active === 'raw' && (
          <>
            <button style={{ ...button, marginLeft: 8 }} onClick={() => show('photos')} title="Back to the Photos editor">
              ← Photos
            </button>
            <b style={{ alignSelf: 'center', marginLeft: 4 }}>RAW</b>
          </>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid #fff', display: 'flex' }}>
        <Suspense fallback={<div style={{ padding: 12 }}>Loading...</div>}>
          {(['photos', 'raw', 'video'] as DarkroomTab[]).map(
            (id) =>
              opened.has(id) && (
                <div key={id} style={{ flex: 1, minWidth: 0, display: active === id ? 'flex' : 'none', flexDirection: 'column' }}>
                  {pane(id, () => show('raw'))}
                </div>
              ),
          )}
        </Suspense>
      </div>
    </div>
  );
};

export default DarkroomWorkspace;
