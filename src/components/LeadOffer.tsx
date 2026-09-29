import React, { useEffect, useState } from 'react';

/**
 * For visitors: after 10 seconds, a small Win98 dialog offering the mailing list (the free guides). Closing it or
 * signing up means it never comes back on this device. Only shows when the list is open (email set up on the server).
 */
const SEEN = 'sk_lead_seen';

const LeadOffer: React.FC = () => {
  const [offer, setOffer] = useState<{ title: string; text: string } | null>(null);
  const [f, setF] = useState({ email: '', name: '', consent: false, website: '' });
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN)) return;
    } catch {
      return; // no storage: we couldn't remember a "no", so don't ask at all
    }
    const t = setTimeout(
      () =>
        fetch('/api/mail')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.open && setOffer({ title: d.title, text: d.text }))
          .catch(() => {}),
      10_000,
    );
    return () => clearTimeout(t);
  }, []);
  const close = () => {
    try {
      localStorage.setItem(SEEN, '1');
    } catch {}
    setOffer(null);
  };
  if (!offer) return null;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('Sending...');
    const r = await fetch('/api/mail/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...f, source: 'popup' }),
    }).catch(() => null);
    if (r?.ok) {
      setDone(true);
      try {
        localStorage.setItem(SEEN, '1');
      } catch {}
    } else setMsg(r ? await r.text() : "Couldn't send. Check your connection.");
  };
  return (
    <div
      role="dialog"
      aria-label={offer.title}
      onPointerDown={(e) => e.stopPropagation()} // clicks here aren't desktop clicks (no selection box)
      style={{
        position: 'absolute',
        right: 12,
        bottom: 44,
        width: 'min(340px, calc(100% - 24px))',
        zIndex: 99990,
        background: '#c0c0c0',
        border: '2px outset #fff',
        boxShadow: '2px 2px 0 #000',
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'linear-gradient(90deg,#000080,#1084d0)',
          color: '#fff',
          fontWeight: 700,
          padding: '2px 4px',
        }}
      >
        <span style={{ flex: 1 }}>{offer.title}</span>
        <button
          onClick={close}
          aria-label="Close"
          style={{
            width: 18,
            height: 16,
            lineHeight: '10px',
            padding: 0,
            border: '2px outset #fff',
            background: '#c0c0c0',
            fontWeight: 700,
          }}
        >
          ×
        </button>
      </div>
      {done ? (
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <b>Check your email</b>
          <div>We sent a link to confirm. The guides come right after.</div>
          <button onClick={close} style={{ alignSelf: 'flex-end', padding: '2px 12px', border: '2px outset #fff', background: '#c0c0c0' }}>
            OK
          </button>
        </div>
      ) : (
        <form onSubmit={send} style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>{offer.text}</div>
          <input
            type="email"
            required
            placeholder="Email"
            autoComplete="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            style={field}
          />
          <input
            placeholder="First name (optional)"
            autoComplete="given-name"
            maxLength={60}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            style={field}
          />
          <label style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
            Email me Sanktuary news and the free guides. Unsubscribe any time.
          </label>
          {/* honeypot: hidden from people, bots fill it in */}
          <input
            value={f.website}
            onChange={(e) => setF({ ...f, website: e.target.value })}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: -9999, width: 1, height: 1 }}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="submit"
              disabled={!f.consent}
              style={{ padding: '2px 12px', border: '2px outset #fff', background: '#c0c0c0', fontWeight: 700 }}
            >
              Send me the guides
            </button>
            <button type="button" onClick={close} style={{ padding: '2px 10px', border: '2px outset #fff', background: '#c0c0c0' }}>
              No thanks
            </button>
          </div>
          {msg && msg !== 'Sending...' && <div style={{ color: '#a00000' }}>{msg}</div>}
        </form>
      )}
    </div>
  );
};

const field: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, padding: '3px 4px', border: '2px inset #808080', minWidth: 0 };

export default LeadOffer;
