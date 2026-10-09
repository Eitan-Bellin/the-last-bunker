import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import { ArtLibrary, glowTexture } from '../art/ArtLibrary';
import { SHAFT_W, WALK_Y } from './layout';
import { Smoke, groundY, mulColor } from './surfaceLife';
import { mix } from './draw';
import type { Lane } from './people';
import { SlopArea } from './HitSlop'; // [plan4:ST-12]

/**
 * Big projects on the surface. Every project has its own lot above the bunker: while it is being built the lot
 * shows scaffolding, a fence, the part already standing (it rises with the stages) and a sign with the progress;
 * the crew stands on the lot and works. A finished project leaves its building there for good.
 * Each building is a painting (public/art/kit/proj-<id>.webp, cut from two sheets by tools/kit.html); until it loads,
 * or if it fails, the lot falls back to plain shapes.
 */

export interface SiteInfo {
  id: string;
  /** 0..1: how much of the whole project is built. */
  frac: number;
  /** The project is still being built (show the scaffolding and the sign). */
  building: boolean;
  /** Sign text while building. */
  label: string;
}

/** A lot the renderer puts the crew on (shaped like a ruin view so the people code can use it as is). */
export interface SiteView {
  root: Container;
  people: Container;
  lane: Lane;
  width: number;
  visualSig: string;
}

const PORTAL_X = SHAFT_W / 2;
const BASE = -5;

/** The plain-shape stand-in for a building (shown while its painting loads): its own drawing size and the drawing. */
interface Plan {
  w: number;
  h: number;
  draw: (g: Graphics) => void;
}

const steel = 0x8a8f98, dark = 0x3a3c44, concrete = 0x7a7670, rust = 0x8a5a3a;

