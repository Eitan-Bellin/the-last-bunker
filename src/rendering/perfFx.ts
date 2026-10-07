/**
 * Cheap replacements for the effects that used to be a `Graphics` cleared and rebuilt every picture (plan 2026-10, Q1): a Graphics
 * that changes is re-triangulated and re-batched in full, which cost 6.9 MB of garbage and 10-13 ms per picture at 24 floors.
 * Here the same effects are pooled sprites whose position and alpha change (no new geometry, nothing allocated per picture),
 * and only the ones inside the camera's view are touched.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { GameState } from '../core/GameState';
import { isDistrict } from '../data/buildingDefs';
import { ROOMS_W, ROOMS_X, FLOOR_H, floorTop } from './layout';
import { hashString, seeded } from './draw';

/**
 * The world rectangle the camera sees right now (plus a margin), refreshed by the renderer once per picture. Effects that animate
 * many small things read it instead of measuring the scene. Unbounded until the renderer sets it (tools, tests).
 */
export const VIEW = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };

/**
 * What the scene is built from, as three numbers computed once per picture (plan Q5). The renderer used to join every building into
 * a string several times per picture just to learn that nothing changed. `rooms` covers what a room's look depends on (type, place,
 * level, new or not), `util` what the structure around the rooms depends on (the same, plus the ruins), `districts` the side tunnels.
 */
export const LAYOUT = { rooms: 0, util: 0, districts: 0 };

const strHash = new Map<string, number>();
const sh = (s: string): number => {
  let h = strHash.get(s);
  if (h === undefined) { h = hashString(s); strHash.set(s, h); }
  return h;
};
const mix = (h: number, v: number): number => Math.imul(h ^ v, 16777619) >>> 0;

export function hashLayout(state: GameState): void {
  let hr = 2166136261, hu = 2166136261, hd = 2166136261;
  for (const b of state.buildings) {
    const fresh = b.isConstructing && b.level === 1 ? 1 : 0;
    const where = (b.position.floor + 8) * 128 + (b.position.x + 32); // [plan4:X-2] offsets keep negative floors and west slots (< 0) from colliding
    hr = mix(mix(mix(mix(hr, sh(b.id)), sh(b.type)), where), (b.level << 2) | (fresh << 1) | (b.isConstructing ? 1 : 0));
    hu = mix(mix(mix(mix(hu, sh(b.id)), sh(b.type)), where), (b.level << 1) | fresh);
    if (isDistrict(b.type)) hd = mix(hd, b.position.floor);
  }
  for (const r of state.ruins) hu = mix(mix(mix(hu, sh(r.id)), r.x), r.floor);
  LAYOUT.rooms = hr;
  LAYOUT.util = hu;
  LAYOUT.districts = hd;
}

const textures = new Map<string, Texture>();

/** A small canvas texture, made once per key. `draw` paints into a size x size canvas. */
function canvasTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): Texture {
  let t = textures.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!, size);
    t = Texture.from(c);
    textures.set(key, t);
  }
  return t;
}

