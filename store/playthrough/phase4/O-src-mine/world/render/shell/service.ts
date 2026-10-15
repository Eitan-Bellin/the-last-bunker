/**
 * [world:M2] The Service Network kit (stratum 2, floors 4-7; style guide 2 "Service Network": pipe galleries, valve wheels, catwalks,
 * pressure gauges, steam). Vector parts in the shared hand (UNIFY outline and gradients), colours from PROPS (no new paintings):
 *
 *   serviceVestibule  the long service corridors between the narrow pump hall and the rooms: a colour-coded pipe gallery (lagged steam,
 *                     the green water main, the yellow gas line) with flanges and flow arrows, drops with valve wheels into the floor, a
 *                     gauge panel at eye height, a junction box with its LED, a leaking flange breathing a wisp of steam;
 *   oldVault          the Old Vault district (floor 5): a steel-lined strongroom under a board-formed crown, banks of safe-deposit boxes
 *                     (a few hanging open), the great round door swung open on its hinge arm with the bolts out and a glint of the
 *                     treasury inside, a stone floor under dust drifts, a trolley of boxes, dust motes in the cone of a cage lamp;
 *   geothermal        the Geothermal district (floor 6): hot rock lit orange from below, a grated catwalk over the magma seam, the big
 *                     lagged pipes along the roof back to the bunker, the wellhead with its valve wheel and two pressure gauges (one in
 *                     the red), a heat exchanger stack by the tunnel, steam vents along the floor;
 *   hints             glimpsed / being dug: the vault door's steel edge, the geothermal's steam and orange seam past the rubble;
 *   servicePocket     the stratum's pockets: the pump gallery's pump sets, the valve vault's manifold wall, the crawlway's ribbed duct.
 */
import { Graphics } from 'pixi.js';
import { PROPS, type StratumPalette } from '../../tokens';
import { stratumOf } from '../../../data/strata';
import { floorIndexAt } from '../../../rendering/geom';
import { WORLD_KIT_IDS, rockTileId } from '../../tokensAssets';
import type { DistrictCtx } from './districts';
import type { LightDef } from './types';
import { OUTLINE, contactShadow, mix, rng, rod, shade, tile, vfill } from './kit';

const K = PROPS.kit.service;
const V = PROPS.district.vault;
const G = PROPS.district.geo;

// ------------------------------------------------------------------------------------------------------------------------- shared parts

/** A valve wheel seen face on: rim, spokes, hub. */
function valveWheel(g: Graphics, x: number, y: number, r: number, color: number = K.valve): void {
  g.circle(x, y, r).stroke({ width: r * 0.42 + OUTLINE.width, color: OUTLINE.color, alpha: OUTLINE.alpha });
  g.circle(x, y, r).stroke({ width: r * 0.42, color });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r).lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r).stroke({ width: 0.9, color: shade(color, 0.8) });
  }
  g.circle(x, y, r * 0.25).fill(shade(color, 0.7));
}

/** A round pressure gauge: bezel, face, needle at `t` (0 = rest, 1 = full scale; > 0.8 sits in the red). */
function gauge(g: Graphics, x: number, y: number, r: number, t: number): void {
  g.circle(x, y, r + 1.2).fill(K.pipe).stroke({ ...OUTLINE, width: 0.8 });
  g.circle(x, y, r).fill(K.gauge);
  // The red arc at the top end of the scale.
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const ar = a0 + (a1 - a0) * 0.8;
  // (An arc continues the current path: start a new one at its first point, or it draws a line from wherever the last shape ended.)
  g.moveTo(x + Math.cos(ar) * r * 0.78, y + Math.sin(ar) * r * 0.78).arc(x, y, r * 0.78, ar, a1).stroke({ width: 1, color: K.valve });
  const a = a0 + (a1 - a0) * t;
  g.moveTo(x, y).lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8).stroke({ width: 0.8, color: OUTLINE.color });
}

