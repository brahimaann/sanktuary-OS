import React, { useEffect, useRef, useState } from 'react';
import FilePicker, { FileRef } from './FilePicker';
import { IconLabel } from './RetroIcon';

/**
 * "Add file..." for touch screens as much as desktops: a small Win98 menu with
 * From this device... (the phone's photos / files, or the computer's) and From Sanktuary... (a team space).
 */
const AddFileButton: React.FC<{
  label?: string;
  accept?: string; // for the device picker, e.g. "image/*"
  onDevice: (files: File[]) => void;
  onServer: (ref: FileRef) => void;
  serverAccept?: (name: string) => boolean;
  style: React.CSSProperties;
  up?: boolean; // open the menu upward (a composer at the bottom of a window)
}> = ({ label = 'Add file...', accept, onDevice, onServer, serverAccept, style, up }) => {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const item: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    background: 'none',
    border: 0,
    font: 'inherit',
    cursor: 'default',
  };
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-block' }}>
      <button style={style} onClick={() => setOpen(!open)}>
        <IconLabel icon="plus">{label}</IconLabel>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            left: 0,
            ...(up ? { bottom: '100%', marginBottom: 2 } : { top: '100%', marginTop: 2 }),
            zIndex: 30,
            minWidth: 190,
            background: '#c0c0c0',
            border: '2px outset #fff',
            boxShadow: '1px 1px 0 #000',
          }}
        >
          <button
            style={item}
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            <IconLabel icon="upload">From this device...</IconLabel>
          </button>
          <button
            style={item}
            onClick={() => {
              setOpen(false);
              setPicking(true);
            }}
          >
            <IconLabel icon="link">From Sanktuary...</IconLabel>
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={accept}
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          if (files.length) onDevice(files);
        }}
      />
      {picking && (
        // The picker covers the window it's in, so it's rendered at the window level by position: fixed
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000 }}>
          <FilePicker
            title="Choose a file from Sanktuary"
            mode="file"
            accept={serverAccept}
            onPick={(r) => {
              setPicking(false);
              if (r) onServer(r);
            }}
          />
        </div>
      )}
    </span>
  );
};

export default AddFileButton;
