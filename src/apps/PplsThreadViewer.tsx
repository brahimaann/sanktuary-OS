import React, { useState } from 'react';
import { HISTORICAL_THREADS, TIMELINE_EVENTS } from './pplsStoryData';
import { useWindowManager } from '../wm/manager';

interface PplsThreadViewerProps {
  threadId: string;
}

const PplsThreadViewer: React.FC<PplsThreadViewerProps> = ({ threadId }) => {
  const { focusWindow } = useWindowManager();
  const [activeTab, setActiveTab] = useState<'transmission' | 'harm' | 'endurance' | 'overcoming'>('transmission');

  const thread = HISTORICAL_THREADS.find((t) => t.id === threadId);

  if (!thread) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontFamily: '"MS Sans Serif", Arial' }}>
        Historical Thread not found.
      </div>
    );
  }

  const handleEventClick = (eventId: string) => {
    // Dispatch custom event to let PplsStory app capture and select the event
    window.dispatchEvent(new CustomEvent('ppls-story-select-event', { detail: { eventId } }));
    focusWindow('ppls-story');
  };

  return (
    <div style={container}>
      {/* Thread title & core idea */}
      <div style={headerPane}>
        <div style={threadTitle}>{thread.title}</div>
        <div style={coreIdeaText}>
          <strong>Core Idea:</strong> {thread.coreIdea}
        </div>
      </div>

      {/* Retro Outset Tabs */}
      <div style={tabsRow}>
        {(['transmission', 'harm', 'endurance', 'overcoming'] as const).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                ...tabBtn,
                background: isActive ? '#c0c0c0' : '#d4d0c8',
                fontWeight: isActive ? 700 : 400,
                borderBottom: isActive ? '2px solid transparent' : '1.5px solid #808080',
                marginTop: isActive ? 0 : 2,
                height: isActive ? 24 : 22,
                zIndex: isActive ? 2 : 1,
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          );
        })}
      </div>

      {/* Tab Content Box */}
      <div style={contentBox}>
        {activeTab === 'transmission' && (
          <div>
            <div style={sectionTitle}>🔄 Global Transmission & Mutation</div>
            <p style={contentText}>{thread.globalTransmission}</p>
          </div>
        )}
        {activeTab === 'harm' && (
          <div>
            <div style={sectionTitle}>⚠️ Mechanism of Harm</div>
            <p style={contentText}>{thread.mechanismOfHarm}</p>
          </div>
        )}
        {activeTab === 'endurance' && (
          <div>
            <div style={sectionTitle}>🛡️ Modes of Endurance & Survival</div>
            <p style={contentText}>{thread.modesOfEndurance}</p>
          </div>
        )}
        {activeTab === 'overcoming' && (
          <div>
            <div style={sectionTitle}>✊ Modes of Overcoming & Liberation</div>
            <p style={contentText}>{thread.modesOfOvercoming}</p>
          </div>
        )}
      </div>

      {/* Connected Events timeline links */}
      <div style={eventsPane}>
        <div style={{ fontWeight: 700, fontSize: 10, color: '#444', marginBottom: 6 }}>
          🔗 CONNECTED HISTORICAL EVENTS:
        </div>
        <div style={eventsList}>
          {thread.connectedEventIds.map((id) => {
            const evt = TIMELINE_EVENTS.find((e) => e.id === id);
            if (!evt) return null;
            return (
              <div
                key={evt.id}
                onClick={() => handleEventClick(evt.id)}
                style={eventBadge}
                title="Click to focus this event in the encyclopedia"
              >
                <span style={{ fontWeight: 700, marginRight: 6 }}>{evt.year > 0 ? evt.year : `${Math.abs(evt.year)} BCE`}:</span>
                <span>{evt.title}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const container: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#c0c0c0',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11,
  padding: 6,
  boxSizing: 'border-box',
  overflow: 'hidden',
  color: '#000',
};

const headerPane: React.CSSProperties = {
  background: '#800000',
  color: '#fff',
  padding: '6px 10px',
  border: '2px inset #808080',
  marginBottom: 6,
  flexShrink: 0,
};

const threadTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 'bold',
  marginBottom: 4,
};

const coreIdeaText: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1.3,
  color: '#e0e0e0',
};

const tabsRow: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  paddingLeft: 4,
  position: 'relative',
  top: 1,
  zIndex: 1,
  flexShrink: 0,
};

const tabBtn: React.CSSProperties = {
  padding: '0 10px',
  fontSize: 10,
  border: '1.5px solid #ffffff',
  borderBottom: 'none',
  borderTopLeftRadius: 3,
  borderTopRightRadius: 3,
  cursor: 'pointer',
  outline: 'none',
  fontFamily: '"MS Sans Serif", Arial',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const contentBox: React.CSSProperties = {
  flex: 1,
  background: '#fff',
  border: '2px inset #808080',
  padding: '10px 12px',
  overflowY: 'auto',
  lineHeight: 1.5,
  display: 'flex',
  flexDirection: 'column',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#800000',
  borderBottom: '1px dashed #808000',
  paddingBottom: 4,
  marginBottom: 8,
};

const contentText: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#111',
};

const eventsPane: React.CSSProperties = {
  marginTop: 6,
  flexShrink: 0,
};

const eventsList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 90,
  overflowY: 'auto',
};

const eventBadge: React.CSSProperties = {
  background: '#e0e0e0',
  border: '1px outset #fff',
  padding: '3px 6px',
  cursor: 'pointer',
  fontSize: 9,
  display: 'flex',
  alignItems: 'center',
  transition: 'background 0.1s',
};

export default PplsThreadViewer;
