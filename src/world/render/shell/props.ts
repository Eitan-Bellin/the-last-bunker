/**
 * [world:C1] Small dressing shared by the edges, the dig face and the caverns: tunnel floors, timber, caution tape, a pick, a lantern set
 * on the ground, rubble walls that shrink with a dig's progress, cracks and a spray-painted dig mark.
 */
import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { makeWorldTiling } from '../../../art/worldKit';
import type { Hex, StratumId } from '../../tokens';
import { noise1 } from '../../model/outline';
import type { LightDef } from './types';
import { OUTLINE, contactShadow, palette, rng, rod, shade, sprite, vfill } from './kit';

/** A rough tunnel floor (packed dirt and grit) from xa to xb with its walking surface at y. */
export function tunnelFloor(g: Graphics, xa: number, xb: number, y: number, depth: number, s: StratumId, seed: number): void {
  const P = palette(s);
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
  const pts: number[] = [x0, y + depth];
  for (let x = x0; x <= x1; x += 6) pts.push(x, y - 1.5 * noise1(seed, x / 14));
  pts.push(x1, y, x1, y + depth);
  g.poly(pts).fill(vfill(shade(P.rockDark, 0.95), y - 2, y + depth, 1.15, 0.6));
  g.moveTo(x0, y).lineTo(x1, y).stroke({ width: 1, color: P.rockRim, alpha: 0.25 });
  const r = rng(seed);
  for (let i = 0; i < (x1 - x0) / 9; i++) {
    const px = x0 + r() * (x1 - x0), sz = 0.8 + r() * 2.2;
    g.ellipse(px, y - sz * 0.4, sz * 1.3, sz).fill(shade(P.rock, 0.7 + r() * 0.6));
  }
}

/** Caution tape stretched from (xa, ya) to (xb, yb). */
export function tape(into: Container, xa: number, ya: number, xb: number, yb: number): TilingSprite {
  const len = Math.hypot(xb - xa, yb - ya);
  const t = makeWorldTiling('tape', len, 9);
  t.anchor.set(0, 0.5);
  t.position.set(xa, ya);
  t.rotation = Math.atan2(yb - ya, xb - xa);
  into.addChild(t);
  return t;
}

/** A pick lying or leaning: steel head on a wooden haft. */
export function pick(g: Graphics, x: number, y: number, angle: number): void {
  const len = 30, hx = x + Math.cos(angle) * len, hy = y + Math.sin(angle) * len;
  rod(g, x, y, hx, hy, 2.2, 0x7a5636);
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  rod(g, hx - nx * 9, hy - ny * 9 + 2, hx + nx * 9, hy + ny * 9 - 2, 2.4, 0x6a6e72);
}

/** A shovel leaning against a wall. */
export function shovel(g: Graphics, x: number, y: number, lean: number): void {
  const tx = x + lean * 30, ty = y - 30;
  rod(g, x, y - 8, tx, ty, 2, 0x7a5636);
  g.poly([x - 4, y, x + 4, y, x + 3 + lean * 2, y - 10, x - 3 + lean * 2, y - 10]).fill(vfill(0x5e6266, y - 10, y)).stroke({ ...OUTLINE, width: 1 });
}

/** A lantern set on the ground (its anchor is the hook; on the ground it stands on its base). */
export function groundLantern(into: Container, glow: Container, x: number, y: number, area: string): LightDef[] {
  const s = sprite('lamp-lantern', x, y);
  s.anchor.y = 1;
  into.addChild(s);
  const e = sprite('lamp-lantern', x, y, { emissive: true });
  e.anchor.y = 1;
  glow.addChild(e);
  return [{ x, y: y - 8, preset: 'lantern', kind: 'shell', area }];
}

/**
 * A rubble wall standing on y from xa to xb, as tall as `fill` (0..1) of `h`: kit rubble piles packed side by side, scaled to the fill.
 * Returns a setter for the fill (a dig's progress clears it without a rebuild).
 */
export function rubbleWall(into: Container, xa: number, xb: number, y: number, h: number, seed: number): (fill: number) => void {
  const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
  const r = rng(seed);
  const pieces: { s: Sprite; base: number }[] = [];
  const back = new Container();
  const mid = new Container();
  // Two rows: big chokes behind, smaller piles in front, overlapping.
  for (let x = x0 + 20; x < x1 + 10; x += 46 + r() * 20) {
    const big = sprite(r() < 0.6 ? 'rubble-c' : 'rubble-b', Math.min(x, x1 - 18), y + 2, { flip: r() < 0.5 });
    const k = h / 50;
    big.scale.set(big.scale.x * (0.9 + r() * 0.25), big.scale.y * k * (0.9 + r() * 0.2));
    pieces.push({ s: big, base: big.scale.y });
    back.addChild(big);
  }
  for (let x = x0 + 8; x < x1; x += 34 + r() * 26) {
    const sm = sprite(r() < 0.5 ? 'rubble-a' : 'rubble-b', x, y + 3, { flip: r() < 0.5 });
    sm.scale.set(sm.scale.x * (0.7 + r() * 0.3), sm.scale.y * (0.7 + r() * 0.35));
    pieces.push({ s: sm, base: sm.scale.y });
    mid.addChild(sm);
  }
  into.addChild(back, mid);
  return (fill: number) => {
    const f = Math.max(0, Math.min(1, fill));
    for (const p of pieces) {
      p.s.scale.y = p.base * Math.max(0.12, f);
      p.s.visible = f > 0.03;
    }
  };
}

/** Jagged cracks running out of a point into the rock; `glowColor` adds an additive lit core (light leaking through). */
export function cracks(dark: Graphics, lit: Graphics | null, x: number, y: number, n: number, len: number, seed: number, glowColor?: Hex): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + r() * 0.8, px = x, py = y;
    const pts = [px, py];
    let l = len * (0.5 + r() * 0.6);
    while (l > 0) {
      const step = 6 + r() * 8;
      a += (r() - 0.5) * 0.9;
      px += Math.cos(a) * step;
      py += Math.sin(a) * step;
      pts.push(px, py);
      l -= step;
    }
    dark.poly(pts, false).stroke({ width: 2.2, color: 0x0a0806, alpha: 0.85, join: 'round', cap: 'round' });
    if (lit && glowColor !== undefined) {
      lit.poly(pts, false).stroke({ width: 3.5, color: glowColor, alpha: 0.18, join: 'round', cap: 'round' });
      lit.poly(pts, false).stroke({ width: 1, color: glowColor, alpha: 0.75, join: 'round', cap: 'round' });
    }
  }
}

/** A spray-painted dig mark (an X in hazard paint) on a rock face. */
export function sprayX(g: Graphics, x: number, y: number, size: number, color: Hex): void {
  for (const [ax, ay, bx, by] of [[-1, -1, 1, 1], [1, -1, -1, 1]]) {
    g.moveTo(x + ax * size, y + ay * size).lineTo(x + bx * size, y + by * size).stroke({ width: 3.2, color, alpha: 0.78, cap: 'round' });
    g.moveTo(x + ax * size, y + ay * size).lineTo(x + bx * size, y + by * size).stroke({ width: 6, color, alpha: 0.12, cap: 'round' });
  }
}

/** A wooden post (tape stand, plate post). */
export function post(g: Graphics, x: number, yTop: number, yBot: number): void {
  rod(g, x, yTop, x, yBot, 2.6, 0x6b4c2e);
  contactShadow(g, x, yBot, 8);
}
