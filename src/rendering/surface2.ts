import { Container, Graphics, MeshSimple, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { ArtLibrary, glowTexture, moteTexture } from '../art/ArtLibrary';
import { bus } from '../core/EventBus';
import { BUILDING_W, SHAFT_W } from './layout';
import { hGradient, mix, seeded, softGlow, vGradient } from './draw';
import { SKY_TOP, WORLD_LEFT, WORLD_RIGHT, type Animated } from './world';
import {
  Birds, Smoke, Weather, analyseSky, canvasTexture, cloudTexture, fogTexture, groundY, lightGrade, moonTexture, mulColor,
  silhouetteTexture, smoothstep, soilThickness, type SurfaceQuality, type View,
} from './surfaceLife';

/**
 * Graphics overhaul G3 (surface): everything above ground in painted pieces (behind the `gfx2` switch).
 * The era's panorama and sun shafts stay; the entrance becomes a painted portal in a hillside over the
 * lift shaft (its pulley housing hides behind the door), the ground a painted topsoil cross-section whose
 * roots hang into the rock, plus painted props, a turning door wheel, day/night tint and drifting dust.
 *
 * Phase 0 (surface): the picture becomes a place — the panorama sits on a slow parallax layer with
 * drifting cloud banks and low haze; at night a real sky (gradient, stars, moon) replaces the painted
 * sunset behind the painted skyline (surfaceLife.analyseSky cuts the landscape out of the painting);
 * birds, bats, chimney and vent smoke, rain and the first era's ash fall; the grass leans in the wind;
 * the topsoil rolls instead of running as a ruler line; the portal is graded to the panorama's light;
 * and at far zoom the world fades into the dark instead of ending in a navy box.
 *
 * Three layers, because the topsoil must cover the rock painting and the portal must cover the shaft head:
 * `container` (sky, panorama, props) goes in the renderer's surface holder, `soil` right above the
 * underground, `front` right above the shaft — see mountSurface2.
 */
export interface Surface2 extends Animated {
  soil: Container;
  front: Container;
  /** gfx-p0: the renderer's quality ladder sets the particle budget and cloud/fog layers. */
  setQuality(q: SurfaceQuality): void;
}

/** Portal look per era (0 wrecked, 1–2 cleared, 3 gatehouse); positions are relative to the trimmed sprite. */
interface PortalLook {
  key: string;
  hub: [number, number];
  lamps: [number, number][];
  flood?: boolean;
  beacon?: [number, number];
  /** Top of the exhaust stack poking out of the mound. */
  vent: [number, number];
}
const PORTALS: Record<number, PortalLook> = {
  0: { key: 'kit/portal-0', hub: [0.5, 0.548], lamps: [], vent: [0.77, 0.12] },
  1: { key: 'kit/portal-1', hub: [0.5, 0.553], lamps: [[0.34, 0.45], [0.643, 0.45]], vent: [0.77, 0.1] },
  3: { key: 'kit/portal-3', hub: [0.497, 0.628], lamps: [[0.155, 0.075], [0.84, 0.075]], flood: true, beacon: [0.638, 0.07], vent: [0.74, 0.16] },
};
const portalFor = (era: number): PortalLook => PORTALS[era <= 0 ? 0 : era >= 3 ? 3 : 1];

/** World width of the portal sprite; the door is centred over the shaft. */
const PORTAL_W = 270;
const PORTAL_X = SHAFT_W / 2;
/** Topsoil strip: texture rows of the grass base and the strip's world height. */
const SOIL_TOP = 0.395;
const SOIL_H = 62;
/** Props stand a little into the grass so its blades overlap their feet. */
const PROP_BASE = -5;
/** How far the ground, sky and clouds run past the world edges (far zoom fades them into the dark). */
const GROUND_EXT = 220;
const SKY_EXT = 1700;
/** The app's clear colour: the world fades into it at the edges. */
const VOID = 0x0d0f1a;
/** Parallax of the panorama layer (fraction of the camera's motion it follows) and its rest point. */
const PAR_X = 0.06, PAR_Y = 0.1, PAR_REF_Y = 240;

/** Rolling ground line of the surface (the portal stands on the level part). */
const ground = (x: number) => groundY(x, PORTAL_X);

/** Props: key, x, height (world units), first and last era shown, mirrored, sways in the wind. */
interface PropPlace { i: number; x: number; h: number; from: number; to: number; flip?: boolean; sway?: number }
const PROPS: PropPlace[] = [
  { i: 4, x: -228, h: 52, from: 0, to: 2 }, // fence piece
  { i: 7, x: -150, h: 18, from: 0, to: 3, sway: 0.09 }, // weeds
  { i: 8, x: -118, h: 118, from: 0, to: 2 }, // antenna mast
  { i: 5, x: 192, h: 30, from: 0, to: 1 }, // rubble
  { i: 2, x: 196, h: 24, from: 1, to: 3 }, // sandbags
  { i: 1, x: 300, h: 44, from: 0, to: 2 }, // wrecked car
  { i: 3, x: 392, h: 34, from: 0, to: 3 }, // barrels
  { i: 6, x: 456, h: 100, from: 1, to: 3 }, // lamp post
  { i: 7, x: 520, h: 16, from: 0, to: 3, flip: true, sway: 0.1 }, // weeds
  { i: 0, x: 590, h: 112, from: 0, to: 3, sway: 0.012 }, // dead tree
  { i: 5, x: 700, h: 26, from: 0, to: 0, flip: true }, // rubble
  { i: 2, x: 742, h: 22, from: 2, to: 3, flip: true }, // sandbags
  { i: 4, x: 800, h: 48, from: 0, to: 1, flip: true }, // fence piece
];
/** Lit spots on props (relative to the trimmed sprite). */
const PROP_LAMP: Record<number, [number, number, number]> = { 6: [0.84, 0.2, 0xffd890], 8: [0.49, 0.023, 0xff3a3a] };

// Dusk and dawn are softened: the panoramas are already warm, a strong orange multiply burns them.
const DAWN = 0xf4ccb8, DUSK = 0xf2c094, NIGHT = 0x4a5a8a;

/**
 * Sky and weather per era. Night gradient stops run top → painting top → mid-sky → horizon; the moon and
 * the smoke sources are fractions of the panorama painting (chimneys, fires in the ruins).
 */
interface EraSky {
  night: [number, number, number, number];
  moon: [number, number];
  moonTint: number;
  stars: number;
  cloud: number;
  cloudAlpha: [number, number];
  fog: number;
  fogAlpha: number;
  smoke: [number, number, number][];
  smokeColor: number;
  smokeAlpha: number;
  ash: boolean;
  /** How often it rains (0 never .. 1 often). */
  wet: number;
}
const ERA_SKY: EraSky[] = [
  {
    night: [0x060508, 0x110d10, 0x241818, 0x3e2a24], moon: [0.68, 0.2], moonTint: 0xe8b898, stars: 0.3,
    cloud: 0x4a3a32, cloudAlpha: [0.4, 0.5], fog: 0x8a7464, fogAlpha: 0.4,
    smoke: [[0.1, 0.63, 1], [0.8, 0.69, 0.85], [0.355, 0.755, 0.6]], smokeColor: 0x2a2320, smokeAlpha: 0.5, ash: true, wet: 0.35,
  },
  {
    night: [0x04060d, 0x080d1e, 0x111b36, 0x1e2a48], moon: [0.3, 0.17], moonTint: 0xf4ecdc, stars: 0.8,
    cloud: 0xffe2c4, cloudAlpha: [0.26, 0.36], fog: 0xd8c8b0, fogAlpha: 0.22,
    smoke: [[0.205, 0.8, 0.55]], smokeColor: 0x8a8278, smokeAlpha: 0.3, ash: false, wet: 1,
  },
  {
    night: [0x04060d, 0x080d1e, 0x111b36, 0x1e2a48], moon: [0.27, 0.19], moonTint: 0xf4ecdc, stars: 0.95,
    cloud: 0xffe4d0, cloudAlpha: [0.24, 0.32], fog: 0xd8d0c0, fogAlpha: 0.18,
    smoke: [[0.392, 0.69, 0.45], [0.705, 0.64, 0.45]], smokeColor: 0xb8b2aa, smokeAlpha: 0.26, ash: false, wet: 1,
  },
  {
    night: [0x04060d, 0x080d1e, 0x111b36, 0x1e2a48], moon: [0.33, 0.13], moonTint: 0xf6f0e2, stars: 1,
    cloud: 0xffe8cc, cloudAlpha: [0.22, 0.3], fog: 0xe0dccc, fogAlpha: 0.16,
    smoke: [[0.186, 0.565, 0.42], [0.292, 0.59, 0.42], [0.198, 0.672, 0.4]], smokeColor: 0xc8c2b8, smokeAlpha: 0.24, ash: false, wet: 1,
  },
];

/** Particle budget per quality level. */
const BUDGET: Record<SurfaceQuality, number> = { high: 1, medium: 0.55, low: 0.22 };

/** Dawn and dusk look the same to `night`; the direction it moves in tells them apart. */
let lastNight = 0;
let rising = true;

/** Expeditions leaving or coming home turn the blast-door wheel. */
let wheelKicks: number[] = [];
let busHooked = false;
function hookBus(): void {
  if (busHooked) return;
  busHooked = true;
  bus.on('mission:start', () => wheelKicks.push(1));
  bus.on('mission:recall', () => wheelKicks.push(-1));
  bus.on('mission:complete', () => wheelKicks.push(-1));
}

const keyed = new Map<string, HTMLCanvasElement>();

/**
 * The topsoil strip is painted on white with grass above and roots below: key out the white reachable from
 * the top and bottom edges (with a colour-to-alpha fringe) once, at runtime.
 */
function keyedStrip(key: string): HTMLCanvasElement | null {
  const hit = keyed.get(key);
  if (hit) return hit;
  const tex = ArtLibrary.get(key);
  const res = tex?.source?.resource as CanvasImageSource | undefined;
  if (!tex || !res) return null;
  const W = tex.source.width, H = tex.source.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(res, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const bg = new Uint8Array(W * H);
  const isBg = (i: number) => {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return 255 - mn < 40 && mx - mn < 30;
  };
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i] || !isBg(i)) continue;
    bg[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1); else stack.push(i - W + 1);
    if (x === 0) stack.push(i + W - 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  // White pockets between crossing grass blades and dangling roots can't be reached by the fill:
  // above and below the soil band every near-white pixel is background.
  for (let y = 0; y < H; y++) {
    if (y > H * 0.36 && y < H * 0.78) continue;
    for (let x = 0; x < W; x++) if (isBg(y * W + x)) bg[y * W + x] = 1;
  }
  // Fringe: three pixels around the background lose their white veil (colour to alpha).
  let zone = bg.slice();
  for (let k = 0; k < 3; k++) {
    const z = zone.slice();
    for (let i = 0; i < W * H; i++) {
      if (zone[i]) continue;
      const x = i % W;
      if ((x > 0 && zone[i - 1]) || (x < W - 1 && zone[i + 1]) || (i >= W && zone[i - W]) || (i < W * (H - 1) && zone[i + W])) z[i] = 1;
    }
    zone = z;
  }
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    if (bg[i]) { d[p + 3] = 0; continue; }
    if (!zone[i]) continue;
    const a = Math.min(1, (255 - Math.min(d[p], d[p + 1], d[p + 2])) / 255 * 1.2);
    if (a < 0.06) { d[p + 3] = 0; continue; }
    for (let ch = 0; ch < 3; ch++) d[p + ch] = Math.max(0, Math.min(255, (d[p + ch] - 255 * (1 - a)) / a));
    d[p + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  keyed.set(key, c);
  return c;
}

/** The keyed strip cut at the grass base: the grass sways, the soil and roots stay put. */
const stripParts = new Map<string, [Texture, Texture, number]>();
function splitStrip(key: string, c: HTMLCanvasElement): [Texture, Texture, number] {
  const hit = stripParts.get(key);
  if (hit) return hit;
  const split = Math.round(c.height * 0.4);
  const crop = (y: number, h: number) => {
    const o = document.createElement('canvas');
    o.width = c.width;
    o.height = h;
    o.getContext('2d')!.drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
    return canvasTexture(o, true);
  };
  const out: [Texture, Texture, number] = [crop(0, split + 1), crop(split, c.height - split), split / c.height];
  stripParts.set(key, out);
  return out;
}

/**
 * The topsoil as two meshes that follow the rolling ground line: the grass fringe (its tip row leans in the
 * wind) and the soil band whose thickness varies, with a ragged dark blend into the rock below.
 */
function buildGround(key: string, c: HTMLCanvasElement): { layer: Container; sway: (t: number, wind: number) => void } {
  const [grassTex, soilTex, splitF] = splitStrip(key, c);
  const layer = new Container();
  const k = SOIL_H / c.height;
  const rep = c.width * k;
  const x0 = WORLD_LEFT - GROUND_EXT, x1 = WORLD_RIGHT + GROUND_EXT, SEG = 14;
  const N = Math.ceil((x1 - x0) / SEG) + 1;
  const xs = new Float32Array(N);
  for (let i = 0; i < N; i++) xs[i] = x0 + i * SEG;
  const mesh = (tex: Texture, rows: number[], rowY: (x: number, r: number) => number) => {
    const R = rows.length;
    const v = new Float32Array(N * R * 2), uv = new Float32Array(N * R * 2), idx = new Uint32Array((N - 1) * (R - 1) * 6);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < N; i++) {
        const p = (j * N + i) * 2;
        v[p] = xs[i];
        v[p + 1] = rowY(xs[i], rows[j]);
        uv[p] = (xs[i] - x0 + 37) / rep;
        uv[p + 1] = j / (R - 1);
      }
    }
    let q = 0;
    for (let j = 0; j < R - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, cc = a + N, d = cc + 1;
        idx[q++] = a; idx[q++] = b; idx[q++] = cc;
        idx[q++] = b; idx[q++] = d; idx[q++] = cc;
      }
    }
    return new MeshSimple({ texture: tex, vertices: v, uvs: uv, indices: idx });
  };
  // Texture row r sits at ground + (r - SOIL_TOP) * SOIL_H; below the grass base the band swells and thins.
  const base = (x: number) => ground(x) - 4;
  const grassRows = [0, 0.55, 1].map(f => f * splitF);
  const grass = mesh(grassTex, grassRows, (x, r) => base(x) + (r - SOIL_TOP) * SOIL_H);
  const soilRows = [0, 0.5, 1].map(f => splitF + f * (1 - splitF));
  const soil = mesh(soilTex, soilRows, (x, r) => base(x) + (r - SOIL_TOP) * SOIL_H * (r > SOIL_TOP ? soilThickness(x) : 1));
  soil.autoUpdate = false;

  // The soil meets the rock along a ragged, darker seam (the painted roots hang over it).
  const edge = (x: number) => base(x) + (0.78 - SOIL_TOP) * SOIL_H * soilThickness(x);
  const rnd = seeded(313);
  const blend = new Graphics();
  const top: number[] = [], bottom: number[] = [];
  for (let x = x0; x <= x1 + 24; x += 24) {
    top.push(x, edge(x) - 6);
    bottom.push(x, edge(x) + 12 + rnd() * 9 + 5 * Math.sin(x * 0.041));
  }
  const pts = [...top];
  for (let i = bottom.length - 2; i >= 0; i -= 2) pts.push(bottom[i], bottom[i + 1]);
  blend.poly(pts).fill(vGradient([[0, 0x000000, 0.42], [0.45, 0x0a0604, 0.25], [1, 0x000000, 0]]));
  // Stones half-buried at the seam break its line; an old cut pipe and a conduit show in the section.
  const stones = new Graphics();
  for (let n = 0; n < 16; n++) {
    const x = x0 + 40 + rnd() * (x1 - x0 - 80);
    const y = edge(x) + (rnd() - 0.6) * 6;
    const r = 2.6 + rnd() * 3.4;
    const p: number[] = [];
    for (let a = 0; a < 7; a++) {
      const ang = (a / 7) * Math.PI * 2;
      const rr = r * (0.75 + rnd() * 0.4);
      p.push(x + Math.cos(ang) * rr * 1.25, y + Math.sin(ang) * rr * 0.8);
    }
    const tone = 0.75 + rnd() * 0.5;
    stones.ellipse(x + 0.6, y + r * 0.75, r * 1.3, r * 0.4).fill({ color: 0x000000, alpha: 0.3 });
    stones.poly(p).fill(vGradient([[0, mix(0x8a8070, 0x6a5e50, 1 - tone + 0.5)], [1, 0x2e2822]]));
    stones.ellipse(x - r * 0.3, y - r * 0.35, r * 0.55, r * 0.22).fill({ color: 0xd8c8b0, alpha: 0.18 });
  }
  for (const [px, py, pr] of [[688, 15, 3.6], [-186, 11, 2.6]] as [number, number, number][]) {
    const y = base(px) + py;
    stones.circle(px, y, pr + 0.8).fill({ color: 0x000000, alpha: 0.35 });
    stones.circle(px, y, pr).fill(vGradient([[0, 0x8a5a3a], [1, 0x3a2418]]));
    stones.circle(px, y, pr * 0.62).fill(0x0c0806);
    stones.arc(px, y, pr - 0.4, -2.6, -1.2).stroke({ color: 0xd8a070, width: 0.6, alpha: 0.5 });
  }
  layer.addChild(blend, soil, stones, grass);

  const gv = grass.vertices;
  return {
    layer,
    sway: (t, wind) => {
      // A gust travels along the grass: the tips lean downwind and ripple; the base row stays planted.
      for (let i = 0; i < N; i++) {
        const x = xs[i];
        const s = wind * (1.1 + 1.1 * Math.sin(x * 0.019 - t * 1.7) + 0.5 * Math.sin(x * 0.061 - t * 3.1 + 1.3));
        gv[i * 2] = x + s;
        gv[(N + i) * 2] = x + s * 0.32;
      }
    },
  };
}

