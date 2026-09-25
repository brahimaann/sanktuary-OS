import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { parseWhen, describeWhen } from '../utils/when';
import { dialog } from '../utils/dialog';
import { LogOn, shell, button, statusBar } from './TeamFiles';
import { IconLabel } from '../components/RetroIcon';

// Grants, residencies, open calls, gigs and jobs posted for the team. Post the link and the deadline; everyone
// hears about it; each person marks where they are with it; reminders go out a week and a day before.
interface Opp {
  id: string;
  title: string;
  org: string;
  kind: string;
  amount: string;
  notes: string;
  link: string;
  deadline: string | null;
  fields: string[];
  people: Record<string, Status>;
  mine: Status | null;
  by: string;
  created: string;
}
type Status = 'interested' | 'applying' | 'applied' | 'no';
const STATUS: [Status, string][] = [
  ['interested', 'Interested'],
  ['applying', 'Applying'],
  ['applied', 'Applied'],
  ['no', 'Not for me'],
];
const today = () => new Date().toLocaleDateString('en-CA');
const daysLeft = (d: string) => Math.round((Date.parse(d) - Date.parse(today())) / 864e5);
const dueText = (d: string | null) => {
  if (!d) return 'Rolling / no deadline';
  const n = daysLeft(d);
  const date = new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return n < 0 ? `Closed ${date}` : n === 0 ? `Due today (${date})` : n === 1 ? `Due tomorrow (${date})` : `Due in ${n} days (${date})`;
};

const Opportunities: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Opportunities" />;
  return <Board />;
};

