// [plan4:GP-8 #7] The Foreman's 'sealOnAlarm' order: shuts the doors around a fire / epidemic / raid, opens only its own doors afterwards,
// leaves a door the player changed alone, freezes in a blackout, and forgets its list when switched off. Run by foreman-test.mjs.
import { StateManager } from '../../src/core/StateManager';
import { createInitialState, type BuildingInstance, type GameState } from '../../src/core/GameState';
import { ForemanSystem, costShare, foremanPolicy, RAID_FIGHT_DEFAULT } from '../../src/systems/ForemanSystem';
import { RAID_BAND, TRIBUTE_SHARE, bunkerDefense, raidStrength, raidTribute, winChance } from '../../src/systems/EventSystem'; // [phase4b]
import { exposureDrivers, hideStoresTrim } from '../../src/systems/ThreatSystem'; // [phase4b]
import { hideStops, incidentBlocks } from '../../src/data/incidents'; // [phase4b]
import { getDoor, setDoor } from '../../src/systems/doors';

const room = (id: string, x: number, floor: number): BuildingInstance => ({
  id, type: 'quarters', level: 1, position: { x, y: 0, floor }, assignedSurvivorIds: [], constructionProgress: 1, constructionTotal: 1, isConstructing: false, specialization: null,
});

export function foremanChecks(): { problems: string[] } {
  const problems: string[] = [];
  const eq = (what: string, got: unknown, want: unknown): void => { if (got !== want) problems.push(`${what}: got ${String(got)}, wanted ${String(want)}`); };
  const make = (): { sm: StateManager; f: ForemanSystem } => {
    const s = createInitialState();
    s.ruins = []; s.incidents = [];
    s.longGame!.meta.act = 2;
    s.buildings = [room('b_1', 4, 2)];
    for (const r of Object.values(s.resources)) r.amount = r.cap = 500;
    s.powerRatio = 1;
    setDoor(s, 2, 4, 'open'); // the west edge of b_1
    setDoor(s, 2, 9, 'open'); // far from it
    const sm = new StateManager();
    sm.loadState(s);
    const stub = null as never;
    return { sm, f: new ForemanSystem(sm, stub, stub, stub, stub, stub, stub) };
  };
  const fire = (s: GameState): void => { s.incidents.push({ id: 'i_1', kind: 'fire', buildingId: 'b_1', severity: 0.3, progress: 0, startedAt: 0 }); };

  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    fire(st());
    f.update(5);
    eq('order off: nothing shut', getDoor(st(), 2, 4), 'open');
    f.set('sealOnAlarm', true);
    eq('on + a fire: the door at the room shuts at once', getDoor(st(), 2, 4), 'closed');
    eq('a door far from the fire stays open', getDoor(st(), 2, 9), 'open');
    eq('the list holds the door it shut', (st().longGame!.foreman.sealed ?? []).join(','), '2:4');
    st().incidents = [];
    f.update(5);
    eq('trouble over: its door is open again', getDoor(st(), 2, 4), 'open');
    eq('the list is empty again', (st().longGame!.foreman.sealed ?? []).length, 0);
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    f.set('sealOnAlarm', true);
    fire(st());
    f.update(5);
    eq('shut by the order', getDoor(st(), 2, 4), 'closed');
    setDoor(st(), 2, 4, 'sealed'); // the player welded it
    st().incidents = [];
    f.update(5);
    eq('a door the player changed is left as the player set it', getDoor(st(), 2, 4), 'sealed');
    eq('and it is off the list', (st().longGame!.foreman.sealed ?? []).length, 0);
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    st().resources.power.amount = 0;
    st().powerRatio = 0.2;
    f.set('sealOnAlarm', true);
    fire(st());
    f.update(5);
    eq('blackout: doors cannot move', getDoor(st(), 2, 4), 'open');
    eq('blackout: the report says so', f.last.sealOnAlarm?.key, 'sealBlackout');
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    f.set('sealOnAlarm', true);
    st().danger.disasters = [{ id: 'd_1', kind: 'epidemic', buildingId: null, startedAt: 0, deadline: 9999 }];
    f.update(5);
    eq('epidemic: every open door shuts', `${getDoor(st(), 2, 4)}${getDoor(st(), 2, 9)}`, 'closedclosed');
    f.set('sealOnAlarm', false);
    eq('switched off: the list is cleared', (st().longGame!.foreman.sealed ?? []).length, 0);
    st().danger.disasters = [];
    f.update(5);
    eq('switched off: nothing is reopened later', getDoor(st(), 2, 4), 'closed');
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    st().longGame!.meta.act = 1;
    fire(st());
    f.set('sealOnAlarm', true);
    f.update(5);
    eq('Act I: the Foreman takes no orders', getDoor(st(), 2, 4), 'open');
  }
  // ---- [phase4b] the policies, the raid odds, the toll, the Exposure levers and hiding ----
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    const p0 = foremanPolicy(st());
    eq('policy default: fight at', p0.fightAt, RAID_FIGHT_DEFAULT);
    eq('policy default: otherwise', p0.otherwise, 'pay');
    eq('policy default: priority', p0.priority, 'even');
    eq('policy default: auto-pay off', p0.autoPay, 0);
    st().longGame!.meta.act = 1; // (the test has no crew systems: "act first" would staff at once from Act II)
    f.setPolicy({ fightAt: 0.65, otherwise: 'hide', priority: 'act', autoPay: 0.05 });
    st().longGame!.meta.act = 2;
    const p1 = foremanPolicy(st());
    eq('policy set: all four kept', `${p1.fightAt}|${p1.otherwise}|${p1.priority}|${p1.autoPay}`, '0.65|hide|act|0.05');
    f.setPolicy({ fightAt: 7 });
    eq('policy: odds line clamped to 1', foremanPolicy(st()).fightAt, 1);
    eq('the chores run without a switch', f.isOn(st(), 'staff') && f.isOn(st(), 'deposit') && f.isOn(st(), 'train'), true);
    eq('cost share: the worst store', costShare(st(), { food: 50, water: 100 }), 0.2);
  }
  {
    eq('odds: an even fight is 50%', Math.round(winChance(100, 100) * 100), 50);
    eq('odds: never certain', winChance(1000, 1) <= 0.97 && winChance(1, 1000) >= 0.03, true);
    eq('odds: more defense, better odds', winChance(120, 100) > winChance(110, 100), true);
    const { sm } = make();
    const st = (): GameState => sm.state as GameState;
    st().era = 2;
    const def = bunkerDefense(st());
    for (const roll of [0, 0.5, 1]) {
      const s = raidStrength(st(), roll);
      const lo = Math.floor(def * RAID_BAND[0]) - 1, hi = Math.ceil(def * RAID_BAND[1]) + 1;
      if (def >= 30 && (s < lo || s > hi)) problems.push(`raid strength ${s} outside ${lo}-${hi} of defense ${def} (roll ${roll})`);
    }
    st().resources.materials.amount = 1000;
    eq('toll: a share of the Act currency', raidTribute(st()).materials, Math.round(1000 * TRIBUTE_SHARE));
  }
  {
    const { sm } = make();
    const st = (): GameState => sm.state as GameState;
    for (const r of Object.values(st().resources)) { r.cap = 1000; r.amount = 1000; }
    const before = exposureDrivers(st()).total;
    eq('hide the stores lowers exposure', exposureDrivers(st(), { hideStores: true }).total < before, true);
    eq('radio silence never raises it', exposureDrivers(st(), { radioSilence: true }).total <= before, true);
    const trim = hideStoresTrim(st());
    eq('hide the stores: food above 60% moves', trim.from.food, 400);
    eq('hide the stores: the Act currency stays', trim.from.materials, undefined);
    const shop: BuildingInstance = { ...room('b_2', 1, 1), type: 'workshop' };
    const farm: BuildingInstance = { ...room('b_3', 6, 1), type: 'farm' };
    eq('hiding stops a workshop', hideStops(shop), true);
    eq('hiding never stops a farm', hideStops(farm), false);
    st().buildings.push(shop);
    st().danger.hiddenUntil = Date.now() + 60_000;
    eq('while hidden the workshop stands still', incidentBlocks(st(), shop), true);
    st().danger.hiddenUntil = Date.now() - 1;
    eq('after the hour it works again', incidentBlocks(st(), shop), false);
  }
  return { problems };
}