const PROP_KEYS = Array.from({ length: 9 }, (_, i) => `kit/prop-${i}`);

/** Load state of the surface pieces, so the renderer rebuilds when they arrive. */
export function surface2Sig(era: number): string {
  const keys = [portalFor(era).key, 'kit/wheel', era >= 2 ? 'kit/topsoil-L' : 'kit/topsoil-R', ...PROP_KEYS];
  return keys.map(k => (ArtLibrary.get(k) ? '1' : '0')).join('');
}

let mounted: Surface2 | null = null;

// [LateGame B1] Small markers for finished big projects, drawn with plain shapes on the surface line.
let projectIds: string[] = [];
let markLayer: Container | null = null;
const MARK_X: Record<string, number> = { radioMast: -190, purifier: 250, greenhouse: 345, metroTunnel: 650, archive: 850, wall: 140 };

function drawMarks(): void {
  const layer = markLayer;
  if (!layer || layer.destroyed) return;
  layer.removeChildren().forEach(c => c.destroy());
  for (const id of projectIds) {
    const x = MARK_X[id];
    if (x === undefined) continue;
    const y = PROP_BASE + ground(x);
    const g = new Graphics();
    if (id === 'radioMast') {
      g.rect(-2, -150, 4, 150).fill(0x8a8f98);
      g.rect(-14, -150, 28, 3).fill(0x8a8f98);
      g.circle(0, -154, 4).fill(0xff3a3a);
    } else if (id === 'purifier') {
      g.rect(-22, -34, 44, 34).fill(0x5a7a8a);
      g.rect(-26, -40, 52, 8).fill(0x7aa0b4);
      g.rect(-4, -62, 8, 22).fill(0x4a6a7a);
    } else if (id === 'greenhouse') {
      g.rect(-30, -26, 60, 26).fill({ color: 0x9fe8a8, alpha: 0.45 });
      g.poly([-34, -26, 0, -46, 34, -26]).fill({ color: 0x7ac48a, alpha: 0.6 });
      g.rect(-30, -26, 60, 2).fill(0x4a6a4a);
    } else if (id === 'metroTunnel') {
      g.rect(-26, -30, 52, 30).fill(0x4a4048);
      g.circle(0, -18, 14).fill(0x14121a);
      g.rect(-26, -34, 52, 5).fill(0x6a6a70);
    } else if (id === 'archive') {
      g.rect(-20, -38, 40, 38).fill(0x8a7a5a);
      g.rect(-24, -44, 48, 7).fill(0xa8946a);
      g.rect(-4, -20, 8, 20).fill(0x3a2e22);
    } else if (id === 'wall') {
      g.rect(-70, -30, 140, 30).fill(0x6a6a70);
      for (let k = -70; k < 70; k += 20) g.rect(k, -38, 12, 8).fill(0x7a7a80);
    }
    g.position.set(x, y);
    layer.addChild(g);
  }
}

