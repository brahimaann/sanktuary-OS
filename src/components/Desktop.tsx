import React, { useState, useEffect, useRef } from 'react';
import { useWindowManager, AppType } from '../wm/manager';
import { vfs } from '../vfs/fs';
import { useMe } from '../utils/api';
import { useAuth } from '@clerk/react';
import { startLive } from '../utils/live';
import { dialog } from '../utils/dialog';

type Cell = [col: number, row: number];
const GRID = 82; // Win98 desktop spacing
const PAD = 16;
const toPx = ([c, r]: Cell) => ({ x: PAD + c * GRID, y: PAD + r * GRID });

interface DesktopIconDef {
  id: string;
  title: string;
  icon: string;
  appType: AppType;
  appProps?: any;
  width?: number;
  height?: number;
}

// Studio apps: members only, so visitors aren't shown doors they can't open. First column when logged on.
const STUDIO_ICONS: DesktopIconDef[] = [
  { id: 'new', title: 'New...', icon: '/images/icons/file-32x32.png', appType: 'new', width: 460, height: 420 },
  { id: 'sanktuary-network', title: 'Team Files', icon: '/images/icons/network-32x32.png', appType: 'network', width: 560, height: 420 },
  // Studio: songs (Tracks), calendar (Timeline) and to-do boards (Planner) in one window
  {
    id: 'studio',
    title: 'Studio',
    icon: '/images/icons/media-player-32x32.png',
    appType: 'studio',
    appProps: { tab: 'songs' },
    width: 960,
    height: 620,
  },
  { id: 'moodboards', title: 'Moodboards', icon: '/images/icons/paint-32x32.png', appType: 'boards', width: 560, height: 420 },
  { id: 'teams', title: 'Messages', icon: '/images/icons/outlook-express-32x32.png', appType: 'teams', width: 300, height: 520 },
];

// The front door: works without an account (Shop and Blog are the same pages as sanktuary.studio/shop and /blog)
const PUBLIC_ICONS: DesktopIconDef[] = [
  { id: 'welcome', title: 'Welcome', icon: '/images/icons/help-32x32.png', appType: 'welcome', width: 520, height: 560 },
  {
    id: 'my-computer',
    title: 'My Computer',
    icon: '/images/icons/my-computer-32x32.png',
    appType: 'directory', // the public directory: people, releases, events, writing, shop
    width: 680,
    height: 500,
  },
  { id: 'producer', title: 'Producer', icon: '/images/icons/convert-audio-32x32.png', appType: 'producer', width: 720, height: 560 },
  {
    id: 'blog',
    title: 'Blog',
    icon: '/images/icons/news-32x32.png',
    appType: 'iframe',
    appProps: { src: '/blog' },
    width: 760,
    height: 560,
  },
  {
    id: 'shop',
    title: 'Shop',
    icon: '/images/icons/favorites-32x32.png',
    appType: 'iframe',
    appProps: { src: '/shop' },
    width: 760,
    height: 560,
  },
];

// Visitors: the way in for members
const LOG_ON_ICON: DesktopIconDef = {
  id: 'profile-me',
  title: 'Log On',
  icon: '/images/icons/logoff-32x32.png',
  appType: 'profile',
  width: 420,
  height: 520,
};

// Extras and games, last
const EXTRA_ICONS: DesktopIconDef[] = [
  {
    id: 'ie',
    title: 'Internet Explorer',
    icon: '/images/icons/internet-explorer-32x32.png',
    appType: 'internet-explorer',
    appProps: { src: 'https://en.m.wikipedia.org/wiki/African_history' },
    width: 900,
    height: 640,
  },
  { id: 'africaonly', title: 'AfricaOnly.TV', icon: '/images/icons/video-32x32.png', appType: 'africaonly', width: 900, height: 620 },
  { id: 'notepad', title: 'Notepad', icon: '/images/icons/notepad-32x32.png', appType: 'notepad', width: 480, height: 360 },
  { id: 'pong', title: 'Pong', icon: '/images/icons/pinball-32x32.png', appType: 'pong', width: 520, height: 380 },
  {
    id: 'recycle',
    title: 'Recycle Bin',
    icon: '/images/icons/recycle-bin-32x32.png',
    appType: 'explorer',
    appProps: { path: 'C:/Recycled' },
    width: 640,
    height: 480,
  },
];

