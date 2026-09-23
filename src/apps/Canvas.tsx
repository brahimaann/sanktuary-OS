import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useWindowManager } from '../wm/manager';
import { useBoard } from '../utils/useBoard';
import { fileIcon, fileKind } from './fileTypes';
import { LogOn, fileUrl, shell, toolbar, button, statusBar } from './TeamFiles';

/**
 * Infinite, live-shared moodboard canvas (Figma / Obsidian Canvas style).
 * Pan: drag the background, scroll, or two fingers. Zoom: Ctrl+scroll or pinch.
 * Everyone on the board sees item changes and each other's cursors in real time.
 */

export interface Item {
  id: string;
  type: 'note' | 'text' | 'image' | 'file' | 'link' | 'edge';
  x: number; y: number; w: number; h: number; z: number;
  color?: string;
  text?: string;
  src?: string;                                    // board asset or team file URL
  name?: string;
  ref?: { app: string; dir: string[]; name: string }; // team file this card points at
  url?: string;
  from?: string; to?: string; // edge: arrow from one item to another (x/y/w/h unused)
}
interface View { x: number; y: number; z: number }

export const DRAG_MIME = 'application/x-sk-file'; // set by TeamFiles when dragging a file out
const NOTE_COLORS = ['#fff59d', '#ffcc80', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#e1bee7', '#ffffff'];
const MAX_ASSET = 95 * 1024 * 1024; // Cloudflare caps a request at 100 MB
const newId = () => crypto.randomUUID().slice(0, 12);

const Canvas: React.FC<{ boardId: string; name: string }> = ({ boardId, name }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name={name} />;
  return <Board boardId={boardId} />;
};

const Board: React.FC<{ boardId: string }> = ({ boardId }) => {
  const { openWindow } = useWindowManager();
  const { items, peers, status, setStatus, me, queue, flush, sendCursor, undo, redo, remember, snapshot, canUndo, canRedo } = useBoard<Item>(boardId);
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<View>(() => {
    try { return JSON.parse(localStorage.getItem(`sk_board_view_${boardId}`) || '') as View; } catch { return { x: 0, y: 0, z: 1 }; }
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const viewRef = useRef(view);
  viewRef.current = view;
  const port = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(`sk_board_view_${boardId}`, JSON.stringify(view)); } catch {}
  }, [boardId, view]);

  // ── Coordinates ──
  const toWorld = (clientX: number, clientY: number) => {
    const r = port.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  };
  const center = () => {
    const r = port.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  const topZ = () => Math.max(0, ...Object.values(itemsRef.current).map((i) => i.z)) + 1;

  const add = (partial: Omit<Item, 'id' | 'z'> & Partial<Pick<Item, 'id'>>) => {
    const item = { id: newId(), z: topZ(), ...partial } as Item;
    queue({ [item.id]: item }, true);
    setSelected(new Set([item.id]));
    return item;
  };

  // ── Wheel: pan, Ctrl/⌘ + wheel: zoom at pointer (native listener so we can preventDefault) ──
  useEffect(() => {
    const el = port.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        if (!e.ctrlKey && !e.metaKey) return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
        const z = Math.min(4, Math.max(0.1, v.z * Math.exp(-e.deltaY * 0.01)));
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        return { z, x: sx - ((sx - v.x) * z) / v.z, y: sy - ((sy - v.y) * z) / v.z };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pointer: pan / pinch on the background, move / resize items ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = (e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: () => void) => {
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) onMove(ev.clientX - sx, ev.clientY - sy, ev); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.world) return;
    port.current?.focus();
    setEditing(null);
    if (!e.shiftKey) setSelected(new Set());
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = viewRef.current;
    if (pointers.current.size === 2) {
      // Pinch: zoom around the midpoint of the two fingers
      const [a, b] = [...pointers.current.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      const r = port.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      drag(e, (_dx, _dy, ev) => {
        pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const [p, q] = [...pointers.current.values()];
        const z = Math.min(4, Math.max(0.1, (start.z * Math.hypot(p.x - q.x, p.y - q.y)) / d0));
        setView({ z, x: mx - ((mx - start.x) * z) / start.z, y: my - ((my - start.y) * z) / start.z });
      }, () => pointers.current.delete(e.pointerId));
      return;
    }
    drag(e, (dx, dy) => { if (pointers.current.size === 1) setView({ ...start, x: start.x + dx, y: start.y + dy }); }, () => pointers.current.delete(e.pointerId));
  };

  const onItemDown = (e: React.PointerEvent, item: Item) => {
    if (editing === item.id) return;
    e.stopPropagation();
    port.current?.focus();
    const sel = e.shiftKey ? new Set(selected).add(item.id) : selected.has(item.id) ? selected : new Set([item.id]);
    setSelected(sel);
    const z = topZ();
    const starts = [...sel].map((id) => itemsRef.current[id]).filter((i) => i && i.type !== 'edge');
    const before = snapshot(starts.map((i) => i.id));
    let moved = false;
    drag(e, (dx, dy) => {
      moved = true;
      const zoom = viewRef.current.z;
      queue(Object.fromEntries(starts.map((s, i) => [s.id, { ...s, x: s.x + dx / zoom, y: s.y + dy / zoom, z: z + i }])), false, true);
    }, () => { if (moved) { remember(before); flush(); } });
  };

  const onResizeDown = (e: React.PointerEvent, item: Item) => {
    e.stopPropagation();
    const ratio = item.h / item.w;
    const before = snapshot([item.id]);
    drag(e, (dx, dy) => {
      const zoom = viewRef.current.z;
      const w = Math.max(40, item.w + dx / zoom);
      const h = item.type === 'image' ? w * ratio : Math.max(30, item.h + dy / zoom);
      queue({ [item.id]: { ...item, w, h } }, false, true);
    }, () => { remember(before); flush(); });
  };

  // Drag from an item's ● handle onto another item to draw an arrow between them
  const onLinkDown = (e: React.PointerEvent, item: Item) => {
    e.stopPropagation();
    let end = toWorld(e.clientX, e.clientY);
    setLinking({ from: item.id, ...end });
    drag(e, (_dx, _dy, ev) => { end = toWorld(ev.clientX, ev.clientY); setLinking({ from: item.id, ...end }); }, () => {
      setLinking(null);
      const hit = itemAt(end.x, end.y);
      if (hit && hit.id !== item.id && !Object.values(itemsRef.current).some((x) => x.type === 'edge' && x.from === item.id && x.to === hit.id)) {
        add({ type: 'edge', from: item.id, to: hit.id, x: 0, y: 0, w: 0, h: 0 });
      }
    });
  };

  const onPointerMove = (e: React.PointerEvent) => sendCursor(toWorld(e.clientX, e.clientY));

  /** Topmost card under a point (world coordinates). */
  const itemAt = (x: number, y: number) =>
    Object.values(itemsRef.current).filter((i) => i.type !== 'edge' && x >= i.x && x <= i.x + i.w && y >= i.y && y <= i.y + i.h).sort((a, b) => b.z - a.z)[0];

  // ── Creating items ──
  const uploadAsset = async (file: File) => {
    if (file.size > MAX_ASSET) throw new Error(`${file.name} is over 95 MB — put it in a team space and drag it in from there`);
    const res = await fetch(`/api/boards/${boardId}/assets?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { src: string; name: string };
  };

  const imageSize = (src: string) =>
    new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
        resolve({ w: img.naturalWidth * s, h: img.naturalHeight * s });
      };
      img.onerror = () => resolve({ w: 240, h: 180 });
      img.src = src;
    });

  const addFiles = async (files: File[], at = center()) => {
    let offset = 0;
    for (const file of files) {
      try {
        setStatus(`Uploading ${file.name}...`);
        const asset = await uploadAsset(file);
        const pos = { x: at.x + offset, y: at.y + offset };
        if (fileKind(file.name) === 'image') add({ type: 'image', ...pos, ...(await imageSize(asset.src)), src: asset.src, name: asset.name });
        else add({ type: 'file', ...pos, w: 240, h: fileKind(file.name) === 'audio' ? 110 : 64, src: asset.src, name: asset.name });
        offset += 24;
        setStatus('');
      } catch (err) {
        setStatus((err as Error).message);
      }
    }
  };

  const addTeamFile = async (ref: { app: string; dir: string[]; name: string }, at: { x: number; y: number }) => {
    const src = fileUrl(ref.app, [...ref.dir, ref.name]);
    if (fileKind(ref.name) === 'image') add({ type: 'image', ...at, ...(await imageSize(src)), src, name: ref.name, ref });
    else add({ type: 'file', ...at, w: 240, h: fileKind(ref.name) === 'audio' ? 110 : 64, name: ref.name, ref, src });
  };

  const addLink = (url: string, at = center()) => {
    const clean = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    add({ type: 'link', ...at, w: 260, h: 64, url: clean, text: new URL(clean).hostname });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const at = toWorld(e.clientX, e.clientY);
    const teamFile = e.dataTransfer.getData(DRAG_MIME);
    if (teamFile) {
      const ref = JSON.parse(teamFile);
      return ref.isDir ? setStatus('Folders can be shared in Teams; drop files onto the board.') : addTeamFile(ref, at);
    }
    if (e.dataTransfer.files.length) return addFiles([...e.dataTransfer.files], at);
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/^https?:\/\//i.test(text)) addLink(text.split('\n')[0], at);
  };

  // Paste images, links or text while the board has focus
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!port.current?.contains(document.activeElement) || editing) return;
      const files = [...(e.clipboardData?.files || [])];
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (files.length) addFiles(files);
      else if (text && /^https?:\/\/\S+$/i.test(text)) addLink(text);
      else if (text) add({ type: 'note', ...center(), w: 200, h: 140, color: NOTE_COLORS[0], text });
      else return;
      e.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const deleteSelected = () => {
    if (!selected.size) return;
    const doomed = new Set(selected);
    for (const i of Object.values(items)) if (i.type === 'edge' && (doomed.has(i.from!) || doomed.has(i.to!))) doomed.add(i.id);
    queue(Object.fromEntries([...doomed].map((id) => [id, null])), true);
    setSelected(new Set());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'Escape') setSelected(new Set());
  };

  const openItem = (item: Item) => {
    if (item.type === 'note' || item.type === 'text') return setEditing(item.id);
    if (item.type === 'link') return window.open(item.url, '_blank', 'noopener');
    if (item.ref) {
      return openWindow({
        id: `preview-${item.ref.app}-${[...item.ref.dir, item.ref.name].join('/')}`,
        title: item.ref.name,
        icon: fileIcon(item.ref.name, false),
        appType: 'file-preview',
        appProps: { ...item.ref, siblings: [item.ref.name] },
        width: 720,
        height: 520,
      });
    }
    if (item.src) window.open(item.src, '_blank');
  };

  const fit = () => {
    const list = Object.values(items).filter((i) => i.type !== 'edge');
    const r = port.current!.getBoundingClientRect();
    if (!list.length) return setView({ x: r.width / 2, y: r.height / 2, z: 1 });
    const minX = Math.min(...list.map((i) => i.x)), minY = Math.min(...list.map((i) => i.y));
    const maxX = Math.max(...list.map((i) => i.x + i.w)), maxY = Math.max(...list.map((i) => i.y + i.h));
    const z = Math.min(2, Math.max(0.1, Math.min((r.width - 80) / (maxX - minX || 1), (r.height - 80) / (maxY - minY || 1))));
    setView({ z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (r.height - (maxY - minY) * z) / 2 - minY * z });
  };

  const zoomBy = (f: number) => {
    const r = port.current!.getBoundingClientRect();
    setView((v) => {
      const z = Math.min(4, Math.max(0.1, v.z * f));
      const sx = r.width / 2, sy = r.height / 2;
      return { z, x: sx - ((sx - v.x) * z) / v.z, y: sy - ((sy - v.y) * z) / v.z };
    });
  };

  const one = selected.size === 1 ? items[[...selected][0]] : null;
  const others = Object.entries(peers);

  return (
    <div style={shell}>
      <div style={toolbar}>
        <button style={button} onClick={() => add({ type: 'note', ...center(), w: 200, h: 140, color: NOTE_COLORS[0], text: '' })}>Note</button>
        <button style={button} onClick={() => add({ type: 'text', ...center(), w: 320, h: 60, text: 'Title' })}>Text</button>
        <button style={button} onClick={() => imageInput.current?.click()}>Image / File...</button>
        <button style={button} onClick={() => { const u = window.prompt('Link URL:')?.trim(); if (u) addLink(u); }}>Link...</button>
        <input ref={imageInput} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = ''; }} />
        {one && (one.type === 'note' || one.type === 'text') && <button style={button} onClick={() => setEditing(one.id)}>Edit</button>}
        {one?.type === 'note' && NOTE_COLORS.map((c) => (
          <button key={c} title="Note color" onClick={() => queue({ [one.id]: { ...one, color: c } }, true)} style={{ width: 16, height: 16, padding: 0, background: c, border: one.color === c ? '2px solid #000' : '1px solid #808080' }} />
        ))}
        {selected.size > 0 && <button style={button} onClick={deleteSelected}>Delete</button>}
        <button style={button} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
        <button style={button} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
        <div style={{ flex: 1 }} />
        <button style={button} onClick={() => zoomBy(1 / 1.25)}>−</button>
        <span style={{ minWidth: 38, textAlign: 'center' }}>{Math.round(view.z * 100)}%</span>
        <button style={button} onClick={() => zoomBy(1.25)}>+</button>
        <button style={button} onClick={fit}>Fit</button>
        <div style={{ display: 'flex', marginLeft: 6 }} title={['you', ...others.map(([, p]) => p.user)].join(', ')}>
          {[me.current && { user: me.current.user, color: me.current.color }, ...others.map(([, p]) => p)].filter(Boolean).map((p, i) => (
            <span key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: p!.color, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: i ? -5 : 0, border: '1px solid #fff' }}>
              {p!.user.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={port}
        className="sk-canvas"
        tabIndex={0}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onDoubleClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.world) add({ type: 'note', ...toWorld(e.clientX, e.clientY), w: 200, h: 140, color: NOTE_COLORS[0], text: '' }); }}
        onKeyDown={onKeyDown}
        onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
        onDrop={onDrop}
        style={{
          flex: 1, position: 'relative', overflow: 'hidden', outline: 'none', touchAction: 'none', margin: '0 2px',
          border: '2px inset #808080', cursor: 'grab',
          backgroundColor: '#f4f1ea',
          backgroundImage: 'radial-gradient(circle, #c9c3b6 1px, transparent 1.2px)',
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div data-world="1" style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }}>
          <Edges
            items={items}
            selected={selected}
            zoom={view.z}
            linking={linking}
            onSelect={(id, add) => { port.current?.focus(); setSelected(add ? new Set(selected).add(id) : new Set([id])); }}
          />
          {Object.values(items).filter((i) => i.type !== 'edge').sort((a, b) => a.z - b.z).map((item) => (
            <ItemView
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              editing={editing === item.id}
              zoom={view.z}
              onDown={(e) => onItemDown(e, item)}
              onResize={(e) => onResizeDown(e, item)}
              onLink={selected.size === 1 ? (e) => onLinkDown(e, item) : undefined}
              onOpen={() => openItem(item)}
              onText={(text) => queue({ [item.id]: { ...item, text } })}
              onDoneEditing={() => { setEditing(null); flush(); }}
            />
          ))}
          {others.map(([conn, p]) => p.x !== undefined && (
            <div key={conn} style={{ position: 'absolute', left: p.x, top: p.y, pointerEvents: 'none', transform: `scale(${1 / view.z})`, transformOrigin: '0 0', zIndex: 1e9 }}>
              <svg width="14" height="20" viewBox="0 0 14 20"><path d="M0 0 L0 16 L4 12 L7 19 L10 18 L7 11 L13 11 Z" fill={p.color} stroke="#fff" strokeWidth="1" /></svg>
              <span style={{ background: p.color, color: '#fff', fontSize: 11, padding: '1px 4px', whiteSpace: 'nowrap', position: 'relative', left: 10, top: -6 }}>{p.user}</span>
            </div>
          ))}
        </div>
        {!Object.keys(items).length && !status && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#777', pointerEvents: 'none', padding: 24, lineHeight: 1.6 }}>
            Double-click to add a note · drop images or files here · drag files in from a team space · paste with Ctrl+V
          </div>
        )}
        {dropping && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,128,0.12)', border: '2px dashed #000080', pointerEvents: 'none' }} />}
      </div>
      <div style={statusBar}>
        {status || `${Object.keys(items).length} item(s) · ${others.length ? `${others.length} other${others.length > 1 ? 's' : ''} here` : 'just you'} · drag background to pan · Ctrl+scroll or pinch to zoom · double-click to add a note`}
      </div>
    </div>
  );
};

const ItemView: React.FC<{
  item: Item; selected: boolean; editing: boolean; zoom: number;
  onDown: (e: React.PointerEvent) => void; onResize: (e: React.PointerEvent) => void; onLink?: (e: React.PointerEvent) => void; onOpen: () => void;
  onText: (t: string) => void; onDoneEditing: () => void;
}> = ({ item, selected, editing, zoom, onDown, onResize, onLink, onOpen, onText, onDoneEditing }) => {
  const box: React.CSSProperties = {
    position: 'absolute', left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z, boxSizing: 'border-box',
    outline: selected ? `${2 / zoom}px solid #000080` : 'none', outlineOffset: 2 / zoom, cursor: 'move', userSelect: 'none',
  };
  const textStyle: React.CSSProperties = {
    width: '100%', height: '100%', padding: item.type === 'note' ? 12 : 0, boxSizing: 'border-box', border: 'none', outline: 'none', resize: 'none',
    background: 'transparent', font: item.type === 'text' ? '700 28px Arial, sans-serif' : '14px Arial, sans-serif', whiteSpace: 'pre-wrap', overflow: 'hidden', color: '#111',
  };

  let body: React.ReactNode;
  if (item.type === 'note' || item.type === 'text') {
    body = editing
      ? <textarea autoFocus defaultValue={item.text} style={textStyle} onChange={(e) => onText(e.target.value)} onBlur={onDoneEditing} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }} />
      : <div style={textStyle}>{item.text || <span style={{ color: '#999' }}>{item.type === 'note' ? 'Double-click to write' : 'Text'}</span>}</div>;
    if (item.type === 'note') body = <div style={{ width: '100%', height: '100%', background: item.color || '#fff59d', boxShadow: '2px 3px 6px rgba(0,0,0,0.25)' }}>{body}</div>;
  } else if (item.type === 'image') {
    body = <img src={item.src} alt={item.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', boxShadow: '2px 3px 8px rgba(0,0,0,0.3)', background: '#ddd' }} />;
  } else {
    const isAudio = item.type === 'file' && fileKind(item.name || '') === 'audio';
    body = (
      <div style={{ width: '100%', height: '100%', background: '#c0c0c0', borderTop: '1px solid #fff', borderLeft: '1px solid #fff', borderRight: '1px solid #000', borderBottom: '1px solid #000', padding: 8, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 6, font: '11px "MS Sans Serif", Arial, sans-serif', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <img src={item.type === 'link' ? '/images/icons/internet-explorer-32x32.png' : fileIcon(item.name || '', false, 32)} alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.type === 'link' ? item.text : item.name}</div>
            <div style={{ color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.type === 'link' ? item.url : item.ref ? `${item.ref.app}/${[...item.ref.dir, item.ref.name].join('/')}` : 'attached file'}</div>
          </div>
        </div>
        {isAudio && <audio src={item.src} controls preload="none" style={{ width: '100%' }} onPointerDown={(e) => e.stopPropagation()} />}
      </div>
    );
  }

  return (
    <div style={box} onPointerDown={onDown} onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}>
      {body}
      {selected && !editing && (
        <div onPointerDown={onResize} style={{ position: 'absolute', right: -6 / zoom, bottom: -6 / zoom, width: 12 / zoom, height: 12 / zoom, background: '#000080', border: `${1 / zoom}px solid #fff`, cursor: 'nwse-resize' }} />
      )}
      {selected && !editing && onLink && (
        <div onPointerDown={onLink} title="Drag onto another card to connect them" style={{ position: 'absolute', right: -22 / zoom, top: `calc(50% - ${8 / zoom}px)`, width: 16 / zoom, height: 16 / zoom, borderRadius: '50%', background: '#fff', border: `${2 / zoom}px solid #000080`, cursor: 'crosshair', boxSizing: 'border-box' }} />
      )}
    </div>
  );
};

/** Point where the line from a box's centre towards (tx, ty) leaves the box. */
function exitPoint(b: Item, tx: number, ty: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Arrows between cards, plus the rubber band while you're drawing a new one. */
const Edges: React.FC<{
  items: Record<string, Item>; selected: Set<string>; zoom: number;
  linking: { from: string; x: number; y: number } | null; onSelect: (id: string, add: boolean) => void;
}> = ({ items, selected, zoom, linking, onSelect }) => {
  const lines: { id: string; x1: number; y1: number; x2: number; y2: number; sel: boolean }[] = [];
  for (const e of Object.values(items)) {
    if (e.type !== 'edge') continue;
    const a = items[e.from!], b = items[e.to!];
    if (!a || !b) continue;
    const p1 = exitPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const p2 = exitPoint(b, a.x + a.w / 2, a.y + a.h / 2);
    lines.push({ id: e.id, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, sel: selected.has(e.id) });
  }
  const from = linking && items[linking.from];
  const w = 2 / zoom;
  return (
    <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
      <defs>
        {['#333', '#000080'].map((c) => (
          <marker key={c} id={`sk-arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 Z" fill={c} />
          </marker>
        ))}
      </defs>
      {lines.map((l) => (
        <g key={l.id}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.sel ? '#000080' : '#333'} strokeWidth={l.sel ? w * 1.6 : w} markerEnd={`url(#sk-arrow-${l.sel ? '000080' : '333'})`} />
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={14 / zoom} style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(ev) => { ev.stopPropagation(); onSelect(l.id, ev.shiftKey); }} />
        </g>
      ))}
      {from && (() => {
        const p = exitPoint(from, linking!.x, linking!.y);
        return <line x1={p.x} y1={p.y} x2={linking!.x} y2={linking!.y} stroke="#000080" strokeWidth={w} strokeDasharray={`${6 / zoom} ${4 / zoom}`} markerEnd="url(#sk-arrow-000080)" />;
      })()}
    </svg>
  );
};

export default Canvas;
