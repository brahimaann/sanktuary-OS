import React, { useState, useEffect } from 'react';
import sound from '../utils/sound';

interface BootScreenProps {
  onComplete: () => void;
}

/* ────────────────────────────────────────────────────────
   Short Award BIOS style loader: BIOS lines, then the Sanktuary logo, then the desktop.
   It only sets the mood and asks nothing (Log On lives in the taskbar). Renders INSIDE the CRT
   screen area, plays once per browser session; any key or click skips ahead.
   ──────────────────────────────────────────────────────── */

interface TermLine {
  text: string;
  color?: string;
  bold?: boolean;
  parts?: { text: string; color: string }[];
}

const hashBlob =
  'hDRDhEyBFFmFBESAQAQIfPgQEYC0F81IvHPD1E1EgAAQKUCsOwfIwIQQ3ZWEaICPy3g0hEhISIwIhQ1UBIBLgL' +
  'FBAAAAAAAAAAAAAAAAAAA1984AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExJU1RGAAAAaSU5GT01DUkQLAAAAMTk5M10wMu0AASU0Rw0AABCaWxs1fAvbGZvcmQAREITR1QAAAUZ9';

const BIOS_LINES: TermLine[] = [
  { text: 'Award Modular BIOS v4.51PG, An Energy Star Ally', color: '#ffffff', bold: true },
  { text: 'Copyright (C) 1984-85, Award Software, Inc.', color: '#aaaaaa' },
  { text: '' },
  { text: '' },
  {
    text: 'Detecting mouse... OK',
    parts: [
      { text: 'Detecting mouse... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  {
    text: 'Detecting touch support... FAILED',
    parts: [
      { text: 'Detecting touch support... ', color: '#aaaaaa' },
      { text: 'FAILED', color: '#ff5555' },
    ],
  },
  {
    text: 'Connecting to The Sanktuary... OK',
    parts: [
      { text: 'Connecting to The Sanktuary... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  {
    text: 'Initializing file system... OK',
    parts: [
      { text: 'Initializing file system... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  {
    text: 'Loading system themes... OK',
    parts: [
      { text: 'Loading system themes... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  {
    text: 'Initializing Recycle Bin... OK',
    parts: [
      { text: 'Initializing Recycle Bin... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  { text: `Preloading default theme assets... ${hashBlob}`, color: '#55ffff' },
  {
    text: 'Preloading default theme assets... OK',
    parts: [
      { text: 'Preloading default theme assets... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  {
    text: 'Loading custom applications... OK',
    parts: [
      { text: 'Loading custom applications... ', color: '#aaaaaa' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
  {
    text: 'Press F8 for Startup Menu... Booting OS/390 Emulator... OK',
    parts: [
      { text: 'Press F8 for Startup Menu... Booting OS/390 Emulator... ', color: '#ffffff' },
      { text: 'OK', color: '#55ff55' },
    ],
  },
];

const SANKTUARY_LOGO = [
  '        SSSSSSSSSSS      The S/370, ESA/390 and z/Architecture',
  '      SSSSSSSSSSSSSS                   Emulator',
  '      SSS',
  '      SSS                S A N K T U A R Y   [ S K T Y ]',
  '        SSSSSSSSSSS      ',
  '           SSSSSSSSS     Mainframe Emulation Subsystem',
  '                 SSS     ',
  "      SSS        SSS     My PC thinks it's a MAINFRAME",
  '      SSSSSSSSSSSSSS',
  '        SSSSSSSSSSS      Copyright (C) 2026 The Sanktuary',
];

const HERCULES_LINES = [
  { text: 'Sanktuary Emulator Version : 3.12 [SKTY]', color: '#8888ff' },
  { text: 'Host name                  : brontide', color: '#8888ff' },
  { text: 'Host OS                    : Linux-4.9.0-4-amd64 #1 SMP Debian 4.9.65-3+deb9u1', color: '#aaaaaa' },
  { text: 'Host Architecture          : x86_64', color: '#8888ff' },
  { text: 'Processors                 : MP=8', color: '#8888ff' },
  { text: 'Chanl Subsys               : 0', color: '#8888ff' },
  { text: 'Device number              : 0700', color: '#8888ff' },
  { text: 'Subchannel                 : 002B', color: '#8888ff' },
  { text: '' },
  ...SANKTUARY_LOGO.map((line) => ({ text: line, color: '#5555ff', bold: true })),
  { text: '' },
  { text: 'HHCLC001I IPLing from device 0700...', color: '#ffffff' },
  { text: 'HHCLC002I Load parameter: 0182', color: '#ffffff' },
  { text: 'HHCLC003I System initialization in progress...', color: '#ffffff' },
  { text: 'HHCLC004I Loading main storage... OK', color: '#55ff55' },
  { text: 'HHCLC005I Mainframe emulation online. Loading OS/390 Subsystems...', color: '#55ff55' },
];

type BootStage = 'BIOS' | 'HERCULES';

export const BootScreen: React.FC<BootScreenProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<BootStage>('BIOS');
  const [biosVisibleCount, setBiosVisibleCount] = useState(0);
  const [herculesVisibleCount, setHerculesVisibleCount] = useState(0);

  // Already played in this session: straight to the desktop
  useEffect(() => {
    if (sessionStorage.getItem('hq_os_booted')) onComplete();
  }, [onComplete]);

  const handleComplete = () => {
    sessionStorage.setItem('hq_os_booted', 'true');
    sound.playStartup();
    onComplete();
  };
  const advance = () => (stage === 'BIOS' ? setStage('HERCULES') : handleComplete());

  // 1. BIOS lines
  useEffect(() => {
    if (stage !== 'BIOS') return;
    const last = biosVisibleCount >= BIOS_LINES.length;
    const timer = setTimeout(
      () => (last ? setStage('HERCULES') : setBiosVisibleCount((n) => n + 1)),
      last ? 250 : BIOS_LINES[biosVisibleCount]?.text === '' ? 15 : 35,
    );
    return () => clearTimeout(timer);
  }, [biosVisibleCount, stage]);

  // 2. Emulator banner and logo, then the desktop
  useEffect(() => {
    if (stage !== 'HERCULES') return;
    const last = herculesVisibleCount >= HERCULES_LINES.length;
    const timer = setTimeout(() => (last ? handleComplete() : setHerculesVisibleCount((n) => n + 1)), last ? 600 : 20);
    return () => clearTimeout(timer);
  }, [herculesVisibleCount, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? handleComplete() : advance());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderBioLine = (line: TermLine, i: number) => {
    if (line.text === '') {
      return (
        <div key={i} style={{ height: '1.1em' }}>
          &nbsp;
        </div>
      );
    }
    if (line.parts) {
      return (
        <div key={i}>
          {line.parts.map((p, j) => (
            <span key={j} style={{ color: p.color }}>
              {p.text}
            </span>
          ))}
        </div>
      );
    }
    return (
      <div
        key={i}
        style={{
          color: line.color || '#aaaaaa',
          wordBreak: 'break-all',
        }}
      >
        {line.text}
      </div>
    );
  };

  return (
    <div
      onClick={advance}
      style={{
        width: '100%',
        height: '100%',
        background: '#000000',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      <style>{`
        @font-face {
          font-family: 'Fixedsys Excelsior';
          src: url('/font/fixedsys-excelsior/fsex300-webfont.woff') format('woff'),
               url('/font/fixedsys-excelsior/fsex300-webfont.ttf') format('truetype');
          font-weight: normal;
          font-style: normal;
          font-display: block;
        }
        .bios-terminal, .bios-terminal * {
          font-family: 'Fixedsys Excelsior', 'Perfect DOS VGA 437', 'Courier New', monospace !important;
          font-weight: normal !important;
          -webkit-font-smoothing: none !important;
          -moz-osx-font-smoothing: unset !important;
        }
      `}</style>

      {/* Render BIOS Screen */}
      {stage === 'BIOS' && (
        <div
          className="bios-terminal"
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '8px 12px',
            fontSize: '14px',
            lineHeight: '1.15',
            position: 'relative',
            color: '#aaaaaa',
            backgroundColor: '#000000',
          }}
        >
          {/* Energy Star logo — top right */}
          <div style={{ position: 'absolute', top: 8, right: 12, textAlign: 'center' }}>
            <svg style={{ width: 100, height: 70 }} viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M 60,4 L 67,24 L 88,24 L 71,37 L 78,57 L 60,44 L 42,57 L 49,37 L 32,24 L 53,24 Z"
                stroke="#ffff00"
                strokeWidth="1.5"
                fill="none"
                strokeLinejoin="round"
              />
              <path d="M 30,14 A 40,40 0 0,0 74,62" stroke="#00cc00" strokeWidth="2" strokeLinecap="round" fill="none" />
              <text
                x="60"
                y="36"
                fill="#ffff00"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Arial, sans-serif"
                textAnchor="middle"
                fontStyle="italic"
              >
                energy
              </text>
            </svg>
            <div style={{ color: '#00cc00', fontSize: '9px', letterSpacing: '0.5px', marginTop: '-4px', fontFamily: 'Arial, sans-serif' }}>
              EPA POLLUTION PREVENTER
            </div>
          </div>

          {/* Printed BIOS lines */}
          {BIOS_LINES.slice(0, biosVisibleCount).map((line, i) => renderBioLine(line, i))}
        </div>
      )}

      {/* Render Hercules emulation info */}
      {stage === 'HERCULES' && (
        <div
          ref={(el) => {
            if (el) el.scrollTop = el.scrollHeight;
          }} // keep the newest lines in view on short screens
          className="bios-terminal"
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '16px 20px',
            fontSize: '13px',
            lineHeight: '1.25',
            position: 'relative',
            color: '#bbbbbb',
            backgroundColor: '#000000',
          }}
        >
          {HERCULES_LINES.slice(0, herculesVisibleCount).map((line, i) => (
            <div
              key={i}
              style={{
                color: line.color || '#aaaaaa',
                fontWeight: 'bold' in line && line.bold ? 'bold' : 'normal',
                wordBreak: 'break-all',
                whiteSpace: 'pre',
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}

      {/* Bottom status bar — pinned */}
      <div
        className="bios-terminal"
        style={{
          padding: '4px 12px',
          fontSize: '14px',
          lineHeight: '1.15',
          color: '#888888',
          borderTop: 'none',
          backgroundColor: 'transparent',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        {stage === 'BIOS' && <span>Press F8 for Startup Menu.</span>}
        {stage === 'HERCULES' && <span>IPL Link Emulation Port: 3001</span>}
      </div>
    </div>
  );
};

export default BootScreen;
