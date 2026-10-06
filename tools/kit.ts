/**
 * Structure kit pipeline (graphics overhaul): turns the Canva exports in art-src/kit/ into seamless
 * tiles and strips in public/art/kit/. Open /tools/kit.html?auto on the dev server.
 *
 * - tile:   repeats both ways (cross-faded edges)
 * - stripH: repeats sideways only (cross-faded left/right)
 * - stripV: repeats up/down only (cross-faded top/bottom)
 * - paint:  a room-sized painting, cropped to the room aspect
 */

/**
 * - sprite: an object painted on a plain white background; the background is keyed out by flood fill from the edges
 * - decal:  kept on white, shown in multiply blend in the game (white disappears)
 * - glow:   kept on black, shown in add blend (black disappears)
 */
type Mode = 'tile' | 'stripH' | 'stripV' | 'paint' | 'sprite' | 'decal' | 'glow';

interface KitJob {
  src: string;
  out: string;
  mode: Mode;
  /** Normalised crop of the source: x0, y0, x1, y1. */
  crop: [number, number, number, number];
  size: [number, number];
  /** Horizontal clone patches: copy the band [from, from + w) over [to, to + w) to erase a feature that would repeat. */
  clone?: { from: number; to: number; w: number }[];
  /** Split the crop into a cols×rows grid; each cell becomes `${out}-${i}` (sprites are then trimmed to their content). */
  grid?: [number, number];
  /** Cells of a grid to skip. */
  skip?: number[];
  /** Era recipe applied to the finished texture (see RECIPES). */
  recipe?: string;
  /** Sprite: also key out pure-white pockets enclosed by the object (gaps in a lattice mast, under a stall). */
  holes?: boolean;
}

/** Deterministic random for the recipes, so a rerun gives the same texture. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

/** Paints soft blobs that wrap around the edges, so a seamless texture stays seamless. */
function blobs(c: HTMLCanvasElement, n: number, color: string, alpha: number, rMin: number, rMax: number, seed: number, stretchY = 1): void {
  const ctx = c.getContext('2d')!;
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * c.width, y = r() * c.height, rad = (rMin + r() * (rMax - rMin)) * c.width;
    for (const dx of [-c.width, 0, c.width]) {
      for (const dy of [-c.height, 0, c.height]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalAlpha = alpha * (0.5 + r() * 0.5);
        ctx.translate(x + dx, y + dy);
        ctx.scale(1, stretchY);
        ctx.translate(-(x + dx), -(y + dy));
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - rad, y + dy - rad * stretchY, rad * 2, rad * 2 * stretchY);
        ctx.restore();
      }
    }
  }
}

