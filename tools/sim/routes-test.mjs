#!/usr/bin/env node
// [plan4:ST-18] Route planner checks for the walkers (see routes-test.ts). Usage: node tools/sim/routes-test.mjs
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'routes', entry: join(ROOT, 'tools', 'sim', 'routes-test.ts') });
const mod = await import(pathToFileURL(file).href);
// [world:M2] The nav graph checks run on the e55 save (the biggest sample city).
const e55 = readFileSync(join(ROOT, 'store', 'sim', 'saves-v7', 'e55-seed1.json'), 'utf8');
const { problems, notes } = mod.routeChecks(e55);
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`routes-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('routes-test OK');
