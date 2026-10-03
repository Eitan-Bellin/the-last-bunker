import { ART, rawName, type ArtEntry, type LightSpot } from '../src/art/registry';
import { SHEETS } from './sheets';

/**
 * Processes Canva exports into game-ready WebP:
 * slice sheets into cells, crop to the target aspect, balance exposure so every room sits at the same
 * brightness, downscale in high quality, encode, and detect the painted lamps so the game can put
 * live light exactly on them. Results go to public/art (images + meta.json) via the dev server.
 */

const log = document.getElementById('log')!;
const grid = document.getElementById('grid')!;
const write = (s: string) => { log.textContent += `${s}\n`; };

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function cropFrom(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, aspect: number, focusY = 0.5): HTMLCanvasElement {
  let w = sw, h = sh, x = sx, y = sy;
  if (w / h > aspect) {
    const nw = Math.round(h * aspect);
    x += Math.round((w - nw) / 2);
    w = nw;
  } else {
    const nh = Math.round(w / aspect);
    y += Math.round((h - nh) * focusY);
    h = nh;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Percentile levels on luminance, applied equally to all channels, plus a gentle midtone lift. */
function balance(c: HTMLCanvasElement, gamma: number, minHi = 200): void {
  const ctx = c.getContext('2d')!;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
  const total = d.length / 4;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= total * p) return v;
    }
    return 255;
  };
  const lo = Math.min(pct(0.004), 30);
  const hi = Math.max(pct(0.997), minHi);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const n = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    lut[v] = Math.round(Math.pow(n, gamma) * 255);
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  ctx.putImageData(data, 0, 0);
}

function downscale(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = document.createElement('canvas');
    half.width = Math.round(cur.width / 2);
    half.height = Math.round(cur.height / 2);
    const ctx = half.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}

/**
 * Finds the painted light sources: small, very bright blobs. Works on a thumbnail,
 * flood-fills bright pixels into blobs and keeps the strongest few.
 */
function detectLights(src: HTMLCanvasElement): LightSpot[] {
  const W = 180;
  const H = Math.round((src.height / src.width) * W);
  const c = downscale(src, W, H);
  const d = c.getContext('2d')!.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  const lums: number[] = [];
  for (let i = 0; i < W * H; i++) {
    lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    lums.push(lum[i]);
  }
  lums.sort((a, b) => a - b);
  const threshold = Math.max(205, lums[Math.floor(lums.length * 0.993)]);
  const seen = new Uint8Array(W * H);
  const blobs: { x: number; y: number; n: number; r: number; g: number; b: number; peak: number }[] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || lum[start] < threshold) continue;
    const stack = [start];
    seen[start] = 1;
    let n = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0, peak = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i / W) | 0;
      n++; sx += x; sy += y;
      sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2];
      peak = Math.max(peak, lum[i]);
      for (const j of [i - 1, i + 1, i - W, i + W]) {
        if (j < 0 || j >= W * H || seen[j] || lum[j] < threshold * 0.92) continue;
        if (Math.abs((j % W) - x) > 1) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (n >= 2 && n < W * H * 0.04) blobs.push({ x: sx / n, y: sy / n, n, r: sr / n, g: sg / n, b: sb / n, peak });
  }
  blobs.sort((a, b) => b.n * b.peak - a.n * a.peak);
  const lights: LightSpot[] = [];
  for (const bl of blobs) {
    if (lights.length >= 5) break;
    const nx = bl.x / W, ny = bl.y / H;
    if (ny > 0.85) continue; // floor reflections, not lamps
    if (lights.some(l => Math.hypot(l.x - nx, (l.y - ny) * (H / W)) < 0.08)) continue;
    // Push the blob color toward its hue so the glow reads as colored light, not grey.
    const max = Math.max(bl.r, bl.g, bl.b, 1);
    const k = 255 / max;
    const col = (Math.min(255, Math.round(bl.r * k)) << 16) | (Math.min(255, Math.round(bl.g * k)) << 8) | Math.min(255, Math.round(bl.b * k));
    const big = lights.length === 0 && ny < 0.4;
    lights.push({
      x: +nx.toFixed(3), y: +ny.toFixed(3),
      r: +Math.min(0.24, Math.max(big ? 0.15 : 0.05, Math.sqrt(bl.n) / W * 3.2)).toFixed(3),
      color: col,
      flicker: ny < 0.35 ? 0.3 : 0.15,
    });
  }
  return lights;
}

const meta: Record<string, { lights: LightSpot[] }> = {};

