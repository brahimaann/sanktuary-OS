import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { useWindowManager } from '../wm/manager';
import { openStudio } from './Studio';
import { LogOn, shell, toolbar, button, statusBar } from './TeamFiles';
import MembersPicker from './MembersPicker';
import RetroIcon, { IconLabel } from '../components/RetroIcon';

// Studio > Locations: the shoot location library. Drop scouting photos and their GPS pins them on the map
// (a photo taken within 150 m of a spot joins it). Each pin says why the spot is worth coming back to, and links
// the moodboards and plans for it and the shoots on the calendar there.

interface Photo {
  id: string;
  file: string;
  name: string;
  by: string;
  taken: string | null;
  lat?: number;
  lng?: number;
}
interface Spot {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  why: string;
  address: string;
  photos: Photo[];
  boards: { id: string; name: string; kind: 'canvas' | 'kanban' }[];
  shoots: { id: string; title: string; kind: string; start: string; status: string }[];
  owner: string;
  members: string[] | null;
  release?: string | null; // the release (campaign) this spot is for
  draft?: boolean; // only its owner sees it, admins included
}
type LatLng = { lat: number; lng: number };

const HOME: LatLng = { lat: 44.9778, lng: -93.265 }; // Twin Cities
const MAX_PHOTO = 95 * 1024 ** 2; // Cloudflare caps a request at 100 MB
const photoUrl = (p: Photo) => `/api/locations/photos/${encodeURIComponent(p.file)}`;
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

const Locations: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Locations" />;
  return <LocationsApp />;
};

