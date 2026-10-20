/**
 * [world:C1-Li] The dig crew at work (architecture 4.2 "Floor dig: ... crew at work; dust; a work lamp"). The diggers are stored like a
 * project crew (DigSystem: assignedBuildingId 'p_dig' / 'p_dig2'), so the classic renderer sends them to the quarters like anyone off a
 * room. In the city they walk to where the rock is being cut and work there: at the pit under the bottom storey for a floor dig (down a
 * ladder from the plaza), at the rubble choke of the edge tunnel for a wing step.
 *
 * Read-only on the state (`longGame.dig` / `dig2`); DigSystem and the economy are untouched. Node-safe and pure.
 */
import type { GameState } from '../../core/GameState';
import type { DigState } from '../../core/state/longGame';
import { CITY as CITY_TOKENS, LIFE } from '../tokens';
import { laneY } from '../model/cityLayout';
import { polyBounds } from '../model/outline';
import type { CityLayout } from '../render/layoutTypes';

/** The crew ids of the two dig slots (DigSystem.DIG_CREW / DIG_CREW2; not imported: that module pulls in the whole engine). */
export const DIG_CREW_IDS: readonly string[] = ['p_dig', 'p_dig2'];

/** Where a dig slot's crew works. Reused (no allocation per call). */
export interface DigSite {
  /** 'pit' = a floor dig, 'edge' = a wing step. */
  kind: 'pit' | 'edge';
  /** The floor the crew stands on (the pit is the floor being dug), and the walking line there. */
  floor: number;
  y: number;
  /** The first digger's x and the way they face (toward the rock). */
  faceX: number;
  dir: number;
  /** Where the walk from the rooms ends before the last leg (the plaza above the pit), and whether that last leg is a ladder down. */
  entryFloor: number;
  entryX: number;
  entryY: number;
  ladder: boolean;
}

export function newDigSite(): DigSite {
  return { kind: 'pit', floor: 0, y: 0, faceX: 0, dir: 1, entryFloor: 0, entryX: 0, entryY: 0, ladder: false };
}

function digOf(state: GameState, slot: number): DigState | undefined {
  const d = slot === 0 ? state.longGame?.dig : state.longGame?.dig2;
  return d && d.floor != null ? d : undefined;
}

/** The slot (0 / 1) whose crew `assigned` is, or -1. */
export function digSlotOfCrew(assigned: string | null | undefined): number {
  if (!assigned) return -1;
  return assigned === DIG_CREW_IDS[0] ? 0 : assigned === DIG_CREW_IDS[1] ? 1 : -1;
}

/** Fills `out` with where dig slot `slot` is worked; false when nothing runs there or the layout has no place for it. */
export function digSite(state: GameState, layout: CityLayout, slot: number, out: DigSite): boolean {
  const d = digOf(state, slot);
  if (!d) return false;
  const D = LIFE.dig;
  if (d.kind === 'wing') {
    const id = `e:${d.floor}:${d.side ?? 'e'}`;
    const e = layout.edges.find(x => x.id === id);
    if (!e) return false;
    out.kind = 'edge';
    out.floor = e.floor;
    out.y = laneY(e.floor);
    out.dir = e.side === 'e' ? 1 : -1;
    out.faceX = e.x - out.dir * D.standOff;
    out.entryFloor = e.floor;
    out.entryX = out.faceX;
    out.entryY = out.y;
    out.ladder = false;
    return true;
  }
  const n = d.floor!;
  if (n < 1) return false; // no storey above to climb down from
  const cav = layout.cavities.find(c => c.id === `c:dig:${n}`);
  if (!cav) return false;
  const b = polyBounds(cav.poly);
  // The rubble wall starts here (shell/digFront.ts) and the work lamp stands at b.x0 + 46: the crew works between them and the wall.
  const wallX = CITY_TOKENS.hub.wallW + b.x0 + 70;
  out.kind = 'pit';
  out.floor = n;
  out.y = laneY(n);
  out.dir = 1;
  out.faceX = wallX - D.standOff;
  out.entryFloor = n - 1;
  out.entryX = b.x0 + D.ladderX;
  out.entryY = laneY(n - 1);
  out.ladder = true;
  return true;
}

/**
 * The place of crew member `k` (0-based, in a stable order) at a site: the first LIFE.dig.atFace dig at the face, side by side away
 * from it; the rest carry rubble a little further back. Writes x and the facing into `out` and returns whether this one digs.
 */
export function crewPlace(site: DigSite, k: number, out: { x: number; face: number }): boolean {
  const D = LIFE.dig;
  if (k < D.atFace) {
    out.x = site.faceX - site.dir * k * D.step;
    out.face = site.dir;
    return true;
  }
  out.x = site.faceX - site.dir * (D.atFace * D.step + 14 + (k - D.atFace) * 12);
  out.face = -site.dir;
  return false;
}
