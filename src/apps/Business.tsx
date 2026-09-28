import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { useApi } from '../utils/api';
import { dialog } from '../utils/dialog';
import { formatSize } from './fileTypes';
import { LogOn, shell, button, statusBar } from './TeamFiles';
import RetroIcon, { IconLabel } from '../components/RetroIcon';

interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  notes: string;
  status: string;
}
interface Job {
  id: string;
  title: string;
  client: string | null;
  status: string;
  amount: number;
  due: string | null;
  notes: string;
}
interface Item {
  desc: string;
  qty: number;
  rate: number;
}
interface Invoice {
  id: string;
  number: string;
  client: string | null;
  job: string | null;
  status: string;
  issued: string | null;
  due: string | null;
  paidOn: string | null;
  items: Item[];
  billTo: string;
  notes: string;
}
interface Doc {
  id: string;
  name: string;
  client: string | null;
  vault: boolean;
  size: number;
  added: string;
  addedBy: string;
}
interface Settings {
  name: string;
  address: string;
  email: string;
  payment: string;
}

/**
 * Opens a print window straight away (browsers block pop-ups opened after waiting on the network), then fills it
 * with a page built from the business details.
 */
const printWindow = async (b: B, page: (s: Settings) => string) => {
  const w = window.open('', '_blank');
  if (!w) return dialog.alert('Your browser blocked the new window. Allow pop-ups for this site and try again.');
  try {
    w.document.write(page(await b('/settings')));
    w.document.close();
  } catch (e) {
    w.close();
    dialog.alert((e as Error).message, { icon: 'error' });
  }
};

const TABS = ['Overview', 'Clients', 'Jobs', 'Invoices', 'Orders', 'Revenue', 'Documents', 'Access log'] as const;
const usd = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const total = (i: Invoice) => i.items.reduce((n, it) => n + it.qty * it.rate, 0);
const STATUSES = {
  clients: ['Lead', 'Active', 'Past'],
  jobs: ['Quote', 'In progress', 'Delivered', 'Paid', 'Cancelled'],
  invoices: ['Draft', 'Sent', 'Paid', 'Void'],
};

/**
 * Private business portal (admins only; the server also insists on two-step verification and logs every access):
 * clients, jobs, invoices with a printable copy, documents with a Tailscale-only vault, and the access log.
 */
const Business: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Business" />;
  return <BusinessApp />;
};

