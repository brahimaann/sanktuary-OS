import React, { useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/react';
import Avatar from '../apps/Avatar';

/** Win98-style account menu (replaces Clerk's modern UserButton popup): who you are, account settings, log off. */
const AccountButton: React.FC = () => {
  const clerk = useClerk();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (!user) return null;
  const name = user.username || user.firstName || 'you';
  const item = (label: string, icon: string, onClick: () => void) => (
    <div
      role="menuitem"
      style={menuItem}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      onPointerEnter={(e) => Object.assign(e.currentTarget.style, { background: '#000080', color: '#fff' })}
      onPointerLeave={(e) => Object.assign(e.currentTarget.style, { background: '', color: '' })}
    >
      <img src={icon} alt="" style={{ width: 16, height: 16 }} />
      {label}
    </div>
  );

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button style={{ ...btn, ...(open ? pressed : {}) }} onClick={() => setOpen(!open)} title="Account">
        <Avatar username={name} size={16} />
        {name} ▾
      </button>
      {open && (
        <div role="menu" style={menu}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderBottom: '1px solid #808080' }}>
            <Avatar username={name} size={32} />
            <div>
              <b>{user.fullName || name}</b>
              <div style={{ color: '#404040' }}>{name}</div>
            </div>
          </div>
          <div style={{ height: 2 }} />
          {item('Account settings...', '/images/icons/tools-folder-16x16.png', () => clerk.openUserProfile())}
          <div style={{ margin: '3px 2px', borderTop: '1px solid #808080', borderBottom: '1px solid #fff' }} />
          {item(`Log Off ${name}...`, '/images/icons/logoff-16x16.png', () => clerk.signOut())}
        </div>
      )}
    </div>
  );
};

const btn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 6px',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #000',
  borderBottom: '1px solid #000',
};
const pressed: React.CSSProperties = {
  borderTop: '1px solid #000',
  borderLeft: '1px solid #000',
  borderRight: '1px solid #fff',
  borderBottom: '1px solid #fff',
};
const menu: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '100%',
  marginTop: 2,
  minWidth: 190,
  zIndex: 50,
  background: '#c0c0c0',
  border: '2px outset #fff',
  boxShadow: '1px 1px 0 #000',
  padding: 2,
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11,
  color: '#000',
};
const menuItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 20px 4px 6px',
  cursor: 'default',
  whiteSpace: 'nowrap',
};

export default AccountButton;
