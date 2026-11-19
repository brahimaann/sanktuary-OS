// Renders ops/formats/formats.tsx without raea: a small stand-in for the raea calls it uses, drawn frame by frame in
// Chromium (Playwright) with a transparent background, then encoded with ffmpeg. Same idea as ops/intro/render.mjs.
//
//   node ops/formats/render.mjs field-op                          -> out/formats/field-op.webm (VP9 with alpha)
//   node ops/formats/render.mjs all --prores                      -> every piece, plus a ProRes 4444 .mov for editors
//   node ops/formats/render.mjs field-op --set code=FO-002 --set "title=New Song" --set date=12.01.26
//   node ops/formats/render.mjs field-op --still 70 --on photo.jpg -> one frame as PNG over a picture (a preview)
//   --out DIR changes where files go.
// Needs esbuild (comes with vite), react, playwright and ffmpeg.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(0, 9)
      .join('\n'),
  );
  process.exit(0);
}
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const sets = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === '--set' ? [[a.split('=')[0], a.slice(a.indexOf('=') + 1)]] : [])));
const out = resolve(opt('--out') || join(root, 'out/formats'));
const still = opt('--still');
const backdrop = opt('--on');

const shim = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
let frame = 0;
export const useCurrentFrame = () => frame;
export const AbsoluteFill = ({ style, children }) => React.createElement('div', { style: { position: 'absolute', inset: 0, ...style } }, children);
export const Composition = () => null;
export const loadFont = (family) => ({ fontFamily: "'" + family + "'" });
export function registerRoot(Root) {
  const comps = {};
  React.Children.forEach(Root().props.children, (c) => c && (comps[c.props.id] = c.props));
  const root = createRoot(document.getElementById('root'));
  window.__comps = Object.fromEntries(Object.entries(comps).map(([id, c]) => [id, { width: c.width, height: c.height, fps: c.fps, frames: c.durationInFrames }]));
  window.__draw = (id, f, props) => { frame = f; const c = comps[id]; flushSync(() => root.render(React.createElement(c.component, { ...c.defaultProps, ...props }))); };
}`;

const { outputFiles } = await build({
  entryPoints: [join(here, 'formats.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [join(root, 'node_modules')],
  plugins: [
    {
      name: 'raea',
      setup(b) {
        b.onResolve({ filter: /^raea(\/text)?$/ }, () => ({ path: 'raea', namespace: 'raea' }));
        b.onLoad({ filter: /.*/, namespace: 'raea' }, () => ({ contents: shim, loader: 'js', resolveDir: here }));
      },
    },
  ],
});

// The app's own copies of the two fonts raea loads from Google Fonts
const font = (family, file) =>
  `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${readFileSync(join(root, 'public/font', file)).toString('base64')}) format('woff2')}`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(
  `<style>${font('Silkscreen', 'silkscreen/silkscreen-latin.woff2')}${font('Pixelify Sans', 'pixelify-sans/pixelify-sans-latin.woff2')}
  html,body{margin:0;background:transparent}#root{position:relative;overflow:hidden}</style><div id="root"></div>`,
);
await page.addScriptTag({ content: outputFiles[0].text });
await page.evaluate(() => document.fonts.ready);
const comps = await page.evaluate(() => window.__comps);
const ids = args[0] === 'all' ? Object.keys(comps) : [args[0]];
mkdirSync(out, { recursive: true });

for (const id of ids) {
  const c = comps[id];
  if (!c) throw new Error(`No composition "${id}". There are: ${Object.keys(comps).join(', ')}`);
  await page.setViewportSize({ width: c.width, height: c.height });
  await page.evaluate(
    ([w, h]) => Object.assign(document.getElementById('root').style, { width: w + 'px', height: h + 'px' }),
    [c.width, c.height],
  );
  if (still) {
    await page.evaluate(([id, f, p]) => window.__draw(id, f, p), [id, +still, sets]);
    await page.evaluate(() => document.fonts.ready);
    const png = join(out, `${id}-${still}.png`);
    await page.screenshot({ path: png, omitBackground: true });
    if (backdrop) {
      // The overlay over a picture, cropped to fill the frame like footage would
      const scaled = `scale=${c.width}:${c.height}:force_original_aspect_ratio=increase,crop=${c.width}:${c.height}`;
      execFileSync('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-i',
        backdrop,
        '-i',
        png,
        '-filter_complex',
        `[0]${scaled}[bg];[bg][1]overlay`,
        png.replace(/\.png$/, '-on.png'),
      ]);
    }
    console.log(png);
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), `${id}-`));
  for (let f = 0; f < c.frames; f++) {
    await page.evaluate(([id, f, p]) => window.__draw(id, f, p), [id, f, sets]);
    await page.screenshot({ path: join(dir, `${String(f).padStart(4, '0')}.png`), omitBackground: true });
  }
  const ff = (...a) =>
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(c.fps), '-i', join(dir, '%04d.png'), ...a], { stdio: 'inherit' });
  ff('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-an', join(out, `${id}.webm`));
  if (args.includes('--prores')) ff('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-an', join(out, `${id}.mov`));
  console.log(join(out, `${id}.webm`));
}
await browser.close();
