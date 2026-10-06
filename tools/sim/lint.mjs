#!/usr/bin/env node
// Data lint for CI: English and Hebrew have the same keys and the same {placeholders}; research is a sound DAG;
// every cost names a real resource (tools/sim/lint.ts). Exit 1 on any problem.
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const load = lang => JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', `${lang}.json`), 'utf8'));
const i18n = { en: load('en'), he: load('he') };
const problems = [];

// i18n parity
const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const [a, b] of [['en', 'he'], ['he', 'en']]) {
  for (const k of Object.keys(i18n[a])) if (!(k in i18n[b])) problems.push(`i18n: ${k} is in ${a} but not in ${b}`);
}
for (const k of Object.keys(i18n.en)) {
  if (k in i18n.he && holes(i18n.en[k]) !== holes(i18n.he[k])) problems.push(`i18n: ${k} placeholders differ (en {${holes(i18n.en[k])}} vs he {${holes(i18n.he[k])}})`);
}

// Performance budget (tools/perf/run.mjs gates a build on it): the file exists and names scenarios and limits.
try {
  const b = JSON.parse(readFileSync(join(ROOT, 'tools', 'perf', 'budget.json'), 'utf8'));
  if (!b.scenarios || !Object.keys(b.scenarios).length) problems.push('perf: tools/perf/budget.json has no scenarios');
} catch (e) {
  problems.push(`perf: tools/perf/budget.json is missing or not valid JSON (${e.message})`);
}

const { file } = await bundleSim({ tag: 'lint', entry: join(HERE, 'lint.ts') });
const mod = await import(pathToFileURL(file).href);
problems.push(...mod.lintData(i18n));
try { rmSync(file); } catch { /* cache file */ }

if (problems.length) {
  console.error(`lint: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`lint OK (${Object.keys(i18n.en).length} keys per language)`);
