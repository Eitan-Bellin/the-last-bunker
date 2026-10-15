/**
 * [world:M1] The per-stratum dressing of a hub (style guide 2): what makes the Service Network's pump hall, the Old Metro's station
 * hall, the Mines' headframe chamber, the Deep Caves' natural cavern and the Core's forge chamber read as places of their own at a glance.
 * `hubKitBack` dresses the back wall (behind the balconies and the people); `hubKitFront` adds what stands on the plaza and the stratum's
 * key light. Bell Square (stratum 1) keeps its own dressing in hub.ts. Colours are the stratum palette and PROPS.kit; every lamp has a
 * visible source; vector parts are thin (rods, rails, rims) or gradient-filled with the shared outline.
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, PROPS, type StratumId, type StratumPalette } from '../../tokens';
import { ROOM_H, floorTop } from '../../../rendering/geom';
import { floorLineY, laneY } from '../../model/cityLayout';
import { archPoints } from '../../model/outline';
import type { HubGeom } from '../layoutTypes';
import type { LightDef } from './types';
import { OUTLINE, contactShadow, lamp, mix, rng, rod, shade, sprite, tile, vfill } from './kit';

const H = CITY.hub;
const K = PROPS.kit;

export interface HubCtx {
  h: HubGeom;
  s: StratumId;
  P: StratumPalette;
  x0: number; x1: number; y0: number; y1: number;
  /** floorTop of the hub's first storey, its last storey, the spine's centre x, the plaza deck y. */
  top: number; fz: number; cx: number; plazaY: number;
  dens: number;
  era: number;
  back: Container;
  front: Container;
  glow: Container;
  lights: LightDef[];
  area: (f: number) => string;
}

export function hubKitBack(c: HubCtx): void {
  switch (CITY.kits[c.s]?.vault) {
    case 'service': return serviceBack(c);
    case 'station': return stationBack(c);
    case 'mine': return mineBack(c);
    case 'cavern': return cavernBack(c);
    case 'forge': return forgeBack(c);
    default: return;
  }
}

export function hubKitFront(c: HubCtx): void {
  switch (CITY.kits[c.s]?.vault) {
    case 'service': return serviceFront(c);
    case 'station': return stationFront(c);
    case 'mine': return mineFront(c);
    case 'cavern': return cavernFront(c);
    case 'forge': return forgeFront(c);
    default: return;
  }
}

/** The inner wall span (between the side walls). */
const inner = (c: HubCtx): [number, number] => [c.x0 + H.wallW, c.x1 - H.wallW];

// ============================================================================================================== Service Network (2)

function serviceBack(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  for (const f of c.h.floors) {
    const t = floorTop(f);
    // The painted pipe rack (back-pipes plate) under each storey's ceiling, scaled to a 46-unit band.
    const rack = tile('back-pipes', a, t + 6, b - a, 46, { tint: mix(K.service.pipe, 0xffffff, 0.35) });
    const k = 46 / 384;
    rack.tileScale.set(rack.tileScale.x * k, rack.tileScale.y * k);
    rack.tilePosition.set(-(a % 400), 0);
    c.back.addChild(rack);
    // A lagged main along the dado with red valve wheels and two pressure gauges by the doorways.
    const py = floorLineY(f) - 30;
    g.rect(a, py, b - a, 5).fill(vfill(K.service.pipeLag, py, py + 5)).stroke({ ...OUTLINE, width: 1 });
    for (let x = a + 14; x < b; x += 28) g.rect(x, py - 1, 2.4, 7).fill(shade(K.service.pipe, 0.7));
    for (const vx of [a + 34, b - 34]) {
      rod(g, vx, py, vx, py - 8, 1.2, K.service.pipe);
      g.circle(vx, py - 11, 4.4).stroke({ width: 1.8, color: K.service.valve }).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
    }
    for (const gx of [a + 8, b - 8]) {
      g.circle(gx, t + 64, 4).fill(K.service.gauge).stroke({ ...OUTLINE, width: 1 });
      rod(g, gx, t + 64, gx + 2.4, t + 61.5, 0.7, K.service.valve);
    }
  }
  // The big ventilation fan in the top storey's back wall, behind the spine: housing, grille and five blades.
  const fx = c.cx, fy = c.top + 48, R = 44;
  g.circle(fx, fy, R + 6).fill(vfill(K.service.fan, fy - R - 6, fy + R + 6)).stroke(OUTLINE);
  g.circle(fx, fy, R).fill(shade(K.service.fan, 0.45));
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2 + 0.3;
    const pts = [fx, fy];
    for (let j = 0; j <= 6; j++) {
      const aa = a0 + (j / 6) * 0.75, rr = R * (0.25 + 0.7 * Math.sin((j / 6) * Math.PI * 0.5 + 0.5));
      pts.push(fx + Math.cos(aa) * rr, fy + Math.sin(aa) * rr);
    }
    g.poly(pts).fill(vfill(K.service.fanBlade, fy - R, fy + R, 1.2, 0.7));
  }
  g.circle(fx, fy, 7).fill(shade(K.service.fanBlade, 1.2)).stroke({ ...OUTLINE, width: 1 });
  for (let x = fx - R; x <= fx + R; x += 8) {
    const hh = Math.sqrt(Math.max(0, R * R - (x - fx) * (x - fx)));
    rod(g, x, fy - hh, x, fy + hh, 0.6, shade(K.service.pipe, 0.9));
  }
  c.back.addChild(g);
}

