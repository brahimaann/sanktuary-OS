import React, { useState, useEffect, useRef } from 'react';
import { useWindowManager, AppType } from '../wm/manager';
import { vfs } from '../vfs/fs';
import { useMe } from '../utils/api';
import { startLive } from '../utils/live';

interface DesktopIconDef {
  id: string;
  title: string;
  icon: string;
  appType: AppType;
  appProps?: any;
  width?: number;
  height?: number;
}

const DEFAULT_ICONS: DesktopIconDef[] = [
  // Column 1
  { id: 'my-computer', title: 'My Computer', icon: '/images/icons/my-computer-32x32.png', appType: 'explorer', appProps: { path: 'C:/' }, width: 640, height: 485 },
  { id: 'my-documents', title: 'My Documents', icon: '/images/icons/my-documents-32x32.png', appType: 'explorer', appProps: { path: 'C:/My Documents' }, width: 640, height: 480 },
  { id: 'network', title: 'Sanktuary Net', icon: '/images/icons/network-32x32.png', appType: 'explorer', appProps: { path: 'C:/Sanktuary Net' }, width: 640, height: 480 },
  { id: 'recycle', title: 'Recycle Bin', icon: '/images/icons/recycle-bin-32x32.png', appType: 'explorer', appProps: { path: 'C:/Recycled' }, width: 640, height: 480 },
  { id: 'ie', title: 'Internet Explorer', icon: '/images/icons/internet-explorer-32x32.png', appType: 'internet-explorer', appProps: { src: 'https://en.m.wikipedia.org/wiki/African_history' }, width: 900, height: 640 },
  { id: 'africaonly', title: 'AfricaOnly.TV', icon: '/images/icons/video-32x32.png', appType: 'africaonly', width: 900, height: 620 },
  { id: 'notepad', title: 'Notepad', icon: '/images/icons/notepad-32x32.png', appType: 'notepad', width: 480, height: 360 },

  // Column 2
  { id: 'winamp', title: 'Winamp', icon: '/images/icons/winamp2-32x32.png', appType: 'winamp', width: 275, height: 348 },
  { id: 'pipes', title: '3D Pipes', icon: '/images/icons/pipes-32x32.png', appType: 'iframe', appProps: { src: '/programs/pipes/index.html#%7B%22hideUI%22%3Atrue%7D' }, width: 800, height: 600 },

  // Column 3
  { id: 'pong', title: 'Pong', icon: '/images/icons/pinball-32x32.png', appType: 'pong', width: 520, height: 380 },
  { id: 'powder-toy', title: 'Sandspiel (Powder)', icon: '/images/icons/pipes-32x32.png', appType: 'iframe', appProps: { src: 'https://sandspiel.club/' }, width: 800, height: 600 },
  { id: 'webradio', title: 'MRND Web Radio', icon: '/images/icons/speaker-32x32.png', appType: 'webradio', width: 280, height: 320 },

  // Team spaces on the home server (Clerk sign-in required)
  { id: 'sanktuary-network', title: 'Sanktuary Network', icon: '/images/icons/network-32x32.png', appType: 'network', width: 560, height: 420 },
  { id: 'moodboards', title: 'Moodboards', icon: '/images/icons/paint-32x32.png', appType: 'boards', width: 560, height: 420 },
  { id: 'planner', title: 'Planner', icon: '/images/icons/task-32x32.png', appType: 'boards', appProps: { kind: 'kanban' }, width: 560, height: 420 },
  { id: 'teams', title: 'Sanktuary Teams', icon: '/images/icons/outlook-express-32x32.png', appType: 'teams', width: 300, height: 520 },
];

// Only shown to admins (see useMe)
const ADMIN_ICON: DesktopIconDef = { id: 'admin-panel', title: 'Admin Panel', icon: '/images/icons/settings-32x32.png', appType: 'admin', width: 760, height: 540 };

