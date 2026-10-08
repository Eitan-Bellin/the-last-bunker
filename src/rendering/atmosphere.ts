import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { BuildingInstance } from '../core/GameState';
import { isHall, roomSlots } from '../data/buildingDefs';
import { glowTexture, moteTexture } from '../art/ArtLibrary';
import { BASE_EAST, ROOMS_X, ROOM_H, SHAFT_GAP, SLOT_W, floorAtY, floorTop, slotX } from './layout';
import { hashString, seeded } from './draw';
import type { WorldLamp } from './structure';
import type { DecalSources } from './decals';
import { galleryVents } from './gallery'; // [plan4:ST-1]
import type { Ext } from './geom';

/**
 * Graphics overhaul G7: the bunker breathes. Every effect comes from something you can see —
 * drops fall from the water stains, steam puffs from valves on the pipe bundle, sparks spit from the
 * broken junction boxes of the Remnant, and slow dust turns in the light under the ceiling lamps.
 * One pooled particle budget (≤120 on screen), only for sources in view; off in low quality, half in medium.
 */

export type AtmoQuality = 'high' | 'medium' | 'low';

export interface Atmosphere {
  container: Container;
  /** Where the effects come from (for inspection). */
  sources: { kind: string; x: number; y: number }[];
  /** Particles alive right now. */
  live: () => number;
  update: (t: number, dt: number, power: number, world: Container, screen: { width: number; height: number }, quality: AtmoQuality) => void;
}

const BUDGET = 120;

let puff: Texture | null = null;

/** A lumpy cloud of steam: a few overlapping soft blobs, denser than the light glow. */
export function puffTexture(): Texture {
  if (puff) return puff;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const r = seeded(77);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2, d = r() * 9;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.8, rad = 12 + r() * 9;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  puff = Texture.from(c);
  return puff;
}

type Kind = 'drip' | 'splash' | 'steam' | 'spark' | 'dust';

interface P {
  s: Sprite;
  kind: Kind;
  x: number; y: number; vx: number; vy: number;
  age: number; life: number;
  size: number; grow: number; a: number;
  /** Drips: the floor they splash on; dust: the light's colour phase. */
  floorY: number;
}

interface Emitter {
  kind: 'drip' | 'steam' | 'spark' | 'dust';
  x: number; y: number;
  next: number;
  /** Steam: venting until this time; dust: half-width of the light cone, floor y in floorY. */
  until: number;
  w: number;
  floorY: number;
  color: number;
  alive: number;
  flash?: Sprite;
}

