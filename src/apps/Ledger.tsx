import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useApi, useMe } from '../utils/api';
import { useWindowManager } from '../wm/manager';
import { button, shell } from './fileTypes';
import { openMusic } from './Studio';
import { grid, gtd, gth, mono, TOKENS } from './foundryModes';

// Ledger: every member sees the master splits they're on. Admins also get Business (clients, jobs, invoices), which
// the server still guards with two-step verification. Invoices go to clients, so they live in Business, not per member.
const Business = lazy(() => import('./Business'));

interface Split {
  track: string;
  title: string;
  release: string;
  role: string;
  share: number;
  total: number;
  signed: boolean;
  open: boolean;
}

const MySplits: React.FC = () => {
  const api = useApi();
  const openWindow = useWindowManager((s) => s.openWindow);
  const [rows, setRows] = useState<Split[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/api/tracks/splits').then(
      (r) => setRows(r.splits),
      (e) => setError(e.message),
    );
  }, [api]);
  if (error) return <div style={{ padding: 12 }}>{error}</div>;
  if (!rows) return <div style={{ padding: 12 }}>Loading...</div>;
  const unsigned = rows.filter((r) => !r.signed).length;
  return (
    <div style={{ ...TOKENS, flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}>
      <div style={{ display: 'flex', gap: 16, padding: '4px 2px 8px', borderBottom: '1px solid currentColor' }}>
        <span>
          Songs <b style={mono}>{rows.length}</b>
        </span>
        <span>
          To sign <b style={mono}>{unsigned}</b>
        </span>
      </div>
      {rows.length === 0 ? (
        <p style={{ padding: 4 }}>You're not on any master splits yet. When someone adds you to a song's split sheet, it shows here.</p>
      ) : (
        <table style={grid}>
          <thead>
            <tr>
              {['Song', 'Release', 'Role', 'Your share', 'Sheet', 'Signed', ''].map((h) => (
                <th key={h} style={gth}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.track + i}>
                <td style={gtd}>{r.title}</td>
                <td style={gtd}>{r.release}</td>
                <td style={gtd}>{r.role || '-'}</td>
                <td style={{ ...gtd, ...mono }}>{r.share}%</td>
                <td style={{ ...gtd, ...mono }}>{r.total === 100 ? '100%' : `${r.total}% (not 100)`}</td>
                <td style={gtd}>{r.signed ? 'Yes' : 'Not yet'}</td>
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

const Ledger: React.FC = () => {
  const { me } = useMe();
  const [tab, setTab] = useState<'splits' | 'business'>('splits');
  const tabs: [typeof tab, string][] = [['splits', 'My splits'], ...(me?.admin ? [['business', 'Business'] as [typeof tab, string]] : [])];
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
        ) : (
          <MySplits />
        )}
      </div>
    </div>
  );
};

export default Ledger;
