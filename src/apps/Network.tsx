import React from 'react';
import { useAuth } from '@clerk/react';
import { useWindowManager } from '../wm/manager';
import { useMe, SpaceInfo } from '../utils/api';
import { formatSize, isTouch } from './fileTypes';
import { LogOn, shell, toolbar, button, statusBar } from './TeamFiles';

const RIGHTS_LABEL = { none: 'No access', view: 'View only', upload: 'Can upload', edit: 'Full edit' };

/** "Network Neighborhood" for Sanktuary: every space this member can reach, with free space. */
const Network: React.FC = () => {
  const { isLoaded, isSignedIn } = useAuth();
  const { me, reload } = useMe();
  const { openWindow } = useWindowManager();

  if (!isLoaded) return <div style={{ ...shell, padding: 16 }}>Connecting...</div>;
  if (!isSignedIn) return <LogOn name="Team Files" />;

  const open = (s: SpaceInfo) =>
    openWindow({
      id: `space-${s.id}`,
      title: s.name,
      icon: '/images/icons/folder-16x16.png',
      appType: 'team-files',
      appProps: { app: s.id },
    });

  return (
    <div style={shell}>
      <div style={toolbar}>
        <button style={button} onClick={reload}>
          Refresh
        </button>
        <span style={{ marginLeft: 6 }}>{me ? `Logged on as ${me.username}${me.admin ? ' (admin)' : ''}` : 'Loading...'}</span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: '#fff',
          border: '2px inset #808080',
          margin: '0 2px',
          padding: 8,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 8,
          alignContent: 'start',
        }}
      >
        {me?.spaces.length === 0 && <div style={{ padding: 8 }}>No spaces are shared with you yet. Ask an admin for access.</div>}
        {me?.spaces.map((s) => {
          const [used, total] = s.quota ? [s.used || 0, s.quota] : s.total ? [s.total - (s.free || 0), s.total] : [0, 0];
          return (
            <div
              key={s.id}
              onClick={() => isTouch && s.online && open(s)}
              onDoubleClick={() => s.online && open(s)}
              style={{
                display: 'flex',
                gap: 8,
                padding: 6,
                border: '1px solid #c0c0c0',
                cursor: 'default',
                opacity: s.online ? 1 : 0.55,
                userSelect: 'none',
              }}
              title={s.online ? 'Open' : 'Drive is unplugged'}
            >
              <img
                src={s.id === 'me' ? '/images/icons/my-documents-32x32.png' : '/images/icons/hard-disk-drive-32x32.png'}
                alt=""
                style={{ width: 32, height: 32 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <div style={{ color: '#444' }}>
                  {s.online ? RIGHTS_LABEL[s.rights] : 'Offline — drive unplugged'}
                  {s.driveName ? ` · ${s.driveName}` : ''}
                </div>
                {s.online && total > 0 && (
                  <>
                    <div style={{ height: 10, border: '1px inset #808080', background: '#fff', marginTop: 4 }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, (used / total) * 100)}%`,
                          background: used / total > 0.9 ? '#a00000' : '#000080',
                        }}
                      />
                    </div>
                    <div style={{ color: '#444', marginTop: 2 }}>
                      {s.quota
                        ? `${formatSize(used)} of ${formatSize(total)} used`
                        : `${formatSize(s.free || 0)} free of ${formatSize(total)}`}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={statusBar}>{me ? `${me.spaces.length} space(s) — ${isTouch ? 'tap' : 'double-click'} to open` : ''}</div>
    </div>
  );
};

export default Network;