const PLANS: Record<string, Plan> = {
  genesisCore: {
    w: 46, h: 96, draw: g => {
      g.rect(-23, -30, 46, 30).fill(dark);
      g.poly([-16, -30, 16, -30, 9, -86, -9, -86]).fill(0x4a4e5a);
      g.circle(0, -90, 10).fill(0x7af0ff).circle(0, -90, 5).fill(0xe8ffff);
      g.rect(-23, -32, 46, 3).fill(steel);
    },
  },
  radioMast: {
    w: 40, h: 170, draw: g => {
      g.poly([-18, 0, -3, -160, 3, -160, 18, 0]).stroke({ color: steel, width: 3 });
      for (let y = -20; y > -150; y -= 22) g.moveTo(-18 * (1 + y / 165), y).lineTo(18 * (1 + (y - 22) / 165), y - 22).stroke({ color: steel, width: 1.5 });
      g.rect(-2, -170, 4, 12).fill(steel);
      g.rect(-14, -132, 28, 3).fill(steel).rect(-10, -100, 20, 3).fill(steel);
      g.circle(0, -173, 4).fill(0xff3a3a);
    },
  },
  constitution: {
    w: 56, h: 74, draw: g => {
      g.rect(-28, -44, 56, 44).fill(0xb8ac94);
      g.poly([-32, -44, 0, -62, 32, -44]).fill(0x9a8e76);
      for (let k = -22; k <= 22; k += 11) g.rect(k - 2.5, -40, 5, 40).fill(0xd8ccb2);
      g.rect(-1, -88, 2, 26).fill(steel);
      g.rect(1, -88, 16, 10).fill(0x3a7ac8);
    },
  },
  surfaceGate: {
    w: 54, h: 112, draw: g => {
      g.rect(-27, -40, 54, 40).fill(concrete);
      g.rect(-17, -34, 34, 34).fill(0x2a2a30).rect(-1, -34, 2, 34).fill(0x55555c);
      g.rect(-24, -112, 5, 72).fill(rust).rect(19, -112, 5, 72).fill(rust);
      g.rect(-27, -114, 54, 6).fill(rust);
      g.circle(0, -104, 8).stroke({ color: 0xc8c8c8, width: 2 });
      g.moveTo(0, -96).lineTo(0, -40).stroke({ color: 0xc8c8c8, width: 1 });
    },
  },
  wall: {
    w: 120, h: 40, draw: g => {
      g.rect(-60, -32, 120, 32).fill(0x6a6a70);
      for (let k = -60; k < 60; k += 20) g.rect(k, -40, 12, 8).fill(0x7a7a80);
      for (let k = -50; k < 60; k += 24) g.rect(k, -22, 14, 3).fill(0x55555a);
    },
  },
  purifier: {
    w: 60, h: 80, draw: g => {
      g.rect(-30, -40, 34, 40).fill(0x5a7a8a);
      g.rect(-34, -46, 42, 8).fill(0x7aa0b4);
      g.circle(18, -22, 12).fill(0x6a8ea0).rect(6, -22, 24, 22).fill(0x6a8ea0);
      g.rect(-18, -80, 8, 34).fill(0x4a6a7a);
      g.rect(4, -10, 26, 3).fill(0x9ad0f0);
    },
  },
  greenhouse: {
    w: 92, h: 56, draw: g => {
      g.ellipse(0, 0, 54, 5).fill({ color: 0x4a8a3a, alpha: 0.8 });
      g.rect(-44, -34, 88, 34).fill({ color: 0x9fe8a8, alpha: 0.42 });
      g.poly([-48, -34, 0, -56, 48, -34]).fill({ color: 0x8ad49a, alpha: 0.55 });
      for (let k = -44; k <= 44; k += 22) g.rect(k - 1, -34, 2, 34).fill(0x4a6a4a);
      g.rect(-44, -35, 88, 2).fill(0x4a6a4a);
      for (let k = -36; k <= 36; k += 12) g.ellipse(k, -6, 5, 6).fill(0x3fa04a);
    },
  },
  skyDome: {
    w: 84, h: 52, draw: g => {
      g.rect(-42, -8, 84, 8).fill(concrete);
      g.arc(0, -8, 40, Math.PI, 0).fill({ color: 0xbfe6ff, alpha: 0.35 });
      g.arc(0, -8, 40, Math.PI, 0).stroke({ color: 0xd8f0ff, width: 2, alpha: 0.9 });
      for (const a of [0.3, 0.55, 0.8]) g.moveTo(-40 * Math.cos(a * Math.PI), -8).lineTo(-40 * Math.cos(a * Math.PI), -8 - 40 * Math.sin(a * Math.PI)).stroke({ color: 0xd8f0ff, width: 1, alpha: 0.6 });
    },
  },
  deepFoundry: {
    w: 64, h: 120, draw: g => {
      g.rect(-32, -36, 64, 36).fill(0x5a4a42);
      g.rect(-24, -118, 12, 82).fill(0x6a5a50).rect(6, -100, 12, 64).fill(0x6a5a50);
      g.rect(-26, -120, 16, 5).fill(dark).rect(4, -102, 16, 5).fill(dark);
      g.rect(-12, -20, 24, 14).fill(0xff8a3a);
    },
  },
  metroTunnel: {
    w: 64, h: 44, draw: g => {
      g.rect(-32, -38, 64, 38).fill(0x4a4048);
      g.arc(0, 0, 20, Math.PI, 0).fill(0x14121a);
      g.rect(-32, -44, 64, 7).fill(0x6a6a70);
      g.rect(-20, -2, 40, 2).fill(steel);
    },
  },
  tradeLeague: {
    w: 76, h: 50, draw: g => {
      const awn = [0xc84a3a, 0xd8a23a, 0x3a8ac8];
      for (let i = 0; i < 3; i++) {
        const x = -38 + i * 26;
        g.rect(x + 2, -28, 3, 28).fill(dark).rect(x + 21, -28, 3, 28).fill(dark);
        g.poly([x, -28, x + 26, -28, x + 22, -40, x + 4, -40]).fill(awn[i]);
        g.rect(x + 4, -12, 18, 12).fill(0x8a6a4a);
      }
      g.rect(-1, -50, 2, 22).fill(steel).rect(1, -50, 12, 8).fill(0xd8a23a);
    },
  },
  archive: {
    w: 56, h: 66, draw: g => {
      g.rect(-28, -50, 56, 50).fill(0x8a7a5a);
      g.rect(-32, -58, 64, 9).fill(0xa8946a);
      for (let k = -18; k <= 18; k += 12) g.rect(k - 3, -42, 6, 10).fill(0xffd890);
      g.rect(-6, -24, 12, 24).fill(0x3a2e22);
    },
  },
  ark: {
    w: 80, h: 64, draw: g => {
      g.poly([-40, -24, 40, -24, 30, 0, -30, 0]).fill(0x6a5038);
      g.rect(-24, -48, 48, 24).fill(0x7a6048);
      g.poly([-28, -48, 0, -64, 28, -48]).fill(0x5a4030);
      g.circle(-10, -36, 4).fill(0xffd890).circle(10, -36, 4).fill(0xffd890);
    },
  },
  vaultSeal: {
    w: 40, h: 58, draw: g => {
      g.rect(-20, -58, 40, 58).fill(concrete);
      g.circle(0, -30, 15).fill(0x9a9a9a).circle(0, -30, 11).fill(0x6a6a6a);
      for (let a = 0; a < 6; a++) g.moveTo(0, -30).lineTo(11 * Math.cos(a), -30 + 11 * Math.sin(a)).stroke({ color: 0xbababa, width: 1.5 });
      g.rect(-20, -60, 40, 4).fill(0xd8a23a);
    },
  },
};

