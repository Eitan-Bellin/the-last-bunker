/**
 * [world:M1] The identity of each district cavern (style guide 2 "side districts keep their own painting and identity"; architecture
 * 1.4). The painted district room stands in the middle; around it the cavern says what the place is:
 *   cave        a dripstone hall: stalactites and stalagmites, moss on the ledges, a string of lanterns across the roof;
 *   lake        the ledge under the room is open black water with the lamps' reflections in it, a plank jetty on posts carries the walk,
 *               a rowboat moored in the open water past the room;
 *   metro       an old station: a tiled tunnel vault behind, the room on the platform (yellow edge), the track in its trench, a dead
 *               coach on the rails past the room with its windows lit (a market stall now), the enamel plate, sodium lamps, a signal;
 *   geothermal  a magma seam under the ledge lighting it from below, steam;  oldVault  the vault's ring door in the cavern wall.
 * Glimpsed (on offer) and being dug, each shows one hint of itself past the rubble: water, rails, dripstone.
 * Every function draws into the cavern piece's layers: `back` (behind the rock: what shows through the open cavern), `g` (in front,
 * under the people) and the additive `lit` glow; lights go in `lights` with the district's area id.
 */
import { Container, Graphics } from 'pixi.js';
import { PROPS, type StratumPalette } from '../../tokens';
import type { LightDef } from './types';
import { OUTLINE, contactShadow, lamp, mix, rng, rod, shade, tile, vfill } from './kit';

const D = PROPS.district;
const ST = PROPS.kit.station;

export interface DistrictCtx {
  kind: string;
  area: string;
  P: StratumPalette;
  /** The cavern's bounds, the room's span, the storey's lines. */
  cb: { x0: number; y0: number; x1: number; y1: number };
  room: { x0: number; x1: number };
  top: number; floor: number; lane: number; bottom: number;
  seed: number;
  roofAt: (x: number) => number | null;
  back: Container;
  g: Graphics;
  lit: Graphics;
  front: Container;
  glow: Container;
  lights: LightDef[];
}

/** Revealed: the full identity. Returns true when the generic ledge and street lamp should NOT be drawn (lake, metro). */
export function dressDistrict(c: DistrictCtx): boolean {
  switch (c.kind) {
    case 'cave': cave(c); return false;
    case 'lake': lake(c); return true;
    case 'metro': metro(c); return true;
    case 'geothermal': geothermal(c); return false;
    case 'oldVault': oldVault(c); return false;
    default: return false;
  }
}

/** Glimpsed or being dug: one hint of the place past the rubble. */
export function hintDistrict(c: DistrictCtx): void {
  const { g, lit, lane } = c;
  const x0 = c.room.x0 + 40, x1 = c.room.x1 + 30;
  if (c.kind === 'lake') {
    g.rect(x0, lane + 6, x1 - x0, 8).fill(vfill(D.water, lane + 6, lane + 14));
    for (let x = x0 + 6; x < x1 - 6; x += 18) lit.rect(x, lane + 7, 9, 1).fill({ color: D.waterLine, alpha: 0.35 });
  } else if (c.kind === 'metro') {
    for (const dy of [4, 9]) rod(g, x0, lane + dy, x1, lane + dy, 1.2, D.rail);
  } else if (c.kind === 'cave') {
    const r = rng(c.seed + 9);
    for (let x = x0; x < x1; x += 16 + r() * 12) {
      const roof = c.top - 6, len = 10 + r() * 18, w = 3 + r() * 3;
      g.poly([x - w, roof, x + w, roof, x, roof + len]).fill(vfill(D.dripstone, roof, roof + len, 1.2, 0.6)).stroke({ ...OUTLINE, width: 0.8 });
    }
  }
}

// -------------------------------------------------------------------------------------------------------------------------- cave

