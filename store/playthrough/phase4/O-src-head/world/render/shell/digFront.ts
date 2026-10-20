/**
 * [world:C1] The dig face under the bottom storey (architecture 4, "Floor dig"): a rough pit cut under the hub with a rubble wall that
 * stands `1 - progress` tall, timber shoring, a work lamp while the crew digs (a lantern and a spray-painted mark while it waits).
 * The crew itself is life-systems' (src/world/life/digCrew.ts); this is the place they work in.
 */
import { Container, Graphics } from 'pixi.js';
import type { StratumId } from '../../tokens';
import { CITY } from '../../tokens';
import { laneY } from '../../model/cityLayout';
import { polyBounds, seedOf } from '../../model/outline';
import type { CityArea, Cavity } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { lamp, palette, sprite } from './kit';
import { groundLantern, pick, rubbleWall, shovel, sprayX, tunnelFloor } from './props';

export function buildDigFront(cav: Cavity, area: CityArea | undefined): ShellPiece {
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'dig:back';
  front.label = 'dig:front';
  const lights: LightDef[] = [];
  const n = +cav.id.split(':')[2];
  const s = cav.s as StratumId;
  const P = palette(s);
  const b = polyBounds(cav.poly);
  const lane = laneY(n);
  const id = `f:${n}`;
  const seed = seedOf(cav.id);
  const digging = area?.state === 'digging';
  const p = area?.progress ?? 0;
  const floor = new Graphics();
  tunnelFloor(floor, b.x0, b.x1, lane, 24, s, seed);
  front.addChild(floor);
  // Shoring: timber sets along the pit, sized to its height.
  const H = lane - b.y0;
  for (let x = b.x0 + 40; x < b.x1 - 30; x += 150) {
    const t = sprite('timber-set', x, lane + 1);
    t.scale.set(t.scale.x, t.scale.y * (H / 72));
    front.addChild(t);
  }
  // The rubble wall: the face the crew is cutting (it clears from the hub side outward as the dig goes on).
  const wall = new Container();
  const startX = CITY.hub.wallW + b.x0 + 70;
  const set = rubbleWall(wall, startX, b.x1, lane, H + 6, seed);
  set(digging ? 1 - p : 1);
  front.addChild(wall);
  const dress = new Graphics();
  if (digging) {
    lights.push(...lamp(front, glow, 'lamp-work', b.x0 + 46, lane, { area: id }));
    shovel(dress, b.x0 + 62, lane, 0.3);
  } else {
    sprayX(dress, (startX + b.x1) / 2, b.y0 + H * 0.45, 16, P.hazard);
    lights.push(...groundLantern(front, glow, b.x0 + 52, lane, id));
    pick(dress, b.x0 + 60, lane - 1, -0.25);
  }
  front.addChild(dress, glow);
  return { back, front, lights, progress: { [id]: (q: number) => set(1 - q) } };
}
