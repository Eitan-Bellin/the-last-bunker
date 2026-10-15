// [world:C0] Projection checks (architecture 3.2): the city projection keeps the logical grid's geometry honest. Run by project-test.mjs over the
// sample saves (migrated with the live code) under three projections: classic (must equal the legacy geom.ts maths bit for bit), the city frames
// of tokens.ts, and a deliberately SKEWED set (every stratum shifted by 37 u more than the last, odd vestibules), so a call that passes the wrong
// floor (or none) shows up as a misplaced edge.
import { migrateState, floorExtent, type GameState } from '../../src/core/GameState';
import { roomFloors, isDistrict, touching } from '../../src/data/buildingDefs';
import { MAX_FLOORS } from '../../src/data/zones';
import { stratumOf, STRATA } from '../../src/data/strata';
import { isPassable } from '../../src/systems/doors';
import * as legacy from '../../src/rendering/geom';
import { SLOT_W, extentsFor } from '../../src/rendering/geom';
import { occupancy } from '../../src/rendering/occupancy';
import { openingsOfFloor } from '../../src/rendering/openings';
import { setDoorBlocked, walkBlocked } from '../../src/rendering/routes';
import { CITY } from '../../src/world/tokens';
import type { CityFrameTokens } from '../../src/world/tokens';
import {
  __setProjectionForTests, buildingRect, districtXAt, frameOf, hubRect, roomsEastX, roomsWestX, slotAtX, slotSpanX, slotX, stripX, useClassicProjection,
  type ProjectionKind,
} from '../../src/world/project';
import type { Rect } from '../../src/world/types';
import { DEFAULT_CITY, resolveCity } from '../../src/world/flag';

/** Every stratum 37 u further out than the one above, with odd vestibules and tunnels (stratum 0 stays classic: project.ts forces it). */
export const SKEW: CityFrameTokens[] = [0, 1, 2, 3, 4, 5, 6].map(s => ({
  hubL: -(20 + 37 * s), hubR: 58 + 11 + 37 * s, vestW: 6 + ((37 * s) % 23), vestE: 6 + ((37 * s) % 29), tunnel: 18 + 5 * s,
}));

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

