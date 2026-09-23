import React, { useState, useRef, useEffect, useCallback } from 'react';

interface InternetExplorerProps {
  src?: string;
  windowId?: string;
}

interface HistoryEntry {
  url: string;
  title: string;
}

const DEFAULT_HOME = 'https://en.m.wikipedia.org/wiki/African_history';

const FAVORITES: { title: string; url: string }[] = [
  { title: 'African History — Wikipedia', url: 'https://en.m.wikipedia.org/wiki/African_history' },
  { title: 'Burna Boy Official', url: 'https://en.m.wikipedia.org/wiki/Burna_Boy' },
  { title: 'Frantz Fanon Studies', url: 'https://en.m.wikipedia.org/wiki/Frantz_Fanon' },
  { title: 'Yorùbá Talking Drum', url: 'https://en.m.wikipedia.org/wiki/Talking_drum' },
  { title: 'Fela Kuti & Afrobeat', url: 'https://en.m.wikipedia.org/wiki/Fela_Kuti' },
  { title: 'Pan-Africanism Movement', url: 'https://en.m.wikipedia.org/wiki/Pan-Africanism' },
  { title: 'Walter Rodney (How Europe Underdeveloped Africa)', url: 'https://en.m.wikipedia.org/wiki/Walter_Rodney' },
  { title: 'Mansa Musa', url: 'https://en.m.wikipedia.org/wiki/Mansa_Musa' },
  { title: 'Amílcar Cabral Foundation', url: 'https://en.m.wikipedia.org/wiki/Am%C3%ADlcar_Cabral' },
  { title: 'Miriam Makeba (Mama Africa)', url: 'https://en.m.wikipedia.org/wiki/Miriam_Makeba' },
];

