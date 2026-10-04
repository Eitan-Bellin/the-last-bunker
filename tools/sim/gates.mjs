#!/usr/bin/env node
// P0 quality gates of the long-game plan:
//  1. determinism: the same seed twice gives the same final game (hash);
//  2. offline identity: a day away makes the same tier-1 resources as a day online without a player (within 3%);
//  3. performance budgets: tick <= 2 ms, 24 h catch-up <= 1.5 s, save serialization <= 20 ms.
// Usage: node tools/sim/gates.mjs <sample save .json> [--hours 24]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const sample = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(ROOT, 'store', 'sim', 'saves-v4', 'era2-seed1.json');
const hi = process.argv.indexOf('--hours');
const hours = hi > 0 ? Number(process.argv[hi + 1]) : 24;
const failures = [];

// 1. Determinism
const dir = mkdtempSync(join(tmpdir(), 'lastbunker-gates-'));
const hashes = [];
for (const k of [1, 2]) {
  const r = spawnSync(process.execPath, [join(HERE, 'run.mjs'), '--mode', 'casual', '--days', '1', '--seeds', '3', '--jobs', '1', '--quiet', '--dump-save', join(dir, `d${k}`)], { encoding: 'utf8' });
  if (r.status !== 0) { failures.push(`determinism run ${k} failed: ${r.stderr.slice(0, 300)}`); break; }
  hashes.push(createHash('sha256').update(readFileSync(join(dir, `d${k}-seed3.json`))).digest('hex').slice(0, 16));
}
rmSync(dir, { recursive: true, force: true });
const same = hashes.length === 2 && hashes[0] === hashes[1];
console.log(`determinism   ${same ? 'ok  ' : 'FAIL'} ${hashes.join(' vs ')}`);
if (!same) failures.push('the same seed gave two different games');

// 2 + 3 need the engine itself.
const { file } = await bundleSim({ tag: 'gates', entry: join(HERE, 'gates.ts') });
const mod = await import(pathToFileURL(file).href);
const json = readFileSync(sample, 'utf8');

// The gate: the shared systems make the same away as online. Then, for information, the full online game
// (incidents and events run only online, so it usually makes a little less than time away at the same efficiency).
for (const economyOnly of [true, false]) {
  const rows = mod.offlineIdentity(json, Math.round(hours * 3600), economyOnly);
  console.log(`\n${economyOnly ? 'offline identity, shared systems' : 'full online game vs away (info)'} (${hours} h, ${sample.split(/[\\/]/).pop()}): online vs away`);
  for (const r of rows) {
    // Scrap has no room rate (only expeditions and salvage), so small absolute differences are noise.
    const ok = r.diff <= 0.03 || Math.abs(r.online - r.offline) < 100;
    if (!ok && economyOnly) failures.push(`offline identity: ${r.resource} differs ${(r.diff * 100).toFixed(1)}%`);
    console.log(`  ${economyOnly ? (ok ? 'ok  ' : 'FAIL') : '    '} ${r.resource.padEnd(10)} ${String(r.online).padStart(9)} ${String(r.offline).padStart(9)}  ${(r.diff * 100).toFixed(1)}%`);
  }
}

const p = mod.perfBudgets(json);
const budget = [['tick', p.tickMs, 2, 'ms'], ['simulate 24h', p.simulate24hMs, 1500, 'ms'], ['stringify', p.stringifyMs, 20, 'ms']];
console.log(`\nperformance (save ${p.saveKB} KB)`);
for (const [name, v, max, unit] of budget) {
  const ok = v <= max;
  if (!ok) failures.push(`${name} ${v.toFixed(2)} ${unit} > ${max}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(13)} ${v.toFixed(2).padStart(8)} ${unit} (budget ${max})`);
}
try { rmSync(file); } catch { /* cache file */ }

console.log(failures.length ? `\nGATES FAILED:\n - ${failures.join('\n - ')}` : '\nall gates pass');
process.exit(failures.length ? 1 : 0);
