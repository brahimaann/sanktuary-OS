import React, { useCallback, useEffect, useState } from 'react';
import { useApi, useMe } from '../utils/api';
import { useLiveEvent } from '../utils/live';
import { dialog } from '../utils/dialog';
import { useWindowManager } from '../wm/manager';
import { showEntry } from '../utils/songNav';
import { openStudio } from './Studio';
import { openPlayDay } from './PlayDay';
import { button } from './fileTypes';

// Operations > Plays: every play (a calendar entry with a checklist: a shoot's shot list, a show setup, a session
// recipe, release day...) with how far along it is, plus the saved plays anyone can start a new one from.
// The checklist itself is edited on the entry in the calendar; this desk is the list.

interface Entry {
  id: string;
  title: string;
  kind: string;
  start: string;
  status?: string;
  location?: string;
  source?: string;
  release?: string | null;
  shots?: { got: boolean }[];
}
interface Project {
  id: string;
  title: string;
  kind: string;
  folder?: { space: string; path: string } | null;
}
interface PlayTemplate {
  id: string;
  name: string;
  kind: string;
  steps: string[];
  by: string;
}

const PLAY_KINDS = ['Shoot', 'Show', 'Session', 'Event'];
const today = () => new Date().toLocaleDateString('en-CA');
// A play uses a folder its project already has (no new folders): a shoot's raw files in Shoots, a session's sets
// in Projects, a show in the project folder itself, an event (a listening party, say) in Events.
const PLAY_FOLDER: Record<string, string> = { Shoot: '/Shoots', Session: '/Projects', Show: '', Event: '/Events' };
const field: React.CSSProperties = {
  font: 'inherit',
  padding: '2px 4px',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
};

