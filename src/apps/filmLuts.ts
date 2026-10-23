// Film-stock looks as 3D LUTs, built here from a recipe instead of shipped as files (no licences to track).
// Each recipe works the way a stock does, not as a tint: white balance and dye crosstalk in linear light, a
// separate contrast curve per dye layer (which is where a stock's split toning comes from), then hue-by-hue moves
// in OkLCh (greens go olive, blues go teal, skin is kept) and highlights that lose colour on the way to white.

export const LUT_SIZE = 33; // 33x33x33 grid, packed as 33 slices side by side (blue picks the slice)

type V3 = [number, number, number];
interface HueMove {
  h: number; // centre hue in degrees (OkLCh: red ~25, skin ~60, yellow ~100, green ~140, cyan ~200, blue ~265)
  w: number; // width in degrees
  dh?: number; // hue shift in degrees
  c?: number; // chroma multiplier
  l?: number; // lightness shift
}
interface Recipe {
  wb: V3; // white balance gains (linear)
  cross: number; // dye crosstalk: how much each channel bleeds into the others (negative = purer colours)
  contrast: V3; // per-layer contrast of the stock itself, on a flattened (camera curve undone) image
  pivot: number; // mid-grey the contrast turns around
  lift: V3; // black point (the base fog of the film)
  roll: number; // highlight roll-off: how far white is pulled down (0 = none)
  sat: number; // overall chroma
  hiSat: number; // chroma kept at white (0..1): film loses colour in the highlights
  hues: HueMove[];
}

const RECIPES: Record<number, Recipe> = {
  // Portra 400: warm, soft, forgiving; skin glows, greens go yellow-olive, blues lean cyan
  24: {
    wb: [1.1, 1.0, 0.86],
    cross: 0.06,
    contrast: [1.15, 1.12, 1.05],
    pivot: 0.42,
    lift: [0.035, 0.03, 0.03],
    roll: 0.04,
    sat: 0.95,
    hiSat: 0.5,
    hues: [
      { h: 60, w: 35, l: 0.015 },
      { h: 140, w: 45, dh: -18, c: 0.78 },
      { h: 250, w: 45, dh: -15, c: 0.95 },
    ],
  },
  // Kodachrome: dense, contrasty, deep reds and yellows, dark saturated blues, black blacks
  25: {
    wb: [1.03, 1.0, 0.95],
    cross: -0.08,
    contrast: [1.52, 1.48, 1.6],
    pivot: 0.38,
    lift: [0.0, 0.0, 0.01],
    roll: 0.03,
    sat: 1.1,
    hiSat: 0.6,
    hues: [
      { h: 25, w: 30, dh: -4, c: 1.25, l: -0.02 },
      { h: 60, w: 30, c: 0.78 },
      { h: 95, w: 30, dh: -8, c: 1.15 },
      { h: 140, w: 40, dh: 10, c: 0.95 },
      { h: 265, w: 45, dh: -8, c: 1.08, l: -0.05 },
    ],
  },
  // Cinestill 800T: tungsten stock in mixed light: cool, teal shadows, reds that stay red (halation is in the shader)
  26: {
    wb: [0.88, 1.0, 1.14],
    cross: 0.04,
    contrast: [1.35, 1.25, 1.12],
    pivot: 0.42,
    lift: [0.02, 0.04, 0.05],
    roll: 0.02,
    sat: 0.95,
    hiSat: 0.4,
    hues: [
      { h: 28, w: 30, c: 1.15 },
      { h: 70, w: 30, dh: -10, c: 0.85 },
      { h: 140, w: 50, dh: 30, c: 0.7 },
      { h: 230, w: 50, c: 1.1 },
    ],
  },
  // Classic Chrome: documentary slide look: muted, hard shadows, reds hold, blues go teal, greens go grey-olive
  27: {
    wb: [1.0, 1.0, 0.98],
    cross: 0.1,
    contrast: [1.48, 1.44, 1.38],
    pivot: 0.5,
    lift: [0.01, 0.012, 0.015],
    roll: 0.05,
    sat: 0.72,
    hiSat: 0.5,
    hues: [
      { h: 28, w: 30, c: 1.25 },
      { h: 60, w: 25, c: 1.15 },
      { h: 95, w: 30, dh: -6, c: 0.85 },
      { h: 140, w: 45, dh: -15, c: 0.65 },
      { h: 250, w: 45, dh: -20, c: 0.88, l: -0.03 },
    ],
  },
  // Velvia 50: punchy slide film: very saturated, deep blacks, magenta-leaning reds, lush greens
  28: {
    wb: [1.0, 1.0, 1.0],
    cross: -0.12,
    contrast: [1.56, 1.56, 1.5],
    pivot: 0.38,
    lift: [0.008, 0.0, 0.01],
    roll: 0.03,
    sat: 1.35,
    hiSat: 0.7,
    hues: [
      { h: 25, w: 30, c: 1.1 },
      { h: 60, w: 30, c: 0.7 },
      { h: 140, w: 50, dh: 6, c: 1.2, l: -0.02 },
      { h: 265, w: 45, dh: -10, c: 1.0, l: -0.04 },
    ],
  },
};

export const isLutLook = (preset: number) => preset in RECIPES;

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);

