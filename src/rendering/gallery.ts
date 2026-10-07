import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { glowTexture } from '../art/ArtLibrary';
import { GALLERY_H, SHAFT_W, SLOT_W, galleryCount, galleryExt, galleryTop, slotX, type Ext } from './geom';
import { seeded } from './draw';
import { VIEW } from './perfFx';
import { depthGains, kitTex, softTexture, type KitState } from './structure';
import type { Animated } from './world';

/**
 * [plan4:ST-1] Service galleries: a low crawl-space band between the slab under floors 3, 7, 11, 15 and 19 and the ceiling of the floor below it. No rooms live
 * here. A horizontal band as wide as the widest floor above it (both sides of the shaft when that floor has a west wing; the shaft itself passes through
 * and is drawn by shaft.ts): a thick pipe bundle under the slab (the kit's pipes at 1.4 scale), a cable tray, a grated catwalk, steel struts, and warm
 * emergency lamps whose glow breathes slowly (no hard flicker). The steam jets live in atmosphere.ts (it owns the particle pool) at the vents listed by
 * `galleryVents`. Static once built; per frame only the lamp glows of galleries in view change their alpha.
 */

/** Pipe bundle height: the structure's bundle (11) at 1.4 scale. */
const PIPE_H = 15;
const PIPE_Y = 2;
const TRAY_Y = 19;
const CATWALK_Y = 27;
const CATWALK_H = GALLERY_H - CATWALK_Y;
const LAMP_Y = 22;
/** Brightness of the unlit gallery by kit state (it is a dim service space lit by its own lamps). */
const BASE: Record<KitState, number> = { R: 0.8, F: 0.78, L: 0.74 };

let grateTex: Texture | null = null;

/** Catwalk edge seen from the front: a steel plate with a row of slots, lit on its top arris (12 x 8, tiles sideways). */
function grateTexture(): Texture {
  if (grateTex) return grateTex;
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#34322e';
  ctx.fillRect(0, 0, 24, 16);
  ctx.fillStyle = 'rgba(200,190,170,0.5)';
  ctx.fillRect(0, 0, 24, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 14, 24, 2);
  // Slots of the grating, seen along the walking surface.
  ctx.fillStyle = '#0c0b0a';
  for (let x = 1; x < 24; x += 4) ctx.fillRect(x, 5, 2.4, 6);
  // A weld seam and a little rust.
  ctx.fillStyle = 'rgba(122,70,34,0.28)';
  ctx.fillRect(0, 12, 24, 1);
  grateTex = Texture.from(c);
  return grateTex;
}

/** Where the steam jets of a bunker's galleries stand (world x, y of the valve): deterministic, for atmosphere.ts. */
export function galleryVents(floors: number, exts: readonly Ext[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let g = 0; g < galleryCount(floors); g++) {
    const ext = galleryExt(exts, g);
    const r = seeded(7000 + g * 31);
    const y = galleryTop(g) + PIPE_Y + PIPE_H * 0.55;
    const x0 = slotX(-ext.w), x1 = slotX(ext.e);
    const n = 1 + Math.floor((x1 - x0) / (SLOT_W * 7));
    for (let i = 0; i < n; i++) {
      let x = x0 + SLOT_W * 2 + r() * (x1 - x0 - SLOT_W * 4);
      if (x > -SLOT_W && x < SHAFT_W + SLOT_W) x = x < SHAFT_W / 2 ? -SLOT_W : SHAFT_W + SLOT_W; // never in the lift
      out.push({ x: Math.round(x / 23) * 23 + 6, y });
    }
  }
  return out;
}

