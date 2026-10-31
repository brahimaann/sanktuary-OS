// Darkroom's picture pipeline: the looks, their settings and the WebGL shaders that develop a photo.
// Shared by the Darkroom app and by darkroom-render.html, which the server renders Darkroom Lite with (for IE).
import { filmLut, isLutLook, LUT_SIZE } from './filmLuts';

// ── Color Grading Presets ──
export interface FilterPreset {
  id: number;
  name: string;
  category: 'swag' | 'goth' | 'camera' | 'film';
  desc: string;
}

export const PRESETS: FilterPreset[] = [
  { id: 0, name: 'None', category: 'swag', desc: 'Original unaltered photo' },
  // Swag Presets
  { id: 1, name: 'Nashville', category: 'swag', desc: 'Warm, faded contrast reminiscent of early Instagram' },
  { id: 2, name: 'Chief Keef', category: 'swag', desc: 'High-saturation, punchy direct-flash grade with falloff' },
  { id: 3, name: 'Nuke', category: 'swag', desc: 'Blown-out, deep fried contrast & sharp clipped edges' },
  { id: 4, name: 'Phreshboy', category: 'swag', desc: 'Cool / magenta shifted modern vintage look' },
  { id: 5, name: 'Sepia', category: 'swag', desc: 'Classic warm monochrome tint with soft roll-off' },
  { id: 6, name: '2014', category: 'swag', desc: 'Muted shadows, lifted blacks and elevated midtone warmth' },
  { id: 7, name: '$$$', category: 'swag', desc: 'Green banknote ink with engraved line shading' },
  { id: 8, name: 'Pandora', category: 'swag', desc: 'Ethereal cyan & violet dream cast' },
  // Goth Presets
  { id: 9, name: 'Bleach Bypass', category: 'goth', desc: 'De-saturated high contrast silver retention film' },
  { id: 10, name: 'Silver B&W', category: 'goth', desc: 'Deep crushed blacks, metallic monochrome tone' },
  { id: 11, name: 'Cross Process', category: 'goth', desc: 'Slide film developed in negative chemistry (C-41)' },
  { id: 12, name: 'Faded Print', category: 'goth', desc: 'Muted highlights, lifted blacks and cyan/green wash' },
  { id: 13, name: 'Teal & Orange', category: 'goth', desc: 'Teal shadows, orange highlights, skin tones protected' },
  { id: 14, name: 'Noir', category: 'goth', desc: 'Hard-light black & white with deep shadows' },
  // 1-Click Cameras
  { id: 15, name: 'Nokia', category: 'camera', desc: '176px phone sensor, 12-bit colour, Bayer dither' },
  { id: 16, name: '1/4" Camcorder', category: 'camera', desc: 'Interlaced scanlines, chroma blur, warm tape gain' },
  { id: 17, name: 'iPhone 3GS', category: 'camera', desc: 'Plastic lens softness, blown highlights, early sensor curve' },
  { id: 18, name: '🧠🧼 Brainwash', category: 'camera', desc: 'Ultra-saturated Y2K direct-flash digicam look' },
  // 2012 Instagram (Chicago drill era)
  { id: 19, name: '2012 Lux', category: 'swag', desc: '2012 Instagram: crunchy clarity, hot saturation, warm skin, dark corners' },
  { id: 20, name: 'Club Flash', category: 'swag', desc: 'Violet club shadows, glowing highlights, phone flash in the dark' },
  { id: 22, name: 'Tungsten Cam', category: 'camera', desc: 'Dark, warm, soft camcorder under one bare bulb' },
  { id: 23, name: 'Cold VHS', category: 'goth', desc: 'Blue-cyan tape, washed blacks, soft and cold' },
  { id: 21, name: 'Faded IG', category: 'swag', desc: 'Old Instagram fade: creamy lifted blacks, soft warm highlights' },
  // Film stocks (3D LUTs built in filmLuts.ts); picking one also sets its grain (FILM_GRAIN)
  { id: 24, name: 'Portra 400', category: 'film', desc: 'Warm, soft colour negative: glowing skin, olive greens, cyan-leaning blues' },
  { id: 25, name: 'Kodachrome', category: 'film', desc: 'Dense slide film: deep reds and yellows, dark blues, black blacks' },
  { id: 26, name: 'Cinestill 800T', category: 'film', desc: 'Tungsten cine film: cool, teal shadows, red halation around lights' },
  { id: 27, name: 'Classic Chrome', category: 'film', desc: 'Muted documentary colour: hard shadows, teal blues, red that holds' },
  { id: 28, name: 'Velvia 50', category: 'film', desc: 'Punchy slide film: rich greens and reds, deep blacks' },
];

export type Source = HTMLImageElement | HTMLCanvasElement;
export const dims = (s: Source) => (s instanceof HTMLImageElement ? [s.naturalWidth, s.naturalHeight] : [s.width, s.height]);

/** A small copy of the picture in Oklab (L, a, b per pixel), with the same maths as srgb_to_oklab in the shader. */
export function oklabPixels(img: Source): Float32Array {
  const [w, h] = dims(img);
  const k = Math.min(1, 256 / Math.max(w, h, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array((d.length / 4) * 3);
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); // exact sRGB, as in the shader
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [lin(d[i]), lin(d[i + 1]), lin(d[i + 2])];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    out.set(
      [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      ],
      (i / 4) * 3,
    );
  }
  return out;
}

/**
 * Match look: the average and spread of a picture's light (L) and colour (a, b) in Oklab, so the shader can move one
 * picture's numbers onto another's (Reinhard-style colour transfer).
 */
export function labStats(img: Source): [number[], number[]] {
  const px = oklabPixels(img);
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let i = 0; i < px.length; i += 3)
    for (let j = 0; j < 3; j++) {
      sum[j] += px[i + j];
      sq[j] += px[i + j] * px[i + j];
    }
  const n = px.length / 3;
  const mean = sum.map((v) => v / n);
  return [mean, sq.map((v, j) => Math.max(0.0001, Math.sqrt(Math.max(0, v / n - mean[j] * mean[j]))))];
}

// Skin, as a soft region in OkLCh (the same one the film stocks protect): around a hue, low chroma (a red jacket is too
// saturated to be skin), and not hair-black or specular white. dh is the distance from the centre hue in radians.
export const ramp = (x: number, a: number, b: number) => Math.min(Math.max((x - a) / (b - a), 0), 1);
const SKIN_WIDTH = 0.384; // 22 degrees
const skinWeight = (L: number, C: number, dh: number) =>
  Math.exp(-(dh * dh) / (2 * SKIN_WIDTH * SKIN_WIDTH)) *
  ramp(C, 0.015, 0.035) *
  (1 - ramp(C, 0.15, 0.2)) *
  ramp(L, 0.12, 0.2) *
  (1 - ramp(L, 0.82, 0.92));
export const angle = (d: number) => Math.atan2(Math.sin(d), Math.cos(d)); // wrap to -pi..pi

