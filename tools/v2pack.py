# v2 room packer: a rendered loop (f_0001.png ..) -> a static background + an atlas holding only the regions that move.
#   python tools/v2pack.py art-src/v2/recycler public/art/v2/recycler [--thresh 9] [--scale 1]
# Output: bg.webp (frame 1), anim.webp (the moving rects of every frame), anim.json (where each crop goes).
import json, os, sys, glob
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
opt = dict(zip(sys.argv[3::2], sys.argv[4::2]))
THRESH = int(opt.get('--thresh', 9))
SCALE = float(opt.get('--scale', 1))
FPS = int(opt.get('--fps', 12))
os.makedirs(dst, exist_ok=True)

paths = sorted(glob.glob(os.path.join(src, 'f_*.png')))
assert paths, 'no frames in ' + src
frames = []
for p in paths:
    im = Image.open(p).convert('RGB')
    if SCALE != 1:
        im = im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)
    frames.append(np.asarray(im).astype(np.int16))
H, W, _ = frames[0].shape
base = frames[0]

# where anything changes over the loop
diff = np.zeros((H, W), bool)
for f in frames[1:]:
    diff |= np.abs(f - base).max(axis=2) > THRESH
mask = Image.fromarray((diff * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
m = np.asarray(mask) > 0

# connected components on a coarse grid (cells of 8 px), then bounding rects, merged when close
CELL = 8
gh, gw = (H + CELL - 1) // CELL, (W + CELL - 1) // CELL
grid = np.zeros((gh, gw), bool)
for gy in range(gh):
    for gx in range(gw):
        grid[gy, gx] = m[gy * CELL:(gy + 1) * CELL, gx * CELL:(gx + 1) * CELL].any()
seen = np.zeros_like(grid)
rects = []
for gy in range(gh):
    for gx in range(gw):
        if not grid[gy, gx] or seen[gy, gx]:
            continue
        stack = [(gy, gx)]
        seen[gy, gx] = True
        y0, x0, y1, x1 = gy, gx, gy, gx
        while stack:
            cy, cx = stack.pop()
            y0, x0, y1, x1 = min(y0, cy), min(x0, cx), max(y1, cy), max(x1, cx)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < gh and 0 <= nx < gw and grid[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        rects.append([x0 * CELL, y0 * CELL, min(W, (x1 + 1) * CELL), min(H, (y1 + 1) * CELL)])


def close(a, b, pad=16):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


merged = True
while merged:
    merged = False
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            if close(rects[i], rects[j]):
                a, b = rects[i], rects[j]
                rects[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                rects.pop(j)
                merged = True
                break
        if merged:
            break

# shelf-pack every rect x every frame into one atlas (max 4096 wide)
cells = [(r, k) for r in range(len(rects)) for k in range(len(frames))]
AW = 2048
x = y = shelf = 0
place = {}
for r, k in sorted(cells, key=lambda c: -(rects[c[0]][3] - rects[c[0]][1])):
    w, h = rects[r][2] - rects[r][0], rects[r][3] - rects[r][1]
    if w > AW:
        AW = w
    if x + w > AW:
        x, y, shelf = 0, y + shelf + 1, 0
    place[(r, k)] = (x, y)
    x += w + 1
    shelf = max(shelf, h)
AH = y + shelf
atlas = Image.new('RGB', (AW, max(1, AH)))
for (r, k), (ax, ay) in place.items():
    x0, y0, x1, y1 = rects[r]
    crop = Image.fromarray(frames[k][y0:y1, x0:x1].astype(np.uint8))
    atlas.paste(crop, (ax, ay))

Image.fromarray(base.astype(np.uint8)).save(os.path.join(dst, 'bg.webp'), quality=86, method=6)
if rects:
    atlas.save(os.path.join(dst, 'anim.webp'), quality=84, method=6)
meta = {
    'w': W, 'h': H, 'fps': FPS, 'frames': len(frames),
    'rects': [{'x': r[0], 'y': r[1], 'w': r[2] - r[0], 'h': r[3] - r[1], 'cells': [place[(i, k)] for k in range(len(frames))]} for i, r in enumerate(rects)],
    'atlas': [AW, AH] if rects else None,
}
json.dump(meta, open(os.path.join(dst, 'anim.json'), 'w'))
area = sum((r[2] - r[0]) * (r[3] - r[1]) for r in rects)
print(f'{len(paths)} frames {W}x{H}: {len(rects)} moving rects, {100 * area / (W * H):.1f}% of the room, atlas {AW}x{AH} '
      f'({AW * AH * 4 / 1e6:.1f} MB GPU), files bg {os.path.getsize(os.path.join(dst, "bg.webp")) // 1024} KB'
      + (f' anim {os.path.getsize(os.path.join(dst, "anim.webp")) // 1024} KB' if rects else ''))
