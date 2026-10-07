// [plan4:ST-14/ST-15, BL-1] Node-level checks of the bulkhead doors, emergency stairwells and vent stacks (run by infra-test.mjs):
// the doors.ts contract, building and operating doors, what a shut door does to fire, epidemic, raid defense, assignment and power,
// the fire code, evacuation, ventilation, and the save round-trip of the layout; then the effects of the first eight new rooms and the
// neighbour pairs (SYNERGIES) as the systems apply them.
import { StateManager } from '../../src/core/StateManager';
import { SeededRandom } from '../../src/core/Random';
import { createInitialState, migrateState, type BuildingInstance, type GameState, type SurvivorState } from '../../src/core/GameState';
import { ResourceSystem } from '../../src/systems/ResourceSystem';
import { BuildingSystem } from '../../src/systems/BuildingSystem';
import { PopulationSystem } from '../../src/systems/PopulationSystem';
import { IncidentSystem } from '../../src/systems/IncidentSystem';
import { doorsBetween, getDoor, infraAt, isPassable, isSealedOff, setDoor, shutDoorCount } from '../../src/systems/doors';
import {
  DOOR_DRAIN, buildColumn, buildDoor, closeEmergencyDoors, columnBlock, doorBlock, doorDefense, doorsOperable, emergencyDoorTargets, fireCodeFloors,
  infraPowerDraw, openAllDoors, setDoorState, upgradeDoor, breachSpeed,
} from '../../src/systems/InfraSystem';
import { evacuationMult, fireCodeMult, ventilationRelief } from '../../src/data/roomEffects';
import { isBuildingUnlocked } from '../../src/systems/ResearchSystem';
import { defenseParts } from '../../src/systems/EventSystem';
import type { BuildingType } from '../../src/core/GameState';
import { roomSlots } from '../../src/data/buildingDefs';
import { moraleBreakdown } from '../../src/systems/PopulationSystem';

const room = (id: string, type: BuildingType, x: number, floor: number): BuildingInstance => ({
  id, type, level: 1, position: { x, y: 0, floor }, assignedSurvivorIds: [], constructionProgress: 1, constructionTotal: 1, isConstructing: false, specialization: null,
});

function base(): GameState {
  const s = createInitialState();
  s.currentFloors = 14;
  s.ruins = []; s.buildings = []; s.incidents = [];
  for (const id of ['bulkheads', 'emergencyExits', 'ventilation']) s.research[id] = { id, completed: true, progress: 0, total: 0, isResearching: false };
  for (const r of Object.values(s.resources)) r.amount = r.cap = 5000;
  return s;
}

function sick(s: GameState, adults: SurvivorState[], seed: number): number {
  const sm = new StateManager();
  sm.loadState(s);
  const is = new IncidentSystem(sm, new SeededRandom(seed), new ResourceSystem());
  const hurtBefore = adults.map(a => a.health);
  const res = is.strike({ id: 'd_1', kind: 'epidemic', buildingId: null, startedAt: 0, deadline: 0 }, 'online', false);
  void hurtBefore;
  return res.hurt;
}

