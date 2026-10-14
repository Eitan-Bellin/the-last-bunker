#!/usr/bin/env node
// [ux-redesign W1] Formatting test: src/ui/format.ts (fmtNum, fmtCost = the old costAmount, fmtDuration, plural with the Hebrew dual)
// and the pure helpers of the UI kit, in Hebrew and English (tools/sim/format-test.ts). Exit 1 on any problem.
// Usage: node tools/sim/format-test.mjs
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'format', entry: join(ROOT, 'tools', 'sim', 'format-test.ts') });
const mod = await import(pathToFileURL(file).href);
const { problems, notes } = mod.formatChecks();
try { rmSync(file); } catch { /* cache file */ }
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.error(`format-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('format-test OK');
