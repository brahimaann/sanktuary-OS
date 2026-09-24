import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useWindowManager } from './wm/manager';
import Desktop from './components/Desktop';
import Taskbar from './components/Taskbar';
import Window from './components/Window';
import BootScreen from './components/BootScreen';
import Screensaver from './components/Screensaver';
import { DialogHost } from './utils/dialog';

// Code-split applications for fast initial boot and minimal bundle
const Notepad = lazy(() => import('./apps/Notepad'));
const Calculator = lazy(() => import('./apps/Calculator'));
const SoundRecorder = lazy(() => import('./apps/SoundRecorder'));
const Explorer = lazy(() => import('./apps/Explorer'));
const DisplayProperties = lazy(() => import('./apps/DisplayProperties'));
const WebRadio = lazy(() => import('./apps/WebRadio'));
const PokemonEmulator = lazy(() => import('./apps/PokemonEmulator'));
const Pong = lazy(() => import('./apps/Pong'));
const AfricaOnlyTV = lazy(() => import('./apps/AfricaOnlyTV'));
const VideoFolder = lazy(() => import('./apps/VideoFolder'));
const VideoPlayer = lazy(() => import('./apps/VideoPlayer'));
const PplsStory = lazy(() => import('./apps/PplsStory'));
const PplsThreadViewer = lazy(() => import('./apps/PplsThreadViewer'));
const LocalEchoTerminal = lazy(() => import('./apps/LocalEchoTerminal'));
const InternetExplorer = lazy(() => import('./apps/InternetExplorer'));
const Winamp = lazy(() => import('./apps/Winamp'));
const TeamFiles = lazy(() => import('./apps/TeamFiles'));
const FilePreview = lazy(() => import('./apps/FilePreview'));
const Network = lazy(() => import('./apps/Network'));
const AdminPanel = lazy(() => import('./apps/AdminPanel'));
const Boards = lazy(() => import('./apps/Boards'));
const Canvas = lazy(() => import('./apps/Canvas'));
const Teams = lazy(() => import('./apps/Teams'));
const Chat = lazy(() => import('./apps/Chat'));
const Profile = lazy(() => import('./apps/Profile'));
const Planner = lazy(() => import('./apps/Planner'));
const Tracks = lazy(() => import('./apps/Tracks'));
const Timeline = lazy(() => import('./apps/Timeline'));
const Business = lazy(() => import('./apps/Business'));
const Welcome = lazy(() => import('./apps/Welcome'));

