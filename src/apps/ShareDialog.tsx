import React, { useEffect, useState } from 'react';
import { useApi } from '../utils/api';
import { displayName, useProfiles } from '../utils/profiles';
import { Ref } from '../utils/refs';
import { liveUser } from '../utils/live';
import { dmId, RefChip } from './Chat';
import { button } from './TeamFiles';

/** Sends a link to a file/folder into a Teams channel or DM. onClose gets where it went, or nothing. */
const ShareDialog: React.FC<{ item: Ref; onClose: (sentTo?: string) => void }> = ({ item, onClose }) => {
  const api = useApi();
  const { profiles } = useProfiles();
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState('general');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const me = liveUser();

  useEffect(() => { api('/api/chat').then((d) => setChannels(d.channels), () => {}); }, [api]);

  const targets = [
    ...channels.map((c) => ({ id: c.id, label: `#${c.name}` })),
    ...profiles.filter((p) => p.username !== me).map((p) => ({ id: dmId(me, p.username), label: `DM: ${displayName(p)}` })),
  ];
  const send = async () => {
    try {
      await api(`/api/chat/${to}`, { method: 'POST', body: JSON.stringify({ text, refs: [item] }) });
      onClose(targets.find((t) => t.id === to)?.label);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div style={{ position: 'absolute', inset: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
      <div style={{ width: 'min(340px, 100%)', background: '#c0c0c0', borderTop: '2px solid #fff', borderLeft: '2px solid #fff', borderRight: '2px solid #000', borderBottom: '2px solid #000', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>Share in Sanktuary Teams</b>
        <div><RefChip r={item} /></div>
        <label>To <select value={to} onChange={(e) => setTo(e.target.value)} style={{ fontFamily: 'inherit', fontSize: 11 }}>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a message (optional)" style={{ fontFamily: 'inherit', fontSize: 11, border: '2px inset #808080', padding: 2 }} />
        {err && <div style={{ color: '#a00000' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
          <button style={button} onClick={() => onClose()}>Cancel</button>
          <button style={{ ...button, fontWeight: 700 }} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;
