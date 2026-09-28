import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { LogOn, shell, button, statusBar } from './TeamFiles';
import { IconLabel } from '../components/RetroIcon';

/**
 * Outreach: who we pitch (radio, playlist curators, press, venues, brands) and where each pitch stands. Shared, so
 * nobody pitches the same curator twice. Marking one Pitched starts a 7-day clock; then whoever pitched is reminded.
 */
interface Contact {
  id: string;
  name: string;
  outlet: string;
  email: string;
  link: string;
  notes: string;
  kind: string;
  status: string;
  pitchedAt: string | null;
  pitchedBy: string | null;
  by: string;
}

const today = () => new Date().toLocaleDateString('en-CA');
const daysSince = (d: string) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
const STATUS_COLORS: Record<string, string> = {
  'To pitch': '#808080',
  Pitched: '#000080',
  Replied: '#806000',
  Yes: '#006000',
  No: '#800000',
};

const Outreach: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Outreach" />;
  return <OutreachApp />;
};

const OutreachApp: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const [data, setData] = useState<{ items: Contact[]; kinds: string[]; statuses: string[] } | null>(null);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', outlet: '', kind: 'Playlist', email: '', link: '' });
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/outreach').then(setData, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('outreach', load);
  if (!data) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;

  const patch = (c: Contact, body: object) =>
    api(`/api/outreach/${c.id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(
      () => (setMsg(''), load()),
      (e) => setMsg(e.message),
    );
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    api('/api/outreach', { method: 'POST', body: JSON.stringify(draft) }).then(
      () => (setDraft({ ...draft, name: '', outlet: '', email: '', link: '' }), setMsg(''), load()),
      (err) => setMsg(err.message),
    );
  };
  const due = (c: Contact) => c.status === 'Pitched' && !!c.pitchedAt && daysSince(c.pitchedAt) >= 7;
  const items = data.items
    .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
    .sort((a, b) => Number(due(b)) - Number(due(a)) || (a.outlet || a.name).localeCompare(b.outlet || b.name));
  const followUps = data.items.filter(due).length;

  return (
    <div style={shell}>
      <form onSubmit={add} style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', padding: 4 }}>
        <input
          style={input}
          placeholder="Name (host, curator, writer)"
          value={draft.name}
          maxLength={100}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          style={input}
          placeholder="Outlet (e.g. Radio K, blog, playlist)"
          value={draft.outlet}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, outlet: e.target.value })}
        />
        <select style={input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
          {data.kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input
          style={input}
          type="email"
          placeholder="Email"
          value={draft.email}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        />
        <input
          style={input}
          placeholder="https:// link"
          value={draft.link}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
        />
        <button type="submit" style={{ ...button, fontWeight: 700 }} disabled={!draft.name.trim() && !draft.outlet.trim()}>
          <IconLabel icon="plus">Add</IconLabel>
        </button>
        <span style={{ flex: 1 }} />
        <select style={input} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          {data.kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select style={input} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {data.statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </form>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: '0 4px' }}>
        {!items.length && (
          <div style={{ padding: 16, color: '#555' }}>
            No contacts yet. Add the radio hosts, playlist curators, writers, venues and brands you want to reach. The Pitch kit on a
            release (Songs &gt; Campaign...) has emails to start from.
          </div>
        )}
        {items.map((c) => (
          <div key={c.id} style={{ borderBottom: '1px solid #ddd', padding: '5px 8px', background: due(c) ? '#ffffe1' : undefined }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ background: STATUS_COLORS[c.status] || '#808080', color: '#fff', padding: '0 5px', fontSize: 10 }}>
                {c.status}
              </span>
              <b style={{ cursor: 'default' }} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                {c.name || c.outlet}
              </b>
              {c.name && c.outlet && <span style={{ color: '#444' }}>{c.outlet}</span>}
              <span style={{ color: '#666' }}>· {c.kind}</span>
              {c.email && <a href={`mailto:${encodeURIComponent(c.email).replace('%40', '@')}`}>{c.email}</a>}
              {c.link && (
                <a href={c.link} target="_blank" rel="noopener noreferrer">
                  link
                </a>
              )}
              <span style={{ flex: 1 }} />
              {c.pitchedAt && c.status === 'Pitched' && (
                <span style={{ color: due(c) ? '#a00000' : '#444', fontWeight: due(c) ? 700 : 400 }}>
                  pitched {c.pitchedAt} by {c.pitchedBy}
                  {due(c) ? ' · follow up' : ''}
                </span>
              )}
              <select style={input} value={c.status} onChange={(e) => patch(c, { status: e.target.value })} title="Where this pitch stands">
                {data.statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button style={button} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                {openId === c.id ? 'Less' : 'More'}
              </button>
            </div>
            {openId === c.id && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                {c.status === 'Pitched' && (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    Pitched on
                    <input
                      type="date"
                      style={input}
                      max={today()}
                      value={c.pitchedAt || ''}
                      onChange={(e) => e.target.value && patch(c, { pitchedAt: e.target.value })}
                    />
                    <span style={{ color: '#555' }}>A week later with no reply, {c.pitchedBy || 'whoever pitched'} gets a reminder.</span>
                  </label>
                )}
                <textarea
                  key={c.id} // not the text: someone else saving mustn't wipe what you are typing
                  rows={3}
                  maxLength={2000}
                  defaultValue={c.notes}
                  placeholder="Notes: what they like, what you sent, their reply..."
                  onBlur={(e) => e.target.value !== c.notes && patch(c, { notes: e.target.value })}
                  style={{ ...input, resize: 'vertical' }}
                />
                {!!me && (c.by === me.username || me.admin) && (
                  <div>
                    <button
                      style={button}
                      onClick={async () =>
                        (await dialog.confirm(`Remove ${c.name || c.outlet} from Outreach?`, { icon: 'warning' })) &&
                        api(`/api/outreach/${c.id}`, { method: 'DELETE' }).then(load, (e) => setMsg(e.message))
                      }
                    >
                      <IconLabel icon="close">Remove</IconLabel>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={statusBar}>
        {msg ||
          `${data.items.length} contact(s)${followUps ? ` · ${followUps} to follow up` : ''} · ${data.items.filter((c) => c.status === 'Yes').length} yes`}
      </div>
    </div>
  );
};

const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
  minWidth: 0,
};

export default Outreach;
