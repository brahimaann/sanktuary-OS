import React, { useEffect, useState } from 'react';
import { useApi } from '../utils/api';
import { button } from './TeamFiles';

/**
 * A release's campaign: plan the singles (a waterfall, one every few weeks before the release) and a 3-video
 * campaign onto the Timeline, and ready-made pitches (radio, playlists, press, distribution, manufacturing, sync). Each
 * pitch turns into one email draft per matching Outreach contact; nothing is sent until you hit send in your own mail app.
 */
interface Props {
  release: {
    id: string;
    title: string;
    kind: string;
    date: string | null;
    artist?: string;
    blurb?: string;
    slug?: string;
    public?: boolean;
    members: string[] | null;
    stores?: Record<string, string>;
  };
  tracks: { id: string; title: string; n: number }[];
  onClose: () => void;
}

const iso = (d: Date) => d.toLocaleDateString('en-CA'); // local YYYY-MM-DD
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const nextFriday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((12 - d.getDay()) % 7 || 7)); // releases go out on Fridays
  return iso(d);
};
const pretty = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });

// What each of the three videos is for, with a starting shot list (edit it on the Timeline)
const VIDEOS: [title: string, offset: (release: string) => string, notes: string][] = [
  [
    'Teaser / visualizer',
    (r) => addDays(r, -14),
    'Goal: build anticipation before release day.\n15-30 s vertical cut for Reels/TikTok/Shorts + a loop visualizer.\nShots: artwork motion, 3-4 moody b-roll moments, one lyric line on screen.\nEnd card: release date + pre-save link.',
  ],
  [
    'Official music video',
    (r) => r,
    'Goal: the main piece on release day.\nShot list: performance (wide, mid, close), story/b-roll scenes, location changes on the hook.\nPrep: treatment, locations, wardrobe, call sheet, release forms for anyone on camera.\nDeliver: 16:9 master, 9:16 cutdowns, thumbnail stills for the lookbook.',
  ],
  [
    'Live / behind the scenes',
    (r) => addDays(r, 21),
    'Goal: keep it going after release.\nOne-take live performance or studio session + behind-the-scenes from the shoot.\nShots: 2 cameras on the performance, candid prep moments, quick talk to camera about the song.\nPost stills to the public lookbook.',
  ],
];

