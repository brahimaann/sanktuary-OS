import React, { useEffect, useRef } from 'react';
import sound from '../utils/sound';

interface BootScreenProps {
  onComplete: () => void;
}

/* ────────────────────────────────────────────────────────
   The Sanktuary intro: a green energy ring spirals out and the pixel wordmark tunes in through
   static (public/intro, drawn by ops/intro/sanktuary-intro.tsx). It asks nothing, plays once per
   browser session, and any key or click skips it. If the video can't play, or the visitor asks
   for less motion, it goes straight to the desktop.
   ──────────────────────────────────────────────────────── */

export const BootScreen: React.FC<BootScreenProps> = ({ onComplete }) => {
  const done = useRef(false);

  const handleComplete = () => {
    if (done.current) return;
    done.current = true;
    sessionStorage.setItem('hq_os_booted', 'true');
    sound.playStartup();
    onComplete();
  };

  useEffect(() => {
    if (sessionStorage.getItem('hq_os_booted')) {
      done.current = true;
      onComplete();
      return;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) handleComplete();
    const timer = setTimeout(handleComplete, 6000); // never hold anyone at the door
    window.addEventListener('keydown', handleComplete);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleComplete);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={handleComplete}
      role="status"
      aria-label="Welcome to Sanktuary"
      style={{
        width: '100%',
        height: '100%',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <video
        autoPlay
        muted
        playsInline
        onEnded={handleComplete}
        onError={handleComplete}
        style={{ width: 'min(100%, 1280px)', imageRendering: 'pixelated' }}
      >
        <source src="/intro/sanktuary-intro.webm" type="video/webm" />
        <source src="/intro/sanktuary-intro.mp4" type="video/mp4" onError={handleComplete} />
      </video>
    </div>
  );
};

export default BootScreen;
