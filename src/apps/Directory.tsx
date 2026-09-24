import React, { useEffect, useRef, useState } from 'react';
import { useWindowManager } from '../wm/manager';
import { button, shell, statusBar } from './TeamFiles';

// My Computer, as the public directory of the studio: who's here, what's out and coming, where to see us,
// what we write and sell. No account needed. Only what was made public shows: people who ticked "Show me in the
// public directory" in their profile, releases marked "Announce publicly", timeline entries marked "Show publicly".
interface Person {
  username: string;
  displayName: string;
  role: string;
  bio: string;
  links: Partial<Record<'soundcloud' | 'instagram' | 'website', string>>;
  avatar: boolean;
}
interface Dir {
  intro: string;
  people: Person[];
  releases: { title: string; kind: string; date: string | null; tracks: number }[];
  events: {
    title: string;
    kind: string;
    start: string;
    end: string | null;
    time: string;
    location: string;
    link: string | null;
    past: boolean;
  }[];
  posts: { id: string; title: string; excerpt: string; url: string; publication: string; date: string }[];
  products: { slug: string; title: string; price: number; kind: string; soldOut: boolean }[];
  pools: { slug: string; title: string; goal: number; raised: number; supporters: number }[];
}
type Section = 'people' | 'releases' | 'events' | 'posts' | 'products' | 'pools';
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'people', label: 'People', icon: 'my-documents-folder' },
  { id: 'releases', label: 'Releases', icon: 'media-player' },
  { id: 'events', label: 'Events', icon: 'task' },
  { id: 'posts', label: 'Writing', icon: 'news' },
  { id: 'products', label: 'Shop', icon: 'favorites-folder' },
  { id: 'pools', label: 'Money pools', icon: 'internet-folder' },
];
const icon = (name: string, size: 16 | 32) => `/images/icons/${name}-${size}x${size}.png`;
const day = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const today = () => new Date().toLocaleDateString('en-CA');

