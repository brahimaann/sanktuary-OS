import React, { useState } from 'react';
import { displayName, useProfiles } from '../utils/profiles';
import Avatar from './Avatar';
import { button } from './TeamFiles';

/**
 * Dialog for choosing who can see something. `members === null` means everyone.
 * `always` (the creator) is always included and can't be unticked.
 * With `listeners`, each person in it can also be set to "Can listen" (see and comment, not change) instead of "Can edit".
 * With `listenFirst`, people are "Can listen" unless they're in `editors` (how new music projects start).
 */
const MembersPicker: React.FC<{
  title: string;
  members: string[] | null;
  always?: string;
  allowEveryone?: boolean;
  note?: string;
  listeners?: string[];
  listenFirst?: boolean;
  editors?: string[];
  onSave: (members: string[] | null, listeners: string[], editors: string[]) => void;
  onClose: () => void;
}> = ({ title, members, always, allowEveryone = true, note, listeners, listenFirst, editors, onSave, onClose }) => {
  const { profiles } = useProfiles();
  const [everyone, setEveryone] = useState(allowEveryone && members === null);
  const [picked, setPicked] = useState<Set<string>>(new Set([...(members || []), ...(always ? [always] : [])]));
  // Roles changed in this dialog; everyone else keeps what they had (or the project's starting role)
  const [roles, setRoles] = useState<Record<string, boolean>>({});
  const listens = (u: string) => roles[u] ?? (editors?.includes(u) ? false : listeners?.includes(u) || !!listenFirst);
  const setRole = (u: string, onlyListen: boolean) => setRoles((r) => ({ ...r, [u]: onlyListen }));
  const toggle = (u: string) => {
    // Someone newly let in starts at "Can listen"; the creator raises them to "Can edit"
    if (listeners && !picked.has(u)) setRole(u, true);
    setPicked((p) => {
      const n = new Set(p);
      n.has(u) ? n.delete(u) : n.add(u);
      return n;
    });
  };

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
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(320px, 92%)',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          borderTop: '2px solid #fff',
          borderLeft: '2px solid #fff',
          borderRight: '2px solid #000',
          borderBottom: '2px solid #000',
        }}
      >
        <div style={{ background: '#000', color: '#fff', fontWeight: 700, padding: '3px 6px' }}>{title}</div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
          {allowEveryone && (
            <>
              <label>
                <input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> Everyone on the team
              </label>
              <label>
                <input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> Only these people 🔒
              </label>
            </>
          )}
          <div
            style={{
              overflow: 'auto',
              background: '#fff',
              border: '2px inset #808080',
              maxHeight: 240,
              opacity: everyone && !listeners ? 0.5 : 1,
            }}
          >
            {profiles.map((p) => (
              <label key={p.username} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px' }}>
                <input
                  type="checkbox"
                  disabled={everyone || p.username === always}
                  checked={p.username === always || picked.has(p.username)}
                  onChange={() => toggle(p.username)}
                />
                <Avatar username={p.username} avatar={p.avatar} size={18} />
                {displayName(p)}
                {p.username === always ? ' (creator)' : ''}
                {listeners && p.username !== always && (everyone || picked.has(p.username)) && (
                  <select
                    style={{ marginLeft: 'auto', fontSize: 11 }}
                    value={listens(p.username) ? 'listen' : 'edit'}
                    onChange={(e) => setRole(p.username, e.target.value === 'listen')}
                  >
                    <option value="edit">Can edit</option>
                    <option value="listen">Can listen</option>
                  </select>
                )}
              </label>
            ))}
          </div>
          {note && <div style={{ color: '#444' }}>{note}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, padding: 8 }}>
          <button style={button} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...button, fontWeight: 700 }}
            onClick={() => {
              const m = everyone ? null : [...picked];
              const shown = profiles.map((p) => p.username).filter((u) => u !== always && (!m || m.includes(u)));
              onSave(
                m,
                shown.filter((u) => listens(u)),
                shown.filter((u) => !listens(u)),
              );
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default MembersPicker;
