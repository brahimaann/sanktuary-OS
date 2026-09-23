import React from 'react';

// Hand-drawn 24x24 stroke icons from Retro.Icons (https://retro-svg.vercel.app, by vetrisuriya.in, MIT licence).
// Used for actions on buttons (back, upload, share...); files, folders and desktop apps keep their Win98 pixel icons.
// "pause" and "stop" aren't in that set and were drawn here in the same style.
const PATHS = {
  back: '<path d="M20 12H4"/><path d="M10.5 5.5L4 12l6.5 6.5"/>',
  forward: '<path d="M4 12h16"/><path d="M13.5 5.5L20 12l-6.5 6.5"/>',
  up: '<path d="M12 20V4"/><path d="M5.5 10.5L12 4l6.5 6.5"/>',
  down: '<path d="M12 4v16"/><path d="M5.5 13.5L12 20l6.5-6.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3.5V8h-4.5"/>',
  upload: '<path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/><path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/>',
  download: '<path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/><path d="M12 4v11"/><path d="M7.5 11L12 15.5 16.5 11"/>',
  share:
    '<circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.8 10.8l6.4-4M8.8 13.2l6.4 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none"/><path d="M12 16v1.5"/>',
  key: '<circle cx="8" cy="14" r="4.5"/><path d="M11.5 10.5L20 2"/><path d="M16.5 5.5l2.5 2.5M14 8l2 2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 16Z"/><path d="M10 21a2 2 0 0 0 4 0"/><path d="M18.5 4l1 1M20.5 4l-1 1"/>',
  chat: '<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4V6.5a1 1 0 0 1 1-1Z"/><path d="M8 10h8M8 12.5h5"/>',
  external: '<path d="M9 5H5v14h14v-4"/><path d="M13 5h6v6"/><path d="M19 5l-9 9"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  logout: '<path d="M9 4H5v16h4"/><path d="M10 12h10"/><path d="M16.5 8.5L20 12l-3.5 3.5"/>',
  login: '<path d="M15 4h4v16h-4"/><path d="M4 12h10"/><path d="M10.5 8.5L14 12l-3.5 3.5"/>',
  play: '<path d="M7 4.5v15L19.5 12 7 4.5Z" fill="currentColor"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14" stroke-width="3.2"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor"/>',
  undo: '<path d="M8 5L4 9l4 4"/><path d="M4 9h9a6 6 0 0 1 0 12h-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  archive: '<rect x="3" y="4.5" width="18" height="5" rx="1.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 13h4"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v4M16 3v4"/><path d="M7.5 13.5h3M7.5 16.5h6"/>',
  note: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="15" r="3"/><path d="M10 17V7l10-2v10"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** A Retro.Icons glyph in the current text colour. Greyed out automatically on disabled buttons (see system.css). */
const RetroIcon: React.FC<{ name: IconName; size?: number; title?: string }> = ({ name, size = 14, title }) => (
  <svg
    className="retro-icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={title ? undefined : true}
    role={title ? 'img' : undefined}
    dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + PATHS[name] }}
  />
);

/** Icon + label, the way Win98 toolbars pair them. */
export const IconLabel: React.FC<{ icon: IconName; children?: React.ReactNode }> = ({ icon, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <RetroIcon name={icon} />
    {children}
  </span>
);

export default RetroIcon;
