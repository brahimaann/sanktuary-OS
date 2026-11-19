// Sanktuary media formats: the 1-bit overlay pack for FIELD OP, DEBRIEF, STATION REPORT and DECLASSIFIED.
// A raea composition file (github.com/shinyobjectz/raea). Every piece is a transparent overlay that sits on
// full-colour footage: small, in a corner or along the bottom (never more than about 15% of the frame, never over a
// face), in white, ink and the signal green, with stepped motion only (no easing, no glow).
//
// Pieces (composition ids):
//   field-op, debrief, station-report, declassified   the opening tag, 16:9, 4.5 s
//   lower-third, lower-third-vertical                    a name and what they do, 5 s
//   case-bug, case-bug-vertical                          the corner tag with a blinking lamp, 2 s, loops
//
// With raea (on the home PC or a Mac):
//   raea render ops/formats/formats.tsx --composition field-op --alpha -o FO-001.mov
//   raea export capcut ops/formats/formats.tsx --composition field-op      (straight into a CapCut draft)
// Change the words in defaultProps at the bottom (code, title, place, date, names).
// Without raea, ops/formats/render.mjs draws the same frames in Chromium: node ops/formats/render.mjs --help
import React from 'react';
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from 'raea';
import { loadFont } from 'raea/text';

const FPS = 30;
const GREEN = '#4b9560',
  WHITE = '#fff',
  INK = '#000';
const label = loadFont('Silkscreen').fontFamily; // small caps labels
const type = loadFont('Pixelify Sans').fontFamily; // titles

type Format = 'field-op' | 'debrief' | 'station-report' | 'declassified';
const NAMES: Record<Format, [name: string, prefix: string]> = {
  'field-op': ['FIELD OP', 'FO'],
  debrief: ['DEBRIEF', 'DB'],
  'station-report': ['STATION REPORT', 'SR'],
  declassified: ['DECLASSIFIED', 'DC'],
};

