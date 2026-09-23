import React, { useState, useEffect, useRef } from 'react';

export const SoundRecorder: React.FC = () => {
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playAudioRef = useRef<HTMLAudioElement | null>(null);
  const playIntervalRef = useRef<any>(null);

  // Set up static green line on canvas on mount
  useEffect(() => {
    drawStaticWave();
    return () => {
      cleanupAudio();
    };
  }, []);

  const drawStaticWave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  };

  const cleanupAudio = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) audioContextRef.current.close();
  };

  const handleRecord = async () => {
    if (isRecording) return;
    if (isPlaying) handleStop();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        setAudioBlob(blob);
        setLength(parseFloat((audioChunksRef.current.length * 0.1).toFixed(2)) || 5.0); // Simulated or real length
      };

      // Set up Audio Web Analyser for Waveform
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      setIsRecording(true);
      setPosition(0);
      mediaRecorder.start();

      drawLiveWave();
    } catch (err) {
      alert('Microphone access denied or unavailable. Simulating recording wave instead.');
      simulateRecording();
    }
  };

  const simulateRecording = () => {
    setIsRecording(true);
    setPosition(0);
    let sec = 0;
    const interval = setInterval(() => {
      sec += 0.1;
      setPosition(parseFloat(sec.toFixed(2)));
    }, 100);

    (window as any).simInterval = interval;

    // Simulate animated wave
    const drawSim = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < canvas.width; i++) {
        const amp = Math.sin(i * 0.1 + Date.now() * 0.02) * (Math.random() * 15 + 5);
        const y = canvas.height / 2 + amp;
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(drawSim);
    };
    drawSim();
  };

  const drawLiveWave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const analyser = analyserRef.current;
    if (!ctx || !analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      setPosition((prev) => parseFloat((prev + 0.01).toFixed(2)));
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
  };

  const handleStop = () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if ((window as any).simInterval) {
        clearInterval((window as any).simInterval);
      }
      setIsRecording(false);
      drawStaticWave();
    }

    if (isPlaying) {
      if (playAudioRef.current) {
        playAudioRef.current.pause();
      }
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
      setIsPlaying(false);
      drawStaticWave();
    }
  };

  const handlePlay = () => {
    if (isRecording || isPlaying) return;

    let targetUrl = '/audio/CHIMES.WAV'; // Fallback sample audio
    if (audioBlob) {
      targetUrl = URL.createObjectURL(audioBlob);
    }

    const audio = new Audio(targetUrl);
    playAudioRef.current = audio;
    setIsPlaying(true);
    setPosition(0);

    audio.play();

    // Track simulated progress & play audio visual effects on canvas
    const startPlayTime = Date.now();
    const duration = audioBlob ? length : 1.5; // Chimes length is around 1.5s
    setLength(duration);

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startPlayTime) / 1000;
      if (elapsed >= duration) {
        handleStop();
        setPosition(duration);
      } else {
        setPosition(parseFloat(elapsed.toFixed(2)));
      }
    }, 50);

    playIntervalRef.current = window.setInterval(() => {}, 1000); // dummy for hook
    clearInterval(playIntervalRef.current);
    playIntervalRef.current = interval;

    const drawPlayWave = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < canvas.width; i++) {
        // High frequency ripple playing wave
        const amp = Math.sin(i * 0.2 + Date.now() * 0.05) * (Math.random() * 10 + 2);
        const y = canvas.height / 2 + amp;
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.stroke();

      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(drawPlayWave);
      }
    };
    drawPlayWave();
  };

  const handleRewind = () => {
    handleStop();
    setPosition(0);
  };

  const handleFastForward = () => {
    handleStop();
    setPosition(length);
  };

  return (
    <div className="sound-recorder flex flex-col p-2 bg-[#c0c0c0] w-full h-full text-xs text-black select-none font-sans">
      {/* Menus */}
      <div className="flex border-b border-gray-400 pb-1 mb-2">
        <span className="mr-3 cursor-default hover:bg-[#000080] hover:text-white px-1">File</span>
        <span className="mr-3 cursor-default hover:bg-[#000080] hover:text-white px-1">Edit</span>
        <span className="mr-3 cursor-default hover:bg-[#000080] hover:text-white px-1">Effects</span>
        <span className="cursor-default hover:bg-[#000080] hover:text-white px-1">Help</span>
      </div>

      {/* Position Display Box */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-700">Position:</span>
          <span className="font-mono text-sm">{position.toFixed(2)} sec.</span>
        </div>
        <div className="flex flex-col text-right">
          <span className="text-[10px] text-gray-700">Length:</span>
          <span className="font-mono text-sm">{length.toFixed(2)} sec.</span>
        </div>
      </div>

      {/* Oscilloscope Green Line Canvas */}
      <div
        className="w-full flex-1 min-h-[50px] border-2 border-inset mb-3 bg-black flex justify-center items-center"
        style={{ borderColor: '#808080 #fff #fff #808080' }}
      >
        <canvas ref={canvasRef} width={260} height={56} className="w-full h-full" />
      </div>

      {/* Controls buttons row */}
      <div className="flex items-center justify-center gap-1 h-[34px]">
        {/* Rewind */}
        <button
          onClick={handleRewind}
          title="Rewind"
          className="w-10 h-8 border border-outset flex items-center justify-center bg-[#c0c0c0] active:border-inset outline-none"
        >
          <img src="/programs/sound-recorder/img/buttons.png" alt="" className="image-render-pixelated object-none" style={{ objectPosition: '0px 0px', width: '14px', height: '14px' }} />
        </button>

        {/* Fast Forward */}
        <button
          onClick={handleFastForward}
          title="Fast Forward"
          className="w-10 h-8 border border-outset flex items-center justify-center bg-[#c0c0c0] active:border-inset outline-none"
        >
          <img src="/programs/sound-recorder/img/buttons.png" alt="" className="image-render-pixelated object-none" style={{ objectPosition: '-15px 0px', width: '14px', height: '14px' }} />
        </button>

        {/* Play */}
        <button
          onClick={handlePlay}
          disabled={isRecording || isPlaying}
          title="Play"
          className="w-10 h-8 border border-outset flex items-center justify-center bg-[#c0c0c0] active:border-inset disabled:opacity-50 outline-none"
        >
          <img src="/programs/sound-recorder/img/buttons.png" alt="" className="image-render-pixelated object-none" style={{ objectPosition: '-30px 0px', width: '14px', height: '14px' }} />
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          disabled={!isRecording && !isPlaying}
          title="Stop"
          className="w-10 h-8 border border-outset flex items-center justify-center bg-[#c0c0c0] active:border-inset disabled:opacity-50 outline-none"
        >
          <img src="/programs/sound-recorder/img/buttons.png" alt="" className="image-render-pixelated object-none" style={{ objectPosition: '-45px 0px', width: '14px', height: '14px' }} />
        </button>

        {/* Record */}
        <button
          onClick={handleRecord}
          disabled={isRecording || isPlaying}
          title="Record"
          className="w-10 h-8 border border-outset flex items-center justify-center bg-[#c0c0c0] active:border-inset disabled:opacity-50 outline-none"
        >
          <img src="/programs/sound-recorder/img/buttons.png" alt="" className="image-render-pixelated object-none" style={{ objectPosition: '-60px 0px', width: '14px', height: '14px' }} />
        </button>
      </div>
    </div>
  );
};
export default SoundRecorder;
