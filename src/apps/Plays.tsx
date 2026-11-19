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
  shots?: { got: boolean }[];
}
interface PlayTemplate {
  id: string;
  name: string;
  kind: string;
  steps: string[];
  by: string;
}

const PLAY_KINDS = ['Shoot', 'Show', 'Session'];
const today = () => new Date().toISOString().slice(0, 10);

const Plays: React.FC = () => {
  const api = useApi();
  const { me } = useMe();
  const { openWindow } = useWindowManager();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [templates, setTemplates] = useState<PlayTemplate[]>([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
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
  const start = async (kind: string, t?: PlayTemplate) => {
    const title = await dialog.prompt(`Name the ${kind.toLowerCase()}`, t?.name || '', { title: 'New play' });
    if (!title?.trim()) return;
    try {
      const steps = (t?.steps || []).map((text) => ({ text, got: false, note: '' }));
      const e = await api('/api/timeline', {
        method: 'POST',
        body: JSON.stringify({ title, kind, start: today(), shots: steps }),
      });
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
