import { mod, SAVES } from './lib.mjs';
import { readdirSync, readFileSync } from 'node:fs';
const m = await mod();
const GS = m.GS;
const paths = (o, p = '', out = new Set(), d = 0) => {
  if (d > 6) return out;
  if (o && typeof o === 'object' && !Array.isArray(o)) { for (const [k, v] of Object.entries(o)) { out.add(p + k); paths(v, p + k + '.', out, d + 1); } }
  return out;
};
const fresh = GS.createInitialState();
const fp = paths(fresh);
console.log('fresh key paths', fp.size);
for (const f of readdirSync(SAVES)) {
  const raw = JSON.parse(readFileSync(SAVES + f, 'utf8'));
  const mig = GS.migrateState(JSON.parse(JSON.stringify(raw)));
  const mp = paths(mig);
  const missing = [...fp].filter(k => !mp.has(k));
  const extra = [...mp].filter(k => !fp.has(k) && !/^(resources|research|refinements|prestige\.upgrades|shop\.|lateGame\.(projects|trade\.deals|weekly\.base)|longGame\.(foreman\.orders|meta\.))/.test(k));
  console.log(f, 'missing-after-migrate:', missing.join(', ') || '-');
}
// raw-minimal save: v1
const v1 = { version: 1, timestamp: 1, resources: { food: { amount: 5, cap: 150 } }, buildings: [], survivors: [], stats: { totalPlayTime: 10 }, prestige: { rebirthCount: 0 }, settings: {language:'he'} };
const mig = GS.migrateState(JSON.parse(JSON.stringify(v1)));
const mp = paths(mig);
console.log('v1-minimal missing:', [...fp].filter(k => !mp.has(k)).join(', ') || '-');
// compare to fresh: longGame deep
const lgFresh = paths(fresh.longGame); 
