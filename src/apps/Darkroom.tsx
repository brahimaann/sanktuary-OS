import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { fileUrl, shell, toolbar, button } from './TeamFiles';
import SevenSegmentDisplay from '../components/SevenSegmentDisplay';
import FilePicker, { FileRef } from '../components/FilePicker';

/**
 * Darkroom: Professional retro image grading & degradation suite.
 * Lightroom Mobile-inspired progressive disclosure layout (65% photo loupe, 2-tier bottom thumb dock)
 * completely dressed in authentic Windows 98 / retro OS styling.
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
  { id: 2, name: 'Chief Keef', category: 'swag', desc: 'High-saturation, punchy flash-photography grade' },
  { id: 3, name: 'Nuke', category: 'swag', desc: 'Blown-out, deep fried contrast & sharp clipped edges' },
  { id: 4, name: 'Phreshboy', category: 'swag', desc: 'Cool / magenta shifted modern vintage look' },
  { id: 5, name: 'Sepia', category: 'swag', desc: 'Classic warm monochrome tint with soft roll-off' },
  { id: 6, name: '2014', category: 'swag', desc: 'Muted shadows, lifted blacks and elevated midtone warmth' },
  { id: 7, name: '$$$', category: 'swag', desc: 'Greenish, stylized analog currency contrast' },
  { id: 8, name: 'Pandora', category: 'swag', desc: 'Ethereal cyan & violet dream cast' },
  // Goth Presets
  { id: 9, name: 'Bleach Bypass', category: 'goth', desc: 'De-saturated high contrast silver retention film' },
  { id: 10, name: 'Silver B&W', category: 'goth', desc: 'Deep crushed blacks, metallic monochrome tone' },
  { id: 11, name: 'Cross Process', category: 'goth', desc: 'Slide film developed in negative chemistry (C-41)' },
  { id: 12, name: 'Faded Print', category: 'goth', desc: 'Muted highlights, lifted blacks and cyan/green wash' },
  { id: 13, name: 'Teal & Orange', category: 'goth', desc: 'Stylized cinematic complementary split' },
  { id: 14, name: 'Noir', category: 'goth', desc: 'Extreme contrast chiaroscuro hard light' },
  // 1-Click Cameras
  { id: 15, name: 'Nokia', category: 'camera', desc: '176x208 12-bit sensor, heavy edge ringing, Bayer dither' },
  { id: 16, name: '1/4" Camcorder', category: 'camera', desc: 'Interlaced scanlines, chroma blur, warm tape gain' },
  { id: 17, name: 'iPhone 3GS', category: 'camera', desc: 'Plastic lens softness, blown highlights, early sensor curve' },
  { id: 18, name: '🧠🧼 Brainwash', category: 'camera', desc: 'Ultra-saturated Y2K direct-flash digicam look' },
];

// ── Collage Presets & Types ──
export type CollageGridPreset =
  | 'single'
  | 'split-v'
  | 'split-h'
  | '3-col'
  | '3-row'
  | '2x2'
  | 'banner-top'
  | 'banner-bottom'
  | 'hero-left'
  | 'hero-right';

export type AspectRatioPreset = '1:1' | '4:3' | '16:9' | '3:4' | '9:16';

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
  { id: '1:1', name: '1:1 (Square)', width: 1200, height: 1200 },
  { id: '4:3', name: '4:3 (Standard digicam)', width: 1200, height: 900 },
  { id: '16:9', name: '16:9 (Widescreen)', width: 1280, height: 720 },
  { id: '3:4', name: '3:4 (Portrait)', width: 900, height: 1200 },
  { id: '9:16', name: '9:16 (Vertical/Story)', width: 720, height: 1280 },
];

export interface TextOverlayItem {
  id: string;
  text: string;
  fontSize: number;
  color: string;
  fontFamily: string;
  align: 'left' | 'center' | 'right';
  xPercent: number;
  yPercent: number;
  shadow: boolean;
}

function drawImageStretch(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  if (!img.naturalWidth || !img.naturalHeight || dw <= 0 || dh <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
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
  blurRadius: number; // 0 to 30
  // Glitch
  glitchMode: 0 | 1 | 2 | 3 | 4; // 0: none, 1: datamosh, 2: vhs, 3: lcd, 4: galaxy
  glitchAmount: number; // 0 to 1
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
};

const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = (p + 1.0) / 2.0; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform sampler2D img;
uniform vec2 res;
uniform int preset;
uniform float amount, contrast, warmth, fade, vignette, grain;
uniform float bloomAmount, bloomTint, lensReflection, ccdNoise;
uniform int blurMode;
uniform float blurRadius;
uniform int glitchMode;
uniform float glitchAmount;
uniform float jpegRes;
uniform float jpegQual;
uniform float uNoise;
uniform float uSharpen;
uniform float uPixel2x;
uniform float uTime;

varying vec2 uv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

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

// ── Physical Degradation Module 1: CCD Bloom & Vertical Smear ──
vec3 apply_ccd_smear(vec2 uvCoord, vec2 texelSize, sampler2D tex) {
  vec3 smear = vec3(0.0);
  for (float i = -12.0; i <= 12.0; i += 1.0) {
    vec2 sample_uv = uvCoord + vec2(0.0, i * texelSize.y * 3.0);
    vec3 sampleColor = texture2D(tex, sample_uv).rgb;
    float lumaVal = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
    float bloom = smoothstep(0.95, 1.0, lumaVal);
    smear += sampleColor * bloom * (1.0 - abs(i) / 12.0);
  }
  return smear * 0.18;
}

// ── Physical Degradation Module 2: JPEG DCT Quantization Artifacts ──
vec3 apply_jpeg_dct(vec2 uvCoord, vec2 resolution, sampler2D tex, float quality) {
  vec2 grid_uv = floor(uvCoord * resolution / 8.0) * 8.0 / resolution;
  vec3 block_avg = texture2D(tex, grid_uv).rgb;
  vec2 local_uv = fract(uvCoord * resolution / 8.0);
  float ringing = cos(local_uv.x * 3.14159265) * cos(local_uv.y * 3.14159265);
  vec3 orig = texture2D(tex, uvCoord).rgb;
  float q_step = mix(3.0, 15.0, quality);
  vec3 quantized = floor(orig * q_step + 0.5) / q_step;
  return mix(block_avg + ringing * 0.1, quantized, quality);
}

// ── Physical Degradation Module 3: Photographic Grain (Poisson / sqrt variance) ──
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 apply_film_grain(vec3 c, vec2 uvCoord, float timeVal, float grainAmt) {
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float variance = sqrt(max(0.0, Y * (1.0 - Y)));
  float noise = (hash12(uvCoord * 100.0 + timeVal) - 0.5) * 2.0;
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

// ── Preset 2: Chief Keef ──
vec3 chief_keef_grade(vec3 c, vec2 uvCoord) {
  float dist = distance(uvCoord, vec2(0.5, 0.5));
  float falloff = clamp(1.0 / (1.0 + 3.5 * dist * dist), 0.0, 1.0);
  vec3 flashed = c * (falloff * 1.6 + 0.1);
  float Y = dot(flashed, vec3(0.2126, 0.7152, 0.0722));
  vec3 saturated = Y + 1.85 * (flashed - vec3(Y));
  return smoothstep(vec3(0.04), vec3(0.92), saturated);
}

// ── Preset 3: Nuke (Deep Fried) ──
vec3 nuke_grade(vec3 c, vec2 uvCoord, vec2 resolution, sampler2D tex) {
  vec2 texel = 1.0 / resolution;
  vec3 n1 = texture2D(tex, uvCoord + vec2(texel.x * 2.0, 0.0)).rgb;
  vec3 n2 = texture2D(tex, uvCoord - vec2(0.0, texel.y * 2.0)).rgb;
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
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
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
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadow = vec3(0.12, 0.08, 0.05);
  vec3 midtone = vec3(0.68, 0.48, 0.25);
  vec3 highlight = vec3(0.97, 0.93, 0.88);
  vec3 toned = mix(mix(shadow, midtone, Y), mix(midtone, highlight, Y), Y);
  return toned;
}

// ── Preset 6: 2014 (Matte Film) ──
vec3 matte_2014_grade(vec3 c) {
  vec3 matte = c * 0.86 + 0.12;
  float Y = dot(matte, vec3(0.2126, 0.7152, 0.0722));
  matte.g = mix(matte.g, Y, 0.45);
  matte.b = mix(matte.b, Y, 0.55);
  vec3 warm_mid = vec3(1.12, 1.04, 0.92);
  float midtone_mask = 1.0 - abs(Y - 0.5) * 2.0;
  matte = mix(matte, matte * warm_mid, midtone_mask * 0.6);
  return clamp(matte, 0.0, 1.0);
}

// ── Preset 7: $$$ (Banknote Intaglio) ──
vec3 banknote_grade(vec3 c) {
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float edgeY = smoothstep(0.25, 0.75, Y);
  vec3 ink_dark = vec3(0.08, 0.14, 0.10);
  vec3 ink_green = vec3(0.32, 0.58, 0.44);
  vec3 paper = vec3(0.93, 0.95, 0.90);
  vec3 grade;
  if (edgeY < 0.5) {
    grade = mix(ink_dark, ink_green, edgeY * 2.0);
  } else {
    grade = mix(ink_green, paper, (edgeY - 0.5) * 2.0);
  }
  return grade;
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
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float silver = pow(Y, 1.5);
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
  float Dmin = 0.02;
  float Dmax = 0.98;
  float k = 6.0;
  float E0 = 0.45;
  float density = Dmin + (Dmax - Dmin) / (1.0 + exp(-k * (E - E0)));
  return vec3(density);
}

// ── Preset 11: Cross Process (X-Pro) ──
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
  float Y = dot(faded, vec3(0.2126, 0.7152, 0.0722));
  faded = mix(faded, vec3(Y), 0.15);
  return clamp(faded, 0.0, 1.0);
}

// ── Preset 13: Teal & Orange (YIQ Skin Protection) ──
vec3 teal_orange_grade(vec3 c) {
  mat3 rgb2yiq = mat3(
    0.299, -0.147, 0.615,
    0.587, -0.289, -0.515,
    0.114, 0.436, -0.100
  );
  mat3 yiq2rgb = mat3(
    1.0, 1.0, 1.0,
    0.956, -0.272, -1.106,
    0.621, -0.647, 1.703
  );
  vec3 yiq = rgb2yiq * c;
  float skin_protect = exp(-pow(yiq.y - 0.45, 2.0) * 12.0);
  float target_Q = mix(-0.15, 0.15, yiq.x);
  yiq.z = mix(target_Q + yiq.z * 0.5, yiq.z, skin_protect);
  return clamp(yiq2rgb * yiq, 0.0, 1.0);
}

// ── Preset 14: Noir (Orthochromatic Bias) ──
vec3 noir_grade(vec3 c) {
  float Y = dot(c, vec3(0.10, 0.40, 0.50));
  float contrastY = pow(clamp((Y - 0.06) * 1.12, 0.0, 1.0), 2.6);
  return vec3(contrastY);
}

// ── Preset 15: Nokia 3310 / N-Gage (Bayer + RGB565) ──
vec3 nokia_grade(vec3 c, vec2 fragCoord) {
  int x = int(mod(fragCoord.x, 4.0));
  int y = int(mod(fragCoord.y, 4.0));
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

  float dVal = (dither / 16.0) - 0.5;
  vec3 dithered = c + dVal * 0.12;

  vec3 q;
  q.r = floor(dithered.r * 31.0 + 0.5) / 31.0;
  q.g = floor(dithered.g * 63.0 + 0.5) / 63.0;
  q.b = floor(dithered.b * 31.0 + 0.5) / 31.0;
  return clamp(q, 0.0, 1.0);
}

// ── Preset 16: 1/4" Camcorder (Horizontal Chroma Smear) ──
vec3 camcorder_grade(vec3 c, vec2 uvCoord, vec2 texelSize, sampler2D tex) {
  mat3 rgb2yiq = mat3(0.299, -0.147, 0.615, 0.587, -0.289, -0.515, 0.114, 0.436, -0.100);
  mat3 yiq2rgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

  vec3 c_left = texture2D(tex, uvCoord - vec2(texelSize.x * 2.5, 0.0)).rgb;
  vec3 c_right = texture2D(tex, uvCoord + vec2(texelSize.x * 2.5, 0.0)).rgb;

  vec3 yiq_c = rgb2yiq * c;
  vec3 yiq_l = rgb2yiq * c_left;
  vec3 yiq_r = rgb2yiq * c_right;

  float blur_I = (yiq_l.y + yiq_c.y * 2.0 + yiq_r.y) / 4.0;
  float blur_Q = (yiq_l.z + yiq_c.z * 2.0 + yiq_r.z) / 4.0;

  vec3 final_yiq = vec3(yiq_c.x, blur_I, blur_Q);
  vec3 out_c = clamp(yiq2rgb * final_yiq, 0.0, 1.0);

  float lines = sin(uvCoord.y * 480.0 * 3.14159265) * 0.05;
  return out_c * (1.0 - lines);
}

// ── Preset 17: iPhone 3GS (OV3640 ISP Knee Curve + Softness) ──
vec3 iphone3gs_grade(vec3 c, vec2 uvCoord) {
  vec3 out_c;
  out_c.r = 1.0 - exp(-c.r * 2.5);
  out_c.g = 1.0 - exp(-c.g * 2.8);
  out_c.b = 1.0 - exp(-c.b * 2.9);

  float dist = distance(uvCoord, vec2(0.5));
  float vignette = smoothstep(0.85, 0.35, dist);
  return clamp(out_c * vignette, 0.0, 1.0);
}

// ── Preset 18: Brainwash (Y2K Digicam CCD Bleed) ──
vec3 brainwash_grade(vec3 c) {
  mat3 satMatrix = mat3(
    1.6, -0.3, -0.3,
    -0.3, 1.6, -0.3,
    -0.3, -0.3, 1.6
  );
  vec3 sat = clamp(satMatrix * c, 0.0, 1.0);
  return smoothstep(0.04, 0.92, sat);
}

void main() {
  vec2 st = uv;

  // 1. Resolution / Pixelate 2x emulation
  if (uPixel2x > 0.5) {
    vec2 grid = res / 2.0;
    st = floor(st * grid) / grid;
  }
  if (jpegRes < 0.99) {
    vec2 grid = max(vec2(16.0), res * jpegRes);
    st = floor(st * grid) / grid;
  }

  // 2. Glitch coordinate distortions
  if (glitchMode == 1 && glitchAmount > 0.01) { // Datamosh
    vec2 block = floor(st * 16.0);
    float shift = hash(block) * glitchAmount * 0.08;
    if (hash(block + 1.3) > 0.6) st.x += shift;
  } else if (glitchMode == 2 && glitchAmount > 0.01) { // VHS
    float scan = sin(st.y * res.y * 0.5 + uTime * 5.0);
    st.x += scan * glitchAmount * 0.005;
  }

  // Base texture sample with optional chromatic aberration (Glitch mode 4 - Galaxy)
  vec3 o;
  if (glitchMode == 4 && glitchAmount > 0.01) {
    vec2 dist = (st - 0.5) * glitchAmount * 0.04;
    o.r = texture2D(img, st + dist).r;
    o.g = texture2D(img, st).g;
    o.b = texture2D(img, st - dist).b;
  } else {
    o = texture2D(img, st).rgb;
  }

  vec3 c = o;

  // 3. Blur / Pixelate modes
  if (blurMode == 1 && blurRadius > 0.5) { // Uniform blur
    vec2 off = vec2(blurRadius) / res;
    c = (texture2D(img, st + vec2(off.x, 0.0)).rgb +
         texture2D(img, st - vec2(off.x, 0.0)).rgb +
         texture2D(img, st + vec2(0.0, off.y)).rgb +
         texture2D(img, st - vec2(0.0, off.y)).rgb) * 0.25;
  } else if (blurMode == 2 && blurRadius > 0.5) { // Vignette blur
    float dist = length(st - 0.5);
    float factor = smoothstep(0.2, 0.6, dist) * blurRadius;
    vec2 off = vec2(factor) / res;
    vec3 bl = (texture2D(img, st + vec2(off.x, 0.0)).rgb +
               texture2D(img, st - vec2(off.x, 0.0)).rgb +
               texture2D(img, st + vec2(0.0, off.y)).rgb +
               texture2D(img, st - vec2(0.0, off.y)).rgb) * 0.25;
    c = mix(c, bl, smoothstep(0.2, 0.6, dist));
  } else if (blurMode == 3 && blurRadius > 1.0) { // Pixelate mosaic
    vec2 blocks = res / blurRadius;
    vec2 bCoord = floor(st * blocks) / blocks;
    c = texture2D(img, bCoord).rgb;
  }

  // 4. Photometric Color Grading Presets (1-18)
  vec3 graded = c;
  if (preset == 1) {
    graded = nashville_grade(c);
  } else if (preset == 2) {
    graded = chief_keef_grade(c, st);
  } else if (preset == 3) {
    graded = nuke_grade(c, st, res, img);
  } else if (preset == 4) {
    graded = phreshboy_grade(c);
  } else if (preset == 5) {
    graded = sepia_grade(c);
  } else if (preset == 6) {
    graded = matte_2014_grade(c);
  } else if (preset == 7) {
    graded = banknote_grade(c);
  } else if (preset == 8) {
    graded = pandora_grade(c);
  } else if (preset == 9) {
    graded = bleach_bypass_grade(c);
  } else if (preset == 10) {
    graded = trix_bw_grade(c);
  } else if (preset == 11) {
    graded = cross_process_grade(c);
  } else if (preset == 12) {
    graded = faded_print_grade(c);
  } else if (preset == 13) {
    graded = teal_orange_grade(c);
  } else if (preset == 14) {
    graded = noir_grade(c);
  } else if (preset == 15) {
    graded = nokia_grade(c, st * res);
  } else if (preset == 16) {
    graded = camcorder_grade(c, st, 1.0 / res, img);
  } else if (preset == 17) {
    graded = iphone3gs_grade(c, st);
  } else if (preset == 18) {
    graded = brainwash_grade(c);
  }

  c = mix(c, graded, amount);

  // 5. Sensor Degradation Module 1: CCD Bloom & Vertical Smear
  if (bloomAmount > 0.01) {
    vec3 smear = apply_ccd_smear(st, 1.0 / res, img) * bloomAmount;
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

  // 7. Sensor Degradation Module 3: Photographic Poisson-style Film Grain
  if (grain > 0.01) {
    c = apply_film_grain(c, st, uTime, grain * 0.35);
  }
  if (ccdNoise > 0.01) {
    vec3 cnoise = vec3(hash(st * res + 1.0), hash(st * res + 2.0), hash(st * res + 3.0)) - 0.5;
    c += cnoise * ccdNoise * 0.3;
  }

  // 8. Sensor Degradation Module 2: JPEG DCT Quantization Artifacts & Extras
  if (jpegQual < 95.0) {
    float q = clamp(1.0 - (jpegQual / 100.0), 0.0, 1.0);
    c = apply_jpeg_dct(st, res, img, q);
  }
  if (uNoise > 0.5) {
    c += (hash(st * 400.0) - 0.5) * 0.12;
  }
  if (uSharpen > 0.5) {
    c = (c - 0.5) * 1.2 + 0.5;
  }

  // 9. Glitch modes: VHS lines / LCD striping
  if (glitchMode == 2 && glitchAmount > 0.01) {
    float bar = smoothstep(0.9, 0.98, sin(st.y * 8.0 + uTime * 3.0));
    c = mix(c, vec3(hash(st * 100.0)), bar * glitchAmount * 0.6);
  } else if (glitchMode == 3 && glitchAmount > 0.01) {
    int sub = int(mod(st.x * res.x, 3.0));
    if (sub == 0) c.gb *= (1.0 - glitchAmount * 0.4);
    else if (sub == 1) c.rb *= (1.0 - glitchAmount * 0.4);
    else c.rg *= (1.0 - glitchAmount * 0.4);
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

interface BakeStep {
  id: string;
  name: string;
  imgData: ImageData;
  time: string;
}

const Darkroom: React.FC<Props> = ({ app, dir = [], name }) => {
  const { getToken } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{ ctx: WebGLRenderingContext; prog: WebGLProgram; texture: WebGLTexture } | null>(null);

  // Images state
  const [originalImg, setOriginalImg] = useState<HTMLImageElement | null>(null);
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);
  const [title, setTitle] = useState(name || 'Untitled');
  const [params, setParams] = useState<DarkroomParams>(DEFAULT_PARAMS);
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState('');
  const [activeTab, setActiveTab] = useState<
    'collage' | 'swag' | 'goth' | 'jpeg' | 'ccd' | 'camera' | 'blur' | 'glitch' | 'versions'
  >('swag');

  // Non-destructive Bake history
  const [bakes, setBakes] = useState<BakeStep[]>([]);
  const [activeBakeId, setActiveBakeId] = useState<string>('original');

  // Server file picker state for iPhone / mobile & desktop
  const [showServerPicker, setShowServerPicker] = useState(false);

  // Collage State
  const [collageGrid, setCollageGrid] = useState<CollageGridPreset>('single');
  const [collageAspect, setCollageAspect] = useState<AspectRatioPreset>('1:1');
  const [collageSlots, setCollageSlots] = useState<(HTMLImageElement | null)[]>([null]);
  const [collageBgColor, setCollageBgColor] = useState<string>('#222222');
  const [collageBgImage, setCollageBgImage] = useState<HTMLImageElement | null>(null);
  const [collageGap, setCollageGap] = useState<number>(8);
  const [textOverlays, setTextOverlays] = useState<TextOverlayItem[]>([]);
  const [isCollageActive, setIsCollageActive] = useState<boolean>(false);

  // Switch collage grid and resize slots array gracefully
  const selectCollageGrid = (newGridId: CollageGridPreset) => {
    setCollageGrid(newGridId);
    setIsCollageActive(true);
    const def = COLLAGE_GRIDS.find((g) => g.id === newGridId);
    if (!def) return;
    setCollageSlots((prev) => {
      const next = [...prev];
      if (!next[0] && (baseImg || originalImg)) {
        next[0] = baseImg || originalImg;
      }
      while (next.length < def.slotCount) next.push(null);
      return next.slice(0, def.slotCount);
    });
  };

  // When switching to collage, automatically ensure the current photo is loaded into slot 1
  useEffect(() => {
    if (activeTab === 'collage') {
      setIsCollageActive(true);
      setCollageSlots((prev) => {
        if (!prev[0] && (baseImg || originalImg)) {
          const next = [...prev];
          next[0] = baseImg || originalImg;
          return next;
        }
        return prev;
      });
    }
  }, [activeTab, baseImg, originalImg]);

  // Re-composite collage and update baseImg whenever collage parameters change
  useEffect(() => {
    if (!isCollageActive) return;
    const gridDef = COLLAGE_GRIDS.find((g) => g.id === collageGrid) || COLLAGE_GRIDS[0];
    const aspectDef = ASPECT_RATIOS.find((a) => a.id === collageAspect) || ASPECT_RATIOS[0];
    const canvas = document.createElement('canvas');
    canvas.width = aspectDef.width;
    canvas.height = aspectDef.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // 1. Background color
    ctx.fillStyle = collageBgColor || '#222222';
    ctx.fillRect(0, 0, W, H);

    // 2. Custom Background image (stretch and shrink to fill)
    if (collageBgImage) {
      drawImageStretch(ctx, collageBgImage, 0, 0, W, H);
    }

    // 3. Render grid slots (stretch and shrink to fill slot bounds, no cropping)
    const outerMargin = collageGap;
    const innerW = W - outerMargin * 2;
    const innerH = H - outerMargin * 2;

    gridDef.slots.forEach((slot, idx) => {
      const sx = Math.round(outerMargin + slot.x * innerW + (collageGap > 0 ? collageGap / 2 : 0));
      const sy = Math.round(outerMargin + slot.y * innerH + (collageGap > 0 ? collageGap / 2 : 0));
      const sw = Math.round(slot.w * innerW - (collageGap > 0 ? collageGap : 0));
      const sh = Math.round(slot.h * innerH - (collageGap > 0 ? collageGap : 0));

      const img = collageSlots[idx];
      if (img) {
        drawImageStretch(ctx, img, sx, sy, sw, sh);
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
    textOverlays.forEach((txt) => {
      if (!txt.text.trim()) return;
      ctx.save();
      const baseScale = Math.min(W, H) / 1000;
      const scaledSize = Math.max(12, Math.round(txt.fontSize * baseScale));
      ctx.font = `bold ${scaledSize}px "${txt.fontFamily}", sans-serif`;
      ctx.textAlign = txt.align;
      ctx.textBaseline = 'middle';
      const tx = (txt.xPercent / 100) * W;
      const ty = (txt.yPercent / 100) * H;

      if (txt.shadow) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillText(txt.text, tx + 3 * baseScale, ty + 3 * baseScale);
      }
      ctx.fillStyle = txt.color;
      ctx.fillText(txt.text, tx, ty);
      ctx.restore();
    });

    const dataUrl = canvas.toDataURL('image/png');
    const compImg = new Image();
    compImg.onload = () => {
      setBaseImg(compImg);
      if (!originalImg) setOriginalImg(compImg);
    };
    compImg.src = dataUrl;
  }, [
    isCollageActive,
    collageGrid,
    collageAspect,
    collageSlots,
    collageBgColor,
    collageBgImage,
    collageGap,
    textOverlays,
  ]);

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
        setOriginalImg(i);
        setBaseImg(i);
        setCollageSlots((prev) => {
          const next = [...prev];
          next[0] = i;
          return next;
        });
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
      setOriginalImg(i);
      setBaseImg(i);
      setCollageSlots((prev) => {
        const next = [...prev];
        next[0] = i;
        return next;
      });
      setTitle(f.name);
      setBakes([]);
      setActiveBakeId('original');
      setStatus('');
    };
    i.onerror = () => setStatus("That file isn't an image this browser can open.");
    i.src = URL.createObjectURL(f);
  };

  // Setup WebGL texture whenever baseImg changes
  useEffect(() => {
    const cv = canvasRef.current;
    if (!baseImg || !cv) return;
    const ctx = cv.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return setStatus("This browser can't run WebGL, which Darkroom needs.");

    const max = Math.min(ctx.getParameter(ctx.MAX_TEXTURE_SIZE), 8192);
    const scale = Math.min(1, max / Math.max(baseImg.naturalWidth, baseImg.naturalHeight));
    cv.width = Math.round(baseImg.naturalWidth * scale);
    cv.height = Math.round(baseImg.naturalHeight * scale);

    const prog = ctx.createProgram()!;
    for (const [type, src] of [
      [ctx.VERTEX_SHADER, VERT],
      [ctx.FRAGMENT_SHADER, FRAG],
    ] as const) {
      const s = ctx.createShader(type)!;
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
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

    const texture = ctx.createTexture()!;
    ctx.bindTexture(ctx.TEXTURE_2D, texture);
    ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, baseImg);
    ctx.viewport(0, 0, cv.width, cv.height);

    glRef.current = { ctx, prog, texture };
    if (scale < 1) setStatus(`Preview scaled to ${cv.width}×${cv.height} (max GPU limit).`);
  }, [baseImg]);

  // Re-render WebGL frame on param update or compare
  useEffect(() => {
    if (!glRef.current || !canvasRef.current) return;
    const { ctx, prog } = glRef.current;
    const p = compare ? DEFAULT_PARAMS : params;

    ctx.uniform2f(ctx.getUniformLocation(prog, 'res'), canvasRef.current.width, canvasRef.current.height);
    ctx.uniform1i(ctx.getUniformLocation(prog, 'preset'), p.preset);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'amount'), p.amount);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'contrast'), p.contrast);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'warmth'), p.warmth);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'fade'), p.fade);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'vignette'), p.vignette);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'grain'), p.iphone6Grain ? Math.max(p.grain, 0.45) : p.grain);

    ctx.uniform1f(ctx.getUniformLocation(prog, 'bloomAmount'), p.bloomAmount);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'bloomTint'), p.bloomTint);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'lensReflection'), p.lensReflection);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'ccdNoise'), p.ccdNoise);

    ctx.uniform1i(ctx.getUniformLocation(prog, 'blurMode'), p.blurMode);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'blurRadius'), p.blurRadius);

    ctx.uniform1i(ctx.getUniformLocation(prog, 'glitchMode'), p.glitchMode);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'glitchAmount'), p.glitchAmount);

    ctx.uniform1f(ctx.getUniformLocation(prog, 'jpegRes'), p.resolution);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'jpegQual'), p.jpegQuality);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'uNoise'), p.jpegNoise ? 1.0 : 0.0);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'uSharpen'), p.jpegSharpen ? 1.0 : 0.0);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'uPixel2x'), p.pixelate2x ? 1.0 : 0.0);
    ctx.uniform1f(ctx.getUniformLocation(prog, 'uTime'), (Date.now() % 100000) / 1000.0);

    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
  }, [baseImg, params, compare]);

  // Non-destructive Bake: bake current canvas as new base image
  const bakeCurrentEdit = () => {
    if (!canvasRef.current) return;
    const cv = canvasRef.current;
    const offscreen = document.createElement('canvas');
    offscreen.width = cv.width;
    offscreen.height = cv.height;
    const octx = offscreen.getContext('2d');
    if (!octx) return;
    octx.drawImage(cv, 0, 0);
    const imgData = octx.getImageData(0, 0, cv.width, cv.height);

    const stepId = `bake-${Date.now()}`;
    const activePresetName = PRESETS.find((pr) => pr.id === params.preset)?.name || 'Custom';
    const newStep: BakeStep = {
      id: stepId,
      name: `Bake ${bakes.length + 1} (${activePresetName})`,
      imgData,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newImg = new Image();
    newImg.onload = () => {
      setBaseImg(newImg);
      setBakes((prev) => [...prev, newStep]);
      setActiveBakeId(stepId);
      setParams(DEFAULT_PARAMS);
      setStatus(`Bake applied. Canvas is ready for layered stacking.`);
    };
    newImg.src = offscreen.toDataURL('image/png');
  };

  // Switch to an earlier bake version or original
  const restoreBake = (stepId: string) => {
    if (stepId === 'original') {
      if (originalImg) {
        setBaseImg(originalImg);
        setActiveBakeId('original');
        setParams(DEFAULT_PARAMS);
        setStatus('Reverted to original photo.');
      }
      return;
    }
    const target = bakes.find((b) => b.id === stepId);
    if (!target) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = target.imgData.width;
    offscreen.height = target.imgData.height;
    const octx = offscreen.getContext('2d');
    if (!octx) return;
    octx.putImageData(target.imgData, 0, 0);
    const img = new Image();
    img.onload = () => {
      setBaseImg(img);
      setActiveBakeId(stepId);
      setParams(DEFAULT_PARAMS);
      setStatus(`Restored to ${target.name}.`);
    };
    img.src = offscreen.toDataURL('image/png');
  };

  const toJpeg = () =>
    new Promise<Blob>((ok, no) =>
      canvasRef.current!.toBlob((b) => (b ? ok(b) : no(new Error('Export failed'))), 'image/jpeg', 0.94),
    );

  const outName = `${title.replace(/\.[^.]+$/, '') || 'photo'}-darkroom.jpg`;

  const download = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await toJpeg());
    a.download = outName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    setStatus(`Exported ${outName} at full resolution.`);
  };

  const saveToFolder = async () => {
    if (!app) return;
    setStatus('Saving to folder...');
    try {
      const body = await toJpeg();
      const q = `upload=${crypto.randomUUID()}&chunks=1&size=${body.size}&chunkSize=${body.size}&chunk=0`;
      const res = await fetch(`${fileUrl(app, [...dir, outName])}?${q}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await getToken()}` },
        body,
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setStatus(`Saved "${outName}" in ${dir.join('/') || 'Root'}.`);
    } catch (e) {
      setStatus(`Failed to save: ${(e as Error).message}`);
    }
  };

  // Helper setter for params
  const setParam = <K extends keyof DarkroomParams>(key: K, val: DarkroomParams[K]) =>
    setParams((prev) => ({ ...prev, [key]: val }));

  return (
    <div style={{ ...shell, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* ── Retro Win98 Menu / Action Bar ── */}
      <div style={{ ...toolbar, flexWrap: 'wrap', gap: 4, padding: '3px 4px' }}>
        <label style={{ ...button, cursor: 'pointer' }}>
          Open Device...
          <input type="file" accept="image/*" hidden onChange={(e) => openLocal(e.target.files?.[0])} />
        </label>
        <button
          style={{ ...button, fontWeight: 700 }}
          onClick={() => setShowServerPicker(true)}
          title="Browse photos from team and server folders"
        >
          Server Files...
        </button>
        <button
          style={{ ...button, fontWeight: compare ? 700 : 400, background: compare ? '#000080' : '#c0c0c0', color: compare ? '#fff' : '#000' }}
          disabled={!baseImg}
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          title="Press & hold to compare original"
        >
          {compare ? '◀ Comparing...' : 'Hold: Compare'}
        </button>
        <button
          style={{ ...button, background: '#008080', color: '#fff', fontWeight: 700 }}
          disabled={!baseImg}
          onClick={bakeCurrentEdit}
          title="Bake current color grade into a new base layer so you can stack more effects"
        >
          Bake Edit
        </button>
        <button style={button} disabled={!baseImg} onClick={download}>
          Download
        </button>
        {app && (
          <button style={button} disabled={!baseImg} onClick={saveToFolder}>
            Save to Folder
          </button>
        )}
        <span style={{ marginLeft: 6, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {title} {bakes.length > 0 ? `(Layer ${bakes.length + 1})` : ''}
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
            // Long press / click-hold on photo also compares
            if (e.button === 0) setCompare(true);
          }}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
        >
          {baseImg ? (
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
              <div style={{ fontSize: 11, marginTop: 4 }}>Open a photo from your device, browse server files, or create a multi-image collage.</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ ...button, fontWeight: 700, cursor: 'pointer' }}>
                  Open Device Photo...
                  <input type="file" accept="image/*" hidden onChange={(e) => openLocal(e.target.files?.[0])} />
                </label>
                <button
                  style={{ ...button, fontWeight: 700, background: '#000080', color: '#fff' }}
                  onClick={() => setShowServerPicker(true)}
                >
                  Browse Server Files...
                </button>
                <button
                  style={{ ...button, fontWeight: 700, background: '#008080', color: '#fff' }}
                  onClick={() => {
                    setActiveTab('collage');
                    setIsCollageActive(true);
                  }}
                >
                  Create Collage
                </button>
              </div>
            </div>
          )}
          {compare && (
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
              ORIGINAL PHOTO
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
            {[
              ['collage', 'Collage'],
              ['swag', 'Swag Filters'],
              ['goth', 'Goth Filters'],
              ['jpeg', 'JPEG Degradation'],
              ['ccd', 'CCD Bloom'],
              ['camera', '1-Click Cameras'],
              ['blur', 'Blur & Pixel'],
              ['glitch', 'Glitch FX'],
              ['versions', `Versions (${bakes.length})`],
            ].map(([tabId, tabTitle]) => {
              const active = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  onClick={() => setActiveTab(tabId as any)}
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
                  {tabTitle}
                </button>
              );
            })}
          </div>

          {/* Tier 2: Category Controls & Presets */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
            {/* ── Collage Module ── */}
            {activeTab === 'collage' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* 1. Layout Grid Presets (10 options) */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                    Layout Grid Presets (10 options):
                  </div>
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

                {/* 2. Aspect Ratios */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                    Aspect Ratios (5 standards):
                  </div>
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

                {/* 3. Multi-Image Slot Loader */}
                <div style={{ background: '#dcdcdc', border: '1px solid #808080', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>Multi-Image Slot Loader:</span>
                      <label style={{ ...button, fontWeight: 700, background: '#000080', color: '#fff', cursor: 'pointer', padding: '2px 8px', fontSize: 11 }}>
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
                                  })
                              )
                            );
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
                      Populates slots in order. You can also customize individual slots below:
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
                <div style={{ background: '#dcdcdc', border: '1px solid #808080', padding: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
                <div style={{ background: '#dcdcdc', border: '1px solid #808080', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PRESETS.filter((p) => p.category === 'swag').map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setParam('preset', p.id)}
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '2px 8px',
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  <label style={{ fontSize: 11 }}>
                    Strength: {(params.amount * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.amount}
                      onChange={(e) => setParam('amount', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Vignette: {(params.vignette * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.vignette}
                      onChange={(e) => setParam('vignette', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Grain: {(params.grain * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.grain}
                      onChange={(e) => setParam('grain', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={params.iphone6Grain}
                      onChange={(e) => setParam('iphone6Grain', e.target.checked)}
                    />
                    iPhone 6 Digital Grain
                  </label>
                </div>
              </div>
            )}

            {/* ── Goth Filters ── */}
            {activeTab === 'goth' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PRESETS.filter((p) => p.category === 'goth').map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setParam('preset', p.id)}
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '2px 8px',
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  <label style={{ fontSize: 11 }}>
                    Contrast: {params.contrast.toFixed(2)}x
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.01}
                      value={params.contrast}
                      onChange={(e) => setParam('contrast', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Warmth: {params.warmth.toFixed(2)}
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.02}
                      value={params.warmth}
                      onChange={(e) => setParam('warmth', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Fade (lifted blacks): {(params.fade * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.fade}
                      onChange={(e) => setParam('fade', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* ── JPEG Degradation ── */}
            {activeTab === 'jpeg' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>Quality Presets:</span>
                  {[
                    ['High', 85, 1.0],
                    ['Medium', 45, 0.65],
                    ['Low', 12, 0.35],
                  ].map(([qName, qVal, rVal]) => (
                    <button
                      key={qName as string}
                      onClick={() => {
                        setParam('jpegQuality', qVal as number);
                        setParam('resolution', rVal as number);
                      }}
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
                  <label style={{ fontSize: 11 }}>
                    JPEG Quality: {Math.round(params.jpegQuality)}%
                    <input
                      type="range"
                      min={1}
                      max={100}
                      step={1}
                      value={params.jpegQuality}
                      onChange={(e) => setParam('jpegQuality', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Resolution Scale: {Math.round(params.resolution * 100)}%
                    <input
                      type="range"
                      min={0.05}
                      max={1.0}
                      step={0.01}
                      value={params.resolution}
                      onChange={(e) => setParam('resolution', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={params.jpegNoise}
                      onChange={(e) => setParam('jpegNoise', e.target.checked)}
                    />
                    Apply Noise (High-freq noise)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={params.jpegSharpen}
                      onChange={(e) => setParam('jpegSharpen', e.target.checked)}
                    />
                    Apply Sharpen (Unsharp mask)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={params.pixelate2x}
                      onChange={(e) => setParam('pixelate2x', e.target.checked)}
                    />
                    Pixelate (2x Upscale)
                  </label>
                </div>
              </div>
            )}

            {/* ── CCD Bloom ── */}
            {activeTab === 'ccd' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  <label style={{ fontSize: 11 }}>
                    Bloom Amount: {(params.bloomAmount * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.bloomAmount}
                      onChange={(e) => setParam('bloomAmount', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Bloom Tint: {params.bloomTint < 0 ? 'Cool' : params.bloomTint > 0 ? 'Warm' : 'Neutral'}
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={params.bloomTint}
                      onChange={(e) => setParam('bloomTint', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    Lens Reflection: {(params.lensReflection * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.lensReflection}
                      onChange={(e) => setParam('lensReflection', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ fontSize: 11 }}>
                    CCD Sensor Noise: {(params.ccdNoise * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.ccdNoise}
                      onChange={(e) => setParam('ccdNoise', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* ── 1-Click Cameras ── */}
            {activeTab === 'camera' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PRESETS.filter((p) => p.category === 'camera').map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setParam('preset', p.id)}
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '4px 8px',
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
                <div style={{ fontSize: 11, color: '#444', fontStyle: 'italic', marginTop: 4 }}>
                  {PRESETS.find((p) => p.id === params.preset)?.desc || 'Select a vintage camera profile above.'}
                </div>
              </div>
            )}

            {/* ── Blur & Pixel ── */}
            {activeTab === 'blur' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    [0, 'Off'],
                    [1, 'Uniform Blur'],
                    [2, 'Vignette Blur (Center sharp)'],
                    [3, 'Pixelate Mosaic'],
                  ].map(([mId, mLabel]) => (
                    <button
                      key={mId as number}
                      onClick={() => setParam('blurMode', mId as any)}
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
                {params.blurMode > 0 && (
                  <label style={{ fontSize: 11 }}>
                    Radius / Pixel Size: {params.blurRadius.toFixed(0)} px
                    <input
                      type="range"
                      min={1}
                      max={25}
                      step={1}
                      value={params.blurRadius}
                      onChange={(e) => setParam('blurRadius', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                )}
              </div>
            )}

            {/* ── Glitch FX ── */}
            {activeTab === 'glitch' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    [0, 'Off'],
                    [1, 'Datamosh'],
                    [2, 'VHS Tracking'],
                    [3, 'LCD Subpixels'],
                    [4, 'Galaxy (Chroma Fringing)'],
                  ].map(([gId, gLabel]) => (
                    <button
                      key={gId as number}
                      onClick={() => setParam('glitchMode', gId as any)}
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
                  <label style={{ fontSize: 11 }}>
                    Glitch Intensity: {(params.glitchAmount * 100).toFixed(0)}%
                    <input
                      type="range"
                      min={0.05}
                      max={1.0}
                      step={0.02}
                      value={params.glitchAmount}
                      onChange={(e) => setParam('glitchAmount', +e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                )}
              </div>
            )}

            {/* ── Versions & Bake Drawer ── */}
            {activeTab === 'versions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: '#333', marginBottom: 2 }}>
                  Non-destructive edit stack. Click any step to restore or inspect.
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => restoreBake('original')}
                    style={{
                      ...button,
                      fontSize: 11,
                      padding: '3px 8px',
                      fontWeight: activeBakeId === 'original' ? 700 : 400,
                      background: activeBakeId === 'original' ? '#000080' : '#c0c0c0',
                      color: activeBakeId === 'original' ? '#fff' : '#000',
                    }}
                  >
                    Original Base
                  </button>
                  {bakes.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => restoreBake(b.id)}
                      style={{
                        ...button,
                        fontSize: 11,
                        padding: '3px 8px',
                        fontWeight: activeBakeId === b.id ? 700 : 400,
                        background: activeBakeId === b.id ? '#000080' : '#c0c0c0',
                        color: activeBakeId === b.id ? '#fff' : '#000',
                      }}
                    >
                      {b.name} <span style={{ fontSize: 9, opacity: 0.8 }}>({b.time})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div style={{ padding: '2px 6px', borderTop: '1px solid #808080', minHeight: 18, fontSize: 11, background: '#c0c0c0', color: '#222' }}>
        {status || 'Ready.'}
      </div>

      {/* ── Server File Picker Modal ── */}
      {showServerPicker && (
        <FilePicker
          title="Open Image from Server"
          mode="file"
          accept={(n) => /\.(jpe?g|png|webp|avif|gif|tiff?|bmp|dng|raw)$/i.test(n)}
          onPick={async (ref: FileRef | null) => {
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
              setOriginalImg(i);
              setBaseImg(i);
              setCollageSlots((prev) => {
                const next = [...prev];
                next[0] = i;
                return next;
              });
              setTitle(fileName);
              setBakes([]);
              setActiveBakeId('original');
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
