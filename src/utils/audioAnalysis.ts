// Audio analysis for the Producer window, all in the browser (nothing is uploaded): tempo, key, loudness
// (EBU R128 / ITU BS.1770 integrated LUFS), sample peak, stereo correlation and tonal balance.
// The pure functions take Float32Arrays so they can be tested outside a browser.
import { sharedAudio } from './sound';

/** In-place radix-2 FFT (re/im length must be a power of two). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude spectra of Hann-windowed frames: calls fn(mags, frameIndex) for each frame. */
function frames(x: Float32Array, size: number, hop: number, fn: (mag: Float64Array, i: number) => void) {
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mag = new Float64Array(size / 2);
  for (let start = 0, f = 0; start + size <= x.length; start += hop, f++) {
    for (let i = 0; i < size; i++) {
      re[i] = x[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    fn(mag, f);
  }
}

export interface Tempo {
  bpm: number;
  confidence: number; // 0-1: how clearly the beat stands out
  alternatives: number[]; // half / double time
}

/** Tempo from multi-band spectral-flux onset envelope autocorrelation.
 * Free from narrow 110-BPM bias; accurately detects 70-175 BPM without halving trap/drill. */
export function estimateTempo(x: Float32Array, sr: number, min = 60, max = 210): Tempo | null {
  const size = 1024;
  const hop = Math.round(sr / 86); // ~11.6 ms per onset frame
  const fr = sr / hop;
  let prevLow: Float64Array | null = null;
  let prevMid: Float64Array | null = null;
  let prevHigh: Float64Array | null = null;
  const env: number[] = [];

  // Multi-band bin boundaries: Low (<250Hz), Mid (250-2500Hz), High (>2500Hz)
  const lowBin = Math.max(1, Math.round((250 * size) / sr));
  const midBin = Math.min(size / 2 - 1, Math.round((2500 * size) / sr));

  frames(x, size, hop, (mag) => {
    const low = mag.slice(0, lowBin).map((m) => Math.log1p(100 * m));
    const mid = mag.slice(lowBin, midBin).map((m) => Math.log1p(100 * m));
    const high = mag.slice(midBin).map((m) => Math.log1p(100 * m));

    let fluxLow = 0, fluxMid = 0, fluxHigh = 0;
    if (prevLow) for (let k = 1; k < low.length; k++) fluxLow += Math.max(0, low[k] - prevLow[k]);
    if (prevMid) for (let k = 1; k < mid.length; k++) fluxMid += Math.max(0, mid[k] - prevMid[k]);
    if (prevHigh) for (let k = 1; k < high.length; k++) fluxHigh += Math.max(0, high[k] - prevHigh[k]);

    // Weighted combination favoring mid/high transients (snare/hats) alongside bass kicks
    env.push(0.35 * fluxLow + 0.45 * fluxMid + 0.20 * fluxHigh);
    prevLow = low;
    prevMid = mid;
    prevHigh = high;
  });

  if (env.length < fr * 8) return null; // under ~8 seconds: not enough to say

  // Remove the slow trend and keep the peaks
  const w = Math.round(fr * 0.5);
  const o = env.map((v, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(env.length - 1, i + w); j++, n++) s += env[j];
    return Math.max(0, v - s / n);
  });

  const ac = (lag: number) => {
    let s = 0;
    for (let i = lag; i < o.length; i++) s += o[i] * o[i - lag];
    return s / (o.length - lag);
  };

  const minLag = Math.floor((60 * fr) / max);
  const maxLag = Math.ceil((60 * fr) / min);
  const acs = new Float64Array(maxLag * 2 + 2);
  for (let l = 1; l < acs.length; l++) acs[l] = ac(l);
  const zero = ac(0) || 1;

  let best = -1;
  let bestScore = -Infinity;
  const scores: number[] = [];

  for (let l = minLag; l <= maxLag; l++) {
    const bpm = (60 * fr) / l;
    // Broad, flat prior across 75 - 165 BPM to avoid forcing 140 BPM down to 70
    const prior = bpm >= 75 && bpm <= 165 ? 1.0 : Math.exp(-0.5 * (Math.min(Math.abs(bpm - 75), Math.abs(bpm - 165)) / 30) ** 2);
    // Harmonic resonance across fundamental lag l and its octave divisions
    const halfLag = Math.round(l / 2);
    const doubleLag = 2 * l;
    const score = (acs[l] + 0.45 * (acs[doubleLag] || 0) + 0.35 * (acs[halfLag] || 0)) * prior;
    scores[l] = score;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }

  // Octave ambiguity check: if the half-lag (double tempo) is strong enough, prefer the faster modern tempo
  const halfLag = Math.round(best / 2);
  if (halfLag >= minLag && acs[halfLag] >= 0.72 * acs[best] && (60 * fr) / halfLag <= 170) {
    best = halfLag;
  }

  // Parabolic interpolation around the best lag for a fractional tempo
  const a = scores[best - 1] ?? bestScore;
  const c = scores[best + 1] ?? bestScore;
  const shift = a - 2 * bestScore + c !== 0 ? (0.5 * (a - c)) / (a - 2 * bestScore + c) : 0;
  const lag = best + Math.max(-0.5, Math.min(0.5, shift));
  const bpm = Math.round(((60 * fr) / lag) * 10) / 10;
  const confidence = Math.max(0, Math.min(1, acs[best] / zero));
  const alternatives = [Math.round((bpm / 2) * 10) / 10, Math.round(bpm * 2 * 10) / 10].filter((b) => b >= 50 && b <= 220);
  return { bpm, confidence, alternatives };
}

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Albrecht & Shanahan (2013) empirical key profiles (high discrimination for modern music)
const AS_MAJOR = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.107, 0.433, 0.061, 0.340];
const AS_MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330];

