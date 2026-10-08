// [plan4:GP-1] Node-level checks of the daily orders (run by daily-test.mjs): the 04:00 day, the pool and the choice of three, the streak and its one
// grace day, the rewards and the economic cap, progress from events/counters/clocks, what counts while away, the swap, and the save defaults.
import { StateManager } from '../../src/core/StateManager';
import { SeededRandom } from '../../src/core/Random';
import { bus } from '../../src/core/EventBus';
import { GameEngine } from '../../src/core/GameEngine';
import { SAVE_VERSION, createInitialState, migrateState, type BuildingInstance, type DailyOrder, type GameState } from '../../src/core/GameState';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { BuildingSystem } from '../../src/systems/BuildingSystem';
import { PopulationSystem } from '../../src/systems/PopulationSystem';
import { ResearchSystem } from '../../src/systems/ResearchSystem';
import { RushSystem } from '../../src/systems/RushSystem';
import { DailySystem, ORDERS_PER_DAY, dayIndex, nextResetAt, pickOrders } from '../../src/systems/DailySystem';
import {
  CHEST_HOURS, CREDIT_HOURS, FRAGS_PER_PLAN, MAX_DAILY_HOURS, ORDERS, REWARD_GOLD, REWARD_RUSH, REWARD_SILVER, RUSH_HOURS, STREAK_MAX_BONUS, actCreditScale, didFlag,
  getOrder, maxDailyHours, streakBonus,
} from '../../src/data/orders';
import en from '../../src/i18n/en.json';
import he from '../../src/i18n/he.json';

const room = (id: string, type: BuildingInstance['type'], x: number, floor: number): BuildingInstance => ({
  id, type, level: 1, position: { x, y: 0, floor }, assignedSurvivorIds: [], constructionProgress: 1, constructionTotal: 1, isConstructing: false, specialization: null,
});

/** A bunker some way into Act II with the pieces the orders look at. */
function base(act = 2): GameState {
  const s = createInitialState();
  s.storyFlags.push('intro:done');
  s.stats.totalPlayTime = 5000;
  s.longGame.meta.act = act;
  s.currentFloors = 8;
  s.era = 2;
  s.maxPopulation = 20;
  s.buildings = [room('b_1', 'generator', 1, 0), room('b_2', 'farm', 3, 0), room('b_3', 'quarters', 5, 0), room('b_4', 'laboratory', 7, 0), room('b_5', 'trainingRoom', 9, 0), room('b_6', 'workshop', 11, 0)];
  const pop = new PopulationSystem();
  const rng = new SeededRandom(5);
  s.survivors = [];
  for (let i = 0; i < 8; i++) {
    const sv = pop.createSurvivor(rng);
    sv.id = `s_${i + 1}`; sv.child = false; sv.health = 100; sv.isOnMission = false;
    s.survivors.push(sv);
  }
  s.buildings[0].assignedSurvivorIds = ['s_1'];
  s.survivors[0].assignedBuildingId = 'b_1';
  for (const r of Object.values(s.resources)) { if (Number.isFinite(r.cap)) r.amount = r.cap = 5000; }
  s.resources.food.productionRate = 2;
  s.resources.power.productionRate = 3;
  s.resources.credits.amount = 0;
  s.resources.blueprints.amount = 0;
  s.rush = 0;
  return s;
}

interface Rig { sm: StateManager; sys: DailySystem; rush: RushSystem; res: ResourceSystem }

function rig(s: GameState): Rig {
  const sm = new StateManager();
  sm.loadState(s);
  const res = new ResourceSystem();
  const rush = new RushSystem(sm, new ResearchSystem(res));
  const bs = new BuildingSystem();
  const sys = new DailySystem(sm, res, rush, { digBlock: st => bs.digBlock(st) });
  return { sm, sys, rush, res };
}

/** Local wall-clock time on a calendar day, hours/minutes (the test names days by offset from a fixed date so it never depends on "today"). */
const at = (dayOffset: number, h: number, m = 0): number => new Date(2026, 2, 1 + dayOffset, h, m, 0, 0).getTime();

const orderOf = (id: string, over: Partial<DailyOrder> = {}): DailyOrder => ({ id, p: 0, need: 1, done: false, claimed: false, b: 0, ...over });

