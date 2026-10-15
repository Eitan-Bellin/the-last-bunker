// [plan4:ST-18] Node-level checks of the walkers' route planner (rendering/routes.ts): same-floor walks, the lift, stairs, the shaft ladder,
// closed doors, wings on both sides of the shaft, the surface row, and the trip-length cap. Run by routes-test.mjs.
import { LANDING_X, LEG_LADDER, LEG_LIFT, LEG_STAIRS, LEG_WALK, Route, route, setDoorBlocked, lineY, entryX, type Stop } from '../../src/rendering/routes';
import { roomsEastX, slotX } from '../../src/world/project';
import { GFX } from '../../src/rendering/gfxFeatures';
import { createInitialState, floorExtent, type GameState } from '../../src/core/GameState';
import { CITY_MAX_TRIP_S, LADDER_X, laneY } from '../../src/rendering/routes';
import { __setProjectionForTests } from '../../src/world/project';
import { HUB_STAIR_AMP, hubStairFor, hubStairX } from '../../src/world/nav/hubStairs';
import { cityCameraFrame } from '../../src/world/nav/cameraFrame';
import { buildCityLayout } from '../../src/world/model/cityLayout';
import { buildSliceState } from '../../src/dev/cityScenario';
import { hasAnnex } from '../../src/rendering/voids';
import { occupancy } from '../../src/rendering/occupancy';
import { extentsFor } from '../../src/rendering/geom';
import { MAX_WP } from '../../src/rendering/routes';
import { resetNavGraph, setNavLayoutSource } from '../../src/world/nav/graph';
import { followChecks, navChecks } from './nav-test';