// Circle of Fifths pitch class order: C, G, D, A, E, B, F#/Gb, C#/Db, Ab, Eb, Bb, F
const FIFTHS_CYCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// Camelot wheel numbers for major keys by root (C=8B) and minor keys (A minor = 8A)
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export interface Key {
  root: number; // 0 = C
  minor: boolean;
  name: string; // "F# minor"
  short: string; // "F#m"
  camelot: string; // "11A"
  confidence: number; // 0-1
  relative: string; // "A major"
}
export const keyName = (root: number, minor: boolean) => `${NOTES[root]} ${minor ? 'minor' : 'major'}`;

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / 12;
  const mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

/** Pitch-class energy (C..B) of the signal between ~65 Hz and 2 kHz. */
export function chroma(x: Float32Array, sr: number) {
  const size = sr > 16000 ? 8192 : 4096;
  const c = new Array(12).fill(0);
  frames(x, size, size / 2, (mag) => {
    let frameTotal = 0;
    const local = new Array(12).fill(0);
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sr) / size;
      if (f < 65 || f > 2000) continue;
      const pc = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12;
      const e = mag[k] * mag[k];
      local[pc] += e;
      frameTotal += e;
    }
    if (frameTotal > 0) for (let i = 0; i < 12; i++) c[i] += Math.sqrt(local[i] / frameTotal); // each frame counts evenly
  });
  return c;
}

/**
 * Key estimation using Signature of Fifths (Kania et al. 2022)
 * combined with Albrecht-Shanahan (2013) cognitive key profiles.
 * Resolves relative major/minor ambiguity and eliminates circle-of-fifths drift.
 */
