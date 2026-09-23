import React, { useRef } from 'react';

interface PokemonEmulatorProps {
  src?: string;
}

/**
 * Thin wrapper around EmulatorJS running inside an iframe.
 * 
 * KEY INSIGHT: EmulatorJS listens for keyboard events on the iframe's own
 * document. The ONLY thing we need to do is let the iframe receive native
 * browser focus — no synthetic events, no focus hacks, no overlays.
 * The user simply clicks the game canvas and the browser gives the iframe
 * focus automatically. Keyboard input then flows directly to EmulatorJS.
 */
export const PokemonEmulator: React.FC<PokemonEmulatorProps> = ({
  src = '/programs/pokemon/index.html'
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const restartGame = () => {
    if (iframeRef.current) iframeRef.current.src = iframeRef.current.src;
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%',
      background: '#0f0520', userSelect: 'none',
      overflow: 'hidden', fontFamily: 'Arial, sans-serif',
    }}>
      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 8px', background: '#0a0318',
        borderBottom: '1px solid #3a1260', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontStyle: 'italic', fontWeight: 700 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2020', boxShadow: '0 0 4px #ff2020' }} />
          <span style={{ color: '#aaa', letterSpacing: 1 }}>GAME BOY </span>
          <span style={{ color: '#a81870' }}>C</span>
          <span style={{ color: '#582080' }}>O</span>
          <span style={{ color: '#1080b0' }}>L</span>
          <span style={{ color: '#88b010' }}>O</span>
          <span style={{ color: '#e08810' }}>R</span>
        </div>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={restartGame}
          style={{
            padding: '2px 8px', fontSize: 10,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 3, color: '#ffaaaa', cursor: 'pointer',
            fontFamily: 'Arial, sans-serif',
          }}
        >↺ Reset</button>
      </div>

      {/* ── Game screen — the iframe IS the game, no overlays ── */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#000', overflow: 'hidden', minHeight: 0,
      }}>
        <iframe
          ref={iframeRef}
          src={src}
          style={{
            width: '100%', height: '100%',
            border: 'none', background: '#000', display: 'block',
          }}
          title="Pokémon Crystal GBC"
          sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads"
          allow="autoplay; gamepad"
        />
      </div>

      {/* ── Hint ── */}
      <div style={{
        flexShrink: 0, background: '#0a0318',
        borderTop: '1px solid #2a0a40',
        padding: '3px 10px', fontSize: 9, color: '#555',
        textAlign: 'center', letterSpacing: 0.5,
      }}>
        Click the game, then use keyboard &nbsp;·&nbsp;
        <b style={{ color: '#777' }}>↑↓←→</b> Move &nbsp;·&nbsp;
        <b style={{ color: '#777' }}>X</b>=A &nbsp;·&nbsp;
        <b style={{ color: '#777' }}>Z</b>=B &nbsp;·&nbsp;
        <b style={{ color: '#777' }}>Enter</b>=Start &nbsp;·&nbsp;
        <b style={{ color: '#777' }}>Shift</b>=Select
      </div>
    </div>
  );
};

export default PokemonEmulator;
