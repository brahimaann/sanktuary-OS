import React, { useState, useEffect } from 'react';
import { vfs, VFSNode } from '../vfs/fs';
import { useWindowManager } from '../wm/manager';

interface ExplorerProps {
  path?: string;
  windowId?: string;
}

interface NetworkLink {
  id: string;
  title: string;
  url: string;
}

const NET_HOOD_LINKS: NetworkLink[] = [
  { id: '98js', title: '98.js', url: 'https://98.js.org' },
  { id: 'packard-belle', title: 'Packard Belle', url: 'https://packard-belle.netlify.app/' },
  { id: 'poolsuite', title: 'Poolsuite', url: 'https://poolsuite.net/' },
  { id: 'win96', title: 'Windows 96', url: 'https://windows96.net/' },
  { id: 'win93', title: 'WINDOWS93', url: 'https://www.windows93.net/' },
];

export const Explorer: React.FC<ExplorerProps> = ({ path: initialPath = 'C:/', windowId }) => {
  const { openWindow, closeWindow } = useWindowManager();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [history, setHistory] = useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [items, setItems] = useState<VFSNode[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  
  // Keep local address bar text to prevent loading on every keystroke
  const [addressBarValue, setAddressBarValue] = useState(initialPath);

  useEffect(() => {
    setAddressBarValue(currentPath);
    if (!isNetworkPath(currentPath)) {
      loadDirectory(currentPath);
      const unsubscribe = vfs.subscribe(() => {
        loadDirectory(currentPath);
      });
      return unsubscribe;
    } else {
      setItems([]);
      setSelectedName(null);
    }
  }, [currentPath]);

  const isNetworkPath = (path: string) => {
    const p = path.toLowerCase().trim();
    return p === 'sanktuary net' || p === 'c:/sanktuary net';
  };

  const handleCreateFolder = () => {
    if (isNetworkPath(currentPath)) return;
    try {
      let folderName = 'New Folder';
      let i = 1;
      while (vfs.exists(`${currentPath}/${folderName}`)) {
        i++;
        folderName = `New Folder (${i})`;
      }
      vfs.mkdir(`${currentPath}/${folderName}`);
    } catch (err: any) {
      alert(err.message || 'Failed to create folder');
    }
  };

  const handleCreateFile = () => {
    if (isNetworkPath(currentPath)) return;
    try {
      let fileName = 'New Text Document.txt';
      let i = 1;
      while (vfs.exists(`${currentPath}/${fileName}`)) {
        i++;
        fileName = `New Text Document (${i}).txt`;
      }
      vfs.writeFile(`${currentPath}/${fileName}`, '');
    } catch (err: any) {
      alert(err.message || 'Failed to create file');
    }
  };

  const handleDeleteSelected = () => {
    if (!selectedName || isNetworkPath(currentPath)) return;
    if (confirm(`Are you sure you want to delete "${selectedName}"?`)) {
      try {
        const fullPath = `${currentPath}/${selectedName}`;
        const item = items.find(i => i.name === selectedName);
        if (item) {
          if (item.type === 'dir') {
            vfs.rmdir(fullPath);
          } else {
            vfs.unlink(fullPath);
          }
        }
      } catch (err: any) {
        alert(err.message || 'Failed to delete item');
      }
    }
  };

  const handleSelectAll = () => {
    if (items.length > 0) {
      setSelectedName(items[0].name);
    }
  };

  const handleClose = () => {
    if (windowId) {
      closeWindow(windowId);
    }
  };

  const loadDirectory = (path: string) => {
    try {
      const dirItems = vfs.readdir(path);
      setItems(dirItems);
      setSelectedName(null);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to read directory');
    }
  };

  const navigateTo = (path: string) => {
    const cleanPath = path.replace(/\/+$/, '') || 'C:/';
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(cleanPath);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(cleanPath);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setCurrentPath(history[idx]);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setCurrentPath(history[idx]);
    }
  };

  const handleUp = () => {
    if (isNetworkPath(currentPath)) {
      navigateTo('C:/');
      return;
    }
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length <= 1) return; // Cannot go above C:
    const parentPath = parts.slice(0, -1).join('/');
    navigateTo(parentPath);
  };

  const handleItemDoubleClick = (item: VFSNode) => {
    const fullPath = `${currentPath}/${item.name}`;
    if (item.type === 'dir') {
      try {
        const contents = vfs.readdir(fullPath);
        if (contents.length === 0) {
          alert('This folder is empty. Conserving energy by not opening it.');
          return;
        }
      } catch (err) {
        // ignore
      }
      navigateTo(fullPath);
    } else {
      // Open file in associated app
      const ext = item.name.split('.').pop()?.toLowerCase();
      if (ext === 'txt') {
        openWindow({
          id: `notepad-${item.name.replace(/[^a-zA-Z0-9]/g, '-')}`,
          title: `${item.name} - Notepad`,
          appType: 'notepad',
          icon: '/images/icons/notepad-16x16.png',
          width: 480,
          height: 360,
          appProps: { filePath: fullPath },
        });
      } else if (ext === 'wav') {
        openWindow({
          id: `soundrec-${item.name.replace(/[^a-zA-Z0-9]/g, '-')}`,
          title: `${item.name} - Sound Recorder`,
          appType: 'soundrec',
          icon: '/images/icons/speaker-16x16.png',
          width: 280,
          height: 160,
          appProps: { filePath: fullPath },
        });
      } else {
        alert(`File content:\n\n${item.content || '[Empty]'}`);
      }
    }
  };

  const handleNetworkLinkDoubleClick = (link: NetworkLink) => {
    openWindow({
      id: `network-link-${link.id}`,
      title: `${link.title} - Internet Explorer`,
      appType: 'internet-explorer',
      icon: '/images/icons/internet-explorer-16x16.png',
      width: 900,
      height: 640,
      appProps: { src: link.url },
    });
  };

  const isNetHood = isNetworkPath(currentPath);

  return (
    <div className="explorer flex flex-col h-full bg-[#c0c0c0] text-black text-xs font-sans select-none">
      {/* Menus */}
      <div className="flex border-b border-gray-400 pb-[2px] px-1 select-none z-[1000]">
        <div className="group relative mr-2">
          <button className="px-2 py-[2px] hover:bg-[#000080] hover:text-white outline-none cursor-default">File</button>
          <div className="hidden group-hover:block absolute left-0 top-[19px] bg-[#c0c0c0] border-2 border-outset w-[120px] z-[1000] shadow text-black">
            <button onClick={handleCreateFolder} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs cursor-default">New Folder</button>
            <button onClick={handleCreateFile} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs cursor-default">New Document</button>
            <hr className="my-1 border-t border-gray-400 border-b border-white" />
            <button onClick={handleClose} disabled={!windowId} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs disabled:opacity-50 cursor-default">Close</button>
          </div>
        </div>

        <div className="group relative mr-2">
          <button className="px-2 py-[2px] hover:bg-[#000080] hover:text-white outline-none cursor-default">Edit</button>
          <div className="hidden group-hover:block absolute left-0 top-[19px] bg-[#c0c0c0] border-2 border-outset w-[100px] z-[1000] shadow text-black">
            <button onClick={handleSelectAll} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs cursor-default">Select All</button>
            <button onClick={handleDeleteSelected} disabled={!selectedName} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs disabled:opacity-50 cursor-default">Delete</button>
          </div>
        </div>

        <div className="group relative mr-2">
          <button className="px-2 py-[2px] hover:bg-[#000080] hover:text-white outline-none cursor-default">View</button>
          <div className="hidden group-hover:block absolute left-0 top-[19px] bg-[#c0c0c0] border-2 border-outset w-[100px] z-[1000] shadow text-black">
            <button onClick={() => { if (!isNetworkPath(currentPath)) loadDirectory(currentPath); }} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs cursor-default">Refresh</button>
          </div>
        </div>

        <span className="mr-3 px-2 py-[2px] cursor-default text-gray-500 opacity-60">Go</span>
        <span className="mr-3 px-2 py-[2px] cursor-default text-gray-500 opacity-60">Favorites</span>

        <div className="group relative">
          <button className="px-2 py-[2px] hover:bg-[#000080] hover:text-white outline-none cursor-default">Help</button>
          <div className="hidden group-hover:block absolute left-0 top-[19px] bg-[#c0c0c0] border-2 border-outset w-[140px] z-[1000] shadow text-black">
            <button onClick={() => alert('Windows 98 Explorer\nExact React Clone')} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-xs cursor-default">About Explorer</button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 p-1 bg-[#c0c0c0] border-b border-gray-400 select-none">
        <button
          onClick={handleBack}
          disabled={historyIndex === 0}
          className="flex items-center gap-1 px-2 py-1 border border-outset disabled:opacity-50 active:border-inset outline-none"
        >
          <img src="/images/icons/back-16x16.png" alt="" className="w-4 h-4 image-render-pixelated" />
          <span>Back</span>
        </button>
        <button
          onClick={handleForward}
          disabled={historyIndex >= history.length - 1}
          className="flex items-center gap-1 px-2 py-1 border border-outset disabled:opacity-50 active:border-inset outline-none"
        >
          <span>Forward</span>
          <img src="/images/icons/forward-16x16.png" alt="" className="w-4 h-4 image-render-pixelated" />
        </button>
        <button
          onClick={handleUp}
          className="flex items-center gap-1 px-2 py-1 border border-outset active:border-inset outline-none"
        >
          <img src="/images/icons/up-16x16.png" alt="" className="w-4 h-4 image-render-pixelated" />
          <span>Up</span>
        </button>
      </div>

      {/* Address Bar */}
      <div className="flex items-center gap-2 p-1 bg-[#c0c0c0] border-b border-gray-400">
        <span className="text-gray-700">Address</span>
        <input
          type="text"
          value={addressBarValue}
          onChange={(e) => setAddressBarValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              navigateTo(addressBarValue);
            }
          }}
          className="flex-1 px-1 bg-white border border-inset text-black outline-none font-mono"
          style={{ borderColor: '#808080 #fff #fff #808080' }}
        />
      </div>

      {/* Content Area */}
      {isNetHood ? (
        <div className="flex-1 bg-white flex overflow-hidden">
          {/* Left Info Panel */}
          <div className="w-[180px] bg-[#c0c0c0] p-4 flex flex-col justify-start border-r border-[#808080] select-none">
            <img src="/images/icons/network-32x32.png" alt="" className="w-12 h-12 image-render-pixelated" />
            <h1 className="text-xl font-bold font-sans mt-3 leading-tight break-words">Network<br />Neighborhood</h1>
            <div className="h-1 w-full mt-4 flex">
              <div className="w-1/4 bg-red-600 h-full"></div>
              <div className="w-1/4 bg-yellow-500 h-full"></div>
              <div className="w-1/4 bg-green-600 h-full"></div>
              <div className="w-1/4 bg-blue-600 h-full"></div>
            </div>
          </div>

          {/* Right Icons Grid */}
          <div className="flex-1 bg-white p-4 overflow-auto flex flex-wrap content-start gap-4">
            {NET_HOOD_LINKS.map((link) => {
              const isSelected = selectedName === link.id;
              return (
                <div
                  key={link.id}
                  onClick={() => setSelectedName(link.id)}
                  onDoubleClick={() => handleNetworkLinkDoubleClick(link)}
                  className={`flex flex-col items-center justify-center text-center cursor-default w-[75px] h-[75px] outline-none rounded p-1 select-none ${
                    isSelected ? 'bg-[#000080] text-white' : 'text-black'
                  }`}
                >
                  <img
                    src="/images/icons/network-32x32.png"
                    alt=""
                    className="w-8 h-8 select-none pointer-events-none image-render-pixelated"
                  />
                  <span
                    className="text-[11px] mt-1 px-1 break-all truncate max-w-full"
                    style={{
                      border: isSelected ? '1px dotted #ffffff' : '1px solid transparent',
                    }}
                  >
                    {link.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className="flex-1 bg-white p-4 overflow-auto flex flex-wrap content-start gap-4"
          style={{ fontSmooth: 'never', WebkitFontSmoothing: 'none' }}
        >
          {items.length === 0 ? (
            <div className="text-gray-500 italic p-4">This folder is empty.</div>
          ) : (
            items.map((item) => {
              const isSelected = selectedName === item.name;
              const ext = item.name.split('.').pop()?.toLowerCase();
              const icon =
                item.type === 'dir'
                  ? '/images/icons/folder-32x32.png'
                  : ext === 'txt'
                  ? '/images/icons/notepad-file-32x32.png'
                  : ext === 'wav'
                  ? '/images/icons/speaker-32x32.png'
                  : '/images/icons/folder-open-32x32.png';

              return (
                <div
                  key={item.name}
                  onClick={() => setSelectedName(item.name)}
                  onDoubleClick={() => handleItemDoubleClick(item)}
                  className={`flex flex-col items-center justify-center text-center cursor-default w-[75px] h-[75px] outline-none rounded p-1 select-none ${
                    isSelected ? 'bg-[#000080] text-white' : 'text-black'
                  }`}
                >
                  <img
                    src={icon}
                    alt=""
                    className="w-8 h-8 select-none pointer-events-none image-render-pixelated"
                  />
                  <span
                    className="text-[11px] mt-1 px-1 break-all truncate max-w-full"
                    style={{
                      border: isSelected ? '1px dotted #ffffff' : '1px solid transparent',
                    }}
                  >
                    {item.name}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default Explorer;
