/**
 * [world:C1] The vestibules (style guide 12 beat 4, "Service Corridor"): short tiled corridors between the hub and the first rooms of
 * each storey, cream subway tile over a green dado, a pipe bundle with a red valve wheel under the ceiling, a caged fluorescent tube
 * (cool work light; one per stratum is failing), and the walkway deck on the corridor lane.
 *
 * [world:M1] Each stratum's kit (CITY.kits) dresses its own: glazed tile in the shelter and the service network (the service's greener),
 * the metro's dirty cream tile with a teal frieze under sodium, a timbered drift in the mines lit by a carbide lantern, a bare rock
 * passage with a fungus shelf in the caves, basalt behind a heat shield in the core.
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, PROPS, type StratumId } from '../../tokens';
import { WORLD_KIT_IDS, rockTileId } from '../../tokensAssets';
import { ROOM_H, SLAB, floorTop } from '../../../rendering/geom';
import { laneY } from '../../model/cityLayout';
import type { Cavity } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, grain, lamp, mix, palette, rod, shade, sprite, tile, vfill } from './kit';
import { polyBounds } from '../../model/outline';

const K = PROPS.kit;

export function buildVestibules(cavs: readonly Cavity[], failing: ReadonlySet<string>): ShellPiece {
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'vestibules:back';
  front.label = 'vestibules:front';
  const lights: LightDef[] = [];
  const pipes = new Graphics();
  const slabs = new Graphics();
  const lit = new Graphics();
  lit.blendMode = 'add';
  for (const c of cavs) {
    const m = /^c:vest:(-?\d+):([we])$/.exec(c.id);
    if (!m) continue;
    const f = +m[1], side = m[2];
    const s = c.s as StratumId;
    const P = palette(s);
    const kit = CITY.kits[s]?.vault ?? 'hub';
    const b = polyBounds(c.poly);
    const w = b.x1 - b.x0, top = floorTop(f), floor = top + ROOM_H;
    const area = `f:${f}`;
    const tiled = kit === 'hub' || kit === 'service' || kit === 'station';
    if (tiled) {
      // The tiled wall, one room height, its pattern locked to the floor line.
      const tint = kit === 'station' ? K.station.tile : kit === 'service' ? mix(P.built, 0xffffff, 0.55) : 0xffffff;
      back.addChild(tile('corridor-tile', b.x0, top, w, ROOM_H, { oy: floor, tint }));
    } else {
      // Hewn or natural rock, a step brighter than the cut face.
      back.addChild(tile(rockTileId(WORLD_KIT_IDS[s]), b.x0, top, w, ROOM_H, { tint: mix(PROPS.rock.tint, 0xffffff, 0.2) }));
    }
    back.addChild(grain(b.x0, top, w, ROOM_H, 0.08));
    // Under the floor line: the slab band (dark concrete behind the deck).
    slabs.rect(b.x0, floor, w, SLAB).fill(vfill(tiled ? P.builtDark : shade(P.rockDark, 1.2), floor, floor + SLAB, 0.9, 0.55));
    const id = `${f}:${side}`;
    if (kit === 'hub' || kit === 'service') {
      // Pipe bundle under the ceiling: two insulated runs and a red valve wheel (vector parts under 6 u).
      const py = top + 7;
      pipes.rect(b.x0, py - 3, w, 4).fill(vfill(shade(P.metal, 1.05), py - 3, py + 1)).stroke({ ...OUTLINE, width: 1 });
      pipes.rect(b.x0, py + 3, w, 3).fill(vfill(PROPS.vestibule.pipe, py + 3, py + 6)).stroke({ ...OUTLINE, width: 1 });
      for (let x = b.x0 + 8; x < b.x1; x += 22) pipes.rect(x, py - 4, 2, 11).fill(shade(P.metal, 0.7));
      const vx = side === 'e' ? b.x0 + w * 0.7 : b.x0 + w * 0.3;
      rod(pipes, vx, py, vx, py + 12, 1.2, PROPS.vestibule.valveStem);
      pipes.circle(vx, py + 15, 4.2).stroke({ width: 1.6, color: PROPS.vestibule.valveWheel }).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
      // The tube: cool work light; the failing one flickers out now and then.
      lights.push(...lamp(back, glow, 'lamp-tube', b.x0 + w / 2, top + 13, { kind: 'shell', preset: failing.has(id) ? 'failingTube' : 'fluoroTube', area }));
    } else if (kit === 'station') {
      // A teal frieze and a sodium globe.
      pipes.rect(b.x0, top + 8, w, 5).fill(vfill(K.station.trim, top + 8, top + 13)).stroke({ ...OUTLINE, width: 0.8 });
      pipes.rect(b.x0, floor - 36, w, 4).fill(K.station.trim);
      const gx = b.x0 + w / 2, gy = top + 24;
      rod(pipes, gx, top + 13, gx, gy - 5, 1, K.station.iron);
      pipes.circle(gx, gy, 4.5).fill(0xffb060).stroke({ width: 1, color: K.station.iron });
      lit.circle(gx, gy, 8).fill({ color: 0xff9a3c, alpha: 0.3 });
      lights.push({ x: gx, y: gy + 4, preset: 'sodium', kind: 'shell', area, radius: 120 });
    } else if (kit === 'mine') {
      // A timber set at the drift's mouth and a carbide lantern on a nail.
      const ts = sprite('timber-set', b.x0 + w / 2, laneY(f) + 1);
      ts.scale.set(ts.scale.x * 0.6, ts.scale.y * ((laneY(f) - top - 4) / 72));
      front.addChild(ts);
      lights.push(...lamp(back, glow, 'lamp-lantern', b.x0 + w / 2 + (side === 'e' ? 9 : -9), top + 30, { kind: 'shell', area }));
    } else if (kit === 'cavern') {
      // A fungus shelf glowing cold on the passage wall.
      const fx = b.x0 + w / 2, fy = top + 40;
      for (let k = 0; k < 3; k++) {
        pipes.ellipse(fx + (k - 1) * 6, fy + (k % 2), 4, 2).fill(shade(K.cavern.fungus, 0.55)).stroke({ ...OUTLINE, width: 0.6 });
        lit.ellipse(fx + (k - 1) * 6, fy - 1 + (k % 2), 3.2, 1.2).fill({ color: K.cavern.fungus, alpha: 0.6 });
      }
      lights.push({ x: fx, y: fy, preset: 'bioFungus', kind: 'shell', area, radius: 80 });
    } else {
      // The core: a riveted heat shield across the passage wall and a caged lamp.
      pipes.rect(b.x0 + 3, top + 14, w - 6, ROOM_H - 22).fill(vfill(K.forge.shield, top + 14, floor - 8, 1.15, 0.75)).stroke({ ...OUTLINE, width: 1 });
      for (let y = top + 20; y < floor - 12; y += 14) for (const rx of [b.x0 + 6, b.x1 - 6]) pipes.circle(rx, y, 0.9).fill(K.forge.shieldEdge);
      lights.push(...lamp(back, glow, 'lamp-cage', b.x0 + (side === 'e' ? 4 : w - 4), top + 22, { kind: 'shell', area }, { flip: side === 'w' }));
    }
    // The walkway deck carries on from the rooms' corridor to the balcony.
    front.addChild(tile('deck', b.x0 - 2, laneY(f), w + 4, CITY.hub.deckH, tiled ? {} : { tint: mix(K.mine.timber, 0xffffff, 0.4) }));
  }
  back.addChildAt(slabs, 0);
  back.addChild(pipes, glow);
  glow.addChild(lit);
  return { back, front, lights };
}