const BusinessApp: React.FC = () => {
  const api = useApi();
  const clerk = useClerk();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [locked, setLocked] = useState<string | null>(null); // why the server refused (two-step, not admin...)
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [msg, setMsg] = useState('');

  const b = useCallback((path: string, init?: RequestInit) => api(`/api/business${path}`, init), [api]);
  const loadAll = useCallback(async () => {
    try {
      const [c, j, i] = await Promise.all([b('/clients'), b('/jobs'), b('/invoices')]);
      setClients(c);
      setJobs(j);
      setInvoices(i);
      setLocked(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      if ([401, 403, 428].includes(err.status || 0)) setLocked(err.message);
      else setMsg(err.message);
    }
  }, [b]);
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (locked)
    return (
      <div style={{ ...shell, padding: 16, gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <RetroIcon name="lock" size={32} />
          <div>
            <b>The business portal is locked</b>
            <div style={{ marginTop: 4 }}>{locked}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={button} onClick={() => clerk.openUserProfile()}>
            <IconLabel icon="gear">Account settings...</IconLabel>
          </button>
          <button style={button} onClick={loadAll}>
            <IconLabel icon="refresh">Try again</IconLabel>
          </button>
        </div>
      </div>
    );

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name || '—';
  const create = async (kind: 'clients' | 'jobs' | 'invoices', body: object) => {
    try {
      const x = await b(`/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      await loadAll();
      return x;
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const patch = async (kind: string, id: string, body: object) => {
    try {
      await b(`/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg('');
      await loadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const remove = async (kind: string, id: string, what: string) => {
    if (!(await dialog.confirm(`Remove ${what}? It's hidden, not destroyed (still in the data file).`, { icon: 'warning' }))) return;
    await b(`/${kind}/${id}`, { method: 'DELETE' }).catch((e) => setMsg(e.message));
    loadAll();
  };
  const shared = { clients, jobs, invoices, clientName, create, patch, remove, setMsg };

  return (
    <div style={shell}>
      <div style={{ display: 'flex', gap: 2, padding: '4px 4px 0', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...button, fontWeight: tab === t ? 700 : 400, position: 'relative', top: tab === t ? 1 : 0 }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={page}>
        {tab === 'Overview' && <Overview b={b} clientName={clientName} />}
        {tab === 'Clients' && <Clients {...shared} b={b} />}
        {tab === 'Jobs' && <Jobs {...shared} />}
        {tab === 'Invoices' && <Invoices {...shared} b={b} />}
        {tab === 'Documents' && <Documents b={b} clients={clients} clientName={clientName} setMsg={setMsg} />}
        {tab === 'Orders' && <Orders b={b} setMsg={setMsg} />}
        {tab === 'Access log' && <AccessLog b={b} />}
        {tab === 'Revenue' && <Revenue b={b} />}
      </div>
      <div style={statusBar}>{msg || 'Private: admins with two-step verification only. Every access is logged.'}</div>
    </div>
  );
};

type B = (path: string, init?: RequestInit) => Promise<any>;

interface RevLine {
  id: string;
  date: string;
  type: 'income' | 'cost';
  source: string;
  amount: number;
  release: string | null;
  note: string;
  batch?: string;
}
interface RevRelease {
  id: string;
  title: string;
  artist: string;
  income: number;
  costs: number;
  net: number;
  toRecoup: number;
  parties: { name: string; share: number; amount: number }[];
}
interface RevData {
  from: string;
  to: string;
  income: number;
  costs: number;
  bySource: Record<string, number>;
  releases: RevRelease[];
  lines: RevLine[];
  shopOrders: number;
  sources: { income: string[]; cost: string[] };
  allReleases: { id: string; title: string }[];
}

/**
 * Money in and out for a period: distributor imports, shop sales, tickets, sponsorships, costs. Each release gets a
 * net-profit statement split by its master splits (Songs > a song > Master splits), printable to send to everyone on it.
 */
const Revenue: React.FC<{ b: B }> = ({ b }) => {
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toLocaleDateString('en-CA'));
  const [d, setD] = useState<RevData | null>(null);
  const [msg, setMsg] = useState('');
  const [line, setLine] = useState({
    date: new Date().toLocaleDateString('en-CA'),
    type: 'income',
    source: 'Tickets',
    amount: '',
    release: '',
    note: '',
  });
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => b(`/revenue?from=${from}&to=${to}`).then(setD, (e) => setMsg(e.message)), [b, from, to]);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <div>{msg || 'Loading...'}</div>;
  const title = (id: string | null) => d.allReleases.find((r) => r.id === id)?.title || '';

  const add = async () => {
    try {
      await b('/revenue', { method: 'POST', body: JSON.stringify({ ...line, release: line.release || null }) });
      setLine({ ...line, amount: '', note: '' });
      setMsg('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const importCsv = async (f?: File) => {
    if (!f) return;
    setMsg('Importing...');
    try {
      const r = await b('/revenue?import', { method: 'POST', body: await f.text() });
      setMsg(
        `Imported ${r.added} line(s)${r.skipped ? `, ${r.skipped} already here` : ''}${
          r.unmatched ? `. ${r.unmatched} couldn't be matched to a release (add the ISRC on the song's BMI sheet, then import again)` : ''
        }.`,
      );
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const remove = async (path: string, what: string) => {
    if (!(await dialog.confirm(`Remove ${what}?`, { icon: 'warning' }))) return;
    await b(path, { method: 'DELETE' }).then(load, (e) => setMsg(e.message));
  };
  const statement = (r: RevRelease) =>
    printWindow(b, (s) => {
      const esc = (t: string) => String(t ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
      const rows = d.lines.filter((l) => l.release === r.id);
      return `<!doctype html><html><head><title>Statement - ${esc(r.title)}</title><style>
      body{font:14px/1.45 Georgia,serif;color:#111;max-width:720px;margin:40px auto;padding:0 24px}
      h1{font:700 22px Arial,sans-serif;margin:0} .muted{color:#555} table{width:100%;border-collapse:collapse;margin:14px 0}
      th,td{text-align:left;padding:5px 4px;border-bottom:1px solid #ccc} td.n,th.n{text-align:right}
      @media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save as PDF</button>
      <h1>${esc(s.name || 'Sanktuary')}: royalty statement</h1>
      <p><b>${esc(r.title)}</b>${r.artist ? ` by ${esc(r.artist)}` : ''}<br><span class="muted">${esc(d.from)} to ${esc(d.to)}</span></p>
      <table><tr><th>Date</th><th>What</th><th>Note</th><th class="n">Amount</th></tr>
      ${rows.map((l) => `<tr><td>${esc(l.date)}</td><td>${esc(l.source)}${l.type === 'cost' ? ' (cost)' : ''}</td><td>${esc(l.note)}</td><td class="n">${l.type === 'cost' ? '-' : ''}${usd(l.amount)}</td></tr>`).join('')}
      </table>
      <p>Income ${usd(r.income)} · Costs ${usd(r.costs)} · <b>Net ${usd(r.net)}</b>${r.toRecoup ? ` · still to recoup ${usd(r.toRecoup)}` : ''}</p>
      <table><tr><th>Name</th><th class="n">Share</th><th class="n">This period</th></tr>
      ${r.parties.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${p.share}%</td><td class="n">${usd(p.amount)}</td></tr>`).join('')}
      </table>
      <p class="muted">Net profit is income minus the costs of making and releasing the recording; costs are recovered from income first.
      Shares are the master splits on file. Each line is shown rounded to the cent; the totals are exact.</p></body></html>`;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        From <input type="date" style={input} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        to <input type="date" style={input} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button
          style={button}
          onClick={() => file.current?.click()}
          title="DistroKid (Bank > See Excruciating Detail > Download) or any distributor's CSV"
        >
          <IconLabel icon="upload">Import distributor CSV...</IconLabel>
        </button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          onChange={(e) => {
            importCsv(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Stat label="Income" value={usd(d.income)} />
        <Stat label="Costs" value={usd(d.costs)} />
        <Stat label="Net" value={usd(Math.round((d.income - d.costs) * 100) / 100)} />
      </div>
      <fieldset style={fieldset}>
        <legend>Where it came from</legend>
        {Object.entries(d.bySource)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 8 }}>
              <span style={{ width: 200 }}>
                {k.split(':')[1]} {k.startsWith('cost') ? '(cost)' : ''}
              </span>
              <b style={{ color: k.startsWith('cost') ? '#a00000' : '#006000' }}>{usd(v)}</b>
            </div>
          ))}
        {!Object.keys(d.bySource).length && <div style={{ color: '#555' }}>Nothing in this period yet.</div>}
        {d.shopOrders > 0 && <div style={{ color: '#555' }}>Shop: {d.shopOrders} paid order(s), counted automatically.</div>}
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Statements by release</legend>
        {d.releases.map((r) => (
          <div key={r.id} style={{ ...box, background: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{r.title}</b>
              <span>
                in {usd(r.income)} · out {usd(r.costs)} · <b>net {usd(r.net)}</b>
              </span>
              {r.toRecoup > 0 && <span style={{ color: '#a00000' }}>still to recoup {usd(r.toRecoup)}</span>}
              <span style={{ flex: 1 }} />
              <button style={button} onClick={() => statement(r)} title="A statement to send to everyone on the split">
                Print statement
              </button>
            </div>
            {r.parties.length ? (
              <div>{r.parties.map((p) => `${p.name} ${p.share}%: ${usd(p.amount)}`).join(' · ')}</div>
            ) : (
              <div style={{ color: '#a00000' }}>No master splits yet: add them on its songs (Songs &gt; a song &gt; Master splits).</div>
            )}
          </div>
        ))}
        {!d.releases.length && <div style={{ color: '#555' }}>Lines tied to a release show up here with their split.</div>}
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Add money in or out</legend>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" style={input} value={line.date} onChange={(e) => setLine({ ...line, date: e.target.value })} />
          <select
            style={input}
            value={line.type}
            onChange={(e) => setLine({ ...line, type: e.target.value, source: d.sources[e.target.value as 'income' | 'cost'][0] })}
          >
            <option value="income">Money in</option>
            <option value="cost">Money out (cost)</option>
          </select>
          <select style={input} value={line.source} onChange={(e) => setLine({ ...line, source: e.target.value })}>
            {d.sources[line.type as 'income' | 'cost'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          $
          <input
            style={{ ...input, width: 80 }}
            type="number"
            min={0.01}
            step="0.01"
            value={line.amount}
            onChange={(e) => setLine({ ...line, amount: e.target.value })}
          />
          <select style={input} value={line.release} onChange={(e) => setLine({ ...line, release: e.target.value })}>
            <option value="">(no release)</option>
            {d.allReleases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <input
            style={{ ...input, flex: 1, minWidth: 120 }}
            placeholder="Note (venue, sponsor, vendor...)"
            value={line.note}
            onChange={(e) => setLine({ ...line, note: e.target.value })}
          />
          <button style={{ ...button, fontWeight: 700 }} disabled={!(Number(line.amount) > 0)} onClick={add}>
            Add
          </button>
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend>Lines ({d.lines.length})</legend>
        <div style={{ maxHeight: 240, overflow: 'auto', background: '#fff', border: '2px inset #808080' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td style={td}>{l.date}</td>
                  <td style={td}>{l.source}</td>
                  <td style={{ ...td, color: l.type === 'cost' ? '#a00000' : '#006000' }}>
                    {l.type === 'cost' ? '-' : ''}
                    {usd(l.amount)}
                  </td>
                  <td style={td}>{title(l.release)}</td>
                  <td style={{ ...td, whiteSpace: 'normal' }}>{l.note}</td>
                  <td style={td}>
                    <button style={button} title="Remove this line" onClick={() => remove(`/revenue/${l.id}`, 'this line')}>
                      ×
                    </button>
                    {l.batch && (
                      <button
                        style={button}
                        title="Undo the whole import this line came from"
                        onClick={() => remove(`/revenue?batch=${l.batch}`, 'that whole import')}
                      >
                        Undo import
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {msg && <div style={{ color: /^Imported/.test(msg) ? '#006000' : '#a00000' }}>{msg}</div>}
    </div>
  );
};
type Shared = {
  clients: Client[];
  jobs: Job[];
  invoices: Invoice[];
  clientName: (id: string | null) => string;
  create: (kind: 'clients' | 'jobs' | 'invoices', body: object) => Promise<any>;
  patch: (kind: string, id: string, body: object) => Promise<void>;
  remove: (kind: string, id: string, what: string) => Promise<void>;
  setMsg: (m: string) => void;
};

const Overview: React.FC<{ b: B; clientName: (id: string | null) => string }> = ({ b, clientName }) => {
  const [o, setO] = useState<any>(null);
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    b('/overview').then(setO, () => {});
    b('/settings').then(setS, () => {});
  }, [b]);
  const saveS = (k: keyof Settings, v: string) => b('/settings', { method: 'PATCH', body: JSON.stringify({ [k]: v }) }).then(setS);
  if (!o) return <div>Loading...</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {o.viaTunnel && (
        <div style={{ ...box, background: '#ffffe1' }}>
          You're on the public internet. Everything works except <b>vault</b> documents, which only open over Tailscale.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Stat label="Owed to you (sent invoices)" value={usd(o.owed)} />
        <Stat label="Paid this year" value={usd(o.paidThisYear)} />
        <Stat label="Active jobs" value={String(o.activeJobs)} />
        <Stat label="Current clients" value={String(o.clients)} />
      </div>
      <fieldset style={fieldset}>
        <legend>Overdue invoices</legend>
        {o.overdue.length === 0 ? (
          <div>None.</div>
        ) : (
          o.overdue.map((i: any) => (
            <div key={i.id} style={{ color: '#a00000' }}>
              {i.number} · {clientName(i.client)} · {usd(i.total)} · was due {i.due}
            </div>
          ))
        )}
      </fieldset>
      {s && (
        <fieldset style={fieldset}>
          <legend>Your details on invoices</legend>
          {(
            [
              ['name', 'Business name', 'e.g. Boroma Studios'],
              ['email', 'Email', 'where clients reply'],
              ['address', 'Address', 'optional'],
              ['payment', 'How to pay', 'e.g. Zelle / Venmo / bank details / pay link'],
            ] as [keyof Settings, string, string][]
          ).map(([k, label, hint]) => (
            <label key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, alignItems: 'center' }}>
              {label}
              <input
                style={input}
                defaultValue={s[k]}
                placeholder={hint}
                onBlur={(e) => e.target.value !== s[k] && saveS(k, e.target.value)}
              />
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ ...box, minWidth: 150, flex: 1, background: '#fff' }}>
    <div style={{ color: '#444' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: '#000080' }}>{value}</div>
  </div>
);

/** A table with a click-to-edit panel below it. */
function ListAndEdit<T extends { id: string }>(props: {
  rows: T[];
  columns: [string, (r: T) => React.ReactNode][];
  add: React.ReactNode;
  edit: (r: T) => React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = props.rows.find((r) => r.id === openId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>{props.add}</div>
      <div style={{ background: '#fff', border: '2px inset #808080', maxHeight: 260, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {props.columns.map(([h]) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setOpenId(r.id === openId ? null : r.id)}
                style={r.id === openId ? { background: '#000080', color: '#fff' } : undefined}
              >
                {props.columns.map(([h, f]) => (
                  <td key={h} style={td}>
                    {f(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!props.rows.length && (
              <tr>
                <td style={td} colSpan={props.columns.length}>
                  Nothing yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {open && <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 6 }}>{props.edit(open)}</div>}
    </div>
  );
}

/** Text input that saves when you leave it. */
const Field: React.FC<{ label: string; value: string; onSave: (v: string) => void; area?: boolean; type?: string }> = ({
  label,
  value,
  onSave,
  area,
  type,
}) => (
  <label style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: area ? 'start' : 'center' }}>
    {label}
    {area ? (
      <textarea
        key={value}
        rows={4}
        style={{ ...input, resize: 'vertical' }}
        defaultValue={value}
        onBlur={(e) => e.target.value !== value && onSave(e.target.value)}
      />
    ) : (
      <input
        key={value}
        type={type}
        style={input}
        defaultValue={value}
        onBlur={(e) => e.target.value !== value && onSave(e.target.value)}
      />
    )}
  </label>
);
const Pick: React.FC<{ label: string; value: string; options: [string, string][]; onSave: (v: string) => void }> = ({
  label,
  value,
  options,
  onSave,
}) => (
  <label style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' }}>
    {label}
    <select style={input} value={value} onChange={(e) => onSave(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </label>
);

/**
 * A partnership proposal letter to a venue, cafe or brand (e.g. a pop-up series): filled from the client and your
 * business details, edited here, then printed or saved as PDF.
 */
const Proposal: React.FC<{ c: Client; b: B; onClose: () => void }> = ({ c, b, onClose }) => {
  const [p, setP] = useState({
    idea: 'Sanktuary pop-up: live music, DJs and local art',
    when: 'One Sunday a month, 2-6 pm, starting [month]',
    bring:
      'Curated live sets and DJs from the Sanktuary roster\nA small art / merch table from local makers\nPromotion to our audience on Instagram, TikTok and our mailing list\nWe handle sound, setup and cleanup',
    ask: 'Use of the space and a power outlet\nA shared post on your socials before each date\n[Fee / bar split / food for the artists]',
    why: 'New customers on a slow afternoon, a regular community event tied to your name, and content you can share.',
  });
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });
  const print = () =>
    printWindow(b, (s) => {
      const esc = (t: string) => String(t ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
      const list = (t: string) =>
        `<ul>${t
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => `<li>${esc(l.trim())}</li>`)
          .join('')}</ul>`;
      return `<!doctype html><html><head><title>Proposal - ${esc(c.company || c.name)}</title><style>
      body{font:15px/1.55 Georgia,serif;color:#111;max-width:680px;margin:40px auto;padding:0 24px}
      h1{font:700 24px Arial,sans-serif;margin:0 0 4px} h2{font:700 15px Arial,sans-serif;margin:20px 0 4px} .muted{color:#555}
      @media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save as PDF</button>
      <h1>${esc(s.name || 'Sanktuary')}</h1><div class="muted">${esc(s.email)}${s.address ? `<br>${esc(s.address).replace(/\n/g, '<br>')}` : ''}</div>
      <p style="margin-top:28px">${esc(new Date().toLocaleDateString([], { dateStyle: 'long' }))}</p>
      <p>Dear ${esc(c.name)}${c.company ? `, ${esc(c.company)}` : ''},</p>
      <p>We'd love to partner with you on <b>${esc(p.idea)}</b>.</p>
      <h2>When</h2><p>${esc(p.when)}</p>
      <h2>What we bring</h2>${list(p.bring)}
      <h2>What we ask</h2>${list(p.ask)}
      <h2>Why it works for you</h2><p>${esc(p.why)}</p>
      <p>Our work, releases and past events: ${esc(location.origin)}/portfolio</p>
      <p>Thank you for considering it. We're happy to meet and walk through it.</p>
      <p>Warmly,<br>${esc(s.name || 'Sanktuary')}</p></body></html>`;
    });
  const row = (k: keyof typeof p, label: string, rows = 1) => (
    <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, alignItems: 'start' }}>
      {label}
      {rows === 1 ? (
        <input style={input} value={p[k]} onChange={set(k)} />
      ) : (
        <textarea rows={rows} style={{ ...input, resize: 'vertical' }} value={p[k]} onChange={set(k)} />
      )}
    </label>
  );
  return (
    <fieldset style={fieldset}>
      <legend>Proposal to {c.company || c.name}</legend>
      {row('idea', 'The idea')}
      {row('when', 'When')}
      {row('bring', 'What we bring (one per line)', 4)}
      {row('ask', 'What we ask (one per line)', 3)}
      {row('why', 'Why it works for them', 2)}
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ ...button, fontWeight: 700 }} onClick={print}>
          Print / PDF
        </button>
        <button style={button} onClick={onClose}>
          Close
        </button>
      </div>
    </fieldset>
  );
};

const Clients: React.FC<Shared & { b: B }> = ({ clients, jobs, invoices, create, patch, remove, b }) => {
  const [proposing, setProposing] = useState<string | null>(null);
  return (
    <ListAndEdit
      rows={clients}
      columns={[
        ['Name', (c) => <b>{c.name}</b>],
        ['Company', (c) => c.company],
        ['Email', (c) => c.email],
        ['Status', (c) => c.status],
      ]}
      add={
        <button
          style={{ ...button, fontWeight: 700 }}
          onClick={async () => {
            const name = (await dialog.prompt('Client name:', '', { title: 'Add client' }))?.trim();
            if (name) create('clients', { name });
          }}
        >
          <IconLabel icon="plus">Add client...</IconLabel>
        </button>
      }
      edit={(c) => (
        <>
          <Field label="Name" value={c.name} onSave={(v) => patch('clients', c.id, { name: v })} />
          <Field label="Company" value={c.company} onSave={(v) => patch('clients', c.id, { company: v })} />
          <Field label="Email" value={c.email} type="email" onSave={(v) => patch('clients', c.id, { email: v })} />
          <Field label="Phone" value={c.phone} type="tel" onSave={(v) => patch('clients', c.id, { phone: v })} />
          <Pick
            label="Status"
            value={c.status}
            options={STATUSES.clients.map((s) => [s, s])}
            onSave={(v) => patch('clients', c.id, { status: v })}
          />
          <Field label="Notes" value={c.notes} area onSave={(v) => patch('clients', c.id, { notes: v })} />
          <div style={{ color: '#444' }}>
            {jobs.filter((j) => j.client === c.id).length} job(s) · {invoices.filter((i) => i.client === c.id).length} invoice(s) ·{' '}
            {usd(invoices.filter((i) => i.client === c.id && i.status === 'Paid').reduce((n, i) => n + total(i), 0))} paid so far
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={button}
              onClick={() => setProposing(proposing === c.id ? null : c.id)}
              title="A partnership proposal letter (pop-up, event, sponsorship)"
            >
              Proposal...
            </button>
            <button style={button} onClick={() => remove('clients', c.id, c.name)}>
              <IconLabel icon="close">Remove client</IconLabel>
            </button>
          </div>
          {proposing === c.id && <Proposal c={c} b={b} onClose={() => setProposing(null)} />}
        </>
      )}
    />
  );
};

const Jobs: React.FC<Shared> = ({ jobs, clients, clientName, create, patch, remove }) => {
  const clientOptions: [string, string][] = [['', '(no client)'], ...clients.map((c) => [c.id, c.name] as [string, string])];
  return (
    <ListAndEdit
      rows={jobs}
      columns={[
        ['Job', (j) => <b>{j.title}</b>],
        ['Client', (j) => clientName(j.client)],
        ['Status', (j) => j.status],
        ['Amount', (j) => (j.amount ? usd(j.amount) : '')],
        ['Due', (j) => j.due || ''],
      ]}
      add={
        <button
          style={{ ...button, fontWeight: 700 }}
          onClick={async () => {
            const title = (await dialog.prompt('What is the job?', '', { title: 'Add job' }))?.trim();
            if (title) create('jobs', { title });
          }}
        >
          <IconLabel icon="plus">Add job...</IconLabel>
        </button>
      }
      edit={(j) => (
        <>
          <Field label="Job" value={j.title} onSave={(v) => patch('jobs', j.id, { title: v })} />
          <Pick label="Client" value={j.client || ''} options={clientOptions} onSave={(v) => patch('jobs', j.id, { client: v || null })} />
          <Pick
            label="Status"
            value={j.status}
            options={STATUSES.jobs.map((s) => [s, s])}
            onSave={(v) => patch('jobs', j.id, { status: v })}
          />
          <Field label="Amount ($)" value={String(j.amount || '')} type="number" onSave={(v) => patch('jobs', j.id, { amount: v || 0 })} />
          <Field label="Due" value={j.due || ''} type="date" onSave={(v) => patch('jobs', j.id, { due: v || null })} />
          <Field label="Notes" value={j.notes} area onSave={(v) => patch('jobs', j.id, { notes: v })} />
          <div>
            <button style={button} onClick={() => remove('jobs', j.id, j.title)}>
              <IconLabel icon="close">Remove job</IconLabel>
            </button>
          </div>
        </>
      )}
    />
  );
};

const Invoices: React.FC<Shared & { b: B }> = ({ invoices, clients, jobs, clientName, create, patch, remove, b }) => {
  const clientOptions: [string, string][] = [['', '(no client)'], ...clients.map((c) => [c.id, c.name] as [string, string])];
  const print = (i: Invoice) =>
    printWindow(b, (s) => {
      const c = clients.find((x) => x.id === i.client);
      const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
      return `<!doctype html><html><head><title>${esc(i.number)}</title><style>
      body{font:14px/1.45 Georgia,serif;color:#111;max-width:720px;margin:40px auto;padding:0 24px}
      h1{font:700 26px Arial,sans-serif;margin:0} .muted{color:#555} table{width:100%;border-collapse:collapse;margin:24px 0}
      th,td{text-align:left;padding:6px 4px;border-bottom:1px solid #ccc} td.n,th.n{text-align:right}
      .tot{font:700 18px Arial,sans-serif;text-align:right} .row{display:flex;justify-content:space-between;gap:24px}
      @media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save as PDF</button>
      <div class="row"><div><h1>${esc(s.name || 'Invoice')}</h1><div class="muted">${esc(s.address).replace(/\n/g, '<br>')}${s.email ? `<br>${esc(s.email)}` : ''}</div></div>
      <div style="text-align:right"><h1>INVOICE</h1><div>${esc(i.number)}</div><div class="muted">Issued ${esc(i.issued || '')}${i.due ? `<br>Due ${esc(i.due)}` : ''}</div></div></div>
      <p><b>Bill to</b><br>${esc(i.billTo || [c?.name, c?.company, c?.email].filter(Boolean).join('\n')).replace(/\n/g, '<br>')}</p>
      <table><tr><th>Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr>
      ${i.items.map((it) => `<tr><td>${esc(it.desc)}</td><td class="n">${it.qty}</td><td class="n">${usd(it.rate)}</td><td class="n">${usd(it.qty * it.rate)}</td></tr>`).join('')}
      </table><div class="tot">Total ${usd(total(i))}${i.status === 'Paid' ? ` · PAID ${esc(i.paidOn || '')}` : ''}</div>
      ${s.payment ? `<p><b>How to pay</b><br>${esc(s.payment).replace(/\n/g, '<br>')}</p>` : ''}
      ${i.notes ? `<p class="muted">${esc(i.notes).replace(/\n/g, '<br>')}</p>` : ''}</body></html>`;
    });
  return (
    <ListAndEdit
      rows={[...invoices].sort((a, b) => b.number.localeCompare(a.number))}
      columns={[
        ['Number', (i) => <b>{i.number}</b>],
        ['Client', (i) => clientName(i.client)],
        ['Issued', (i) => i.issued || ''],
        ['Due', (i) => i.due || ''],
        ['Total', (i) => usd(total(i))],
        ['Status', (i) => i.status],
      ]}
      add={
        <button style={{ ...button, fontWeight: 700 }} onClick={() => create('invoices', { client: clients[0]?.id || null })}>
          <IconLabel icon="plus">New invoice</IconLabel>
        </button>
      }
      edit={(i) => <InvoiceEditor key={i.id} i={i} clientOptions={clientOptions} jobs={jobs} patch={patch} remove={remove} print={print} />}
    />
  );
};

const InvoiceEditor: React.FC<{
  i: Invoice;
  clientOptions: [string, string][];
  jobs: Job[];
  patch: Shared['patch'];
  remove: Shared['remove'];
  print: (i: Invoice) => void;
}> = ({ i, clientOptions, jobs, patch, remove, print }) => {
  const [items, setItems] = useState<Item[]>(i.items.length ? i.items : [{ desc: '', qty: 1, rate: 0 }]);
  const saveItems = (next: Item[]) => patch('invoices', i.id, { items: next.filter((it) => it.desc.trim() || it.rate) });
  const set = (n: number, k: keyof Item, v: string) =>
    setItems(items.map((it, j) => (j === n ? { ...it, [k]: k === 'desc' ? v : Number(v) || 0 } : it)));
  return (
    <>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <b style={{ fontSize: 13, flex: 1 }}>{i.number}</b>
        <button style={{ ...button, fontWeight: 700 }} onClick={() => print(i)}>
          <IconLabel icon="external">Print / PDF...</IconLabel>
        </button>
      </div>
      <Pick label="Client" value={i.client || ''} options={clientOptions} onSave={(v) => patch('invoices', i.id, { client: v || null })} />
      <Pick
        label="Job"
        value={i.job || ''}
        options={[
          ['', '(none)'],
          ...jobs.filter((j) => !i.client || j.client === i.client).map((j) => [j.id, j.title] as [string, string]),
        ]}
        onSave={(v) => patch('invoices', i.id, { job: v || null })}
      />
      <Pick
        label="Status"
        value={i.status}
        options={STATUSES.invoices.map((s) => [s, s])}
        onSave={(v) => patch('invoices', i.id, { status: v })}
      />
      <Field label="Issued" value={i.issued || ''} type="date" onSave={(v) => patch('invoices', i.id, { issued: v || null })} />
      <Field label="Due" value={i.due || ''} type="date" onSave={(v) => patch('invoices', i.id, { due: v || null })} />
      <fieldset style={fieldset}>
        <legend>Line items</legend>
        {items.map((it, n) => (
          <div key={n} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="Description"
              value={it.desc}
              onChange={(e) => set(n, 'desc', e.target.value)}
              onBlur={() => saveItems(items)}
            />
            <input
              style={{ ...input, width: 44 }}
              type="number"
              min={0}
              value={it.qty}
              onChange={(e) => set(n, 'qty', e.target.value)}
              onBlur={() => saveItems(items)}
              title="Quantity"
            />
            <input
              style={{ ...input, width: 80 }}
              type="number"
              min={0}
              step="0.01"
              value={it.rate}
              onChange={(e) => set(n, 'rate', e.target.value)}
              onBlur={() => saveItems(items)}
              title="Rate ($)"
            />
            <span style={{ width: 80, textAlign: 'right' }}>{usd(it.qty * it.rate)}</span>
            <button
              style={button}
              title="Remove line"
              onClick={() => {
                const next = items.filter((_, j) => j !== n);
                setItems(next);
                saveItems(next);
              }}
            >
              <RetroIcon name="close" />
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button style={button} onClick={() => setItems([...items, { desc: '', qty: 1, rate: 0 }])}>
            <IconLabel icon="plus">Add line</IconLabel>
          </button>
          <b>Total {usd(items.reduce((n, it) => n + it.qty * it.rate, 0))}</b>
        </div>
      </fieldset>
      <Field label="Bill to" value={i.billTo} area onSave={(v) => patch('invoices', i.id, { billTo: v })} />
      <Field label="Notes" value={i.notes} area onSave={(v) => patch('invoices', i.id, { notes: v })} />
      <div>
        <button style={button} onClick={() => remove('invoices', i.id, i.number)}>
          <IconLabel icon="close">Remove invoice</IconLabel>
        </button>
      </div>
    </>
  );
};

const Documents: React.FC<{ b: B; clients: Client[]; clientName: (id: string | null) => string; setMsg: (m: string) => void }> = ({
  b,
  clients,
  clientName,
  setMsg,
}) => {
  const { getToken } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [client, setClient] = useState('');
  const [vault, setVault] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => b('/docs').then(setDocs, (e) => setMsg(e.message)), [b, setMsg]);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async (files: File[]) => {
    setBusy(true);
    for (const f of files) {
      const r = await fetch(`/api/business/docs?name=${encodeURIComponent(f.name)}&client=${client}&vault=${vault ? 1 : 0}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await getToken()}` },
        body: f,
      });
      if (!r.ok) setMsg(await r.text());
    }
    setBusy(false);
    load();
  };
  // The portal needs the sign-in token in a header, so files are fetched here and handed to the browser
  const open = async (d: Doc) => {
    const r = await fetch(`/api/business/docs/${d.id}/file`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (!r.ok) return setMsg(await r.text());
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = d.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={{ ...button, fontWeight: 700 }} disabled={busy} onClick={() => input.current?.click()}>
          <IconLabel icon="upload">{busy ? 'Uploading...' : 'Upload...'}</IconLabel>
        </button>
        for
        <select style={inputStyle} value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">(no client)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label
          style={{ display: 'flex', gap: 3, alignItems: 'center' }}
          title="Vault documents only open over Tailscale, never over the public internet"
        >
          <input type="checkbox" checked={vault} onChange={(e) => setVault(e.target.checked)} />
          🔒 Vault (Tailscale only)
        </label>
        <input ref={input} type="file" multiple hidden onChange={(e) => (upload([...(e.target.files || [])]), (e.target.value = ''))} />
      </div>
      <div style={{ background: '#fff', border: '2px inset #808080', maxHeight: 320, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Client', 'Size', 'Added', ''].map((h) => (
                <th key={h} style={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td style={td}>
                  {d.vault ? '🔒 ' : ''}
                  <b>{d.name}</b>
                </td>
                <td style={td}>{clientName(d.client)}</td>
                <td style={td}>{formatSize(d.size)}</td>
                <td style={td}>
                  {new Date(d.added).toLocaleDateString()} · {d.addedBy}
                </td>
                <td style={{ ...td, display: 'flex', gap: 4 }}>
                  <button style={button} onClick={() => open(d)}>
                    <IconLabel icon="download">Open</IconLabel>
                  </button>
                  <button
                    style={button}
                    onClick={() =>
                      b(`/docs/${d.id}`, { method: 'PATCH', body: JSON.stringify({ vault: !d.vault }) }).then(load, (e) =>
                        setMsg(e.message),
                      )
                    }
                  >
                    {d.vault ? 'Unvault' : 'Vault'}
                  </button>
                  <button
                    style={button}
                    title="Hide it (the file stays on the PC)"
                    onClick={async () =>
                      (await dialog.confirm(`Remove ${d.name} from the portal? The file stays on the PC.`, { icon: 'warning' })) &&
                      b(`/docs/${d.id}`, { method: 'DELETE' }).then(load, (e) => setMsg(e.message))
                    }
                  >
                    <RetroIcon name="close" />
                  </button>
                </td>
              </tr>
            ))}
            {!docs.length && (
              <tr>
                <td style={td} colSpan={5}>
                  No documents yet. Contracts, briefs, receipts... are stored on the PC itself, not on a USB space.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type Order = {
  id: string;
  title: string;
  kind: string;
  qty: number;
  amount: number;
  status: string;
  paid?: string;
  note?: string;
  customer?: {
    name: string;
    email: string;
    shipTo: string | null;
    address: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } | null;
  };
};

/** Shop orders: who bought what, where to ship it, and where it's at. */
const Orders: React.FC<{ b: B; setMsg: (m: string) => void }> = ({ b, setMsg }) => {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const load = useCallback(() => b('/orders').then(setOrders, (e) => setMsg(e.message)), [b, setMsg]);
  useEffect(() => {
    load();
  }, [load]);
  if (!orders) return <div>Loading...</div>;
  if (!orders.length) return <div>No orders yet. Products are set up in Admin Panel &gt; Shop &amp; pool.</div>;
  const todo = orders.filter((o) => o.status === 'Paid');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <b>{todo.length}</b> to ship · {orders.length} orders ·{' '}
        {usd(orders.filter((o) => o.status !== 'Refunded').reduce((n, o) => n + o.amount, 0))} total
      </div>
      {orders.map((o) => {
        const a = o.customer?.address;
        return (
          <div
            key={o.id}
            style={{ ...box, background: o.status === 'Paid' ? '#ffffe1' : '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>
                {o.qty} × {o.title}
              </b>
              <span>{usd(o.amount)}</span>
              <span style={{ color: '#555' }}>{o.paid ? new Date(o.paid).toLocaleString() : ''}</span>
              <span style={{ flex: 1 }} />
              <select
                style={input}
                value={o.status}
                onChange={(e) =>
                  b(`/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }).then(load, (err) =>
                    setMsg(err.message),
                  )
                }
              >
                {(o.status === 'Oversold' ? ['Oversold', 'Refunded'] : ['Paid', 'Shipped', 'Delivered', 'Refunded']).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {o.status === 'Oversold' && (
              <div style={{ color: '#a00000' }}>
                Paid after the last ones sold (their checkout ran out). Refund it in the Stripe dashboard, then mark it Refunded.
              </div>
            )}
            <div>
              {o.customer?.name} · <a href={`mailto:${o.customer?.email}`}>{o.customer?.email}</a>
              {o.kind === 'digital' && ' · digital, delivered automatically'}
            </div>
            {a && (
              <div style={{ whiteSpace: 'pre-line', fontFamily: 'Consolas, monospace' }}>
                {[o.customer?.shipTo, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country]
                  .filter(Boolean)
                  .join('\n')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const AccessLog: React.FC<{ b: B }> = ({ b }) => {
  const [log, setLog] = useState<{ at: string; user: string; action: string; what: string; ip: string; via: string }[] | null>(null);
  useEffect(() => {
    b('/audit').then(setLog, () => setLog([]));
  }, [b]);
  return (
    <div
      style={{
        background: '#000',
        color: '#c0c0c0',
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 12,
        padding: 8,
        border: '2px inset #808080',
        minHeight: 200,
        maxHeight: 420,
        overflow: 'auto',
        whiteSpace: 'pre',
      }}
    >
      {!log && 'Loading...'}
      {log?.map((e, i) => (
        <div key={i}>
          <span style={{ color: '#808080' }}>{new Date(e.at).toLocaleString()}</span> <span style={{ color: '#ffff55' }}>{e.user}</span>{' '}
          {e.action} {e.what && <span style={{ color: '#55ffff' }}>{e.what}</span>}{' '}
          <span style={{ color: e.via === 'internet' ? '#ff8855' : '#55ff55' }}>
            ({e.via} · {e.ip})
          </span>
        </div>
      ))}
    </div>
  );
};

const page: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #404040',
  borderBottom: '1px solid #404040',
  margin: '0 4px',
  padding: 10,
};
const box: React.CSSProperties = { border: '2px groove #fff', padding: 8 };
const fieldset: React.CSSProperties = {
  border: '2px groove #fff',
  margin: 0,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const th: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  textAlign: 'left',
  fontWeight: 400,
  padding: '2px 6px',
  background: '#c0c0c0',
  borderRight: '1px solid #808080',
  borderBottom: '1px solid #808080',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '3px 6px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap', cursor: 'default' };
const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 4px',
  background: '#fff',
  border: '2px inset #808080',
  minWidth: 0,
};
const inputStyle = input;

export default Business;
