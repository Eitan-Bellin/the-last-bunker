#!/usr/bin/env node
// [plan4:ST-19] bestSpot and BuildingSystem.relocate on the sample saves (cost, downtime, crew, validity, save round-trip).
// Usage: node tools/sim/placement-test.mjs [folder]   (default store/sim/saves-v6)
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(ROOT, 'store', 'sim', 'saves-v6'));
let games = [];
try { games = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f, json: readFileSync(join(dir, f), 'utf8') })); } catch { /* samples are gitignored */ }
if (!games.length) { console.log(`placement-test: no sample saves in ${dir} (skipped)`); process.exit(0); }

const { file } = await bundleSim({ tag: 'placement', entry: join(ROOT, 'tools', 'sim', 'placement-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.placementChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`placement-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`placement-test OK (${games.length} saves)`);
