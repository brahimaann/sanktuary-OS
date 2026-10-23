import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useWindowManager } from './wm/manager';
import Desktop, { Folder } from './components/Desktop';
import Taskbar from './components/Taskbar';
import Window from './components/Window';
import BootScreen from './components/BootScreen';
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
const NewThing = lazy(() => import('./apps/NewThing'));
const ShareIn = lazy(() => import('./apps/ShareIn'));
const Directory = lazy(() => import('./apps/Directory'));
const Producer = lazy(() => import('./apps/Producer'));
const Studio = lazy(() => import('./apps/Studio'));
const Darkroom = lazy(() => import('./apps/Darkroom'));
const VideoEditor = lazy(() => import('./apps/VideoEditor'));

/** After a deploy the old build's files are gone, so an app opened in a tab from before can't load. */
const isStaleBuild = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically/i.test(
    String((e as Error)?.message || e),
  );

/**
 * One app failing shows a message in its own window instead of taking the whole desktop down. Never reloads by
 * itself: other windows may hold unsaved work.
 */
class WindowErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (!isStaleBuild(error)) console.error(error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleBuild(error);
    return (
      <div className="w-full h-full bg-[#c0c0c0] p-4 text-xs flex flex-col gap-2">
        <b>{stale ? 'Sanktuary was just updated.' : 'This window hit a problem.'}</b>
        <div>
          {stale
            ? 'Save anything open in other windows, then reload to get the new version.'
            : 'The rest of Sanktuary is fine. Try again, or close this window.'}
        </div>
        {!stale && <div className="text-gray-700 break-all">{String(error.message).slice(0, 300)}</div>}
        <div className="flex gap-2">
          <button
            className="px-3 py-1 border-2 border-outset bg-[#c0c0c0]"
            onClick={() => (stale ? location.reload() : this.setState({ error: null }))}
          >
            {stale ? 'Reload' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }
}

export const App: React.FC = () => {
  const { windows } = useWindowManager();
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    // Phones scroll the page up to make room for the keyboard (signing in) and don't always scroll back when it closes
    const settle = () => setTimeout(() => window.scrollTo(0, 0), 100);
    window.addEventListener('focusout', settle);
    return () => window.removeEventListener('focusout', settle);
  }, []);

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
        content = <Welcome tour={win.appProps?.tour} />;
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
      case 'new':
        content = <NewThing kind={win.appProps?.kind} />;
        break;
      case 'darkroom':
        content = <Darkroom {...win.appProps} />;
        break;
      case 'video-editor':
        content = <VideoEditor clip={win.appProps?.clip} />;
        break;
      case 'studio':
        content = <Studio tab={win.appProps?.tab} />;
        break;
      case 'producer':
        content = <Producer />;
        break;
      case 'directory':
        content = <Directory />;
        break;
      case 'share-in':
        content = <ShareIn missed={win.appProps?.missed} />;
        break;
      case 'folder':
        content = <Folder items={win.appProps?.items || []} />;
        break;
      case 'canvas':
        content = <Canvas boardId={win.appProps?.boardId} name={win.title} />;
        break;
      default:
        content = <div className="p-4">Unknown Application</div>;
    }

    return (
      <WindowErrorBoundary>
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
      </WindowErrorBoundary>
    );
  };

  const handleBootComplete = () => {
    setIsBooting(false);
  };

  return (
    <div className="crt-wrapper">
      <div className="crt-screen-content">
        {isBooting ? (
          /* BIOS boot terminal */
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
