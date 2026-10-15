#!/usr/bin/env node
// [ux-redesign W4 qa] HUD count-up test: src/ui/fx/countUp.ts. A big jump counts up and ends exactly on the real amount, a held number
// waits for the goods and then counts, reduced motion jumps at once, small changes keep the gentle roll, production ticking during a count
// is followed, a drop (spending) shows at once, a hold drops a running count and nothing is left busy afterwards. Exit 1 on any problem. Usage: node tools/sim/countup-test.mjs
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'countup', entry: join(ROOT, 'src', 'ui', 'fx', 'countUp.ts') });
const C = await import(pathToFileURL(file).href);
try { rmSync(file); } catch { /* cache file */ }

const problems = [];
const ok = (cond, what) => { if (!cond) problems.push(what); };

/** Runs the HUD loop at 60 fps for `ms`; `target(t)` is the real amount at time t. Returns the frames shown. */
function run(cu, key, shown, target, ms, t0 = 0) {
  const out = [];
  for (let t = t0; t <= t0 + ms; t += 1000 / 60) {
    shown = cu.step(key, shown, typeof target === 'function' ? target(t) : target, t, 1 / 60);
    out.push({ t, shown });
  }
  return out;
}
const last = f => f[f.length - 1].shown;
/** Counting or waiting (the class keeps this private; the bundle does not). */
const busy = cu => cu.tweens.size > 0 || cu.holds.size > 0;

// ---- countMs: 300 ms for a small jump, 1000 ms for a doubling or more ------------------------------------------------------------------
ok(C.countMs(100, 106) >= C.COUNT_MIN_MS && C.countMs(100, 106) < 400, `countMs small ${C.countMs(100, 106)}`);
ok(C.countMs(100, 200) === C.COUNT_MAX_MS, `countMs doubling ${C.countMs(100, 200)}`);
ok(C.countMs(0, 500) === C.COUNT_MAX_MS, `countMs from zero ${C.countMs(0, 500)}`);

// ---- a big jump counts up, monotonic, and ends exactly on the target -----------------------------------------------------------------
{
  const cu = new C.CountUp();
  const f = run(cu, 'food', 100, 250, 1500);
  ok(last(f) === 250, `jump ends on target: ${last(f)}`);
  let mono = true;
  for (let i = 1; i < f.length; i++) if (f[i].shown < f[i - 1].shown) mono = false;
  ok(mono, 'jump counts up monotonically');
  const mid = f.find(x => x.t >= 300).shown;
  ok(mid > 100 && mid < 250, `jump is mid-count at 300 ms: ${mid}`);
  const done = f.find(x => x.shown === 250).t;
  ok(done <= C.COUNT_MAX_MS + 40, `jump done by ~1000 ms: ${done}`);
  ok(!busy(cu), 'not busy after the count');
}

// ---- a drop (spending) shows at once ------------------------------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  const f = run(cu, 'water', 500, 120, 1500);
  ok(f[0].shown === 120, `drop snaps: ${f[0].shown}`);
  ok(last(f) === 120, `drop ends on target: ${last(f)}`);
  ok(!busy(cu), 'drop makes no tween');
}

// ---- hold: the number waits for the goods, then counts and ends on target ---------------------------------------------------------------
{
  const cu = new C.CountUp();
  cu.hold('scrap', 600, 0);
  ok(busy(cu), 'busy while held');
  const f = run(cu, 'scrap', 40, 140, 2000);
  ok(f.filter(x => x.t < 590).every(x => x.shown === 40), 'held number stays until the landing');
  ok(last(f) === 140, `held jump ends on target: ${last(f)}`);
  ok(!busy(cu), 'hold cleared');
}

// ---- release early: counting starts at once -------------------------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  cu.hold('scrap', 5000, 0);
  run(cu, 'scrap', 40, 140, 100);
  cu.release('scrap');
  const f = run(cu, 'scrap', 40, 140, 1200, 120);
  ok(f.find(x => x.t >= 400).shown > 40, 'released hold counts');
  ok(last(f) === 140, 'released hold ends on target');
}

// ---- a hold never freezes a drop (spending while goods fly) ---------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  cu.hold('materials', 600, 0);
  const f = run(cu, 'materials', 300, 100, 1500);
  ok(f[0].shown === 100, 'drop is not held');
  ok(last(f) === 100, 'drop under hold ends on target');
}

// ---- reduced motion: instant -------------------------------------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  cu.instant = true;
  const s = cu.step('food', 100, 250, 0, 1 / 60);
  ok(s === 250, `instant jump: ${s}`);
}

// ---- small changes roll (no tween) and settle on target ---------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  const f = run(cu, 'food', 100, 102, 1000);
  ok(!busy(cu), 'small change makes no tween');
  ok(last(f) === 102, `small change settles: ${last(f)}`);
}

// ---- production keeps ticking during a count: follows, ends on the final target -----------------------------------------------------
{
  const cu = new C.CountUp();
  const f = run(cu, 'power', 100, t => 300 + Math.floor(t / 100), 2000);
  const want = 300 + Math.floor(f[f.length - 1].t / 100);
  ok(Math.abs(last(f) - want) < 1, `follows ticking target: ${last(f)} vs ${want}`);
}

// ---- a second big jump mid-count restarts toward the new target -----------------------------------------------------------------------
{
  const cu = new C.CountUp();
  const f = run(cu, 'data', 100, t => (t < 300 ? 200 : 600), 2500);
  ok(last(f) === 600, `second jump ends on target: ${last(f)}`);
}

// ---- zero to something ---------------------------------------------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  const f = run(cu, 'seedCores', 0, 3, 1500);
  ok(last(f) === 3, `0 -> 3 ends on 3: ${last(f)}`);
}

// ---- qa-wave-4 C1: a HUD frame between the gain and the burst starts a count; the hold drops it, and the count starts at the landing from
// the shown value (no jump of most of the gain in one frame). ----------------------------------------------------------------------------
{
  const cu = new C.CountUp();
  let shown = 504000;
  shown = cu.step('m', shown, 1104000, 0, 1 / 60); // the frame before the burst starts
  cu.hold('m', 600, 8);
  let atLand = shown, after = shown;
  for (let t = 16; t <= 1700; t += 16) {
    if (t >= 608 && t < 624) cu.release('m');
    const prev = shown;
    shown = cu.step('m', shown, 1104000, t, 1 / 60);
    if (t < 608) ok(shown === 504000, `held at ${t}: ${shown}`);
    if (t >= 608 && t < 624) { atLand = prev; after = shown; }
  }
  const leap = (after - atLand) / (1104000 - 504000);
  ok(leap < 0.25, `count-up after a hold jumps ${Math.round(leap * 100)}% of the gain in the first frame after the landing (want < 25%)`);
  ok(shown === 1104000, 'held jump with an early tween still ends on target');
  ok(!busy(cu), 'nothing busy after the held count');
}

// ---- a hold that runs out on its own (nothing landed) counts from the shown value too ---------------------------------------------------
{
  const cu = new C.CountUp();
  cu.hold('k', 300, 0);
  const f = run(cu, 'k', 1000, 3000, 1800);
  const first = f.find(x => x.t >= 300 + 20).shown;
  ok(first < 1000 + 0.25 * 2000, `expired hold starts gently: ${first}`);
  ok(last(f) === 3000, 'expired hold ends on target');
}

if (problems.length) {
  console.error(`countup-test FAILED (${problems.length})`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('countup-test OK');
