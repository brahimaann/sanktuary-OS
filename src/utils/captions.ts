// Captions drawn onto a canvas: Darkroom's text overlays and the video editor's lyrics and title cards use the same
// drawing, so what the editor previews is exactly what gets rendered.

/**
 * How a caption is laid out (from lyric videos and 2012-era edits):
 * plain: one line; grid: words spaced out in even columns, row by row; stacked: one huge word per line filling
 * the width; soft: a small, slightly blurred line (white on black cards); brat: the lime "brat" cover card.
 * From the team's lyric references: word: one bold yellow word at a time; sub / serif: a small film subtitle line;
 * build: words add one by one until the line is full; stack: one word per line, a cream left-hand column.
 */
export type TextStyle = 'plain' | 'grid' | 'stacked' | 'soft' | 'brat' | 'word' | 'sub' | 'serif' | 'build' | 'stack';
export const TEXT_STYLES: [TextStyle, string][] = [
  ['plain', 'Plain'],
  ['grid', 'Word grid'],
  ['stacked', 'Big stacked'],
  ['soft', 'Soft'],
  ['brat', 'brat card'],
  ['word', 'One word'],
  ['sub', 'Subtitle'],
  ['serif', 'Serif subtitle'],
  ['build', 'Build-up'],
  ['stack', 'Stack'],
];
/** Styles that show the words one at a time (word timing matters for these) */
export const WORD_STYLES: TextStyle[] = ['word', 'build', 'grid'];

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
  shown?: number; // word styles: how many words are showing so far (all if missing)
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
  const shown = Math.max(1, Math.min(words.length, txt.shown ?? words.length));
  if (style === 'word') {
    // one bold condensed yellow word at a time, in the middle
    ctx.font = `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = size / 6;
    ctx.fillStyle = '#f5d90a';
    ctx.fillText(words[shown - 1], tx, ty);
  } else if (style === 'sub' || style === 'serif' || style === 'build') {
    // film subtitles: a small line, wrapped to 80% of the width; build-up lays the whole line out and shows the
    // words said so far, so nothing jumps as they appear
    ctx.font = style === 'serif' ? `${size}px Georgia, "Times New Roman", serif` : `${size}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = size / 4;
    ctx.fillStyle = style === 'serif' ? '#f1e2b3' : '#fff';
    const space = ctx.measureText(' ').width;
    const lines: { w: string; x: number }[][] = [[]];
    let lineW = 0;
    for (const w of words) {
      const ww = ctx.measureText(w).width;
      if (lineW && lineW + space + ww > W * 0.8) {
        lines.push([]);
        lineW = 0;
      }
      lines[lines.length - 1].push({ w, x: lineW + (lineW ? space : 0) });
      lineW += (lineW ? space : 0) + ww;
    }
    const lineH = size * 1.2;
    let n = 0;
    lines.forEach((line, i) => {
      const last = line[line.length - 1];
      const left = tx - (last.x + ctx.measureText(last.w).width) / 2;
      const y = ty + (i - (lines.length - 1) / 2) * lineH;
      for (const { w, x } of line) if (n++ < (style === 'build' ? shown : words.length)) ctx.fillText(w, left + x, y);
    });
  } else if (style === 'stack') {
    // one word per line down a left-hand column, bold and cream
    ctx.font = `bold ${size}px "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = size / 5;
    ctx.fillStyle = '#f3ead2';
    words.forEach((w, i) => ctx.fillText(w, W * 0.28, ty + (i - (words.length - 1) / 2) * size * 0.95));
  } else if (style === 'brat') {
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
    words.slice(0, shown).forEach((w, i) => put(w, W * 0.08 + (i % cols) * colW, ty + (Math.floor(i / cols) - (rows - 1) / 2) * lineH));
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
