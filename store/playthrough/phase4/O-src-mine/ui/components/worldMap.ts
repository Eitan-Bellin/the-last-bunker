import type { BiomeId } from '../../data/surface';
import { BIOMES } from '../../data/surface';

/**
 * Plan 2026-10 M6: the world map as a painted terrain instead of flat coloured hexagons. Each biome's painting (the
 * expedition pictures in art/biomes) is repeated across the map as a pattern and cut into the revealed hexagons, with soft
 * edges, so neighbouring areas of one biome read as one landscape; undiscovered area is fog (dark, grainy), explored ground is
 * lit and not-yet-explored ground is dimmed. Plain Canvas 2D drawn once per change behind the interactive SVG (which keeps
 * the clicks, icons and rings): no WebGL, no per-frame cost, about 3 MB while the map is open and nothing while it is closed.
 */
export interface MapHex { x: number; y: number; biome: string; revealed: boolean; explored: boolean }

const TILE_W = 420;
const TILE_H = 236;
const SCALE = 1.5; // canvas pixels per map unit
const tiles = new Map<string, HTMLCanvasElement>();
let loading: Promise<void> | null = null;

const BIOME_FILES: BiomeId[] = ['ruins', 'wasteland', 'toxicForest', 'shatteredCity', 'caves', 'militaryZone'];

/** Loads the six biome paintings once, as small tiles (the full images are dropped straight away). */
export function ensureBiomeTiles(): Promise<void> {
  loading ??= Promise.all(BIOME_FILES.map(id => new Promise<void>(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = TILE_W;
      c.height = TILE_H;
      c.getContext('2d')!.drawImage(img, 0, 0, TILE_W, TILE_H);
      tiles.set(id, c);
      res();
    };
    img.onerror = () => res();
    img.src = `${import.meta.env.BASE_URL}art/biomes/${id}.webp`;
  }))).then(() => undefined);
  return loading;
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function codeOf(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) | 0;
  return n;
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Paints the terrain into `canvas` for a map of `w` x `h` units centred on the origin. `center` gives a hex's centre in map
 * units and `size` its radius (same maths as the SVG overlay).
 */
export function paintWorldMap(
  canvas: HTMLCanvasElement, hexes: MapHex[], w: number, h: number, size: number, center: (q: number, r: number) => { x: number; y: number },
): void {
  const W = Math.round(w * SCALE), H = Math.round(h * SCALE);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.setTransform(SCALE, 0, 0, SCALE, W / 2, H / 2);
    return [c, g] as const;
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Base: the dark ground the fog is made of, with a little grain.
  const base = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.62);
  base.addColorStop(0, '#1b1d22');
  base.addColorStop(1, '#0b0c0e');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(SCALE, 0, 0, SCALE, W / 2, H / 2);
  for (let i = 0; i < 900; i++) {
    const x = (hash2(i, 1) - 0.5) * w, y = (hash2(i, 2) - 0.5) * h;
    ctx.fillStyle = `rgba(120,128,140,${0.02 + hash2(i, 3) * 0.04})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + hash2(i, 4) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Terrain: each biome's painting as a pattern, cut into the revealed hexes.
  const [tc, tg] = make();
  const [mc, mg] = make();
  const patterns = new Map<string, CanvasPattern | null>();
  for (const [id, tile] of tiles) {
    const p = tg.createPattern(tile, 'repeat');
    // A tile covers about 250 x 140 map units, shifted per biome so neighbouring biomes do not show the same crop.
    p?.setTransform(new DOMMatrix().translate(hash2(codeOf(id), 7) * 200, hash2(codeOf(id), 9) * 120).scale(0.6));
    patterns.set(id, p);
  }
  for (const hx of hexes) {
    if (!hx.revealed) continue;
    const c = center(hx.x, hx.y);
    const pat = patterns.get(hx.biome);
    hexPath(tg, c.x, c.y, size + 0.9);
    tg.fillStyle = pat ?? `#${BIOMES[hx.biome as BiomeId]?.color.toString(16).padStart(6, '0') ?? '444444'}`;
    tg.fill();
    // Explored ground is lit, ground only seen from afar is dim and cold; each hex a touch different.
    const v = (hash2(hx.x * 31 + 5, hx.y * 17 + 3) - 0.5) * 0.07;
    tg.fillStyle = hx.explored ? `rgba(10,8,6,${Math.max(0, 0.04 + v)})` : `rgba(10,12,18,${0.5 + v})`;
    tg.fill();
    hexPath(mg, c.x, c.y, size + 1.6);
    mg.fillStyle = '#fff';
    mg.fill();
  }
  // Soft edges: the terrain keeps only what the (blurred) mask of revealed hexes covers.
  tg.setTransform(1, 0, 0, 1, 0, 0);
  tg.globalCompositeOperation = 'destination-in';
  try {
    tg.filter = 'blur(2.5px)';
  } catch {
    // no canvas filters: hard edges
  }
  tg.drawImage(mc, 0, 0);
  tg.filter = 'none';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tc, 0, 0);
  ctx.setTransform(SCALE, 0, 0, SCALE, W / 2, H / 2);

  // Fog over the undiscovered hexes: patchy and dark, thicker toward the edge, so the world fades out instead of ending.
  for (const hx of hexes) {
    const c = center(hx.x, hx.y);
    if (hx.revealed) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 0.7;
      hexPath(ctx, c.x, c.y, size - 0.4);
      ctx.stroke();
      continue;
    }
    const a = 0.10 + hash2(hx.x + 100, hx.y + 100) * 0.1;
    ctx.fillStyle = `rgba(48,52,60,${a})`;
    hexPath(ctx, c.x, c.y, size - 1.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  // The bunker's own hex: a steel plate.
  for (const hx of hexes) {
    if (hx.biome !== 'bunker') continue;
    const c = center(hx.x, hx.y);
    const g = ctx.createRadialGradient(c.x, c.y - 3, 1, c.x, c.y, size);
    g.addColorStop(0, '#8d9098');
    g.addColorStop(1, '#4a4d55');
    ctx.fillStyle = g;
    hexPath(ctx, c.x, c.y, size - 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // A vignette and a veil of grain over the whole map, like the rest of the picture.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}
