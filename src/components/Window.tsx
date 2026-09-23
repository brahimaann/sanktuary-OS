import React, { useRef } from 'react';
import { useWindowManager } from '../wm/manager';

interface WindowProps {
  id: string;
  title: string;
  icon?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isMinimized: boolean;
  focused: boolean;
  zIndex: number;
  resizable?: boolean;
  children?: React.ReactNode;
}

export const Window: React.FC<WindowProps> = ({
  id,
  title,
  icon,
  x,
  y,
  width,
  height,
  isMaximized,
  isMinimized,
  focused,
  zIndex,
  resizable = true,
  children,
}) => {
  const { focusWindow, closeWindow, minimizeWindow, maximizeWindow, updateWindowPosition, updateWindowSize } = useWindowManager();
  const windowRef = useRef<HTMLDivElement>(null);

  if (isMinimized) return null;

  const handlePointerDown = () => {
    focusWindow(id);
  };

  const handleTitlePointerDown = (e: React.PointerEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    focusWindow(id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWindowX = x;
    const startWindowY = y;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      updateWindowPosition(id, startWindowX + deltaX, startWindowY + deltaY);
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const handleResizePointerDown = (e: React.PointerEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    focusWindow(id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width;
    const startH = height;
    const startWindowX = x;
    const startWindowY = y;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newW = startW;
      let newH = startH;
      let newX = startWindowX;
      let newY = startWindowY;

      if (direction.includes('e')) {
        newW = Math.max(200, startW + deltaX);
      }
      if (direction.includes('s')) {
        newH = Math.max(100, startH + deltaY);
      }
      if (direction.includes('w')) {
        const potentialW = startW - deltaX;
        if (potentialW >= 200) {
          newW = potentialW;
          newX = startWindowX + deltaX;
        }
      }
      if (direction.includes('n')) {
        const potentialH = startH - deltaY;
        if (potentialH >= 100) {
          newH = potentialH;
          newY = startWindowY + deltaY;
        }
      }

      updateWindowSize(id, newW, newH);
      if (newX !== startWindowX || newY !== startWindowY) {
        updateWindowPosition(id, newX, newY);
      }
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const style: React.CSSProperties = isMaximized
    ? {
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: 'calc(100% - 30px)',
        zIndex,
      }
    : {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex,
      };

  return (
    <div
      ref={windowRef}
      className={`os-window ${focused ? 'focused' : ''} ${isMaximized ? 'maximized' : ''}`}
      style={style}
      onPointerDown={handlePointerDown}
    >
      <div
        className="window-titlebar"
        onPointerDown={handleTitlePointerDown}
        onDoubleClick={() => resizable && maximizeWindow(id)}
      >
        {icon && (
          <img
            src={icon}
            alt=""
            className="icon"
            style={{ width: '16px', height: '16px', marginLeft: '4px', marginRight: '2px', verticalAlign: 'middle' }}
          />
        )}
        <div className="window-title-area">
          <span className="window-title">{title}</span>
        </div>
        <button
          className="window-button window-action-minimize"
          aria-label="Minimize"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => minimizeWindow(id)}
        >
          <span className="window-button-icon" />
        </button>
        <button
          className="window-button window-action-maximize"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          disabled={!resizable}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => resizable && maximizeWindow(id)}
        >
          <span className="window-button-icon" />
        </button>
        <button
          className="window-button window-action-close window-close-button"
          aria-label="Close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => closeWindow(id)}
        >
          <span className="window-button-icon" />
        </button>
      </div>

      <div className="window-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>

      {/* Resize handles */}
      {resizable && !isMaximized && (
        <>
          <div
            className="resize-handle n"
            style={{ position: 'absolute', top: 0, left: 4, right: 4, height: 4, cursor: 'ns-resize' }}
            onPointerDown={(e) => handleResizePointerDown(e, 'n')}
          />
          <div
            className="resize-handle s"
            style={{ position: 'absolute', bottom: 0, left: 4, right: 4, height: 4, cursor: 'ns-resize' }}
            onPointerDown={(e) => handleResizePointerDown(e, 's')}
          />
          <div
            className="resize-handle e"
            style={{ position: 'absolute', top: 4, bottom: 4, right: 0, width: 4, cursor: 'ew-resize' }}
            onPointerDown={(e) => handleResizePointerDown(e, 'e')}
          />
          <div
            className="resize-handle w"
            style={{ position: 'absolute', top: 4, bottom: 4, left: 0, width: 4, cursor: 'ew-resize' }}
            onPointerDown={(e) => handleResizePointerDown(e, 'w')}
          />
          <div
            className="resize-handle se"
            style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, cursor: 'nwse-resize', zIndex: 10 }}
            onPointerDown={(e) => handleResizePointerDown(e, 'se')}
          />
          <div
            className="resize-handle sw"
            style={{ position: 'absolute', bottom: 0, left: 0, width: 8, height: 8, cursor: 'nesw-resize', zIndex: 10 }}
            onPointerDown={(e) => handleResizePointerDown(e, 'sw')}
          />
          <div
            className="resize-handle ne"
            style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, cursor: 'nesw-resize', zIndex: 10 }}
            onPointerDown={(e) => handleResizePointerDown(e, 'ne')}
          />
          <div
            className="resize-handle nw"
            style={{ position: 'absolute', top: 0, left: 0, width: 8, height: 8, cursor: 'nwse-resize', zIndex: 10 }}
            onPointerDown={(e) => handleResizePointerDown(e, 'nw')}
          />
        </>
      )}
    </div>
  );
};
export default Window;