const LocationsApp: React.FC = () => {
  const api = useApi();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState<string | 'new' | null>(null); // the spot whose pin the next map click sets
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<{ center: LatLng; z: number } | null>(null);
  const [showList, setShowList] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(
    () =>
      api('/api/locations').then(
        (d) => setSpots(d.items),
        (e) => setMsg(e.message),
      ),
    [api],
  );
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('locations', load);
  // First load: frame every pin (or the Twin Cities when there are none)
  useEffect(() => {
    if (spots && !view) setView(fit(spots.filter(pinned)));
  }, [spots, view]);

  const spot = spots?.find((s) => s.id === selected) || null;
  const select = (s: Spot | null, fly = false) => {
    setSelected(s?.id || null);
    if (fly && s && pinned(s)) setView((v) => ({ center: { lat: s.lat!, lng: s.lng! }, z: Math.max(v?.z || 0, 15) }));
  };

  const upload = async (files: File[], to?: string) => {
    let last: { id: string; gps: boolean } | null = null;
    for (const [n, f] of files.entries()) {
      if (!f.type.startsWith('image/') && !/\.(heic|heif|dng|cr2|cr3|nef|arw|raf)$/i.test(f.name)) continue;
      if (f.size > MAX_PHOTO) {
        setMsg(`${f.name} is over 95 MB`);
        continue;
      }
      setMsg(`Uploading ${f.name} (${n + 1} of ${files.length})...`);
      const q = new URLSearchParams({ name: f.name, ...(to ? { to } : {}) });
      try {
        const r = await api(`/api/locations/photos?${q}`, { method: 'PUT', body: f });
        last = { id: r.location, gps: r.gps };
        setMsg(
          r.gps
            ? `${f.name}: ${r.made ? 'pinned a new spot' : 'added to the spot it was taken at'}`
            : `${f.name} has no location in it${r.made ? ': click the map where it was taken' : ''}`,
        );
        if (r.made && !r.gps) setPlacing(r.location);
      } catch (e) {
        setMsg(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (!last) return;
    const fresh: Spot[] = (await api('/api/locations')).items;
    setSpots(fresh);
    select(fresh.find((s) => s.id === last!.id) || null, true);
  };

  const newSpot = async (at: LatLng) => {
    try {
      const s: Spot = await api('/api/locations', { method: 'POST', body: JSON.stringify(at) });
      await load();
      setSelected(s.id);
      setEditing(true);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const here = () =>
    navigator.geolocation
      ? (setMsg('Finding where you are...'),
        navigator.geolocation.getCurrentPosition(
          (p) => (setMsg(''), newSpot({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })),
          (e) => setMsg(`Couldn't get your location: ${e.message}`),
          { enableHighAccuracy: true, timeout: 15000 },
        ))
      : setMsg('This browser has no location access');

  const onMapClick = async (at: LatLng) => {
    if (!placing) return select(null);
    const id = placing;
    setPlacing(null);
    if (id === 'new') return newSpot(at);
    try {
      await api(`/api/locations/${id}`, { method: 'PATCH', body: JSON.stringify({ lat: +at.lat.toFixed(6), lng: +at.lng.toFixed(6) }) });
      setMsg('Pin moved');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (!spots || !view) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;
  const q = filter.trim().toLowerCase();
  const shown = spots.filter((s) => !q || `${s.name} ${s.why} ${s.address}`.toLowerCase().includes(q));

  return (
    <div
      style={shell}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <div style={toolbar}>
        <button className="sk-signal" style={{ ...button, fontWeight: 700 }} onClick={() => fileInput.current?.click()}>
          <IconLabel icon="upload">Add photos...</IconLabel>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.heic,.heif,.dng"
          multiple
          hidden
          onChange={(e) => {
            upload([...(e.target.files || [])]);
            e.target.value = '';
          }}
        />
        <button
          style={{ ...button, fontWeight: placing === 'new' ? 700 : 400 }}
          onClick={() => setPlacing(placing === 'new' ? null : 'new')}
          title="Then click the map where it is"
        >
          <IconLabel icon="pin">New spot</IconLabel>
        </button>
        <button style={button} onClick={here} title="Pin where you're standing (for scouting on the spot)">
          <IconLabel icon="plus">I'm here</IconLabel>
        </button>
        <input
          style={{ ...field, flex: 1, minWidth: 60, maxWidth: 220 }}
          placeholder="Find a spot..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button style={button} onClick={() => setShowList(!showList)}>
          {showList ? 'Hide list' : 'List'}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 4, padding: '0 2px', position: 'relative' }}>
        {showList && (
          <div style={{ ...box, width: 200, flexShrink: 0 }}>
            {shown.length === 0 && (
              <div style={{ padding: 8 }}>
                {spots.length
                  ? 'No spot matches.'
                  : 'No spots yet. Drop scouting photos here: their GPS pins them on the map. Or click New spot, then the map.'}
              </div>
            )}
            {shown.map((s) => (
              <div
                key={s.id}
                className={s.id === selected ? 'sk-signal' : undefined}
                onClick={() => select(s, true)}
                onDoubleClick={() => (select(s, true), setEditing(true))}
                style={{ display: 'flex', gap: 6, padding: '3px 6px', borderBottom: '1px solid #eee', alignItems: 'center' }}
              >
                {s.photos[0] ? (
                  <img src={photoUrl(s.photos[0])} alt="" style={thumb} loading="lazy" />
                ) : (
                  <span style={{ ...thumb, border: '1px dashed #000' }} />
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={ellipsis}>{s.name}</b>
                  <span style={{ ...ellipsis, fontSize: 10 }}>
                    {pinned(s) ? '' : 'no pin · '}
                    {s.photos.length} photo{s.photos.length === 1 ? '' : 's'}
                    {s.shoots.length ? ` · ${s.shoots.length} shoot${s.shoots.length === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                {s.draft && <i>draft</i>}
                {s.members && <RetroIcon name="lock" size={12} />}
              </div>
            ))}
          </div>
        )}
        <SpotMap
          spots={shown}
          view={view}
          setView={setView}
          selected={selected}
          placing={!!placing}
          onPick={(s) => select(s)}
          onClick={onMapClick}
          popup={
            spot &&
            !editing &&
            pinned(spot) && (
              <div style={popup} onPointerDown={(e) => e.stopPropagation()}>
                {spot.photos[0] && (
                  <img
                    src={photoUrl(spot.photos[0])}
                    alt=""
                    style={{ width: '100%', maxHeight: 90, objectFit: 'cover', display: 'block' }}
                  />
                )}
                <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <b>{spot.name}</b>
                  {spot.why ? (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{spot.why.length > 160 ? `${spot.why.slice(0, 160)}...` : spot.why}</span>
                  ) : (
                    <span style={{ color: '#666' }}>Why is this spot worth coming back to?</span>
                  )}
                  {spot.shoots[0] && (
                    <span style={{ fontSize: 10 }}>
                      Next: {spot.shoots.find((x) => x.status !== 'Done' && x.status !== 'Cancelled')?.title || spot.shoots.at(-1)!.title}
                    </span>
                  )}
                  <button style={{ ...button, alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>
                    Open...
                  </button>
                </div>
              </div>
            )
          }
        />
        {spot && editing && (
          <SpotPanel
            key={spot.id}
            spot={spot}
            onChange={load}
            onClose={() => setEditing(false)}
            onDeleted={() => (setEditing(false), setSelected(null), load())}
            onMovePin={() => (setPlacing(spot.id), setEditing(false), setMsg(`Click the map where "${spot.name}" is`))}
            onUpload={(f) => upload(f, spot.id)}
            setMsg={setMsg}
          />
        )}
        {dragOver && <div style={dropHint}>Drop photos to pin them</div>}
      </div>
      <div style={statusBar}>
        {placing ? (
          <>
            <b>Click the map</b> to {placing === 'new' ? 'drop the new spot' : 'place the pin'} ·{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), setPlacing(null))}>
              cancel
            </a>
          </>
        ) : (
          msg || `${spots.length} spot${spots.length === 1 ? '' : 's'} · ${spots.reduce((n, s) => n + s.photos.length, 0)} photos`
        )}
      </div>
    </div>
  );
};

const pinned = (s: Spot) => s.lat !== null && s.lng !== null;

// ── The map: OpenStreetMap tiles in greyscale, pins in the signal colour. Drag to pan, wheel or +/- to zoom. ──
const TILE = 256;
const toPx = ({ lat, lng }: LatLng, z: number) => {
  const size = TILE * 2 ** z;
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * size, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size };
};
const toLatLng = (x: number, y: number, z: number): LatLng => {
  const size = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (((x / size) * 360 + 540) % 360) - 180 };
};
/** The view that frames these pins in a ~600x400 map. */
function fit(pins: Spot[]): { center: LatLng; z: number } {
  if (!pins.length) return { center: HOME, z: 11 };
  const lats = pins.map((s) => s.lat!);
  const lngs = pins.map((s) => s.lng!);
  const center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
  let z = 16;
  while (z > 2) {
    const a = toPx({ lat: Math.max(...lats), lng: Math.min(...lngs) }, z);
    const b = toPx({ lat: Math.min(...lats), lng: Math.max(...lngs) }, z);
    if (b.x - a.x < 500 && b.y - a.y < 320) break;
    z--;
  }
  return { center, z };
}

const SpotMap: React.FC<{
  spots: Spot[];
  view: { center: LatLng; z: number };
  setView: (v: { center: LatLng; z: number }) => void;
  selected: string | null;
  placing: boolean;
  onPick: (s: Spot) => void;
  onClick: (at: LatLng) => void;
  popup: React.ReactNode;
}> = ({ spots, view, setView, selected, placing, onPick, onClick, popup }) => {
  const el = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const wheelAt = useRef(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el.current!);
    return () => ro.disconnect();
  }, []);

  const { z } = view;
  const c = toPx(view.center, z);
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const n = 2 ** z;
  const tiles: React.ReactNode[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx++)
    for (let ty = Math.max(0, Math.floor(top / TILE)); ty <= Math.min(n - 1, Math.floor((top + size.h) / TILE)); ty++)
      tiles.push(
        <img
          key={`${z}/${tx}/${ty}`}
          src={`https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png`}
          alt=""
          draggable={false}
          style={{ position: 'absolute', left: tx * TILE - left, top: ty * TILE - top, width: TILE, height: TILE }}
        />,
      );
  // Zoom by one step, keeping the point under (px, py) where it is
  const zoom = (dz: number, px = size.w / 2, py = size.h / 2) => {
    const nz = Math.max(3, Math.min(19, z + dz));
    if (nz === z) return;
    const k = 2 ** (nz - z);
    const wx = (left + px) * k;
    const wy = (top + py) * k;
    setView({ center: toLatLng(wx - px + size.w / 2, wy - py + size.h / 2, nz), z: nz });
  };
  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = el.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const sel = spots.find((s) => s.id === selected && pinned(s));
  const selPx = sel && toPx({ lat: sel.lat!, lng: sel.lng! }, z);

  return (
    <div
      ref={el}
      style={{
        ...box,
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        cursor: placing ? 'crosshair' : 'grab',
        touchAction: 'none',
        background: '#ddd',
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        setView({ center: toLatLng(d.cx - dx, d.cy - dy, z), z });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          const { px, py } = local(e);
          onClick(toLatLng(left + px, top + py, z));
        }
      }}
      onDoubleClick={(e) => {
        const { px, py } = local(e);
        zoom(1, px, py);
      }}
      onWheel={(e) => {
        if (Date.now() - wheelAt.current < 200 || !e.deltaY) return;
        wheelAt.current = Date.now();
        const { px, py } = local(e);
        zoom(e.deltaY < 0 ? 1 : -1, px, py);
      }}
    >
      <div style={{ position: 'absolute', inset: 0, filter: 'grayscale(1) contrast(1.15)' }}>{tiles}</div>
      {spots.filter(pinned).map((s) => {
        const p = toPx({ lat: s.lat!, lng: s.lng! }, z);
        const on = s.id === selected;
        return (
          <div
            key={s.id}
            title={s.name}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPick(s)}
            style={{
              position: 'absolute',
              left: p.x - left - (on ? 8 : 6),
              top: p.y - top - (on ? 8 : 6),
              width: on ? 16 : 12,
              height: on ? 16 : 12,
              background: 'var(--sk-signal)',
              border: `2px solid #000`,
              boxShadow: on ? '2px 2px 0 #000' : undefined,
              cursor: 'pointer',
              zIndex: on ? 3 : 2,
            }}
          />
        );
      })}
      {selPx && popup && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(4, selPx.x - left - 110), size.w - 224),
            // below the pin in the top half of the map, above it in the bottom half, so it stays in view
            ...(selPx.y - top < size.h / 2 ? { top: selPx.y - top + 14 } : { bottom: size.h - (selPx.y - top) + 14 }),
            zIndex: 4,
          }}
        >
          {popup}
        </div>
      )}
      <div
        style={{ position: 'absolute', right: 6, top: 6, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 5 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button style={button} onClick={() => zoom(1)} title="Zoom in">
          +
        </button>
        <button style={button} onClick={() => zoom(-1)} title="Zoom out">
          −
        </button>
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', right: 0, bottom: 0, background: '#fff', color: '#000', fontSize: 9, padding: '0 3px', zIndex: 5 }}
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
};

/** Everything about one spot: name, why, photos, and its moodboards, plans and shoots. Saves as you go. */
const SpotPanel: React.FC<{
  spot: Spot;
  onChange: () => void;
  onClose: () => void;
  onDeleted: () => void;
  onMovePin: () => void;
  onUpload: (files: File[]) => void;
  setMsg: (m: string) => void;
}> = ({ spot: s, onChange, onClose, onDeleted, onMovePin, onUpload, setMsg }) => {
  const api = useApi();
  const { me } = useMe();
  const { openWindow } = useWindowManager();
  const [draft, setDraft] = useState(s);
  const [boards, setBoards] = useState<{ id: string; name: string; kind: 'canvas' | 'kanban' }[]>([]);
  const [shootDay, setShootDay] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [big, setBig] = useState<Photo | null>(null);
  const [releases, setReleases] = useState<{ id: string; title: string }[]>([]);
  const addPhotos = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(s), [s]);
  useEffect(() => {
    api('/api/tracks').then(
      (d) => setReleases(d.releases),
      () => {},
    );
    Promise.all(['canvas', 'kanban'].map((k) => api(`/api/boards?kind=${k}`))).then(
      ([a, b]) => setBoards([...a, ...b].map((x) => ({ id: x.id, name: x.name, kind: x.kind || 'canvas' }))),
      () => {},
    );
  }, [api]);

  const save = async (body: object) => {
    try {
      await api(`/api/locations/${s.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg('');
      onChange();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const text = (k: 'name' | 'why' | 'address') => ({
    value: draft[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: e.target.value }),
    onBlur: () => draft[k] !== s[k] && save({ [k]: draft[k] }),
  });
  const linked = s.boards.map((b) => b.id);
  const openBoard = (b: { id: string; name: string; kind: string }) =>
    openWindow(
      b.kind === 'kanban'
        ? {
            id: `planner-${b.id}`,
            title: b.name,
            icon: '/images/icons/task-16x16.png?v=2',
            appType: 'planner',
            appProps: { boardId: b.id },
            width: 1000,
            height: 640,
          }
        : {
            id: `canvas-${b.id}`,
            title: b.name,
            icon: '/images/icons/paint-16x16.png?v=2',
            appType: 'canvas',
            appProps: { boardId: b.id, name: b.name },
            width: 1000,
            height: 680,
          },
    );
  const newBoard = async (kind: 'canvas' | 'kanban') => {
    const name = (
      await dialog.prompt(
        kind === 'kanban' ? 'Name the shoot plan:' : 'Name the moodboard:',
        `${s.name} ${kind === 'kanban' ? 'shoot plan' : 'moodboard'}`,
        {
          title: kind === 'kanban' ? 'New Plan' : 'New Board',
        },
      )
    )?.trim();
    if (!name) return;
    try {
      const b = await api('/api/boards', { method: 'POST', body: JSON.stringify({ name, kind }) });
      await save({ boards: [...linked, b.id] });
      openBoard(b);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const openShoot = (id: string) => {
    openStudio(openWindow, 'calendar');
    setTimeout(() => window.dispatchEvent(new CustomEvent('sk:timeline-entry', { detail: id })), 300); // after the tab mounts
  };
  const planShoot = async () => {
    try {
      const e = await api('/api/timeline', {
        method: 'POST',
        body: JSON.stringify({
          title: `Shoot at ${s.name}`,
          kind: 'Shoot',
          start: shootDay,
          location: s.address || s.name,
          place: s.id,
          release: s.release || null,
        }),
      });
      setShootDay('');
      onChange();
      openShoot(e.id);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const canManage = !!me && (s.owner === me.username || me.admin);

  return (
    <div style={panel}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input style={{ ...field, flex: 1, fontWeight: 700, fontSize: 13 }} {...text('name')} />
        <button style={button} onClick={onClose} title="Back to the map">
          <RetroIcon name="close" />
        </button>
      </div>
      <fieldset style={fieldset}>
        <legend>Why it's worth it</legend>
        <textarea
          rows={4}
          style={{ ...field, width: '100%', resize: 'vertical' }}
          placeholder="The light at golden hour, the mural, the empty lot, permits needed..."
          {...text('why')}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ ...field, flex: 1, minWidth: 120 }} placeholder="Address or how to find it" {...text('address')} />
          <button style={button} onClick={onMovePin}>
            <IconLabel icon="pin">{pinned(s) ? 'Move pin' : 'Place pin'}</IconLabel>
          </button>
          {pinned(s) && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...button, textDecoration: 'none', color: '#000' }}
            >
              <IconLabel icon="external">Directions</IconLabel>
            </a>
          )}
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Photos ({s.photos.length})</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {s.photos.map((p) => (
            <img
              key={p.id}
              src={photoUrl(p)}
              alt={p.name}
              title={`${p.name} · ${p.by}${p.taken ? ` · ${p.taken.slice(0, 10)}` : ''}`}
              style={{ ...thumb, width: 72, height: 72, cursor: 'zoom-in' }}
              loading="lazy"
              onClick={() => setBig(p)}
            />
          ))}
          <button style={{ ...button, width: 72, height: 72 }} onClick={() => addPhotos.current?.click()}>
            <IconLabel icon="plus">Add</IconLabel>
          </button>
          <input
            ref={addPhotos}
            type="file"
            accept="image/*,.heic,.heif,.dng"
            multiple
            hidden
            onChange={(e) => (onUpload([...(e.target.files || [])]), (e.target.value = ''))}
          />
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Moodboards and plans</legend>
        {s.boards.map((b) => (
          <div key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>
              {b.kind === 'kanban' ? 'Plan' : 'Moodboard'}: <b>{b.name}</b>
            </span>
            <button style={button} onClick={() => openBoard(b)}>
              <IconLabel icon="external">Open</IconLabel>
            </button>
            <button style={button} title="Unlink (the board stays)" onClick={() => save({ boards: linked.filter((x) => x !== b.id) })}>
              <RetroIcon name="close" />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value="" onChange={(e) => e.target.value && save({ boards: [...linked, e.target.value] })} style={field}>
            <option value="">Link a board...</option>
            {(['canvas', 'kanban'] as const).map((k) => (
              <optgroup key={k} label={k === 'kanban' ? 'Plans' : 'Moodboards'}>
                {boards
                  .filter((b) => b.kind === k && !linked.includes(b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button style={button} onClick={() => newBoard('canvas')}>
            <IconLabel icon="plus">New moodboard</IconLabel>
          </button>
          <button style={button} onClick={() => newBoard('kanban')}>
            <IconLabel icon="plus">New shoot plan</IconLabel>
          </button>
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Shoots here</legend>
        {s.shoots.map((x) => (
          <div key={x.id} style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: x.status === 'Cancelled' ? 0.55 : 1 }}>
            <span style={{ width: 90 }}>{day(x.start)}</span>
            <b style={{ flex: 1 }}>{x.title}</b>
            <span>{x.status}</span>
            <button style={button} onClick={() => openShoot(x.id)}>
              <IconLabel icon="calendar">Open</IconLabel>
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Plan a shoot on
          <input type="date" value={shootDay} onChange={(e) => setShootDay(e.target.value)} style={field} />
          <button className={shootDay ? 'sk-signal' : undefined} style={button} disabled={!shootDay} onClick={planShoot}>
            <IconLabel icon="calendar">Add to calendar</IconLabel>
          </button>
        </div>
      </fieldset>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        For
        <select
          value={s.release || ''}
          onChange={(e) => save({ release: e.target.value || null })}
          style={field}
          title="The release this spot is for: it shows in that release's Campaign in Music"
        >
          <option value="">(no release)</option>
          {releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        {me?.username === s.owner && (
          <label
            style={{ display: 'flex', gap: 3, alignItems: 'center' }}
            title="Only you see a draft spot (admins too) until you untick this"
          >
            <input type="checkbox" checked={!!s.draft} onChange={(e) => save({ draft: e.target.checked })} />
            Draft
          </label>
        )}
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={button} onClick={() => setChoosing(true)}>
            {s.members ? `🔒 ${s.members.length + 1} people can see this` : 'Everyone can see this'}...
          </button>
          <span style={{ flex: 1 }} />
          <button
            style={button}
            onClick={async () =>
              (await dialog.confirm(`Delete "${s.name}" and its ${s.photos.length} photos? Shoots and boards linked to it stay.`, {
                icon: 'warning',
              })) && api(`/api/locations/${s.id}`, { method: 'DELETE' }).then(onDeleted, (e) => setMsg(e.message))
            }
          >
            <IconLabel icon="close">Delete</IconLabel>
          </button>
        </div>
      )}
      {choosing && (
        <MembersPicker
          title={`Who can see "${s.name}"`}
          members={s.members ?? null}
          always={s.owner}
          note="Everyone = every member. Pick people to keep a spot private (you and admins always see it)."
          onSave={(m) => save({ members: m })}
          onClose={() => setChoosing(false)}
        />
      )}
      {big && (
        <div
          style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 10, display: 'flex', flexDirection: 'column' }}
          onClick={() => setBig(null)}
        >
          <img src={photoUrl(big)} alt={big.name} style={{ flex: 1, minHeight: 0, objectFit: 'contain' }} />
          <div style={{ color: '#fff', padding: 6, display: 'flex', gap: 8 }}>
            <span style={{ flex: 1 }}>
              {big.name} · {big.by}
              {big.taken ? ` · ${big.taken.replace('T', ' ')}` : ''}
              {big.lat !== undefined ? '' : ' · no GPS'}
            </span>
            {(big.by === me?.username || canManage) && (
              <button
                style={button}
                onClick={(e) => {
                  e.stopPropagation();
                  api(`/api/locations/${s.id}/photos/${big.id}`, { method: 'DELETE' }).then(
                    () => (setBig(null), onChange()),
                    (err) => setMsg(err.message),
                  );
                }}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const box: React.CSSProperties = { overflow: 'auto', background: '#fff', border: '2px inset #808080', minWidth: 0 };
const panel: React.CSSProperties = {
  ...box,
  position: 'absolute',
  top: 0,
  bottom: 0,
  right: 2,
  width: 'min(440px, calc(100% - 4px))',
  zIndex: 6,
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const popup: React.CSSProperties = {
  width: 220,
  background: '#fff',
  border: '2px solid #000',
  boxShadow: '3px 3px 0 #000',
  cursor: 'default',
};
const thumb: React.CSSProperties = {
  width: 36,
  height: 36,
  objectFit: 'cover',
  flexShrink: 0,
  display: 'inline-block',
  border: '1px solid #000',
};
const ellipsis: React.CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const dropHint: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: '3px dashed #000',
  background: 'rgba(255,255,255,.8)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  zIndex: 20,
  pointerEvents: 'none',
};
const field: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
};
const fieldset: React.CSSProperties = {
  border: '2px groove #fff',
  margin: 0,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export default Locations;
