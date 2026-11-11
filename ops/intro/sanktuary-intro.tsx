// Sanktuary intro: the boot loader and a transparent overlay for vlogs and edits.
// A raea composition (github.com/shinyobjectz/raea). A spark spirals out into a crackling green energy ring,
// the pixel wordmark tunes in through static, locks with a flash and a shock ring, holds, then breaks up.
// Everything sits on the wordmark's own pixel grid (6 px cells), in white, black and the signal green.
//
//   raea render ops/intro/sanktuary-intro.tsx --alpha -o sanktuary-intro.mov   (transparent movie)
//   raea render ops/intro/sanktuary-intro.tsx -o sanktuary-intro.mp4          (on black)
//
// Without raea, ops/intro/render.mjs draws the same frames in Chromium and encodes public/intro/.
import { AbsoluteFill, Composition, interpolate, registerRoot, useCurrentFrame } from 'raea';

const W = 1280,
  H = 720,
  U = 6,
  FPS = 30,
  FRAMES = 114;
const GREEN = '#4b9560',
  WHITE = '#fff',
  INK = '#000';

// public/icons/sanktuary-wordmark.svg: runs of ink on a 120 x 41 grid
const WORDMARK =
  'M72 0h7v1h-7zM54 1h43v1h-43zM46 2h58v1h-58zM41 3h27v1h-27zM83 3h24v1h-24zM35 4h17v1h-17zM64 4h3v1h-3zM97 4h10v1h-10zM30 5h16v1h-16zM64 5h3v1h-3zM104 5h2v1h-2zM27 6h13v1h-13zM60 6h1v1h-1zM64 6h3v1h-3zM23 7h12v1h-12zM51 7h3v1h-3zM58 7h4v1h-4zM64 7h3v1h-3zM20 8h10v1h-10zM47 8h2v1h-2zM51 8h3v1h-3zM57 8h5v1h-5zM64 8h3v1h-3zM69 8h2v1h-2zM77 8h1v1h-1zM83 8h2v1h-2zM94 8h5v1h-5zM17 9h9v1h-9zM37 9h3v1h-3zM46 9h3v1h-3zM50 9h4v1h-4zM56 9h6v1h-6zM64 9h3v1h-3zM68 9h4v1h-4zM76 9h3v1h-3zM82 9h4v1h-4zM92 9h9v1h-9zM105 9h2v1h-2zM14 10h9v1h-9zM30 10h2v1h-2zM37 10h4v1h-4zM46 10h3v1h-3zM50 10h4v1h-4zM56 10h5v1h-5zM64 10h3v1h-3zM68 10h4v1h-4zM76 10h3v1h-3zM82 10h5v1h-5zM91 10h11v1h-11zM104 10h4v1h-4zM12 11h8v1h-8zM30 11h3v1h-3zM37 11h4v1h-4zM46 11h3v1h-3zM50 11h4v1h-4zM55 11h5v1h-5zM64 11h3v1h-3zM68 11h3v1h-3zM75 11h4v1h-4zM82 11h5v1h-5zM90 11h12v1h-12zM104 11h5v1h-5zM116 11h3v1h-3zM10 12h8v1h-8zM29 12h4v1h-4zM37 12h4v1h-4zM46 12h3v1h-3zM50 12h9v1h-9zM64 12h3v1h-3zM68 12h3v1h-3zM75 12h4v1h-4zM82 12h5v1h-5zM90 12h6v1h-6zM98 12h5v1h-5zM105 12h4v1h-4zM115 12h5v1h-5zM8 13h7v1h-7zM29 13h4v1h-4zM37 13h5v1h-5zM45 13h4v1h-4zM50 13h8v1h-8zM64 13h3v1h-3zM68 13h3v1h-3zM75 13h4v1h-4zM82 13h5v1h-5zM92 13h4v1h-4zM99 13h5v1h-5zM105 13h4v1h-4zM115 13h4v1h-4zM7 14h6v1h-6zM29 14h4v1h-4zM37 14h5v1h-5zM45 14h3v1h-3zM50 14h7v1h-7zM64 14h3v1h-3zM68 14h3v1h-3zM75 14h4v1h-4zM81 14h7v1h-7zM92 14h4v1h-4zM100 14h4v1h-4zM105 14h5v1h-5zM114 14h5v1h-5zM5 15h6v1h-6zM28 15h5v1h-5zM37 15h5v1h-5zM45 15h3v1h-3zM50 15h6v1h-6zM64 15h3v1h-3zM68 15h4v1h-4zM75 15h4v1h-4zM81 15h7v1h-7zM92 15h4v1h-4zM100 15h4v1h-4zM106 15h4v1h-4zM114 15h5v1h-5zM4 16h5v1h-5zM28 16h5v1h-5zM37 16h6v1h-6zM45 16h3v1h-3zM50 16h5v1h-5zM64 16h3v1h-3zM68 16h4v1h-4zM75 16h4v1h-4zM81 16h3v1h-3zM85 16h3v1h-3zM92 16h4v1h-4zM100 16h4v1h-4zM106 16h4v1h-4zM113 16h5v1h-5zM3 17h5v1h-5zM28 17h5v1h-5zM36 17h7v1h-7zM45 17h3v1h-3zM50 17h5v1h-5zM64 17h3v1h-3zM68 17h4v1h-4zM75 17h4v1h-4zM81 17h3v1h-3zM85 17h3v1h-3zM92 17h4v1h-4zM100 17h4v1h-4zM107 17h4v1h-4zM113 17h5v1h-5zM2 18h5v1h-5zM27 18h6v1h-6zM36 18h7v1h-7zM44 18h4v1h-4zM49 18h6v1h-6zM64 18h3v1h-3zM68 18h4v1h-4zM75 18h4v1h-4zM80 18h9v1h-9zM92 18h11v1h-11zM107 18h4v1h-4zM112 18h5v1h-5zM2 19h4v1h-4zM17 19h5v1h-5zM27 19h6v1h-6zM36 19h7v1h-7zM44 19h4v1h-4zM49 19h7v1h-7zM64 19h3v1h-3zM68 19h4v1h-4zM75 19h3v1h-3zM80 19h10v1h-10zM92 19h11v1h-11zM107 19h9v1h-9zM2 20h21v1h-21zM27 20h7v1h-7zM36 20h11v1h-11zM49 20h7v1h-7zM64 20h3v1h-3zM68 20h4v1h-4zM74 20h4v1h-4zM80 20h3v1h-3zM86 20h3v1h-3zM92 20h10v1h-10zM108 20h8v1h-8zM3 21h21v1h-21zM26 21h8v1h-8zM36 21h11v1h-11zM49 21h8v1h-8zM64 21h3v1h-3zM68 21h4v1h-4zM74 21h4v1h-4zM79 21h4v1h-4zM86 21h3v1h-3zM92 21h8v1h-8zM108 21h8v1h-8zM4 22h14v1h-14zM19 22h5v1h-5zM26 22h8v1h-8zM36 22h4v1h-4zM41 22h6v1h-6zM49 22h3v1h-3zM53 22h5v1h-5zM64 22h3v1h-3zM68 22h4v1h-4zM74 22h4v1h-4zM79 22h4v1h-4zM86 22h4v1h-4zM92 22h8v1h-8zM109 22h6v1h-6zM7 23h2v1h-2zM18 23h6v1h-6zM25 23h4v1h-4zM31 23h3v1h-3zM36 23h3v1h-3zM41 23h6v1h-6zM49 23h3v1h-3zM54 23h4v1h-4zM64 23h3v1h-3zM69 23h3v1h-3zM74 23h4v1h-4zM79 23h3v1h-3zM86 23h4v1h-4zM92 23h9v1h-9zM110 23h5v1h-5zM16 24h7v1h-7zM25 24h3v1h-3zM31 24h3v1h-3zM36 24h3v1h-3zM41 24h6v1h-6zM49 24h3v1h-3zM55 24h4v1h-4zM64 24h3v1h-3zM69 24h8v1h-8zM79 24h3v1h-3zM87 24h3v1h-3zM92 24h4v1h-4zM97 24h5v1h-5zM110 24h4v1h-4zM15 25h6v1h-6zM25 25h3v1h-3zM31 25h3v1h-3zM36 25h3v1h-3zM42 25h5v1h-5zM48 25h4v1h-4zM55 25h4v1h-4zM64 25h3v1h-3zM69 25h8v1h-8zM78 25h4v1h-4zM87 25h3v1h-3zM92 25h4v1h-4zM98 25h4v1h-4zM110 25h4v1h-4zM13 26h7v1h-7zM25 26h3v1h-3zM31 26h4v1h-4zM36 26h3v1h-3zM42 26h5v1h-5zM48 26h4v1h-4zM56 26h4v1h-4zM64 26h3v1h-3zM69 26h7v1h-7zM78 26h4v1h-4zM87 26h4v1h-4zM92 26h5v1h-5zM98 26h5v1h-5zM110 26h4v1h-4zM11 27h7v1h-7zM24 27h4v1h-4zM32 27h3v1h-3zM36 27h3v1h-3zM43 27h4v1h-4zM48 27h4v1h-4zM56 27h5v1h-5zM64 27h3v1h-3zM70 27h6v1h-6zM78 27h3v1h-3zM87 27h4v1h-4zM93 27h4v1h-4zM99 27h4v1h-4zM110 27h4v1h-4zM10 28h6v1h-6zM24 28h3v1h-3zM32 28h7v1h-7zM43 28h4v1h-4zM48 28h3v1h-3zM57 28h4v1h-4zM64 28h3v1h-3zM71 28h4v1h-4zM78 28h3v1h-3zM88 28h3v1h-3zM93 28h3v1h-3zM100 28h4v1h-4zM110 28h4v1h-4zM8 29h6v1h-6zM24 29h3v1h-3zM32 29h6v1h-6zM44 29h2v1h-2zM48 29h3v1h-3zM58 29h2v1h-2zM64 29h3v1h-3zM89 29h1v1h-1zM100 29h5v1h-5zM110 29h4v1h-4zM6 30h7v1h-7zM24 30h3v1h-3zM33 30h3v1h-3zM64 30h3v1h-3zM101 30h4v1h-4zM110 30h4v1h-4zM1 31h10v1h-10zM24 31h2v1h-2zM33 31h2v1h-2zM64 31h4v1h-4zM102 31h3v1h-3zM110 31h4v1h-4zM0 32h9v1h-9zM65 32h2v1h-2zM110 32h4v1h-4zM1 33h6v1h-6zM110 33h4v1h-4zM2 34h2v1h-2zM110 34h4v1h-4zM110 35h4v1h-4zM110 36h4v1h-4zM110 37h4v1h-4zM110 38h4v1h-4zM111 39h3v1h-3zM112 40h1v1h-1z';