export function buildGalleries(floors: number, exts: readonly Ext[], st: KitState, ambient: number): Animated {
  const root = new Container();
  root.eventMode = 'none';
  const n = galleryCount(floors);
  const glow = glowTexture();
  const pipeTex = kitTex('pipes', st);
  const colTex = kitTex('column', st);
  const drop = softTexture('drop');
  const lip = softTexture('lip');
  const base = Math.min(0.95, BASE[st] * (0.85 + 0.3 * ambient));
  const tintAt = (v: number, y: number) => {
    const [r, g, b] = depthGains(y);
    const c = (k: number) => Math.round(255 * Math.max(0, Math.min(1, v * k)));
    return (c(r) << 16) | (c(g) << 8) | c(b);
  };

  interface Band { c: Container; y0: number; y1: number; shown: boolean; lamps: { s: Sprite; a: number; ph: number }[] }
  const bands: Band[] = [];

  for (let g = 0; g < n; g++) {
    const ext = galleryExt(exts, g);
    const y0 = galleryTop(g);
    const band: Band = { c: new Container(), y0, y1: y0 + GALLERY_H, shown: true, lamps: [] };
    band.c.eventMode = 'none';
    const r = seeded(4100 + g * 17);
    const tint = tintAt(base, y0 + GALLERY_H / 2);
    // Both halves of the band: east of the shaft, and west of it when the floors above reach that way.
    const spans: [number, number][] = [[SHAFT_W, slotX(ext.e) + 6]];
    if (ext.w > 0) spans.push([slotX(-ext.w) - 6, 0]);
    const g2 = new Graphics();
    for (const [xa, xb] of spans) {
      const w = xb - xa;
      // The back of the crawl space: dark, so the lamps and the bundle read.
      g2.rect(xa, y0, w, GALLERY_H).fill({ color: 0x050607, alpha: 0.42 });
      // The slab above throws its shadow down the back wall.
      const sh = new Sprite(drop);
      sh.tint = 0x000000;
      sh.alpha = 0.55;
      sh.width = w;
      sh.height = 16;
      sh.position.set(xa, y0 - 1);
      band.c.addChild(sh);
      // The thick pipe bundle under the slab.
      if (pipeTex) {
        const p = new TilingSprite({ texture: pipeTex, width: w, height: PIPE_H });
        p.position.set(xa, y0 + PIPE_Y);
        p.tileScale.set(PIPE_H / pipeTex.height);
        p.tilePosition.set(-xa - g * 37, 0);
        p.tint = tint;
        band.c.addChild(p);
      } else {
        g2.rect(xa, y0 + PIPE_Y, w, PIPE_H).fill(0x3a4048);
        g2.rect(xa, y0 + PIPE_Y + 2, w, 3).fill(0x4a4a46);
      }
      // A second, thinner water main, and the cable tray hung under it.
      g2.rect(xa, y0 + 17.5, w, 2.6).fill(0x3e4a40);
      g2.rect(xa, y0 + 17.5, w, 0.8).fill({ color: 0xa0a890, alpha: 0.4 });
      g2.rect(xa, y0 + TRAY_Y + 2, w, 5).fill(0x16171a);
      g2.rect(xa, y0 + TRAY_Y + 2, w, 0.8).fill({ color: 0x8a8f94, alpha: 0.4 });
      g2.rect(xa, y0 + TRAY_Y + 6.4, w, 0.8).fill({ color: 0x000000, alpha: 0.6 });
      for (let x = xa; x < xb; x += 6 + r() * 9) {
        const col = r() < 0.5 ? 0x14161a : r() < 0.6 ? 0x6a2a1a : 0x1c3a52;
        g2.rect(x, y0 + TRAY_Y + 3 + Math.floor(r() * 3) * 1.2, 3 + r() * 6, 1).fill({ color: col, alpha: 0.85 });
      }
      // Hanger brackets for the tray every half slot-pair.
      for (let x = xa + 8; x < xb - 4; x += SLOT_W) {
        g2.rect(x, y0 + 14, 1.6, TRAY_Y - 11).fill(0x2a2a28);
        g2.rect(x - 2, y0 + TRAY_Y + 7, 5.6, 1.2).fill(0x2a2a28);
      }
      // The catwalk: grating on brackets along the floor of the gallery.
      const cat = new TilingSprite({ texture: grateTexture(), width: w, height: CATWALK_H });
      cat.position.set(xa, y0 + CATWALK_Y);
      cat.tileScale.set(0.5);
      cat.tint = tintAt(base * 1.7, y0 + CATWALK_Y);
      band.c.addChild(cat);
      const edge = new Sprite(lip);
      edge.position.set(xa, y0 + CATWALK_Y - 1.5);
      edge.width = w;
      edge.height = 5;
      edge.alpha = 0.55;
      band.c.addChild(edge);
      // Steel struts from the slab to the catwalk, with a base plate.
      if (colTex) {
        for (let s = -Math.ceil(ext.w / 4) * 4; s <= ext.e; s += 4) {
          const x = slotX(s);
          if (x <= xa + 8 || x >= xb - 4 || (x > -SLOT_W && x < SHAFT_W + SLOT_W / 2)) continue;
          const post = new TilingSprite({ texture: colTex, width: 5, height: GALLERY_H });
          post.position.set(x - 2.5, y0);
          post.tileScale.set(10 / colTex.width);
          post.tilePosition.set(0, -y0);
          post.tint = tintAt(base * 1.1, y0 + 17);
          band.c.addChild(post);
        }
      }
      // Emergency lamps: a caged bulb on the strut line every four slots, a glow that breathes and a pool on the catwalk.
      for (let x = xa + SLOT_W * 2 + r() * SLOT_W; x < xb - SLOT_W; x += SLOT_W * 3.2 + r() * SLOT_W) {
        if (x > -SLOT_W / 2 && x < SHAFT_W + SLOT_W / 2) continue;
        const red = r() < 0.3;
        const color = red ? 0xff5a30 : 0xffa24a;
        g2.rect(x - 3, y0 + LAMP_Y - 3, 6, 5.4).fill(0x15130f);
        g2.rect(x - 2.1, y0 + LAMP_Y - 2.2, 4.2, 3.4).fill(red ? 0x6a2410 : 0x8a5a24);
        g2.rect(x - 3, y0 + LAMP_Y - 3, 6, 0.8).fill({ color: 0x8a8a80, alpha: 0.4 });
        g2.rect(x - 0.4, y0 + LAMP_Y - 3, 0.8, 0.1).fill(0xffffff);
        const halo = new Sprite(glow);
        halo.anchor.set(0.5);
        halo.tint = color;
        halo.blendMode = 'add';
        halo.width = 74;
        halo.height = GALLERY_H * 1.1;
        halo.position.set(x, y0 + LAMP_Y);
        const core = new Sprite(glow);
        core.anchor.set(0.5);
        core.tint = 0xffe0b0;
        core.blendMode = 'add';
        core.width = 7;
        core.height = 5.5;
        core.position.set(x, y0 + LAMP_Y - 0.5);
        const pool = new Sprite(glow);
        pool.anchor.set(0.5);
        pool.tint = color;
        pool.blendMode = 'add';
        pool.width = 44;
        pool.height = 7;
        pool.position.set(x, y0 + CATWALK_Y + 1);
        band.c.addChild(halo, core, pool);
        band.lamps.push({ s: halo, a: red ? 0.6 : 0.75, ph: r() * 6.28 }, { s: core, a: 0.85, ph: 0 }, { s: pool, a: 0.6, ph: 0 });
      }
      // Valve wheels where the steam leaves the bundle (atmosphere.ts puffs from the same spots).
    }
    for (const v of galleryVents(floors, exts).filter(v => v.y > y0 && v.y < y0 + GALLERY_H)) {
      g2.rect(v.x - 2, v.y - 6, 4.5, 12).fill(0x2a2b2a);
      g2.rect(v.x - 2, v.y - 6, 1.2, 12).fill({ color: 0x9a9a90, alpha: 0.35 });
      g2.circle(v.x + 4, v.y - 2, 2.6).stroke({ color: 0x7a3a26, width: 1 });
    }
    band.c.addChildAt(g2, 0);
    // Ends of the band: where it enters the casing walls, the shadow of the wall.
    const endFade = softTexture('fadeH');
    for (const [ex, flip] of [[slotX(ext.e) + 6 - 8, true], ...(ext.w > 0 ? [[slotX(-ext.w) - 6, false]] : [])] as [number, boolean][]) {
      const cap = new Sprite(endFade);
      cap.tint = 0x000000;
      cap.alpha = 0.6;
      cap.width = 8;
      cap.height = GALLERY_H;
      cap.position.set(ex, y0);
      if (flip) {
        cap.scale.x *= -1;
        cap.x += 8;
      }
      band.c.addChild(cap);
    }
    root.addChild(band.c);
    bands.push(band);
  }

  return {
    container: root,
    animate: (t, power) => {
      const { y0, y1 } = VIEW;
      for (const b of bands) {
        const show = b.y1 > y0 && b.y0 < y1;
        if (show !== b.shown) {
          b.shown = show;
          b.c.visible = show;
        }
        if (!show) continue;
        // The emergency circuit stays on when the power sags (a little dimmer), and the glow breathes slowly.
        const k = 0.65 + 0.35 * power;
        for (const l of b.lamps) l.s.alpha = l.a * k * (l.ph ? 0.88 + 0.12 * Math.sin(t * 1.3 + l.ph) : 1);
      }
    },
  };
}
