// Save-migration check: loads an older save the way the game does (migrateState + a real GameEngine start) and reports
// anything the migration lost or broke. Used by tools/sim/migrate-test.mjs on the sample saves in store/sim/saves-v4/.
import { GameEngine } from '../../src/core/GameEngine';
import { SAVE_VERSION, createInitialState, createLayout, migrateState, type GameState, type ResourceType } from '../../src/core/GameState';
import { PROJECTS } from '../../src/data/projects';
import { RESERVE } from '../../src/systems/ProjectSystem';
import { revealedAreaIds } from '../../src/core/state/city';
import { installDeterminism } from './core';

export interface MigrateCheck {
  from: number;
  to: number;
  act: number | null;
  legacy: boolean | null;
  problems: string[];
  /** A short picture of the game after migration and a simulated hour. */
  after: { era: number; act: number | null; buildings: number; people: number; floors: number; playTime: number };
}

/** Stable JSON (object keys sorted) for byte-level comparisons that do not depend on key order. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/**
 * [world:C0] v8: the city slice is well-formed and seeded from the bunker (everything revealed is seen, nothing found), the layout and every
 * room / ruin position are byte-identical, the migration is idempotent, `found` survives a round trip and `whatsnew:v8` is owed exactly once.
 */
function cityMigrationProblems(old: GameState, m: GameState, from: number): string[] {
  const p: string[] = [];
  const c = m.city;
  const sortedUnique = (a: unknown) => Array.isArray(a) && a.every(x => typeof x === 'string') && a.every((x, i) => i === 0 || a[i - 1] < x);
  if (!c || c.v !== 1 || !sortedUnique(c.seen) || !sortedUnique(c.found)) return ['city: slice missing or malformed (v 1, sorted unique seen / found)'];
  if (!old.city) {
    const seen = new Set(c.seen);
    const missing = revealedAreaIds(m).filter(id => !seen.has(id));
    if (missing.length) p.push(`city: revealed but not seen after seeding: ${missing.slice(0, 6).join(', ')}`);
    for (const id of ['surface', 's:0', 's:1']) if (!seen.has(id)) p.push(`city: seen lacks ${id}`);
    for (let f = 0; f < m.currentFloors; f++) if (!seen.has(`f:${f}`)) { p.push(`city: seen lacks f:${f}`); break; }
    if (c.found.length) p.push(`city: found is not empty after seeding (${c.found.join(', ')})`);
  }
  // Positions are never rewritten: the layout (v 1) and every room and ruin stand where they stood.
  const wantLayout = { ...createLayout(), ...(old.layout ?? {}), v: 1 };
  if (canon(m.layout) !== canon(wantLayout)) p.push('city: layout changed by the migration');
  const pos = (s: GameState) => canon([...s.buildings.map(b => [b.id, b.type, b.position]), ...(s.ruins ?? []).map(r => [r.id, r.floor, r.x, r.w])]);
  if (old.version >= 4 && pos(m) !== pos(old)) p.push('city: a room or ruin position changed');
  // Idempotent: migrating the migrated game changes nothing.
  const again = migrateState(JSON.parse(JSON.stringify(m)) as GameState);
  if (canon(again.city) !== canon(m.city) || canon(again.layout) !== canon(m.layout) || canon(again.storyFlags) !== canon(m.storyFlags)) p.push('city: migrating twice is not idempotent (city / layout / flags)');
  // A found pocket survives a save round trip.
  const withFound = JSON.parse(JSON.stringify(m)) as GameState;
  withFound.city = { ...withFound.city, found: ['p:1:wellRoom'] };
  const rt = migrateState(JSON.parse(JSON.stringify(withFound)) as GameState);
  if (!rt.city.found.includes('p:1:wellRoom')) p.push('city: a found pocket is lost on a round trip');
  // The "what's new" card for v8 is owed once to a save from before v8 (and never twice).
  const owed = m.storyFlags.filter(f => f === 'whatsnew:v8').length;
  if (from < 8 && owed !== 1) p.push(`city: whatsnew:v8 flagged ${owed} times, expected once`);
  if (again.storyFlags.filter(f => f === 'whatsnew:v8').length !== owed) p.push('city: whatsnew:v8 added again on a second migration');
  return p;
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
    // [plan4:ST-3] The second dig slot exists, and a dig without `kind` is a floor dig (older saves).
    if (m.longGame && (!m.longGame.dig2 || m.longGame.dig2.floor !== null || (m.longGame.dig.kind ?? 'floor') !== 'floor')) problems.push('dig2 / dig.kind not defaulted');
    // [plan4:X-3] v7: an older save gets the empty layout (no wings, doors, infrastructure; surface row closed).
    if (!old.layout && (!m.layout || m.layout.v !== 1 || Object.keys(m.layout.ext).length || Object.keys(m.layout.doors).length || m.layout.infra.length || m.layout.surfaceOpen)) problems.push('layout not defaulted');
    // [plan4:GP-1] The daily orders block exists after migration (additive field, SAVE_VERSION unchanged); a save that had one keeps it.
    if (!m.daily || !Array.isArray(m.daily.orders) || !Array.isArray(m.daily.spare) || typeof m.daily.streak !== 'number') problems.push('daily not defaulted');
    if (old.daily && JSON.stringify(old.daily.orders ?? []) !== JSON.stringify(m.daily?.orders)) problems.push('daily orders changed by migration');
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
    // [phase5] Genesis upgrades, keystones and the run's hardships (even retired ones) are kept as they were.
    for (const [id, lvl] of Object.entries(old.prestige?.upgrades ?? {})) if ((m.prestige.upgrades[id] ?? 0) !== lvl) problems.push(`genesis upgrade ${id} ${lvl} -> ${m.prestige.upgrades[id] ?? 0}`);
    for (const id of old.longGame?.meta.mutators ?? []) if (!m.longGame?.meta.mutators.includes(id)) problems.push(`hardship ${id} lost`);
    problems.push(...cityMigrationProblems(old, m, from));
    // Only for saves from before the Acts existed (no longGame slice): those were placed in Act 4. A v5+ save keeps the Act it was in. [plan4:QA-1]
    if (m.longGame && !old.longGame && (old.era ?? 0) >= 3 && m.longGame.meta.act !== 4) problems.push(`era 3 save placed in Act ${m.longGame.meta.act}`);
    // [phase1] Auto-delivery: an old save keeps hand delivery (pledge off unless it was saved on); a new game starts with it on.
    if (!old.lateGame?.pledgeDefault && m.lateGame.pledgeDefault) problems.push('pledge: switched on for an old save');
    if (JSON.stringify(old.lateGame?.pledges ?? {}) !== JSON.stringify(m.lateGame.pledges ?? {})) problems.push('pledge: per-project choices changed by migration');
    if (!createInitialState().lateGame.pledgeDefault || !migrateState(createInitialState()).lateGame.pledgeDefault) problems.push('pledge: a new game does not start with it on');

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
    // [phase1] Crew work never sits above what its stage needs (the Vault Seal's hours were cut: a save mid-seal finishes the stage).
    for (const p of PROJECTS) {
      const prog = s.lateGame.projects[p.id];
      const st = prog ? p.stages[prog.stage] : undefined;
      if (prog && st && prog.work > st.hours * 3600 + 1 && e.projectSystem.paidUp(s, p.id) && s.activeProjectId === p.id) problems.push(`project ${p.id}: stage ${prog.stage + 1} has all its work and resources but did not finish`);
    }
    // [phase1] Pledge: switched on, a minute feeds the active stage and never takes a store below its reserve.
    const active = s.activeProjectId;
    if (active && !e.projectSystem.paidUp(s, active)) {
      const ps = e.projectSystem;
      const paidBefore = Object.values(ps.progressOf(s, active).paid).reduce((a, v) => a + (v ?? 0), 0);
      const stageBefore = ps.progressOf(s, active).stage;
      // [phase3] Judged with the pledge's own keep (PLEDGE_KEEP), not the hand-delivery reserve: a store the pledge may not touch is not a miss.
      const could = Object.entries(ps.missing(s, active)).some(([r, left]) => ps.deliverable(s, r as ResourceType, left as number, true) > 0.01);
      ps.setPledge(active, true);
      const low: string[] = [];
      for (let i = 0; i < 60; i++) {
        const before = { ...ps.progressOf(s, active).paid };
        e.advance(1, 'online');
        const after = ps.progressOf(s, active).paid;
        for (const [r, v] of Object.entries(after) as [ResourceType, number][]) {
          const res = s.resources[r];
          const reserve = Number.isFinite(res.cap) ? (RESERVE[r] ?? 0) * res.cap : 0;
          // Fed this second (paid went up) and the store ends under its reserve: the pledge dug into it. (Overflow absorbs only above the cap.)
          if (v > (before[r] ?? 0) + 1e-6 && res.amount < reserve - 1 && !low.includes(r)) low.push(r);
        }
      }
      const prog = ps.progressOf(s, active);
      const paidAfter = Object.values(prog.paid).reduce((a, v) => a + (v ?? 0), 0);
      if (could && prog.stage === stageBefore && paidAfter <= paidBefore) problems.push(`pledge: a minute fed nothing into ${active}`);
      if (low.length) problems.push(`pledge: took ${low.join(', ')} below the reserve`);
    }
    return {
      from, to: m.version, act: m.longGame?.meta.act ?? null, legacy: m.longGame?.meta.legacy ?? null, problems,
      after: { era: s.era, act: s.longGame?.meta.act ?? null, buildings: s.buildings.length, people: s.survivors.length, floors: s.currentFloors, playTime: Math.round(s.stats.totalPlayTime) },
    };
  } finally {
    det.restore();
  }
}
