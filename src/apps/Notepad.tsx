import React, { useState, useEffect } from 'react';
import { vfs } from '../vfs/fs';
import { useWindowManager } from '../wm/manager';

interface NotepadProps {
  filePath?: string;
}

export const Notepad: React.FC<NotepadProps> = ({ filePath: initialFilePath }) => {
  const { closeWindow } = useWindowManager();
  const [filePath, setFilePath] = useState<string | null>(initialFilePath || null);
  const [content, setContent] = useState('');
  const [statusText, setStatusText] = useState('Ln 1, Col 1');

  useEffect(() => {
    if (initialFilePath) {
      try {
        const txt = vfs.readFile(initialFilePath);
        setContent(txt);
        setFilePath(initialFilePath);
      } catch (err) {
        console.error('Failed to read notepad file:', err);
      }
    }
  }, [initialFilePath]);

  const handleNew = () => {
    setContent('');
    setFilePath(null);
  };

  const handleOpen = () => {
    const path = prompt('Enter file path to open (e.g. C:/Desktop/Welcome.txt):');
    if (path) {
      try {
        const txt = vfs.readFile(path);
        setContent(txt);
        setFilePath(path);
      } catch (err: any) {
        alert(err.message || 'File not found');
      }
    }
  };

  const handleSave = () => {
    if (filePath) {
      try {
        vfs.writeFile(filePath, content);
        alert(`Saved successfully to ${filePath}`);
      } catch (err: any) {
        alert(`Error: ${err.message}`);
      }
    } else {
      handleSaveAs();
    }
  };

  const handleSaveAs = () => {
    const path = prompt('Enter target path to save as:', filePath || 'C:/Desktop/untitled.txt');
    if (path) {
      try {
        vfs.writeFile(path, content);
        setFilePath(path);
        alert(`Saved successfully to ${path}`);
      } catch (err: any) {
        alert(`Error: ${err.message}`);
      }
    }
  };

  const insertDateTime = () => {
    const now = new Date();
    const formatted = now.toLocaleString();
    setContent((prev) => prev + formatted);
  };

  const updateCursorPos = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const textBeforeCursor = textarea.value.substring(0, textarea.selectionStart);
    const lines = textBeforeCursor.split('\n');
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length + 1;
    setStatusText(`Ln ${currentLine}, Col ${currentCol}`);
  };

  return (
    <div className="notepad flex flex-col h-full bg-[#c0c0c0] text-black text-xs font-sans select-text">
      {/* Menu Bar */}
      <div className="menus flex items-center bg-[#c0c0c0] px-1 border-b border-gray-400 select-none">
        <div className="group relative">
          <button className="menu-button px-2 py-1 hover:bg-[#000080] hover:text-white outline-none">File</button>
          <div className="hidden group-hover:block absolute left-0 top-[18px] bg-[#c0c0c0] border-2 border-outset w-[100px] z-[999] shadow">
            <button onClick={handleNew} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">New</button>
            <button onClick={handleOpen} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">Open...</button>
            <button onClick={handleSave} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">Save</button>
            <button onClick={handleSaveAs} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">Save As...</button>
            <hr className="my-1 border-t border-gray-400 border-b border-white" />
            <button onClick={() => closeWindow('notepad')} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">Exit</button>
          </div>
        </div>

        <div className="group relative">
          <button className="menu-button px-2 py-1 hover:bg-[#000080] hover:text-white outline-none">Edit</button>
          <div className="hidden group-hover:block absolute left-0 top-[18px] bg-[#c0c0c0] border-2 border-outset w-[120px] z-[999] shadow">
            <button onClick={() => setContent('')} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">Clear All</button>
            <button onClick={insertDateTime} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">Time/Date</button>
          </div>
        </div>

        <div className="group relative">
          <button className="menu-button px-2 py-1 hover:bg-[#000080] hover:text-white outline-none">Help</button>
          <div className="hidden group-hover:block absolute left-0 top-[18px] bg-[#c0c0c0] border-2 border-outset w-[120px] z-[999] shadow">
            <button onClick={() => alert(`Windows 98 Notepad\nExact React Clone`)} className="w-full text-left px-3 py-1 hover:bg-[#000080] hover:text-white">About Notepad</button>
          </div>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 p-1 bg-white relative">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyUp={updateCursorPos}
          onMouseUp={updateCursorPos}
          className="w-full h-full p-1 border-2 border-inset outline-none font-mono resize-none text-[12px] leading-tight select-text overflow-auto"
          style={{ borderColor: '#808080 #fff #fff #808080', fontSmooth: 'never', WebkitFontSmoothing: 'none' }}
        />
      </div>

      {/* Status Bar */}
      <div
        className="status-bar h-5 px-2 bg-[#c0c0c0] border-t border-gray-400 flex justify-end items-center text-[10px] text-gray-700 font-sans"
      >
        <div className="border-l border-gray-500 pl-2 h-4 flex items-center pr-4">
          {statusText}
        </div>
      </div>
    </div>
  );
};
export default Notepad;