function cave(c: DistrictCtx): void {
  const { g, lit, cb, room, top, lane } = c;
  const r = rng(c.seed + 1);
  // Stalagmites on the ledge either side of the room, and dripstone curtains on the far walls.
  for (const [xa, xb] of [[cb.x0 + 14, room.x0 - 8], [room.x1 + 8, cb.x1 - 14]] as const) {
    for (let x = xa; x < xb; x += 9 + r() * 10) {
      const h = 8 + r() * 26, w = 3 + r() * 4;
      g.poly([x - w, lane, x + w, lane, x + (r() - 0.5) * 2, lane - h]).fill(vfill(D.dripstone, lane - h, lane, 1.25, 0.6)).stroke({ ...OUTLINE, width: 0.8 });
    }
  }
  // Moss along the ledge lip and in tufts on the roof.
  for (let x = cb.x0 + 10; x < cb.x1 - 10; x += 7 + r() * 9) {
    if (x > room.x0 - 4 && x < room.x1 + 4 && r() < 0.6) continue;
    g.ellipse(x, lane + 1, 3 + r() * 4, 1.6 + r()).fill({ color: r() < 0.3 ? D.mossLit : D.moss, alpha: 0.85 });
  }
  for (let x = cb.x0 + 20; x < cb.x1 - 20; x += 12 + r() * 16) {
    const roof = c.roofAt(x);
    if (roof === null) continue;
    g.ellipse(x, roof + 3, 4 + r() * 5, 2 + r() * 1.5).fill({ color: D.moss, alpha: 0.6 });
  }
  // The lantern string across the roof: a sagging rope, five lanterns (the cave is lived in).
  const xa = room.x0 + 6, xb = cb.x1 - 26, ya = top - 36;
  const rope: number[] = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; rope.push(xa + (xb - xa) * t, ya + Math.sin(Math.PI * t) * 14); }
  g.poly(rope, false).stroke({ width: 0.9, color: PROPS.kit.mine.rope, alpha: 0.9 });
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    c.lights.push(...lamp(c.front, c.glow, 'lamp-lantern', xa + (xb - xa) * t, ya + Math.sin(Math.PI * t) * 14, { kind: 'civic', area: c.area }));
  }
  // A drip pool glinting under the longest stalactite.
  lit.ellipse(room.x1 + 26, lane - 1, 7, 1.2).fill({ color: D.waterLine, alpha: 0.3 });
}

// -------------------------------------------------------------------------------------------------------------------------- lake

function lake(c: DistrictCtx): void {
  const { g, lit, cb, room, lane, bottom } = c;
  const wy = lane + 6;
  const x0 = cb.x0 + 6, x1 = cb.x1 - 6;
  // The water: black-teal, darker with depth; its lit surface line.
  g.rect(x0, wy, x1 - x0, bottom - wy).fill(vfill(D.water, wy, bottom, 1.2, 0.5));
  g.rect(x0, wy, x1 - x0, 1.4).fill({ color: D.waterLine, alpha: 0.45 });
  // Open water past the room: the cavern floor drops away, a rowboat moored there.
  const ox = room.x1 + 26, ow = x1 - ox;
  const bx = room.x1 + 44 + Math.max(0, ow - 90) / 2;
  g.poly([bx - 26, wy - 7, bx + 26, wy - 7, bx + 20, wy + 1, bx - 20, wy + 1]).fill(vfill(D.jetty, wy - 7, wy + 1)).stroke({ ...OUTLINE, width: 1 });
  g.rect(bx - 22, wy - 8, 44, 1.6).fill(shade(D.jetty, 1.3));
  rod(g, bx + 6, wy - 7, bx - 14, wy - 18, 1.2, D.jettyPost);
  c.lights.push(...lamp(c.front, c.glow, 'lamp-lantern', bx - 14, wy - 18, { kind: 'civic', area: c.area }));
  // A stone quay under the room (its plinth), the jetty carries on from it.
  g.rect(room.x0 - 4, c.floor, room.x1 - room.x0 + 8, wy + 6 - c.floor).fill(vfill(shade(c.P.rockDark, 1.25), c.floor, wy + 6)).stroke({ ...OUTLINE, width: 1 });
  g.rect(room.x0 - 4, wy + 4, room.x1 - room.x0 + 8, 2).fill({ color: 0x000000, alpha: 0.4 });
  // The jetty: planks on posts carry the walk from the tunnel to past the room.
  const jx0 = cb.x0 + 4, jx1 = room.x1 + 20;
  g.rect(jx0, lane - 1, jx1 - jx0, 5).fill(vfill(D.jetty, lane - 1, lane + 4)).stroke({ ...OUTLINE, width: 1 });
  for (let x = jx0 + 4; x < jx1; x += 9) g.rect(x, lane - 1, 0.8, 5).fill({ color: 0x000000, alpha: 0.3 });
  for (let x = jx0 + 10; x < jx1; x += 32) {
    rod(g, x, lane + 4, x, bottom - 6, 2.6, D.jettyPost);
    lit.rect(x - 3, wy + 2, 6, 0.8).fill({ color: D.waterLine, alpha: 0.4 });
  }
  // A lamp on a post at the jetty's end.
  const lx = jx1 - 4;
  rod(g, lx, lane, lx, lane - 70, 2.2, D.jettyPost);
  g.circle(lx, lane - 72, 3.4).fill(PROPS.globe.warm).stroke({ width: 1, color: OUTLINE.color, alpha: 0.6 });
  lit.circle(lx, lane - 72, 7).fill({ color: PROPS.globe.warmHalo, alpha: 0.35 });
  c.lights.push({ x: lx, y: lane - 70, preset: 'streetLamp', kind: 'civic', area: c.area });
  // Reflections: the room's warm light and each lamp's, broken streaks down the water; ripples.
  const streak = (x: number, w: number, col: number, a: number) => {
    for (let y = wy + 3, i = 0; y < bottom - 3; y += 4, i++) lit.rect(x - w / 2 + Math.sin(i * 1.7) * 2.5, y, w * (1 - i * 0.06), 1.4).fill({ color: col, alpha: a * (1 - i * 0.08) });
  };
  for (let x = room.x0 + 24; x < room.x1 - 10; x += 46) streak(x, 22, PROPS.globe.warmHalo, 0.22);
  streak(lx, 10, PROPS.globe.warmHalo, 0.35);
  streak(bx - 14, 8, PROPS.globe.warmStreak, 0.3);
  for (let x = x0 + 8; x < x1 - 8; x += 26) lit.rect(x, wy + 10 + ((x * 7) % 18), 12, 0.7).fill({ color: D.waterLine, alpha: 0.18 });
}

