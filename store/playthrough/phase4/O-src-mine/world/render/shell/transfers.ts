/**
 * [world:M1] The transfers: where a service gallery (the band between two strata, gallery.ts draws its pipes and catwalk) crosses the
 * hub column, it becomes the seam's landing (style guide 2 "Seams"): a hazard-edged deck across the hub, an enamel plate in the next
 * stratum's sign ink, a row of signal lamps in the next stratum's key colour along the whole band, and one signature prop of the next
 * stratum shown early at each vestibule end (a red valve wheel before the service network, a strip of metro tile, a timber prop before
 * the mines, a crystal before the caves, an ember crack before the core). Going down always feels like arriving somewhere new.
 *
 * [world:M2] The strata have their own frames now, so the two hubs' stair columns do not line up: each transfer run (model/transfers.ts)
 * is drawn as people walk it: a stair well cut through the upper hub's plaza slab with its flights down to the catwalk, the catwalk deck
 * along the band under both hubs (the jog), and the flights down into the lower hub's top storey, with a cage lamp on each well.
 */
import { Container, Graphics } from 'pixi.js';
import { CITY, PROPS, SIGNS, STRATA, type StratumId } from '../../tokens';
import { FLIGHT_RISE, GALLERY_H, SHAFT_W, TOWER_AMP } from '../../../rendering/geom';
import type { GalleryTransfer, TransferRun } from '../../model/transfers';
import { polyBounds } from '../../model/outline';
import type { Cavity, HubGeom } from '../layoutTypes';
import type { PresetName } from '../lighting';
import type { LightDef, ShellPiece } from './types';
import { OUTLINE, mix, palette, rod, shade, sprite, vfill } from './kit';

const T = CITY.transfer;
const KEY: Record<number, PresetName> = { 2: 'fluoroTube', 3: 'sodium', 4: 'lantern', 5: 'bioFungus', 6: 'magma' };

export function buildTransfers(cavs: readonly Cavity[], hubs: readonly HubGeom[], transfers: readonly GalleryTransfer[] = []): ShellPiece {
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
    const tr = transfers.find(t => t.g === gi);
    if (hub) {
      let hx0 = hub.rect.x + CITY.hub.wallW, hx1 = hub.rect.x + hub.rect.w - CITY.hub.wallW;
      // [world:M2] With a transfer the landing hall spans the wider of the two hubs (rendering/gallery.ts leaves that part of the band to
      // the shell): the service pipes run on behind the flights, the deck carries both ends of every run.
      const hl = hubOf(next);
      if (tr && hl) {
        hx0 = Math.min(hx0, hl.rect.x + CITY.hub.wallW);
        hx1 = Math.max(hx1, hl.rect.x + hl.rect.w - CITY.hub.wallW);
        const Pu = palette(c.s as StratumId);
        for (const [xa, xb] of [[hx0, 0], [SHAFT_W, hx1]] as const) {
          g.rect(xa, y0 + T.pipeY, xb - xa, T.pipeH).fill(vfill(shade(Pu.metal, 0.85), y0 + T.pipeY, y0 + T.pipeY + T.pipeH)).stroke({ ...OUTLINE, width: 0.8 });
          g.rect(xa, y0 + T.pipeY + T.pipeH + 2.5, xb - xa, 2.6).fill(shade(Pu.secondary, 0.7));
          for (let x = xa + 12; x < xb - 6; x += T.flangeEvery) g.rect(x - 1.2, y0 + T.pipeY - 1.2, 2.4, T.pipeH + 2.4).fill(shade(Pu.metal, 0.55));
        }
      }
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
  // [world:M2] The runs, over the deck and the signal row.
  const runs = new Container();
  const wells = new Graphics();
  const rails = new Graphics();
  for (const t of transfers) for (const r of t.runs) drawRun(r, t, wells, runs, rails, lights);
  front.addChild(g, wells, runs, rails, glow);
  glow.addChild(lit);
  return { front, lights };
}

/** One transfer run: the well through the upper plaza, both flight columns with stringers, landings and handrail, the lamp. */
function drawRun(r: TransferRun, t: GalleryTransfer, wells: Graphics, runs: Container, rails: Graphics, lights: LightDef[]): void {
  const Pu = palette(t.upper), Pl = palette(t.lower);
  const area = `g:${t.g}`;
  const A = TOWER_AMP;
  // The well: the dark cut through the upper hub's plaza slab, a hazard lip on its edges.
  const wx0 = r.upper.column - A - 6, wx1 = r.upper.column + A + 6;
  wells.rect(wx0, r.upper.y + 2, wx1 - wx0, t.y0 - r.upper.y + 2).fill({ color: PROPS.hub.doorway, alpha: 0.78 });
  for (let x = wx0; x < wx1 - 4; x += 10) wells.rect(x, r.upper.y + 2, 5, 2).fill(Pu.hazard);
  // Stringer posts of both columns.
  for (const [c, y0, y1, P] of [[r.upper.column, r.upper.y, r.deckY, Pu], [r.lower.column, r.deckY, r.lower.y, Pl]] as const) {
    wells.rect(c - A - 4, y0 - 4, 3, y1 - y0 + 8).fill(vfill(P.metal, y0, y1)).stroke({ ...OUTLINE, width: 1 });
    wells.rect(c + A + 1, y0 - 4, 3, y1 - y0 + 8).fill(vfill(shade(P.metal, 0.8), y0, y1)).stroke({ ...OUTLINE, width: 1 });
  }
  // The flights: every path segment that is not the level run. Each starts on one landing and ends on the other side of its column.
  const P = r.path;
  for (let i = 2; i < P.length; i += 2) {
    const xa = P[i - 2], ya = P[i - 1], xb = P[i], yb = P[i + 1];
    if (Math.abs(yb - ya) < 1e-6) continue;
    const left = xb < xa;
    const Pk = ya < r.deckY - 1e-6 ? Pu : Pl;
    const fl = sprite('stair-flight', xb, yb, { flip: !left });
    fl.scale.y *= (yb - ya) / FLIGHT_RISE;
    runs.addChild(fl);
    rod(rails, xa, ya - 14, xb, yb - 14, 1.6, shade(Pk.secondary, 1.05));
    // The landing at the foot of the flight.
    rails.rect(xb - 6, yb, 12, 3.5).fill(shade(Pk.metal, 1.1)).stroke({ ...OUTLINE, width: 1 });
  }
  // A cage lamp over the top of each column (the well and the drop into the lower hub), on the band's ceiling.
  for (const c of [r.upper.column, r.lower.column]) lights.push({ x: c, y: t.y0 + 4, preset: 'cageLamp', kind: 'shell', area, radius: 64, intensity: 0.6 });
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
