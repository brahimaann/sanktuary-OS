import React, { useEffect, useState } from 'react';
import { useWindowManager } from '../wm/manager';
import { button, shell, statusBar } from './TeamFiles';
import RetroIcon, { IconLabel } from '../components/RetroIcon';

interface Front {
  intro: string;
  posts: { id: string; title: string; excerpt: string; url: string; image: string | null; publication: string; date: string }[];
  events: { title: string; kind: string; start: string; end: string | null; location: string; link: string | null }[];
  releases: { title: string; kind: string; date: string | null }[];
  pools?: { slug: string; title: string; goal: number; raised: number; supporters: number }[];
}
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const until = (d: string) => Math.round((Date.parse(d) - Date.parse(new Date().toLocaleDateString('en-CA'))) / 864e5);

/** The front door for visitors: who we are, latest writing, what's coming up, and a way to join. No account needed. */
const Welcome: React.FC = () => {
  const { openWindow } = useWindowManager();
  const [f, setF] = useState<Front | null>(null);
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    fetch('/api/public')
      .then((r) => r.json())
      .then(setF, () => {});
  }, []);
  const openBlog = (src = '/blog') =>
    openWindow({
      id: 'blog',
      title: 'Blog',
      icon: '/images/icons/news-16x16.png',
      appType: 'iframe',
      appProps: { src },
      width: 760,
      height: 560,
    });

  return (
    <div style={{ ...shell, overflow: 'auto' }}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <img src="/images/icons/network-32x32.png" alt="" style={{ width: 32, height: 32 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#000080' }}>Welcome to Sanktuary</div>
            <div style={{ color: '#444' }}>Twin Cities · music · art · fashion · film</div>
          </div>
        </div>
        <div style={{ ...panel, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{f ? f.intro : 'Loading...'}</div>

        {f && f.releases.length > 0 && (
          <Section title="On the way">
            {f.releases.map((r) => (
              <div key={r.title} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <RetroIcon name="note" />
                <b>{r.title}</b> <span style={{ color: '#444' }}>{r.kind}</span>
                <span style={{ flex: 1 }} />
                {r.date && <span>{until(r.date) > 0 ? `out in ${until(r.date)} days` : `out ${day(r.date)}`}</span>}
              </div>
            ))}
          </Section>
        )}

        {f && f.events.length > 0 && (
          <Section title="Coming up">
            {f.events.map((e) => (
              <div key={e.title + e.start} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 92 }}>{day(e.start)}</span>
                <b>{e.title}</b>
                <span style={{ color: '#444' }}>
                  {e.kind}
                  {e.location ? ` · ${e.location}` : ''}
                </span>
                {e.link && (
                  <a href={e.link} target="_blank" rel="noopener noreferrer">
                    details
                  </a>
                )}
              </div>
            ))}
          </Section>
        )}

        {f && f.posts.length > 0 && (
          <Section title="Latest writing">
            {f.posts.map((p) => (
              <div key={p.id} onClick={() => openBlog(p.url)} style={{ cursor: 'pointer', display: 'flex', gap: 8 }}>
                {p.image && <img src={p.image} alt="" style={{ width: 64, height: 48, objectFit: 'cover', border: '1px solid #808080' }} />}
                <div style={{ minWidth: 0 }}>
                  <b>{p.title}</b>
                  <div style={{ color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.excerpt}</div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={button}
                onClick={() =>
                  openWindow({
                    id: 'shop',
                    title: 'Shop',
                    icon: '/images/icons/favorites-16x16.png',
                    appType: 'iframe',
                    appProps: { src: '/shop' },
                    width: 760,
                    height: 560,
                  })
                }
              >
                <IconLabel icon="external">Shop</IconLabel>
              </button>
              <button style={button} onClick={() => openBlog()}>
                <IconLabel icon="external">Read the blog</IconLabel>
              </button>
            </div>
          </Section>
        )}

        {f && (f.pools?.length || 0) > 0 && (
          <Section title="Help us get there">
            {f.pools!.map((p) => (
              <div key={p.slug} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <b style={{ flex: 1 }}>{p.title}</b>
                  <span>
                    ${Math.round(p.raised).toLocaleString()}
                    {p.goal ? ` of $${Math.round(p.goal).toLocaleString()}` : ''}
                  </span>
                </div>
                {p.goal > 0 && (
                  <div style={{ height: 14, background: '#fff', border: '2px inset #808080', padding: 1 }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, (p.raised / p.goal) * 100)}%`,
                        background: 'repeating-linear-gradient(90deg,#000080 0 8px,transparent 8px 10px)',
                      }}
                    />
                  </div>
                )}
                <div>
                  <a href={`/pool/${p.slug}`} target="_blank" rel="noopener noreferrer">
                    Put in
                  </a>{' '}
                  · {p.supporters} supporters
                </div>
              </div>
            ))}
          </Section>
        )}

        <Section title="Join the Village">
          {joining ? (
            <JoinForm onDone={() => setJoining(false)} />
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 180 }}>Artist, designer, engineer, photographer or just a fan? Tell us about you.</span>
              <button style={{ ...button, fontWeight: 700 }} onClick={() => setJoining(true)}>
                <IconLabel icon="plus">Join...</IconLabel>
              </button>
            </div>
          )}
        </Section>
      </div>
      <div style={statusBar}>Already a member? Open Sanktuary Network or your profile and log on.</div>
    </div>
  );
};

const JoinForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [v, setV] = useState({ name: '', email: '', role: '', links: '', message: '', website: '' });
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/public/join', { method: 'POST', body: JSON.stringify(v) });
    if (r.ok) setSent(true);
    else setMsg(await r.text());
  };
  if (sent)
    return (
      <div>
        Thanks, {v.name.split(' ')[0]}. We read every one of these and will reach out.{' '}
        <button style={button} onClick={onDone}>
          OK
        </button>
      </div>
    );
  return (
    <form onSubmit={send} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, alignItems: 'center' }}>
      Name
      <input style={field} value={v.name} onChange={set('name')} required autoComplete="name" />
      Email
      <input style={field} type="email" value={v.email} onChange={set('email')} required autoComplete="email" />
      I'm a...
      <select style={field} value={v.role} onChange={set('role')}>
        <option value="">(choose)</option>
        {['Musician', 'Producer', 'Designer', 'Photographer', 'Videographer', 'Writer', 'Developer', 'Fan', 'Other'].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      Links
      <input style={field} value={v.links} onChange={set('links')} placeholder="Instagram, SoundCloud, portfolio..." />
      <span style={{ alignSelf: 'start' }}>Message</span>
      <textarea style={{ ...field, resize: 'vertical' }} rows={3} value={v.message} onChange={set('message')} />
      {/* Hidden from people; bots fill it in and get ignored */}
      <input
        value={v.website}
        onChange={set('website')}
        tabIndex={-1}
        autoComplete="off"
        style={{ position: 'absolute', left: -9999, width: 1, height: 1 }}
        aria-hidden
      />
      <span />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button style={{ ...button, fontWeight: 700 }} type="submit">
          Send
        </button>
        <button style={button} type="button" onClick={onDone}>
          Cancel
        </button>
        {msg && <span style={{ color: '#a00000' }}>{msg}</span>}
      </div>
    </form>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <fieldset style={{ border: '2px groove #fff', margin: 0, padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
    <legend style={{ fontWeight: 700 }}>{title}</legend>
    {children}
  </fieldset>
);

const panel: React.CSSProperties = { background: '#fff', border: '2px inset #808080', padding: 10, fontSize: 13 };
const field: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, padding: '3px 4px', border: '2px inset #808080', minWidth: 0 };

export default Welcome;
