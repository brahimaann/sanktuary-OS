// Renders sanktuary-intro.tsx without raea: a tiny stand-in for the few raea calls it uses, drawn frame by
// frame in Chromium (Playwright) with a transparent background, then encoded with ffmpeg.
//   node ops/intro/render.mjs            -> public/intro/sanktuary-intro.webm (VP9 with alpha) + .mp4 (on black)
//   node ops/intro/render.mjs --prores   -> also sanktuary-intro.mov (ProRes 4444 with alpha, for editors)
// Needs esbuild (comes with vite), react, playwright and ffmpeg.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../public/intro');
const shim = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
let frame = 0;
export const useCurrentFrame = () => frame;
export const AbsoluteFill = ({ style, children }) => React.createElement('div', { style: { position: 'absolute', inset: 0, ...style } }, children);
export const Composition = () => null;
export function interpolate(x, inp, outp, o = {}) {
  if (x <= inp[0] && o.extrapolateLeft === 'clamp') return outp[0];
  if (x >= inp[inp.length - 1] && o.extrapolateRight === 'clamp') return outp[outp.length - 1];
  let i = 1;
  while (i < inp.length - 1 && x > inp[i]) i++;
  return outp[i - 1] + ((x - inp[i - 1]) / (inp[i] - inp[i - 1])) * (outp[i] - outp[i - 1]);
}
export function registerRoot(fn) {
  const c = fn().props;
  const root = createRoot(document.getElementById('root'));
  window.__comp = { width: c.width, height: c.height, fps: c.fps, frames: c.durationInFrames };
  window.__draw = (f) => { frame = f; flushSync(() => root.render(React.createElement(c.component))); };
}`;

const { outputFiles } = await build({
  entryPoints: [join(here, 'sanktuary-intro.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [join(here, '../../node_modules')],
  plugins: [
    {
      name: 'raea',
      setup(b) {
        b.onResolve({ filter: /^raea$/ }, () => ({ path: 'raea', namespace: 'raea' }));
        b.onLoad({ filter: /.*/, namespace: 'raea' }, () => ({ contents: shim, loader: 'js', resolveDir: here }));
      },
    },
  ],
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(
  '<style>html,body{margin:0;background:transparent}#root{position:relative;width:1280px;height:720px}</style><div id="root"></div>',
);
await page.addScriptTag({ content: outputFiles[0].text });
const { width, height, fps, frames } = await page.evaluate(() => window.__comp);
await page.setViewportSize({ width, height });
const dir = mkdtempSync(join(tmpdir(), 'intro-'));
for (let f = 0; f < frames; f++) {
  await page.evaluate((n) => window.__draw(n), f);
  await page.screenshot({ path: join(dir, `${String(f).padStart(4, '0')}.png`), omitBackground: true });
}
await browser.close();

mkdirSync(out, { recursive: true });
const seq = ['-y', '-v', 'error', '-framerate', String(fps), '-i', join(dir, '%04d.png')];
const ff = (...a) => execFileSync('ffmpeg', [...seq, ...a], { stdio: 'inherit' });
ff('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-an', join(out, 'sanktuary-intro.webm'));
ff(
  '-filter_complex',
  `color=black:s=${width}x${height}:r=${fps}[bg];[bg][0]overlay=shortest=1,format=yuv420p`,
  '-c:v',
  'libx264',
  '-crf',
  '20',
  '-movflags',
  '+faststart',
  '-an',
  join(out, 'sanktuary-intro.mp4'),
);
if (process.argv.includes('--prores')) {
  ff('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-an', join(out, 'sanktuary-intro.mov'));
}
console.log(`frames in ${dir}, videos in ${out}`);
