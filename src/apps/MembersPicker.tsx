import React, { useState } from 'react';
import { displayName, memberFor, useProfiles } from '../utils/profiles';
import { useWindowManager } from '../wm/manager';
import Avatar from './Avatar';
import { button } from './TeamFiles';

/**
 * Dialog for choosing who can see something. `members === null` means everyone.
 * `always` (the creator) is always included and can't be unticked.
 * With `listeners`, each person in it can also be set to "Can listen" (see and comment, not change) instead of "Can edit".
 */
const MembersPicker: React.FC<{
  title: string;
  members: string[] | null;
  always?: string;
  allowEveryone?: boolean;
  note?: string;
  listeners?: string[];
  /** With `owners`, a person can also be made a co-owner: they then decide who sees, edits and listens too. */
  owners?: string[];
  onSave: (members: string[] | null, listeners: string[], owners: string[]) => void;
  onClose: () => void;
}> = ({ title, members, always, allowEveryone = true, note, listeners, owners, onSave, onClose }) => {
  const { profiles } = useProfiles();
  const [everyone, setEveryone] = useState(allowEveryone && members === null);
  const [picked, setPicked] = useState<Set<string>>(new Set([...(members || []), ...(always ? [always] : [])]));
  const [listen, setListen] = useState(new Set(listeners));
  const [own, setOwn] = useState(new Set(owners));
  const setRole = (u: string, role: string) => {
    setListen((l) => {
      const n = new Set(l);
      role === 'listen' ? n.add(u) : n.delete(u);
      return n;
    });
    setOwn((o) => {
      const n = new Set(o);
      role === 'own' ? n.add(u) : n.delete(u);
      return n;
    });
  };
  const toggle = (u: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(u) ? n.delete(u) : n.add(u);
      return n;
    });

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
                {p.username === always ? (owners ? ' (owner)' : ' (creator)') : ''}
                {listeners && p.username !== always && (everyone || picked.has(p.username)) && (
                  <select
                    style={{ marginLeft: 'auto', fontSize: 11 }}
                    value={own.has(p.username) ? 'own' : listen.has(p.username) ? 'listen' : 'edit'}
                    onChange={(e) => setRole(p.username, e.target.value)}
                  >
                    {owners && <option value="own">Co-owner</option>}
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
              const inIt = (u: string) => u !== always && (!m || m.includes(u));
              onSave(m, [...listen].filter(inIt), [...own].filter(inIt));
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

/** Artist credits ("HIMA, Prince") with each name that's a member linked to their profile, matched as you type. */
export const ArtistLinks: React.FC<{ names: string | string[]; onRemove?: (i: number) => void }> = ({ names, onRemove }) => {
  const { profiles } = useProfiles();
  const { openWindow } = useWindowManager();
  const list = (Array.isArray(names) ? names : names.split(',')).map((n) => n.trim()).filter(Boolean);
  return (
    <>
      {list.map((n, i) => {
        const p = memberFor(n, profiles);
        return (
          <span key={n} className="sk-chip" title={p ? `${displayName(p)}'s profile` : 'Not a member (yet)'}>
            {p ? (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  openWindow({
                    id: `profile-${p.username}`,
                    title: `${displayName(p)} — Info`,
                    icon: '/images/icons/my-documents-16x16.png?v=2',
                    appType: 'profile',
                    appProps: { username: p.username },
                    width: 420,
                    height: 520,
                  });
                }}
                style={{ color: 'inherit' }}
              >
                {n} <span style={{ opacity: 0.6 }}>@{p.username}</span>
              </a>
            ) : (
              n
            )}
            {onRemove && (
              <button className="sk-chip-x" title={`Remove ${n}`} onClick={() => onRemove(i)}>
                ×
              </button>
            )}
          </span>
        );
      })}
    </>
  );
};

/** Member names to suggest in an artist box (pair with <input list="sk-members">). */
export const MemberOptions: React.FC = () => {
  const { profiles } = useProfiles();
  return (
    <datalist id="sk-members">
      {profiles.map((p) => (
        <option key={p.username} value={displayName(p)}>
          @{p.username}
        </option>
      ))}
    </datalist>
  );
};
