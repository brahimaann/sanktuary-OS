import React, { useEffect, useRef, useState, useCallback } from 'react';

const PADDLE_W = 10;
const PADDLE_H = 60;
const BALL_SIZE = 10;
const SPEED_STEP = 0.3;
const INITIAL_BALL_SPEED = 4;
const AI_SPEED = 3.5;

interface GameState {
  playerY: number;
  aiY: number;
  ballX: number;
  ballY: number;
  ballVX: number;
  ballVY: number;
  playerScore: number;
  aiScore: number;
  phase: 'idle' | 'playing' | 'paused' | 'gameover';
  winner: 'player' | 'ai' | null;
}

const WIN_SCORE = 7;

function makeInitialState(W: number, H: number): GameState {
  const angle = (Math.random() * 60 - 30) * (Math.PI / 180);
  const dir = Math.random() > 0.5 ? 1 : -1;
  return {
    playerY: H / 2 - PADDLE_H / 2,
    aiY: H / 2 - PADDLE_H / 2,
    ballX: W / 2,
    ballY: H / 2,
    ballVX: dir * INITIAL_BALL_SPEED * Math.cos(angle),
    ballVY: INITIAL_BALL_SPEED * Math.sin(angle),
    playerScore: 0,
    aiScore: 0,
    phase: 'idle',
    winner: null,
  };
}

