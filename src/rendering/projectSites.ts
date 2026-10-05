import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import { ArtLibrary } from '../art/ArtLibrary';
import { SHAFT_W, WALK_Y } from './layout';
import { groundY } from './surfaceLife';
import type { Lane } from './people';

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

/** The plain shapes behind each painting are drawn at their own size; this fits them to the lot. */
const shapeScale = (id: string) => LOT_H[id] / PLANS[id].h;

/** The paintings stand on a dirt patch with a soft shadow: this share of the picture sits below the ground line. */
const ART_SINK = 0.04;

export const projectArtKey = (id: string) => `kit/proj-${id}`;

const labelStyle = new TextStyle({ fontFamily: 'Rubik, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffe6b0, stroke: { color: 0x14141e, width: 3 } });

function paintedBody(tex: Texture, w: number, tint: number): Container {
  const s = new Sprite(tex);
  s.anchor.set(0.5, 1 - ART_SINK);
  s.width = w;
  s.scale.y = s.scale.x;
  s.tint = tint;
  return s;
}

function scaffold(w: number, h: number): Graphics {
  const g = new Graphics();
  const x0 = -w / 2 - 6, x1 = w / 2 + 6;
  const wood = 0xc0954f;
  for (let x = x0; x <= x1 + 0.1; x += Math.max(18, (x1 - x0) / Math.max(2, Math.round((x1 - x0) / 26)))) g.rect(x - 1.2, -h, 2.4, h).fill(wood);
  g.rect(x1 - 1.2, -h, 2.4, h).fill(wood);
  for (let y = -18; y > -h; y -= 20) g.rect(x0 - 2, y, x1 - x0 + 4, 3).fill(0x9a7440);
  // Cross braces on the outer bays.
  for (let y = 0; y > -h + 20; y -= 20) {
    g.moveTo(x0, y).lineTo(x0 + 18, y - 20).stroke({ color: wood, width: 1, alpha: 0.8 });
    g.moveTo(x1, y).lineTo(x1 - 18, y - 20).stroke({ color: wood, width: 1, alpha: 0.8 });
  }
  // Hazard barrier at the foot.
  for (let x = x0 - 8; x < x1 + 8; x += 8) g.rect(x, -9, 8, 4).fill(((x - x0) / 8) % 2 < 1 ? 0xf0c030 : 0x1a1a1a);
  g.rect(x0 - 8, -9, 1.5, 9).fill(dark).rect(x1 + 6.5, -9, 1.5, 9).fill(dark);
  return g;
}

/**
 * Owns the lots: rebuilds a lot when its state changes and keeps a site view per lot for the crew.
 * `layer` holds the buildings, `crew` (added after it) the people, so the workers stand in front of the scaffolding.
 */
export class ProjectSites {
  readonly layer = new Container();
  readonly crew = new Container();
  readonly views = new Map<string, SiteView>();
  private lots = new Map<string, { root: Container; sig: string }>();
  onTap: ((id: string) => void) | null = null;

  constructor() {
    this.layer.label = 'projectSites';
    this.crew.label = 'projectCrews';
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
      old?.root.destroy({ children: true });
      const root = this.buildLot(site, plan, frac);
      if (LOTS[site.id].back) this.layer.addChildAt(root, 0);
      else this.layer.addChild(root);
      this.lots.set(site.id, { root, sig });
      this.ensureView(site.id, plan);
    }
    for (const [id, lot] of this.lots) {
      if (keep.has(id)) continue;
      lot.root.destroy({ children: true });
      this.lots.delete(id);
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

  private buildLot(site: SiteInfo, plan: Plan, frac: number): Container {
    const lot = LOTS[site.id];
    const root = new Container();
    root.position.set(lot.x, BASE + groundY(lot.x, PORTAL_X) - (lot.back ? BACK_RISE : 0));
    if (lot.back) root.scale.set(BACK_SCALE);
    const tex = ArtLibrary.get(projectArtKey(site.id));
    const { w, h } = lot;
    const make = (): Container => {
      if (tex) return paintedBody(tex, w, lot.back ? 0xc4c0b8 : 0xffffff);
      const g = new Graphics();
      // Flat shapes against a painted backdrop: a warm, slightly dimmed tint keeps them from shouting (more for the back row).
      g.tint = lot.back ? 0xb8b4ae : 0xe4e0d8;
      plan.draw(g);
      g.scale.set(shapeScale(site.id));
      return g;
    };
    const body = make();
    root.addChild(body);
    if (site.building) {
      // The part already standing rises with the work; a faint ghost shows what it will be.
      const ghost = make();
      ghost.alpha = 0.16;
      root.addChildAt(ghost, 0);
      const shown = Math.max(0.08, frac);
      const mask = new Graphics().rect(-w / 2 - 60, -h * shown - 2, w + 120, h * shown + 20).fill(0xffffff);
      root.addChild(mask);
      body.mask = mask;
      root.addChild(scaffold(w * 0.86, Math.min(h, h * shown + 24)));
      const sign = new Container();
      sign.position.set(0, -Math.min(h, h * shown + 24) - 22);
      const text = new Text({ text: site.label, style: labelStyle, resolution: 3 });
      text.anchor.set(0.5, 1);
      const bw = Math.max(44, Math.min(90, text.width));
      const bar = new Graphics()
        .roundRect(-bw / 2, 3, bw, 5, 2.5).fill({ color: 0x000000, alpha: 0.75 })
        .roundRect(-bw / 2, 3, Math.max(3, bw * frac), 5, 2.5).fill(0xffb547);
      sign.addChild(text, bar);
      root.addChild(sign);
    }
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = { contains: (x: number, y: number) => x >= -w / 2 - 12 && x <= w / 2 + 12 && y >= -h - 40 && y <= 4 };
    root.on('pointertap', () => this.onTap?.(site.id));
    return root;
  }
}
