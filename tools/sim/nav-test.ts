// [world:M2 camera-nav] Node checks of the city nav graph (src/world/nav/graph.ts) on the e55 save with skewed per-stratum frames: every
// floor pair 0..23 reaches without a teleport within MAX_TRIP_S with the lift on, gallery transfers carry trips between strata, columns never
// cross a frame change, closed doors block (or are walked around), and a path query stays fast. Run from routes-test.ts (routes-test.mjs).
import { LEG_LADDER, LEG_LIFT, LEG_STAIRS, LEG_WALK, CITY_MAX_TRIP_S as MAX_TRIP_S, MAX_WP, Route, laneY, lineY, route, setDoorBlocked, type Stop } from '../../src/rendering/routes';
import { __setProjectionForTests, frameOf, roomsEastX, slotX } from '../../src/world/project';
import { GFX } from '../../src/rendering/gfxFeatures';
import { migrateState, floorExtent, type GameState } from '../../src/core/GameState';
import { stratumOf } from '../../src/data/strata';
import { buildCityLayout } from '../../src/world/model/cityLayout';
import { NAV_STATS, navGraph, resetNavGraph, setNavLayoutSource, standInTransfers } from '../../src/world/nav/graph';
import { HUB_STAIR_AMP } from '../../src/world/nav/hubStairs';
import { CAMERA, type CityFrameTokens } from '../../src/world/tokens';
import { FollowTracker } from '../../src/world/nav/followGesture';

/** Deliberately different frames per stratum (column jogs at every gallery). Stratum 0 stays classic whatever is given. */
export const SKEWED_FRAMES: readonly CityFrameTokens[] = [
  { hubL: 0, hubR: 58, vestW: 6, vestE: 6, tunnel: 18 },
  { hubL: -64, hubR: 122, vestW: 36, vestE: 36, tunnel: 18 },
  { hubL: -96, hubR: 150, vestW: 40, vestE: 52, tunnel: 22 },
  { hubL: -70, hubR: 130, vestW: 28, vestE: 30, tunnel: 18 },
  { hubL: -120, hubR: 176, vestW: 44, vestE: 60, tunnel: 26 },
  { hubL: -80, hubR: 140, vestW: 36, vestE: 44, tunnel: 18 },
  { hubL: -100, hubR: 124, vestW: 50, vestE: 38, tunnel: 30 },
];

