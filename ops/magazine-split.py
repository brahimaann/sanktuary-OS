# Usage: python3 ops/magazine-split.py "<folder of exported spread JPGs>" public/magazine/pages
# Split each CITIES spread at its white gutter into two 920x1400 WebP pages (padded on a dark mat if the shape differs).
import sys, glob, os, re
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
W, H = 920, 1400

def page(im, name):
    s = min(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    c = Image.new('RGB', (W, H), '#0b0b0f')
    c.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    c.save(f'{out}/{name}.webp', 'WEBP', quality=80)

names = []
for f in sorted(glob.glob(f'{src}/*.jpg'), key=str.lower):
    if f.endswith('_1.jpg'):
        continue  # pixel-identical duplicate export
    im = Image.open(f).convert('RGB')
    g = im.convert('L').resize((im.width // 4, im.height // 4))
    mid = g.width // 2
    white = [x for x in range(mid - 40, mid + 40) if min(g.crop((x, 1, x + 1, g.height - 1)).getdata()) > 230]
    cut = (white[0] + white[-1] + 1) * 2 if white else im.width // 2
    name = re.sub(r'[^a-z0-9]+', '-', os.path.basename(f).lower().split(' profile')[0]).strip('-')
    page(im.crop((0, 0, cut, im.height)), f'{name}-1')
    page(im.crop((cut, 0, im.width, im.height)), f'{name}-2')
    names.append(name)
    print(name, im.size, 'cut', cut, 'gutter' if white else 'no gutter')
print(names)
