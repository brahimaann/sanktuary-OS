import { create } from 'zustand';
import sound from '../utils/sound';

export type AppType =
  | 'notepad'
  | 'calculator'
  | 'soundrec'
  | 'explorer'
  | 'iframe'
  | 'internet-explorer'
  | 'display-properties'
  | 'webradio'
  | 'pokemon'
  | 'pong'
  | 'africaonly'
  | 'video-folder'
  | 'video-player'
  | 'ppls-story'
  | 'ppls-thread-viewer'
  | 'ppls-local-echo'
  | 'winamp'
  | 'team-files'
  | 'file-preview'
  | 'network'
  | 'admin'
  | 'boards'
  | 'canvas'
  | 'teams'
  | 'chat'
  | 'profile'
  | 'planner'
  | 'tracks'
  | 'timeline'
  | 'business'
  | 'welcome'
  | 'new';

export interface WindowInstance {
  id: string;
  title: string;
  icon?: string;
  appType: AppType;
  appProps?: any;
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isMinimized: boolean;
  zIndex: number;
  focused: boolean;
}

export type ScreensaverType = 'starfield' | 'none';

interface WindowManagerState {
  windows: WindowInstance[];
  maxZIndex: number;
  startMenuOpen: boolean;

  openWindow: (
    spec: Omit<WindowInstance, 'x' | 'y' | 'width' | 'height' | 'isMaximized' | 'isMinimized' | 'zIndex' | 'focused'> &
      Partial<WindowInstance>,
  ) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowPosition: (id: string, x: number, y: number) => void;
  updateWindowSize: (id: string, width: number, height: number) => void;
  setStartMenuOpen: (open: boolean) => void;
  wallpaper: string;
  bgColor: string;
  setWallpaper: (wp: string) => void;
  setBgColor: (color: string) => void;
  screensaver: ScreensaverType;
  screensaverTimeout: number;
  isScreensaverActive: boolean;
  setScreensaver: (s: ScreensaverType) => void;
  setScreensaverTimeout: (mins: number) => void;
  setScreensaverActive: (active: boolean) => void;
}

