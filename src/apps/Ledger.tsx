import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useApi, useMe } from '../utils/api';
import { dialog } from '../utils/dialog';
import { useWindowManager } from '../wm/manager';
import { button, shell } from './fileTypes';
import { openMusic } from './Studio';
import { caption, grid, gtd, gth, mono, paneHead, sfield, TOKENS } from './foundryModes';

// Ledger: every member sees the songs they claim space on and their own invoices (to artists, for their own work).
// Admins also get Business (Sanktuary's clients, jobs and invoices), which the server still guards with two-step.
const Business = lazy(() => import('./Business'));

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fail = (e: Error) => dialog.alert(e.message, { icon: 'error' });

interface Claim {
  track: string;
  title: string;
  releaseId: string;
  release: string;
  role: string;
  share: number;
  total: number;
  signed: boolean;
  open: boolean;
  made: number;
  releaseMade: number;
  toRecoup: number;
  yours: number;
}

/** Where a claim stands: nothing to split yet, costs coming back first, or earning. */
const stage = (r: Claim) => (r.releaseMade <= 0 ? 'Placeholder' : r.toRecoup > 0 ? 'Recouping' : 'Earning');
const nextStep = (r: Claim) =>
  r.total !== 100
    ? `The sheet adds up to ${r.total}%, not 100. Ask whoever runs the song to fix it.`
    : !r.signed
      ? 'Sign your claim: Open, then Splits.'
      : stage(r) === 'Placeholder'
        ? 'Nothing to split yet. Your space is held until the song earns.'
        : stage(r) === 'Recouping'
          ? `${usd(r.toRecoup)} of costs come back first, then it splits.`
          : 'Paid out by hand. Ask an admin when.';

// On a phone each song is a small card instead of a wide table row
const SONGS_CSS = `@container (max-width: 620px) {
.lg-t thead { display: none }
.lg-t tr { display: block; padding: 4px 0; border-bottom: 1px solid #000 }
.lg-t td { display: inline-block; border: 0 !important; white-space: normal !important; min-width: 0 !important }
.lg-t td:first-child, .lg-t td:nth-child(6) { display: block }
.lg-t td[data-l]::before { content: attr(data-l) ': '; font-weight: 700 }
}`;