/** Called by the app when the set of finished projects changes. */
export function setSurfaceProjects(ids: string[]): void {
  projectIds = ids;
  drawMarks();
}

/** Puts the soil above the underground and the portal above the shaft; drops the previous surface's layers. */
export function mountSurface2(s: Surface2, world: Container, underground: Container, shaft: Container): void {
  if (mounted && mounted !== s) {
    mounted.soil.destroy({ children: true });
    mounted.front.destroy({ children: true });
  }
  mounted = s;
  world.addChildAt(s.soil, world.getChildIndex(underground) + 1);
  world.addChildAt(s.front, world.getChildIndex(shaft) + 1);
}

function glow(x: number, y: number, size: number, color: number): Sprite {
  const s = new Sprite(glowTexture());
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.width = s.height = size;
  s.tint = color;
  s.blendMode = 'add';
  return s;
}

function contactShadow(x: number, y: number, w: number): Sprite {
  const s = new Sprite(glowTexture());
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.width = w;
  s.height = Math.max(5, w * 0.12);
  s.tint = 0x000000;
  s.alpha = 0.5;
  return s;
}

/** A tiling band (cloud or fog) across the whole sky, `h` world units tall. */
function band(tex: Texture, y: number, h: number, tile: number): TilingSprite {
  const x0 = WORLD_LEFT - SKY_EXT, x1 = WORLD_RIGHT + SKY_EXT;
  const s = new TilingSprite({ texture: tex, width: x1 - x0, height: h });
  s.position.set(x0, y);
  s.tileScale.set(tile / tex.width, h / tex.height);
  return s;
}