// Only shown to admins (see useMe)
// Admins only too; the server additionally requires two-step verification
const BUSINESS_ICON: DesktopIconDef = {
  id: 'business',
  title: 'Business',
  icon: '/images/icons/my-documents-folder-32x32.png',
  appType: 'business',
  width: 860,
  height: 600,
};

const ADMIN_ICON: DesktopIconDef = {
  id: 'admin-panel',
  title: 'Admin Panel',
  icon: '/images/icons/settings-32x32.png',
  appType: 'admin',
  width: 760,
  height: 540,
};

export const Desktop: React.FC = () => {
  const { openWindow, wallpaper, bgColor } = useWindowManager();
  const { me } = useMe();
  const { isLoaded, isSignedIn } = useAuth();
  // Visitors without an account land on the Welcome window (once per visit)
  useEffect(() => {
    if (!isLoaded || isSignedIn) return;
    try {
      if (sessionStorage.getItem('sk_welcomed')) return;
      sessionStorage.setItem('sk_welcomed', '1');
    } catch {}
    openWindow({
      id: 'welcome',
      title: 'Welcome to Sanktuary',
      icon: '/images/icons/network-16x16.png',
      appType: 'welcome',
      width: 520,
      height: 560,
    });
  }, [isLoaded, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Members: the studio tour opens once, the first time they're logged on in this browser
    if (!isSignedIn) return;
    try {
      if (localStorage.getItem('sk_member_tour')) return;
      localStorage.setItem('sk_member_tour', '1');
    } catch {
      return;
    }
    openWindow({
      id: 'welcome',
      title: 'Welcome to Sanktuary',
      icon: '/images/icons/help-16x16.png',
      appType: 'welcome',
      appProps: { tour: true },
      width: 520,
      height: 560,
    });
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // The service worker makes Sanktuary installable with a place in the phone's share menu (and does push)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Arrived from the share menu: show what was shared and ask where it goes
    const q = new URLSearchParams(location.search);
    if (!q.has('share')) return;
    history.replaceState(null, '', location.pathname);
    openWindow({
      id: 'share-in',
      title: 'Share to Sanktuary',
      icon: '/images/icons/network-16x16.png',
      appType: 'share-in',
      appProps: { missed: q.get('share') === 'missed' },
      width: 440,
      height: 460,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (me) startLive();
  }, [me]);
  const [vfsIcons, setVfsIcons] = useState<DesktopIconDef[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  // Icons sit in grid cells, one icon per cell. Each person's arrangement is kept in this browser (per user).
  const layoutKey = `sk_desktop_${me?.username || 'guest'}`;
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [drag, setDrag] = useState<{ ids: string[]; sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null);

  // Custom right click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean } | null>(null);
  const [iconContextMenu, setIconContextMenu] = useState<{ x: number; y: number; icon: DesktopIconDef } | null>(null);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);

  const desktopRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const loadVfsDesktopFiles = () => {
    try {
      const files = vfs.readdir('C:/Desktop');
      const loaded: DesktopIconDef[] = files.map((file) => {
        const title = file.name;
        const id = `vfs-desktop-${title.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const isTxt = title.endsWith('.txt');
        const icon = isTxt ? '/images/icons/notepad-file-32x32.png' : '/images/icons/folder-32x32.png';
        const appType = isTxt ? 'notepad' : 'explorer';
        const appProps = isTxt ? { filePath: `C:/Desktop/${title}` } : { path: `C:/Desktop/${title}` };
        return {
          id,
          title,
          icon,
          appType,
          appProps,
          width: isTxt ? 480 : 640,
          height: isTxt ? 360 : 480,
        };
      });
      setVfsIcons(loaded);
    } catch (err) {
      console.error('Failed to read C:/Desktop directory:', err);
    }
  };

  // Custom Win98 Confirm Dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    icon?: DesktopIconDef;
    onConfirm: () => void;
  } | null>(null);

  const handleDeleteIcon = (icon: DesktopIconDef) => {
    setIconContextMenu(null);
    setConfirmDialog({
      isOpen: true,
      title: 'Confirm File Delete',
      message: `Are you sure you want to send '${icon.title}' to the Recycle Bin?`,
      icon,
      onConfirm: () => {
        try {
          const path = `C:/Desktop/${icon.title}`;
          if (vfs.exists(path)) {
            const stat = vfs.stat(path);
            if (stat?.isDirectory) {
              vfs.rmdir(path);
            } else {
              vfs.unlink(path);
            }
          }
        } catch (err: any) {
          console.error(err);
        }
        setConfirmDialog(null);
      },
    });
  };

  useEffect(() => {
    loadVfsDesktopFiles();
    const unsubscribe = vfs.subscribe(() => {
      loadVfsDesktopFiles();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedIds.length > 0) {
        const vfsSelected = vfsIcons.filter((icon) => selectedIds.includes(icon.id));
        if (vfsSelected.length > 0) {
          vfsSelected.forEach((icon) => handleDeleteIcon(icon));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, vfsIcons]);

  // Logged on: studio apps first, then the front door (+ admin tools), then extras. Visitors: front door, Log On, extras.
  const allIcons = isSignedIn
    ? [...STUDIO_ICONS, ...PUBLIC_ICONS, ...(me?.admin ? [ADMIN_ICON, BUSINESS_ICON] : []), ...EXTRA_ICONS, ...vfsIcons]
    : [...PUBLIC_ICONS, LOG_ON_ICON, ...EXTRA_ICONS, ...vfsIcons];

  // Marquee Selection Logic / Clicking background
  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;

    // Do not dismiss if clicking inside the context menu
    if (target.closest('.context-menu')) {
      return;
    }

    // Dismiss context menu
    setContextMenu(null);
    setIconContextMenu(null);
    setActiveSubMenu(null);

    if (e.button !== 0) return; // Only left click
    if (target.closest('.desktop-icon') || target.closest('.start-menu') || target.closest('.taskbar')) {
      return;
    }

    const rect = desktopRef.current?.getBoundingClientRect();
    if (!rect) return;

    setSelectedIds([]);
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    setMarquee({ startX, startY, currentX: startX, currentY: startY });

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const currentX = moveEvent.clientX - rect.left;
      const currentY = moveEvent.clientY - rect.top;
      setMarquee((prev) => (prev ? { ...prev, currentX, currentY } : null));

      // Compute intersection
      const x1 = Math.min(startX, currentX);
      const x2 = Math.max(startX, currentX);
      const y1 = Math.min(startY, currentY);
      const y2 = Math.max(startY, currentY);

      const newlySelected: string[] = [];
      allIcons.forEach((icon) => {
        const element = iconRefs.current[icon.id];
        if (element) {
          const elementRect = element.getBoundingClientRect();
          const desktopRect = desktopRef.current!.getBoundingClientRect();
          const elX1 = elementRect.left - desktopRect.left;
          const elX2 = elementRect.right - desktopRect.left;
          const elY1 = elementRect.top - desktopRect.top;
          const elY2 = elementRect.bottom - desktopRect.top;

          // Check overlap
          const overlaps = !(x2 < elX1 || x1 > elX2 || y2 < elY1 || y1 > elY2);
          if (overlaps) {
            newlySelected.push(icon.id);
          }
        }
      });
      setSelectedIds(newlySelected);
    };

    const handlePointerUp = () => {
      setMarquee(null);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  useEffect(() => {
    try {
      setCells(JSON.parse(localStorage.getItem(layoutKey) || '{}'));
    } catch {
      setCells({});
    }
  }, [layoutKey]);

  useEffect(() => {
    const el = desktopRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Where every icon goes: saved cells first (if still on screen and free), then the rest fill the first free
  // cells top-to-bottom, column by column. No two icons ever share a cell.
  const rows = Math.max(1, Math.floor((size.h - PAD - 75) / GRID) + 1);
  const cols = Math.max(1, Math.floor((size.w - PAD - 75) / GRID) + 1);
  const key = ([c, r]: Cell) => `${c},${r}`;
  const layout: Record<string, Cell> = {};
  {
    const taken = new Set<string>();
    for (const { id } of allIcons) {
      const c = cells[id];
      if (Array.isArray(c) && c[0] >= 0 && c[1] >= 0 && c[0] < cols && c[1] < rows && !taken.has(key(c))) {
        layout[id] = [c[0], c[1]];
        taken.add(key(c));
      }
    }
    let n = 0;
    for (const { id } of allIcons) {
      if (layout[id]) continue;
      while (taken.has(key([Math.floor(n / rows), n % rows]))) n++;
      layout[id] = [Math.floor(n / rows), n % rows];
      taken.add(key(layout[id]));
    }
  }

  const saveCells = (next: Record<string, Cell>) => {
    setCells(next);
    try {
      localStorage.setItem(layoutKey, JSON.stringify(next));
    } catch {}
  };

  // Dropped: each moved icon takes the cell under it, or the nearest free one if another icon is there
  const dropIcons = (ids: string[], dx: number, dy: number) => {
    const taken = new Set(allIcons.filter((i) => !ids.includes(i.id)).map((i) => key(layout[i.id])));
    const next = { ...layout };
    const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, v));
    for (const id of ids) {
      const want: Cell = [clamp(Math.round(layout[id][0] + dx / GRID), cols), clamp(Math.round(layout[id][1] + dy / GRID), rows)];
      let best: Cell | null = taken.has(key(want)) ? null : want;
      // ponytail: scans every cell per icon; fine for a desktop's few dozen icons
      let d = best ? 0 : Infinity;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const dist = (i - want[0]) ** 2 + (j - want[1]) ** 2;
          if (dist < d && !taken.has(key([i, j]))) [d, best] = [dist, [i, j]];
        }
      next[id] = best || layout[id]; // screen full: stays where it was
      taken.add(key(next[id]));
    }
    saveCells(next);
  };

  const handleIconPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setContextMenu(null);
    setActiveSubMenu(null);
    if (e.ctrlKey) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
      return;
    }
    // Pressing on a highlighted icon drags the whole highlighted group, like Windows
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    setSelectedIds(ids);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ ids, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false });
  };

  const handleIconPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 4 });
  };

  const handleIconPointerUp = (id: string, e: React.PointerEvent) => {
    if (!drag) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (drag.moved) dropIcons(drag.ids, drag.dx, drag.dy);
    else {
      setSelectedIds([id]); // a plain click on one of several highlighted icons picks just that one
      if (e.pointerType === 'touch') {
        // Phones: a tap opens the icon (double-tap is unreliable on touch screens)
        const iconDef = allIcons.find((i) => i.id === id);
        if (iconDef) handleIconDoubleClick(iconDef);
      }
    }
    setDrag(null);
  };

  const handleIconDoubleClick = (iconDef: DesktopIconDef) => {
    if (iconDef.appType === 'explorer') {
      const path = iconDef.appProps?.path || 'C:/';
      try {
        const contents = vfs.readdir(path);
        if (contents.length === 0) {
          dialog.alert('This folder is empty. Conserving energy by not opening it.');
          return;
        }
      } catch (err) {
        // ignore
      }
    }

    openWindow({
      id: iconDef.id,
      title: iconDef.title,
      appType: iconDef.appType,
      icon: iconDef.icon.replace('-32x32', '-16x16'), // Use small icon for title bar
      appProps: iconDef.appProps || {},
      width: iconDef.width || 400,
      height: iconDef.height || 300,
    });
  };

  // Right click Desktop Menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    if (target.closest('.desktop-icon') || target.closest('.start-menu') || target.closest('.taskbar')) {
      return;
    }
    const rect = desktopRef.current?.getBoundingClientRect();
    if (!rect) return;

    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      visible: true,
    });
  };

  const handleIconContextMenu = (e: React.MouseEvent, icon: DesktopIconDef) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIds([icon.id]);
    setContextMenu(null);
    const rect = desktopRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIconContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      icon,
    });
  };

  const handleCreateNewFolder = () => {
    try {
      let folderName = 'New Folder';
      let i = 1;
      while (vfs.exists(`C:/Desktop/${folderName}`)) {
        i++;
        folderName = `New Folder (${i})`;
      }
      vfs.mkdir(`C:/Desktop/${folderName}`);
    } catch (err) {
      console.error(err);
    }
    setContextMenu(null);
    setActiveSubMenu(null);
  };

  const handleCreateNewTextFile = () => {
    try {
      let fileName = 'New Text Document.txt';
      let i = 1;
      while (vfs.exists(`C:/Desktop/${fileName}`)) {
        i++;
        fileName = `New Text Document (${i}).txt`;
      }
      vfs.writeFile(`C:/Desktop/${fileName}`, '');
    } catch (err) {
      console.error(err);
    }
    setContextMenu(null);
    setActiveSubMenu(null);
  };

  // Drag and Drop File Import
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const text = await file.text();
      vfs.writeFile(`C:/Desktop/${file.name}`, text);
    }
  };

  return (
    <div
      ref={desktopRef}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="desktop folder-view absolute left-0 top-0 w-full h-[calc(100%-30px)] select-none overflow-hidden"
      style={{
        backgroundColor: bgColor,
        backgroundImage: wallpaper ? `url(${wallpaper})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        touchAction: 'none', // Prevents default gestures like pinch-to-zoom on desktop
      }}
      data-view-mode="DESKTOP"
    >
      {allIcons.map((icon) => {
        const isSelected = selectedIds.includes(icon.id);
        const isDragging = !!drag?.moved && drag.ids.includes(icon.id);
        const home = toPx(layout[icon.id]);
        const pos = isDragging ? { x: home.x + drag!.dx, y: home.y + drag!.dy } : home;
        return (
          <div
            key={icon.id}
            ref={(el) => {
              iconRefs.current[icon.id] = el;
            }}
            onPointerDown={(e) => handleIconPointerDown(icon.id, e)}
            onPointerMove={handleIconPointerMove}
            onPointerUp={(e) => handleIconPointerUp(icon.id, e)}
            onDoubleClick={() => handleIconDoubleClick(icon)}
            onContextMenu={(e) => handleIconContextMenu(e, icon)}
            className={`desktop-icon w-[75px] h-[75px] flex flex-col items-center justify-center text-center cursor-default outline-none rounded p-1 ${
              isSelected ? 'focused selected' : ''
            }`}
            style={{
              position: 'absolute',
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              zIndex: isDragging ? 50 : 1,
              opacity: isDragging ? 0.7 : 1,
              touchAction: 'none',
            }}
          >
            <div className="icon-wrapper w-[32px] h-[32px] relative flex justify-center items-center">
              <img src={icon.icon} alt="" className="w-[32px] h-[32px] select-none pointer-events-none image-render-pixelated" />
              <div
                className="selection-effect absolute top-0 left-0 w-[32px] h-[32px] bg-[#000080] opacity-[0.5] rounded"
                style={{
                  display: isSelected ? 'block' : 'none',
                  mixBlendMode: 'color-burn',
                  WebkitMaskImage: `url(${icon.icon})`,
                  maskImage: `url(${icon.icon})`,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                }}
              />
            </div>
            <span
              className="title text-xs mt-1 px-1 text-white select-none break-all"
              style={{
                backgroundColor: isSelected ? '#000080' : 'transparent',
                border: isSelected ? '1px dotted #ffffff' : '1px solid transparent',
                textShadow: isSelected ? 'none' : '1px 1px 0px #000, -1px -1px 0px #000, 1px -1px 0px #000, -1px 1px 0px #000',
              }}
            >
              {icon.title}
            </span>
          </div>
        );
      })}

      {/* Marquee box overlay */}
      {marquee && (
        <div
          className="marquee absolute border border-dotted border-white pointer-events-none z-[9999]"
          style={{
            left: `${Math.min(marquee.startX, marquee.currentX)}px`,
            top: `${Math.min(marquee.startY, marquee.currentY)}px`,
            width: `${Math.abs(marquee.startX - marquee.currentX)}px`,
            height: `${Math.abs(marquee.startY - marquee.currentY)}px`,
            mixBlendMode: 'difference',
          }}
        />
      )}

      {/* Custom Context Menu */}
      {contextMenu && (
        <div
          className="context-menu absolute bg-[#c0c0c0] text-black border-2 border-outset p-[2px] z-[99999] select-none text-[11px] font-sans flex flex-col w-[150px] shadow"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          <div
            onClick={() => {
              saveCells({}); // back to the default order
              setContextMenu(null);
            }}
            className="hover:bg-[#000080] hover:text-white px-3 py-1 cursor-default"
          >
            Arrange Icons
          </div>
          <div className="px-3 py-1 cursor-default text-gray-500 opacity-60">Line Up Icons</div>
          <div onClick={() => window.location.reload()} className="hover:bg-[#000080] hover:text-white px-3 py-1 cursor-default">
            Refresh
          </div>
          <div className="h-[1px] bg-gray-400 my-1"></div>
          <div className="px-3 py-1 cursor-default text-gray-500 opacity-60">Paste</div>
          <div className="px-3 py-1 cursor-default text-gray-500 opacity-60">Paste Shortcut</div>
          <div className="h-[1px] bg-gray-400 my-1"></div>

          {/* Submenu New */}
          <div
            onMouseEnter={() => setActiveSubMenu('new')}
            onMouseLeave={() => setActiveSubMenu(null)}
            className={`px-3 py-1 cursor-default flex justify-between items-center relative ${
              activeSubMenu === 'new' ? 'bg-[#000080] text-white' : 'hover:bg-[#000080] hover:text-white'
            }`}
          >
            <span>New</span>
            <span>▶</span>

            {activeSubMenu === 'new' && (
              <div className="absolute bg-[#c0c0c0] text-black border-2 border-outset p-[2px] left-[144px] -top-1 w-[130px] flex flex-col z-[100000]">
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateNewFolder();
                  }}
                  className="hover:bg-[#000080] hover:text-white px-2 py-1 cursor-default flex items-center gap-2"
                >
                  <img src="/images/icons/folder-16x16.png" className="w-3.5 h-3.5" alt="" />
                  <span>Folder</span>
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateNewTextFile();
                  }}
                  className="hover:bg-[#000080] hover:text-white px-2 py-1 cursor-default flex items-center gap-2"
                >
                  <img src="/images/icons/notepad-16x16.png" className="w-3.5 h-3.5" alt="" />
                  <span>Text Document</span>
                </div>
              </div>
            )}
          </div>

          <div className="h-[1px] bg-gray-400 my-1"></div>
          <div
            onClick={() => {
              openWindow({
                id: 'display-properties',
                title: 'Display Properties',
                appType: 'display-properties',
                icon: '/images/icons/themes-16x16.png',
                width: 360,
                height: 400,
              });
              setContextMenu(null);
            }}
            className="hover:bg-[#000080] hover:text-white px-3 py-1 cursor-default"
          >
            Properties
          </div>
        </div>
      )}

      {/* Icon Right-Click Context Menu */}
      {iconContextMenu && (
        <div
          className="context-menu absolute bg-[#c0c0c0] text-black border-2 border-outset p-[2px] z-[99999] select-none text-[11px] font-sans flex flex-col w-[140px] shadow"
          style={{
            left: `${iconContextMenu.x}px`,
            top: `${iconContextMenu.y}px`,
          }}
        >
          <div
            onClick={() => {
              handleIconDoubleClick(iconContextMenu.icon);
              setIconContextMenu(null);
            }}
            className="hover:bg-[#000080] hover:text-white px-3 py-1 cursor-default font-bold"
          >
            Open
          </div>
          {iconContextMenu.icon.id.startsWith('vfs-desktop-') && (
            <>
              <div className="h-[1px] bg-gray-400 my-1"></div>
              <div
                onClick={() => handleDeleteIcon(iconContextMenu.icon)}
                className="hover:bg-[#000080] hover:text-white px-3 py-1 cursor-default"
              >
                Delete
              </div>
            </>
          )}
        </div>
      )}

      {/* Custom Win98 Confirm Dialog Modal */}
      {confirmDialog && confirmDialog.isOpen && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-[999999] select-none">
          <div className="os-window outset-deep bg-[#c0c0c0] w-[350px] text-black shadow-xl p-[2px]">
            <div className="window-titlebar flex items-center justify-between px-2 py-1 font-bold text-white bg-gradient-to-r from-[#000080] to-[#1084d0] text-xs">
              <span className="truncate">{confirmDialog.title}</span>
              <button
                onClick={() => setConfirmDialog(null)}
                className="w-4 h-3.5 bg-[#c0c0c0] text-black flex items-center justify-center text-xs font-bold border border-outset active:border-inset"
              >
                ✕
              </button>
            </div>
            <div className="p-4 flex items-center gap-3">
              <img
                src="/images/icons/msg-warning-32x32.png"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
                className="w-8 h-8 flex-shrink-0 image-render-pixelated"
                alt="Warning"
              />
              <p className="text-xs leading-relaxed text-black break-words flex-1">{confirmDialog.message}</p>
            </div>
            <div className="flex justify-end gap-2 px-3 py-2 bg-[#c0c0c0]">
              <button
                onClick={() => confirmDialog.onConfirm()}
                className="px-4 py-1 text-xs text-black border outset-deep bg-[#c0c0c0] active:inset-deep font-sans outline-none min-w-[60px] cursor-pointer"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-1 text-xs text-black border outset-deep bg-[#c0c0c0] active:inset-deep font-sans outline-none min-w-[60px] cursor-pointer"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Desktop;