/**
 * Scale: an adult is about 48 units (1.75 m), so a metre is about 27 units. Buildings are drawn a little under
 * life size (a game's usual squeeze), but always well above the people: from a market stall (about 3 m) to the
 * radio mast and the foundry chimneys (8 to 10 m).
 */
const LOT_H: Record<string, number> = {
  vaultSeal: 120, radioMast: 260, purifier: 150, greenhouse: 105, metroTunnel: 125, archive: 175, wall: 115,
  deepFoundry: 210, surfaceGate: 210, skyDome: 115, tradeLeague: 85, constitution: 140, ark: 130, genesisCore: 185,
};
/** Width / height of each cut painting (public/art/kit/proj-<id>.webp). */
const ASPECT: Record<string, number> = {
  vaultSeal: 512 / 437, radioMast: 438 / 512, purifier: 512 / 392, greenhouse: 512 / 304, metroTunnel: 512 / 463,
  archive: 512 / 376, wall: 512 / 431, deepFoundry: 512 / 501, surfaceGate: 512 / 441, skyDome: 512 / 315,
  tradeLeague: 512 / 215, constitution: 512 / 350, ark: 512 / 305, genesisCore: 512 / 432,
};
/** Lots in the order the Acts open them, west to east: the settlement grows away from the entrance as the run goes on. */
const ORDER = ['vaultSeal', 'radioMast', 'purifier', 'greenhouse', 'metroTunnel', 'archive', 'wall', 'deepFoundry',
  'surfaceGate', 'skyDome', 'tradeLeague', 'constitution', 'ark', 'genesisCore'];
/** Every other lot stands a step back (smaller, higher, dimmer), so neighbours may overlap a little and read as depth. */
const BACK_SCALE = 0.85, BACK_RISE = 16;
/** Neighbours overlap by this share of their half-widths. */
const OVERLAP = 0.18;
/** First lot: just east of the entrance hill (it hides x < ~170). */
const FIRST_X = 250;