/** Per-pixel colour transform: f gets r,g,b (0..255) and the pixel's luminance relative to the image mean. */
function pixels(c: HTMLCanvasElement, f: (r: number, g: number, b: number, rel: number, x: number, y: number) => [number, number, number]): void {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let mean = 0;
  for (let i = 0; i < d.length; i += 4) mean += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  mean /= d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const p = i / 4;
    const [r, g, b] = f(d[i], d[i + 1], d[i + 2], L / Math.max(1, mean), p % c.width, Math.floor(p / c.width));
    d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(img, 0, 0);
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Era recipes: the same painted material, wrecked (R) or cared for and painted (L). */
const RECIPES: Record<string, (c: HTMLCanvasElement) => void> = {
  /** Neglect: darker, colder, greenish damp, black water stains and mould. */
  grime: c => {
    pixels(c, (r, g, b) => {
      const l = (r + g + b) / 3;
      return [(r * 0.55 + l * 0.45) * 0.78, (g * 0.55 + l * 0.45) * 0.84, (b * 0.55 + l * 0.45) * 0.8];
    });
    blobs(c, 14, 'rgba(8,10,6,1)', 0.55, 0.04, 0.12, 11, 3.2);
    blobs(c, 8, 'rgba(40,52,30,1)', 0.35, 0.05, 0.1, 23, 1.4);
  },
  /** Painted wall: ochre dado below, off-white above, the concrete showing through the paint, a few chips. */
  paintWall: c => {
    const lo = hex('#8f7448'), hi = hex('#c9bea6'), line = hex('#4a3a26');
    const split = Math.round(c.height * 0.56);
    pixels(c, (r, g, b, rel, _x, y) => {
      const p = Math.abs(y - split) < c.height * 0.012 ? line : y > split ? lo : hi;
      const k = Math.max(0.55, Math.min(1.25, 0.55 + 0.5 * rel));
      return [p[0] * k, p[1] * k, p[2] * k];
    });
    blobs(c, 10, 'rgba(70,60,48,1)', 0.45, 0.01, 0.03, 31);
    blobs(c, 6, 'rgba(30,24,18,1)', 0.25, 0.04, 0.09, 41, 2.5);
  },
  /** Cleaned and lit: a touch brighter and warmer, stains lifted. */
  clean: c => pixels(c, (r, g, b, rel) => {
    const lift = rel < 0.8 ? (0.8 - rel) * 40 : 0;
    return [r * 1.12 + lift + 6, g * 1.1 + lift + 3, b * 1.04 + lift];
  }),
  /** Fresh paint on steel: dark olive, rust showing only in the darkest pits. */
  paintSteel: c => {
    const p = hex('#4c5a46');
    pixels(c, (r, g, b, rel) => {
      const k = Math.max(0.4, Math.min(1.35, rel));
      const paint = [p[0] * k, p[1] * k, p[2] * k];
      const keep = rel < 0.55 ? 0.6 : 0.15;
      return [paint[0] * (1 - keep) + r * keep, paint[1] * (1 - keep) + g * keep, paint[2] * (1 - keep) + b * keep];
    });
  },
  /** Heavy rust: orange-brown, flaking, dark. */
  rust: c => {
    pixels(c, (r, g, b, rel) => {
      const k = Math.max(0.35, Math.min(1.2, rel));
      return [(r * 0.4 + 128 * k * 0.6) * 0.85, (g * 0.4 + 70 * k * 0.6) * 0.82, (b * 0.4 + 36 * k * 0.6) * 0.8];
    });
    blobs(c, 10, 'rgba(10,8,6,1)', 0.45, 0.03, 0.1, 51, 2.8);
  },
};

/** Keys out a near-white background connected to the image border, with a soft edge. */
function keyWhite(c: HTMLCanvasElement, tol = 34, holes = false): void {
  const ctx = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const bg = new Uint8Array(W * H);
  const isBg = (i: number) => {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    return 255 - Math.min(r, g, b) < tol && Math.max(r, g, b) - Math.min(r, g, b) < 28;
  };
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i] || !isBg(i)) continue;
    bg[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  if (holes) {
    // Enclosed pockets of the background: strictly white, uncoloured and big enough not to be a painted highlight.
    const pure = (i: number) => {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      return 255 - Math.min(r, g, b) < 16 && Math.max(r, g, b) - Math.min(r, g, b) < 10;
    };
    const seen = new Uint8Array(W * H);
    for (let s = 0; s < W * H; s++) {
      if (bg[s] || seen[s] || !pure(s)) continue;
      const comp: number[] = [];
      stack.push(s);
      seen[s] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        comp.push(i);
        const x = i % W, y = (i / W) | 0;
        for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (n >= 0 && !seen[n] && !bg[n] && pure(n)) { seen[n] = 1; stack.push(n); }
        }
      }
      if (comp.length >= 24) for (const i of comp) bg[i] = 1;
    }
  }
  // Soft edge: pixels next to the background fade by how white they are.
  for (let i = 0; i < W * H; i++) {
    if (bg[i]) { d[i * 4 + 3] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    const nearBg = (x > 0 && bg[i - 1]) || (x < W - 1 && bg[i + 1]) || (y > 0 && bg[i - W]) || (y < H - 1 && bg[i + W]);
    if (nearBg) {
      const whiteness = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255;
      d[i * 4 + 3] = Math.round(255 * Math.min(1, (1 - whiteness) * 2.2));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Crops a canvas to its non-transparent content (plus a small margin). */
function trim(c: HTMLCanvasElement, margin = 4): HTMLCanvasElement {
  const ctx = c.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return c;
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
  x1 = Math.min(c.width - 1, x1 + margin); y1 = Math.min(c.height - 1, y1 + margin);
  const [o, octx] = canvas(x1 - x0 + 1, y1 - y0 + 1);
  octx.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

/** Fits a canvas inside w×h keeping its aspect. */
function fit(c: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const s = Math.min(w / c.width, h / c.height, 1);
  return resize(c, Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
}

export const KIT_JOBS: KitJob[] = [
  { src: 'kit/K-01-wall-F.png', out: 'kit/wall-F', mode: 'tile', crop: [0, 0, 1, 1], size: [512, 512] },
  { src: 'kit/K-01-wall-F.png', out: 'kit/wall-R', mode: 'tile', crop: [0, 0, 1, 1], size: [512, 512], recipe: 'grime' },
  { src: 'kit/K-01-wall-F.png', out: 'kit/wall-L', mode: 'tile', crop: [0, 0, 1, 1], size: [512, 512], recipe: 'clean' },
  { src: 'kit/K-02-slab-F.png', out: 'kit/slab-F', mode: 'stripH', crop: [0, 0.175, 1, 0.81], size: [1024, 368] },
  { src: 'kit/K-02-slab-F.png', out: 'kit/slab-R', mode: 'stripH', crop: [0, 0.175, 1, 0.81], size: [1024, 368], recipe: 'grime' },
  { src: 'kit/K-02-slab-F.png', out: 'kit/slab-L', mode: 'stripH', crop: [0, 0.175, 1, 0.81], size: [1024, 368], recipe: 'clean' },
  { src: 'kit/K-03-column-F.png', out: 'kit/column-F', mode: 'stripV', crop: [0.19, 0, 0.82, 1], size: [144, 512] },
  { src: 'kit/K-03-column-F.png', out: 'kit/column-R', mode: 'stripV', crop: [0.19, 0, 0.82, 1], size: [144, 512], recipe: 'rust' },
  { src: 'kit/K-03-column-F.png', out: 'kit/column-L', mode: 'stripV', crop: [0.19, 0, 0.82, 1], size: [144, 512], recipe: 'paintSteel' },
  {
    src: 'kit/K-08-pipes-F.png', out: 'kit/pipes-F', mode: 'stripH', crop: [0, 0.255, 1, 0.745], size: [1024, 252],
    // The valve wheel would repeat every tile: paint plain pipe over it (valves come back as separate sprites).
    clone: [{ from: 0.36, to: 0.485, w: 0.11 }],
  },
  {
    src: 'kit/K-08-pipes-F.png', out: 'kit/pipes-R', mode: 'stripH', crop: [0, 0.255, 1, 0.745], size: [1024, 252],
    clone: [{ from: 0.36, to: 0.485, w: 0.11 }], recipe: 'grime',
  },
  {
    src: 'kit/K-08-pipes-F.png', out: 'kit/pipes-L', mode: 'stripH', crop: [0, 0.255, 1, 0.745], size: [1024, 252],
    clone: [{ from: 0.36, to: 0.485, w: 0.11 }], recipe: 'clean',
  },
  { src: 'kit/K-12-bay-A.png', out: 'kit/bay-A-wide', mode: 'paint', crop: [0, 0.015, 1, 0.985], size: [720, 522] },
  { src: 'kit/K-12-bay-A.png', out: 'kit/bay-A-narrow', mode: 'paint', crop: [0.17, 0.015, 0.83, 0.985], size: [480, 522] },
  { src: 'kit/K-17-car.png', out: 'kit/car', mode: 'sprite', crop: [0.12, 0.15, 0.88, 0.94], size: [288, 448] },
  { src: 'kit/K-25b-wprops.png', out: 'kit/wprop', mode: 'sprite', crop: [0, 0, 1, 1], size: [160, 160], grid: [3, 3] }, // signage: 9 wall props
  { src: 'kit/S-01-portal-0.png', out: 'kit/portal-0', mode: 'sprite', crop: [0, 0.1, 1, 0.9], size: [840, 560] }, // surface: entrance, wrecked
  { src: 'kit/S-02-portal-1.png', out: 'kit/portal-1', mode: 'sprite', crop: [0, 0.1, 1, 0.9], size: [840, 560] }, // surface: entrance, cleared
  { src: 'kit/S-03-portal-3.png', out: 'kit/portal-3', mode: 'sprite', crop: [0, 0, 1, 0.9], size: [840, 560] }, // surface: entrance, gatehouse
  { src: 'kit/S-04-wheel.png', out: 'kit/wheel', mode: 'sprite', crop: [0, 0, 1, 1], size: [256, 256] }, // surface: blast-door wheel (holes pre-keyed)
  { src: 'kit/S-05-topsoil-R.png', out: 'kit/topsoil-R', mode: 'stripH', crop: [0, 0.12, 1, 0.88], size: [1024, 440] }, // surface: dead topsoil (white keyed in game)
  { src: 'kit/S-06-topsoil-L.png', out: 'kit/topsoil-L', mode: 'stripH', crop: [0, 0.12, 1, 0.88], size: [1024, 440] }, // surface: regrowing topsoil
  { src: 'kit/S-07-props.png', out: 'kit/prop-0', mode: 'sprite', crop: [0.035, 0.03, 0.25, 0.5], size: [400, 400] }, // surface: dead tree
  { src: 'kit/S-07-props.png', out: 'kit/prop-1', mode: 'sprite', crop: [0.253, 0.29, 0.53, 0.5], size: [400, 400] }, // surface: wrecked car
  { src: 'kit/S-07-props.png', out: 'kit/prop-2', mode: 'sprite', crop: [0.552, 0.31, 0.785, 0.5], size: [400, 400] }, // surface: sandbags
  { src: 'kit/S-07-props.png', out: 'kit/prop-3', mode: 'sprite', crop: [0.82, 0.26, 0.97, 0.5], size: [400, 400] }, // surface: barrels
  { src: 'kit/S-07-props.png', out: 'kit/prop-4', mode: 'sprite', crop: [0.04, 0.64, 0.255, 0.92], size: [400, 400] }, // surface: fence piece
  { src: 'kit/S-07-props.png', out: 'kit/prop-5', mode: 'sprite', crop: [0.295, 0.68, 0.525, 0.94], size: [400, 400] }, // surface: rubble pile
  { src: 'kit/S-07-props.png', out: 'kit/prop-6', mode: 'sprite', crop: [0.625, 0.52, 0.755, 0.93], size: [400, 400] }, // surface: lamp post
  { src: 'kit/S-07-props.png', out: 'kit/prop-7', mode: 'sprite', crop: [0.815, 0.71, 0.95, 0.92], size: [400, 400] }, // surface: weeds and stone
  { src: 'kit/S-08-mast.png', out: 'kit/prop-8', mode: 'sprite', crop: [0, 0, 1, 1], size: [400, 400] }, // surface: antenna mast with beacon
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-radioMast', mode: 'sprite', holes: true, crop: [0.060, 0.124, 0.272, 0.555], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-purifier', mode: 'sprite', holes: true, crop: [0.275, 0.213, 0.505, 0.551], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-greenhouse', mode: 'sprite', holes: true, crop: [0.505, 0.293, 0.722, 0.537], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-skyDome', mode: 'sprite', holes: true, crop: [0.728, 0.302, 0.945, 0.537], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-vaultSeal', mode: 'sprite', holes: true, crop: [0.055, 0.631, 0.264, 0.969], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-wall', mode: 'sprite', holes: true, crop: [0.278, 0.622, 0.505, 0.969], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-deepFoundry', mode: 'sprite', holes: true, crop: [0.507, 0.565, 0.740, 0.969], size: [512, 512] }, // big project building
  { src: 'kit/P-01-projects-A.png', out: 'kit/proj-metroTunnel', mode: 'sprite', holes: true, crop: [0.742, 0.649, 0.942, 0.987], size: [512, 512] }, // big project building
  { src: 'kit/P-02-projects-B.png', out: 'kit/proj-archive', mode: 'sprite', holes: true, crop: [0.060, 0.164, 0.340, 0.537], size: [512, 512] }, // big project building
  { src: 'kit/P-02-projects-B.png', out: 'kit/proj-surfaceGate', mode: 'sprite', holes: true, crop: [0.360, 0.121, 0.640, 0.537], size: [512, 512] }, // big project building
  { src: 'kit/P-02-projects-B.png', out: 'kit/proj-tradeLeague', mode: 'sprite', holes: true, crop: [0.655, 0.306, 0.945, 0.537], size: [512, 512] }, // big project building
  { src: 'kit/P-02-projects-B.png', out: 'kit/proj-constitution', mode: 'sprite', holes: true, crop: [0.060, 0.626, 0.340, 0.933], size: [512, 512] }, // big project building
  { src: 'kit/P-02-projects-B.png', out: 'kit/proj-ark', mode: 'sprite', holes: true, crop: [0.360, 0.644, 0.640, 0.942], size: [512, 512] }, // big project building
  { src: 'kit/P-02-projects-B.png', out: 'kit/proj-genesisCore', mode: 'sprite', holes: true, crop: [0.660, 0.572, 0.940, 0.951], size: [512, 512] }, // big project building
];

const log = document.getElementById('log')!;
const outs = document.getElementById('outs')!;
const write = (s: string) => { log.textContent += `${s}\n`; };

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** Scales down in halves for a clean result. */
function resize(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const [c, ctx] = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const [c, ctx] = canvas(w, h);
  ctx.drawImage(cur, 0, 0, w, h);
  return c;
}

/** Cross-fades the far edge into the near one so the result repeats without a seam along one axis. */
function seamless(src: HTMLCanvasElement, axis: 'x' | 'y', overlap = 0.12): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const o = Math.round((axis === 'x' ? W : H) * overlap);
  const ow = axis === 'x' ? W - o : W, oh = axis === 'y' ? H - o : H;
  const [c, ctx] = canvas(ow, oh);
  ctx.drawImage(src, 0, 0);
  const data = src.getContext('2d')!.getImageData(0, 0, W, H).data;
  const out = ctx.getImageData(0, 0, ow, oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const along = axis === 'x' ? x : y;
      if (along >= o) continue;
      // Smoothstep weight: the start of the tile fades in from the cut-off end.
      const t = along / o;
      const k = t * t * (3 - 2 * t);
      const i = (y * ow + x) * 4;
      const j = axis === 'x' ? (y * W + x + ow) * 4 : ((y + oh) * W + x) * 4;
      const a = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) out.data[i + ch] = data[j + ch] * (1 - k) + data[a + ch] * k;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function clonePatch(c: HTMLCanvasElement, patch: { from: number; to: number; w: number }): void {
  const ctx = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const w = Math.round(patch.w * W), from = Math.round(patch.from * W), to = Math.round(patch.to * W);
  const src = ctx.getImageData(from, 0, w, H);
  const dst = ctx.getImageData(to, 0, w, H);
  const feather = Math.round(w * 0.2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, w - 1 - x);
      const k = Math.min(1, edge / feather);
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) dst.data[i + ch] = dst.data[i + ch] * (1 - k) + src.data[i + ch] * k;
    }
  }
  ctx.putImageData(dst, to, 0);
}

async function save(c: HTMLCanvasElement, key: string): Promise<number> {
  const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/webp', 0.84));
  await fetch(`/__art/save/${key}.webp`, { method: 'POST', body: blob });
  return blob.size;
}

/**
 * Clean-up on a whole source sheet before any crop, in fractions of the sheet: `fill` paints white (keyed out later),
 * `mirror` copies a band flipped left-right onto `toX` (to rebuild a symmetric part hidden under a mark).
 */
type PrepOp = { fill: [number, number, number, number] } | { mirror: [number, number, number, number]; toX: number };
const D = (x: number) => x / 2000, V = (y: number) => y / 1125;
const SOURCE_PREP: Record<string, PrepOp[]> = {
  // The generator's "moda.app" badge in the bottom-right corner: over the tunnel's right pillar on A, by the Genesis base on B.
  'kit/P-01-projects-A.png': [{ mirror: [D(1500), V(985), D(1600), V(1062)], toX: D(1740) }, { fill: [D(1840), V(985), D(1930), V(1062)] }],
  'kit/P-02-projects-B.png': [{ mirror: [D(1385), V(988), D(1420), V(1060)], toX: D(1740) }, { fill: [D(1775), V(988), D(1930), V(1060)] }],
};

function prepSource(img: CanvasImageSource & { width: number; height: number }, ops: PrepOp[]): HTMLCanvasElement {
  const [c, ctx] = canvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const W = img.width, H = img.height;
  for (const op of ops) {
    if ('fill' in op) {
      const [x0, y0, x1, y1] = op.fill;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
    } else {
      const [x0, y0, x1, y1] = op.mirror;
      const sw = (x1 - x0) * W, sh = (y1 - y0) * H;
      ctx.save();
      ctx.translate(op.toX * W + sw, y0 * H);
      ctx.scale(-1, 1);
      ctx.drawImage(c, x0 * W, y0 * H, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    }
  }
  return c;
}

async function run(): Promise<void> {
  log.textContent = '';
  const only = new URLSearchParams(location.search).get('only');
  const available = new Set<string>(await (await fetch('/__art/list')).json());
  for (const job of KIT_JOBS) {
    if (only && !job.out.includes(only)) continue;
    if (!available.has(job.src)) { write(`missing ${job.src}`); continue; }
    const raw = await load(`/__art/raw/${job.src}`);
    const img = SOURCE_PREP[job.src] ? prepSource(raw, SOURCE_PREP[job.src]) : raw;
    const [x0, y0, x1, y1] = job.crop;
    const sw = Math.round((x1 - x0) * img.width), sh = Math.round((y1 - y0) * img.height);
    const [crop, cctx] = canvas(sw, sh);
    cctx.drawImage(img, Math.round(x0 * img.width), Math.round(y0 * img.height), sw, sh, 0, 0, sw, sh);
    for (const p of job.clone ?? []) clonePatch(crop, p);
    if (job.grid) {
      // A sheet of separate objects: one output per cell.
      const [cols, rows] = job.grid;
      const cw = crop.width / cols, ch = crop.height / rows;
      for (let i = 0; i < cols * rows; i++) {
        if (job.skip?.includes(i)) continue;
        const [cell, cx] = canvas(Math.round(cw) - 8, Math.round(ch) - 8);
        cx.drawImage(crop, (i % cols) * cw + 4, Math.floor(i / cols) * ch + 4, cell.width, cell.height, 0, 0, cell.width, cell.height);
        let out = cell;
        if (job.mode === 'sprite') { keyWhite(out, 34, !!job.holes); out = trim(out); }
        out = fit(out, job.size[0], job.size[1]);
        const bytes = await save(out, `${job.out}-${i}`);
        write(`${`${job.out}-${i}`.padEnd(18)} ${out.width}x${out.height}  ${(bytes / 1024).toFixed(0)} KB`);
        const im = document.createElement('img');
        im.src = out.toDataURL('image/png');
        im.style.cssText = `max-width:160px;margin:4px;background:${job.mode === 'glow' ? '#000' : 'repeating-conic-gradient(#555 0 25%,#777 0 50%) 0/16px 16px'}`;
        outs.appendChild(im);
      }
      continue;
    }
    let out: HTMLCanvasElement;
    if (job.mode === 'sprite') {
      keyWhite(crop, 34, !!job.holes);
      out = fit(trim(crop), job.size[0], job.size[1]);
      const bytes = await save(out, job.out);
      write(`${job.out.padEnd(18)} ${out.width}x${out.height}  ${(bytes / 1024).toFixed(0)} KB`);
      const im = document.createElement('img');
      im.src = out.toDataURL('image/png');
      im.style.cssText = 'max-width:300px;margin:4px;background:repeating-conic-gradient(#555 0 25%,#777 0 50%) 0/16px 16px';
      outs.appendChild(im);
      continue;
    }
    if (job.mode === 'decal' || job.mode === 'glow') {
      out = fit(crop, job.size[0], job.size[1]);
      const bytes = await save(out, job.out);
      write(`${job.out.padEnd(18)} ${out.width}x${out.height}  ${(bytes / 1024).toFixed(0)} KB`);
      continue;
    }
    if (job.mode === 'paint') {
      out = resize(crop, job.size[0], job.size[1]);
    } else {
      // Size up by the overlap first so the seamless cut lands on the requested size.
      const ox = job.mode === 'tile' || job.mode === 'stripH' ? 1 / 0.88 : 1;
      const oy = job.mode === 'tile' || job.mode === 'stripV' ? 1 / 0.88 : 1;
      out = resize(crop, Math.round(job.size[0] * ox), Math.round(job.size[1] * oy));
      if (job.mode === 'tile' || job.mode === 'stripH') out = seamless(out, 'x');
      if (job.mode === 'tile' || job.mode === 'stripV') out = seamless(out, 'y');
    }
    if (job.recipe) RECIPES[job.recipe](out);
    const bytes = await save(out, job.out);
    write(`${job.out.padEnd(18)} ${out.width}x${out.height}  ${(bytes / 1024).toFixed(0)} KB`);
    const box = document.createElement('div');
    box.className = 'out';
    const url = out.toDataURL('image/png');
    if (job.mode === 'paint') {
      const im = document.createElement('img');
      im.src = url;
      box.appendChild(im);
    } else {
      // Show the strip tiled 2-3 times to check the seam by eye.
      const t = document.createElement('div');
      t.className = 'tiled';
      t.style.backgroundImage = `url(${url})`;
      if (job.mode === 'stripV') { t.style.width = '200px'; t.style.height = '520px'; t.style.backgroundSize = '100% auto'; }
      box.appendChild(t);
    }
    outs.appendChild(box);
  }
  write('done');
  (window as unknown as { __kitDone: boolean }).__kitDone = true;
}

if (new URLSearchParams(location.search).has('auto')) void run();
