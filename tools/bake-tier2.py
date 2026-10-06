"""
Plan 2026-10 Q5: bake the top-tier room paintings (`rooms/<type>-2.webp`) into the same lamp-lit, matte, grainy look as
tiers 0 and 1. The originals are cold, glossy cyan renders (the biggest style break in the bunker); this pulls cyan out of
the metal and the walls, warms the whites, rolls the highlights off and adds a little grain, but leaves the lit screens
(bright, saturated cyan) alone, so cyan stays where a screen is.

    python tools/bake-tier2.py            (from the repo root; needs Pillow + numpy)

The pristine originals are copied once to art-src/p2-orig/ (git-ignored); every run starts from those, so running it again
never stacks the effect. Output goes to public/art/rooms/*-2.webp and the measured exposure of those paintings is
refreshed in public/art/balance.json (the same numbers tools/lum.html writes: mean luma, mean rgb, share of blown pixels).
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'public', 'art')
ORIG = os.path.join(ROOT, 'art-src', 'p2-orig')

TYPES = ['armory', 'canteen', 'farm', 'generator', 'hydroponics', 'laboratory', 'medbay', 'quarters', 'radioTower',
         'reactor', 'storage', 'trainingRoom', 'waterPump', 'waterPurifier', 'workshop']


# Where the cool band (cyan, ice blue) is turned to: the olive-amber of tiers 0 and 1.
HUE_TARGET = 55.0


def rgb_to_hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    mn = a.min(-1)
    d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0.0)
    h = np.zeros_like(mx)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.maximum(d, 1e-6), 0)
    gc = np.where(m, (mx - g) / np.maximum(d, 1e-6), 0)
    bc = np.where(m, (mx - b) / np.maximum(d, 1e-6), 0)
    h = np.where(mx == r, bc - gc, np.where(mx == g, 2.0 + rc - bc, 4.0 + gc - rc))
    h = (h / 6.0) % 1.0
    return h * 360.0, s, mx


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bake(img, seed):
    a = np.asarray(img.convert('RGB'), dtype=np.float32) / 255.0
    h, s, v = rgb_to_hsv(a)
    # Cool band: cyan to blue.
    cool = smooth(130, 165, h) * (1 - smooth(255, 285, h))
    # Lit screens and glow strips: bright and clearly coloured. They keep their cyan; the rest of the cool band does not.
    emissive = smooth(0.40, 0.75, v) * smooth(0.30, 0.55, s) * cool
    keep = np.clip(emissive * 1.6, 0, 1)
    # 1. Cool metal, walls and floor swing toward the olive-green and amber of the lower tiers (hue turned, saturation eased).
    w = cool * (1 - keep)
    hh = h + (HUE_TARGET - h) * w * 0.95
    sat = s * (1 - 0.40 * w)
    # back to rgb from the shifted hue / saturation, same value
    i = np.floor(hh / 60.0) % 6
    f = hh / 60.0 - np.floor(hh / 60.0)
    p_ = v * (1 - sat)
    q_ = v * (1 - f * sat)
    t_ = v * (1 - (1 - f) * sat)
    i = i.astype(np.int32)
    r = np.choose(i, [v, q_, p_, p_, t_, v])
    g = np.choose(i, [t_, v, v, q_, p_, p_])
    b = np.choose(i, [p_, p_, t_, v, v, q_])
    shifted = np.stack([r, g, b], -1)
    out = np.where((w > 0.001)[..., None], shifted, a)
    # 2. Warm lamp light over everything that is not a screen (cream whites, amber shadows) and a little more body in the colour.
    warm = np.array([1.12, 1.0, 0.78], dtype=np.float32)
    # Only as much as the painting is cold: the canteen, quarters and farm are warm already and just get the matte finish.
    cold = float(np.clip((a[..., 2].mean() / max(1e-6, a[..., 0].mean()) - 0.6) / 0.4, 0, 1))
    k = (0.9 * cold * (1 - keep))[..., None]
    out = out * (1 + (warm - 1) * k)
    gray = (0.3 * out[..., 0] + 0.59 * out[..., 1] + 0.11 * out[..., 2])[..., None]
    out = gray + (out - gray) * (1 + 0.35 * k)
    # 3. Roll the highlights off (glossy white glare is the main "render" tell) and sink the shadows a hair toward brown.
    vv = out.max(-1, keepdims=True)
    roll = 1 - 0.20 * smooth(0.55, 1.0, vv) * (1 - keep[..., None])
    out = out * roll
    out = np.clip(out, 0, 1) ** np.float32(1.10)
    shadow = (1 - smooth(0.0, 0.22, out.max(-1, keepdims=True)))
    out = out + shadow * np.array([0.010, 0.006, 0.0], dtype=np.float32)
    # 4. Matte it: a touch of blur mixed in (CG edges are too crisp for the painted tiers), then grain.
    im = Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
    bl = np.asarray(im.filter(ImageFilter.GaussianBlur(0.9)), dtype=np.float32) / 255.0
    out = np.clip(out, 0, 1) * 0.62 + bl * 0.38
    rng = np.random.default_rng(seed)
    grain = rng.normal(0, 0.016, size=a.shape[:2]).astype(np.float32)[..., None]
    out = out + grain * (0.4 + 0.6 * np.sqrt(np.clip(out.mean(-1, keepdims=True), 0, 1)))
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))


def measure(img):
    w = 96
    sm = img.convert('RGB').resize((w, round(w * img.height / img.width)), Image.BILINEAR)
    d = np.asarray(sm, dtype=np.float32)
    r, g, b = d[..., 0].mean(), d[..., 1].mean(), d[..., 2].mean()
    lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
    hot = float(((0.3 * d[..., 0] + 0.59 * d[..., 1] + 0.11 * d[..., 2]) > 215).mean())
    return {'lum': round(float(lum), 3), 'rgb': [int(round(r)), int(round(g)), int(round(b))], 'hot': round(hot, 3)}


def stats(img):
    a = np.asarray(img.convert('RGB'), dtype=np.float32) / 255.0
    h, s, v = rgb_to_hsv(a)
    return float((s > 0.6).mean() * 100), float(((h > 150) & (h < 250) & (s > 0.2)).mean() * 100)


def main():
    only = sys.argv[1:] or TYPES
    os.makedirs(ORIG, exist_ok=True)
    bal_path = os.path.join(ART, 'balance.json')
    bal = json.load(open(bal_path))
    for t in only:
        name = f'{t}-2.webp'
        src = os.path.join(ORIG, name)
        dst = os.path.join(ART, 'rooms', name)
        if not os.path.exists(src):
            shutil.copy(dst, src)
        img = Image.open(src)
        out = bake(img, sum(map(ord, t)))
        out.save(dst, 'WEBP', quality=88, method=6)
        key = f'rooms/{t}-2'
        before, after = measure(img), measure(out)
        if key in bal:
            bal[key] = after
        s0, c0 = stats(img)
        s1, c1 = stats(out)
        print(f'{key:26s} lum {before["lum"]:.3f} -> {after["lum"]:.3f}  rgb {before["rgb"]} -> {after["rgb"]}  '
              f'S>0.6 {s0:.1f}% -> {s1:.1f}%  cool {c0:.1f}% -> {c1:.1f}%  {os.path.getsize(dst) // 1024} KB')
    json.dump(bal, open(bal_path, 'w'), separators=(',', ':'))


if __name__ == '__main__':
    main()