export function routeChecks(e55json: string | null = null): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const fail = (m: string): void => { problems.push(m); };
  const st: GameState = createInitialState();
  st.currentFloors = 10;
  const r = new Route();
  const stop = (floor: number, x: number): Stop => ({ floor, x, y: lineY(floor) });
  const kinds = (): string => Array.from(r.kind.slice(0, r.n)).join('');
  // [airy2] The classic planner rules below are checked with the spacious pass off (the corridor lane adds waypoints); the airy rules follow at the end.
  const airyWas = GFX.airy;
  GFX.airy = false;

  // Same floor, east side: a straight walk of two waypoints.
  setDoorBlocked(null);
  let o = route(st, stop(2, roomsEastX(2) + 20), stop(2, roomsEastX(2) + 300), true, 0.5, r);
  if (!o || r.n !== 2 || r.kind[1] !== LEG_WALK) fail(`same floor: expected 2 waypoints, got ${o ? r.n : 'null'}`);
  // Across the shaft (west wing to east room): no partition door there, still a straight walk.
  o = route(st, stop(2, slotX(2, -3) + 10), stop(2, roomsEastX(2) + 100), true, 0.5, r);
  if (!o || r.n !== 2) fail('west to east on one floor should be a straight walk');

  // Other floor with power: walk to the landing, ride, walk on.
  o = route(st, stop(1, roomsEastX(1) + 200), stop(6, roomsEastX(6) + 90), true, 0.99, r);
  if (!o || kinds() !== [LEG_WALK, LEG_WALK, LEG_LIFT, LEG_WALK].join('')) fail(`lift trip kinds: ${o ? kinds() : 'null'}`);
  else if (r.x[1] !== LANDING_X || r.x[2] !== LANDING_X || r.floor[2] !== 6 || r.floor[1] !== 1) fail('lift trip: waypoints are not at the landing of the right floors');
  // From a west-wing room the same.
  o = route(st, stop(6, slotX(6, -2)), stop(1, slotX(1, -5)), true, 0.99, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LIFT)) fail('west-wing lift trip has no lift leg');

  // Blackout without a stairwell: the ladder in the shaft.
  o = route(st, stop(2, roomsEastX(2) + 50), stop(4, roomsEastX(4) + 50), false, 0.5, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LADDER)) fail('blackout without stairs should use the ladder');
  // ... and a 12-floor ladder climb is too long to draw.
  st.currentFloors = 24;
  if (route(st, stop(0, roomsEastX(0) + 50), stop(18, roomsEastX(18) + 50), false, 0.5, r) !== null) fail('an 18-floor ladder climb should be refused as too long'); // floor-0: the climb starts on B1

  // A stairwell column through floors 1..4 at slot 3: blackout trips use it; with power only some short hops do.
  st.layout.infra.push({ id: 's1', kind: 'stairwell', floor: 1, x: 3, floors: 4 });
  o = route(st, stop(1, roomsEastX(1) + 400), stop(3, roomsEastX(3) + 20), false, 0.5, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_STAIRS)) fail('blackout with a stairwell should take the stairs');
  else {
    const k = Array.from(r.kind.slice(0, r.n)).indexOf(LEG_STAIRS);
    if (r.flights[k] !== 2 || r.floor[k] !== 3) fail(`stairs leg: ${r.flights[k]} flights to floor ${r.floor[k]}, expected 2 to 3`);
    const cx = slotX(1, 3) + 23; // the stairwell column starts on floor 1
    if (Math.abs(r.x[k - 1] - (cx - 46 * 0.32)) > 0.01 || Math.abs(r.x[k] - (cx - 46 * 0.32)) > 0.01) fail('even number of flights should end on the same side it started');
  }
  o = route(st, stop(1, roomsEastX(1) + 400), stop(2, roomsEastX(2) + 20), true, 0.1, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_STAIRS)) fail('a one-floor hop with a low roll and a stairwell should take the stairs');
  o = route(st, stop(1, roomsEastX(1) + 400), stop(2, roomsEastX(2) + 20), true, 0.9, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LIFT)) fail('a one-floor hop with a high roll should take the lift');
  o = route(st, stop(1, roomsEastX(1) + 400), stop(6, roomsEastX(6) + 20), false, 0.5, r);
  // [airy2] The floors stand 44 taller (module constant, fixed at load), so a five-floor ladder climb can now exceed the trip cap and be refused (null): the stairwell must not be used either way.
  if (o ? !Array.from(r.kind.slice(0, r.n)).includes(LEG_LADDER) || Array.from(r.kind.slice(0, r.n)).includes(LEG_STAIRS) : false) fail('a stairwell that does not reach floor 6 must not be used (ladder instead)');

  // A closed partition door between slots 4 and 5 of floor 2 stops the walk across it, not walks on other floors or other slots.
  setDoorBlocked((f, a, b) => f === 2 && a === 4 && b === 5);
  if (route(st, stop(2, slotX(2, 2) + 10), stop(2, slotX(2, 8) + 10), true, 0.5, r) !== null) fail('a closed door in the way must give no route');
  if (!route(st, stop(2, slotX(2, 5) + 10), stop(2, slotX(2, 8) + 10), true, 0.5, r)) fail('walking beyond the closed door should still work');
  if (!route(st, stop(3, slotX(3, 2) + 10), stop(3, slotX(3, 8) + 10), true, 0.5, r)) fail('the same walk on another floor should work');
  // The lift trip from behind the closed door cannot reach the shaft.
  if (route(st, stop(2, slotX(2, 8) + 10), stop(5, slotX(5, 1) + 10), true, 0.5, r) !== null) fail('a lift trip from behind a closed door cannot reach the landing');
  // West wing doors (slots count up toward the shaft).
  setDoorBlocked((f, a, b) => f === 2 && a === -3 && b === -2);
  if (route(st, stop(2, slotX(2, -4) + 10), stop(2, slotX(2, -1) + 10), true, 0.5, r) !== null) fail('a closed west-wing door in the way must give no route');
  if (!route(st, stop(2, slotX(2, -2) + 10), stop(2, slotX(2, -1) + 10), true, 0.5, r)) fail('west wing: the walk beyond the door should work');
  setDoorBlocked(null);

  // The surface row joins floor 0 by the shaft ladder; then the lift for the rest.
  const ground: Stop = { floor: -1, x: -40, y: -8 };
  o = route(st, ground, stop(3, roomsEastX(3) + 60), true, 0.9, r);
  const ks = o ? Array.from(r.kind.slice(0, r.n)) : [];
  if (!o || !ks.includes(LEG_LADDER) || !ks.includes(LEG_LIFT)) fail(`surface to floor 3: expected a ladder and a lift, got ${ks.join('')}`);
  o = route(st, stop(3, roomsEastX(3) + 60), ground, true, 0.9, r);
  if (!o || r.floor[r.n - 1] !== -1 || r.y[r.n - 1] !== -8) fail('floor to surface should end on the surface line');

  // Doorway side: the edge facing where the walker comes from.
  if (entryX(100, 92, 20) !== 104 || entryX(100, 92, 400) !== 188) fail('entryX picks the wrong doorway side');
  // [airy2:D1] With the corridor on, a long walk steps out onto the lane of the front corridor, follows it, and steps back in.
  GFX.airy = true;
  setDoorBlocked(null);
  o = route(st, stop(2, roomsEastX(2) + 20), stop(2, roomsEastX(2) + 300), true, 0.5, r);
  if (!o || r.n < 4 || r.kind[r.n - 1] !== LEG_WALK) fail(`airy same floor: expected a lane walk of 4+ waypoints, got ${o ? r.n : 'null'}`);
  else if (r.y[1] === r.y[0] || r.y[r.n - 1] !== r.y[0]) fail('airy same floor: the walk should leave the room line for the lane and end on the room line');
  // Short hops stay in the room (no lane).
  o = route(st, stop(2, roomsEastX(2) + 20), stop(2, roomsEastX(2) + 50), true, 0.5, r);
  if (!o || r.n !== 2) fail('airy: a short walk (under 40 units) should stay a straight 2-waypoint walk');
  // The lift still serves the other floors, and the plan never overflows the waypoint list.
  o = route(st, stop(1, roomsEastX(1) + 200), stop(6, roomsEastX(6) + 90), true, 0.99, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LIFT) || r.n > 16) fail(`airy lift trip: ${o ? kinds() : 'null'}`);
  GFX.airy = airyWas;
  notes.push('routes: 20+ plans checked (same floor, wings, lift, stairs, ladder, doors, surface, length cap)');
  notes.push(`routes: classic digest ${classicDigest()}`);
  cityChecks(fail, notes);
  navChecks(e55json, fail, notes); // [world:M2 camera-nav]
  followChecks(fail, notes);
  return { problems, notes };
}

