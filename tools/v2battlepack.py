# v2 battlefield packer: art-src/v2/battle/<layer>.png (full-frame transparent) -> public/art/v2/battle/<layer>.webp
# cropped to its content, plus layers.json with each crop's offset in game units (2 px per unit).
import json, os, sys
from PIL import Image

src, dst = 'art-src/v2/battle', 'public/art/v2/battle'
os.makedirs(dst, exist_ok=True)
out = {}
for name in ('camp', 'tower', 'tower_broken', 'wall', 'wall_broken'):
    im = Image.open(os.path.join(src, f'{name}.png')).convert('RGBA')
    b = im.getchannel('A').point(lambda a: 255 if a > 6 else 0).getbbox()
    crop = im.crop(b)
    crop.save(os.path.join(dst, f'{name}.webp'), quality=88, method=6)
    out[name] = {'x': b[0] / 2, 'y': b[1] / 2, 'w': crop.width / 2, 'h': crop.height / 2, 'frameH': im.height / 2}
    print(name, crop.size)
json.dump(out, open(os.path.join(dst, 'layers.json'), 'w'))