export const App: React.FC = () => {
  const { windows, screensaver, screensaverTimeout, isScreensaverActive, setScreensaverActive } = useWindowManager();
  const [isBooting, setIsBooting] = useState(true);
  const [powerOnClass, setPowerOnClass] = useState('');

  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Screensaver idle detection
  useEffect(() => {
    if (isBooting || screensaver === 'none') return;

    let timeoutId: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(
        () => {
          setScreensaverActive(true);
        },
        screensaverTimeout * 60 * 1000,
      );
    };

    const handleActivity = () => {
      if (!isScreensaverActive) {
        resetTimer();
      }
    };

    resetTimer();
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('pointerdown', handleActivity);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('pointerdown', handleActivity);
    };
  }, [isBooting, screensaver, screensaverTimeout, isScreensaverActive, setScreensaverActive]);

  const W = windowSize.width;
  const H = windowSize.height;

  // CRT bezel sizing — mobile gets a very thin frame so the screen area is maximised
  // Large screens  (W >= 1400): 33px sides
  // Medium screens (1000 <= W < 1400): 28px sides
  // Small screens  (600 <= W < 1000): 12px sides
  // Mobile         (W < 600):  8px sides
  const borderX = W >= 1400 ? 33 : W >= 1000 ? 28 : W >= 600 ? 12 : 8;
  const borderY = H >= 900 ? 33 : H >= 700 ? 28 : H >= 500 ? 10 : 8;
  const borderBottom = W < 600 ? borderY * 1.2 : borderY * 1.4; // slimmer bottom chin on mobile

  const curveX = borderX * 0.2;
  const curveY = borderY * 0.2;

  const renderAppContent = (win: any) => {
    let content: React.ReactNode;
    switch (win.appType) {
      case 'notepad':
        content = <Notepad filePath={win.appProps?.filePath} />;
        break;
      case 'calculator':
        content = <Calculator isFocused={win.focused} />;
        break;
      case 'soundrec':
        content = <SoundRecorder />;
        break;
      case 'explorer':
        content = <Explorer path={win.appProps?.path} windowId={win.id} />;
        break;
      case 'internet-explorer':
        content = <InternetExplorer src={win.appProps?.src} windowId={win.id} />;
        break;
      case 'iframe':
        content = (
          <iframe
            src={win.appProps?.src}
            className="w-full h-full border-none bg-white"
            title={win.title}
            sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads"
          />
        );
        break;
      case 'display-properties':
        content = <DisplayProperties />;
        break;
      case 'webradio':
        content = <WebRadio />;
        break;
      case 'pokemon':
        content = <PokemonEmulator src={win.appProps?.src} />;
        break;
      case 'pong':
        content = <Pong />;
        break;
      case 'africaonly':
        content = <AfricaOnlyTV />;
        break;
      case 'video-folder':
        content = <VideoFolder collectionId={win.appProps?.collectionId} />;
        break;
      case 'ppls-story':
        content = <PplsStory />;
        break;
      case 'ppls-thread-viewer':
        content = <PplsThreadViewer threadId={win.appProps?.threadId} />;
        break;
      case 'ppls-local-echo':
        content = <LocalEchoTerminal />;
        break;
      case 'video-player':
        content = (
          <VideoPlayer videoSrc={win.appProps?.videoSrc} videoTitle={win.appProps?.videoTitle} videoArtist={win.appProps?.videoArtist} />
        );
        break;
      case 'winamp':
        content = <Winamp />;
        break;
      case 'team-files':
        content = <TeamFiles app={win.appProps?.app} name={win.title} initialPath={win.appProps?.initialPath} />;
        break;
      case 'file-preview':
        content = <FilePreview {...win.appProps} />;
        break;
      case 'network':
        content = <Network />;
        break;
      case 'admin':
        content = <AdminPanel />;
        break;
      case 'boards':
        content = <Boards kind={win.appProps?.kind} />;
        break;
      case 'teams':
        content = <Teams />;
        break;
      case 'chat':
        content = <Chat channel={win.appProps?.channel} title={win.title} />;
        break;
      case 'profile':
        content = <Profile username={win.appProps?.username} />;
        break;
      case 'planner':
        content = <Planner boardId={win.appProps?.boardId} name={win.title} />;
        break;
      case 'welcome':
        content = <Welcome />;
        break;
      case 'business':
        content = <Business />;
        break;
      case 'timeline':
        content = <Timeline />;
        break;
      case 'tracks':
        content = <Tracks />;
        break;
      case 'canvas':
        content = <Canvas boardId={win.appProps?.boardId} name={win.title} />;
        break;
      default:
        content = <div className="p-4">Unknown Application</div>;
    }

    return (
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center bg-[#c0c0c0] font-mono text-xs text-gray-700">
            <div className="border border-t-white border-l-white border-r-gray-800 border-b-gray-800 p-2 bg-[#d4d0c8] shadow-sm">
              Loading...
            </div>
          </div>
        }
      >
        {content}
      </Suspense>
    );
  };

  const handleBootComplete = () => {
    setIsBooting(false);
    setPowerOnClass('crt-power-on');
  };

  /* CRT monitor frame is ALWAYS visible.
     During boot: BIOS terminal renders inside the screen area.
     After boot: Desktop + windows render inside the screen area. */

  return (
    <div className="crt-wrapper">
      {/* Custom responsive SVG CRT Bezel — always present, matches dynamic size */}
      <svg className="crt-bezel-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bezel-shading" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <stop offset="85%" stopColor="#e2ded6" />
            <stop offset="100%" stopColor="#a6a299" />
          </radialGradient>
        </defs>
        <path
          d={`M 0 0 H ${W} V ${H} H 0 Z M ${borderX} ${borderY} Q ${W / 2} ${borderY - curveY} ${W - borderX} ${borderY} Q ${W - borderX + curveX} ${(H - borderBottom + borderY) / 2} ${W - borderX} ${H - borderBottom} Q ${W / 2} ${H - borderBottom + curveY} ${borderX} ${H - borderBottom} Q ${borderX - curveX} ${(H - borderBottom + borderY) / 2} ${borderX} ${borderY} Z`}
          fill="url(#bezel-shading)"
          fillRule="evenodd"
        />
        <path
          d={`M ${borderX} ${borderY} Q ${W / 2} ${borderY - curveY} ${W - borderX} ${borderY} Q ${W - borderX + curveX} ${(H - borderBottom + borderY) / 2} ${W - borderX} ${H - borderBottom} Q ${W / 2} ${H - borderBottom + curveY} ${borderX} ${H - borderBottom} Q ${borderX - curveX} ${(H - borderBottom + borderY) / 2} ${borderX} ${borderY}`}
          fill="none"
          stroke="#807d75"
          strokeWidth={Math.max(1.5, borderX * 0.08)}
        />
      </svg>

      {/* Screen Content Window — dynamic dimensions positioned to match the bezel hole */}
      <div
        className={`crt-screen-content ${isBooting ? '' : powerOnClass}`}
        style={{
          top: borderY,
          left: borderX,
          width: W - borderX * 2,
          height: H - borderY - borderBottom,
        }}
      >
        <div className="crt-screen-vignette" />
        <div className="crt-screen-filter" />
        <div className="crt-screen-flicker" />

        {isScreensaverActive && <Screensaver type={screensaver} onDismiss={() => setScreensaverActive(false)} />}

        {isBooting ? (
          /* BIOS boot terminal — rendered INSIDE the CRT screen */
          <BootScreen onComplete={handleBootComplete} />
        ) : (
          /* Desktop environment */
          <div className="relative w-full h-full overflow-hidden bg-[#008080]">
            <Desktop />

            {windows.map((win) => (
              <Window
                key={win.id}
                id={win.id}
                title={win.title}
                icon={win.icon}
                x={win.x}
                y={win.y}
                width={win.width}
                height={win.height}
                isMaximized={win.isMaximized}
                isMinimized={win.isMinimized}
                focused={win.focused}
                zIndex={win.zIndex}
              >
                {renderAppContent(win)}
              </Window>
            ))}

            <Taskbar />
            <DialogHost />
          </div>
        )}
      </div>
    </div>
  );
};
export default App;
