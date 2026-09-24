import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { analyzeAudio, Analysis, noteTimes, reverbTimes, scaleOf, compatibleKeys, keyName } from '../utils/audioAnalysis';
import { shell, button, statusBar } from './TeamFiles';
import FilePicker from '../components/FilePicker';
import { fileKind } from './fileTypes';
import { IconLabel } from '../components/RetroIcon';
import { GUIDE } from './producerGuide';

// Producer: a companion for making music. Drop a song to get its tempo, key, loudness and tonal balance
// (worked out in the browser: nothing is uploaded), compare a mix with a reference, get delay and reverb times
// for the tempo, the key's scale and chords, and a guide of chains, tips and tools. Open to everyone.
type Tab = 'analyze' | 'compare' | 'tempo' | 'guide';
const TABS: [Tab, string][] = [
  ['analyze', 'Analyze'],
  ['compare', 'Compare'],
  ['tempo', 'Tempo & key'],
  ['guide', 'Guide'],
];
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const db = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-∞');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const Producer: React.FC = () => {
  const [tab, setTab] = useState<Tab>('analyze');
  const [mine, setMine] = useState<Named | null>(null);
  const [bpm, setBpm] = useState(110);
  const [key, setKey] = useState<{ root: number; minor: boolean }>({ root: 9, minor: true });
  // A finished analysis feeds the tempo and key tools
  const adopt = (a: Named) => {
    setMine(a);
    if (a.result.tempo) setBpm(a.result.tempo.bpm);
    if (a.result.key) setKey({ root: a.result.key.root, minor: a.result.key.minor });
  };
  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0' }}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              ...button,
              borderBottom: tab === id ? 'none' : button.borderBottom,
              fontWeight: tab === id ? 700 : 400,
              position: 'relative',
              top: tab === id ? 1 : 0,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#c0c0c0', borderTop: '1px solid #fff', padding: 8 }}>
        {tab === 'analyze' && <AnalyzeTab current={mine} onDone={adopt} />}
        {tab === 'compare' && <CompareTab mine={mine} onMine={adopt} onClearMine={() => setMine(null)} />}
        {tab === 'tempo' && <TempoTab bpm={bpm} setBpm={setBpm} keySel={key} setKey={setKey} />}
        {tab === 'guide' && <GuideTab />}
      </div>
      <div style={statusBar}>Files are measured on this device. Nothing is uploaded.</div>
    </div>
  );
};

interface Named {
  name: string;
  result: Analysis;
}

/** Choose a file from this device or from Team Files, then analyse it. */
const Picker: React.FC<{ label: string; onDone: (a: Named) => void }> = ({ label, onDone }) => {
  const { isSignedIn, getToken } = useAuth();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [picking, setPicking] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = async (name: string, load: () => Promise<ArrayBuffer>) => {
    setErr('');
    try {
      setBusy(`Opening ${name}...`);
      const result = await analyzeAudio(await load(), setBusy);
      onDone({ name, result });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const fromDevice = (f?: File) => {
    if (!f) return;
    if (f.size > 500 * 1024 ** 2) return setErr('That file is over 500 MB. Bounce an MP3 or a shorter section.');
    run(f.name, () => f.arrayBuffer());
  };
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        fromDevice(e.dataTransfer.files[0]);
      }}
      style={{
        border: `2px dashed ${over ? '#000080' : '#808080'}`,
        background: over ? '#e8e8ff' : '#dcdcdc',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'center',
        textAlign: 'center',
        position: 'relative',
      }}
    >
      <b>{label}</b>
      <div style={{ color: '#444' }}>Drop a song here, or</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button style={button} disabled={!!busy} onClick={() => input.current?.click()}>
          <IconLabel icon="upload">From this device...</IconLabel>
        </button>
        {isSignedIn && (
          <button style={button} disabled={!!busy} onClick={() => setPicking(true)}>
            <IconLabel icon="link">From Team Files...</IconLabel>
          </button>
        )}
      </div>
      {busy && <div style={{ color: '#000080' }}>{busy}</div>}
      {err && <div style={{ color: '#a00000' }}>{err}</div>}
      <input
        ref={input}
        type="file"
        hidden
        accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.m4a,.ogg"
        onChange={(e) => {
          fromDevice(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {picking && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000 }}>
          <FilePicker
            title="Choose a song"
            mode="file"
            accept={(n) => fileKind(n) === 'audio'}
            onPick={(r) => {
              setPicking(false);
              if (!r) return;
              run(r.path.split('/').pop()!, async () => {
                const res = await fetch(`/api/files/${r.space}/${r.path.split('/').map(encodeURIComponent).join('/')}`, {
                  headers: { Authorization: `Bearer ${await getToken()}` },
                });
                if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
                return res.arrayBuffer();
              });
            }}
          />
        </div>
      )}
    </div>
  );
};

