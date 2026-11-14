import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { analyzeAudio, Analysis, noteTimes, reverbTimes, scaleOf, compatibleKeys, keyName } from '../utils/audioAnalysis';
import { shell, button, statusBar } from './TeamFiles';
import FilePicker from '../components/FilePicker';
import { fileKind } from './fileTypes';
import { IconLabel } from '../components/RetroIcon';
import { GUIDE, GENRES, TRACKING } from './producerGuide';
import {
  TOKENS,
  COCKPIT_CSS,
  rule,
  mono,
  cell,
  label,
  pane,
  paneHead,
  grid,
  gth,
  gtd,
  num,
  caption,
  sfield,
  FoundryRoles,
  EditList,
  Item,
} from './foundryModes';
import { useWindowManager } from '../wm/manager';
import { openSong, takeSessionWish } from '../utils/songs';
import SevenSegmentDisplay from '../components/SevenSegmentDisplay';

// Foundry (the Producer window): a companion for making music. Session is the recording cockpit: tempo, key,
// sample rate and genre on one ribbon drive delay, reverb and compressor times, 808 notes in Hz, a vocal
// checklist with a lyric bar count and the genre's vocal chain, all on one screen. Drop a song to get its tempo, key, loudness and tonal balance
// (worked out in the browser: nothing is uploaded), compare a mix with a reference, get delay and reverb times
// for the tempo, the key's scale and chords, and a guide of chains, tips and tools. Open to everyone.
type Tab = 'session' | 'analyze' | 'compare' | 'convert' | 'guide';
const TABS: [Tab, string][] = [
  ['session', 'Session'],
  ['analyze', 'Analyze'],
  ['compare', 'Compare'],
  ['convert', 'To WAV'],
  ['guide', 'Guide'],
];
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const db = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-∞');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const Producer: React.FC = () => {
  const [tab, setTab] = useState<Tab>('session');
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
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', borderTop: '1px solid #fff', padding: tab === 'session' ? 0 : 8 }}>
        {tab === 'analyze' && <AnalyzeTab current={mine} onDone={adopt} />}
        {tab === 'compare' && <CompareTab mine={mine} onMine={adopt} onClearMine={() => setMine(null)} />}
        {tab === 'session' && <FoundryRoles recording={<SessionTab bpm={bpm} setBpm={setBpm} keySel={key} setKey={setKey} />} />}
        {tab === 'convert' && <ConvertTab />}
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

