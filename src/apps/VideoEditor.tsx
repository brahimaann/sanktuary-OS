import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { drawText, lyricWords, TEXT_STYLES, TextOverlayItem, TextStyle, WORD_STYLES } from '../utils/captions';
import FilePicker, { FileRef } from '../components/FilePicker';
import { sharedAudio } from '../utils/sound';
import { beatGrid, estimateTempo, waveformPeaks } from '../utils/audioAnalysis';
import { lightAudio } from './fileTypes';
import type { ContentItem } from './ShotContent';
import { fileUrl, LogOn, shell, toolbar, button, statusBar } from './TeamFiles';

/**
 * Quick video editor for promo and lyric videos: one clip (+ a song), a format, how the clip fills it, a look and
 * timed captions, previewed live here and rendered to an MP4 by the server (next to the clip). Templates set it all
 * up in one tap, for a post in about fifteen minutes.
 */
type Format = '9:16' | '4:5' | '1:1' | '16:9';
type Fit = 'crop' | 'fit' | 'stretch' | 'duo' | 'film' | 'scope';
type Look = 'none' | 'lux' | 'faded' | 'bw' | 'cold' | 'tungsten' | 'club' | 'film' | 'vhs';
interface Cap {
  id: string;
  text: string;
  start: number;
  end: number;
  style: TextStyle;
  size: number;
  y: number;
  words?: number[]; // when each word is sung (seconds into the edit), from tap timing
}

const SIZES: Record<Format, [number, number]> = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const FITS: [Fit, string][] = [
  ['crop', 'Fill (crop)'],
  ['fit', 'Whole clip (bars)'],
  ['stretch', 'Stretch'],
  ['duo', 'Stretch duo'],
  ['film', '4:3 picture'],
  ['scope', 'Widescreen bars'],
];
// "4:3 picture" and "Widescreen bars" crop the clip to that shape and centre it in the frame on black (the same
// sum is in server/index.mjs videoBox)
const BOX: Partial<Record<Fit, number>> = { film: 4 / 3, scope: 2.39 };
const box = (W: number, H: number, aspect: number) => {
  const w = Math.min(W, H * aspect);
  return [2 * Math.round(w / 2), 2 * Math.round(w / aspect / 2)];
};
// Each look's live preview is a CSS filter close to the server's ffmpeg version (server/index.mjs VIDEO_LOOKS)
const LOOKS: [Look, string, string][] = [
  ['none', 'None', ''],
  ['lux', '2012 Lux', 'contrast(1.12) saturate(1.5) sepia(0.12)'],
  ['faded', 'Faded IG', 'contrast(0.85) brightness(1.08) saturate(0.9) sepia(0.15)'],
  ['bw', 'Silver B&W', 'grayscale(1) contrast(1.3)'],
  ['cold', 'Cold VHS', 'saturate(0.55) contrast(0.88) sepia(0.25) hue-rotate(170deg)'],
  ['tungsten', 'Tungsten Cam', 'brightness(0.85) saturate(0.75) sepia(0.45)'],
  ['club', 'Club Flash', 'contrast(1.15) saturate(1.2) hue-rotate(-20deg)'],
  ['film', 'Film grain', 'contrast(0.9) brightness(1.05) saturate(0.8) sepia(0.2)'],
  ['vhs', 'VHS bleed', 'contrast(0.85) brightness(0.95) saturate(1.3) sepia(0.15) blur(0.6px)'],
];
// One-tap lyric templates, from the team's reference videos: all lowercase, small type, the words doing the motion
const LYRIC_TEMPLATES: { label: string; fit: Fit; look: Look; style: TextStyle; size: number; y: number }[] = [
  { label: 'One word', fit: 'scope', look: 'tungsten', style: 'word', size: 80, y: 50 },
  { label: 'Film subtitle', fit: 'film', look: 'faded', style: 'sub', size: 34, y: 66 },
  { label: 'Serif subtitle', fit: 'crop', look: 'film', style: 'serif', size: 36, y: 74 },
  { label: 'Centre line', fit: 'film', look: 'bw', style: 'sub', size: 34, y: 50 },
  { label: 'Build-up', fit: 'crop', look: 'none', style: 'build', size: 52, y: 50 },
  { label: 'Stack', fit: 'film', look: 'vhs', style: 'stack', size: 80, y: 50 },
  { label: 'Spread grid', fit: 'film', look: 'faded', style: 'grid', size: 90, y: 49 },
];
const styleSize = (st: TextStyle) => LYRIC_TEMPLATES.find((x) => x.style === st)?.size ?? (st === 'grid' ? 110 : 60);
// Beat cuts: how often the edit cuts to the next clip. steady: every bar (4 beats); smart: every 2 beats; energy: every
// beat where the song is loud, every bar elsewhere.
type Pace = 'off' | 'steady' | 'smart' | 'energy';
const PACES: [Pace, string][] = [
  ['off', 'No cuts'],
  ['steady', 'Steady (every bar)'],
  ['smart', 'Smart (every 2 beats)'],
  ['energy', 'Energy (faster when loud)'],
];
interface Piece {
  ref: FileRef;
  key: string;
  at: number; // where it starts in the edit
  from: number; // where it starts in its clip
  len: number;
}
const keyOf = (r: FileRef) => `${r.space}/${r.path}`;
/** The edit as pieces of the clips, cut on the beats (song times) for the pace; the clips take turns in `order`,
 * each carrying on from where it left off (back to its start when it runs out). */
