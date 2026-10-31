// Darkroom Lite's renderer. Internet Explorer can't run WebGL, so the server opens this page in a headless browser
// (Edge on the home PC) and develops the picture here with the desktop Darkroom's own shaders: every look and effect
// matches, and new looks reach Lite without a second copy.
import {
  buildFx,
  DarkroomParams,
  DEFAULT_PARAMS,
  dims,
  drawFrame,
  FILM_GRAIN,
  Gl,
  initGl,
  PRESETS,
  skinCentre,
  Source,
} from './apps/darkroomGl';

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error("Couldn't read this picture"));
    img.src = src;
  });

const cv = document.createElement('canvas');
let gl: Gl | null = null;

/** The picture (a data: URL) through the look, at most `max` px on its long side, as a JPEG data: URL. */
async function develop(src: string, input: Partial<DarkroomParams>, max: number) {
  const p = { ...DEFAULT_PARAMS, ...input };
  const img = await load(src);
  const [w, h] = dims(img);
  const s = Math.min(1, max / Math.max(w, h));
  cv.width = Math.round(w * s);
  cv.height = Math.round(h * s);
  let source: Source = img;
  if (p.jpegQuality < 100 || p.resolution < 1) {
    // Crushed the way the desktop does it: a smaller, lower-quality JPEG, stretched back up by the GPU
    const c = document.createElement('canvas');
    c.width = Math.max(16, Math.round(cv.width * p.resolution));
    c.height = Math.max(16, Math.round(cv.height * p.resolution));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    source = await load(c.toDataURL('image/jpeg', Math.max(0.01, p.jpegQuality / 100)));
  }
  if (!gl) {
    const g = initGl(cv);
    if (typeof g === 'string') throw new Error(g);
    gl = g;
  }
  const { ctx } = gl;
  ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, source);
  ctx.viewport(0, 0, cv.width, cv.height);
  gl.fx = buildFx(ctx, gl.prog, gl.fx, cv.width, cv.height);
  drawFrame(gl, p, null, p.skinUniform ? skinCentre(img) : null);
  return cv.toDataURL('image/jpeg', 0.92);
}

Object.assign(window, { develop, darkroomLooks: { presets: PRESETS, filmGrain: FILM_GRAIN, defaults: DEFAULT_PARAMS } });