const Campaign: React.FC<Props> = ({ release, tracks, onClose }) => {
  const api = useApi();
  const [tab, setTab] = useState<'plan' | 'pitch'>('plan');
  const [picked, setPicked] = useState<string[]>(tracks.slice(0, 3).map((t) => t.id));
  const [weeks, setWeeks] = useState(5);
  // Singles work back from release day (the last one a few weeks before it), never starting in the past
  const [first, setFirst] = useState(() => {
    const n = Math.min(3, tracks.length) || 1;
    const back = release.date ? addDays(release.date, -n * 5 * 7) : '';
    return back > nextFriday() ? back : nextFriday();
  });
  const [videos, setVideos] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const singles = tracks.filter((t) => picked.includes(t.id));
  const plan: { title: string; kind: string; start: string; notes: string }[] = [
    ...singles.map((t, i) => ({
      title: `Single ${i + 1}: ${t.title}`,
      kind: 'Drop',
      start: addDays(first, i * weeks * 7),
      notes: `Single ${i + 1} from ${release.title}. Pitch to playlists at least 7 days before (Spotify for Artists), post the teaser, update the link in bio.`,
    })),
    ...(videos && release.date
      ? VIDEOS.map(([title, when, notes]) => ({ title: `${title}: ${release.title}`, kind: 'Video', start: when(release.date!), notes }))
      : []),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const late = release.date ? plan.filter((p) => p.kind === 'Drop' && p.start >= release.date!) : [];

  const addToTimeline = async () => {
    setBusy(true);
    setMsg('Adding...');
    try {
      // Entries already there (an earlier run, or one cut short) aren't added twice.
      // The server keeps them as private as the release.
      const have: { title: string; start: string; release?: string | null }[] = (await api('/api/timeline')).items;
      const todo = plan.filter((p) => !have.some((h) => h.release === release.id && h.title === p.title && h.start === p.start));
      for (const p of todo) await api('/api/timeline', { method: 'POST', body: JSON.stringify({ ...p, release: release.id }) });
      setMsg(
        `Added ${todo.length} entries to the Timeline${todo.length < plan.length ? ` (${plan.length - todo.length} were already there)` : ''}. Everyone on them gets reminders.`,
      );
      setDone(true);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };

  // Pitches: filled from the release, edited before copying
  const who = release.artist || 'Sanktuary';
  const lead = singles[0]?.title || tracks[0]?.title || release.title;
  const page = release.public && release.slug ? `${location.origin}/release/${release.slug}` : '';
  const listen = release.stores?.spotify || release.stores?.presave || page;
  const when = release.date ? pretty(release.date) : 'soon';
  const about = release.blurb?.trim() || `[Two sentences on the song: the sound, the story, who it's for.]`;
  const PITCHES: [label: string, kind: string, text: string][] = [
    [
      'College & community radio',
      'Radio',
      `Subject: ${who} - "${lead}" for your rotation (Twin Cities)\n\nHi [host/music director name],\n\n${who} is a Twin Cities artist, and "${lead}" is from the ${release.kind.toLowerCase()} ${release.title}, out ${when}.\n\n${about}\n\nListen: ${listen || '[link]'}\nClean version: [yes/no]\n\nWe'd love a spin on [show name], and ${who} is happy to come in for an interview or a live session.\n\nThank you,\n[your name]\nSanktuary`,
    ],
    [
      'Playlist curators',
      'Playlist',
      `Subject: "${lead}" by ${who} for [playlist name]\n\nHi [curator name],\n\nI think "${lead}" would sit well on [playlist name] next to [similar artist/track on the list].\n\n${about}\n\nListen: ${listen || '[link]'}\nGenre / mood: [e.g. alternative R&B, late night]\nOut: ${when}\n\nThanks for listening either way.\n[your name]`,
    ],
    [
      'Blogs & press',
      'Blog / press',
      `Subject: Premiere / feature: ${who} - ${release.title} (out ${when})\n\nHi [writer name],\n\nI loved your piece on [recent article]. ${who} is releasing ${release.title}, a ${release.kind.toLowerCase()}, on ${when}.\n\n${about}\n\nLead single: "${lead}"\nListen: ${listen || '[private link]'}${page ? `\nPress page (photos, story, credits): ${page}` : ''}\nPortfolio / one-sheet: ${location.origin}/portfolio\n\nAvailable for an interview, a premiere or an exclusive.\n\nBest,\n[your name]\nSanktuary`,
    ],
    [
      'Distribution',
      'Distribution',
      `Subject: Distribution for ${who} - ${release.title} (out ${when})\n\nHi [contact name],\n\nWe're looking for distribution for ${release.title}, a ${release.kind.toLowerCase()} by ${who} (Twin Cities), with ${tracks.length || '[number of]'} tracks, out ${when}.\n\n${about}\n\nListen (private): ${listen || '[link]'}\nPortfolio / one-sheet: ${location.origin}/portfolio\n\nCould you share your terms (split or fee, term length, territories, marketing and playlist pitching support)? Masters and artwork are ready.\n\nThank you,\n[your name]\nSanktuary`,
    ],
    [
      'Manufacturing (vinyl, CD, cassette, merch)',
      'Manufacturing',
      `Subject: Quote request: ${release.title} by ${who}\n\nHi [contact name],\n\nWe'd like a quote for a run of ${release.title} (${release.kind.toLowerCase()}, ${tracks.length || '[number of]'} tracks), ready by ${release.date ? pretty(addDays(release.date, -14)) : '[date]'}.\n\nFormat: [12" vinyl / CD / cassette / shirts]\nQuantity: [100 / 300 / 500]\nPackaging: [jacket, insert, colour, shrink wrap]\nTotal runtime: [mm:ss]\n\nPlease include turnaround time, test pressings and shipping to Minneapolis. Audio and artwork are ready to send.\n\nThank you,\n[your name]\nSanktuary`,
    ],
    [
      'Sync & placement',
      'Sync / placement',
      `Subject: ${who} - "${lead}" for sync (one-stop, cleared)\n\nHi [contact name],\n\n"${lead}" by ${who} could fit [show / ad / film / game you have in mind]: [mood, tempo, where it lands in a scene].\n\n${about}\n\nListen: ${listen || '[link]'}\nInstrumental and clean versions: [yes/no]\nRights: master and publishing controlled, one-stop clearance\n\nHappy to send stems or a full catalogue list.\n\nBest,\n[your name]\nSanktuary`,
    ],
  ];
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<{ id: string; name: string; outlet: string; email: string; kind: string; status: string }[]>([]);
  const loadContacts = () =>
    api('/api/outreach').then(
      (d) => setContacts(d.items),
      (e) => setMsg(e.message),
    );
  useEffect(() => {
    if (tab === 'pitch') loadContacts();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const markPitched = (id: string) =>
    api(`/api/outreach/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Pitched' }) }).then(loadContacts, (e) =>
      setMsg(e.message),
    );

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
      <div style={{ width: 'min(700px, 98%)', maxHeight: '96%', overflow: 'auto', background: '#c0c0c0', border: '2px outset #fff' }}>
        <div style={{ background: 'linear-gradient(90deg,#000080,#1084d0)', color: '#fff', fontWeight: 700, padding: '3px 6px' }}>
          Campaign: {release.title}
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(
              [
                ['plan', 'Singles & videos'],
                ['pitch', 'Pitch kit'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} style={{ ...button, fontWeight: tab === id ? 700 : 400 }} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'plan' && (
            <>
              <fieldset style={fieldset}>
                <legend>Singles (a waterfall: each one keeps the release in front of people)</legend>
                {!tracks.length && <div>Add songs to the release first.</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {tracks.map((t) => (
                    <label key={t.id} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={picked.includes(t.id)}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))}
                      />
                      {t.n}. {t.title}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  First single on
                  <input type="date" value={first} onChange={(e) => e.target.value && setFirst(e.target.value)} style={input} />
                  then one every
                  <select value={weeks} onChange={(e) => setWeeks(+e.target.value)} style={input}>
                    {[3, 4, 5, 6, 8].map((w) => (
                      <option key={w} value={w}>
                        {w} weeks
                      </option>
                    ))}
                  </select>
                </div>
              </fieldset>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={videos} disabled={!release.date} onChange={(e) => setVideos(e.target.checked)} />
                3-video campaign around release day (teaser 2 weeks before, the video on the day, live/BTS 3 weeks after)
                {!release.date && ' (set a release date first)'}
              </label>
              <div style={{ background: '#fff', border: '2px inset #808080', padding: 6, maxHeight: 200, overflow: 'auto' }}>
                {plan.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ width: 150, flexShrink: 0 }}>{pretty(p.start)}</span>
                    <b>{p.title}</b>
                  </div>
                ))}
                {release.date && (
                  <div style={{ display: 'flex', gap: 8, color: '#006000' }}>
                    <span style={{ width: 150, flexShrink: 0 }}>{pretty(release.date)}</span>
                    <b>{release.title} out</b>
                  </div>
                )}
                {!plan.length && <div style={{ color: '#555' }}>Pick songs to see the plan.</div>}
              </div>
              {late.length > 0 && (
                <div style={{ color: '#a00000' }}>
                  {late.length} single(s) land on or after release day: start earlier or space them closer.
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                <span style={{ marginRight: 'auto' }}>{msg}</span>
                <button style={button} onClick={onClose}>
                  Close
                </button>
                <button style={{ ...button, fontWeight: 700 }} disabled={busy || done || !plan.length} onClick={addToTimeline}>
                  Add {plan.length} to Timeline
                </button>
              </div>
            </>
          )}

          {tab === 'pitch' && (
            <>
              <div>
                Starting points filled from the release. Replace the [brackets], make each one personal, send from your own email. Pitch
                playlists and radio 2-4 weeks before release day. Contacts in Outreach still marked "To pitch" get their own draft (name and
                outlet filled in): open it, read it over, send, then mark it pitched so the follow-up reminder starts.
              </div>
              {msg && <div style={{ color: '#a00000' }}>{msg}</div>}
              {PITCHES.map(([label, kind, text]) => (
                <Pitch
                  key={label}
                  label={label}
                  value={texts[label] ?? text}
                  onChange={(v) => setTexts({ ...texts, [label]: v })}
                  contacts={contacts.filter((c) => c.kind === kind && c.status === 'To pitch' && c.email)}
                  onPitched={markPitched}
                />
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={button} onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// One contact's copy of a pitch, as a mailto: link that opens a draft in their own mail app
const draftFor = (text: string, c: { name: string; outlet: string; email: string }) => {
  const filled = text
    .replace(/\[(show|playlist) name\]/g, c.outlet || '$&')
    .replace(/\[(host\/music director|curator|writer|contact) name\]/g, c.name || 'there');
  const [, subject = '', body = filled] = filled.match(/^Subject: (.*)\n\n([\s\S]*)$/) || [];
  return `mailto:${encodeURIComponent(c.email).replace('%40', '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

const Pitch: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  contacts: { id: string; name: string; outlet: string; email: string }[];
  onPitched: (id: string) => void;
}> = ({ label, value, onChange, contacts, onPitched }) => {
  const [note, setNote] = useState('');
  return (
    <fieldset style={fieldset}>
      <legend>{label}</legend>
      <textarea
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...input, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          style={button}
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => setNote('Copied.'),
              () => setNote('Could not copy.'),
            )
          }
        >
          Copy
        </button>
        <span>{note}</span>
      </div>
      {contacts.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <a href={draftFor(value, c)}>Draft to {c.name || c.outlet}</a>
          <span style={{ color: '#555' }}>{c.name && c.outlet}</span>
          <span style={{ flex: 1 }} />
          <button style={button} onClick={() => onPitched(c.id)}>
            Sent: mark pitched
          </button>
        </div>
      ))}
    </fieldset>
  );
};

const fieldset: React.CSSProperties = {
  border: '2px groove #fff',
  margin: 0,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default Campaign;