export function buildAtmosphere(buildings: BuildingInstance[], floors: number, era: number, lamps: WorldLamp[], src: DecalSources, exts: readonly Ext[] = []): Atmosphere {
  const root = new Container();
  root.eventMode = 'none';
  const fixtures = new Graphics();
  const back = new Container();
  const addL = new Container();
  addL.blendMode = 'add';
  root.addChild(fixtures, back, addL);
  const mote = moteTexture();
  const glow = glowTexture();
  const e = Math.max(0, Math.min(3, era));
  const ems: Emitter[] = [];
  const r = seeded(hashString(`atmo:${floors}`));

  for (const d of src.drips) ems.push({ kind: 'drip', x: d.x, y: d.y, next: r() * 3, until: 0, w: 0, floorY: d.floorY, color: 0xb8ccd4, alive: 0 });

  for (const sp of src.sparks) {
    const flash = new Sprite(glow);
    flash.anchor.set(0.5);
    flash.tint = 0xffc070;
    flash.width = flash.height = 26;
    flash.alpha = 0;
    addL.addChild(flash);
    ems.push({ kind: 'spark', x: sp.x, y: sp.y, next: 0.5 + r() * 3, until: 0, w: 0, floorY: 0, color: 0xffd080, alive: 0, flash });
  }

  // Valves on the pipe bundle: a few fixed joints per level that leak steam (more in the wrecked eras).
  const perFloor = [2, 1.2, 0.6, 0.35][e];
  for (let f = 0; f < floors; f++) {
    const fr = seeded(hashString(`steam:${f}`));
    const halls = buildings.filter(b => isHall(b.type) && b.position.floor === f - 1)
      .map(b => [slotX(b.position.x), slotX(b.position.x) + roomSlots(b.type) * SLOT_W]);
    let n = perFloor;
    while (n > 0) {
      const chance = Math.min(1, n);
      n -= 1;
      if (fr() > chance) continue;
      // Joints sit where pipe sections meet: half-slot marks along the run.
      const x = ROOMS_X + SLOT_W / 4 + Math.floor(fr() * (2 * (exts[f]?.e ?? BASE_EAST) - 1)) * (SLOT_W / 2);
      if (halls.some(([a, b]) => x > a - 4 && x < b + 4)) continue;
      const y = floorTop(f) + 6;
      valve(fixtures, x, y, fr);
      ems.push({ kind: 'steam', x: x + 2.5, y: y - 1, next: fr() * 6, until: 0, w: fr() < 0.5 ? -1 : 1, floorY: 0, color: 0xd6dadb, alive: 0 });
    }
    // [plan4:ST-4] A west wing has its own valves on its bundle (own random stream: the east side stays as it was).
    const ew = exts[f]?.w ?? 0;
    if (ew > 0) {
      const wr = seeded(hashString(`steam-w:${f}`));
      let m = perFloor;
      while (m > 0) {
        const chance = Math.min(1, m);
        m -= 1;
        if (wr() > chance) continue;
        const x = -SHAFT_GAP - SLOT_W / 4 - Math.floor(wr() * (2 * ew - 1)) * (SLOT_W / 2);
        if (halls.some(([a, b]) => x > a - 4 && x < b + 4)) continue;
        const y = floorTop(f) + 6;
        valve(fixtures, x, y, wr);
        ems.push({ kind: 'steam', x: x + 2.5, y: y - 1, next: wr() * 6, until: 0, w: wr() < 0.5 ? -1 : 1, floorY: 0, color: 0xd6dadb, alive: 0 });
      }
    }
  }

  // Dust turning in the light under each ceiling lamp.
  for (const l of lamps) {
    if (!l.ceiling) continue;
    const f = Math.max(0, floorAtY(l.y).floor);
    ems.push({ kind: 'dust', x: l.x, y: l.y + 4, next: r() * 2, until: 0, w: Math.min(26, l.reach * 0.22), floorY: floorTop(f) + ROOM_H - 10, color: l.color, alive: 0 });
  }

  // [plan4:ST-1] Steam from the valves of the service galleries (same pool and budget; none while a gallery does not exist or in Low, which draws no atmosphere).
  if (exts.length) {
    const gr = seeded(hashString(`gallery-steam:${floors}`));
    for (const v of galleryVents(floors, exts)) ems.push({ kind: 'steam', x: v.x + 2.5, y: v.y - 1, next: gr() * 6, until: 0, w: gr() < 0.5 ? -1 : 1, floorY: 0, color: 0xd6dadb, alive: 0 });
  }

  const pool: P[] = [];
  const active: P[] = [];
  const take = (kind: Kind, tex: Texture, add: boolean): P | null => {
    let p = pool.pop();
    if (!p) {
      if (active.length >= BUDGET) return null;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      p = { s, kind, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, grow: 0, a: 1, floorY: 0 };
    }
    p.kind = kind;
    p.s.texture = tex;
    // Shown once the update loop has placed it (a fresh sprite would flash at the origin for a frame).
    p.s.visible = false;
    p.s.rotation = 0;
    p.age = 0;
    p.grow = 0;
    (add ? addL : back).addChild(p.s);
    active.push(p);
    return p;
  };
  const release = (i: number) => {
    const p = active[i];
    p.s.visible = false;
    p.s.removeFromParent();
    active[i] = active[active.length - 1];
    active.pop();
    pool.push(p);
  };

  let vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0;
  const inView = (x: number, y: number, m = 30) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

  const spawn = (em: Emitter, t: number, cap: number, dustCap: number) => {
    switch (em.kind) {
      case 'drip': {
        // A drop swells at the stain for a moment, then lets go.
        const p = take('drip', mote, false);
        if (!p) return;
        p.x = em.x; p.y = em.y; p.vx = 0; p.vy = 0;
        p.life = 9; p.size = 0.6; p.a = 0.8; p.floorY = em.floorY;
        p.s.tint = em.color;
        em.next = t + 1.4 + r() * 2.8;
        return;
      }
      case 'steam': {
        if (t >= em.until) {
          // The burst is over: the valve rests a while, then vents for a few seconds.
          em.next = t + 3 + r() * 6;
          em.until = em.next + 1.5 + r() * 2.5;
          return;
        }
        if (em.alive >= 10 || active.length >= cap) { em.next = t + 0.2; return; }
        const p = take('steam', puffTexture(), false);
        if (!p) return;
        // A jet from the joint that slows, swells and rises as it cools.
        p.x = em.x + (r() - 0.5) * 2; p.y = em.y;
        p.vx = em.w * (10 + r() * 10); p.vy = 2 + r() * 4;
        p.life = 1.6 + r() * 0.9; p.size = 2.5; p.grow = 12 + r() * 6; p.a = [0.62, 0.52, 0.42, 0.34][e];
        p.s.tint = em.color;
        p.floorY = ems.indexOf(em);
        em.alive++;
        em.next = t + 0.12 + r() * 0.12;
        return;
      }
      case 'spark': {
        em.next = t + 1.6 + r() * 4.5;
        const n = 5 + Math.floor(r() * 7);
        for (let i = 0; i < n && active.length < cap; i++) {
          const p = take('spark', mote, true);
          if (!p) break;
          p.x = em.x + (r() - 0.5) * 3; p.y = em.y;
          const a = Math.PI * (0.15 + r() * 0.7);
          const sp = 30 + r() * 60;
          p.vx = Math.cos(a) * sp * (r() < 0.5 ? -1 : 1); p.vy = -Math.sin(a) * sp * 0.6 + 10;
          p.life = 0.3 + r() * 0.45; p.size = 1.1 + r() * 0.6; p.a = 1;
          p.s.tint = r() < 0.5 ? 0xffd890 : 0xffa040;
        }
        if (em.flash) em.flash.alpha = 0.9;
        return;
      }
      case 'dust': {
        if (em.alive >= 4 || active.length >= dustCap) { em.next = t + 0.5; return; }
        const p = take('dust', mote, true);
        if (!p) return;
        const depth = r();
        p.y = em.y + 6 + depth * (em.floorY - em.y - 10);
        p.x = em.x + (r() - 0.5) * 2 * em.w * (0.4 + depth * 0.8);
        p.vx = (r() - 0.5) * 3; p.vy = -0.5 + r() * 2.5;
        p.life = 4 + r() * 4; p.size = 0.9 + r() * 0.8; p.a = 0.22 + r() * 0.2;
        p.s.tint = em.color;
        p.floorY = ems.indexOf(em);
        em.alive++;
        em.next = t + 0.6 + r() * 1.4;
      }
    }
  };

  return {
    container: root,
    sources: ems.map(e => ({ kind: e.kind, x: e.x, y: e.y })),
    live: () => active.length,
    update: (t, dt, power, world, screen, quality) => {
      const off = quality === 'low';
      root.visible = !off;
      if (off) {
        while (active.length) release(active.length - 1);
        for (const em of ems) em.alive = 0;
        return;
      }
      const cap = quality === 'medium' ? BUDGET / 2 : BUDGET;
      const tl = world.toLocal({ x: 0, y: 0 });
      const br = world.toLocal({ x: screen.width, y: screen.height });
      vx0 = tl.x; vy0 = tl.y; vx1 = br.x; vy1 = br.y;
      // Too far out to see a drop: skip the whole thing.
      const far = vx1 - vx0 > 900;

      if (!far) {
        for (const em of ems) {
          if (em.flash && em.flash.alpha > 0) em.flash.alpha = Math.max(0, em.flash.alpha - dt * 7);
          if (t < em.next || !inView(em.x, em.y, em.kind === 'dust' ? 10 : 40)) continue;
          if (em.kind === 'spark' && power < 0.05) { em.next = t + 2; continue; }
          if (em.kind === 'dust' && power < 0.1) { em.next = t + 1; continue; }
          if (active.length >= cap) break;
          spawn(em, t, cap, Math.floor(cap * 0.5));
        }
      }

      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i];
        p.age += dt;
        const k = p.age / p.life;
        const s = p.s;
        let dead = k >= 1;
        switch (p.kind) {
          case 'drip': {
            if (p.age < 0.7) {
              // Swelling at the source.
              const g = p.age / 0.7;
              s.width = 0.8 + g * 0.6;
              s.height = 0.9 + g * 1.1;
              s.alpha = p.a * g;
              s.position.set(p.x, p.y + g * 1.2);
              break;
            }
            p.vy += 320 * dt;
            p.y += p.vy * dt;
            s.width = 1.1;
            s.height = 1.8 + Math.min(2.2, p.vy * 0.012);
            s.alpha = p.a;
            s.position.set(p.x, p.y);
            if (p.y >= p.floorY) {
              dead = true;
              for (let j = 0; j < 3 && active.length < cap; j++) {
                const q = take('splash', mote, false);
                if (!q) break;
                q.x = p.x; q.y = p.floorY; q.vx = (r() - 0.5) * 30; q.vy = -12 - r() * 16;
                q.life = 0.25 + r() * 0.15; q.size = 0.7; q.a = 0.7;
                q.s.tint = 0xc8d8de;
              }
            }
            break;
          }
          case 'splash': {
            p.vy += 260 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt;
            s.position.set(p.x, p.y);
            s.width = s.height = p.size;
            s.alpha = p.a * (1 - k);
            break;
          }
          case 'steam': {
            // Rises, spreads and thins out; drifts away from the wall.
            p.x += p.vx * dt; p.y += p.vy * dt - 9 * dt * k;
            p.vx *= 1 - dt * 1.6;
            p.vy *= 1 - dt * 2;
            const sz = p.size + p.grow * Math.sqrt(k);
            s.width = sz * 1.3;
            s.height = sz;
            s.position.set(p.x, p.y);
            s.alpha = p.a * Math.min(1, k * 6) * (1 - k);
            if (dead) {
              const em = ems[p.floorY];
              if (em) em.alive = Math.max(0, em.alive - 1);
            }
            break;
          }
          case 'spark': {
            p.vy += 220 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt;
            const v = Math.hypot(p.vx, p.vy);
            s.rotation = Math.atan2(p.vy, p.vx) + Math.PI / 2;
            s.width = p.size;
            s.height = p.size + Math.min(4, v * 0.04);
            s.position.set(p.x, p.y);
            s.alpha = p.a * (1 - k * k);
            break;
          }
          case 'dust': {
            p.x += (p.vx + Math.sin(t * 0.7 + p.y * 0.1) * 1.5) * dt;
            p.y += p.vy * dt;
            s.width = s.height = p.size;
            s.position.set(p.x, p.y);
            // Glints in and out of the light; brighter with the power.
            s.alpha = p.a * Math.sin(Math.PI * k) * Math.min(1, power * 1.1);
            if (dead) {
              const em = ems[p.floorY];
              if (em) em.alive = Math.max(0, em.alive - 1);
            }
            break;
          }
        }
        if (dead) release(i);
        else s.visible = true;
      }
    },
  };
}

/** A flanged joint with a small hand wheel on the pipe bundle — the visible source of the steam. */
function valve(g: Graphics, x: number, y: number, r: () => number): void {
  // Flange collar around the bundle.
  g.rect(x - 2, y - 5, 4.5, 11).fill(0x2a2b2a);
  g.rect(x - 2, y - 5, 1.2, 11).fill({ color: 0x9a9a90, alpha: 0.35 });
  for (const by of [y - 3.5, y + 3.5]) g.circle(x + 0.3, by, 0.7).fill(0x6a6a62);
  // Hand wheel on a short stem.
  const wx = x + 2.5 + (r() < 0.5 ? 0 : -5), wy = y - 2;
  g.rect(wx - 0.5, wy, 1, 3).fill(0x3a3a38);
  g.circle(wx, wy, 2.6).stroke({ color: 0x7a3a26, width: 1 });
  g.moveTo(wx - 2.4, wy).lineTo(wx + 2.4, wy).stroke({ color: 0x7a3a26, width: 0.6 });
  g.moveTo(wx, wy - 2.4).lineTo(wx, wy + 2.4).stroke({ color: 0x7a3a26, width: 0.6 });
}
