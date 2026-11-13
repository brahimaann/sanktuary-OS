import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { button } from './TeamFiles';
import { useApi } from '../utils/api';

// Foundry's Session tab has three roles on the same cockpit: Recording (in Producer.tsx), Director and Stylist.
// Each one is a ribbon of settings that drives three panes: math on the left, the working list in the centre,
// a brief on the right. Numbers are starting points, not rules. A Director or Stylist plan is kept on the shoot picked
// in the role bar (so the whole crew sees it, in Foundry and on the shoot in Calendar); with no shoot, on this device.
// Session cockpit: 1px rules between every cell, monospace numbers, no padding to spare (S machine, 1-bit)
export const TOKENS = {
  '--fk-bg': '#fff',
  '--fk-ink': '#000',
  '--fk-dim': '#555',
  '--fk-rule': '#000',
  '--fk-head-bg': '#000',
  '--fk-head-ink': '#fff',
  '--fk-read': '#000',
  '--fk-warn': '#000',
} as React.CSSProperties;
// Fixed layout: the ribbon and three panes always fill the window and each pane scrolls on its own (like a DAW).
// On a narrow window (phone, tablet in portrait) the panes stack and the cockpit scrolls instead.
export const COCKPIT_CSS = `
.fk-cockpit { container-type: inline-size; }
.fk-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(280px, 1fr) minmax(240px, 1.1fr) minmax(250px, 1fr); overflow: hidden; }
.fk-grid > section { overflow: auto; }
.fk-cockpit input[type='checkbox'] { accent-color: var(--sk-signal, #4b9560); }
@container (max-width: 760px) {
  .fk-grid { grid-template-columns: 1fr; overflow: auto; }
  .fk-grid > section { overflow: visible; border-right: 0 !important; border-bottom: 1px solid var(--fk-rule); }
}
`;
export const rule = '1px solid var(--fk-rule)';
export const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Consolas, monospace', fontVariantNumeric: 'tabular-nums' };
export const cell: React.CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', padding: '4px 6px', borderRight: rule };
export const label: React.CSSProperties = { fontWeight: 700, textTransform: 'uppercase', fontSize: 10 };
export const pane: React.CSSProperties = { display: 'flex', flexDirection: 'column', borderRight: rule, minHeight: 0, overflow: 'auto' };
export const paneHead: React.CSSProperties = {
  margin: 0,
  padding: '2px 6px',
  background: 'var(--fk-head-bg)',
  color: 'var(--fk-head-ink)',
  fontSize: 11,
  position: 'sticky',
  top: 0,
};
export const grid: React.CSSProperties = { borderCollapse: 'collapse', width: '100%' };
export const gth: React.CSSProperties = { ...label, textAlign: 'left', padding: '2px 6px', borderBottom: rule };
export const gtd: React.CSSProperties = { padding: '1px 6px', borderBottom: '1px dotted var(--fk-rule)', whiteSpace: 'nowrap' };
export const num: React.CSSProperties = { ...gtd, ...mono, textAlign: 'right', color: 'var(--fk-read)' };
export const caption: React.CSSProperties = { padding: '2px 6px 4px', color: 'var(--fk-dim)', fontSize: 10, borderBottom: rule };
export const sfield: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 3px',
  background: 'var(--fk-bg)',
  color: 'var(--fk-ink)',
  border: rule,
};

/** The shoot the plan is being kept on: its saved halves, and how to save one. null = kept on this device. */
type Half = 'director' | 'stylist';
const ShootPlan = createContext<{ plan: Partial<Record<Half, object>>; save: (half: Half, value: object) => void } | null>(null);

/** A value kept on the picked shoot (when `half` is given and a shoot is picked), else in this browser
 * (private window: just not kept). */