/** Skin uniformity: this photo's own skin tone (hue in radians, chroma), or null when there's hardly any skin in it. */
export function skinCentre(img: Source): [number, number] | null {
  const px = oklabPixels(img);
  // Start from typical skin, then centre on this person's: deep, golden, olive and pink undertones all differ
  let hue = (50 * Math.PI) / 180;
  let res: [number, number] | null = null;
  for (let pass = 0; pass < 2; pass++) {
    let [sw, sa, sb, sc] = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 3) {
      const C = Math.hypot(px[i + 1], px[i + 2]);
      // Only clear skin sets the target: near-greys (a beige wall, a grey-lit cheek) would drag it toward grey
      const w = skinWeight(px[i], C, angle(Math.atan2(px[i + 2], px[i + 1]) - hue)) * ramp(C, 0.025, 0.045);
      sw += w;
      sa += w * px[i + 1];
      sb += w * px[i + 2];
      sc += w * C;
    }
    if (sw < (px.length / 3) * 0.01) return null;
    hue = Math.atan2(sb, sa);
    res = [hue, sc / sw];
  }
  return res;
}

/** The colour of a small patch of the picture at (u, v), 0..1 from the top left, as [hue in radians, chroma]. */
export function pickColour(img: Source, u: number, v: number): [number, number] {
  const px = oklabPixels(img);
  const [w0, h0] = dims(img);
  const k = Math.min(1, 256 / Math.max(w0, h0, 1));
  const [w, h] = [Math.max(1, Math.round(w0 * k)), Math.max(1, Math.round(h0 * k))];
  const [cx, cy] = [Math.round(u * (w - 1)), Math.round(v * (h - 1))];
  let [sa, sb, sc, n] = [0, 0, 0, 0];
  for (let y = Math.max(0, cy - 3); y <= Math.min(h - 1, cy + 3); y++)
    for (let x = Math.max(0, cx - 3); x <= Math.min(w - 1, cx + 3); x++) {
      const i = (y * w + x) * 3;
      sa += px[i + 1];
      sb += px[i + 2];
      sc += Math.hypot(px[i + 1], px[i + 2]);
      n++;
    }
  return [Math.atan2(sb, sa), sc / n];
}

// Each stock's own grain: slow slide film is fine and quiet, fast film is coarse. Cinestill's halation is in the shader.
export const FILM_GRAIN: Record<number, Pick<DarkroomParams, 'grain' | 'grainSize'>> = {
  24: { grain: 0.22, grainSize: 0.45 }, // Portra 400
  25: { grain: 0.15, grainSize: 0.2 }, // Kodachrome 64
  26: { grain: 0.3, grainSize: 0.6 }, // Cinestill 800T
  27: { grain: 0.15, grainSize: 0.35 }, // Classic Chrome
  28: { grain: 0.1, grainSize: 0.1 }, // Velvia 50
};

export interface DarkroomParams {
  preset: number;
  amount: number;
  contrast: number;
  warmth: number;
  fade: number;
  vignette: number;
  grain: number;
  grainSize: number; // 0 (fine, slow film) to 1 (coarse, fast film)
  iphone6Grain: boolean;
  halation: number; // 0 to 1: red-orange glow around lights
  clarity: number; // -1 to 1: local contrast that stops at edges (no halos)
  // JPEG Degradation
  jpegQuality: number; // 0-100
  resolution: number; // 0.1 to 1.0 (downsampling)
  jpegNoise: boolean;
  jpegSharpen: boolean;
  pixelate2x: boolean;
  // CCD Bloom
  bloomAmount: number;
  bloomTint: number; // -1 to 1 (cool to warm)
  lensReflection: number; // 0 to 1
  ccdNoise: number; // 0 to 1
  // Blur / Pixelate
  blurMode: 0 | 1 | 2 | 3; // 0: None, 1: Uniform, 2: Vignette, 3: Pixelate
  blurRadius: number; // 0 to 25 (px on a 1000px photo; scales with the photo)
  // Glitch
  glitchMode: 0 | 1 | 2 | 3 | 4; // 0: none, 1: datamosh, 2: vhs, 3: lcd, 4: galaxy
  glitchAmount: number; // 0 to 1
  glitchThreshold: number; // 0 to 1: datamosh only moves blocks at least this bright
  // Match look: how far the photo moves to the reference photo's colours (0 = off), and whether light moves too
  match: number;
  matchTone: boolean;
  // Colour mixer: per hue band (MIX_BANDS), -1 to 1 each. Hue moves up to 30 degrees, lightness up to 0.1 in OkLCh
  mixHue: number[];
  mixSat: number[];
  mixLum: number[];
  skinUniform: number; // 0 to 1: pulls every bit of skin toward the photo's own average skin tone
  skinPick: number[]; // [hue in radians, chroma] of skin tapped on the photo; empty = work it out from the photo
}

// Colour mixer bands: name and centre hue in OkLCh degrees (skin sits between red and orange)
export const MIX_BANDS = [
  ['Red', 25],
  ['Orange', 55],
  ['Yellow', 100],
  ['Green', 140],
  ['Aqua', 195],
  ['Blue', 255],
  ['Purple', 300],
  ['Magenta', 340],
] as const;
// Each band is a bell as wide as its gaps to the neighbours, so the bands share out every hue between them
export const MIX_C = MIX_BANDS.map(([, h]) => (h * Math.PI) / 180);
export const MIX_W = MIX_C.map((h, i) => (angle(h - MIX_C[(i + 7) % 8]) + angle(MIX_C[(i + 1) % 8] - h)) / 4);

export const DEFAULT_PARAMS: DarkroomParams = {
  preset: 0,
  amount: 1,
  contrast: 1,
  warmth: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  grainSize: 0.4,
  iphone6Grain: false,
  halation: 0,
  clarity: 0,
  jpegQuality: 100,
  resolution: 1.0,
  jpegNoise: false,
  jpegSharpen: false,
  pixelate2x: false,
  bloomAmount: 0,
  bloomTint: 0,
  lensReflection: 0,
  ccdNoise: 0,
  blurMode: 0,
  blurRadius: 0,
  glitchMode: 0,
  glitchAmount: 0,
  glitchThreshold: 0,
  match: 0,
  matchTone: true,
  mixHue: [0, 0, 0, 0, 0, 0, 0, 0],
  mixSat: [0, 0, 0, 0, 0, 0, 0, 0],
  mixLum: [0, 0, 0, 0, 0, 0, 0, 0],
  skinUniform: 0,
  skinPick: [],
};

