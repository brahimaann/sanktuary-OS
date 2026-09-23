import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useWindowManager } from '../wm/manager';
import { useApi, useMe } from '../utils/api';
import MembersPicker from './MembersPicker';
import { isTouch } from './fileTypes';
import { DRAG_BOARD } from '../utils/refs';
import { LogOn, shell, toolbar, button, statusBar } from './TeamFiles';

interface BoardMeta { id: string; name: string; owner: string; updated: string; updatedBy: string; items: number; online: number; members?: string[] | null }

/** List of the team's moodboards; opens each one in its own canvas window. */
const Boards: React.FC<{ kind?: 'canvas' | 'kanban' }> = ({ kind = 'canvas' }) => {
  const plans = kind === 'kanban';
  const label = plans ? 'Planner' : 'Moodboards';
  const { isLoaded, isSignedIn } = useAuth();
  const api = useApi();
  const { openWindow } = useWindowManager();
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [sharing, setSharing] = useState(false);
  const { me } = useMe();

  const load = useCallback(() => {
    api(`/api/boards?kind=${kind}`).then(setBoards, (e) => setStatus(e.message));
  }, [api, kind]);
  useEffect(() => { if (isSignedIn) load(); }, [isSignedIn, load]);

  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name={label} />;

  const open = (b: Pick<BoardMeta, 'id' | 'name'>) =>
    plans
      ? openWindow({ id: `planner-${b.id}`, title: b.name, icon: '/images/icons/task-16x16.png', appType: 'planner', appProps: { boardId: b.id }, width: 1000, height: 640 })
      : openWindow({ id: `canvas-${b.id}`, title: b.name, icon: '/images/icons/paint-16x16.png', appType: 'canvas', appProps: { boardId: b.id, name: b.name }, width: 1000, height: 680 });

  const create = async () => {
    const name = window.prompt(plans ? 'Name the new plan (e.g. Album rollout):' : 'Name the new board:')?.trim();
    if (!name) return;
    try { open(await api('/api/boards', { method: 'POST', body: JSON.stringify({ name, kind }) })); load(); } catch (e) { setStatus((e as Error).message); }
  };
  const pick = boards?.find((b) => b.id === selected);
  const rename = async () => {
    const name = pick && window.prompt('Rename board:', pick.name)?.trim();
    if (!pick || !name) return;
    try { await api(`/api/boards/${pick.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); load(); } catch (e) { setStatus((e as Error).message); }
  };
  const canShare = !!pick && !!me && (pick.owner === me.username || me.admin);
  const saveSharing = async (members: string[] | null) => {
    setSharing(false);
    if (!pick) return;
    try { await api(`/api/boards/${pick.id}`, { method: 'PATCH', body: JSON.stringify({ members }) }); load(); } catch (e) { setStatus((e as Error).message); }
  };
  const remove = async () => {
    if (!pick || !window.confirm(`Delete the board "${pick.name}"? An admin can still recover it from data\\boards-trash.`)) return;
    try { await api(`/api/boards/${pick.id}`, { method: 'DELETE' }); setSelected(null); load(); } catch (e) { setStatus((e as Error).message); }
  };

  return (
    <div style={{ ...shell, position: 'relative' }}>
      <div style={toolbar}>
        <button style={button} onClick={create}>{plans ? 'New Plan...' : 'New Board...'}</button>
        <button style={button} disabled={!pick} onClick={() => pick && open(pick)}>Open</button>
        <button style={button} disabled={!pick} onClick={rename}>Rename</button>
        <button style={button} disabled={!pick} onClick={remove}>Delete</button>
        <button style={button} disabled={!canShare} onClick={() => setSharing(true)} title="Choose who can see it (creator or admin)">Sharing...</button>
        <button style={button} onClick={load}>Refresh</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: '0 2px', padding: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, alignContent: 'start' }}>
        {boards?.length === 0 && <div style={{ padding: 8, gridColumn: '1 / -1' }}>Nothing here yet. Click <b>{plans ? 'New Plan...' : 'New Board...'}</b> to start one.</div>}
        {boards?.map((b) => (
          <div
            key={b.id}
            onClick={() => (isTouch ? open(b) : setSelected(b.id))}
            onDoubleClick={() => open(b)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_BOARD, JSON.stringify({ boardId: b.id, name: b.name, kind }))}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6, textAlign: 'center', cursor: 'default', userSelect: 'none', background: selected === b.id ? '#000080' : undefined, color: selected === b.id ? '#fff' : undefined }}
          >
            <img src={plans ? '/images/icons/task-32x32.png' : '/images/icons/paint-32x32.png'} alt="" style={{ width: 32, height: 32 }} />
            <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{b.members ? '🔒 ' : ''}{b.name}</div>
            <div style={{ fontSize: 10, opacity: 0.8 }}>{b.items} item(s){b.online ? ` · ${b.online} online` : ''}</div>
            <div style={{ fontSize: 10, opacity: 0.8 }}>{new Date(b.updated).toLocaleDateString()} by {b.updatedBy}</div>
          </div>
        ))}
      </div>
      {sharing && pick && (
        <MembersPicker
          title={`Who can see "${pick.name}"?`}
          members={pick.members ?? null}
          always={pick.owner}
          note="Admins can always open every board, to help manage it."
          onSave={saveSharing}
          onClose={() => setSharing(false)}
        />
      )}
      <div style={statusBar}>{status || `${boards?.length ?? 0} ${plans ? 'plan' : 'board'}(s) — ${isTouch ? 'tap' : 'double-click'} to open · drag one into a chat to share it`}</div>
    </div>
  );
};

export default Boards;
