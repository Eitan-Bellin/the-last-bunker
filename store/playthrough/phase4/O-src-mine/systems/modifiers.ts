import type { BuildingInstance, GameState, ResourceType } from '../core/GameState';
import { TUNING } from '../data/tuning';

/**
 * Output modifiers: everything that scales a room's output beyond the room itself (its level, crew, chain and
 * specialization). Systems add theirs with registerModifier() instead of editing the production formula, so the
 * stack can be shown to the player ("why is this low?") and held under one ceiling (TUNING.multiplierCeiling).
 */
export interface ModifierContext {
  state: GameState;
  building: BuildingInstance;
  resource: ResourceType;
  /** 0.25..1: how well the grid feeds the rooms right now. */
  powerRatio: number;
}

export interface OutputModifier {
  /** Stable id; the UI label is the i18n key `mod.<id>`. */
  id: string;
  /** Called once per production update before any mult(): anything costly that does not depend on the room. */
  prepare?(state: GameState): void;
  /** The multiplier for this room and resource (1 = no effect). */
  mult(ctx: ModifierContext): number;
}

const modifiers: OutputModifier[] = [];

/** Adds a modifier (or replaces the one with the same id, keeping its place). */
export function registerModifier(m: OutputModifier): void {
  const at = modifiers.findIndex(x => x.id === m.id);
  if (at >= 0) modifiers[at] = m;
  else modifiers.push(m);
}

export function prepareModifiers(state: GameState): void {
  for (const m of modifiers) m.prepare?.(state);
}

/** The product of every modifier for this room and resource, held under the central ceiling. */
export function modifierProduct(ctx: ModifierContext): number {
  let p = 1;
  for (const m of modifiers) p *= m.mult(ctx);
  return Math.min(p, TUNING.multiplierCeiling);
}

/** Each modifier's share, for the "why" panel (call prepareModifiers first). Ones at exactly 1 are left out. */
export function modifierBreakdown(ctx: ModifierContext): { id: string; mult: number }[] {
  return modifiers.map(m => ({ id: m.id, mult: m.mult(ctx) })).filter(x => Math.abs(x.mult - 1) > 1e-6);
}