export const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = (p + 1.0) / 2.0; gl_Position = vec4(p, 0.0, 1.0); }`;

// Sizes that should look the same on a phone snap and a 24MP file scale with `big` (the long side in pixels).
export const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D img;
uniform vec2 res;
uniform int preset;
uniform float amount, contrast, warmth, fade, vignette, grain;
uniform float bloomAmount, bloomTint, lensReflection, ccdNoise;
uniform int blurMode;
uniform float blurRadius;
uniform int glitchMode;
uniform float glitchAmount, glitchThreshold;
uniform float uMatch, uMatchTone;
uniform vec3 uSrcMean, uSrcStd, uRefMean, uRefStd;
uniform float uMixC[8], uMixW[8], uMixH[8], uMixS[8], uMixL[8];
uniform float uMixOn, uSkinU, uSkinH, uSkinC;
uniform float uNoise;
uniform float uSharpen;
uniform float uPixel2x;
uniform float uTime;
uniform sampler2D lut;
uniform float uLut;
uniform float uGrainSize, uHalation, uClarity, uDigitalGrain;
uniform sampler2D fx; // quarter-size, blurred: r = light energy (for halation), g = local mean tone, b = its square

varying vec2 uv;

// NTSC YIQ (GLSL matrices are column-major)
const mat3 RGB2YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 YIQ2RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 snap(vec2 st, vec2 grid) { return (floor(st * grid) + 0.5) / grid; }

// Exact sRGB curve (the linear toe matters in the shadows; pow 2.2 crushes them). Light adds and blurs in linear.
vec3 srgb2lin(vec3 c) {
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 lin2srgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Highlight shoulder with a path to white: light more than a stop past the top spills into the other channels (so
// blown-out colours walk toward white, like film, while punchy saturated colours stay punchy), then each channel
// rolls off instead of clipping.
vec3 shoulder(vec3 c) {
  vec3 over = max(c - 2.0, 0.0);
  c += (vec3(over.r + over.g + over.b) - over) * 0.15;
  vec3 x = max(c - 0.95, 0.0);
  return min(c, 0.95 + 0.05 * x / (x + 0.0125)); // 1.0 lands on 0.99, anything brighter approaches 1.0
}

// Film look: 33^3 LUT packed as 33 slices side by side (blue picks the slice), blended across two slices
vec3 lut3d(vec3 c) {
  const float N = ${LUT_SIZE}.0;
  c = clamp(c, 0.0, 1.0) * (N - 1.0);
  float b0 = floor(c.b);
  vec2 rg = (c.rg + 0.5) / vec2(N * N, N);
  vec3 s0 = texture2D(lut, rg + vec2(b0 / N, 0.0)).rgb;
  vec3 s1 = texture2D(lut, rg + vec2(min(b0 + 1.0, N - 1.0) / N, 0.0)).rgb;
  return mix(s0, s1, c.b - b0);
}

// Interleaved gradient noise: half a code value of dither so gradients and vignettes don't band in 8 bits
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// ── Oklab Transformations (Ottosson) ──
vec3 srgb_to_oklab(vec3 c) {
  vec3 lrgb = srgb2lin(clamp(c, 0.0, 1.0));
  float l = 0.4122214708 * lrgb.r + 0.5363325363 * lrgb.g + 0.0514459929 * lrgb.b;
  float m = 0.2119034982 * lrgb.r + 0.6806995451 * lrgb.g + 0.1073969566 * lrgb.b;
  float s = 0.0883024619 * lrgb.r + 0.2817188376 * lrgb.g + 0.6299787005 * lrgb.b;
  l = pow(max(0.0, l), 1.0 / 3.0);
  m = pow(max(0.0, m), 1.0 / 3.0);
  s = pow(max(0.0, s), 1.0 / 3.0);
  vec3 lab;
  lab.x = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  lab.y = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  lab.z = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return lab;
}

vec3 oklab_to_srgb(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 rgb;
  rgb.r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  rgb.g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  rgb.b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return lin2srgb(clamp(rgb, 0.0, 1.0));
}

// 7x7 box blur over +-off. Each pixel jitters the grid, so big radii come out smooth instead of as ghost copies.
vec3 box_blur(vec2 st, vec2 off) {
  vec3 s = vec3(0.0);
  vec2 j = vec2(hash12(gl_FragCoord.xy), hash12(gl_FragCoord.yx + 3.1)) - 0.5;
  for (int i = -3; i <= 3; i++) {
    for (int k = -3; k <= 3; k++) s += srgb2lin(texture2D(img, st + (vec2(float(i), float(k)) + j) * off / 3.0).rgb);
  }
  return lin2srgb(s / 49.0); // averaged as light, so bright spots stay bright instead of going grey
}

// ── Physical Degradation Module 1: CCD Bloom & Vertical Smear (returns linear light) ──
vec3 apply_ccd_smear(vec2 uvCoord, float stepY) {
  vec3 smear = vec3(0.0);
  for (float i = -12.0; i <= 12.0; i += 1.0) {
    vec3 sampleColor = texture2D(img, uvCoord + vec2(0.0, i * stepY)).rgb;
    float bloom = smoothstep(0.9, 1.0, luma(sampleColor));
    smear += srgb2lin(sampleColor) * bloom * (1.0 - abs(i) / 12.0);
  }
  return smear * 0.18;
}

// Smooth value noise: one random value per cell, blended between cells, so grains have soft round edges
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + 1.0), f.x), f.y) - 0.5;
}

// Film grain: clumps of two sizes (fine grains bunch into larger blotches), mostly the same in each layer with a
// little colour of its own (most in blue), strongest in the midtones and fading in deep shadows and clean highlights, like a print.
vec3 film_grain(vec3 c, vec2 px, float size, float amt) {
  vec2 p = px / size;
  float mono = vnoise(p) * 0.65 + vnoise(p * 2.3 + 17.0) * 0.35;
  vec3 tint = vec3(vnoise(p * 1.7 + 3.1), vnoise(p * 1.7 + 41.3), vnoise(p * 1.7 + 77.9));
  vec3 n = mono * vec3(0.95, 1.0, 1.15) + tint * vec3(0.15, 0.15, 0.3); // the blue layer has the biggest grains
  float Y = luma(c);
  return c + n * amt * (0.25 + 3.0 * Y * (1.0 - Y));
}

// ── Digital grain (iPhone 6): hard per-cell noise, Poisson-like (sqrt variance) ──
vec3 apply_film_grain(vec3 c, vec2 cell, float timeVal, float grainAmt) {
  float Y = luma(c);
  float variance = sqrt(max(0.0, Y * (1.0 - Y)));
  float noise = (hash12(cell + timeVal * 61.0) - 0.5) * 2.0;
  return c + noise * variance * grainAmt;
}

// ── Preset 1: Nashville ──
vec3 nashville_grade(vec3 c) {
  vec3 graded;
  graded.r = 0.05 + 1.10 * c.r - 0.15 * (c.r * c.r);
  graded.g = 0.02 + 0.95 * c.g + 0.05 * (c.g * c.g);
  graded.b = 0.18 + 0.70 * c.b + 0.10 * (c.b * c.b);
  vec3 peach_blend = mix(graded, vec3(0.96, 0.82, 0.65), c.r * 0.15);
  return clamp(peach_blend, 0.0, 1.0);
}

// ── Preset 2: Chief Keef (on-camera flash: hot centre, falling off to the edges) ──
vec3 chief_keef_grade(vec3 c, vec2 uvCoord) {
  float dist = distance(uvCoord, vec2(0.5, 0.5));
  float falloff = clamp(1.0 / (1.0 + 3.5 * dist * dist), 0.0, 1.0);
  vec3 flashed = c * (0.35 + falloff * 0.95);
  float Y = luma(flashed);
  vec3 saturated = Y + 1.85 * (flashed - vec3(Y));
  return smoothstep(vec3(0.04), vec3(0.92), saturated);
}

// ── Preset 3: Nuke (Deep Fried) ──
vec3 nuke_grade(vec3 c, vec2 uvCoord, float big) {
  vec2 texel = vec2(max(2.0, big / 800.0)) / res;
  vec3 n1 = texture2D(img, uvCoord + vec2(texel.x, 0.0)).rgb;
  vec3 n2 = texture2D(img, uvCoord - vec2(0.0, texel.y)).rgb;
  vec3 edge = (c - (n1 + n2) * 0.5) * 12.0;
  vec3 sharp = clamp(c + edge, 0.0, 1.0);
  sharp = pow(sharp, vec3(0.5));
  float steps = 3.0;
  vec3 quantized = floor(sharp * steps + 0.5) / steps;
  quantized.r = clamp(quantized.r * 1.6, 0.0, 1.0);
  quantized.g = clamp(quantized.g * 1.2, 0.0, 1.0);
  quantized.b = clamp(quantized.b * 0.4, 0.0, 1.0);
  return quantized;
}

// ── Preset 4: Phreshboy ──
vec3 phreshboy_grade(vec3 c) {
  float Y = luma(c);
  vec3 shadow_tint = vec3(0.08, 0.12, 0.22);
  vec3 highlight_tint = vec3(0.92, 0.85, 0.96);
  vec3 split = mix(shadow_tint, highlight_tint, Y);
  vec3 graded = mix(c, split, 0.45);
  graded = smoothstep(0.08, 0.92, graded);
  graded = graded * 0.88 + 0.10;
  return clamp(graded, 0.0, 1.0);
}

// ── Preset 5: Sepia (Silver Sulfide) ──
vec3 sepia_grade(vec3 c) {
  float Y = luma(c);
  vec3 shadow = vec3(0.12, 0.08, 0.05);
  vec3 midtone = vec3(0.68, 0.48, 0.25);
  vec3 highlight = vec3(0.97, 0.93, 0.88);
  return mix(mix(shadow, midtone, Y), mix(midtone, highlight, Y), Y);
}

// ── Preset 6: 2014 (Matte Film) ──
vec3 matte_2014_grade(vec3 c) {
  vec3 matte = c * 0.86 + 0.12;
  float Y = luma(matte);
  matte.g = mix(matte.g, Y, 0.45);
  matte.b = mix(matte.b, Y, 0.55);
  vec3 warm_mid = vec3(1.12, 1.04, 0.92);
  float midtone_mask = 1.0 - abs(Y - 0.5) * 2.0;
  matte = mix(matte, matte * warm_mid, midtone_mask * 0.6);
  return clamp(matte, 0.0, 1.0);
}

// ── Preset 7: $$$ (Banknote Intaglio: three inks plus engraved hatching in the shadows) ──
vec3 banknote_grade(vec3 c, vec2 fc, float big) {
  float edgeY = smoothstep(0.25, 0.75, luma(c));
  vec3 ink_dark = vec3(0.08, 0.14, 0.10);
  vec3 ink_green = vec3(0.32, 0.58, 0.44);
  vec3 paper = vec3(0.93, 0.95, 0.90);
  vec3 grade = edgeY < 0.5 ? mix(ink_dark, ink_green, edgeY * 2.0) : mix(ink_green, paper, (edgeY - 0.5) * 2.0);
  float lines = 0.5 + 0.5 * sin((fc.x + fc.y) * 6.2831853 / max(3.0, big / 400.0));
  return mix(grade, ink_dark, (1.0 - edgeY) * (1.0 - lines) * 0.6);
}

// ── Preset 8: Pandora (Oklab Gradient Mapping) ──
vec3 pandora_grade(vec3 c) {
  vec3 oklab = srgb_to_oklab(c);
  vec3 shadow_ok = vec3(0.3, 0.1, -0.15);
  vec3 high_ok = vec3(0.85, -0.12, -0.05);
  float t = smoothstep(0.1, 0.9, oklab.x);
  vec3 mapped_ok = mix(shadow_ok, high_ok, t);
  mapped_ok.x = mix(mapped_ok.x, oklab.x, 0.6);
  return oklab_to_srgb(mapped_ok);
}

// ── Preset 9: Bleach Bypass (Silver Density) ──
vec3 bleach_bypass_grade(vec3 c) {
  float silver = pow(luma(c), 1.5);
  vec3 blend;
  blend.r = (silver < 0.5) ? (2.0 * c.r * silver) : (1.0 - 2.0 * (1.0 - c.r) * (1.0 - silver));
  blend.g = (silver < 0.5) ? (2.0 * c.g * silver) : (1.0 - 2.0 * (1.0 - c.g) * (1.0 - silver));
  blend.b = (silver < 0.5) ? (2.0 * c.b * silver) : (1.0 - 2.0 * (1.0 - c.b) * (1.0 - silver));
  vec3 desaturated = mix(blend, vec3(silver), 0.55);
  return clamp((desaturated - 0.5) * 1.15 + 0.5, 0.0, 1.0);
}

// ── Preset 10: Silver B&W (Tri-X 400 H&D Curve) ──
vec3 trix_bw_grade(vec3 c) {
  float E = dot(c, vec3(0.25, 0.60, 0.15));
  float density = 0.02 + 0.96 / (1.0 + exp(-6.0 * (E - 0.45)));
  return vec3(density);
}

// ── Preset 11: Cross Process (X-Pro: cyan shadows, yellow highlights) ──
vec3 cross_process_grade(vec3 c) {
  vec3 graded;
  graded.b = clamp(c.b * 0.65 + 0.20, 0.0, 1.0);
  graded.g = clamp(pow(c.g, 0.85) * 1.15, 0.0, 1.0);
  graded.r = smoothstep(0.02, 0.88, c.r);
  graded = (graded - 0.5) * 1.25 + 0.5;
  return clamp(graded, 0.0, 1.0);
}

// ── Preset 12: Faded Print (Arrhenius Dye Collapse) ──
vec3 faded_print_grade(vec3 c) {
  vec3 faded;
  faded.r = c.r * 0.96 + 0.04;
  faded.g = c.g * 0.82 + 0.08;
  faded.b = c.b * 0.38 + 0.15;
  faded = mix(faded, vec3(luma(faded)), 0.15);
  return clamp(faded, 0.0, 1.0);
}

// ── Preset 13: Teal & Orange (the I axis runs teal to orange; skin sits on +I and is protected) ──
vec3 teal_orange_grade(vec3 c) {
  vec3 yiq = RGB2YIQ * c;
  float t = smoothstep(0.1, 0.9, yiq.x);
  vec2 target = mix(vec2(-0.10, -0.035), vec2(0.12, -0.012), t);
  vec2 d = yiq.yz - vec2(0.15, 0.01);
  float skin = exp(-dot(d, d) * 60.0);
  yiq.yz = mix(yiq.yz * 0.6 + target * 0.7, yiq.yz, skin * 0.75);
  return clamp((YIQ2RGB * yiq - 0.5) * 1.08 + 0.5, 0.0, 1.0);
}

// ── Preset 14: Noir (orthochromatic: blue-sensitive, red-blind; S-curve keeps some midtones) ──
vec3 noir_grade(vec3 c) {
  float Y = dot(c, vec3(0.10, 0.40, 0.50));
  return vec3(pow(smoothstep(0.12, 0.88, Y), 1.35));
}

// ── Preset 15: Nokia (4x4 Bayer dither, 12-bit RGB444; the 176px grid is applied in main) ──
vec3 nokia_grade(vec3 c, vec2 cell) {
  int x = int(mod(cell.x, 4.0));
  int y = int(mod(cell.y, 4.0));
  int idx = x + y * 4;
  float dither = 0.0;
  if (idx == 0) dither = 0.0;
  else if (idx == 1) dither = 8.0;
  else if (idx == 2) dither = 2.0;
  else if (idx == 3) dither = 10.0;
  else if (idx == 4) dither = 12.0;
  else if (idx == 5) dither = 4.0;
  else if (idx == 6) dither = 14.0;
  else if (idx == 7) dither = 6.0;
  else if (idx == 8) dither = 3.0;
  else if (idx == 9) dither = 11.0;
  else if (idx == 10) dither = 1.0;
  else if (idx == 11) dither = 9.0;
  else if (idx == 12) dither = 15.0;
  else if (idx == 13) dither = 7.0;
  else if (idx == 14) dither = 13.0;
  else dither = 5.0;
  vec3 dithered = c + ((dither / 16.0) - 0.5) / 15.0;
  return clamp(floor(dithered * 15.0 + 0.5) / 15.0, 0.0, 1.0);
}

// ── Preset 16: 1/4" Camcorder (Horizontal Chroma Smear) ──
vec3 camcorder_grade(vec3 c, vec2 uvCoord, float big) {
  vec2 off = vec2(max(2.5, big / 256.0) / res.x, 0.0);
  vec3 yiq_c = RGB2YIQ * c;
  vec3 yiq_l = RGB2YIQ * texture2D(img, uvCoord - off).rgb;
  vec3 yiq_r = RGB2YIQ * texture2D(img, uvCoord + off).rgb;
  vec2 chroma = (yiq_l.yz + yiq_c.yz * 2.0 + yiq_r.yz) / 4.0;
  vec3 out_c = clamp(YIQ2RGB * vec3(yiq_c.x, chroma), 0.0, 1.0) * vec3(1.04, 1.0, 0.93);
  float lines = sin(uvCoord.y * 480.0 * 3.14159265) * 0.05;
  return out_c * (1.0 - lines);
}

// ── Preset 17: iPhone 3GS (soft plastic lens, knee curve that still reaches white, lens falloff) ──
vec3 iphone3gs_grade(vec3 c, vec2 uvCoord, float big) {
  vec2 o = vec2(big / 700.0) / res;
  vec3 soft = (texture2D(img, uvCoord + vec2(o.x, 0.0)).rgb + texture2D(img, uvCoord - vec2(o.x, 0.0)).rgb +
               texture2D(img, uvCoord + vec2(0.0, o.y)).rgb + texture2D(img, uvCoord - vec2(0.0, o.y)).rgb) * 0.25;
  c = mix(c, soft, 0.5);
  vec3 k = vec3(2.5, 2.8, 2.9);
  vec3 out_c = (1.0 - exp(-c * k)) / (1.0 - exp(-k));
  out_c *= vec3(1.0, 1.02, 0.94);
  float vig = mix(0.6, 1.0, 1.0 - smoothstep(0.3, 0.85, distance(uvCoord, vec2(0.5))));
  return clamp(out_c * vig, 0.0, 1.0);
}

// ── Preset 19: 2012 Lux (Instagram Lux + early HDR apps: big-radius "clarity", hot saturation, warm, vignette) ──
vec3 lux2012_grade(vec3 c, vec2 st, float big) {
  vec2 o = vec2(big / 120.0) / res;
  vec3 wide = (texture2D(img, st + vec2(o.x, 0.0)).rgb + texture2D(img, st - vec2(o.x, 0.0)).rgb +
               texture2D(img, st + vec2(0.0, o.y)).rgb + texture2D(img, st - vec2(0.0, o.y)).rgb) * 0.25;
  c += (c - wide) * 1.4;
  float Y = luma(c);
  c = Y + (c - Y) * 1.55;
  c *= vec3(1.10, 1.0, 0.84);
  c = smoothstep(0.03, 0.97, c);
  c *= mix(0.55, 1.0, 1.0 - smoothstep(0.35, 0.85, distance(st, vec2(0.5))));
  return clamp(c, 0.0, 1.0);
}

// ── Preset 20: Club Flash (violet shadows, warm skin, highlights that glow) ──
vec3 club_grade(vec3 c, vec2 st, float big) {
  vec2 o = vec2(big / 60.0) / res;
  vec3 glow = (texture2D(img, st + o).rgb + texture2D(img, st - o).rgb +
               texture2D(img, st + vec2(o.x, -o.y)).rgb + texture2D(img, st + vec2(-o.x, o.y)).rgb) * 0.25;
  vec3 tint = mix(vec3(0.25, 0.10, 0.45), vec3(1.0, 0.85, 0.75), smoothstep(0.1, 0.9, luma(c)));
  c = mix(c, c * tint * 1.6, 0.55);
  c += smoothstep(0.55, 1.0, luma(glow)) * glow * 0.45;
  c = (c - 0.5) * 1.15 + 0.45;
  return clamp(c, 0.0, 1.0);
}

// ── Preset 21: Faded IG (Valencia / Amaro era: creamy lifted blacks, warm, soft highlights) ──
vec3 faded_ig_grade(vec3 c) {
  c = c * 0.82 + vec3(0.14, 0.11, 0.09);
  float Y = luma(c);
  c = mix(vec3(Y), c, 1.15) * vec3(1.06, 1.0, 0.92);
  c = mix(c, vec3(1.0, 0.94, 0.86), smoothstep(0.7, 1.0, Y) * 0.35);
  return clamp(c, 0.0, 1.0);
}

// ── Preset 22: Tungsten Cam (underexposed, one warm bulb, soft lens, heavy falloff) ──
vec3 tungsten_grade(vec3 c, vec2 st, float big) {
  vec2 o = vec2(big / 500.0) / res;
  vec3 soft = (texture2D(img, st + vec2(o.x, 0.0)).rgb + texture2D(img, st - vec2(o.x, 0.0)).rgb +
               texture2D(img, st + vec2(0.0, o.y)).rgb + texture2D(img, st - vec2(0.0, o.y)).rgb) * 0.25;
  c = mix(c, soft, 0.45);
  float Y = luma(c);
  c = mix(vec3(Y), c, 0.7) * vec3(1.25, 0.98, 0.62);
  c = pow(max(c, 0.0), vec3(1.35)) * 0.95;
  c *= mix(0.35, 1.0, 1.0 - smoothstep(0.25, 0.8, distance(st, vec2(0.5, 0.45))));
  return clamp(c, 0.0, 1.0);
}

// ── Preset 23: Cold VHS (blue-cyan cast, lifted grey blacks, low contrast, soft) ──
vec3 cold_vhs_grade(vec3 c, vec2 st, float big) {
  vec2 o = vec2(big / 400.0, 0.0) / res;
  c = (c * 2.0 + texture2D(img, st + o).rgb + texture2D(img, st - o).rgb) * 0.25;
  float Y = luma(c);
  c = mix(vec3(Y), c, 0.55) * vec3(0.78, 0.95, 1.18);
  return clamp(c * 0.78 + vec3(0.10, 0.12, 0.16), 0.0, 1.0);
}

// ── Preset 18: Brainwash (Y2K Digicam CCD Bleed) ──
vec3 brainwash_grade(vec3 c) {
  mat3 satMatrix = mat3(1.6, -0.3, -0.3, -0.3, 1.6, -0.3, -0.3, -0.3, 1.6);
  return smoothstep(0.04, 0.92, clamp(satMatrix * c, 0.0, 1.0));
}

void main() {
  vec2 st = uv;
  float big = max(res.x, res.y);

  // 1. Resolution / Pixelate 2x emulation
  if (uPixel2x > 0.5) st = snap(st, res / 2.0);
  vec2 nokiaCell = vec2(0.0);
  if (preset == 15) {
    vec2 grid = mix(res, res * (176.0 / min(res.x, res.y)), amount);
    nokiaCell = floor(st * grid);
    st = (nokiaCell + 0.5) / grid;
  }

  // 2. Glitch coordinate distortions
  if (glitchMode == 1 && glitchAmount > 0.01) { // Datamosh: bright-enough blocks slide like broken motion vectors
    vec2 grid = vec2(24.0, 16.0);
    vec2 block = floor(st * grid);
    float bright = luma(texture2D(img, (block + 0.5) / grid).rgb);
    if (bright >= glitchThreshold && hash(block + 1.3) > 0.7 - glitchAmount * 0.4) {
      st += (vec2(hash(block), hash(block + 7.1)) - 0.5) * vec2(0.2, 0.08) * glitchAmount;
    }
  } else if (glitchMode == 2 && glitchAmount > 0.01) { // VHS: each band of lines jitters sideways
    float line = floor(st.y * 240.0);
    st.x += (hash(vec2(line, floor(uTime * 8.0))) - 0.5) * glitchAmount * 0.012;
  }

  // Base texture sample with optional chromatic aberration (Glitch mode 4 - Galaxy)
  vec3 c;
  if (glitchMode == 4 && glitchAmount > 0.01) {
    vec2 dist = (st - 0.5) * glitchAmount * 0.04;
    c.r = texture2D(img, st + dist).r;
    c.g = texture2D(img, st).g;
    c.b = texture2D(img, st - dist).b;
  } else {
    c = texture2D(img, st).rgb;
  }

  // Skin uniformity and colour mixer, in OkLCh on the photo's own colours (before any look)
  if (uSkinU > 0.001 || uMixOn > 0.5) {
    vec3 lab = srgb_to_oklab(c);
    float L = lab.x;
    float C = length(lab.yz);
    float h = atan(lab.z, lab.y);
    // Skin: blotches and casts (red patches, a green spill) move toward this person's own skin tone; light stays
    if (uSkinU > 0.001) {
      float d = mod(uSkinH - h + 9.424778, 6.283185) - 3.141593;
      float w = exp(-d * d / 0.294912) * clamp((C - 0.015) / 0.02, 0.0, 1.0) * (1.0 - clamp((C - 0.15) / 0.05, 0.0, 1.0))
        * clamp((L - 0.12) / 0.08, 0.0, 1.0) * (1.0 - clamp((L - 0.82) / 0.1, 0.0, 1.0));
      h += d * uSkinU * w;
      C = mix(C, uSkinC, 0.35 * uSkinU * w);
    }
    if (uMixOn > 0.5) {
      float sum = 0.0, dh = 0.0, ds = 0.0, dl = 0.0;
      for (int i = 0; i < 8; i++) {
        float d = mod(h - uMixC[i] + 9.424778, 6.283185) - 3.141593;
        float w = exp(-d * d / (2.0 * uMixW[i] * uMixW[i]));
        sum += w;
        dh += w * uMixH[i];
        ds += w * uMixS[i];
        dl += w * uMixL[i];
      }
      float colourful = smoothstep(0.02, 0.06, C) / sum; // greys have no hue to pick a band by, so they stay put
      h += dh * colourful * 0.5236;
      C *= max(0.0, 1.0 + ds * colourful);
      L += dl * colourful * 0.1;
    }
    c = oklab_to_srgb(vec3(L, C * cos(h), C * sin(h)));
  }

  // Match look: move the colours (and light) statistics to the reference photo's, in Oklab
  if (uMatch > 0.001) {
    vec3 lab = srgb_to_oklab(c);
    vec3 moved = (lab - uSrcMean) / max(uSrcStd, vec3(0.0001)) * uRefStd + uRefMean;
    if (uMatchTone < 0.5) moved.x = lab.x;
    c = mix(c, oklab_to_srgb(moved), uMatch);
  }

  // 3. Blur / Pixelate modes (radius is in px on a 1000px photo)
  float radius = blurRadius * big / 1000.0;
  if (blurMode == 1 && blurRadius > 0.5) {
    c = box_blur(st, vec2(radius) / res);
  } else if (blurMode == 2 && blurRadius > 0.5) {
    c = mix(c, box_blur(st, vec2(radius) / res), smoothstep(0.2, 0.6, length(st - 0.5)));
  } else if (blurMode == 3 && blurRadius > 1.0) {
    c = texture2D(img, snap(st, res / radius)).rgb;
  }

  // 4. Photometric Color Grading Presets (1-23 in code, film stocks from the LUT)
  vec3 graded = c;
  if (preset == 1) graded = nashville_grade(c);
  else if (preset == 2) graded = chief_keef_grade(c, st);
  else if (preset == 3) graded = nuke_grade(c, st, big);
  else if (preset == 4) graded = phreshboy_grade(c);
  else if (preset == 5) graded = sepia_grade(c);
  else if (preset == 6) graded = matte_2014_grade(c);
  else if (preset == 7) graded = banknote_grade(c, st * res, big);
  else if (preset == 8) graded = pandora_grade(c);
  else if (preset == 9) graded = bleach_bypass_grade(c);
  else if (preset == 10) graded = trix_bw_grade(c);
  else if (preset == 11) graded = cross_process_grade(c);
  else if (preset == 12) graded = faded_print_grade(c);
  else if (preset == 13) graded = teal_orange_grade(c);
  else if (preset == 14) graded = noir_grade(c);
  else if (preset == 15) graded = nokia_grade(c, nokiaCell);
  else if (preset == 16) graded = camcorder_grade(c, st, big);
  else if (preset == 17) graded = iphone3gs_grade(c, st, big);
  else if (preset == 18) graded = brainwash_grade(c);
  else if (preset == 19) graded = lux2012_grade(c, st, big);
  else if (preset == 20) graded = club_grade(c, st, big);
  else if (preset == 21) graded = faded_ig_grade(c);
  else if (preset == 22) graded = tungsten_grade(c, st, big);
  else if (preset == 23) graded = cold_vhs_grade(c, st, big);
  else if (uLut > 0.5) graded = lut3d(c);

  c = mix(c, graded, amount);

  // Halation (Cinestill brings its own): light scattered back off the film base, so its spread follows how much
  // light there is (no cutoff); it shows most around lights, a little on top of them.
  vec3 local = texture2D(fx, st).rgb;
  float hal = uHalation + (preset == 26 ? 0.6 * amount : 0.0);
  if (hal > 0.01) {
    float glowOn = 1.0 - 0.7 * smoothstep(0.6, 1.0, luma(c));
    c = lin2srgb(srgb2lin(c) + local.r * vec3(1.0, 0.28, 0.08) * 2.5 * hal * glowOn);
  }

  // Clarity (guided filter): where the neighbourhood is flat the local mean is the base and detail is lifted; at an
  // edge the variance is high, the base follows the pixel itself, and nothing is added, so there is no halo.
  if (abs(uClarity) > 0.01) {
    float Y0 = luma(texture2D(img, st).rgb);
    float a = max(local.b - local.g * local.g, 0.0);
    a /= a + 0.003;
    float Y = luma(c);
    c += (Y0 - mix(local.g, Y0, a)) * uClarity * 2.0 * (4.0 * Y * (1.0 - Y));
  }

  // 5. Contrast and fade work on the picture as seen (pivot on mid-grey)
  c = (c - 0.5) * contrast + 0.5;
  c = c * (1.0 - fade * 0.32) + fade * 0.14;

  // 6. Light: bloom, flare, white balance and vignette in linear light, then the highlight shoulder
  float flare = smoothstep(0.85, 1.0, luma(c)) * lensReflection; // picked by how bright it looks
  c = srgb2lin(c);
  if (bloomAmount > 0.01) { // CCD Bloom & Vertical Smear
    vec3 smear = apply_ccd_smear(st, max(3.0, res.y / 300.0) / res.y) * bloomAmount;
    vec3 bColor = vec3(1.0 + bloomTint * 0.3, 1.0, 1.0 - bloomTint * 0.3);
    c += smear * bColor * 1.5;
  }
  c += flare * vec3(0.4, 0.7, 1.0) * 0.5;
  c *= vec3(1.0 + warmth * 0.25, 1.0, 1.0 - warmth * 0.25);
  c *= pow(1.0 - vignette * smoothstep(0.3, 0.8, length(st - 0.5) * 1.25), 2.2); // same strength as before, as light
  c = lin2srgb(shoulder(c));

  // 7. Sensor Degradation Module 3: grain in film-grain-sized cells, CCD colour noise per pixel
  if (grain > 0.01 && uDigitalGrain > 0.5) {
    c = apply_film_grain(c, floor(gl_FragCoord.xy / max(1.0, big / 1500.0)), uTime, grain * 0.35);
  } else if (grain > 0.01) {
    c = film_grain(c, gl_FragCoord.xy + uTime * 997.0, max(0.7, mix(0.8, 2.8, uGrainSize) * big / 1500.0), grain * 0.7);
  }
  if (ccdNoise > 0.01) {
    vec3 cnoise = vec3(hash12(gl_FragCoord.xy + 1.7), hash12(gl_FragCoord.xy + 11.3), hash12(gl_FragCoord.xy + 23.9)) - 0.5;
    c += cnoise * ccdNoise * 0.3;
  }

  // 8. Extras (real JPEG compression happens before the shader: see crushed)
  if (uNoise > 0.5) {
    c += (hash12(gl_FragCoord.xy * 1.7) - 0.5) * 0.12;
  }
  if (uSharpen > 0.5) { // unsharp mask: add back the difference from a small blur
    vec2 t = vec2(max(1.0, big / 1200.0)) / res;
    vec3 bl = (texture2D(img, st + vec2(t.x, 0.0)).rgb + texture2D(img, st - vec2(t.x, 0.0)).rgb +
               texture2D(img, st + vec2(0.0, t.y)).rgb + texture2D(img, st - vec2(0.0, t.y)).rgb) * 0.25;
    c += (texture2D(img, st).rgb - bl) * 1.5;
  }

  // 9. Glitch modes: VHS tracking bar / LCD subpixel grid
  if (glitchMode == 2 && glitchAmount > 0.01) {
    float bar = smoothstep(0.9, 0.98, sin(st.y * 8.0 + uTime * 3.0));
    c = mix(c, vec3(hash12(gl_FragCoord.xy)), bar * glitchAmount * 0.6);
  } else if (glitchMode == 3 && glitchAmount > 0.01) {
    float px = max(1.0, floor(big / 640.0));
    int sub = int(mod(floor(st.x * res.x / px), 3.0));
    if (sub == 0) c.gb *= (1.0 - glitchAmount * 0.4);
    else if (sub == 1) c.rb *= (1.0 - glitchAmount * 0.4);
    else c.rg *= (1.0 - glitchAmount * 0.4);
    if (mod(floor(st.y * res.y / px), 3.0) < 1.0) c *= 1.0 - glitchAmount * 0.3;
  }

  gl_FragColor = vec4(clamp(c + (ign(gl_FragCoord.xy) - 0.5) / 255.0, 0.0, 1.0), 1.0);
}`;

