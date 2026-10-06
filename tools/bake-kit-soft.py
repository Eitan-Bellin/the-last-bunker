"""
Plan 2026-10 Q8: the clean "cardboard" illustrations of the surface (the 14 project buildings and the three portals) are sharper
and cleaner than the soft painted panoramas behind them. This bakes the difference away: a little softening of colour and
edges, ten per cent less saturation, a faint warm cast, film grain on the opaque pixels.

    python tools/bake-kit-soft.py         (from the repo root; needs Pillow + numpy)

Originals are copied once to art-src/p2-orig/kit/ (git-ignored) and every run starts from them, so it never stacks.
"""
import os
import shutil

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, 'public', 'art', 'kit')
ORIG = os.path.join(ROOT, 'art-src', 'p2-orig', 'kit')


def bake(img, seed):
    rgba = img.convert('RGBA')
    a = np.asarray(rgba, dtype=np.float32) / 255.0
    alpha = a[..., 3:4]
    # Colour softening that does not bleed transparent black into the edges: blur premultiplied, divide back.
    pre = Image.fromarray((np.concatenate([a[..., :3] * alpha, alpha], -1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    bl = np.asarray(pre.filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255.0
    ba = bl[..., 3:4]
    soft_rgb = np.where(ba > 1e-3, bl[..., :3] / np.maximum(ba, 1e-3), a[..., :3])
    rgb = a[..., :3] * 0.55 + np.clip(soft_rgb, 0, 1) * 0.45
    out_alpha = alpha * 0.6 + ba * 0.4
    gray = (0.3 * rgb[..., 0] + 0.59 * rgb[..., 1] + 0.11 * rgb[..., 2])[..., None]
    rgb = gray + (rgb - gray) * 0.9
    rgb = rgb * np.array([1.03, 1.0, 0.95], dtype=np.float32)
    rng = np.random.default_rng(seed)
    grain = rng.normal(0, 0.014, size=a.shape[:2]).astype(np.float32)[..., None]
    rgb = np.clip(rgb + grain * (out_alpha > 0.5), 0, 1)
    res = np.concatenate([rgb, out_alpha], -1)
    return Image.fromarray((np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def main():
    os.makedirs(ORIG, exist_ok=True)
    names = sorted(f for f in os.listdir(KIT) if f.endswith('.webp') and (f.startswith('proj-') or f.startswith('portal-')))
    for n in names:
        src = os.path.join(ORIG, n)
        dst = os.path.join(KIT, n)
        if not os.path.exists(src):
            shutil.copy(dst, src)
        out = bake(Image.open(src), sum(map(ord, n)))
        out.save(dst, 'WEBP', quality=88, method=6)
        print(f'{n:28s} {os.path.getsize(dst) // 1024} KB')


if __name__ == '__main__':
    main()
