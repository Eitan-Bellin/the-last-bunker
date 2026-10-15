#!/usr/bin/env node
// [ux-redesign W3a] "What now?" advisor test: src/ui/onboarding/advisorRules.ts (crisis > collect > goal > upgrade, a goal that fixes a
// crisis takes its slot, time to empty, the first-session window, the idle hint, the quiet first minutes). Exit 1 on any problem.
// Usage: node tools/sim/advisor-test.mjs
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleSim } from './bundle.mjs';
import './node-globals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { file } = await bundleSim({ tag: 'advisor', entry: join(ROOT, 'src', 'ui', 'onboarding', 'advisorRules.ts') });
const A = await import(pathToFileURL(file).href);
try { rmSync(file); } catch { /* cache file */ }

const problems = [];
const ok = (cond, what) => { if (!cond) problems.push(what); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const calm = (patch = {}) => ({
  stores: [{ id: 'food', amount: 100, net: 0.2 }, { id: 'water', amount: 100, net: 0.1 }],
  powerRatio: 1, powerUsed: true, raid: false, incidents: 0,
  collect: { inbox: 0, supply: false, daily: 0 },
  goal: { id: 'farm', fixes: [] }, idleResearch: false, upgrade: false,
  ...patch,
});
const keys = input => A.adviseOrder(input).map(p => p.key);

// ---- time to empty ------------------------------------------------------------------------------------------------------------
eq(A.timeToEmpty(100, -1), 100, 'falling store');
eq(A.timeToEmpty(100, 0.5), Infinity, 'rising store never empties');
eq(A.timeToEmpty(100, -A.STEADY / 2), Infinity, 'a trickle is steady');
eq(A.timeToEmpty(-5, -1), 0, 'already empty');

// ---- order ----------------------------------------------------------------------------------------------------------------------
eq(keys(calm()), ['goal:farm'], 'calm: the goal');
eq(keys(calm({ goal: null })), [], 'nothing to say');
eq(keys(calm({ upgrade: true, idleResearch: true })), ['goal:farm', 'research', 'upgrade'], 'goal before recommendations');
eq(keys(calm({ collect: { inbox: 2, supply: true, daily: 1 } })), ['inbox', 'supply', 'daily', 'goal:farm'], 'collect before the goal');
eq(keys(calm({ stores: [{ id: 'food', amount: 100, net: -1 }], collect: { inbox: 1, supply: false, daily: 0 } })),
  ['store:food', 'inbox', 'goal:farm'], 'crisis before collect');
eq(keys(calm({ stores: [{ id: 'food', amount: 100, net: -0.5 }, { id: 'water', amount: 30, net: -0.5 }] })),
  ['store:water', 'goal:farm'], 'only stores under the threshold, soonest first (food has 200 s)');
eq(keys(calm({ stores: [{ id: 'food', amount: 50, net: -0.5 }, { id: 'water', amount: 30, net: -0.5 }] })),
  ['store:water', 'store:food', 'goal:farm'], 'two crises, soonest first');
eq(keys(calm({ raid: true, incidents: 2, powerRatio: 0.5, stores: [{ id: 'food', amount: 10, net: -1 }] })),
  ['raid', 'incident', 'store:food', 'power', 'goal:farm'], 'raid > incident > store > power');
eq(keys(calm({ powerRatio: 0.5, powerUsed: false })), ['goal:farm'], 'no consumers, no deficit');
eq(keys(calm({ powerRatio: 0.5, stores: [{ id: 'power', amount: 6, net: -1 }] })), ['store:power', 'goal:farm'], 'a draining power reserve is one crisis, not two');
eq(keys(calm({ powerRatio: 0.5, stores: [{ id: 'power', amount: 6, net: -1 }], collect: { inbox: 0, supply: true, daily: 0 }, goal: { id: 'restoreGenerator', fixes: ['power'] } })),
  ['goal:restoreGenerator', 'supply'], 'opening: the generator step leads over the supply crate');
eq(A.advise(calm({ stores: [{ id: 'food', amount: 10, net: -1 }] })).seconds, 10, 'the crisis carries its countdown');

// ---- a goal that fixes the crisis takes its slot ------------------------------------------------------------------------------
{
  const order = A.adviseOrder(calm({ powerRatio: 0.2, goal: { id: 'restoreGenerator', fixes: ['power'] }, collect: { inbox: 1, supply: false, daily: 0 } }));
  eq(order.map(p => p.key), ['goal:restoreGenerator', 'inbox'], 'generator step replaces the power alarm');
  eq([order[0].urgent, order[0].resource], [true, 'power'], 'the goal is marked urgent with the resource');
}
{
  const order = A.adviseOrder(calm({
    stores: [{ id: 'food', amount: 20, net: -1 }, { id: 'water', amount: 40, net: -1 }],
    goal: { id: 'pump', fixes: ['water', 'food'] },
  }));
  eq(order.map(p => p.key), ['goal:pump'], 'a goal fixing two crises appears once');
  eq(order[0].seconds, 20, 'with the soonest countdown');
}
eq(keys(calm({ raid: true, goal: { id: 'g', fixes: ['power'] } })), ['raid', 'goal:g'], 'a raid is never folded into a goal');
eq(keys(calm({ stores: [{ id: 'food', amount: 20, net: -1 }], goal: { id: 'g', fixes: ['water'] } })), ['store:food', 'goal:g'], 'a goal for another resource does not fold');

// ---- first session ------------------------------------------------------------------------------------------------------------
ok(A.ftueActive({ profileDone: false, tutorialStep: 0, playSeconds: 0 }), 'new game: spotlight on');
ok(A.ftueActive({ profileDone: false, tutorialStep: A.FTUE_STEPS - 1, playSeconds: 300 }), 'last FTUE step: on');
ok(!A.ftueActive({ profileDone: false, tutorialStep: A.FTUE_STEPS, playSeconds: 300 }), 'past the first steps: off');
ok(!A.ftueActive({ profileDone: true, tutorialStep: 0, playSeconds: 0 }), 'returning player (profile flag), new slot: off');
ok(!A.ftueActive({ profileDone: false, tutorialStep: 2, playSeconds: A.FTUE_MAX_PLAY_S }), 'an old save stuck early: off');
ok(A.ftueFinished({ profileDone: false, tutorialStep: 12, playSeconds: 9 }), 'finished by steps');
ok(!A.ftueFinished({ profileDone: false, tutorialStep: 1, playSeconds: 60 }), 'not finished yet');

// ---- idle hint ------------------------------------------------------------------------------------------------------------------
const idle = (patch = {}) => ({ idleMs: A.IDLE_HINT_MS, ftue: true, crisis: false, blocked: false, shown: 0, ...patch });
ok(A.idleHintDue(idle()), 'idle 9 s in the first session');
ok(A.idleHintDue(idle({ ftue: false, crisis: true })), 'idle during a crisis');
ok(!A.idleHintDue(idle({ ftue: false, crisis: false })), 'calm game: no hand');
ok(!A.idleHintDue(idle({ idleMs: A.IDLE_HINT_MS - 1 })), 'not before 9 s');
ok(!A.idleHintDue(idle({ blocked: true })), 'never over a sheet / dialog / placement');
ok(!A.idleHintDue(idle({ shown: A.IDLE_HINT_MAX })), 'gives up after a few times');

// ---- quiet first minutes --------------------------------------------------------------------------------------------------------
ok(!A.promptAllowed(0) && !A.promptAllowed(A.PROMPT_QUIET_S - 1), 'no offers in the first 5 minutes');
ok(A.promptAllowed(A.PROMPT_QUIET_S), 'offers allowed after 5 minutes');
eq(A.PROMPT_QUIET_S, 300, 'five minutes');

if (problems.length) {
  console.error(`advisor-test: ${problems.length} problem(s)\n - ${problems.join('\n - ')}`);
  process.exit(1);
}
console.log('advisor-test OK');