const Directory: React.FC = () => {
  const { openWindow } = useWindowManager();
  const [d, setD] = useState<Dir | null>(null);
  const [err, setErr] = useState('');
  const [section, setSection] = useState<Section | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch('/api/public/directory')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('The directory is offline right now.'))))
      .then(setD, (e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 520));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const go = (s: Section | null) => {
    setSection(s);
    setOpen(null);
  };
  const page = (title: string, src: string, ico = 'internet-explorer') =>
    openWindow({ id: `dir-${src}`, title, icon: icon(ico, 16), appType: 'iframe', appProps: { src }, width: 760, height: 560 });
  const welcome = () =>
    openWindow({ id: 'welcome', title: 'Welcome to Sanktuary', icon: icon('network', 16), appType: 'welcome', width: 520, height: 560 });

  // One row per item in the open section: [name, detail, icon]
  const rows: [string, string, string][] = !d
    ? []
    : section === 'people'
      ? d.people.map((p) => [p.displayName, p.role, 'my-documents'])
      : section === 'releases'
        ? d.releases.map((r) => [
            r.title,
            `${r.kind}${r.date ? ` · ${r.date > today() ? 'out' : 'released'} ${day(r.date)}` : ''}`,
            'media-player',
          ])
        : section === 'events'
          ? d.events.map((e) => [e.title, `${e.kind} · ${day(e.start)}${e.time ? ` ${e.time}` : ''}${e.past ? ' (past)' : ''}`, 'task'])
          : section === 'posts'
            ? d.posts.map((p) => [p.title, `${p.publication} · ${day(p.date.slice(0, 10))}`, 'news'])
            : section === 'products'
              ? d.products.map((p) => [p.title, `${money(p.price)}${p.soldOut ? ' · sold out' : ''}`, 'favorites'])
              : section === 'pools'
                ? d.pools.map((p) => [p.title, `${money(p.raised)} of ${money(p.goal)} · ${p.supporters} supporter(s)`, 'internet-folder'])
                : [];
  const activate = (i: number) => {
    if (!d || !section) return;
    if (section === 'posts') return page(d.posts[i].title, d.posts[i].url, 'news');
    if (section === 'products') return page('Shop', `/shop/${d.products[i].slug}`, 'favorites');
    if (section === 'pools') return page(d.pools[i].title, `/pool/${d.pools[i].slug}`, 'favorites');
    setOpen(i === open ? null : i);
  };
  const label = SECTIONS.find((s) => s.id === section)?.label;

  return (
    <div ref={box} style={shell}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 4px' }}>
        <button style={button} disabled={!section} onClick={() => go(null)} title="Up one level">
          ↑ Up
        </button>
        <span style={{ marginLeft: 4 }}>Address</span>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: '#fff',
            border: '2px inset #808080',
            padding: '1px 4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <img src={icon('hard-disk-drive', 16)} alt="" width={16} height={16} />
          S:\Sanktuary{label ? `\\${label}` : ''}
        </div>
        <button style={{ ...button, fontWeight: 700 }} onClick={welcome}>
          Join the Village
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 2, padding: '0 2px' }}>
        {!narrow && (
          <div style={{ ...pane, width: 150, flexShrink: 0, padding: 4 }}>
            <TreeRow ico="my-computer" text="Sanktuary (S:)" active={!section} onClick={() => go(null)} />
            {SECTIONS.map((s) => (
              <TreeRow key={s.id} ico={s.icon} text={s.label} indent active={section === s.id} onClick={() => go(s.id)} />
            ))}
          </div>
        )}
        <div style={{ ...pane, flex: 1, position: 'relative' }}>
          {err && <div style={{ padding: 12, color: '#a00000' }}>{err}</div>}
          {!d && !err && <div style={{ padding: 12 }}>Reading S:\...</div>}
          {d && !section && (
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{d.intro}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 }}>
                {SECTIONS.map((s) => (
                  <button key={s.id} onClick={() => go(s.id)} style={bigIcon}>
                    <img src={icon(s.icon, 32)} alt="" width={32} height={32} />
                    <span>{s.label}</span>
                    <span style={{ color: '#666', fontSize: 10 }}>{d[s.id].length} item(s)</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {d && section && (
            <div>
              {rows.map(([name, detail, ico], i) => (
                <React.Fragment key={i}>
                  <div
                    onClick={() => activate(i)}
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      padding: '3px 6px',
                      cursor: 'default',
                      ...(open === i ? { background: '#000080', color: '#fff' } : {}),
                    }}
                  >
                    {section === 'people' && d.people[i].avatar ? (
                      <img src={`/api/public/avatar/${d.people[i].username}`} alt="" width={16} height={16} />
                    ) : (
                      <img src={icon(ico, 16)} alt="" width={16} height={16} />
                    )}
                    <b style={{ flexShrink: 0 }}>{name}</b>
                    <span
                      style={{ color: open === i ? '#fff' : '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {detail}
                    </span>
                  </div>
                  {open === i && <Details d={d} section={section} i={i} />}
                </React.Fragment>
              ))}
              {!rows.length && <div style={{ padding: 12, color: '#666' }}>Nothing here yet.</div>}
            </div>
          )}
        </div>
      </div>
      <div style={statusBar}>{d ? (section ? `${rows.length} object(s)` : `${SECTIONS.length} folder(s)`) : ''}</div>
    </div>
  );
};

const Details: React.FC<{ d: Dir; section: Section; i: number }> = ({ d, section, i }) => {
  const card: React.CSSProperties = {
    margin: '2px 6px 8px 28px',
    padding: 8,
    background: '#ffffe1',
    border: '1px solid #808080',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  };
  if (section === 'people') {
    const p = d.people[i];
    return (
      <div style={{ ...card, flexDirection: 'row', gap: 10 }}>
        {p.avatar && <img src={`/api/public/avatar/${p.username}`} alt="" width={64} height={64} style={{ border: '1px solid #808080' }} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <b>
            {p.displayName} <span style={{ fontWeight: 400, color: '#555' }}>@{p.username}</span>
          </b>
          {p.role && <div>{p.role}</div>}
          {p.bio && <div style={{ whiteSpace: 'pre-wrap' }}>{p.bio}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(['soundcloud', 'instagram', 'website'] as const).map(
              (k) =>
                p.links[k] && (
                  <a key={k} href={p.links[k]} target="_blank" rel="noopener noreferrer nofollow">
                    {k === 'website' ? 'Website' : k[0].toUpperCase() + k.slice(1)}
                  </a>
                ),
            )}
          </div>
        </div>
      </div>
    );
  }
  if (section === 'releases') {
    const r = d.releases[i];
    return (
      <div style={card}>
        <b>
          {r.title} ({r.kind})
        </b>
        <div>{r.date ? `${r.date > today() ? 'Coming' : 'Released'} ${day(r.date)}` : 'Date to be announced'}</div>
        {r.tracks > 0 && <div>{r.tracks} track(s)</div>}
      </div>
    );
  }
  const e = d.events[i];
  return (
    <div style={card}>
      <b>{e.title}</b>
      <div>
        {e.kind} · {day(e.start)}
        {e.end && e.end !== e.start ? ` – ${day(e.end)}` : ''}
        {e.time ? ` at ${e.time}` : ''}
      </div>
      {e.location && <div>{e.location}</div>}
      {e.link && (
        <a href={e.link} target="_blank" rel="noopener noreferrer nofollow">
          More info / tickets
        </a>
      )}
    </div>
  );
};

const TreeRow: React.FC<{ ico: string; text: string; indent?: boolean; active: boolean; onClick: () => void }> = ({
  ico,
  text,
  indent,
  active,
  onClick,
}) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      gap: 4,
      alignItems: 'center',
      padding: '2px 4px',
      paddingLeft: indent ? 18 : 4,
      cursor: 'default',
      whiteSpace: 'nowrap',
      ...(active ? { background: '#000080', color: '#fff' } : {}),
    }}
  >
    <img src={icon(ico, 16)} alt="" width={16} height={16} />
    {text}
  </div>
);

const pane: React.CSSProperties = { overflow: 'auto', background: '#fff', border: '2px inset #808080', minWidth: 0 };
const bigIcon: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
  background: 'none',
  border: '1px dotted transparent',
  padding: 6,
  font: 'inherit',
  cursor: 'default',
};

export default Directory;