function linToOklab([r, g, b]: V3): V3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLin([L, a, b]: V3): V3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// Phone and camera JPEGs already carry an S-curve. Undo a typical one first (sCurve with 1/k is its exact inverse), so
// each stock's own curve, toe and shoulder shape the picture instead of stacking on top of the camera's.
const CAMERA_K = 1.25;
const CAMERA_PIVOT = 0.45;

// Contrast around a pivot that keeps black at black and white at white (a smooth S, steeper as k grows)
const sCurve = (x: number, k: number, p: number) => {
  x = Math.min(Math.max(x, 0), 1);
  const a = (x / p) ** k * p;
  const b = 1 - ((1 - x) / (1 - p)) ** k * (1 - p);
  return x < p ? a : b;
};

function grade(rgb: V3, r: Recipe): V3 {
  const [L0, a0, b0] = linToOklab(rgb.map(toLin) as V3);
  // 1. Light: white balance and dye crosstalk
  let lin = rgb.map((v, i) => toLin(sCurve(v, 1 / CAMERA_K, CAMERA_PIVOT)) * r.wb[i]) as V3;
  const avg = (lin[0] + lin[1] + lin[2]) / 3;
  lin = lin.map((v) => v + (avg - v) * r.cross) as V3;
  // 2. Each dye layer has its own curve (on the display-encoded value, where a curve reads as contrast)
  let s = lin.map((v, i) => sCurve(toSrgb(v), r.contrast[i], r.pivot)) as V3;
  s = s.map((v, i) => r.lift[i] + v * (1 - r.lift[i] - r.roll)) as V3;
  // 3. Colour: hue-by-hue moves in OkLCh, then highlights fade toward white
  const [L, a, b] = linToOklab(s.map(toLin) as V3);
  let C = Math.hypot(a, b) * r.sat;
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  let dL = 0;
  for (const m of r.hues) {
    const d = ((h - m.h + 540) % 360) - 180;
    const wgt = Math.exp(-(d * d) / (2 * (m.w / 2) ** 2)) * Math.min(1, C / 0.04); // fades out near grey
    h += (m.dh || 0) * wgt;
    C *= 1 + ((m.c ?? 1) - 1) * wgt;
    dL += (m.l || 0) * wgt;
  }
  // Skin guard: whatever the stock does to everything else, skin stays true. Contrast curves pull the lower mids
  // down (where deep skin sits) and warm stocks push skin orange, so skin may not end up more than a touch darker,
  // more saturated or off its own hue than it started.
  const h0 = (Math.atan2(b0, a0) * 180) / Math.PI;
  const C0 = Math.hypot(a0, b0);
  // Skin is a soft region, not a box: red/mahogany (~25-35), golden (~40-55) and olive (~60-75) undertones, low
  // chroma (an orange bag or a red jacket is too saturated to be skin), and not hair-black or specular white.
  const d0 = ((h0 - 50 + 540) % 360) - 180;
  const ramp = (x: number, a: number, b: number) => Math.min(Math.max((x - a) / (b - a), 0), 1);
  const skin =
    Math.exp(-(d0 * d0) / (2 * 22 * 22)) *
    ramp(C0, 0.015, 0.035) *
    (1 - ramp(C0, 0.15, 0.2)) *
    ramp(L0, 0.12, 0.2) *
    (1 - ramp(L0, 0.82, 0.92));
  dL += Math.max(0, L0 - 0.01 - (L + dL)) * skin;
  C -= Math.max(0, C - C0 * 1.04) * skin;
  h -= (((h - h0 + 540) % 360) - 180) * 0.8 * skin;
  const hi = Math.min(Math.max((L - 0.75) / 0.25, 0), 1);
  C *= 1 - hi * hi * (1 - r.hiSat);
  // Too much colour for the screen: lower the chroma (keeping hue and lightness) instead of clipping each channel,
  // which would bend the hue and leave hard bands.
  const hr = (h * Math.PI) / 180;
  const at = (c: number) => oklabToLin([L + dL, c * Math.cos(hr), c * Math.sin(hr)]);
  const fits = (c: number) => at(c).every((v) => v >= -0.001 && v <= 1.001);
  if (!fits(C)) {
    let lo = 0;
    for (let i = 0, hiC = C; i < 12; i++) {
      const mid = (lo + hiC) / 2;
      if (fits(mid)) lo = mid;
      else hiC = mid;
    }
    C = lo;
  }
  return at(C).map((v) => Math.min(Math.max(toSrgb(v), 0), 1)) as V3;
}

const cache = new Map<number, Uint8Array>();
/** The look's LUT as RGBA pixels, LUT_SIZE*LUT_SIZE wide and LUT_SIZE high. Inputs and outputs are sRGB. */
export function filmLut(preset: number): Uint8Array {
  let px = cache.get(preset);
  if (px) return px;
  const n = LUT_SIZE;
  const r = RECIPES[preset];
  px = new Uint8Array(n * n * n * 4);
  for (let bi = 0; bi < n; bi++)
    for (let gi = 0; gi < n; gi++)
      for (let ri = 0; ri < n; ri++) {
        const o = grade([ri / (n - 1), gi / (n - 1), bi / (n - 1)], r);
        const i = (gi * n * n + bi * n + ri) * 4;
        px[i] = Math.round(o[0] * 255);
        px[i + 1] = Math.round(o[1] * 255);
        px[i + 2] = Math.round(o[2] * 255);
        px[i + 3] = 255;
      }
  cache.set(preset, px);
  return px;
}