export function navChecks(e55json: string | null, fail: (m: string) => void, notes: string[]): void {
  if (!e55json) { fail('nav: the e55 save was not given'); return; }
  const airyWas = GFX.airy, galWas = GFX.galleries;
  GFX.airy = true;
  GFX.galleries = true;
  __setProjectionForTests('city', SKEWED_FRAMES);
  setNavLayoutSource(s => buildCityLayout(s));
  resetNavGraph();
  setDoorBlocked(null);
  try {
    const st = migrateState(JSON.parse(e55json) as GameState);
    st.currentFloors = 24;
    const r = new Route();
    const ks = (): number[] => Array.from(r.kind.slice(0, r.n));
    const stop = (floor: number, slot: number): Stop => ({ floor, x: slotX(floor, slot) + 23, y: lineY(floor) });
    const slotsOf = (f: number): number[] => {
      const e = floorExtent(st, f);
      const out: number[] = [];
      for (let s = -e.w; s < e.e; s++) out.push(s);
      return out;
    };
    const g = navGraph(st);
    notes.push(`nav: e55 x24 floors, skewed frames: ${g.N} nodes, ${g.aTo.length / 2} vertical links, ${g.links.length} transfers (from the city layout)`);

    // 1. Every slot pair across floors 0..23 with the lift on (a high and a low roll): never refused, never the ladder, within the cap.
    let plans = 0, worst = 0, lifts = 0, walked = 0, viaGallery = 0;
    const t0 = performance.now();
    for (let a = 0; a < 24; a++) for (let b = 0; b < 24; b++) {
      if (a === b) continue;
      const sa = slotsOf(a), sb = slotsOf(b);
      for (const x of sa) for (const y of sb) for (const rnd of [0.1, 0.9]) {
        plans++;
        const o = route(st, stop(a, x), stop(b, y), true, rnd, r);
        if (!o) { fail(`nav: ${a}:${x} -> ${b}:${y} (roll ${rnd}) refused: the survivor would teleport`); continue; }
        if (ks().includes(LEG_LADDER)) fail(`nav: ${a}:${x} -> ${b}:${y} uses the shaft ladder with the lift on`);
        if (r.n > MAX_WP) fail('nav: waypoint overflow');
        if (r.seconds > MAX_TRIP_S) fail(`nav: ${a}:${x} -> ${b}:${y} returned ${r.seconds.toFixed(1)} s`);
        worst = Math.max(worst, r.seconds);
        if (ks().includes(LEG_LIFT)) lifts++; else walked++;
        if (NAV_STATS.lastLinksUsed > 0 && !ks().includes(LEG_LIFT)) viaGallery++;
        checkColumns(r, fail, `${a}:${x}->${b}:${y}`);
      }
    }
    const ms = performance.now() - t0;
    notes.push(`nav: ${plans} plans (every slot pair, floors 0-23, lift on, rolls 0.1 / 0.9): none refused, ${lifts} by the lift, ${walked} walked (${viaGallery} through a gallery), longest ${worst.toFixed(1)} s (cap ${MAX_TRIP_S}); ${(ms * 1000 / plans).toFixed(1)} us a plan`);

    // 2. Gallery transfers carry trips between strata: blackout 3 -> 4 and the lift-shy 2 -> 6 (acceptance M2: "a 2->6 trip goes via the gallery").
    let o = route(st, stop(3, 2), stop(4, 2), false, 0.5, r);
    if (!o || ks().includes(LEG_LADDER) || NAV_STATS.lastLinksUsed !== 1) fail(`nav: blackout 3->4 should take the gallery transfer, got ${o ? ks().join('') : 'null'} (links ${NAV_STATS.lastLinksUsed})`);
    o = route(st, stop(2, 1), stop(6, 1), true, 0.1, r);
    if (!o || ks().includes(LEG_LIFT) || NAV_STATS.lastLinksUsed !== 1) fail(`nav: a lift-shy 2->6 should walk through the gallery, got ${o ? ks().join('') : 'null'}`);
    else notes.push(`nav: 2->6 lift-shy via the gallery: ${r.n} waypoints, ${r.seconds.toFixed(1)} s`);
    o = route(st, stop(2, 1), stop(6, 1), true, 0.9, r);
    if (!o || !ks().includes(LEG_LIFT)) fail(`nav: 2->6 with a high roll should ride the lift, got ${o ? ks().join('') : 'null'}`);
    // Blackout: every floor pair one stratum apart (and within one) reaches without the ladder when stairs exist; count the long ones.
    let bPlans = 0, bNull = 0, bLadder = 0, bLinks = 0;
    for (let a = 0; a < 24; a++) for (let b = Math.max(0, a - 5); b <= Math.min(23, a + 5); b++) {
      if (a === b) continue;
      for (const x of [0, 5, 11]) {
        bPlans++;
        o = route(st, stop(a, x), stop(b, x), false, 0.5, r);
        if (!o) { bNull++; continue; }
        if (ks().includes(LEG_LADDER)) bLadder++;
        if (NAV_STATS.lastLinksUsed) bLinks++;
        if (stratumOf(a) !== stratumOf(b) && !ks().includes(LEG_LADDER) && NAV_STATS.lastLinksUsed === 0) fail(`nav: blackout ${a}->${b} changes stratum without a transfer or the ladder`);
        checkColumns(r, fail, `blackout ${a}->${b}`);
      }
    }
    if (bLadder) fail(`nav: ${bLadder} blackout trips within 5 floors fell back to the shaft ladder (stairs and transfers exist)`);
    notes.push(`nav: blackout ${bPlans} plans within 5 floors: ${bPlans - bNull} drawn (${bLinks} through a gallery), ${bNull} too long to draw (> ${MAX_TRIP_S} s), none on the ladder`);

    // 3. Closed doors: a room shut in on both sides is unreachable; one shut door is walked around (another floor) or blocks, never crossed.
    const f = 9, s = 6;
    setDoorBlocked((fl, x0, x1) => fl === f && ((x0 === s - 1 && x1 === s) || (x0 === s && x1 === s + 1)));
    if (route(st, stop(2, 1), stop(f, s), true, 0.9, r) !== null) fail('nav: a room shut in by two closed doors must be unreachable');
    if (route(st, stop(f, s + 3), stop(f, s), true, 0.9, r) !== null) fail('nav: a same-floor walk into a shut-in room must be refused');
    setDoorBlocked((fl, x0, x1) => fl === f && x0 === 3 && x1 === 4);
    const doorX = slotX(f, 4);
    for (const rnd of [0.1, 0.9]) for (const from of [stop(f, 8), stop(f + 1, 9), stop(2, 0)]) {
      o = route(st, from, stop(f, 1), true, rnd, r);
      if (!o) continue;
      for (let i = 1; i < r.n; i++) {
        if (r.kind[i] !== LEG_WALK || r.floor[i] !== f || r.floor[i - 1] !== f) continue;
        const lo = Math.min(r.x[i - 1], r.x[i]), hi = Math.max(r.x[i - 1], r.x[i]);
        if (lo < doorX && hi > doorX) fail(`nav: a walk on floor ${f} crosses the closed door (${lo.toFixed(0)}..${hi.toFixed(0)} over ${doorX})`);
      }
    }
    o = route(st, stop(f, 8), stop(f, 1), true, 0.9, r);
    notes.push(`nav: closed door on floor ${f}: the same-floor trip ${o ? `goes around (${ks().join('')}, ${r.seconds.toFixed(1)} s)` : 'is refused'}`);
    setDoorBlocked(null);

    // 4. Query time on e55 (graph cached): a fixed spread of cross-floor trips.
    const N = 4000;
    const times: number[] = [];
    let seed = 7;
    const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < N; i++) {
      const a = Math.floor(rand() * 24), b = Math.floor(rand() * 24);
      const sa = slotsOf(a), sb = slotsOf(b);
      const A = stop(a, sa[Math.floor(rand() * sa.length)]), B = stop(b, sb[Math.floor(rand() * sb.length)]);
      const q = performance.now();
      route(st, A, B, rand() < 0.8, rand(), r);
      times.push(performance.now() - q);
    }
    times.sort((x, y) => x - y);
    const med = times[N >> 1], p90 = times[Math.floor(N * 0.9)], p99 = times[Math.floor(N * 0.99)];
    notes.push(`nav: query time e55 (graph cached, ${N} random trips): median ${(med * 1000).toFixed(0)} us, p90 ${(p90 * 1000).toFixed(0)} us, p99 ${(p99 * 1000).toFixed(0)} us`);
    if (med > 0.2) fail(`nav: median path query ${med.toFixed(3)} ms exceeds 0.2 ms`);
    const b0 = NAV_STATS.builds;
    for (let i = 0; i < 50; i++) route(st, stop(1, 1), stop(20, 3), true, 0.5, r);
    if (NAV_STATS.builds !== b0) fail('nav: the graph was rebuilt without a layout change');
    st.layout.infra.push({ id: 'navt', kind: 'stairwell', floor: 13, x: 7, floors: 2 });
    route(st, stop(1, 1), stop(20, 3), true, 0.5, r);
    if (NAV_STATS.builds !== b0 + 1) fail('nav: a new stairwell should rebuild the graph once');
    st.layout.infra.pop();

    // 5. The stand-in transfers follow the frames: they start on the upper stratum's east hub landing and end on the lower one's.
    for (const t of standInTransfers(24)) {
      if (Math.abs(t.top.x - (frameOf(t.fromFloor).hubR - 40 - HUB_STAIR_AMP)) > 0.01) fail(`nav: transfer ${t.gallery} top x ${t.top.x}`);
      if (Math.abs(t.bottom.x - (frameOf(t.toFloor).hubR - 40 - HUB_STAIR_AMP)) > 0.01) fail(`nav: transfer ${t.gallery} bottom x ${t.bottom.x}`);
    }
    // Same frame everywhere (the tokens of today): a trip still never uses a column through a frame change.
    if (roomsEastX(3) === roomsEastX(4)) fail('nav: the skewed frames should differ between strata 1 and 2');
  } finally {
    __setProjectionForTests('classic');
    setNavLayoutSource(null);
    resetNavGraph();
    GFX.airy = airyWas;
    GFX.galleries = galWas;
    setDoorBlocked(null);
  }
}