export const Desktop: React.FC = () => {
  const { openWindow, wallpaper, bgColor } = useWindowManager();
  const { me } = useMe();
  useEffect(() => { if (me) startLive(); }, [me]);
  const [vfsIcons, setVfsIcons] = useState<DesktopIconDef[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);

  // Freeform Desktop Icon positions and drag state
  const [positions, setPositions] = useState<{ [id: string]: { x: number; y: number } }>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [currentDragPos, setCurrentDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragMoved = useRef(false);
  
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

  const allIcons = [...DEFAULT_ICONS, ...(me?.admin ? [ADMIN_ICON] : []), ...vfsIcons];

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
      setMarquee((prev) => prev ? { ...prev, currentX, currentY } : null);

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
      const saved = localStorage.getItem('hq_os_desktop_icon_positions');
      if (saved) {
        setPositions(JSON.parse(saved));
      }
    } catch (_) {}
  }, []);

  const getIconPos = (id: string, index: number) => {
    if (positions[id]) return positions[id];
    const row = index % 7;
    const col = Math.floor(index / 7);
    return {
      x: 16 + col * 82,
      y: 16 + row * 82,
    };
  };

  const handleIconPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    handleIconClick(id, e);
    e.currentTarget.setPointerCapture(e.pointerId);

    const parentRect = desktopRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    const curPos = positions[id] || getIconPos(id, allIcons.findIndex((i) => i.id === id));

    dragMoved.current = false;
    setDraggingId(id);
    setDragOffset({
      x: e.clientX - parentRect.left - curPos.x,
      y: e.clientY - parentRect.top - curPos.y,
    });
    setCurrentDragPos(curPos);
  };

  const handleIconPointerMove = (id: string, e: React.PointerEvent) => {
    if (draggingId !== id) return;
    dragMoved.current = true;
    const parentRect = desktopRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    const newX = Math.max(8, e.clientX - parentRect.left - dragOffset.x);
    const newY = Math.max(8, e.clientY - parentRect.top - dragOffset.y);
    setCurrentDragPos({ x: newX, y: newY });
  };

  const handleIconPointerUp = (id: string, e: React.PointerEvent) => {
    if (draggingId !== id) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (dragMoved.current && currentDragPos) {
      // Snap to 82px Win98 desktop grid
      const snappedX = Math.max(16, Math.round((currentDragPos.x - 16) / 82) * 82 + 16);
      const snappedY = Math.max(16, Math.round((currentDragPos.y - 16) / 82) * 82 + 16);
      const finalPos = { x: snappedX, y: snappedY };

      setPositions((prev) => {
        const next = { ...prev, [id]: finalPos };
        try {
          localStorage.setItem('hq_os_desktop_icon_positions', JSON.stringify(next));
        } catch (_) {}
        return next;
      });
    } else if (e.pointerType === 'touch') {
      // Phones: a tap opens the icon (double-tap is unreliable on touch screens)
      const iconDef = allIcons.find((i) => i.id === id);
      if (iconDef) handleIconDoubleClick(iconDef);
    }

    setDraggingId(null);
    setCurrentDragPos(null);
  };

  const handleIconClick = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    setContextMenu(null);
    setActiveSubMenu(null);
    if (e.ctrlKey) {
      setSelectedIds((prev) => 
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      );
    } else {
      setSelectedIds([id]);
    }
  };

  const handleIconDoubleClick = (iconDef: DesktopIconDef) => {
    if (iconDef.appType === 'explorer') {
      const path = iconDef.appProps?.path || 'C:/';
      try {
        const contents = vfs.readdir(path);
        if (contents.length === 0) {
          alert('This folder is empty. Conserving energy by not opening it.');
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
      visible: true
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
      {allIcons.map((icon, index) => {
        const isSelected = selectedIds.includes(icon.id);
        const isDragging = draggingId === icon.id;
        const pos = isDragging && currentDragPos ? currentDragPos : getIconPos(icon.id, index);
        return (
          <div
            key={icon.id}
            ref={(el) => { iconRefs.current[icon.id] = el; }}
            onPointerDown={(e) => handleIconPointerDown(icon.id, e)}
            onPointerMove={(e) => handleIconPointerMove(icon.id, e)}
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
              touchAction: 'none',
            }}
          >
            <div className="icon-wrapper w-[32px] h-[32px] relative flex justify-center items-center">
              <img
                src={icon.icon}
                alt=""
                className="w-[32px] h-[32px] select-none pointer-events-none image-render-pixelated"
              />
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
          <div className="px-3 py-1 cursor-default text-gray-500 opacity-60">Arrange Icons</div>
          <div className="px-3 py-1 cursor-default text-gray-500 opacity-60">Line Up Icons</div>
          <div
            onClick={() => window.location.reload()}
            className="hover:bg-[#000080] hover:text-white px-3 py-1 cursor-default"
          >
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
              <div
                className="absolute bg-[#c0c0c0] text-black border-2 border-outset p-[2px] left-[144px] -top-1 w-[130px] flex flex-col z-[100000]"
              >
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
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                className="w-8 h-8 flex-shrink-0 image-render-pixelated"
                alt="Warning"
              />
              <p className="text-xs leading-relaxed text-black break-words flex-1">
                {confirmDialog.message}
              </p>
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