function serviceFront(c: HubCtx): void {
  if (c.dens < 0.3) return;
  const g = new Graphics();
  const [a, b] = inner(c);
  const by = c.plazaY;
  // A pump manifold on the plaza's west side: three risers, flanges, the big red wheel.
  const mx = a + 16;
  contactShadow(g, mx + 16, by, 40);
  for (let i = 0; i < 3; i++) {
    const x = mx + i * 12;
    g.rect(x, by - 46, 6, 46).fill(vfill(K.service.pipe, by - 46, by)).stroke({ ...OUTLINE, width: 1 });
    g.rect(x - 1.5, by - 30, 9, 3).fill(shade(K.service.pipe, 0.75));
  }
  g.rect(mx - 3, by - 50, 36, 6).fill(vfill(shade(K.service.pipe, 0.9), by - 50, by - 44)).stroke({ ...OUTLINE, width: 1 });
  g.circle(mx + 15, by - 58, 7).stroke({ width: 2.2, color: K.service.valve }).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
  rod(g, mx + 15, by - 51, mx + 15, by - 58, 1.4, K.service.pipe);
  // A junction box and a tool cart on the east side.
  const jx = b - 52;
  g.rect(jx, by - 30, 18, 22).fill(vfill(K.service.fan, by - 30, by - 8)).stroke(OUTLINE);
  g.rect(jx + 3, by - 26, 12, 2).fill(c.P.hazard);
  g.circle(jx + 14, by - 12, 1.2).fill(PROPS.signal);
  contactShadow(g, b - 20, by, 22);
  g.rect(b - 30, by - 16, 20, 10).fill(vfill(K.service.valve, by - 16, by - 6)).stroke({ ...OUTLINE, width: 1 });
  for (const wx of [b - 27, b - 13]) g.circle(wx, by - 3, 3).fill(shade(K.service.fan, 0.8)).stroke({ ...OUTLINE, width: 0.8 });
  c.front.addChild(g);
  // Steam escaping the manifold: a soft additive puff (no particles; the gallery vents have the moving steam).
  const puff = new Graphics();
  for (let i = 0; i < 3; i++) puff.ellipse(mx + 15 + i * 4, by - 70 - i * 10, 10 + i * 5, 6 + i * 3).fill({ color: 0xffffff, alpha: 0.05 });
  puff.blendMode = 'add';
  c.glow.addChild(puff);
}

// ============================================================================================================== Old Metro (3)

