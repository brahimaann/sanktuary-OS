import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { fileUrl, shell, toolbar, button } from './TeamFiles';
import SevenSegmentDisplay from '../components/SevenSegmentDisplay';
import FilePicker, { FileRef } from '../components/FilePicker';
import { isTouch, saveFilesToDevice, saveToDevice } from './fileTypes';
import { uploadFiles } from '../utils/upload';
import { drawText, TEXT_STYLES, TextOverlayItem, TextStyle } from '../utils/captions';

/**
 * Darkroom: Professional retro image grading & degradation suite.
 * Lightroom Mobile-inspired progressive disclosure layout (65% photo loupe, 2-tier bottom thumb dock)
 * completely dressed in authentic Windows 98 / retro OS styling.
 *
 * Editing model: each tab shows only its own live edit. Save commits it as a new version (the next tab edits
 * on top of it); switching tabs drops an unsaved edit. Undo / Redo step through the saved versions.
 */
interface Props {
  app?: string;
  dir?: string[];
  name?: string;
}

// ── Color Grading Presets ──
export interface FilterPreset {
  id: number;
  name: string;
  category: 'swag' | 'goth' | 'camera';
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
];

// ── Collage Presets & Types ──
export type CollageGridPreset =
  'single' | 'split-v' | 'split-h' | '3-col' | '3-row' | '2x2' | 'banner-top' | 'banner-bottom' | 'hero-left' | 'hero-right';

export type AspectRatioPreset = 'photo' | '1:1' | '4:3' | '16:9' | '3:4' | '9:16';
type Fit = 'crop' | 'fit' | 'stretch' | 'none'; // none: no photos, just the background and text

export interface CollageSlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollageGridDefinition {
  id: CollageGridPreset;
  name: string;
  desc: string;
  slotCount: number;
  slots: CollageSlotRect[];
}