interface Lot { x: number; back: boolean; w: number; h: number }
const LOTS: Record<string, Lot> = {};
{
  let prevX = 0, prevHalf = 0;
  ORDER.forEach((id, i) => {
    const back = i % 2 === 1;
    const h = LOT_H[id];
    const w = h * ASPECT[id];
    const half = (w * (back ? BACK_SCALE : 1)) / 2;
    const x = i === 0 ? FIRST_X : prevX + (prevHalf + half) * (1 - OVERLAP);
    LOTS[id] = { x: Math.round(x), back, w, h };
    prevX = x;
    prevHalf = half;
  });
}

/** Right edge of a lot (the camera reaches the easternmost lot that has something on it). */
export function lotRight(id: string): number {
  const l = LOTS[id];
  return l ? l.x + (l.w * (l.back ? BACK_SCALE : 1)) / 2 : 0;
}

/** Top of a lot's building and sign, in world y (negative is up), so the camera can rise to see it. */
export function lotTop(id: string): number {
  const l = LOTS[id];
  return l ? BASE - (l.h * (l.back ? BACK_SCALE : 1)) - (l.back ? BACK_RISE : 0) - 40 : 0;
}

/** [ux-wp3 R4] Middle of a lot's building in world coordinates (the project ceremony's camera goes there); null for an unknown id. */
export function lotCenter(id: string): { x: number; y: number } | null {
  const l = LOTS[id];
  if (!l) return null;
  const s = l.back ? BACK_SCALE : 1;
  return { x: l.x, y: BASE - (l.h * s) / 2 - (l.back ? BACK_RISE : 0) };
}

/** The plain shapes behind each painting are drawn at their own size; this fits them to the lot. */
const shapeScale = (id: string) => LOT_H[id] / PLANS[id].h;

/** The paintings stand on a dirt patch: this share of the picture sits below the ground line (the grass fringe covers it). */
const ART_SINK = 0.07;

export const projectArtKey = (id: string) => `kit/proj-${id}`;

const labelStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffe6b0, stroke: { color: 0x14141e, width: 3 } });

/**
 * Lights and smoke on each painting, as fractions of the picture (0,0 top-left): windows and lamps glow at night,
 * `always` ones (a furnace, the Genesis orb) burn day and night, `blink` ones flash like a beacon.
 */
interface Spot { x: number; y: number; size: number; color: number; always?: boolean; blink?: boolean }
const WARM = 0xffc878, RED = 0xff4a3a;
const SPOTS: Record<string, Spot[]> = {
  radioMast: [{ x: 0.47, y: 0.03, size: 26, color: RED, blink: true }, { x: 0.66, y: 0.84, size: 40, color: WARM }],
  purifier: [{ x: 0.79, y: 0.6, size: 40, color: WARM }],
  greenhouse: [{ x: 0.5, y: 0.55, size: 120, color: 0xffd8a0 }],
  skyDome: [{ x: 0.55, y: 0.6, size: 110, color: 0xffd8a0 }],
  wall: [{ x: 0.42, y: 0.12, size: 44, color: WARM }, { x: 0.74, y: 0.14, size: 44, color: WARM }],
  deepFoundry: [{ x: 0.5, y: 0.82, size: 90, color: 0xff7a2a, always: true }, { x: 0.52, y: 0.5, size: 50, color: WARM }],
  metroTunnel: [{ x: 0.42, y: 0.1, size: 26, color: RED, blink: true }],
  archive: [{ x: 0.3, y: 0.38, size: 46, color: WARM }, { x: 0.52, y: 0.38, size: 46, color: WARM }, { x: 0.3, y: 0.72, size: 46, color: WARM }],
  tradeLeague: [{ x: 0.53, y: 0.4, size: 50, color: WARM }],
  constitution: [{ x: 0.5, y: 0.72, size: 50, color: WARM }],
  ark: [{ x: 0.33, y: 0.52, size: 40, color: WARM }, { x: 0.62, y: 0.48, size: 40, color: WARM }],
  genesisCore: [{ x: 0.5, y: 0.08, size: 90, color: 0x7af0ff, always: true }],
  surfaceGate: [{ x: 0.7, y: 0.55, size: 40, color: WARM }],
};
/** Chimney tops that smoke (the foundry's two stacks, the radio shack's stove pipe). */
const SMOKE: Record<string, [number, number][]> = {
  deepFoundry: [[0.32, 0.02], [0.6, 0.12]],
  radioMast: [[0.7, 0.72]],
};

