// Pictures dragged from other sites onto a moodboard become pictures, not links to the page they came from.
import assert from 'node:assert/strict';
import { imageFromDrop } from '../src/utils/webImage.ts';

const pin = 'https://www.pinterest.com/pin/123/';
assert.equal(
  imageFromDrop(
    '<meta charset="utf-8"><img alt="" src="https://i.pinimg.com/236x/ab/cd.jpg" srcset="https://i.pinimg.com/236x/ab/cd.jpg 1x, https://i.pinimg.com/474x/ab/cd.jpg 2x, https://i.pinimg.com/originals/ab/cd.jpg 4x">',
    pin,
  ),
  'https://i.pinimg.com/originals/ab/cd.jpg',
  'Pinterest: the original from srcset',
);
assert.equal(
  imageFromDrop(
    '<a href="/imgres?x=1"><img src="data:image/jpeg;base64,/9j/4AAQ" class="YQ4gaf"></a>',
    'https://www.google.com/imgres?x=1',
  ),
  'data:image/jpeg;base64,/9j/4AAQ',
  'Google Images: the thumbnail',
);
assert.equal(
  imageFromDrop("<img src='https://encrypted-tbn0.gstatic.com/images?q=tbn:A&amp;s=1'>", ''),
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:A&s=1',
);
assert.equal(imageFromDrop('', 'https://example.com/photo.webp?w=800'), 'https://example.com/photo.webp?w=800', 'a link to a picture');
assert.equal(imageFromDrop('<a href="https://example.com">site</a>', 'https://example.com'), '', 'a plain link stays a link');
assert.equal(imageFromDrop('<img src="javascript:alert(1)">', ''), '', 'only web or data: pictures');
console.log('web image drops: ok');
