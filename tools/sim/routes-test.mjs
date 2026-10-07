#!/usr/bin/env node
// [plan4:ST-18] Route planner checks for the walkers (see routes-test.ts). Usage: node tools/sim/routes-test.mjs
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'routes', entry: join(ROOT, 'tools', 'sim', 'routes-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.routeChecks();
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`routes-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('routes-test OK');
