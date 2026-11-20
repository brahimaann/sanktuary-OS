import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RetroIcon, { IconName } from './RetroIcon';

/** A bare ⋯ button holding the less-used actions in a 1-bit dropdown. A row closes it when clicked. */
const MoreMenu: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title = 'More' }) => {
  const [at, setAt] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // A wide menu under a ⋯ near the left edge (a phone) would run off screen: pin it to the left edge instead
  useLayoutEffect(() => {
    const m = menu.current;
    if (m && m.getBoundingClientRect().left < 4) Object.assign(m.style, { left: '4px', right: 'auto' });
  }, [at]);
  useEffect(() => {
    if (!at) return;
    const close = (e: PointerEvent) => !btn.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setAt(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [at]);
  return (
    <>
      <button
        ref={btn}
        className="sk-tool"
        title={title}
        aria-label={title}
        aria-expanded={!!at}
        onClick={() => setAt(at ? null : btn.current!.getBoundingClientRect())}
      >
        <RetroIcon name="more" size={16} />
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="sk-menu"
            style={{
              top: at.bottom + 2,
              right: Math.max(4, innerWidth - at.right),
              maxHeight: innerHeight - at.bottom - 10,
            }}
            onClick={(e) => (e.target as HTMLElement).closest('button:not([data-keep])') && setAt(null)}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
};

export const MenuItem: React.FC<{
  icon?: IconName;
  on?: boolean; // a ticked choice
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ icon, on, disabled, title, onClick, children }) => (
  <button role="menuitem" className={on ? 'on' : undefined} disabled={disabled} title={title} onClick={onClick}>
    <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{icon ? <RetroIcon name={icon} /> : on ? '✓' : ''}</span>
    {children}
  </button>
);

export const MenuHead: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="sk-menu-head">{children}</div>;

export default MoreMenu;
