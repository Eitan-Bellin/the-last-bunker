#!/usr/bin/env node
// A quick health check of the game logic for CI and for "did my change break the economy": one simulated day, one seed.
// It fails (exit 1) when a system throws, when the simulator stops understanding GameEngine.tick(), or when the early game stops progressing.
// (A silent break of exactly this kind went unnoticed for a day: every simulation reported "no era reached".)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'lastbunker-smoke-'));
const out = join(dir, 'smoke.json');
const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
const r = spawnSync(process.execPath, [run, '--mode', 'casual', '--days', '1', '--seeds', '1', '--jobs', '1', '--quiet', '--json', out], { encoding: 'utf8' });
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
if (r.status !== 0) {
  console.error('smoke: the simulation did not finish');
  process.exit(1);
}
const data = JSON.parse(readFileSync(out, 'utf8'));
rmSync(dir, { recursive: true, force: true });
const run1 = data.runs?.[0];
const problems = [];
if (!run1) problems.push('no run result');
else {
  for (const w of run1.warnings ?? []) if (/error|could not read/i.test(w)) problems.push(`warning: ${w.slice(0, 160)}`);
  if ((run1.stepList?.length ?? 0) < 8) problems.push(`only ${run1.stepList?.length ?? 0} systems in the step list (GameEngine.tick() changed shape?)`);
  const era1 = run1.milestones?.['era 1'] ?? run1.milestones?.['era 1 restoration'];
  const reached = !!era1 && era1.wall != null;
  if (!reached) problems.push('the first era was never reached in a simulated day');
}
if (problems.length) {
  console.error('\nsmoke FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('\nsmoke OK');