function useKept<T>(key: string, blank: T, half?: Half): [T, (patch: Partial<T>) => void] {
  const shoot = useContext(ShootPlan);
  const on = half && shoot ? shoot : null;
  const [v, setV] = useState<T>(() => {
    if (on) return { ...blank, ...on.plan[half!] };
    try {
      return { ...blank, ...JSON.parse(localStorage.getItem(key) || '{}') };
    } catch {
      return blank;
    }
  });
  const set = (patch: Partial<T>) => {
    const n = { ...v, ...patch };
    setV(n);
    if (on) return on.save(half!, n as object);
    try {
      localStorage.setItem(key, JSON.stringify(n));
    } catch {
      /* not kept */
    }
  };
  return [v, set];
}

const Cockpit: React.FC<{ ribbon: React.ReactNode; children: React.ReactNode }> = ({ ribbon, children }) => (
  <div
    className="fk-cockpit"
    style={{
      ...TOKENS,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      background: 'var(--fk-bg)',
      color: 'var(--fk-ink)',
    }}
  >
    <style>{COCKPIT_CSS}</style>
    <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: rule }}>{ribbon}</div>
    <div className="fk-grid">{children}</div>
  </div>
);

const Pick: React.FC<{
  name: string;
  value: string | number;
  options: (string | number)[];
  onChange: (v: string) => void;
  last?: boolean;
}> = ({ name, value, options, onChange, last }) => (
  <div style={last ? { ...cell, borderRight: 0 } : cell}>
    <span style={label}>{name}</span>
    <select style={sfield} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  </div>
);

