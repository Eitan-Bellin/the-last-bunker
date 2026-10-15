/**
 * [world:C1] The dark edges (style guide 12 beat 6; architecture 4): the open end of every storey on both sides is a short tunnel stub
 * that ends in what stops the wing from growing (data/wings.ts wingBlock):
 *   act        a collapsed tunnel: rubble choke, a broken beam, caution tape across the mouth, a "sealed by order" plate; a lantern and a
 *              pick on the ground (a warm island) and a COLD TEASE beyond the rubble (the hook for the next Act)
 *   stability  cracked rock with timber props, a small choke, a caged lamp on a timber
 *   district   a district's tunnel is being dug here: tape and spoil heaps
 *   ready      a marked dig site: spray-painted X on the face, tools, a caged lamp
 *   digging    a work lamp and a rubble face that clears with the dig's progress
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, SIGNS, type StratumId } from '../../tokens';
import { floorTop } from '../../../rendering/geom';
import { laneY } from '../../model/cityLayout';
import { seedOf } from '../../model/outline';
import type { Cavity, EdgeSite } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, lamp, palette, rod, shade, sprite } from './kit';
import { cracks, groundLantern, pick, post, rubbleWall, shovel, sprayX, tape, tunnelFloor } from './props';

const L = CITY.layout;

export function buildEdges(edges: readonly EdgeSite[], cavs: readonly Cavity[]): ShellPiece {
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'edges:back';
  front.label = 'edges:front';
  const lights: LightDef[] = [];
  const progress: Record<string, (p: number) => void> = {};
  const backG = new Graphics();
  const floorG = new Graphics();
  const dress = new Graphics();
  back.addChild(backG);
  front.addChild(floorG);
  for (const e of edges) {
    const cav = cavs.find(c => c.id === `c:edge:${e.floor}:${e.side}`);
    if (!cav) continue;
    const s = cav.s as StratumId;
    const P = palette(s);
    const dir = e.side === 'e' ? 1 : -1;
    const mouth = e.x - dir * L.edgeLen * L.edgeChoke;
    const far = mouth + dir * L.edgeLen;
    const lane = laneY(e.floor);
    const ceil = floorTop(e.floor) + L.edgeTop;
    const seed = seedOf(e.id);
    const area = e.id;
    tunnelFloor(floorG, mouth - dir * 4, far, lane, 30, s, seed);
    // Timber sets hold the tunnel: one at the mouth, one by the choke.
    for (const t of [0.12, 0.46]) {
      const ts = sprite('timber-set', mouth + dir * L.edgeLen * t, lane + 1);
      ts.scale.set(ts.scale.x * 0.92, ts.scale.y * ((lane - ceil + 6) / 72));
      front.addChild(ts);
    }
    const choke = e.x;
    if (e.block === 'act') {
      // Three looks so a column of sealed ends never repeats: the east ends are "sealed by order" (tape, plate, the lantern by the pick),
      // the west ends alternate between a timber collapse and a bricked-up passage.
      const look = e.side === 'e' ? 0 : e.floor % 2 ? 1 : 2;
      const lit = new Graphics();
      lit.blendMode = 'add';
      glow.addChild(lit);
      if (look === 2) {
        // Bricked up: concrete blocks laid across the tunnel, one block missing at the top where the cold leaks through.
        const bw = 12, bh = 7, wx0 = Math.min(choke, choke + dir * 22), gapCourse = 1;
        let course = 0;
        for (let y = lane; y > ceil + 2; y -= bh, course++) {
          const off = course % 2 ? bw / 2 : 0;
          for (let x = wx0 - off; x < wx0 + 22; x += bw) {
            const xa = Math.max(wx0, x), xb = Math.min(wx0 + 22, x + bw);
            if (xb - xa < 2) continue;
            const top = Math.max(ceil + 2, y - bh);
            const missing = course === Math.floor((lane - ceil) / bh) - gapCourse && x > wx0 + 4;
            if (missing) { lit.rect(xa + 1, top + 1, xb - xa - 2, y - top - 2).fill({ color: 0x6aa8ff, alpha: 0.5 }); continue; }
            dress.rect(xa, top, xb - xa - 0.6, y - top - 0.6).fill(shade(P.builtDark, 1.15 + 0.15 * ((x + y) % 3) / 3)).stroke({ ...OUTLINE, width: 0.8 });
          }
        }
        // A stencilled plate on the blocks.
        dress.rect(wx0 + 3, lane - 44, 16, 10).fill(SIGNS.plate.fill).stroke({ width: 1, color: SIGNS.plate.rim });
        dress.rect(wx0 + 5, lane - 40, 12, 2.5).fill(0xb03a2a);
        const pile = sprite('rubble-a', choke - dir * 18, lane + 2, { flip: dir < 0 });
        front.addChild(pile);
      } else {
        const wall = new Container();
        rubbleWall(wall, choke - dir * 10, far, lane, lane - ceil + 8, seed)(1);
        front.addChild(wall);
        const beam = sprite('timber-beam', choke - dir * 16, lane - (look === 1 ? 30 : 18), { rotation: dir * (look === 1 ? -0.75 : -0.42), flip: dir < 0 });
        front.addChild(beam);
        cracks(new Graphics(), lit, choke + dir * 14, lane - 22, 2, 16, seed + 3, 0x6aa8ff);
        lit.alpha = 0.55;
      }
      if (look === 0) {
        // Tape across the mouth: two crossed strips between posts.
        const tx = mouth + dir * 34;
        post(dress, tx - dir * 6, lane - 46, lane);
        post(dress, tx + dir * 14, lane - 40, lane);
        tape(front, tx - dir * 6, lane - 42, tx + dir * 14, lane - 14);
        tape(front, tx - dir * 6, lane - 16, tx + dir * 14, lane - 36);
        // The plate: dark enamel with a red bar ("sealed by order"), no text in the world.
        const px = tx + dir * 26, py = lane - 52;
        dress.rect(px - 9, py, 18, 12).fill(SIGNS.plate.fill).stroke({ width: 1, color: SIGNS.plate.rim });
        dress.rect(px - 7, py + 4.5, 14, 3).fill(0xb03a2a);
        rod(dress, px, py + 12, px, lane, 1.6, 0x4a4440);
        // A warm island at the mouth: a lantern by a pick.
        lights.push(...groundLantern(front, glow, mouth + dir * 62, lane, area));
        pick(dress, mouth + dir * 70, lane - 1, dir > 0 ? -0.2 : Math.PI + 0.2);
      } else if (look === 1) {
        // Planks stacked against the collapse, a drip line.
        front.addChild(sprite('timber-planks', mouth + dir * 50, lane + 1, { flip: dir < 0 }));
        for (let i = 0; i < 3; i++) dress.rect(choke - dir * (20 + i * 7), ceil + 4 + i * 4, 1, 9 + i * 3).fill({ color: 0x9ab0c0, alpha: 0.3 });
      }
      // The cold beyond (every sealed end has one: the invitation to the next Act).
      lights.push({ x: far - dir * 14, y: (ceil + lane) / 2, preset: 'teaseBeyond', kind: 'tease', area });
    } else if (e.block === 'stability') {
      cracks(backG, null, choke, (ceil + lane) / 2, 7, 70, seed);
      const wall = new Container();
      rubbleWall(wall, choke, far, lane, (lane - ceil) * 0.75, seed)(1);
      front.addChild(wall);
      const ts = sprite('timber-set', choke - dir * 18, lane + 1);
      ts.scale.set(ts.scale.x * 0.8, ts.scale.y * ((lane - ceil + 4) / 72));
      front.addChild(ts);
      lights.push(...lamp(back, glow, 'lamp-cage', mouth + dir * L.edgeLen * 0.12 + dir * 8, ceil + 24, { area }, { flip: dir < 0 }));
      // Drips down the cracked face.
      for (let i = 0; i < 4; i++) dress.rect(choke - dir * (8 + i * 9), ceil + 6 + i * 5, 1, 10 + i * 4).fill({ color: 0x9ab0c0, alpha: 0.35 });
    } else if (e.block === 'district') {
      const wall = new Container();
      rubbleWall(wall, choke, far, lane, (lane - ceil) * 0.6, seed)(1);
      front.addChild(wall);
      post(dress, mouth + dir * 30, lane - 40, lane);
      post(dress, mouth + dir * 58, lane - 40, lane);
      tape(front, mouth + dir * 30, lane - 34, mouth + dir * 58, lane - 34);
      lights.push(...lamp(back, glow, 'lamp-cage', mouth + dir * 20, ceil + 22, { area }, { flip: dir < 0 }));
    } else if (e.block === 'ready') {
      // The dig mark: a sprayed X on every other floor, a chalked arrow on the rest (a column of identical marks reads as a pattern).
      if (e.floor % 2 === 0) sprayX(backG, choke + dir * 12, (ceil + lane) / 2, 10, P.hazard);
      else {
        const ax = choke + dir * 4, ay = (ceil + lane) / 2;
        backG.moveTo(ax - dir * 12, ay).lineTo(ax + dir * 8, ay).stroke({ width: 2.4, color: 0xe8e0c8, alpha: 0.6, cap: 'round' });
        backG.moveTo(ax + dir * 2, ay - 6).lineTo(ax + dir * 9, ay).lineTo(ax + dir * 2, ay + 6).stroke({ width: 2.4, color: 0xe8e0c8, alpha: 0.6, cap: 'round', join: 'round' });
      }
      pick(dress, choke - dir * 28, lane - 1, dir > 0 ? -1.25 : Math.PI + 1.25);
      shovel(dress, choke - dir * 40, lane, -dir * 0.25);
      const pile = sprite('rubble-a', choke - dir * 6, lane + 2);
      front.addChild(pile);
      lights.push(...lamp(back, glow, 'lamp-cage', mouth + dir * 20, ceil + 22, { area }, { flip: dir < 0 }));
    } else {
      // digging: a face of rubble that clears with the progress, a work lamp on the crew's side.
      const wall = new Container();
      const set = rubbleWall(wall, choke - dir * 6, far, lane, lane - ceil + 6, seed);
      set(1 - e.progress);
      progress[e.id] = (p: number) => set(1 - p);
      front.addChild(wall);
      lights.push(...lamp(front, glow, 'lamp-work', mouth + dir * 26, lane, { area, kind: 'shell' }, { flip: dir < 0 }));
      shovel(dress, mouth + dir * 44, lane, dir * 0.25);
    }
    // The rock face at the far end reads darker (depth) with a faint rim.
    backG.rect(Math.min(far - dir * 18, far), ceil - 12, 18, lane - ceil + 14).fill({ color: 0x000000, alpha: 0.35 });
  }
  front.addChild(dress, glow);
  return { back, front, lights, progress };
}
