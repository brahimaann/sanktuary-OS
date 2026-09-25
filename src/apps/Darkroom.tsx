import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { fileUrl, shell, toolbar, button } from './TeamFiles';

/**
 * Darkroom: film looks for photos (bleach bypass and friends), done in one WebGL shader so sliders are instant
 * at full resolution. Opens a team photo (from File Preview) or a file from this computer; the result downloads
 * or is saved next to the original.
 */
interface Props {
  app?: string;
  dir?: string[];
  name?: string;
}
type Params = { look: number; amount: number; contrast: number; warmth: number; fade: number; vignette: number; grain: number };

const LOOKS: { name: string; p: Partial<Params> }[] = [
  { name: 'None', p: { amount: 0 } },
  { name: 'Bleach bypass', p: { amount: 1, contrast: 1.1, warmth: -0.2, vignette: 0.35, grain: 0.15 } },
  { name: 'Cross process', p: { amount: 0.9, contrast: 1.05, warmth: 0.1, vignette: 0.2, grain: 0.1 } },
  { name: 'Silver B&W', p: { amount: 1, contrast: 1.15, warmth: 0, vignette: 0.3, grain: 0.25 } },
  { name: 'Faded print', p: { amount: 1, contrast: 0.9, warmth: 0.3, fade: 0.4, vignette: 0.2, grain: 0.15 } },
  { name: 'Teal & orange', p: { amount: 0.8, contrast: 1.05, warmth: 0.1, vignette: 0.25, grain: 0.05 } },
];
const NEUTRAL: Params = { look: 0, amount: 0, contrast: 1, warmth: 0, fade: 0, vignette: 0, grain: 0 };
const SLIDERS: [keyof Params, string, number, number][] = [
  ['amount', 'Strength', 0, 1],
  ['contrast', 'Contrast', 0.5, 1.5],
  ['warmth', 'Warmth', -1, 1],
  ['fade', 'Fade', 0, 1],
  ['vignette', 'Vignette', 0, 1],
  ['grain', 'Grain', 0, 1],
];

