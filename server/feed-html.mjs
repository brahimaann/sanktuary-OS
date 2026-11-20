// Feed HTML helpers, kept apart from index.mjs so tests/properties.test.mjs can check them on their own.
export const decodeXml = (s = '') =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '\ufffd')) // a bad number must not sink the whole feed
    .replace(/&amp;/g, '&');

// Substack post HTML, cut down to plain formatting before it's shown on our site: every tag not on this list is
// dropped (its text kept), scripts/iframes/forms are removed with their contents, and only https links and
// pictures survive as attributes. Nothing from the feed can run code on sanktuary.studio.
const CLEAN_TAGS = {
  p: [],
  br: [],
  hr: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  sup: [],
  sub: [],
  blockquote: [],
  ul: [],
  ol: [],
  li: [],
  pre: [],
  code: [],
  figure: [],
  figcaption: [],
  a: ['href'],
  img: ['src', 'alt'],
};
export const escAttr = (v) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export function cleanHtml(html) {
  return (
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(
        /<(script|style|iframe|object|embed|noscript|svg|math|form|template|button|select|textarea|video|audio)\b[\s\S]*?<\/\1\s*>/gi,
        '',
      )
      // A "<" that doesn't open a whole tag (say "<img src=x onerror=..." with no ">") becomes text, else the page's
      // own markup after it would close the tag and run the handler
      .replace(/<\/?([a-zA-Z][\w-]*)([^<>]*)>|</g, (whole, name, attrs) => {
        if (!name) return '&lt;';
        const t = name.toLowerCase();
        if (!CLEAN_TAGS[t]) return '';
        if (whole.startsWith('</')) return ['br', 'hr', 'img'].includes(t) ? '' : `</${t}>`;
        let out = '';
        for (const a of CLEAN_TAGS[t]) {
          const m = attrs.match(new RegExp(`\\s${a}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
          const v = m ? decodeXml(m[1] ?? m[2]).trim() : '';
          if (a === 'alt' ? v : /^https:\/\//i.test(v)) out += ` ${a}="${escAttr(v)}"`;
        }
        if (t === 'a') out += ' target="_blank" rel="noopener noreferrer nofollow"';
        if (t === 'img') out += ' loading="lazy" referrerpolicy="no-referrer"';
        return `<${t}${out}>`;
      })
  );
}
