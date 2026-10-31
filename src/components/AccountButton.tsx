import React, { useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/react';
import Avatar from '../apps/Avatar';
import RetroIcon, { IconName } from './RetroIcon';
import { useApi } from '../utils/api';
import { dialog } from '../utils/dialog';

/** Win98-style account menu (replaces Clerk's modern UserButton popup): who you are, account settings, log off. */
const AccountButton: React.FC = () => {
  const clerk = useClerk();
  const { user } = useUser();
  const api = useApi();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  // A code for a device that can't sign in itself (Internet Explorer on a Surface RT): typed into /lite/pair
  const pairDevice = async () => {
    try {
      const { code, minutes, devices } = await api('/api/pair', { method: 'POST' });
      await dialog.alert(
        `Your code: ${code.slice(0, 3)} ${code.slice(3)}\n\nOn the other device, go to ${location.host}/lite/pair and type it in. It works once, for ${minutes} minutes.` +
          (devices.length ? `\n\nAlready signed in: ${devices.map((d: { name: string }) => d.name).join(', ')}.` : ''),
        { title: 'Sign in another device', icon: 'info' },
      );
    } catch (e) {
      dialog.alert(`Couldn't make a code: ${(e as Error).message}`);
    }
  };
  const unpairAll = async () => {
    if (!(await dialog.confirm('Sign out every device you signed in with a code?'))) return;
    await api('/api/pair', { method: 'DELETE' }).then(
      () => dialog.alert('Done. Those devices are signed out.'),
      (e) => dialog.alert(`Couldn't sign them out: ${e.message}`),
    );
  };

  if (!user) return null;
  const name = user.username || user.firstName || 'you';
  const item = (label: string, icon: IconName, onClick: () => void) => (
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
      <RetroIcon name={icon} size={16} />
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
          {item('Account settings...', 'gear', () => clerk.openUserProfile())}
          {item('Sign in another device...', 'key', pairDevice)}
          {item('Sign out other devices...', 'lock', unpairAll)}
          <div style={{ margin: '3px 2px', borderTop: '1px solid #808080', borderBottom: '1px solid #fff' }} />
          {item(`Log Off ${name}...`, 'logout', () => clerk.signOut())}
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
