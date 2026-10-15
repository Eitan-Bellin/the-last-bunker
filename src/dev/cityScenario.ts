/**
 * [world:C1] DEV ONLY. The vertical slice of "The City Below" as a real save (architecture section 6.1), built with the engine's own APIs:
 *
 *   ?city&slot=city-slice&scenario=slice       Act I, 3 floors, the stratum-1 hub, the living rooms restored, 8 survivors, the dark edge e:2:e
 *   ?city&slot=city-slice&scenario=slice-dig   the same, plus the floor-3 dig at 40 % with a crew of 2
 *
 * The scenario builds the state on a throw-away engine, writes it to the `?slot=` save (never the player's main slot: it refuses to run without
 * one), then reloads the page without `scenario` so the game boots from that save like any other (a real save -> load round trip).
 * Called from src/main.ts inside an `import.meta.env.DEV` block, before the GameApp exists.
 */
import { GameEngine } from '../core/GameEngine';
import { SaveManager, hasValidSlot } from '../core/SaveManager';
import { seedCity } from '../core/state/city';
import type { BuildingType, GameState } from '../core/GameState';

export type CityScenarioId = 'slice' | 'slice-dig';

/** The START_LAYOUT ruins the slice restores (they come back as the room they were), by floor:slot. */
const RESTORE: readonly string[] = ['0:6', '0:10', '1:0', '1:2', '2:0', '2:5'];
/** The ruins the slice keeps (collapsed 0:3, debris 1:5, flooded 2:2); every other ruin is cleared to an empty bay. */
const KEEP: readonly string[] = ['0:3', '1:5', '2:2'];
const SURVIVORS = 8;

type EngineInternals = {
  setupNewGame(): void;
  stateManager: GameEngine['stateManager'];
};

/** Builds the scenario state on a fresh engine (no tick, no save of its own) and returns it. */
export function buildSliceState(id: CityScenarioId): GameState {
  const e = new GameEngine();
  const x = e as unknown as EngineInternals;
  const sm = x.stateManager;
  x.setupNewGame();
  const S = (): Readonly<GameState> => sm.state;

  // The story is past the intro, the Act I tutorial is behind the player (no spotlights over the slice).
  sm.applyDeltas([
    { path: 'storyFlags', value: [...new Set([...S().storyFlags, 'intro:done', 'story:static', 'event:radioSignal', 'tip:drag', 'tip:pinch', 'tip:dbltap', 'tip:wing'])] },
    { path: 'achievements', value: [...new Set([...(S().achievements ?? []), 'firstSteps', 'allFloors', 'pop6'])] },
    { path: 'tutorialStep', value: 17 },
    { path: 'currentFloors', value: 3 },
  ]);

  // Ruins: restore six rooms where they lie (as RestorationSystem.complete does), keep three, clear the rest.
  for (const key of RESTORE) {
    const [f, s] = key.split(':').map(Number);
    const r = S().ruins.find(q => q.floor === f && q.x === s);
    if (!r?.restoresTo) continue;
    sm.applyDelta({ path: 'ruins', value: S().ruins.filter(q => q.id !== r.id) });
    const b = e.buildingSystem.placeBuilding(r.restoresTo as BuildingType, { x: r.x, y: 0, floor: r.floor }, sm);
    if (!b) continue;
    const i = S().buildings.findIndex(q => q.id === b.id);
    sm.applyDeltas([
      { path: `buildings.${i}.isConstructing`, value: false },
      { path: `buildings.${i}.constructionProgress`, value: b.constructionTotal },
    ]);
  }
  sm.applyDelta({ path: 'ruins', value: S().ruins.filter(q => KEEP.includes(`${q.floor}:${q.x}`)) });
  sm.applyDelta({ path: 'ruinsCleared', value: RESTORE.length });
  e.buildingSystem.recalculateMaxPopulation(sm);

  // Eight survivors (adults), each on a room so the slice shows people at work.
  const rng = (e as unknown as { rng: Parameters<GameEngine['populationSystem']['createSurvivor']>[0] }).rng;
  while (S().survivors.length < SURVIVORS) {
    const s = e.populationSystem.createSurvivor(rng);
    e.populationSystem.addSurvivor(sm, { ...s, child: false });
  }
  if (S().maxPopulation < SURVIVORS) sm.applyDelta({ path: 'maxPopulation', value: SURVIVORS });
  const order: BuildingType[] = ['generator', 'waterPump', 'farm', 'canteen', 'workshop', 'medbay', 'farm', 'generator'];
  S().survivors.forEach((s, k) => {
    const b = S().buildings.find(q => q.type === order[k % order.length] && !q.isConstructing);
    if (b) e.populationSystem.assignSurvivorToBuilding(sm, s.id, b.id);
  });

  // A comfortable stock: the slice is about the look, not a crisis.
  for (const [res, v] of Object.entries({ food: 120, water: 120, power: 80, materials: 160, scrap: 60 })) {
    if (S().resources[res as keyof GameState['resources']]) sm.applyDelta({ path: `resources.${res}.amount`, value: v });
  }

  if (id === 'slice-dig') {
    // The floor-3 dig at 40 % with two of the room crews on it (BuildingSystem.dig + DigSystem.assign: the engine's own path).
    e.buildingSystem.dig(sm);
    const total = S().longGame.dig.total;
    sm.applyDelta({ path: 'longGame.dig.progress', value: Math.round(total * 0.4) });
    const crew = S().survivors.filter(s => !s.child).slice(-2);
    for (const s of crew) e.digSystem.assign(s.id, 0);
  }

  // Save v8: everything revealed counts as seen (no "new" pins over the slice).
  sm.applyDelta({ path: 'city', value: seedCity(S() as GameState) });
  return sm.getSnapshot();
}

/**
 * Runs `?scenario=` when it names a city scenario: writes the slot save and reloads without the param. Returns true when the page is
 * reloading (the caller stops booting), false when there was nothing to do.
 */
export async function runCityScenario(search: string = location.search): Promise<boolean> {
  const q = new URLSearchParams(search);
  const id = q.get('scenario') as CityScenarioId | null;
  if (id !== 'slice' && id !== 'slice-dig') return false;
  // SaveManager's own test (dev build + /^[a-z0-9_-]{1,20}$/i): an invalid name would fall back to the main save key.
  if (!hasValidSlot()) {
    console.warn('[cityScenario] refused: a scenario needs a valid ?slot=<name> (letters, digits, _ or -, up to 20; it never writes the main save)');
    return false;
  }
  const state = buildSliceState(id);
  await new SaveManager().saveJson(JSON.stringify(state));
  q.delete('scenario');
  const rest = q.toString().replace(/=(&|$)/g, '$1');
  location.replace(`${location.pathname}?${rest}${location.hash}`);
  return true;
}
