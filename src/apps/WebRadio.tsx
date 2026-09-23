import React, { useState, useEffect, useRef } from 'react';

interface RadioTrack {
  title: string;
  artist: string;
  url: string;
}

const RADIO_TRACKS: RadioTrack[] = [
  { title: 'Yellow Diamonds (Demo)', artist: 'mrnd', url: '/audio/yellow_diamonds_demo.wav' },
  { title: 'Trophies', artist: 'Drake', url: '/audio/drake_trophies.wav' },
  { title: 'Windows 98 Sound (Lofi Ambient)', artist: 'retro', url: '/audio/The Microsoft Sound.wav' },
  { title: 'Classic Tada (Retro Synth)', artist: 'Windows 98', url: '/audio/TADA.WAV' },
  { title: 'Chord Chill', artist: 'Windows 98', url: '/audio/CHORD.WAV' },
];

export const WebRadio: React.FC = () => {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  
  // Simulated visualizer heights
  const [visualizerHeights, setVisualizerHeights] = useState<number[]>([10, 10, 10, 10, 10, 10, 10, 10]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentTrack = RADIO_TRACKS[currentTrackIndex];

  useEffect(() => {
    audioRef.current = new Audio(currentTrack.url);
    audioRef.current.volume = volume;

    const onTimeUpdate = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    };

    const onLoadedMetadata = () => {
      if (audioRef.current) {
        setDuration(audioRef.current.duration);
      }
    };

    const onEnded = () => {
      handleNext();
    };

    audioRef.current.addEventListener('timeupdate', onTimeUpdate);
    audioRef.current.addEventListener('loadedmetadata', onLoadedMetadata);
    audioRef.current.addEventListener('ended', onEnded);

    if (isPlaying) {
      audioRef.current.play().catch(e => console.log('Audio playback failed', e));
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeEventListener('timeupdate', onTimeUpdate);
        audioRef.current.removeEventListener('loadedmetadata', onLoadedMetadata);
        audioRef.current.removeEventListener('ended', onEnded);
        audioRef.current = null;
      }
    };
  }, [currentTrackIndex]);

  // Audio volume sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Visualizer bar animation when playing
  useEffect(() => {
    if (!isPlaying) {
      setVisualizerHeights([2, 2, 2, 2, 2, 2, 2, 2]);
      return;
    }

    const interval = setInterval(() => {
      setVisualizerHeights(
        Array.from({ length: 8 }, () => Math.floor(Math.random() * 28) + 4)
      );
    }, 120);

    return () => clearInterval(interval);
  }, [isPlaying]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(e => console.log('Audio playback failed', e));
      setIsPlaying(true);
    }
  };

  const handleNext = () => {
    setIsPlaying(true);
    setCurrentTrackIndex((prev) => (prev + 1) % RADIO_TRACKS.length);
  };

  const handlePrev = () => {
    setIsPlaying(true);
    setCurrentTrackIndex((prev) => (prev - 1 + RADIO_TRACKS.length) % RADIO_TRACKS.length);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="web-radio bg-[#c0c0c0] w-full h-full p-2 flex flex-col justify-between font-sans text-xs select-none text-black">
      {/* Upper Display Box */}
      <div
        className="bg-[#000000] text-[#00ff00] p-2 font-mono flex flex-col justify-between border-2 border-inset rounded h-[90px]"
        style={{ borderColor: '#808080 #fff #fff #808080' }}
      >
        <div className="flex justify-between items-start">
          <div className="truncate flex-1 pr-2">
            <div className="text-[10px] text-gray-500 uppercase">Current Station: MRND FM</div>
            <div className="text-sm font-bold truncate mt-1">{currentTrack.title}</div>
            <div className="text-xs text-green-400 mt-1">by {currentTrack.artist}</div>
          </div>

          {/* Retro green bar Equalizer Visualizer */}
          <div className="flex items-end gap-[2px] h-[35px] w-[50px] border-b border-green-900 pb-[1px] select-none">
            {visualizerHeights.map((h, i) => (
              <div
                key={i}
                className="bg-[#00ff00] w-[4px]"
                style={{ height: `${h}px` }}
              ></div>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] text-green-400 border-t border-green-950 pt-1">
          <span>{isPlaying ? 'PLAYING ▮' : 'PAUSED █'}</span>
          <span>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Progress Slider */}
      <div className="flex items-center gap-2 my-2">
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleTimeChange}
          className="flex-1 accent-blue-900 cursor-pointer h-1 rounded"
        />
      </div>

      {/* Controls Area */}
      <div className="flex gap-2 items-center flex-1 justify-between select-none">
        {/* Buttons */}
        <div className="flex gap-1">
          <button
            onClick={handlePrev}
            className="w-[32px] h-[25px] border border-outset bg-[#c0c0c0] active:border-inset outline-none font-bold"
          >
            |&lt;
          </button>
          <button
            onClick={handlePlayPause}
            className="w-[48px] h-[25px] border border-outset bg-[#c0c0c0] active:border-inset outline-none font-bold"
          >
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <button
            onClick={handleNext}
            className="w-[32px] h-[25px] border border-outset bg-[#c0c0c0] active:border-inset outline-none font-bold"
          >
            &gt;|
          </button>
        </div>

        {/* Volume slider */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-700">VOL:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-[60px] cursor-pointer"
          />
        </div>
      </div>

      {/* Playlist Selector List */}
      <div className="mt-2 flex-1 flex flex-col">
        <span className="text-gray-700 font-bold mb-1">Station Playlist:</span>
        <div
          className="flex-1 bg-white border-2 border-inset overflow-y-auto h-[100px]"
          style={{ borderColor: '#808080 #fff #fff #808080' }}
        >
          {RADIO_TRACKS.map((track, i) => {
            const isCurrent = currentTrackIndex === i;
            return (
              <div
                key={track.title}
                onClick={() => {
                  setCurrentTrackIndex(i);
                  setIsPlaying(true);
                }}
                className={`px-2 py-1 cursor-default flex justify-between ${
                  isCurrent ? 'bg-[#000080] text-white font-bold' : 'hover:bg-gray-200'
                }`}
              >
                <span>{track.title}</span>
                <span className="opacity-60">{track.artist}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WebRadio;