/** A crisp little disc with a one-pixel soft edge (what `circle().fill()` used to draw). */
function discTexture(): Texture {
  return canvasTexture('disc', 16, (g, s) => {
    const r = s / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.62, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** Power bead: a bright core in a soft amber halo, light added on top (the old two circles in one texture). */
function powerBeadTexture(): Texture {
  return canvasTexture('bead-power', 32, (g, s) => {
    const r = s / 2;
    g.globalCompositeOperation = 'lighter';
    // halo: radius 3.4 of a 4-unit half width, core: radius 1
    const halo = g.createRadialGradient(r, r, 0, r, r, r * 0.85);
    halo.addColorStop(0, 'rgba(255,176,48,0.22)');
    halo.addColorStop(0.9, 'rgba(255,176,48,0.22)');
    halo.addColorStop(1, 'rgba(255,176,48,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, s, s);
    const core = g.createRadialGradient(r, r, 0, r, r, r * 0.3);
    core.addColorStop(0, 'rgba(255,216,96,0.9)');
    core.addColorStop(0.75, 'rgba(255,216,96,0.9)');
    core.addColorStop(1, 'rgba(255,216,96,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);
  });
}

/** Water bead: one pale blue dot. */
function waterBeadTexture(): Texture {
  return canvasTexture('bead-water', 16, (g, s) => {
    const r = s / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(154,216,255,0.7)');
    grad.addColorStop(0.62, 'rgba(154,216,255,0.7)');
    grad.addColorStop(1, 'rgba(154,216,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/**
 * Splits a big static layer into horizontal bands (a few floors each), every band its own render group, and shows only the bands the
 * camera can see (plan M1). The structure in front of the rooms is ~3,600 objects at 24 floors and about a sixth of them are ever on
 * screen: Pixi walked, updated and batched all of them every picture. The pieces keep their look and their order inside a band;
 * plain containers one level down (the shadows, the additive light spills) are copied per band with their blend mode, so nothing
 * changes how it is drawn. Pieces too tall for one band (a pipe down the whole bunker) stay in a layer of their own, tested one by one.
 * References to the pieces (the code that tints them each frame) stay valid: they are moved, not copied.
 */
export function bandize(root: Container, label: string, bandH: number, top: number): { update(): void; bands: number; tall: number } {
  interface Band { c: Container; y0: number; y1: number; shown: boolean }
  const bands = new Map<number, Band>();
  const tall: { o: Container; y0: number; y1: number }[] = [];
  const tallLayer = new Container();
  tallLayer.label = `${label}Tall`;
  tallLayer.eventMode = 'none';

  const rangeOf = (o: Container, offY: number): [number, number] => {
    const b = o.getLocalBounds();
    let a = offY + o.y + b.minY * o.scale.y, z = offY + o.y + b.maxY * o.scale.y;
    if (a > z) [a, z] = [z, a];
    if (o.rotation !== 0) { const r = Math.max(b.maxX - b.minX, b.maxY - b.minY); a -= r; z += r; }
    return [a, z];
  };
  const bandFor = (y0: number, y1: number): number => Math.floor(((y0 + y1) / 2 - top) / bandH);
  const bandOf = (k: number): Band => {
    let b = bands.get(k);
    if (!b) {
      const c = new Container();
      c.label = `${label}Band`;
      c.eventMode = 'none';
      c.isRenderGroup = true;
      bands.set(k, b = { c, y0: Infinity, y1: -Infinity, shown: true });
    }
    return b;
  };
  const isPlain = (o: Container) => (!o.renderPipeId || o.renderPipeId === 'container') && o.children.length > 0;

  const copies = new Map<Container, Map<number, Container>>(); // plain container -> its copy in each band
  const copyIn = (p: Container, k: number, band: Band): Container => {
    let m = copies.get(p);
    if (!m) copies.set(p, m = new Map());
    let c = m.get(k);
    if (!c) {
      c = new Container();
      c.blendMode = p.blendMode;
      c.alpha = p.alpha;
      c.tint = p.tint;
      c.position.copyFrom(p.position);
      c.scale.copyFrom(p.scale);
      c.eventMode = 'none';
      band.c.addChild(c);
      m.set(k, c);
    }
    return c;
  };

  const place = (o: Container, parent: Container | null): void => {
    const offY = parent ? parent.y : 0;
    const [y0, y1] = rangeOf(o, offY);
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 - y0 > bandH * 1.5) {
      tall.push({ o, y0: Number.isFinite(y0) ? y0 : -1e9, y1: Number.isFinite(y1) ? y1 : 1e9 });
      tallLayer.addChild(o);
      return;
    }
    const k = bandFor(y0, y1);
    const band = bandOf(k);
    band.y0 = Math.min(band.y0, y0);
    band.y1 = Math.max(band.y1, y1);
    (parent ? copyIn(parent, k, band) : band.c).addChild(o);
  };

  for (const child of root.children.slice()) {
    if (isPlain(child)) for (const leaf of child.children.slice()) place(leaf, child);
    else place(child, null);
    if (isPlain(child) && child.children.length === 0) child.destroy();
  }
  root.removeChildren();
  const ordered = [...bands.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, b] of ordered) root.addChild(b.c);
  root.addChild(tallLayer);

  const list = ordered.map(([, b]) => b);
  return {
    bands: list.length,
    tall: tall.length,
    update(): void {
      const { y0, y1 } = VIEW;
      for (const b of list) {
        const show = b.y1 > y0 && b.y0 < y1;
        if (show !== b.shown) { b.shown = show; b.c.visible = show; }
      }
      for (const t of tall) {
        const show = t.y1 > y0 && t.y0 < y1;
        if (show !== t.o.visible) t.o.visible = show;
      }
    },
  };
}

/** Dust motes drifting through the occupied floors: a pool of sprites, only the motes in view are shown. */
export class Dust {
  readonly container = new Container();
  private motes: { x: number; y: number; vx: number; vy: number; ph: number }[] = [];
  private pool: Sprite[] = [];
  private floors = 0;
  private readonly MAX = 320;

  constructor() {
    this.container.label = 'dust';
    this.container.eventMode = 'none';
  }

  setFloors(floors: number): void {
    if (floors === this.floors) return;
    this.floors = floors;
    const rnd = seeded(99 + floors);
    this.motes = [];
    for (let i = 0; i < 26 * floors; i++) {
      this.motes.push({
        x: ROOMS_X + rnd() * ROOMS_W, y: floorTop(0) + rnd() * (floorTop(floors) - floorTop(0)), // [plan4:ST-1] the galleries add height
        vx: (rnd() - 0.5) * 4, vy: (rnd() - 0.5) * 3, ph: rnd() * Math.PI * 2,
      });
    }
    // The pool follows the number of motes (a camera far out may see a few hundred); sprites are created as they are needed.
    this.want = Math.min(this.MAX, this.motes.length);
    while (this.pool.length > this.want) this.pool.pop()!.destroy();
    this.attached = Math.min(this.attached, this.pool.length);
  }

  /** How many sprites exist and how many are attached to the container (only attached ones cost anything). */
  private want = 0;
  private attached = 0;

  update(dt: number, t: number): void {
    const { x0, y0, x1, y1 } = VIEW;
    const pool = this.pool;
    let n = 0;
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < ROOMS_X) m.x += ROOMS_W;
      if (m.x > ROOMS_X + ROOMS_W) m.x -= ROOMS_W;
      if (n < this.want && m.x > x0 && m.x < x1 && m.y > y0 && m.y < y1) {
        if (n >= pool.length) pool.push(this.make());
        const s = pool[n++];
        s.position.set(m.x, m.y);
        s.alpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.5 + m.ph));
      }
    }
    // Attach what is needed (with some slack), detach a lot of unused ones only when many are idle: the container's draw list is rebuilt
    // when the set changes, so it must not change every picture.
    if (n > this.attached) this.attach(Math.min(pool.length, n + 24));
    else if (n + 64 < this.attached) this.attach(n + 24);
    for (let i = n; i < this.attached; i++) if (pool[i].alpha !== 0) pool[i].alpha = 0;
  }

  private make(): Sprite {
    const s = new Sprite(discTexture());
    s.anchor.set(0.5);
    s.width = s.height = 2.4;
    s.tint = 0xffe6c0;
    s.blendMode = 'add';
    s.alpha = 0;
    return s;
  }

  private attach(count: number): void {
    const pool = this.pool;
    while (pool.length < count) pool.push(this.make());
    while (this.attached < count) this.container.addChild(pool[this.attached++]);
    while (this.attached > count) this.container.removeChild(pool[--this.attached]);
  }
}

/** One run of the pipes: beads of light travelling along it, skipping the places where a hall interrupts it. */
export interface BeadRun {
  y: number;
  x0: number;
  x1: number;
  kind: 'power' | 'water';
  gaps: number[][];
}

interface RunSprites { run: BeadRun; holder: Container; beads: Sprite[]; speed: number; spacing: number; shown: boolean }

/**
 * The "current" travelling along the power and water mains: one pooled sprite per bead instead of two circles redrawn per bead per
 * picture. Runs outside the camera's view are hidden as a whole (a toggle that happens only when the camera crosses them).
 */
export class FlowBeads {
  readonly container = new Container();
  private runs: RunSprites[] = [];

  private painted: boolean;

  constructor(runs: BeadRun[], painted: boolean) {
    this.painted = painted;
    this.container.label = 'flow';
    this.container.eventMode = 'none';
    for (const run of runs) {
      const power = run.kind === 'power';
      const spacing = power ? 38 : 24;
      const holder = new Container();
      const n = Math.max(1, Math.ceil((run.x1 - run.x0) / spacing) + 1);
      const beads: Sprite[] = [];
      for (let i = 0; i < n; i++) {
        const s = new Sprite(power ? powerBeadTexture() : waterBeadTexture());
        s.anchor.set(0.5);
        s.width = s.height = power ? 8 : 2.6; // 4 units each side of the centre for the halo, 1.3 for the water dot
        s.blendMode = 'add';
        s.y = run.y;
        s.alpha = 0;
        holder.addChild(s);
        beads.push(s);
      }
      this.container.addChild(holder);
      this.runs.push({ run, holder, beads, speed: power ? 90 : 30, spacing, shown: true });
    }
  }

  animate(t: number, power: number): void {
    const { x0: vx0, y0: vy0, x1: vx1, y1: vy1 } = VIEW;
    for (const r of this.runs) {
      const { run, beads } = r;
      const show = run.y > vy0 && run.y < vy1 && run.x1 > vx0 && run.x0 < vx1 && !(run.kind === 'power' && power < 0.3);
      if (show !== r.shown) { r.shown = show; r.holder.visible = show; }
      if (!show) continue;
      const k = run.kind === 'power' ? (this.painted ? 0.4 : 1) * power : 1; // over the painted conduit the current is a faint glint
      const base = run.x0 + ((t * r.speed) % r.spacing);
      for (let i = 0; i < beads.length; i++) {
        const x = base + i * r.spacing;
        const s = beads[i];
        let on = x < run.x1;
        if (on) for (const g of run.gaps) if (x >= g[0] && x <= g[1]) { on = false; break; }
        if (on) {
          s.x = x;
          s.alpha = k;
        } else if (s.alpha !== 0) s.alpha = 0;
      }
    }
  }
}
