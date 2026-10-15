/**
 * [world:C1] District caverns beyond the floor ends (architecture 1.4; style guide 12 beat 5). A built district's cavern is OPEN at the back
 * (Cavity back 'none': the parallax planes show through), with a rock ledge under the painted district room, stalactites along the roof
 * (never over the room), a street lamp and the tunnel's timber. On offer (glimpsed) it is a rubble-choked mouth with the district's own
 * signature light beyond; being dug, the choke clears with the construction's progress.
 */
import { Container, Graphics } from 'pixi.js';
import { STRATA, type Hex, type StratumId } from '../../tokens';
import { DISTRICT_SLOTS } from '../../../data/buildingDefs';
import { ROOM_H, SLOT_W, floorTop } from '../../../rendering/geom';
import { laneY, storeyBottom } from '../../model/cityLayout';
import { polyBounds, seedOf } from '../../model/outline';
import type { CityArea, Cavity } from '../layoutTypes';
import type { PresetName } from '../lighting';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, lamp, palette, rng, rod, shade, sprite, vfill } from './kit';
import { rubbleWall, tunnelFloor } from './props';

/** The light a district shows through its choked mouth before it is dug (its identity, cool = the unknown). */
const DISTRICT_TEASE: Record<string, { preset: PresetName; color?: Hex }> = {
  cave: { preset: 'crystal' },
  lake: { preset: 'signal', color: 0x40c8e0 },
  metro: { preset: 'sodium' },
  geothermal: { preset: 'magma' },
  oldVault: { preset: 'teaseBeyond' },
};

