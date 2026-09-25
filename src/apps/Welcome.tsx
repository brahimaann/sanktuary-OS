import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useWindowManager, AppType } from '../wm/manager';
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

// The tour: a few steps that say what each part is for, each with a "Show me" that opens it. Visitors get the
// public side; members get the studio side (and it opens once on their first visit after logging on).
interface Step {
  title: string;
  text: string;
  open?: { id: string; title: string; appType: AppType; icon: string; appProps?: object; width: number; height: number };
}
const win = (id: string, title: string, appType: AppType, icon: string, width = 760, height = 560, appProps?: object) => ({
  id,
  title,
  appType,
  icon: `/images/icons/${icon}`,
  width,
  height,
  appProps,
});
const VISITOR_TOUR: Step[] = [
  {
    title: 'This is a desktop',
    text: 'Everything here opens in windows, like an old PC. Double-click an icon (tap on a phone) to open it; drag a window by its blue title bar; the Start button, bottom left, lists everything.',
  },
  {
    title: 'My Computer: who we are',
    text: 'The directory: the people in the collective, what we have out and coming, events, writing, the shop.',
    open: win('my-computer', 'My Computer', 'directory', 'my-computer-16x16.png', 680, 500),
  },
  {
    title: 'Producer: tools for making music',
    text: 'Drop in a song to get its tempo, key and loudness, compare your mix with a reference, get delay and reverb times for your tempo, and read chains, tips and free tools. Your file stays on your device.',
    open: win('producer', 'Producer', 'producer', 'convert-audio-16x16.png', 720, 560),
  },
  {
    title: 'Read the blog',
    text: 'Essays and notes from the studio, readable right here.',
    open: win('blog', 'Blog', 'iframe', 'news-16x16.png', 760, 560, { src: '/blog' }),
  },
  {
    title: 'Shop and money pools',
    text: 'Merch and digital releases, and pools that fund what we make next. Payments go through Stripe.',
    open: win('shop', 'Shop', 'iframe', 'favorites-16x16.png', 760, 560, { src: '/shop' }),
  },
  {
    title: 'Join the Village',
    text: 'Artist, engineer, photographer or fan: tell us about you at the bottom of this window and we will reach out.',
  },
];
const MEMBER_TOUR: Step[] = [
  {
    title: 'New... adds anything',
    text: 'A release, a song, a shoot, a show, a drop. It asks two or three things and understands dates like "next sat 8pm". Releases get their folders made for you.',
    open: win('new', 'New', 'new', 'file-32x32.png', 460, 420),
  },
  {
    title: 'Team Files: the shared drives',
    text: 'Upload by dragging files in, drag to move, right-click for more. Projects (Ableton, FL, Premiere, After Effects, PSD, AI) open read-only; Download asks whether you are just looking, trying things out, or checking it out so nobody else edits at the same time.',
    open: win('sanktuary-network', 'Team Files', 'network', 'network-16x16.png', 560, 420),
  },
  {
    title: 'Studio > Songs: tracks fill themselves in',
    text: 'Drop bounces into a release\'s folder (or onto Tracks): "03 Song v4.wav" becomes track 3 with v4 as its bounce. Projects, stems, BPM and the cover are linked by name.',
    open: win('studio', 'Studio', 'studio', 'media-player-16x16.png', 960, 620, { tab: 'songs' }),
  },
  {
    title: 'Studio > Calendar: shoots, shows, drops',
    text: 'One calendar for everything with a date, release days included. People on an entry get reminded the day before.',
    open: win('studio', 'Studio', 'studio', 'media-player-16x16.png', 960, 620, { tab: 'calendar' }),
  },
  {
    title: 'Studio > Opportunities: grants, calls, gigs',
    text: 'Post a grant, residency, open call or gig with its link and deadline and the whole team hears about it. Mark Interested or Applying to get reminded a week and a day before it closes; Copy portfolio link fills the "work samples" box.',
    open: win('studio', 'Studio', 'studio', 'media-player-16x16.png', 960, 620, { tab: 'opportunities' }),
  },
  {
    title: 'Moodboards',
    text: 'Drag images, audio and files onto a shared canvas; it updates live for everyone. To-do boards (the old Planner) are in Studio > Boards.',
    open: win('moodboards', 'Moodboards', 'boards', 'paint-16x16.png', 560, 420),
  },
  {
    title: 'Messages',
    text: 'Channels and direct messages. Attach files from your phone or from the drives.',
    open: win('teams', 'Messages', 'teams', 'outlook-express-16x16.png', 300, 520),
  },
  {
    title: 'Producer',
    text: 'Tempo, key and loudness of any bounce (from your device or Team Files), a reference comparison, delay and reverb times, and a guide. Save the tempo and key straight onto a track.',
    open: win('producer', 'Producer', 'producer', 'convert-audio-16x16.png', 720, 560),
  },
  {
    title: 'Edit photos',
    text: 'Open a photo or camera RAW file in Team Files and press Edit photo: a full RAW editor, running on the studio PC.',
  },
  {
    title: 'Your profile and your phone',
    text: 'Set your picture and links, choose whether you show in the public directory, see your projects and turn on notifications. On Android, Add to Home screen puts Sanktuary in your share menu.',
    open: win('profile-me', 'My Profile', 'profile', 'my-documents-16x16.png', 420, 520),
  },
];

