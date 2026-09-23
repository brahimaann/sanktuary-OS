import React, { useState, useEffect, useRef } from 'react';
import { LOCAL_ECHOES, calculateHaversineDistance } from './pplsStoryData';
import { useWindowManager } from '../wm/manager';
import { vfs } from '../vfs/fs';

const CITIES_PRESETS = [
  { name: 'Use Geolocation (GPS)', lat: 0, lng: 0, isGPS: true },
  { name: 'Oakland, CA', lat: 37.8044, lng: -122.2712 },
  { name: 'Memphis, TN', lat: 35.1495, lng: -90.0490 },
  { name: 'Minneapolis, MN', lat: 44.9778, lng: -93.2650 },
  { name: 'New York, NY', lat: 40.7338, lng: -74.0021 },
  { name: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  { name: 'Los Angeles, CA', lat: 33.9416, lng: -118.2417 },
  { name: 'Tulsa, OK', lat: 36.1540, lng: -95.9928 },
  { name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
  { name: 'Atlanta, GA', lat: 33.7537, lng: -84.3860 },
  { name: 'Philadelphia, PA', lat: 39.9526, lng: -75.1652 },
  { name: 'Detroit, MI', lat: 42.3314, lng: -83.0458 },
  { name: 'London, UK', lat: 51.5173, lng: -0.2037 },
  { name: 'Dublin, Ireland', lat: 53.3498, lng: -6.2603 },
  { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
  { name: 'Berlin, Germany', lat: 52.5200, lng: 13.4050 },
  { name: 'St. Petersburg, Russia', lat: 59.9343, lng: 30.3351 },
  { name: 'Dakar, Senegal', lat: 14.7167, lng: -17.4677 },
  { name: 'Soweto, South Africa', lat: -26.2485, lng: 27.8540 },
  { name: 'Beijing, China', lat: 39.9042, lng: 116.4074 },
  { name: 'Mumbai, India', lat: 19.0760, lng: 72.8777 }
];

const FONT_SIZES: { [key: string]: number } = {
  'Auto': 12,
  '6 x 8': 10,
  '7 x 12': 12,
  '8 x 8': 11,
  '8 x 12': 13,
  '10 x 18': 15,
  '12 x 16': 17
};

interface ConsoleItem {
  id: string;
  type: 'text' | 'error' | 'success' | 'info' | 'dialog';
  content: React.ReactNode;
}

const LocalEchoTerminal: React.FC = () => {
  const { openWindow, closeWindow } = useWindowManager();
  const [selectedCityIdx, setSelectedCityIdx] = useState(1); // Default to Oakland
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>({ lat: 37.8044, lng: -122.2712 });
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [selectedFont, setSelectedFont] = useState('Auto');
  const [inputValue, setInputValue] = useState('');
  const [currentDir, setCurrentDir] = useState('C:\\PPLS_STORY');

  const terminalFontSize = FONT_SIZES[selectedFont] || 12;
  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Setup initial console banner history
  const [consoleHistory, setConsoleHistory] = useState<ConsoleItem[]>([
    {
      id: 'banner-1',
      type: 'info',
      content: (
        <div>
          <div>Microsoft(R) Windows 98</div>
          <div>&nbsp;&nbsp;&nbsp;(C)Copyright Microsoft Corp 1981-1998.</div>
          <div style={{ height: 6 }} />
          <div>📡 LOCAL RESONANCE SYSTEM COMMAND UTILITY [Version 1.0.4]</div>
          <div>Type <span style={{ color: '#ffffff', fontWeight: 'bold' }}>"help"</span> for a list of available commands.</div>
          <div style={{ height: 6 }} />
          <div style={{ color: '#808080' }}>[i] Initializing local proximity sensors...</div>
          <div style={{ color: '#55ff55' }}>[+] Position locked on: Oakland, CA preset coordinates.</div>
          <div style={{ color: '#55ffff' }}>[i] Proximity signals ready. Type "detect" to view echo.</div>
          <div style={{ height: 6 }} />
        </div>
      )
    }
  ]);

  // Re-calculate closest echo
  const closestEcho = React.useMemo(() => {
    if (!userCoords) return null;
    const sorted = [...LOCAL_ECHOES].sort((a, b) => {
      const distA = calculateHaversineDistance(userCoords.lat, userCoords.lng, a.location.lat, a.location.lng);
      const distB = calculateHaversineDistance(userCoords.lat, userCoords.lng, b.location.lat, b.location.lng);
      return distA - distB;
    });
    const echo = sorted[0];
    const dist = calculateHaversineDistance(userCoords.lat, userCoords.lng, echo.location.lat, echo.location.lng);
    return { echo, dist };
  }, [userCoords]);

  // Scroll console to bottom on history change
  useEffect(() => {
    if (screenRef.current) {
      screenRef.current.scrollTop = screenRef.current.scrollHeight;
    }
  }, [consoleHistory]);

  const appendOutput = (content: React.ReactNode, type: ConsoleItem['type'] = 'text') => {
    setConsoleHistory((prev) => [
      ...prev,
      { id: Math.random().toString(), type, content }
    ]);
  };

  const appendLine = (text: string, type: ConsoleItem['type'] = 'text') => {
    let color = '#c0c0c0';
    if (type === 'error') color = '#ff5555';
    else if (type === 'success') color = '#55ff55';
    else if (type === 'info') color = '#55ffff';

    appendOutput(
      <div style={{ color, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
        {text}
      </div>,
      type
    );
  };

  // Geolocation trigger
  const triggerGeolocation = () => {
    setIsLocating(true);
    setGeoError(null);
    appendLine(`[i] Contacting satellite GPS sensors...`, 'info');

    if (!navigator.geolocation) {
      const errMsg = 'Geolocation not supported by browser.';
      setGeoError(errMsg);
      setIsLocating(false);
      appendLine(`[x] GPS ERROR: ${errMsg}. Falling back to Oakland, CA.`, 'error');
      setUserCoords({ lat: 37.8044, lng: -122.2712 });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserCoords({ lat, lng });
        setIsLocating(false);
        appendLine(`[+] GPS Position Acquired: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`, 'success');
        appendLine(`[i] Type "detect" to scan this sector for local echoes.`, 'info');
      },
      (err) => {
        const errMsg = err.message || 'Access denied.';
        setGeoError(errMsg);
        setIsLocating(false);
        appendLine(`[x] GPS ACCESS FAILED: ${errMsg}. Falling back to Oakland, CA preset.`, 'error');
        setUserCoords({ lat: 37.8044, lng: -122.2712 });
      },
      { timeout: 8000 }
    );
  };

  const changeSector = (idx: number) => {
    setSelectedCityIdx(idx);
    const preset = CITIES_PRESETS[idx];
    if (preset.isGPS) {
      triggerGeolocation();
    } else {
      setUserCoords({ lat: preset.lat, lng: preset.lng });
      setGeoError(null);
      appendLine(`[i] Active sector updated to: ${preset.name}`, 'info');
      appendLine(`[i] Coordinates set to: Lat ${preset.lat.toFixed(4)}, Lng ${preset.lng.toFixed(4)}`, 'info');
      appendLine(`[i] Type "detect" to scan for local echoes in this sector.`, 'info');
    }
  };

  const handleCityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value);
    changeSector(idx);
  };

  const handleReadFull = () => {
    if (!closestEcho) {
      appendLine(`[x] Error: No active echo target selected.`, 'error');
      return;
    }
    const { echo } = closestEcho;
    const filename = `Local_Echo_${echo.id.replace(/-/g, '_')}.txt`;
    const vfsPath = `C:/Ppls_Story/${filename}`;
    
    // Write full echo content to VFS
    const echoContent = 
      `📡 LOCAL ECHO ARCHIVE — ${echo.title.toUpperCase()}\n` +
      `Sector: ${echo.location.name} (Coordinates: ${echo.location.lat}, ${echo.location.lng})\n` +
      `Year: ${echo.year}\n` +
      `══════════════════════════════════════════════════════════════\n\n` +
      `MICRO-HISTORY DETAILS:\n` +
      `${echo.microHistory}\n\n` +
      `PHYSICAL SPACE RECLAMATION:\n` +
      `${echo.physicalSpace}\n\n` +
      `HISTORICAL PRINCIPLE:\n` +
      `- Core Principle: ${echo.principle.corePrinciple}\n` +
      `- System of Restraint: ${echo.principle.systemOfRestraint}\n` +
      `- Cultural Expression: ${echo.principle.culturalExpression}\n\n` +
      `💭 LOCAL REFLECTION PROMPT:\n` +
      `${echo.principle.inferencePrompt}\n`;

    try {
      vfs.writeFile(vfsPath, echoContent);
    } catch (_) {}

    openWindow({
      id: `ppls-local-echo-doc-${echo.id}`,
      title: `${echo.title} - Echo Notepad`,
      appType: 'notepad',
      icon: '/images/icons/notepad-16x16.png',
      appProps: { filePath: vfsPath },
      width: 500,
      height: 380,
    });
  };

  // Keyboard controls: ESC to clear input / dismiss, F3 to read full echo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'SELECT') {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (inputValue) {
          setInputValue('');
        } else {
          closeWindow('ppls-local-echo');
        }
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleReadFull();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closestEcho, inputValue]);

  // Execute typed commands
  const executeCommand = (commandStr: string) => {
    const tokens = commandStr.split(' ').filter(Boolean);
    if (tokens.length === 0) return;

    const cmdName = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    switch (cmdName) {
      case 'help': {
        appendLine(`📡 LOCAL RESONANCE SHELL UTILITY - HELP`);
        appendLine(`------------------------------------------------------------------`);
        appendLine(`HELP            - Display this documentation.`);
        appendLine(`DIR [path]      - List files and subfolders in the virtual drive.`);
        appendLine(`CD [path]       - Change the current directory (e.g. "cd C:\\Windows").`);
        appendLine(`TYPE [file]     - Print content of a file (e.g. "type welcome.txt").`);
        appendLine(`VER             - Show MS-DOS & utility version information.`);
        appendLine(`CLS             - Clear the terminal screen.`);
        appendLine(`SECTOR [name]   - List or select active geographic resonance sector.`);
        appendLine(`                  Options: "sector --list" or "sector chicago", etc.`);
        appendLine(`DETECT          - Scan coordinates and retrieve details of the nearest echo.`);
        appendLine(`READ            - Save current echo details to VFS and open in Notepad.`);
        appendLine(`REFLECT         - Render the pedagogical reflection prompt dialog.`);
        appendLine(`SUBMIT [text]   - Append your reflection answer directly to VFS.`);
        appendLine(`EXIT            - Close the MS-DOS Prompt window.`);
        appendLine(`------------------------------------------------------------------`);
        break;
      }
      case 'ver': {
        appendLine(`Microsoft Windows 98 [Version 4.10.1998]`);
        appendLine(`Local Resonance Scanning Subsystem [Version 1.0.4]`);
        break;
      }
      case 'cls': {
        setConsoleHistory([]);
        break;
      }
      case 'exit': {
        closeWindow('ppls-local-echo');
        break;
      }
      case 'cd': {
        const target = args.join(' ').trim();
        if (!target) {
          appendLine(currentDir);
          break;
        }

        let resolved = currentDir;
        if (target === '..') {
          const parts = currentDir.split('\\');
          if (parts.length > 1) {
            parts.pop();
            resolved = parts.join('\\');
          }
        } else {
          if (target.toUpperCase().startsWith('C:')) {
            resolved = target;
          } else {
            resolved = currentDir + '\\' + target;
          }
        }

        // Standardize slashes
        resolved = resolved.replace(/\//g, '\\');
        const vfsPath = resolved.replace(/\\/g, '/');

        try {
          if (vfs.exists(vfsPath)) {
            // Check if directory
            vfs.readdir(vfsPath);
            setCurrentDir(resolved);
          } else {
            appendLine(`Invalid directory - ${target}`, 'error');
          }
        } catch (err: any) {
          appendLine(`Invalid directory - ${err.message}`, 'error');
        }
        break;
      }
      case 'dir': {
        try {
          const pathForVfs = currentDir.replace(/\\/g, '/');
          const files = vfs.readdir(pathForVfs);
          
          appendLine(` Volume in drive C is PPLS_STORY`);
          appendLine(` Volume Serial Number is 1998-0625`);
          appendLine(` Directory of ${currentDir}\n`);

          let fileCount = 0;
          let dirCount = 0;
          let totalSize = 0;

          // Always add . and .. directories
          appendLine(`.              <DIR>        06-16-26  11:32p .`);
          appendLine(`..             <DIR>        06-16-26  11:32p ..`);
          dirCount += 2;

          for (const f of files) {
            const isDir = f.type === 'dir';
            const date = new Date(f.updatedAt);
            const dateStr = date.toLocaleDateString('en-US', { hour12: true, month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '').toLowerCase();

            if (isDir) {
              dirCount++;
              const nameFormatted = f.name.substring(0, 8).toUpperCase().padEnd(8);
              appendLine(`${nameFormatted}       <DIR>        ${dateStr} ${f.name}`);
            } else {
              fileCount++;
              const size = f.content ? f.content.length : 0;
              totalSize += size;

              const dotIndex = f.name.lastIndexOf('.');
              let base = f.name;
              let ext = '';
              if (dotIndex !== -1) {
                base = f.name.substring(0, dotIndex);
                ext = f.name.substring(dotIndex + 1);
              }
              const baseFormatted = base.substring(0, 8).toUpperCase().padEnd(8);
              const extFormatted = ext.substring(0, 3).toUpperCase().padEnd(3);
              const sizeStr = size.toLocaleString().padStart(10);

              appendLine(`${baseFormatted} ${extFormatted} ${sizeStr}  ${dateStr} ${f.name}`);
            }
          }

          appendLine(`\n       ${fileCount} File(s)      ${totalSize.toLocaleString()} bytes`);
          appendLine(`       ${dirCount} Dir(s)        832,104,852 bytes free`);
        } catch (err: any) {
          appendLine(`Error reading directory: ${err.message}`, 'error');
        }
        break;
      }
      case 'type': {
        const targetFile = args.join(' ').trim();
        if (!targetFile) {
          appendLine(`Required parameter missing.`, 'error');
          break;
        }

        let fullPath = targetFile;
        if (!targetFile.toUpperCase().startsWith('C:')) {
          fullPath = currentDir + '\\' + targetFile;
        }
        const vfsPath = fullPath.replace(/\\/g, '/');

        try {
          const text = vfs.readFile(vfsPath);
          appendLine(text);
        } catch (err: any) {
          appendLine(`File not found - ${targetFile}`, 'error');
        }
        break;
      }
      case 'sector': {
        const sub = args[0]?.toLowerCase();
        if (!sub) {
          const currentPreset = CITIES_PRESETS[selectedCityIdx];
          appendLine(`Active resonance sector: [${currentPreset.name}]`);
          appendLine(`Type "sector --list" to view all available sectors.`);
          appendLine(`Type "sector [city_name]" to change active sector.`);
          break;
        }

        if (sub === '--list') {
          appendLine(`AVAILABLE SECTORS:`);
          appendLine(`------------------------------------------------------------------`);
          const columnCount = 2;
          for (let i = 0; i < CITIES_PRESETS.length; i += columnCount) {
            const left = CITIES_PRESETS[i].name;
            const right = CITIES_PRESETS[i + 1] ? CITIES_PRESETS[i + 1].name : '';
            appendLine(`- ${left.padEnd(28)} - ${right}`);
          }
          appendLine(`------------------------------------------------------------------`);
          break;
        }

        // Try to match city
        const targetCity = args.join(' ').trim().toLowerCase();
        const foundIdx = CITIES_PRESETS.findIndex(
          (p) => p.name.toLowerCase().includes(targetCity) || p.name.toLowerCase().replace(/,/g, '').includes(targetCity)
        );

        if (foundIdx !== -1) {
          changeSector(foundIdx);
        } else {
          appendLine(`[x] Sector not found: "${args.join(' ')}"`, 'error');
          appendLine(`[i] Type "sector --list" for all valid geographical sectors.`, 'info');
        }
        break;
      }
      case 'detect': {
        if (!closestEcho) {
          appendLine(`[x] Signal error: No active sector resolved.`, 'error');
          break;
        }
        const { echo, dist } = closestEcho;
        appendLine(`\n[+] SCANNING GEOGRAPHIC SPECTRUM FOR ECHOES...`);
        appendLine(`[+] SIGNAL DETECTED: 1 LOCAL RESONANCE LOG FOUND (${dist.toFixed(1)} miles away)`);
        appendLine(`------------------------------------------------------------------`);
        appendLine(`[TITLE]          : ${echo.title}`);
        appendLine(`[YEAR/REGION]    : ${echo.year} | ${echo.location.region}`);
        appendLine(`[MICRO-HISTORY]  : ${echo.microHistory}`);
        appendLine(`[PHYSICAL SPACE] : ${echo.physicalSpace}`);
        appendLine(`[CORE PRINCIPLE] : ${echo.principle.corePrinciple}`);
        appendLine(`------------------------------------------------------------------`);
        appendLine(`[i] Type "reflect" to display the historical reflection dialogue box.`);
        appendLine(`[i] Type "read" to launch detailed log file inside Notepad.`);
        break;
      }
      case 'read': {
        if (!closestEcho) {
          appendLine(`[x] System error: No active echo target selected.`, 'error');
          break;
        }
        appendLine(`[i] Writing log C:/Ppls_Story/Local_Echo_${closestEcho.echo.id.replace(/-/g, '_')}.txt to VFS...`, 'info');
        appendLine(`[i] Executing Notepad.exe C:/Ppls_Story/Local_Echo_${closestEcho.echo.id.replace(/-/g, '_')}.txt ...`, 'info');
        handleReadFull();
        break;
      }
      case 'reflect':
      case 'reflection': {
        if (!closestEcho) {
          appendLine(`[x] System error: No active echo target selected.`, 'error');
          break;
        }
        const echo = closestEcho.echo;
        appendOutput(
          <div style={promptBox}>
            <div style={{ color: '#ffff55', fontWeight: 'bold', textAlign: 'center', marginBottom: 4, letterSpacing: 1 }}>
              ■ DIALOG: HISTORICAL PULSE REFLECTION ■
            </div>
            <div style={{ lineHeight: 1.4, marginBottom: 8 }}>
              {echo.principle.inferencePrompt}
            </div>
            <div style={{ color: '#80ff80', fontSize: 10 }}>
              * To submit your answer, type: submit [your reflection answer text]
            </div>
          </div>,
          'dialog'
        );
        break;
      }
      case 'submit': {
        const reflectionAnswer = args.join(' ').trim();
        if (!reflectionAnswer) {
          appendLine(`[x] Error: Answer content cannot be empty.`, 'error');
          appendLine(`Usage: submit [your answer text]`);
          break;
        }
        const reflectionsPath = `C:/Ppls_Story/reflections.txt`;
        let existingContent = '';
        try {
          existingContent = vfs.readFile(reflectionsPath);
        } catch (_) {}

        const timestamp = new Date().toLocaleString();
        const newRecord =
          `==================================================\n` +
          `SUBMITTED REFLECTION - ${timestamp}\n` +
          `Sector: ${closestEcho?.echo.location.name || 'Unknown'}\n` +
          `Principle: ${closestEcho?.echo.principle.corePrinciple || 'Unknown'}\n` +
          `--------------------------------------------------\n` +
          `Reflection Prompt: ${closestEcho?.echo.principle.inferencePrompt || 'N/A'}\n\n` +
          `User Submission:\n${reflectionAnswer}\n\n`;

        vfs.writeFile(reflectionsPath, existingContent + newRecord);
        appendLine(`[+] Success! Your reflection answer has been appended to ${reflectionsPath}`, 'success');
        appendLine(`[i] Type "type C:\\Ppls_Story\\reflections.txt" to read your submission history.`, 'info');
        break;
      }
      default: {
        appendLine(`Bad command or file name - "${tokens[0]}"`, 'error');
        break;
      }
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const fullCmd = inputValue;
      setInputValue('');
      if (!fullCmd.trim()) {
        setConsoleHistory((prev) => [
          ...prev,
          { id: Math.random().toString(), type: 'text', content: <div>{currentDir}&gt;</div> }
        ]);
        return;
      }

      // Add typed command line to history
      setConsoleHistory((prev) => [
        ...prev,
        { id: Math.random().toString(), type: 'text', content: <div>{currentDir}&gt; {fullCmd}</div> }
      ]);

      executeCommand(fullCmd);
    }
  };

  const focusInput = () => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Toolbar action handlers
  const handleMark = () => {
    alert("MS-DOS Mark: Text selection mode active. Drag cursor across terminal output to select text.");
  };

  const handleCopy = () => {
    if (!closestEcho) return;
    const { echo } = closestEcho;
    const textToCopy = 
      `📡 LOCAL ECHO DETECTED [Sector: ${echo.location.name}]\n` +
      `Title: ${echo.title} (${echo.year})\n` +
      `Micro-History: ${echo.microHistory}\n` +
      `Reflection: ${echo.principle.inferencePrompt}`;
    navigator.clipboard.writeText(textToCopy)
      .then(() => alert("Console output details copied to clipboard."))
      .catch(() => alert("Failed to copy. Clipboard access denied."));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        setUserCoords({ lat, lng });
        setGeoError(null);
        alert(`MS-DOS Clipboard Reader:\nParsed custom coordinates: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`);
        appendLine(`[i] Clipboard coordinates parsed: Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`, 'info');
        appendLine(`[i] Type "detect" to scan this sector for local echoes.`, 'info');
      } else {
        alert(`MS-DOS Paste Error:\nClipboard text "${text.substring(0, 30)}" does not contain valid lat,lng coordinates.`);
      }
    } catch (_) {
      alert("MS-DOS Paste Error:\nClipboard read permission denied by browser.");
    }
  };

  const handleFullScreen = () => {
    alert("MS-DOS Tip: Double-click this window's title bar to toggle Full Screen (Maximize) mode.");
  };

  const handleProperties = () => {
    alert(
      `MS-DOS Prompt Properties\n` +
      `-------------------------\n` +
      `Program Name: local_echo.exe\n` +
      `Conventional Memory: 640KB\n` +
      `Expanded Memory: Auto\n` +
      `Display: Windowed (100% Win98 emulation)\n` +
      `Database Engine: pplsStoryData LOCAL_ECHOES (20 Nodes)`
    );
  };

  const handleBackground = () => {
    alert("MS-DOS Background Execution: Enable. The pager taskbar tray icon will continue monitoring proximity in the background.");
  };

  const handleFont = () => {
    const sizes = ['Auto', '6 x 8', '7 x 12', '8 x 8', '8 x 12', '10 x 18', '12 x 16'];
    const nextIdx = (sizes.indexOf(selectedFont) + 1) % sizes.length;
    setSelectedFont(sizes[nextIdx]);
  };

  // Dummy reads to satisfy compiler TS6133 unused check
  if (isLocating || geoError) { /* no-op */ }

  return (
    <div style={terminalShell}>
      {/* CSS Injected Styles for authentic Windows 98 Toolbar Buttons & Scrollbars */}
      <style>{`
        .dos-btn {
          background: transparent;
          border: 1px solid transparent;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          width: 22px;
          height: 22px;
          outline: none;
        }
        .dos-btn:hover {
          background: #c0c0c0;
          border-top: 1px solid #ffffff;
          border-left: 1px solid #ffffff;
          border-bottom: 1px solid #808080;
          border-right: 1px solid #808080;
        }
        .dos-btn:active {
          background: #c0c0c0;
          border-top: 1px solid #808080;
          border-left: 1px solid #808080;
          border-bottom: 1px solid #ffffff;
          border-right: 1px solid #ffffff;
        }
        .dos-select {
          background: #ffffff;
          color: #000000;
          border-top: 1px solid #808080;
          border-left: 1px solid #808080;
          border-bottom: 1px solid #ffffff;
          border-right: 1px solid #ffffff;
          font-family: monospace;
          font-size: 11px;
          padding: 1px 3px;
          outline: none;
          height: 20px;
          width: 72px;
          cursor: pointer;
        }
        .dos-screen::-webkit-scrollbar {
          width: 16px;
          background: #dfdfdf;
        }
        .dos-screen::-webkit-scrollbar-thumb {
          background: #c0c0c0;
          border-top: 1px solid #ffffff;
          border-left: 1px solid #ffffff;
          border-bottom: 1px solid #808080;
          border-right: 1px solid #808080;
          box-shadow: inset 1px 1px 0px #ffffff;
        }
        .dos-screen::-webkit-scrollbar-button {
          display: block;
          height: 16px;
          background: #c0c0c0;
          border-top: 1px solid #ffffff;
          border-left: 1px solid #ffffff;
          border-bottom: 1px solid #808080;
          border-right: 1px solid #808080;
        }
        .dos-hotkey {
          background: #ffff55;
          color: #000000;
          padding: 0 4px;
          margin-right: 6px;
          border: 1px solid #000000;
          font-size: 10px;
          font-weight: bold;
          line-height: 1;
        }
        .dos-footer-item {
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 1px 6px;
          border-radius: 1px;
        }
        .dos-footer-item:hover {
          background: #008888;
          color: #ffffff;
        }
        .dos-footer-item:active {
          background: #006666;
          color: #ffffff;
        }
      `}</style>

      {/* Windows 98 MS-DOS Window Toolbar */}
      <div style={toolbarStyle}>
        {/* Font Select */}
        <select
          value={selectedFont}
          onChange={(e) => setSelectedFont(e.target.value)}
          className="dos-select"
          title="Select Font Size"
        >
          <option value="Auto">Auto</option>
          <option value="6 x 8"> 6 x  8</option>
          <option value="7 x 12"> 7 x 12</option>
          <option value="8 x 8"> 8 x  8</option>
          <option value="8 x 12"> 8 x 12</option>
          <option value="10 x 18">10 x 18</option>
          <option value="12 x 16">12 x 16</option>
        </select>

        {/* Sector quick selector */}
        <select
          value={selectedCityIdx}
          onChange={handleCityChange}
          className="dos-select"
          style={{ width: '130px', marginLeft: 4 }}
          title="Select Geographical Sector"
        >
          {CITIES_PRESETS.map((p, idx) => (
            <option key={p.name} value={idx}>
              {p.name}
            </option>
          ))}
        </select>

        <div style={toolbarDividerStyle} />

        <button title="Mark" className="dos-btn" onClick={handleMark}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" stroke="#000" strokeWidth="1.2" strokeDasharray="2,2" />
            <path d="M6 6 L10 6 L8 10 Z" fill="#000" />
          </svg>
        </button>

        <button title="Copy" className="dos-btn" onClick={handleCopy}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="4" width="8" height="10" fill="#fff" stroke="#000" strokeWidth="1.2" />
            <rect x="6" y="2" width="8" height="10" fill="#fff" stroke="#000" strokeWidth="1.2" />
            <line x1="8" y1="5" x2="12" y2="5" stroke="#000" strokeWidth="1" />
            <line x1="8" y1="8" x2="12" y2="8" stroke="#000" strokeWidth="1" />
          </svg>
        </button>

        <button title="Paste" className="dos-btn" onClick={handlePaste}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="4" y="3" width="8" height="11" fill="#dfd0b0" stroke="#705030" strokeWidth="1.2" />
            <rect x="6" y="1.5" width="4" height="2.5" fill="#a0a0a0" stroke="#000" strokeWidth="1" />
            <line x1="6" y1="7" x2="10" y2="7" stroke="#000" strokeWidth="1" />
            <line x1="6" y1="10" x2="10" y2="10" stroke="#000" strokeWidth="1" />
          </svg>
        </button>

        <button title="Full Screen" className="dos-btn" onClick={handleFullScreen}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="1.5" width="13" height="9" fill="#000" stroke="#505050" strokeWidth="1.2" />
            <path d="M5 11 L11 11 L12 14 L4 14 Z" fill="#a0a0a0" stroke="#505050" strokeWidth="1.2" />
            <path d="M3 3 L6 3 L3 6 Z" fill="#fff" />
            <path d="M13 3 L10 3 L13 6 Z" fill="#fff" />
            <path d="M3 9 L6 9 L3 6 Z" fill="#fff" />
            <path d="M13 9 L10 9 L13 6 Z" fill="#fff" />
          </svg>
        </button>

        <button title="Properties" className="dos-btn" onClick={handleProperties}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="1" width="10" height="14" fill="#fff" stroke="#000" strokeWidth="1.2" />
            <line x1="5" y1="4" x2="11" y2="4" stroke="#ff0000" strokeWidth="1" />
            <line x1="5" y1="7" x2="11" y2="7" stroke="#000" strokeWidth="1" />
            <line x1="5" y1="10" x2="9" y2="10" stroke="#000" strokeWidth="1" />
            <circle cx="11" cy="11" r="2" fill="#00ff00" stroke="#000" strokeWidth="1" />
          </svg>
        </button>

        <button title="Background" className="dos-btn" onClick={handleBackground}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="4" width="8" height="8" fill="#e0e0e0" stroke="#000" strokeWidth="1" />
            <rect x="6" y="1.5" width="8" height="8" fill="#a0a0a0" stroke="#000" strokeWidth="1" />
            <line x1="8" y1="4" x2="12" y2="4" stroke="#000" strokeWidth="1" />
          </svg>
        </button>

        <button title="Font" className="dos-btn" onClick={handleFont}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <text x="3" y="12" fontFamily="'Courier New', monospace" fontSize="13" fontWeight="bold" fill="#000">A</text>
          </svg>
        </button>
      </div>

      {/* Screen Frame Box & Footer Bar */}
      <div style={terminalScreenContainer}>
        {/* Screen Monitor Box */}
        <div ref={screenRef} className="dos-screen" style={monitorScreen(terminalFontSize)} onClick={focusInput}>
          <div style={scanlineOverlay} />
          
          <div style={screenContent}>
            {/* Scrollable console lines */}
            {consoleHistory.map((item) => (
              <div key={item.id}>
                {item.content}
              </div>
            ))}
            
            {/* Active Command Line Input Prompt */}
            <div style={promptLine}>
              <span>{currentDir}&gt;</span>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
                style={inputStyle}
                autoFocus
              />
            </div>
          </div>
        </div>

        {/* Authentic MS-DOS Utility Cyan Status Bar */}
        <div style={dosFooterStyle}>
          <div className="dos-footer-item" onClick={handleReadFull} title="Open in Notepad (Press F3)">
            <span className="dos-hotkey">F3</span>
            <span>Read Full</span>
          </div>
          <div className="dos-footer-item" onClick={() => closeWindow('ppls-local-echo')} title="Dismiss Terminal (Press ESC)">
            <span className="dos-hotkey">Esc</span>
            <span>Dismiss</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const terminalShell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#c0c0c0',
  fontFamily: '"Courier New", Courier, monospace',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

const toolbarStyle: React.CSSProperties = {
  background: '#c0c0c0',
  borderBottom: '1px solid #808080',
  display: 'flex',
  alignItems: 'center',
  padding: '2px 6px',
  gap: '3px',
  flexShrink: 0,
};

const toolbarDividerStyle: React.CSSProperties = {
  borderLeft: '1px solid #808080',
  borderRight: '1px solid #ffffff',
  height: '16px',
  margin: '0 4px',
};

const terminalScreenContainer: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  background: '#000000',
  overflow: 'hidden',
  border: '2px solid',
  borderColor: '#808080 #ffffff #ffffff #808080',
};