/**
 * A hub or tower stairs leg (4 flights a storey, |amp| 19) and a stairwell leg (one flight a storey) are vertical columns: both ends must sit in
 * the same frame (a column that crossed a jog would be drawn at the wrong x on one end). Transfer legs (one flight, or an odd zig-zag that
 * spans dx) are free.
 */
function checkColumns(r: Route, fail: (m: string) => void, what: string): void {
  for (let i = 1; i < r.n; i++) {
    if (r.kind[i] !== LEG_STAIRS) continue;
    const fa = r.floor[i - 1], fb = r.floor[i];
    if (fa === fb) continue;
    const column = Math.abs(r.amp[i]) === 19 && r.flights[i] % 4 === 0 && Math.abs(r.x[i] - r.x[i - 1]) < 0.01 && Math.abs(r.y[i - 1] - laneY(fa)) < 0.5;
    if (!column) continue;
    const Fa = frameOf(fa), Fb = frameOf(fb);
    if (Fa.hubL !== Fb.hubL || Fa.hubR !== Fb.hubR || Fa.vestE !== Fb.vestE || Fa.vestW !== Fb.vestW) fail(`nav: ${what} takes a stair column across a frame change (${fa} -> ${fb})`);
  }
}

/**
 * [world:M2 camera-nav] The follow tracker (src/world/nav/followGesture.ts), stepped at 60 Hz on a phone view (390 x 560 between the HUD
 * bands, zoom 1): a survivor walking a lane and turning, then a 2 s lift ride over a whole stratum (about 2,300 units, eased). Once held, the
 * survivor never leaves the central CAMERA.follow.deadZone; the catch-up never jumps; reduced motion only cuts (and centres).
 */
