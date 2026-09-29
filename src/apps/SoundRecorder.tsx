import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { sharedAudio } from '../utils/sound';
import { uploadFiles } from '../utils/upload';
import FilePicker from '../components/FilePicker';
import { saveToDevice } from './fileTypes';

/**
 * Sound Recorder, now a session recorder: record the mic (or camera + mic) in the browser, play it back, then save
 * it to a team folder (members) or to this device. What's recorded is the browser's own format (WebM / MP4),
 * named after the time it was made.
 */
type Mode = 'audio' | 'video';

// The first format this browser can record: Chrome/Firefox write WebM, Safari MP4
const pickType = (mode: Mode) =>
  (mode === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  ).find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || '';
const extFor = (type: string) =>
  type.includes('mp4') ? (type.startsWith('video') ? 'mp4' : 'm4a') : type.includes('ogg') ? 'ogg' : 'webm';
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const SoundRecorder: React.FC = () => {
  const { isSignedIn, getToken } = useAuth();
  const [mode, setMode] = useState<Mode>('audio');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [status, setStatus] = useState('Press ● to record.');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const startRef = useRef(0);

  const stopStream = () => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(
    () => () => {
      stopStream();
      if (recRef.current?.state === 'recording') recRef.current.stop();
    },
    [],
  );
  useEffect(() => () => void (take && URL.revokeObjectURL(take.url)), [take]);

  // Green oscilloscope line while recording (flat line otherwise)
  const draw = (analyser?: AnalyserNode) => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const data = new Uint8Array(analyser?.frequencyBinCount || 1);
    const frame = () => {
      analyser?.getByteTimeDomainData(data);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (!analyser) {
        ctx.moveTo(0, cv.height / 2);
        ctx.lineTo(cv.width, cv.height / 2);
      } else
        data.forEach((v, i) => {
          const x = (i / (data.length - 1)) * cv.width;
          const y = (v / 255) * cv.height;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
      ctx.stroke();
      if (startRef.current) setElapsed((Date.now() - startRef.current) / 1000);
      if (analyser) frameRef.current = requestAnimationFrame(frame);
    };
    frame();
  };
  useEffect(() => draw(), []);

  const record = async () => {
    const type = pickType(mode);
    if (!navigator.mediaDevices?.getUserMedia || !type) return setStatus("This browser can't record here.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        mode === 'video' ? { audio: true, video: { width: { ideal: 1920 }, height: { ideal: 1080 } } } : { audio: true },
      );
      streamRef.current = stream;
      if (mode === 'video' && liveRef.current) {
        liveRef.current.srcObject = stream;
        liveRef.current.play().catch(() => {});
      }
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: type });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || type });
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
        setTake({ blob, url: URL.createObjectURL(blob), name: `Session ${stamp}.${extFor(blob.type)}` });
        setStatus(`Recorded ${clock((Date.now() - startRef.current) / 1000)}. Play it back, then save it.`);
        startRef.current = 0;
      };
      recRef.current = rec;
      rec.start(1000); // a chunk a second, so a long take isn't one giant buffer at the end
      startRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      setTake(null);
      setStatus(mode === 'video' ? 'Recording camera + mic...' : 'Recording...');
      const audio = sharedAudio();
      if (audio) {
        const analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        audio.createMediaStreamSource(stream).connect(analyser);
        draw(analyser);
      }
    } catch (e) {
      stopStream();
      setStatus(
        (e as Error).name === 'NotAllowedError'
          ? 'Allow the microphone (and camera) for this site, then try again.'
          : "Couldn't start recording.",
      );
    }
  };

  const stop = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop();
    stopStream();
    if (liveRef.current) liveRef.current.srcObject = null;
    setRecording(false);
    draw();
  };

  const saveTo = async (space: string, dir: string[]) => {
    if (!take) return;
    setSaving(0);
    try {
      const [name] = await uploadFiles(getToken, space, dir, [{ file: take.blob, name: take.name }], (sent, total) =>
        setSaving(Math.round((sent / total) * 100)),
      );
      setStatus(`Saved "${name}" in ${[space, ...dir].join(' / ')}.`);
    } catch (e) {
      setStatus(`Couldn't save: ${(e as Error).message}`);
    }
    setSaving(null);
  };

  const btn = 'h-8 px-2 border-2 bg-[#c0c0c0] disabled:opacity-50 outline-none';
  const outset = { borderColor: '#fff #808080 #808080 #fff' };
  return (
    <div className="sound-recorder flex flex-col gap-2 p-2 bg-[#c0c0c0] w-full h-full text-xs text-black select-none font-sans">
      <div className="flex items-center gap-3">
        {(['audio', 'video'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input type="radio" checked={mode === m} disabled={recording} onChange={() => setMode(m)} />
            {m === 'audio' ? 'Mic only' : 'Camera + mic'}
          </label>
        ))}
        <span className="ml-auto font-mono text-sm">{clock(recording ? elapsed : 0)}</span>
      </div>

      {mode === 'video' && (recording || !take) && (
        <video ref={liveRef} muted playsInline className="w-full bg-black" style={{ maxHeight: 220 }} />
      )}
      {take &&
        !recording &&
        (take.blob.type.startsWith('video') ? (
          <video src={take.url} controls playsInline className="w-full bg-black" style={{ maxHeight: 220 }} />
        ) : (
          <audio src={take.url} controls className="w-full" />
        ))}
      {!take || recording ? (
        <div className="w-full min-h-[50px] flex-1 border-2 bg-black" style={{ borderColor: '#808080 #fff #fff #808080' }}>
          <canvas ref={canvasRef} width={260} height={56} className="w-full h-full" />
        </div>
      ) : null}

      <div className="flex items-center justify-center gap-1 flex-wrap">
        <button
          className={btn}
          style={{ ...outset, color: '#a00000', fontWeight: 700 }}
          disabled={recording}
          onClick={record}
          title="Record"
        >
          ● Record
        </button>
        <button className={btn} style={outset} disabled={!recording} onClick={stop} title="Stop">
          ■ Stop
        </button>
        {take && !recording && (
          <>
            <button className={btn} style={outset} onClick={() => saveToDevice(take.blob, take.name)}>
              Download
            </button>
            {isSignedIn && (
              <button className={btn} style={{ ...outset, fontWeight: 700 }} disabled={saving !== null} onClick={() => setPicking(true)}>
                {saving !== null ? `Saving ${saving}%` : 'Save to team folder...'}
              </button>
            )}
          </>
        )}
      </div>
      <div className="text-[11px] text-gray-800">{status}</div>
      {picking && (
        <FilePicker
          title="Save the take in..."
          mode="folder"
          onPick={(r) => {
            setPicking(false);
            if (r) saveTo(r.space, r.path.split('/').filter(Boolean));
          }}
        />
      )}
    </div>
  );
};
export default SoundRecorder;
