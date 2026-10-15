/**
 * [world:M1] The transfers: where a service gallery (the band between two strata, gallery.ts draws its pipes and catwalk) crosses the
 * hub column, it becomes the seam's landing (style guide 2 "Seams"): a hazard-edged deck across the hub, an enamel plate in the next
 * stratum's sign ink, a row of signal lamps in the next stratum's key colour along the whole band, and one signature prop of the next
 * stratum shown early at each vestibule end (a red valve wheel before the service network, a strip of metro tile, a timber prop before
 * the mines, a crystal before the caves, an ember crack before the core). Going down always feels like arriving somewhere new.
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, PROPS, SIGNS, STRATA, type StratumId } from '../../tokens';
import { GALLERY_H } from '../../../rendering/geom';
import { polyBounds } from '../../model/outline';
import type { Cavity, HubGeom } from '../layoutTypes';
import type { PresetName } from '../lighting';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, mix, palette, rod, shade, vfill } from './kit';

const T = CITY.transfer;
const KEY: Record<number, PresetName> = { 2: 'fluoroTube', 3: 'sodium', 4: 'lantern', 5: 'bioFungus', 6: 'magma' };

export function buildTransfers(cavs: readonly Cavity[], hubs: readonly HubGeom[]): ShellPiece {
  const front = new Container();
  const glow = new Container();
  front.label = 'transfers:front';
  const lights: LightDef[] = [];
  const g = new Graphics();
  const lit = new Graphics();
  lit.blendMode = 'add';
  const hubOf = (s: number) => hubs.find(h => h.s === s);
  for (const c of cavs) {
    const m = /^c:gal:(\d+)$/.exec(c.id);
    if (!m) continue;
    const gi = +m[1];
    const next = Math.min(6, (c.s as number) + 1) as StratumId;
    const b = polyBounds(c.poly);
    const y0 = b.y0, y1 = y0 + GALLERY_H;
    const hub = hubOf(c.s) ?? hubOf(next);
    const area = `g:${gi}`;
    const key = STRATA[next].light.key;
    const Pn = palette(next);
    // The signal row along the band, in the next stratum's key colour (additive dots: no pools, so the band stays a dim service space).
    for (let x = b.x0 + 20; x < b.x1 - 10; x += T.lampEvery) {
      g.rect(x - 2.4, y0 + 3, 4.8, 3).fill(shade(Pn.metal, 0.9)).stroke({ ...OUTLINE, width: 0.6 });
      lit.circle(x, y0 + 7, 2.6).fill({ color: key, alpha: 0.95 });
      lit.circle(x, y0 + 7, 9).fill({ color: key, alpha: 0.22 });
      lit.ellipse(x, y0 + 12, 14, 4).fill({ color: key, alpha: 0.08 });
    }
    if (hub) {
      const hx0 = hub.rect.x + CITY.hub.wallW, hx1 = hub.rect.x + hub.rect.w - CITY.hub.wallW;
      // The landing deck across the hub, hazard edge.
      const dy = y1 - T.deckH;
      g.rect(hx0, dy, hx1 - hx0, T.deckH).fill(vfill(shade(Pn.metal, 1.1), dy, y1)).stroke({ ...OUTLINE, width: 1 });
      for (let x = hx0 + 2; x < hx1 - 6; x += 10) g.rect(x, dy, 5, 2).fill(Pn.hazard);
      // The stratum plate: enamel in the next stratum's ink with a bar of its accent; no words (the depth ruler names it).
      const px = hx1 - T.plateW - 6, py = y0 + 6;
      g.roundRect(px, py, T.plateW, T.plateH, 2).fill(SIGNS.plate.fill).stroke({ width: 1.2, color: SIGNS.stratumInk[next] });
      g.rect(px + 4, py + 4.5, T.plateW - 8, 3).fill(mix(Pn.accent, 0xffffff, 0.15));
      lights.push({ x: (hx0 + hx1) / 2, y: y0 + 10, preset: KEY[next] ?? 'cageLamp', kind: 'shell', area, radius: 110, intensity: 0.75 });
    }
    // One signature prop of the next stratum at each end of the band.
    for (const ex of [b.x0 + 26, b.x1 - 30]) foreshadow(g, lit, next, ex, y1, lights, area);
  }
  front.addChild(g, glow);
  glow.addChild(lit);
  return { front, lights };
}

function foreshadow(g: Graphics, lit: Graphics, s: StratumId, x: number, y: number, lights: LightDef[], area: string): void {
  const K = PROPS.kit;
  if (s === 2) {
    rod(g, x, y - 4, x, y - 16, 1.2, K.service.pipe);
    g.circle(x, y - 19, 4.2).stroke({ width: 1.8, color: K.service.valve }).stroke({ width: 0.6, color: OUTLINE.color, alpha: 0.6 });
  } else if (s === 3) {
    g.rect(x - 12, y - 22, 24, 18).fill(vfill(K.station.tile, y - 22, y - 4)).stroke({ ...OUTLINE, width: 0.8 });
    g.rect(x - 12, y - 15, 24, 3).fill(K.station.trim);
  } else if (s === 4) {
    rod(g, x - 8, y - 2, x - 8, y - 28, 3, K.mine.timber);
    rod(g, x + 8, y - 2, x + 8, y - 28, 3, K.mine.timber);
    rod(g, x - 11, y - 28, x + 11, y - 28, 3, K.mine.timberDark);
  } else if (s === 5) {
    for (const [dx, h] of [[-4, 16], [1, 22], [6, 12]] as const) {
      g.poly([x + dx - 2.5, y - 2, x + dx + 2.5, y - 2, x + dx, y - 2 - h]).fill(vfill(K.cavern.crystal, y - 2 - h, y - 2, 1.2, 0.6)).stroke({ ...OUTLINE, width: 0.7 });
      lit.poly([x + dx - 1, y - 3, x + dx, y - h, x + dx + 1, y - 3]).fill({ color: K.cavern.crystal, alpha: 0.4 });
    }
    lights.push({ x, y: y - 12, preset: 'crystal', kind: 'tease', area, radius: 70 });
  } else if (s === 6) {
    lit.poly([x - 14, y - 3, x - 4, y - 9, x + 3, y - 5, x + 14, y - 11, x + 14, y - 8, x + 3, y - 2, x - 4, y - 6, x - 14, y - 1]).fill({ color: K.forge.magma, alpha: 0.7 });
    lights.push({ x, y: y - 6, preset: 'magma', kind: 'tease', area, radius: 80 });
  }
}
