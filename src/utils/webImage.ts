/**
 * The picture in something dragged in from another site (Pinterest, Google Images, ...). Browsers hand over the page
 * the picture links to as the URL and the picture itself only as HTML, so the <img> is read from that: its largest
 * srcset entry (Pinterest's original), else its src (Google's thumbnails are data: URLs). A link that is itself a
 * picture counts too. '' when there's no picture.
 */
export function imageFromDrop(html: string, uri: string): string {
  const img = html.match(/<img\b[^>]*>/i)?.[0] || '';
  const attr = (name: string) => img.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'is'))?.[2].replace(/&amp;/g, '&');
  const best = attr('srcset')?.split(/,\s+/).pop()?.trim().split(/\s+/)[0];
  const src = [best, attr('src')].find((s) => s && /^(https?:\/\/|data:image\/)/i.test(s));
  if (src) return src;
  return /^https?:\/\/\S+\.(jpe?g|png|gif|webp|avif)(\?\S*)?$/i.test(uri) ? uri : '';
}
