#!/usr/bin/env node
// [plan4:GP-8 #7] The Foreman's sealOnAlarm order (doors shut in a fire / epidemic / raid, reopened after). Usage: node tools/sim/foreman-test.mjs
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'foreman', entry: join(ROOT, 'tools', 'sim', 'foreman-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems } = mod.foremanChecks();
try { rmSync(file); } catch { /* cache file */ }
if (problems.length) {
  console.error(`foreman-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('foreman-test OK');