const Board: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const [data, setData] = useState<{ items: Opp[]; fields: string[]; kinds: string[] } | null>(null);
  const [field, setField] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/api/opportunities').then(setData, (e) => setMsg(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('opportunities', load);
  if (!data) return <div style={{ ...shell, padding: 16 }}>{msg || 'Loading...'}</div>;

  const patch = (o: Opp, body: object) =>
    api(`/api/opportunities/${o.id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(load, (e) => setMsg(e.message));
  const copyPortfolio = () => {
    const url = `${location.origin}/portfolio`;
    navigator.clipboard?.writeText(url).then(
      () => setMsg(`Copied ${url}: paste it where the application asks for work samples.`),
      () => setMsg(url),
    );
  };
  const items = data.items
    .filter((o) => !field || o.fields.includes(field) || o.fields.includes('Any') || !o.fields.length)
    .filter((o) => showPast || !o.deadline || daysLeft(o.deadline) >= 0)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const open = data.items.filter((o) => !o.deadline || daysLeft(o.deadline) >= 0).length;

  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: 4 }}>
        <button style={{ ...button, fontWeight: 700 }} onClick={() => setAdding(true)}>
          <IconLabel icon="plus">Post an opportunity...</IconLabel>
        </button>
        <select style={field_} value={field} onChange={(e) => setField(e.target.value)} title="Show only what fits">
          <option value="">All fields</option>
          {data.fields
            .filter((f) => f !== 'Any')
            .map((f) => (
              <option key={f}>{f}</option>
            ))}
        </select>
        <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          Show past
        </label>
        <span style={{ flex: 1 }} />
        <button style={button} onClick={copyPortfolio} title="Your portfolio page, for 'work samples' fields">
          Copy portfolio link
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: '0 4px' }}>
        {!items.length && (
          <div style={{ padding: 16, color: '#555' }}>
            Nothing here yet. Found a grant, a residency, an open call or a gig? <b>Post an opportunity</b>: paste the link and the
            deadline, and the whole team hears about it.
          </div>
        )}
        {items.map((o) => {
          const who = Object.entries(o.people).filter(([, s]) => s === 'applying' || s === 'applied');
          const soon = o.deadline && daysLeft(o.deadline) >= 0 && daysLeft(o.deadline) <= 7;
          const past = o.deadline && daysLeft(o.deadline) < 0;
          const canEdit = !!me && (o.by === me.username || me.admin);
          return (
            <div key={o.id} style={{ padding: '8px 10px', borderBottom: '1px solid #ddd', opacity: past || o.mine === 'no' ? 0.55 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ background: '#000080', color: '#fff', padding: '0 5px', fontSize: 10 }}>{o.kind}</span>
                <b style={{ fontSize: 13 }}>{o.title}</b>
                {o.org && <span style={{ color: '#444' }}>{o.org}</span>}
                {o.amount && <span style={{ color: '#006000', fontWeight: 700 }}>{o.amount}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ color: soon ? '#a00000' : '#444', fontWeight: soon ? 700 : 400 }}>{dueText(o.deadline)}</span>
              </div>
              {o.fields.length > 0 && <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>For: {o.fields.join(', ')}</div>}
              {o.notes && <div style={{ whiteSpace: 'pre-wrap', margin: '6px 0', lineHeight: 1.4 }}>{o.notes}</div>}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                {o.link && (
                  <a
                    href={o.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...button, textDecoration: 'none', color: '#000', fontWeight: 700 }}
                  >
                    <IconLabel icon="external">Open & apply</IconLabel>
                  </a>
                )}
                {STATUS.map(([s, label]) => (
                  <button
                    key={s}
                    style={{ ...button, ...(o.mine === s ? { background: '#000080', color: '#fff' } : {}) }}
                    onClick={() => patch(o, { status: o.mine === s ? null : s })}
                    title={s === 'interested' || s === 'applying' ? "You'll be reminded a week and a day before the deadline" : undefined}
                  >
                    {label}
                  </button>
                ))}
                <span style={{ color: '#444' }}>
                  {who.length ? `${who.map(([u, s]) => `${u}${s === 'applied' ? ' ✓' : ''}`).join(', ')} going for it` : ''}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ color: '#888', fontSize: 10 }}>posted by {o.by}</span>
                {canEdit && (
                  <button
                    style={button}
                    onClick={async () =>
                      (await dialog.confirm(`Take down "${o.title}"?`, { icon: 'warning' })) &&
                      api(`/api/opportunities/${o.id}`, { method: 'DELETE' }).then(load, (e) => setMsg(e.message))
                    }
                  >
                    Take down
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={statusBar}>{msg || `${open} open opportunit${open === 1 ? 'y' : 'ies'}`}</div>
      {adding && (
        <PostForm
          fields={data.fields}
          kinds={data.kinds}
          onDone={(text) => {
            setAdding(false);
            if (text) setMsg(text);
            load();
          }}
        />
      )}
    </div>
  );
};

const PostForm: React.FC<{ fields: string[]; kinds: string[]; onDone: (msg?: string) => void }> = ({ fields, kinds, onDone }) => {
  const api = useApi();
  const [v, setV] = useState({ link: '', title: '', org: '', kind: 'Grant', when: '', amount: '', notes: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const parsed = parseWhen(v.when);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });
  const post = async () => {
    if (v.when.trim() && !parsed) return setErr(`Couldn't read "${v.when}" as a date. Try "oct 31" or "10/31".`);
    try {
      const o = await api('/api/opportunities', {
        method: 'POST',
        body: JSON.stringify({ ...v, link: v.link.trim(), deadline: parsed?.date ?? null, fields: picked }),
      });
      onDone(`Posted "${o.title}". The team has been told.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' };
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div style={{ width: 'min(480px, 96%)', maxHeight: '96%', overflow: 'auto', background: '#c0c0c0', border: '2px outset #fff' }}>
        <div style={{ background: 'linear-gradient(90deg,#000080,#1084d0)', color: '#fff', fontWeight: 700, padding: '3px 6px' }}>
          Post an opportunity
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={row}>
            Link
            <input
              style={field_}
              value={v.link}
              onChange={set('link')}
              placeholder="https://... (where to read about it and apply)"
              autoFocus
            />
          </label>
          <label style={row}>
            Name
            <input style={field_} value={v.title} onChange={set('title')} placeholder="e.g. Creative Support for Individuals" />
          </label>
          <label style={row}>
            From
            <input style={field_} value={v.org} onChange={set('org')} placeholder="e.g. Minnesota State Arts Board" />
          </label>
          <label style={row}>
            Kind
            <select style={field_} value={v.kind} onChange={set('kind')}>
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label style={row}>
            Deadline
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input style={{ ...field_, width: 130 }} value={v.when} onChange={set('when')} placeholder="oct 31 (optional)" />
              <span style={{ color: v.when && !parsed ? '#a00000' : '#000080' }}>
                {parsed ? `→ ${describeWhen({ ...parsed, time: '' })}` : v.when ? "can't read that yet" : ''}
              </span>
            </span>
          </label>
          <label style={row}>
            Amount
            <input style={field_} value={v.amount} onChange={set('amount')} placeholder="e.g. up to $6,000 (optional)" />
          </label>
          <div style={row}>
            <span>For</span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {fields.map((f) => (
                <label key={f} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(f)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, f] : picked.filter((x) => x !== f))}
                  />
                  {f}
                </label>
              ))}
            </span>
          </div>
          <label style={{ ...row, alignItems: 'start' }}>
            What it asks
            <textarea
              style={{ ...field_, resize: 'vertical' }}
              rows={4}
              value={v.notes}
              onChange={set('notes')}
              placeholder="Who can apply, what to send (work samples, budget, statement...), anything to know."
            />
          </label>
          {err && <div style={{ color: '#a00000' }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button style={button} onClick={() => onDone()}>
              Cancel
            </button>
            <button style={{ ...button, fontWeight: 700 }} disabled={!v.title.trim()} onClick={post}>
              Post and tell the team
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const field_: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default Opportunities;
