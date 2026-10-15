#!/usr/bin/env node
// [world:C1] City layout checks (see city-layout-test.ts): buildCityLayout over every sample save and the vertical-slice scenario under the city
// projection: deterministic, well-formed polygons inside the bounds, derived discovery agrees with revealedAreaIds, every room / ruin / empty slot
// stands inside the cut, hubs, stairs and balconies sit where routes expect them, edges past the floor ends, progress never changes the signature.
// Usage: node tools/sim/city-layout-test.mjs [folder ...]
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
const { file } = await bundleSim({ tag: "citylayout", entry: join(ROOT, 'tools', 'sim', 'city-layout-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.cityLayoutChecks(games);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (!games.length) console.log('  (no sample saves found: frame maths only)');
if (problems.length) {
  console.error(`city-layout-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('city-layout-test OK');