function stationBack(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  for (const f of c.h.floors) {
    const t = floorTop(f), fl = floorLineY(f);
    // Teal enamel trim: a frieze under the ceiling and a band over the dado.
    g.rect(a, t + 8, b - a, 5).fill(vfill(K.station.trim, t + 8, t + 13)).stroke({ ...OUTLINE, width: 0.8 });
    g.rect(a, fl - 36, b - a, 4).fill(vfill(K.station.trim, fl - 36, fl - 32));
    // The dado below it, dirty and darker.
    g.rect(a, fl - 32, b - a, 32).fill({ color: shade(K.station.tile, 0.45), alpha: 0.55 });
  }
  // Cast-iron columns by the walls, a capital at every storey.
  for (const x of [a + 6, b - 13]) {
    g.rect(x, c.y0 + H.vaultRise * 0.5, 7, c.y1 - c.y0 - H.vaultRise * 0.5).fill(vfill(K.station.iron, c.y0, c.y1, 1.2, 0.8)).stroke({ ...OUTLINE, width: 1 });
    for (const f of c.h.floors) {
      const t = floorTop(f);
      g.poly([x - 4, t + 2, x + 11, t + 2, x + 8, t + 9, x - 1, t + 9]).fill(shade(K.station.iron, 1.2)).stroke({ ...OUTLINE, width: 0.8 });
    }
  }
  // The dead tunnel mouth in the top storey behind the spine: a tiled portal, black inside, two rails running into the dark.
  const f0 = c.h.floors[0];
  const mb = floorLineY(f0), half = 62;
  const arch = archPoints(c.cx - half, c.cx + half, mb - 58, 36, 16);
  g.poly([c.cx - half, mb, ...arch, c.cx + half, mb]).fill(vfill(PROPS.tunnelDark, mb - 94, mb, 1, 1.4));
  g.poly([c.cx - half, mb, ...arch, c.cx + half, mb], false).stroke({ width: 7, color: shade(K.station.tile, 0.95) }).stroke({ width: 1.2, color: OUTLINE.color, alpha: 0.8 });
  g.poly(arch, false).stroke({ width: 2.4, color: K.station.trim });
  for (const dx of [-26, 26]) g.moveTo(c.cx + dx, mb).lineTo(c.cx + dx * 0.25, mb - 30).stroke({ width: 1.4, color: PROPS.district.rail, alpha: 0.5 });
  // The enamel station plate on the vault over the portal (no words in the world: the bars read as a station sign) and the clock.
  const py = c.top - 30;
  g.roundRect(c.cx - 36, py, 72, 14, 2).fill(K.station.plate).stroke({ width: 1.6, color: K.station.plateRim });
  g.rect(c.cx - 26, py + 5.5, 52, 3).fill({ color: K.station.plateRim, alpha: 0.85 });
  const kx = c.cx + 58, ky = c.top + 2;
  rod(g, kx, ky - 16, kx, ky - 8, 1, K.station.iron);
  g.circle(kx, ky, 8.5).fill(K.station.clockFace).stroke({ width: 1.6, color: K.station.iron });
  rod(g, kx, ky, kx, ky - 5.5, 0.9, K.station.iron);
  rod(g, kx, ky, kx + 4, ky + 1.5, 0.9, K.station.iron);
  c.back.addChild(g);
  // A teal signal lamp in the tunnel mouth: the cool hint that the line goes on.
  const sig = new Graphics();
  sig.circle(c.cx + half - 14, mb - 46, 2.2).fill(PROPS.cavern.lakeTease);
  sig.blendMode = 'add';
  c.glow.addChild(sig);
  c.lights.push({ x: c.cx + half - 14, y: mb - 46, preset: 'signal', kind: 'shell', area: c.area(f0) });
}

