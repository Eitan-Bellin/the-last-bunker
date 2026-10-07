#!/usr/bin/env node
// [plan4:GP-1] daily orders: the 04:00 day, the pool and the choice of three, the streak and its grace day, rewards and the 1.5-hour cap,
// progress (events, counters, clocks), what counts while away, the swap, the save defaults, and one pass through the real engine.
// Usage: node tools/sim/daily-test.mjs [folder]   (default store/sim/saves-v6; without sample saves only the synthetic checks run)
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(ROOT, 'store', 'sim', 'saves-v6'));
let games = [];
try { games = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f, json: readFileSync(join(dir, f), 'utf8') })); } catch { /* samples are gitignored */ }

const { file } = await bundleSim({ tag: 'daily', entry: join(ROOT, 'tools', 'sim', 'daily-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = await mod.dailyChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`daily-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`daily-test OK (${games.length} saves)`);
