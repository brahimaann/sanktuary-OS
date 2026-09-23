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

const TABS = ['Overview', 'Clients', 'Jobs', 'Invoices', 'Documents', 'Access log'] as const;
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
        {tab === 'Clients' && <Clients {...shared} />}
        {tab === 'Jobs' && <Jobs {...shared} />}
        {tab === 'Invoices' && <Invoices {...shared} b={b} />}
        {tab === 'Documents' && <Documents b={b} clients={clients} clientName={clientName} setMsg={setMsg} />}
        {tab === 'Access log' && <AccessLog b={b} />}
      </div>
      <div style={statusBar}>{msg || 'Private: admins with two-step verification only. Every access is logged.'}</div>
    </div>
  );
};

type B = (path: string, init?: RequestInit) => Promise<any>;
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

const Clients: React.FC<Shared> = ({ clients, jobs, invoices, create, patch, remove }) => (
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
        <div>
          <button style={button} onClick={() => remove('clients', c.id, c.name)}>
            <IconLabel icon="close">Remove client</IconLabel>
          </button>
        </div>
      </>
    )}
  />
);

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
  const print = async (i: Invoice) => {
    const s: Settings = await b('/settings');
    const c = clients.find((x) => x.id === i.client);
    const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${esc(i.number)}</title><style>
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
      ${i.notes ? `<p class="muted">${esc(i.notes).replace(/\n/g, '<br>')}</p>` : ''}</body></html>`);
    w.document.close();
  };
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