const OX = 47,
  OY = 39; // wordmark origin in cells, centred in the frame
const CX = 640 / U,
  CY = OY + 20.5; // ring centre in cells
const RX = 74,
  RY = 46; // ring radii in cells

const CELLS: [number, number][] = [];
for (const m of WORDMARK.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
  for (let i = 0; i < +m[3]; i++) CELLS.push([+m[1] + i, +m[2]]);
}

// Deterministic noise, so every render (and every renderer) draws the same frame
function hash(a: number, b: number, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

class Layer {
  d: string[] = [];
  seen = new Set<number>();
  add(x: number, y: number, w = 1, h = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (w === 1 && h === 1) {
      const k = y * 1000 + x;
      if (this.seen.has(k)) return;
      this.seen.add(k);
    }
    this.d.push(`M${x} ${y}h${w}v${h}h-${w}z`);
  }
  path(fill: string) {
    return this.d.length ? <path d={this.d.join('')} fill={fill} /> : null;
  }
}

function Intro() {
  const f = useCurrentFrame();
  const green = new Layer(),
    white = new Layer(),
    ink = new Layer(),
    wm = new Layer(),
    top = new Layer();

  // Stars: a few cells that blink in once the ring is out
  for (let i = 0; i < 36; i++) {
    const born = 18 + hash(i, 1) * 30;
    if (f < born || f > 104 - hash(i, 2) * 10 || hash(i, Math.floor(f / 3), 3) < 0.25) continue;
    green.add(hash(i, 4) * (W / U), hash(i, 5) * (H / U));
  }

  // The energy ring: a spark at the centre that spirals out, then crackles round with a gap in it
  const grow = easeOut(interpolate(f, [0, 42], [0, 1], clamp));
  const collapse = interpolate(f, [98, 112], [0, 1], clamp);
  const head = 0.6 - grow * Math.PI * 2.4 - Math.max(0, f - 42) * 0.035 - collapse * 2;
  const len = interpolate(f, [0, 16, 42], [0.1, 3.6, 5.2], clamp) * (1 - collapse);
  const steps = Math.ceil(len * 70);
  for (let i = 0; i <= steps && f < 112; i++) {
    const s = i / Math.max(1, steps); // 0 at the head, 1 at the tail
    const a = head + s * len;
    const spiral = interpolate(f, [0, 42], [0.08, 1], clamp) + collapse * 0.5;
    const r = spiral * (1 + 0.05 * (hash(i >> 3, Math.floor(f / 2), 9) - 0.5));
    const kick = Math.round((hash(i >> 2, f, 11) - 0.5) * 3); // crackle, across the ring
    const x = CX + Math.cos(a) * RX * r + Math.cos(a) * kick;
    const y = CY + Math.sin(a) * RY * r + Math.sin(a) * kick;
    if (s > 0.55 && hash(i, f, 13) > (1 - s) * 2.2) continue; // the tail thins out into dither
    const thick = s < 0.06 ? 3 : s < 0.6 ? 3 : s < 0.8 ? 2 : 1;
    (i < 3 ? white : green).add(x - 1, y - 1, thick, thick);
    // flame licks: dithered cells flaring off the outside of the band, thickest behind the head
    const flare = (1 - s) * 5 * hash(i >> 1, Math.floor(f / 2), 59);
    for (let k = 2; k < flare; k++) {
      if ((Math.round(x) + Math.round(y) + k) % 2 || hash(i, k, f) < 0.3) continue;
      green.add(x + Math.cos(a) * k, y + Math.sin(a) * k * 0.8);
    }
    // sparks thrown off the ring
    if (hash(i, f, 17) > 0.985) green.add(x + (hash(i, f, 19) - 0.5) * 10, y + (hash(i, f, 23) - 0.5) * 8);
  }

  // Shock ring when the wordmark locks
  const shock = interpolate(f, [50, 64], [0, 1], clamp);
  if (shock > 0 && shock < 1) {
    const n = 260;
    for (let i = 0; i < n; i++) {
      if (hash(i, f, 29) < shock) continue;
      const a = (i / n) * Math.PI * 2,
        r = 0.2 + shock * 1.25;
      green.add(CX + Math.cos(a) * RX * r, CY + Math.sin(a) * RY * r);
    }
  }

  // The wordmark tunes in through static, locks, holds, then breaks up
  const tune = interpolate(f, [12, 48], [0, 1.15], clamp);
  const gone = interpolate(f, [96, 110], [0, 1.15], clamp);
  const jitter = interpolate(f, [12, 40, 50], [7, 2, 0], clamp) + (f === 72 || f === 73 || f === 87 ? 2 : 0);
  const flash = f >= 49 && f <= 51;
  for (const [cx, cy] of CELLS) {
    const t = hash(cx, cy, 7) * 0.85 + (cx / 120) * 0.15;
    const out = 1 - hash(cy, cx, 31) * 0.85 - ((120 - cx) / 120) * 0.15;
    const band = cy >> 2;
    const shift = jitter && hash(band, f, 37) > 0.55 ? Math.round((hash(band, f, 41) - 0.5) * 2 * jitter) : 0;
    const x = OX + cx + shift,
      y = OY + cy;
    if (tune > t + 0.15 && gone < out) {
      ink.add(x - 1, y - 1, 4, 4); // outline plus a one-cell drop shadow, so it reads on light ground too
      (flash ? top : wm).add(x, y);
    } else if ((tune > t && gone < out + 0.15) || (gone > out && gone < out + 0.15)) {
      const h = hash(cx * 7 + cy, f, 43);
      if (h > 0.35) (h > 0.75 ? white : top).add(x, y);
    }
  }

  // Loose static in the wordmark's box while it tunes in and breaks up
  const noise = Math.round(interpolate(f, [8, 26, 50], [0, 140, 0], clamp) + interpolate(f, [94, 102, 112], [0, 90, 0], clamp));
  for (let i = 0; i < noise; i++) {
    green.add(OX - 6 + hash(i, f, 47) * 132, OY - 3 + hash(i, f, 53) * 47);
  }

  return (
    <AbsoluteFill style={{ background: 'transparent' }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W / U} ${H / U}`}
        shapeRendering="crispEdges"
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        {green.path(GREEN)}
        {ink.path(INK)}
        {top.path(GREEN)}
        {wm.path(WHITE)}
        {white.path(WHITE)}
      </svg>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="sanktuary-intro" component={Intro} width={W} height={H} fps={FPS} durationInFrames={FRAMES} />);
