import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { useWindowManager, AppType } from '../wm/manager';
import sound from '../utils/sound';
import { liveUser, useLiveEvent } from '../utils/live';
import NotificationTray from './Notifications';
import { openStudio } from '../apps/Studio';
import { button } from '../apps/TeamFiles';

interface MenuItem {
  id: string;
  label: string;
  title: string;
  appType: AppType;
  icon: string;
  width: number;
  height: number;
  props?: object;
  bold?: boolean;
}
const icon = (n: string) => `/images/icons/${n}`;
const STUDIO_MENU: MenuItem[] = [
  { id: 'new', label: 'New...', title: 'New', appType: 'new', icon: icon('file-32x32.png'), width: 460, height: 420, bold: true },
  {
    id: 'sanktuary-network',
    label: 'Team Files',
    title: 'Team Files',
    appType: 'network',
    icon: icon('network-32x32.png'),
    width: 560,
    height: 420,
  },
  {
    id: 'studio',
    label: 'Studio (songs, calendar, boards)',
    title: 'Studio',
    appType: 'studio',
    icon: icon('media-player-32x32.png'),
    width: 960,
    height: 620,
    props: { tab: 'songs' },
  },
  { id: 'moodboards', label: 'Moodboards', title: 'Moodboards', appType: 'boards', icon: icon('paint-32x32.png'), width: 560, height: 420 },
  {
    id: 'producer',
    label: 'Producer',
    title: 'Producer',
    appType: 'producer',
    icon: icon('convert-audio-32x32.png'),
    width: 720,
    height: 560,
  },
  { id: 'teams', label: 'Messages', title: 'Messages', appType: 'teams', icon: icon('outlook-express-32x32.png'), width: 300, height: 520 },
];
const VISITOR_MENU: MenuItem[] = [
  {
    id: 'welcome',
    label: 'Welcome & tour',
    title: 'Welcome to Sanktuary',
    appType: 'welcome',
    icon: icon('help-32x32.png'),
    width: 520,
    height: 560,
    bold: true,
    props: { tour: true },
  },
  {
    id: 'producer',
    label: 'Producer',
    title: 'Producer',
    appType: 'producer',
    icon: icon('convert-audio-32x32.png'),
    width: 720,
    height: 560,
  },
  { id: 'profile-me', label: 'Log On...', title: 'Log On', appType: 'profile', icon: icon('logoff-32x32.png'), width: 420, height: 520 },
];