const AnalyzeTab: React.FC<{ current: Named | null; onDone: (a: Named) => void }> = ({ current, onDone }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Picker label="What's in this song?" onDone={onDone} />
    {current && <Report a={current} />}
  </div>
);

const Report: React.FC<{ a: Named }> = ({ a: { name, result: r } }) => {
  const k = r.key;
  const t = r.tempo;
  const loud = !Number.isFinite(r.lufs)
    ? 'silent'
    : r.lufs > -9
      ? 'very loud (streaming will turn it down a lot)'
      : r.lufs > -13
        ? 'loud, typical of a finished master'
        : r.lufs > -16
          ? 'around streaming level'
          : 'quiet: fine for a mix, low for a master';
  return (
    <fieldset style={box}>
      <legend>
        <b>{name}</b>
      </legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        <Stat
          label="Tempo"
          value={t ? `${t.bpm} BPM` : '?'}
          note={
            t
              ? `${t.confidence > 0.5 ? 'clear beat' : 'loose beat: check it'}${t.alternatives.length ? ` · or ${t.alternatives.join(' / ')}` : ''}`
              : 'too short to tell'
          }
        />
        <Stat
          label="Key"
          value={k ? k.name : '?'}
          note={k ? `${k.camelot} · relative ${k.relative}${k.confidence < 0.4 ? ' · unsure' : ''}` : ''}
        />
        <Stat label="Loudness" value={`${db(r.lufs)} LUFS`} note={loud} />
        <Stat label="Peak" value={`${db(r.peak)} dBFS`} note={r.peak > -0.3 ? 'touching 0: may clip after encoding' : 'headroom ok'} />
        <Stat
          label="Stereo"
          value={r.correlation === null ? 'mono file' : r.correlation.toFixed(2)}
          note={
            r.correlation === null
              ? ''
              : r.correlation < 0
                ? 'phase trouble: check in mono'
                : r.correlation > 0.9
                  ? 'nearly mono'
                  : 'healthy width'
          }
        />
        <Stat
          label="File"
          value={clock(r.duration)}
          note={r.channels === 1 ? 'mono' : r.channels === 2 ? 'stereo' : `${r.channels} channels`}
        />
      </div>
      <Bands bands={r.bands} />
      <SaveToTrack a={r} />
    </fieldset>
  );
};

const Stat: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div style={{ background: '#fff', border: '2px inset #808080', padding: 6 }}>
    <div style={{ color: '#666', fontSize: 10 }}>{label}</div>
    <div style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
    {note && <div style={{ color: '#444', fontSize: 10 }}>{note}</div>}
  </div>
);

/** Tonal balance bars: each band's share of the energy (0 dB = all of it). */
const Bands: React.FC<{ bands: { name: string; db: number }[]; other?: { name: string; db: number }[] }> = ({ bands, other }) => (
  <div style={{ marginTop: 8 }}>
    <div style={{ color: '#444', marginBottom: 4 }}>Tonal balance{other ? ' (navy: yours, grey: reference)' : ''}</div>
    {bands.map((b, i) => {
      const w = (v: number) => `${Math.max(2, Math.min(100, 100 + v * 2.5))}%`; // -40 dB .. 0 dB
      return (
        <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 60px', gap: 6, alignItems: 'center', marginBottom: 2 }}>
          <span>{b.name}</span>
          <div style={{ background: '#fff', border: '1px solid #808080', height: other ? 14 : 10, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: other ? '50%' : '100%', width: w(b.db), background: '#000080' }} />
            {other && (
              <div style={{ position: 'absolute', left: 0, bottom: 0, height: '50%', width: w(other[i].db), background: '#808080' }} />
            )}
          </div>
          <span style={{ textAlign: 'right' }}>
            {other ? `${b.db - other[i].db > 0 ? '+' : ''}${(b.db - other[i].db).toFixed(1)} dB` : `${b.db} dB`}
          </span>
        </div>
      );
    })}
  </div>
);

