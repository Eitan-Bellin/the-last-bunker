import { runSim, type SimMode, type SimResult } from './sim/core';
import { textReport } from './sim/report-core.mjs';

/**
 * Balance simulation bot, browser page (Sprint 9, upgraded for the balance pass): the same bot and metrics as the
 * Node runner (tools/sim/run.mjs), shown in the page. It never touches the real save (in-memory save only).
 *   /tools/balance.html?hours=12&seed=3                 greedy, always online
 *   /tools/balance.html?mode=casual&days=3&seeds=1-3    ~45 min/day with real offline returns
 *   /tools/balance.html?mode=engaged&days=2&think=10    ~2 h/day in 8 sessions
 * The Node runner is the reliable way for long or many runs (Vite reloads can't kill it).
 */

const params = new URLSearchParams(location.search);
const MODE = (params.get('mode') ?? 'greedy') as SimMode;
const HOURS = Number(params.get('hours') ?? 12);
const DAYS = Number(params.get('days') ?? 3);
const THINK = params.get('think') ? Number(params.get('think')) : undefined;
const out = document.getElementById('out')!;
const status = document.getElementById('status')!;
const log = (s: string) => { out.textContent += `${s}\n`; };

function seedList(): number[] {
  const raw = params.get('seeds') ?? params.get('seed') ?? '1';
  const list: number[] = [];
  for (const part of raw.split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) list.push(i);
    else if (part.trim()) list.push(Number(part));
  }
  return list;
}

const fmt = (h: number) => `${Math.floor(h)}h${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;

async function run(): Promise<void> {
  if (!['greedy', 'casual', 'engaged', 'neglect'].includes(MODE)) { log(`unknown mode "${MODE}" (greedy | casual | engaged)`); return; }
  const seeds = seedList();
  const runs: SimResult[] = [];
  const yieldFn = () => new Promise<void>(r => setTimeout(r, 0));
  for (const seed of seeds) {
    const res = await runSim({
      mode: MODE, seed, hours: HOURS, days: DAYS, think: THINK, yieldFn,
      onProgress: (f, label) => { status.textContent = `seed ${seed}: ${Math.round(f * 100)}% (${label})`; },
    });
    runs.push(res);
  }
  status.textContent = 'done';
  const meta = { mode: MODE, hours: MODE === 'greedy' ? HOURS : undefined, days: MODE === 'greedy' ? undefined : DAYS, think: THINK ?? (MODE === 'greedy' ? 5 : 10), note: 'browser page' };
  log(textReport({ meta, runs }));
  for (const r of runs) {
    log(`\n--- seed ${r.seed}: simulated in ${(r.runMs / 1000).toFixed(1)} s ---`);
    log('  wall    online  era pop/max  kids fl bld  lv res  expl mor  hp  iso   food      water     materials   knowledge  scrap');
    for (const x of r.samples) {
      const res = (k: string) => `${x.res[k][0]}/${x.res[k][1]}`;
      log(`  ${fmt(x.wallH).padStart(7)} ${fmt(x.playH).padStart(6)} ${String(x.era).padStart(3)} ${`${x.pop}/${x.maxPop}`.padStart(7)} ${String(x.kids).padStart(4)} ${String(x.floors).padStart(2)} ${String(x.buildings).padStart(3)} ${String(x.levels).padStart(3)} ${String(x.research).padStart(3)} ${String(x.explored).padStart(5)} ${String(x.morale).padStart(3)} ${String(x.minHp).padStart(3)} ${String(x.iso).padStart(4)}  ${res('food').padEnd(9)} ${res('water').padEnd(9)} ${res('materials').padEnd(11)} ${res('knowledge').padEnd(10)} ${res('scrap')}`);
    }
    if (r.offline.length) {
      log('  offline returns (first 12): away → gained | wasted');
      for (const o of r.offline.slice(0, 12)) log(`    ${fmt(o.wallH).padStart(7)} away ${o.awayMin} min → ${JSON.stringify(o.gained)} | ${JSON.stringify(o.wasted)}${o.arrivals ? ` · door ${o.arrivals}` : ''}`);
    }
    log(`  final: ${JSON.stringify(r.final)}`);
  }
  (window as unknown as { __balance: unknown }).__balance = runs.length === 1 ? runs[0] : runs;
}

void run();