function beatPieces(
  clips: { ref: FileRef; from: number; length: number }[],
  grid: { beats: number[]; loud: number[] } | null,
  songAt: number,
  duration: number,
  pace: Pace,
  order: number[] = clips.map((_, i) => i),
): Piece[] {
  const cuts: number[] = [];
  if (grid && pace !== 'off' && clips.length)
    grid.beats.forEach((b, i) => {
      const t = b - songAt;
      const on = pace === 'steady' ? i % 4 === 0 : pace === 'smart' ? i % 2 === 0 : grid.loud[i] >= 0.75 || i % 4 === 0;
      if (on && t > 0.3 && t < duration - 0.3 && t - (cuts[cuts.length - 1] ?? 0) >= 0.3) cuts.push(Math.round(t * 1000) / 1000);
    });
  const bounds = [0, ...cuts, duration];
  const cursor = clips.map((c) => c.from);
  return bounds.slice(0, -1).map((at, i) => {
    const k = order[i % order.length];
    const c = clips[k];
    const len = Math.round((bounds[i + 1] - at) * 1000) / 1000;
    if (c.length && cursor[k] + len > c.length) cursor[k] = Math.min(c.from, Math.max(0, c.length - len));
    const from = Math.round(cursor[k] * 1000) / 1000;
    cursor[k] += len;
    return { ref: c.ref, key: keyOf(c.ref), at, from, len };
  });
}
interface ProjectHome {
  id: string;
  title: string;
  folder: FileRef;
  content?: ContentItem[];
}
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const AUDIO = /\.(wav|aiff?|flac|mp3|m4a|ogg)$/i;
const newId = () => Math.random().toString(36).slice(2, 9);
// When each word shows: the tapped times, or spread evenly over the caption for the word-by-word styles
const wordTimes = (c: Cap) => {
  if (c.words?.length) return c.words;
  if (!WORD_STYLES.includes(c.style)) return [];
  const n = lyricWords(c.text).length;
  return Array.from({ length: n }, (_, i) => c.start + ((c.end - c.start) * i) / n);
};
const asItem = (c: Cap, now = Infinity): TextOverlayItem => ({
  shown: wordTimes(c).length ? wordTimes(c).filter((w) => w <= now).length : undefined,
  id: c.id,
  text: c.text,
  fontSize: c.size,
  color: '#ffffff',
  fontFamily: 'Arial',
  align: 'center',
  xPercent: 50,
  yPercent: c.y,
  shadow: c.style === 'plain' || c.style === 'grid',
  style: c.style,
});

const VideoEditor: React.FC<{ clip?: FileRef }> = ({ clip: initial }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Video Editor" />;
  return <Editor initial={initial} />;
};

