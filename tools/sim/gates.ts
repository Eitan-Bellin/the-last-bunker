// P0 quality gates that need the engine itself (run by tools/sim/gates.mjs):
// offline identity (time away vs the same time played online) and performance budgets.
import { GameEngine } from '../../src/core/GameEngine';
import { migrateState, type GameState, type ResourceType } from '../../src/core/GameState';
import { TICKED_RESOURCES } from '../../src/data/resources';
import { installDeterminism } from './core';

function engineFrom(json: string, stockShare?: number): GameEngine {
  const e = new GameEngine();
  const state = migrateState(JSON.parse(json) as GameState);
  // Stocks well below the cap, so neither run spends the day full (a full store hides what was made).
  if (stockShare !== undefined) for (const r of TICKED_RESOURCES) state.resources[r].amount = Math.min(state.resources[r].amount, state.resources[r].cap * stockShare);
  // adoptState is private; the steps that matter here are the same ones init() runs.
  (e as unknown as { adoptState: (s: GameState) => void }).adoptState(state);
  return e;
}

/** Per tier-1 resource: what `seconds` of time away made versus the same span played online (no player, no events). */
export function offlineIdentity(json: string, seconds: number, economyOnly = false): { resource: ResourceType; online: number; offline: number; diff: number }[] {
  const det = installDeterminism(7);
  try {
    // Online without a player: events and story wait for answers that never come, so both runs see only the economy.
    const on = engineFrom(json, 0.3);
    on.resourceSystem.overflowLog = {};
    // Economy only: the systems that exist only online (events, incidents, story...) sit out, so both runs share one step list.
    if (economyOnly) for (const name of ['event', 'incident', 'achievements', 'objective', 'era', 'story']) on.register({ name });
    const totalOn: Partial<Record<ResourceType, number>> = {};
    // Made = change in stock + what overflowed into credits or a project (spending shows up as a smaller gain).
    const track = (e: GameEngine, into: Partial<Record<ResourceType, number>>, prev: Record<string, number>) => {
      for (const r of TICKED_RESOURCES) {
        const now = e.stateManager.state.resources[r].amount;
        into[r] = (into[r] ?? 0) + (now - prev[r]);
        prev[r] = now;
      }
    };
    const overflow = (e: GameEngine, into: Partial<Record<ResourceType, number>>) => {
      for (const [r, o] of Object.entries(e.resourceSystem.overflowLog) as [ResourceType, { converted: number; absorbed: number }][]) into[r] = (into[r] ?? 0) + o.converted + o.absorbed;
    };
    const snap = (e: GameEngine) => Object.fromEntries(TICKED_RESOURCES.map(r => [r, e.stateManager.state.resources[r].amount]));
    let prev = snap(on);
    for (let t = 0; t < seconds; t++) {
      on.advance(1, 'online');
      if (t % 60 === 59) track(on, totalOn, prev);
    }
    track(on, totalOn, prev);
    overflow(on, totalOn);

    const off = engineFrom(json, 0.3);
    const totalOff: Partial<Record<ResourceType, number>> = {};
    prev = snap(off);
    off.simulate(seconds, 1);
    track(off, totalOff, prev);
    overflow(off, totalOff);

    return TICKED_RESOURCES.map(r => {
      const a = totalOn[r] ?? 0;
      const b = totalOff[r] ?? 0;
      const scale = Math.max(1, Math.abs(a), Math.abs(b));
      return { resource: r, online: Math.round(a), offline: Math.round(b), diff: Math.abs(a - b) / scale };
    });
  } finally {
    det.restore();
  }
}

/** Milliseconds: an average online tick, a 24-hour catch-up, and one save serialization. */
export function perfBudgets(json: string): { tickMs: number; simulate24hMs: number; stringifyMs: number; saveKB: number } {
  const det = installDeterminism(9);
  try {
    const e = engineFrom(json);
    for (let i = 0; i < 200; i++) e.advance(0.1, 'online'); // warm-up
    const n = 3000;
    let t0 = performance.now();
    for (let i = 0; i < n; i++) e.advance(0.1, 'online');
    const tickMs = (performance.now() - t0) / n;
    t0 = performance.now();
    const s = JSON.stringify(e.stateManager.state);
    const stringifyMs = performance.now() - t0;
    t0 = performance.now();
    e.simulate(86_400, 0.8);
    const simulate24hMs = performance.now() - t0;
    return { tickMs, simulate24hMs, stringifyMs, saveKB: Math.round(s.length / 1024) };
  } finally {
    det.restore();
  }
}
