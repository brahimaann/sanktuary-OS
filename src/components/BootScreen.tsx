import React, { useState, useEffect, useRef } from 'react';
import { getCookie, setCookie } from '../utils/cookies';
import sound from '../utils/sound';
import { useAuth } from '@clerk/react';
import { useTeamLogin } from '../utils/teamLogin';

interface BootScreenProps {
  onComplete: () => void;
}

/* ────────────────────────────────────────────────────────
   Authentic Award BIOS terminal boot sequence.
   Renders INSIDE the CRT screen area (not fullscreen).
   ──────────────────────────────────────────────────────── */

interface TermLine {
  text: string;
  color?: string;
  bold?: boolean;
  parts?: { text: string; color: string }[];
}

const hashBlob =
  'hDRDhEyBFFmFBESAQAQIfPgQEYC0F81IvHPD1E1EgAAQKUCsOwfIwIQQ3ZWEaICPy3g0hEhISIwIhQ1UBIBLgL' +
  'FBAAAAAAAAAAAAAAAAAAA1984AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAExJU1RGAAAAaSU5GT01DUkQLAAAAMTk5M10wMu0AASU0Rw0AABCaWxs1fAvbGZvcmQAREITR1QAAAUZ9';

const BIOS_LINES: TermLine[] = [
  { text: 'Award Modular BIOS v4.51PG, An Energy Star Ally', color: '#ffffff', bold: true },
  { text: 'Copyright (C) 1984-85, Award Software, Inc.', color: '#aaaaaa' },
  { text: '' },
  { text: '' },
  { text: 'Detecting mouse... OK', parts: [{ text: 'Detecting mouse... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: 'Detecting touch support... FAILED', parts: [{ text: 'Detecting touch support... ', color: '#aaaaaa' }, { text: 'FAILED', color: '#ff5555' }] },
  { text: 'Connecting to The Sanktuary... OK', parts: [{ text: 'Connecting to The Sanktuary... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: 'Initializing file system... OK', parts: [{ text: 'Initializing file system... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: 'Loading system themes... OK', parts: [{ text: 'Loading system themes... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: 'Initializing Recycle Bin... OK', parts: [{ text: 'Initializing Recycle Bin... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: `Preloading default theme assets... ${hashBlob}`, color: '#55ffff' },
  { text: 'Preloading default theme assets... OK', parts: [{ text: 'Preloading default theme assets... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: 'Loading custom applications... OK', parts: [{ text: 'Loading custom applications... ', color: '#aaaaaa' }, { text: 'OK', color: '#55ff55' }] },
  { text: 'Press F8 for Startup Menu... Booting OS/390 Emulator... OK', parts: [{ text: 'Press F8 for Startup Menu... Booting OS/390 Emulator... ', color: '#ffffff' }, { text: 'OK', color: '#55ff55' }] },
];

const SANKTUARY_LOGO = [
  "        SSSSSSSSSSS      The S/370, ESA/390 and z/Architecture",
  "      SSSSSSSSSSSSSS                   Emulator",
  "      SSS",
  "      SSS                S A N K T U A R Y   [ S K T Y ]",
  "        SSSSSSSSSSS      ",
  "           SSSSSSSSS     Mainframe Emulation Subsystem",
  "                 SSS     ",
  "      SSS        SSS     My PC thinks it's a MAINFRAME",
  "      SSSSSSSSSSSSSS",
  "        SSSSSSSSSSS      Copyright (C) 2026 The Sanktuary"
];

const HERCULES_LINES = [
  { text: 'Sanktuary Emulator Version : 3.12 [SKTY]', color: '#8888ff' },
  { text: 'Host name                  : brontide', color: '#8888ff' },
  { text: 'Host OS                    : Linux-4.9.0-4-amd64 #1 SMP Debian 4.9.65-3+deb9u1', color: '#aaaaaa' },
  { text: 'Host Architecture          : x86_64', color: '#8888ff' },
  { text: 'Processors                 : MP=8', color: '#8888ff' },
  { text: 'Chanl Subsys               : 0', color: '#8888ff' },
  { text: 'Device number              : 0700', color: '#8888ff' },
  { text: 'Subchannel                 : 002B', color: '#8888ff' },
  { text: '' },
  ...SANKTUARY_LOGO.map(line => ({ text: line, color: '#5555ff', bold: true })),
  { text: '' },
  { text: 'HHCLC001I IPLing from device 0700...', color: '#ffffff' },
  { text: 'HHCLC002I Load parameter: 0182', color: '#ffffff' },
  { text: 'HHCLC003I System initialization in progress...', color: '#ffffff' },
  { text: 'HHCLC004I Loading main storage... OK', color: '#55ff55' },
  { text: 'HHCLC005I Mainframe emulation online. Loading OS/390 Subsystems...', color: '#55ff55' },
];

type BootStage = 'BIOS' | 'HERCULES' | 'MAINFRAME_LINK';
type DialogueState = 'ASK_NAME' | 'ASK_PASSWORD' | 'VERIFYING' | 'ASK_BOOT' | 'BOOTING' | 'DONE';

const ASK_PASSWORD_LINES = [
  `TEAM OPERATORS: ENTER YOUR ACCESS CODE.`,
  `GUESTS: PRESS ENTER TO CONTINUE WITHOUT CLEARANCE.`,
  ` `,
];

export const BootScreen: React.FC<BootScreenProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<BootStage>('BIOS');
  const { isSignedIn } = useAuth();
  const teamLogin = useTeamLogin();
  const [biosVisibleCount, setBiosVisibleCount] = useState(0);
  const [herculesVisibleCount, setHerculesVisibleCount] = useState(0);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Check if we should bypass the boot intro on this session
  useEffect(() => {
    if (sessionStorage.getItem('hq_os_booted')) {
      onComplete();
    }
  }, [onComplete]);

  // Wrap onComplete to record that the OS booted in this session
  const handleComplete = () => {
    sessionStorage.setItem('hq_os_booted', 'true');
    sound.playStartup();
    onComplete();
  };

  // Mainframe green screen states
  const [dialogueState, setDialogueState] = useState<DialogueState>('ASK_NAME');
  const [mainframeHistory, setMainframeHistory] = useState<string[]>([]);
  const [promptLabel, setPromptLabel] = useState('ENTER OPERATOR ID (YOUR NAME): ');
  const [inputValue, setInputValue] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. BIOS stage printing
  useEffect(() => {
    if (stage !== 'BIOS') return;
    if (biosVisibleCount >= BIOS_LINES.length) {
      const timer = setTimeout(() => {
        setStage('HERCULES');
      }, 1000);
      return () => clearTimeout(timer);
    }
    const delay = BIOS_LINES[biosVisibleCount]?.text === '' ? 50 : 100;
    const timer = setTimeout(() => {
      setBiosVisibleCount(prev => prev + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [biosVisibleCount, stage]);

  // 2. Hercules stage printing
  useEffect(() => {
    if (stage !== 'HERCULES') return;
    if (herculesVisibleCount >= HERCULES_LINES.length) {
      const timer = setTimeout(() => {
        if (isMobile) {
          handleComplete();
        } else {
          setStage('MAINFRAME_LINK');
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setHerculesVisibleCount(prev => prev + 1);
    }, 45);
    return () => clearTimeout(timer);
  }, [herculesVisibleCount, stage, isMobile]);

  // 3. Mainframe setup
  useEffect(() => {
    if (stage !== 'MAINFRAME_LINK') return;

    // Retrieve and increment visit cookie
    const visitsCookieStr = getCookie('hq_os_visits');
    const newVisits = parseInt(visitsCookieStr || '0', 10) + 1;
    setCookie('hq_os_visits', newVisits.toString(), 365);

    // Retrieve name cookie
    const storedName = getCookie('hq_os_username') || '';

    // Format current date and time
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
    const timeStr = new Date().toLocaleTimeString(undefined, { hour12: false });

    if (!storedName) {
      setDialogueState('ASK_NAME');
      setPromptLabel('ENTER OPERATOR ID (YOUR NAME): ');
      setMainframeHistory([
        `*** SKTY TERMINAL v3.12 - SANKTUARY CORE SUBSYSTEMS ***`,
        `*** DATE: ${dateStr}  TIME: ${timeStr}  NODE: SKTY-CORE ***`,
        ` `,
        `ESTABLISHING LINK... SECURE.`,
        ` `,
        `WARNING: A NEW OPERATOR TERMINAL ACCESS ATTEMPT DETECTED.`,
        `ALL SESSION METADATA WILL BE ENCRYPTED AND LOGGED.`,
        ` `,
        `IDENTIFICATION IS REQUIRED FOR OS BOOT PERMISSION.`,
        ` `
      ]);
    } else {
      setDialogueState('ASK_BOOT');
      setPromptLabel('===> ');
      setMainframeHistory([
        `*** SKTY TERMINAL v3.12 - SANKTUARY CORE SUBSYSTEMS ***`,
        `*** DATE: ${dateStr}  TIME: ${timeStr}  NODE: SKTY-CORE ***`,
        ` `,
        `ESTABLISHING LINK... SECURE.`,
        ` `,
        `WELCOME BACK, OPERATOR: ${storedName.toUpperCase()}`,
        `THIS IS SYSTEM ACCESS VISIT #${newVisits} ON THIS PORT.`,
        `SYSTEM LOGS SHOW PREVIOUS SESSIONS COMPLETED STABLY.`,
        ` `,
        ...(isSignedIn
          ? [`TEAM CLEARANCE... ACTIVE`, ` `, `DO YOU WISH TO INITIATE THE OS WORKSPACE ENVIRONMENT? (Y/N):`]
          : ASK_PASSWORD_LINES),
      ]);
      if (!isSignedIn) {
        setDialogueState('ASK_PASSWORD');
        setPromptLabel('ACCESS CODE: ');
      }
    }

    // Refocus input
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 100);
  }, [stage]);

  // Auto-scroll as lines print
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [biosVisibleCount, herculesVisibleCount, mainframeHistory]);

  // Skip / navigate stages using global keys (specifically Escape)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleComplete();
        return;
      }
      // Quick advance in BIOS or Hercules stage on any key
      if (stage === 'BIOS') {
        setStage('HERCULES');
      } else if (stage === 'HERCULES') {
        if (isMobile) {
          handleComplete();
        } else {
          setStage('MAINFRAME_LINK');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [stage, isMobile]);

  const handleContainerClick = () => {
    if (stage === 'MAINFRAME_LINK') {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    } else if (stage === 'BIOS') {
      setStage('HERCULES');
    } else if (stage === 'HERCULES') {
      if (isMobile) {
        handleComplete();
      } else {
        setStage('MAINFRAME_LINK');
      }
    }
  };

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = inputValue.trim();
    setInputValue('');

    if (dialogueState === 'BOOTING' || dialogueState === 'DONE' || dialogueState === 'VERIFYING') return;

    // Append operator input to history (access codes are masked)
    const shown = dialogueState === 'ASK_PASSWORD' ? '*'.repeat(cleanInput.length) : cleanInput;
    setMainframeHistory(prev => [...prev, `${promptLabel}${shown}`]);

    if (dialogueState === 'ASK_NAME') {
      if (!cleanInput) {
        setMainframeHistory(prev => [
          ...prev,
          `*** ERROR: OPERATOR ID CANNOT BE EMPTY.`,
          ` `
        ]);
        return;
      }

      setCookie('hq_os_username', cleanInput, 365);

      setMainframeHistory(prev => [
        ...prev,
        `*** OPERATOR ID '${cleanInput.toUpperCase()}' REGISTERED SUCCESSFULLY.`,
        `*** CREATING OS SECURITY CONTEXT... OK`,
        ` `,
        ...ASK_PASSWORD_LINES,
      ]);
      setPromptLabel('ACCESS CODE: ');
      setDialogueState('ASK_PASSWORD');
    } else if (dialogueState === 'ASK_PASSWORD') {
      const askBoot = [` `, `INITIATE GRAPHICAL WORKSPACE INTERFACE? (Y/N):`];
      if (!cleanInput) {
        setMainframeHistory(prev => [...prev, `*** GUEST SESSION. TEAM FOLDERS LOCKED.`, ...askBoot]);
        setPromptLabel('===> ');
        setDialogueState('ASK_BOOT');
        return;
      }
      setDialogueState('VERIFYING');
      setMainframeHistory(prev => [...prev, `VERIFYING OPERATOR CLEARANCE...`]);
      teamLogin(getCookie('hq_os_username') || '', cleanInput).then((error) => {
        if (error) {
          setMainframeHistory(prev => [
            ...prev,
            `*** ERROR: ACCESS DENIED. ${error.toUpperCase()}`,
            `*** RE-ENTER ACCESS CODE, OR PRESS ENTER FOR GUEST ACCESS.`,
            ` `,
          ]);
          setDialogueState('ASK_PASSWORD');
        } else {
          setMainframeHistory(prev => [...prev, `*** OPERATOR VERIFIED... OK`, `*** TEAM CLEARANCE GRANTED. TEAM FOLDERS UNLOCKED.`, ...askBoot]);
          setPromptLabel('===> ');
          setDialogueState('ASK_BOOT');
        }
        setTimeout(() => inputRef.current?.focus(), 50);
      });
    } else if (dialogueState === 'ASK_BOOT') {
      const lower = cleanInput.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        setMainframeHistory(prev => [
          ...prev,
          `*** BOOT COMMAND: LOAD GRAPHICAL WORKSPACE`,
          `*** INITIALIZING WIN98 EMULATION ENVIRONMENT...`,
          `*** LOADING USER EXPERIENCE STACK... OK`,
          `*** REDIRECTING CONSOLE... IPL COMPLETED.`
        ]);
        setDialogueState('BOOTING');
        setTimeout(() => {
          handleComplete();
        }, 1200);
      } else if (lower === 'n' || lower === 'no') {
        setMainframeHistory(prev => [
          ...prev,
          `*** BOOT COMMAND: TERMINAL ONLY (SUSPENDED)`,
          `*** SECURITY POLICY ERROR: MAIN DECK INTERFACE MANDATES GUI OVERLAY.`,
          `*** OVERRIDING OPERATOR CMD... FORCE GRAPHICAL INITIALIZATION.`,
          `*** DEPLOYING OS SHELL IN 2 SECONDS...`
        ]);
        setDialogueState('BOOTING');
        setTimeout(() => {
          handleComplete();
        }, 2200);
      } else {
        setMainframeHistory(prev => [
          ...prev,
          `*** UNRECOGNIZED IPL OPTION: '${cleanInput}'`,
          `*** ASSUMING DEFAULT: GRAPHICAL BOOT SYSTEM`,
          `*** BOOTING OS/390 GRAPHICAL LAYER PROTOCOLS...`
        ]);
        setDialogueState('BOOTING');
        setTimeout(() => {
          handleComplete();
        }, 1200);
      }
    }
  };

  const renderHistoryLine = (line: string, index: number) => {
    if (line.trim() === '') {
      return <div key={index} style={{ height: '1.15em' }}>&nbsp;</div>;
    }

    if (line.startsWith('***')) {
      return (
        <div key={index} style={{ color: '#ffffff', fontWeight: 'bold' }}>
          {line}
        </div>
      );
    }

    if (line.includes('WARNING:')) {
      const parts = line.split('WARNING:');
      return (
        <div key={index}>
          <span style={{ color: '#aaaaaa' }}>{parts[0]}</span>
          <span style={{ color: '#ffff55', fontWeight: 'bold' }}>WARNING:</span>
          <span style={{ color: '#aaaaaa' }}>{parts[1]}</span>
        </div>
      );
    }

    if (line.includes('ERROR:')) {
      const parts = line.split('ERROR:');
      return (
        <div key={index}>
          <span style={{ color: '#aaaaaa' }}>{parts[0]}</span>
          <span style={{ color: '#ff5555', fontWeight: 'bold' }}>ERROR:</span>
          <span style={{ color: '#aaaaaa' }}>{parts[1]}</span>
        </div>
      );
    }

    if (line.includes('... OK')) {
      const idx = line.lastIndexOf('... OK');
      return (
        <div key={index}>
          <span>{line.substring(0, idx + 4)}</span>
          <span style={{ color: '#55ff55' }}>OK</span>
        </div>
      );
    }

    if (line.includes('... SECURE')) {
      const idx = line.lastIndexOf('... SECURE');
      return (
        <div key={index}>
          <span>{line.substring(0, idx + 4)}</span>
          <span style={{ color: '#55ff55' }}>SECURE</span>
        </div>
      );
    }

    if (line.includes('... SUCCESS')) {
      const idx = line.lastIndexOf('... SUCCESS');
      return (
        <div key={index}>
          <span>{line.substring(0, idx + 4)}</span>
          <span style={{ color: '#55ff55' }}>SUCCESS</span>
        </div>
      );
    }

    return (
      <div key={index} style={{ color: '#aaaaaa', whiteSpace: 'pre-wrap' }}>
        {line}
      </div>
    );
  };

  const renderBioLine = (line: TermLine, i: number) => {
    if (line.text === '') {
      return <div key={i} style={{ height: '1.1em' }}>&nbsp;</div>;
    }
    if (line.parts) {
      return (
        <div key={i}>
          {line.parts.map((p, j) => (
            <span key={j} style={{ color: p.color }}>{p.text}</span>
          ))}
        </div>
      );
    }
    return (
      <div
        key={i}
        style={{
          color: line.color || '#aaaaaa',
          wordBreak: 'break-all',
        }}
      >
        {line.text}
      </div>
    );
  };

  return (
    <div
      onClick={handleContainerClick}
      style={{
        width: '100%',
        height: '100%',
        background: '#000000',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        cursor: 'text',
      }}
    >
      <style>{`
        @font-face {
          font-family: 'Fixedsys Excelsior';
          src: url('/font/fixedsys-excelsior/fsex300-webfont.woff') format('woff'),
               url('/font/fixedsys-excelsior/fsex300-webfont.ttf') format('truetype');
          font-weight: normal;
          font-style: normal;
          font-display: block;
        }
        .bios-terminal, .bios-terminal * {
          font-family: 'Fixedsys Excelsior', 'Perfect DOS VGA 437', 'Courier New', monospace !important;
          font-weight: normal !important;
          -webkit-font-smoothing: none !important;
          -moz-osx-font-smoothing: unset !important;
        }
        @keyframes terminal-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .term-cursor {
          display: inline-block;
          width: 8px;
          height: 14px;
          background-color: currentColor;
          animation: terminal-blink 1s infinite;
          vertical-align: middle;
          margin-left: 2px;
        }
      `}</style>

      {/* Render BIOS Screen */}
      {stage === 'BIOS' && (
        <div
          ref={containerRef}
          className="bios-terminal"
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '8px 12px',
            fontSize: '14px',
            lineHeight: '1.15',
            position: 'relative',
            color: '#aaaaaa',
            backgroundColor: '#000000',
          }}
        >
          {/* Energy Star logo — top right */}
          <div style={{ position: 'absolute', top: 8, right: 12, textAlign: 'center' }}>
            <svg style={{ width: 100, height: 70 }} viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M 60,4 L 67,24 L 88,24 L 71,37 L 78,57 L 60,44 L 42,57 L 49,37 L 32,24 L 53,24 Z" stroke="#ffff00" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
              <path d="M 30,14 A 40,40 0 0,0 74,62" stroke="#00cc00" strokeWidth="2" strokeLinecap="round" fill="none" />
              <text x="60" y="36" fill="#ffff00" fontSize="10" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fontStyle="italic">energy</text>
            </svg>
            <div style={{ color: '#00cc00', fontSize: '9px', letterSpacing: '0.5px', marginTop: '-4px', fontFamily: 'Arial, sans-serif' }}>
              EPA POLLUTION PREVENTER
            </div>
          </div>

          {/* Printed BIOS lines */}
          {BIOS_LINES.slice(0, biosVisibleCount).map((line, i) => renderBioLine(line, i))}
        </div>
      )}

      {/* Render Hercules emulation info */}
      {stage === 'HERCULES' && (
        <div
          ref={containerRef}
          className="bios-terminal"
          style={{
            flex: 1,
            overflow: 'hidden',
            padding: '16px 20px',
            fontSize: '13px',
            lineHeight: '1.25',
            position: 'relative',
            color: '#bbbbbb',
            backgroundColor: '#000000',
          }}
        >
          {HERCULES_LINES.slice(0, herculesVisibleCount).map((line, i) => (
            <div
              key={i}
              style={{
                color: line.color || '#aaaaaa',
                fontWeight: ('bold' in line && line.bold) ? 'bold' : 'normal',
                wordBreak: 'break-all',
                whiteSpace: 'pre',
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      )}

      {/* Render custom SKTY style white interactive terminal */}
      {stage === 'MAINFRAME_LINK' && (
        <div
          ref={containerRef}
          className="bios-terminal"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            fontSize: '14px',
            lineHeight: '1.15',
            position: 'relative',
            color: '#aaaaaa',
            backgroundColor: '#000000',
          }}
        >
          {/* History lines */}
          {mainframeHistory.map((line, i) => renderHistoryLine(line, i))}

          {/* Current Prompt Input line */}
          {dialogueState !== 'BOOTING' && dialogueState !== 'VERIFYING' && (
            <form onSubmit={handleInputSubmit} style={{ display: 'inline-block', width: '100%', marginTop: '8px' }}>
              <span style={{ color: '#ffffff' }}>{promptLabel}</span>
              <span style={{ position: 'relative', display: 'inline-block', color: '#ffffff' }}>
                {dialogueState === 'ASK_PASSWORD' ? '*'.repeat(inputValue.length) : inputValue}
                <span className="term-cursor" />
              </span>
              <input
                ref={inputRef}
                type={dialogueState === 'ASK_PASSWORD' ? 'password' : 'text'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                style={{
                  position: 'absolute',
                  opacity: 0,
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  cursor: 'text',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'transparent',
                }}
                autoFocus
              />
            </form>
          )}

          {/* Skip button at the very bottom right */}
          <div 
            onClick={(e) => {
              e.stopPropagation();
              handleComplete();
            }}
            style={{
              position: 'absolute',
              bottom: '12px',
              right: '12px',
              color: '#444444',
              fontSize: '11px',
              cursor: 'pointer',
              border: '1px solid #222222',
              padding: '2px 6px',
              background: '#000000',
              borderRadius: '2px',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#444444'}
          >
            [ESC] SKIP INTRO
          </div>
        </div>
      )}

      {/* Bottom status bar — pinned */}
      <div
        className="bios-terminal"
        style={{
          padding: '4px 12px',
          fontSize: '14px',
          lineHeight: '1.15',
          color: '#888888',
          borderTop: 'none',
          backgroundColor: 'transparent',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        {stage === 'BIOS' && <span>Press F8 for Startup Menu.</span>}
        {stage === 'HERCULES' && <span>IPL Link Emulation Port: 3001</span>}
        {stage === 'MAINFRAME_LINK' && (
          <>
            <span>RUNSTATE: ONLINE</span>
            <span>SKTY CORE v3.12</span>
          </>
        )}
      </div>
    </div>
  );
};

export default BootScreen;