const Tour: React.FC<{ member: boolean }> = ({ member }) => {
  const { openWindow } = useWindowManager();
  const steps = member ? MEMBER_TOUR : VISITOR_TOUR;
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [member]);
  const s = steps[Math.min(i, steps.length - 1)];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ ...panel, fontSize: 12, minHeight: 86 }}>
        <div style={{ color: '#666', fontSize: 10 }}>
          Step {i + 1} of {steps.length}
        </div>
        <b style={{ color: '#000080' }}>{s.title}</b>
        <div style={{ marginTop: 4, lineHeight: 1.45 }}>{s.text}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button style={button} disabled={i === 0} onClick={() => setI(i - 1)}>
          ‹ Back
        </button>
        <button style={{ ...button, fontWeight: 700 }} disabled={i === steps.length - 1} onClick={() => setI(i + 1)}>
          Next ›
        </button>
        <span style={{ flex: 1 }} />
        {s.open && (
          <button
            style={button}
            onClick={() => {
              // Studio may already be open on another tab: switch it
              if (s.open!.appType === 'studio')
                window.dispatchEvent(new CustomEvent('sk:studio-tab', { detail: (s.open!.appProps as { tab: string }).tab }));
              openWindow(s.open!);
            }}
          >
            <IconLabel icon="external">Show me</IconLabel>
          </button>
        )}
      </div>
    </div>
  );
};

/** The front door: who we are, a tour, latest writing, what's coming up, and a way to join. No account needed. */
const Welcome: React.FC<{ tour?: boolean }> = ({ tour }) => {
  const { openWindow } = useWindowManager();
  const { isSignedIn } = useAuth();
  const [f, setF] = useState<Front | null>(null);
  const [joining, setJoining] = useState(false);
  const tourBox = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (tour) tourBox.current?.scrollIntoView({ block: 'start' });
  }, [tour]);
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

        <Section title={isSignedIn ? 'How the studio works' : 'Take the tour'} refEl={tourBox}>
          <Tour member={!!isSignedIn} />
        </Section>

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
      <div style={{ ...statusBar, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1 }}>{isSignedIn ? "You're logged on." : 'Already a member?'}</span>
        {!isSignedIn && (
          <button
            style={button}
            onClick={() =>
              openWindow({
                id: 'profile-me',
                title: 'Log On',
                icon: '/images/icons/network-16x16.png',
                appType: 'profile',
                width: 420,
                height: 520,
              })
            }
          >
            <IconLabel icon="login">Log on...</IconLabel>
          </button>
        )}
      </div>
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

const Section: React.FC<{ title: string; children: React.ReactNode; refEl?: React.Ref<HTMLFieldSetElement> }> = ({
  title,
  children,
  refEl,
}) => (
  <fieldset
    ref={refEl}
    style={{ border: '2px groove #fff', margin: 0, padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}
  >
    <legend style={{ fontWeight: 700 }}>{title}</legend>
    {children}
  </fieldset>
);

const panel: React.CSSProperties = { background: '#fff', border: '2px inset #808080', padding: 10, fontSize: 13 };
const field: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, padding: '3px 4px', border: '2px inset #808080', minWidth: 0 };

export default Welcome;
