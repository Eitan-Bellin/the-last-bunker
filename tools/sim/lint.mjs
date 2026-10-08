#!/usr/bin/env node
// Data lint for CI: English and Hebrew have the same keys and the same {placeholders}; research is a sound DAG;
// every cost names a real resource (tools/sim/lint.ts). Exit 1 on any problem.
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
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
// [plan4:BL-8] The effect readers are identity on today's rooms, and a probe room with every effect and rule behaves.
problems.push(...mod.effectHookProblems());
try { rmSync(file); } catch { /* cache file */ }

// [plan4:X-2] Placement truth table: the old fixed-12-slot rule and placeBlock/floorExtent agree on every slot of the sample saves (when present).
const savesDir = join(ROOT, 'store', 'sim', 'saves-v6');
let saves = [];
try { saves = readdirSync(savesDir).filter(f => f.endsWith('.json')).sort().map(f => ({ name: f, json: readFileSync(join(savesDir, f), 'utf8') })); } catch { /* gitignored samples: the synthetic game is still checked */ }
problems.push(...mod.placementTruthTable(saves));
// [plan4:ST-8 / ST-1] District data and position rules; no saved hall straddles a service gallery.
problems.push(...mod.districtAndGalleryProblems(saves));
// [plan4:ST-16] The surface (gate-house) row: geometry, placement table, opening at Act II.
problems.push(...mod.surfaceRowChecks(saves));

// [plan4:X-2] Reverse floor lookups outside rendering/geom.ts fail the lint; a fixed slot count (SLOTS_PER_FLOOR) is a warning.
const srcFiles = [];
const walkSrc = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walkSrc(p); else if (f.endsWith('.ts')) srcFiles.push({ rel: relative(join(ROOT, 'src'), p).split(sep).join('/'), text: readFileSync(p, 'utf8') }); } };
walkSrc(join(ROOT, 'src'));
const legacy = mod.legacyGeometryWarnings(srcFiles);
const lookups = legacy.filter(l => l.includes('FLOOR_H'));
const counts = legacy.filter(l => l.includes('SLOTS_PER_FLOOR'));
for (const l of lookups) problems.push(`geometry: ${l} (use floorAtY in rendering/geom.ts)`);
if (counts.length) console.log(`lint warning: ${counts.length} use(s) of SLOTS_PER_FLOOR outside rendering/geom.ts (use floorExtent)`);
if (process.argv.includes('--verbose')) console.log(`legacy geometry: ${lookups.length} reverse lookup(s), ${counts.length} slot-count use(s)` + (legacy.length ? '\n - ' + legacy.join('\n - ') : ''));

if (problems.length) {
  console.error(`lint: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log(`lint OK (${Object.keys(i18n.en).length} keys per language)`);
