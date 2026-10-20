// [phase5] Run-2 harness (Agent G): a Genesis on a stage save, the Genesis choices a player makes (class, shop, ending perk),
// then the engaged bot plays the new timeline for a few days. Bundled by tools/sim/genesis-run2.mjs (also against a frozen src).
import { GameEngine } from '../../src/core/GameEngine';
import type { GameState } from '../../src/core/GameState';
import { PRESTIGE_UPGRADES, upgradeCost } from '../../src/data/prestige';
import { modifierBreakdown, modifierProduct, prepareModifiers } from '../../src/systems/modifiers';
import { ACT_CURRENCY } from '../../src/data/pricing';
import { installDeterminism, runSim, type SimMode } from './core';

export interface Run2Plan {
  /** Founding keystone ("class") to pick first; none = no class. */
  cls?: string;
  /** Spend the rest of the Isotope-7 in the shop (a fixed, sensible order). */
  shop?: boolean;
  mutators?: string[];
  scenario?: string;
}

/** The order a sensible player fills the shop in (one level of each per pass, while it can pay). */
const SHOP_ORDER = ['actLedger', 'echoPower', 'lootLuck', 'fastResearch', 'labBench', 'storageMemory', 'quickStart', 'preDug', 'veteranSurvivors', 'hardyStock', 'scoutTeams', 'offlineEfficiency'];

type Loose = Record<string, unknown>;
const fn = (o: unknown, k: string) => { const v = (o as Loose | null)?.[k]; return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(o) : null; };

/** Product of every output modifier (under the ceiling) on the rooms that make the current Act's currency, and the raw one. */
function actCurrencyStack(state: GameState): { rooms: number; capped: number; ceilingHit: number; mods: Record<string, number> } {
  prepareModifiers(state);
  const act = Math.max(1, state.longGame?.meta.act ?? 1);
  const cur = ACT_CURRENCY[Math.min(ACT_CURRENCY.length - 1, act)];
  let n = 0; let sum = 0; let hit = 0;
  const mods: Record<string, number> = {};
  for (const b of state.buildings) {
    const p = modifierProduct({ state, building: b, resource: cur, powerRatio: 1 });
    n++; sum += p; if (p >= 3.999) hit++;
    for (const m of modifierBreakdown({ state, building: b, resource: cur, powerRatio: 1 })) mods[m.id] = (mods[m.id] ?? 0) + m.mult;
  }
  for (const k of Object.keys(mods)) mods[k] = +(mods[k] / Math.max(1, n)).toFixed(2);
  return { rooms: n, capped: n ? +(sum / n).toFixed(2) : 0, ceilingHit: hit, mods };
}

