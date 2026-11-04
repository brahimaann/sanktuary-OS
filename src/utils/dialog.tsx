import React, { useEffect, useRef, useState } from 'react';
import sound from './sound';

/**
 * Win98 message boxes to replace the browser's alert / confirm / prompt.
 *   await dialog.alert('Saved.')
 *   if (await dialog.confirm('Delete it?')) ...
 *   const name = await dialog.prompt('Name:', 'default')   // null when cancelled
 * Rendered by <DialogHost />, which App mounts once over the desktop.
 */
type Icon = 'info' | 'warning' | 'error' | 'question';
interface Request {
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
  title: string;
  icon: Icon;
  value?: string;
  password?: boolean;
  ok: string;
  cancel: string;
  resolve: (v: any) => void;
}
interface Options {
  title?: string;
  icon?: Icon;
  ok?: string;
  cancel?: string;
  password?: boolean;
}

let queue: Request[] = [];
let notify: (() => void) | null = null;

const open = <T,>(r: Omit<Request, 'resolve'>) =>
  new Promise<T>((resolve) => {
    queue = [...queue, { ...r, resolve }];
    notify?.();
  });

export const dialog = {
  alert: (message: string, o: Options = {}) =>
    open<void>({
      kind: 'alert',
      message,
      title: o.title || 'Sanktuary OS',
      icon: o.icon || (/error|fail|not found|denied|can't|cannot/i.test(message) ? 'error' : 'info'),
      ok: o.ok || 'OK',
      cancel: '',
    }),
  confirm: (message: string, o: Options = {}) =>
    open<boolean>({
      kind: 'confirm',
      message,
      title: o.title || 'Confirm',
      icon: o.icon || 'question',
      ok: o.ok || 'Yes',
      cancel: o.cancel || 'No',
    }),
  prompt: (message: string, value = '', o: Options = {}) =>
    open<string | null>({
      kind: 'prompt',
      message,
      value,
      title: o.title || 'Sanktuary OS',
      icon: o.icon || 'question',
      ok: o.ok || 'OK',
      cancel: o.cancel || 'Cancel',
      password: o.password,
    }),
};

/** Shows the front dialog in the queue. Mount once, inside the desktop. */
export const DialogHost: React.FC = () => {
  const [, setTick] = useState(0);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    notify = () => setTick((t) => t + 1);
    return () => {
      notify = null;
    };
  }, []);

  const req = queue[0];
  useEffect(() => {
    if (!req) return;
    setText(req.value || '');
    if (req.kind !== 'prompt') sound.playDing();
    setTimeout(() => (req.kind === 'prompt' ? input.current?.select() : okBtn.current?.focus()), 0);
  }, [req]);

  if (!req) return null;

  const close = (answer: boolean) => {
    queue = queue.slice(1);
    req.resolve(req.kind === 'prompt' ? (answer ? text : null) : req.kind === 'confirm' ? answer : undefined);
    setTick((t) => t + 1);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.15)',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        }
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
          e.preventDefault();
          close(true);
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div role="dialog" aria-modal="true" aria-label={req.title} style={box}>
        <div style={titleBar}>
          <span style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ background: '#fff', padding: '0 8px' }}>{req.title}</span>
          </span>
          <button
            aria-label="Close"
            onClick={() => close(false)}
            style={{ ...btn, minWidth: 0, width: 16, height: 14, padding: 0, fontSize: 10, lineHeight: '10px', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '14px 14px 8px', alignItems: 'flex-start' }}>
          <img
            src={`/images/icons/${req.icon}-32x32-8bpp.png`}
            alt=""
            style={{ width: 32, height: 32, flexShrink: 0, imageRendering: 'pixelated' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{req.message}</div>
            {req.kind === 'prompt' && (
              <input
                ref={input}
                type={req.password ? 'password' : 'text'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 8,
                  fontFamily: 'inherit',
                  fontSize: 12,
                  padding: '3px 4px',
                  background: '#fff',
                  border: '2px inset #808080',
                }}
              />
            )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '6px 12px 12px' }}>
          <button ref={okBtn} style={{ ...btn, outline: '1px solid #000', outlineOffset: -4 }} onClick={() => close(true)}>
            {req.ok}
          </button>
          {req.kind !== 'alert' && (
            <button style={btn} onClick={() => close(false)}>
              {req.cancel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// The S machine alert: flat black frame, hard shadow, striped title bar like the windows
const box: React.CSSProperties = {
  width: 'min(380px, 92%)',
  background: '#fff',
  color: '#000',
  fontFamily: "'Pixelify Sans', sans-serif",
  fontSize: 13,
  border: '2px solid #000',
  boxShadow: '3px 3px 0 #000',
};
const titleBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  height: 24,
  boxSizing: 'border-box',
  borderBottom: '2px solid #000',
  fontFamily: "'Silkscreen', monospace",
  fontSize: 12,
  background: 'repeating-linear-gradient(#000 0 1px, #fff 1px 3px) content-box #fff',
};
const btn: React.CSSProperties = {
  minWidth: 75,
  padding: '4px 10px',
  background: '#fff',
  color: '#000',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  border: '2px solid #000',
};