const Table: React.FC<{ head: string[]; rows: (string | number)[][]; wrap?: boolean }> = ({ head, rows, wrap }) => (
  <table style={grid}>
    <thead>
      <tr>
        {head.map((h) => (
          <th key={h} style={gth}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <tr key={i}>
          {r.map((c, j) => (
            <td key={j} style={j ? (wrap ? { ...num, whiteSpace: 'normal' } : num) : gtd}>
              {c}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** A checklist kept on this device: add a line, tick it off, remove it. */
interface Item {
  text: string;
  done?: boolean;
}
const List: React.FC<{ items: Item[]; set: (items: Item[]) => void; placeholder: string }> = ({ items, set, placeholder }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    set([...items, { text: draft.trim() }]);
    setDraft('');
  };
  return (
    <div style={{ padding: '4px 6px', borderBottom: rule }}>
      {items.map((it, i) => (
        <label key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '1px 0' }}>
          <input
            type="checkbox"
            checked={!!it.done}
            onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
          />
          <span style={{ ...mono, color: 'var(--fk-dim)' }}>{String(i + 1).padStart(2, '0')}</span>
          <span style={{ flex: 1, ...(it.done ? { textDecoration: 'line-through', color: 'var(--fk-dim)' } : {}) }}>{it.text}</span>
          <button
            style={{ ...button, padding: '0 4px' }}
            title="Remove"
            onClick={(e) => (e.preventDefault(), set(items.filter((_, j) => j !== i)))}
          >
            ×
          </button>
        </label>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input
          style={{ ...sfield, flex: 1, minWidth: 0 }}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button style={button} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
};

const Checks: React.FC<{ title: string; items: string[]; done: Record<string, boolean>; set: (d: Record<string, boolean>) => void }> = ({
  title,
  items,
  done,
  set,
}) => (
  <div style={{ padding: '4px 6px', borderBottom: rule }}>
    <div style={label}>
      {title}{' '}
      <span style={mono}>
        {items.filter((c) => done[c]).length}/{items.length}
      </span>
    </div>
    {items.map((c) => (
      <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '1px 0' }}>
        <input type="checkbox" checked={!!done[c]} onChange={(e) => set({ ...done, [c]: e.target.checked })} />
        <span style={done[c] ? { textDecoration: 'line-through', color: 'var(--fk-dim)' } : undefined}>{c}</span>
      </label>
    ))}
  </div>
);

// ---- Director / cinematographer ----

const SENSORS: Record<string, [number, number]> = {
  'Full frame': [36, 24],
  'Super 35': [24.9, 14],
  'APS-C': [23.5, 15.6],
  'Micro 4/3': [17.3, 13],
  'Phone (1/1.3")': [9.8, 7.4],
};
const FOCALS = [14, 18, 24, 35, 50, 85, 135];
const LENS_NOTES: [string, string][] = [
  ['14-18mm', 'Wide establishing, rooms, cars; distorts faces up close.'],
  ['24mm', 'Wide but natural: walk-and-talks, dance, group shots.'],
  ['35mm', 'Closest to the eye: the everyday storytelling lens.'],
  ['50mm', 'Standard: mid shots and clean product.'],
  ['85mm', 'Portraits and close-ups; soft background.'],
  ['135mm', 'Compression and isolation from far away; needs support.'],
];
const RIG = [
  'Batteries charged (camera, monitor, lights, mics)',
  'Cards formatted, enough for the day',
  'Lenses cleaned, caps in the bag',
  'Frame rate, shutter and resolution set and matched across cameras',
  'White balance set or a grey card shot',
  'ND filters packed for daylight at 180°',
  'Tripod plate, sandbags, gimbal balanced',
  'Audio: slate or clap per take, room tone recorded',
];
const ft = (m: number) => (m * 3.281).toFixed(1);

const DirectorCockpit: React.FC = () => {
  const [d, set] = useKept(
    'sk:foundry-director',
    {
      fps: '23.976',
      angle: '180',
      aspect: '2.39',
      sensor: 'Full frame',
      stop: '2.8',
      iso: '800',
      subject: '3',
      shots: [] as Item[],
      rig: {} as Record<string, boolean>,
    },
    'director',
  );
  const fps = Number(d.fps);
  const t = Number(d.angle) / 360 / fps; // exposure time in seconds
  const [w, h] = SENSORS[d.sensor] || SENSORS['Full frame'];
  const diag = Math.hypot(w, h);
  const crop = 43.27 / diag;
  const coc = diag / 1500; // circle of confusion, mm
  const N = Number(d.stop);
  const s = Number(d.subject) * 1000; // mm
  const lux = (250 * N * N) / (t * Number(d.iso)); // incident light for a normal exposure (C = 250)
  const ar = Number(d.aspect);
  const uhdH = Math.min(2160, Math.round(3840 / ar));
  return (
    <Cockpit
      ribbon={
        <>
          <Pick
            name="FPS"
            value={d.fps}
            options={['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '120']}
            onChange={(fps) => set({ fps })}
          />
          <Pick
            name="Shutter"
            value={d.angle}
            options={['45', '90', '144', '172.8', '180', '270', '360']}
            onChange={(angle) => set({ angle })}
          />
          <Pick name="Aspect" value={d.aspect} options={['1.33', '1.78', '1.85', '2.00', '2.39']} onChange={(aspect) => set({ aspect })} />
          <Pick name="Sensor" value={d.sensor} options={Object.keys(SENSORS)} onChange={(sensor) => set({ sensor })} />
          <Pick name="f/" value={d.stop} options={['1.4', '2', '2.8', '4', '5.6', '8', '11', '16']} onChange={(stop) => set({ stop })} />
          <Pick name="ISO" value={d.iso} options={['100', '200', '400', '800', '1600', '3200', '6400']} onChange={(iso) => set({ iso })} />
          <div style={{ ...cell, borderRight: 0 }}>
            <span style={label}>Subject</span>
            <input
              style={{ ...sfield, width: 48 }}
              type="number"
              min={0.3}
              step={0.1}
              value={d.subject}
              onChange={(e) => set({ subject: e.target.value })}
              aria-label="Subject distance in metres"
            />
            <span style={mono}>m</span>
          </div>
        </>
      }
    >
      <section style={pane}>
        <h3 style={paneHead}>Camera math</h3>
        <Table
          wrap
          head={['Exposure', '']}
          rows={[
            ['Shutter speed', `1/${Math.round(1 / t)} s`],
            ['Light needed', `${Math.round(lux)} lux · ${Math.round(lux / 10.764)} fc`],
            ['Frames in 10 s / 30 s / 60 s', `${Math.round(fps * 10)} / ${Math.round(fps * 30)} / ${Math.round(fps * 60)}`],
            [`${d.aspect}:1 in UHD`, `3840 × ${uhdH}${uhdH < 2160 ? ` (bars ${Math.round((2160 - uhdH) / 2)} px)` : ''}`],
          ]}
        />
        <div style={caption}>
          180° (1/{Math.round(fps * 2)} s) gives natural motion blur. Light is the incident level for a normal exposure at f/{d.stop}, ISO{' '}
          {d.iso}.
        </div>
        <Table
          head={['mm', 'FF eq.', 'H-FOV', 'Near', 'Far', 'Hyperfocal']}
          rows={FOCALS.map((f) => {
            const H = (f * f) / (N * coc) + f;
            const near = (s * H) / (H + (s - f));
            const far = s >= H ? Infinity : (s * H) / (H - (s - f));
            return [
              f,
              Math.round(f * crop),
              `${Math.round((2 * Math.atan(w / (2 * f)) * 180) / Math.PI)}°`,
              `${(near / 1000).toFixed(2)} m`,
              far === Infinity ? '∞' : `${(far / 1000).toFixed(2)} m`,
              `${(H / 1000).toFixed(1)} m`,
            ];
          })}
        />
        <div style={caption}>
          Depth of field at {d.subject} m ({ft(Number(d.subject))} ft), {d.sensor} (crop {crop.toFixed(2)}×). Focus at the hyperfocal
          distance and everything from half of it to infinity is sharp.
        </div>
      </section>
      <section style={pane}>
        <h3 style={paneHead}>Shot list</h3>
        <List items={d.shots} set={(shots) => set({ shots })} placeholder="e.g. Wide, artist walks in, 24mm, dolly" />
      </section>
      <section style={{ ...pane, borderRight: 0 }}>
        <h3 style={paneHead}>Brief: camera and lenses</h3>
        <Checks title="Rig checklist" items={RIG} done={d.rig} set={(rig) => set({ rig })} />
        <div style={{ padding: '4px 6px' }}>
          <div style={label}>Lenses</div>
          {LENS_NOTES.map(([l, n]) => (
            <div key={l} style={{ padding: '1px 0' }}>
              <b style={mono}>{l}</b> {n}
            </div>
          ))}
        </div>
      </section>
    </Cockpit>
  );
};

// ---- Stylist / apparel ----

// Base spec for size M (inches) and yards of 60" fabric per piece, before shrinkage and cutting waste
const BLOCKS: Record<string, { chest: number; length: number; yards: number; grade: [number, number]; fabric: string }> = {
  'Boxy tee': { chest: 22, length: 27, yards: 0.9, grade: [1.5, 1], fabric: 'Jersey' },
  Hoodie: { chest: 24, length: 28, yards: 1.75, grade: [2, 1], fabric: 'Fleece / French terry' },
  Crewneck: { chest: 23, length: 27, yards: 1.4, grade: [2, 1], fabric: 'Fleece / French terry' },
  Shorts: { chest: 16, length: 19, yards: 0.9, grade: [1, 0.5], fabric: 'Fleece / twill' },
  'Track pant': { chest: 16, length: 41, yards: 1.5, grade: [1, 0.5], fabric: 'Fleece / nylon' },
};
const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const SEAMS: [string, string][] = [
  ['Overlocked knit seams', '3/8" (1 cm)'],
  ['Woven seams', '5/8" (1.5 cm)'],
  ['Hems, coverstitch', '1" (2.5 cm)'],
  ['Neck rib, set-in', '3/8" (1 cm)'],
  ['Zip openings', '5/8" (1.5 cm)'],
];
const ALTERATIONS = [
  'Photograph the piece before any change',
  'Pin, try on, then mark with chalk; never cut on the body',
  'Take in at side seams first, hems last',
  'Use temporary fixes (clips, tape) on pulls you must return',
  'Steam everything before it goes on camera',
  "Note what changed on the piece's pull line",
];

const StylistCockpit: React.FC = () => {
  const [st, set] = useKept(
    'sk:foundry-stylist',
    {
      block: 'Boxy tee',
      gsm: '280',
      width: '60',
      shrink: '5',
      run: { S: 10, M: 20, L: 20, XL: 10 } as Record<string, number>,
      looks: [] as Item[],
      pulls: [] as Item[],
      alt: {} as Record<string, boolean>,
    },
    'stylist',
  );
  const b = BLOCKS[st.block] || BLOCKS['Boxy tee'];
  const shrink = Number(st.shrink) / 100;
  const width = Number(st.width);
  const units = SIZES.reduce((a, z) => a + (Number(st.run[z]) || 0), 0);
  const perPiece = b.yards * (60 / width) * (1 + shrink) * 1.1; // 10% cutting waste
  const yards = units * perPiece;
  const grams = perPiece * 0.9144 * (width * 0.0254) * Number(st.gsm);
  return (
    <Cockpit
      ribbon={
        <>
          <Pick name="Block" value={st.block} options={Object.keys(BLOCKS)} onChange={(block) => set({ block })} />
          <Pick
            name="GSM"
            value={st.gsm}
            options={['160', '180', '200', '240', '280', '320', '360', '400', '450']}
            onChange={(gsm) => set({ gsm })}
          />
          <Pick name='Width"' value={st.width} options={['44', '54', '58', '60', '66', '72']} onChange={(width) => set({ width })} />
          <Pick name="Shrink %" value={st.shrink} options={['0', '2', '3', '5', '7', '10']} onChange={(shrink) => set({ shrink })} />
          <div style={{ ...cell, borderRight: 0, flexWrap: 'wrap' }}>
            <span style={label}>Run</span>
            {SIZES.map((z) => (
              <label key={z} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <span style={mono}>{z}</span>
                <input
                  style={{ ...sfield, width: 38 }}
                  type="number"
                  min={0}
                  value={st.run[z] || 0}
                  onChange={(e) => set({ run: { ...st.run, [z]: Number(e.target.value) } })}
                  aria-label={`Units in ${z}`}
                />
              </label>
            ))}
          </div>
        </>
      }
    >
      <section style={pane}>
        <h3 style={paneHead}>Fabric math</h3>
        <Table
          head={['Yield', '']}
          rows={[
            ['Units', units],
            ['Yards per piece', perPiece.toFixed(2)],
            ['Yards to order', `${Math.ceil(yards)} yd (${(yards * 0.9144).toFixed(1)} m)`],
            ['Fabric used per piece', `${Math.round(grams)} g`],
          ]}
        />
        <div style={caption}>
          {st.block} in {b.fabric}, {st.width}" wide, {st.shrink}% shrinkage and 10% cutting waste. Order 5% over for test washes.
        </div>
        <Table
          head={['Size', 'Chest ½', 'Length', 'Cut chest', 'Cut length']}
          rows={SIZES.map((z, i) => {
            const step = i - 2;
            const chest = b.chest + step * b.grade[0];
            const len = b.length + step * b.grade[1];
            return [z, `${chest}"`, `${len}"`, `${(chest / (1 - shrink)).toFixed(2)}"`, `${(len / (1 - shrink)).toFixed(2)}"`];
          })}
        />
        <div style={caption}>
          Finished measurements from a base M, graded {b.grade[0]}" chest and {b.grade[1]}" length per size. Cut sizes add the shrinkage
          back.
        </div>
        <Table head={['Seam allowance', '']} rows={SEAMS} />
      </section>
      <section style={pane}>
        <h3 style={paneHead}>Looks</h3>
        <List items={st.looks} set={(looks) => set({ looks })} placeholder="e.g. Look 3: boxy tee black, track pant, white AF1" />
      </section>
      <section style={{ ...pane, borderRight: 0 }}>
        <h3 style={paneHead}>Brief: pulls and alterations</h3>
        <div style={{ ...label, padding: '4px 6px 0' }}>Pulls (tick when returned)</div>
        <List items={st.pulls} set={(pulls) => set({ pulls })} placeholder="e.g. Jacket from showroom X, back Fri" />
        <Checks title="Alterations" items={ALTERATIONS} done={st.alt} set={(alt) => set({ alt })} />
      </section>
    </Cockpit>
  );
};

// ---- Role switch ----

interface Shoot {
  id: string;
  source?: string;
  title: string;
  kind: string;
  start: string;
  plan?: Partial<Record<Half, object>>;
}
const ROLES = ['Recording', 'Director', 'Stylist'] as const;
type Role = (typeof ROLES)[number];

/** The Session tab: a role bar, then that role's cockpit. Recording is passed in from Producer. */
export const FoundryRoles: React.FC<{ recording: React.ReactNode }> = ({ recording }) => {
  const [r, set] = useKept<{ role: Role; shoot: string }>('sk:foundry-role', { role: 'Recording', shoot: '' });
  // Shoots and videos on the Calendar: pick one and the Director / Stylist plan lives on it, for everyone on the shoot
  const api = useApi();
  const [shoots, setShoots] = useState<Shoot[]>([]);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    api('/api/timeline').then(
      (d: { items: Shoot[] }) =>
        setShoots(d.items.filter((i) => !i.source && ['Shoot', 'Video'].includes(i.kind)).sort((a, b) => b.start.localeCompare(a.start))),
      () => {},
    );
  }, [api]);
  const shoot = shoots.find((s) => s.id === r.shoot);
  const timer = useRef<number | undefined>(undefined);
  const save = (half: Half, value: object) => {
    shoot!.plan = { ...shoot!.plan, [half]: value };
    setSaved('Saving...');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () =>
        api(`/api/timeline/${shoot!.id}`, { method: 'PATCH', body: JSON.stringify({ plan: { [half]: value } }) }).then(
          () => setSaved('Saved on the shoot'),
          (e: Error) => setSaved(e.message),
        ),
      700,
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '3px 6px', borderBottom: '1px solid #000' }}>
        <span style={label}>Role</span>
        {ROLES.map((x) => (
          <button
            key={x}
            style={{ ...button, ...(r.role === x ? { background: 'var(--sk-signal, #4b9560)', color: '#000', fontWeight: 700 } : {}) }}
            aria-pressed={r.role === x}
            onClick={() => set({ role: x })}
          >
            {x}
          </button>
        ))}
        {r.role !== 'Recording' && (
          <>
            <span style={{ ...label, marginLeft: 8 }}>Shoot</span>
            <select
              style={{ ...sfield, maxWidth: 220 }}
              value={shoot ? shoot.id : ''}
              onChange={(e) => (setSaved(''), set({ shoot: e.target.value }))}
              title="Keep this plan on a shoot from the Calendar, so the whole crew sees it"
            >
              <option value="">(only on this device)</option>
              {shoots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.start} {s.title}
                </option>
              ))}
            </select>
            <span style={{ color: 'var(--fk-dim, #555)' }}>
              {shoot ? saved || 'Kept on the shoot: the crew sees it' : shoots.length ? '' : 'Add a shoot in Calendar to share this plan'}
            </span>
          </>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ShootPlan.Provider value={shoot ? { plan: shoot.plan || {}, save } : null}>
          {r.role === 'Director' ? (
            <DirectorCockpit key={shoot?.id} />
          ) : r.role === 'Stylist' ? (
            <StylistCockpit key={shoot?.id} />
          ) : (
            recording
          )}
        </ShootPlan.Provider>
      </div>
    </div>
  );
};