// -------------------------------------------------------------------------------------------------------------------------- metro

function metro(c: DistrictCtx): void {
  const { g, lit, cb, room, top, lane, floor, bottom } = c;
  // The tiled tunnel vault behind (it fills the open cavern; the rock cut frames it), ribs every bay, a teal frieze.
  // (Only its own storey band: stacked district caverns merge, and the lake above keeps its open dark.)
  const vy0 = Math.max(cb.y0, top - 6);
  const vault = tile('corridor-tile', cb.x0, vy0, cb.x1 - cb.x0, cb.y1 - vy0, { oy: floor, tint: shade(ST.tile, 0.8) });
  c.back.addChild(vault);
  const b = new Graphics();
  for (let x = cb.x0 + 30; x < cb.x1; x += 84) b.rect(x, vy0, 5, cb.y1 - vy0).fill({ color: 0x000000, alpha: 0.28 });
  b.rect(cb.x0, vy0, cb.x1 - cb.x0, 4).fill(ST.trim);
  b.rect(cb.x0, top + 12, cb.x1 - cb.x0, 3).fill({ color: ST.trim, alpha: 0.8 });
  b.rect(cb.x0, floor - 34, cb.x1 - cb.x0, 34).fill({ color: shade(ST.tile, 0.4), alpha: 0.5 });
  c.back.addChild(b);
  // The platform: the walk at the lane, its yellow edge, the platform face down to the track trench.
  const px1 = room.x1 + 16;
  const pTop = lane - 1, trench = lane + 14;
  g.rect(cb.x0 + 4, pTop, px1 - cb.x0 - 4, trench - pTop).fill(vfill(shade(ST.tile, 0.55), pTop, trench)).stroke({ ...OUTLINE, width: 1 });
  for (let x = cb.x0 + 6; x < px1 - 4; x += 12) g.rect(x, pTop, 8, 2).fill(D.platformEdge);
  // The track: ballast, sleepers, two rails, along the whole cavern.
  g.rect(cb.x0 + 4, trench, cb.x1 - cb.x0 - 8, bottom - trench).fill(vfill(shade(c.P.rockDark, 1.2), trench, bottom));
  for (let x = cb.x0 + 6; x < cb.x1 - 6; x += 10) g.rect(x, bottom - 12, 6, 3).fill(D.sleeper);
  for (const dy of [14, 9]) rod(g, cb.x0 + 4, bottom - dy, cb.x1 - 4, bottom - dy, 1.4, D.rail);
  // The dead coach past the platform, a little off the rails, windows lit: somebody trades from it now.
  const carX0 = px1 + 8, carX1 = cb.x1 - 44;
  if (carX1 - carX0 > 60) {
    const cy1 = bottom - 12, cy0 = cy1 - 54;
    const car = new Graphics();
    car.roundRect(carX0, cy0, carX1 - carX0, cy1 - cy0, 6).fill(vfill(D.carBody, cy0, cy1, 1.15, 0.6)).stroke(OUTLINE);
    car.roundRect(carX0 + 2, cy0 - 5, carX1 - carX0 - 4, 9, 4).fill(vfill(D.carRoof, cy0 - 5, cy0 + 4)).stroke({ ...OUTLINE, width: 1 });
    car.rect(carX0, cy0 + 34, carX1 - carX0, 3).fill({ color: ST.plateRim, alpha: 0.5 });
    for (let x = carX0 + 8; x + 14 < carX1 - 6; x += 22) {
      car.rect(x, cy0 + 10, 14, 16).fill(shade(D.carWindow, 0.55)).stroke({ ...OUTLINE, width: 0.8 });
      lit.rect(x + 1, cy0 + 11, 12, 14).fill({ color: D.carWindow, alpha: 0.35 });
    }
    for (const wx of [carX0 + 16, carX1 - 16]) car.circle(wx, cy1 + 2, 4.5).fill(PROPS.kit.station.iron).stroke({ ...OUTLINE, width: 0.8 });
    c.front.addChild(car);
    c.lights.push({ x: (carX0 + carX1) / 2, y: cy0 + 20, preset: 'lantern', kind: 'civic', area: c.area, radius: 110 });
  }
  // The enamel plate on the tiled wall over the coach, a clock, two sodium lamps on brackets, the teal signal down the tunnel.
  const pcx = Math.min(cb.x1 - 50, (room.x1 + cb.x1) / 2), pyy = top + 22;
  g.roundRect(pcx - 34, pyy, 68, 12, 2).fill(ST.plate).stroke({ width: 1.6, color: ST.plateRim });
  g.rect(pcx - 25, pyy + 4.5, 50, 3).fill({ color: ST.plateRim, alpha: 0.85 });
  const kx = room.x1 + 16, ky = top + 26;
  g.circle(kx, ky, 7.5).fill(ST.clockFace).stroke({ width: 1.4, color: ST.iron });
  rod(g, kx, ky, kx, ky - 5, 0.9, ST.iron);
  rod(g, kx, ky, kx + 3.5, ky + 1.2, 0.9, ST.iron);
  for (const x of [room.x0 - 12, Math.min(cb.x1 - 20, room.x1 + 110)]) {
    const y = top + 12;
    rod(g, x, y - 10, x, y - 4, 1, ST.iron);
    g.circle(x, y, 4.2).fill(PROPS.globe.sodium).stroke({ width: 1, color: ST.iron });
    lit.circle(x, y, 8).fill({ color: PROPS.globe.sodiumHalo, alpha: 0.35 });
    c.lights.push({ x, y: y + 4, preset: 'sodium', kind: 'civic', area: c.area });
  }
  const sx = cb.x1 - 18, sy = trench - 28;
  rod(g, sx, trench, sx, sy, 1.4, ST.iron);
  g.circle(sx, sy, 2.4).fill(PROPS.cavern.lakeTease);
  lit.circle(sx, sy, 5).fill({ color: PROPS.cavern.lakeTease, alpha: 0.4 });
  c.lights.push({ x: sx, y: sy, preset: 'signal', kind: 'shell', area: c.area });
  contactShadow(g, room.x1 + 4, lane, 16);
}