async function finish(entry: ArtEntry, cropped: HTMLCanvasElement): Promise<void> {
  const [w, h] = entry.out;
  // Ruins stay dark on purpose; story panels and backdrops keep their own grading.
  if (entry.kind === 'room') balance(cropped, 0.86);
  else if (entry.kind === 'portrait') balance(cropped, 0.95);
  else if (entry.kind === 'ruin') balance(cropped, 0.82, 190);
  else if (entry.kind === 'district' || entry.kind === 'hall') balance(cropped, 0.84);
  const out = downscale(cropped, w, h);
  if (entry.kind === 'room' || entry.kind === 'district' || entry.kind === 'hall') meta[entry.key] = { lights: detectLights(out) };
  const blob = await new Promise<Blob>((resolve) => out.toBlob(b => resolve(b!), 'image/webp', 0.84));
  await fetch(`/__art/save/${entry.key}.webp`, { method: 'POST', body: blob });
  write(`${entry.key}.webp  ${w}x${h}  ${(blob.size / 1024).toFixed(0)} KB  lights:${meta[entry.key]?.lights.length ?? '-'}`);
  show(entry, URL.createObjectURL(blob), meta[entry.key]?.lights ?? entry.lights ?? []);
}

function show(entry: ArtEntry, url: string, lights: LightSpot[]): void {
  const fig = document.createElement('figure');
  const img = document.createElement('img');
  img.src = url;
  fig.appendChild(img);
  const cap = document.createElement('figcaption');
  cap.textContent = entry.key;
  fig.appendChild(cap);
  img.onload = () => {
    if (!(document.getElementById('spots') as HTMLInputElement).checked) return;
    for (const s of lights) {
      const dot = document.createElement('div');
      dot.className = 'spot';
      const size = s.r * img.width * 2;
      dot.style.left = `${6 + s.x * img.width}px`;
      dot.style.top = `${6 + s.y * img.height}px`;
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.borderColor = `#${s.color.toString(16).padStart(6, '0')}`;
      fig.appendChild(dot);
    }
  };
  grid.appendChild(fig);
}

async function run(): Promise<void> {
  log.textContent = '';
  grid.textContent = '';
  const available = new Set<string>(await (await fetch('/__art/list')).json());
  const only = new URLSearchParams(location.search).get('only');
  const byKey = new Map(ART.map(a => [a.key, a]));
  const done = new Set<string>();
  // Single images first (they may supersede sheet cells).
  for (const entry of ART) {
    if (only && !entry.key.includes(only)) continue;
    const raw = `raw/${rawName(entry)}`;
    if (!available.has(raw)) continue;
    const img = await loadImage(`/__art/raw/${raw}`);
    await finish(entry, cropFrom(img, 0, 0, img.naturalWidth, img.naturalHeight, entry.out[0] / entry.out[1], entry.focusY));
    done.add(entry.key);
  }
  for (const sheet of SHEETS) {
    if (!available.has(sheet.file)) {
      write(`missing sheet: ${sheet.file}`);
      continue;
    }
    const img = await loadImage(`/__art/raw/${sheet.file}`);
    const cw = img.naturalWidth / sheet.cols, ch = img.naturalHeight / sheet.rows;
    for (let i = 0; i < sheet.keys.length; i++) {
      const key = sheet.keys[i];
      const entry = key ? byKey.get(key) : undefined;
      if (!entry || done.has(entry.key) || (only && !entry.key.includes(only))) continue;
      const col = i % sheet.cols, row = Math.floor(i / sheet.cols);
      // Trim a couple of pixels so neighbouring cells never bleed in.
      await finish(entry, cropFrom(img, col * cw + 2, row * ch + 2, cw - 4, ch - 4, entry.out[0] / entry.out[1], entry.focusY));
      done.add(entry.key);
    }
  }
  if (!only) {
    await fetch('/__art/save/meta.json', { method: 'POST', body: JSON.stringify(meta) });
    write(`meta.json: ${Object.keys(meta).length} entries`);
  }
  // The structure kit has its own pipeline (tools/kit.html).
  const missing = ART.filter(a => a.kind !== 'kit' && !done.has(a.key)).map(a => a.key);
  if (missing.length) write(`not yet painted: ${missing.join(', ')}`);
  write('done');
  (window as unknown as { __artDone: boolean }).__artDone = true;
}

document.getElementById('run')!.addEventListener('click', () => void run());
if (new URLSearchParams(location.search).has('auto')) void run();