/**
 * A fingerprint of a fixed grid of classic plans (both GFX passes, lift on / off, rolls low / high, with and without a stairwell): printed
 * so a change to routes.ts can be compared against the previous commit (it must not move while the city work lands).
 */
function classicDigest(): string {
  __setProjectionForTests('classic');
  const airyWas = GFX.airy;
  const st: GameState = createInitialState();
  st.currentFloors = 12;
  st.layout.infra.push({ id: 'sd', kind: 'stairwell', floor: 1, x: 3, floors: 4 });
  const r = new Route();
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => { h = Math.imul(h ^ (Math.round(v * 100) | 0), 16777619) >>> 0; };
  for (const airy of [false, true]) {
    GFX.airy = airy;
    for (let a = -1; a < 6; a++) for (let b = 0; b < 6; b++) for (const lift of [true, false]) for (const rnd of [0.1, 0.9]) {
      const from: Stop = a < 0 ? { floor: -1, x: -40, y: -8 } : { floor: a, x: roomsEastX(a) + 30 + a * 17, y: lineY(a) };
      const to: Stop = { floor: b, x: roomsEastX(b) + 260 - b * 11, y: lineY(b) };
      const o = route(st, from, to, lift, rnd, r);
      mix(o ? r.n : -1);
      if (!o) continue;
      mix(r.seconds);
      for (let i = 0; i < r.n; i++) { mix(r.x[i]); mix(r.y[i]); mix(r.kind[i]); mix(r.floor[i]); mix(r.amp[i]); mix(r.flights[i]); }
    }
  }
  GFX.airy = airyWas;
  return h.toString(16);
}

/**
 * [world:C1 camera-nav] The city projection (architecture D10, 1.3): in the vertical slice (stratum 1, floors 0-2) a survivor moving
 * between floors takes the hub stairs or the lift (the lift landing on the balcony lane), never the ladder with power on and never a
 * refused plan (a teleport); the stair columns are the level-builder's; the annex is off; trips stay under MAX_TRIP_S; the camera frame
 * from the layout is sane.
 */