// Pre-pass for halation and clarity, run once per photo on a quarter-size copy: mode 0 writes light energy, tone and
// tone squared; mode 1 is one direction of a Gaussian blur (25 taps, sigma 4 taps). The main shader reads the result.
export const FX_FRAG = `precision mediump float;
uniform sampler2D img, src;
uniform int mode;
uniform vec2 dir;
varying vec2 uv;
void main() {
  if (mode == 0) {
    vec3 c = texture2D(img, uv).rgb;
    vec3 l = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
    float E = dot(l, vec3(0.2126, 0.7152, 0.0722));
    float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(E * E * E * E, Y, Y * Y, 1.0); // E^4: bright light dominates without a hard threshold
  } else {
    vec4 s = vec4(0.0);
    float w = 0.0;
    for (int i = -12; i <= 12; i++) {
      float x = float(i);
      float g = exp(-x * x / 32.0);
      s += texture2D(src, uv + dir * x) * g;
      w += g;
    }
    gl_FragColor = s / w;
  }
}`;

export interface Fx {
  prog: WebGLProgram;
  tex: [WebGLTexture, WebGLTexture];
  fbo: [WebGLFramebuffer, WebGLFramebuffer];
  half: number; // HALF_FLOAT_OES when the phone can render to it, else 0 (8-bit)
}