export const useWindowManager = create<WindowManagerState>((set) => ({
  windows: [],
  maxZIndex: 100,
  startMenuOpen: false,

  openWindow: (spec) =>
    set((state) => {
      sound.playClick();
      const existing = state.windows.find((w) => w.id === spec.id);
      if (existing) {
        const nextZ = state.maxZIndex + 1;
        const updated = state.windows.map((w) =>
          w.id === spec.id ? { ...w, isMinimized: false, focused: true, zIndex: nextZ } : { ...w, focused: false },
        );
        return { windows: updated, maxZIndex: nextZ, startMenuOpen: false };
      }

      // Get active desktop dimensions dynamically
      const desktopEl = typeof document !== 'undefined' ? document.querySelector('.crt-screen-content') : null;
      const desktopWidth = desktopEl ? desktopEl.clientWidth : typeof window !== 'undefined' ? window.innerWidth * 0.88 : 800;
      const desktopHeight = desktopEl ? desktopEl.clientHeight : typeof window !== 'undefined' ? window.innerHeight * 0.85 : 600;

      let computedWidth = spec.width || 400;
      let computedHeight = spec.height || 300;

      // Apply relative scaling rules based on appType / id
      if (spec.appType === 'notepad') {
        computedWidth = Math.max(320, Math.round(desktopWidth * 0.65));
        computedHeight = Math.max(240, Math.round(desktopHeight * 0.6));
      } else if (spec.appType === 'canvas' || spec.appType === 'planner' || spec.appType === 'tracks' || spec.appType === 'timeline') {
        computedWidth = Math.max(600, Math.round(desktopWidth * 0.9));
        computedHeight = Math.max(420, Math.round(desktopHeight * 0.85));
      } else if (spec.appType === 'explorer' || spec.appType === 'team-files') {
        computedWidth = Math.max(400, Math.round(desktopWidth * 0.75));
        computedHeight = Math.max(300, Math.round(desktopHeight * 0.65));
      } else if (spec.id === 'paint') {
        computedWidth = Math.max(500, Math.round(desktopWidth * 0.82));
        computedHeight = Math.max(400, Math.round(desktopHeight * 0.75));
      } else if (spec.id === 'winamp') {
        computedWidth = 275;
        computedHeight = 348;
      } else if (spec.appType === 'pokemon') {
        computedWidth = Math.min(520, Math.round(desktopWidth * 0.65));
        computedHeight = Math.min(520, Math.round(desktopHeight * 0.8));
      } else if (spec.appType === 'calculator') {
        computedWidth = 260;
        computedHeight = 260;
      } else if (spec.appType === 'soundrec') {
        computedWidth = 280;
        computedHeight = 160;
      } else if (spec.id === 'solitaire') {
        computedWidth = 585;
        computedHeight = 410;
      } else if (spec.id === 'minesweeper') {
        computedWidth = 280;
        computedHeight = 345;
      } else if (spec.id === 'msdos') {
        computedWidth = Math.max(400, Math.round(desktopWidth * 0.7));
        computedHeight = Math.max(300, Math.round(desktopHeight * 0.6));
      } else if (spec.appType === 'ppls-story') {
        computedWidth = Math.max(600, Math.round(desktopWidth * 0.8));
        computedHeight = Math.max(450, Math.round(desktopHeight * 0.82));
      } else if (spec.appType === 'ppls-thread-viewer') {
        computedWidth = Math.max(420, Math.round(desktopWidth * 0.5));
        computedHeight = Math.max(320, Math.round(desktopHeight * 0.55));
      } else if (spec.appType === 'internet-explorer') {
        computedWidth = Math.max(700, Math.round(desktopWidth * 0.85));
        computedHeight = Math.max(480, Math.round(desktopHeight * 0.82));
      } else if (spec.appType === 'ppls-local-echo') {
        computedWidth = 460;
        computedHeight = 350;
      } else {
        // General fallback
        if (computedWidth > desktopWidth * 0.9) {
          computedWidth = Math.round(desktopWidth * 0.85);
        }
        if (computedHeight > desktopHeight * 0.9) {
          computedHeight = Math.round(desktopHeight * 0.8);
        }
      }

      // Ensure computed size never exceeds desktop boundaries
      if (computedWidth > desktopWidth) {
        computedWidth = Math.round(desktopWidth * 0.95);
      }
      if (computedHeight > desktopHeight) {
        computedHeight = Math.round(desktopHeight * 0.9);
      }

      // Compute cascaded initial position (x, y) relative to screen center
      const offsetX = (state.windows.length * 25) % 125;
      const offsetY = (state.windows.length * 25) % 125;
      const x = Math.max(10, Math.round((desktopWidth - computedWidth) / 2) + offsetX - 50);
      const y = Math.max(10, Math.round((desktopHeight - computedHeight) / 2) + offsetY - 50);

      const nextZ = state.maxZIndex + 1;
      const newWindow: WindowInstance = {
        id: spec.id,
        title: spec.title,
        icon: spec.icon,
        appType: spec.appType,
        appProps: spec.appProps || {},
        x,
        y,
        width: computedWidth,
        height: computedHeight,
        isMaximized: spec.isMaximized ?? desktopWidth < 600, // phones: every window opens full-screen
        isMinimized: spec.isMinimized ?? false,
        zIndex: nextZ,
        focused: true,
      };

      const updated = state.windows.map((w) => ({ ...w, focused: false }));
      return {
        windows: [...updated, newWindow],
        maxZIndex: nextZ,
        startMenuOpen: false,
      };
    }),

  closeWindow: (id) =>
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    })),

  focusWindow: (id) =>
    set((state) => {
      // If the window is already active/focused and not minimized, do nothing
      const current = state.windows.find((w) => w.id === id);
      if (current && current.focused && !current.isMinimized) {
        return {};
      }

      const nextZ = state.maxZIndex + 1;
      return {
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, focused: true, isMinimized: false, zIndex: nextZ } : { ...w, focused: false },
        ),
        maxZIndex: nextZ,
      };
    }),

  minimizeWindow: (id) =>
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, isMinimized: true, focused: false } : w)),
    })),

  maximizeWindow: (id) =>
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w)),
    })),

  updateWindowPosition: (id, x, y) =>
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
    })),

  updateWindowSize: (id, width, height) =>
    set((state) => ({
      windows: state.windows.map((w) => (w.id === id ? { ...w, width, height } : w)),
    })),

  setStartMenuOpen: (open) => set({ startMenuOpen: open }),
  wallpaper: '/images/custom-wallpaper.png',
  bgColor: '#008080',
  setWallpaper: (wp) => set({ wallpaper: wp }),
  setBgColor: (color) => set({ bgColor: color }),
  // 3D Pipes was retired: anyone who had it gets the starfield
  screensaver: (typeof localStorage !== 'undefined' && localStorage.getItem('hq_os_screensaver') === 'none' ? 'none' : 'starfield') as ScreensaverType,
  screensaverTimeout:
    typeof localStorage !== 'undefined' && localStorage.getItem('hq_os_screensaver_timeout')
      ? Number(localStorage.getItem('hq_os_screensaver_timeout'))
      : 2,
  isScreensaverActive: false,
  setScreensaver: (s) => {
    try {
      localStorage.setItem('hq_os_screensaver', s);
    } catch (_) {}
    set({ screensaver: s });
  },
  setScreensaverTimeout: (mins) => {
    try {
      localStorage.setItem('hq_os_screensaver_timeout', String(mins));
    } catch (_) {}
    set({ screensaverTimeout: mins });
  },
  setScreensaverActive: (active) => set({ isScreensaverActive: active }),
}));