function stationFront(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  const by = c.plazaY;
  // The platform edge: a yellow line along the plaza deck.
  for (let x = a; x < b; x += 12) g.rect(x, by + 1, 8, 2).fill({ color: PROPS.district.platformEdge, alpha: 0.85 });
  if (c.dens > 0.3) {
    // Turnstiles on the west side, a bench on the east.
    for (const tx of [a + 14, a + 30]) {
      contactShadow(g, tx, by, 10);
      g.rect(tx - 3, by - 20, 6, 20).fill(vfill(K.station.iron, by - 20, by)).stroke({ ...OUTLINE, width: 1 });
      rod(g, tx + 3, by - 14, tx + 11, by - 14, 1.2, shade(K.station.iron, 1.5));
    }
    const bx = b - 44;
    contactShadow(g, bx + 16, by, 32);
    g.rect(bx, by - 11, 32, 3.5).fill(vfill(PROPS.hub.benchSeat, by - 11, by - 7)).stroke({ ...OUTLINE, width: 1 });
    rod(g, bx + 3, by - 8, bx + 3, by, 2, K.station.iron);
    rod(g, bx + 29, by - 8, bx + 29, by, 2, K.station.iron);
  }
  c.front.addChild(g);
  // Sodium globes hung under each storey's ceiling by the columns: the most orange light in the game.
  const globes = new Graphics();
  const lit = new Graphics();
  lit.blendMode = 'add';
  for (const f of c.h.floors) {
    for (const x of [a + 34, b - 34]) {
      const y = floorTop(f) + 26;
      rod(globes, x, floorTop(f) + 4, x, y - 5, 1, K.station.iron);
      globes.circle(x, y, 5).fill(PROPS.globe.sodium).stroke({ width: 1, color: K.station.iron });
      lit.circle(x, y, 9).fill({ color: PROPS.globe.sodiumHalo, alpha: 0.35 });
      c.lights.push({ x, y: y + 4, preset: 'sodium', kind: 'civic', area: c.area(f) });
    }
  }
  c.front.addChild(globes);
  c.glow.addChild(lit);
}

// ============================================================================================================== Mines (4)

function mineBack(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  const r = rng(4400 + c.h.floors[0]);
  // Copper veins and gold flecks running through the hewn wall.
  for (let i = 0; i < 5; i++) {
    let x = a + r() * (b - a), y = c.y0 + 20 + r() * (c.y1 - c.y0 - 40);
    const pts = [x, y];
    for (let j = 0; j < 8; j++) { x += 10 + r() * 14; y += (r() - 0.5) * 22; pts.push(x, y); }
    g.poly(pts, false).stroke({ width: 2.2, color: K.mine.ore, alpha: 0.55, join: 'round', cap: 'round' });
    for (let j = 0; j < 4; j++) g.circle(pts[j * 4] + r() * 4, pts[j * 4 + 1] + r() * 4, 1.2).fill({ color: K.mine.gold, alpha: 0.85 });
  }
  c.back.addChild(g);
  // Timber sets hold every storey up against the walls.
  for (const f of c.h.floors) {
    for (const x of [a + 18, b - 18]) {
      const ts = sprite('timber-set', x, floorLineY(f) + 2);
      ts.scale.set(ts.scale.x * 0.62, ts.scale.y * ((ROOM_H - 6) / 72));
      c.back.addChild(ts);
    }
  }
}

