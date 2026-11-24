import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi } from '../utils/api';
import { drawText, TEXT_STYLES, TextOverlayItem, TextStyle, WORD_STYLES } from '../utils/captions';
import FilePicker, { FileRef } from '../components/FilePicker';
import { sharedAudio } from '../utils/sound';
import { waveformPeaks } from '../utils/audioAnalysis';
import { lightAudio } from './fileTypes';
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
  { label: 'Spread grid', fit: 'crop', look: 'none', style: 'grid', size: 44, y: 50 },
];
const styleSize = (st: TextStyle) => LYRIC_TEMPLATES.find((x) => x.style === st)?.size ?? (st === 'grid' ? 110 : 60);
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const AUDIO = /\.(wav|aiff?|flac|mp3|m4a|ogg)$/i;
const newId = () => Math.random().toString(36).slice(2, 9);
// When each word shows: the tapped times, or spread evenly over the caption for the word-by-word styles
const wordTimes = (c: Cap) => {
  if (c.words?.length) return c.words;
  if (!WORD_STYLES.includes(c.style)) return [];
  const n = c.text.trim().split(/\s+/).length;
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
  const [picking, setPicking] = useState<null | 'clip' | 'song'>(null);
  const [token, setToken] = useState('');
  const [clipLength, setClipLength] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [proxy, setProxy] = useState(false); // the server's H.264 copy, for clips the browser can't decode (HEVC / ProRes)
  const [jobs, setJobs] = useState<{ id: string; name: string; status: string; pct: number; error: string | null }[]>([]);
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
    return `${fileUrl(r.space, parts)}?t=${token}`;
  };

  useEffect(() => {
    getToken().then((x) => setToken(x || ''));
  }, [getToken, clip, song]);
  // A draft per clip in this browser, so closing the window doesn't lose the captions and settings
  const draftKey = clip && `sk_video_${clip.space}/${clip.path}`;
  useEffect(() => {
    if (!clip) return;
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
      setName(d.name);
    } catch {
      // no draft or storage blocked: start fresh
    }
  }, [clip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      if (draftKey)
        localStorage.setItem(draftKey, JSON.stringify({ song, songAt, start, duration, format, fit, look, caps, lyrics, capStyle, name }));
    } catch {
      // storage full or blocked: the draft just isn't kept
    }
  }, [draftKey, song, songAt, start, duration, format, fit, look, caps, lyrics, capStyle, name]);

  // The song's waveform, to pick where it starts (the light MP3 copy for WAV / AIFF / FLAC)
  useEffect(() => {
    setSongPeaks(null);
    if (!song || !token) return;
    const abort = new AbortController();
    fetch(src(song) + (lightAudio(song.path) ? '&preview' : ''), { signal: abort.signal })
      .then((r) => r.arrayBuffer())
      .then((b) => sharedAudio()!.decodeAudioData(b))
      .then((a) => {
        if (abort.signal.aborted) return;
        setSongPeaks(waveformPeaks(a.getChannelData(0)));
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

  // The live preview: the clip drawn into the frame the way the render will (the look as a CSS filter on this
  // layer), captions on a second layer on top, exactly as they'll be burned in
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const v = video.current;
      const fc = frameCv.current?.getContext('2d');
      const cc = capCv.current?.getContext('2d');
      if (v && fc && cc) {
        const now = Math.max(0, v.currentTime - start);
        if (playing && now >= duration) {
          v.currentTime = start;
          if (audio.current) audio.current.currentTime = songAt;
        }
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
        const a = audio.current;
        if (playing && a && !a.paused && !a.seeking && Math.abs(a.currentTime - songAt - now) > 0.1) a.currentTime = songAt + now;
        cc.clearRect(0, 0, W, H);
        for (const c of caps) if (now >= c.start && now < c.end) drawText(cc, asItem(c, now), W, H);
        if (Math.abs(now - shown.current) > 0.04) setT((shown.current = now)); // the time readout, not every frame
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [W, H, fit, caps, start, duration, playing, songAt]);

  const seek = (s: number) => {
    if (video.current) video.current.currentTime = start + s;
    if (audio.current) audio.current.currentTime = songAt + s;
  };
  const play = () => {
    if (!video.current) return;
    if (playing) {
      video.current.pause();
      audio.current?.pause();
      return setPlaying(false);
    }
    seek(t >= duration ? 0 : t);
    video.current.muted = !!song; // the song replaces the clip's own sound, like the render
    video.current.play().catch(() => {});
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
    .map((l) => l.trim().split(/\s+/).filter(Boolean))
    .filter((l) => l.length)
    .slice(0, 80);
  const tapUnits = tap ? (tap.byWord ? lyricLines.flat() : lyricLines.map((l) => l.join(' '))) : [];
  const startTap = () => {
    const byWord = WORD_STYLES.includes(capStyle);
    setTap({ byWord, times: [] });
    if (playing) play();
    seek(0);
    setTimeout(play, 50);
    setMsg(`Tap on every ${byWord ? 'word' : 'line'} as it's sung: the button, T or Enter.`);
  };
  const finishTap = (times: number[]) => {
    if (!tap) return;
    if (playing) play();
    const y = caps[0]?.y ?? 50;
    const out: Cap[] = [];
    let k = 0;
    lyricLines.forEach((line, i) => {
      const own = tap.byWord ? times.slice(k, k + line.length) : times.slice(i, i + 1);
      k += line.length;
      if (!own.length) return;
      const next = tap.byWord ? times[k] : times[i + 1];
      const end = Math.min(duration, next ?? Infinity, own[own.length - 1] + (tap.byWord ? 2 : 5));
      out.push({
        id: newId(),
        text: line.join(' '),
        start: own[0],
        end: Math.max(end, own[0] + 0.2),
        style: capStyle,
        size: styleSize(capStyle),
        y,
        words: tap.byWord ? own : undefined,
      });
    });
    setCaps(out);
    setTap(null);
    setMsg(`${out.length} lines timed. Play it back; drag a line's times to fix it, or tap again.`);
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

  const render = async () => {
    if (!clip) return;
    setMsg('Preparing captions...');
    // The captions as a run of full-size transparent pictures, one for each stretch where what's on screen
    // doesn't change (a new word, a new line), drawn exactly like the preview: the server lays them over the video
    const live = caps.filter((c) => c.text.trim() && c.end > c.start);
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
    if (pngs.length > 600) return setMsg('Too many caption changes for one video (600 at most): shorten it or use fewer words.');
    const parts = clip.path.split('/');
    try {
      await api('/api/video/render', {
        method: 'POST',
        body: JSON.stringify({
          clip,
          song,
          songAt,
          start,
          duration,
          format,
          fit,
          look,
          captions: pngs,
          out: { space: clip.space, dir: parts.slice(0, -1).join('/') },
          name,
        }),
      });
      setMsg('Rendering on the server. You get a notification when it is ready (it goes next to the clip).');
      loadJobs();
    } catch (e) {
      setMsg((e as Error).message);
    }
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
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter: LOOKS.find((l) => l[0] === look)![2] }}
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
          {clip && token && (
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
          {song && token && <audio ref={audio} src={src(song)} preload="auto" />}
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
            {jobs.map((j) => (
              <div key={j.id}>
                {j.name}: {j.status === 'Rendering' ? `${j.pct}%` : j.status}
                {j.error && <span style={{ color: '#a00000' }}> {j.error}</span>}
              </div>
            ))}
          </fieldset>
        </div>
      </div>
      <div style={statusBar}>
        {msg || 'The preview is close to the final look; captions are exact. Space play/pause · ←/→ a frame (Shift: 1 s)'}
      </div>
      {picking && (
        <FilePicker
          title={picking === 'clip' ? 'Pick a video clip' : 'Pick a song'}
          mode="file"
          accept={(n) => (picking === 'clip' ? VIDEO : AUDIO).test(n)}
          onPick={(r) => {
            setPicking(null);
            if (!r) return;
            if (picking === 'clip') {
              setClip(r);
              setStart(0);
              setProxy(false);
              setPlaying(false); // the new clip loads paused
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
