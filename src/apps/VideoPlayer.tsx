import React, { useState, useRef, useEffect, useCallback } from 'react';

interface VideoPlayerProps {
  videoSrc: string;
  videoTitle?: string;
  videoArtist?: string;
}

/** Extract YouTube video ID from various URL formats */
function extractYTId(src: string): string | null {
  const m = src.match(/(?:embed\/|watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Load the YouTube IFrame API script once globally */
let ytApiReady = false;
let ytApiCallbacks: (() => void)[] = [];

function ensureYTApi(cb: () => void) {
  if (ytApiReady && (window as any).YT?.Player) {
    cb();
    return;
  }
  ytApiCallbacks.push(cb);
  if (document.getElementById('yt-iframe-api')) return; // already loading

  const tag = document.createElement('script');
  tag.id = 'yt-iframe-api';
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  (window as any).onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    ytApiCallbacks.forEach(fn => fn());
    ytApiCallbacks = [];
  };
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Windows Media Player 6.4–style video player.
 * Uses the YouTube IFrame Player API for real playback control.
 * YouTube's own controls are hidden; all interaction goes through the Win98 chrome.
 */
const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoSrc,
  videoTitle = 'Untitled',
  videoArtist,
}) => {
  const playerDivRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const timerRef = useRef<number>(0);

  const [playerState, setPlayerState] = useState<'unstarted' | 'playing' | 'paused' | 'ended' | 'buffering'>('unstarted');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);


  const ytId = extractYTId(videoSrc);
  const isYouTube = !!ytId;

  // Non-YouTube fallback: just embed normally
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── YouTube Player Setup ──
  useEffect(() => {
    if (!isYouTube || !playerDivRef.current) return;

    ensureYTApi(() => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }

      playerRef.current = new (window as any).YT.Player(playerDivRef.current!, {
        videoId: ytId,
        playerVars: {
          autoplay: 1,
          controls: 0,         // Hide YouTube controls
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,   // Hide annotations
          disablekb: 1,        // Disable YouTube keyboard shortcuts
          fs: 0,               // Hide fullscreen button
          playsinline: 1,
        },
        events: {
          onReady: (event: any) => {
            event.target.setVolume(volume);
            setDuration(event.target.getDuration() || 0);
          },
          onStateChange: (event: any) => {
            const stateMap: Record<number, typeof playerState> = {
              [-1]: 'unstarted',
              0: 'ended',
              1: 'playing',
              2: 'paused',
              3: 'buffering',
            };
            setPlayerState(stateMap[event.data] || 'unstarted');
            if (event.data === 1) {
              setDuration(event.target.getDuration() || 0);
            }
          },
        },
      });
    });

    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (_) {}
        playerRef.current = null;
      }
    };
  }, [ytId]);

  // ── Progress timer ──
  useEffect(() => {
    if (playerState === 'playing') {
      timerRef.current = window.setInterval(() => {
        if (playerRef.current?.getCurrentTime) {
          setCurrentTime(playerRef.current.getCurrentTime());
          const d = playerRef.current.getDuration();
          if (d && d > 0) setDuration(d);
        }
      }, 250);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [playerState]);

  // ── Controls ──
  const play = useCallback(() => { playerRef.current?.playVideo(); }, []);
  const pause = useCallback(() => { playerRef.current?.pauseVideo(); }, []);
  const stop = useCallback(() => {
    playerRef.current?.stopVideo();
    setCurrentTime(0);
    setPlayerState('ended');
  }, []);

  const seekTo = useCallback((pct: number) => {
    if (duration > 0 && playerRef.current) {
      playerRef.current.seekTo(pct * duration, true);
      setCurrentTime(pct * duration);
    }
  }, [duration]);

  const handleSeekBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(pct);
  }, [seekTo]);

  const changeVolume = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const vol = Math.round(pct * 100);
    setVolume(vol);
    playerRef.current?.setVolume(vol);
    if (vol > 0 && muted) {
      setMuted(false);
      playerRef.current?.unMute();
    }
  }, [muted]);

  const toggleMute = useCallback(() => {
    if (muted) {
      playerRef.current?.unMute();
      setMuted(false);
    } else {
      playerRef.current?.mute();
      setMuted(true);
    }
  }, [muted]);

  const progress = duration > 0 ? currentTime / duration : 0;

  const stateLabel =
    playerState === 'playing' ? 'Playing' :
    playerState === 'paused' ? 'Paused' :
    playerState === 'buffering' ? 'Buffering...' :
    playerState === 'ended' ? 'Stopped' : 'Ready';

  return (
    <div style={shell}>
      {/* ── Menu bar ── */}
      <div style={menuBar}>
        <span style={menuItemStyle}>File</span>
        <span style={menuItemStyle}>View</span>
        <span style={menuItemStyle}>Play</span>
        <span style={menuItemStyle}>Favorites</span>
        <span style={menuItemStyle}>Help</span>
      </div>

      {/* ── Video area ── */}
      <div style={videoArea}>
        {isYouTube ? (
          <div ref={playerDivRef} style={{ width: '100%', height: '100%' }} />
        ) : (
          <iframe
            ref={iframeRef}
            src={videoSrc}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#000' }}
            title={videoTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
      </div>

      {/* ── Now playing strip ── */}
      <div style={nowPlaying}>
        <div style={ticker}>
          <span style={{ color: playerState === 'playing' ? '#00ff00' : '#666', marginRight: 8 }}>♫</span>
          <span>{videoTitle}</span>
          {videoArtist && <span style={{ color: '#aaa', marginLeft: 8 }}>— {videoArtist}</span>}
        </div>
      </div>

      {/* ── Transport controls ── */}
      <div style={transportBar}>
        {/* Seek bar */}
        <div style={seekBarTrack} onClick={handleSeekBarClick}>
          <div style={{ ...seekBarFill, width: `${progress * 100}%` }} />
          <div style={{ ...seekBarThumb, left: `${progress * 100}%` }} />
        </div>

        {/* Time display */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 2px', marginBottom: 2 }}>
          <span style={timeText}>{formatTime(currentTime)}</span>
          <span style={timeText}>{formatTime(duration)}</span>
        </div>

        {/* Buttons row */}
        <div style={buttonRow}>
          <div style={{ display: 'flex', gap: 1 }}>
            <button style={tBtn} title="Stop" onClick={stop}>⏹</button>
            <button style={{ ...tBtn, ...(playerState === 'playing' ? tBtnActive : {}) }} title="Play" onClick={play}>▶</button>
            <button style={{ ...tBtn, ...(playerState === 'paused' ? tBtnActive : {}) }} title="Pause" onClick={pause}>⏸</button>
          </div>

          <div style={divider} />

          <div style={{ display: 'flex', gap: 1 }}>
            <button style={tBtn} title="Rewind 10s" onClick={() => seekTo(Math.max(0, (currentTime - 10) / (duration || 1)))}>⏪</button>
            <button style={tBtn} title="Forward 10s" onClick={() => seekTo(Math.min(1, (currentTime + 10) / (duration || 1)))}>⏩</button>
          </div>

          <div style={{ flex: 1 }} />

          {/* Volume */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, cursor: 'pointer', userSelect: 'none' }} onClick={toggleMute}>
              {muted || volume === 0 ? '🔇' : volume < 40 ? '🔈' : '🔊'}
            </span>
            <div style={volumeTrack} onClick={changeVolume}>
              <div style={{ ...volumeFill, width: muted ? '0%' : `${volume}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={statusBarStyle}>
        <div style={statusSeg}>
          <span style={{ color: playerState === 'playing' ? '#008000' : playerState === 'paused' ? '#808000' : '#808080', marginRight: 4 }}>●</span>
          {stateLabel}
        </div>
        <div style={{ ...statusSeg, flex: 0, width: 100, borderLeft: '1px solid #808080', textAlign: 'center', justifyContent: 'center' }}>
          Windows Media
        </div>
      </div>
    </div>
  );
};

/* ── Styles ── */
const shell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
  background: '#c0c0c0', fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11, overflow: 'hidden', color: '#000',
};
const menuBar: React.CSSProperties = {
  display: 'flex', gap: 0, padding: '2px 4px',
  background: '#c0c0c0', borderBottom: '1px solid #808080',
  flexShrink: 0,
};
const menuItemStyle: React.CSSProperties = {
  padding: '1px 8px', cursor: 'default', fontSize: 11,
};
const videoArea: React.CSSProperties = {
  flex: 1, background: '#000', overflow: 'hidden',
  border: '2px inset #404040', margin: '0 2px', minHeight: 0,
};
const nowPlaying: React.CSSProperties = {
  background: '#1a1a2e', padding: '3px 8px',
  borderTop: '1px solid #333', borderBottom: '1px solid #333',
  flexShrink: 0, overflow: 'hidden',
};
const ticker: React.CSSProperties = {
  fontSize: 11, color: '#ddd', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis',
  fontFamily: 'monospace',
};
const transportBar: React.CSSProperties = {
  padding: '4px 6px 2px',
  background: 'linear-gradient(180deg, #d4d0c8 0%, #c0c0c0 100%)',
  flexShrink: 0,
};
const seekBarTrack: React.CSSProperties = {
  width: '100%', height: 10,
  background: '#222', border: '1px inset #808080',
  position: 'relative', marginBottom: 2, cursor: 'pointer',
};
const seekBarFill: React.CSSProperties = {
  height: '100%', background: '#000080',
  transition: 'width 0.15s linear',
};
const seekBarThumb: React.CSSProperties = {
  position: 'absolute', top: -2, width: 10, height: 14,
  background: '#c0c0c0', border: '2px outset #e0e0e0',
  cursor: 'pointer', transform: 'translateX(-50%)',
  transition: 'left 0.15s linear',
};
const timeText: React.CSSProperties = {
  fontSize: 9, fontFamily: 'monospace', color: '#444',
};
const buttonRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0',
};
const tBtn: React.CSSProperties = {
  width: 28, height: 24, fontSize: 12, cursor: 'pointer',
  background: '#c0c0c0', border: '2px outset #e0e0e0',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, fontFamily: 'inherit',
};
const tBtnActive: React.CSSProperties = {
  border: '2px inset #808080', background: '#a8a8a8',
};
const divider: React.CSSProperties = {
  width: 1, height: 18, background: '#808080', margin: '0 4px',
};
const volumeTrack: React.CSSProperties = {
  width: 64, height: 8, background: '#222',
  border: '1px inset #808080', position: 'relative', cursor: 'pointer',
};
const volumeFill: React.CSSProperties = {
  height: '100%', background: '#000080',
  transition: 'width 0.1s',
};
const statusBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flexShrink: 0,
  background: '#c0c0c0', borderTop: '1px solid #fff', height: 20,
};
const statusSeg: React.CSSProperties = {
  flex: 1, padding: '0 6px', fontSize: 10,
  border: '1px inset #808080', height: '100%',
  display: 'flex', alignItems: 'center',
  overflow: 'hidden', whiteSpace: 'nowrap',
};

export default VideoPlayer;