/** A horizontal pipe run with flanges every `every` units. */
function pipeRun(g: Graphics, x0: number, x1: number, y: number, h: number, color: number, every: number): void {
  g.rect(x0, y, x1 - x0, h).fill(vfill(color, y, y + h, 1.15, 0.7)).stroke({ ...OUTLINE, width: 0.8 });
  g.rect(x0, y + 0.6, x1 - x0, Math.max(0.6, h * 0.18)).fill({ color: 0xffffff, alpha: 0.12 });
  for (let x = x0 + every / 2; x < x1 - 2; x += every) g.rect(x - 1, y - 1, 2.2, h + 2).fill(shade(color, 0.6));
}

/** A soft column of steam rising from (x, y): stacked puffs, fading and widening as they rise (normal blend: steam is lit, not a light). */
function steam(g: Graphics, x: number, y: number, h: number, seed: number, alpha: number = G.steamAlpha): void {
  const r = rng(seed);
  for (let k = 0; k < 6; k++) {
    const t = k / 6;
    g.ellipse(x + (r() - 0.5) * 6 * t + t * 4, y - h * t, 3 + t * 9, 2.4 + t * 6).fill({ color: G.steam, alpha: alpha * (1 - t * 0.75) });
  }
}

/** A small flow arrow painted on a pipe (stencil). */
function arrow(g: Graphics, x: number, y: number, dir: 1 | -1): void {
  g.poly([x - 3 * dir, y - 1.6, x + 3 * dir, y, x - 3 * dir, y + 1.6]).fill({ color: K.stencil, alpha: 0.7 });
}

// ------------------------------------------------------------------------------------------------------------------------- vestibules

/**
 * The service corridor's extra dressing over the shared tile wall and ceiling bundle (vestibule.ts): `b` is the corridor's x span, `top`
 * and `floor` its ceiling and floor lines, `side` which end the hub is on. Long corridors (the frame's vestibules are 96-110 u) get it all;
 * short ones only the gallery of pipes.
 */
export function serviceVestibule(g: Graphics, lit: Graphics, lights: LightDef[], b: { x0: number; x1: number }, top: number, floor: number, side: 'w' | 'e', area: string, seed: number): void {
  const w = b.x1 - b.x0;
  const r = rng(seed);
  // The colour-coded gallery: lagged steam, the yellow gas line, the green water main (flow arrows toward the rooms).
  const dir: 1 | -1 = side === 'e' ? 1 : -1;
  pipeRun(g, b.x0, b.x1, top + 18, 5, K.pipeLag, 26);
  pipeRun(g, b.x0, b.x1, top + 26, 3, K.gas, 30);
  pipeRun(g, b.x0, b.x1, top + 32, 6, K.water, 34);
  for (let x = b.x0 + 14; x < b.x1 - 8; x += 38) { arrow(g, x, top + 27.5, dir); arrow(g, x + 12, top + 35, dir); }
  if (w < 60) return;
  // Two drops into the floor with their valve wheels (the hub end and the room end).
  for (const t of [0.18, 0.86]) {
    const x = b.x0 + w * t;
    rod(g, x, top + 38, x, floor - 2, 3.2, K.water);
    g.rect(x - 3.6, floor - 8, 7.2, 3).fill(shade(K.water, 0.6));
    valveWheel(g, x, top + 58 + (t < 0.5 ? 0 : 6), 5);
  }
  // The gauge panel: a steel plate with two gauges and a stencilled number; one gauge reads high.
  const px = b.x0 + w * 0.42, py = top + 44;
  g.roundRect(px - 13, py, 26, 18, 1.5).fill(vfill(K.fan, py, py + 18)).stroke({ ...OUTLINE, width: 0.8 });
  gauge(g, px - 6, py + 8, 4, 0.35 + r() * 0.2);
  gauge(g, px + 6, py + 8, 4, 0.82);
  g.rect(px - 9, py + 14.5, 18, 1.2).fill({ color: K.stencil, alpha: 0.6 });
  // The junction box with its green LED, and conduit up to the ceiling bundle.
  const jx = b.x0 + w * 0.64, jy = top + 50;
  rod(g, jx, top + 12, jx, jy, 1.4, K.pipe);
  g.rect(jx - 6, jy, 12, 15).fill(vfill(K.fan, jy, jy + 15)).stroke({ ...OUTLINE, width: 0.8 });
  g.circle(jx + 3, jy + 4, 1).fill(PROPS.signal);
  lit.circle(jx + 3, jy + 4, 3.2).fill({ color: PROPS.signal, alpha: 0.4 });
  // A leaking flange on the steam line breathes a wisp.
  steam(g, b.x0 + w * (side === 'e' ? 0.3 : 0.7), top + 18, 16, seed + 3, G.steamAlpha * 0.7);
  void lights;
}

