// Captions drawn onto a canvas: Darkroom's text overlays and the video editor's lyrics and title cards use the same
// drawing, so what the editor previews is exactly what gets rendered.

/**
 * How a caption is laid out (from lyric videos and 2012-era edits):
 * plain: one line; grid: words spaced out in even columns, row by row; stacked: one huge word per line filling
 * the width; soft: a small, slightly blurred line (white on black cards); brat: the lime "brat" cover card.
 */
export type TextStyle = 'plain' | 'grid' | 'stacked' | 'soft' | 'brat';
export const TEXT_STYLES: [TextStyle, string][] = [
  ['plain', 'Plain'],
  ['grid', 'Word grid'],
  ['stacked', 'Big stacked'],
  ['soft', 'Soft'],
  ['brat', 'brat card'],
];

export interface TextOverlayItem {
  id: string;
  text: string;
  fontSize: number;
  color: string;
  fontFamily: string;
  align: 'left' | 'center' | 'right';
  xPercent: number;
  yPercent: number;
  shadow: boolean;
  style?: TextStyle; // how the words are laid out (plain line if missing)
}

/** Draws one caption onto a W×H canvas (sizes are relative, so it looks the same at any resolution). */
export function drawText(ctx: CanvasRenderingContext2D, txt: TextOverlayItem, W: number, H: number) {
  if (!txt.text.trim()) return;
  const scale = Math.min(W, H) / 1000;
  const size = Math.max(12, Math.round(txt.fontSize * scale));
  const tx = (txt.xPercent / 100) * W;
  const ty = (txt.yPercent / 100) * H;
  const put = (t: string, x: number, y: number) => {
    if (txt.shadow) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillText(t, x + 3 * scale, y + 3 * scale);
    }
    ctx.fillStyle = txt.color;
    ctx.fillText(t, x, y);
  };
  ctx.save();
  ctx.textBaseline = 'middle';
  const style = txt.style || 'plain';
  const words = txt.text.trim().split(/\s+/);
  if (style === 'brat') {
    // the brat cover: the whole frame lime green, lowercase narrow type, stretched wide and a little out of focus
    ctx.fillStyle = '#8ace00';
    ctx.fillRect(0, 0, W, H);
    const t = txt.text.trim().toLowerCase();
    ctx.font = `100px "Arial Narrow", Arial, sans-serif`;
    const big = Math.min((100 * W * 0.8) / (ctx.measureText(t).width * 1.25), H * 0.18);
    ctx.font = `${Math.round(big)}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = big / 12;
    ctx.translate(W / 2, ty);
    ctx.scale(1.25, 1);
    ctx.fillText(t, 0, 0);
  } else if (style === 'grid') {
    // three even columns, words left-aligned in them, the block centred on the chosen height
    const cols = 3;
    const colW = (W * 0.84) / cols;
    const lineH = size * 1.12;
    const rows = Math.ceil(words.length / cols);
    ctx.font = `${size}px "${txt.fontFamily}", Arial, sans-serif`;
    ctx.textAlign = 'left';
    words.forEach((w, i) => put(w, W * 0.08 + (i % cols) * colW, ty + (Math.floor(i / cols) - (rows - 1) / 2) * lineH));
  } else if (style === 'stacked') {
    // one word per line, as big as the widest word allows across 90% of the width
    ctx.font = `bold 100px "${txt.fontFamily}", Arial, sans-serif`;
    const widest = Math.max(...words.map((w) => ctx.measureText(w).width));
    const big = Math.min((100 * W * 0.9) / widest, (H * 0.9) / (words.length * 0.9));
    ctx.font = `bold ${Math.round(big)}px "${txt.fontFamily}", Arial, sans-serif`;
    ctx.textAlign = 'left';
    words.forEach((w, i) => put(w, W * 0.05, ty + (i - (words.length - 1) / 2) * big * 0.9));
  } else {
    ctx.font = `${style === 'soft' ? '' : 'bold '}${size}px "${txt.fontFamily}", sans-serif`;
    ctx.textAlign = txt.align;
    if (style === 'soft') {
      // a glow in its own colour reads as the slightly out-of-focus type on black cards
      ctx.shadowColor = txt.color;
      ctx.shadowBlur = size / 5;
    }
    put(txt.text, tx, ty);
  }
  ctx.restore();
}