/** Build the blurred quarter-size copy of whatever is on texture unit 0, leave it on unit 2, restore the main pass. */
export function buildFx(ctx: WebGLRenderingContext, prog: WebGLProgram, fx: Fx | undefined, w: number, h: number): Fx | undefined {
  if (!fx) {
    const p = ctx.createProgram()!;
    for (const [type, src] of [
      [ctx.VERTEX_SHADER, VERT],
      [ctx.FRAGMENT_SHADER, FX_FRAG],
    ] as const) {
      const sh = ctx.createShader(type)!;
      ctx.shaderSource(sh, src);
      ctx.compileShader(sh);
      ctx.attachShader(p, sh);
    }
    ctx.bindAttribLocation(p, 0, 'p');
    ctx.linkProgram(p);
    if (!ctx.getProgramParameter(p, ctx.LINK_STATUS)) return undefined;
    const hf = ctx.getExtension('OES_texture_half_float');
    ctx.getExtension('EXT_color_buffer_half_float');
    ctx.getExtension('OES_texture_half_float_linear');
    fx = {
      prog: p,
      tex: [ctx.createTexture()!, ctx.createTexture()!],
      fbo: [ctx.createFramebuffer()!, ctx.createFramebuffer()!],
      half: hf ? hf.HALF_FLOAT_OES : 0,
    };
  }
  const qw = Math.max(1, Math.round(w / 4));
  const qh = Math.max(1, Math.round(h / 4));
  ctx.activeTexture(ctx.TEXTURE3);
  for (let i = 0; i < 2; i++) {
    ctx.bindTexture(ctx.TEXTURE_2D, fx.tex[i]);
    for (const k of [ctx.TEXTURE_WRAP_S, ctx.TEXTURE_WRAP_T]) ctx.texParameteri(ctx.TEXTURE_2D, k, ctx.CLAMP_TO_EDGE);
    for (const k of [ctx.TEXTURE_MIN_FILTER, ctx.TEXTURE_MAG_FILTER]) ctx.texParameteri(ctx.TEXTURE_2D, k, ctx.LINEAR);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, qw, qh, 0, ctx.RGBA, fx.half || ctx.UNSIGNED_BYTE, null);
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, fx.fbo[i]);
    ctx.framebufferTexture2D(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.TEXTURE_2D, fx.tex[i], 0);
    if (fx.half && ctx.checkFramebufferStatus(ctx.FRAMEBUFFER) !== ctx.FRAMEBUFFER_COMPLETE) {
      fx.half = 0; // this phone can't render to half floats: start again in 8 bits
      ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
      return buildFx(ctx, prog, fx, w, h);
    }
  }
  ctx.useProgram(fx.prog);
  ctx.viewport(0, 0, qw, qh);
  const u = (n: string) => ctx.getUniformLocation(fx!.prog, n);
  ctx.uniform1i(u('img'), 0);
  ctx.uniform1i(u('src'), 3);
  const tap = Math.max(w, h) / 2400; // quarter-size px per tap: sigma = 4 taps = long side / 150 at full size
  const passes: [number, number, number, number, number][] = [
    [0, 0, 0, 0, 0], // mode, from, to, dx, dy: energy and tone into tex 0
    [1, 0, 1, tap / qw, 0], // blur across into tex 1
    [1, 1, 0, 0, tap / qh], // blur down into tex 0
  ];
  passes.forEach(([mode, from, to, dx, dy]) => {
    ctx.bindTexture(ctx.TEXTURE_2D, mode ? fx!.tex[from] : null);
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, fx!.fbo[to]);
    ctx.uniform1i(u('mode'), mode);
    ctx.uniform2f(u('dir'), dx, dy);
    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
  });
  ctx.bindTexture(ctx.TEXTURE_2D, null);
  ctx.bindFramebuffer(ctx.FRAMEBUFFER, null);
  ctx.activeTexture(ctx.TEXTURE2);
  ctx.bindTexture(ctx.TEXTURE_2D, fx.tex[0]);
  ctx.activeTexture(ctx.TEXTURE0);
  ctx.useProgram(prog);
  ctx.viewport(0, 0, w, h);
  return fx;
}