function paintedBody(tex: Texture, w: number, tint: number): Container {
  const s = new Sprite(tex);
  s.anchor.set(0.5, 1 - ART_SINK);
  s.width = w;
  s.scale.y = s.scale.x;
  s.tint = tint;
  return s;
}

/** Soft dark ellipse under a building, like the one under every surface prop. */
function contactShadow(w: number): Sprite {
  const s = new Sprite(glowTexture());
  s.anchor.set(0.5);
  s.width = w * 1.05;
  s.height = Math.max(8, w * 0.12);
  s.tint = 0x000000;
  s.alpha = 0.55;
  return s;
}

function glowSprite(size: number, color: number): Sprite {
  const s = new Sprite(glowTexture());
  s.anchor.set(0.5);
  s.width = s.height = size;
  s.tint = color;
  s.blendMode = 'add';
  s.alpha = 0;
  return s;
}

function scaffold(w: number, h: number): Graphics {
  const g = new Graphics();
  const x0 = -w / 2 - 6, x1 = w / 2 + 6;
  // Weathered timber, not fresh pine: it must sit in the same muted world as the paintings.
  const wood = 0x8a6a44, plank = 0x6e5236;
  for (let x = x0; x <= x1 + 0.1; x += Math.max(18, (x1 - x0) / Math.max(2, Math.round((x1 - x0) / 26)))) g.rect(x - 1.2, -h, 2.4, h).fill(wood);
  g.rect(x1 - 1.2, -h, 2.4, h).fill(wood);
  for (let y = -18; y > -h; y -= 20) g.rect(x0 - 2, y, x1 - x0 + 4, 3).fill(plank);
  // Cross braces on the outer bays.
  for (let y = 0; y > -h + 20; y -= 20) {
    g.moveTo(x0, y).lineTo(x0 + 18, y - 20).stroke({ color: wood, width: 1, alpha: 0.8 });
    g.moveTo(x1, y).lineTo(x1 - 18, y - 20).stroke({ color: wood, width: 1, alpha: 0.8 });
  }
  // Hazard barrier at the foot.
  for (let x = x0 - 8; x < x1 + 8; x += 8) g.rect(x, -9, 8, 4).fill(((x - x0) / 8) % 2 < 1 ? 0xc8a032 : 0x1a1a1a);
  g.rect(x0 - 8, -9, 1.5, 9).fill(dark).rect(x1 + 6.5, -9, 1.5, 9).fill(dark);
  return g;
}

interface LotRecord {
  root: Container;
  sig: string;
  /** Things that live outside the tinted layer (lights, sign) and go with the lot. */
  extras: Container[];
  lights: { s: Sprite; spot: Spot; ph: number }[];
  smoke: Smoke[];
}

/**
 * Owns the lots: rebuilds a lot when its state changes and keeps a site view per lot for the crew.
 * Layers, back to front: `layer` (the buildings, the poles and wires, the clutter between lots; lit like the rest of the
 * surface by the clock, the weather and the painting's own light), `smokeLayer`, `glowLayer` (window light, never
 * darkened by the night tint), `crew` (the people), `signLayer` (progress signs, always readable).
 */
export class ProjectSites {
  readonly layer = new Container();
  readonly smokeLayer = new Container();
  readonly glowLayer = new Container();
  readonly crew = new Container();
  readonly signLayer = new Container();
  readonly views = new Map<string, SiteView>();
  private lots = new Map<string, LotRecord>();
  /** Poles, wires and clutter: rebuilt when the set of lots changes. */
  private decor = new Container();
  private decorSig = '';
  private lastT = -1;
  onTap: ((id: string) => void) | null = null;

