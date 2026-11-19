// Property tests (fast-check): throw thousands of generated inputs at the feed HTML cleaner, which puts outside
// blogs' HTML on our own pages, and check that nothing it lets through could run code.
import fc from 'fast-check';
import { cleanHtml, decodeXml } from '../server/feed-html.mjs';

let pass = 0;
const failed = [];
const property = (name, arb, ok, runs = 5000) => {
  try {
    fc.assert(fc.property(arb, ok), { numRuns: runs });
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`FAIL  ${name}\n${e.message.split('\n').slice(0, 6).join('\n')}`);
  }
};

// HTML-ish soup: the pieces attacks are made of, in any order
const soup = fc
  .array(
    fc.oneof(
      fc.constantFrom('<', '>', '</', '/>', '"', "'", '=', ' ', '\n', '\t', '/', '<!--', '-->', '&lt;', '&#60;', '&amp;'),
      fc.constantFrom('img', 'a', 'p', 'b', 'script', 'svg', 'iframe', 'style', 'IMG', 'ScRiPt', 'math', 'x-y'),
      fc.constantFrom('src', 'href', 'alt', 'onerror', 'onload', 'style', 'srcset', 'formaction'),
      fc.constantFrom('https://e.com/a.png', 'javascript:alert(1)', 'data:text/html,x', 'alert(1)', 'x'),
      fc.string({ maxLength: 4 }),
    ),
    { maxLength: 40 },
  )
  .map((a) => a.join(''));

const TAGS = 'p|br|hr|h1|h2|h3|h4|strong|b|em|i|u|s|sup|sub|blockquote|ul|ol|li|pre|code|figure|figcaption|a|img';
const ATTR =
  '(?: (?:href|src)="https://[^"<>]*"| alt="[^"<>]*"| target="_blank"| rel="noopener noreferrer nofollow"| loading="lazy"| referrerpolicy="no-referrer")*';
// Every "<" in the output opens one of our own tags with only our attributes; anything else is text
const SAFE = new RegExp(`^(?:[^<]|</?(?:${TAGS})${ATTR}>)*$`);

property('cleaned feed HTML only holds allowed tags and attributes', soup, (html) => SAFE.test(cleanHtml(html)));
property('cleaned feed HTML never ends inside an open tag', soup, (html) => {
  const out = cleanHtml(html);
  return out.lastIndexOf('<') <= out.lastIndexOf('>');
});
property(
  'decoding feed text never throws',
  fc.string({ unit: 'binary', maxLength: 30 }).map((s) => s + '&#' + s.length * 99999999 + ';'),
  (s) => {
    decodeXml(s);
    return true;
  },
);
property('decoding feed text never throws on any number', fc.bigInt({ min: 0n, max: 10n ** 30n }), (n) => {
  decodeXml(`&#${n};`);
  return true;
});

console.log(`\n${pass} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