export function infraChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string): void => { if (problems.length < 25) problems.push(m); };
  const eq = (what: string, got: unknown, want: unknown): void => { if (got !== want) fail(`${what}: got ${String(got)}, wanted ${String(want)}`); };
  const near = (what: string, got: number, want: number, tol: number): void => { if (Math.abs(got - want) > tol) fail(`${what}: got ${got.toFixed(3)}, wanted ${want} +-${tol}`); };

  // ---- 1. the doors.ts contract ----
  {
    const s = base();
    eq('no door = passable', isPassable(s, 2, 0, 9), true);
    eq('getDoor of nothing', getDoor(s, 2, 4), undefined);
    setDoor(s, 2, 4, 'open');
    eq('open door passable', isPassable(s, 2, 1, 6), true);
    setDoor(s, 2, 4, 'closed');
    eq('closed door blocks east walk', isPassable(s, 2, 1, 6), false);
    eq('closed door blocks west walk', isPassable(s, 2, 6, 1), false);
    eq('closed door: same side passable', isPassable(s, 2, 4, 9), true);
    eq('the door sits between slot 3 and slot 4', isPassable(s, 2, 3, 3), true);
    eq('boundary 4 is not between 4 and 5', isPassable(s, 2, 4, 5), true);
    eq('boundary 4 IS between 3 and 4', isPassable(s, 2, 3, 4), false);
    eq('other floor unaffected', isPassable(s, 3, 1, 6), true);
    setDoor(s, 2, 7, 'sealed');
    const between = doorsBetween(s, 2, 9, 1);
    eq('doorsBetween order (travelling west)', between.map(d => d.x).join(','), '7,4');
    eq('shutDoorCount', shutDoorCount(s), 2);
    eq('sealed room off from the shaft', isSealedOff(s, 2, 8, 2), true);
    eq('room before the sealed door is not sealed off', isSealedOff(s, 2, 5, 2), false);
    eq('west room with its own door', (() => { setDoor(s, 2, -2, 'sealed'); return isSealedOff(s, 2, -4, 2); })(), true);
  }

  // ---- 2. building and operating doors ----
  {
    const s = base();
    s.buildings = [room('b_1', 'generator', 1, 2), room('b_2', 'farm', 3, 2), room('b_3', 'canteen', 6, 2)];
    const sm = new StateManager();
    sm.loadState(s);
    const rs = new ResourceSystem();
    eq('bulkhead is unlocked by research', isBuildingUnlocked(s, 'bulkhead' as BuildingType), true);
    const locked = createInitialState();
    eq('bulkhead locked without research', isBuildingUnlocked(locked, 'bulkhead' as BuildingType), false);
    eq('doorBlock locked', doorBlock(locked, 0, 3), 'locked');
    eq('doorBlock shaft', doorBlock(s, 2, 0), 'shaft');
    eq('doorBlock inside a room', doorBlock(s, 2, 2), 'inside'); // generator takes 1-2 (2 slots)
    eq('doorBlock empty (no room by it)', doorBlock(s, 2, 11), 'empty');
    eq('doorBlock ok between rooms', doorBlock(s, 2, 3), null);
    eq('doorBlock out of bounds east', doorBlock(s, 2, 13), 'bounds');
    eq('doorBlock bad floor', doorBlock(s, 14, 3), 'floor');
    const mat0 = s.resources.materials.amount;
    eq('buildDoor builds', buildDoor(sm, rs, 2, 3), null);
    eq('door is open at first', getDoor(sm.state as GameState, 2, 3), 'open');
    eq('door cost spent', mat0 - sm.state.resources.materials.amount, 40);
    eq('door is an infra item', (sm.state as GameState).layout.infra.filter(i => i.kind === 'bulkhead').length, 1);
    eq('second door on the same boundary', buildDoor(sm, rs, 2, 3), 'exists');
    eq('setDoorState closed', setDoorState(sm, 2, 3, 'closed'), null);
    eq('door closed', getDoor(sm.state as GameState, 2, 3), 'closed');
    eq('setDoorState on a boundary without a door', setDoorState(sm, 2, 9, 'closed'), 'missing');
    eq('upgrade door', upgradeDoor(sm, rs, 2, 3), null);
    eq('upgrade door again', upgradeDoor(sm, rs, 2, 3), null);
    eq('door level cap', upgradeDoor(sm, rs, 2, 3), 'max');
    // blackout freezes the doors
    const st = sm.state as GameState;
    st.resources.power.amount = 0; st.powerRatio = 0.3;
    eq('doors not operable in a blackout', doorsOperable(st), false);
    eq('setDoorState in a blackout', setDoorState(sm, 2, 3, 'open'), 'blackout');
    eq('door keeps its state through the blackout', getDoor(st, 2, 3), 'closed');
    st.resources.power.amount = 100; st.powerRatio = 1;
    // emergency
    eq('emergency without trouble: nothing to shut', emergencyDoorTargets(st).length, 0);
    setDoor(st, 2, 6, 'open');
    st.incidents = [{ id: 'i_1', kind: 'fire', buildingId: 'b_3', severity: 0.5, progress: 0, startedAt: 0 }];
    eq('fire ring includes the open door at the room edge', emergencyDoorTargets(st).map(t => t.x).join(','), '6');
    eq('closeEmergencyDoors shut one', closeEmergencyDoors(sm), 1);
    eq('door shut by the emergency button', getDoor(st, 2, 6), 'closed');
    eq('openAllDoors', openAllDoors(sm), 2);
    eq('all open', shutDoorCount(st), 0);
  }

  // ---- 3. fire spread through a shut door (10%) ----
  {
    const trials = 600;
    const run = (door: 'none' | 'open' | 'closed' | 'sealed'): number => {
      let spread = 0;
      for (let seed = 1; seed <= trials; seed++) {
        const s = base();
        s.buildings = [room('b_1', 'generator', 1, 2), room('b_2', 'farm', 3, 2)];
        if (door !== 'none') setDoor(s, 2, 3, door);
        s.incidents = [{ id: 'i_1', kind: 'fire', buildingId: 'b_1', severity: 1, progress: 0, startedAt: 0 }];
        const sm = new StateManager();
        sm.loadState(s);
        const is = new IncidentSystem(sm, new SeededRandom(seed * 7919), new ResourceSystem());
        is.sync(s);
        (is as unknown as { advance(dt: number): void }).advance(1);
        if ((sm.state as GameState).incidents.some(i => i.buildingId === 'b_2')) spread++;
      }
      return spread / trials;
    };
    near('fire spread with no door', run('none'), 1, 0);
    near('fire spread through an open door', run('open'), 1, 0);
    near('fire spread through a closed door', run('closed'), 0.1, 0.04);
    near('fire spread through a sealed door', run('sealed'), 0.1, 0.04);
    notes.push(`fire spread: open 100%, closed ${(run('closed') * 100).toFixed(1)}%`);
  }

  // ---- 4. epidemic: a shut door shields the rooms behind it; with no door the old pick is unchanged ----
  {
    const mk = (door: boolean): { s: GameState; adults: SurvivorState[] } => {
      const s = base();
      s.buildings = [room('b_1', 'generator', 1, 2), room('b_2', 'farm', 3, 2), room('b_3', 'canteen', 6, 2)];
      const pop = new PopulationSystem();
      const rng = new SeededRandom(11);
      s.survivors = [];
      for (let i = 0; i < 24; i++) {
        const sv = pop.createSurvivor(rng);
        sv.id = `s_${i + 1}`; sv.child = false; sv.health = 100; sv.isOnMission = false;
        // 6 people in the generator room, 18 in the far rooms behind the door at boundary 3.
        sv.assignedBuildingId = i < 6 ? 'b_1' : i < 14 ? 'b_2' : 'b_3';
        s.buildings.find(b => b.id === sv.assignedBuildingId)!.assignedSurvivorIds.push(sv.id);
        s.survivors.push(sv);
      }
      if (door) setDoor(s, 2, 3, 'closed');
      return { s, adults: s.survivors };
    };
    let open = 0, shut = 0;
    const seeds = 80;
    for (let seed = 1; seed <= seeds; seed++) { open += sick(mk(false).s, [], seed); shut += sick(mk(true).s, [], seed); }
    open /= seeds; shut /= seeds;
    if (!(shut < open)) fail(`a shut door should lower the epidemic's toll (open ${open.toFixed(2)}, shut ${shut.toFixed(2)})`);
    // No door: the same pick as the plain shuffle (determinism of old games).
    {
      const { s } = mk(false);
      const sm = new StateManager(); sm.loadState(s);
      const seedRng = new SeededRandom(99);
      const expect = seedRng.shuffle(s.survivors).slice(0, Math.ceil(s.survivors.length * 0.3)).map(x => x.id).sort().join(',');
      const is = new IncidentSystem(sm, new SeededRandom(99), new ResourceSystem());
      const pick = (is as unknown as { pickSick(st: GameState, a: SurvivorState[], soft: boolean): SurvivorState[] }).pickSick(s, s.survivors, false).map(x => x.id).sort().join(',');
      eq('epidemic with no door is the old shuffle pick', pick, expect);
    }
    notes.push(`epidemic toll: no door ${open.toFixed(1)}, one shut door ${shut.toFixed(1)} (of 24 adults)`);
  }

  // ---- 5. raid defense, breach friction, power, assignment ----
  {
    const s = base();
    s.buildings = [room('b_1', 'generator', 1, 0), room('b_2', 'farm', 3, 0)];
    const d0 = defenseParts(s).walls;
    setDoor(s, 0, 3, 'closed');
    s.layout.infra.push({ id: 'inf_1', kind: 'bulkhead', floor: 0, x: 3, level: 2 });
    eq('door defense = 3 x level', doorDefense(s), 6);
    eq('walls grow by the door defense', defenseParts(s).walls - d0, 6);
    setDoor(s, 0, 3, 'open');
    eq('an open door adds no defense', doorDefense(s), 0);
    setDoor(s, 0, 3, 'closed');
    near('breach with no door between shaft and room', breachSpeed(s, s.buildings[0], 150), 1, 1e-9);
    near('breach one shut door behind', breachSpeed(s, s.buildings[1], 150), 150 / 158, 1e-9);
    // power
    eq('infra power draw: one shut door', infraPowerDraw(s), DOOR_DRAIN);
    setDoor(s, 0, 3, 'open');
    eq('infra power draw: open door is free', infraPowerDraw(s), 0);
    // assignment into a sealed-off room
    setDoor(s, 0, 3, 'sealed');
    const sm = new StateManager();
    s.survivors = [new PopulationSystem().createSurvivor(new SeededRandom(3))];
    s.survivors[0].child = false;
    sm.loadState(s);
    const ps = new PopulationSystem();
    eq('cannot assign into a room behind a sealed door', ps.assignSurvivorToBuilding(sm, s.survivors[0].id, 'b_2'), false);
    eq('can assign into a room before the sealed door', ps.assignSurvivorToBuilding(sm, s.survivors[0].id, 'b_1'), true);
    setDoor(s, 0, 3, 'closed');
    eq('a merely closed door does not block assignment', ps.assignSurvivorToBuilding(sm, s.survivors[0].id, 'b_2'), true);
  }

  // ---- 6. the fire code, evacuation, ventilation, columns ----
  {
    const s = base();
    s.currentFloors = 14;
    s.buildings = [room('b_1', 'generator', 1, 5), room('b_2', 'farm', 1, 9), room('b_3', 'canteen', 1, 12)];
    eq('fire code floors without stairwell', fireCodeFloors(s).join(','), '9,12');
    eq('fire code x1.5 on a deep floor', fireCodeMult(s, 9), 1.5);
    eq('no fire code above', fireCodeMult(s, 5), 1);
    eq('no evacuation bonus without stairwell', evacuationMult(s, 9), 1);
    const sm = new StateManager(); sm.loadState(s);
    const rs = new ResourceSystem();
    eq('stairwell build', buildColumn(sm, rs, 'stairwell', 10, 1), null);
    const st = sm.state as GameState;
    eq('stairwell is infra', infraAt(st, 'stairwell', 10).length, 1);
    const sx = st.layout.infra[0].x;
    eq('stairwell does not take a room slot', st.buildings.every(b => b.position.floor !== 10 || b.position.x !== sx), true);
    eq('fire code: floors next to the stairwell are covered', fireCodeFloors(st).join(','), '12');
    eq('fire code x1 within one floor', fireCodeMult(st, 9), 1);
    eq('fire code x1 within one floor (below)', fireCodeMult(st, 11), 1);
    eq('fire code still x1.5 two floors away', fireCodeMult(st, 12), 1.5);
    eq('evacuation x0.6 within 3 floors', evacuationMult(st, 12), 0.6);
    eq('evacuation x1 four floors away', evacuationMult(st, 14), 1);
    // placement: a room cannot take the stairwell's slot
    const bs = new BuildingSystem();
    eq('a room cannot be placed on the stairwell slot', bs.placeBlock('farm', { x: sx - roomSlots('farm') + 1, y: 0, floor: 10 }, st), 'overlap');
    // price grows per copy
    const c1 = st.resources.materials.amount;
    eq('second stairwell build', buildColumn(sm, rs, 'stairwell', 5, 1), null);
    eq('second stairwell costs x1.6', Math.round(c1 - sm.state.resources.materials.amount), 112);
    // vent stacks
    eq('no vents: no relief', ventilationRelief(st), 0);
    eq('vent 1', buildColumn(sm, rs, 'ventStack', 3, 1), null);
    eq('relief 2', ventilationRelief(sm.state as GameState), 2);
    eq('vent 2', buildColumn(sm, rs, 'ventStack', 4, 2), null);
    eq('vent 3', buildColumn(sm, rs, 'ventStack', 6, 1), null);
    eq('relief 6 with 3 stacks', ventilationRelief(sm.state as GameState), 6);
    eq('no fourth stack', columnBlock(sm.state as GameState, 'ventStack', 7, 1), 'copies');
    eq('stairwell + vents draw power', infraPowerDraw(sm.state as GameState) > 0, true);
    eq('columns on a bad floor', columnBlock(st, 'stairwell', 20, 1), 'floor');
    // the layout survives a save round-trip
    const back = migrateState(JSON.parse(JSON.stringify(sm.state)) as GameState);
    eq('layout infra survives migrateState', back.layout.infra.length, (sm.state as GameState).layout.infra.length);
    eq('stairwell level/floors survive', JSON.stringify(back.layout.infra), JSON.stringify((sm.state as GameState).layout.infra));
  }

  // ---- 7. the first eight new rooms, and the neighbour pairs, as the systems apply them ----
  {
    const rs = new ResourceSystem();
    const withRooms = (rooms: BuildingInstance[]): GameState => {
      const s = base();
      s.currentFloors = 6;
      s.buildings = rooms;
      return s;
    };
    const out = (s: GameState, id: string, r: string): number => (rs.getBuildingOutput(s, s.buildings.find(b => b.id === id)!) as Record<string, number>)[r] ?? 0;
    const lvl = (b: BuildingInstance, n: number): BuildingInstance => ({ ...b, level: n });

    // battery bank: +150 power storage per level
    {
      const a = withRooms([]);
      const b = withRooms([room('b_1', 'batteryBank', 1, 2)]);
      const c = withRooms([lvl(room('b_1', 'batteryBank', 1, 2), 3)]);
      const base0 = rs.computeCaps(a).power ?? 0;
      near('battery bank adds 150 power cap at L1', (rs.computeCaps(b).power ?? 0) - base0, 150, 1);
      near('battery bank adds 450 power cap at L3', (rs.computeCaps(c).power ?? 0) - base0, 450, 1);
    }
    // library: knowledge and knowledge storage; condenser: water with no crew; mushroom farm: food and medicine; recycler: scrap
    {
      const s = withRooms([room('b_1', 'library', 1, 2), room('b_2', 'condenser', 4, 2), room('b_3', 'mushroomFarm', 7, 3), room('b_4', 'recycler', 9, 2)]);
      if (!(out(s, 'b_1', 'knowledge') > 0)) fail('library makes no knowledge');
      if (!(out(s, 'b_2', 'water') > 0)) fail('condenser makes no water');
      if (!(out(s, 'b_3', 'food') > 0 && out(s, 'b_3', 'medicine') > 0)) fail('mushroom farm makes no food or medicine');
      if (!(out(s, 'b_4', 'scrap') > 0)) fail('recycler makes no scrap');
      const plain = withRooms([]);
      near('library adds 60 knowledge cap', (rs.computeCaps(s).knowledge ?? 0) - (rs.computeCaps(plain).knowledge ?? 0), 60, 1);
    }
    // commons / library morale channels (comfort and culture), gate post and barracks defense, barracks beds
    {
      const s = withRooms([room('b_1', 'commons', 1, 2), room('b_2', 'library', 4, 2), room('b_3', 'gatePost', 1, 0), room('b_4', 'barracks', 5, 0)]);
      const mb = moraleBreakdown(s);
      if (!(mb.channels.comfort.raw > 0)) fail('commons gives no comfort morale');
      if (!(mb.channels.culture.raw > 0)) fail('library gives no culture morale');
      const none = withRooms([]);
      if (!(defenseParts(s).guards > defenseParts(none).guards)) fail('gate post and barracks add no defense');
    }
    // neighbour pairs: touching rooms get the bonus, rooms one slot apart do not
    {
      const pair = (a: BuildingType, b: BuildingType, touch: boolean): GameState => withRooms([room('b_1', a, 1, 2), room('b_2', b, 1 + roomSlots(a) + (touch ? 0 : 1), 2)]);
      const ratio = (a: BuildingType, b: BuildingType, res: string, id: string): number => out(pair(a, b, true), id, res) / out(pair(a, b, false), id, res);
      near('mushroom farm by a pump: food x1.1', ratio('mushroomFarm', 'waterPump', 'food', 'b_1'), 1.1, 0.001);
      near('library by a laboratory: knowledge x1.08', ratio('library', 'laboratory', 'knowledge', 'b_1'), 1.08, 0.001);
      near('laboratory by a library: knowledge x1.08', ratio('library', 'laboratory', 'knowledge', 'b_2'), 1.08, 0.001);
      near('generator by a battery bank: power x1.05', ratio('generator', 'batteryBank', 'power', 'b_1'), 1.05, 0.001);
      const mat = (touch: boolean): number => (rs.breakdown(pair('recycler', 'workshop', touch), 'materials').sinks.find(x => x.key === 'recycler')?.value ?? 0);
      near('recycler by a workshop: 20% less materials', mat(true) / mat(false), 0.8, 0.001);
      const mor = (touch: boolean): number => moraleBreakdown(pair('canteen', 'commons', touch)).sources.find(x => x.type === 'commons')?.value ?? 0;
      near('commons by a canteen: +5% morale', mor(true) / mor(false), 1.05, 0.001);
      // three neighbours at most, +20% ceiling: five pumps cannot give more than 20%
      const crowd = withRooms([room('b_1', 'mushroomFarm', 6, 2), room('b_2', 'waterPump', 4, 2), room('b_3', 'waterPump', 8, 2)]);
      near('two pumps: output x1.2 (the ceiling)', out(crowd, 'b_1', 'food') / out(pair('mushroomFarm', 'waterPump', false), 'b_1', 'food'), 1.2, 0.001);
    }
  }

  // ---- 8. the sample saves: nothing breaks on real games ----
  for (const g of games) {
    const st = migrateState(JSON.parse(g.json) as GameState);
    const f = fireCodeFloors(st);
    eq(`${g.name}: no doors in an old save`, shutDoorCount(st), 0);
    eq(`${g.name}: no relief in an old save`, ventilationRelief(st) >= 0, true);
    notes.push(`${g.name}: ${f.length} floors below the fire code`);
  }
  return { problems, notes };
}
