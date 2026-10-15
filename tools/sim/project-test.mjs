#!/usr/bin/env node
// [world:C0] Projection checks for "The City Below" (see project-test.ts): classic = legacy geometry bit for bit, and under the city frames and a
// deliberately skewed set: touching rooms share an edge, nothing overlaps, halls stay aligned, slotAtX round-trips and is null in the hub, doorways
// sit on room edges, walkBlocked agrees with isPassable. Runs over every sample save in the given folders (default saves-v6 and saves-v7).
// Usage: node tools/sim/project-test.mjs [folder ...]
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirs = process.argv.slice(2).length ? process.argv.slice(2).map(d => resolve(process.cwd(), d)) : [join(ROOT, 'store', 'sim', 'saves-v6'), join(ROOT, 'store', 'sim', 'saves-v7')];
const games = [];
for (const d of dirs) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).filter(x => x.endsWith('.json')).sort()) games.push({ name: `${basename(d)}/${f}`, json: readFileSync(join(d, f), 'utf8') });
}
const { file } = await bundleSim({ tag: 'project', entry: join(ROOT, 'tools', 'sim', 'project-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.projectChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (!games.length) console.log('  (no sample saves found: frame maths only)');
if (problems.length) {
  console.error(`project-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('project-test OK');