function cityChecks(fail: (m: string) => void, notes: string[]): void {
  const airyWas = GFX.airy;
  GFX.airy = true;
  __setProjectionForTests('city');
  // [world:M2] The nav graph reads the hubs (and transfers) from the level-builder's layout, as the game's provider does.
  setNavLayoutSource(s => buildCityLayout(s));
  resetNavGraph();
  setDoorBlocked(null);
  try {
    const st = buildSliceState('slice');
    const L = buildCityLayout(st);
    const hub = L.hubs.find(h => h.s === 1);
    // The stair columns are where the level-builder put them (and where the shell draws them).
    if (!hub || hub.stairs.length !== 2) fail(`city: the slice hub should have 2 stair columns, got ${hub?.stairs.length ?? 'no hub'}`);
    else for (const c of hub.stairs) if (Math.abs(c.x - hubStairX(1, c.side)) > 0.01) fail(`city: hub stair ${c.side} at ${c.x}, nav says ${hubStairX(1, c.side)}`);
    // Within a stratum only, dug floors only.
    if (!Number.isNaN(hubStairFor(st.currentFloors, 0, 3, 100))) fail('city: floor 3 is not dug in the slice: no hub stair to it');
    if (Number.isNaN(hubStairFor(st.currentFloors, 0, 2, 100))) fail('city: floors 0..2 should have a hub stair');
    if (!Number.isNaN(hubStairFor(12, 2, 5, 100))) fail('city: a hub stair must not cross the gallery between strata');
    if (hubStairFor(st.currentFloors, 0, 1, -200) !== hubStairX(1, 'w') || hubStairFor(st.currentFloors, 0, 1, 400) !== hubStairX(1, 'e')) fail('city: the nearest hub stair column should win');
    // No stair annex in the city.
    if (hasAnnex(occupancy(st.buildings, st.ruins ?? [], st.currentFloors, extentsFor(st, st.currentFloors)))) fail('city: the stair annex must be off');

    const r = new Route();
    const stop = (floor: number, x: number): Stop => ({ floor, x, y: lineY(floor) });
    const ks = (): number[] => Array.from(r.kind.slice(0, r.n));
    const eastX = hubStairX(1, 'e');
    // Blackout 0 -> 2 from the first room (nearer the hub than the first void tower): the east hub stairs, entered and left on the right landing, 8 flights, lane to lane.
    let o = route(st, stop(0, roomsEastX(0) + 10), stop(2, roomsEastX(2) + 60), false, 0.5, r); // floor-0: the walk starts on B1, the slice's top storey
    if (!o) fail('city: blackout 0->2 has no route (the survivor would teleport)');
    else {
      const k = ks().indexOf(LEG_STAIRS);
      if (k < 1 || ks().includes(LEG_LADDER)) fail(`city: blackout 0->2 should take the hub stairs, got ${ks().join('')}`);
      else {
        if (Math.abs(r.x[k - 1] - (eastX - HUB_STAIR_AMP)) > 0.01 || Math.abs(r.x[k] - (eastX - HUB_STAIR_AMP)) > 0.01) fail(`city: hub stairs should start and end on the right landing (${eastX - HUB_STAIR_AMP}), got ${r.x[k - 1]} / ${r.x[k]}`);
        if (r.amp[k] !== HUB_STAIR_AMP || r.flights[k] !== 8) fail(`city: hub stairs amp ${r.amp[k]} flights ${r.flights[k]}, expected ${HUB_STAIR_AMP} / 8`);
        if (Math.abs(r.y[k - 1] - laneY(0)) > 0.01 || Math.abs(r.y[k] - laneY(2)) > 0.01) fail('city: hub stairs should run lane to lane');
        // The zig-zag stays inside the column (walkers.ts: x = start + amp + amp * zig, zig in -1..1).
        const lo = r.x[k - 1] + 2 * Math.min(0, r.amp[k]), hi = r.x[k - 1] + 2 * Math.max(0, r.amp[k]);
        if (lo < eastX - 22 || hi > eastX + 22) fail(`city: the hub zig-zag leaves its 44-wide column (${lo}..${hi})`);
      }
    }
    // With the lift: a high roll rides from the landing on the balcony lane to the other balcony.
    // [world:M2] The graph weighs time: from beside the hub the lift is clearly quicker than two storeys of stairs for a walker who is not lift-shy.
    o = route(st, stop(2, roomsEastX(2) + 10), stop(0, roomsEastX(0) + 10), true, 0.9, r); // floor-0: the lift ride ends on B1's balcony lane
    if (!o || !ks().includes(LEG_LIFT)) fail(`city: a high roll with power should ride the lift, got ${o ? ks().join('') : 'null'}`);
    else {
      const k = ks().indexOf(LEG_LIFT);
      if (r.x[k] !== LANDING_X || Math.abs(r.y[k - 1] - laneY(2)) > 0.01 || Math.abs(r.y[k] - laneY(0)) > 0.01) fail('city: the lift should board and leave on the balcony lane');
    }
    // A low roll with power takes the hub stairs.
    o = route(st, stop(1, roomsEastX(1) + 60), stop(2, roomsEastX(2) + 90), true, 0.1, r);
    if (!o || !ks().includes(LEG_STAIRS)) fail(`city: a low roll should take the hub stairs, got ${o ? ks().join('') : 'null'}`);

    // Never a teleport between the slice floors: every slot pair on floors 0..2, lift on (low and high roll) and off.
    let plans = 0, worst = 0, stairs = 0, lifts = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (a === b) continue;
      const ea = floorExtent(st, a).e, eb = floorExtent(st, b).e;
      for (let sa = 0; sa < ea; sa += 1) for (let sb = 0; sb < eb; sb += 3) for (const [lift, rnd] of [[true, 0.1], [true, 0.9], [false, 0.5]] as const) {
        plans++;
        o = route(st, stop(a, roomsEastX(a) + sa * 46 + 23), stop(b, roomsEastX(b) + sb * 46 + 23), lift, rnd, r);
        if (!o) { fail(`city: ${a}:${sa} -> ${b}:${sb} (lift ${lift}, roll ${rnd}) has no route: the survivor would teleport`); continue; }
        if (ks().includes(LEG_LADDER)) fail(`city: ${a}:${sa} -> ${b}:${sb} uses the shaft ladder`);
        if (r.n > MAX_WP) fail('city: waypoint list overflow');
        if (r.seconds > CITY_MAX_TRIP_S) fail('city: a trip over CITY_MAX_TRIP_S was returned');
        worst = Math.max(worst, r.seconds);
        if (ks().includes(LEG_STAIRS)) stairs++;
        if (ks().includes(LEG_LIFT)) lifts++;
      }
    }
    notes.push(`routes (city): ${plans} slice plans between floors 0-2, ${stairs} by the hub stairs, ${lifts} by the lift, none refused, longest ${worst.toFixed(1)} s (cap ${CITY_MAX_TRIP_S})`);
    // The surface still joins floor 0 by the shaft ladder (LADDER_X), then hub stairs or the lift.
    o = route(st, { floor: -1, x: -40, y: -8 }, stop(2, roomsEastX(2) + 60), true, 0.9, r);
    if (!o || r.x[ks().indexOf(LEG_LADDER)] !== LADDER_X) fail('city: surface -> floor 2 should climb the shaft ladder to floor 0 first');
    // A closed bulkhead still blocks the walk (acceptance 6.4: closing a bulkhead blocks the walk). [world:M2] With the graph a survivor walks
    // around one shut door when another floor leads past it, so the room is shut in on both sides here.
    setDoorBlocked((fl, x0, x1) => fl === 2 && ((x0 === 5 && x1 === 6) || (x0 === 6 && x1 === 7)));
    if (route(st, stop(0, roomsEastX(0) + 30), stop(2, slotX(2, 6) + 10), true, 0.9, r) !== null) fail( // floor-0: from B1 down to the bulkhead on B3
      'city: a room shut in by closed doors must not be reachable');
    setDoorBlocked(null);

    // The camera frame from the layout: content inside bounds, the hub inside content, the bounds tighter than the dressing bounds.
    const cf = cityCameraFrame(L);
    const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
      a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.w <= b.x + b.w + 0.01 && a.y + a.h <= b.y + b.h + 0.01;
    if (!cf.hub || !inside(cf.hub, cf.content)) fail('city camera: the hub should sit inside the framed content');
    if (!inside(cf.content, cf.bounds)) fail('city camera: the content should sit inside the bounds');
    if (cf.bounds.w >= L.bounds.w || cf.bounds.h >= L.bounds.h) fail('city camera: the camera bounds should be tighter than the layout dressing bounds');
    if (cf.hub && Math.abs(cf.hub.x + cf.hub.w / 2 - 29) > 0.01) fail(`city camera: the hub (with vestibules) should be centred on the spine, got ${cf.hub.x + cf.hub.w / 2}`);
    notes.push(`routes (city): camera frame bounds ${JSON.stringify(cf.bounds)} content ${JSON.stringify(cf.content)} hub ${JSON.stringify(cf.hub)}`);
  } finally {
    __setProjectionForTests('classic');
    setNavLayoutSource(null);
    resetNavGraph();
    GFX.airy = airyWas;
    setDoorBlocked(null);
  }
}