// ------------------------------------------------------------------------------------------------------------------------- the Old Vault

/** Revealed Old Vault. Returns true: it draws its own floor (no generic ledge or street lamp). */
export function oldVault(c: DistrictCtx): boolean {
  const { g, lit, cb, room, top, floor, lane, bottom } = c;
  const r = rng(c.seed + 5);
  const bx0 = cb.x0 + 4, bx1 = cb.x1 - 4;
  const crown = top - V.crownDrop;
  // The great door's place: past the room, clear of the far wall.
  const R = V.doorR;
  const dx = Math.min(bx1 - R - V.leafW - 16, room.x1 + V.doorDx + R), dy = floor - R - 6;

  // --- back: the board-formed crown, the riveted steel lining, the deposit banks (they show through the open cavern)
  const b = new Graphics();
  b.rect(bx0, cb.y0, bx1 - bx0, crown - cb.y0).fill(vfill(V.concrete, cb.y0, crown, 1.05, 0.7));
  for (let y = crown - 10; y > cb.y0; y -= 11) b.rect(bx0, y, bx1 - bx0, 1).fill({ color: 0x000000, alpha: 0.15 });
  b.rect(bx0, crown, bx1 - bx0, bottom - crown).fill(vfill(V.steel, crown, bottom, 1.1, 0.55));
  for (let x = bx0 + 2; x < bx1; x += V.plateW) {
    b.rect(x, crown, 1.2, floor - crown).fill({ color: 0x000000, alpha: 0.35 });
    for (let y = crown + 6; y < floor - 2; y += 14) { b.circle(x + 4, y, 0.9).fill(V.rivet); b.circle(x + V.plateW - 4, y, 0.9).fill(V.rivet); }
  }
  b.rect(bx0, crown, bx1 - bx0, 3).fill(shade(V.steel, 1.35));
  // Deposit banks: west of the room, and between the room and the door.
  const banks: [number, number][] = [[bx0 + 8, room.x0 - 6], [room.x1 + 6, dx - R - 8]];
  for (const [xa, xb] of banks) {
    if (xb - xa < V.boxW * 2) continue;
    for (let y = top + 8; y + V.boxH < floor - 4; y += V.boxH + 1.5) {
      for (let x = xa; x + V.boxW <= xb; x += V.boxW + 1.5) {
        const open = r() < 0.12;
        b.rect(x, y, V.boxW, V.boxH).fill(open ? V.boxDark : vfill(V.boxFace, y, y + V.boxH, 1.15, 0.8)).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
        if (!open) b.circle(x + V.boxW / 2, y + V.boxH / 2, 0.7).fill(PROPS.kit.forge.brass);
        else b.rect(x + (r() < 0.5 ? -V.boxW * 0.6 : V.boxW * 0.9), y, V.boxW * 0.7, V.boxH).fill(vfill(V.boxFace, y, y + V.boxH, 0.9, 0.6));
      }
    }
  }
  // The door's dark opening in the lining and the treasury glimpsed inside: shelves, a glint of gold.
  b.circle(dx, dy, R + 5).fill(V.steelDark);
  b.circle(dx, dy, R - 1).fill(V.inside);
  for (const sy of [dy - 8, dy + 6]) b.rect(dx - R * 0.6, sy, R * 1.2, 2).fill(shade(V.steel, 0.7));
  for (let k = 0; k < 5; k++) b.rect(dx - R * 0.5 + k * 6, dy + 1, 4, 5).fill(PROPS.kit.mine.gold);
  c.back.addChild(b);
  lit.ellipse(dx, dy + 4, R * 0.5, 4).fill({ color: PROPS.kit.mine.gold, alpha: 0.18 });

  // --- front: the floor, the door frame and the swung leaf, the trolley, dust
  g.rect(cb.x0 + 8, floor, cb.x1 - cb.x0 - 16, bottom - floor).fill(vfill(V.stoneDark, floor, bottom, 1.1, 0.5));
  g.rect(cb.x0 + 8, floor, cb.x1 - cb.x0 - 16, 3).fill(V.stone);
  for (let x = cb.x0 + 14; x < cb.x1 - 10; x += 18) g.rect(x, floor, 0.8, 3).fill({ color: 0x000000, alpha: 0.35 });
  // Dust drifts along the floor and against the walls.
  for (let x = cb.x0 + 12; x < cb.x1 - 12; x += 10 + r() * 18) {
    if (x > room.x0 - 4 && x < room.x1 + 4) continue;
    g.ellipse(x, lane + 1, 4 + r() * 7, 1 + r() * 1.2).fill({ color: V.dust, alpha: 0.35 });
  }
  // The frame: a thick ring with bolt sockets.
  g.circle(dx, dy, R + 5).stroke({ width: 7 + OUTLINE.width * 2, color: OUTLINE.color, alpha: OUTLINE.alpha });
  g.circle(dx, dy, R + 5).stroke({ width: 7, color: V.steelLit });
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.circle(dx + Math.cos(a) * (R + 5), dy + Math.sin(a) * (R + 5), 1.2).fill(V.steelDark); }
  // The leaf, swung open toward us on its hinge arm (seen edge-on: a tall ellipse, its thick edge, the locking bolts out).
  const lx = dx + R + 6 + V.leafW / 2;
  rod(g, dx + R + 4, dy - R * 0.5, lx, dy - R * 0.5, 3, V.steelDark);
  rod(g, dx + R + 4, dy + R * 0.5, lx, dy + R * 0.5, 3, V.steelDark);
  g.ellipse(lx + 3, dy, V.leafW / 2, R + 2).fill(vfill(shade(V.steel, 0.8), dy - R, dy + R)).stroke({ ...OUTLINE, width: 1 });
  g.ellipse(lx, dy, V.leafW / 2, R + 2).fill(vfill(V.steelLit, dy - R, dy + R, 1.2, 0.7)).stroke({ ...OUTLINE, width: 1 });
  for (let k = -2; k <= 2; k++) rod(g, lx - V.leafW / 2 - 4, dy + k * (R / 2.6), lx - V.leafW / 2 + 1, dy + k * (R / 2.6), 2.2, V.rivet);
  valveWheel(g, lx, dy, V.leafW * 0.32, PROPS.kit.forge.brass);
  contactShadow(g, lx, lane, V.leafW + 6);
  // A trolley of deposit boxes left by the door, and two boxes on the floor.
  const tx = Math.max(room.x1 + 10, dx - R - 26);
  if (tx + 22 < dx - R) {
    g.rect(tx, lane - 14, 22, 3).fill(V.steelDark);
    for (let k = 0; k < 3; k++) g.rect(tx + 1 + k * 7, lane - 22, 6, 8).fill(vfill(V.boxFace, lane - 22, lane - 14)).stroke({ ...OUTLINE, width: 0.6 });
    rod(g, tx + 21, lane - 14, tx + 25, lane - 26, 1, V.steelDark);
    for (const wx of [tx + 4, tx + 18]) g.circle(wx, lane - 2, 2.2).fill(V.steelDark);
  }
  g.rect(room.x0 - 20, lane - 6, 8, 6).fill(vfill(V.boxFace, lane - 6, lane)).stroke({ ...OUTLINE, width: 0.6 });
  g.rect(room.x0 - 12, lane - 4, 6, 4).fill(vfill(V.boxFace, lane - 4, lane)).stroke({ ...OUTLINE, width: 0.6 });
  // A caged lamp over the door: a cool cone through the dust, motes in it.
  const cx = dx - R * 0.4, cy = crown + 6;
  rod(g, cx, crown, cx, cy, 1, V.steelDark);
  lit.poly([cx - 3, cy + 2, cx + 3, cy + 2, cx + 26, floor, cx - 26, floor]).fill({ color: V.dust, alpha: 0.05 });
  const motes = V.motes;
  for (let k = 0; k < motes; k++) {
    const t = r();
    lit.circle(cx + (r() - 0.5) * 2 * (4 + t * 22), cy + 4 + t * (floor - cy - 8), 0.6 + r() * 0.6).fill({ color: V.dust, alpha: 0.2 + r() * 0.25 });
  }
  c.lights.push({ x: cx, y: cy + 4, preset: 'cageLamp', kind: 'shell', area: c.area, radius: 120 });
  c.lights.push({ x: dx, y: dy + 2, preset: 'lantern', kind: 'shell', area: c.area, radius: 60, intensity: 0.5 });
  return true;
}

