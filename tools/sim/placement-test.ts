// [plan4:ST-19] Node-level checks of the placement helpers and of BuildingSystem.relocate on the sample saves (run by placement-test.mjs):
// bestSpot is always a valid spot (null only when nothing is valid) and prefers a compound neighbour; relocate charges 10% of the build price,
// leaves the room standing still for 30 s, keeps the crew, refuses what it must refuse, and survives a save round-trip.
import { BuildingSystem } from '../../src/systems/BuildingSystem';
import { bestSpot, placeEffects, spotForTap, validSpots } from '../../src/systems/placementRank';
import { RELOCATE_COST_SHARE, RELOCATE_SECONDS, relocateBlock, relocateCost, stateWithout } from '../../src/systems/relocate';
import { StateManager } from '../../src/core/StateManager';
import { bus } from '../../src/core/EventBus';
import { BUILDABLE_TYPES, getDef, isDistrict, roomSlots } from '../../src/data/buildingDefs';
import { DISTRICTS, availableDistricts } from '../../src/data/districts'; // plan4:BL-24,25
import { floorExtent, migrateState, type BuildingInstance, type BuildingType, type GameState } from '../../src/core/GameState';

const rich = (s: GameState): void => { for (const r of Object.values(s.resources)) r.amount = r.cap; };