/** Choose a file from this device or from Team Files, then analyse it (or hand it to onFile instead). */
const Picker: React.FC<{
  label: string;
  onDone?: (a: Named) => void;
  onFile?: (name: string, data: ArrayBuffer, status: (s: string) => void) => Promise<void>;
}> = ({ label, onDone, onFile }) => {
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
      if (onFile) return await onFile(name, await load(), setBusy);
      const result = await analyzeAudio(await load(), setBusy);
      onDone?.({ name, result });
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
        border: `2px dashed ${over ? '#000' : '#808080'}`,
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
      {busy && <div style={{ color: '#000' }}>{busy}</div>}
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
        <div style={{ background: '#fff', border: '2px inset #808080', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#666', fontSize: 10 }}>Tempo</span>
            {t && <SevenSegmentDisplay value={Math.round(t.bpm)} height={18} color="#00ff66" label="BPM" />}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{t ? `${t.bpm} BPM` : '?'}</div>
          {t && (
            <div style={{ color: '#444', fontSize: 10 }}>
              {t.confidence > 0.5 ? 'clear beat' : 'loose beat: check it'}
              {t.alternatives.length ? ` · or ${t.alternatives.join(' / ')}` : ''}
            </div>
          )}
        </div>
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
            <div style={{ position: 'absolute', left: 0, top: 0, height: other ? '50%' : '100%', width: w(b.db), background: '#000' }} />
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
const CAMELOT_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MIN = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
/** Frequency of a note (0 = C) in an octave, A4 = 440 Hz. */
export const noteHz = (root: number, octave: number) => 440 * 2 ** ((12 * (octave + 1) + root - 69) / 12);
const CHECKS = ['Lead takes', 'Lead comp', 'Doubles L/R', 'Ad-lib lanes', 'Stacks and harmonies', 'Tuned', 'Stems bounced'];
const SESSION_KEY = 'sk:foundry-session';
interface Session {
  id: string;
  song: string;
  track?: string; // the song in Music this session is for
  bpm?: number;
  key?: { root: number; minor: boolean };
  rate: number;
  genre: string;
  checks: Record<string, boolean>; // ticks from before the vocal checklist could be edited
  vocals?: Item[];
  lyrics: string;
  updated?: string;
  by?: string; // someone else's session for a song you can see
}
const newId = () => crypto.randomUUID().slice(0, 12);
const blankSession = (): Session => ({ id: newId(), song: '', rate: 48000, genre: GENRES[0].name, checks: {}, lyrics: '' });
const loadSession = (): Session => {
  try {
    return { ...blankSession(), ...JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') };
  } catch {
    return blankSession();
  }
};
const keepSession = (s: Session) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private window: the working session just isn't kept on this device */
  }
};
type Song = { id: string; title: string; bpm?: string };

/**
 * Session: Foundry's recording cockpit. The ribbon (tempo, key, sample rate, genre) drives every pane at once:
 * delay, reverb and compressor times, the key's notes in Hz, the vocal checklist and lyric bar count, and the
 * genre's vocal chain. A session saves itself as you work, to your account: the Sessions list opens past ones on any
 * device. Its song comes from the same list as Operations > Music, so the song's page and its sessions link both ways.
 */
const SessionTab: React.FC<{
  bpm: number;
  setBpm: (n: number) => void;
  keySel: { root: number; minor: boolean };
  setKey: (k: { root: number; minor: boolean }) => void;
}> = ({ bpm, setBpm, keySel, setKey }) => {
  const { isSignedIn } = useAuth();
  const api = useApi();
  const { openWindow } = useWindowManager();
  const [s, setS] = useState(loadSession);
  const [past, setPast] = useState<Record<string, Session>>({});
  const [shared, setShared] = useState<Session[]>([]); // other people's sessions for songs you can see
  const [songs, setSongs] = useState<Song[]>([]);
  const [saved, setSaved] = useState('');
  const timer = useRef<number | undefined>(undefined);
  // Saved a moment after the last change, with the ribbon's tempo and key. An empty session isn't worth a row.
  const save = (n: Session) => {
    keepSession(n);
    clearTimeout(timer.current);
    if (!isSignedIn || !(n.song.trim() || n.lyrics.trim() || n.track)) return;
    setSaved('Saving...');
    timer.current = window.setTimeout(
      () =>
        api('/api/foundry', { method: 'PUT', body: JSON.stringify({ id: n.id, session: n }) }).then(
          () => {
            setPast((p) => ({ ...p, [n.id]: { ...n, updated: new Date().toISOString() } }));
            setSaved('Saved');
          },
          (e: Error) => setSaved(e.message),
        ),
      800,
    );
  };
  const set = (patch: Partial<Session>) => {
    const n = { ...s, bpm, key: keySel, ...patch };
    setS(n);
    save(n);
  };
  const open = (n: Session) => {
    clearTimeout(timer.current);
    setS(n);
    keepSession(n);
    if (n.bpm) setBpm(n.bpm);
    if (n.key) setKey(n.key);
    setSaved('');
  };
  // A new session keeps your checklist (unticked), sample rate and genre
  const fresh = (song?: Song) => {
    const n: Session = {
      ...blankSession(),
      rate: s.rate,
      genre: s.genre,
      vocals: s.vocals?.map((v) => ({ text: v.text })),
      ...(song ? { song: song.title, track: song.id, bpm: Number(song.bpm) || undefined } : {}),
    };
    open(n);
    if (song) save(n);
  };
  const latest = (list: Record<string, Session>) => Object.values(list).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  // Asked for from a song's page in Music (or its file): its latest session, or a new one for it
  const forSong = (id: string | null, list = past, all = songs) => {
    if (!id) return;
    const had = latest(list).find((x) => x.track === id);
    const song = all.find((x) => x.id === id);
    if (had) open(had);
    else if (song) fresh(song);
  };
  useEffect(() => {
    if (!isSignedIn) return;
    Promise.all([api('/api/foundry'), api('/api/tracks')]).then(
      ([f, t]: [{ sessions: Record<string, Session>; shared: Session[] }, { tracks: Song[] }]) => {
        setPast(f.sessions);
        setShared(f.shared || []);
        setSongs(t.tracks);
        forSong(takeSessionWish(), f.sessions, t.tracks);
      },
      () => {},
    );
  }, [api, isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => forSong(takeSessionWish());
    window.addEventListener('sk:foundry-song', on);
    return () => window.removeEventListener('sk:foundry-song', on);
  });
  const vocals = s.vocals || CHECKS.map((text) => ({ text, done: !!s.checks[text] }));
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
  const q = valid ? 60000 / bpm : 0;
  const scale = scaleOf(keySel.root, keySel.minor);
  const camelotKey = `${(keySel.minor ? CAMELOT_MIN : CAMELOT_MAJ)[keySel.root]}${keySel.minor ? 'A' : 'B'}`;
  const genre = GENRES.find((g) => g.name === s.genre) || GENRES[0];
  const bars = s.lyrics.split('\n').filter((l) => l.trim()).length;
  return (
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
      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: rule }}>
        <div style={cell}>
          <SevenSegmentDisplay value={bpm.toFixed(1)} height={22} color="#00ff66" label="BPM" />
          <input
            style={{ ...sfield, width: 58 }}
            type="number"
            min={20}
            max={400}
            step={0.1}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            aria-label="Tempo in BPM"
          />
          <button style={button} onClick={tap} title="Tap along with the beat">
            Tap
          </button>
          <button style={button} onClick={() => setBpm(Math.round(bpm * 5) / 10)} title="Half tempo">
            ½
          </button>
          <button style={button} onClick={() => setBpm(Math.round(bpm * 20) / 10)} title="Double tempo">
            2x
          </button>
        </div>
        <div style={cell}>
          <span style={label}>Key</span>
          <select style={sfield} value={keySel.root} onChange={(e) => setKey({ ...keySel, root: Number(e.target.value) })}>
            {NOTE_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select
            style={sfield}
            value={keySel.minor ? 'minor' : 'major'}
            onChange={(e) => setKey({ ...keySel, minor: e.target.value === 'minor' })}
          >
            <option>major</option>
            <option>minor</option>
          </select>
          <span style={mono}>{camelotKey}</span>
        </div>
        <div style={cell}>
          <span style={label}>Rate</span>
          <select style={sfield} value={s.rate} onChange={(e) => set({ rate: Number(e.target.value) })}>
            {[44100, 48000, 96000].map((r) => (
              <option key={r} value={r}>
                {r / 1000} kHz / 24-bit
              </option>
            ))}
          </select>
        </div>
        <div style={{ ...cell, borderRight: 0 }}>
          <span style={label}>Genre</span>
          <select style={sfield} value={genre.name} onChange={(e) => set({ genre: e.target.value })}>
            {GENRES.map((g) => (
              <option key={g.name}>{g.name}</option>
            ))}
          </select>
          <span style={{ ...mono, color: bpm < genre.bpm[0] || bpm > genre.bpm[1] ? 'var(--fk-warn)' : 'var(--fk-dim)' }}>
            {genre.bpm[0]}-{genre.bpm[1]} BPM{bpm < genre.bpm[0] || bpm > genre.bpm[1] ? ' (outside)' : ''}
          </span>
        </div>
      </div>
      <div className="fk-grid">
        <section style={pane}>
          <h3 style={paneHead}>Signal math</h3>
          {valid ? (
            <>
              <table style={grid}>
                <thead>
                  <tr>
                    {['Note', 'Straight', 'Dotted', 'Triplet', 'Samples'].map((h) => (
                      <th key={h} style={gth}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {noteTimes(bpm)
                    .slice(2)
                    .map((n) => (
                      <tr key={n.name}>
                        <td style={gtd}>{n.name}</td>
                        <td style={num}>{n.ms.toFixed(1)}</td>
                        <td style={num}>{n.dotted.toFixed(1)}</td>
                        <td style={num}>{n.triplet.toFixed(1)}</td>
                        <td style={num}>{Math.round((n.ms / 1000) * s.rate)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div style={caption}>Delay times in ms. Samples are for the straight note at {s.rate / 1000} kHz.</div>
              <table style={grid}>
                <thead>
                  <tr>
                    {['Reverb', 'Pre-delay', 'Decay'].map((h) => (
                      <th key={h} style={gth}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reverbTimes(bpm).map((r) => (
                    <tr key={r.name} title={`Good for ${r.use}`}>
                      <td style={gtd}>{r.name}</td>
                      <td style={num}>{ms(r.predelay)}</td>
                      <td style={num}>{ms(r.decay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={caption}>Pre-delay plus decay ends on a note, so the tail clears before the next hit.</div>
              <table style={grid}>
                <thead>
                  <tr>
                    {['Compressor release', 'ms'].map((h) => (
                      <th key={h} style={gth}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Punchy (1/16)', q / 4],
                      ['Smooth (1/8)', q / 2],
                      ['Pumping bus (1/4)', q],
                    ] as const
                  ).map(([n, v]) => (
                    <tr key={n}>
                      <td style={gtd}>{n}</td>
                      <td style={num}>{v.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div style={caption}>Set a tempo between 20 and 400 BPM.</div>
          )}
          <table style={grid}>
            <thead>
              <tr>
                {['808 / sub', 'Oct 0', 'Oct 1', 'Oct 2'].map((h) => (
                  <th key={h} style={gth}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Root ' + NOTE_NAMES[keySel.root], keySel.root],
                  ['Fifth ' + NOTE_NAMES[(keySel.root + 7) % 12], (keySel.root + 7) % 12],
                ] as const
              ).map(([n, r]) => (
                <tr key={n}>
                  <td style={gtd}>{n}</td>
                  {[0, 1, 2].map((o) => (
                    <td key={o} style={num}>
                      {noteHz(r, o).toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={caption}>Hz. Tune the 808, Drum Buss Boom or a dynamic EQ notch to the root.</div>
          <div style={{ padding: '4px 6px', borderTop: rule }}>
            <b>{keyName(keySel.root, keySel.minor)}</b>: <span style={mono}>{scale.notes.join(' ')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 3 }}>
              {scale.chords.map((c) => (
                <span key={c.numeral} style={{ border: rule, marginRight: -1, padding: '1px 4px' }}>
                  <span style={{ color: 'var(--fk-dim)' }}>{c.numeral}</span> <b>{c.chord}</b>
                </span>
              ))}
            </div>
            <div style={{ marginTop: 3 }}>Mixes with {compatibleKeys(camelotKey).join(', ')}</div>
          </div>
        </section>
        <section style={pane}>
          <h3 style={paneHead}>Session</h3>
          {isSignedIn && (
            <div style={{ padding: '6px 6px 0', display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={label}>Sessions</span>
              <select
                style={{ ...sfield, flex: 1, minWidth: 0 }}
                value={past[s.id] ? s.id : ''}
                title="Sessions save themselves to your account. Pick a past one to open it."
                onChange={(e) => {
                  const v = e.target.value;
                  const theirs = shared.find((x) => `by:${x.by}:${x.id}` === v);
                  // Someone else's session opens as your own copy: theirs stays as they left it
                  if (theirs) open({ ...blankSession(), ...theirs, id: newId(), by: undefined, updated: undefined });
                  else if (v === 'new') fresh();
                  else if (past[v]) open(past[v]);
                }}
              >
                {!past[s.id] && <option value="">{s.song || 'Untitled'} (not saved yet)</option>}
                {latest(past).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.song || 'Untitled'} · {x.updated ? new Date(x.updated).toLocaleDateString() : ''}
                  </option>
                ))}
                {shared.length > 0 && (
                  <optgroup label="From others on your songs (opens a copy)">
                    {shared.map((x) => (
                      <option key={`${x.by}:${x.id}`} value={`by:${x.by}:${x.id}`}>
                        {x.song || 'Untitled'} · {x.by} · {x.updated ? new Date(x.updated).toLocaleDateString() : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="new">+ New session</option>
              </select>
              {past[s.id] && (
                <button
                  style={{ ...button, padding: '0 4px' }}
                  title="Delete this saved session"
                  onClick={() => {
                    const { [s.id]: gone, ...rest } = past;
                    api(`/api/foundry?id=${gone.id}`, { method: 'DELETE' }).then(
                      () => (setPast(rest), fresh()),
                      () => {},
                    );
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )}
          <div style={{ padding: 6, display: 'flex', gap: 4, alignItems: 'center', borderBottom: rule }}>
            <span style={label}>Song</span>
            <input
              style={{ ...sfield, flex: 1, minWidth: 0 }}
              value={s.song}
              placeholder="Untitled, or pick a song from Music"
              list="foundry-songs"
              onChange={(e) => {
                // Typing or picking a title that's in Music ties the session to that song
                const hit = songs.find((x) => x.title === e.target.value);
                set({ song: e.target.value, track: hit?.id });
                if (hit && Number(hit.bpm)) setBpm(Number(hit.bpm));
              }}
            />
            <datalist id="foundry-songs">
              {songs.map((x) => (
                <option key={x.id} value={x.title} />
              ))}
            </datalist>
            {s.track && (
              <button style={button} title="This song's page in Operations > Music" onClick={() => openSong(openWindow, s.track!)}>
                Music
              </button>
            )}
            <span style={{ color: 'var(--fk-dim)', whiteSpace: 'nowrap' }}>{saved}</span>
          </div>
          <EditList
            title="Vocals"
            items={vocals}
            start={vocals}
            set={(v) => set({ vocals: v })}
            placeholder="e.g. Whisper track, hook stacks"
          />
          <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 140 }}>
            <div style={{ ...label, marginBottom: 2 }}>
              Lyrics, one bar per line{' '}
              <span style={mono}>
                {bars} bars{valid && bars ? ` · ${clock((bars * 4 * q) / 1000)}` : ''}
              </span>
            </div>
            <textarea
              style={{ ...sfield, flex: 1, minHeight: 120, resize: 'none', ...mono }}
              value={s.lyrics}
              onChange={(e) => set({ lyrics: e.target.value })}
              aria-label="Lyrics"
            />
            {valid && (
              <div style={caption}>
                8 bars {clock((32 * q) / 1000)} · 16 bars {clock((64 * q) / 1000)} · 32 bars {clock((128 * q) / 1000)}
              </div>
            )}
          </div>
        </section>
        <section style={{ ...pane, borderRight: 0 }}>
          <h3 style={paneHead}>Brief: {genre.name}</h3>
          <div style={{ padding: '4px 6px', borderBottom: rule }}>{genre.note}</div>
          <div style={{ padding: '4px 6px', borderBottom: rule }}>
            <div style={label}>Vocal chain</div>
            <ol style={{ margin: '2px 0 0', paddingLeft: 18, listStyle: 'decimal' }}>
              {genre.chain.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </div>
          <div style={{ padding: '4px 6px' }}>
            <div style={label}>Tracking</div>
            <ul style={{ margin: '2px 0 0', paddingLeft: 18, listStyle: 'square' }}>
              {TRACKING.map((t) => (
                <li key={t}>{t}</li>
              ))}
              <li>Record at {s.rate / 1000} kHz / 24-bit and keep every take in the session at that rate.</li>
            </ul>
            <div style={caption}>Starting points: adjust by ear. Full chains in the Guide tab.</div>
          </div>
        </section>
      </div>
    </div>
  );
};

/**
 * Any audio the browser can decode (MP3, M4A/AAC, OGG, FLAC, WAV) as a WAV file for a DAW or sampler, on this
 * device. Decoding at the chosen rate resamples too. It can't bring back what MP3 compression threw away.
 */
const ConvertTab: React.FC = () => {
  const [rate, setRate] = useState(44100);
  const [bits, setBits] = useState<16 | 24>(24);
  const [done, setDone] = useState('');
  const toWav = async (name: string, data: ArrayBuffer, status: (s: string) => void) => {
    setDone('');
    status('Decoding...');
    const audio = await new OfflineAudioContext(2, 1, rate).decodeAudioData(data).catch(() => {
      throw new Error("This browser can't read that file. Try an MP3, M4A, OGG, FLAC or WAV.");
    });
    status('Writing WAV...');
    const ch = audio.numberOfChannels;
    const bytes = bits / 8;
    const frames = audio.length;
    const out = new DataView(new ArrayBuffer(44 + frames * ch * bytes));
    const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    out.setUint32(4, 36 + frames * ch * bytes, true);
    str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); // PCM
    out.setUint16(22, ch, true);
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * ch * bytes, true);
    out.setUint16(32, ch * bytes, true);
    out.setUint16(34, bits, true);
    str(36, 'data');
    out.setUint32(40, frames * ch * bytes, true);
    const chans = [...Array(ch).keys()].map((c) => audio.getChannelData(c));
    const max = bits === 16 ? 0x7fff : 0x7fffff;
    for (let i = 0, o = 44; i < frames; i++)
      for (let c = 0; c < ch; c++, o += bytes) {
        const v = Math.round(Math.max(-1, Math.min(1, chans[c][i])) * max);
        if (bits === 16) out.setInt16(o, v, true);
        else {
          out.setUint8(o, v & 0xff);
          out.setUint8(o + 1, (v >> 8) & 0xff);
          out.setUint8(o + 2, (v >> 16) & 0xff);
        }
      }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'audio/wav' }));
    a.download = `${name.replace(/\.[^.]+$/, '')}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    status('');
    setDone(`Saved ${a.download} (${(rate / 1000).toFixed(1)} kHz, ${bits}-bit, ${clock(audio.duration)}).`);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Sample rate{' '}
          <select value={rate} onChange={(e) => setRate(+e.target.value)}>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
          </select>
        </label>
        <label>
          Bit depth{' '}
          <select value={bits} onChange={(e) => setBits(+e.target.value as 16 | 24)}>
            <option value={24}>24-bit</option>
            <option value={16}>16-bit</option>
          </select>
        </label>
      </div>
      <Picker label="Convert to WAV" onFile={toWav} />
      {done && <div style={{ color: '#006000' }}>{done}</div>}
      <div style={{ color: '#555' }}>
        For samplers and DAWs that want WAV. Converting an MP3 doesn't bring back quality the MP3 already lost.
      </div>
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
export default Producer;
