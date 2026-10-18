import React from 'react';

// 7-segment display logic: 7 segments labeled a (top), b (top-right), c (bottom-right),
// d (bottom), e (bottom-left), f (top-left), g (middle), plus dp (decimal point).
// 1 = lit, 0 = unlit.
const SEGMENTS: Record<string, number[]> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
  '-': [0, 0, 0, 0, 0, 0, 1],
  A: [1, 1, 1, 0, 1, 1, 1],
  b: [0, 0, 1, 1, 1, 1, 1],
  C: [1, 0, 0, 1, 1, 1, 0],
  c: [0, 0, 0, 1, 1, 0, 1],
  d: [0, 1, 1, 1, 1, 0, 1],
  E: [1, 0, 0, 1, 1, 1, 1],
  F: [1, 0, 0, 0, 1, 1, 1],
  H: [0, 1, 1, 0, 1, 1, 1],
  h: [0, 0, 1, 0, 1, 1, 1],
  L: [0, 0, 0, 1, 1, 1, 0],
  o: [0, 0, 1, 1, 1, 0, 1],
  P: [1, 1, 0, 0, 1, 1, 1],
  r: [0, 0, 0, 0, 1, 0, 1],
  u: [0, 0, 1, 1, 1, 0, 0],
  U: [0, 1, 1, 1, 1, 1, 0],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};

interface DigitProps {
  char: string;
  hasDot?: boolean;
  color?: string;
  unlitColor?: string;
  height?: number;
}

export const SevenSegmentDigit: React.FC<DigitProps> = ({
  char,
  hasDot = false,
  color = '#39ff14', // Classic phosphor green
  unlitColor = 'rgba(57, 255, 20, 0.08)',
  height = 36,
}) => {
  const width = Math.round(height * 0.58);
  const active = SEGMENTS[char] || SEGMENTS[char.toUpperCase()] || [0, 0, 0, 0, 0, 0, 0];

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 58 100"
      style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}
    >
      <defs>
        <filter id={`glow-${color.replace(/[^a-zA-Z0-9]/g, '')}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g style={{ filter: `drop-shadow(0 0 3px ${color}88)` }}>
        {/* a - Top */}
        <polygon points="10,8  16,2  42,2  48,8  42,14 16,14" fill={active[0] ? color : unlitColor} />
        {/* b - Top Right */}
        <polygon points="49,9  55,15 55,43 49,49 43,43 43,15" fill={active[1] ? color : unlitColor} />
        {/* c - Bottom Right */}
        <polygon points="49,51 55,57 55,85 49,91 43,85 43,57" fill={active[2] ? color : unlitColor} />
        {/* d - Bottom */}
        <polygon points="10,92 16,86 42,86 48,92 42,98 16,98" fill={active[3] ? color : unlitColor} />
        {/* e - Bottom Left */}
        <polygon points="9,51  15,57 15,85 9,91  3,85  3,57" fill={active[4] ? color : unlitColor} />
        {/* f - Top Left */}
        <polygon points="9,9   15,15 15,43 9,49  3,43  3,15" fill={active[5] ? color : unlitColor} />
        {/* g - Middle */}
        <polygon points="10,50 16,44 42,44 48,50 42,56 16,56" fill={active[6] ? color : unlitColor} />
        {/* dp - Decimal Point */}
        <circle cx="54" cy="94" r="4" fill={hasDot ? color : unlitColor} />
      </g>
    </svg>
  );
};

export interface SevenSegmentDisplayProps {
  value: string | number;
  digits?: number;
  color?: string;
  unlitColor?: string;
  height?: number;
  backgroundColor?: string;
  label?: string;
  style?: React.CSSProperties;
}

export const SevenSegmentDisplay: React.FC<SevenSegmentDisplayProps> = ({
  value,
  digits,
  color = '#00ff66',
  unlitColor,
  height = 32,
  backgroundColor = '#101410',
  label,
  style,
}) => {
  const str = String(value);

  // Parse characters and handle attached decimal points
  const items: { char: string; hasDot: boolean }[] = [];
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') {
      if (items.length > 0) {
        items[items.length - 1].hasDot = true;
      } else {
        items.push({ char: ' ', hasDot: true });
      }
    } else {
      items.push({ char: ch, hasDot: false });
    }
  }

  // Pad to requested digit count
  if (digits && items.length < digits) {
    const padCount = digits - items.length;
    for (let i = 0; i < padCount; i++) {
      items.unshift({ char: ' ', hasDot: false });
    }
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: backgroundColor,
        border: '2px inset #808080',
        borderRadius: 2,
        padding: '3px 6px',
        boxShadow: 'inset 0 0 6px #000',
        fontFamily: 'monospace',
        userSelect: 'none',
        ...style,
      }}
    >
      <div style={{ display: 'flex', gap: Math.max(2, Math.round(height * 0.1)), alignItems: 'center' }}>
        {items.map((item, idx) => (
          <SevenSegmentDigit key={idx} char={item.char} hasDot={item.hasDot} color={color} unlitColor={unlitColor} height={height} />
        ))}
      </div>
      {label && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: color,
            opacity: 0.8,
            marginTop: 2,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export default SevenSegmentDisplay;
