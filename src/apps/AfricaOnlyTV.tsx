import React, { useRef, useState, useEffect } from 'react';

const TARGET_URL = 'https://www.africaonly.tv/';

/** A minimal Win98‑style browser chrome wrapping AfricaOnly.TV */
const AfricaOnlyTV: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [address, setAddress] = useState(TARGET_URL);
  const [currentUrl, setCurrentUrl] = useState(TARGET_URL);
  const [status, setStatus] = useState('Done');
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [history, setHistory] = useState<string[]>([TARGET_URL]);
  const [histIdx, setHistIdx] = useState(0);

  // Detect X-Frame-Options block via a HEAD fetch
  useEffect(() => {
    setBlocked(false);
    setLoading(true);
    setStatus(`Opening ${currentUrl}…`);

    fetch(currentUrl, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        // no-cors means we can't actually read headers — just start loading
        setStatus(`Connecting to ${new URL(currentUrl).hostname}…`);
      })
      .catch(() => {
        setStatus('Network error');
      });
  }, [currentUrl]);

  const handleLoad = () => {
    setLoading(false);
    setStatus('Done');
    // Try reading the iframe's location to detect silent block
    try {
      const loc = iframeRef.current?.contentWindow?.location?.href;
      if (loc && loc !== currentUrl && !loc.startsWith(currentUrl)) {
        setBlocked(true);
      }
    } catch {
      // cross-origin block — site likely loaded fine but we can't inspect it
    }
  };

  const handleError = () => {
    setLoading(false);
    setBlocked(true);
    setStatus('Page could not be displayed');
  };

  const navigate = (url: string) => {
    let full = url.trim();
    if (!full.startsWith('http://') && !full.startsWith('https://')) {
      full = 'https://' + full;
    }
    const newHist = history.slice(0, histIdx + 1);
    newHist.push(full);
    setHistory(newHist);
    setHistIdx(newHist.length - 1);
    setCurrentUrl(full);
    setAddress(full);
  };

  const goBack = () => {
    if (histIdx > 0) {
      const idx = histIdx - 1;
      setHistIdx(idx);
      setCurrentUrl(history[idx]);
      setAddress(history[idx]);
    }
  };

  const goForward = () => {
    if (histIdx < history.length - 1) {
      const idx = histIdx + 1;
      setHistIdx(idx);
      setCurrentUrl(history[idx]);
      setAddress(history[idx]);
    }
  };

  const refresh = () => {
    setLoading(true);
    setBlocked(false);
    // Force iframe reload by toggling the src
    if (iframeRef.current) {
      iframeRef.current.src = currentUrl;
    }
    setStatus(`Refreshing…`);
  };

  const openExternal = () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={shell}>
      {/* ── Toolbar ── */}
      <div style={toolbar}>
        {/* Nav buttons */}
        <button style={navBtn} onClick={goBack} disabled={histIdx === 0} title="Back">◀</button>
        <button style={navBtn} onClick={goForward} disabled={histIdx >= history.length - 1} title="Forward">▶</button>
        <button style={navBtn} onClick={refresh} title="Refresh">↻</button>
        <button style={navBtn} onClick={() => navigate(TARGET_URL)} title="Home">🏠</button>

        <div style={sep} />

        {/* Address bar */}
        <span style={addrLabel}>Address</span>
        <div style={addrBox}>
          <img src="/images/icons/internet-explorer-16x16.png" style={{ width: 16, height: 16, marginRight: 4, flexShrink: 0 }} alt="" />
          <input
            style={addrInput}
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') navigate(address); }}
            spellCheck={false}
          />
          <button style={goBtn} onClick={() => navigate(address)}>Go</button>
        </div>

        <div style={sep} />

        {/* External open button */}
        <button style={{ ...navBtn, fontSize: 10, padding: '1px 6px' }} onClick={openExternal} title="Open in browser tab">
          ↗ Open
        </button>
      </div>

      {/* ── Content area ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
        {/* Loading shimmer bar */}
        {loading && !blocked && (
          <div style={progressBar}>
            <div style={progressFill} />
          </div>
        )}

        {/* Iframe */}
        {!blocked && (
          <iframe
            ref={iframeRef}
            key={currentUrl}
            src={currentUrl}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            title="AfricaOnly.TV"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
            referrerPolicy="no-referrer"
            onLoad={handleLoad}
            onError={handleError}
          />
        )}

        {/* Fallback page — shown when site blocks embedding */}
        {blocked && (
          <div style={fallback}>
            <img src="/images/icons/internet-explorer-32x32.png" style={{ width: 48, height: 48, imageRendering: 'pixelated' }} alt="" />
            <div style={{ fontWeight: 'bold', marginTop: 12, fontSize: 14 }}>
              This page cannot be displayed
            </div>
            <div style={{ color: '#555', fontSize: 11, marginTop: 6, maxWidth: 340, textAlign: 'center', lineHeight: 1.5 }}>
              <strong>AfricaOnly.TV</strong> has security settings that prevent it from being
              embedded inside another window (X‑Frame‑Options).
            </div>
            <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
              <button style={fbBtn} onClick={openExternal}>
                Open AfricaOnly.TV in browser
              </button>
              <button style={{ ...fbBtn, background: '#c0c0c0', color: '#000', border: '2px outset #e0e0e0' }} onClick={refresh}>
                Try Again
              </button>
            </div>
            <div style={{ marginTop: 20, color: '#888', fontSize: 10 }}>
              {currentUrl}
            </div>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div style={statusBar}>
        <div style={statusSegment}>
          {loading && !blocked ? '⏳ ' : blocked ? '🚫 ' : '✔ '}
          {status}
        </div>
        <div style={{ ...statusSegment, width: 120, textAlign: 'center', borderLeft: '1px solid #808080' }}>
          {new URL(currentUrl).hostname}
        </div>
        <div style={{ ...statusSegment, width: 80, textAlign: 'center', borderLeft: '1px solid #808080' }}>
          Internet
        </div>
      </div>
    </div>
  );
};