const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = (p + 1.0) / 2.0; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision highp float;
uniform sampler2D img; uniform vec2 res; uniform int look;
uniform float amount, contrast, warmth, fade, vignette, grain;
varying vec2 uv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 overlay(vec3 a, vec3 b) { return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 o = texture2D(img, uv).rgb, c = o;
  if (look == 1) { vec3 b = overlay(c, vec3(luma(c))); c = mix(b, vec3(luma(b)), 0.45); c = (c - 0.5) * 1.15 + 0.5; } // silver left in: luminance over a drained colour
  else if (look == 2) c = vec3(smoothstep(0.05, 0.95, c.r), pow(c.g, 0.9) * 1.05, c.b * 0.7 + 0.12); // slide film in negative chemistry
  else if (look == 3) c = vec3(smoothstep(0.02, 0.98, luma(c)));
  else if (look == 4) { c = c * 0.85 + 0.08; c = mix(c, vec3(luma(c)), 0.25) * vec3(1.05, 1.0, 0.92); }
  else if (look == 5) c = mix(c, mix(vec3(0.0, 0.35, 0.45), vec3(1.0, 0.6, 0.3), luma(c)), 0.3);
  c = mix(o, c, amount);
  c = (c - 0.5) * contrast + 0.5;
  c *= vec3(1.0 + warmth * 0.1, 1.0, 1.0 - warmth * 0.1);
  c = c * (1.0 - fade * 0.3) + fade * 0.12;
  c *= 1.0 - vignette * smoothstep(0.3, 0.75, length(uv - 0.5) * 1.2);
  c += (hash(uv * res) - 0.5) * grain * 0.25;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Browsers decode these directly (full resolution); TIFF/PSD come through the server's preview
const NATIVE = /\.(jpe?g|png|webp|avif|gif)$/i;

const Darkroom: React.FC<Props> = ({ app, dir = [], name }) => {
  const { getToken } = useAuth();
  const canvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<{ ctx: WebGLRenderingContext; prog: WebGLProgram } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [title, setTitle] = useState(name || '');
  const [params, setParams] = useState<Params>({ ...NEUTRAL, ...LOOKS[1].p, look: 1 });
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState('');

  // A team photo passed in from File Preview
  useEffect(() => {
    if (!app || !name) return;
    let live = true;
    setStatus('Loading...');
    getToken().then((t) => {
      const i = new Image();
      i.onload = () => live && (setImg(i), setStatus(''));
      i.onerror = () => live && setStatus("Couldn't open this photo.");
      i.src = `${fileUrl(app, [...dir, name])}?t=${t}${NATIVE.test(name) ? '' : '&preview'}`;
    });
    return () => {
      live = false;
    };
  }, [app, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const openLocal = (f?: File) => {
    if (!f) return;
    const i = new Image();
    i.onload = () => (setImg(i), setTitle(f.name), setStatus(''));
    i.onerror = () => setStatus("That file isn't an image this browser can open.");
    i.src = URL.createObjectURL(f);
  };

  // Upload the photo as a texture (scaled down only if the graphics card can't hold it)
  useEffect(() => {
    const cv = canvas.current;
    if (!img || !cv) return;
    const ctx = cv.getContext('webgl', { preserveDrawingBuffer: true });
    if (!ctx) return setStatus("This browser can't run WebGL, which Darkroom needs.");
    const max = Math.min(ctx.getParameter(ctx.MAX_TEXTURE_SIZE), 8192);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    cv.width = Math.round(img.naturalWidth * scale);
    cv.height = Math.round(img.naturalHeight * scale);
    const prog = ctx.createProgram()!;
    for (const [type, src] of [
      [ctx.VERTEX_SHADER, VERT],
      [ctx.FRAGMENT_SHADER, FRAG],
    ] as const) {
      const s = ctx.createShader(type)!;
      ctx.shaderSource(s, src);
      ctx.compileShader(s);
      ctx.attachShader(prog, s);
    }
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) return setStatus('Graphics error: ' + ctx.getProgramInfoLog(prog));
    ctx.useProgram(prog);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
    ctx.enableVertexAttribArray(0);
    ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0);
    ctx.bindTexture(ctx.TEXTURE_2D, ctx.createTexture());
    ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true);
    for (const p of [ctx.TEXTURE_WRAP_S, ctx.TEXTURE_WRAP_T]) ctx.texParameteri(ctx.TEXTURE_2D, p, ctx.CLAMP_TO_EDGE);
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, img);
    ctx.viewport(0, 0, cv.width, cv.height);
    gl.current = { ctx, prog };
    if (scale < 1) setStatus(`Working at ${cv.width}×${cv.height} (the largest this graphics card takes).`);
  }, [img]);

  // Draw on every change; holding Compare shows the untouched photo
  useEffect(() => {
    if (!gl.current || !canvas.current) return;
    const { ctx, prog } = gl.current;
    const p = compare ? NEUTRAL : params;
    ctx.uniform2f(ctx.getUniformLocation(prog, 'res'), canvas.current.width, canvas.current.height);
    ctx.uniform1i(ctx.getUniformLocation(prog, 'look'), p.look);
    for (const k of ['amount', 'contrast', 'warmth', 'fade', 'vignette', 'grain'] as const)
      ctx.uniform1f(ctx.getUniformLocation(prog, k), p[k]);
    ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
  }, [img, params, compare]);

  const outName = `${title.replace(/\.[^.]+$/, '') || 'photo'} (${LOOKS[params.look].name}).jpg`;
  const toJpeg = () =>
    new Promise<Blob>((ok, no) => canvas.current!.toBlob((b) => (b ? ok(b) : no(new Error('Export failed'))), 'image/jpeg', 0.92));

  const download = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await toJpeg());
    a.download = outName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  // Next to the original, through the same upload as Team Files (the server checks upload rights)
  const saveToFolder = async () => {
    if (!app) return;
    setStatus('Saving...');
    try {
      const body = await toJpeg();
      const q = `upload=${crypto.randomUUID()}&chunks=1&size=${body.size}&chunkSize=${body.size}&chunk=0`;
      const res = await fetch(`${fileUrl(app, [...dir, outName])}?${q}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await getToken()}` },
        body,
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setStatus(`Saved "${outName}" in ${dir.join('/') || 'the top folder'}.`);
    } catch (e) {
      setStatus(`Not saved: ${(e as Error).message}`);
    }
  };

  const set = (k: keyof Params, v: number) => setParams((p) => ({ ...p, [k]: v }));
  return (
    <div style={shell}>
      <div style={toolbar}>
        <label style={{ ...button, cursor: 'default' }}>
          Open...
          <input type="file" accept="image/*" hidden onChange={(e) => openLocal(e.target.files?.[0])} />
        </label>
        <button
          style={button}
          disabled={!img}
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
        >
          Hold to compare
        </button>
        <button style={button} disabled={!img} onClick={download}>
          Download
        </button>
        {app && (
          <button style={button} disabled={!img} onClick={saveToFolder}>
            Save to folder
          </button>
        )}
        <span style={{ marginLeft: 6, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#808080',
            border: '2px inset #808080',
            margin: 2,
          }}
        >
          {img ? (
            <canvas ref={canvas} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <span style={{ color: '#fff' }}>Open a photo to start (or use Film look on a photo in Team Files).</span>
          )}
        </div>
        <div style={{ width: 170, padding: 6, display: 'flex', flexDirection: 'column', gap: 6, overflow: 'auto' }}>
          <fieldset style={{ border: '2px groove #fff', padding: 4 }}>
            <legend>Look</legend>
            {LOOKS.map((l, i) => (
              <label key={l.name} style={{ display: 'block', padding: '1px 0' }}>
                <input type="radio" name="look" checked={params.look === i} onChange={() => setParams({ ...NEUTRAL, ...l.p, look: i })} />{' '}
                {l.name}
              </label>
            ))}
          </fieldset>
          {SLIDERS.map(([k, label, min, max]) => (
            <label key={k} style={{ display: 'block' }}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={0.01}
                value={params[k]}
                onChange={(e) => set(k, +e.target.value)}
                style={{ width: '100%' }}
                disabled={!img}
              />
            </label>
          ))}
        </div>
      </div>
      <div style={{ padding: '2px 6px', borderTop: '1px solid #808080', minHeight: 16 }}>{status}</div>
    </div>
  );
};

export default Darkroom;