function mineFront(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  // The headframe over the spine: two raking timber legs from the top storey's balconies to the winch wheel under the roof.
  const f0 = c.h.floors[0];
  const legY = laneY(f0), apexY = c.top - H.vaultRise + 22;
  const wx = c.cx, wy = apexY + 4, R = 17;
  for (const sx of [-1, 1]) {
    const fx = c.cx + sx * 74;
    g.poly([fx - 3, legY, fx + 3, legY, wx + sx * 6, wy + 4, wx + sx * 1, wy + 4]).fill(vfill(K.mine.timber, wy, legY)).stroke({ ...OUTLINE, width: 1 });
  }
  for (const t of [0.35, 0.7]) {
    const ya = wy + (legY - wy) * t;
    const half = 6 + 68 * t;
    rod(g, c.cx - half, ya, c.cx + half, ya, 2.4, K.mine.timberDark);
  }
  // The winch wheel: rim, spokes, hub; the cable runs down the spine.
  g.circle(wx, wy, R).stroke({ width: 3, color: K.mine.iron }).stroke({ width: 1, color: OUTLINE.color, alpha: 0.7 });
  for (let i = 0; i < 6; i++) {
    const aa = (i / 6) * Math.PI;
    rod(g, wx - Math.cos(aa) * R, wy - Math.sin(aa) * R, wx + Math.cos(aa) * R, wy + Math.sin(aa) * R, 0.9, K.mine.iron);
  }
  g.circle(wx, wy, 3).fill(shade(K.mine.iron, 1.3));
  rod(g, wx + R - 1, wy, wx + R - 1, c.y1 - 20, 0.8, shade(K.mine.rope, 0.7));
  c.front.addChild(g);
  // The work flood on the headframe: the hub's key light.
  c.lights.push(...lamp(c.front, c.glow, 'lamp-cage', c.cx - 28, wy + 22, { kind: 'shell', preset: 'floodlight', area: c.area(f0) }, { flip: true }));
  if (c.dens < 0.3) return;
  // An ore cart on rails across the plaza, ore heaped in it; a stack of blasting crates.
  const p = new Graphics();
  const by = c.plazaY;
  rod(p, a, by - 1, b, by - 1, 1.2, PROPS.district.rail);
  for (let x = a + 4; x < b; x += 11) p.rect(x, by - 0.5, 6, 2).fill(K.mine.timberDark);
  const cxr = a + 46;
  contactShadow(p, cxr + 14, by, 30);
  p.poly([cxr, by - 20, cxr + 30, by - 20, cxr + 26, by - 5, cxr + 4, by - 5]).fill(vfill(K.mine.cart, by - 20, by - 5)).stroke(OUTLINE);
  for (let i = 0; i < 5; i++) p.circle(cxr + 6 + i * 4.5, by - 21 - (i % 2) * 2, 3).fill(shade(i % 2 ? K.mine.ore : c.P.rock, 1.2));
  for (const w of [cxr + 8, cxr + 22]) p.circle(w, by - 3, 3).fill(K.mine.iron).stroke({ ...OUTLINE, width: 0.8 });
  const kx = b - 36;
  contactShadow(p, kx + 12, by, 26);
  p.rect(kx, by - 14, 24, 14).fill(vfill(K.mine.timber, by - 14, by)).stroke(OUTLINE);
  p.rect(kx + 4, by - 24, 16, 10).fill(vfill(shade(K.mine.timber, 0.9), by - 24, by - 14)).stroke(OUTLINE);
  p.rect(kx + 2, by - 9, 20, 2.4).fill(PROPS.edges.sealBar);
  c.front.addChild(p);
}

// ============================================================================================================== Deep Caves (5)

function cavernBack(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  const r = rng(5500 + c.h.floors[0]);
  // Flowstone curtains down the walls.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side < 0 ? a + 4 + i * 9 : b - 4 - i * 9;
      const yA = c.y0 + 30 + r() * 40, yB = yA + 80 + r() * 160;
      const pts: number[] = [];
      for (let y = yA; y <= yB; y += 8) pts.push(x + Math.sin(y / 13 + i) * 2.5, y);
      g.poly(pts, false).stroke({ width: 4 + r() * 3, color: K.cavern.flowstone, alpha: 0.32, cap: 'round' });
    }
  }
  // Stalactites hanging from the natural roof (the hub's ragged vault line).
  const v = c.h.vault;
  for (let i = 2; i < v.length - 2; i += 2) {
    if (r() < 0.35) continue;
    const x = v[i], y = v[i + 1];
    const len = 8 + r() * 26, w = 3 + r() * 4;
    g.poly([x - w, y - 2, x + w, y - 2, x + (r() - 0.5) * 2, y + len]).fill(vfill(shade(c.P.rock, 1.3), y, y + len, 1.2, 0.7)).stroke({ ...OUTLINE, width: 0.8 });
  }
  c.back.addChild(g);
  // Glowing fungus shelves on the walls, one bed per storey and side: soft cold pools.
  const lit = new Graphics();
  lit.blendMode = 'add';
  const beds = new Graphics();
  for (const f of c.h.floors) {
    for (const side of [-1, 1]) {
      const x = side < 0 ? a + 22 : b - 22, y = floorTop(f) + 46;
      for (let k = 0; k < 5; k++) {
        const bx = x + (k - 2) * 5, w = 4 + (k % 2) * 2;
        beds.ellipse(bx, y + (k % 3), w, 2.2).fill(shade(K.cavern.fungus, 0.55)).stroke({ ...OUTLINE, width: 0.6 });
        lit.ellipse(bx, y - 1 + (k % 3), w * 0.8, 1.4).fill({ color: K.cavern.fungus, alpha: 0.55 });
      }
      c.lights.push({ x, y, preset: 'bioFungus', kind: 'shell', area: c.area(f) });
    }
  }
  c.back.addChild(beds);
  c.glow.addChild(lit);
}