export interface Gl {
  ctx: WebGLRenderingContext;
  prog: WebGLProgram;
  lut: number; // the film look whose LUT is on texture unit 1
  fx?: Fx;
}

/** The canvas's WebGL context with the Darkroom shader built and its textures set up, or an error to show. */
export function initGl(cv: HTMLCanvasElement): Gl | string {
  const ctx = cv.getContext('webgl', { preserveDrawingBuffer: true });
  if (!ctx) return "This browser can't run WebGL, which Darkroom needs.";
  const prog = ctx.createProgram()!;
  for (const [type, src] of [
    [ctx.VERTEX_SHADER, VERT],
    [ctx.FRAGMENT_SHADER, FRAG],
  ] as const) {
    const s = ctx.createShader(type)!;
    ctx.shaderSource(s, src);
    ctx.compileShader(s);
    if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) return 'Shader error: ' + ctx.getShaderInfoLog(s);
    ctx.attachShader(prog, s);
  }
  ctx.linkProgram(prog);
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) return 'Shader compilation error: ' + ctx.getProgramInfoLog(prog);
  ctx.useProgram(prog);
  ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
  ctx.enableVertexAttribArray(0);
  ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0);
  ctx.bindTexture(ctx.TEXTURE_2D, ctx.createTexture());
  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
  // film-look LUT on texture unit 1 (filled when a film look is picked); the photo stays on unit 0
  ctx.activeTexture(ctx.TEXTURE1);
  ctx.bindTexture(ctx.TEXTURE_2D, ctx.createTexture());
  for (const k of [ctx.TEXTURE_WRAP_S, ctx.TEXTURE_WRAP_T]) ctx.texParameteri(ctx.TEXTURE_2D, k, ctx.CLAMP_TO_EDGE);
  for (const k of [ctx.TEXTURE_MIN_FILTER, ctx.TEXTURE_MAG_FILTER]) ctx.texParameteri(ctx.TEXTURE_2D, k, ctx.LINEAR);
  ctx.activeTexture(ctx.TEXTURE0);
  ctx.uniform1i(ctx.getUniformLocation(prog, 'lut'), 1);
  ctx.uniform1i(ctx.getUniformLocation(prog, 'fx'), 2);
  return { ctx, prog, lut: 0 };
}

