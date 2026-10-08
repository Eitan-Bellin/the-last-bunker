import { mkEngine, scan, negatives, crashlog, clearCrash, run, summary } from './lib.mjs';
const scenarios = {
  baseline: s => {},
  zeroSurvivors: (s, sm) => { sm.applyDelta({ path: 'survivors', value: [] }); },
  zeroResources: s => { for (const r of Object.values(s.resources)) r.amount = 0; },
  noBuildings: (s, sm) => { sm.applyDelta({ path: 'buildings', value: [] }); },
  workersOrphan: s => { for (const b of s.buildings) b.assignedSurvivorIds = ['ghost1', 'ghost2']; },
  maxPop0: (s) => { s.maxPopulation = 0; },
  happyNaN: s => { for (const p of s.survivors) p.happiness = NaN; },
  healthZero: s => { for (const p of s.survivors) p.health = 0; },
  day1000: s => { s.stats.totalPlayTime = 1000 * 86400; if (s.longGame) s.longGame.meta.worldT = 1000 * 86400; },
  day100000: s => { s.stats.totalPlayTime = 1e8 * 86400; if (s.longGame) s.longGame.meta.worldT = 1e8 * 86400; },
  capZero: s => { for (const r of Object.values(s.resources)) r.cap = 0; },
  levelsHuge: s => { for (const b of s.buildings) b.level = 99999; },
  levelsZero: s => { for (const b of s.buildings) b.level = 0; },
  allSurvivorsOnMission: s => { for (const p of s.survivors) p.isOnMission = true; },
};
for (const file of ['c-seed1.json', 'e30-seed1.json', 'e55-seed1.json']) {
  for (const [name, fn] of Object.entries(scenarios)) {
    const { e, sm, det } = await mkEngine(file);
    clearCrash();
    fn(sm.state, sm);
    let err = null;
    try { run(e, 600, 1); run(e, 60, 0.1); } catch (x) { err = x.message; }
    const s = sm.state;
    const bad = scan(s);
    console.log(file.padEnd(14), name.padEnd(20), JSON.stringify(summary(s)), 'NaN:', bad.slice(0, 4).join(';') || '-', 'neg:', negatives(s).slice(0, 3).join(';') || '-', 'crash:', [...new Set(crashlog())].slice(0, 3).join(' | ') || '-', err ? 'THROW ' + err : '');
    det.restore();
  }
}