const Plays: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const { openWindow } = useWindowManager();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [templates, setTemplates] = useState<PlayTemplate[]>([]);
  const [msg, setMsg] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  // The play being started: what, when and for which project, before it goes on the calendar
  const [draft, setDraft] = useState<{ kind: string; title: string; start: string; release: string; t?: PlayTemplate } | null>(null);
  const load = useCallback(() => {
    api('/api/tracks')
      .then((r: { releases: (Project & { deleted?: boolean })[] }) => setProjects(r.releases.filter((x) => !x.deleted)))
      .catch(() => setProjects([]));
    api('/api/timeline')
      .then((r: { items: Entry[] }) => setItems(r.items.filter((i) => !i.source)))
      .catch((e: Error) => setMsg(e.message));
    api('/api/timeline/templates')
      .then((r: { templates: PlayTemplate[] }) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  }, [api]);
  useEffect(load, [load]);
  useLiveEvent('timeline', load);

  const open = (id: string) => {
    showEntry(id);
    openStudio(openWindow, 'calendar');
  };
  const start = (kind: string, t?: PlayTemplate) =>
    setDraft({ kind, title: t?.name || '', start: today(), release: draft?.release || '', t });
  const create = async () => {
    if (!draft?.title.trim()) return setMsg('Give the play a name.');
    const p = projects.find((x) => x.id === draft.release);
    try {
      const e = await api('/api/timeline', {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title,
          kind: draft.kind,
          start: draft.start || today(),
          release: p?.id || null,
          folder: p?.folder ? { space: p.folder.space, path: p.folder.path + PLAY_FOLDER[draft.kind] } : null,
          shots: (draft.t?.steps || []).map((text) => ({ text, got: false, note: '' })),
        }),
      });
      setDraft(null);
      setMsg('');
      open(e.id);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const remove = async (t: PlayTemplate) => {
    if (!(await dialog.confirm(`Remove the saved play "${t.name}"? Plays already started from it keep their steps.`))) return;
    try {
      await api(`/api/timeline/templates/${t.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  if (!items) return <div style={{ padding: 12 }}>{msg || 'Loading...'}</div>;
  const plays = items
    .filter((i) => PLAY_KINDS.includes(i.kind) || i.shots?.length)
    .filter((i) => i.status !== 'Cancelled')
    .sort((a, b) => a.start.localeCompare(b.start));
  const coming = plays.filter((i) => i.start >= today() && i.status !== 'Done');
  const past = plays
    .filter((i) => !coming.includes(i))
    .reverse()
    .slice(0, 10);

  const row = (i: Entry) => {
    const n = i.shots?.length || 0;
    const got = i.shots?.filter((x) => x.got).length || 0;
    return (
      <div key={i.id} style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={() => open(i.id)}
          style={{ ...button, display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', width: '100%' }}
          title="Open it in the calendar to tick steps"
        >
          <span style={{ width: 64, flex: '0 0 64px' }}>{i.kind}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i.title}
            {i.release ? ` · ${projects.find((p) => p.id === i.release)?.title || ''}` : ''}
            {i.location ? ` · ${i.location}` : ''}
          </span>
          <span style={{ display: 'flex', gap: 2 }} aria-label={`${got} of ${n} done`}>
            {Array.from({ length: Math.min(n, 12) }, (_, k) => (
              <span
                key={k}
                style={{ width: 8, height: 10, border: '1px solid currentColor', background: k < got ? 'currentColor' : 'transparent' }}
              />
            ))}
          </span>
          <span style={{ width: 92, textAlign: 'right' }}>{n ? `${got} of ${n}` : 'no list yet'}</span>
          <span style={{ width: 84, textAlign: 'right' }}>{i.start}</span>
        </button>
        <button
          style={button}
          title="On the day: the checklist as big rows to tap, on a phone"
          onClick={() => openPlayDay(openWindow, i.id, i.title || i.kind)}
        >
          Day view
        </button>
      </div>
    );
  };

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ flex: 1 }}>Plays: real-world moves, each with its checklist</b>
        {PLAY_KINDS.map((k) => (
          <button key={k} style={button} onClick={() => start(k)}>
            + {k}
          </button>
        ))}
      </div>
      {draft && (
        <div style={{ border: '2px solid currentColor', padding: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>New {draft.kind.toLowerCase()}</b>
          <input
            autoFocus
            style={{ ...field, flex: '2 1 160px' }}
            placeholder={
              draft.kind === 'Shoot'
                ? 'e.g. Photo shoot: cover + press'
                : draft.kind === 'Show'
                  ? 'e.g. Release show'
                  : draft.kind === 'Event'
                    ? 'e.g. Keep Going listening party'
                    : 'e.g. Vocal session'
            }
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <input type="date" style={field} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          <select
            style={{ ...field, flex: '1 1 140px' }}
            value={draft.release}
            title="The project this play is for: it shows on the project's countdown and uses the project's folder"
            onChange={(e) => setDraft({ ...draft, release: e.target.value })}
          >
            <option value="">(no project)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.kind})
              </option>
            ))}
          </select>
          <button style={button} onClick={create}>
            Start
          </button>
          <button style={button} onClick={() => setDraft(null)}>
            Cancel
          </button>
          {draft.t && (
            <span style={{ width: '100%', opacity: 0.8 }}>
              From "{draft.t.name}": {draft.t.steps.length} steps.
            </span>
          )}
          {draft.release && (
            <span style={{ width: '100%', opacity: 0.8 }}>
              {(() => {
                const f = projects.find((x) => x.id === draft.release)?.folder;
                return f ? `Files go in ${f.path}${PLAY_FOLDER[draft.kind]}` : 'This project has no folder yet.';
              })()}
            </span>
          )}
        </div>
      )}
      {msg && <div>{msg}</div>}
      <div style={{ fontWeight: 700 }}>Coming up · {coming.length}</div>
      {coming.length ? coming.map(row) : <div style={{ opacity: 0.8 }}>No plays coming up. Start one above.</div>}
      {!!past.length && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Wrapped · {past.length}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>{past.map(row)}</div>
        </details>
      )}
      <div style={{ fontWeight: 700 }}>Saved plays · {templates.length}</div>
      {templates.length ? (
        templates.map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>
              {t.name}{' '}
              <span style={{ opacity: 0.75 }}>
                ({t.kind}, {t.steps.length} steps, by {t.by})
              </span>
            </span>
            <button style={button} onClick={() => start(t.kind, t)}>
              Start one
            </button>
            {(t.by === me?.username || me?.admin) && (
              <button style={button} title="Remove this saved play" onClick={() => remove(t)}>
                ✕
              </button>
            )}
          </div>
        ))
      ) : (
        <div style={{ opacity: 0.8 }}>
          None saved yet. Open a play with a checklist (a show setup, a session recipe) and press "Save as a play…".
        </div>
      )}
    </div>
  );
};

export default Plays;
