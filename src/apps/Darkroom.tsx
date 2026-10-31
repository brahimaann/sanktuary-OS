import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { fileUrl, shell, toolbar, button } from './TeamFiles';
import SevenSegmentDisplay from '../components/SevenSegmentDisplay';
import FilePicker, { FileRef } from '../components/FilePicker';
import { isTouch, saveFilesToDevice, saveToDevice } from './fileTypes';
import { uploadFiles } from '../utils/upload';
import { drawText, TEXT_STYLES, TextOverlayItem, TextStyle } from '../utils/captions';
import {
  buildFx,
  DarkroomParams,
  DEFAULT_PARAMS,
  dims,
  drawFrame,
  FILM_GRAIN,
  FilterPreset,
  Gl,
  initGl,
  labStats,
  MIX_BANDS,
  pickColour,
  PRESETS,
  skinCentre,
  Source,
} from './darkroomGl';

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

const TABS = [
  ['collage', 'Collage'],
  ['swag', 'Swag Filters'],
  ['goth', 'Goth Filters'],
  ['film', 'Film Stocks'],
  ['mixer', 'Colour Mixer'],
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
  const glRef = useRef<Gl | null>(null);

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
  const [mixBand, setMixBand] = useState(1); // Colour mixer: the band being edited (Orange, where most skin sits)
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
  const skinUsed = params.skinUniform > 0;
  const [picking, setPicking] = useState(false); // Colour Mixer: the next tap on the photo picks the skin tone
  const skinPick = params.skinPick;
  const skin = useMemo(
    () => (skinUsed && source ? (skinPick.length ? (skinPick as [number, number]) : skinCentre(source)) : null),
    [skinUsed, source, skinPick],
  );
  const dirty =
    isCollageActive ||
    (Object.keys(DEFAULT_PARAMS) as (keyof DarkroomParams)[]).some((k) => String(params[k]) !== String(DEFAULT_PARAMS[k]));
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
      const g = initGl(cv);
      if (typeof g === 'string') return setStatus(g);
      glRef.current = g;
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
    glRef.current.fx = buildFx(ctx, glRef.current.prog, glRef.current.fx, cv.width, cv.height);
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
        g.fx = buildFx(ctx, prog, g.fx, 1080, 1350);
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
    drawFrame(glRef.current, compare ? DEFAULT_PARAMS : params, matchStats, skin);
  }, [source, crushed, params, compare, matchStats, skin, redraw]);

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
          onClick={() =>
            setParams((prev) => ({
              ...prev,
              preset: p.id,
              // A stock brings its own grain; leaving the stocks takes it away again
              ...(FILM_GRAIN[p.id] ??
                (FILM_GRAIN[prev.preset] ? { grain: DEFAULT_PARAMS.grain, grainSize: DEFAULT_PARAMS.grainSize } : {})),
            }))
          }
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
            cursor: picking ? 'crosshair' : undefined,
          }}
          onPointerDown={(e) => {
            if (picking) {
              const r = canvasRef.current?.getBoundingClientRect();
              setPicking(false);
              if (!r || !source) return;
              const [u, v] = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
              if (u < 0 || u > 1 || v < 0 || v > 1) return;
              const [hue, C] = pickColour(source, u, v);
              if (C < 0.015) return setStatus('That spot is almost grey, so it has no skin tone to work from. Tap on skin.');
              setParams((prev) => ({ ...prev, skinPick: [hue, C], skinUniform: prev.skinUniform || 0.5 }));
              return;
            }
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

            {/* ── Film Stocks ── */}
            {activeTab === 'film' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {presetButtons('film')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  {strength}
                  {slider('Grain', 'grain', 0, 1, 0.01, pct(params.grain))}
                  {slider(
                    'Grain size',
                    'grainSize',
                    0,
                    1,
                    0.01,
                    params.grainSize < 0.34 ? 'Fine' : params.grainSize < 0.67 ? 'Medium' : 'Coarse',
                  )}
                  {slider('Halation', 'halation', 0, 1, 0.01, pct(params.halation))}
                  {slider('Clarity', 'clarity', -0.5, 1, 0.01, pct(params.clarity))}
                  {slider('Contrast', 'contrast', 0.5, 2, 0.01, `${params.contrast.toFixed(2)}x`)}
                  {slider('Warmth', 'warmth', -1, 1, 0.02, params.warmth.toFixed(2))}
                </div>
              </div>
            )}

            {/* ── Colour Mixer ── */}
            {activeTab === 'mixer' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {MIX_BANDS.map(([name, hue], i) => (
                    <button
                      key={name}
                      onClick={() => setMixBand(i)}
                      style={{ ...button, fontSize: 11, padding: '2px 8px', fontWeight: mixBand === i ? 700 : 400 }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 9,
                          height: 9,
                          marginRight: 4,
                          border: '1px solid #000',
                          background: `oklch(0.7 0.14 ${hue})`,
                          outline: mixBand === i ? '1px dotted #000' : undefined,
                        }}
                      />
                      {name}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
                  {(
                    [
                      ['Hue', 'mixHue', (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 30)}°`],
                      ['Saturation', 'mixSat', (v: number) => `${v > 0 ? '+' : ''}${pct(v)}`],
                      ['Lightness', 'mixLum', (v: number) => `${v > 0 ? '+' : ''}${pct(v)}`],
                    ] as const
                  ).map(([label, key, shown]) => (
                    <label key={key}>
                      {MIX_BANDS[mixBand][0]} {label.toLowerCase()}: {shown(params[key][mixBand])}
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={params[key][mixBand]}
                        onChange={(e) =>
                          setParams((prev) => ({ ...prev, [key]: prev[key].map((v, i) => (i === mixBand ? +e.target.value : v)) }))
                        }
                        onDoubleClick={() => setParams((prev) => ({ ...prev, [key]: prev[key].map((v, i) => (i === mixBand ? 0 : v)) }))}
                        style={{ width: '100%' }}
                      />
                    </label>
                  ))}
                  {slider('Skin uniformity', 'skinUniform', 0, 1, 0.01, pct(params.skinUniform))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b>Skin tone:</b>
                  <button
                    style={{ ...button, fontSize: 11, background: picking ? '#000080' : '#c0c0c0', color: picking ? '#fff' : '#000' }}
                    onClick={() => setPicking(!picking)}
                  >
                    {picking ? 'Now tap skin on the photo...' : 'Tap to pick'}
                  </button>
                  {skinPick.length ? (
                    <>
                      <span
                        title="The skin tone you picked"
                        style={{
                          width: 16,
                          height: 16,
                          border: '1px solid #000',
                          background: `oklch(0.6 ${skinPick[1]} ${(skinPick[0] * 180) / Math.PI})`,
                        }}
                      />
                      <button style={{ ...button, fontSize: 11 }} onClick={() => setParam('skinPick', [])}>
                        Auto
                      </button>
                    </>
                  ) : (
                    <span>Auto (worked out from the photo)</span>
                  )}
                </div>
                <div style={{ color: '#444' }}>
                  {skinUsed && !skin
                    ? "Skin uniformity didn't find enough skin in this photo to work from. Tap to pick it instead."
                    : "Skin uniformity evens out blotchy or colour-cast patches by pulling them toward the photo's own skin tone (or the one you tap), without changing how light or dark the skin is. In a group shot, tap the face you want it to follow. Double-click a slider to reset it."}
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
