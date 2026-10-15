/**
 * [world:C1] The vestibules (style guide 12 beat 4, "Service Corridor"): short tiled corridors between the hub and the first rooms of
 * each storey, cream subway tile over a green dado, a pipe bundle with a red valve wheel under the ceiling, a caged fluorescent tube
 * (cool work light; one per stratum is failing), and the walkway deck on the corridor lane.
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, PROPS, type StratumId } from '../../tokens';
import { ROOM_H, SLAB, floorTop } from '../../../rendering/geom';
import { laneY } from '../../model/cityLayout';
import type { Cavity } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, grain, lamp, palette, rod, shade, tile, vfill } from './kit';
import { polyBounds } from '../../model/outline';

export function buildVestibules(cavs: readonly Cavity[], failing: ReadonlySet<string>): ShellPiece {
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'vestibules:back';
  front.label = 'vestibules:front';
  const lights: LightDef[] = [];
  const pipes = new Graphics();
  const slabs = new Graphics();
  for (const c of cavs) {
    const m = /^c:vest:(-?\d+):([we])$/.exec(c.id);
    if (!m) continue;
    const f = +m[1], side = m[2];
    const s = c.s as StratumId;
    const P = palette(s);
    const b = polyBounds(c.poly);
    const w = b.x1 - b.x0, top = floorTop(f), floor = top + ROOM_H;
    // The tiled wall, one room height, its pattern locked to the floor line.
    back.addChild(tile('corridor-tile', b.x0, top, w, ROOM_H, { oy: floor, tint: s === 1 || s === 2 ? 0xffffff : shade(P.secondary, 1.3) }));
    back.addChild(grain(b.x0, top, w, ROOM_H, 0.08));
    // Under the floor line: the slab band (dark concrete behind the deck).
    slabs.rect(b.x0, floor, w, SLAB).fill(vfill(P.builtDark, floor, floor + SLAB, 0.9, 0.55));
    // Pipe bundle under the ceiling: two insulated runs and a red valve wheel (vector parts under 6 u).
    const py = top + 7;
    pipes.rect(b.x0, py - 3, w, 4).fill(vfill(shade(P.metal, 1.05), py - 3, py + 1)).stroke({ ...OUTLINE, width: 1 });
    pipes.rect(b.x0, py + 3, w, 3).fill(vfill(PROPS.vestibule.pipe, py + 3, py + 6)).stroke({ ...OUTLINE, width: 1 });
    for (let x = b.x0 + 8; x < b.x1; x += 22) pipes.rect(x, py - 4, 2, 11).fill(shade(P.metal, 0.7));
    const vx = side === 'e' ? b.x0 + w * 0.7 : b.x0 + w * 0.3;
    rod(pipes, vx, py, vx, py + 12, 1.2, PROPS.vestibule.valveStem);
    pipes.circle(vx, py + 15, 4.2).stroke({ width: 1.6, color: PROPS.vestibule.valveWheel }).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
    // The tube: cool work light; the failing one flickers out now and then.
    const id = `${f}:${side}`;
    lights.push(...lamp(back, glow, 'lamp-tube', b.x0 + w / 2, top + 13, { kind: 'shell', preset: failing.has(id) ? 'failingTube' : 'fluoroTube', area: `f:${f}` }));
    // The walkway deck carries on from the rooms' corridor to the balcony.
    front.addChild(tile('deck', b.x0 - 2, laneY(f), w + 4, CITY.hub.deckH));
  }
  back.addChildAt(slabs, 0);
  back.addChild(pipes, glow);
  return { back, front, lights };
}
