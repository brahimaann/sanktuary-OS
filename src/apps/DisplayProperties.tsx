import React, { useState } from 'react';
import { useWindowManager, ScreensaverType } from '../wm/manager';

export const DisplayProperties: React.FC = () => {
  const {
    wallpaper,
    bgColor,
    setWallpaper,
    setBgColor,
    closeWindow,
    screensaver,
    screensaverTimeout,
    setScreensaver,
    setScreensaverTimeout,
    setScreensaverActive,
  } = useWindowManager();
  const [activeTab, setActiveTab] = useState<'background' | 'screensaver'>('background');
  
  // Local modifications before Apply/OK
  const [selectedWallpaper, setSelectedWallpaper] = useState(wallpaper);
  const [selectedBgColor, setSelectedBgColor] = useState(bgColor);
  const [selectedScreensaver, setSelectedScreensaver] = useState<ScreensaverType>(screensaver);
  const [selectedTimeout, setSelectedTimeout] = useState<number>(screensaverTimeout);

  const wallpapers = [
    { name: '(None) - Teal', file: '', color: '#008080' },
    { name: '(None) - Windows Blue', file: '', color: '#000080' },
    { name: 'Clouds', file: '/images/clouds.jpg', color: '#008080' },
    { name: '3D Blocks', file: '/images/3d.jpg', color: '#008080' },
  ];

  const handleApply = () => {
    setWallpaper(selectedWallpaper);
    setBgColor(selectedBgColor);
    setScreensaver(selectedScreensaver);
    setScreensaverTimeout(selectedTimeout);
  };

  const handleOK = () => {
    handleApply();
    closeWindow('display-properties');
  };

  const handleCancel = () => {
    closeWindow('display-properties');
  };

  return (
    <div className="display-properties bg-[#c0c0c0] w-full h-full p-2 flex flex-col justify-between font-sans text-xs select-none text-black">
      {/* Tabs */}
      <div className="flex border-b border-white pr-4">
        <button
          onClick={() => setActiveTab('background')}
          className={`px-3 py-1 border-t border-x rounded-t cursor-default outline-none ${
            activeTab === 'background'
              ? 'bg-[#c0c0c0] border-white font-bold -mb-[1px] z-10'
              : 'bg-[#d0d0d0] border-transparent text-gray-600'
          }`}
          style={{
            borderTopColor: activeTab === 'background' ? '#fff' : 'transparent',
            borderLeftColor: activeTab === 'background' ? '#fff' : 'transparent',
            borderRightColor: activeTab === 'background' ? '#808080' : 'transparent',
          }}
        >
          Background
        </button>
        <button
          onClick={() => setActiveTab('screensaver')}
          className={`px-3 py-1 border-t border-x rounded-t cursor-default outline-none ${
            activeTab === 'screensaver'
              ? 'bg-[#c0c0c0] border-white font-bold -mb-[1px] z-10'
              : 'bg-[#d0d0d0] border-transparent text-gray-600'
          }`}
          style={{
            borderTopColor: activeTab === 'screensaver' ? '#fff' : 'transparent',
            borderLeftColor: activeTab === 'screensaver' ? '#fff' : 'transparent',
            borderRightColor: activeTab === 'screensaver' ? '#808080' : 'transparent',
          }}
        >
          Screen Saver
        </button>
        <button className="px-3 py-1 bg-[#d0d0d0] text-gray-500 border-t border-x rounded-t cursor-default opacity-60 outline-none">
          Appearance
        </button>
        <button className="px-3 py-1 bg-[#d0d0d0] text-gray-500 border-t border-x rounded-t cursor-default opacity-60 outline-none">
          Settings
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 border-x border-b border-white bg-[#c0c0c0] p-3 flex flex-col gap-3">
        {activeTab === 'background' && (
          <>
            {/* Monitor Preview Screen */}
            <div className="flex justify-center">
              <div className="w-[120px] h-[90px] bg-[#3a3a3a] border-4 border-[#808080] rounded p-1 shadow-inner flex justify-center items-center relative">
                {/* Desktop Preview inside miniature monitor */}
                <div
                  className="w-full h-full border border-black overflow-hidden flex justify-center items-center"
                  style={{
                    backgroundColor: selectedBgColor,
                    backgroundImage: selectedWallpaper ? `url(${selectedWallpaper})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {/* Miniature Icons representation */}
                  <div className="absolute top-2 left-2 w-2 h-2 bg-blue-900 border border-white opacity-40"></div>
                  <div className="absolute top-5 left-2 w-2 h-2 bg-blue-900 border border-white opacity-40"></div>
                  <div className="absolute top-2 left-5 w-4 h-2 bg-gray-400 opacity-40 rounded"></div>
                </div>
              </div>
            </div>

            {/* Selection Area */}
            <div className="flex-1 flex flex-col gap-1">
              <span>Select a background wallpaper or color:</span>
              <div
                className="flex-1 bg-white border-2 border-inset overflow-y-auto min-h-[90px]"
                style={{ borderColor: '#808080 #fff #fff #808080' }}
              >
                {wallpapers.map((wp) => {
                  const isSelected = selectedWallpaper === wp.file && (wp.file !== '' || selectedBgColor === wp.color);
                  return (
                    <div
                      key={wp.name}
                      onClick={() => {
                        setSelectedWallpaper(wp.file);
                        setSelectedBgColor(wp.color);
                      }}
                      className={`px-2 py-1 cursor-default ${
                        isSelected ? 'bg-[#000080] text-white' : 'hover:bg-gray-200'
                      }`}
                    >
                      {wp.name}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'screensaver' && (
          <div className="flex-1 flex flex-col justify-between">
            {/* Miniature Monitor Preview */}
            <div className="flex justify-center">
              <div className="w-[120px] h-[90px] bg-[#3a3a3a] border-4 border-[#808080] rounded p-1 shadow-inner flex justify-center items-center relative overflow-hidden">
                <div className="w-full h-full border border-black bg-black flex justify-center items-center text-center">
                  {selectedScreensaver === 'pipes' ? (
                    <span className="text-[10px] text-green-400 font-mono">3D PIPES</span>
                  ) : selectedScreensaver === 'starfield' ? (
                    <span className="text-[10px] text-white font-mono">★ · . * .</span>
                  ) : (
                    <span className="text-[10px] text-gray-500 font-sans">(None)</span>
                  )}
                </div>
              </div>
            </div>

            {/* Screen Saver Controls Box */}
            <fieldset
              className="border p-2 flex flex-col gap-2"
              style={{ borderColor: '#808080' }}
            >
              <legend className="px-1 text-black font-semibold">Screen Saver</legend>
              <div className="flex items-center gap-2">
                <select
                  value={selectedScreensaver}
                  onChange={(e) => setSelectedScreensaver(e.target.value as ScreensaverType)}
                  className="flex-1 bg-white border border-gray-600 px-1 py-0.5 text-xs outline-none"
                >
                  <option value="pipes">3D Pipes</option>
                  <option value="starfield">Starfield Simulation</option>
                  <option value="none">(None)</option>
                </select>
                <button
                  type="button"
                  disabled={selectedScreensaver === 'none'}
                  onClick={() => setScreensaverActive(true)}
                  className="px-3 py-0.5 bg-[#c0c0c0] border border-t-white border-l-white border-r-gray-800 border-b-gray-800 active:border-t-gray-800 active:border-l-gray-800 active:border-r-white active:border-b-white text-xs disabled:opacity-50"
                >
                  Preview
                </button>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <label className="text-black">Wait:</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={selectedTimeout}
                  onChange={(e) => setSelectedTimeout(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-14 bg-white border border-gray-600 px-1 py-0.5 text-xs text-center"
                />
                <span className="text-black">minutes</span>
              </div>
            </fieldset>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={handleOK}
          className="w-[65px] h-[22px] border border-outset bg-[#c0c0c0] active:border-inset outline-none flex items-center justify-center"
        >
          OK
        </button>
        <button
          onClick={handleCancel}
          className="w-[65px] h-[22px] border border-outset bg-[#c0c0c0] active:border-inset outline-none flex items-center justify-center"
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="w-[65px] h-[22px] border border-outset bg-[#c0c0c0] active:border-inset outline-none flex items-center justify-center"
        >
          Apply
        </button>
      </div>
    </div>
  );
};

export default DisplayProperties;
