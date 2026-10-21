// v2 base layer smoke test: Command Center job, digging gated and timed, squad attack, raid on the bunker.
//   node --experimental-strip-types tools/v2basetest.ts
import { Base, newBase } from '../src/v2/base.ts';
import { Mine, newSave } from '../src/v2/mine.ts';

const fail = (m: string) => { console.error('FAIL', m); process.exit(1); };
let now = 1_000_000;
const s = newSave();
s.base = newBase(now);
const mine = new Mine(s);
const base = new Base(mine, s.base);
mine.levelCap = () => base.levelCap();
s.cash = 1e6;
base.step(now);
if (s.base.camps.length !== 4) fail('four camps');
if (!base.startDig(now)) fail('dig floor 2');
if (base.startDig(now)) fail('one dig at a time');
now += 31_000; base.step(now);
if (mine.s.floors.length !== 2) fail('floor 2 opened after 30 s');
if (base.canDigMore()) fail('CC 1 allows only 2 floors');
if (!base.startCC(now)) fail('cc upgrade');
if (!base.startDef('armory', now)) fail('second builder builds the armory');
if (base.startDef('walls', now)) fail('no third builder');
now += 61_000; base.step(now);
if (s.base.cc !== 2) fail('cc 2 after a minute');
if (!base.canDigMore()) fail('cc 2 allows floor 3');
if (mine.levelCap() !== 50) fail('cap 50');
const c = s.base.camps[0];
if (!base.attack(c.id, now)) fail('attack');
if (base.attack(s.base.camps[1].id, now)) fail('one squad');
now += 120_000; base.step(now);
if (s.base.squad) fail('squad back');
if (!s.base.reports.length) fail('report');
now += 3 * 3600_000; base.step(now);
if (!s.base.reports.some(r => r.kind === 'defense')) fail('raid on the bunker');
console.log('base ok', { cc: s.base.cc, floors: mine.s.floors.length, reports: s.base.reports.map(r => `${r.kind}:${r.win}`), gems: s.gems });
