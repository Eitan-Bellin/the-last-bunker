#!/usr/bin/env node
// Headless balance simulator: bundles the live game code and runs the bot in Node worker threads.
// Usage: node tools/sim/run.mjs --mode greedy|casual|engaged [--hours 48 | --days 7] [--seeds 1-10] [--json out.json]
//        [--think 10] [--jobs 4] [--src store/sim/baseline-src] [--return restart|resume] [--teams 2] [--note "..."] [--quiet]
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { bundleSim, ROOT } from './bundle.mjs';
import { aggregate, textReport } from './report-core.mjs';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}
function parseSeeds(s) {
  const out = [];
  for (const part of String(s).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.push(i);
    else if (part.trim()) out.push(+part);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(readmeHint());
  process.exit(0);
}
const mode = args.mode ?? 'greedy';
if (!['greedy', 'casual', 'engaged', 'neglect'].includes(mode)) { console.error(`unknown --mode ${mode}`); process.exit(1); }
const seeds = parseSeeds(args.seeds ?? '1-5');
const hours = mode === 'greedy' ? Number(args.hours ?? (args.days ? Number(args.days) * 24 : 48)) : undefined;
const days = mode === 'greedy' ? undefined : Number(args.days ?? 7);
const think = Number(args.think ?? (mode === 'greedy' ? 5 : 10));
const jobs = Math.max(1, Math.min(seeds.length, Number(args.jobs ?? Math.max(1, availableParallelism() - 3))));
const quiet = !!args.quiet;
const log = (...x) => { if (!quiet) console.log(...x); };

const startedAt = new Date().toISOString();
log(`bundling ${args.src ?? 'src'} ...`);
const { file: bundle, fingerprint } = await bundleSim({ src: args.src, tag: mode });
log(`code ${fingerprint.src} #${fingerprint.hash}, newest change ${fingerprint.newestChange}; ${seeds.length} seed(s) on ${jobs} thread(s)`);

const opts = seed => ({ mode, seed, hours, days, think, returnMode: args.return ?? 'restart', teams: args.teams ? Number(args.teams) : undefined, noDanger: !!args.nodanger, rebirths: args.rebirths ? Number(args.rebirths) : undefined, dumpSave: !!args['dump-save'], difficulty: args.difficulty, daily: args.daily });
const results = [];
const failures = [];
const queue = [...seeds];
const t0 = Date.now();

async function runOne(seed) {
  return new Promise(res => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { bundle, opts: opts(seed) } });
    w.on('message', m => {
      if (m.type === 'progress') { if (!quiet && args.progress) console.log(`  seed ${seed}: ${Math.round(m.f * 100)}% (${m.label})`); return; }
      if (m.type === 'done') { results.push(m.res); log(`  seed ${seed} done in ${(m.res.runMs / 1000).toFixed(0)} s`); }
      if (m.type === 'error') { failures.push({ seed, err: m.err }); console.error(`  seed ${seed} FAILED: ${m.err}`); }
      w.terminate();
    });
    w.on('error', err => { failures.push({ seed, err: String(err?.stack ?? err) }); console.error(`  seed ${seed} crashed: ${err}`); res(); });
    w.on('exit', () => res());
  });
}
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await runOne(queue.shift()); }));
try { rmSync(bundle); } catch { /* cache file */ }
results.sort((a, b) => a.seed - b.seed);

const data = {
  meta: {
    mode, hours, days, think, returnMode: args.return ?? 'restart', seeds, startedAt, finishedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - t0) / 1000), note: args.note ?? null, fingerprint, node: process.version,
    stepList: results[0]?.stepList ?? [], failures,
  },
  runs: results,
};
data.aggregate = aggregate(results);
const text = results.length ? textReport(data) : 'no successful runs';
console.log(`\n${text}`);
// --dump-save <prefix>: each run's final game as <prefix>-seed<N>.json (kept out of the results JSON).
if (args['dump-save']) {
  for (const r of results) {
    if (!r?.finalSave) continue;
    writeFileSync(resolve(process.cwd(), `${args['dump-save']}-seed${r.seed}.json`), r.finalSave);
    delete r.finalSave;
  }
}
if (args.json) {
  const out = resolve(process.cwd(), args.json);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 1));
  if (args.txt !== false) writeFileSync(out.replace(/\.json$/, '') + '.txt', text + '\n');
  log(`\nsaved ${out}`);
}
process.exit(failures.length && !results.length ? 1 : 0);

function readmeHint() {
  return `see ${join(ROOT, 'tools', 'sim', 'README.md')}\n` +
    'node tools/sim/run.mjs --mode greedy|casual|engaged [--hours 48 | --days 7] [--seeds 1-10] [--json out.json] [--think N] [--jobs N] [--src dir] [--return restart|resume] [--note text] [--progress] [--quiet]';
}
