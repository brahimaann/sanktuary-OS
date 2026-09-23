import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconLabel } from '../components/RetroIcon';
import { useApi, useMe } from '../utils/api';
import { dialog } from '../utils/dialog';
import { useLiveEvent } from '../utils/live';

export interface ProjectInfo {
  kind: string;
  name?: string;
  status: string;
  lock: { user: string; at: string } | null;
  turn: { user: string; until: string } | null;
  queue: string[];
  following?: boolean;
  followers?: number;
  history?: { at: string; user: string; action: string; note?: string }[];
}
type Purpose = 'view' | 'playground' | 'checkout';

const STATUSES = ['Not started', 'In progress', 'In review', 'Done'];
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Check-out / check-in for one project, shown over the team files window.
 * mode "download" first asks what the download is for: just viewing, a playground copy, or checking out.
 */
const ProjectPanel: React.FC<{
  app: string;
  dir: string[];
  name: string;
  isDir: boolean;
  mode: 'info' | 'download';
  canEdit: boolean; // upload rights or better in this space
  download: (purpose: Purpose, before?: () => Promise<boolean>) => Promise<void>;
  uploadStaged: (items: { file: File; rel: string[] }[], stage: { id: string; project: string[] }) => Promise<boolean>;
  onClose: () => void;
  onChanged: () => void;
}> = ({ app, dir, name, isDir, mode, canEdit, download, uploadStaged, onClose, onChanged }) => {
  const api = useApi();
  const { me } = useMe();
  const [p, setP] = useState<ProjectInfo | null>(null);
  const [msg, setMsg] = useState('');
  const [asking, setAsking] = useState(mode === 'download');
  const [note, setNote] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const base = `/api/projects?space=${encodeURIComponent(app)}&path=${encodeURIComponent([...dir, name].join('/'))}`;
  const you = me?.username || '';

  const load = useCallback(() => api(base).then(setP, (e) => setMsg(e.message)), [api, base]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string, extra = '') => {
    try {
      setP({ ...p!, ...(await api(`${base}&action=${action}${extra}`, { method: 'POST' })) });
      setMsg('');
      onChanged();
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    }
  };

  // Pick where to save first (the browser only allows that straight after a click), then lock, then download.
  const checkOut = () =>
    download('checkout', async () => {
      if (!(await act('checkout', note ? `&note=${encodeURIComponent(note)}` : ''))) return false;
      setAsking(false);
      setMsg(`Checked out. Nobody else can change ${name} until you check it in. Downloading your copy...`);
      return true;
    });

  const checkIn = async (files: File[]) => {
    const items = files.map((file) => ({ file, rel: isDir ? file.webkitRelativePath.split('/').slice(1) : [] }));
    if (!items.length) return;
    if (!isDir && files[0].name.toLowerCase() !== name.toLowerCase()) {
      if (!(await dialog.confirm(`You picked "${files[0].name}", not "${name}". Check it in as the new ${name}?`, { icon: 'warning' })))
        return;
    }
    const stage = { id: crypto.randomUUID(), project: [...dir, name] };
    setMsg('Uploading the new version...');
    if (!(await uploadStaged(items, stage))) return setMsg('Upload stopped, nothing was changed. Try the check-in again.');
    const q = `&stage=${stage.id}&files=${items.length}&note=${encodeURIComponent(note)}`;
    try {
      const r = await api(`${base}&action=checkin${q}`, { method: 'POST' });
      if (r.ok === false) {
        const go = await dialog.confirm(
          `These files are used by the project but aren't inside it, so they'll be missing for everyone else:\n\n${r.missing.join('\n')}\n\n` +
            (p?.kind === 'Ableton Live'
              ? 'Fix: in Ableton, File > Collect All and Save, then check in again.\n\n'
              : p?.kind === 'FL Studio'
                ? 'Fix: in FL Studio, File > Export > Zipped loop package, or copy the samples into the project folder.\n\n'
                : 'Fix: copy the linked files into the project folder (or embed them), then check in again.\n\n') +
            'Check in anyway?',
          { title: 'Missing files', icon: 'warning', ok: 'Check in anyway', cancel: 'Cancel' },
        );
        if (!go) return setMsg('Check-in cancelled: it is still checked out to you. Fix the missing files and try again.');
        await api(`${base}&action=checkin${q}&force=1`, { method: 'POST' });
      }
      setNote('');
      setMsg('Checked in. The previous version is kept, and whoever is next in line has been told.');
      load();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const mine = p?.lock?.user === you;
  const lockedByOther = !!p?.lock && !mine;
  const otherTurn = !!p?.turn && p.turn.user !== you;
  const queued = !!p?.queue.includes(you);
  const free = !!p && !p.lock && !otherTurn;

  return (
    <div style={overlay}>
      <div style={{ fontWeight: 700 }}>
        {name} · {p?.kind || '...'} project
      </div>

      {asking ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <div>What are you doing with it?</div>
          <Choice title="Just viewing" text="Download a copy to look at or listen to." onClick={() => (download('view'), onClose())} />
          <Choice
            title="Playground copy"
            text="Your own copy to experiment with. It can never be checked back in, so nothing you do affects the real project."
            onClick={() => (download('playground'), onClose())}
          />
          <Choice
            title="Check out to edit"
            text={
              !canEdit
                ? "You don't have upload rights in this space."
                : lockedByOther
                  ? `Checked out by ${p!.lock!.user} since ${when(p!.lock!.at)}. Join the queue to go next.`
                  : otherTurn
                    ? `It's ${p!.turn!.user}'s turn until ${when(p!.turn!.until)}. Join the queue to go next.`
                    : 'Locks it so nobody else can change it until you check it back in. Everyone can still view it.'
            }
            disabled={!canEdit || !free}
            onClick={checkOut}
          />
          {canEdit && !free && !mine && !queued && (
            <button style={button} onClick={() => act('queue')}>
              <IconLabel icon="plus">Join the queue</IconLabel>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'auto' }}>
          {p && (
            <>
              <div style={box}>
                <b>
                  {p.lock
                    ? `Checked out by ${mine ? 'you' : p.lock.user} since ${when(p.lock.at)}`
                    : p.turn
                      ? `${p.turn.user === you ? 'Your' : `${p.turn.user}'s`} turn: claim it by ${when(p.turn.until)}`
                      : 'Free: nobody has it checked out'}
                </b>
                {p.queue.length > 0 && <div>Queue: {p.queue.map((u) => (u === you ? 'you' : u)).join(' → ')}</div>}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  Status
                  <select
                    style={input}
                    value={p.status}
                    onChange={async (e) => {
                      const n = await dialog.prompt(`Note for the team (optional):`, '', { title: `Status: ${e.target.value}` });
                      if (n !== null) act('status', `&status=${encodeURIComponent(e.target.value)}&note=${encodeURIComponent(n)}`);
                    }}
                  >
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={!!p.following} onChange={(e) => act(e.target.checked ? 'follow' : 'unfollow')} />
                    Follow updates
                  </label>
                </div>
              </div>

              {canEdit && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(mine || free) && (
                    <input
                      style={{ ...input, flex: 1, minWidth: 160 }}
                      placeholder={mine ? 'What changed? (shown to the team)' : 'Note (optional)'}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  )}
                  {free && (
                    <button style={{ ...button, fontWeight: 700 }} onClick={checkOut}>
                      <IconLabel icon="lock">Check out</IconLabel>
                    </button>
                  )}
                  {mine && (
                    <>
                      <button style={{ ...button, fontWeight: 700 }} onClick={() => picker.current?.click()}>
                        <IconLabel icon="upload">Check in...</IconLabel>
                      </button>
                      <button
                        style={button}
                        onClick={async () =>
                          (await dialog.confirm(`Give ${name} back without uploading changes?`, { icon: 'question' })) && act('release')
                        }
                      >
                        <IconLabel icon="undo">Release</IconLabel>
                      </button>
                    </>
                  )}
                  {!free && !mine && !queued && (
                    <button style={button} onClick={() => act('queue')}>
                      <IconLabel icon="plus">Join the queue</IconLabel>
                    </button>
                  )}
                  {queued && (
                    <button style={button} onClick={() => act('unqueue')}>
                      <IconLabel icon="close">Leave the queue</IconLabel>
                    </button>
                  )}
                  {lockedByOther && (
                    <button
                      style={button}
                      title="Owner or admin only"
                      onClick={async () =>
                        (await dialog.confirm(`Release ${p.lock!.user}'s check-out? Changes they haven't checked in won't be here.`, {
                          icon: 'warning',
                        })) && act('release')
                      }
                    >
                      <IconLabel icon="key">Force release</IconLabel>
                    </button>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={button} onClick={() => download('view')}>
                  <IconLabel icon="download">Download to view</IconLabel>
                </button>
                <button style={button} onClick={() => download('playground')}>
                  <IconLabel icon="download">Playground copy</IconLabel>
                </button>
              </div>

              <div style={{ ...box, background: '#fff', flex: 1, minHeight: 60, overflow: 'auto' }}>
                {!p.history?.length && <div style={{ color: '#666' }}>No history yet.</div>}
                {p.history?.map((h, i) => (
                  <div key={i}>
                    <span style={{ color: '#666' }}>{when(h.at)}</span> <b>{h.user}</b> {h.action}
                    {h.note ? `: ${h.note}` : ''}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <input
        ref={picker}
        type="file"
        hidden
        {...(isDir ? { webkitdirectory: '', multiple: true } : {})}
        onChange={(e) => {
          checkIn([...(e.target.files || [])]);
          e.target.value = '';
        }}
      />
      {msg && <div style={{ color: /^(Checked|Upload|Check-in c)/.test(msg) ? '#000080' : '#a00000' }}>{msg}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {asking ? (
          <button style={button} onClick={() => setAsking(false)}>
            Project details...
          </button>
        ) : (
          <span />
        )}
        <button style={button} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};

type Where = { space: string; dir: string[]; name: string };
type Mine = ProjectInfo & { name: string; owner: boolean; at: Where };
type Note = { id: string; at: string; text: string; turn?: boolean; where?: Where };

/** Profile section: every project you own, hold, are queued for or follow, plus the latest updates. */
export const MyProjects: React.FC<{ you: string; open: (w: Where) => void }> = ({ you, open }) => {
  const api = useApi();
  const [list, setList] = useState<Mine[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const load = useCallback(() => {
    api('/api/projects?mine').then(setList, () => setList([]));
    api('/api/projects?notifications').then(setNotes, () => {});
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveEvent('notify', load);

  const state = (p: Mine) =>
    p.lock?.user === you
      ? `🔒 You have it checked out (since ${when(p.lock.at)})`
      : p.turn?.user === you
        ? `⭐ Your turn: check it out by ${when(p.turn.until)}`
        : p.queue.includes(you)
          ? `In the queue: #${p.queue.indexOf(you) + 1}`
          : p.lock
            ? `Checked out by ${p.lock.user}`
            : p.turn
              ? `${p.turn.user}'s turn`
              : 'Free';
  return (
    <div style={{ border: '2px groove #fff', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <b>My Projects</b>
      {!list && <div>Loading...</div>}
      {list?.length === 0 && (
        <div style={{ color: '#444' }}>
          Nothing yet. Open a project in a team folder and tick "Follow updates", check it out, or join its queue.
        </div>
      )}
      {list?.map((p) => (
        <div
          key={`${p.at.space}/${[...p.at.dir, p.at.name].join('/')}`}
          style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#fff', border: '1px solid #808080', padding: '3px 6px' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{p.name}</b>{' '}
            <span style={{ color: '#555' }}>
              · {p.kind} · {p.status}
              {p.owner ? ' · yours' : ''}
            </span>
            <div>{state(p)}</div>
          </div>
          <button style={button} onClick={() => open(p.at)}>
            Open
          </button>
        </div>
      ))}
      {notes.length > 0 && (
        <>
          <b style={{ marginTop: 4 }}>Updates</b>
          <div style={{ background: '#fff', border: '2px inset #808080', maxHeight: 160, overflow: 'auto', padding: 4 }}>
            {notes.slice(0, 30).map((n) => (
              <div key={n.id} style={{ padding: '2px 0', borderBottom: '1px solid #eee', fontWeight: n.turn ? 700 : 400 }}>
                <span style={{ color: '#666' }}>{when(n.at)}</span> {n.text}{' '}
                {n.where && (
                  <a href="#" onClick={(e) => (e.preventDefault(), open(n.where!))}>
                    open
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const Choice: React.FC<{ title: string; text: string; disabled?: boolean; onClick: () => void }> = ({ title, text, disabled, onClick }) => (
  <button
    style={{ ...button, textAlign: 'left', padding: '6px 10px', display: 'block', width: '100%', opacity: disabled ? 0.6 : 1 }}
    disabled={disabled}
    onClick={onClick}
  >
    <b>{title}</b>
    <div style={{ marginTop: 2 }}>{text}</div>
  </button>
);

const overlay: React.CSSProperties = {
  position: 'absolute',
  inset: 8,
  zIndex: 5,
  background: '#c0c0c0',
  border: '2px outset #fff',
  display: 'flex',
  flexDirection: 'column',
  padding: 8,
  gap: 6,
};
const box: React.CSSProperties = { border: '2px groove #fff', padding: 6 };
const button: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 8px',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #000',
  borderBottom: '1px solid #000',
};
const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 3px',
  background: '#fff',
  border: '2px inset #808080',
};

export default ProjectPanel;
