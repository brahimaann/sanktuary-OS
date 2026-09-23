import React, { useEffect, useRef } from 'react';

export type ScreensaverType = 'pipes' | 'starfield' | 'none';

interface ScreensaverProps {
  type: ScreensaverType;
  onDismiss: () => void;
}

export const Screensaver: React.FC<ScreensaverProps> = ({ type, onDismiss }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialPointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = () => onDismiss();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const handlePointerDown = () => onDismiss();

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!initialPointer.current) {
      initialPointer.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const dist = Math.hypot(e.clientX - initialPointer.current.x, e.clientY - initialPointer.current.y);
    if (dist > 10) {
      onDismiss();
    }
  };

  // Canvas-based Starfield Simulation
  useEffect(() => {
    if (type !== 'starfield') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const numStars = 400;
    const stars: { x: number; y: number; z: number; pz: number }[] = [];
    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: (Math.random() - 0.5) * width * 2,
        y: (Math.random() - 0.5) * height * 2,
        z: Math.random() * width,
        pz: Math.random() * width,
      });
    }

    const render = () => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      for (let i = 0; i < numStars; i++) {
        const star = stars[i];
        star.pz = star.z;
        star.z -= 4;

        if (star.z <= 0) {
          star.z = width;
          star.pz = width;
          star.x = (Math.random() - 0.5) * width * 2;
          star.y = (Math.random() - 0.5) * height * 2;
        }

        const k = 128 / star.z;
        const px = star.x * k + cx;
        const py = star.y * k + cy;

        const pk = 128 / star.pz;
        const prevX = star.x * pk + cx;
        const prevY = star.y * pk + cy;

        if (px >= 0 && px <= width && py >= 0 && py <= height) {
          const shade = Math.min(255, Math.floor((1 - star.z / width) * 255));
          ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
          ctx.lineWidth = Math.max(1, (1 - star.z / width) * 2.5);
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    const handleResize = () => {
      if (!canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [type]);

  if (type === 'none') return null;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 99999,
        background: '#000000',
        cursor: 'none',
        overflow: 'hidden',
      }}
    >
      {type === 'pipes' ? (
        <iframe
          src="/programs/pipes/index.html#%7B%22hideUI%22%3Atrue%7D"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            pointerEvents: 'none', // Ensure pointer events bubble up to the dismiss wrapper
          }}
          title="3D Pipes Screensaver"
        />
      ) : (
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      )}
    </div>
  );
};

export default Screensaver;