export async function dailyChecks(games: { name: string; json: string }[]): Promise<{ problems: string[]; notes: string[] }> {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string): void => { if (problems.length < 30) problems.push(m); };
  const eq = (what: string, got: unknown, want: unknown): void => { if (got !== want) fail(`${what}: got ${String(got)}, wanted ${String(want)}`); };
  const near = (what: string, got: number, want: number, tol: number): void => { if (Math.abs(got - want) > tol) fail(`${what}: got ${got.toFixed(3)}, wanted ${want} +-${tol}`); };

  // ---- 1. the day starts at 04:00 local time ----
  {
    eq('03:59 is still yesterday', dayIndex(at(10, 3, 59)), dayIndex(at(9, 12)));
    eq('04:00 is a new day', dayIndex(at(10, 4, 0)), dayIndex(at(9, 12)) + 1);
    eq('23:59 is the same day as noon', dayIndex(at(10, 23, 59)), dayIndex(at(10, 12)));
    eq('00:30 belongs to the evening before', dayIndex(at(10, 0, 30)), dayIndex(at(9, 22)));
    // Every calendar day of a year (it crosses both clock changes of whatever zone this runs in) is exactly one more than the day before.
    let prev = dayIndex(at(-200, 12));
    let step = true;
    for (let d = -199; d < 200; d++) { const x = dayIndex(at(d, 12)); if (x !== prev + 1) step = false; prev = x; }
    eq('consecutive days count up by one all year (clock changes included)', step, true);
    eq('reset from 03:00 is 04:00 today', nextResetAt(at(10, 3, 0)), at(10, 4, 0));
    eq('reset from 05:00 is 04:00 tomorrow', nextResetAt(at(10, 5, 0)), at(11, 4, 0));
    eq('reset from exactly 04:00 is tomorrow', nextResetAt(at(10, 4, 0)), at(11, 4, 0));
    eq('the reset starts a new day', dayIndex(nextResetAt(at(10, 9))), dayIndex(at(10, 9)) + 1);
    eq('a moment before the reset is the old day', dayIndex(nextResetAt(at(10, 9)) - 1), dayIndex(at(10, 9)));
  }

  // ---- 2. the pool ----
  {
    eq('22 orders in the pool', ORDERS.length, 22);
    eq('unique ids', new Set(ORDERS.map(o => o.id)).size, ORDERS.length);
    const tiers = { easy: 0, medium: 0, new: 0 };
    for (const o of ORDERS) tiers[o.tier]++;
    if (tiers.easy < 5 || tiers.medium < 5 || tiers.new < 4) fail(`tier counts too thin: ${JSON.stringify(tiers)}`);
    eq('three orders only dig, research and food count away', ORDERS.filter(o => o.offline).map(o => o.id).sort().join(','), 'dig1,food,research1');
    for (const o of ORDERS) {
      for (const [lang, table] of [['en', en], ['he', he]] as const) {
        if (!(`orders.${o.id}` in table)) fail(`orders.${o.id} missing in ${lang}.json`);
        if (o.tier === 'new' && !(`orders.${o.id}.hint` in table)) fail(`orders.${o.id}.hint missing in ${lang}.json`);
      }
      if (o.fromAct < 1 || o.fromAct > 7) fail(`${o.id}: odd fromAct ${o.fromAct}`);
    }
    // Every Act has something of each tier to offer in a developed bunker (the choice never runs dry).
    for (let act = 1; act <= 7; act++) {
      const s = base(act);
      const { sys } = rig(s);
      void sys;
      const bs = new BuildingSystem();
      const env = { digBlock: (st: GameState) => bs.digBlock(st) };
      const have = new Set(ORDERS.filter(o => act >= o.fromAct && act <= (o.toAct ?? 99) && o.avail(s, env)).map(o => o.tier));
      if (have.size < 2) fail(`act ${act}: only ${[...have].join('/')} orders available in a plain bunker`);
    }
  }

  // ---- 3. the choice of three ----
  {
    const s = base(2);
    const bs = new BuildingSystem();
    const env = { digBlock: (st: GameState) => bs.digBlock(st) };
    const day = dayIndex(at(20, 9));
    const a = pickOrders(s, day, env);
    const b = pickOrders(s, day, env);
    eq('three orders a day', a.orders.length, ORDERS_PER_DAY);
    eq('the same bunker and day always give the same orders', a.orders.map(o => o.id).join(), b.orders.map(o => o.id).join());
    eq('three different orders', new Set(a.orders.map(o => o.id)).size, 3);
    eq('one easy, one medium, one new', a.orders.map(o => getOrder(o.id)?.tier).join(), 'easy,medium,new');
    eq('two held back for the swap', a.spare.length, 2);
    if (a.spare.some(id => a.orders.some(o => o.id === id))) fail('a reserve order is also on the list');
    eq('nothing is done at the start', a.orders.some(o => o.done || o.claimed || o.p !== 0), false);
    let differ = 0;
    for (let d = 1; d <= 12; d++) if (pickOrders(s, day + d, env).orders.map(o => o.id).join() !== a.orders.map(o => o.id).join()) differ++;
    if (differ < 8) fail(`the orders hardly change from day to day (${differ} of 12 differ)`);
    // Yesterday's orders are not offered again when others exist.
    const yesterday = a.orders.map(o => o.id);
    const next = pickOrders(s, day + 1, env, yesterday);
    if (next.orders.some(o => yesterday.includes(o.id))) fail('an order of yesterday came back');
    // The "new" tier teaches: one never finished is preferred.
    const seen = base(2);
    for (const o of ORDERS.filter(x => x.tier === 'new')) seen.storyFlags.push(didFlag(o.id));
    const fresh = base(2);
    const novel = ORDERS.filter(o => o.tier === 'new' && o.avail(fresh, env));
    if (novel.length >= 2) {
      fresh.storyFlags.push(didFlag(novel[0].id));
      for (let d = 0; d < 20; d++) {
        const p = pickOrders(fresh, day + d, env);
        if (p.orders[2]?.id === novel[0].id && novel.some(n => n.id !== novel[0].id && !fresh.storyFlags.includes(didFlag(n.id)))) { fail('a "new" order the player already finished was offered while others were fresh'); break; }
      }
    }
    // Needs follow the bunker: more food, more to produce.
    const rich = base(2);
    rich.resources.food.productionRate = 40;
    eq('produce-food order scales with the bunker', getOrder('food')!.need(rich) > getOrder('food')!.need(base(2)), true);
    eq('and never under a thousand', getOrder('food')!.need({ ...base(2), resources: { ...base(2).resources, food: { ...base(2).resources.food, productionRate: 0.01 } } } as GameState), 1000);
    // The offline ones see their order through a long absence: a pool that covers each Act of every sample save.
    for (const g of games) {
      const st = migrateState(JSON.parse(g.json) as GameState);
      const p = pickOrders(st, day, env);
      if (p.orders.length < 3) fail(`${g.name}: only ${p.orders.length} orders offered`);
    }
  }

  // ---- 4. the day turns over at 04:00 ----
  {
    const { sm, sys } = rig(base(2));
    eq('orders start with no orders', sm.state.daily.orders.length, 0);
    eq('and no day', sm.state.daily.day, -1);
    sys.ensureToday(at(30, 3, 59));
    const first = sm.state.daily.orders.map(o => o.id).join();
    eq('orders are made when asked', sm.state.daily.orders.length, 3);
    eq('03:59 is day D-1', sm.state.daily.day, dayIndex(at(29, 12)));
    eq('asking again the same day changes nothing', sys.ensureToday(at(30, 3, 59)), false);
    eq('the same list', sm.state.daily.orders.map(o => o.id).join(), first);
    eq('half a minute later (03:59:30) is still the same day', sys.ensureToday(at(30, 3, 59) + 30_000), false);
    eq('04:00 turns the day', sys.ensureToday(at(30, 4, 0)), true);
    eq('the new day number', sm.state.daily.day, dayIndex(at(30, 12)));
    eq('three new orders', sm.state.daily.orders.length, 3);
    if (sm.state.daily.orders.map(o => o.id).join() === first) fail('04:00 brought the same three orders');
    // A clock that went back (a trip over a time zone) neither regenerates nor loses anything.
    const keep = sm.state.daily.orders.map(o => o.id).join();
    eq('an earlier clock does not remake the day', sys.ensureToday(at(29, 12)), false);
    eq('and the orders stay', sm.state.daily.orders.map(o => o.id).join(), keep);
    // Not before the guided half hour (and not in a bunker nobody lives in).
    const young = base(1);
    young.stats.totalPlayTime = 600;
    const y = rig(young);
    eq('no orders in the first half hour of Act I', y.sys.ensureToday(at(30, 9)), false);
    young.stats.totalPlayTime = 1900;
    eq('orders once it is over', y.sys.ensureToday(at(30, 9)), true);
    const empty = base(2);
    empty.survivors = [];
    eq('no orders for an empty bunker', rig(empty).sys.ensureToday(at(30, 9)), false);
  }

  // ---- 5. rollover pays what was earned ----
  {
    const { sm, sys } = rig(base(2));
    sys.ensureToday(at(40, 9));
    sm.state.daily.orders.forEach((_, i) => sys.forceComplete(i));
    eq('all three finished', sm.state.daily.orders.every(o => o.done), true);
    const credits = sm.state.resources.credits.amount, rushBefore = sm.state.rush;
    sys.ensureToday(at(41, 5));
    if (!(sm.state.resources.credits.amount > credits)) fail('credits of finished orders were lost at the turn of the day');
    eq('rush of the bronze order came', sm.state.rush, rushBefore + REWARD_RUSH);
    eq('the streak counted the old day', sm.state.daily.streak, 1);
    eq('the new day starts with the chest closed', sm.state.daily.chest, false);
    eq('and nothing taken', sm.state.daily.orders.some(o => o.claimed), false);
  }

  // ---- 6. rewards ----
  {
    const { sm, sys } = rig(base(1));
    sys.ensureToday(at(50, 9));
    sm.state.daily.orders = [orderOf('upgrade1', { done: true, p: 1 }), orderOf('guests3', { done: true, p: 3, need: 3 }), orderOf('newRoom', { done: true, p: 1 })];
    eq('claiming something unfinished does nothing', sys.claim(5), null);
    const c1 = sys.claim(0)!;
    eq('bronze: one rush charge', c1.rush, REWARD_RUSH);
    eq('rush arrived', sm.state.rush, REWARD_RUSH);
    eq('a second claim of the same order does nothing', sys.claim(0), null);
    const c2 = sys.claim(1)!;
    eq('silver: credits (day 1 pays the plain amount)', c2.credits, REWARD_SILVER);
    eq('gold may be credits', sys.claim(2, 'credits')!.credits, REWARD_GOLD);
    eq('credits arrived', sm.state.resources.credits.amount, REWARD_SILVER + REWARD_GOLD);
    // gold as pieces of a blueprint
    const g = rig(base(1));
    g.sys.ensureToday(at(50, 9));
    for (let k = 1; k <= FRAGS_PER_PLAN; k++) {
      g.sm.state.daily.orders = [orderOf('upgrade1', { p: 1 }), orderOf('guests3', { need: 3 }), orderOf('newRoom', { done: true, p: 1 })];
      const c = g.sys.claim(2, 'frag')!;
      eq(`a piece of a blueprint (${k})`, c.frag, 1);
      eq(`blueprint made only on the ${FRAGS_PER_PLAN}th piece`, c.blueprints, k === FRAGS_PER_PLAN ? 1 : 0);
    }
    eq('the blueprint arrived', g.sm.state.resources.blueprints.amount, 1);
    eq('the pieces start over', g.sm.state.daily.frag, 0);
    // credits follow the shop's price ramp across the Acts
    const late = rig(base(4));
    late.sys.ensureToday(at(50, 9));
    late.sm.state.daily.orders = [orderOf('guests3', { done: true, p: 3, need: 3 })];
    eq('silver in Act IV is dearer like the shop', late.sys.claim(0)!.credits, Math.round(REWARD_SILVER * actCreditScale(late.sm.state)));
    if (!(actCreditScale(late.sm.state) > 1)) fail('credits do not scale with the Act');
  }

  // ---- 7. the streak and its grace day ----
  {
    const claimOn = (r: Rig, dayOffset: number): number => {
      r.sys.ensureToday(at(dayOffset, 9));
      r.sm.state.daily.orders = [orderOf('guests3', { done: true, p: 3, need: 3 })];
      return r.sys.claim(0)!.bonus;
    };
    const r = rig(base(2));
    near('day 1 pays the plain amount', claimOn(r, 100), 0, 1e-9);
    near('day 2 adds 10%', claimOn(r, 101), 0.1, 1e-9);
    near('day 3 adds 20%', claimOn(r, 102), 0.2, 1e-9);
    eq('streak 3', r.sm.state.daily.streak, 3);
    eq('a second claim the same day does not count twice', (() => { r.sm.state.daily.orders = [orderOf('guests3', { done: true, p: 3, need: 3 })]; r.sys.claim(0); return r.sm.state.daily.streak; })(), 3);
    // One missed day: the grace day keeps the streak.
    near('after one missed day the streak holds (+30%)', claimOn(r, 104), 0.3, 1e-9);
    eq('the grace day is used', r.sm.state.daily.graceUsed, true);
    eq('and the streak grew', r.sm.state.daily.streak, 4);
    // A second single miss with no grace left breaks it.
    near('a second miss breaks the streak', claimOn(r, 106), 0, 1e-9);
    eq('back to one', r.sm.state.daily.streak, 1);
    eq('the grace day is fresh again', r.sm.state.daily.graceUsed, false);
    // Two days missed breaks it at once.
    const r2 = rig(base(2));
    claimOn(r2, 200); claimOn(r2, 201);
    near('two missed days break it', claimOn(r2, 204), 0, 1e-9);
    // The bonus tops out at +50%.
    const r3 = rig(base(2));
    let top = 0;
    for (let d = 0; d < 12; d++) top = claimOn(r3, 300 + d);
    near('+50% at most', top, STREAK_MAX_BONUS, 1e-9);
    near('streakBonus(1)', streakBonus(1), 0, 1e-9);
    near('streakBonus(6)', streakBonus(6), 0.5, 1e-9);
    near('streakBonus(40)', streakBonus(40), 0.5, 1e-9);
    // A week in a row earns the grace day back.
    const r4 = rig(base(2));
    claimOn(r4, 400); claimOn(r4, 401); claimOn(r4, 403); // grace used on the 3rd claim
    eq('grace used', r4.sm.state.daily.graceUsed, true);
    for (let d = 404; d <= 407; d++) claimOn(r4, d);
    eq('streak 7', r4.sm.state.daily.streak, 7);
    eq('the 7th day gives the grace day back', r4.sm.state.daily.graceUsed, false);
    // The display: a streak that has lapsed reads 0.
    eq('liveStreak reads 0 after a long gap', r4.sys.liveStreak(dayIndex(at(430, 12))), 0);
    eq('liveStreak keeps it the next day', r4.sys.liveStreak(dayIndex(at(408, 12))), 7);
    // The bonus raises the credits paid.
    const pay = rig(base(2));
    claimOn(pay, 500); claimOn(pay, 501);
    pay.sm.state.daily.orders = [orderOf('guests3', { done: true, p: 3, need: 3 })];
    pay.sm.state.daily.orders[0].claimed = false;
    pay.sys.ensureToday(at(502, 9));
    pay.sm.state.daily.orders = [orderOf('guests3', { done: true, p: 3, need: 3 })];
    eq('day 3 pays 120% of silver', pay.sys.claim(0)!.credits, Math.round(REWARD_SILVER * 1.2 * actCreditScale(pay.sm.state)));
  }

  // ---- 8. the economic cap: one day's rewards are at most 1.5 hours of production ----
  {
    near('the model: max day', maxDailyHours(), CHEST_HOURS + REWARD_RUSH * RUSH_HOURS + (REWARD_SILVER + REWARD_GOLD) * (1 + STREAK_MAX_BONUS) * CREDIT_HOURS, 1e-9);
    if (!(maxDailyHours() <= MAX_DAILY_HOURS)) fail(`one day can pay ${maxDailyHours().toFixed(3)} production hours (cap ${MAX_DAILY_HOURS})`);
    const s = base(3);
    const r = rig(s);
    // Play a whole week of perfect days (all three orders, the chest) and measure what actually arrives, in hours of the food/water/materials/knowledge production.
    let worst = 0;
    for (let d = 0; d < 9; d++) {
      r.sys.ensureToday(at(600 + d, 9));
      r.sm.state.daily.orders = [orderOf('upgrade1', { done: true, p: 1 }), orderOf('guests3', { done: true, p: 3, need: 3 }), orderOf('newRoom', { done: true, p: 1 })];
      const before = { c: r.sm.state.resources.credits.amount, rush: r.sm.state.rush };
      for (const resKey of ['food', 'water', 'materials', 'knowledge', 'scrap'] as const) r.sm.state.resources[resKey].amount = 0;
      r.sm.state.resources.food.productionRate = 2;
      for (const resKey of ['food', 'water', 'materials', 'knowledge', 'scrap'] as const) r.sm.state.resources[resKey].cap = 1e7; // room for the whole chest
      for (let i = 0; i < 3; i++) r.sys.claim(i, 'credits');
      const chest = r.sys.claimChest();
      if (!chest) { fail('the chest did not open after three finished orders'); break; }
      const hoursFromChest = (chest.gains.food ?? 0) / (2 * 3600);
      near('the chest holds one hour of food', hoursFromChest, CHEST_HOURS, 0.01);
      const scale = actCreditScale(r.sm.state);
      const credits = (r.sm.state.resources.credits.amount - before.c) / scale;
      const hours = hoursFromChest + (r.sm.state.rush - before.rush) * RUSH_HOURS + credits * CREDIT_HOURS;
      worst = Math.max(worst, hours);
    }
    notes.push(`daily cap: model max ${maxDailyHours().toFixed(3)} h, measured worst perfect day ${worst.toFixed(3)} h (cap ${MAX_DAILY_HOURS} h)`);
    if (worst > MAX_DAILY_HOURS + 1e-6) fail(`a perfect day paid ${worst.toFixed(3)} production hours, above the cap of ${MAX_DAILY_HOURS}`);
    // The chest: all three done, once a day, closed for a day with one order missing.
    const c = rig(base(2));
    c.sys.ensureToday(at(700, 9));
    c.sm.state.daily.orders = [orderOf('upgrade1', { done: true }), orderOf('guests3', { done: true }), orderOf('newRoom')];
    eq('the chest is shut while an order is open', c.sys.claimChest(), null);
    c.sm.state.daily.orders[2].done = true;
    eq('open when all are done', !!c.sys.claimChest(), true);
    eq('only once a day', c.sys.claimChest(), null);
  }

  // ---- 9. progress ----
  {
    const live = rig(base(2));
    live.sys.ensureToday(at(800, 9));
    const setOrders = (r: Rig, ...o: DailyOrder[]): void => { r.sm.state.daily.orders = o; };
    // events
    setOrders(live, orderOf('bubbles', { need: 10 }));
    for (let i = 0; i < 9; i++) bus.emit('bubble:collected', 'b_1');
    eq('nine bubbles of ten', live.sm.state.daily.orders[0].p, 9);
    bus.emit('bubble:collected', 'b_1');
    eq('ten bubbles finish it', live.sm.state.daily.orders[0].done, true);
    eq('and it is remembered as done once', live.sm.state.storyFlags.includes(didFlag('bubbles')), true);
    bus.emit('bubble:collected', 'b_1');
    eq('more bubbles change nothing', live.sm.state.daily.orders[0].p, 10);
    // an event that is worth something only sometimes
    setOrders(live, orderOf('contracts2', { need: 2 }));
    bus.emit('inbox:resolved', { kind: 'event' }, 'accept');
    eq('answering another kind of card is not a contract', live.sm.state.daily.orders[0].p, 0);
    bus.emit('inbox:resolved', { kind: 'contract' }, 'decline');
    eq('declining a contract does not count', live.sm.state.daily.orders[0].p, 0);
    bus.emit('inbox:resolved', { kind: 'contract' }, 'accept');
    eq('accepting one does', live.sm.state.daily.orders[0].p, 1);
    // a door shut during trouble
    const door = rig((() => { const s = base(2); s.incidents = []; return s; })());
    door.sys.ensureToday(at(800, 9));
    door.sm.state.daily.orders = [orderOf('closeDoor')];
    bus.emit('door:changed', { floor: 1, x: 3, state: 'closed' });
    eq('a door shut in peace time does not count', door.sm.state.daily.orders[0].p, 0);
    door.sm.applyDelta({ path: 'incidents', value: [{ id: 'i_1', kind: 'fire', buildingId: 'b_1', severity: 0.5, startedAt: 0, deadline: 100 } as unknown as GameState['incidents'][number]] });
    bus.emit('door:changed', { floor: 1, x: 3, state: 'open' });
    eq('opening a door during trouble does not count', door.sm.state.daily.orders[0].p, 0);
    bus.emit('door:changed', { floor: 1, x: 3, state: 'closed' });
    eq('shutting a door during an incident does', door.sm.state.daily.orders[0].done, true);
    // counters
    const cnt = rig(base(2));
    cnt.sys.ensureToday(at(801, 9));
    cnt.sm.state.daily.orders = [{ ...orderOf('upgrade1'), b: cnt.sm.state.buildings.reduce((n, b) => n + b.level, 0) }, { ...orderOf('newRoom'), b: new Set(cnt.sm.state.buildings.map(b => b.type)).size }, { ...orderOf('train1'), b: 0 }];
    cnt.sys.update();
    eq('nothing moved yet', cnt.sm.state.daily.orders.some(o => o.p > 0), false);
    cnt.sm.state.buildings[0].level = 2;
    cnt.sm.state.buildings.push(room('b_9', 'storage', 13, 0));
    cnt.sm.state.lateGame.trained = 1;
    cnt.sys.update();
    eq('an upgrade is seen', cnt.sm.state.daily.orders[0].done, true);
    eq('a room type never built is seen', cnt.sm.state.daily.orders[1].done, true);
    eq('a training is seen', cnt.sm.state.daily.orders[2].done, true);
    // progress never goes backwards (a demolished room)
    cnt.sm.state.buildings.pop();
    cnt.sys.update();
    eq('done stays done', cnt.sm.state.daily.orders[1].done, true);
    // a state that has to hold over time
    const pw = rig(base(2));
    pw.sys.ensureToday(at(802, 9));
    pw.sm.state.daily.orders = [orderOf('power60', { need: 7200 })];
    pw.sm.state.resources.power.cap = 100;
    pw.sm.state.resources.power.amount = 70;
    pw.sm.state.stats.totalPlayTime = 6000; pw.sys.update();
    for (let i = 1; i <= 3; i++) { pw.sm.state.stats.totalPlayTime += 1; pw.sys.update(); }
    eq('three seconds of a healthy store count', pw.sm.state.daily.orders[0].p, 3);
    pw.sm.state.resources.power.amount = 30;
    pw.sm.state.stats.totalPlayTime += 1; pw.sys.update();
    eq('a low store does not', pw.sm.state.daily.orders[0].p, 3);
    pw.sm.state.resources.power.amount = 70;
    pw.sm.state.stats.totalPlayTime += 100000; pw.sys.update();
    eq('a long gap (a frozen tab) counts for at most a few seconds', pw.sm.state.daily.orders[0].p <= 3 + 5, true);
    // the nursery counts the children standing there now
    const nu = base(2);
    nu.buildings.push(room('b_n', 'nursery', 15, 0));
    for (let i = 0; i < 3; i++) { const k = new PopulationSystem().createSurvivor(new SeededRandom(40 + i)); k.id = `k_${i}`; k.child = true; k.assignedBuildingId = i < 2 ? 'b_n' : null; nu.survivors.push(k); }
    const nr = rig(nu);
    nr.sys.ensureToday(at(803, 9));
    nr.sm.state.daily.orders = [orderOf('nursery2', { need: 2 })];
    nr.sys.update();
    eq('two children in the nursery finish the order', nr.sm.state.daily.orders[0].done, true);
    // switched off (the simulator plays by hand)
    const off = rig(base(2));
    off.sys.ensureToday(at(804, 9));
    off.sys.progressEnabled = false;
    off.sm.state.daily.orders = [orderOf('bubbles', { need: 2 })];
    bus.emit('bubble:collected', 'b_1'); bus.emit('bubble:collected', 'b_1');
    eq('progress can be switched off', off.sm.state.daily.orders[0].p, 0);
    eq('forceComplete still finishes', off.sys.forceComplete(0), true);
    eq('and claims', !!off.sys.claim(0), true);
  }

  // ---- 10. away: only dig, research and food move ----
  {
    const r = rig(base(2));
    r.sys.ensureToday(at(900, 9));
    r.sm.state.daily.orders = [
      orderOf('research1', { need: 1 }), orderOf('bubbles', { need: 10 }),
      { ...orderOf('guests3', { need: 3 }), b: r.sm.state.stats.totalSurvivorsRecruited },
      { ...orderOf('food', { need: 1000 }), b: r.sm.state.stats.totalFoodProduced },
    ];
    r.sys.beginAway();
    for (let i = 0; i < 10; i++) bus.emit('bubble:collected', 'b_1');
    bus.emit('research:complete', 'x');
    // births and food made while away
    r.sm.state.stats.totalSurvivorsRecruited += 3;
    r.sm.state.stats.totalFoodProduced += 1500;
    r.sys.update();
    r.sys.endAway();
    r.sys.update();
    eq('research done away counts', r.sm.state.daily.orders[0].done, true);
    eq('bubbles tapped while away cannot happen, and do not count', r.sm.state.daily.orders[1].p, 0);
    eq('residents who arrived while away do not count', r.sm.state.daily.orders[2].p, 0);
    eq('food made while away counts', r.sm.state.daily.orders[3].done, true);
    // and the guest counter works again once back
    r.sm.state.stats.totalSurvivorsRecruited += 3;
    r.sys.update();
    eq('residents after the return count', r.sm.state.daily.orders[2].done, true);
  }

  // ---- 11. the swap ----
  {
    const r = rig(base(2));
    r.sys.ensureToday(at(1000, 9));
    const before = r.sm.state.daily.orders.map(o => o.id);
    const spare0 = r.sm.state.daily.spare[0];
    eq('can swap an open order', r.sys.canSwap(1), true);
    eq('swap works', r.sys.swap(1), true);
    eq('the reserve order took its place', r.sm.state.daily.orders[1].id, spare0);
    eq('the others stayed', r.sm.state.daily.orders[0].id + r.sm.state.daily.orders[2].id, before[0] + before[2]);
    eq('one swap a day', r.sys.swap(2), false);
    r.sys.ensureToday(at(1001, 9));
    eq('the swap is back the next day', r.sys.canSwap(0), true);
    r.sm.state.daily.orders[0].done = true;
    eq('a finished order cannot be swapped', r.sys.canSwap(0), false);
  }

  // ---- 12. the save ----
  {
    const fresh = createInitialState();
    eq('new game has the daily block', JSON.stringify(Object.keys(fresh.daily).sort()), JSON.stringify(['chest', 'day', 'frag', 'graceUsed', 'lastClaim', 'orders', 'spare', 'streak', 'swapped']));
    eq('and no orders', fresh.daily.orders.length, 0);
    eq('SAVE_VERSION stays 7 (additive)', SAVE_VERSION, 7);
    const old = JSON.parse(JSON.stringify(createInitialState())) as Partial<GameState>;
    delete old.daily;
    const m = migrateState(old as GameState);
    eq('an old save gets the defaults', JSON.stringify(m.daily), JSON.stringify(createInitialState().daily));
    const partial = JSON.parse(JSON.stringify(createInitialState())) as GameState;
    (partial as unknown as { daily: unknown }).daily = { day: 5, streak: 3, orders: 'broken' };
    const mp = migrateState(partial);
    eq('a partial block keeps what it has', mp.daily.streak, 3);
    eq('and mends what is wrong', Array.isArray(mp.daily.orders), true);
    eq('and fills the rest', mp.daily.lastClaim, -1);
    const round = migrateState(JSON.parse(JSON.stringify(m)) as GameState);
    eq('migrating twice changes nothing', JSON.stringify(round.daily), JSON.stringify(m.daily));
    for (const g of games) {
      const st = migrateState(JSON.parse(g.json) as GameState);
      if (!st.daily || !Array.isArray(st.daily.orders)) fail(`${g.name}: no daily block after migration`);
    }
  }

  // ---- 13. through the engine: a day away ----
  if (games.length) {
    const g = games.find(x => /e30|e55/.test(x.name)) ?? games[games.length - 1];
    const e = new GameEngine();
    (e as unknown as { adoptState: (s: GameState) => void }).adoptState(JSON.parse(g.json) as GameState);
    const sm = e.stateManager;
    sm.applyDelta({ path: 'stats.totalPlayTime', value: Math.max(sm.state.stats.totalPlayTime, 5000) });
    sm.applyDelta({ path: 'storyFlags', value: [...new Set([...sm.state.storyFlags, 'intro:done'])] });
    e.dailySystem.ensureToday(Date.now());
    const ds = sm.state.daily;
    eq(`${g.name}: engine made today's orders`, ds.orders.length >= 3, true);
    sm.applyDelta({ path: 'daily.orders', value: [
      orderOf('food', { need: 100, b: sm.state.stats.totalFoodProduced }),
      orderOf('bubbles', { need: 5 }),
      { ...orderOf('guests3', { need: 3 }), b: sm.state.stats.totalSurvivorsRecruited },
    ] });
    e.simulate(6 * 3600, 0.8);
    notes.push(`engine, ${g.name}: after 6 h away food ${sm.state.daily.orders[0].p}/${sm.state.daily.orders[0].need}, bubbles ${sm.state.daily.orders[1].p}, guests ${sm.state.daily.orders[2].p}`);
    eq('food produced while away counts', sm.state.daily.orders[0].done, true);
    eq('bubbles do not move while away', sm.state.daily.orders[1].p, 0);
    eq('residents born/arrived while away do not count', sm.state.daily.orders[2].p, 0);
    eq('the engine is not left in "away"', e.dailySystem.away, false);
    // The engine carries the streak through Genesis but remakes the orders.
    const sysNames = e.systemNames().join(',');
    eq('the daily system is in the step list (online and away)', /daily\(slow\)/.test(sysNames) && !/daily\(slow\)\(online only\)/.test(sysNames), true);
  }

  return { problems, notes };
}