const Editor: React.FC<{ initial?: FileRef }> = ({ initial }) => {
  const api = useApi();
  const { getToken } = useAuth();
  const [clip, setClip] = useState<FileRef | null>(initial || null);
  const [song, setSong] = useState<FileRef | null>(null);
  const [songAt, setSongAt] = useState(0);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(15);
  const [format, setFormat] = useState<Format>('9:16');
  const [fit, setFit] = useState<Fit>('crop');
  const [look, setLook] = useState<Look>('none');
  const [caps, setCaps] = useState<Cap[]>([]);
  const [lyrics, setLyrics] = useState('');
  const [capStyle, setCapStyle] = useState<TextStyle>('grid');
  const [picking, setPicking] = useState<null | 'clip' | 'song' | 'more'>(null);
  const [more, setMore] = useState<{ ref: FileRef; from: number }[]>([]); // the other clips the beat cuts use
  const [pace, setPace] = useState<Pace>('off');
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const [grid, setGrid] = useState<{ bpm: number; beats: number[]; loud: number[] } | null>(null);
  const vids = useRef<Record<string, HTMLVideoElement | null>>({});
  const [token, setToken] = useState<string | null>(null); // null until asked; '' when signed in by cookie
  const [clipLength, setClipLength] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [proxy, setProxy] = useState(false); // the server's H.264 copy, for clips the browser can't decode (HEVC / ProRes)
  const [jobs, setJobs] = useState<
    { id: string; name: string; status: string; pct: number; error: string | null; space: string; path: string; batch: string | null }[]
  >([]);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [songPeaks, setSongPeaks] = useState<number[] | null>(null);
  const [songLength, setSongLength] = useState(0);

  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const frameCv = useRef<HTMLCanvasElement>(null);
  const capCv = useRef<HTMLCanvasElement>(null);
  const songCv = useRef<HTMLCanvasElement>(null);
  const shown = useRef(0);
  const [W, H] = SIZES[format];
  const src = (r: FileRef) => {
    const parts = r.path.split('/');
    return `${fileUrl(r.space, parts)}?t=${token ?? ''}`;
  };

  useEffect(() => {
    getToken().then((x) => setToken(x || ''));
  }, [getToken, clip, song]);
  // A draft per clip in this browser, so closing the window doesn't lose the captions and settings
  const draftKey = clip && `sk_video_${clip.space}/${clip.path}`;
  const loadingDraft = useRef(false); // the first save after a load would write the empty state over the draft
  useEffect(() => {
    if (!clip) return;
    loadingDraft.current = true;
    setName(
      `${clip.path
        .split('/')
        .pop()!
        .replace(/\.[^.]+$/, '')} edit`,
    );
    try {
      const d = JSON.parse(localStorage.getItem(draftKey!) || 'null');
      if (!d) return;
      setSong(d.song);
      setSongAt(d.songAt);
      setStart(d.start);
      setDuration(d.duration);
      setFormat(d.format);
      setFit(d.fit);
      setLook(d.look);
      setCaps(d.caps);
      setLyrics(d.lyrics);
      setCapStyle(d.capStyle);
      setMore(d.more || []);
      setPace(d.pace || 'off');
      setName(d.name);
    } catch {
      // no draft or storage blocked: start fresh
    }
  }, [clip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loadingDraft.current) {
      loadingDraft.current = false;
      return;
    }
    try {
      if (draftKey)
        localStorage.setItem(
          draftKey,
          JSON.stringify({ song, songAt, start, duration, format, fit, look, caps, lyrics, capStyle, name, more, pace }),
        );
    } catch {
      // storage full or blocked: the draft just isn't kept
    }
  }, [draftKey, song, songAt, start, duration, format, fit, look, caps, lyrics, capStyle, name, more, pace]);

  // The song's waveform, to pick where it starts (the light MP3 copy for WAV / AIFF / FLAC)
  useEffect(() => {
    setSongPeaks(null);
    setGrid(null);
    if (!song || token === null) return;
    const abort = new AbortController();
    fetch(src(song) + (lightAudio(song.path) ? '&preview' : ''), { signal: abort.signal })
      .then((r) => r.arrayBuffer())
      .then((b) => sharedAudio()!.decodeAudioData(b))
      .then((a) => {
        if (abort.signal.aborted) return;
        setSongPeaks(waveformPeaks(a.getChannelData(0)));
        // the beat, for cutting between clips on it
        const tempo = estimateTempo(a.getChannelData(0), a.sampleRate);
        setGrid(tempo ? { bpm: tempo.bpm, ...beatGrid(a.getChannelData(0), a.sampleRate, tempo.bpm) } : null);
        setSongLength(a.duration);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [song, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const g = songCv.current?.getContext('2d');
    if (!g || !songPeaks || !songLength) return;
    const [w, h] = [g.canvas.width, g.canvas.height];
    const x = (s: number) => (s / songLength) * w;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffe1';
    g.fillRect(x(songAt), 0, x(duration), h); // the part that plays under the clip
    const top = Math.max(...songPeaks) || 1;
    const bar = w / songPeaks.length;
    songPeaks.forEach((p, i) => {
      const bh = (p / top) * h;
      const s = (i / songPeaks.length) * songLength;
      g.fillStyle = s >= songAt && s < songAt + duration ? '#000' : '#a0a0a0';
      g.fillRect(i * bar, (h - bh) / 2, Math.max(1, bar - 0.5), bh);
    });
    g.fillStyle = '#c00000';
    g.fillRect(x(songAt + t), 0, 1, h);
  }, [songPeaks, songLength, songAt, duration, t]);

  // Beat cuts: the clips, the pieces the edit is cut into, and whether there's more than one
  const clips = clip
    ? [{ ref: clip, from: start }, ...more].map((c) => ({
        ...c,
        length: keyOf(c.ref) === keyOf(clip) ? clipLength : lengths[keyOf(c.ref)] || 0,
      }))
    : [];
  const pieces = beatPieces(clips, song ? grid : null, songAt, duration, more.length ? pace : 'off');
  const multi = pieces.length > 1;

  // The live preview: the clip drawn into the frame the way the render will (the look as a CSS filter on this
  // layer), captions on a second layer on top, exactly as they'll be burned in
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = audio.current;
      // Beat cuts play on the song's clock: the clip of the piece under it is kept at the right point
      let v = video.current;
      let now = Math.max(0, (v?.currentTime ?? 0) - start);
      if (multi && a) {
        now = Math.max(0, a.currentTime - songAt);
        const p = pieces.find((x) => now >= x.at && now < x.at + x.len) ?? pieces[pieces.length - 1];
        v = vids.current[p.key] ?? null;
        const want = p.from + (now - p.at);
        if (v && !v.seeking && Math.abs(v.currentTime - want) > (playing ? 0.25 : 0.04)) v.currentTime = want;
        if (v && playing && v.paused) v.play().catch(() => {});
        for (const o of Object.values(vids.current)) if (o && o !== v && !o.paused) o.pause();
      }
      const fc = frameCv.current?.getContext('2d');
      const cc = capCv.current?.getContext('2d');
      if (v && fc && cc) {
        if (playing && now >= duration) seek(0);
        fc.fillStyle = '#000';
        fc.fillRect(0, 0, W, H);
        if (v.videoWidth) {
          const [iw, ih] = [v.videoWidth, v.videoHeight];
          const aspect = BOX[fit];
          if (aspect) {
            // crop the clip to the box's shape, centred, and put it in the middle of the frame
            const [bw, bh] = box(W, H, aspect);
            const s = Math.max(bw / iw, bh / ih);
            const [sw, sh] = [bw / s, bh / s];
            fc.drawImage(v, (iw - sw) / 2, (ih - sh) / 2, sw, sh, (W - bw) / 2, (H - bh) / 2, bw, bh);
          } else if (fit === 'stretch') fc.drawImage(v, 0, 0, W, H);
          else if (fit === 'duo') {
            fc.drawImage(v, 0, 0, W / 2, H);
            fc.drawImage(v, W / 2, 0, W / 2, H);
          } else {
            const s = fit === 'crop' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
            fc.drawImage(v, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
          }
        }
        // Two players drift apart: keep the song on the video's clock
        if (!multi && playing && a && !a.paused && !a.seeking && Math.abs(a.currentTime - songAt - now) > 0.1) a.currentTime = songAt + now;
        cc.clearRect(0, 0, W, H);
        for (const c of caps) if (now >= c.start && now < c.end) drawText(cc, asItem(c, now), W, H);
        if (Math.abs(now - shown.current) > 0.04) setT((shown.current = now)); // the time readout, not every frame
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [W, H, fit, caps, start, duration, playing, songAt, pieces]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (s: number) => {
    if (video.current && !multi) video.current.currentTime = start + s;
    if (audio.current) audio.current.currentTime = songAt + s;
  };
  const play = () => {
    if (!video.current) return;
    if (playing) {
      video.current.pause();
      audio.current?.pause();
      for (const o of Object.values(vids.current)) o?.pause();
      return setPlaying(false);
    }
    seek(t >= duration ? 0 : t);
    video.current.muted = !!song; // the song replaces the clip's own sound, like the render
    if (!multi) video.current.play().catch(() => {});
    audio.current?.play().catch(() => {});
    setPlaying(true);
  };

  // Lyrics: one caption per line, spread evenly over the clip
  const spread = () => {
    const lines = lyrics
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 80);
    if (!lines.length) return;
    const each = duration / lines.length;
    setCaps(
      lines.map((text, i) => ({
        id: newId(),
        text,
        start: Math.round(i * each * 10) / 10,
        end: Math.round((i + 1) * each * 10) / 10,
        style: capStyle,
        size: styleSize(capStyle),
        y: caps[0]?.y ?? 50,
      })),
    );
  };

  // Tap timing: the edit plays and every tap (the button, T or Enter) marks when the next word is sung, or the
  // next line for the line styles. The lyrics become captions with those times.
  const [tap, setTap] = useState<null | { byWord: boolean; times: number[] }>(null);
  const lyricLines = lyrics
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => lyricWords(l).length)
    .slice(0, 80);
  const tapUnits = tap ? (tap.byWord ? lyricLines.flatMap(lyricWords) : lyricLines.map((l) => l.replace(/\s+\/(?=\s|$)/g, ''))) : [];
  const startTap = () => {
    const byWord = WORD_STYLES.includes(capStyle);
    setTap({ byWord, times: [] });
    if (playing) play();
    seek(0);
    setTimeout(play, 50);
    setMsg(`Tap on every ${byWord ? 'word' : 'line'} as it's sung: the button, T or Enter.`);
  };
  // Lyric lines + when each word (or each line) starts -> captions that hold until the next line
  const timeLines = (lines: string[], times: number[], byWord: boolean) => {
    const y = caps[0]?.y ?? 50;
    const out: Cap[] = [];
    let k = 0;
    lines.forEach((line, i) => {
      const count = lyricWords(line).length;
      const own = byWord ? times.slice(k, k + count) : times.slice(i, i + 1);
      k += count;
      if (!own.length) return;
      const next = byWord ? times[k] : times[i + 1];
      const end = Math.min(duration, next ?? Infinity, own[own.length - 1] + (byWord ? 2 : 5));
      out.push({
        id: newId(),
        text: line,
        start: own[0],
        end: Math.max(end, own[0] + 0.2),
        style: capStyle,
        size: styleSize(capStyle),
        y,
        words: byWord ? own : undefined,
      });
    });
    setCaps(out);
    return out;
  };
  const finishTap = (times: number[]) => {
    if (!tap) return;
    if (playing) play();
    const out = timeLines(lyricLines, times, tap.byWord);
    setTap(null);
    setMsg(`${out.length} lines timed. Play it back; drag a line's times to fix it, or tap again.`);
  };
  // Auto timing: the server listens to the song under the edit (or, with no song, the clip's own sound). With lyrics pasted, they get the times; without,
  // what it heard becomes the lyrics (a new line at each pause or every seven words).
  const [hearing, setHearing] = useState(false);
  const autoTime = async () => {
    if (!song && !clip) return;
    setHearing(true);
    setMsg(`Listening to the ${song ? 'song' : "clip's sound"} for the words (the first time on the server can take a few minutes)...`);
    try {
      const r: { heard: { w: string; t: number }[]; times: number[] | null } = await api('/api/video/words', {
        method: 'POST',
        body: JSON.stringify({ song, songAt, clip, clipAt: start, duration, lyrics }),
      });
      let lines = lyricLines;
      let times = r.times;
      if (!times) {
        const rows: string[][] = [];
        r.heard.forEach((h, i) => {
          if (!i || h.t - r.heard[i - 1].t > 0.7 || rows[rows.length - 1].length >= 7) rows.push([]);
          rows[rows.length - 1].push(h.w.toLowerCase().replace(/[.,!?]+$/, ''));
        });
        lines = rows.map((x) => x.join(' '));
        times = r.heard.map((h) => h.t);
        setLyrics(lines.join('\n'));
      }
      const out = timeLines(lines, times, true);
      setMsg(`${out.length} line${out.length === 1 ? '' : 's'} timed by ear. Play it back and fix any word's line times, or tap instead.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setHearing(false);
  };
  const tapNow = () => {
    if (!tap) return;
    const now = Math.round((video.current ? video.current.currentTime - start : t) * 100) / 100;
    const times = [...tap.times, now];
    if (times.length >= tapUnits.length) finishTap(times);
    else setTap({ ...tap, times });
  };
  const setCap = (id: string, k: keyof Cap, v: string | number) => setCaps(caps.map((c) => (c.id === id ? { ...c, [k]: v } : c)));

  // One tap: format, fill, look and a caption set to start from
  const lyricTemplate = (tp: (typeof LYRIC_TEMPLATES)[number]) => {
    setFormat('9:16');
    setFit(tp.fit);
    setLook(tp.look);
    setCapStyle(tp.style);
    setLyrics(lyrics.toLowerCase());
    setCaps(caps.map((c) => ({ ...c, text: c.text.toLowerCase(), style: tp.style, size: tp.size, y: tp.y })));
    if (!caps.length) setMsg(`${tp.label}: paste the lyrics (one line each), then Tap timing or Spread over clip.`);
  };
  // Promo presets, from the formats that keep coming back on TikTok / Reels: each sets the length, look, pace and a
  // starting caption to change (hook first, words in the top or middle, out of the bottom third the apps cover)
  const promo = (k: 'pov' | 'foryou' | 'hook' | 'performance' | 'bts' | 'canvas') => {
    const d = { pov: 15, foryou: 20, hook: 20, performance: 20, bts: 20, canvas: 8 }[k];
    const cap = (text: string, from: number, to: number, style: TextStyle, size: number, y: number): Cap => ({
      id: newId(),
      text,
      start: from,
      end: Math.min(d, to),
      style,
      size,
      y,
    });
    setFormat('9:16');
    setDuration(d);
    setFit('crop');
    setLook(({ pov: 'faded', foryou: 'film', hook: 'tungsten', performance: 'none', bts: 'tungsten', canvas: 'none' } as const)[k]);
    setPace(more.length ? ({ performance: 'off', canvas: 'steady' } as Record<string, Pace>)[k] || 'smart' : 'off');
    if (k === 'pov') setCaps([cap('pov: you just got home and this comes on', 0, d, 'sub', 40, 22)]);
    else if (k === 'foryou') {
      const lines = lyrics.trim() ? lyricLines.slice(0, 5) : ['you still text them first', 'you play it at 2am', 'you already know'];
      const each = (d - 2) / lines.length;
      setCaps([
        cap('this song is for you if...', 0, d, 'sub', 40, 22),
        ...lines.map((l, i) => cap(l.toLowerCase(), 2 + i * each, 2 + (i + 1) * each, 'build', 52, 50)),
      ]);
    } else if (k === 'hook') setCaps([cap('i wrote this song about...', 0, 3, 'serif', 60, 50)]);
    else if (k === 'bts') setCaps([cap('in the studio', 0, d, 'sub', 34, 15)]);
    else setCaps([]);
    setMsg(
      {
        pov: 'POV: change the line to your own. Start the song on its hook.',
        foryou: '"For you if": paste 3-5 short lines as the lyrics, then press the preset again.',
        hook: 'Story hook: the line, then the chorus drops. Start the song just before the chorus.',
        performance: 'Performance: one raw take, no cuts. Pick the best 20 seconds.',
        bts: 'BTS: add session clips under Beat cuts for quick cuts between them.',
        canvas: 'Canvas: an 8 second loop for Spotify. Pick a part that loops cleanly.',
      }[k],
    );
  };
  const template = (k: 'lyric' | 'stretch' | 'brat' | 'card' | 'stacked') => {
    setFormat('9:16');
    if (k === 'lyric') {
      setFit('crop');
      setLook('cold');
      setCapStyle('grid');
      setMsg('Lyric video: paste the lyrics (one line each) and press "Spread over clip".');
    } else if (k === 'stretch') {
      setFit('duo');
      setLook('lux');
    } else if (k === 'brat') {
      setFit('crop');
      setLook('none');
      setCaps([{ id: newId(), text: 'out now', start: 0, end: Math.min(2, duration), style: 'brat', size: 60, y: 50 }]);
    } else if (k === 'card') {
      setFit('crop');
      setLook('tungsten');
      setCaps([{ id: newId(), text: 'hella funds', start: 0, end: Math.min(2, duration), style: 'soft', size: 60, y: 50 }]);
    } else {
      setFit('crop');
      setLook('bw');
      setCaps([{ id: newId(), text: 'PAIN PAIN PAIN', start: 0, end: Math.min(3, duration), style: 'stacked', size: 60, y: 50 }]);
    }
  };

  const loadJobs = () => api('/api/video').then(setJobs, () => {});
  useEffect(() => {
    loadJobs();
    if (!jobs.some((j) => j.status === 'Waiting' || j.status === 'Rendering')) return;
    const i = setInterval(loadJobs, 2000);
    return () => clearInterval(i);
  }, [jobs.map((j) => j.status + j.pct).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // The captions as a run of full-size transparent pictures, one for each stretch where what's on screen doesn't
  // change (a new word, a new line), drawn exactly like the preview: the server lays them over the video
  const captionPngs = (list: Cap[]) => {
    const live = list.filter((c) => c.text.trim() && c.end > c.start);
    const cuts = [...new Set([0, duration, ...live.flatMap((c) => [c.start, c.end, ...wordTimes(c)])])]
      .filter((x) => x >= 0 && x <= duration)
      .sort((a, b) => a - b);
    const pngs: { start: number; end: number; png: string }[] = [];
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      if (b - a < 0.01) continue;
      const on = live.filter((c) => c.start <= a && c.end > a);
      if (!on.length) continue;
      g.clearRect(0, 0, W, H);
      for (const c of on) drawText(g, asItem(c, a + 0.001), W, H);
      const png = cv.toDataURL('image/png');
      const prev = pngs[pngs.length - 1];
      if (prev && prev.png === png && Math.abs(prev.end - a) < 0.001) prev.end = b;
      else pngs.push({ start: a, end: b, png });
    }
    if (pngs.length > 600) throw new Error('Too many caption changes for one video (600 at most): shorten it or use fewer words.');
    return pngs;
  };
  const renderOne = (o: {
    fit: Fit;
    look: Look;
    caps: Cap[];
    pieces: Piece[];
    name: string;
    out: { space: string; dir: string; folder?: string };
    batch?: string;
  }) =>
    api('/api/video/render', {
      method: 'POST',
      body: JSON.stringify({
        clip,
        song,
        songAt,
        start,
        duration,
        format,
        fit: o.fit,
        look: o.look,
        captions: captionPngs(o.caps),
        segments: o.pieces.length > 1 ? o.pieces.map((p) => ({ clip: p.ref, from: p.from, len: p.len })) : undefined,
        out: o.out,
        name: o.name,
        batch: o.batch,
      }),
    });
  const render = async () => {
    if (!clip) return;
    setMsg('Preparing captions...');
    try {
      await renderOne({ fit, look, caps, pieces, name, out: { space: clip.space, dir: clip.path.split('/').slice(0, -1).join('/') } });
      setMsg('Rendering on the server. You get a notification when it is ready (it goes next to the clip).');
      loadJobs();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // ── Batch: many versions at once (clip order, pace, look and lyric template varied), then a wall of them to keep
  // or drop. Inside a project they render into its Edits folder, and keepers become Edited footage on it, each
  // with a post day (one a day from the next free day), so they line up on the Board's calendar.
  const [batchN, setBatchN] = useState(6);
  const [vary, setVary] = useState<{ paces: Pace[]; looks: Look[]; templates: string[] }>({ paces: [], looks: [], templates: [] });
  const [batch, setBatch] = useState<null | { id: string; project: ProjectHome | null }>(null);
  const [decided, setDecided] = useState<Record<string, string>>({}); // job id -> 'kept · Tue' / 'dropped'
  const toggle = <K extends keyof typeof vary>(k: K, v: (typeof vary)[K][number]) =>
    setVary({ ...vary, [k]: (vary[k] as string[]).includes(v) ? (vary[k] as string[]).filter((x) => x !== v) : [...vary[k], v] });
  const renderBatch = async () => {
    if (!clip) return;
    setMsg('Setting up the batch...');
    try {
      const home = await projectOf(clip);
      const id = Math.random().toString(36).slice(2, 10);
      const out = home
        ? { space: home.folder.space, dir: home.folder.path, folder: `Edits/Batch ${name}` }
        : { space: clip.space, dir: clip.path.split('/').slice(0, -1).join('/'), folder: `Batch ${name}` };
      let seed = Date.now() % 2147483647;
      const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
      const pick = <T,>(xs: T[], fallback: T) => (xs.length ? xs[Math.floor(rnd() * xs.length)] : fallback);
      for (let v = 0; v < batchN; v++) {
        const order = clips.map((_, i) => i).sort(() => rnd() - 0.5);
        const tp = LYRIC_TEMPLATES.find((x) => x.label === pick(vary.templates, ''));
        const vPace = more.length ? pick(vary.paces, pace) : 'off';
        const vCaps = tp ? caps.map((c) => ({ ...c, style: tp.style, size: tp.size, y: tp.y })) : caps;
        setMsg(`Sending version ${v + 1} of ${batchN}...`);
        await renderOne({
          fit: tp?.fit ?? fit,
          look: pick(vary.looks, tp?.look ?? look),
          caps: vCaps,
          pieces: beatPieces(clips, song ? grid : null, songAt, duration, vPace, order),
          name: `${name} v${String(v + 1).padStart(2, '0')}`,
          out,
          batch: id,
        });
      }
      setBatch({ id, project: home });
      setDecided({});
      setMsg(`${batchN} versions rendering on the server. They show up below as they finish: keep or drop each one.`);
      loadJobs();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const decide = async (j: { id: string; space: string; path: string; name: string }, keepIt: boolean) => {
    try {
      if (!keepIt) {
        await api(fileUrl(j.space, j.path.split('/')), { method: 'DELETE' });
        return setDecided({ ...decided, [j.id]: 'dropped' });
      }
      const home = batch?.project;
      if (!home) return setDecided({ ...decided, [j.id]: 'kept' });
      const now: { releases: ProjectHome[]; tracks: { id: string; release: string; content?: ContentItem[] }[] } = await api('/api/tracks');
      const songs = now.tracks.filter((x) => x.release === home.id);
      const owner = songs.length === 1 ? songs[0] : now.releases.find((r) => r.id === home.id);
      const content = owner?.content || [];
      // its post day: the day after the last footage already lined up (or tomorrow)
      const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA');
      const last = content.filter((c) => c.due && c.status !== 'Posted').reduce((m, c) => (c.due! > m ? c.due! : m), '');
      const day = last >= tomorrow ? new Date(Date.parse(`${last}T12:00:00`) + 864e5).toLocaleDateString('en-CA') : tomorrow;
      const file = { space: j.space, path: j.path };
      const item: ContentItem = {
        id: Math.random().toString(36).slice(2, 10),
        kind: 'Video',
        title: j.name.replace(/\.mp4$/, ''),
        status: 'Edited',
        file,
        edit: file,
        due: day,
      };
      await api(songs.length === 1 ? `/api/tracks/track/${songs[0].id}` : `/api/tracks/release/${home.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: [...content, item] }),
      });
      setDecided({
        ...decided,
        [j.id]: `kept · posts ${new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}`,
      });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const projectOf = async (c: FileRef): Promise<ProjectHome | null> => {
    const r: { releases: ProjectHome[] } = await api('/api/tracks');
    return r.releases.find((x) => x.folder && x.folder.space === c.space && c.path.startsWith(x.folder.path + '/')) || null;
  };

  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0));
  const scale = Math.min(360 / W, 520 / H);
  return (
    <div
      style={shell}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!clip || ['TEXTAREA', 'INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
        const step = e.shiftKey ? 1 : 1 / 30; // a frame, or a second with Shift
        const now = video.current ? video.current.currentTime - start : t; // t is rounded for the readout
        if (tap && (e.key === 't' || e.key === 'T' || e.key === 'Enter')) tapNow();
        else if (e.key === ' ') play();
        else if (e.key === 'ArrowLeft') seek(Math.max(0, now - step));
        else if (e.key === 'ArrowRight') seek(Math.min(duration, now + step));
        else return;
        e.preventDefault(); // and a focused button doesn't also get the space
      }}
    >
      <div style={{ ...toolbar, flexWrap: 'wrap' }}>
        <button style={{ ...button, fontWeight: 700 }} onClick={() => setPicking('clip')}>
          {clip ? 'Change clip...' : 'Pick a clip...'}
        </button>
        <button style={button} onClick={() => setPicking('song')}>
          {song ? `♪ ${song.path.split('/').pop()}` : 'Add a song...'}
        </button>
        {song && (
          <button style={button} onClick={() => setSong(null)} title="Use the clip's own sound">
            ×
          </button>
        )}
        <span style={{ marginLeft: 6 }}>Templates:</span>
        {(
          [
            ['lyric', 'Lyric video'],
            ['stretch', 'Stretch edit'],
            ['brat', 'brat promo'],
            ['card', 'Black card intro'],
            ['stacked', 'Big words'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} style={button} onClick={() => template(k)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ ...toolbar, flexWrap: 'wrap' }}>
        <span>Promo presets:</span>
        {(
          [
            ['pov', 'POV text'],
            ['foryou', 'For you if...'],
            ['hook', 'Story hook'],
            ['performance', 'Performance'],
            ['bts', 'BTS'],
            ['canvas', 'Canvas 8s'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} style={button} onClick={() => promo(k)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ ...toolbar, flexWrap: 'wrap' }}>
        <span>Lyric templates:</span>
        {LYRIC_TEMPLATES.map((tp) => (
          <button
            key={tp.label}
            style={{ ...button, fontWeight: capStyle === tp.style && fit === tp.fit && look === tp.look ? 700 : 400 }}
            onClick={() => lyricTemplate(tp)}
          >
            {tp.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: 6, overflow: 'auto', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <div style={{ position: 'relative', width: W * scale, height: H * scale, background: '#000', border: '2px inset #808080' }}>
            <canvas
              ref={frameCv}
              width={W}
              height={H}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                filter:
                  // the look first, then flipped back like every other picture in the dark (inverted) theme
                  LOOKS.find((l) => l[0] === look)![2] +
                  (document.documentElement.dataset.theme === 'dark' ? ' invert(1) hue-rotate(180deg)' : ''),
              }}
            />
            <canvas ref={capCv} width={W} height={H} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            {!clip && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  color: '#aaa',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 12,
                  textAlign: 'center',
                }}
              >
                Pick a clip from your team folders to start.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', width: W * scale }}>
            <button style={button} disabled={!clip} onClick={play}>
              {playing ? '❚❚' : '▶'}
            </button>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.05}
              value={Math.min(t, duration)}
              onChange={(e) => seek(+e.target.value)}
              style={{ flex: 1 }}
            />
            <span style={{ fontFamily: 'monospace' }}>{t.toFixed(1)}s</span>
          </div>
          {clip && token !== null && (
            <video
              ref={video}
              src={src(clip) + (proxy ? '&preview' : '')}
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              onError={() => {
                if (proxy) return setMsg("This clip can't be previewed here (the render may still work).");
                setProxy(true);
                setMsg('This clip does not play in the browser: making a preview copy (the render uses the original)...');
              }}
              onLoadedMetadata={(e) => {
                if (proxy) setMsg('');
                setClipLength(e.currentTarget.duration || 0);
                e.currentTarget.currentTime = start;
              }}
              style={{ display: 'none' }}
            />
          )}
          {song && token !== null && <audio ref={audio} src={src(song)} preload="auto" />}
          {/* beat cuts: a player per clip (the main clip too), kept at the right point by the preview */}
          {multi &&
            token !== null &&
            clips.map((c) => (
              <video
                key={keyOf(c.ref)}
                ref={(el) => {
                  vids.current[keyOf(c.ref)] = el;
                }}
                src={src(c.ref)}
                muted
                playsInline
                preload="auto"
                crossOrigin="anonymous"
                style={{ display: 'none' }}
              />
            ))}
          {token !== null &&
            more.map((c) => (
              <video
                key={'len' + keyOf(c.ref)}
                src={src(c.ref)}
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration || 0;
                  setLengths((l) => ({ ...l, [keyOf(c.ref)]: d }));
                }}
                style={{ display: 'none' }}
              />
            ))}
        </div>

        <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <fieldset style={fs}>
            <legend>Shape</legend>
            <div style={rowS}>
              {(Object.keys(SIZES) as Format[]).map((f) => (
                <button key={f} style={{ ...button, fontWeight: format === f ? 700 : 400 }} onClick={() => setFormat(f)}>
                  {f}
                </button>
              ))}
            </div>
            <div style={rowS}>
              {FITS.map(([f, label]) => (
                <button key={f} style={{ ...button, fontWeight: fit === f ? 700 : 400 }} onClick={() => setFit(f)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset style={fs}>
            <legend>Look</legend>
            <div style={rowS}>
              {LOOKS.map(([l, label]) => (
                <button key={l} style={{ ...button, fontWeight: look === l ? 700 : 400 }} onClick={() => setLook(l)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset style={fs}>
            <legend>Time</legend>
            <label style={rowS}>
              Clip from
              <input
                type="number"
                style={inp}
                min={0}
                max={clipLength || 36000}
                step={0.5}
                value={start}
                onChange={(e) => setStart(num(e.target.value, 0, clipLength || 36000))}
              />
              s, length
              <input
                type="number"
                style={inp}
                min={1}
                max={180}
                step={0.5}
                value={duration}
                onChange={(e) => setDuration(num(e.target.value, 1, 180))}
              />
              s {clipLength ? `(clip is ${clipLength.toFixed(1)}s)` : ''}
            </label>
            {song && (
              <label style={rowS}>
                Song from
                <input
                  type="number"
                  style={inp}
                  min={0}
                  step={0.5}
                  value={songAt}
                  onChange={(e) => setSongAt(num(e.target.value, 0, 36000))}
                />
                s (the song replaces the clip's sound)
              </label>
            )}
            {song && songPeaks && (
              <canvas
                ref={songCv}
                width={600}
                height={40}
                title="Click where the song should start"
                style={{ width: '100%', height: 40, border: '2px inset #808080', cursor: 'pointer' }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const at = Math.round(((e.clientX - r.left) / r.width) * songLength * 10) / 10;
                  setSongAt(at);
                  if (audio.current) audio.current.currentTime = at + t;
                }}
              />
            )}
          </fieldset>
          <fieldset style={fs}>
            <legend>Beat cuts</legend>
            <div style={rowS}>
              Cut between this clip and
              {more.map((c, i) => (
                <span key={keyOf(c.ref)} style={{ ...rowS, border: '1px solid #808080', padding: '0 3px' }}>
                  {c.ref.path.split('/').pop()} from
                  <input
                    type="number"
                    style={{ ...inp, width: 44 }}
                    min={0}
                    step={0.5}
                    value={c.from}
                    onChange={(e) => setMore(more.map((x, k) => (k === i ? { ...x, from: num(e.target.value, 0, 36000) } : x)))}
                  />
                  s
                  <button style={button} onClick={() => setMore(more.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </span>
              ))}
              <button style={button} disabled={!clip || more.length >= 11} onClick={() => setPicking('more')}>
                + Clip...
              </button>
            </div>
            <div style={rowS}>
              {PACES.map(([p, label]) => (
                <button
                  key={p}
                  style={{ ...button, fontWeight: pace === p ? 700 : 400 }}
                  disabled={!more.length && p !== 'off'}
                  onClick={() => setPace(p)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              {!song
                ? 'Add a song: the cuts land on its beat.'
                : !grid
                  ? songPeaks
                    ? 'No steady beat found in this song, so there is nothing to cut on.'
                    : 'Finding the beat...'
                  : `${grid.bpm} BPM${multi ? ` · ${pieces.length} cuts across ${clips.length} clips` : ''}`}
            </div>
          </fieldset>
          <fieldset style={fs}>
            <legend>Captions</legend>
            <textarea
              rows={3}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="Paste lyrics or lines here, one per line"
              style={{ ...inp, width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={rowS}>
              Style
              <select style={inp} value={capStyle} onChange={(e) => setCapStyle(e.target.value as TextStyle)}>
                {TEXT_STYLES.map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
              </select>
              <button style={button} disabled={!lyrics.trim()} onClick={spread}>
                Spread over clip
              </button>
              {tap ? (
                <>
                  <button style={{ ...button, fontWeight: 700, minWidth: 140 }} onClick={tapNow} title="T or Enter">
                    TAP: {tapUnits[tap.times.length]}
                  </button>
                  <span>
                    {tap.times.length}/{tapUnits.length}
                  </span>
                  <button style={button} onClick={() => finishTap(tap.times)}>
                    Stop
                  </button>
                </>
              ) : (
                <button
                  style={button}
                  disabled={(!song && !clip) || hearing}
                  onClick={autoTime}
                  title="The server listens to the song (or the clip itself when there is no song) and times every word. Paste the lyrics first for your spelling, or leave them empty to write down what it hears"
                >
                  {hearing ? 'Listening...' : 'Auto timing'}
                </button>
              )}
              {!tap && (
                <button
                  style={button}
                  disabled={!clip || !lyrics.trim()}
                  onClick={startTap}
                  title="Play the edit and tap along to time the lyrics"
                >
                  Tap timing
                </button>
              )}
              <button
                style={button}
                onClick={() =>
                  setCaps([
                    ...caps,
                    {
                      id: newId(),
                      text: 'text',
                      start: Math.round(t * 10) / 10,
                      end: Math.min(duration, Math.round(t * 10) / 10 + 2),
                      style: capStyle,
                      size: 60,
                      y: 50,
                    },
                  ])
                }
              >
                + Caption at {t.toFixed(1)}s
              </button>
            </div>
            <div style={{ maxHeight: 180, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {caps.map((c) => (
                <div key={c.id} style={{ ...rowS, background: t >= c.start && t < c.end ? '#ffffe1' : undefined }}>
                  <input style={{ ...inp, flex: 1, minWidth: 90 }} value={c.text} onChange={(e) => setCap(c.id, 'text', e.target.value)} />
                  <input
                    type="number"
                    style={{ ...inp, width: 52 }}
                    step={0.1}
                    value={c.start}
                    onChange={(e) => setCap(c.id, 'start', num(e.target.value, 0, duration))}
                  />
                  –
                  <input
                    type="number"
                    style={{ ...inp, width: 52 }}
                    step={0.1}
                    value={c.end}
                    onChange={(e) => setCap(c.id, 'end', num(e.target.value, 0, duration))}
                  />
                  <select style={inp} value={c.style} onChange={(e) => setCap(c.id, 'style', e.target.value)}>
                    {TEXT_STYLES.map(([s, label]) => (
                      <option key={s} value={s}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="range"
                    min={20}
                    max={200}
                    value={c.size}
                    title="Size"
                    onChange={(e) => setCap(c.id, 'size', +e.target.value)}
                    style={{ width: 60 }}
                  />
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={c.y}
                    title="Height"
                    onChange={(e) => setCap(c.id, 'y', +e.target.value)}
                    style={{ width: 60 }}
                  />
                  <button style={button} onClick={() => setCaps(caps.filter((x) => x.id !== c.id))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset style={fs}>
            <legend>Render</legend>
            <div style={rowS}>
              Name
              <input style={{ ...inp, flex: 1 }} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
              .mp4
              <button style={{ ...button, fontWeight: 700 }} disabled={!clip} onClick={render}>
                Render MP4
              </button>
            </div>
            {jobs
              .filter((j) => !j.batch)
              .map((j) => (
                <div key={j.id}>
                  {j.name}: {j.status === 'Rendering' ? `${j.pct}%` : j.status}
                  {j.error && <span style={{ color: '#a00000' }}> {j.error}</span>}
                </div>
              ))}
          </fieldset>
          <fieldset style={fs}>
            <legend>Batch</legend>
            <div style={rowS}>
              Make
              <select style={inp} value={batchN} onChange={(e) => setBatchN(+e.target.value)}>
                {[3, 6, 12, 24].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              versions, mixing the clip order and:
            </div>
            {more.length > 0 && (
              <div style={rowS}>
                Pace:
                {PACES.filter(([p]) => p !== 'off').map(([p, label]) => (
                  <label key={p} style={rowS}>
                    <input type="checkbox" checked={vary.paces.includes(p)} onChange={() => toggle('paces', p)} />
                    {label.split(' ')[0]}
                  </label>
                ))}
              </div>
            )}
            <div style={rowS}>
              Look:
              {LOOKS.filter(([l]) => l !== 'none').map(([l, label]) => (
                <label key={l} style={rowS}>
                  <input type="checkbox" checked={vary.looks.includes(l)} onChange={() => toggle('looks', l)} />
                  {label}
                </label>
              ))}
            </div>
            {caps.length > 0 && (
              <div style={rowS}>
                Lyrics:
                {LYRIC_TEMPLATES.map((tp) => (
                  <label key={tp.label} style={rowS}>
                    <input type="checkbox" checked={vary.templates.includes(tp.label)} onChange={() => toggle('templates', tp.label)} />
                    {tp.label}
                  </label>
                ))}
              </div>
            )}
            <div style={rowS}>
              <button style={{ ...button, fontWeight: 700 }} disabled={!clip} onClick={renderBatch}>
                Render batch
              </button>
              <span style={{ color: '#555' }}>Inside a project they go to its Edits folder.</span>
            </div>
            {batch && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {jobs
                  .filter((j) => j.batch === batch.id)
                  .reverse()
                  .map((j) => (
                    <div
                      key={j.id}
                      style={{
                        width: 110,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        opacity: decided[j.id] === 'dropped' ? 0.35 : 1,
                      }}
                    >
                      {j.status === 'Done' && decided[j.id] !== 'dropped' ? (
                        <video
                          src={`${fileUrl(j.space, j.path.split('/'))}?t=${token ?? ''}`}
                          muted
                          loop
                          autoPlay
                          playsInline
                          style={{ width: 110, aspectRatio: `${W} / ${H}`, background: '#000', border: '2px inset #808080' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 110,
                            aspectRatio: `${W} / ${H}`,
                            background: '#000',
                            color: '#aaa',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                          }}
                        >
                          {decided[j.id] === 'dropped' ? 'Dropped' : j.status === 'Rendering' ? `${j.pct}%` : j.status}
                        </div>
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {j.name.replace(/\.mp4$/, '')}
                      </span>
                      {j.status === 'Done' &&
                        (decided[j.id] ? (
                          <b>{decided[j.id] === 'dropped' ? '' : decided[j.id]}</b>
                        ) : (
                          <div style={rowS}>
                            <button
                              style={{ ...button, fontWeight: 700 }}
                              onClick={() => decide(j, true)}
                              title={batch.project ? `Becomes Edited footage on ${batch.project.title}, with a post day` : 'Keep it'}
                            >
                              Keep
                            </button>
                            <button style={button} onClick={() => decide(j, false)}>
                              Drop
                            </button>
                          </div>
                        ))}
                    </div>
                  ))}
              </div>
            )}
          </fieldset>
        </div>
      </div>
      <div style={statusBar}>
        {msg || 'The preview is close to the final look; captions are exact. Space play/pause · ←/→ a frame (Shift: 1 s)'}
      </div>
      {picking && (
        <FilePicker
          title={picking === 'song' ? 'Pick a song' : 'Pick a video clip'}
          mode="file"
          accept={(n) => (picking === 'song' ? AUDIO : VIDEO).test(n)}
          onPick={(r) => {
            setPicking(null);
            if (!r) return;
            if (picking === 'clip') {
              setClip(r);
              setStart(0);
              setProxy(false);
              setPlaying(false); // the new clip loads paused
            } else if (picking === 'more') {
              if (keyOf(r) !== keyOf(clip!) && !more.some((c) => keyOf(c.ref) === keyOf(r))) setMore([...more, { ref: r, from: 0 }]);
              if (pace === 'off') setPace('smart');
            } else setSong(r);
          }}
        />
      )}
    </div>
  );
};

const fs: React.CSSProperties = {
  border: '2px groove #fff',
  margin: 0,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const rowS: React.CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' };
const inp: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
  width: 60,
};

export default VideoEditor;
