/** Dark (default) or White. The whole OS is 1-bit, so dark is the same screen inverted (see html[data-theme='dark'] in system.css). */
export type Theme = 'dark' | 'white';
const KEY = 'sk:theme';

export const getTheme = (): Theme => (document.documentElement.dataset.theme === 'white' ? 'white' : 'dark');

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode: still switches for this visit */
  }
  window.dispatchEvent(new Event('sk-theme'));
}