/** Wall-clock showers: a slow beat of two waves, raining roughly a sixth of the time in the wet eras. */
function rainNow(wet: number): number {
  const T = Date.now() / 1000;
  const w = 0.5 + 0.5 * (0.6 * Math.sin(T / 577 + 1.3) + 0.4 * Math.sin(T / 233 + 0.4));
  return smoothstep(0.86 - 0.2 * wet, 0.97 - 0.15 * wet, w);
}

export function buildSurface2(
  backdrop: Texture | null, rayTexture: Texture | null, rayColor: number, era: number, getNight: () => number,
): Surface2 {
  hookBus();
  const root = new Container();
  const far = new Container();
  const farBack = new Container();
  const nightSky = new Container();
  const clouds = new Container();
  const farLand = new Container();
  const farFx = new Container();
  const mid = new Container();
  const lit = new Container();
  const glows = new Container();
  const soil = new Container();
  const front = new Container();
  const frontLit = new Container();
  const frontSmoke = new Container();
  const frontGlows = new Container();
  root.eventMode = 'none';
  soil.eventMode = front.eventMode = 'none';
  front.addChild(frontLit, frontSmoke, frontGlows);
  far.addChild(farBack, nightSky, clouds, farLand, farFx);
  const rnd = seeded(77);
  const w = WORLD_RIGHT - WORLD_LEFT;
  const sky = ERA_SKY[Math.max(0, Math.min(3, era))];
  let quality: SurfaceQuality = 'high';

  // ---------- Sky and panorama (on the slow parallax layer) ----------
  let painted: Sprite | null = null;
  const info = backdrop ? analyseSky(backdrop, era) : null;
  // The painting spans [px0, px0 + pw] × [py0, 0.16 × its height below ground].
  const pw = w + 40, px0 = WORLD_LEFT - 20;
  let ph = 600, py0 = -500;
  const skyX0 = WORLD_LEFT - SKY_EXT, skyX1 = WORLD_RIGHT + SKY_EXT;
  if (backdrop) {
    const scale = pw / backdrop.width;
    ph = backdrop.height * scale;
    py0 = -ph * 0.84;
    // The sky above the painting continues its top colour and darkens into the void (far zoom).
    const ext = new Graphics();
    const topC = info?.top ?? 0x0c0b10;
    ext.rect(skyX0, -2600, skyX1 - skyX0, py0 + 2606).fill(vGradient([[0, VOID], [0.72, mix(VOID, topC, 0.5)], [1, topC]]));
    farBack.addChild(ext);
    // Mirrored copies continue the land past the world edges (they fade into the dark, see the vignette).
    for (const [x, sx] of [[px0, -scale], [px0, scale], [px0 + 2 * pw, -scale]] as [number, number][]) {
      const s = new Sprite(backdrop);
      s.scale.set(sx, scale);
      s.position.set(x, py0);
      farBack.addChild(s);
      if (sx > 0) painted = s;
      if (info) {
        const l = new Sprite(info.land);
        l.scale.set(sx * (backdrop.width / info.land.width), scale * (backdrop.height / info.land.height));
        l.position.set(x, py0);
        farLand.addChild(l);
      }
    }
  } else {
    const g = new Graphics();
    g.rect(WORLD_LEFT, SKY_TOP, w, -SKY_TOP).fill(vGradient([[0, 0x14101e], [0.55, 0x3a2430], [0.85, 0x7a4a2e], [1, 0x9a6a3a]]));
    farBack.addChild(g);
  }

  // Night: a deep gradient sky with stars and a moon, behind the painted skyline (the land cut-out).
  {
    const g = new Graphics();
    const [c0, c1, c2, c3] = sky.night;
    g.rect(skyX0, -2600, skyX1 - skyX0, py0 - 300 + 2600).fill(c0);
    g.rect(skyX0, py0 - 300, skyX1 - skyX0, 360 + ph * 0.84).fill(vGradient([[0, c0], [0.3, c1], [0.62, c2], [0.92, c3], [1, c3]]));
    nightSky.addChild(g);
  }
  const stars: { s: Sprite; a: number; ph: number; rate: number }[] = [];
  {
    const sr = seeded(1999);
    const mt = moteTexture();
    for (let i = 0; i < 170; i++) {
      // Denser and brighter high up; thinning toward the horizon haze.
      const fy = Math.pow(sr(), 1.6) * 0.62;
      const x = px0 - 300 + sr() * (pw + 600), y = py0 - 160 + fy * (ph * 0.84 + 160);
      const s = new Sprite(mt);
      s.anchor.set(0.5);
      s.position.set(x, y);
      const big = sr() < 0.08;
      s.width = s.height = big ? 2.6 + sr() * 1.4 : 1 + sr() * 1.3;
      s.tint = [0xffffff, 0xdfe8ff, 0xfff0d8, 0xcfdcff][Math.floor(sr() * 4)];
      s.blendMode = 'add';
      nightSky.addChild(s);
      stars.push({ s, a: (big ? 1 : 0.45 + sr() * 0.5) * (1 - fy) * sky.stars, ph: sr() * 10, rate: 0.6 + sr() * 2.4 });
    }
    const mx = px0 + sky.moon[0] * pw, my = py0 + sky.moon[1] * ph;
    const halo = glow(mx, my, 120, sky.moonTint);
    halo.alpha = 0.22;
    const halo2 = glow(mx, my, 44, sky.moonTint);
    halo2.alpha = 0.35;
    const moon = new Sprite(moonTexture());
    moon.anchor.set(0.5);
    moon.position.set(mx, my);
    moon.width = moon.height = 24;
    moon.tint = sky.moonTint;
    nightSky.addChild(halo, halo2, moon);
  }
  nightSky.visible = false;

  // Clouds: two banks drifting at their own speeds; they pass behind the painted skyline.
  const cloudHigh = band(cloudTexture(0), py0 - 40, 190, 980);
  const cloudLow = band(cloudTexture(1), py0 + ph * 0.16, 200, 820);
  cloudHigh.tilePosition.x = 210;
  clouds.addChild(cloudHigh, cloudLow);
  clouds.visible = !!backdrop;
  // Lightning lights the sky behind the silhouettes.
  const flash = new Sprite(Texture.WHITE);
  flash.position.set(skyX0, py0 - 400);
  flash.width = skyX1 - skyX0;
  flash.height = ph + 400;
  flash.tint = 0xd8e0ff;
  flash.blendMode = 'add';
  flash.alpha = 0;
  clouds.addChild(flash);

  // Haze: a band over the horizon and a thin ground mist (on a half-speed parallax layer).
  const haze = band(fogTexture(), -110, 96, 900);
  const mist = band(fogTexture(), -44, 46, 640);
  mist.tilePosition.x = 333;
  mid.addChild(haze, mist);

  // Smoke from chimneys and burning ruins in the painting; the first era's ruins smoulder.
  const farSmoke: Smoke[] = [];
  if (backdrop) {
    sky.smoke.forEach(([fx, fy, size], i) => {
      farSmoke.push(new Smoke(farFx, {
        x: px0 + fx * pw, y: py0 + fy * ph, rate: era === 0 ? 1.6 : 1.1, life: era === 0 ? 11 : 8, rise: era === 0 ? 9 : 6,
        size: [5 * size, (era === 0 ? 46 : 26) * size], alpha: sky.smokeAlpha, color: sky.smokeColor, drift: 7,
      }, era === 0 ? 18 : 10, 101 + i * 7));
    });
  }

  // Birds over the panorama; bats around the entrance at night.
  const batLayer = new Container();
  const birds = backdrop ? new Birds(farFx, batLayer, era, [px0 - 60, px0 + pw + 60], [py0 + ph * 0.1, py0 + ph * 0.42], [PORTAL_X + 70, -92]) : null;

  const rays = new Container();
  rays.blendMode = 'add';
  const shafts: { s: Sprite; base: number; ph: number }[] = [];
  if (rayTexture) {
    for (let i = 0; i < 6; i++) {
      const s = new Sprite(rayTexture);
      s.anchor.set(0.5, 0);
      s.tint = rayColor;
      s.width = 70 + rnd() * 90;
      s.height = 340;
      const base = -0.5 + rnd() * 0.35;
      s.rotation = base;
      s.position.set(BUILDING_W * (0.35 + rnd() * 0.7), SKY_TOP - 40);
      s.alpha = 0;
      rays.addChild(s);
      shafts.push({ s, base, ph: rnd() * 10 });
    }
  }

  // The clean painted portal and props are graded toward the panorama's light.
  const grade = info ? lightGrade(info.light, era === 0 ? 0.42 : 0.3) : 0xffffff;

  // ---------- Props ----------
  const blinkers: { s: Sprite; ph: number }[] = [];
  const nightLamps: { s: Sprite; day: number; night: number; ph: number }[] = [];
  const swayers: { s: Sprite; k: number; ph: number }[] = [];
  const props = new Container();
  for (const p of PROPS) {
    if (era < p.from || era > p.to) continue;
    const tex = ArtLibrary.get(`kit/prop-${p.i}`);
    if (!tex) continue;
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    const k = p.h / tex.height;
    const gy = PROP_BASE + ground(p.x);
    s.scale.set(p.flip ? -k : k, k);
    s.position.set(p.x, gy);
    s.tint = grade;
    props.addChild(contactShadow(p.x, gy - 1, tex.width * k * 0.9), s);
    if (p.sway) swayers.push({ s, k: p.sway, ph: p.x * 0.02 });
    const lamp = PROP_LAMP[p.i];
    if (lamp && era >= 1) {
      const lx = p.x + (p.flip ? -1 : 1) * (lamp[0] - 0.5) * tex.width * k;
      const ly = gy - (1 - lamp[1]) * p.h;
      if (p.i === 8) {
        const g = glow(lx, ly, 22, lamp[2]);
        glows.addChild(g);
        blinkers.push({ s: g, ph: rnd() * 6 });
      } else {
        const g = glow(lx, ly, 46, lamp[2]);
        glows.addChild(g);
        nightLamps.push({ s: g, day: 0, night: 0.85, ph: rnd() * 6 });
      }
    }
  }
  lit.addChild(props);
  markLayer = new Container(); // [LateGame B1]
  lit.addChild(markLayer);
  drawMarks();

  // ---------- Topsoil cross-section (above the rock painting) ----------
  const soilKey = era >= 2 ? 'kit/topsoil-L' : 'kit/topsoil-R';
  const soilCanvas = keyedStrip(soilKey);
  let sway: ((t: number, wind: number) => void) | null = null;
  if (soilCanvas) {
    const g = buildGround(soilKey, soilCanvas);
    sway = g.sway;
    soil.addChild(g.layer);
  } else {
    // While the strip loads: a plain earth line (the old look).
    const g = new Graphics();
    g.rect(WORLD_LEFT, -8, w, 10).fill(0x4a3a2a);
    soil.addChild(g);
  }
  // Past the world's sides the rock and the soil fade into the dark.
  {
    const v = new Graphics();
    v.rect(WORLD_LEFT - SKY_EXT, -46, SKY_EXT + 60, 6000).fill(hGradient([[0, VOID, 1], [0.86, VOID, 1], [0.97, VOID, 0.55], [1, VOID, 0]]));
    v.rect(WORLD_RIGHT - 60, -46, SKY_EXT + 60, 6000).fill(hGradient([[0, VOID, 0], [0.03, VOID, 0.55], [0.14, VOID, 1], [1, VOID, 1]]));
    soil.addChild(v);
  }

  // ---------- Entrance portal over the shaft ----------
  const look = portalFor(era);
  const ptex = ArtLibrary.get(look.key);
  let wheel: Sprite | null = null;
  let rim: Sprite | null = null;
  let vent: Smoke | null = null;
  const flood: Sprite[] = [];
  if (ptex) {
    const k = PORTAL_W / ptex.width;
    const pph = ptex.height * k;
    const left = PORTAL_X - PORTAL_W / 2, top = 3 - pph;
    frontLit.addChild(contactShadow(PORTAL_X, 0, PORTAL_W * 0.95));
    // The bunker's exhaust stack pokes out of the mound behind the door frame.
    {
      const vx = left + look.vent[0] * PORTAL_W, vy = top + look.vent[1] * pph;
      const stack = new Graphics();
      stack.rect(vx - 2.4, vy, 4.8, 30).fill(hGradient([[0, 0x2a2622], [0.35, era <= 0 ? 0x6a5444 : 0x6e6a62], [1, 0x1e1c1a]]));
      stack.rect(vx - 2.4, vy + 6, 4.8, 1.2).fill({ color: 0x000000, alpha: 0.35 });
      stack.rect(vx - 1.2, vy + 9, 0.9, 12).fill({ color: 0x6a3a1e, alpha: 0.45 });
      // Rain cap on two short legs.
      stack.rect(vx - 2, vy - 3, 0.8, 3).fill(0x2a2622);
      stack.rect(vx + 1.2, vy - 3, 0.8, 3).fill(0x2a2622);
      stack.poly([vx - 5, vy - 3, vx, vy - 6.2, vx + 5, vy - 3, vx + 4.4, vy - 2.2, vx - 4.4, vy - 2.2]).fill(vGradient([[0, 0x8a847a], [1, 0x3a3632]]));
      stack.tint = grade;
      frontLit.addChild(stack);
      vent = new Smoke(frontSmoke, {
        x: vx, y: vy - 3, rate: 2.2, life: 4.2, rise: 13, size: [3, 22], alpha: era <= 0 ? 0.32 : 0.24,
        color: era <= 0 ? 0x8a8078 : 0xe4e0d8, drift: 9,
      }, 14, 23);
    }
    const sil = silhouetteTexture(look.key, ptex);
    if (sil) {
      // Sun-side rim: a light copy of the silhouette peeks past the right and top edges.
      rim = new Sprite(sil);
      rim.scale.set(k);
      rim.position.set(left + 1.1, top - 0.9);
      rim.tint = rayColor;
      frontLit.addChild(rim);
    }
    const portal = new Sprite(ptex);
    portal.scale.set(k);
    portal.position.set(left, top);
    portal.tint = grade;
    frontLit.addChild(portal);
    const wtex = ArtLibrary.get('kit/wheel');
    if (wtex) {
      wheel = new Sprite(wtex);
      wheel.anchor.set(0.5);
      wheel.width = wheel.height = PORTAL_W * (era >= 3 ? 0.062 : 0.07);
      wheel.position.set(left + look.hub[0] * PORTAL_W, top + look.hub[1] * pph);
      if (era >= 3) wheel.tint = 0xe8c070;
      else if (era <= 0) wheel.tint = 0xb08a70;
      frontLit.addChild(wheel);
    }
    for (const [lx, ly] of look.lamps) {
      const x = left + lx * PORTAL_W, y = top + ly * pph;
      const g = glow(x, y, look.flood ? 60 : 34, look.flood ? 0xfff0d0 : 0xffc870);
      frontGlows.addChild(g);
      nightLamps.push({ s: g, day: 0.12, night: 0.9, ph: rnd() * 6 });
      if (look.flood) {
        // Floodlights throw a cone down onto the approach.
        const cone = new Sprite(glowTexture());
        cone.anchor.set(0.5, 0.15);
        cone.position.set(x + (x < PORTAL_X ? 14 : -14), y + 4);
        cone.width = 70;
        cone.height = 120;
        cone.rotation = x < PORTAL_X ? -0.35 : 0.35;
        cone.tint = 0xfff0d0;
        cone.blendMode = 'add';
        frontGlows.addChild(cone);
        flood.push(cone);
      }
    }
    // The bunker's number, stencilled on a small steel plate bolted to the concrete beside the door.
    {
      const px = left + 0.735 * PORTAL_W, py = top + 0.5 * pph;
      const plate = new Graphics();
      plate.roundRect(-10, -6, 20, 12, 1).fill(era <= 0 ? 0x2c2a26 : 0x34332e).stroke({ color: 0x0e0c0a, width: 0.8 });
      plate.rect(-9, -5.4, 18, 0.8).fill({ color: 0xffffff, alpha: 0.18 });
      for (const [rx, ry] of [[-8, -4], [8, -4], [-8, 4], [8, 4]]) plate.circle(rx, ry, 0.7).fill(0x8a8478);
      const num = new Text({
        text: '17',
        style: { fontFamily: 'Karantina, sans-serif', fontSize: 30, fontWeight: '700', fill: era <= 0 ? 0x9a8248 : 0xd9a441 },
        resolution: 2,
      });
      num.anchor.set(0.5);
      num.scale.set(0.3);
      num.alpha = era <= 0 ? 0.7 : 0.95;
      plate.position.set(px, py);
      num.position.set(px, py + 0.4);
      if (era <= 0) plate.rotation = num.rotation = 0.06;
      frontLit.addChild(plate, num);
    }
    if (look.beacon) {
      const g = glow(left + look.beacon[0] * PORTAL_W, top + look.beacon[1] * pph, 22, 0xff3a3a);
      frontGlows.addChild(g);
      blinkers.push({ s: g, ph: 0 });
    }
  } else {
    // While the painting loads: the old grey entrance block outline.
    const g = new Graphics();
    g.rect(-14, -52, SHAFT_W + 70, 52).fill(0x6a6a70);
    frontLit.addChild(g);
  }

  // ---------- Wind: dust (by day) and fireflies (at night) drifting along the ground ----------
  const dust = new Container();
  dust.blendMode = 'add';
  const motes: { s: Sprite; x: number; y: number; v: number; ph: number; size: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const s = new Sprite(moteTexture());
    s.anchor.set(0.5);
    const size = 1.5 + rnd() * 2.5;
    s.width = s.height = size;
    dust.addChild(s);
    motes.push({ s, x: WORLD_LEFT + rnd() * w, y: -2 - rnd() * 26, v: 10 + rnd() * 18, ph: rnd() * 10, size });
  }

  // ---------- Weather ----------
  const weatherLayer = new Container();
  const weather = new Weather(weatherLayer, x => ground(x) - 2);

  // ---------- Far zoom: the sky's sides fade into the dark ----------
  const vignette = new Graphics();
  vignette.rect(skyX0, -2600, SKY_EXT + 80, 2600).fill(hGradient([[0, VOID, 1], [0.6, VOID, 0.92], [0.88, VOID, 0.45], [1, VOID, 0]]));
  vignette.rect(WORLD_RIGHT - 80, -2600, SKY_EXT + 80, 2600).fill(hGradient([[0, VOID, 0], [0.12, VOID, 0.45], [0.4, VOID, 0.92], [1, VOID, 1]]));

  root.addChild(far, rays, mid, lit, glows, batLayer, dust, weatherLayer, vignette);
  // Sun haze fallback when there is no painting.
  if (!backdrop) {
    const sun = new Graphics();
    softGlow(sun, BUILDING_W * 0.78, -150, 170, 120, 0xff8a4a, 0.35);
    sun.blendMode = 'add';
    root.addChildAt(sun, 1);
  }

  let lastT = -1;
  let spin = 0, spinFrom = 0, spinTo = 0, spinT0 = -10;
  const SPIN_DUR = 2.6;
  let flashAge = 9;
  const view: View = { x0: WORLD_LEFT, x1: WORLD_RIGHT, y0: -400, y1: 400 };
  const lr = seeded(5150);

  return {
    container: root,
    soil,
    front,
    setQuality: q => { quality = q; },
    animate: (t, power) => {
      // A replaced surface can still get one call after it was destroyed (the sprites are gone by then).
      if (root.destroyed) return;
      const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const budget = BUDGET[quality];

      // Camera: the visible world rectangle, read from the world container's transform.
      const wc = root.parent?.parent;
      if (wc && wc.scale.x > 0) {
        const s = wc.scale.x;
        view.x0 = -wc.x / s;
        view.x1 = (window.innerWidth - wc.x) / s;
        view.y0 = -wc.y / s;
        view.y1 = (window.innerHeight - wc.y) / s;
      }
      const surfaceShown = view.y0 < 60;
      // Parallax: the panorama follows the camera a little, so it reads as far away.
      const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
      const ox = Math.max(-30, Math.min(30, (cx - BUILDING_W / 2) * PAR_X));
      const oy = Math.max(-18, Math.min(42, (cy - PAR_REF_Y) * PAR_Y));
      far.position.set(ox, oy);
      mid.position.set(ox * 0.5, oy * 0.5);

      // Weather: showers by the wall clock (or `window.__weather` = 'rain' | 'storm' | 'ash' | 'clear' in dev).
      const dev = (window as unknown as { __weather?: string }).__weather;
      let rain = dev === 'rain' || dev === 'storm' ? 1 : dev === 'clear' || dev === 'ash' ? 0 : rainNow(sky.wet);
      const ash = sky.ash || dev === 'ash' ? (dev === 'clear' ? 0 : (0.6 + 0.4 * Math.sin(t * 0.05)) * (1 - rain)) : 0;
      if (!Number.isFinite(rain)) rain = 0;

      // Clock tint: dawn / day / dusk / night, greyed under rain.
      const night = Math.max(0, Math.min(1, getNight()));
      if (Math.abs(night - lastNight) > 1e-5) rising = night > lastNight;
      lastNight = night;
      const mid0 = rising ? DUSK : DAWN;
      const clock = night < 0.5 ? mix(0xffffff, mid0, night / 0.5) : mix(mid0, NIGHT, (night - 0.5) / 0.5);
      const tint = rain > 0.01 ? mulColor(clock, mix(0xffffff, 0x98a2b0, rain * 0.7)) : clock;
      farBack.tint = farLand.tint = farFx.tint = tint;
      lit.tint = soil.tint = frontLit.tint = frontSmoke.tint = tint;

      // Night sky over the painted sunset (the painted sun goes with it).
      const nightA = smoothstep(0.3, 0.85, night) * 0.97;
      nightSky.visible = nightA > 0.005;
      nightSky.alpha = nightA;
      if (nightSky.visible) {
        const shown = Math.round(stars.length * (quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1));
        const cloudy = 1 - 0.75 * rain;
        for (let i = 0; i < stars.length; i++) {
          const st = stars[i];
          st.s.visible = i < shown;
          if (st.s.visible) st.s.alpha = st.a * cloudy * (0.65 + 0.35 * Math.sin(t * st.rate + st.ph));
        }
      }

      // Clouds drift with the wind; they thicken and grey in rain, darken at night.
      const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
      const wind = gust * (1 + 0.6 * rain);
      cloudHigh.tilePosition.x += dt * 3.2 * (0.7 + 0.3 * wind);
      cloudLow.tilePosition.x += dt * 6.5 * (0.6 + 0.4 * wind);
      const cTint = mulColor(mix(sky.cloud, 0x9aa2b2, rain * 0.75), mix(0xffffff, 0x2a3048, smoothstep(0.2, 0.9, night)));
      cloudHigh.tint = cloudLow.tint = cTint;
      cloudHigh.alpha = (sky.cloudAlpha[0] + 0.25 * rain) * (1 - 0.35 * nightA);
      cloudLow.alpha = (sky.cloudAlpha[1] + 0.35 * rain) * (1 - 0.3 * nightA);
      cloudLow.visible = quality !== 'low';

      // Haze over the horizon; denser at dawn, dusk and in rain, moonlit blue at night.
      haze.tilePosition.x += dt * 2.2 * wind;
      mist.tilePosition.x += dt * 4.5 * wind;
      const fogC = mix(mix(sky.fog, 0xa8b0bc, rain * 0.6), 0x4a5878, smoothstep(0.3, 0.9, night));
      haze.tint = mist.tint = fogC;
      const twilight = 1 - Math.abs(night - 0.5) * 2;
      haze.alpha = Math.min(0.7, sky.fogAlpha * (1 + 0.6 * twilight + 0.9 * rain) * (1 - 0.35 * nightA));
      mist.alpha = haze.alpha * 0.75;
      mist.visible = quality !== 'low';

      // Lightning in heavy rain (not in the ash era): a double flicker behind the skyline.
      flashAge += dt;
      if (era >= 1 && rain > 0.7 && lr() < dt / (dev === 'storm' ? 5 : 28)) flashAge = 0;
      flash.alpha = flashAge < 0.7 ? 0.42 * Math.exp(-flashAge * 10) + (flashAge > 0.16 ? 0.3 * Math.exp(-(flashAge - 0.16) * 7) : 0) : 0;
      flash.visible = flash.alpha > 0.003;

      const dark = Math.min(1, Math.max(0, (night - 0.25) / 0.5));
      const on = Math.max(0, Math.min(1, power));
      for (const l of nightLamps) {
        const flick = 0.94 + 0.06 * Math.sin(t * 9 + l.ph) * Math.sin(t * 3.3 + l.ph);
        l.s.alpha = (l.day + (l.night - l.day) * dark) * on * flick;
      }
      for (const c of flood) c.alpha = 0.22 * dark * on;
      for (const b of blinkers) b.s.alpha = (Math.sin(t * 3 + b.ph) > 0.3 ? 0.55 + 0.45 * dark : 0.08) * Math.max(0.3, on);
      for (const r of shafts) {
        r.s.rotation = r.base + Math.sin(t * 0.07 + r.ph) * 0.05;
        r.s.alpha = (0.06 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.21 + r.ph))) * (1 - night) * (1 - rain);
      }
      if (rim) rim.alpha = 0.55 * (1 - smoothstep(0.2, 0.6, night)) * (1 - rain);

      // Life: grass and weeds lean in the wind; smoke columns; birds; weather.
      if (surfaceShown) {
        if (sway && quality !== 'low') sway(t, wind);
        for (const p of swayers) p.s.skew.x = p.k * (wind * 0.8 + 0.5 * Math.sin(t * 2.1 + p.ph)) * wind;
        const smokeCap = quality === 'low' ? 0.5 : 1;
        for (const s of farSmoke) s.update(dt, wind, 99, smokeCap * (1 - 0.6 * rain));
        vent?.update(dt, wind, 99, smokeCap * (0.6 + 0.4 * on));
        birds?.update(t, dt, night, rain);
        weather.update(dt, t, view, wind, rain, ash, budget, 1 - 0.55 * dark, era === 0);
      }
      weatherLayer.visible = surfaceShown;

      // Dust by day; fireflies over the grass on clear nights once the valley greens.
      const flies = era >= 1 ? smoothstep(0.55, 0.85, night) * (1 - rain) : 0;
      const nMotes = Math.round(motes.length * (quality === 'low' ? 0.3 : quality === 'medium' ? 0.6 : 1));
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        if (m.s.destroyed) continue;
        m.s.visible = i < nMotes && surfaceShown;
        if (!m.s.visible) continue;
        m.x += m.v * gust * dt * (1 - 0.8 * flies);
        if (m.x > WORLD_RIGHT) { m.x = WORLD_LEFT; m.y = -2 - ((m.ph * 7.3) % 26); }
        if (flies > 0.01) {
          const blink = Math.max(0, Math.sin(t * 1.3 + m.ph * 3));
          m.s.position.set(m.x + Math.sin(t * 0.7 + m.ph) * 8, m.y - 6 + Math.sin(t * 0.9 + m.ph * 2) * 7);
          m.s.tint = mix(0xd8c0a0, 0xd8ff7a, flies);
          m.s.width = m.s.height = m.size * (1 + flies * 0.4);
          m.s.alpha = (0.18 + 0.2 * gust) * (1 - flies) * (1 - night * 0.6) + flies * blink * 0.95;
        } else {
          m.s.position.set(m.x, m.y + Math.sin(t * 1.7 + m.ph) * 3 - gust * 2);
          m.s.tint = 0xd8c0a0;
          m.s.width = m.s.height = m.size;
          m.s.alpha = (0.18 + 0.2 * gust) * (1 - night * 0.6) * (1 - rain);
        }
      }
      // Blast-door wheel: one and a quarter turns when a team leaves (or comes home, the other way).
      if (wheel) {
        if (wheelKicks.length && t - spinT0 > SPIN_DUR) {
          const dir = wheelKicks.shift()!;
          spinFrom = spin;
          spinTo = spin + dir * Math.PI * 2.5;
          spinT0 = t;
        }
        const k = Math.min(1, (t - spinT0) / SPIN_DUR);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        spin = spinFrom + (spinTo - spinFrom) * e;
        wheel.rotation = spin;
      } else if (wheelKicks.length > 4) wheelKicks = wheelKicks.slice(-2);
    },
  };
}