  constructor() {
    this.layer.label = 'projectSites';
    this.crew.label = 'projectCrews';
    this.layer.addChild(this.decor);
    for (const c of [this.smokeLayer, this.glowLayer, this.signLayer]) c.eventMode = 'none';
  }

  /** East edge of the lots in use (0 when none): the camera may pan this far. */
  get right(): number {
    let r = 0;
    for (const id of this.lots.keys()) r = Math.max(r, lotRight(id) + 30);
    return r;
  }

  /** Highest point of the lots in use (0 when none): the camera may rise this far. */
  get top(): number {
    let t = 0;
    for (const id of this.lots.keys()) t = Math.min(t, lotTop(id));
    return t;
  }

  set(sites: SiteInfo[]): void {
    const keep = new Set<string>();
    for (const site of sites) {
      const plan = PLANS[site.id];
      if (!plan || !LOTS[site.id]) continue;
      keep.add(site.id);
      const frac = Math.max(0, Math.min(1, site.frac));
      const sig = `${site.building}|${Math.round(frac * 100)}|${site.label}|${ArtLibrary.get(projectArtKey(site.id)) ? 'art' : 'shape'}`;
      const old = this.lots.get(site.id);
      if (old?.sig === sig) continue;
      if (old) this.drop(old);
      const rec = this.buildLot(site, plan, frac, sig);
      // Back-row lots go behind the front row, but in front of the poles and clutter (decor is child 0).
      if (LOTS[site.id].back) this.layer.addChildAt(rec.root, 1);
      else this.layer.addChild(rec.root);
      this.lots.set(site.id, rec);
      this.ensureView(site.id, plan);
    }
    for (const [id, rec] of this.lots) {
      if (keep.has(id)) continue;
      this.drop(rec);
      this.lots.delete(id);
    }
    const decorSig = ORDER.filter(id => this.lots.has(id)).join(',');
    if (decorSig !== this.decorSig) {
      this.decorSig = decorSig;
      this.buildDecor();
    }
  }

  private drop(rec: LotRecord): void {
    rec.root.destroy({ children: true });
    for (const e of rec.extras) e.destroy({ children: true });
  }

  /**
   * Light the lots like the rest of the surface: `light` is the surface's clock and weather tint, `grade` the
   * panorama's own light (src/rendering/surface2.ts). Windows warm up as it gets dark; chimneys smoke.
   */
  animate(t: number, light: number, grade: number, night: number, power: number, wind: number): void {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.layer.tint = mulColor(light, grade);
    this.smokeLayer.tint = light;
    // The crew on the surface share the outdoor light (a little brighter than the buildings: they are closer).
    this.crew.tint = mix(light, 0xffffff, 0.25);
    const dark = Math.min(1, Math.max(0, (night - 0.25) / 0.5));
    const on = Math.max(0, Math.min(1, power));
    for (const rec of this.lots.values()) {
      for (const l of rec.lights) {
        const flick = 0.93 + 0.07 * Math.sin(t * 8 + l.ph) * Math.sin(t * 3.1 + l.ph);
        if (l.spot.blink) l.s.alpha = (Math.sin(t * 3 + l.ph) > 0.35 ? 0.5 + 0.5 * dark : 0.06) * Math.max(0.3, on);
        else if (l.spot.always) l.s.alpha = (0.5 + 0.35 * dark) * (0.85 + 0.15 * Math.sin(t * 1.7 + l.ph)) * flick;
        else l.s.alpha = 0.72 * dark * on * flick;
      }
      for (const s of rec.smoke) s.update(dt, wind, 99, 0.8);
    }
  }

