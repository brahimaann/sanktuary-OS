import { useWindowManager } from '../wm/manager';

// One list of songs, reached from every window: Files (a song's file), Operations > Music (the song's page) and
// Foundry (its recording sessions). A window that isn't open yet picks its wish up when it mounts.
type Open = ReturnType<typeof useWindowManager.getState>['openWindow'];
let wantSong: string | null = null;
let wantSession: string | null = null;
const take = (which: 'song' | 'session') => {
  const w = which === 'song' ? wantSong : wantSession;
  if (which === 'song') wantSong = null;
  else wantSession = null;
  return w;
};
export const takeSongWish = () => take('song');
export const takeSessionWish = () => take('session');

/** Opens a song's page in Operations > Music. */
export function openSong(openWindow: Open, trackId: string) {
  wantSong = trackId;
  window.dispatchEvent(new CustomEvent('sk:studio-tab', { detail: 'music' }));
  window.dispatchEvent(new Event('sk:open-song'));
  openWindow({
    id: 'studio',
    title: 'Operations',
    icon: '/images/icons/media-player-16x16.png?v=2',
    appType: 'studio',
    appProps: { tab: 'music' },
    width: 960,
    height: 620,
  });
}

/** Opens Foundry on a song's recording session (its latest one, or a new one). */
export function openSession(openWindow: Open, trackId: string) {
  wantSession = trackId;
  window.dispatchEvent(new Event('sk:foundry-song'));
  openWindow({
    id: 'producer',
    title: 'Foundry',
    icon: '/images/icons/convert-audio-16x16.png?v=2',
    appType: 'producer',
    width: 960,
    height: 620,
  });
}
