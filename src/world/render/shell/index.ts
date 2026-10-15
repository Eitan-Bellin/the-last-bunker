/**
 * [world:C1] The city shell: everything structural the level-builder draws around the rooms of "The City Below".
 *
 *   buildShell(layout, state, quality, opts?) -> ShellParts
 *     back   -> mount in the play layer BEHIND the rooms (BunkerRenderer: undergroundHolder): the cavity backs (vault wall, corridor tile,
 *               concrete, recessed rock) and over them the rock cut face with every cavity cut out, its AO and lit rim
 *     front  -> mount ABOVE the rooms and the spine, under the walkers (architecture 5: shellFront): balconies, railings, stairs, bridge,
 *               chandelier, vestibule decks, edge chokes and tape, the dig face, district ledges and stalactites, pocket cracks
 *     lights -> CityRenderer.addLight each (LightInput, with the fog area set so hidden areas stay dark)
 *     update(view, now) per frame (streams the rock chunks), setProgress(id, p) when a dig moves, destroy() before the next build.
 *
 * Rebuild when `cityLayoutSig(state)` changes (the layout's `sig`). See store/world-redesign/C1-L-notes.md for the wiring.
 */
import { Container, Graphics } from 'pixi.js';
import type { GameState } from '../../../core/GameState';
import { SLOT_W } from '../../../rendering/geom';
import { WORLD_KIT_IDS, rockTileId } from '../../tokensAssets';
import { PROPS, type StratumId } from '../../tokens';
import type { RenderTier } from '../../tokensRender';
import { polyBounds } from '../../model/outline';
import type { Cavity, CityLayout, Rect } from '../layoutTypes';
import { buildCaverns } from './cavern';
import { buildDigFront } from './digFront';
import { buildEdges } from './edges';
import { buildEntrance } from './entrance';
import { buildDoors } from './doors';
import { buildTransfers } from './transfers';
import type { GalleryTransfer } from '../../model/transfers';
import { ForeSilhouettes } from './fore';
import { buildHub } from './hub';
import { grain, palette, shade, tile, vfill } from './kit';
import { buildPockets } from './pockets';
import { RockLayer } from './rock';
import type { LightDef, ShellOptions, ShellParts, ShellPiece } from './types';
import { buildVestibules } from './vestibule';

export type { LightDef, ShellParts, ShellPiece, ShellOptions } from './types';

/** The plain backs: dark board-formed concrete behind the floor strips and galleries, recessed rock behind tunnels, pits and pockets. */
function buildBacks(cavs: readonly Cavity[]): Container {
  const c = new Container();
  c.label = 'shell:backs';
  const g = new Graphics();
  const lines = new Graphics();
  for (const cav of cavs) {
    const b = polyBounds(cav.poly);
    const s = cav.s as StratumId;
    const P = palette(s);
    if (cav.back === 'concrete') {
      g.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0).fill(vfill(shade(P.builtDark, 0.8), b.y0, b.y1, 1.05, 0.7));
      for (let y = b.y0 + 10; y < b.y1; y += 11) lines.moveTo(b.x0, y).lineTo(b.x1, y).stroke({ width: 1, color: 0x000000, alpha: 0.12 });
      for (let x = Math.ceil(b.x0 / SLOT_W) * SLOT_W; x < b.x1; x += SLOT_W) lines.moveTo(x, b.y0).lineTo(x, b.y1).stroke({ width: 1.2, color: 0x000000, alpha: 0.18 });
      c.addChild(grain(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0));
    } else if (cav.back === 'rock') {
      // Recessed rock: the same rock, in shadow (it is the far wall of a tunnel or a pit).
      c.addChild(tile(rockTileId(WORLD_KIT_IDS[Math.max(1, s)]), b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, { tint: PROPS.rock.recessTint }));
    }
  }
  c.addChildAt(g, 0);
  c.addChild(lines);
  return c;
}

/** [world:M1] `state`: the era, and (city doors) the layout's doors and the floor count when given. */
export function buildShell(layout: CityLayout, state: Pick<GameState, 'era'> & Partial<Pick<GameState, 'layout' | 'currentFloors'>>, quality: RenderTier, opts: ShellOptions = {}): ShellParts {
  const era = opts.era ?? state.era ?? 0;
  const back = new Container();
  const front = new Container();
  back.label = 'shell:back';
  front.label = 'shell:front';
  back.eventMode = 'none';
  front.eventMode = 'none';
  const pieces: ShellPiece[] = [];

  back.addChild(buildBacks(layout.cavities));
  // One failing tube per hub: the east vestibule of its middle storey.
  const failing = new Set<string>();
  for (const h of layout.hubs) failing.add(`${h.floors[Math.min(1, h.floors.length - 1)]}:e`);
  pieces.push(buildVestibules(layout.cavities.filter(c => c.back === 'tile'), failing));
  for (const h of layout.hubs) pieces.push(buildHub(h, quality, era));
  const top = layout.hubs.find(h => h.s === 1 && h.floors[0] === 0);
  if (top) pieces.push(buildEntrance(top));
  pieces.push(buildCaverns(layout.areas, layout.cavities, era));
  pieces.push(buildEdges(layout.edges, layout.cavities));
  const dig = layout.cavities.find(c => c.id.startsWith('c:dig:'));
  if (dig) pieces.push(buildDigFront(dig, layout.areas.find(a => a.id === `f:${dig.id.split(':')[2]}`)));
  pieces.push(buildPockets(layout.areas, layout.cavities));
  // [world:M2] buildCityLayout returns a CityModel (the layout plus its gallery transfers); a bare CityLayout draws no runs.
  pieces.push(buildTransfers(layout.cavities, layout.hubs, (layout as CityLayout & { transfers?: GalleryTransfer[] }).transfers ?? []));
  pieces.push(buildDoors(state));

  for (const p of pieces) if (p.back) back.addChild(p.back);
  const rock = new RockLayer(layout, quality);
  back.addChild(rock.container);
  for (const p of pieces) if (p.front) front.addChild(p.front);

  // [world:M1] The fore plane's silhouettes (High only; they join the renderer's fore plane on the first update).
  const fore = new ForeSilhouettes(layout);
  const lights: LightDef[] = pieces.flatMap(p => p.lights);
  const progress: Record<string, (p: number) => void> = Object.assign({}, ...pieces.map(p => p.progress ?? {}));
  const stats = { rockChunks: 0, rockShown: 0 };
  return {
    back, front, lights, stats,
    update(view: Rect, now: number) {
      rock.update(view, now);
      fore.update(front, view, now);
      stats.rockChunks = rock.manager.stats.built;
      stats.rockShown = rock.manager.stats.shown;
    },
    setProgress(id: string, p: number) {
      progress[id]?.(p);
    },
    refreshRock() {
      rock.manager.clear();
    },
    destroy() {
      rock.destroy();
      fore.destroy();
      back.destroy({ children: true });
      front.destroy({ children: true });
    },
  };
}
