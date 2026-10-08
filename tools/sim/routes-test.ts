// [plan4:ST-18] Node-level checks of the walkers' route planner (rendering/routes.ts): same-floor walks, the lift, stairs, the shaft ladder,
// closed doors, wings on both sides of the shaft, the surface row, and the trip-length cap. Run by routes-test.mjs.
import { LANDING_X, LEG_LADDER, LEG_LIFT, LEG_STAIRS, LEG_WALK, Route, route, setDoorBlocked, lineY, entryX, type Stop } from '../../src/rendering/routes';
import { ROOMS_X, slotX } from '../../src/rendering/geom';
import { GFX } from '../../src/rendering/gfxFeatures';
import { createInitialState, type GameState } from '../../src/core/GameState';

export function routeChecks(): { problems: string[]; notes: string[] } {
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
  let o = route(st, stop(2, ROOMS_X + 20), stop(2, ROOMS_X + 300), true, 0.5, r);
  if (!o || r.n !== 2 || r.kind[1] !== LEG_WALK) fail(`same floor: expected 2 waypoints, got ${o ? r.n : 'null'}`);
  // Across the shaft (west wing to east room): no partition door there, still a straight walk.
  o = route(st, stop(2, slotX(-3) + 10), stop(2, ROOMS_X + 100), true, 0.5, r);
  if (!o || r.n !== 2) fail('west to east on one floor should be a straight walk');

  // Other floor with power: walk to the landing, ride, walk on.
  o = route(st, stop(1, ROOMS_X + 200), stop(6, ROOMS_X + 90), true, 0.99, r);
  if (!o || kinds() !== [LEG_WALK, LEG_WALK, LEG_LIFT, LEG_WALK].join('')) fail(`lift trip kinds: ${o ? kinds() : 'null'}`);
  else if (r.x[1] !== LANDING_X || r.x[2] !== LANDING_X || r.floor[2] !== 6 || r.floor[1] !== 1) fail('lift trip: waypoints are not at the landing of the right floors');
  // From a west-wing room the same.
  o = route(st, stop(6, slotX(-2)), stop(1, slotX(-5)), true, 0.99, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LIFT)) fail('west-wing lift trip has no lift leg');

  // Blackout without a stairwell: the ladder in the shaft.
  o = route(st, stop(2, ROOMS_X + 50), stop(4, ROOMS_X + 50), false, 0.5, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LADDER)) fail('blackout without stairs should use the ladder');
  // ... and a 12-floor ladder climb is too long to draw.
  st.currentFloors = 24;
  if (route(st, stop(0, ROOMS_X + 50), stop(18, ROOMS_X + 50), false, 0.5, r) !== null) fail('an 18-floor ladder climb should be refused as too long');

  // A stairwell column through floors 1..4 at slot 3: blackout trips use it; with power only some short hops do.
  st.layout.infra.push({ id: 's1', kind: 'stairwell', floor: 1, x: 3, floors: 4 });
  o = route(st, stop(1, ROOMS_X + 400), stop(3, ROOMS_X + 20), false, 0.5, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_STAIRS)) fail('blackout with a stairwell should take the stairs');
  else {
    const k = Array.from(r.kind.slice(0, r.n)).indexOf(LEG_STAIRS);
    if (r.flights[k] !== 2 || r.floor[k] !== 3) fail(`stairs leg: ${r.flights[k]} flights to floor ${r.floor[k]}, expected 2 to 3`);
    const cx = slotX(3) + 23;
    if (Math.abs(r.x[k - 1] - (cx - 46 * 0.32)) > 0.01 || Math.abs(r.x[k] - (cx - 46 * 0.32)) > 0.01) fail('even number of flights should end on the same side it started');
  }
  o = route(st, stop(1, ROOMS_X + 400), stop(2, ROOMS_X + 20), true, 0.1, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_STAIRS)) fail('a one-floor hop with a low roll and a stairwell should take the stairs');
  o = route(st, stop(1, ROOMS_X + 400), stop(2, ROOMS_X + 20), true, 0.9, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LIFT)) fail('a one-floor hop with a high roll should take the lift');
  o = route(st, stop(1, ROOMS_X + 400), stop(6, ROOMS_X + 20), false, 0.5, r);
  // [airy2] The floors stand 44 taller (module constant, fixed at load), so a five-floor ladder climb can now exceed the trip cap and be refused (null): the stairwell must not be used either way.
  if (o ? !Array.from(r.kind.slice(0, r.n)).includes(LEG_LADDER) || Array.from(r.kind.slice(0, r.n)).includes(LEG_STAIRS) : false) fail('a stairwell that does not reach floor 6 must not be used (ladder instead)');

  // A closed partition door between slots 4 and 5 of floor 2 stops the walk across it, not walks on other floors or other slots.
  setDoorBlocked((f, a, b) => f === 2 && a === 4 && b === 5);
  if (route(st, stop(2, slotX(2) + 10), stop(2, slotX(8) + 10), true, 0.5, r) !== null) fail('a closed door in the way must give no route');
  if (!route(st, stop(2, slotX(5) + 10), stop(2, slotX(8) + 10), true, 0.5, r)) fail('walking beyond the closed door should still work');
  if (!route(st, stop(3, slotX(2) + 10), stop(3, slotX(8) + 10), true, 0.5, r)) fail('the same walk on another floor should work');
  // The lift trip from behind the closed door cannot reach the shaft.
  if (route(st, stop(2, slotX(8) + 10), stop(5, slotX(1) + 10), true, 0.5, r) !== null) fail('a lift trip from behind a closed door cannot reach the landing');
  // West wing doors (slots count up toward the shaft).
  setDoorBlocked((f, a, b) => f === 2 && a === -3 && b === -2);
  if (route(st, stop(2, slotX(-4) + 10), stop(2, slotX(-1) + 10), true, 0.5, r) !== null) fail('a closed west-wing door in the way must give no route');
  if (!route(st, stop(2, slotX(-2) + 10), stop(2, slotX(-1) + 10), true, 0.5, r)) fail('west wing: the walk beyond the door should work');
  setDoorBlocked(null);

  // The surface row joins floor 0 by the shaft ladder; then the lift for the rest.
  const ground: Stop = { floor: -1, x: -40, y: -8 };
  o = route(st, ground, stop(3, ROOMS_X + 60), true, 0.9, r);
  const ks = o ? Array.from(r.kind.slice(0, r.n)) : [];
  if (!o || !ks.includes(LEG_LADDER) || !ks.includes(LEG_LIFT)) fail(`surface to floor 3: expected a ladder and a lift, got ${ks.join('')}`);
  o = route(st, stop(3, ROOMS_X + 60), ground, true, 0.9, r);
  if (!o || r.floor[r.n - 1] !== -1 || r.y[r.n - 1] !== -8) fail('floor to surface should end on the surface line');

  // Doorway side: the edge facing where the walker comes from.
  if (entryX(100, 92, 20) !== 104 || entryX(100, 92, 400) !== 188) fail('entryX picks the wrong doorway side');
  // [airy2:D1] With the corridor on, a long walk steps out onto the lane of the front corridor, follows it, and steps back in.
  GFX.airy = true;
  setDoorBlocked(null);
  o = route(st, stop(2, ROOMS_X + 20), stop(2, ROOMS_X + 300), true, 0.5, r);
  if (!o || r.n < 4 || r.kind[r.n - 1] !== LEG_WALK) fail(`airy same floor: expected a lane walk of 4+ waypoints, got ${o ? r.n : 'null'}`);
  else if (r.y[1] === r.y[0] || r.y[r.n - 1] !== r.y[0]) fail('airy same floor: the walk should leave the room line for the lane and end on the room line');
  // Short hops stay in the room (no lane).
  o = route(st, stop(2, ROOMS_X + 20), stop(2, ROOMS_X + 50), true, 0.5, r);
  if (!o || r.n !== 2) fail('airy: a short walk (under 40 units) should stay a straight 2-waypoint walk');
  // The lift still serves the other floors, and the plan never overflows the waypoint list.
  o = route(st, stop(1, ROOMS_X + 200), stop(6, ROOMS_X + 90), true, 0.99, r);
  if (!o || !Array.from(r.kind.slice(0, r.n)).includes(LEG_LIFT) || r.n > 16) fail(`airy lift trip: ${o ? kinds() : 'null'}`);
  GFX.airy = airyWas;
  notes.push('routes: 20+ plans checked (same floor, wings, lift, stairs, ladder, doors, surface, length cap)');
  return { problems, notes };
}
