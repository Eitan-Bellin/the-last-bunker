import { mod } from './lib.mjs';
const m = await mod();
const { Buildings: B, ResearchData: R, GS, Research } = m;
const s0 = GS.createInitialState();
const s1 = GS.createInitialState();
for (const r of R.RESEARCH) s1.research[r.id] = { id: r.id, completed: true, progress: 0, total: 0, isResearching: false };
const unlockedBy = {};
for (const r of R.RESEARCH) for (const k of Object.keys(r)) if (/unlock|build/i.test(k)) unlockedBy[r.id] = r[k];
console.log('research fields sample', Object.keys(R.RESEARCH[0]).join(','));
const never = [], free = [];
for (const t of B.BUILDABLE_TYPES) {
  const u0 = Research.isBuildingUnlocked(s0, t), u1 = Research.isBuildingUnlocked(s1, t);
  if (!u1) never.push(t); if (u0) free.push(t);
}
console.log('never unlocked even with all research:', never.join(' ') || '-');
console.log('unlocked from start:', free.join(' '));
// which research unlocks which type
const who = {};
for (const r of R.RESEARCH) { const st = GS.createInitialState(); for (const t of B.BUILDABLE_TYPES) { if (Research.isBuildingUnlocked(s0, t)) continue; const s = GS.createInitialState(); s.research[r.id] = { id: r.id, completed: true, progress: 0, total: 0, isResearching: false }; if (Research.isBuildingUnlocked(s, t)) (who[t] ??= []).push(r.id); } }
console.log('single-research unlocks:', Object.entries(who).map(([t, ids]) => `${t}<-${ids.join('/')}`).join(' | '));
const noSingle = B.BUILDABLE_TYPES.filter(t => !free.includes(t) && !who[t]);
console.log('types gated but no single research unlocks them (multi-requirement?):', noSingle.join(' ') || '-');