/* ── Styles ── */
const shell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
  background: '#c0c0c0', fontFamily: 'Arial, sans-serif', fontSize: 11,
  overflow: 'hidden',
};
const toolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 2,
  padding: '2px 4px', background: '#c0c0c0',
  borderBottom: '1px solid #808080',
  flexWrap: 'nowrap', flexShrink: 0,
};
const navBtn: React.CSSProperties = {
  minWidth: 24, height: 22, fontSize: 12, cursor: 'pointer',
  background: '#c0c0c0', border: '2px outset #e0e0e0',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 4px', flexShrink: 0,
};
const sep: React.CSSProperties = {
  width: 1, height: 20, background: '#808080', margin: '0 3px', flexShrink: 0,
};
const addrLabel: React.CSSProperties = {
  fontSize: 11, flexShrink: 0, marginRight: 4, color: '#000',
};
const addrBox: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flex: 1,
  background: '#fff', border: '2px inset #808080',
  padding: '1px 4px', height: 22, overflow: 'hidden',
};
const addrInput: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none', fontSize: 11,
  fontFamily: 'Arial, sans-serif', background: 'transparent',
  minWidth: 0,
};
const goBtn: React.CSSProperties = {
  flexShrink: 0, height: 18, fontSize: 10, cursor: 'pointer',
  background: '#c0c0c0', border: '2px outset #e0e0e0',
  padding: '0 6px', marginLeft: 2,
};
const progressBar: React.CSSProperties = {
  position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 10,
  background: '#c0c0c0', overflow: 'hidden',
};
const progressFill: React.CSSProperties = {
  height: '100%', background: '#000080',
  animation: 'ie-progress 1.6s linear infinite',
  width: '40%',
};
const fallback: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', height: '100%', background: '#fff',
  padding: 24, fontFamily: 'Arial, sans-serif',
};
const fbBtn: React.CSSProperties = {
  padding: '4px 14px', fontSize: 11, cursor: 'pointer',
  background: '#000080', color: '#fff',
  border: '2px outset #4040a0', fontFamily: 'Arial, sans-serif',
};
const statusBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  background: '#c0c0c0', borderTop: '1px solid #ffffff',
  flexShrink: 0, height: 20,
};
const statusSegment: React.CSSProperties = {
  flex: 1, fontSize: 10, padding: '0 6px',
  border: '1px inset #808080', height: '100%',
  display: 'flex', alignItems: 'center', overflow: 'hidden',
  whiteSpace: 'nowrap', textOverflow: 'ellipsis',
};

export default AfricaOnlyTV;