export const Taskbar: React.FC = () => {
  const { isSignedIn } = useAuth();
  const { windows, startMenuOpen, setStartMenuOpen, openWindow, focusWindow, minimizeWindow } = useWindowManager();

  const [timeStr, setTimeStr] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const startMenuRef = useRef<HTMLDivElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  // Local Echo pager states and effect
  const isPplsStoryRunning = windows.some((w) => w.appType === 'ppls-story');
  const [pagerBlink, setPagerBlink] = useState(true);

  useEffect(() => {
    if (!isPplsStoryRunning) return;
    const interval = setInterval(() => {
      setPagerBlink((b) => !b);
    }, 600);
    return () => clearInterval(interval);
  }, [isPplsStoryRunning]);

  const handlePagerClick = () => {
    sound.playDing();

    openWindow({
      id: 'ppls-local-echo',
      title: '📡 Local Echo Detector',
      appType: 'ppls-local-echo',
      icon: '/images/icons/my-computer-16x16.png',
      width: 460,
      height: 350,
    });
  };

  // Update clock every second
  useEffect(() => {
    const updateClock = () => {
      setTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Close start menu when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        startMenuOpen &&
        startMenuRef.current &&
        !startMenuRef.current.contains(e.target as Node) &&
        startButtonRef.current &&
        !startButtonRef.current.contains(e.target as Node)
      ) {
        setStartMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [startMenuOpen, setStartMenuOpen]);

  const handleStartButtonClick = () => {
    setStartMenuOpen(!startMenuOpen);
  };

  const handleTaskClick = (id: string, focused: boolean, isMinimized: boolean) => {
    if (focused && !isMinimized) {
      minimizeWindow(id);
    } else {
      focusWindow(id);
    }
  };

  const launchApp = (id: string, title: string, appType: AppType, icon: string, width = 400, height = 300, props: any = {}) => {
    openWindow({
      id,
      title,
      appType,
      icon,
      width,
      height,
      appProps: props,
    });
    setStartMenuOpen(false);
  };

  return (
    <div className="taskbar absolute bottom-0 left-0 right-0 h-[30px] flex items-center bg-[#c0c0c0] border-t-2 border-white select-none z-[99999]">
      {/* Start Button */}
      <button
        ref={startButtonRef}
        onClick={handleStartButtonClick}
        className={`start-button flex items-center h-[22px] px-1 m-[2px] font-bold text-black outline-none ${
          startMenuOpen ? 'inset-deep' : ''
        }`}
      >
        <img src="/images/start-logo.png" alt="WinLogo" className="w-4 h-4 mr-1 image-render-pixelated" />
        Start
      </button>

      <div className="taskbar-divider h-5 w-[2px] mx-1 border-l border-gray-600 border-r border-white" />

      {/* Tasks list */}
      <div className="tasks flex flex-1 h-[24px] overflow-hidden items-center">
        {windows.map((win) => (
          <button
            key={win.id}
            onClick={() => handleTaskClick(win.id, win.focused, win.isMinimized)}
            className={`task flex items-center h-[22px] max-w-[150px] flex-1 px-1 m-[1px] text-xs text-black overflow-hidden text-ellipsis whitespace-nowrap outline-none ${
              win.focused && !win.isMinimized ? 'font-bold inset-deep' : ''
            }`}
          >
            {win.icon && <img src={win.icon} alt="" className="w-4 h-4 mr-1 image-render-pixelated flex-shrink-0" />}
            <span className="truncate">{win.title}</span>
          </button>
        ))}
      </div>

      <div className="taskbar-divider h-5 w-[2px] mx-1 border-l border-gray-600 border-r border-white" />

      {/* Tray */}
      <div
        className="tray flex items-center h-[22px] px-2 m-[2px] bg-[#c0c0c0] border-2 border-inset text-xs text-black"
        style={{ borderStyle: 'solid', borderColor: '#808080 #fff #fff #808080' }}
      >
        <TeamsTray />
        <NotificationTray />
        {isPplsStoryRunning && (
          <button
            onClick={handlePagerClick}
            className={`mr-2 cursor-pointer border-none bg-transparent outline-none flex items-center justify-center ${
              pagerBlink ? 'opacity-100' : 'opacity-30'
            }`}
            style={{
              transition: 'opacity 0.25s',
              fontSize: 14,
              lineHeight: 1,
            }}
            title="📡 Click to check local history echo"
          >
            📟
          </button>
        )}
        <img src="/images/icons/speaker-16x16.png" alt="Volume" className="w-4 h-4 mr-2 image-render-pixelated" />
        <span
          className="taskbar-time cursor-pointer select-none px-1 hover:bg-[#000080] hover:text-white"
          onClick={() => setCalendarOpen(!calendarOpen)}
          title="Click to view calendar & clock"
        >
          {timeStr}
        </span>
        {/* Log On (visitors) / your account (members), in the corner */}
        <button
          onClick={() =>
            openWindow({ id: 'profile-me', title: isSignedIn ? 'My Account' : 'Log On', appType: 'profile', icon: icon('logoff-32x32.png'), width: 420, height: 520 })
          }
          className="ml-1 cursor-pointer border-none bg-transparent outline-none flex items-center"
          style={{ fontSize: 14, lineHeight: 1 }}
          title={isSignedIn ? 'My account' : 'Log on'}
          aria-label={isSignedIn ? 'My account' : 'Log on'}
        >
          🔑
        </button>
      </div>

      {/* Mini Calendar Popup */}
      {calendarOpen && <MiniCalendarPopup onClose={() => setCalendarOpen(false)} />}

      {/* Start Menu */}
      {startMenuOpen && (
        <div
          ref={startMenuRef}
          className="start-menu outset-deep z-[1000000] text-black"
          style={{
            left: 0,
            bottom: 'calc(100% + 1px)',
            height: 'auto',
          }}
        >
          {/* Side Logo bar */}
          <div className="start-menu-titlebar w-[30px]" />

          {/* Menu Items */}
          <ul className="flex-1 list-none p-1 m-0 text-xs">
            {/* Members: the studio first. Visitors: the tour and the way in. */}
            {(isSignedIn ? STUDIO_MENU : VISITOR_MENU).map((m) => (
              <li key={m.id} className="hover:bg-[#000080] hover:text-white group">
                <button
                  onClick={() => launchApp(m.id, m.title, m.appType, m.icon, m.width, m.height, m.props)}
                  className={`w-full text-left py-1 px-2 flex items-center ${m.bold ? 'font-bold' : ''}`}
                >
                  <img src={m.icon} alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                  <span>{m.label}</span>
                </button>
              </li>
            ))}
            <hr className="my-1 border-t border-gray-400 border-b border-white" />
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() => launchApp('my-computer', 'My Computer', 'directory', '/images/icons/my-computer-16x16.png', 680, 500)}
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/my-computer-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>My Computer</span>
              </button>
            </li>
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() => launchApp('notepad', 'Untitled - Notepad', 'notepad', '/images/icons/notepad-16x16.png', 480, 360)}
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/notepad-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>Notepad</span>
              </button>
            </li>
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() => launchApp('calculator', 'Calculator', 'calculator', '/images/icons/calculator-16x16.png', 260, 260)}
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/calculator-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>Calculator</span>
              </button>
            </li>
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() => launchApp('soundrec', 'Sound - Sound Recorder', 'soundrec', '/images/icons/speaker-16x16.png', 280, 160)}
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/speaker-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>Sound Recorder</span>
              </button>
            </li>
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() => launchApp('ppls-story', 'Ppls Library', 'ppls-story', '/images/icons/ppls-story-32x32.svg', 800, 600)}
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/ppls-story-32x32.svg" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>Ppls Library</span>
              </button>
            </li>

            <hr className="my-1 border-t border-gray-400 border-b border-white" />

            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() =>
                  launchApp('pinball', '3D Pinball for Windows - Space Cadet', 'iframe', '/images/icons/pinball-16x16.png', 600, 440, {
                    src: '/programs/pinball/space-cadet.html',
                  })
                }
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/pinball-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>3D Pinball</span>
              </button>
            </li>
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() =>
                  launchApp('paint', 'untitled - Paint', 'iframe', '/images/icons/paint-16x16.png', 800, 600, {
                    src: '/programs/jspaint/index.html',
                  })
                }
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/paint-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>Paint</span>
              </button>
            </li>
            <li className="hover:bg-[#000080] hover:text-white group">
              <button
                onClick={() =>
                  launchApp('display-properties', 'Display Properties', 'display-properties', '/images/icons/themes-16x16.png', 360, 400)
                }
                className="w-full text-left py-1 px-2 flex items-center"
              >
                <img src="/images/icons/themes-32x32.png" alt="" className="w-6 h-6 mr-3 image-render-pixelated" />
                <span>Display Properties</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};