const MySongs: React.FC = () => {
  const api = useApi();
  const openWindow = useWindowManager((s) => s.openWindow);
  const [rows, setRows] = useState<Claim[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/api/tracks/splits').then(
      (r) => setRows(r.splits),
      (e) => setError(e.message),
    );
  }, [api]);
  if (error) return <div style={{ padding: 12 }}>{error}</div>;
  if (!rows) return <div style={{ padding: 12 }}>Loading...</div>;
  // Your part is worked out per release (its net, shared by everyone's claims), so count each release once
  const yours = [...new Map(rows.map((r) => [r.releaseId, r.yours])).values()].reduce((a, b) => a + b, 0);
  return (
    <div style={{ ...TOKENS, flex: 1, minHeight: 0, overflow: 'auto', containerType: 'inline-size' }}>
      <style>{SONGS_CSS}</style>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '4px 6px', borderBottom: '1px solid currentColor' }}>
        <span>
          Songs <b style={mono}>{rows.length}</b>
        </span>
        <span>
          To sign <b style={mono}>{rows.filter((r) => !r.signed).length}</b>
        </span>
        <span>
          Earning <b style={mono}>{rows.filter((r) => stage(r) === 'Earning').length}</b>
        </span>
        <span>
          Your part so far <b style={mono}>{usd(yours)}</b>
        </span>
      </div>
      <div style={caption}>
        This is the space you're claiming on each song, not money yet. It only becomes a split once the song is out and has earned enough to
        share.
      </div>
      {rows.length === 0 ? (
        <p style={{ padding: 6 }}>You're not claiming space on any songs yet. When someone puts you on a song's sheet, it shows here.</p>
      ) : (
        <table style={grid} className="lg-t">
          <thead>
            <tr>
              {['Song', 'Release', 'Claiming', 'Stage', 'Song made', 'Next step', ''].map((h) => (
                <th key={h} style={gth}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.track + i}>
                <td style={{ ...gtd, fontWeight: 700 }}>{r.title}</td>
                <td data-l="Release" style={gtd}>
                  {r.release}
                </td>
                <td style={{ ...gtd, ...mono }}>
                  {r.share}%{r.role ? ` · ${r.role}` : ''}
                </td>
                <td style={gtd}>
                  {stage(r)}
                  {stage(r) === 'Recouping' && <span style={mono}> · {usd(r.toRecoup)} left</span>}
                </td>
                <td data-l="Song made" style={{ ...gtd, ...mono }}>
                  {usd(r.made)}
                </td>
                <td style={{ ...gtd, whiteSpace: 'normal', minWidth: 180 }}>{nextStep(r)}</td>
                <td style={gtd}>
                  {r.open && (
                    <button style={button} onClick={() => openMusic(openWindow)}>
                      Open
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

interface Item {
  desc: string;
  qty: number;
  rate: number;
}
interface Invoice {
  id: string;
  number: string;
  status: string;
  billTo: string;
  title: string;
  notes: string;
  items: Item[];
  deposit: number;
  issued: string | null;
  due: string | null;
  depositOn: string | null;
  paidOn: string | null;
}
interface Details {
  name: string;
  email: string;
  payment: string;
  terms: string;
}
const totalOf = (i: Pick<Invoice, 'items'>) => Math.round(i.items.reduce((n, it) => n + it.qty * it.rate, 0) * 100) / 100;
const depositOf = (i: Invoice) => Math.round(totalOf(i) * i.deposit) / 100;
const field: React.CSSProperties = { ...sfield, width: '100%', boxSizing: 'border-box' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '92px 1fr', gap: 4, alignItems: 'start', padding: '2px 6px' };

/** A text box that saves when you leave it. */
const Edit: React.FC<{ label: string; value: string; onSave: (v: string) => void; area?: boolean; type?: string }> = ({
  label,
  value,
  onSave,
  area,
  type,
}) => {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => v !== value && onSave(v);
  return (
    <label style={row}>
      <span>{label}</span>
      {area ? (
        <textarea style={{ ...field, height: 44, resize: 'vertical' }} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} />
      ) : (
        <input style={field} type={type} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} />
      )}
    </label>
  );
};

const InvoiceEditor: React.FC<{ i: Invoice; statuses: string[]; patch: (body: object) => Promise<void>; reload: () => void }> = ({
  i,
  statuses,
  patch,
  reload,
}) => {
  const api = useApi();
  const [items, setItems] = useState<Item[]>(i.items);
  useEffect(() => setItems(i.items), [i]);
  const saveItems = (next: Item[]) => patch({ items: next.filter((it) => it.desc.trim() || it.rate) });
  const set = (n: number, k: keyof Item, v: string) =>
    setItems(items.map((it, j) => (j === n ? { ...it, [k]: k === 'desc' ? v : Number(v) || 0 } : it)));
  const copyLink = async () => {
    if (i.status === 'Draft') {
      if (!(await dialog.confirm('The link only opens once the invoice is sent. Mark it as Sent?'))) return;
      await patch({ status: 'Sent' });
    }
    const r = await api(`/api/ledger/invoices/${i.id}/page`).catch(fail);
    if (!r) return;
    await navigator.clipboard?.writeText(r.link).catch(() => {});
    dialog.alert(`Send this link to the artist. It opens without an account:\n\n${r.link}`);
  };
  const preview = async () => {
    const w = window.open('', '_blank'); // opened first: browsers block pop-ups opened after waiting on the network
    if (!w) return dialog.alert('Your browser blocked the new window. Allow pop-ups for this site and try again.');
    const r = await api(`/api/ledger/invoices/${i.id}/page`).catch((e) => (w.close(), fail(e)));
    if (r) (w.document.write(r.html), w.document.close());
  };
  const live = { ...i, items };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', padding: '4px 6px', borderBottom: '1px solid #000' }}>
        <b style={{ ...mono, flex: 1 }}>{i.number}</b>
        <button style={{ ...button, fontWeight: 700 }} onClick={copyLink} disabled={i.status === 'Void'}>
          Copy link
        </button>
        <button style={button} onClick={preview}>
          Preview / PDF
        </button>
      </div>
      <label style={row}>
        <span>Status</span>
        <select style={field} value={i.status} onChange={(e) => patch({ status: e.target.value })}>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <Edit label="Bill to" area value={i.billTo} onSave={(v) => patch({ billTo: v })} />
      <Edit label="For" value={i.title} onSave={(v) => patch({ title: v })} />
      <div style={{ padding: '2px 6px' }}>
        {items.map((it, n) => (
          <div key={n} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
            <input
              style={{ ...field, flex: 1 }}
              placeholder="Shoot, edits, usage..."
              value={it.desc}
              onChange={(e) => set(n, 'desc', e.target.value)}
              onBlur={() => saveItems(items)}
            />
            <input
              style={{ ...field, width: 40 }}
              type="number"
              min={0}
              title="Quantity"
              value={it.qty}
              onChange={(e) => set(n, 'qty', e.target.value)}
              onBlur={() => saveItems(items)}
            />
            <input
              style={{ ...field, width: 72 }}
              type="number"
              min={0}
              step="0.01"
              title="Rate ($)"
              value={it.rate}
              onChange={(e) => set(n, 'rate', e.target.value)}
              onBlur={() => saveItems(items)}
            />
            <button
              style={button}
              title="Remove line"
              onClick={() => {
                const next = items.filter((_, j) => j !== n);
                setItems(next);
                saveItems(next);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button style={button} onClick={() => setItems([...items, { desc: '', qty: 1, rate: 0 }])}>
            Add line
          </button>
          <b style={mono}>Total {usd(totalOf(live))}</b>
        </div>
      </div>
      <Edit label="Deposit (%)" type="number" value={String(i.deposit)} onSave={(v) => patch({ deposit: v })} />
      {i.deposit > 0 && (
        <div style={{ ...row, ...mono }}>
          <span />
          <span>
            {usd(depositOf(live))} now, {usd(totalOf(live) - depositOf(live))} after
          </span>
        </div>
      )}
      <Edit label="Due" type="date" value={i.due || ''} onSave={(v) => patch({ due: v || null })} />
      <Edit label="Notes" area value={i.notes} onSave={(v) => patch({ notes: v })} />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 6px' }}>
        {i.deposit > 0 && i.status === 'Sent' && (
          <button style={button} onClick={() => patch({ status: 'Deposit paid' })}>
            Deposit received
          </button>
        )}
        {['Sent', 'Deposit paid'].includes(i.status) && (
          <button style={button} onClick={() => patch({ status: 'Paid' })}>
            Paid in full
          </button>
        )}
        <button
          style={button}
          onClick={() => api('/api/ledger/invoices', { method: 'POST', body: JSON.stringify({ copy: i.id }) }).then(reload, fail)}
        >
          Copy as new
        </button>
        <button
          style={button}
          onClick={async () =>
            (await dialog.confirm(`Remove ${i.number}? Its link stops working.`, { icon: 'warning' })) &&
            api(`/api/ledger/invoices/${i.id}`, { method: 'DELETE' }).then(reload, fail)
          }
        >
          Remove
        </button>
      </div>
      {(i.depositOn || i.paidOn) && (
        <div style={caption}>
          {i.depositOn ? `Deposit in ${i.depositOn}. ` : ''}
          {i.paidOn ? `Paid in full ${i.paidOn}.` : ''}
        </div>
      )}
    </div>
  );
};

const MyInvoices: React.FC = () => {
  const api = useApi();
  const [data, setData] = useState<{ invoices: Invoice[]; details: Details; statuses: string[] } | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => api('/api/ledger').then(setData, (e) => setError(e.message)), [api]);
  useEffect(() => void load(), [load]);
  if (error) return <div style={{ padding: 12 }}>{error}</div>;
  if (!data) return <div style={{ padding: 12 }}>Loading...</div>;
  const { invoices, details, statuses } = data;
  const sel = invoices.find((x) => x.id === pick) || invoices[0];
  const patch = (id: string) => (body: object) =>
    api(`/api/ledger/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(
      (x: Invoice) => setData({ ...data, invoices: invoices.map((y) => (y.id === id ? x : y)) }),
      fail,
    );
  const saveDetails = (body: Partial<Details>) =>
    api('/api/ledger/details', { method: 'PATCH', body: JSON.stringify(body) }).then(
      (d: Details) => setData({ ...data, details: { ...details, ...d } }),
      fail,
    );
  const create = () =>
    api('/api/ledger/invoices', { method: 'POST', body: JSON.stringify({}) }).then(
      (x: Invoice) => (setData({ ...data, invoices: [x, ...invoices] }), setPick(x.id)),
      fail,
    );
  const owed = invoices
    .filter((i) => ['Sent', 'Deposit paid'].includes(i.status))
    .reduce((n, i) => n + totalOf(i) - (i.status === 'Deposit paid' ? depositOf(i) : 0), 0);
  return (
    <div style={{ ...TOKENS, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', containerType: 'inline-size' }}>
      <style>{`.lg-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(220px,1fr) minmax(280px,1.3fr);overflow:hidden}
.lg-grid>section{overflow:auto;border-right:1px solid #000}
@container (max-width:620px){.lg-grid{grid-template-columns:1fr;overflow:auto}.lg-grid>section{overflow:visible;border-right:0;border-bottom:1px solid #000}}`}</style>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '4px 6px', borderBottom: '1px solid #000' }}>
        <button style={{ ...button, fontWeight: 700 }} onClick={create}>
          New invoice
        </button>
        <span>
          Invoices <b style={mono}>{invoices.length}</b>
        </span>
        <span>
          Owed to you <b style={mono}>{usd(owed)}</b>
        </span>
      </div>
      <div className="lg-grid">
        <section>
          <h4 style={paneHead}>My invoices</h4>
          {invoices.length === 0 ? (
            <p style={{ padding: 6, margin: 0 }}>
              Bill an artist for a shoot, a beat or a mix, and ask for a deposit before you start. New invoices ask for 50% up front.
            </p>
          ) : (
            <table style={grid}>
              <thead>
                <tr>
                  {['No.', 'To', 'Total', 'Status'].map((h) => (
                    <th key={h} style={gth}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setPick(i.id)}
                    style={{ cursor: 'pointer', ...(i.id === sel?.id ? { background: '#000', color: '#fff' } : {}) }}
                  >
                    <td style={{ ...gtd, ...mono }}>{i.number}</td>
                    <td style={{ ...gtd, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {i.billTo.split('\n')[0] || '-'}
                    </td>
                    <td style={{ ...gtd, ...mono }}>{usd(totalOf(i))}</td>
                    <td style={gtd}>{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details style={{ borderTop: '1px solid #000', marginTop: 8 }} open={!details.payment}>
            <summary style={{ ...paneHead, cursor: 'pointer' }}>From you, and how to pay you</summary>
            <Edit label="Your name" value={details.name} onSave={(v) => saveDetails({ name: v })} />
            <Edit label="Email" type="email" value={details.email} onSave={(v) => saveDetails({ email: v })} />
            <Edit label="How to pay" area value={details.payment} onSave={(v) => saveDetails({ payment: v })} />
            <Edit label="Small print" area value={details.terms} onSave={(v) => saveDetails({ terms: v })} />
            <div style={caption}>
              Shown on every invoice you send. The artist pays you directly (Cash App, Venmo, Zelle...): Sanktuary never holds the money.
            </div>
          </details>
        </section>
        <section>
          {sel ? (
            <InvoiceEditor key={sel.id} i={sel} statuses={statuses} patch={patch(sel.id)} reload={load} />
          ) : (
            <p style={{ padding: 6 }}>Pick an invoice, or make a new one.</p>
          )}
        </section>
      </div>
    </div>
  );
};

type Tab = 'songs' | 'invoices' | 'business';
const Ledger: React.FC = () => {
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('songs');
  const tabs: [Tab, string][] = [
    ['songs', 'My songs'],
    ['invoices', 'My invoices'],
    ...(me?.admin ? [['business', 'Business'] as [Tab, string]] : []),
  ];
  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0' }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{ ...button, fontWeight: tab === id ? 700 : 400, position: 'relative', top: tab === id ? 1 : 0 }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid #fff', display: 'flex', flexDirection: 'column' }}>
        {tab === 'business' && me?.admin ? (
          <Suspense fallback={<div style={{ padding: 12 }}>Loading...</div>}>
            <Business />
          </Suspense>
        ) : tab === 'invoices' ? (
          <MyInvoices />
        ) : (
          <MySongs />
        )}
      </div>
    </div>
  );
};

export default Ledger;