  /** Every lot gets a crew view, built or not, so people assigned to a just-picked project have somewhere to stand. */
  ensureView(id: string, _plan = PLANS[id]): SiteView | undefined {
    const lot = LOTS[id];
    if (!lot) return undefined;
    let v = this.views.get(id);
    if (v) return v;
    // The crew works along the front half of the lot (people stand in front of the building, on the ground line).
    const width = Math.max(70, Math.min(160, lot.w * 0.8));
    const root = new Container();
    root.position.set(lot.x - width / 2, BASE + groundY(lot.x, PORTAL_X) - WALK_Y + 2);
    const people = new Container();
    people.sortableChildren = true;
    root.addChild(people);
    this.crew.addChild(root);
    v = { root, people, lane: { x0: 6, x1: width - 6 }, width, visualSig: `site:${id}` };
    this.views.set(id, v);
    return v;
  }

  private buildLot(site: SiteInfo, plan: Plan, frac: number, sig: string): LotRecord {
    const lot = LOTS[site.id];
    const k = lot.back ? BACK_SCALE : 1;
    const gy = BASE + groundY(lot.x, PORTAL_X) - (lot.back ? BACK_RISE : 0);
    const root = new Container();
    root.position.set(lot.x, gy);
    root.scale.set(k);
    const rec: LotRecord = { root, sig, extras: [], lights: [], smoke: [] };
    const tex = ArtLibrary.get(projectArtKey(site.id));
    const { w, h } = lot;
    // Back row: a touch of the horizon haze, so it reads as further away.
    const make = (): Container => {
      if (tex) return paintedBody(tex, w, lot.back ? 0xc2c8cc : 0xffffff);
      const g = new Graphics();
      // Flat shapes against a painted backdrop: a warm, slightly dimmed tint keeps them from shouting (more for the back row).
      g.tint = lot.back ? 0xb8b4ae : 0xe4e0d8;
      plan.draw(g);
      g.scale.set(shapeScale(site.id));
      return g;
    };
    root.addChild(contactShadow(w));
    const body = make();
    root.addChild(body);
    const shown = site.building ? Math.max(0.08, frac) : 1;
    if (site.building) {
      // The part already standing rises with the work; a faint ghost shows what it will be.
      const ghost = make();
      ghost.alpha = 0.16;
      root.addChildAt(ghost, 1);
      const mask = new Graphics().rect(-w / 2 - 60, -h * shown - 2, w + 120, h * shown + 30).fill(0xffffff);
      root.addChild(mask);
      body.mask = mask;
      root.addChild(scaffold(w * 0.86, Math.min(h, h * shown + 24)));
      // The sign stays readable at night: it lives in its own untinted layer.
      const sign = new Container();
      sign.position.set(lot.x, gy - (Math.min(h, h * shown + 24) + 22) * k);
      const text = new Text({ text: site.label, style: labelStyle, resolution: 3 });
      text.anchor.set(0.5, 1);
      const bw = Math.max(44, Math.min(90, text.width));
      const bar = new Graphics()
        .roundRect(-bw / 2, 3, bw, 5, 2.5).fill({ color: 0x000000, alpha: 0.75 })
        .roundRect(-bw / 2, 3, Math.max(3, bw * frac), 5, 2.5).fill(0xffb547);
      sign.addChild(text, bar);
      this.signLayer.addChild(sign);
      rec.extras.push(sign);
    }
    if (tex) {
      // Window light and smoke, placed on the painting; only on the part already standing.
      const hp = w / (tex.width / tex.height);
      const at = (fx: number, fy: number): [number, number] => [lot.x + (fx - 0.5) * w * k, gy + (fy - (1 - ART_SINK)) * hp * k];
      const lights = new Container();
      let i = 0;
      for (const spot of SPOTS[site.id] ?? []) {
        const [x, y] = at(spot.x, spot.y);
        if (gy - y > h * shown * k + 2) continue;
        const s = glowSprite(spot.size * k * 0.75, spot.color);
        s.position.set(x, y);
        lights.addChild(s);
        rec.lights.push({ s, spot, ph: lot.x * 0.01 + i++ * 1.7 });
      }
      this.glowLayer.addChild(lights);
      rec.extras.push(lights);
      if (!site.building) {
        const smoke = new Container();
        for (const [fx, fy] of SMOKE[site.id] ?? []) {
          const [x, y] = at(fx, fy);
          rec.smoke.push(new Smoke(smoke, { x, y, rate: 1.6, life: 5, rise: 14, size: [5, 30], alpha: 0.28, color: 0xc8c0b8, drift: 9 }, 14, Math.round(x)));
        }
        this.smokeLayer.addChild(smoke);
        rec.extras.push(smoke);
      }
    }
    // Weeds grow over the foot of the building, like everywhere else on the surface.
    const weeds = ArtLibrary.get('kit/prop-7');
    if (weeds) {
      for (const [fx, flip, sz] of [[-0.42, false, 20], [0.38, true, 16], [0.05, false, 13]] as [number, boolean, number][]) {
        const s = new Sprite(weeds);
        s.anchor.set(0.5, 0.92);
        const sc = sz / weeds.height;
        s.scale.set(flip ? -sc : sc, sc);
        s.position.set(fx * w, 1);
        root.addChild(s);
      }
    }
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new SlopArea(-w / 2 - 12, -h - 40, w + 24, h + 44); // [plan4:ST-12 #4] at least 44 screen px
    root.on('pointertap', () => this.onTap?.(site.id));
    return rec;
  }