export default Taskbar;

/** Envelope in the tray when a Teams message arrives while its chat window isn't in front. Click opens Teams. */
const TeamsTray: React.FC = () => {
  const { windows, openWindow } = useWindowManager();
  const [unread, setUnread] = useState(0);
  useLiveEvent('message', (m: { channel: string; user: string }) => {
    if (m.user === liveUser()) return;
    const w = windows.find((x) => x.id === `chat-${m.channel}`);
    if (w && w.focused && !w.isMinimized && document.hasFocus()) return;
    setUnread((n) => n + 1); // the sound comes with the pop-up (Notifications.tsx)
  });
  if (!unread) return null;
  return (
    <button
      onClick={() => {
        setUnread(0);
        openWindow({
          id: 'teams',
          title: 'Messages',
          icon: '/images/icons/outlook-express-16x16.png',
          appType: 'teams',
          width: 300,
          height: 520,
        });
      }}
      title={`${unread} new message(s) — open Messages`}
      className="mr-2 cursor-pointer border-none bg-transparent outline-none flex items-center gap-1"
    >
      <img src="/images/icons/mail-16x16.png" alt="" style={{ width: 16, height: 16 }} />
      <b>{unread}</b>
    </button>
  );
};

/** Authentic Windows 98 Mini Calendar Tray Popup */
const MiniCalendarPopup: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { openWindow } = useWindowManager();
  const [viewDate, setViewDate] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onClose]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleString('default', { month: 'long' });

  // First day of month (0 = Sunday, 1 = Monday...)
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  const isCurrentDay = (d: number) =>
    now.getFullYear() === year && now.getMonth() === month && now.getDate() === d;

  return (
    <div
      ref={ref}
      className="outset-deep"
      style={{
        position: 'fixed',
        right: 4,
        bottom: 'calc(100% + 2px)',
        zIndex: 1000001,
        width: 220,
        background: '#c0c0c0',
        padding: 4,
        fontFamily: 'Tahoma, sans-serif',
        fontSize: 11,
        userSelect: 'none',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          background: '#000080',
          color: '#fff',
          fontWeight: 700,
          padding: '2px 4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span>Date &amp; Time</span>
        <button
          onClick={onClose}
          style={{
            background: '#c0c0c0',
            color: '#000',
            border: '1px outset #fff',
            fontSize: 10,
            lineHeight: 1,
            padding: '1px 3px',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      {/* Month / Year header with navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
          padding: '2px 4px',
        }}
      >
        <button
          onClick={prevMonth}
          style={{ ...button, padding: '1px 5px', fontSize: 10 }}
          title="Previous Month"
        >
          ◀
        </button>
        <b style={{ fontSize: 11 }}>
          {monthName} {year}
        </b>
        <button
          onClick={nextMonth}
          style={{ ...button, padding: '1px 5px', fontSize: 10 }}
          title="Next Month"
        >
          ▶
        </button>
      </div>

      {/* Calendar Grid */}
      <div
        style={{
          background: '#fff',
          border: '2px inset #808080',
          padding: 2,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontWeight: 700, fontSize: 10, color: '#666', borderBottom: '1px solid #c0c0c0', paddingBottom: 2 }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <span key={i}>{day}</span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 11, gap: 1, marginTop: 2 }}>
          {Array.from({ length: firstDay }).map((_, i) => (
            <span key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const current = isCurrentDay(dayNum);
            return (
              <span
                key={dayNum}
                style={{
                  padding: '2px 0',
                  background: current ? '#000080' : 'transparent',
                  color: current ? '#fff' : '#000',
                  fontWeight: current ? 700 : 400,
                  borderRadius: 1,
                }}
              >
                {dayNum}
              </span>
            );
          })}
        </div>
      </div>

      {/* Live Digital Clock Time */}
      <div
        style={{
          marginTop: 4,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 6,
          background: '#101410',
          border: '2px inset #808080',
          padding: '2px 6px',
        }}
      >
        <span style={{ color: '#00ff66', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
          {now.toLocaleTimeString()}
        </span>
      </div>

      {/* Open Calendar button */}
      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => {
            openStudio(openWindow, 'calendar');
            onClose();
          }}
          style={{ ...button, width: '100%', fontSize: 11, padding: '3px 6px', fontWeight: 700 }}
        >
          Open Studio Calendar
        </button>
      </div>
    </div>
  );
};