export const InternetExplorer: React.FC<InternetExplorerProps> = ({
  src = DEFAULT_HOME,
}) => {
  const [history, setHistory] = useState<HistoryEntry[]>([{ url: src, title: src }]);
  const [histIdx, setHistIdx] = useState(0);
  const [addressBarValue, setAddressBarValue] = useState(src);
  const [isLoading, setIsLoading] = useState(true);
  const [statusText, setStatusText] = useState('Done');
  const [showFavorites, setShowFavorites] = useState(false);
  const [showFavMenu, setShowFavMenu] = useState(false);
  const [pageTitle, setPageTitle] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState(0);

  const currentUrl = history[histIdx]?.url ?? src;

  // Simulate loading progress bar
  const startProgress = () => {
    setProgress(0);
    setIsLoading(true);
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) {
          clearInterval(progressRef.current!);
          return 90;
        }
        return p + Math.random() * 15;
      });
    }, 120);
  };

  const finishProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
    setIsLoading(false);
    setStatusText('Done');
    setTimeout(() => setProgress(0), 600);
  };

  const navigate = useCallback((url: string) => {
    let finalUrl = url.trim();
    if (!finalUrl) return;
    // Add protocol if missing
    if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('//')) {
      finalUrl = 'https://' + finalUrl;
    }
    const newEntry: HistoryEntry = { url: finalUrl, title: finalUrl };
    const newHistory = history.slice(0, histIdx + 1);
    newHistory.push(newEntry);
    setHistory(newHistory);
    setHistIdx(newHistory.length - 1);
    setAddressBarValue(finalUrl);
    setStatusText(`Opening: ${finalUrl}`);
    startProgress();
    setShowFavMenu(false);
    setShowFavorites(false);
  }, [history, histIdx]);

  const handleBack = () => {
    if (histIdx > 0) {
      const idx = histIdx - 1;
      setHistIdx(idx);
      setAddressBarValue(history[idx].url);
      setStatusText(`Going back...`);
      startProgress();
    }
  };

  const handleForward = () => {
    if (histIdx < history.length - 1) {
      const idx = histIdx + 1;
      setHistIdx(idx);
      setAddressBarValue(history[idx].url);
      setStatusText(`Going forward...`);
      startProgress();
    }
  };

  const handleRefresh = () => {
    setStatusText('Refreshing...');
    startProgress();
    // Force iframe reload by toggling the key
    if (iframeRef.current) {
      const curr = iframeRef.current.src;
      iframeRef.current.src = '';
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = curr;
      }, 50);
    }
  };

  const handleStop = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setIsLoading(false);
    setProgress(0);
    setStatusText('Stopped.');
    if (iframeRef.current) {
      // Can't really stop an iframe, but we can blur it
      iframeRef.current.blur();
    }
  };

  const handleHome = () => {
    navigate(DEFAULT_HOME);
  };

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigate(addressBarValue);
    }
  };

  const handleIframeLoad = () => {
    finishProgress();
    try {
      const title = iframeRef.current?.contentDocument?.title;
      if (title) {
        setPageTitle(title);
        // Update history entry title
        setHistory((prev) => {
          const copy = [...prev];
          copy[histIdx] = { ...copy[histIdx], title };
          return copy;
        });
      }
    } catch (_) {
      // Cross-origin, can't read title
      setPageTitle(currentUrl);
    }
  };

  useEffect(() => {
    startProgress();
  }, []);

  const canBack = histIdx > 0;
  const canForward = histIdx < history.length - 1;

  return (
    <div style={shell}>
      {/* ── Menu Bar ── */}
      <div style={menuBar}>
        {['File', 'Edit', 'View', 'Go'].map((m) => (
          <span key={m} style={menuItem}>{m}</span>
        ))}

        {/* Favorites with dropdown */}
        <div style={{ position: 'relative' }}>
          <span
            style={{ ...menuItem, background: showFavMenu ? 'var(--sabr-title-active-start)' : 'transparent', color: showFavMenu ? '#fff' : '#000' }}
            onClick={() => { setShowFavMenu(!showFavMenu); setShowFavorites(false); }}
          >
            Favorites
          </span>
          {showFavMenu && (
            <div style={favDropdown}>
              <div style={favHeader}>★ Bookmarks</div>
              {FAVORITES.map((fav) => (
                <div
                  key={fav.url}
                  style={favItem}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sabr-title-active-start)', e.currentTarget.style.color = '#fff')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = '#000')}
                  onClick={() => navigate(fav.url)}
                >
                  <img src="/images/icons/internet-explorer-16x16.png" alt="" style={{ width: 14, height: 14, marginRight: 6, imageRendering: 'pixelated' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                  {fav.title}
                </div>
              ))}
            </div>
          )}
        </div>

        <span style={menuItem}>Help</span>
        <div style={{ flex: 1 }} />
        <img src="/images/icons/internet-explorer-16x16.png" alt="IE" style={{ width: 22, height: 22, marginRight: 6, imageRendering: 'pixelated' }} onError={(e) => (e.currentTarget.style.display = 'none')} />
      </div>

      {/* ── Toolbar ── */}
      <div style={toolbar}>
        {/* Back */}
        <button style={{ ...toolBtn, opacity: canBack ? 1 : 0.4 }} disabled={!canBack} onClick={handleBack} title="Back">
          <span style={toolIcon}>◀</span>
          <span style={toolLabel}>Back</span>
        </button>

        {/* Forward */}
        <button style={{ ...toolBtn, opacity: canForward ? 1 : 0.4 }} disabled={!canForward} onClick={handleForward} title="Forward">
          <span style={toolLabel}>Forward</span>
          <span style={toolIcon}>▶</span>
        </button>

        <div style={toolSep} />

        {/* Stop */}
        <button style={{ ...toolBtn, opacity: isLoading ? 1 : 0.4 }} onClick={handleStop} title="Stop">
          <span style={{ ...toolIcon, color: '#cc0000' }}>✕</span>
          <span style={toolLabel}>Stop</span>
        </button>

        {/* Refresh */}
        <button style={toolBtn} onClick={handleRefresh} title="Refresh">
          <span style={{ ...toolIcon, color: '#007700' }}>↻</span>
          <span style={toolLabel}>Refresh</span>
        </button>

        {/* Home */}
        <button style={toolBtn} onClick={handleHome} title="Home">
          <span style={toolIcon}>🏠</span>
          <span style={toolLabel}>Home</span>
        </button>

        <div style={toolSep} />

        {/* Favorites toggle */}
        <button style={{ ...toolBtn, background: showFavorites ? '#b0b0b0' : 'transparent' }} onClick={() => { setShowFavorites(!showFavorites); setShowFavMenu(false); }} title="Favorites">
          <span style={toolIcon}>★</span>
          <span style={toolLabel}>Favorites</span>
        </button>
      </div>

      {/* ── Address Bar ── */}
      <div style={addressBar}>
        <span style={addressLabel}>Address</span>
        <input
          type="text"
          value={addressBarValue}
          onChange={(e) => setAddressBarValue(e.target.value)}
          onKeyDown={handleAddressKeyDown}
          style={addressInput}
          spellCheck={false}
          aria-label="Address bar"
        />
        <button style={goBtn} onClick={() => navigate(addressBarValue)} title="Go">
          Go
        </button>
      </div>

      {/* ── Main content area ── */}
      <div style={contentArea}>
        {/* Favorites sidebar */}
        {showFavorites && (
          <div style={favSidebar}>
            <div style={favSidebarHeader}>
              <span>★ Favorites</span>
              <button style={favSidebarClose} onClick={() => setShowFavorites(false)}>×</button>
            </div>
            <div style={favSidebarList}>
              {FAVORITES.map((fav) => (
                <div
                  key={fav.url}
                  style={favSidebarItem}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sabr-title-active-start)'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#000'; }}
                  onClick={() => { navigate(fav.url); setShowFavorites(false); }}
                >
                  <img src="/images/icons/internet-explorer-16x16.png" alt="" style={{ width: 14, height: 14, marginRight: 6, imageRendering: 'pixelated', flexShrink: 0 }} onError={(e) => (e.currentTarget.style.display = 'none')} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fav.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* iframe viewport */}
        <iframe
          ref={iframeRef}
          src={currentUrl}
          style={iframeStyle}
          title={pageTitle || currentUrl}
          onLoad={handleIframeLoad}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-presentation"
          allow="autoplay; fullscreen"
        />
      </div>

      {/* ── Loading progress bar ── */}
      {progress > 0 && progress < 100 && (
        <div style={progressBar}>
          <div style={{ ...progressFill, width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}

      {/* ── Status Bar ── */}
      <div style={statusBar}>
        <div style={statusLeft}>
          {isLoading ? (
            <span style={{ color: 'var(--sabr-title-active-start)' }}>⏳ {statusText}</span>
          ) : (
            <span>✓ {statusText}</span>
          )}
        </div>
        <div style={statusRight}>
          <span style={{ marginRight: 8, fontSize: 9 }}>🔒 Internet</span>
        </div>
      </div>

      {/* Click-away overlay for menus */}
      {(showFavMenu) && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 9 }}
          onClick={() => { setShowFavMenu(false); }}
        />
      )}
    </div>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const shell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#c0c0c0',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11,
  overflow: 'hidden',
  color: '#000',
  position: 'relative',
};

const menuBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '2px 4px',
  background: '#c0c0c0',
  borderBottom: '1px solid #808080',
  flexShrink: 0,
  userSelect: 'none',
  position: 'relative',
  zIndex: 20,
};

const menuItem: React.CSSProperties = {
  padding: '1px 8px',
  cursor: 'default',
  fontSize: 11,
};

const toolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '3px 6px',
  background: '#c0c0c0',
  borderBottom: '1px solid #808080',
  flexShrink: 0,
  userSelect: 'none',
};

const toolBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  padding: '3px 8px',
  background: 'transparent',
  border: '1px solid transparent',
  cursor: 'default',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 9,
  minWidth: 44,
};

const toolIcon: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
};

const toolLabel: React.CSSProperties = {
  fontSize: 9,
  color: '#000',
};

const toolSep: React.CSSProperties = {
  width: 1,
  height: 32,
  background: '#808080',
  margin: '0 4px',
  flexShrink: 0,
};

const addressBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 6px',
  background: '#c0c0c0',
  borderBottom: '2px solid #808080',
  flexShrink: 0,
};

const addressLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#000',
  flexShrink: 0,
};

const addressInput: React.CSSProperties = {
  flex: 1,
  height: 20,
  padding: '1px 4px',
  background: '#fff',
  border: '1px solid',
  borderColor: '#808080 #fff #fff #808080',
  fontFamily: '"MS Sans Serif", Arial, monospace',
  fontSize: 11,
  outline: 'none',
  color: '#000',
};

const goBtn: React.CSSProperties = {
  padding: '1px 8px',
  background: '#c0c0c0',
  border: '2px solid',
  borderColor: '#fff #808080 #808080 #fff',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11,
  cursor: 'default',
  flexShrink: 0,
};

const contentArea: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
  position: 'relative',
};

const iframeStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  height: '100%',
  border: 'none',
  background: '#fff',
};

const progressBar: React.CSSProperties = {
  height: 3,
  background: '#c0c0c0',
  flexShrink: 0,
};

const progressFill: React.CSSProperties = {
  height: '100%',
  background: 'var(--sabr-title-active-start)',
  transition: 'width 0.1s linear',
};

const statusBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '1px 6px',
  background: '#c0c0c0',
  borderTop: '1px solid #808080',
  flexShrink: 0,
  fontSize: 10,
  userSelect: 'none',
};

const statusLeft: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const statusRight: React.CSSProperties = {
  flexShrink: 0,
  borderLeft: '1px solid #808080',
  paddingLeft: 8,
};

// ── Favorites ──

const favDropdown: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: 0,
  background: '#c0c0c0',
  border: '2px solid',
  borderColor: '#fff #808080 #808080 #fff',
  width: 220,
  zIndex: 100,
  boxShadow: '2px 2px 4px rgba(0,0,0,0.3)',
};

const favHeader: React.CSSProperties = {
  padding: '4px 8px',
  background: 'var(--sabr-title-active-start)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 700,
};

const favItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 8px',
  cursor: 'default',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const favSidebar: React.CSSProperties = {
  width: 200,
  flexShrink: 0,
  background: '#c0c0c0',
  borderRight: '2px solid #808080',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const favSidebarHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: 'var(--sabr-title-active-start)',
  color: '#fff',
  padding: '4px 8px',
  fontWeight: 700,
  fontSize: 11,
  flexShrink: 0,
};

const favSidebarClose: React.CSSProperties = {
  background: '#c0c0c0',
  border: '2px solid',
  borderColor: '#fff #808080 #808080 #fff',
  color: '#000',
  width: 16,
  height: 14,
  fontSize: 10,
  lineHeight: '10px',
  cursor: 'default',
  padding: 0,
};

const favSidebarList: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
};

const favSidebarItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 8px',
  cursor: 'default',
  fontSize: 11,
};

export default InternetExplorer;
