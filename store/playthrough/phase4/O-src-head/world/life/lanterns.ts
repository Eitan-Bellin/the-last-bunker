/**
 * [world:C1-Li] Carried light (style guide 7): a few walkers carry a lantern (8% in the upper strata, 35% in the deep ones), miners and
 * the dig crew wear headlamps, and somebody standing in the dark gets a faint light of their own. Every one of them is a real moving
 * pool in the city's lightmap.
 *
 * The lightmap belongs to the CityRenderer, which the renderer (BunkerRenderer) owns, so this module only holds a seam: the renderer hands
 * it a light sink once the city is mounted (`setLightSink`, see store/world-redesign/C1-Li-notes.md for the exact lines). Without a sink
 * (classic mode, lite, before the mount) nobody carries a lit lantern and every call here is a cheap no-op.
 *
 * Budget: lights are added and removed only when a walk starts or ends (never per frame); `move` is a field write in the lighting.
 * Caps per render tier come from LIFE.lantern.max / LIFE.selfLight.max.
 */
import { LIFE, PEOPLE } from '../tokens';
import type { LightInput } from '../render/lighting';
import { roll01 } from './idleSpots';

/** What the city lighting offers the people (CityRenderer.addLight / removeLight / moveLight and CityHost.lightAt). */
export interface LightSink {
  add(l: LightInput): number;
  remove(id: number): void;
  move(id: number, x: number, y: number): void;
  /** Light from the pools at a world point (CityHost.lightAt: PEOPLE.minLight at least); used for self-light and the rim side. */
  lightAt?(x: number, y: number): number;
}

export type LifeTier = 'high' | 'medium' | 'low' | 'lite';

/** 0 nothing, 1 a lantern in the hand, 2 a headlamp. */
export type CarryKind = 0 | 1 | 2;
export const CARRY_NONE = 0;
export const CARRY_LANTERN = 1;
export const CARRY_HEADLAMP = 2;

let sink: LightSink | null = null;
/** Bumped whenever the sink changes: light ids handed out under an older sink are dead and must not be removed or moved. */
let gen = 1;
let tier: LifeTier = 'high';
let carried = 0;
let selfLit = 0;

/** The renderer's seam: the city's lights (null in classic mode or when the city is torn down). */
export function setLightSink(s: LightSink | null): void {
  if (s === sink) return;
  sink = s;
  gen++;
  carried = 0;
  selfLit = 0;
}

export function lightSink(): LightSink | null {
  return sink;
}

/** The generation the current light ids belong to. */
export function lightGen(): number {
  return gen;
}

/** The render tier (caps): set by the life pass once a picture. */
export function setLifeTier(t: LifeTier): void {
  tier = t;
}

export function lifeTier(): LifeTier {
  return tier;
}

/** Pools-only light at a world point (PEOPLE.minLight without a sink: "bright enough", nothing to fix). */
export function lightAt(x: number, y: number): number {
  return sink?.lightAt ? sink.lightAt(x, y) : 1;
}

/**
 * Does this person carry a light in this stratum? Deterministic per person (id hash `h`): PEOPLE.lanternShareUpper of the walkers in
 * the upper strata, PEOPLE.lanternShareDeep from LIFE.lantern.deepFrom down, and in the headlamp strata (the mines) it is a headlamp.
 */
export function carryFor(h: number, stratum: number): CarryKind {
  if (stratum <= 0) return CARRY_NONE;
  const deep = stratum >= LIFE.lantern.deepFrom;
  const share = deep ? PEOPLE.lanternShareDeep : PEOPLE.lanternShareUpper;
  if (roll01(h, 7) >= share) return CARRY_NONE;
  return (PEOPLE.headlampStrata as readonly number[]).includes(stratum) ? CARRY_HEADLAMP : CARRY_LANTERN;
}

/** Adds a carried light (lantern or headlamp) at x, y; -1 when there is no sink or the tier's cap is reached. */
export function addCarried(kind: CarryKind, x: number, y: number): number {
  if (!sink || kind === CARRY_NONE || carried >= LIFE.lantern.max[tier]) return -1;
  carried++;
  return sink.add({ x, y, preset: kind === CARRY_HEADLAMP ? 'headlamp' : 'lantern', kind: 'carried', dynamic: true });
}

/** Adds a faint self-light (a person standing in the dark); -1 when capped or there is no sink. */
export function addSelfLight(x: number, y: number): number {
  const S = LIFE.selfLight;
  if (!sink || selfLit >= S.max[tier]) return -1;
  selfLit++;
  return sink.add({ x, y, preset: 'lantern', color: S.color, radius: S.radius, intensity: S.intensity, flicker: 'steady', halo: 0, cone: 0, kind: 'carried', dynamic: true });
}

/** Moves a light added under generation `g` (no-op when the sink changed since). */
export function moveLight(id: number, g: number, x: number, y: number): void {
  if (id >= 0 && g === gen && sink) sink.move(id, x, y);
}

/** Removes a carried light (`self` = it was a self-light) added under generation `g`. */
export function removeLight(id: number, g: number, self: boolean): void {
  if (id < 0 || g !== gen || !sink) return;
  sink.remove(id);
  if (self) selfLit = Math.max(0, selfLit - 1);
  else carried = Math.max(0, carried - 1);
}

/** Counters for the dev probe. */
export function lanternStats(): { carried: number; self: number; tier: LifeTier; sink: boolean } {
  return { carried, self: selfLit, tier, sink: !!sink };
}