/** Draw the photo on texture unit 0 through the look `p`. matchStats: [source mean, std, reference mean, std] in Oklab. */
export function drawFrame(g: Gl, p: DarkroomParams, matchStats: number[][] | null, skin: [number, number] | null) {
  const { ctx, prog } = g;
  const u = (n: string) => ctx.getUniformLocation(prog, n);
  ctx.uniform2f(u('res'), ctx.canvas.width, ctx.canvas.height);
  ctx.uniform1i(u('preset'), p.preset);
  ctx.uniform1f(u('uLut'), isLutLook(p.preset) ? 1 : 0);
  if (isLutLook(p.preset) && g.lut !== p.preset) {
    g.lut = p.preset;
    ctx.activeTexture(ctx.TEXTURE1);
    ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, false);
    const n = LUT_SIZE;
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, n * n, n, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, filmLut(p.preset));
    ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
    ctx.activeTexture(ctx.TEXTURE0);
  }
  ctx.uniform1f(u('amount'), p.amount);
  ctx.uniform1f(u('contrast'), p.contrast);
  ctx.uniform1f(u('warmth'), p.warmth);
  ctx.uniform1f(u('fade'), p.fade);
  ctx.uniform1f(u('vignette'), p.vignette);
  ctx.uniform1f(u('grain'), p.iphone6Grain ? Math.max(p.grain, 0.45) : p.grain);
  ctx.uniform1f(u('uDigitalGrain'), p.iphone6Grain ? 1 : 0);
  ctx.uniform1f(u('uGrainSize'), p.grainSize);
  ctx.uniform1f(u('uHalation'), p.halation);
  ctx.uniform1f(u('uClarity'), p.clarity);
  ctx.uniform1f(u('bloomAmount'), p.bloomAmount);
  ctx.uniform1f(u('bloomTint'), p.bloomTint);
  ctx.uniform1f(u('lensReflection'), p.lensReflection);
  ctx.uniform1f(u('ccdNoise'), p.ccdNoise);
  ctx.uniform1i(u('blurMode'), p.blurMode);
  ctx.uniform1f(u('blurRadius'), p.blurRadius);
  ctx.uniform1i(u('glitchMode'), p.glitchMode);
  ctx.uniform1f(u('glitchAmount'), p.glitchAmount);
  ctx.uniform1f(u('glitchThreshold'), p.glitchThreshold);
  ctx.uniform1f(u('uMatch'), matchStats ? p.match : 0);
  ctx.uniform1f(u('uMatchTone'), p.matchTone ? 1 : 0);
  const [sm, ss, rm, rs] = matchStats || [
    [0, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
    [1, 1, 1],
  ];
  ctx.uniform3fv(u('uSrcMean'), sm);
  ctx.uniform3fv(u('uSrcStd'), ss);
  ctx.uniform3fv(u('uRefMean'), rm);
  ctx.uniform3fv(u('uRefStd'), rs);
  ctx.uniform1fv(u('uMixC'), MIX_C);
  ctx.uniform1fv(u('uMixW'), MIX_W);
  ctx.uniform1fv(u('uMixH'), p.mixHue);
  ctx.uniform1fv(u('uMixS'), p.mixSat);
  ctx.uniform1fv(u('uMixL'), p.mixLum);
  ctx.uniform1f(u('uMixOn'), [...p.mixHue, ...p.mixSat, ...p.mixLum].some((v) => v) ? 1 : 0);
  ctx.uniform1f(u('uSkinU'), skin ? p.skinUniform : 0);
  ctx.uniform1f(u('uSkinH'), skin?.[0] ?? 0);
  ctx.uniform1f(u('uSkinC'), skin?.[1] ?? 0);
  ctx.uniform1f(u('uNoise'), p.jpegNoise ? 1.0 : 0.0);
  ctx.uniform1f(u('uSharpen'), p.jpegSharpen ? 1.0 : 0.0);
  ctx.uniform1f(u('uPixel2x'), p.pixelate2x ? 1.0 : 0.0);
  ctx.uniform1f(u('uTime'), (Date.now() % 100000) / 1000.0);
  ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
}
