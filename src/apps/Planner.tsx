import React, { useState } from 'react';
import { useAuth } from '@clerk/react';
import { useBoard } from '../utils/useBoard';
import { displayName, useProfiles } from '../utils/profiles';
import { Ref, refFromDrop, useOpenRef } from '../utils/refs';
import { RefChip } from './Chat';
import Avatar from './Avatar';
import { LogOn, shell, toolbar, button, statusBar } from './TeamFiles';

/** Kanban planner: columns of cards, edited live by the whole team (same live board engine as Moodboards). */
interface Column { id: string; type: 'column'; title: string; order: number }
interface Card { id: string; type: 'card'; col: string; order: number; title: string; text?: string; assignee?: string; due?: string; color?: string; refs?: Ref[] }
type PlanItem = Column | Card;

const LABELS = ['', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
const CARD_MIME = 'application/x-sk-card';
const newId = () => crypto.randomUUID().slice(0, 12);
const today = () => new Date().toISOString().slice(0, 10);

const Planner: React.FC<{ boardId: string; name: string }> = ({ boardId, name }) => {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name={name} />;
  return <Plan boardId={boardId} />;
};

const Plan: React.FC<{ boardId: string }> = ({ boardId }) => {
  const { items, peers, status, queue, me } = useBoard<PlanItem>(boardId);
  const { profiles, byName } = useProfiles();
  const [editing, setEditing] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const all = Object.values(items);
  const columns = all.filter((i): i is Column => i.type === 'column').sort((a, b) => a.order - b.order);
  const cardsIn = (col: string) => all.filter((i): i is Card => i.type === 'card' && i.col === col).sort((a, b) => a.order - b.order);
  const doneCol = columns.find((c) => /done/i.test(c.title))?.id;

  const addColumn = () => {
    const title = window.prompt('Column name:')?.trim();
    const id = newId();
    if (title) queue({ [id]: { id, type: 'column', title, order: (columns.at(-1)?.order ?? 0) + 1 } }, true);
  };
  const addCard = (col: string) => {
    const title = window.prompt('Card title:')?.trim();
    if (!title) return;
    const id = newId();
    queue({ [id]: { id, type: 'card', col, order: (cardsIn(col).at(-1)?.order ?? 0) + 1, title } }, true);
  };
  const renameColumn = (c: Column) => {
    const title = window.prompt('Rename column:', c.title)?.trim();
    if (title) queue({ [c.id]: { ...c, title } }, true);
  };
  const removeColumn = (c: Column) => {
    if (cardsIn(c.id).length) return window.alert('Move or delete the cards in this column first.');
    if (window.confirm(`Delete the column "${c.title}"?`)) queue({ [c.id]: null }, true);
  };

  // Drop a card before another card, or at the end of a column
  const dropCard = (e: React.DragEvent, col: string, before?: Card) => {
    e.preventDefault();
    e.stopPropagation();
    setOverCol(null);
    const card = items[e.dataTransfer.getData(CARD_MIME)] as Card | undefined;
    if (!card || card.id === before?.id) return;
    const list = cardsIn(col).filter((c) => c.id !== card.id);
    const i = before ? list.findIndex((c) => c.id === before.id) : list.length;
    const prev = list[i - 1]?.order ?? (list[0]?.order ?? 1) - 1;
    const next = list[i]?.order ?? prev + 2;
    queue({ [card.id]: { ...card, col, order: (prev + next) / 2 } }, true);
  };

  const others = Object.values(peers);
  const editCard = editing ? (items[editing] as Card | undefined) : undefined;

  return (
    <div style={{ ...shell, position: 'relative' }}>
      <div style={toolbar}>
        <button style={button} onClick={addColumn}>Add column...</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2 }} title={['you', ...others.map((p) => p.user)].join(', ')}>
          {[me.current?.user, ...others.map((p) => p.user)].filter(Boolean).map((u, i) => <Avatar key={i} username={u!} avatar={byName[u!]?.avatar} size={20} />)}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 8, overflow: 'auto', padding: 8, background: '#008080', margin: '0 2px', border: '2px inset #808080', alignItems: 'flex-start' }}>
        {columns.map((col) => {
          const cards = cardsIn(col.id);
          return (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
              onDrop={(e) => dropCard(e, col.id)}
              style={{ width: 250, flexShrink: 0, background: '#c0c0c0', borderTop: '1px solid #fff', borderLeft: '1px solid #fff', borderRight: '1px solid #000', borderBottom: '1px solid #000', display: 'flex', flexDirection: 'column', maxHeight: '100%', outline: overCol === col.id ? '2px dashed #000080' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 4px', background: '#000080', color: '#fff', fontWeight: 700 }}>
                <span style={{ flex: 1, cursor: 'default' }} onDoubleClick={() => renameColumn(col)} title="Double-click to rename">{col.title}</span>
                <span style={{ fontWeight: 400 }}>{cards.length}</span>
                <button onClick={() => removeColumn(col)} title="Delete column" style={{ ...button, padding: '0 4px', minHeight: 0 }}>×</button>
              </div>
              <div style={{ overflow: 'auto', padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cards.map((c) => {
                  const late = c.due && c.due < today() && c.col !== doneCol;
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData(CARD_MIME, c.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => dropCard(e, col.id, c)}
                      onClick={() => setEditing(c.id)}
                      style={{ background: '#fff', border: '1px solid #808080', borderLeft: `5px solid ${c.color || '#fff'}`, padding: 6, cursor: 'pointer', boxShadow: '1px 1px 0 #000' }}
                    >
                      <div style={{ fontWeight: 700, wordBreak: 'break-word', textDecoration: c.col === doneCol ? 'line-through' : 'none' }}>{c.title}</div>
                      {c.text && <div style={{ color: '#555', marginTop: 2, overflow: 'hidden', maxHeight: 30 }}>{c.text}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: '#555' }}>
                        {c.assignee && <><Avatar username={c.assignee} avatar={byName[c.assignee]?.avatar} size={16} /><span>{displayName(byName[c.assignee], c.assignee)}</span></>}
                        {c.due && <span style={{ color: late ? '#c00000' : '#555', fontWeight: late ? 700 : 400 }}>📅 {new Date(c.due + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                        {!!c.refs?.length && <span>🔗 {c.refs.length}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button style={{ ...button, margin: 4 }} onClick={() => addCard(col.id)}>+ Add card</button>
            </div>
          );
        })}
      </div>
      <div style={statusBar}>{status || `${columns.length} column(s) · drag cards between columns · click a card for details`}</div>
      {editCard && (
        <CardEditor
          card={editCard}
          columns={columns}
          people={profiles.map((p) => p.username)}
          nameOf={(u) => displayName(byName[u], u)}
          onChange={(c) => queue({ [c.id]: c })}
          onDelete={() => { if (window.confirm(`Delete "${editCard.title}"?`)) { queue({ [editCard.id]: null }, true); setEditing(null); } }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

const CardEditor: React.FC<{
  card: Card; columns: Column[]; people: string[]; nameOf: (u: string) => string;
  onChange: (c: Card) => void; onDelete: () => void; onClose: () => void;
}> = ({ card, columns, people, nameOf, onChange, onDelete, onClose }) => {
  const openRef = useOpenRef();
  const set = (patch: Partial<Card>) => onChange({ ...card, ...patch });
  const onDrop = (e: React.DragEvent) => {
    const r = refFromDrop(e.dataTransfer);
    if (!r) return;
    e.preventDefault();
    set({ refs: [...(card.refs || []), r].slice(0, 20) });
  };
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} style={{ width: 'min(440px, 92%)', maxHeight: '92%', overflow: 'auto', background: '#c0c0c0', borderTop: '2px solid #fff', borderLeft: '2px solid #fff', borderRight: '2px solid #000', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#000080', color: '#fff', fontWeight: 700, padding: '3px 6px', display: 'flex' }}>
          <span style={{ flex: 1 }}>Card details</span>
          <button onClick={onClose} style={{ ...button, padding: '0 5px', minHeight: 0 }}>×</button>
        </div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={card.title} onChange={(e) => set({ title: e.target.value })} style={{ ...field, fontWeight: 700, fontSize: 13 }} />
          <textarea value={card.text || ''} placeholder="Notes..." rows={4} onChange={(e) => set({ text: e.target.value })} style={{ ...field, resize: 'vertical' }} />
          <label style={row}>Column
            <select value={card.col} onChange={(e) => set({ col: e.target.value })} style={field}>{columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
          </label>
          <label style={row}>Assigned to
            <select value={card.assignee || ''} onChange={(e) => set({ assignee: e.target.value || undefined })} style={field}>
              <option value="">(nobody)</option>
              {people.map((u) => <option key={u} value={u}>{nameOf(u)}</option>)}
            </select>
          </label>
          <label style={row}>Due date
            <input type="date" value={card.due || ''} onChange={(e) => set({ due: e.target.value || undefined })} style={field} />
          </label>
          <div style={row}>Label
            <div style={{ display: 'flex', gap: 4 }}>
              {LABELS.map((c) => <button key={c || 'none'} onClick={() => set({ color: c || undefined })} title={c ? '' : 'No label'} style={{ width: 20, height: 20, padding: 0, background: c || '#fff', border: (card.color || '') === c ? '2px solid #000' : '1px solid #808080' }} />)}
            </div>
          </div>
          <div>
            <div style={{ marginBottom: 2 }}>Links <span style={{ color: '#555' }}>(drag files, folders or boards onto this box)</span></div>
            <div style={{ minHeight: 28, background: '#fff', border: '2px inset #808080', padding: 2 }}>
              {(card.refs || []).map((r, i) => <RefChip key={i} r={r} onOpen={() => openRef(r)} onRemove={() => set({ refs: card.refs!.filter((_, j) => j !== i) })} />)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8 }}>
          <button style={button} onClick={onDelete}>Delete card</button>
          <button style={{ ...button, fontWeight: 700 }} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

const field: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, padding: '2px 4px', border: '2px inset #808080', background: '#fff', minWidth: 0 };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 6 };

export default Planner;
