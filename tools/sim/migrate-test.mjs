#!/usr/bin/env node
// Save-migration test: every sample save in a folder (default store/sim/saves-v4) is migrated and started with the live
// code; exit 1 if any lost something or broke. Sample saves come from an older build: run.mjs --dump-save <prefix>.
// Usage: node tools/sim/migrate-test.mjs [folder]
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = resolve(process.cwd(), process.argv[2] ?? join(ROOT, 'store', 'sim', 'saves-v4'));
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
if (!files.length) {
  console.error(`no sample saves in ${dir}`);
  process.exit(1);
}

const { file } = await bundleSim({ tag: 'migrate', entry: join(ROOT, 'tools', 'sim', 'migrate.ts') });
const mod = await import(pathToFileURL(file).href);
let failed = 0;
for (const f of files) {
  const r = await mod.checkMigration(readFileSync(join(dir, f), 'utf8'));
  const ok = r.problems.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(24)} v${r.from}->v${r.to} act ${r.act} legacy ${r.legacy} | after 1h away + 10 min: era ${r.after.era}, rooms ${r.after.buildings}, people ${r.after.people}, floors ${r.after.floors}`);
  for (const p of r.problems) console.log(`       - ${p}`);
}
try { rmSync(file); } catch { /* cache file */ }
console.log(failed ? `\n${failed} of ${files.length} saves FAILED` : `\nall ${files.length} saves migrate`);
process.exit(failed ? 1 : 0);