export const COLLAGE_GRIDS: CollageGridDefinition[] = [
  { id: 'single', name: 'Single Frame', desc: '1 frame border layout', slotCount: 1, slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
  {
    id: 'split-v',
    name: '2-Frame Split V',
    desc: '2 vertical split frames (top & bottom)',
    slotCount: 2,
    slots: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'split-h',
    name: '2-Frame Split H',
    desc: '2 side-by-side horizontal frames',
    slotCount: 2,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: '3-col',
    name: '3-Column Split',
    desc: '3 vertical columns side-by-side',
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ],
  },
  {
    id: '3-row',
    name: '3-Row Stack',
    desc: '3 horizontal rows stacked vertically',
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 1, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: '2x2',
    name: '2x2 Grid',
    desc: '4 equal quadrants',
    slotCount: 4,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'banner-top',
    name: 'Banner Top',
    desc: 'Mixed: 1 wide banner top, 2 split bottom',
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'banner-bottom',
    name: 'Banner Bottom',
    desc: 'Mixed: 2 split top, 1 wide banner bottom',
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'hero-left',
    name: 'Hero Left',
    desc: 'Mixed: 1 large hero left, 2 stacked right',
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: 'hero-right',
    name: 'Hero Right',
    desc: 'Mixed: 2 stacked left, 1 large hero right',
    slotCount: 3,
    slots: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
];

export interface AspectRatioDefinition {
  id: AspectRatioPreset;
  name: string;
  width: number;
  height: number;
}

export const ASPECT_RATIOS: AspectRatioDefinition[] = [
  { id: 'photo', name: 'Same as photo', width: 0, height: 0 },
  { id: '1:1', name: '1:1 (Square)', width: 1200, height: 1200 },
  { id: '4:3', name: '4:3 (Standard digicam)', width: 1200, height: 900 },
  { id: '16:9', name: '16:9 (Widescreen)', width: 1280, height: 720 },
  { id: '3:4', name: '3:4 (Portrait)', width: 900, height: 1200 },
  { id: '9:16', name: '9:16 (Vertical/Story)', width: 720, height: 1280 },
];

const FITS: [Fit, string, string][] = [
  ['none', 'No photo', 'Just the background colour and the text (a text card)'],
  ['crop', 'Crop to fill', 'Fills each frame, trimming the edges that overflow (no distortion)'],
  ['fit', 'Whole photo', 'Shows the whole photo, with background around it'],
  ['stretch', 'Stretch', 'Stretches or squashes the photo to the frame'],
];

type Source = HTMLImageElement | HTMLCanvasElement;
const dims = (s: Source) => (s instanceof HTMLImageElement ? [s.naturalWidth, s.naturalHeight] : [s.width, s.height]);

/**
 * Match look: the average and spread of a picture's light (L) and colour (a, b) in Oklab, from a small copy.
 * The same maths as srgb_to_oklab in the shader, so the shader can move one picture's numbers onto another's
 * (Reinhard-style colour transfer).
 */
function labStats(img: Source): [number[], number[]] {
  const [w, h] = dims(img);
  const k = Math.min(1, 256 / Math.max(w, h, 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [lin(d[i]), lin(d[i + 1]), lin(d[i + 2])];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lab = [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
    for (let j = 0; j < 3; j++) {
      sum[j] += lab[j];
      sq[j] += lab[j] * lab[j];
    }
  }
  const n = d.length / 4;
  const mean = sum.map((v) => v / n);
  return [mean, sq.map((v, j) => Math.max(0.0001, Math.sqrt(Math.max(0, v / n - mean[j] * mean[j]))))];
}

// crop: fill the slot and trim the overflow; fit: whole photo inside the slot; stretch: fill it, distorting
function drawImageIn(ctx: CanvasRenderingContext2D, img: Source, dx: number, dy: number, dw: number, dh: number, fit: Fit) {
  const [iw, ih] = dims(img);
  if (!iw || !ih || dw <= 0 || dh <= 0) return;
  const s = fit === 'crop' ? Math.max(dw / iw, dh / ih) : Math.min(dw / iw, dh / ih);
  const [w, h] = fit === 'stretch' ? [dw, dh] : [iw * s, ih * s];
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
  ctx.restore();
}

export interface DarkroomParams {
  preset: number;
  amount: number;
  contrast: number;
  warmth: number;
  fade: number;
  vignette: number;
  grain: number;
  iphone6Grain: boolean;
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
}

const DEFAULT_PARAMS: DarkroomParams = {
  preset: 0,
  amount: 1,
  contrast: 1,
  warmth: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  iphone6Grain: false,
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
};

const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = (p + 1.0) / 2.0; gl_Position = vec4(p, 0.0, 1.0); }`;

// Sizes that should look the same on a phone snap and a 24MP file scale with `big` (the long side in pixels).
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
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
uniform float uNoise;
uniform float uSharpen;
uniform float uPixel2x;
uniform float uTime;

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

// ── Oklab Transformations (Ottosson) ──
vec3 srgb_to_oklab(vec3 c) {
  vec3 lrgb = pow(clamp(c, 0.0, 1.0), vec3(2.2));
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
  return pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / 2.2));
}

// 7x7 box blur over +-off. Each pixel jitters the grid, so big radii come out smooth instead of as ghost copies.
vec3 box_blur(vec2 st, vec2 off) {
  vec3 s = vec3(0.0);
  vec2 j = vec2(hash12(gl_FragCoord.xy), hash12(gl_FragCoord.yx + 3.1)) - 0.5;
  for (int i = -3; i <= 3; i++) {
    for (int k = -3; k <= 3; k++) s += texture2D(img, st + (vec2(float(i), float(k)) + j) * off / 3.0).rgb;
  }
  return s / 49.0;
}

// ── Physical Degradation Module 1: CCD Bloom & Vertical Smear ──
vec3 apply_ccd_smear(vec2 uvCoord, float stepY) {
  vec3 smear = vec3(0.0);
  for (float i = -12.0; i <= 12.0; i += 1.0) {
    vec3 sampleColor = texture2D(img, uvCoord + vec2(0.0, i * stepY)).rgb;
    float bloom = smoothstep(0.9, 1.0, luma(sampleColor));
    smear += sampleColor * bloom * (1.0 - abs(i) / 12.0);
  }
  return smear * 0.18;
}

// ── Physical Degradation Module 3: Photographic Grain (Poisson / sqrt variance) ──
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

  // 4. Photometric Color Grading Presets (1-18)
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

  c = mix(c, graded, amount);

  // 5. Sensor Degradation Module 1: CCD Bloom & Vertical Smear
  if (bloomAmount > 0.01) {
    vec3 smear = apply_ccd_smear(st, max(3.0, res.y / 300.0) / res.y) * bloomAmount;
    vec3 bColor = vec3(1.0 + bloomTint * 0.3, 1.0, 1.0 - bloomTint * 0.3);
    c += smear * bColor * 1.5;
  }
  if (lensReflection > 0.01) {
    float flare = smoothstep(0.85, 1.0, luma(c)) * lensReflection;
    c += flare * vec3(0.4, 0.7, 1.0) * 0.5;
  }

  // 6. Contrast, Warmth, Fade, Vignette
  c = (c - 0.5) * contrast + 0.5;
  c *= vec3(1.0 + warmth * 0.12, 1.0, 1.0 - warmth * 0.12);
  c = c * (1.0 - fade * 0.32) + fade * 0.14;
  c *= 1.0 - vignette * smoothstep(0.3, 0.8, length(st - 0.5) * 1.25);

  // 7. Sensor Degradation Module 3: grain in film-grain-sized cells, CCD colour noise per pixel
  if (grain > 0.01) {
    c = apply_film_grain(c, floor(gl_FragCoord.xy / max(1.0, big / 1500.0)), uTime, grain * 0.35);
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

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const TABS = [
  ['collage', 'Collage'],
  ['swag', 'Swag Filters'],
  ['goth', 'Goth Filters'],
  ['jpeg', 'JPEG Degradation'],
  ['ccd', 'CCD Bloom'],
  ['camera', '1-Click Cameras'],
  ['blur', 'Blur & Pixel'],
  ['glitch', 'Glitch FX'],
  ['match', 'Match look'],
  ['carousel', 'Carousel'],
  ['versions', 'Versions'],
] as const;
type Tab = (typeof TABS)[number][0];

/** A saved step. Undo / Redo move through these. */
interface Version {
  img: HTMLImageElement;
  name: string;
  time: string;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const forget = (vs: Version[]) => vs.forEach((v) => v.img.src.startsWith('blob:') && URL.revokeObjectURL(v.img.src));

const Darkroom: React.FC<Props> = ({ app, dir = [], name }) => {
  const { getToken } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{ ctx: WebGLRenderingContext; prog: WebGLProgram } | null>(null);

  const [history, setHistory] = useState<Version[]>([]);
  const [pos, setPos] = useState(0);
  const saved = history[pos]?.img ?? null;
  const [title, setTitle] = useState(name || 'Untitled');
  const [params, setParams] = useState<DarkroomParams>(DEFAULT_PARAMS);
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('swag');

  // Server file picker state for iPhone / mobile & desktop
  // what the server picker is for: opening a photo, the Match look reference, or carousel slides
  const [showServerPicker, setShowServerPicker] = useState<false | 'open' | 'ref' | 'slides'>(false);
  const [matchRef, setMatchRef] = useState<{ img: HTMLImageElement; name: string } | null>(null);
  const [refStats, setRefStats] = useState<[number[], number[]] | null>(null);
  const pickReference = (img: HTMLImageElement, name: string) => {
    setMatchRef({ img, name });
    setRefStats(labStats(img));
    setParams((prev) => ({ ...prev, match: prev.match || 0.8 }));
    setStatus(`Matching the look of ${name}. Save to keep it.`);
  };

  // Collage State
  const [collageGrid, setCollageGrid] = useState<CollageGridPreset>('single');
  const [collageAspect, setCollageAspect] = useState<AspectRatioPreset>('photo');
  const [collageFit, setCollageFit] = useState<Fit>('crop');
  const [collageSlots, setCollageSlots] = useState<(HTMLImageElement | null)[]>([null]);
  const [collageBgColor, setCollageBgColor] = useState<string>('#222222');
  const [collageBgImage, setCollageBgImage] = useState<HTMLImageElement | null>(null);
  const [collageGap, setCollageGap] = useState<number>(8);
  const [textOverlays, setTextOverlays] = useState<TextOverlayItem[]>([]);
  // "IG post 2012": the photo inside an old Instagram post (username, likes, caption) instead of a grid
  const [igPost, setIgPost] = useState<{ user: string; likes: string; caption: string } | null>(null);
  // The collage is only composed once it's been changed on the Collage tab, so just opening the tab changes nothing
  const [isCollageActive, setIsCollageActive] = useState<boolean>(false);
  const [collageOut, setCollageOut] = useState<HTMLCanvasElement | null>(null);

  // What the loupe edits: the collage preview while composing one, otherwise the current saved version
  // (holding Compare on the Collage tab shows the photo before the collage)
  // Carousel (Instagram, 4:5 slides): one wide photo split into seamless slides, or one photo per slide
  const [slides, setSlides] = useState<HTMLImageElement[]>([]);
  const [carMode, setCarMode] = useState<'split' | 'photos'>('split');
  const [carCount, setCarCount] = useState(3);
  const [carText, setCarText] = useState<string[]>([]);
  const [carStyle, setCarStyle] = useState<TextStyle>('plain');
  const [carouselOut, setCarouselOut] = useState<HTMLCanvasElement | null>(null);
  const [redraw, setRedraw] = useState(0); // bumped after an export used the canvas, to put the preview back
  const addSlides = (imgs: HTMLImageElement[]) => {
    setSlides((prev) => [...prev, ...imgs].slice(0, 10));
    setCarMode('photos');
    setStatus('');
  };
  const slideCount = carMode === 'split' ? carCount : slides.length;
  /** Slide i as a canvas at `k` × 1080x1350: its part of the wide photo (or its own photo), then its caption. */
  const slideCanvas = (i: number, k: number) => {
    const [W, H] = [Math.round(1080 * k), Math.round(1350 * k)];
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    if (carMode === 'split' && saved) {
      const [iw, ih] = dims(saved);
      const s = Math.max((slideCount * W) / iw, H / ih); // the photo covers the whole strip; this slide is one window of it
      x.drawImage(saved, (slideCount * W - iw * s) / 2 - i * W, (H - ih * s) / 2, iw * s, ih * s);
    } else if (slides[i]) drawImageIn(x, slides[i], 0, 0, W, H, 'crop');
    if (carText[i]?.trim())
      drawText(
        x,
        {
          id: `s${i}`,
          text: carText[i],
          fontSize: 60,
          color: '#ffffff',
          fontFamily: 'Arial',
          align: 'center',
          xPercent: 50,
          yPercent: 82,
          shadow: true,
          style: carStyle,
        },
        W,
        H,
      );
    return c;
  };
  // The preview: every slide side by side (half size), with a gap where the swipe is
  useEffect(() => {
    if (activeTab !== 'carousel' || !slideCount || (carMode === 'split' && !saved)) return setCarouselOut(null);
    const [w, h, gap] = [540, 675, 16];
    const strip = document.createElement('canvas');
    strip.width = slideCount * w + (slideCount - 1) * gap;
    strip.height = h;
    const x = strip.getContext('2d')!;
    x.fillStyle = '#c0c0c0';
    x.fillRect(0, 0, strip.width, h);
    for (let i = 0; i < slideCount; i++) x.drawImage(slideCanvas(i, 0.5), i * (w + gap), 0);
    setCarouselOut(strip);
  }, [activeTab, carMode, carCount, slides, carText, carStyle, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const source: Source | null =
    activeTab === 'carousel' && carouselOut
      ? carouselOut
      : activeTab === 'collage' && collageOut && !(compare && saved)
        ? collageOut
        : saved;
  // Match look: this photo's numbers and the reference's, for the shader
  const matchStats = useMemo(
    () => (refStats && source ? ([...labStats(source), ...refStats] as [number[], number[], number[], number[]]) : null),
    [refStats, source],
  );
  const dirty = isCollageActive || (Object.keys(DEFAULT_PARAMS) as (keyof DarkroomParams)[]).some((k) => params[k] !== DEFAULT_PARAMS[k]);
  const canUndo = dirty || pos > 0;
  const canRedo = pos < history.length - 1;

  const startWith = (img: HTMLImageElement, t?: string) => {
    forget(history);
    setHistory([{ img, name: 'Original', time: now() }]);
    setPos(0);
    setParams(DEFAULT_PARAMS);
    setIsCollageActive(false);
    setCollageSlots((prev) => [img, ...prev.slice(1)]);
    if (t) setTitle(t);
  };

  const dropEdit = () => {
    setParams(DEFAULT_PARAMS);
    setIsCollageActive(false);
  };

  const switchTab = (t: Tab) => {
    if (t === activeTab) return;
    if (dirty) setStatus('Unsaved edit dropped. Press Save before switching tabs to keep an edit.');
    dropEdit();
    setActiveTab(t);
  };

  const goTo = (i: number) => {
    dropEdit();
    setPos(i);
    setStatus(`Showing "${history[i].name}".`);
  };

  const undo = () => {
    if (dirty) {
      dropEdit();
      return setStatus('Unsaved edit cleared.');
    }
    if (pos > 0) goTo(pos - 1);
  };
  const redo = () => {
    if (!canRedo) return;
    goTo(pos + 1);
    if (dirty) setStatus(`Unsaved edit cleared. Showing "${history[pos + 1].name}".`);
  };

  // Save: the edit on screen becomes the new version the next edits build on
  const saving = useRef(false); // a big PNG takes a moment; a double-click mustn't save twice
  const save = () => {
    const cv = canvasRef.current;
    if (!cv || !dirty || saving.current) return;
    saving.current = true;
    const label =
      activeTab === 'collage'
        ? 'Collage'
        : (params.preset && PRESETS.find((p) => p.id === params.preset)?.name) || TABS.find(([id]) => id === activeTab)![1];
    cv.toBlob((b) => {
      if (!b) {
        saving.current = false;
        return setStatus("Couldn't save this edit.");
      }
      const img = new Image();
      img.onload = () => {
        saving.current = false;
        forget(history.slice(pos + 1)); // saving after an undo replaces the steps that were undone
        const next = [...history.slice(0, pos + 1), { img, name: label, time: now() }];
        // phones reload a page that uses too much memory (each version of a 24MP photo is ~100MB decoded):
        // keep the original + the last 5 saves there, 24 on computers
        if (next.length > (isTouch ? 6 : 25)) forget(next.splice(1, 1));
        setHistory(next);
        setPos(next.length - 1);
        dropEdit();
        setStatus(`Saved "${label}". The next edit builds on it; Undo steps back.`);
      };
      img.onerror = () => {
        saving.current = false;
        setStatus("Couldn't save this edit.");
      };
      img.src = URL.createObjectURL(b);
    }, 'image/png');
  };

  // Switch collage grid and resize slots array gracefully
  const selectCollageGrid = (newGridId: CollageGridPreset) => {
    setCollageGrid(newGridId);
    setIsCollageActive(true);
    const def = COLLAGE_GRIDS.find((g) => g.id === newGridId);
    if (!def) return;
    setCollageSlots((prev) => {
      const next = [...prev];
      while (next.length < def.slotCount) next.push(null);
      return next.slice(0, def.slotCount);
    });
  };

  // Opening the Collage tab puts the current saved version (with its edits) in slot 1,
  // unless slot 1 holds a photo chosen for the collage
  useEffect(() => {
    // (not right after saving a collage: that would put the collage inside itself)
    if (activeTab !== 'collage' || !saved || history[pos]?.name === 'Collage') return;
    setCollageSlots((prev) => (!prev[0] || history.some((v) => v.img === prev[0]) ? [saved, ...prev.slice(1)] : prev));
  }, [activeTab, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compose the collage preview whenever collage settings change
  useEffect(() => {
    if (!isCollageActive || activeTab !== 'collage') return setCollageOut(null);
    if (igPost) {
      // An old (2012) Instagram post: header with the username, the photo square, likes and caption below
      const c = document.createElement('canvas');
      c.width = 1080;
      c.height = 1350;
      const x = c.getContext('2d');
      if (!x) return;
      x.fillStyle = '#fbfaf6';
      x.fillRect(0, 0, 1080, 1350);
      const photo = collageSlots[0];
      if (photo) {
        x.save(); // round avatar from the same photo
        x.beginPath();
        x.arc(70, 66, 40, 0, Math.PI * 2);
        x.clip();
        drawImageIn(x, photo, 30, 26, 80, 80, 'crop');
        x.restore();
        drawImageIn(x, photo, 0, 132, 1080, 1080, 'crop');
      }
      x.fillStyle = '#125688'; // 2012 Instagram's username blue
      x.font = 'bold 38px "Helvetica Neue", Arial, sans-serif';
      x.textBaseline = 'middle';
      x.fillText(igPost.user || 'username', 130, 66);
      x.fillStyle = '#b0b0b0';
      x.font = '32px "Helvetica Neue", Arial, sans-serif';
      x.textAlign = 'right';
      x.fillText('◷ 6d', 1050, 66);
      x.textAlign = 'left';
      x.fillStyle = '#125688';
      x.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
      if (igPost.likes) x.fillText(`♥ ${igPost.likes} likes`, 30, 1252);
      x.fillText(igPost.user || 'username', 30, 1306);
      const w = x.measureText(`${igPost.user || 'username'} `).width;
      x.fillStyle = '#262626';
      x.font = '34px "Helvetica Neue", Arial, sans-serif';
      x.fillText(igPost.caption, 30 + w, 1306);
      return setCollageOut(c);
    }
    const gridDef = COLLAGE_GRIDS.find((g) => g.id === collageGrid) || COLLAGE_GRIDS[0];
    const aspectDef = ASPECT_RATIOS.find((a) => a.id === collageAspect) || ASPECT_RATIOS[0];
    const canvas = document.createElement('canvas');
    if (aspectDef.id === 'photo') {
      const [iw, ih] = collageSlots[0] ? dims(collageSlots[0]) : [1200, 1200];
      const s = Math.min(1, Math.sqrt(16e6 / (iw * ih))); // up to 16MP: iPhone Safari's canvas limit
      canvas.width = Math.round(iw * s);
      canvas.height = Math.round(ih * s);
    } else {
      canvas.width = aspectDef.width;
      canvas.height = aspectDef.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // 1. Background color
    ctx.fillStyle = collageBgColor || '#222222';
    ctx.fillRect(0, 0, W, H);

    // 2. Custom Background image (always fills the frame)
    if (collageBgImage) drawImageIn(ctx, collageBgImage, 0, 0, W, H, 'crop');

    // 3. Render grid slots
    const outerMargin = collageGap;
    const innerW = W - outerMargin * 2;
    const innerH = H - outerMargin * 2;

    gridDef.slots.forEach((slot, idx) => {
      const sx = Math.round(outerMargin + slot.x * innerW + (collageGap > 0 ? collageGap / 2 : 0));
      const sy = Math.round(outerMargin + slot.y * innerH + (collageGap > 0 ? collageGap / 2 : 0));
      const sw = Math.round(slot.w * innerW - (collageGap > 0 ? collageGap : 0));
      const sh = Math.round(slot.h * innerH - (collageGap > 0 ? collageGap : 0));

      if (collageFit === 'none') return; // text on a plain background
      const img = collageSlots[idx];
      if (img) {
        drawImageIn(ctx, img, sx, sy, sw, sh, collageFit);
      } else {
        // Retro placeholder slot box
        ctx.save();
        ctx.fillStyle = '#161616';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
        ctx.setLineDash([]);
        ctx.fillStyle = '#808080';
        ctx.font = `bold ${Math.max(13, Math.round(sw * 0.045))}px Tahoma, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Slot ${idx + 1}: Empty`, sx + sw / 2, sy + sh / 2);
        ctx.restore();
      }
    });

    // 4. Render editable text typography overlays (proportional scaling so text never jumps)
    textOverlays.forEach((txt) => drawText(ctx, txt, W, H));

    setCollageOut(canvas);
  }, [
    activeTab,
    isCollageActive,
    collageGrid,
    collageAspect,
    collageFit,
    collageSlots,
    collageBgColor,
    collageBgImage,
    collageGap,
    textOverlays,
    igPost,
  ]);

  // One-tap layouts from 2012 Instagram / TikTok edits (each one is a starting point: every setting stays editable)
  const quickLook = (look: 'stretch' | 'story' | 'grid' | 'ig' | 'vertical' | 'lyrics' | 'stacked' | 'card') => {
    const photo = collageSlots[0] || saved;
    setIgPost(look === 'ig' ? (igPost ?? { user: 'sanktuary', likes: '6978', caption: '#PartyAtMyHouse' }) : null);
    if (look === 'stretch') {
      // the "stretch picture": the same photo twice, squashed side by side in a tall frame
      setCollageGrid('split-h');
      setCollageSlots([photo, photo]);
      setCollageFit('stretch');
      setCollageAspect('9:16');
      setCollageGap(0);
    } else if (look === 'story') {
      // black bars and a caption over the middle, like a TikTok slideshow
      setCollageGrid('single');
      setCollageSlots([photo]);
      setCollageFit('fit');
      setCollageAspect('9:16');
      setCollageGap(0);
      setCollageBgColor('#000000');
      setTextOverlays([
        {
          id: `txt-${Date.now()}`,
          text: '2012 ...',
          fontSize: 52,
          color: '#ffffff',
          fontFamily: 'Arial',
          align: 'center',
          xPercent: 50,
          yPercent: 50,
          shadow: true,
        },
      ]);
    } else if (look === 'vertical') {
      // a wide music-video frame squashed into a tall one
      setCollageGrid('single');
      setCollageSlots([photo]);
      setCollageFit('stretch');
      setCollageAspect('9:16');
      setCollageGap(0);
    } else if (look === 'lyrics' || look === 'stacked' || look === 'card') {
      // lyric-video text: words spaced in a grid over the photo, huge stacked words over it in black & white, or
      // one soft line on a black card
      setCollageGrid('single');
      setCollageSlots([photo]);
      setCollageFit(look === 'card' ? 'none' : 'crop');
      setCollageAspect('9:16');
      setCollageGap(0);
      setCollageBgColor('#000000');
      if (look === 'stacked') setParam('preset', 10); // Silver B&W underneath
      const text = look === 'lyrics' ? 'i done been a dope head i done been a' : look === 'stacked' ? 'PAIN PAIN PAIN' : 'hella funds';
      setTextOverlays([
        {
          id: `txt-${Date.now()}`,
          text,
          fontSize: look === 'lyrics' ? 110 : 60, // card text stays small, like the reference; stacked sizes itself
          color: '#ffffff',
          fontFamily: 'Arial',
          align: 'center',
          xPercent: 50,
          yPercent: 50,
          shadow: look === 'lyrics',
          style: look === 'lyrics' ? 'grid' : look === 'stacked' ? 'stacked' : 'soft',
        },
      ]);
    } else if (look === 'grid') {
      setCollageGrid('2x2');
      setCollageSlots((prev) => [photo, prev[1] || null, prev[2] || null, prev[3] || null]);
      setCollageFit('crop');
      setCollageAspect('3:4');
      setCollageGap(4);
      setCollageBgColor('#ffffff');
    }
    setIsCollageActive(true);
  };

  // Load team photo if provided
  useEffect(() => {
    if (!app || !name) return;
    let live = true;
    setStatus('Opening photo...');
    getToken().then((token) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => {
        if (!live) return;
        startWith(i);
        setStatus('');
      };
      i.onerror = () => live && setStatus("Couldn't open this photo.");
      const isNative = /\.(jpe?g|png|webp|avif|gif)$/i.test(name);
      i.src = `${fileUrl(app, [...dir, name])}?t=${token}${isNative ? '' : '&preview'}`;
    });
    return () => {
      live = false;
    };
  }, [app, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const openLocal = (f?: File) => {
    if (!f) return;
    const i = new Image();
    i.onload = () => {
      startWith(i, f.name);
      setStatus('');
    };
    i.onerror = () => setStatus("That file isn't an image this browser can open.");
    i.src = URL.createObjectURL(f);
  };

  // Real JPEG (the JPEG tab): the picture is scaled down smoothly and saved as a JPEG at the chosen quality by the
  // browser's own encoder, then drawn back at full size. Real 8x8 blocks, ringing and colour smear, not a filter.
  const [crushed, setCrushed] = useState<HTMLImageElement | null>(null);
  const keep = (img: HTMLImageElement | null) =>
    setCrushed((prev) => {
      if (prev && prev !== img) URL.revokeObjectURL(prev.src);
      return img;
    });
  useEffect(() => {
    if (!source || (params.jpegQuality >= 100 && params.resolution >= 1)) return keep(null);
    let live = true;
    const t = setTimeout(() => {
      const [w, h] = dims(source);
      const c = document.createElement('canvas');
      c.width = Math.max(16, Math.round(w * params.resolution));
      c.height = Math.max(16, Math.round(h * params.resolution));
      const x = c.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      x.drawImage(source, 0, 0, c.width, c.height);
      c.toBlob(
        (b) => {
          if (!b || !live) return;
          const img = new Image();
          img.onload = () => (live ? keep(img) : URL.revokeObjectURL(img.src));
          img.src = URL.createObjectURL(b);
        },
        'image/jpeg',
        Math.max(0.01, params.jpegQuality / 100),
      );
    }, 120); // slider drags: encode once it settles
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [source, params.jpegQuality, params.resolution]); // eslint-disable-line react-hooks/exhaustive-deps

  // Upload the picture to the GPU whenever it changes (the shader program is built once per canvas)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!source || !cv) return;
    if (glRef.current?.ctx.canvas !== cv) {
      const ctx = cv.getContext('webgl', { preserveDrawingBuffer: true });
      if (!ctx) return setStatus("This browser can't run WebGL, which Darkroom needs.");
      const prog = ctx.createProgram()!;
      for (const [type, src] of [
        [ctx.VERTEX_SHADER, VERT],
        [ctx.FRAGMENT_SHADER, FRAG],
      ] as const) {
        const s = ctx.createShader(type)!;
        ctx.shaderSource(s, src);
        ctx.compileShader(s);
        if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) return setStatus('Shader error: ' + ctx.getShaderInfoLog(s));
        ctx.attachShader(prog, s);
      }
      ctx.linkProgram(prog);
      if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
        return setStatus('Shader compilation error: ' + ctx.getProgramInfoLog(prog));
      }
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
      glRef.current = { ctx, prog };
    }
    const { ctx } = glRef.current;
    const [w, h] = dims(source);
    const max = Math.min(ctx.getParameter(ctx.MAX_TEXTURE_SIZE), 8192);
    const scale = Math.min(1, max / Math.max(w, h));
    cv.width = Math.round(w * scale);
    cv.height = Math.round(h * scale);
    // the canvas keeps the picture's full size; a smaller JPEG'd copy is stretched back up smoothly
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, crushed && !compare ? crushed : source);
    ctx.viewport(0, 0, cv.width, cv.height);
    if (scale < 1) setStatus(`Preview scaled to ${cv.width}×${cv.height} (max GPU limit).`);
  }, [source, crushed, compare, redraw]);

  /**
   * The carousel's slides at full size (1080x1350), each drawn through the look chosen on this tab, as JPEGs: to
   * this device (one share sheet on phones: "Save N Images") or into the photo's folder.
   */
  const exportSlides = async (to: 'device' | 'folder') => {
    const g = glRef.current;
    const cv = canvasRef.current;
    if (!g || !cv || !slideCount) return;
    const { ctx, prog } = g;
    const base = title.replace(/\.[^.]+$/, '') || 'carousel';
    const files: File[] = [];
    try {
      for (let i = 0; i < slideCount; i++) {
        setStatus(`Rendering slide ${i + 1} of ${slideCount}...`);
        cv.width = 1080;
        cv.height = 1350;
        ctx.viewport(0, 0, 1080, 1350);
        ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, slideCanvas(i, 1));
        ctx.uniform2f(ctx.getUniformLocation(prog, 'res'), 1080, 1350);
        ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
        const blob = await new Promise<Blob>((ok, no) =>
          cv.toBlob((b) => (b ? ok(b) : no(new Error('Export failed'))), 'image/jpeg', 0.94),
        );
        files.push(new File([blob], `${base} ${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
      }
    } finally {
      setRedraw((n) => n + 1); // the preview comes back
    }
    if (to === 'device') {
      const done = await saveFilesToDevice(files);
      if (done !== 'cancelled')
        setStatus(
          done === 'shared'
            ? `Sent ${files.length} slides (Save Images puts them in Photos, in order).`
            : `Downloaded ${files.length} slides.`,
        );
    } else if (app) {
      setStatus('Saving the slides...');
      try {
        await uploadFiles(
          getToken,
          app,
          dir,
          files.map((f) => ({ file: f, name: f.name })),
        );
        setStatus(`Saved ${files.length} slides in ${dir.join('/') || 'Root'}.`);
      } catch (e) {
        setStatus(`Failed to save: ${(e as Error).message}`);
      }
    }
  };

  // Re-render WebGL frame on param update or compare
  useEffect(() => {
    if (!glRef.current || !canvasRef.current || !source) return;
    const { ctx, prog } = glRef.current;
    const p = compare ? DEFAULT_PARAMS : params;
    const u = (n: string) => ctx.getUniformLocation(prog, n);

    ctx.uniform2f(u('res'), canvasRef.current.width, canvasRef.current.height);
    ctx.uniform1i(u('preset'), p.preset);
    ctx.uniform1f(u('amount'), p.amount);
    ctx.uniform1f(u('contrast'), p.contrast);
    ctx.uniform1f(u('warmth'), p.warmth);
    ctx.uniform1f(u('fade'), p.fade);
    ctx.uniform1f(u('vignette'), p.vignette);
    ctx.uniform1f(u('grain'), p.iphone6Grain ? Math.max(p.grain, 0.45) : p.grain);
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
    ctx.uniform1f(u('uNoise'), p.jpegNoise ? 1.0 : 0.0);
    ctx.uniform1f(u('uSharpen'), p.jpegSharpen ? 1.0 : 0.0);
    ctx.uniform1f(u('uPixel2x'), p.pixelate2x ? 1.0 : 0.0);
    ctx.uniform1f(u('uTime'), (Date.now() % 100000) / 1000.0);

    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
  }, [source, crushed, params, compare, matchStats, redraw]);

  const toJpeg = () =>
    new Promise<Blob>((ok, no) => canvasRef.current!.toBlob((b) => (b ? ok(b) : no(new Error('Export failed'))), 'image/jpeg', 0.94));

  const outName = `${title.replace(/\.[^.]+$/, '') || 'photo'}-darkroom.jpg`;

  const download = async () => {
    const done = await saveToDevice(await toJpeg(), outName);
    if (done !== 'cancelled')
      setStatus(done === 'shared' ? `Sent ${outName} (choose Save Image to put it in Photos).` : `Exported ${outName} at full resolution.`);
  };

  const saveToFolder = async () => {
    if (!app) return;
    setStatus('Exporting to folder...');
    try {
      const body = await toJpeg();
      const q = `upload=${crypto.randomUUID()}&chunks=1&size=${body.size}&chunkSize=${body.size}&chunk=0`;
      const res = await fetch(`${fileUrl(app, [...dir, outName])}?${q}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await getToken()}` },
        body,
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setStatus(`Exported "${outName}" to ${dir.join('/') || 'Root'}.`);
    } catch (e) {
      setStatus(`Failed to export: ${(e as Error).message}`);
    }
  };

  // Helper setter for params
  const setParam = <K extends keyof DarkroomParams>(key: K, val: DarkroomParams[K]) => setParams((prev) => ({ ...prev, [key]: val }));

  const slider = (label: string, key: keyof DarkroomParams, min: number, max: number, step: number, shown: string) => (
    <label style={{ fontSize: 11 }}>
      {label}: {shown}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={params[key] as number}
        onChange={(e) => setParam(key, +e.target.value as never)}
        style={{ width: '100%' }}
      />
    </label>
  );
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const strength = slider('Strength', 'amount', 0, 1, 0.01, pct(params.amount));

  const presetButtons = (category: FilterPreset['category'], padding = '2px 8px') => (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {PRESETS.filter((p) => p.category === category).map((p) => (
        <button
          key={p.id}
          onClick={() => setParam('preset', p.id)}
          style={{
            ...button,
            fontSize: 11,
            padding,
            fontWeight: params.preset === p.id ? 700 : 400,
            background: params.preset === p.id ? '#000080' : '#c0c0c0',
            color: params.preset === p.id ? '#fff' : '#000',
          }}
          title={p.desc}
        >
          {p.name}
        </button>
      ))}
    </div>
  );

  return (
    <div
      style={{ ...shell, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}
      onKeyDown={(e) => {
        // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z), except while typing text
        if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).matches('input[type=text],input[type=number],textarea')) return;
        const k = e.key.toLowerCase();
        if (k !== 'z' && k !== 'y') return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redo();
        else undo();
      }}
    >
      {/* ── Retro Win98 Menu / Action Bar ── */}
      <div style={{ ...toolbar, flexWrap: 'wrap', gap: 4, padding: '3px 4px' }}>
        <label style={{ ...button, cursor: 'pointer' }}>
          Open Device...
          <input type="file" accept="image/*" hidden onChange={(e) => openLocal(e.target.files?.[0])} />
        </label>
        <button
          style={{ ...button, fontWeight: 700 }}
          onClick={() => setShowServerPicker('open')}
          title="Browse photos from team and server folders"
        >
          Server Files...
        </button>
        <button
          style={{
            ...button,
            fontWeight: compare ? 700 : 400,
            background: compare ? '#000080' : '#c0c0c0',
            color: compare ? '#fff' : '#000',
          }}
          disabled={!source}
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          title="Press & hold to see the photo without this tab's edit"
        >
          {compare ? '◀ Comparing...' : 'Hold: Compare'}
        </button>
        <button style={button} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z): clear the unsaved edit, or step back one save">
          ↶ Undo
        </button>
        <button style={button} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">
          ↷ Redo
        </button>
        <button
          style={{ ...button, background: dirty ? '#008080' : '#c0c0c0', color: dirty ? '#fff' : '#000', fontWeight: 700 }}
          disabled={!source || !dirty || activeTab === 'carousel'} // carousel slides are exported, not saved as a version
          onClick={save}
          title="Keep this edit. Other tabs then edit on top of it; switching tabs without saving drops it."
        >
          Save
        </button>
        <button style={button} disabled={!source} onClick={download}>
          {isTouch ? 'Save to Photos' : 'Download'}
        </button>
        {app && (
          <button style={button} disabled={!source} onClick={saveToFolder}>
            Export to Folder
          </button>
        )}
        <span style={{ marginLeft: 6, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {title} {history.length > 1 ? `(version ${pos + 1} of ${history.length})` : ''}
          {dirty ? ' • unsaved' : ''}
        </span>
      </div>

      {/* ── Progressive Disclosure Layout ── */}
      {/* 65% Photo Loupe (Top) + 35% 2-Tier Retro Dock (Bottom) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#808080' }}>
        {/* Photo Loupe (65% height or flex: 2) */}
        <div
          className="darkroom-loupe media-clean"
          style={{
            flex: '1 1 60%',
            minHeight: 180,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#202020',
            border: '2px inset #808080',
            margin: 2,
            position: 'relative',
            overflow: 'hidden',
          }}
          onPointerDown={(e) => {
            // Long press / click-hold on photo also compares (not on a collage: that swaps the whole picture; use the button)
            if (e.button === 0 && activeTab !== 'collage') setCompare(true);
          }}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
        >
          {source ? (
            <canvas
              ref={canvasRef}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              }}
            />
          ) : (
            <div style={{ color: '#c0c0c0', textAlign: 'center', padding: 16 }}>
              <b>No photo open</b>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Open a photo from your device, browse server files, or create a multi-image collage.
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ ...button, fontWeight: 700, cursor: 'pointer' }}>
                  Open Device Photo...
                  <input type="file" accept="image/*" hidden onChange={(e) => openLocal(e.target.files?.[0])} />
                </label>
                <button
                  style={{ ...button, fontWeight: 700, background: '#000080', color: '#fff' }}
                  onClick={() => setShowServerPicker('open')}
                >
                  Browse Server Files...
                </button>
                <button
                  style={{ ...button, fontWeight: 700, background: '#008080', color: '#fff' }}
                  onClick={() => {
                    switchTab('collage');
                    setIsCollageActive(true);
                  }}
                >
                  Create Collage
                </button>
              </div>
            </div>
          )}
          {compare && source && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                background: '#000080',
                color: '#fff',
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
                border: '1px solid #fff',
              }}
            >
              BEFORE THIS EDIT
            </div>
          )}
        </div>

        {/* 2-Tier Bottom Dock (Win98 Retro Theme) */}
        <div
          style={{
            flex: '0 0 auto',
            minHeight: 160,
            maxHeight: 240,
            background: '#c0c0c0',
            borderTop: '2px outset #fff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Tier 1: Category Tabs (Windows 98 Style) */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: '3px 4px 0',
              borderBottom: '1px solid #808080',
              overflowX: 'auto',
              background: '#dcdcdc',
              whiteSpace: 'nowrap',
            }}
          >
            {TABS.map(([tabId, tabTitle]) => {
              const active = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  onClick={() => switchTab(tabId)}
                  style={{
                    ...button,
                    borderBottom: active ? 'none' : button.borderBottom,
                    fontWeight: active ? 700 : 400,
                    background: active ? '#c0c0c0' : '#e0e0e0',
                    position: 'relative',
                    top: active ? 1 : 0,
                    padding: '3px 8px',
                    fontSize: 11,
                  }}
                >
                  {tabId === 'versions' ? `${tabTitle} (${history.length})` : tabTitle}
                </button>
              );
            })}
          </div>

          {/* Tier 2: Category Controls & Presets */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
            {/* ── Collage Module ── */}
            {activeTab === 'collage' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* 0. Quick looks (2012 Instagram / TikTok edits) */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Quick looks:</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(
                      [
                        ['stretch', 'Stretch duo', 'The same photo twice, stretched side by side (9:16)'],
                        ['story', 'Story caption', 'Black bars and a caption in the middle (9:16)'],
                        ['grid', '2×2 grid', 'Four photos in a white 3:4 grid'],
                        ['ig', 'IG post 2012', 'The photo inside an old Instagram post: username, likes, caption'],
                        ['vertical', 'Vertical stretch', 'A wide video frame squashed into 9:16'],
                        ['lyrics', 'Lyric grid', 'Lyrics spaced out word by word in even columns over the photo'],
                        ['stacked', 'Big stacked', 'Huge stacked words over the photo in black & white'],
                        ['card', 'Black card', 'One soft line of white text on black'],
                      ] as const
                    ).map(([id, label, desc]) => (
                      <button
                        key={id}
                        title={desc}
                        onClick={() => quickLook(id)}
                        style={{ ...button, fontSize: 11, padding: '2px 8px', fontWeight: id === 'ig' && igPost ? 700 : 400 }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {igPost && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, fontSize: 11, alignItems: 'center' }}>
                      {(['user', 'likes', 'caption'] as const).map((k) => (
                        <input
                          key={k}
                          value={igPost[k]}
                          placeholder={k === 'user' ? 'username' : k === 'likes' ? 'likes' : 'caption'}
                          maxLength={k === 'caption' ? 60 : 30}
                          onChange={(e) => setIgPost({ ...igPost, [k]: e.target.value })}
                          style={{ fontSize: 11, padding: '1px 4px', width: k === 'caption' ? 180 : 90 }}
                        />
                      ))}
                      <button style={{ ...button, fontSize: 10, padding: '1px 6px' }} onClick={() => setIgPost(null)}>
                        Back to grids
                      </button>
                    </div>
                  )}
                </div>

                {/* 1. Layout Grid Presets (10 options) */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Layout Grid Presets (10 options):</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {COLLAGE_GRIDS.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => selectCollageGrid(g.id)}
                        style={{
                          ...button,
                          fontSize: 11,
                          padding: '2px 8px',
                          fontWeight: collageGrid === g.id ? 700 : 400,
                          background: collageGrid === g.id ? '#000080' : '#c0c0c0',
                          color: collageGrid === g.id ? '#fff' : '#000',
                        }}
                        title={g.desc}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Aspect Ratios + how photos fill their frames */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Aspect Ratio:</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {ASPECT_RATIOS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setCollageAspect(a.id);
                          setIsCollageActive(true);
                        }}
                        style={{
                          ...button,
                          fontSize: 11,
                          padding: '2px 8px',
                          fontWeight: collageAspect === a.id ? 700 : 400,
                          background: collageAspect === a.id ? '#000080' : '#c0c0c0',
                          color: collageAspect === a.id ? '#fff' : '#000',
                        }}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>Photos in frames:</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {FITS.map(([id, label, desc]) => (
                      <button
                        key={id}
                        title={desc}
                        onClick={() => {
                          setCollageFit(id);
                          setIsCollageActive(true);
                        }}
                        style={{
                          ...button,
                          fontSize: 11,
                          padding: '2px 8px',
                          fontWeight: collageFit === id ? 700 : 400,
                          background: collageFit === id ? '#000080' : '#c0c0c0',
                          color: collageFit === id ? '#fff' : '#000',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Multi-Image Slot Loader */}
                <div
                  style={{
                    background: '#dcdcdc',
                    border: '1px solid #808080',
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>Multi-Image Slot Loader:</span>
                      <label
                        style={{
                          ...button,
                          fontWeight: 700,
                          background: '#000080',
                          color: '#fff',
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: 11,
                        }}
                      >
                        Choose Files...
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={async (e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length === 0) return;
                            const loaded = await Promise.all(
                              files.map(
                                (f) =>
                                  new Promise<HTMLImageElement>((resolve, reject) => {
                                    const im = new Image();
                                    im.onload = () => resolve(im);
                                    im.onerror = reject;
                                    im.src = URL.createObjectURL(f);
                                  }),
                              ),
                            ).catch(() => null);
                            if (!loaded) return setStatus("One of those files isn't an image this browser can open.");
                            setCollageSlots((prev) => {
                              const next = [...prev];
                              const gridDef = COLLAGE_GRIDS.find((g) => g.id === collageGrid) || COLLAGE_GRIDS[0];
                              for (let i = 0; i < loaded.length && i < gridDef.slotCount; i++) {
                                next[i] = loaded[i];
                              }
                              return next;
                            });
                            setIsCollageActive(true);
                            setStatus(`Loaded ${loaded.length} image(s) into collage.`);
                          }}
                        />
                      </label>
                    </div>
                    <span style={{ fontSize: 11, color: '#444' }}>
                      Slot 1 starts as your current edit. Populates slots in order, or change single slots below:
                    </span>
                  </div>

                  {/* Individual slot controls */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {COLLAGE_GRIDS.find((g) => g.id === collageGrid)?.slots.map((_, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: '#fff',
                          border: '1px solid #808080',
                          padding: '2px 6px',
                          fontSize: 11,
                        }}
                      >
                        <b>Slot {idx + 1}:</b>
                        {collageSlots[idx] ? (
                          <span style={{ color: '#008000', fontWeight: 700 }}>Loaded</span>
                        ) : (
                          <span style={{ color: '#888' }}>Empty</span>
                        )}
                        <label style={{ ...button, padding: '1px 5px', fontSize: 10, cursor: 'pointer' }}>
                          {collageSlots[idx] ? 'Change' : 'Load'}
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const im = new Image();
                              im.onload = () => {
                                setCollageSlots((prev) => {
                                  const next = [...prev];
                                  next[idx] = im;
                                  return next;
                                });
                                setIsCollageActive(true);
                              };
                              im.src = URL.createObjectURL(file);
                            }}
                          />
                        </label>
                        {collageSlots[idx] && (
                          <button
                            style={{ ...button, padding: '1px 5px', fontSize: 10 }}
                            onClick={() => {
                              setCollageSlots((prev) => {
                                const next = [...prev];
                                next[idx] = null;
                                return next;
                              });
                              setIsCollageActive(true);
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. Background Customization */}
                <div
                  style={{
                    background: '#dcdcdc',
                    border: '1px solid #808080',
                    padding: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700 }}>Background:</span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="color"
                      value={collageBgColor}
                      onChange={(e) => {
                        setCollageBgColor(e.target.value);
                        setIsCollageActive(true);
                      }}
                      style={{ width: 24, height: 20, padding: 0, border: '1px solid #808080', cursor: 'pointer' }}
                    />
                    <input
                      type="text"
                      value={collageBgColor}
                      onChange={(e) => {
                        setCollageBgColor(e.target.value);
                        setIsCollageActive(true);
                      }}
                      placeholder="#222222"
                      style={{ width: 68, fontSize: 11, fontFamily: 'monospace', padding: '1px 4px' }}
                    />
                    <button
                      style={{ ...button, fontSize: 10, padding: '1px 4px' }}
                      onClick={() => {
                        setCollageBgColor('#222222');
                        setIsCollageActive(true);
                      }}
                    >
                      Default (#222222)
                    </button>
                  </div>

                  <span style={{ color: '#888' }}>|</span>

                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11 }}>Custom BG Image:</span>
                    <label style={{ ...button, fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
                      Choose File...
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const im = new Image();
                          im.onload = () => {
                            setCollageBgImage(im);
                            setIsCollageActive(true);
                          };
                          im.src = URL.createObjectURL(file);
                        }}
                      />
                    </label>
                    {collageBgImage && (
                      <button
                        style={{ ...button, fontSize: 10, padding: '1px 5px' }}
                        onClick={() => {
                          setCollageBgImage(null);
                          setIsCollageActive(true);
                        }}
                      >
                        Clear BG Image
                      </button>
                    )}
                  </div>

                  <span style={{ color: '#888' }}>|</span>

                  <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Border Gap: {collageGap}px
                    <input
                      type="range"
                      min={0}
                      max={32}
                      value={collageGap}
                      onChange={(e) => {
                        setCollageGap(+e.target.value);
                        setIsCollageActive(true);
                      }}
                      style={{ width: 70 }}
                    />
                  </label>
                </div>

                {/* 5. Text Overlay */}
                <div
                  style={{
                    background: '#dcdcdc',
                    border: '1px solid #808080',
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>Text Overlay:</span>
                      <button
                        style={{ ...button, fontWeight: 700, fontSize: 11, padding: '2px 8px', background: '#008080', color: '#fff' }}
                        onClick={() => {
                          setTextOverlays((prev) => [
                            ...prev,
                            {
                              id: `txt-${Date.now()}`,
                              text: 'NEW TEXT',
                              fontSize: 34,
                              color: '#ffffff',
                              fontFamily: 'Impact',
                              align: 'center',
                              xPercent: 50,
                              yPercent: 50,
                              shadow: true,
                            },
                          ]);
                          setIsCollageActive(true);
                        }}
                      >
                        Add Text
                      </button>
                    </div>
                    <span style={{ fontSize: 10, color: '#444' }}>
                      Add editable typography over the composition with retro drop shadow.
                    </span>
                  </div>

                  {textOverlays.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        background: '#fff',
                        padding: '3px 6px',
                        border: '1px solid #a0a0a0',
                        fontSize: 11,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>#{idx + 1}</span>
                      <input
                        type="text"
                        value={item.text}
                        placeholder="Editable typography..."
                        onChange={(e) => {
                          const val = e.target.value;
                          setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, text: val } : t)));
                          setIsCollageActive(true);
                        }}
                        style={{ fontSize: 11, padding: '1px 4px', width: 140 }}
                      />
                      <select
                        value={item.style || 'plain'}
                        title="How the words are laid out"
                        onChange={(e) => {
                          const val = e.target.value as TextStyle;
                          setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, style: val } : t)));
                          setIsCollageActive(true);
                        }}
                        style={{ fontSize: 11, padding: '1px' }}
                      >
                        {TEXT_STYLES.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={item.fontFamily}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, fontFamily: val } : t)));
                          setIsCollageActive(true);
                        }}
                        style={{ fontSize: 11, padding: '1px' }}
                      >
                        <option value="Impact">Impact</option>
                        <option value="Tahoma">Tahoma</option>
                        <option value="Arial">Arial</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Courier New">Courier New</option>
                        <option value="Times New Roman">Times New Roman</option>
                      </select>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        Size:
                        <input
                          type="number"
                          min={12}
                          max={120}
                          value={item.fontSize}
                          onChange={(e) => {
                            const val = +e.target.value || 24;
                            setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, fontSize: val } : t)));
                            setIsCollageActive(true);
                          }}
                          style={{ width: 44, fontSize: 11 }}
                        />
                      </label>
                      <input
                        type="color"
                        value={item.color}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, color: val } : t)));
                          setIsCollageActive(true);
                        }}
                        style={{ width: 22, height: 20, padding: 0, cursor: 'pointer' }}
                      />
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        Pos Y: {item.yPercent}%
                        <input
                          type="range"
                          min={5}
                          max={95}
                          value={item.yPercent}
                          onChange={(e) => {
                            const val = +e.target.value;
                            setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, yPercent: val } : t)));
                            setIsCollageActive(true);
                          }}
                          style={{ width: 60 }}
                        />
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <input
                          type="checkbox"
                          checked={item.shadow}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setTextOverlays((prev) => prev.map((t) => (t.id === item.id ? { ...t, shadow: checked } : t)));
                            setIsCollageActive(true);
                          }}
                        />
                        Shadow
                      </label>
                      <button
                        style={{ ...button, fontSize: 10, padding: '1px 5px', color: '#800000', fontWeight: 700 }}
                        onClick={() => {
                          setTextOverlays((prev) => prev.filter((t) => t.id !== item.id));
                          setIsCollageActive(true);
                        }}
                        title="Remove Text Overlay"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Swag Filters ── */}
            {activeTab === 'swag' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {presetButtons('swag')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  {strength}
                  {slider('Vignette', 'vignette', 0, 1, 0.01, pct(params.vignette))}
                  {slider('Grain', 'grain', 0, 1, 0.01, pct(params.grain))}
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={params.iphone6Grain} onChange={(e) => setParam('iphone6Grain', e.target.checked)} />
                    iPhone 6 Digital Grain
                  </label>
                </div>
              </div>
            )}

            {/* ── Goth Filters ── */}
            {activeTab === 'goth' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {presetButtons('goth')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  {strength}
                  {slider('Contrast', 'contrast', 0.5, 2, 0.01, `${params.contrast.toFixed(2)}x`)}
                  {slider('Warmth', 'warmth', -1, 1, 0.02, params.warmth.toFixed(2))}
                  {slider('Fade (lifted blacks)', 'fade', 0, 1, 0.01, pct(params.fade))}
                </div>
              </div>
            )}

            {/* ── JPEG Degradation ── */}
            {activeTab === 'jpeg' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>Quality Presets:</span>
                  {(
                    [
                      ['High', 85, 1.0],
                      ['Medium', 45, 0.65],
                      ['Low', 12, 0.35],
                    ] as const
                  ).map(([qName, qVal, rVal]) => (
                    <button
                      key={qName}
                      onClick={() => setParams((prev) => ({ ...prev, jpegQuality: qVal, resolution: rVal }))}
                      style={{ ...button, fontSize: 10, padding: '1px 6px' }}
                    >
                      {qName}
                    </button>
                  ))}
                  <div style={{ marginLeft: 'auto' }}>
                    <SevenSegmentDisplay value={Math.round(params.jpegQuality)} height={16} color="#00ff66" label="Q%" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  {slider('JPEG Quality', 'jpegQuality', 1, 100, 1, `${Math.round(params.jpegQuality)}%`)}
                  {slider('Size before saving (smaller = mushier)', 'resolution', 0.05, 1, 0.01, pct(params.resolution))}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={params.jpegNoise} onChange={(e) => setParam('jpegNoise', e.target.checked)} />
                    Apply Noise (High-freq noise)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={params.jpegSharpen} onChange={(e) => setParam('jpegSharpen', e.target.checked)} />
                    Apply Sharpen (Unsharp mask)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={params.pixelate2x} onChange={(e) => setParam('pixelate2x', e.target.checked)} />
                    Pixelate (2x Upscale)
                  </label>
                </div>
              </div>
            )}

            {/* ── CCD Bloom ── */}
            {activeTab === 'ccd' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                {slider('Bloom Amount', 'bloomAmount', 0, 1, 0.01, pct(params.bloomAmount))}
                {slider('Bloom Tint', 'bloomTint', -1, 1, 0.05, params.bloomTint < 0 ? 'Cool' : params.bloomTint > 0 ? 'Warm' : 'Neutral')}
                {slider('Lens Reflection', 'lensReflection', 0, 1, 0.01, pct(params.lensReflection))}
                {slider('CCD Sensor Noise', 'ccdNoise', 0, 1, 0.01, pct(params.ccdNoise))}
              </div>
            )}

            {/* ── 1-Click Cameras ── */}
            {activeTab === 'camera' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {presetButtons('camera', '4px 8px')}
                {params.preset > 0 && strength}
                <div style={{ fontSize: 11, color: '#444', fontStyle: 'italic', marginTop: 4 }}>
                  {(params.preset && PRESETS.find((p) => p.id === params.preset)?.desc) || 'Select a vintage camera profile above.'}
                </div>
              </div>
            )}

            {/* ── Blur & Pixel ── */}
            {activeTab === 'blur' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(
                    [
                      [0, 'Off'],
                      [1, 'Uniform Blur'],
                      [2, 'Vignette Blur (Center sharp)'],
                      [3, 'Pixelate Mosaic'],
                    ] as const
                  ).map(([mId, mLabel]) => (
                    <button
                      key={mId}
                      // A mode starts at a visible size instead of doing nothing until the slider moves
                      onClick={() => setParams((prev) => ({ ...prev, blurMode: mId, blurRadius: mId ? prev.blurRadius || 8 : 0 }))}
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '2px 8px',
                        fontWeight: params.blurMode === mId ? 700 : 400,
                        background: params.blurMode === mId ? '#000080' : '#c0c0c0',
                        color: params.blurMode === mId ? '#fff' : '#000',
                      }}
                    >
                      {mLabel}
                    </button>
                  ))}
                </div>
                {params.blurMode > 0 && slider('Radius / Pixel Size', 'blurRadius', 1, 25, 1, `${params.blurRadius.toFixed(0)}`)}
              </div>
            )}

            {/* ── Glitch FX ── */}
            {activeTab === 'glitch' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(
                    [
                      [0, 'Off'],
                      [1, 'Datamosh'],
                      [2, 'VHS Tracking'],
                      [3, 'LCD Subpixels'],
                      [4, 'Galaxy (Chroma Fringing)'],
                    ] as const
                  ).map(([gId, gLabel]) => (
                    <button
                      key={gId}
                      onClick={() =>
                        setParams((prev) => ({
                          ...prev,
                          glitchMode: gId,
                          glitchAmount: gId ? prev.glitchAmount || 0.5 : 0,
                          glitchThreshold: gId ? prev.glitchThreshold : 0,
                        }))
                      }
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '2px 8px',
                        fontWeight: params.glitchMode === gId ? 700 : 400,
                        background: params.glitchMode === gId ? '#000080' : '#c0c0c0',
                        color: params.glitchMode === gId ? '#fff' : '#000',
                      }}
                    >
                      {gLabel}
                    </button>
                  ))}
                </div>
                {params.glitchMode > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                    {slider('Glitch Intensity', 'glitchAmount', 0.05, 1, 0.02, pct(params.glitchAmount))}
                    {params.glitchMode === 1 &&
                      slider('Threshold (only blocks brighter than this move)', 'glitchThreshold', 0, 1, 0.01, pct(params.glitchThreshold))}
                  </div>
                )}
              </div>
            )}

            {/* ── Match look ── */}
            {activeTab === 'match' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b>Reference:</b>
                  <label style={{ ...button, cursor: 'pointer', fontSize: 11 }}>
                    Choose photo...
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        const im = new Image();
                        im.onload = () => pickReference(im, file.name);
                        im.onerror = () => setStatus("That file isn't a picture this browser can open.");
                        im.src = URL.createObjectURL(file);
                      }}
                    />
                  </label>
                  {app && (
                    <button style={{ ...button, fontSize: 11 }} onClick={() => setShowServerPicker('ref')}>
                      From team files...
                    </button>
                  )}
                  {matchRef && (
                    <>
                      <img src={matchRef.img.src} alt="" style={{ height: 40, border: '1px solid #808080' }} />
                      <span>{matchRef.name}</span>
                    </>
                  )}
                </div>
                {matchRef ? (
                  <div
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6, alignItems: 'center' }}
                  >
                    {slider('Strength', 'match', 0, 1, 0.01, pct(params.match))}
                    <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" checked={params.matchTone} onChange={(e) => setParam('matchTone', e.target.checked)} />
                      Match brightness &amp; contrast too
                    </label>
                  </div>
                ) : (
                  <div style={{ color: '#444' }}>
                    Pick a photo whose look you want: a reference edit, a still from a video, an album cover. Your photo takes on its
                    colours (and, if you like, its light); Strength sets how far. Save to keep it, then keep editing on the other tabs.
                  </div>
                )}
              </div>
            )}

            {/* ── Carousel ── */}
            {activeTab === 'carousel' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(
                    [
                      ['split', 'Split this photo'],
                      ['photos', 'One photo per slide'],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      style={{
                        ...button,
                        fontSize: 11,
                        fontWeight: carMode === m ? 700 : 400,
                        background: carMode === m ? '#000080' : '#c0c0c0',
                        color: carMode === m ? '#fff' : '#000',
                      }}
                      onClick={() => setCarMode(m)}
                    >
                      {label}
                    </button>
                  ))}
                  {carMode === 'split' ? (
                    <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      Slides
                      <input
                        type="range"
                        min={2}
                        max={10}
                        value={carCount}
                        onChange={(e) => setCarCount(+e.target.value)}
                        style={{ width: 90 }}
                      />
                      {carCount} (swipes across one wide picture)
                    </label>
                  ) : (
                    <>
                      <label style={{ ...button, cursor: 'pointer', fontSize: 11 }}>
                        Add photos...
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={async (e) => {
                            const files = Array.from(e.target.files || []);
                            e.target.value = '';
                            const imgs = await Promise.all(
                              files.map(
                                (f) =>
                                  new Promise<HTMLImageElement | null>((ok) => {
                                    const im = new Image();
                                    im.onload = () => ok(im);
                                    im.onerror = () => ok(null);
                                    im.src = URL.createObjectURL(f);
                                  }),
                              ),
                            );
                            addSlides(imgs.filter((i): i is HTMLImageElement => !!i));
                          }}
                        />
                      </label>
                      {app && (
                        <button style={{ ...button, fontSize: 11 }} onClick={() => setShowServerPicker('slides')}>
                          From team files...
                        </button>
                      )}
                      {saved && (
                        <button
                          style={{ ...button, fontSize: 11 }}
                          onClick={() => addSlides([saved as HTMLImageElement])}
                          title="The photo as it is now, with its saved edits"
                        >
                          Add this photo
                        </button>
                      )}
                      <span>{slides.length}/10</span>
                      {slides.length > 0 && (
                        <button style={{ ...button, fontSize: 11 }} onClick={() => setSlides([])}>
                          Clear
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <b>Look:</b>
                  <select
                    value={params.preset}
                    onChange={(e) => setParam('preset', +e.target.value)}
                    style={{ fontSize: 11 }}
                    title="Applied to every slide (the captions too)"
                  >
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {params.preset > 0 && strength}
                  <b style={{ marginLeft: 8 }}>Captions:</b>
                  <select value={carStyle} onChange={(e) => setCarStyle(e.target.value as TextStyle)} style={{ fontSize: 11 }}>
                    {TEXT_STYLES.map(([st, label]) => (
                      <option key={st} value={st}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Array.from({ length: slideCount }, (_, i) => (
                    <input
                      key={i}
                      placeholder={`Slide ${i + 1} text`}
                      maxLength={120}
                      value={carText[i] || ''}
                      onChange={(e) => setCarText((prev) => Object.assign([...prev], { [i]: e.target.value }))}
                      style={{ fontSize: 11, width: 110 }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button style={{ ...button, fontWeight: 700 }} disabled={!carouselOut} onClick={() => exportSlides('device')}>
                    {isTouch ? `Save ${slideCount} slides to Photos` : `Download ${slideCount} slides`}
                  </button>
                  {app && (
                    <button style={button} disabled={!carouselOut} onClick={() => exportSlides('folder')}>
                      Save slides to folder
                    </button>
                  )}
                  <span style={{ color: '#444' }}>1080×1350 (Instagram 4:5), numbered in order.</span>
                </div>
              </div>
            )}

            {/* ── Versions ── */}
            {activeTab === 'versions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: '#333', marginBottom: 2 }}>
                  Every Save adds a version. Click one to go back to it; saving from there replaces the later ones.
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {history.map((v, i) => (
                    <button
                      key={i}
                      onClick={() => goTo(i)}
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '3px 8px',
                        fontWeight: pos === i ? 700 : 400,
                        background: pos === i ? '#000080' : '#c0c0c0',
                        color: pos === i ? '#fff' : '#000',
                      }}
                    >
                      {i + 1}. {v.name} <span style={{ fontSize: 9, opacity: 0.8 }}>({v.time})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div
        style={{ padding: '2px 6px', borderTop: '1px solid #808080', minHeight: 18, fontSize: 11, background: '#c0c0c0', color: '#222' }}
      >
        {status || 'Ready.'}
      </div>

      {/* ── Server File Picker Modal ── */}
      {showServerPicker && (
        <FilePicker
          title={
            showServerPicker === 'ref'
              ? 'Pick the reference photo'
              : showServerPicker === 'slides'
                ? 'Add a photo to the carousel'
                : 'Open Image from Server'
          }
          mode="file"
          accept={(n) => /\.(jpe?g|png|webp|avif|gif|tiff?|bmp|dng|raw)$/i.test(n)}
          onPick={async (ref: FileRef | null) => {
            const purpose = showServerPicker;
            setShowServerPicker(false);
            if (!ref) return;
            setStatus('Loading photo from server...');
            const t = (await getToken()) || '';
            const pathParts = ref.path.split('/');
            const fileName = pathParts.pop() || 'photo';
            const isNative = /\.(jpe?g|png|webp|avif|gif)$/i.test(fileName);
            const src = `${fileUrl(ref.space, pathParts)}/${encodeURIComponent(fileName)}?t=${t}${isNative ? '' : '&preview'}`;
            const i = new Image();
            i.crossOrigin = 'anonymous';
            i.onload = () => {
              if (purpose === 'ref') return pickReference(i, fileName);
              if (purpose === 'slides') return addSlides([i]);
              startWith(i, fileName);
              setStatus(`Opened ${fileName} from server.`);
            };
            i.onerror = () => setStatus(`Could not open ${fileName} from server.`);
            i.src = src;
          }}
        />
      )}
    </div>
  );
};

export default Darkroom;