export function followChecks(fail: (m: string) => void, notes: string[]): void {
  const dt = 1 / 60, vw = 390, vh = 560, z = 1;
  const dz = CAMERA.follow.deadZone;
  const hw = (vw * dz) / 2 / z, hh = (vh * dz) / 2 / z;
  for (const calm of [false, true]) {
    const tr = new FollowTracker();
    const cam = { x: -300, y: 400 };
    let t = 0, worstOut = 0, maxStep = 0, cuts = 0, lockedAt = -1, firstStep = 0;
    let lastX = cam.x, lastY = cam.y;
    const target = (time: number): { x: number; y: number } => {
      if (time < 6) return { x: 200 + 30 * time, y: 700 };              // walking east
      if (time < 9) return { x: 380 - 30 * (time - 6), y: 700 };         // turns back west
      if (time < 11) { const u = (time - 9) / 2, e = u * u * (3 - 2 * u); return { x: 290, y: 700 + 2300 * e }; } // the lift
      return { x: 290 + 30 * (time - 11), y: 3000 };                     // walks off on the new floor
    };
    for (let i = 0; i < 60 * 14; i++) {
      t += dt;
      const p = target(t);
      tr.step(cam, p.x, p.y, dt, z, vw, vh, calm);
      const step = Math.hypot(cam.x - lastX, cam.y - lastY);
      if (i === 0) firstStep = step;
      if (calm && step > 0) {
        cuts++;
        if (Math.abs(cam.x - p.x) > 0.01 || Math.abs(cam.y - p.y) > 0.01) fail('follow (reduced motion): a cut must centre the survivor');
      }
      if (tr.locked && lockedAt < 0) lockedAt = t;
      if (tr.locked) {
        worstOut = Math.max(worstOut, Math.abs(p.x - cam.x) - hw, Math.abs(p.y - cam.y) - hh);
        if (!calm) maxStep = Math.max(maxStep, step);
      }
      lastX = cam.x;
      lastY = cam.y;
    }
    if (worstOut > 0.01) fail(`follow${calm ? ' (reduced motion)' : ''}: the survivor left the central ${dz * 100}% by ${worstOut.toFixed(1)} units`);
    if (!calm && firstStep > Math.hypot(500, 300) * 0.2) fail(`follow: the catch-up jumped ${firstStep.toFixed(0)} units in one frame`);
    if (!calm && lockedAt < 0) fail('follow: the camera never caught the survivor');
    notes.push(calm
      ? `follow (reduced motion): ${cuts} cuts over 14 s (walk, turn, a 2 s lift ride, walk), survivor always inside the central ${dz * 100}%`
      : `follow: held after ${lockedAt.toFixed(2)} s; survivor inside the central ${dz * 100}% every frame after (walk, turn, 2,300-unit lift ride); largest camera move ${maxStep.toFixed(1)} units / frame (the lift peaks at ${(2300 * 1.5 / 2 / 60).toFixed(1)})`);
  }
}
