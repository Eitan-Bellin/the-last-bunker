# v2 people packer: art-src/v2/people/<variant>/<anim>_NN.png -> public/art/v2/people/<variant>.webp + .json
# Every frame of a variant is cropped to the same box (the union of all its frames), one row per animation.
import json, os, sys, glob
from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else 'art-src/v2/people'
dst = sys.argv[2] if len(sys.argv) > 2 else 'public/art/v2/people'
os.makedirs(dst, exist_ok=True)
index = {}
for vdir in sorted(glob.glob(os.path.join(src, 'v*'))):
    v = os.path.basename(vdir)
    meta = json.load(open(os.path.join(vdir, 'meta.json')))
    anims = {a: sorted(glob.glob(os.path.join(vdir, f'{a}_*.png'))) for a in meta['anims']}
    frames = {a: [Image.open(p).convert('RGBA') for p in ps] for a, ps in anims.items()}
    W, H = meta['res']
    box = None
    for fs in frames.values():
        for im in fs:
            b = im.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    x0, y0, x1, y1 = box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1
    cw, ch = x1 - x0, y1 - y0
    cols = max(len(fs) for fs in frames.values())
    atlas = Image.new('RGBA', (cols * cw, len(frames) * ch))
    rows = {}
    for r, (a, fs) in enumerate(frames.items()):
        for k, im in enumerate(fs):
            atlas.paste(im.crop((x0, y0, x1, y1)), (k * cw, r * ch))
        rows[a] = {'row': r, 'n': len(fs)}
    atlas.save(os.path.join(dst, f'{v}.webp'), quality=88, method=6)
    fx, fy = meta['foot'][0] * W - x0, meta['foot'][1] * H - y0
    info = {'cell': [cw, ch], 'foot': [round(fx, 1), round(fy, 1)], 'pxPerMetre': H / meta['metresTall'], 'fps': meta['fps'], 'anims': rows}
    json.dump(info, open(os.path.join(dst, f'{v}.json'), 'w'))
    index[v] = True
    print(v, f'cell {cw}x{ch}', f'atlas {atlas.width}x{atlas.height}', f'{os.path.getsize(os.path.join(dst, v + ".webp")) // 1024} KB')
names = sorted(index)
json.dump([n for n in names if int(n[1:]) < 4], open(os.path.join(dst, 'index.json'), 'w'))
json.dump([n for n in names if int(n[1:]) >= 4], open(os.path.join(dst, 'battle.json'), 'w'))