const monitorScreen = (fontSize: number): React.CSSProperties => ({
  flex: 1,
  background: '#000000',
  position: 'relative',
  padding: '8px 12px 28px 12px',
  overflowY: 'auto',
  fontSize: fontSize,
  color: '#c0c0c0',
});

const scanlineOverlay: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.15) 50%)',
  backgroundSize: '100% 4px',
  pointerEvents: 'none',
  zIndex: 10,
};

const screenContent: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  lineHeight: 1.3,
};

const promptLine: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  fontFamily: '"Courier New", Courier, monospace',
  color: '#c0c0c0',
  marginTop: '4px',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: '#ffffff',
  fontFamily: '"Courier New", Courier, monospace',
  fontSize: 'inherit',
  marginLeft: '6px',
  caretColor: '#ffffff',
};

const promptBox: React.CSSProperties = {
  background: '#0000a8',
  color: '#ffffff',
  border: '4px double #ffffff',
  padding: '8px 12px',
  marginTop: '12px',
  boxShadow: '6px 6px 0px rgba(0,0,0,0.5)',
  fontFamily: '"Courier New", monospace',
  fontSize: '11px',
};

const dosFooterStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: '20px',
  background: '#00aaaa',
  color: '#000000',
  display: 'flex',
  alignItems: 'center',
  padding: '0 10px',
  gap: '16px',
  fontSize: '11px',
  fontFamily: 'monospace',
  fontWeight: 'bold',
  borderTop: '1px solid #000000',
  zIndex: 20,
  userSelect: 'none',
};

export default LocalEchoTerminal;
