// Audio analysis for the Producer window, all in the browser (nothing is uploaded): tempo, key, loudness
// (EBU R128 / ITU BS.1770 integrated LUFS), sample peak, stereo correlation and tonal balance.
// The pure functions take Float32Arrays so they can be tested outside a browser.

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

/** Tempo from the spectral-flux onset envelope's autocorrelation, with a gentle preference around 110 BPM
 * (so a 104 BPM groove isn't read as 52 or 208). Mono signal, any sample rate. */
export function estimateTempo(x: Float32Array, sr: number, min = 60, max = 200): Tempo | null {
  const size = 1024;
  const hop = Math.round(sr / 86); // ~11.6 ms per onset frame
  const fr = sr / hop;
  let prev: Float64Array | null = null;
  const env: number[] = [];
  frames(x, size, hop, (mag) => {
    const logMag = mag.map((m) => Math.log1p(100 * m));
    let flux = 0;
    if (prev) for (let k = 1; k < logMag.length; k++) flux += Math.max(0, logMag[k] - prev[k]);
    env.push(flux);
    prev = logMag;
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
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    const score = (acs[l] + 0.5 * acs[2 * l] + 0.25 * (acs[Math.round(l / 2)] || 0)) * prior;
    scores[l] = score;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  // Parabolic interpolation around the best lag for a fractional tempo
  const a = scores[best - 1] ?? bestScore;
  const c = scores[best + 1] ?? bestScore;
  const shift = a - 2 * bestScore + c !== 0 ? (0.5 * (a - c)) / (a - 2 * bestScore + c) : 0;
  const lag = best + Math.max(-0.5, Math.min(0.5, shift));
  const bpm = Math.round(((60 * fr) / lag) * 10) / 10;
  const confidence = Math.max(0, Math.min(1, acs[best] / zero));
  const alternatives = [bpm / 2, bpm * 2].filter((b) => b >= 50 && b <= 220).map((b) => Math.round(b * 10) / 10);
  return { bpm, confidence, alternatives };
}

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Krumhansl-Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
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

export function estimateKey(x: Float32Array, sr: number): Key | null {
  const c = chroma(x, sr);
  if (c.every((v) => v === 0)) return null;
  const results: { root: number; minor: boolean; r: number }[] = [];
  for (let root = 0; root < 12; root++)
    for (const minor of [false, true]) {
      const prof = minor ? MINOR : MAJOR;
      const rotated = c.map((_, i) => c[(i + root) % 12]);
      results.push({ root, minor, r: correlate(rotated, prof) });
    }
  results.sort((a, b) => b.r - a.r);
  const [best, second] = results;
  const relRoot = best.minor ? (best.root + 3) % 12 : (best.root + 9) % 12;
  return {
    root: best.root,
    minor: best.minor,
    name: keyName(best.root, best.minor),
    short: `${NOTES[best.root]}${best.minor ? 'm' : ''}`,
    camelot: `${best.minor ? CAMELOT_MINOR[best.root] : CAMELOT_MAJOR[best.root]}${best.minor ? 'A' : 'B'}`,
    confidence: Math.max(0, Math.min(1, (best.r - second.r) * 5 + best.r * 0.3)),
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
  const q = 60000 / bpm;
  const r = (predelayBeats: number, totalBeats: number) => ({
    predelay: q * predelayBeats,
    decay: q * totalBeats - q * predelayBeats,
  });
  return [
    { name: 'Tight room', use: 'drums, percussion', ...r(1 / 64, 1 / 4) },
    { name: 'Small plate', use: 'snares, lead vocal (keeps it close)', ...r(1 / 32, 1 / 2) },
    { name: 'Plate / chamber', use: 'vocals, keys', ...r(1 / 16, 1) },
    { name: 'Hall', use: 'pads, background vocals, strings', ...r(1 / 16, 4) },
    { name: 'Big space', use: 'ambient throws, intros, transitions', ...r(1 / 8, 8) },
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

/** Decodes any format the browser can play (WAV, AIFF, MP3, FLAC, M4A, OGG) and analyses it. */
export async function analyzeAudio(data: ArrayBuffer, onStep: (s: string) => void = () => {}): Promise<Analysis> {
  onStep('Decoding...');
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(data);
  } catch {
    throw new Error("This browser can't read that file. Try a WAV, MP3, FLAC or M4A.");
  } finally {
    ctx.close();
  }
  const channels = [...Array(buf.numberOfChannels).keys()].map((i) => buf.getChannelData(i));
  // Tempo, key and balance from up to 90 s of mono at 22 kHz, skipping a long intro
  const len = Math.min(buf.duration, 90);
  const start = buf.duration > 120 ? Math.min(30, buf.duration - len) : 0;
  const sr = 22050;
  const off = new OfflineAudioContext(1, Math.ceil(len * sr), sr);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, start, len);
  const mono = (await off.startRendering()).getChannelData(0);
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