  /**
   * What makes the lots one settlement and not a row of stickers: a power line on timber poles from the bunker
   * entrance out to the last lot (wires sag between poles), and the clutter of a lived-in place in the gaps.
   */
  private buildDecor(): void {
    this.decor.removeChildren().forEach(c => c.destroy({ children: true }));
    const ids = ORDER.filter(id => this.lots.has(id));
    if (!ids.length) return;
    const g = new Graphics();
    const lastRight = Math.max(...ids.map(id => lotRight(id)));
    // Poles: one just east of the entrance, then about every 150 units out to the last lot.
    const poles: [number, number][] = [];
    for (let x = 175; x <= lastRight + 20; x += 150) poles.push([x, BASE + groundY(x, PORTAL_X) - BACK_RISE - 2]);
    const H = 118;
    for (const [x, y] of poles) {
      g.rect(x - 1.6, y - H, 3.2, H).fill(0x4a3a2a);
      g.rect(x - 11, y - H + 6, 22, 2.4).fill(0x3e3024);
      for (const dx of [-9, 0, 9]) g.rect(x + dx - 1, y - H + 3, 2, 3.4).fill(0x8a8478);
    }
    // Wires: three sagging spans between neighbouring poles.
    for (let i = 0; i + 1 < poles.length; i++) {
      const [x0, y0] = poles[i];
      const [x1, y1] = poles[i + 1];
      for (const dx of [-9, 0, 9]) {
        const ax = x0 + dx, ay = y0 - H + 3, bx = x1 + dx, by = y1 - H + 3;
        g.moveTo(ax, ay).quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 14, bx, by).stroke({ color: 0x1e1a18, width: 0.9, alpha: 0.8 });
      }
    }
    this.decor.addChild(g);
    // Clutter in the gaps between lots: barrels, sandbags, a lamp post, weeds (the surface's own props).
    const kinds = [3, 2, 7, 6, 3, 7];
    const heights: Record<number, number> = { 2: 22, 3: 30, 6: 92, 7: 16 };
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = LOTS[ids[i]], b = LOTS[ids[i + 1]];
      const kind = kinds[i % kinds.length];
      const tex = ArtLibrary.get(`kit/prop-${kind}`);
      if (!tex) continue;
      const x = (a.x + b.x) / 2 + ((i * 37) % 23) - 11;
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      const sc = heights[kind] / tex.height;
      s.scale.set(i % 2 ? -sc : sc, sc);
      s.position.set(x, BASE + groundY(x, PORTAL_X) + 2);
      this.decor.addChild(s);
    }
  }
}