// ------------------------------------------------------------------------------------------------------------------------- Geothermal

/** Revealed Geothermal plant. Returns false: the generic rock ledge stays (the catwalk stands over it). */
export function geothermal(c: DistrictCtx): boolean {
  const { g, lit, cb, room, top, lane, bottom } = c;
  const r = rng(c.seed + 3);
  const s = stratumOf(floorIndexAt(top + 1));
  // --- back: hot rock, darker crust, lit from below (it shows through the open cavern).
  c.back.addChild(tile(rockTileId(WORLD_KIT_IDS[s]), cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0, { tint: G.crust }));
  const hb = new Graphics();
  hb.blendMode = 'add';
  for (let k = 0; k < 5; k++) {
    const y = bottom - k * 16;
    hb.rect(cb.x0, y - 16, cb.x1 - cb.x0, 16).fill({ color: G.heat, alpha: 0.05 * (5 - k) / 5 });
  }
  c.back.addChild(hb);
  // The magma seam under the ledge (the plant's reason to be here).
  const pts: number[] = [cb.x0 + 14, bottom - 4];
  for (let x = cb.x0 + 14; x <= cb.x1 - 14; x += 9) pts.push(x, lane + 12 + r() * 6);
  pts.push(cb.x1 - 14, bottom - 4);
  lit.poly(pts).fill({ color: PROPS.kit.forge.magma, alpha: 0.45 });
  // --- the grated catwalk over the seam, on posts.
  g.rect(cb.x0 + 6, lane - 1, cb.x1 - cb.x0 - 12, 4).fill(vfill(K.grate, lane - 1, lane + 3)).stroke({ ...OUTLINE, width: 0.8 });
  for (let x = cb.x0 + 9; x < cb.x1 - 8; x += 5) g.rect(x, lane, 2.5, 2).fill({ color: 0x000000, alpha: 0.45 });
  for (let x = cb.x0 + 16; x < cb.x1 - 10; x += 36) rod(g, x, lane + 3, x, bottom - 2, 2, shade(K.grate, 0.8));
  // --- the big lagged pipes along the roof, back toward the bunker (west), on hangers.
  const py = top + 6;
  const wx = Math.min(cb.x1 - 34, room.x1 + G.wellDx);
  for (const [dy, h] of [[0, 7], [10, 5]] as const) pipeRun(g, cb.x0 + 4, wx + 4, py + dy, h, dy ? K.pipe : K.pipeLag, 24);
  for (let x = cb.x0 + 20; x < wx; x += 40) rod(g, x, cb.y0 + 6, x, py, 1, K.pipe);
  // --- the wellhead: the casing up from the seam to the roof pipes, its valve wheel, two gauges (one reading in the red), a relief vent.
  rod(g, wx, py + 7, wx, bottom - 2, 6, K.pipe);
  g.rect(wx - 6, lane - 28, 12, 6).fill(vfill(shade(K.pipe, 1.2), lane - 28, lane - 22)).stroke({ ...OUTLINE, width: 0.8 });
  valveWheel(g, wx, lane - 40, 7);
  gauge(g, wx + 11, lane - 52, 4.5, 0.55);
  gauge(g, wx - 11, lane - 58, 4.5, 0.9);
  rod(g, wx + 4, py + 10, wx + 16, py + 10, 2, K.pipe);
  rod(g, wx + 16, py + 10, wx + 16, py + 2, 2, K.pipe);
  steam(g, wx + 16, py + 2, 18, c.seed + 11);
  lit.circle(wx, lane + 14, 14).fill({ color: G.heat, alpha: 0.25 });
  // --- the heat exchanger by the tunnel: a finned stack between the mouth and the room.
  const ex = room.x0 - 26;
  if (ex - 14 > cb.x0 + 4) {
    g.rect(ex - 9, top + 34, 18, lane - top - 34).fill(vfill(K.fan, top + 34, lane)).stroke({ ...OUTLINE, width: 1 });
    for (let y = top + 38; y < lane - 4; y += 4) g.rect(ex - 11, y, 22, 1.4).fill(shade(K.fanBlade, 0.9));
    lit.rect(ex - 7, lane - 14, 14, 3).fill({ color: G.heat, alpha: 0.4 });
    rod(g, ex, top + 34, ex, py + 7, 3, K.pipeLag);
  }
  // --- steam vents along the floor past the room: fissures with a plume each.
  for (let k = 0; k < 3; k++) {
    const vx = room.x1 + 12 + k * ((wx - room.x1 - 24) / 3);
    if (vx > wx - 10) break;
    lit.ellipse(vx, lane + 2, 5, 1.2).fill({ color: G.heat, alpha: 0.6 });
    steam(g, vx, lane - 1, 30 + r() * 16, c.seed + 20 + k);
  }
  for (const t of [0.3, 0.75]) c.lights.push({ x: cb.x0 + (cb.x1 - cb.x0) * t, y: lane + 16, preset: 'magma', kind: 'shell', area: c.area, radius: 150 });
  c.lights.push({ x: wx, y: lane - 30, preset: 'forge', kind: 'shell', area: c.area, radius: 90, intensity: 0.6 });
  return false;
}