export function estimateKey(x: Float32Array, sr: number): Key | null {
  const c = chroma(x, sr);
  if (c.every((v) => v === 0)) return null;

  // 1. Signature of Fifths vector calculation (Kania et al. 2022)
  let sigX = 0;
  let sigY = 0;
  for (let k = 0; k < 12; k++) {
    const pc = FIFTHS_CYCLE[k];
    const weight = c[pc];
    const angle = (2 * Math.PI * k) / 12;
    sigX += weight * Math.cos(angle);
    sigY += weight * Math.sin(angle);
  }
  const sigMag = Math.hypot(sigX, sigY);
  const sigAngle = (Math.atan2(sigY, sigX) + 2 * Math.PI) % (2 * Math.PI); // [0, 2pi)

  // 2. Correlation with Albrecht-Shanahan profiles across all 24 major/minor keys
  const results: { root: number; minor: boolean; r: number; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const prof = minor ? AS_MINOR : AS_MAJOR;
      const rotated = c.map((_, i) => c[(i + root) % 12]);
      const r = correlate(rotated, prof);

      // Expected angle on circle of fifths for this key center:
      // Major tonic is at fifth index; Minor tonic is at +3 semitones (relative major equivalent).
      const fifthIndex = FIFTHS_CYCLE.indexOf(minor ? (root + 3) % 12 : root);
      const expectedAngle = (2 * Math.PI * fifthIndex) / 12;
      let angleDiff = Math.abs(sigAngle - expectedAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      // Signature of Fifths proximity weighting (Kania et al. 2022)
      const sigProximity = sigMag > 0 ? Math.cos(angleDiff) : 0;
      const score = r * 0.7 + Math.max(0, sigProximity) * 0.3;

      results.push({ root, minor, r, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const [best, second] = results;
  const relRoot = best.minor ? (best.root + 3) % 12 : (best.root + 9) % 12;
  return {
    root: best.root,
    minor: best.minor,
    name: keyName(best.root, best.minor),
    short: `${NOTES[best.root]}${best.minor ? 'm' : ''}`,
    camelot: `${best.minor ? CAMELOT_MINOR[best.root] : CAMELOT_MAJOR[best.root]}${best.minor ? 'A' : 'B'}`,
    confidence: Math.max(0, Math.min(1, (best.score - (second ? second.score : 0)) * 4 + best.r * 0.2)),
    relative: keyName(relRoot, !best.minor),
  };
}

export const BANDS: [string, number, number][] = [
  ['Sub', 20, 60],
  ['Low', 60, 250],
  ['Low mids', 250, 2000],
  ['High mids', 2000, 6000],
  ['Air', 6000, 20000],
];

/** Share of energy per band, in dB relative to the whole (e.g. Low -4.2). Mono signal. */
export function bandBalance(x: Float32Array, sr: number) {
  const size = 4096;
  const sums = new Array(BANDS.length).fill(0);
  frames(x, size, size, (mag) => {
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sr) / size;
      const b = BANDS.findIndex(([, lo, hi]) => f >= lo && f < hi);
      if (b >= 0) sums[b] += mag[k] * mag[k];
    }
  });
  const total = sums.reduce((a, b) => a + b, 0) || 1;
  return BANDS.map(([name], i) => ({ name, db: Math.round(10 * Math.log10(sums[i] / total || 1e-12) * 10) / 10 }));
}

/** Second-order IIR filter over a signal (direct form I). */
function biquad(x: Float32Array, b: number[], a: number[]) {
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** BS.1770 K-weighting filters for any sample rate (the pre-filter shelf, then the RLB high-pass). */
function kWeight(x: Float32Array, sr: number) {
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad(
    x,
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  );
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  return biquad(shelf, [1, -2, 1], [1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0]);
}

/** Integrated loudness in LUFS (gated, 400 ms blocks, 75% overlap), or -Infinity for silence. */
export function integratedLoudness(channels: Float32Array[], sr: number) {
  const weighted = channels.slice(0, 2).map((c) => kWeight(c, sr)); // front L/R, weight 1 each
  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const powers: number[] = [];
  for (let start = 0; start + block <= weighted[0].length; start += step) {
    let p = 0;
    for (const ch of weighted) {
      let s = 0;
      for (let i = start; i < start + block; i++) s += ch[i] * ch[i];
      p += s / block;
    }
    powers.push(p);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const mean = (ps: number[]) => ps.reduce((a, b) => a + b, 0) / ps.length;
  const abs = powers.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return Math.round(lufs(mean(gated)) * 10) / 10;
}

export function samplePeakDb(channels: Float32Array[]) {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak ? Math.round(20 * Math.log10(peak) * 10) / 10 : -Infinity;
}

/** Left/right correlation: 1 = mono, 0 = very wide, negative = phase trouble. null for mono files. */
export function stereoCorrelation(channels: Float32Array[]) {
  if (channels.length < 2) return null;
  const [l, r] = channels;
  let lr = 0,
    ll = 0,
    rr = 0;
  for (let i = 0; i < l.length; i++) {
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  return ll && rr ? Math.round((lr / Math.sqrt(ll * rr)) * 100) / 100 : 1;
}

// ── Timing from a tempo ──

/** Note lengths in ms at a tempo: straight, dotted and triplet, 1/1 to 1/64. */
export function noteTimes(bpm: number) {
  const quarter = 60000 / bpm;
  return [
    ['1/1', 4],
    ['1/2', 2],
    ['1/4', 1],
    ['1/8', 0.5],
    ['1/16', 0.25],
    ['1/32', 0.125],
    ['1/64', 0.0625],
  ].map(([name, beats]) => {
    const ms = quarter * (beats as number);
    return { name: name as string, ms, dotted: ms * 1.5, triplet: (ms * 2) / 3, hz: 1000 / ms };
  });
}

/** Reverbs that breathe with the song: pre-delay and decay chosen so pre-delay + decay lands on a note length. */
export function reverbTimes(bpm: number) {
  const q = 60000 / bpm; // ms per quarter note (1 beat)
  const r = (predelayFractionOfBeat: number, totalBeats: number) => ({
    predelay: Math.round(q * predelayFractionOfBeat * 10) / 10,
    decay: Math.round((q * totalBeats - q * predelayFractionOfBeat) * 10) / 10,
  });
  return [
    { name: 'Tight room', use: 'drums, percussion', ...r(1 / 16, 1) }, // predelay: 1/64th note (1/16 beat), decay: 1/4 note (1 beat)
    { name: 'Small plate', use: 'snares, lead vocal (keeps it close)', ...r(1 / 8, 2) }, // predelay: 1/32nd note (1/8 beat), decay: 1/2 note (2 beats)
    { name: 'Plate / chamber', use: 'vocals, keys', ...r(1 / 4, 4) }, // predelay: 1/16th note (1/4 beat), decay: 1 whole note (4 beats)
    { name: 'Hall', use: 'pads, background vocals, strings', ...r(1 / 4, 8) }, // predelay: 1/16th note (1/4 beat), decay: 2 whole notes (8 beats)
    { name: 'Big space', use: 'ambient throws, intros, transitions', ...r(1 / 2, 16) }, // predelay: 1/8th note (1/2 beat), decay: 4 whole notes (16 beats)
  ];
}

/** Notes of the key's scale and its diatonic chords. */
export function scaleOf(root: number, minor: boolean) {
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const notes = steps.map((s) => NOTES[(root + s) % 12]);
  const qualities = minor ? ['m', 'dim', '', 'm', 'm', '', ''] : ['', 'm', 'm', '', '', 'm', 'dim'];
  const numerals = minor ? ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'] : ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
  return { notes, chords: notes.map((n, i) => ({ numeral: numerals[i], chord: n + qualities[i] })) };
}

/** Keys that mix well (Camelot neighbours): same number other letter, and one step either way. */
export function compatibleKeys(camelot: string) {
  const n = Number(camelot.slice(0, -1));
  const l = camelot.slice(-1);
  const wrap = (x: number) => ((x + 11) % 12) + 1;
  return [`${n}${l === 'A' ? 'B' : 'A'}`, `${wrap(n - 1)}${l}`, `${wrap(n + 1)}${l}`];
}

// ── In the browser: decode a file and run everything ──

export interface Analysis {
  duration: number;
  channels: number;
  tempo: Tempo | null;
  key: Key | null;
  lufs: number;
  peak: number;
  correlation: number | null;
  bands: { name: string; db: number }[];
}

const breathe = () => new Promise((r) => setTimeout(r)); // let the window repaint between steps

// Tempo, key and balance come from up to 90 s of mono at 22 kHz, skipping a long intro
const EXCERPT_RATE = 22050;
async function monoExcerpt(buf: AudioBuffer) {
  const len = Math.min(buf.duration, 90);
  const start = buf.duration > 120 ? Math.min(30, buf.duration - len) : 0;
  const off = new OfflineAudioContext(1, Math.ceil(len * EXCERPT_RATE), EXCERPT_RATE);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, start, len);
  return (await off.startRendering()).getChannelData(0);
}

/** Just tempo and key, from audio already decoded (the file preview's waveform). */
export async function tempoAndKey(buf: AudioBuffer) {
  const mono = await monoExcerpt(buf);
  await breathe();
  return { tempo: estimateTempo(mono, EXCERPT_RATE), key: estimateKey(mono, EXCERPT_RATE) };
}

/** Decodes any format the browser can play (WAV, AIFF, MP3, FLAC, M4A, OGG) and analyses it. */
export async function analyzeAudio(data: ArrayBuffer, onStep: (s: string) => void = () => {}): Promise<Analysis> {
  onStep('Decoding...');
  let buf: AudioBuffer;
  try {
    buf = await sharedAudio()!.decodeAudioData(data);
  } catch {
    throw new Error("This browser can't read that file. Try a WAV, MP3, FLAC or M4A.");
  }
  const channels = [...Array(buf.numberOfChannels).keys()].map((i) => buf.getChannelData(i));
  const mono = await monoExcerpt(buf);
  const sr = EXCERPT_RATE;
  onStep('Finding the tempo...');
  await breathe();
  const tempo = estimateTempo(mono, sr);
  onStep('Finding the key...');
  await breathe();
  const key = estimateKey(mono, sr);
  onStep('Measuring loudness...');
  await breathe();
  return {
    duration: buf.duration,
    channels: buf.numberOfChannels,
    tempo,
    key,
    lufs: integratedLoudness(channels, buf.sampleRate),
    peak: samplePeakDb(channels),
    correlation: stereoCorrelation(channels),
    bands: bandBalance(mono, sr),
  };
}