/** Loads the save like the app does, makes the Genesis and the player's choices, and returns the new timeline as save JSON. */
export async function genesisFrom(saveJson: string, plan: Run2Plan): Promise<{ json: string; info: Record<string, unknown> }> {
  const det = installDeterminism(1);
  try {
    const e = new GameEngine();
    let stored = JSON.stringify({ ...JSON.parse(saveJson), timestamp: Date.now() });
    (e as unknown as { saveManager: unknown }).saveManager = {
      loadSafe: async () => ({ status: 'ok', state: JSON.parse(stored) }),
      saveJson: async (j: string) => { stored = j; },
      snapshotPrev: async () => true,
    };
    await e.init();
    const s0 = e.stateManager.state;
    const info: Record<string, unknown> = {
      act: s0.longGame?.meta.act, canRebirth: e.metaSystem.canRebirth(s0), gain: e.metaSystem.rebirthGain(s0),
      ending: s0.storyFlags.find(f => f.startsWith('ending:')), d70Stack: actCurrencyStack(s0),
    };
    await e.rebirth();
    const sm = e.stateManager;
    const bought: string[] = [];
    if (plan.cls) {
      const choose = fn(e, 'chooseClass') ?? null;
      const metaChoose = fn(e.metaSystem, 'chooseClass');
      let ok = false;
      if (choose) ok = !!choose(plan.cls);
      else if (metaChoose) {
        // What the lead's GameEngine.chooseClass does: the Founders bring their two people.
        ok = !!metaChoose(plan.cls);
        if (ok && plan.cls === 'ksFounders') for (let i = 0; i < 2; i++) e.populationSystem.addSurvivor(sm, e.populationSystem.createSurvivor(e.rng));
      } else {
        ok = e.metaSystem.buy(plan.cls);
        // On the old code the Founders' people only come at a new game's setup: add them as the old start would have (fair compare).
        if (ok && plan.cls === 'ksFounders') for (let i = 0; i < 2; i++) e.populationSystem.addSurvivor(sm, e.populationSystem.createSurvivor(e.rng));
      }
      if (ok) bought.push(plan.cls);
    }
    if (plan.shop) {
      let any = true;
      while (any) {
        any = false;
        for (const id of SHOP_ORDER) {
          const def = PRESTIGE_UPGRADES.find(u => u.id === id);
          if (!def) continue;
          if (e.metaSystem.isotope(sm.state) >= upgradeCost(def, e.metaSystem.upgradeLevel(sm.state, id)) && e.metaSystem.buy(id)) { bought.push(id); any = true; }
        }
      }
    }
    if (plan.scenario) e.setScenario(plan.scenario);
    if (plan.mutators) e.setMutators(plan.mutators);
    const s = sm.state;
    info.bought = Object.entries(bought.reduce<Record<string, number>>((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {})).map(([k, v]) => `${k}x${v}`).join(' ');
    info.isoLeft = Math.floor(s.resources.isotope7.amount);
    info.start = { pop: s.survivors.length, floors: s.currentFloors, materials: Math.round(s.resources.materials.amount), scrap: Math.round(s.resources.scrap.amount), knowledge: Math.round(s.resources.knowledge.amount), food: Math.round(s.resources.food.amount) };
    info.perk = (fn(e.metaSystem, 'endingPerkOf')?.(s) as { perk: { name: { en: string } } } | undefined)?.perk.name.en ?? null;
    return { json: JSON.stringify(s), info };
  } finally {
    det.restore();
  }
}

/** Plays `days` with the bot from the state in `json` (or from a brand-new game when json is null = run 1). */
export async function playFrom(json: string | null, seed: number, days: number, mode: SimMode = 'engaged') {
  const proto = GameEngine.prototype as unknown as { setupNewGame: () => void; adoptState: (s: GameState) => void };
  const orig = proto.setupNewGame;
  let pending = json;
  proto.setupNewGame = function (this: typeof proto) {
    if (pending) {
      const st = JSON.parse(pending) as GameState;
      pending = null;
      st.timestamp = Date.now();
      st.storyFlags = [...new Set([...st.storyFlags, 'intro:done', 'difficulty:chosen'])];
      this.adoptState(st);
      return;
    }
    orig.call(this);
  };
  try {
    const r = await runSim({ mode, seed, days, dumpSave: true });
    const fin = JSON.parse((r as unknown as { finalSave: string }).finalSave) as GameState;
    const ms = (r.timeline2 && Object.keys(r.timeline2).length ? r.timeline2 : r.milestones);
    const acts = Object.entries(ms).filter(([k]) => /^act \d$/.test(k)).map(([k, v]) => `${k.slice(4)}@${(v.wall / 3600).toFixed(1)}h`).join(' ');
    const act = fin.longGame?.meta.act ?? 0;
    const cur = ACT_CURRENCY[Math.min(ACT_CURRENCY.length - 1, act)];
    return {
      seed, act, acts, pop: fin.survivors.length, floors: fin.currentFloors, rooms: fin.buildings.length,
      levels: fin.buildings.reduce((a, b) => a + b.level, 0), research: Object.values(fin.research).filter(x => x.completed).length,
      actCurrency: `${cur} ${Math.round(fin.resources[cur].amount)}`, deaths: r.deaths.total, stack: actCurrencyStack(fin),
      warnings: (r as unknown as { warnings?: string[] }).warnings?.slice(0, 3),
    };
  } finally {
    proto.setupNewGame = orig;
  }
}