function crystalCluster(g: Graphics, lit: Graphics, x: number, y: number, n: number, h: number, seed: number, col: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const px = x + (i - n / 2) * 5 + (r() - 0.5) * 3, hh = h * (0.45 + r() * 0.6), w = 2.5 + r() * 2.5, lean = (r() - 0.5) * 8;
    g.poly([px - w, y, px + w, y, px + lean + w * 0.2, y - hh, px + lean - w * 0.3, y - hh + 3]).fill(vfill(mix(col, 0xffffff, 0.15), y - hh, y, 1.25, 0.55)).stroke({ ...OUTLINE, width: 0.8 });
    lit.poly([px - w * 0.3, y - 2, px + lean * 0.9, y - hh + 4, px + w * 0.2, y - 2]).fill({ color: col, alpha: 0.35 });
  }
}

function cavernFront(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  const lit = new Graphics();
  lit.blendMode = 'add';
  const by = c.plazaY;
  // Crystal clusters on the plaza at both walls: the caves' cold key light.
  crystalCluster(g, lit, a + 18, by, 6, 34, 51, K.cavern.crystal);
  crystalCluster(g, lit, b - 20, by, 5, 30, 52, K.cavern.violet);
  c.lights.push({ x: a + 18, y: by - 20, preset: 'crystal', kind: 'shell', area: c.area(c.fz) });
  c.lights.push({ x: b - 20, y: by - 18, preset: 'crystal', color: K.cavern.violet, kind: 'shell', area: c.area(c.fz) });
  if (c.dens >= 0.3) {
    // A tarp camp on poles with a lantern: a small warm island, the strongest warm/cool contrast in the game.
    const tx = a + 48;
    rod(g, tx, by, tx + 2, by - 34, 1.8, K.mine.timber);
    rod(g, tx + 40, by, tx + 38, by - 26, 1.8, K.mine.timber);
    g.poly([tx - 6, by - 32, tx + 46, by - 24, tx + 44, by - 19, tx - 4, by - 27]).fill(vfill(K.cavern.tarp, by - 32, by - 19)).stroke({ ...OUTLINE, width: 1 });
    contactShadow(g, tx + 20, by, 30);
    g.rect(tx + 8, by - 8, 14, 8).fill(vfill(PROPS.hub.crate, by - 8, by)).stroke({ ...OUTLINE, width: 0.9 });
    c.lights.push(...lamp(c.front, c.glow, 'lamp-lantern', tx + 20, by - 24, { kind: 'civic', area: c.area(c.fz) }));
  }
  c.front.addChild(g);
  c.glow.addChild(lit);
}

// ============================================================================================================== Core (6)

