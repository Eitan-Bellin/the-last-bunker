#!/usr/bin/env node
// [plan4:ST-14/ST-15] doors, stairwells, vent stacks: contract, building, fire, epidemic, defense, fire code, ventilation.
// Usage: node tools/sim/infra-test.mjs [folder]   (default store/sim/saves-v6)
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(ROOT, 'store', 'sim', 'saves-v6'));
let games = [];
try { games = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f, json: readFileSync(join(dir, f), 'utf8') })); } catch { /* samples are gitignored */ }
if (!games.length) { console.log(`infra-test: no sample saves in ${dir} (skipped)`); process.exit(0); }

const { file } = await bundleSim({ tag: 'infra', entry: join(ROOT, 'tools', 'sim', 'infra-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.infraChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`infra-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`infra-test OK (${games.length} saves)`);
