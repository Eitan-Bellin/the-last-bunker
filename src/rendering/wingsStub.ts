// [plan4:ST-4] TEMPORARY STUB: remove this file when the Architect's src/data/wings.ts merges, and change the single re-export in ./wingsApi.ts to
// `export { wingOptions, type WingOption } from '../data/wings';`. The names and the shape are the agreed contract of that module.
//
// In a dev build the stub offers a 2-slot dig on both sides of every floor that has not reached the Act-I-style limits below, so the dig signs can be seen
// and tapped; in a production build it offers nothing (the signs stay hidden).
import type { GameState } from '../core/GameState';
import { floorExtent } from '../core/GameState';

export type WingOption = {
  floor: number;
  side: 'w' | 'e';
  steps: number;
  cost: Record<string, number>;
  seconds: number;
  block: null | 'act' | 'stability' | 'busy' | 'cost' | 'locked' | 'district';
};

export function wingOptions(state: GameState): WingOption[] {
  if (!import.meta.env.DEV) return [];
  const out: WingOption[] = [];
  for (let f = 0; f < state.currentFloors; f++) {
    const ext = floorExtent(state, f);
    if (ext.e < 22) out.push({ floor: f, side: 'e', steps: 2, cost: { materials: 120 + f * 10 }, seconds: 600, block: null });
    if (ext.w < 10) out.push({ floor: f, side: 'w', steps: 2, cost: { materials: 120 + f * 10 }, seconds: 600, block: null });
  }
  return out;
}
