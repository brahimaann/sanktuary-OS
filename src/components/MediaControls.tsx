import React, { useEffect, useState } from 'react';
import RetroIcon from './RetroIcon';

/**
 * Win98 Media Player controls for an <audio>/<video> element (which keeps doing the playing, without its
 * own controls): navy display with state and time, trackbar, Play / Pause / Stop and volume.
 * Same look as the public share page (server/share.html).
 */
const MediaControls: React.FC<{ media: React.RefObject<HTMLMediaElement | null>; src: string }> = ({ media, src }) => {
  const [, redraw] = useState(0);
  const [drag, setDrag] = useState<number | null>(null); // seek position while the thumb is held
  const m = media.current;

  useEffect(() => {
    const el = media.current;
    if (!el) return;
    const tick = () => redraw((n) => n + 1);
    const events = ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'volumechange'];
    events.forEach((e) => el.addEventListener(e, tick));
    tick();
    return () => events.forEach((e) => el.removeEventListener(e, tick));
  }, [media, src]);

  const dur = m?.duration || 0;
  const now = drag !== null ? drag * dur : m?.currentTime || 0;
  const playing = !!m && !m.paused;
  const paused = !!m && m.paused && m.currentTime > 0 && !m.ended;
  const state = !m ? 'Stopped' : m.ended ? 'Finished' : playing ? 'Playing' : paused ? 'Paused' : 'Stopped';
  const commit = () => {
    if (m && drag !== null && dur) m.currentTime = drag * dur;
    setDrag(null);
  };

  return (
    <div className="w98-mp">
      <div className="w98-mp-lcd">
        <span>{state}</span>
        <span className="w98-mp-time">
          {clock(now)} / {dur ? clock(dur) : '--:--'}
        </span>
      </div>
      <input
        className="w98-track"
        type="range"
        min={0}
        max={1000}
        aria-label="Position"
        value={Math.round((dur ? now / dur : 0) * 1000)}
        onChange={(e) => setDrag(Number(e.target.value) / 1000)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        style={{ width: '100%' }}
      />
      <div className="w98-mp-row">
        <button className={`w98-mp-btn${playing ? ' on' : ''}`} title="Play" onClick={() => m?.play()}>
          <RetroIcon name="play" size={13} />
        </button>
        <button className={`w98-mp-btn${paused ? ' on' : ''}`} title="Pause" onClick={() => m?.pause()}>
          <RetroIcon name="pause" size={13} />
        </button>
        <button
          className="w98-mp-btn"
          title="Stop"
          onClick={() => {
            if (!m) return;
            m.pause();
            m.currentTime = 0;
          }}
        >
          <RetroIcon name="stop" size={13} />
        </button>
        <span className="w98-mp-sep" />
        <img src="/images/icons/speaker-16x16.png" alt="Volume" width={16} height={16} />
        <input
          className="w98-track"
          type="range"
          min={0}
          max={100}
          aria-label="Volume"
          value={Math.round((m?.volume ?? 1) * 100)}
          onChange={(e) => m && (m.volume = Number(e.target.value) / 100)}
          style={{ width: 80 }}
        />
      </div>
    </div>
  );
};

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default MediaControls;
