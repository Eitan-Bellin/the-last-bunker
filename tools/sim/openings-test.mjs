#!/usr/bin/env node
// [plan4:ST-13] The door openings (src/rendering/openings.ts) on the sample saves and on a synthetic wing: doors only between different rooms, one per pair,
// corridor stubs where a wing ends, roomDoorX consistent. Usage: node tools/sim/openings-test.mjs [folder]   (default store/sim/saves-v6)
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(ROOT, 'store', 'sim', 'saves-v6'));
let games = [];
try { games = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f, json: readFileSync(join(dir, f), 'utf8') })); } catch { /* samples are gitignored */ }
if (!games.length) { console.log(`openings-test: no sample saves in ${dir} (skipped)`); process.exit(0); }

const { file } = await bundleSim({ tag: 'openings', entry: join(ROOT, 'tools', 'sim', 'openings-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.openingChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`openings-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`openings-test OK (${games.length} saves)`);
