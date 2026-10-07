// Save-migration check: loads an older save the way the game does (migrateState + a real GameEngine start) and reports
// anything the migration lost or broke. Used by tools/sim/migrate-test.mjs on the sample saves in store/sim/saves-v4/.
import { GameEngine } from '../../src/core/GameEngine';
import { SAVE_VERSION, migrateState, type GameState, type ResourceType } from '../../src/core/GameState';
import { installDeterminism } from './core';

export interface MigrateCheck {
  from: number;
  to: number;
  act: number | null;
  legacy: boolean | null;
  problems: string[];
  /** A short picture of the game after migration and a simulated hour. */
  after: { era: number; buildings: number; people: number; floors: number; playTime: number };
}

/** Old format in, problems out. `json` is the save as the game stores it (uncompressed JSON). */
export async function checkMigration(json: string): Promise<MigrateCheck> {
  const det = installDeterminism(1);
  const problems: string[] = [];
  try {
    const old = JSON.parse(json) as GameState;
    const from = old.version ?? 1;
    const m = migrateState(JSON.parse(json) as GameState);

    if (m.version !== SAVE_VERSION) problems.push(`version ${m.version}, expected ${SAVE_VERSION}`);
    if (!m.longGame?.meta) problems.push('no longGame slice');
    // Nothing the player has may be taken away.
    if (m.buildings.length !== old.buildings.length) problems.push(`buildings ${old.buildings.length} -> ${m.buildings.length}`);
    if (m.survivors.length !== old.survivors.length) problems.push(`survivors ${old.survivors.length} -> ${m.survivors.length}`);
    for (const [k, v] of Object.entries(old.resources ?? {}) as [ResourceType, { amount: number }][]) {
      const now = m.resources[k]?.amount;
      if (now === undefined || now < v.amount - 1e-6) problems.push(`resource ${k} ${v.amount} -> ${now}`);
    }
    for (const id of Object.keys(old.research ?? {})) if (!(id in m.research)) problems.push(`research ${id} lost`);
    for (const f of old.storyFlags ?? []) if (!m.storyFlags.includes(f)) problems.push(`flag ${f} lost`);
    if ((m.currentFloors ?? 0) < (old.currentFloors ?? 0)) problems.push(`floors ${old.currentFloors} -> ${m.currentFloors}`);
    if ((m.prestige?.rebirthCount ?? 0) !== (old.prestige?.rebirthCount ?? 0)) problems.push('rebirth count changed');
    // Only for saves from before the Acts existed (no longGame slice): those were placed in Act 4. A v5+ save keeps the Act it was in. [plan4:QA-1]
    if (m.longGame && !old.longGame && (old.era ?? 0) >= 3 && m.longGame.meta.act !== 4) problems.push(`era 3 save placed in Act ${m.longGame.meta.act}`);

    // Then start it like the app does (adoptState through init, an hour of time away) and play ten minutes.
    const e = new GameEngine();
    let stored: string | null = JSON.stringify({ ...old, timestamp: Date.now() - 3_600_000 });
    (e as unknown as { saveManager: unknown }).saveManager = {
      loadSafe: async () => ({ status: 'ok', state: JSON.parse(stored!) }),
      saveJson: async (j: string) => { stored = j; },
      snapshotPrev: async () => true,
    };
    const crashes: string[] = [];
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    ls?.removeItem('lastbunker_crashlog');
    await e.init();
    for (let i = 0; i < 600; i++) e.advance(1, 'online');
    const log = ls?.getItem('lastbunker_crashlog');
    if (log && log !== '[]') crashes.push(log.slice(0, 300));
    if (crashes.length) problems.push(`systems threw: ${crashes.join(' | ')}`);
    const s = e.stateManager.state;
    if (s.survivors.length === 0 && old.survivors.length > 0) problems.push('everyone gone after an hour');
    return {
      from, to: m.version, act: m.longGame?.meta.act ?? null, legacy: m.longGame?.meta.legacy ?? null, problems,
      after: { era: s.era, buildings: s.buildings.length, people: s.survivors.length, floors: s.currentFloors, playTime: Math.round(s.stats.totalPlayTime) },
    };
  } finally {
    det.restore();
  }
}
