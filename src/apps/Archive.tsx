import React, { useEffect, useState } from 'react';
import { useApi } from '../utils/api';
import { shell, button, statusBar } from './TeamFiles';
import RetroIcon from '../components/RetroIcon';
import { openStudio } from './Studio';
import { useWindowManager } from '../wm/manager';

interface ArchiveItem {
  id: string;
  title: string;
  type: 'release' | 'timeline' | 'session' | 'project';
  date: string;
  detail: string;
}

export const Archive: React.FC = () => {
  const api = useApi();
  const { openWindow } = useWindowManager();
  const [filter, setFilter] = useState<'all' | 'release' | 'timeline'>('all');
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api('/api/tracks').catch(() => ({ releases: [] })),
      api('/api/timeline').catch(() => ({ items: [] })),
    ]).then(([tracksData, timelineData]) => {
      const list: ArchiveItem[] = [];

      // Releases that are released or past date
      for (const r of tracksData.releases || []) {
        list.push({
          id: r.id,
          title: r.title,
          type: 'release',
          date: r.date || 'No date',
          detail: `${r.kind} · ${r.artist || 'Sanktuary'}`,
        });
      }

      // Past timeline events
      for (const t of timelineData.items || []) {
        if (t.past || (t.start && new Date(t.start).getTime() < Date.now())) {
          list.push({
            id: t.id,
            title: t.title,
            type: 'timeline',
            date: t.start || 'Past',
            detail: `${t.kind} ${t.location ? `· ${t.location}` : ''}`,
          });
        }
      }

      setItems(list.sort((a, b) => b.date.localeCompare(a.date)));
      setLoading(false);
    });
  }, [api]);

  const filtered = filter === 'all' ? items : items.filter((i) => i.type === filter);

  return (
    <div style={{ ...shell, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 6, padding: '4px 6px', background: '#dcdcdc', borderBottom: '1px solid #808080', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 11 }}>Archive Filter:</span>
        {(['all', 'release', 'timeline'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...button,
              fontSize: 11,
              padding: '2px 8px',
              fontWeight: filter === f ? 700 : 400,
              background: filter === f ? '#000080' : '#c0c0c0',
              color: filter === f ? '#fff' : '#000',
            }}
          >
            {f === 'all' ? 'All Archives' : f === 'release' ? 'Releases' : 'Timeline'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#444' }}>
          {filtered.length} item(s) preserved
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: '#fff', border: '2px inset #808080', margin: 4 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #808080', textAlign: 'left' }}>
              <th style={{ padding: '3px 6px', width: 24 }}></th>
              <th style={{ padding: '3px 6px' }}>Title</th>
              <th style={{ padding: '3px 6px', width: 90 }}>Type</th>
              <th style={{ padding: '3px 6px', width: 90 }}>Date</th>
              <th style={{ padding: '3px 6px' }}>Details</th>
              <th style={{ padding: '3px 6px', width: 60 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#666' }}>
                  Loading archive...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, textAlign: 'center', color: '#666' }}>
                  No archived items found.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={`${item.type}-${item.id}`} style={{ borderBottom: '1px solid #e0e0e0' }}>
                  <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                    <RetroIcon name={item.type === 'release' ? 'archive' : 'calendar'} size={16} />
                  </td>
                  <td style={{ padding: '3px 6px', fontWeight: 700 }}>{item.title}</td>
                  <td style={{ padding: '3px 6px', textTransform: 'capitalize', color: '#444' }}>{item.type}</td>
                  <td style={{ padding: '3px 6px', color: '#666' }}>{item.date}</td>
                  <td style={{ padding: '3px 6px', color: '#333' }}>{item.detail}</td>
                  <td style={{ padding: '3px 6px' }}>
                    <button
                      style={{ ...button, fontSize: 10, padding: '1px 6px' }}
                      onClick={() => {
                        if (item.type === 'release') {
                          window.dispatchEvent(new CustomEvent('sk:tracks-release', { detail: item.id }));
                          openStudio(openWindow, 'songs');
                        } else {
                          window.dispatchEvent(new CustomEvent('sk:timeline-entry', { detail: item.id }));
                          openStudio(openWindow, 'calendar');
                        }
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={statusBar}>Archive vault: past releases, finished timeline milestones, and historic projects.</div>
    </div>
  );
};

export default Archive;
