/**
 * [world:C1] Pockets (architecture 1.4, 4 "Pocket"): cosmetic secrets in the rock beyond any floor's reach. Before they are found they show
 * only as cracks in the cut face with the stratum's tease colour glowing through them (a tease light the fog lets through at
 * FOG.teaseAlpha); once found the hollow is lit by its own light: crystals in the caves and below, a dusty chamber above.
 */
import { Container, Graphics } from 'pixi.js';
import { STRATA, type StratumId } from '../../tokens';
import { polyBounds, seedOf } from '../../model/outline';
import type { CityArea, Cavity } from '../layoutTypes';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, mix, palette, rng, shade, sprite, vfill } from './kit';
import { cracks } from './props';

export function buildPockets(areas: readonly CityArea[], cavs: readonly Cavity[]): ShellPiece {
  const back = new Container();
  const front = new Container();
  const glow = new Container();
  back.label = 'pockets:back';
  front.label = 'pockets:front';
  const lights: LightDef[] = [];
  const dark = new Graphics();
  const lit = new Graphics();
  const inner = new Graphics();
  lit.blendMode = 'add';
  for (const a of areas) {
    if (a.kind !== 'pocket') continue;
    const cav = cavs.find(c => c.id === `c:${a.id}`);
    if (!cav) continue;
    const s = a.s as StratumId;
    const P = palette(s);
    const tease = STRATA[s].tease === 0xff3a2a ? 0x6aa8ff : STRATA[s].tease;
    const b = polyBounds(cav.poly);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const seed = seedOf(a.id);
    const r = rng(seed);
    // Cracks run from the hollow out through the rock, lit from inside.
    for (let i = 0; i < 4; i++) {
      const ex = r() < 0.5 ? b.x0 + 6 : b.x1 - 6, ey = b.y0 + (b.y1 - b.y0) * (0.2 + r() * 0.6);
      cracks(dark, a.state === 'revealed' ? null : lit, ex, ey, 2, 46, seed + i, tease);
    }
    // Inside: crystals (caves, core) or a dusty chamber with rubble.
    if (s >= 5 || a.id.includes('crystal') || a.id.includes('Grotto')) {
      for (let i = 0; i < 7; i++) {
        const x = b.x0 + 14 + r() * (b.x1 - b.x0 - 28), y = b.y1 - 4;
        const h = 14 + r() * 26, w = 4 + r() * 5;
        inner.poly([x - w, y, x + w, y, x + (r() - 0.5) * 6, y - h]).fill(vfill(mix(tease, 0xffffff, 0.2), y - h, y, 1.2, 0.6)).stroke({ ...OUTLINE, width: 1 });
      }
    } else {
      front.addChild(sprite('rubble-a', cx - 14, b.y1 - 2, { tint: shade(P.rock, 1.6) }));
      inner.rect(b.x0 + 10, b.y1 - 6, b.x1 - b.x0 - 20, 6).fill(vfill(P.rockDark, b.y1 - 6, b.y1));
    }
    lights.push({ x: cx, y: cy, preset: s >= 5 ? 'crystal' : 'teaseBeyond', kind: 'tease', area: a.id, color: tease });
  }
  back.addChild(inner);
  front.addChild(dark, glow);
  glow.addChild(lit);
  return { back, front, lights };
}