export function placementChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const bs = new BuildingSystem();
  const fail = (m: string): void => { if (problems.length < 25) problems.push(m); };

  for (const g of games) {
    const base = migrateState(JSON.parse(g.json) as GameState);
    rich(base);
    // ---- bestSpot ----
    let checked = 0;
    for (const type of BUILDABLE_TYPES) {
      const spots = validSpots(type, base, bs);
      const best = bestSpot(type, base, bs);
      checked++;
      if (!best) { if (spots.length) fail(`${g.name}: bestSpot(${type}) is null but ${spots.length} spots are valid`); continue; }
      if (bs.placeBlock(type, best, base) !== null) fail(`${g.name}: bestSpot(${type}) = floor ${best.floor} slot ${best.x} is not valid (${bs.placeBlock(type, best, base)})`);
      if (!spots.some(p => p.x === best.x && p.floor === best.floor)) fail(`${g.name}: bestSpot(${type}) is not in validSpots`);
      const again = bestSpot(type, base, bs);
      if (!again || again.x !== best.x || again.floor !== best.floor) fail(`${g.name}: bestSpot(${type}) is not deterministic`);
      // A compound neighbour wins when one is on offer.
      const fx = placeEffects(type, best, base);
      const anyCompound = spots.some(p => placeEffects(type, p, base).compound > 0);
      if (anyCompound && fx.compound === 0) fail(`${g.name}: bestSpot(${type}) has no compound neighbour although a spot with one exists`);
    }
    notes.push(`${g.name}: bestSpot checked for ${checked} room types`);

    // ---- [plan4:BL-24,25] districts: each kind can be dug on its own floor once the world allows it, stands at the end of that floor, is never a valid room spot and never moves ----
    {
      const world = JSON.parse(JSON.stringify(base)) as GameState;
      world.currentFloors = 12;
      world.storyFlags = [...new Set([...world.storyFlags, 'districts:unlocked'])];
      world.buildings = world.buildings.filter(b => !isDistrict(b.type));
      world.longGame.meta.act = 7;
      for (const d of DISTRICTS) if (d.needsResearch) (world.research as Record<string, unknown>)[d.needsResearch] = { id: d.needsResearch, completed: true, progress: 0, active: false };
      const sm = new StateManager();
      sm.loadState(world);
      let dug = 0;
      for (let guard = 0; guard < 8; guard++) {
        const next = availableDistricts(sm.state)[0];
        if (!next) break;
        const b = bs.digDistrict(sm, next.kind);
        if (!b) { fail(`${g.name}: digDistrict(${next.kind}) refused an available district`); break; }
        dug++;
        if (b.position.floor !== next.floor || b.position.x !== floorExtent(sm.state, next.floor).e) fail(`${g.name}: ${next.kind} was dug at floor ${b.position.floor} slot ${b.position.x}, expected floor ${next.floor} at the end of the floor`);
        if (validSpots(next.kind as BuildingType, sm.state, bs).length) fail(`${g.name}: ${next.kind} has valid placement spots (a district is dug, never placed)`);
        if (bs.placeBlock(next.kind as BuildingType, { x: 0, y: 0, floor: next.floor }, sm.state) === null) fail(`${g.name}: ${next.kind} can be placed like a room`);
        const done = { ...b, isConstructing: false };
        if (relocateBlock(sm.state, done) !== 'district') fail(`${g.name}: ${next.kind} can be moved`);
      }
      const floors = sm.state.buildings.filter(b => isDistrict(b.type)).map(b => b.position.floor);
      if (new Set(floors).size !== floors.length) fail(`${g.name}: two districts share a floor (${floors})`);
      if (dug !== DISTRICTS.length) fail(`${g.name}: ${dug} of ${DISTRICTS.length} districts could be dug in a deep Act VII world`);
      notes.push(`${g.name}: ${dug} districts dug on floors ${floors.sort((a, b) => a - b).join(',')}`);
    }

    // ---- [plan4:ST-16] the surface row: closed = no spot; open = spots on floor -1 only inside slots -11..-4; best spot valid; a tap on the row answers; building fills it ----
    {
      const closed = { ...base, layout: { ...base.layout, surfaceOpen: false } } as GameState;
      const open = { ...base, layout: { ...base.layout, surfaceOpen: true } } as GameState;
      let rowTypes = 0;
      for (const type of BUILDABLE_TYPES) {
        const where = getDef(type)?.place?.floors;
        if (where !== 'surface' && where !== 'entranceOrSurface') continue;
        rowTypes++;
        const w = roomSlots(type);
        if (validSpots(type, closed, bs).some(p => p.floor === -1)) fail(`${g.name}: ${type} has a spot on the closed surface row`);
        const spots = validSpots(type, open, bs).filter(p => p.floor === -1);
        const copies = getDef(type)?.maxCopies;
        const full = copies !== undefined && base.buildings.filter(b => b.type === type).length >= copies;
        if (!spots.length && !full && !(getDef(type)?.place?.needsFlag)) fail(`${g.name}: ${type} has no spot on the open surface row`);
        for (const p of spots) if (p.x < -11 || p.x + w > -3) fail(`${g.name}: ${type} spot slot ${p.x} is outside slots -11..-4`);
        const best = bestSpot(type, open, bs);
        if (best && bs.placeBlock(type, best, open) !== null) fail(`${g.name}: bestSpot(${type}) on the open row is not valid`);
        if (where === 'surface' && best && best.floor !== -1) fail(`${g.name}: bestSpot(${type}) = floor ${best.floor}, a surface-only room`);
        if (spots.length) {
          const tap = spotForTap(type, -1, spots[0].x, open, bs);
          if (tap.block !== null) fail(`${g.name}: a tap on the open surface slot ${spots[0].x} for ${type} answers ${tap.block}`);
          // Fill the row with this type until it says no: every placement stays inside the row and never overlaps.
          const sm = new StateManager();
          sm.loadState(JSON.parse(JSON.stringify(open)) as GameState);
          let n = 0;
          for (let guard = 0; guard < 12; guard++) {
            const spot = validSpots(type, sm.state, bs).find(p => p.floor === -1);
            if (!spot) break;
            if (!bs.placeBuilding(type, spot, sm)) { fail(`${g.name}: placeBuilding(${type}) refused a valid surface spot`); break; }
            n++;
          }
          const row = sm.state.buildings.filter(b => b.position.floor === -1);
          const used = new Set<number>();
          for (const b of row) for (let x = b.position.x; x < b.position.x + roomSlots(b.type); x++) { if (used.has(x)) fail(`${g.name}: two surface rooms share slot ${x}`); used.add(x); }
          if (!n && !full) fail(`${g.name}: no ${type} could be built on the open surface row`);
        }
      }
      notes.push(`${g.name}: surface row checked for ${rowTypes} room types`);
    }

    // ---- spotForTap: a tap on a valid slot gives that slot; on an occupied one the reason ----
    const occ = base.buildings.find(b => b.position.floor >= 0 && !!getDef(b.type) && !isDistrict(b.type)); // plan4:BL-24,25 every district, not just the first three
    if (occ) {
      const t = spotForTap('storage', occ.position.floor, occ.position.x, base, bs);
      if (t.block === null && bs.placeBlock('storage', t.pos, base) !== null) fail(`${g.name}: spotForTap returned a block-free spot that is not valid`);
    }

    // ---- relocate ----
    const cands = base.buildings.filter(b => !b.isConstructing && b.position.floor >= 0 && !isDistrict(b.type)); // plan4:BL-24,25
    const movable = (b: BuildingInstance): boolean => validSpots(b.type, stateWithout(base, b.id), bs).some(p => p.x !== b.position.x || p.floor !== b.position.floor);
    const crewed = cands.filter(b => b.assignedSurvivorIds.length > 0).find(movable) ?? cands.find(movable) ?? cands[0];
    if (!crewed) { notes.push(`${g.name}: no room to relocate`); continue; }
    const mk = (): { sm: StateManager; b: BuildingInstance } => {
      const sm = new StateManager();
      const st = JSON.parse(JSON.stringify(base)) as GameState;
      sm.loadState(st);
      return { sm, b: st.buildings.find(x => x.id === crewed.id)! };
    };
    const target = (state: GameState, b: BuildingInstance) => validSpots(b.type, stateWithout(state, b.id), bs).find(p => p.x !== b.position.x || p.floor !== b.position.floor);
    {
      const { sm, b } = mk();
      const to = target(sm.state, b);
      if (!to) { notes.push(`${g.name}: no other valid spot for ${b.type} (relocate not run)`); continue; }
      const before = JSON.parse(JSON.stringify(sm.state)) as GameState;
      const cost = relocateCost(bs, before, b);
      const want = Object.fromEntries(Object.entries(bs.getBuildCost(b.type, stateWithout(before, b.id))).map(([r, v]) => [r, Math.max(1, Math.ceil(v * RELOCATE_COST_SHARE))]));
      if (JSON.stringify(cost) !== JSON.stringify(want)) fail(`${g.name}: relocateCost ${JSON.stringify(cost)} != 10% of the build price ${JSON.stringify(want)}`);
      let emitted = 0;
      const off = bus.on('building:relocated', () => { emitted++; });
      const ok = bs.relocate(sm, b.id, to);
      off();
      if (!ok) fail(`${g.name}: relocate(${b.type}) to a valid spot returned false`);
      else {
        const now = sm.state.buildings.find(x => x.id === b.id)!;
        if (now.position.x !== to.x || now.position.floor !== to.floor) fail(`${g.name}: relocate did not move the room`);
        for (const [r, v] of Object.entries(cost)) {
          const d = before.resources[r as keyof GameState['resources']].amount - sm.state.resources[r as keyof GameState['resources']].amount;
          if (Math.abs(d - v) > 1e-6) fail(`${g.name}: relocate charged ${d} ${r}, expected ${v}`);
        }
        const wt = before.longGame.meta.worldT;
        if (Math.abs((now.retoolUntil ?? 0) - (Math.max(b.retoolUntil ?? 0, wt) + RELOCATE_SECONDS)) > 1e-6) fail(`${g.name}: downtime ${(now.retoolUntil ?? 0) - wt} s, expected ${RELOCATE_SECONDS}`);
        if (JSON.stringify(now.assignedSurvivorIds) !== JSON.stringify(b.assignedSurvivorIds)) fail(`${g.name}: relocate changed the crew`);
        for (const id of b.assignedSurvivorIds) if (sm.state.survivors.find(s => s.id === id)?.assignedBuildingId !== b.id) fail(`${g.name}: a worker lost the assignment`);
        if (emitted !== 1) fail(`${g.name}: building:relocated emitted ${emitted} times`);
        if (sm.state.buildings.length !== before.buildings.length) fail(`${g.name}: relocate changed the number of rooms`);
        // The room is judged against the bunker without itself: its old spot is free again, and a second move is refused while it stands still.
        if (bs.relocate(sm, b.id, { x: b.position.x, y: 0, floor: b.position.floor })) fail(`${g.name}: a room that is still being moved moved again`);
        // Survives a save round-trip (additive field, no version change).
        const back = migrateState(JSON.parse(JSON.stringify(sm.state)) as GameState);
        const nb = back.buildings.find(x => x.id === b.id)!;
        if (nb.position.x !== to.x || nb.position.floor !== to.floor || nb.retoolUntil !== now.retoolUntil) fail(`${g.name}: the move did not survive a save round-trip`);
        if (back.version !== before.version) fail(`${g.name}: SAVE_VERSION changed (${before.version} -> ${back.version})`);
        notes.push(`${g.name}: relocated ${b.type} floor ${b.position.floor}/${b.position.x} -> ${to.floor}/${to.x} for ${JSON.stringify(cost)}, ${RELOCATE_SECONDS} s still`);
      }
    }
    {
      // Refusals: same spot, an occupied / wrong spot, a room under construction, one with an incident, one already moving, too poor, a cavern.
      const { sm, b } = mk();
      const snap = JSON.stringify(sm.state);
      const unchanged = (why: string): void => { if (JSON.stringify(sm.state) !== snap) fail(`${g.name}: ${why} changed the state although it was refused`); };
      if (bs.relocate(sm, b.id, { ...b.position })) fail(`${g.name}: relocate to its own spot returned true`);
      unchanged('relocate to the same spot');
      const other = sm.state.buildings.find(x => x.id !== b.id && x.position.floor >= 0 && !isDistrict(x.type)); // plan4:BL-24,25
      if (other && bs.relocate(sm, b.id, { ...other.position })) fail(`${g.name}: relocate onto another room returned true`);
      unchanged('relocate onto another room');
      if (bs.relocate(sm, b.id, { x: 99, y: 0, floor: b.position.floor })) fail(`${g.name}: relocate out of bounds returned true`);
      if (bs.relocate(sm, 'nope', { x: 0, y: 0, floor: 0 })) fail(`${g.name}: relocate of an unknown room returned true`);
      const to = target(sm.state, b);
      if (to) {
        const cons = mk();
        cons.b.isConstructing = true;
        if (relocateBlock(cons.sm.state, cons.b) !== 'busy' || bs.relocate(cons.sm, cons.b.id, to)) fail(`${g.name}: a room under construction can be moved`);
        const inc = mk();
        (inc.sm.state as { incidents: unknown }).incidents = [{ id: 'i1', kind: 'fire', buildingId: inc.b.id, progress: 0, severity: 0.2 } as never];
        if (relocateBlock(inc.sm.state, inc.b) !== 'incident' || bs.relocate(inc.sm, inc.b.id, to)) fail(`${g.name}: a room with an incident can be moved`);
        const mov = mk();
        mov.b.retoolUntil = mov.sm.state.longGame.meta.worldT + 100;
        if (relocateBlock(mov.sm.state, mov.b) !== 'moving' || bs.relocate(mov.sm, mov.b.id, to)) fail(`${g.name}: a room that is being moved / refitted can be moved`);
        const poor = mk();
        for (const r of Object.keys(relocateCost(bs, poor.sm.state, poor.b))) (poor.sm.state.resources as Record<string, { amount: number }>)[r].amount = 0;
        const poorSnap = JSON.stringify(poor.sm.state);
        if (bs.relocate(poor.sm, poor.b.id, to) || JSON.stringify(poor.sm.state) !== poorSnap) fail(`${g.name}: relocate without the resources changed something`);
      }
      const cav = sm.state.buildings.find(x => isDistrict(x.type));
      if (cav && (relocateBlock(sm.state, cav) !== 'district' || bs.relocate(sm, cav.id, { x: 0, y: 0, floor: cav.position.floor }))) fail(`${g.name}: a cavern can be moved`);
    }
    // Wide rooms: the width in slots decides whether a spot fits (no overlap with a neighbour after the move).
    const wide = base.buildings.find(b => !b.isConstructing && roomSlots(b.type) >= 3 && b.position.floor >= 0 && !isDistrict(b.type)); // plan4:BL-24,25
    if (wide) {
      const sm = new StateManager();
      sm.loadState(JSON.parse(JSON.stringify(base)) as GameState);
      const w = sm.state.buildings.find(b => b.id === wide.id)!;
      const to = validSpots(w.type, stateWithout(sm.state, w.id), bs).find(p => p.x !== w.position.x || p.floor !== w.position.floor);
      if (to && !bs.relocate(sm, w.id, to)) fail(`${g.name}: relocate of the ${roomSlots(w.type)}-slot ${w.type} to a valid spot failed`);
      for (const a of sm.state.buildings) for (const b of sm.state.buildings) {
        if (a.id >= b.id || a.position.floor !== b.position.floor || isDistrict(a.type) || isDistrict(b.type)) continue;
        if (a.position.x < b.position.x + roomSlots(b.type) && a.position.x + roomSlots(a.type) > b.position.x) fail(`${g.name}: ${a.type} and ${b.type} overlap after a move`);
      }
    }
  }
  return { problems, notes };
}
