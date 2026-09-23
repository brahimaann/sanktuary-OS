import React, { useCallback, useEffect, useState } from 'react';
import { IconLabel } from '../components/RetroIcon';
import { useApi } from '../utils/api';
import { displayName, useProfiles } from '../utils/profiles';
import { Ref } from '../utils/refs';
import { liveUser } from '../utils/live';
import { dmId, RefChip } from './Chat';
import { button } from './TeamFiles';

interface Link {
  token: string;
  url: string;
  createdBy: string;
  created: string;
  expires: string | null;
  password: boolean;
  download: boolean;
  revoked: boolean;
  views: number;
  downloads: number;
  lastOpened: string | null;
}

/**
 * Share a file/folder: send it into a Teams channel or DM, or make a public link for people without an
 * account (expiry, optional password, downloads on/off; views and downloads are counted).
 * onClose gets where it went, or nothing.
 */
const ShareDialog: React.FC<{ item: Ref; onClose: (sentTo?: string) => void }> = ({ item, onClose }) => {
  const [tab, setTab] = useState<'teams' | 'link'>('teams');
  return (
    <div style={{ position: 'absolute', inset: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
      <div style={dlg}>
        <div style={{ display: 'flex', gap: 2 }}>
          {(['teams', 'link'] as const).map((t) => (
            <button key={t} style={{ ...button, fontWeight: tab === t ? 700 : 400 }} onClick={() => setTab(t)}>
              {t === 'teams' ? 'Send in Teams' : 'Public link'}
            </button>
          ))}
        </div>
        <div>
          <RefChip r={item} />
        </div>
        {tab === 'teams' ? <SendInTeams item={item} onClose={onClose} /> : <PublicLinks item={item} onClose={() => onClose()} />}
      </div>
    </div>
  );
};

const SendInTeams: React.FC<{ item: Ref; onClose: (sentTo?: string) => void }> = ({ item, onClose }) => {
  const api = useApi();
  const { profiles } = useProfiles();
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState('general');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const me = liveUser();

  useEffect(() => {
    api('/api/chat').then(
      (d) => setChannels(d.channels),
      () => {},
    );
  }, [api]);

  const targets = [
    ...channels.map((c) => ({ id: c.id, label: `#${c.name}` })),
    ...profiles.filter((p) => p.username !== me).map((p) => ({ id: dmId(me, p.username), label: `DM: ${displayName(p)}` })),
  ];
  const send = async () => {
    try {
      await api(`/api/chat/${to}`, { method: 'POST', body: JSON.stringify({ text, refs: [item] }) });
      onClose(targets.find((t) => t.id === to)?.label);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <label>
        To{' '}
        <select value={to} onChange={(e) => setTo(e.target.value)} style={field}>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a message (optional)" style={field} />
      {err && <div style={{ color: '#a00000' }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
        <button style={button} onClick={() => onClose()}>
          Cancel
        </button>
        <button style={{ ...button, fontWeight: 700 }} onClick={send}>
          <IconLabel icon="share">Send</IconLabel>
        </button>
      </div>
    </>
  );
};

const PublicLinks: React.FC<{ item: Ref; onClose: () => void }> = ({ item, onClose }) => {
  const api = useApi();
  const [links, setLinks] = useState<Link[]>([]);
  const [days, setDays] = useState(7);
  const [password, setPassword] = useState('');
  const [download, setDownload] = useState(true);
  const [msg, setMsg] = useState('');
  const path = [...(item.dir || []), item.name].join('/');
  const qs = `space=${encodeURIComponent(item.app || '')}&path=${encodeURIComponent(path)}`;

  const load = useCallback(() => api(`/api/links?${qs}`).then(setLinks, (e) => setMsg(e.message)), [api, qs]);
  useEffect(() => {
    load();
  }, [load]);

  const full = (l: Link) => `${location.origin}${l.url}`;
  const copy = async (l: Link) => {
    try {
      await navigator.clipboard.writeText(full(l));
      setMsg('Link copied.');
    } catch {
      setMsg(full(l)); // no clipboard access: show it to copy by hand
    }
  };
  const create = async () => {
    try {
      const l: Link = await api('/api/links', {
        method: 'POST',
        body: JSON.stringify({ space: item.app, path, days, password, download }),
      });
      setPassword('');
      await load();
      copy(l);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const revoke = async (l: Link) => {
    try {
      await api(`/api/links/${l.token}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const live = links.filter((l) => !l.revoked && (!l.expires || Date.parse(l.expires) > Date.now()));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, alignItems: 'center' }}>
        Expires
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={field}>
          <option value={1}>in 1 day</option>
          <option value={7}>in 7 days</option>
          <option value={30}>in 30 days</option>
          <option value={90}>in 90 days</option>
          <option value={0}>never</option>
        </select>
        Password
        <input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="(none)"
          autoComplete="off"
          style={field}
        />
        <span />
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />
          Allow downloads (off = stream and view only)
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
        <button style={{ ...button, fontWeight: 700 }} onClick={create}>
          <IconLabel icon="link">Create link</IconLabel>
        </button>
      </div>
      {live.length > 0 && (
        <div style={{ background: '#fff', border: '2px inset #808080', maxHeight: 150, overflow: 'auto' }}>
          {live.map((l) => (
            <div key={l.token} style={{ padding: 4, borderBottom: '1px solid #eee' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.password ? '🔑 ' : ''}
                  {l.download ? '' : '👁 '}by {l.createdBy} · {l.expires ? `until ${new Date(l.expires).toLocaleDateString()}` : 'no expiry'}
                </span>
                <button style={button} onClick={() => copy(l)}>
                  <IconLabel icon="link">Copy</IconLabel>
                </button>
                <button style={button} onClick={() => revoke(l)}>
                  <IconLabel icon="close">Turn off</IconLabel>
                </button>
              </div>
              <div style={{ color: '#555' }}>
                {l.views} view(s) · {l.downloads} download(s)
                {l.lastOpened ? ` · last opened ${new Date(l.lastOpened).toLocaleString()}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {msg && <div style={{ color: msg === 'Link copied.' ? '#000080' : '#a00000', wordBreak: 'break-all' }}>{msg}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={button} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
};

const dlg: React.CSSProperties = {
  width: 'min(380px, 100%)',
  maxHeight: '100%',
  overflow: 'auto',
  background: '#c0c0c0',
  borderTop: '2px solid #fff',
  borderLeft: '2px solid #fff',
  borderRight: '2px solid #000',
  borderBottom: '2px solid #000',
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const field: React.CSSProperties = { fontFamily: 'inherit', fontSize: 11, border: '2px inset #808080', padding: 2 };

export default ShareDialog;