// -------------------------------------------------------------------------------------------------------------------------- deeper districts

function geothermal(c: DistrictCtx): void {
  const { lit, cb, lane, bottom } = c;
  const r = rng(c.seed + 3);
  const pts: number[] = [cb.x0 + 14, bottom - 4];
  for (let x = cb.x0 + 14; x <= cb.x1 - 14; x += 9) pts.push(x, lane + 12 + r() * 6);
  pts.push(cb.x1 - 14, bottom - 4);
  lit.poly(pts).fill({ color: PROPS.kit.forge.magma, alpha: 0.45 });
  for (let i = 0; i < 4; i++) lit.ellipse(cb.x0 + 30 + i * ((cb.x1 - cb.x0 - 60) / 3), lane - 30 - (i % 2) * 14, 14, 9).fill({ color: 0xffffff, alpha: 0.04 });
  for (const t of [0.25, 0.75]) c.lights.push({ x: cb.x0 + (cb.x1 - cb.x0) * t, y: lane + 16, preset: 'magma', kind: 'shell', area: c.area, radius: 150 });
}

function oldVault(c: DistrictCtx): void {
  const { cb, room, top } = c;
  const x = room.x1 + 28, y = top + 44, R = 24;
  if (x + R > cb.x1 - 4) return;
  const g = new Graphics();
  g.circle(x, y, R).fill(vfill(PROPS.kit.forge.brass, y - R, y + R, 1.1, 0.55)).stroke(OUTLINE);
  g.circle(x, y, R - 6).stroke({ width: 2.4, color: shade(PROPS.kit.forge.brass, 0.7) });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.circle(x + Math.cos(a) * (R - 3), y + Math.sin(a) * (R - 3), 1).fill(mix(PROPS.kit.forge.brass, 0xffffff, 0.3)); }
  c.back.addChild(g);
}