/** Typewriter: the first n characters at frame f, one a frame from `from`. */
const typed = (s: string, f: number, from: number) => s.slice(0, Math.max(0, f - from));
/** Steps from 0 to 1 over [a, b] in `n` hard steps. */
const steps = (f: number, a: number, b: number, n: number) => Math.min(1, Math.max(0, Math.floor(((f - a) / (b - a)) * n) / n));
/** Blinks out at the end like a cursor: on, off, on, off. */
const blinkOut = (f: number, end: number) => (f < end - 12 ? true : Math.floor((f - (end - 12)) / 3) % 2 === 1);
const tc = (f: number) => {
  const s = Math.floor(f / FPS);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f % FPS).padStart(2, '0')}`;
};

const Lamp: React.FC<{ on: boolean; size?: number }> = ({ on, size = 14 }) => (
  <span
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      background: on ? GREEN : 'transparent',
      border: `2px solid ${on ? GREEN : WHITE}`,
      boxSizing: 'border-box',
    }}
  />
);

// ── The opening tag ─────────────────────────────────────────────────────────────────────────────
interface OpenProps {
  format: Format;
  code: string; // the case number, e.g. FO-001
  title: string; // the song or subject
  place: string; // station or site
  date: string;
  coords?: string; // STATION REPORT only
}
const OPEN = 135;

const Open: React.FC<OpenProps> = ({ format, code, title, place, date, coords }) => {
  const f = useCurrentFrame();
  if (!blinkOut(f, OPEN)) return null;
  const [name] = NAMES[format];
  const head = `${name}  ${code}`;
  const meta = [place, format === 'station-report' && coords ? coords : '', date].filter(Boolean).join('  ·  ').toUpperCase();
  const grow = steps(f, 0, 6, 4); // the box draws in, four steps wide
  const unredact = steps(f, 36, 48, 6); // the bar over the title comes off in six chunks
  // As wide as the longest line (Silkscreen ~ 0.8 em a letter at 22 px with spacing, Pixelify ~ 0.62 em at 56 px)
  const W = Math.min(1200, Math.max(520, 72 + Math.max(head.length * 20, title.length * 36, meta.length * 17)));
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 72,
          bottom: 72,
          width: W,
          height: 156,
          background: INK,
          border: `3px solid ${WHITE}`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          color: WHITE,
          clipPath: `inset(0 ${(1 - grow) * 100}% 0 0)`,
        }}
      >
        {/* FIELD OP: crosshair corners */}
        {format === 'field-op' &&
          [
            [6, 6],
            [W - 26, 6],
            [6, 130],
            [W - 26, 130],
          ].map(([x, y], i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: 14,
                height: 14,
                borderLeft: i % 2 ? 'none' : `2px solid ${GREEN}`,
                borderRight: i % 2 ? `2px solid ${GREEN}` : 'none',
                borderTop: i < 2 ? `2px solid ${GREEN}` : 'none',
                borderBottom: i < 2 ? 'none' : `2px solid ${GREEN}`,
              }}
            />
          ))}
        <div
          style={{
            position: 'absolute',
            left: 28,
            top: 18,
            right: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: label,
            fontSize: 22,
            letterSpacing: 2,
          }}
        >
          <Lamp on={Math.floor(f / 8) % 2 === 0 || f > 60} />
          <span>{typed(head, f, 6)}</span>
          {format === 'debrief' && f > 20 && <span style={{ marginLeft: 'auto', color: GREEN }}>REC {tc(f - 20)}</span>}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 28,
            top: 52,
            fontFamily: type,
            fontSize: 56,
            lineHeight: '64px',
            fontVariantLigatures: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {f >= 24 && title.toUpperCase()}
          {f >= 24 && unredact < 1 && (
            <span style={{ position: 'absolute', top: 6, bottom: 6, left: `${unredact * 100}%`, right: 0, background: WHITE }} />
          )}
        </div>
        <div style={{ position: 'absolute', left: 28, bottom: 14, fontFamily: label, fontSize: 18, letterSpacing: 2 }}>
          {typed(meta, f, 50)}
          {f >= 50 && f < 50 + meta.length + 20 && Math.floor(f / 6) % 2 === 0 && <span style={{ background: WHITE }}>&nbsp;</span>}
        </div>
      </div>
      {/* DECLASSIFIED: the stamp lands beside the tag */}
      {format === 'declassified' && f >= 64 && (
        <div
          style={{
            position: 'absolute',
            left: 72 + W + 24,
            bottom: 96,
            padding: '8px 16px',
            border: `5px solid ${GREEN}`,
            color: GREEN,
            background: INK,
            fontFamily: label,
            fontSize: 30,
            letterSpacing: 3,
            transform: `rotate(-4deg) scale(${f < 66 ? 1.4 : 1})`,
          }}
        >
          DECLASSIFIED
        </div>
      )}
    </AbsoluteFill>
  );
};

// ── Lower third: who's talking ──────────────────────────────────────────────────────────────────
interface LowerProps {
  name: string;
  role: string;
  vertical?: boolean;
}
const LOWER = 150;
const Lower: React.FC<LowerProps> = ({ name, role, vertical }) => {
  const f = useCurrentFrame();
  if (!blinkOut(f, LOWER)) return null;
  const grow = steps(f, 0, 6, 3);
  return (
    <AbsoluteFill>
      {/* Vertical: above the bottom third, clear of the app's captions and buttons */}
      <div
        style={{
          position: 'absolute',
          left: vertical ? 60 : 72,
          ...(vertical ? { top: 1180 } : { bottom: 72 }),
          width: Math.max(360, 90 + Math.max(name.length * 26, role.length * 17)),
          clipPath: `inset(0 ${(1 - grow) * 100}% 0 0)`,
          overflow: 'hidden',
          height: 104,
          background: INK,
          border: `3px solid ${WHITE}`,
          boxSizing: 'border-box',
          color: WHITE,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 22,
            top: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: type,
            fontSize: 40,
            fontVariantLigatures: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <Lamp on size={16} />
          {typed(name.toUpperCase(), f, 6)}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 50,
            bottom: 12,
            fontFamily: label,
            fontSize: 18,
            letterSpacing: 2,
            color: GREEN,
            whiteSpace: 'nowrap',
          }}
        >
          {typed(role.toUpperCase(), f, 10 + name.length)}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Case bug: the corner tag, loops ─────────────────────────────────────────────────────────────
interface BugProps {
  code: string;
  vertical?: boolean;
}
const Bug: React.FC<BugProps> = ({ code, vertical }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          right: vertical ? 48 : 64,
          top: vertical ? 220 : 56,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          background: INK,
          border: `2px solid ${WHITE}`,
          color: WHITE,
          fontFamily: label,
          fontSize: 20,
          letterSpacing: 2,
        }}
      >
        <Lamp on={f < 30} size={12} />
        {code}
      </div>
    </AbsoluteFill>
  );
};

// ── Defaults: change these per shoot ────────────────────────────────────────────────────────────
const open = (format: Format, extra: Partial<OpenProps> = {}): OpenProps => ({
  format,
  code: `${NAMES[format][1]}-001`,
  title: 'Keep Going',
  place: 'Twin Cities station',
  date: '11.19.26',
  ...extra,
});
const HD = { width: 1920, height: 1080, fps: FPS };
const TALL = { width: 1080, height: 1920, fps: FPS };

export const Root: React.FC = () => (
  <>
    <Composition id="field-op" component={Open} {...HD} durationInFrames={OPEN} defaultProps={open('field-op')} />
    <Composition
      id="debrief"
      component={Open}
      {...HD}
      durationInFrames={OPEN}
      defaultProps={open('debrief', { title: 'Kaiya on Keep Going' })}
    />
    <Composition
      id="station-report"
      component={Open}
      {...HD}
      durationInFrames={OPEN}
      defaultProps={open('station-report', { title: 'Cedar-Riverside', coords: '44.97N 93.25W' })}
    />
    <Composition id="declassified" component={Open} {...HD} durationInFrames={OPEN} defaultProps={open('declassified')} />
    <Composition
      id="lower-third"
      component={Lower}
      {...HD}
      durationInFrames={LOWER}
      defaultProps={{ name: 'Kaiya', role: 'Vocals · Keep Going' }}
    />
    <Composition
      id="lower-third-vertical"
      component={Lower}
      {...TALL}
      durationInFrames={LOWER}
      defaultProps={{ name: 'Kaiya', role: 'Vocals · Keep Going', vertical: true }}
    />
    <Composition id="case-bug" component={Bug} {...HD} durationInFrames={60} defaultProps={{ code: 'FO-001' }} />
    <Composition id="case-bug-vertical" component={Bug} {...TALL} durationInFrames={60} defaultProps={{ code: 'FO-001', vertical: true }} />
  </>
);

registerRoot(Root);
