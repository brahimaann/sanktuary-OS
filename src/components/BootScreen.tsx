import React, { useState, useEffect } from 'react';
import sound from '../utils/sound';

interface BootScreenProps {
  onComplete: () => void;
}

/* ────────────────────────────────────────────────────────
   The S machine starting up: the pixel wordmark in a box on the dotted desktop and a short
   progress bar, the way the first desktops said hello. It asks nothing (Log On lives in the
   taskbar), plays once per browser session, and any key or click skips it.
   ──────────────────────────────────────────────────────── */

const STEPS = 12;

export const BootScreen: React.FC<BootScreenProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  // Already played in this session: straight to the desktop
  useEffect(() => {
    if (sessionStorage.getItem('hq_os_booted')) onComplete();
  }, [onComplete]);

  const handleComplete = () => {
    sessionStorage.setItem('hq_os_booted', 'true');
    sound.playStartup();
    onComplete();
  };

  useEffect(() => {
    const timer = setTimeout(() => (step >= STEPS ? handleComplete() : setStep((n) => n + 1)), step >= STEPS ? 250 : 90);
    return () => clearTimeout(timer);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('keydown', handleComplete);
    return () => window.removeEventListener('keydown', handleComplete);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={handleComplete}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--sk-dither)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontFamily: "'Pixelify Sans', sans-serif",
      }}
    >
      <div
        role="status"
        style={{
          width: 'min(360px, calc(100% - 32px))',
          background: '#fff',
          border: '2px solid #000',
          boxShadow: '3px 3px 0 #000',
          padding: '28px 28px 22px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <img src="/icons/sanktuary-wordmark.svg" alt="Sanktuary" style={{ width: '100%', imageRendering: 'pixelated' }} />
        <div style={{ fontSize: 16 }}>Welcome to Sanktuary.</div>
        <div style={{ width: '100%', height: 12, border: '2px solid #000', padding: 1 }}>
          <div style={{ width: `${(step / STEPS) * 100}%`, height: '100%', background: 'var(--sk-signal)' }} />
        </div>
      </div>
    </div>
  );
};

export default BootScreen;