export function buildCaverns(areas: readonly CityArea[], cavs: readonly Cavity[], era: number): ShellPiece {
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'caverns:back';
  front.label = 'caverns:front';
  const lights: LightDef[] = [];
  const progress: Record<string, (p: number) => void> = {};
  const g = new Graphics();
  const fg = new Graphics();
  for (const a of areas) {
    if (a.kind !== 'district') continue;
    const kind = a.id.slice(2);
    const cave = cavs.find(c => c.id === `c:dist:${kind}`);
    const tun = cavs.find(c => c.id === `c:tun:${kind}`);
    if (!cave) continue;
    const s = cave.s as StratumId;
    const P = palette(s);
    const cb = polyBounds(cave.poly);
    const room = { x0: (a.label?.x ?? 0) - (DISTRICT_SLOTS * SLOT_W) / 2, x1: (a.label?.x ?? 0) + (DISTRICT_SLOTS * SLOT_W) / 2 };
    const f = floorOfY(a.label?.y ?? 0);
    const top = floorTop(f), lane = laneY(f), floor = top + ROOM_H;
    const seed = seedOf(a.id);
    // The tunnel from the floor's end: timber and a dirt floor.
    if (tun) {
      const tb = polyBounds(tun.poly);
      tunnelFloor(fg, tb.x0, tb.x1, lane, 26, s, seed);
      const ts = sprite('timber-set', (tb.x0 + tb.x1) / 2, lane + 1);
      ts.scale.set(ts.scale.x * 0.8, ts.scale.y * ((lane - tb.y0 + 4) / 72));
      front.addChild(ts);
    }
    if (a.state === 'revealed') {
      // The ledge under the room: a rock shelf with a lit lip, the cavern floor beyond the room.
      g.rect(cb.x0 + 8, floor, cb.x1 - cb.x0 - 16, storeyBottom(f) - floor).fill(vfill(shade(P.rockDark, 1.1), floor, storeyBottom(f), 1.1, 0.5));
      tunnelFloor(fg, cb.x0 + 10, cb.x1 - 10, lane, 20, s, seed + 1);
      // Stalactites along the roof, clear of the room's top.
      const r = rng(seed);
      for (let x = cb.x0 + 16; x < cb.x1 - 16; x += 14 + r() * 18) {
        const roofY = roofAt(cave.poly, x);
        if (roofY === null) continue;
        const room0 = x > room.x0 - 6 && x < room.x1 + 6;
        const maxLen = room0 ? Math.max(0, top - roofY - 8) : (lane - roofY) * 0.45;
        const len = Math.min(maxLen, 10 + r() * 34);
        if (len < 6) continue;
        const w = 4 + r() * 6;
        fg.poly([x - w, roofY - 2, x + w, roofY - 2, x + (r() - 0.5) * 3, roofY + len]).fill(vfill(shade(P.rockDark, 0.9), roofY, roofY + len, 1.2, 0.7)).stroke({ ...OUTLINE, width: 1 });
        fg.moveTo(x - w * 0.6, roofY).lineTo(x, roofY + len * 0.8).stroke({ width: 1, color: P.rockRim, alpha: 0.3 });
      }
      // A street lamp on the ledge just past the room, and string lights from the Colony era on.
      const lx = Math.min(cb.x1 - 18, room.x1 + 22);
      rod(fg, lx, lane, lx, lane - 74, 2.4, shade(P.metal, 0.9));
      rod(fg, lx, lane - 74, lx - 9, lane - 74, 1.8, shade(P.metal, 0.9));
      fg.poly([lx - 15, lane - 74, lx - 3, lane - 74, lx - 5, lane - 68, lx - 13, lane - 68]).fill(0x2a2622).stroke({ ...OUTLINE, width: 1 });
      const bulb = new Graphics();
      bulb.circle(lx - 9, lane - 67, 2.6).fill({ color: 0xffe0a8 });
      bulb.blendMode = 'add';
      glow.addChild(bulb);
      lights.push({ x: lx - 9, y: lane - 66, preset: 'streetLamp', kind: 'civic', area: a.id });
      if (era >= 2) {
        for (let i = 0; i < 10; i++) {
          const t = (i + 0.5) / 10, bx = cb.x0 + 24 + (cb.x1 - cb.x0 - 48) * t, by = top - 22 + Math.sin(Math.PI * t) * 18;
          lights.push(...lamp(front, glow, 'lamp-bulb', bx, by, { kind: 'civic', area: a.id }));
        }
      }
    } else {
      // Glimpsed or being dug: a choke of rubble fills the cavern mouth; the district's light leaks past it.
      const wall = new Container();
      const set = rubbleWall(wall, room.x0 - 30, room.x1 + 20, lane, lane - top + 4, seed);
      const p = a.state === 'digging' ? a.progress ?? 0 : 0;
      set(1 - p);
      if (a.state === 'digging') progress[a.id] = (q: number) => set(1 - q);
      front.addChild(wall);
      const t = DISTRICT_TEASE[kind] ?? { preset: 'teaseBeyond' as PresetName };
      lights.push({ x: (room.x0 + room.x1) / 2 + 40, y: top + 40, preset: t.preset, kind: 'tease', area: a.id, ...(t.color !== undefined ? { color: t.color } : {}) });
      if (a.state === 'digging') lights.push(...lamp(front, glow, 'lamp-work', room.x0 - 50, lane, { area: a.id }));
      void STRATA;
    }
  }
  back.addChild(g);
  front.addChildAt(fg, 0);
  front.addChild(glow);
  return { back, front, lights, progress };
}

/** The floor whose band holds y (the district's label sits 20 above its room top). */
function floorOfY(y: number): number {
  let f = 0;
  while (f < 23 && floorTop(f + 1) <= y + 20) f++;
  return f;
}

/** The cavern roof (smallest y of the polygon) above x, or null. */
function roofAt(poly: readonly number[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xa = poly[j], ya = poly[j + 1], xb = poly[i], yb = poly[i + 1];
    if ((x < Math.min(xa, xb)) || x > Math.max(xa, xb) || xa === xb) continue;
    const y = ya + ((yb - ya) * (x - xa)) / (xb - xa);
    if (best === null || y < best) best = y;
  }
  return best;
}