const Pong: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);
  const keysRef = useRef<{ [k: string]: boolean }>({});
  const [displayScore, setDisplayScore] = useState({ player: 0, ai: 0 });
  const [phase, setPhase] = useState<GameState['phase']>('idle');
  const [winner, setWinner] = useState<GameState['winner']>(null);
  const [dimensions, setDimensions] = useState({ W: 480, H: 320 });

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      setDimensions({ W, H });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { W, H } = dimensions;

  const resetBall = useCallback((s: GameState, scorer: 'player' | 'ai') => {
    const angle = (Math.random() * 50 - 25) * (Math.PI / 180);
    const dir = scorer === 'player' ? -1 : 1; // serve toward the one who just got scored on
    const speed = INITIAL_BALL_SPEED + (s.playerScore + s.aiScore) * SPEED_STEP * 0.5;
    s.ballX = W / 2;
    s.ballY = H / 2;
    s.ballVX = dir * speed * Math.cos(angle);
    s.ballVY = speed * Math.sin(angle) * (Math.random() > 0.5 ? 1 : -1);
  }, [W, H]);

  // Main game loop
  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const s = stateRef.current;
    if (!canvas || !ctx || !s) return;

    const PADDLE_MARGIN = 8;

    if (s.phase === 'playing') {
      // Player paddle movement
      const playerSpeed = 5;
      if (keysRef.current['ArrowUp'] || keysRef.current['w'] || keysRef.current['W']) {
        s.playerY = Math.max(0, s.playerY - playerSpeed);
      }
      if (keysRef.current['ArrowDown'] || keysRef.current['s'] || keysRef.current['S']) {
        s.playerY = Math.min(H - PADDLE_H, s.playerY + playerSpeed);
      }

      // AI tracking
      const aiCenter = s.aiY + PADDLE_H / 2;
      const ballCenter = s.ballY;
      if (aiCenter < ballCenter - 4) s.aiY = Math.min(H - PADDLE_H, s.aiY + AI_SPEED);
      if (aiCenter > ballCenter + 4) s.aiY = Math.max(0, s.aiY - AI_SPEED);

      // Ball movement
      s.ballX += s.ballVX;
      s.ballY += s.ballVY;

      // Top/bottom wall bounce
      if (s.ballY <= 0) { s.ballY = 0; s.ballVY = Math.abs(s.ballVY); }
      if (s.ballY + BALL_SIZE >= H) { s.ballY = H - BALL_SIZE; s.ballVY = -Math.abs(s.ballVY); }

      // Player paddle (left side)
      const playerPaddleX = PADDLE_MARGIN;
      if (
        s.ballVX < 0 &&
        s.ballX <= playerPaddleX + PADDLE_W &&
        s.ballX >= playerPaddleX &&
        s.ballY + BALL_SIZE >= s.playerY &&
        s.ballY <= s.playerY + PADDLE_H
      ) {
        const hitPos = (s.ballY + BALL_SIZE / 2 - s.playerY) / PADDLE_H; // 0..1
        const angle = (hitPos - 0.5) * (Math.PI * 0.65);
        const speed = Math.min(14, Math.sqrt(s.ballVX ** 2 + s.ballVY ** 2) + SPEED_STEP);
        s.ballVX = Math.abs(speed * Math.cos(angle));
        s.ballVY = speed * Math.sin(angle);
        s.ballX = playerPaddleX + PADDLE_W + 1;
      }

      // AI paddle (right side)
      const aiPaddleX = W - PADDLE_MARGIN - PADDLE_W;
      if (
        s.ballVX > 0 &&
        s.ballX + BALL_SIZE >= aiPaddleX &&
        s.ballX + BALL_SIZE <= aiPaddleX + PADDLE_W + 2 &&
        s.ballY + BALL_SIZE >= s.aiY &&
        s.ballY <= s.aiY + PADDLE_H
      ) {
        const hitPos = (s.ballY + BALL_SIZE / 2 - s.aiY) / PADDLE_H;
        const angle = (hitPos - 0.5) * (Math.PI * 0.65);
        const speed = Math.min(14, Math.sqrt(s.ballVX ** 2 + s.ballVY ** 2) + SPEED_STEP);
        s.ballVX = -Math.abs(speed * Math.cos(angle));
        s.ballVY = speed * Math.sin(angle);
        s.ballX = aiPaddleX - BALL_SIZE - 1;
      }

      // Scoring
      if (s.ballX < 0) {
        s.aiScore += 1;
        if (s.aiScore >= WIN_SCORE) { s.phase = 'gameover'; s.winner = 'ai'; }
        else resetBall(s, 'ai');
        setDisplayScore({ player: s.playerScore, ai: s.aiScore });
      } else if (s.ballX + BALL_SIZE > W) {
        s.playerScore += 1;
        if (s.playerScore >= WIN_SCORE) { s.phase = 'gameover'; s.winner = 'player'; }
        else resetBall(s, 'player');
        setDisplayScore({ player: s.playerScore, ai: s.aiScore });
      }

      if (s.phase === 'gameover') {
        setPhase('gameover');
        setWinner(s.winner);
      }
    }

    // Draw
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Center dashed line
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Score
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = `bold ${Math.round(H * 0.22)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(s.playerScore), W / 4, H * 0.3);
    ctx.fillText(String(s.aiScore), (W * 3) / 4, H * 0.3);

    // Paddles
    const PADDLE_MARGIN_DRAW = 8;
    // Player paddle glow
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(PADDLE_MARGIN_DRAW, s.playerY, PADDLE_W, PADDLE_H);

    // AI paddle glow
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(W - PADDLE_MARGIN_DRAW - PADDLE_W, s.aiY, PADDLE_W, PADDLE_H);
    ctx.shadowBlur = 0;

    // Ball
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.ballX + BALL_SIZE / 2, s.ballY + BALL_SIZE / 2, BALL_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    rafRef.current = requestAnimationFrame(loop);
  }, [W, H, resetBall]);

  // Start / restart
  const startGame = useCallback(() => {
    const gs = makeInitialState(W, H);
    gs.phase = 'playing';
    stateRef.current = gs;
    setDisplayScore({ player: 0, ai: 0 });
    setPhase('playing');
    setWinner(null);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [W, H, loop]);

  // Pause toggle
  const togglePause = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.phase === 'idle' || s.phase === 'gameover') return;
    if (s.phase === 'playing') {
      s.phase = 'paused';
      setPhase('paused');
      cancelAnimationFrame(rafRef.current);
    } else {
      s.phase = 'playing';
      setPhase('playing');
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [loop]);

  // Keyboard
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keysRef.current[e.key] = true;
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
      if (e.key === ' ') {
        e.preventDefault();
        if (phase === 'idle' || phase === 'gameover') startGame();
      }
      if (['ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [phase, startGame, togglePause]);

  // Init idle drawing when dimensions change
  useEffect(() => {
    if (!stateRef.current || stateRef.current.phase === 'idle') {
      stateRef.current = makeInitialState(W, H);
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [W, H, loop]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#000', display: 'flex', flexDirection: 'column', position: 'relative', userSelect: 'none' }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />

      {/* Overlay messages */}
      {phase === 'idle' && (
        <div style={overlayStyle}>
          <div style={titleStyle}>PONG</div>
          <div style={subStyle}>You <span style={{ color: '#00e5ff' }}>◀</span> vs AI <span style={{ color: '#ff4444' }}>▶</span></div>
          <div style={hintStyle}>W/S or ↑/↓ to move</div>
          <button style={btnStyle} onClick={startGame}>▶ Start Game</button>
          <div style={smallHint}>First to {WIN_SCORE} wins</div>
        </div>
      )}

      {phase === 'paused' && (
        <div style={overlayStyle}>
          <div style={titleStyle}>PAUSED</div>
          <button style={btnStyle} onClick={togglePause}>▶ Resume</button>
          <button style={{ ...btnStyle, marginTop: 8, background: 'rgba(255,255,255,0.1)' }} onClick={startGame}>↺ Restart</button>
        </div>
      )}

      {phase === 'gameover' && (
        <div style={overlayStyle}>
          <div style={{ ...titleStyle, color: winner === 'player' ? '#00e5ff' : '#ff4444' }}>
            {winner === 'player' ? '🏆 YOU WIN!' : '💀 AI WINS'}
          </div>
          <div style={subStyle}>
            {displayScore.player} — {displayScore.ai}
          </div>
          <button style={btnStyle} onClick={startGame}>▶ Play Again</button>
        </div>
      )}

      {/* Controls hint strip at bottom */}
      {phase === 'playing' && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.4)',
          fontSize: 10, textAlign: 'center', padding: '2px 0',
          fontFamily: 'monospace', letterSpacing: 1,
        }}>
          W/S · ↑/↓ &nbsp;|&nbsp; P = Pause
        </div>
      )}
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.7)',
  gap: 8,
};
const titleStyle: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 36, fontWeight: 900,
  color: '#fff', letterSpacing: 6, textShadow: '0 0 20px rgba(255,255,255,0.5)',
};
const subStyle: React.CSSProperties = {
  fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)', fontSize: 13,
};
const hintStyle: React.CSSProperties = {
  fontFamily: 'monospace', color: 'rgba(255,255,255,0.45)', fontSize: 11,
};
const smallHint: React.CSSProperties = {
  fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 4,
};
const btnStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '6px 22px',
  background: 'rgba(255,255,255,0.15)',
  border: '1px solid rgba(255,255,255,0.3)',
  color: '#fff',
  fontFamily: 'monospace',
  fontSize: 13,
  cursor: 'pointer',
  borderRadius: 2,
  letterSpacing: 1,
  transition: 'background 0.15s',
};

export default Pong;
