#!/usr/bin/env node
// [plan4:BL-15..32] Effects, weather, children, placement and the memorial flag of the twelve wave 2 rooms on the sample saves.
// Usage: node tools/sim/rooms-test.mjs [folder]   (default store/sim/saves-v6)
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(ROOT, 'store', 'sim', 'saves-v6'));
let games = [];
try { games = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f, json: readFileSync(join(dir, f), 'utf8') })); } catch { /* samples are gitignored */ }
if (!games.length) { console.log(`rooms-test: no sample saves in ${dir} (skipped)`); process.exit(0); }

const { file } = await bundleSim({ tag: 'rooms', entry: join(ROOT, 'tools', 'sim', 'rooms-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.roomsChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`rooms-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`rooms-test OK (${games.length} saves)`);