function forgeBack(c: HubCtx): void {
  const [a, b] = inner(c);
  const g = new Graphics();
  // Heat shields: blued steel plates riveted along both walls, every storey.
  for (const f of c.h.floors) {
    const t = floorTop(f);
    for (const x of [a + 2, b - 26]) {
      g.rect(x, t + 12, 24, ROOM_H - 20).fill(vfill(K.forge.shield, t + 12, t + ROOM_H - 8, 1.15, 0.75)).stroke({ ...OUTLINE, width: 1 });
      g.rect(x, t + 12, 24, 1.4).fill({ color: K.forge.shieldEdge, alpha: 0.8 });
      for (let y = t + 18; y < t + ROOM_H - 10; y += 14) for (const rx of [x + 3, x + 21]) g.circle(rx, y, 0.9).fill(K.forge.shieldEdge);
    }
  }
  // The vault ring door behind the spine in the top storey: concentric brass rings, bolts, locking bars.
  const rx = c.cx, ry = c.top + 52, R = 50;
  g.circle(rx, ry, R + 4).fill(shade(K.forge.basalt, 0.8));
  g.circle(rx, ry, R).fill(vfill(K.forge.brass, ry - R, ry + R, 1.15, 0.55)).stroke(OUTLINE);
  g.circle(rx, ry, R - 9).fill(vfill(shade(K.forge.brass, 0.6), ry - R, ry + R, 1.1, 0.7)).stroke({ ...OUTLINE, width: 1 });
  g.circle(rx, ry, R - 22).stroke({ width: 3, color: shade(K.forge.brass, 0.85) });
  for (let i = 0; i < 12; i++) {
    const aa = (i / 12) * Math.PI * 2;
    g.circle(rx + Math.cos(aa) * (R - 4.5), ry + Math.sin(aa) * (R - 4.5), 1.4).fill(shade(K.forge.brass, 1.3));
  }
  for (let i = 0; i < 4; i++) {
    const aa = (i / 4) * Math.PI * 2 + 0.4;
    rod(g, rx + Math.cos(aa) * 8, ry + Math.sin(aa) * 8, rx + Math.cos(aa) * (R - 12), ry + Math.sin(aa) * (R - 12), 2.4, shade(K.forge.brass, 0.75));
  }
  // Geothermal risers up both walls.
  for (const x of [a + 30, b - 34]) {
    g.rect(x, c.y0 + 30, 5, c.y1 - c.y0 - 30).fill(vfill(shade(K.forge.shieldEdge, 0.8), c.y0, c.y1)).stroke({ ...OUTLINE, width: 0.8 });
    for (let y = c.y0 + 60; y < c.y1; y += 72) g.rect(x - 1.5, y, 8, 3).fill(shade(K.forge.shield, 1.2));
  }
  c.back.addChild(g);
}

function forgeFront(c: HubCtx): void {
  const [a, b] = inner(c);
  const by = c.plazaY + H.deckH * 0.55;
  // The magma seam under the plaza grating: the only stratum lit from the floor up.
  const seam = new Graphics();
  const r = rng(6600 + c.fz);
  const pts: number[] = [a, by + 3];
  for (let x = a; x <= b; x += 8) pts.push(x, by - 2 - r() * 4);
  pts.push(b, by + 3);
  for (let x = b; x >= a; x -= 8) pts.push(x, by + 6 + r() * 4);
  seam.poly(pts).fill({ color: K.forge.magma, alpha: 0.8 });
  for (let x = a + 6; x < b - 6; x += 8) seam.rect(x, by - 1, 4, 3).fill({ color: K.forge.magmaCore, alpha: 0.55 });
  seam.blendMode = 'add';
  c.glow.addChild(seam);
  // Heat haze and embers over it (static: the lightmap's pulse animates the glow).
  const haze = new Graphics();
  for (let i = 0; i < 6; i++) haze.ellipse(a + 20 + i * ((b - a - 40) / 5), by - 22 - (i % 2) * 10, 14, 8).fill({ color: K.forge.magma, alpha: 0.05 });
  for (let i = 0; i < 18; i++) haze.circle(a + r() * (b - a), by - 10 - r() * 60, 0.9).fill({ color: K.forge.magmaCore, alpha: 0.7 });
  haze.blendMode = 'add';
  c.glow.addChild(haze);
  for (const t of [0.2, 0.5, 0.8]) c.lights.push({ x: a + (b - a) * t, y: by + 4, preset: 'magma', kind: 'shell', area: c.area(c.fz) });
  // Embers in the upper storeys: a forge brazier on each balcony end (warm, people live here too).
  if (c.dens >= 0.3) {
    const g = new Graphics();
    const fx = b - 18, fy = c.plazaY;
    contactShadow(g, fx, fy, 16);
    g.poly([fx - 9, fy - 14, fx + 9, fy - 14, fx + 6, fy, fx - 6, fy]).fill(vfill(K.forge.shield, fy - 14, fy)).stroke(OUTLINE);
    c.front.addChild(g);
    const fl = new Graphics();
    fl.poly([fx - 7, fy - 14, fx - 2, fy - 24, fx + 1, fy - 17, fx + 5, fy - 26, fx + 7, fy - 14]).fill({ color: PROPS.hub.flame, alpha: 0.85 });
    fl.blendMode = 'add';
    c.glow.addChild(fl);
    c.lights.push({ x: fx, y: fy - 20, preset: 'forge', kind: 'shell', area: c.area(c.fz) });
  }
}