// ------------------------------------------------------------------------------------------------------------------------- hints

/** Glimpsed / being dug: one hint of the Old Vault or the Geothermal plant past the rubble. False for other districts. */
export function hintService(c: DistrictCtx): boolean {
  const { g, lit, room, top, lane } = c;
  if (c.kind === 'oldVault') {
    const x = room.x1 + 20, y = lane - V.doorR - 6;
    const arcAt = (gr: Graphics, rad: number, a0: number, a1: number) => gr.moveTo(x + Math.cos(a0) * rad, y + Math.sin(a0) * rad).arc(x, y, rad, a0, a1);
    arcAt(g, V.doorR + 5, Math.PI * 0.6, Math.PI * 1.4).stroke({ width: 6, color: V.steelLit });
    arcAt(lit, V.doorR + 7, Math.PI * 0.7, Math.PI * 1.2).stroke({ width: 1.2, color: V.dust, alpha: 0.4 });
    return true;
  }
  if (c.kind === 'geothermal') {
    for (let k = 0; k < 3; k++) steam(g, room.x0 + 50 + k * 46, lane, 26 + k * 6, c.seed + 30 + k);
    lit.rect(room.x0 + 30, lane + 8, room.x1 - room.x0, 2).fill({ color: G.heat, alpha: 0.5 });
    void top;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------------------------------- pockets

/** The stratum-2 pockets' insides (pocketInside.ts calls this first). False for any other pocket. */
export function servicePocket(name: string, g: Graphics, lit: Graphics, b: { x0: number; y0: number; x1: number; y1: number }, P: StratumPalette, lights: LightDef[], area: string): boolean {
  const cx = (b.x0 + b.x1) / 2, fy = b.y1 - 4, w = b.x1 - b.x0;
  if (name === 'pumpGallery') {
    g.rect(b.x0 + 8, fy, w - 16, 5).fill(vfill(P.builtDark, fy, fy + 5));
    pipeRun(g, b.x0 + 10, b.x1 - 10, fy - 52, 6, K.water, 30);
    // Two pump sets: motor, flywheel, the pump body, risers into the main.
    for (const px of [b.x0 + w * 0.3, b.x0 + w * 0.7]) {
      g.roundRect(px - 14, fy - 18, 28, 18, 4).fill(vfill(K.water, fy - 18, fy)).stroke({ ...OUTLINE, width: 1 });
      g.rect(px - 22, fy - 14, 9, 12).fill(vfill(K.fan, fy - 14, fy - 2)).stroke({ ...OUTLINE, width: 0.8 });
      g.circle(px + 18, fy - 10, 8).stroke({ width: 2.4, color: K.pipe }).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
      rod(g, px, fy - 18, px, fy - 46, 3, K.water);
      gauge(g, px + 6, fy - 30, 3.5, 0.5);
    }
    lights.push({ x: cx, y: fy - 40, preset: 'fluoroTube', kind: 'shell', area, radius: 90 });
    return true;
  }
  if (name === 'valveVault') {
    g.rect(b.x0 + 8, fy, w - 16, 5).fill(vfill(P.builtDark, fy, fy + 5));
    // The manifold wall: a header pipe, rows of valve wheels on stubs, a gauge per row.
    pipeRun(g, b.x0 + 12, b.x1 - 12, fy - 62, 6, K.pipeLag, 22);
    for (let row = 0; row < 2; row++) {
      const y = fy - 42 + row * 20;
      pipeRun(g, b.x0 + 14, b.x1 - 14, y, 3, K.pipe, 18);
      for (let x = b.x0 + 22; x < b.x1 - 16; x += 14) valveWheel(g, x, y - 5, 4, row ? K.valve : PROPS.kit.forge.brass);
      gauge(g, b.x1 - 18, y + 9, 3.2, row ? 0.85 : 0.4);
    }
    lights.push({ x: cx, y: fy - 50, preset: 'cageLamp', kind: 'shell', area, radius: 80 });
    return true;
  }
  if (name === 'crawlway') {
    // A ribbed duct to crawl through, a dropped torch lighting the floor.
    const y0 = b.y0 + 1, y1 = b.y1 - 1;
    g.rect(b.x0 + 4, y0, w - 8, y1 - y0).fill(vfill(K.fan, y0, y1, 1.1, 0.6)).stroke({ ...OUTLINE, width: 0.8 });
    for (let x = b.x0 + 8; x < b.x1 - 6; x += 7) g.rect(x, y0, 1.4, y1 - y0).fill(shade(K.fanBlade, 0.8));
    g.rect(cx - 4, y1 - 3, 7, 2.4).fill(K.pipe);
    lit.poly([cx + 3, y1 - 2, cx + 26, y1 - 6, cx + 26, y1]).fill({ color: PROPS.globe.warm, alpha: 0.3 });
    lights.push({ x: cx + 10, y: y1 - 3, preset: 'headlamp', kind: 'shell', area, radius: 60, intensity: 0.6 });
    return true;
  }
  return false;
}