export function projectChecks(games: { name: string; json: string }[]): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const modes: { name: string; kind: ProjectionKind; frames?: CityFrameTokens[] }[] = [
    { name: 'classic', kind: 'classic' }, { name: 'city', kind: 'city' }, { name: 'skew', kind: 'city', frames: SKEW },
  ];
  try {
    for (const mode of modes) {
      __setProjectionForTests(mode.kind, mode.frames ?? null);
      const fail = (m: string) => { if (problems.length < 40) problems.push(`[${mode.name}] ${m}`); };
      let checked = 0;

      // Pure frame maths on every floor: slotAtX round-trips, is null inside the hub and vestibules, the spans and strips agree.
      for (let f = -1; f < MAX_FLOORS; f++) {
        const F = frameOf(f);
        if (F.s !== stratumOf(f)) fail(`frameOf(${f}) is stratum ${F.s}, expected ${stratumOf(f)}`);
        for (let s = -24; s < 40; s++) {
          const x = slotX(f, s);
          if (slotAtX(f, x + 0.5) !== s || slotAtX(f, x + SLOT_W - 0.5) !== s) fail(`slotAtX does not round-trip floor ${f} slot ${s}`);
          if (mode.kind === 'classic' && (x !== legacy.slotX(s) || legacy.slotAtX(x + 0.5) !== s)) fail(`classic slotX(${f}, ${s}) = ${x}, legacy ${legacy.slotX(s)}`);
          const sp = slotSpanX(f, s, 3);
          if (s >= 0 || s + 3 <= 0) { if (sp.x1 - sp.x0 !== 3 * SLOT_W) fail(`slotSpanX(${f}, ${s}, 3) is ${sp.x1 - sp.x0} wide`); }
          checked++;
        }
        for (let x = roomsWestX(f) + 0.01; x < roomsEastX(f); x += 3) if (slotAtX(f, x) !== null) { fail(`slotAtX(${f}, ${x.toFixed(1)}) is a slot inside the hub / vestibules`); break; }
        if (roomsWestX(f) > F.hubL || roomsEastX(f) < F.hubR || F.hubL > 0 || F.hubR < legacy.SHAFT_W) fail(`floor ${f}: the hub does not hold the spine or the vestibules are inside it`);
        if (f >= 0) {
          const h = hubRect(F.s);
          if (h.x !== F.hubL || h.x + h.w !== F.hubR) fail(`hubRect(${F.s}) is not hubL..hubR`);
        }
        if (mode.kind === 'classic') {
          for (const e of [{ w: 0, e: 12 }, { w: 4, e: 16 }]) {
            const sx = stripX(f, e);
            if (sx.x0 !== (e.w > 0 ? legacy.slotX(-e.w) : 0) || sx.x1 !== legacy.slotX(e.e)) fail(`classic stripX(${f}) differs from the legacy strip`);
          }
          if (districtXAt(f, 14) !== legacy.districtXAt(14)) fail(`classic districtXAt(${f}) differs from legacy`);
        }
      }

      for (const g of games) {
        let state: GameState;
        try { state = migrateState(JSON.parse(g.json) as GameState); } catch (e) { fail(`${g.name}: does not parse (${e})`); continue; }
        const floors = state.currentFloors;
        // Synthetic shut doors on every floor (both sides of the spine where the floor reaches), so walkBlocked has something to agree about.
        state.layout = { ...state.layout, doors: { ...state.layout.doors } };
        for (let f = 0; f < floors; f++) {
          const ext = floorExtent(state, f);
          if (ext.e > 4) state.layout.doors[`${f}:3`] = f % 2 ? 'sealed' : 'closed';
          if (ext.w > 3) state.layout.doors[`${f}:-2`] = 'closed';
        }
        const rooms = state.buildings.filter(b => b.position.floor >= 0);
        const rectOf = new Map<string, Rect>();
        for (const b of rooms) {
          const r = buildingRect(b);
          rectOf.set(b.id, r);
          if (mode.kind === 'classic' && (r.x !== legacy.buildingX(b))) fail(`${g.name}: classic buildingX(${b.id}) = ${r.x}, legacy ${legacy.buildingX(b)}`);
          // A hall is one rect over two storeys: both of its floors must put it at the same x (it never straddles a gallery, so never a stratum seam).
          if (roomFloors(b.type) > 1 && !isDistrict(b.type)) {
            for (let k = 1; k < roomFloors(b.type); k++) if (slotX(b.position.floor + k, b.position.x) !== r.x) fail(`${g.name}: hall ${b.id} is not aligned on floor ${b.position.floor + k}`);
          }
        }
        // Touching rooms share an edge (except across the spine, where the hub and the shaft stand between them, as in the classic tower).
        for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i], b = rooms[j];
          if (isDistrict(a.type) || isDistrict(b.type) || !touching(a, b)) continue;
          const [l, r] = a.position.x < b.position.x ? [a, b] : [b, a];
          if (r.position.x === 0) continue; // across the spine
          const ra = rectOf.get(l.id)!, rb = rectOf.get(r.id)!;
          if (Math.abs(ra.x + ra.w - rb.x) > 1e-6) fail(`${g.name}: touching rooms ${l.id} / ${r.id} on floor ${l.position.floor} do not share an edge (${ra.x + ra.w} vs ${rb.x})`);
          checked++;
        }
        // No two things overlap: rooms, districts and ruins (a hall covers both of its storeys).
        const all: { id: string; r: Rect }[] = [...rooms.map(b => ({ id: b.id, r: rectOf.get(b.id)! }))];
        for (const ru of state.ruins ?? []) if (ru.floor >= 0) {
          const sp = slotSpanX(ru.floor, ru.x, ru.w);
          all.push({ id: ru.id, r: { x: sp.x0, y: legacy.floorTop(ru.floor), w: sp.x1 - sp.x0, h: legacy.ROOM_H } });
        }
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlap(all[i].r, all[j].r)) fail(`${g.name}: ${all[i].id} and ${all[j].id} overlap`);
        // Nothing sits in the hub; a district opens past the end of its floor.
        for (const b of rooms) {
          const r = rectOf.get(b.id)!, F = frameOf(b.position.floor);
          if (r.x < F.hubR + 1e-6 && r.x + r.w > F.hubL - 1e-6) fail(`${g.name}: ${b.id} reaches into the hub of stratum ${F.s}`);
          if (isDistrict(b.type) && r.x < slotX(b.position.floor, floorExtent(state, b.position.floor).e)) fail(`${g.name}: district ${b.id} starts inside its floor`);
        }
        // Doorways sit on room edges; walkBlocked agrees with the door rules.
        const grid = occupancy(state.buildings, state.ruins, floors, extentsFor(state, floors));
        setDoorBlocked((f, a, b) => !isPassable(state, f, a, b));
        for (let f = 0; f < floors; f++) {
          for (const o of openingsOfFloor(grid, f)) {
            const want = o.kind === 'landing' ? (o.side === 'w' ? roomsWestX(f) : roomsEastX(f)) : slotX(f, o.slot);
            if (o.x !== want) fail(`${g.name}: floor ${f} ${o.kind} door at slot ${o.slot} has x ${o.x}, expected ${want}`);
            const L = o.leftId ? rectOf.get(o.leftId) : undefined, R = o.rightId ? rectOf.get(o.rightId) : undefined;
            if (L && rooms.find(b => b.id === o.leftId)?.position.floor === f && Math.abs(L.x + L.w - o.x) > 1e-6) fail(`${g.name}: floor ${f} door x ${o.x} is not the east edge of ${o.leftId}`);
            if (R && rooms.find(b => b.id === o.rightId)?.position.floor === f && Math.abs(R.x - o.x) > 1e-6) fail(`${g.name}: floor ${f} door x ${o.x} is not the west edge of ${o.rightId}`);
            checked++;
          }
          const ext = floorExtent(state, f);
          for (const [lo, hi] of [[0, ext.e], [-ext.w, 0]] as [number, number][]) {
            for (let s0 = lo; s0 < hi; s0 += 2) for (let s1 = s0 + 1; s1 < hi; s1 += 3) {
              const x0 = slotX(f, s0) + SLOT_W / 2, x1 = slotX(f, s1) + SLOT_W / 2;
              const want = !isPassable(state, f, s0, s1);
              if (walkBlocked(f, x0, x1) !== want || walkBlocked(f, x1, x0) !== want) fail(`${g.name}: floor ${f} walk ${s0} -> ${s1}: walkBlocked ${!want}, doors say ${want}`);
              checked++;
            }
          }
        }
        setDoorBlocked(null);
      }
      notes.push(`${mode.name}: ${checked} checks over ${games.length} game(s), ${STRATA.length} strata`);
    }
  } finally {
    __setProjectionForTests('classic');
    setDoorBlocked(null);
  }
  // The city frames come from tokens and are not the classic ones (or this test would prove nothing).
  if (CITY.frames[1].hubR === CITY.classic.hubR) problems.push('city: the underground frame equals the classic one');
  // [world:M2] Distinct frames (D5 lifted): no two neighbouring strata share a frame, and every hub side holds the wall, a stair column and
  // its landing beside the spine (CITY.hub: wallW + stairInset + stairW, and the landing TOWER_AMP past the column centre on the balcony).
  const H = CITY.hub, side = H.wallW + H.stairInset + H.stairW;
  for (let s = 1; s <= 6; s++) {
    const F = CITY.frames[s];
    if (s > 1) { const P = CITY.frames[s - 1]; if (P.hubL === F.hubL && P.hubR === F.hubR && P.vestW === F.vestW && P.vestE === F.vestE) problems.push(`city: strata ${s - 1} and ${s} share a frame`); }
    if (-F.hubL < side + 2 || F.hubR - legacy.SHAFT_W < side + 2) problems.push(`city: stratum ${s}'s hub is too narrow for its stair columns`);
    if (F.hubL + H.wallW + H.stairInset + H.stairW / 2 + legacy.TOWER_AMP > 0) problems.push(`city: stratum ${s}'s west landing is not on the balcony`);
    if (F.vestW < 6 || F.vestE < 6 || F.tunnel < 6) problems.push(`city: stratum ${s}'s vestibules or tunnel are too short`);
  }
  // [world:M1] The flag: the query wins (and `?city=0` beats a remembered '1'), then the remembered '1' / '0', then DEFAULT_CITY.
  const flagCases: [string, string | null, boolean][] = [
    ['?city', null, true], ['?city=1', '0', true], ['?city=0', '1', false], ['?slot=a&city', null, true], ['', '1', true], ['', '0', false],
    ['', null, DEFAULT_CITY], ['', 'junk', DEFAULT_CITY], ['?slot=x', null, DEFAULT_CITY],
  ];
  for (const [q, st, want] of flagCases) if (resolveCity(q, st) !== want) problems.push(`flag: resolveCity(${q || '(none)'}, ${st}) is not ${want}`);
  // The session kill switch puts the classic frames back on every stratum.
  __setProjectionForTests('city');
  useClassicProjection();
  for (let f = 0; f < MAX_FLOORS; f++) if (slotX(f, 0) !== legacy.slotX(0)) { problems.push(`flag: after useClassicProjection floor ${f} slot 0 is not classic`); break; }
  __setProjectionForTests('classic');
  notes.push(`flag: ${flagCases.length} resolution cases, kill switch restores classic`);
  return { problems, notes };
}
