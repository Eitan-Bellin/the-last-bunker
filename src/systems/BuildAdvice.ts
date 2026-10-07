import type { BuildingType, GameState, ResourceType } from '../core/GameState';

/**
 * [plan4:BL-39] "Recommended now" for the build menu: a few rooms that answer what is short right now, in plain priority order
 * (power, water, food, beds, mood). A pure reading of the state, like the Guide: nothing here changes the game. The menu passes
 * `canBuild` (unlocked, under its copy limit, a free spot) so only rooms the player could really place are suggested.
 */
export interface BuildTip {
  type: BuildingType;
  /** i18n key of the reason ("build.rec.power"). */
  why: string;
}

const net = (state: GameState, r: ResourceType): number => (state.resources[r]?.productionRate ?? 0) - (state.resources[r]?.consumptionRate ?? 0);

export function recommendedRooms(state: GameState, canBuild: (type: BuildingType) => boolean, max = 3): BuildTip[] {
  const out: BuildTip[] = [];
  const add = (why: string, types: BuildingType[]) => {
    for (const type of types) {
      if (out.length >= max) return;
      if (out.some(t => t.type === type) || !canBuild(type)) continue;
      out.push({ type, why });
    }
  };
  if ((state.powerRatio ?? 1) < 0.99 || net(state, 'power') < 0.5) add('build.rec.power', ['generator', 'reactor']);
  const p = state.resources.power;
  if (p && p.cap > 0 && p.amount < p.cap * 0.25 && net(state, 'power') >= 0.5) add('build.rec.battery', ['batteryBank']);
  if (net(state, 'water') < 0.2) add('build.rec.water', ['waterPump', 'condenser', 'waterPurifier']);
  if (net(state, 'food') < 0.2) add('build.rec.food', ['farm', 'hydroponics', 'mushroomFarm']);
  if (state.survivors.length >= state.maxPopulation - 1) add('build.rec.beds', ['quarters', 'barracks']);
  if (state.survivors.length >= 4) {
    const mood = state.survivors.reduce((s, x) => s + x.happiness, 0) / state.survivors.length;
    if (mood < 55) add('build.rec.morale', ['commons', 'canteen']);
  }
  return out;
}
