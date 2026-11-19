import type { useWindowManager } from '../wm/manager';

/** Open one song's page in Music (now, or when Music next opens), e.g. from the Operations board or the calendar. */
let wish: { release: string; track?: string } | null = null;
export const showSong = (release: string, track?: string) => {
  wish = { release, track };
  window.dispatchEvent(new Event('sk:tracks-song'));
};
export const takeSongWish = () => {
  const w = wish;
  wish = null;
  return w;
};

/** The window spec that opens a plan (Planner board): from the calendar or the Board. */
export const planWindow = (id: string, name: string) => ({
  id: `planner-${id}`,
  title: name,
  icon: '/images/icons/task-16x16.png?v=2',
  appType: 'planner' as const,
  appProps: { boardId: id },
  width: 1000,
  height: 640,
});

/** Open one calendar entry (now, or when the calendar next opens), e.g. from a lamp on the Board. */
let entryWish: string | null = null;
export const showEntry = (id: string) => {
  entryWish = id;
  window.dispatchEvent(new CustomEvent('sk:timeline-entry', { detail: id }));
};
export const takeEntryWish = () => {
  const w = entryWish;
  entryWish = null;
  return w;
};

/** Open Foundry on a song's recording session: its latest one, or a new one tied to the song (from the song page or Files). */
let sessionWish: string | null = null;
export const openSession = (openWindow: ReturnType<typeof useWindowManager.getState>['openWindow'], track: string) => {
  sessionWish = track;
  window.dispatchEvent(new Event('sk:foundry-song'));
  openWindow({
    id: 'producer',
    title: 'Foundry',
    icon: '/images/icons/convert-audio-16x16.png?v=2',
    appType: 'producer',
    width: 960,
    height: 620,
  });
};
export const takeSessionWish = () => {
  const w = sessionWish;
  sessionWish = null;
  return w;
};
