// v2 pacing check: a greedy player runs the real mine simulation and we log when the goals are reached.
// Run: node --experimental-strip-types tools/v2sim.ts [minutes=60] [tapEvery=1.5]
import { FLOORS } from '../src/v2/econ.ts';
import { Mine, newSave, type StageId } from '../src/v2/mine.ts';

const minutes = Number(process.argv[2] ?? 60);
const tapEvery = Number(process.argv[3] ?? 1.5);
const mine = new Mine(newSave());
const log: string[] = [];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const note = (msg: string) => log.push(`${fmt(mine.s.time).padStart(6)}  ${msg}`);
let purchases = 0;
let lastPurchase = 0;
let longestWait = 0;

const stages = (): StageId[] => ['elev', 'market', ...mine.s.floors.map((_, i) => i)];

function act(): void {
  // 1) dig / hire when affordable (the big moments), 2) otherwise the upgrade with the best income gain per coin
  for (let guard = 0; guard < 50; guard++) {
    const before = mine.rates().income;
    const dig = mine.digCost();
    if (dig !== null && dig <= mine.s.cash) { mine.dig(); note(`dig floor ${mine.s.floors.length} (${FLOORS[mine.s.floors.length - 1].name})`); bought(); continue; }
    const hire = stages().find(id => !mine.stage(id).mgr && mine.mgrCost(id) <= mine.s.cash);
    if (hire !== undefined) { mine.hire(hire); note(`hire manager ${hire}`); bought(); continue; }
    let best: { id: StageId; score: number } | null = null;
    for (const id of stages()) {
      const cost = mine.upgradeCost(id, 1);
      if (cost > mine.s.cash) continue;
      const st = mine.stage(id);
      st.lvl++;
      const gain = mine.rates().income - before;
      st.lvl--;
      const score = (gain + before * 1e-4) / cost;
      if (!best || score > best.score) best = { id, score };
    }
    // keep a reserve for the next dig when it is close
    if (!best || (dig !== null && mine.rates().income * 120 > dig - mine.s.cash)) return;
    mine.upgrade(best.id, 1);
    bought();
  }
}

function bought(): void {
  purchases++;
  longestWait = Math.max(longestWait, mine.s.time - lastPurchase);
  lastPurchase = mine.s.time;
}

const DT = 0.05;
let nextTap = 0;
let nextAct = 0;
let nextReport = 300;
for (let t = 0; t < minutes * 60; t += DT) {
  if (mine.s.time >= nextTap) { for (const id of stages()) if (mine.idle(id)) mine.tap(id); nextTap += tapEvery; }
  if (mine.s.time >= nextAct) { act(); nextAct += 2; }
  for (const id of stages()) mine.boost(id);
  mine.step(DT);
  if (mine.s.time >= nextReport) {
    const r = mine.rates();
    note(`income ${r.income.toFixed(1)}/s (floors ${r.floorSum.toFixed(1)} elev ${r.elev.toFixed(1)} market ${r.market.toFixed(1)}) cash ${mine.s.cash.toFixed(0)} lv ${mine.s.floors.map(f => f.lvl).join('/')} e${mine.s.elev.lvl} m${mine.s.market.lvl}`);
    nextReport += 300;
  }
}
console.log(log.join('\n'));
console.log(`\npurchases ${purchases} (${(purchases / minutes).toFixed(1)}/min), longest wait between purchases ${longestWait.toFixed(0)} s, earned ${mine.s.stats.earned.toExponential(2)}`);