/** Members: put the tempo and key on a song in Tracks. */
const SaveToTrack: React.FC<{ a: Analysis }> = ({ a }) => {
  const { isSignedIn } = useAuth();
  const api = useApi();
  const [tracks, setTracks] = useState<{ id: string; title: string; release: string }[]>([]);
  const [id, setId] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (isSignedIn)
      api('/api/tracks').then(
        (d) => setTracks(d.tracks),
        () => {},
      );
  }, [api, isSignedIn]);
  if (!isSignedIn || !tracks.length || (!a.tempo && !a.key)) return null;
  const save = async () => {
    try {
      await api(`/api/tracks/track/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...(a.tempo ? { bpm: String(Math.round(a.tempo.bpm)) } : {}), ...(a.key ? { key: a.key.short } : {}) }),
      });
      setMsg('Saved to the track.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
      Save tempo and key to
      <select style={field} value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">(choose a track)</option>
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <button style={button} disabled={!id} onClick={save}>
        Save
      </button>
      {msg}
    </div>
  );
};

/** Your mix next to a reference, at matched loudness: where the balance differs. */
const CompareTab: React.FC<{ mine: Named | null; onMine: (a: Named) => void; onClearMine: () => void }> = ({
  mine,
  onMine,
  onClearMine,
}) => {
  const [ref, setRef] = useState<Named | null>(null);
  const diffs =
    mine && ref
      ? mine.result.bands
          .map((b, i) => ({ name: b.name, d: b.db - ref.result.bands[i].db }))
          .filter((x) => Math.abs(x.d) >= 2)
          .map((x) => `${x.name}: ${Math.abs(x.d).toFixed(1)} dB ${x.d > 0 ? 'more' : 'less'} than the reference`)
      : [];
  const loud =
    mine && ref && Number.isFinite(mine.result.lufs) && Number.isFinite(ref.result.lufs) ? mine.result.lufs - ref.result.lufs : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ color: '#444' }}>
        Pick a released song you'd like yours to sit next to. The balance is compared as shares of each song's own energy, so the louder
        master doesn't win just by being louder.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        {mine ? <Slot title="Your mix" a={mine} onClear={onClearMine} /> : <Picker label="Your mix" onDone={onMine} />}
        {ref ? <Slot title="Reference" a={ref} onClear={() => setRef(null)} /> : <Picker label="Reference song" onDone={setRef} />}
      </div>
      {mine && ref && (
        <fieldset style={box}>
          <legend>
            <b>Side by side</b>
          </legend>
          {loud !== null && (
            <div>
              Loudness: yours is{' '}
              <b>
                {Math.abs(loud).toFixed(1)} dB {loud > 0 ? 'louder' : 'quieter'}
              </b>
              . Turn the louder one down by that much before listening, or you'll prefer it for being loud.
            </div>
          )}
          {mine.result.tempo && ref.result.tempo && (
            <div>
              Tempo: {mine.result.tempo.bpm} vs {ref.result.tempo.bpm} BPM. Key: {mine.result.key?.name || '?'} vs{' '}
              {ref.result.key?.name || '?'}
            </div>
          )}
          <Bands bands={mine.result.bands} other={ref.result.bands} />
          <div style={{ marginTop: 6 }}>
            {diffs.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {diffs.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : (
              'The balance is within 2 dB of the reference in every band.'
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
};

const Slot: React.FC<{ title: string; a: Named; onClear: () => void }> = ({ title, a, onClear }) => (
  <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 2, background: '#dcdcdc' }}>
    <b>{title}</b>
    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
    <div>
      {db(a.result.lufs)} LUFS · {a.result.tempo?.bpm ?? '?'} BPM · {a.result.key?.short ?? '?'}
    </div>
    <div>
      <button style={button} onClick={onClear}>
        Choose another
      </button>
    </div>
  </div>
);

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const TempoTab: React.FC<{
  bpm: number;
  setBpm: (n: number) => void;
  keySel: { root: number; minor: boolean };
  setKey: (k: { root: number; minor: boolean }) => void;
}> = ({ bpm, setBpm, keySel, setKey }) => {
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now].slice(-8);
    if (taps.current.length >= 3) {
      const gaps = taps.current.slice(1).map((t, i) => t - taps.current[i]);
      setBpm(Math.round((60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)) * 10) / 10);
    }
  };
  const valid = bpm >= 20 && bpm <= 400;
  const scale = scaleOf(keySel.root, keySel.minor);
  const camelotKey = (() => {
    const maj = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
    const min = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
    return `${keySel.minor ? min[keySel.root] : maj[keySel.root]}${keySel.minor ? 'A' : 'B'}`;
  })();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        Tempo
        <input
          style={{ ...field, width: 70 }}
          type="number"
          min={20}
          max={400}
          step={0.1}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
        />
        BPM
        <button style={button} onClick={tap} title="Tap along with the beat">
          Tap
        </button>
        <span style={{ width: 12 }} />
        Key
        <select style={field} value={keySel.root} onChange={(e) => setKey({ ...keySel, root: Number(e.target.value) })}>
          {NOTE_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select
          style={field}
          value={keySel.minor ? 'minor' : 'major'}
          onChange={(e) => setKey({ ...keySel, minor: e.target.value === 'minor' })}
        >
          <option>major</option>
          <option>minor</option>
        </select>
      </div>
      {valid && (
        <>
          <fieldset style={box}>
            <legend>
              <b>Delay and LFO times at {bpm} BPM</b>
            </legend>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Note', 'Straight', 'Dotted', 'Triplet', 'LFO rate'].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {noteTimes(bpm).map((n) => (
                  <tr key={n.name}>
                    <td style={td}>{n.name}</td>
                    <td style={td}>{ms(n.ms)}</td>
                    <td style={td}>{ms(n.dotted)}</td>
                    <td style={td}>{ms(n.triplet)}</td>
                    <td style={td}>{n.hz.toFixed(2)} Hz</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
          <fieldset style={box}>
            <legend>
              <b>Reverbs that move with the song</b>
            </legend>
            <div style={{ color: '#444', marginBottom: 4 }}>
              Pre-delay keeps the dry sound clear before the reverb arrives; pre-delay + decay ends on a note, so tails die out in time.
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Space', 'Pre-delay', 'Decay', 'Good for'].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reverbTimes(bpm).map((r) => (
                  <tr key={r.name}>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{ms(r.predelay)}</td>
                    <td style={td}>{ms(r.decay)}</td>
                    <td style={td}>{r.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ color: '#444', marginTop: 4 }}>
              Compressor release: try {ms(60000 / bpm / 4)} (1/16) for punch or {ms(60000 / bpm / 2)} (1/8) for smoother pumping.
            </div>
          </fieldset>
        </>
      )}
      <fieldset style={box}>
        <legend>
          <b>{keyName(keySel.root, keySel.minor)}</b> ({camelotKey})
        </legend>
        <div>
          Notes: <b>{scale.notes.join(' ')}</b>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {scale.chords.map((c) => (
            <span key={c.numeral} style={{ background: '#fff', border: '1px solid #808080', padding: '2px 6px' }}>
              <span style={{ color: '#666' }}>{c.numeral}</span> <b>{c.chord}</b>
            </span>
          ))}
        </div>
        <div style={{ marginTop: 4 }}>
          Mixes well with: {compatibleKeys(camelotKey).join(', ')} (Camelot). Relative {keySel.minor ? 'major' : 'minor'}:{' '}
          {keyName(keySel.minor ? (keySel.root + 3) % 12 : (keySel.root + 9) % 12, !keySel.minor)}.
        </div>
      </fieldset>
    </div>
  );
};

const GuideTab: React.FC = () => {
  const [open, setOpen] = useState(GUIDE[0].title);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {GUIDE.map((s) => (
        <fieldset key={s.title} style={{ ...box, padding: open === s.title ? '4px 10px 10px' : '2px 10px' }}>
          <legend>
            <button style={{ ...button, fontWeight: 700 }} onClick={() => setOpen(open === s.title ? '' : s.title)}>
              {open === s.title ? '−' : '+'} {s.title}
            </button>
          </legend>
          {open === s.title && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.intro && <div style={{ color: '#444' }}>{s.intro}</div>}
              {s.items.map((it) => (
                <div key={it.name}>
                  <b>{it.name}</b>
                  {it.steps ? (
                    <ol style={{ margin: '2px 0 0', paddingLeft: 20 }}>
                      {it.steps.map((st) => (
                        <li key={st}>{st}</li>
                      ))}
                    </ol>
                  ) : (
                    <div>{it.text}</div>
                  )}
                  {it.link && (
                    <a href={it.link} target="_blank" rel="noopener noreferrer">
                      {new URL(it.link).hostname.replace(/^www\./, '')}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      <div style={{ color: '#666', fontSize: 10 }}>Starting points, not rules: trust your ears and your references.</div>
    </div>
  );
};

const box: React.CSSProperties = { border: '2px groove #fff', margin: 0, padding: '4px 10px 10px' };
const field: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 3px',
  background: '#fff',
  border: '2px inset #808080',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  fontWeight: 400,
  padding: '1px 6px',
  background: '#c0c0c0',
  borderBottom: '1px solid #808080',
};
const td: React.CSSProperties = { padding: '2px 6px', borderBottom: '1px solid #ddd', background: '#fff', whiteSpace: 'nowrap' };

export default Producer;
