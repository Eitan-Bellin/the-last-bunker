/**
 * [world:C0] Save v8: the discovery slice of "The City Below" (architecture 1.5, D6, D7).
 *
 * Presentation-only state; the economy never reads it. Discovery is DERIVED from logic: a dug floor, a dug gallery, a built district and a
 * reached stratum are revealed by definition (`revealedAreaIds`), so an old save comes up fully discovered and there is one source of truth.
 * The save only holds what logic cannot know:
 *  seen   area ids the player has acknowledged (an area revealed but not seen shows a "new" pin), sorted and unique
 *  found  cosmetic pockets found by a tap (data/strata.ts PocketDef ids), sorted and unique
 *
 * Area ids: `surface`, `s:<stratum>`, `f:<floor>`, `g:<gallery>`, `e:<floor>:<w|e>` (an edge site: never "revealed", it moves out as wings are
 * dug), `d:<district kind>`, `p:<stratum>:<name>`.
 * Pure and Node-safe (the sim, the lint and the migration tests import it).
 */
import type { GameState } from '../GameState';
import { isDistrict } from '../../data/buildingDefs';
import { GALLERY_ABOVE_FLOORS } from '../../data/zones';
import { pocketById, strataReached } from '../../data/strata';

export interface CityState {
  v: 1;
  seen: string[];
  found: string[];
}

export function createCity(): CityState {
  return { v: 1, seen: [], found: [] };
}

/** Sorted, unique copy of a list of ids (strings only). */
export function sortedIds(list: readonly unknown[]): string[] {
  return [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0))].sort();
}

type CitySource = Pick<GameState, 'currentFloors' | 'buildings'> & { city?: CityState };

/** Every area logic says is revealed: the surface, each stratum reached, each dug floor and gallery, each built district, each found pocket. Sorted. */
export function revealedAreaIds(state: CitySource): string[] {
  const out: string[] = ['surface'];
  const floors = Math.max(0, Math.floor(state.currentFloors ?? 0));
  for (const s of strataReached(floors)) out.push(`s:${s}`);
  for (let f = 0; f < floors; f++) out.push(`f:${f}`);
  GALLERY_ABOVE_FLOORS.forEach((above, i) => { if (above < floors) out.push(`g:${i}`); });
  for (const b of state.buildings ?? []) if (isDistrict(b.type) && !b.isConstructing) out.push(`d:${b.type}`);
  for (const id of state.city?.found ?? []) if (pocketById(id)) out.push(id);
  return sortedIds(out);
}

/** The slice an older save (or one without `city`) starts with: everything already revealed counts as seen (no "new" pins on first load), nothing found. */
export function seedCity(state: CitySource): CityState {
  return { v: 1, seen: sortedIds([...revealedAreaIds({ ...state, city: undefined }), 'surface', 's:0', 's:1']), found: [] };
}

/** A well-formed slice from whatever the save holds (pure). Ids are kept even when this build does not know them (a newer build's pockets survive a round trip). */
export function normalizeCity(c: unknown): CityState {
  const o = (c && typeof c === 'object' ? c : {}) as Partial<Record<keyof CityState, unknown>>;
  const seen = Array.isArray(o.seen) ? sortedIds(o.seen) : [];
  const found = Array.isArray(o.found) ? sortedIds(o.found).filter(id => id.startsWith('p:')) : [];
  return { v: 1, seen, found };
}
