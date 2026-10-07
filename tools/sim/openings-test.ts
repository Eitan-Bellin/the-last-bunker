// [plan4:ST-13] Node-level checks of the door openings (src/rendering/openings.ts) on the sample saves and on a synthetic wing (run by openings-test.mjs):
// a door stands exactly where two different rooms meet (never between two rooms of one compound, never at a ruin or an empty bay), the list is sorted and
// without doubles, roomDoorX agrees with it, and a wing that ends in one or two empty slots next to a room gets a corridor stub with a door.
import { migrateState, type BuildingInstance, type GameState } from '../../src/core/GameState';
import { roomSlots } from '../../src/data/buildingDefs';
import { extentsFor, slotX } from '../../src/rendering/geom';
import { occupancy } from '../../src/rendering/occupancy';
import { floorOpenings, openingsOfFloor, roomDoorX } from '../../src/rendering/openings';

export function openingChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string): void => { if (problems.length < 25) problems.push(m); };

  for (const g of games) {
    const state = migrateState(JSON.parse(g.json) as GameState);
    const floors = state.currentFloors;
    const exts = extentsFor(state, floors);
    const grid = occupancy(state.buildings, state.ruins, floors, exts);
    let total = 0;
    for (let f = 0; f < floors; f++) {
      const ops = floorOpenings(state, f);
      total += ops.length;
      for (let i = 1; i < ops.length; i++) if (ops[i].x <= ops[i - 1].x) fail(`${g.name}: floor ${f} openings are not sorted / unique at x ${ops[i].x}`);
      const ext = grid.ext[f];
      const cell = (s: number) => grid[f][s + ext.w] ?? null;
      for (const o of ops) {
        if (o.kind !== 'room') continue;
        const a = cell(o.slot - 1), b = cell(o.slot);
        if (!a || !b || a.ruin || b.ruin || a.key === b.key) fail(`${g.name}: floor ${f} door at slot ${o.slot} is not between two different rooms`);
        if (o.x !== slotX(o.slot)) fail(`${g.name}: floor ${f} door at slot ${o.slot} has x ${o.x}, not the column`);
      }
      // Every pair of neighbouring different rooms has its door.
      for (let s = -ext.w + 1; s < ext.e; s++) {
        if (s === 0) continue;
        const a = cell(s - 1), b = cell(s);
        if (a && b && !a.ruin && !b.ruin && a.key !== b.key && !ops.some(o => o.kind === 'room' && o.slot === s)) fail(`${g.name}: floor ${f} slot ${s}: two rooms meet and no door`);
      }
    }
    // roomDoorX of a room: a neighbour of another kind on its east side means a door there, and the number list matches the floor's doors.
    for (const b of state.buildings) {
      if (b.position.floor < 0 || b.position.floor >= floors || b.type === 'cave' || b.type === 'lake' || b.type === 'metro') continue;
      const d = roomDoorX(state, b.id);
      const xs = roomDoorX(state, b.position.floor);
      for (const x of [d.w, d.e]) if (x !== null && !xs.includes(x)) fail(`${g.name}: roomDoorX(${b.id}) gives x ${x}, which is not one of the floor's doors`);
    }
    notes.push(`${g.name}: ${total} doors on ${floors} floors`);
  }

  // Synthetic floors: rooms by real widths (quarters 3 slots, workshop 2); a wing dug to e = 13 leaves two empty slots after the last room (a stub), e = 14 three.
  const fake = (xs: [BuildingInstance['type'], number][], e: number, w = 0): GameState => {
    const base = migrateState(JSON.parse(games[0]?.json ?? '{}') as GameState);
    const mk = (i: number, type: BuildingInstance['type'], x: number): BuildingInstance => ({ ...base.buildings[0], id: 'r' + (i + 1), type, position: { floor: 0, x, y: 0 }, isConstructing: false, level: 1, assignedSurvivorIds: [] });
    const st: GameState = { ...base, buildings: xs.map(([t, x], i) => mk(i, t, x)), ruins: [], currentFloors: 1 };
    st.layout = { ...st.layout, ext: { '0': { w, e } }, doors: {}, infra: [] };
    return st;
  };
  const opsOf = (st: GameState) => openingsOfFloor(occupancy(st.buildings, [], 1, extentsFor(st, 1)), 0);
  if (games.length) {
    const tail: [BuildingInstance['type'], number][] = [['quarters', 6], ['workshop', 9]];
    const w2 = fake(tail, 13);
    const stub = opsOf(w2).find(o => o.kind === 'stub');
    if (!stub || stub.run !== 2 || stub.slot !== 11 || stub.x !== slotX(11)) fail(`wing with 2 empty slots: expected a stub at slot 11 with run 2, got ${JSON.stringify(stub)}`);
    if (opsOf(fake(tail, 14)).some(o => o.kind === 'stub')) fail('a wing with 3 empty slots must not get a stub');
    if (opsOf(fake(tail, 12)).some(o => o.kind === 'stub')) fail('a floor with no wing must not get a stub');
    // Rooms at the shaft: the landing is the west door of the first room, the next room's boundary its east door.
    const near = fake([['quarters', 0], ['workshop', 3]], 12);
    const d = roomDoorX(near, 'r1');
    if (d.w !== 64 || d.e !== slotX(3)) fail(`roomDoorX of the room at the shaft: expected landing 64 and east door ${slotX(3)}, got ${JSON.stringify(d)}`);
    const d2 = roomDoorX(near, 'r2');
    if (d2.w !== slotX(3) || d2.e !== null) fail(`roomDoorX of the second room: expected west door ${slotX(3)} and no east door, got ${JSON.stringify(d2)}`);
    // A west wing: the first room against the shaft has the west landing door.
    const west = fake([['workshop', -2]], 12, 2);
    const dw = roomDoorX(west, 'r1');
    if (dw.e !== -6 || dw.w !== null) fail(`roomDoorX of a west wing room: expected the west landing at -6 and no west door, got ${JSON.stringify(dw)}`);
    void roomSlots;
    notes.push('synthetic floors: stub rule, landings and roomDoorX checked');
  }
  return { problems, notes };
}
