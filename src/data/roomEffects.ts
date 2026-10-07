import type { BuildingInstance, GameState } from '../core/GameState';
import { effectiveLevel, entryAt, getDef, type BuildingEffects, type ProductionEntry } from './buildingDefs';
import { incidentBlocks } from './incidents';
import { infraOfKind, infraSpan } from '../systems/doors'; // [plan4:ST-15]

/**
 * [plan4:BL-8] Readers for the room effects of the redesign (BuildingDef.effects). Each one has an identity default:
 * with no room that has the effect they return 1 (a multiplier), 0 (an amount) or false, so the game plays exactly as it did
 * before the rooms existed. The systems call these at the one place the effect applies; the numbers come from buildings.json.
 */

/** The effects that are a `{ base, perLevel }` entry. */
type EntryEffect = 'childCapacity' | 'childGrowth' | 'quarantine' | 'earlyWarning' | 'cargo' | 'returnSafety' | 'hygiene' | 'mourning' | 'ventilation';

/** Rooms that do their job right now: finished (or upgrading at their old level) and not stopped by an incident. */
function active(state: GameState, b: BuildingInstance): boolean {
  return effectiveLevel(b) > 0 && !incidentBlocks(state, b);
}

/** One room's value of an entry effect at its level (0 when its type does not have it). */
export function roomEffect(b: BuildingInstance, key: EntryEffect): number {
  const e = getDef(b.type)?.effects?.[key] as ProductionEntry | undefined;
  return e ? entryAt(e, effectiveLevel(b)) : 0;
}

/** Sum of an entry effect over every working room (0 when none). */
export function effectSum(state: GameState, key: EntryEffect): number {
  let sum = 0;
  for (const b of state.buildings) {
    if (!getDef(b.type)?.effects?.[key] || !active(state, b)) continue;
    sum += roomEffect(b, key);
  }
  return sum;
}

/** Largest value of an entry effect among the working rooms (0 when none). */
export function effectMax(state: GameState, key: EntryEffect): number {
  let m = 0;
  for (const b of state.buildings) {
    if (!getDef(b.type)?.effects?.[key] || !active(state, b)) continue;
    m = Math.max(m, roomEffect(b, key));
  }
  return m;
}

/** Whether any working room has a flag effect (evacuation, firebreak). */
function anyFlag(state: GameState, key: 'evacuation' | 'firebreak', test?: (b: BuildingInstance) => boolean): boolean {
  for (const b of state.buildings) {
    if (!(getDef(b.type)?.effects as BuildingEffects | undefined)?.[key] || !active(state, b)) continue;
    if (!test || test(b)) return true;
  }
  return false;
}

// ---- readers, one per effect ----

/** Seconds added to the raid warning by lookouts (EventSystem.startRaid). 0 without a watchtower. Capped at 300. */
export function earlyWarningLead(state: GameState): number {
  return Math.min(300, effectSum(state, 'earlyWarning'));
}

/** Expedition teams the bunker can have out beyond the base two (ExplorationSystem.maxTeams): +1 per threshold level reached. */
export function expeditionTeamsBonus(state: GameState): number {
  let n = 0;
  for (const b of state.buildings) {
    const thresholds = getDef(b.type)?.effects?.expeditionTeams;
    if (!thresholds || !active(state, b)) continue;
    const level = effectiveLevel(b);
    for (const at of thresholds) if (level >= at) n++;
  }
  return n;
}

/** Multiplier on what a caravan brings home (ExplorationSystem.completeCaravan): garage and market. 1 without them. */
export function cargoMult(state: GameState): number {
  return 1 + Math.min(0.8, effectSum(state, 'cargo'));
}

/** Multiplier on injury odds when a team or caravan comes home (ExplorationSystem): the decontamination chamber. 1 without it. */
export function returnSafetyMult(state: GameState): number {
  return 1 - Math.min(0.5, effectSum(state, 'returnSafety'));
}

/** Multiplier on the weight of epidemics and roach swarms (IncidentSystem): bathhouses. 1 without them. */
export function hygieneMult(state: GameState): number {
  return 1 - Math.min(0.5, effectSum(state, 'hygiene'));
}

/** Multiplier on the mourning penalty after a death (DeathSystem.griefFor): the memorial hall. 1 without it. */
export function mourningMult(state: GameState): number {
  return 1 - Math.min(0.6, effectSum(state, 'mourning'));
}

/** Sick residents the quarantine wards can hold apart (IncidentSystem epidemic). 0 without one. */
export function quarantineCapacity(state: GameState): number {
  return Math.floor(effectSum(state, 'quarantine'));
}

/** Points of the crowding penalty that ventilation takes away (PopulationSystem). 0 without a vent stack. */
export function ventilationRelief(state: GameState): number {
  // [plan4:ST-15] Vent stacks (layout.infra): 2 points each, at most three stacks count (max 6). Rooms with a ventilation effect add theirs.
  const stacks = Math.min(3, infraOfKind(state, 'ventStack').length);
  return Math.round(effectSum(state, 'ventilation')) + 2 * stacks;
}

/** Multiplier on injuries from fire and collapse on a floor (IncidentSystem): an emergency stairwell within 3 floors. 1 without one. */
export function evacuationMult(state: GameState, floor: number): number {
  // [plan4:ST-15] An emergency stairwell (layout.infra column) within three floors of the fire or collapse.
  const stairs = infraOfKind(state, 'stairwell').some(i => {
    const s = infraSpan(i);
    return (floor < s.top ? s.top - floor : floor > s.bottom ? floor - s.bottom : 0) <= 3;
  });
  return stairs || anyFlag(state, 'evacuation', b => Math.abs(b.position.floor - floor) <= 3) ? 0.6 : 1;
}

/**
 * [plan4:ST-15] The fire code: from floor index 8 (B9) down, a floor with no stairwell on it or next to it is a trap, and people hurt in a
 * fire or a collapse there take x1.5. Combine with evacuationMult (a stairwell three floors away still shortens the way, a little).
 */
export function fireCodeMult(state: GameState, floor: number): number {
  if (floor < 8) return 1;
  const covered = infraOfKind(state, 'stairwell').some(i => {
    const s = infraSpan(i);
    return floor >= s.top - 1 && floor <= s.bottom + 1;
  });
  return covered ? 1 : 1.5;
}

/** A room that fire neither enters nor leaves (a bulkhead-walled or fire-doored room). */
export function isFirebreak(b: BuildingInstance): boolean {
  return !!getDef(b.type)?.effects?.firebreak;
}

/** Any working room that stops fire (for tools and the room panel). */
export function hasFirebreak(state: GameState): boolean {
  return anyFlag(state, 'firebreak');
}

// ---- children (BL-4) ----

/** Children one room can hold: 0 for rooms without childCapacity (so nobody can be assigned a child there). */
export function childCapacityOf(b: BuildingInstance): number {
  return Math.floor(roomEffect(b, 'childCapacity'));
}

/** Growing-up speed from the rooms: the best nursery's multiplier (1 without one); FamilySystem takes the larger of this and the quarters spec. */
export function roomChildGrowth(state: GameState): number {
  return Math.max(1, effectMax(state, 'childGrowth'));
}

/** Stat points a school-type room gives a graduate (0 for rooms without graduateStat). */
export function graduateStatOf(b: BuildingInstance): number {
  return getDef(b.type)?.effects?.graduateStat ?? 0;
}
