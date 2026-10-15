# M2 — camera-nav notes: the nav graph, follow-survivor

*Branch `world/m2-N` (from `world-redesign` @ `c692979`), 2026-10-15.*

## 1. Files

| File | What |
|---|---|
| `src/world/nav/graph.ts` (new) | The city nav graph: Dijkstra over lift landings, the shaft ladder, hub stair columns, void towers, stairwells and gallery transfers. It emits the existing `Route`, so walkers.ts is unchanged. Cached per layout key; a query allocates nothing. |
| `src/world/nav/followGesture.ts` (new) | `FollowSource` (the seam to the survivors) and `FollowTracker` (dead-zone hold, catch-up glide, reduced-motion cuts). Pure, Node-safe. |
| `src/rendering/routes.ts` | `route()` asks `planCityRoute` first in the city. Also: `MAX_WP` 16 → 32, `CITY_MAX_TRIP_S` 75, and `walkTo` / `pushWaypoint` / `LIFT_EST_S` are exported. Classic behaviour is unchanged. |
| `src/rendering/walkers.ts` | Read-only `pickAt(wx, wy, slop)`, `locate(id, …)` and `followSource(people, world)`. Routing and life are untouched. |
| `src/rendering/CameraController.ts` | `follow()` for real, plus `startFollow(id)`, `stopFollow()`, `setFollowSource()`, `followedId` and `onFollowChange`. Also the gestures (section 4). |
| `src/world/tokens.ts` | CAMERA block only: `follow` gets `catchUp`, `maxLead`, `minZoom`, `pickSlopPx` and `jumpPx`; `deadZone` goes 0.2 → 0.3 (the brief's "central 30 %"). |
| `tools/sim/nav-test.ts` (new) | The e55 nav checks and the follow-tracker checks. They are called from `routes-test.ts`, and `routes-test.mjs` now reads `saves-v7/e55-seed1.json`. |
| `tools/sim/routes-test.ts` | The city slice cases are adapted to the graph (section 3). |

## 2. For the orchestrator: BunkerRenderer wiring (1 line, not applied here)

I tested this line locally and then reverted it, because BunkerRenderer is the tech-artist's file:

```ts
// constructor, right after `this.cam.setup();` (l.578 at c692979):
this.cam.setFollowSource(this.walkers.followSource(this.people, this.worldContainer)); // [world:M2 camera-nav] follow-survivor: double tap a walker
```

- Without this line the follow gesture does nothing: `pickSurvivor` returns null, and double taps frame rooms as before.
- `follow(get)` still works for any point.
- No other wiring is needed:
  - the nav graph reads the hubs and transfers from `cityLayoutProvider()`, which `cityWiring` already sets to the real `buildCityLayout`;
  - doors still come through `setDoorBlocked`.

**For the UX session (the person sheet, the follow chip):**
- `renderer.cam.startFollow(survivorId): boolean` (false = survivor unknown, or the source is not wired);
- `cam.stopFollow()`;
- `cam.followedId` (string | null);
- `cam.onFollowChange = (id | null) => …` fires on every start and end, including the user's pan, pinch, wheel or tap.
- **Note:** the first tap of a double tap on a walker still opens the person sheet (`onPersonTap`), as before; the second tap starts the follow and leaves the sheet open. The UX session may want to close the sheet on `onFollowChange(id)`, or show the chip in it.

## 3. The nav graph (deliverable 1)

**Nodes and edges.**
- **Nodes** sit on each dug floor and the surface row:
  - lift landing (`LANDING_X`, lane);
  - shaft ladder foot (`LADDER_X`, room line);
  - hub stair stops (layout `hubs[].stairs`, right landing, lane);
  - void tower stops (airy);
  - stairwell / evacuation-room stops (room line);
  - transfer ends.
- **Walking:** neighbouring nodes in x order are joined. Each such link is checked with `walkBlocked`, so a closed or sealed door cuts it.
- **Lift:** every landing to every other one, at `LIFT_EST_S` (10 s).
- **Columns:** a column joins two floors only when it stands at the same x on both (same frame). Column jogs between strata with different frames therefore need nothing special: no stair is ever drawn across a jog. Hub columns never leave their stratum.
- **Transfers:** a transfer is an edge between its two ends. Its `run` is walked as follows:
  - a nearly flat segment: a walk;
  - a slope (|dx| ≥ |dy|/2): one straight flight (ramp or stair run);
  - anything steeper: zig-zag flights of `FLIGHT_RISE`; an odd count spans dx, and an even count of ±19 is used for a straight drop.
- **Ramps or stairs inside a stratum** can be given in the same `transfers` list.
- **Bridges** are same-floor and already walkable (a walk across the spine was never blocked).

**Costs.**
- All costs are travel time in seconds.
- The ladder is weighted ×4 in the search, so it stays the last resort. Walkers refuse ladder trips with power on, so they must not be planned there when stairs exist.
- **Rolls:**
  - `rnd < CITY_HUB_STAIR_SHARE` (0.5) means *lift-shy*: the lift costs +45 s, so any trip that stays drawable is walked.
  - Otherwise stairs, towers and transfers weigh ×1.6 (`STAIR_EFFORT`), so the walker mostly rides.
  - A lift-shy plan over the cap is planned again without the penalty. One still over the cap is refused, so the survivor appears (as before).
- **Same floor:** a trip with nothing in the way is the old straight walk. Behind a closed door the graph looks for a way around (another floor). If there is none, the trip is refused.

**Cache.**
- `navKey` is a numeric FNV hash of:
  - the floor count;
  - the per-floor extents (read in place; no `floorExtent` allocation);
  - rooms (floor, slot, constructing, type), ruins and infra;
  - the frames of strata 1-6;
  - the airy and galleries flags.
- The graph (typed arrays, CSR edges, a preallocated heap) is rebuilt only when the key moves.
- A query writes into preallocated scratch arrays only.

**Contract with LEVEL-BUILDER (transfers).**
- I code against `transfers: { gallery, fromFloor, toFloor, side, top, bottom, run }[]` on `CityLayout`, read as `(layout as …).transfers`. `M2-L-notes.md` did not exist yet in lbw-C.
- `run` may or may not repeat `top` and `bottom`; points are deduped.
- **If the field is absent:** `standInTransfers(floors)` runs one stand-in per revealed gallery. It goes down from the upper stratum's east hub stair landing into the gallery (`galleryTop + GALLERY_H - 6`), along it, and down to the lower stratum's east hub landing.
- **If the field is present** (even `[]`), the stand-ins are off. At merge: if L's geometry lands, nothing to do. If L ships no transfers, the stand-ins keep the gallery walkable, but they are not drawn as stairs.

**The city trip cap (decision).**
- `CITY_MAX_TRIP_S` = 75 s; classic keeps `MAX_TRIP_S` = 60 s.
- With wide, skewed frames, a trip from the far east of a 14-slot floor to the far east of another stratum's floor takes 61-75 s even by lift: about 25 s of walking each way plus the 10 s lift. That is because the hub and its vestibules add about 130 units per crossing.
- At 60 s, 258 of 177k plans were refused (teleports). At 75 s, none are.

## 4. Follow-survivor (deliverable 3)

**Tracker (`FollowTracker.step`).**
- **Catch-up:** a glide at `catchUp` 6/s, with no hold until the target is inside the dead zone.
- **Held:** the camera eases at `spring` 5/s toward the target plus a look-ahead (0.25 s of smoothed velocity, capped at half the dead zone). A **hard hold** then keeps the target inside the central `deadZone` (30 %) on both axes every frame.
- This is what makes lift rides work: the car crosses about 2,300 units in 2 s, which a spring alone would lose.
- A target that moves more than `jumpPx` (240 screen px) in a frame was placed, not walked: the tracker drops back to catch-up, so nothing snaps.
- **Reduced motion:** cuts only. The camera stands still while the target is inside the dead zone, then cuts to centre it.
- On start the camera zooms in to `minZoom` 1 if it is further out (eased; reduced motion: at once), so walkers keep walking (`WALK_MIN_ZOOM` is 0.7).

**What it follows.**
- A walker: its slot position. While riding the lift: the car (`lift.carY()`).
- Anyone else: their figure in their room, through the parent chain, with no allocation.
- So the follow continues when the walk ends. `locate` returning false (the person is gone) ends it.

**Gestures (city only, in CameraController; no DOM):**

| Gesture | Effect |
|---|---|
| Double tap on a walking survivor (or loiterer / digger out of their room) | Starts the follow. The `onDoubleTap` hit test runs before the room framing. |
| Drag past the threshold, pinch, wheel | Stops it. A touch alone no longer cancels; the C1 stub cancelled on every pointerdown. |
| Single tap on the followed survivor | Keeps it (the sheet opens as usual). |
| Single tap anywhere else in the world | Stops it. |

- Long press is left alone: it picks the survivor up.

## 5. Tests and gates

**`routes-test`** (in check:full).

Classic: **digest `261d4638`, unchanged** (the same as at c692979).

City slice (adapted from C1):
- 864 plans: none refused, no ladder, longest 42.1 s.
- The cases that encoded the old rules now follow the graph:
  - a "high roll rides the lift" case starts beside the hub (from the far end two storeys of stairs can honestly be quicker);
  - the closed-door case shuts the room in on both sides, because one shut door is now walked around via another floor.

New `nav-test` on **e55 with 24 floors and deliberately skewed per-stratum frames** (`SKEWED_FRAMES`, via `__setProjectionForTests('city', frames)`):

| Check | Result |
|---|---|
| Every slot pair, floors 0-23, lift on, rolls 0.1 / 0.9 | 177,072 plans. None refused, no ladder, every plan ≤ 75 s. 140,352 by lift, 36,720 walked, of which 17,146 go through a gallery. |
| Stair columns across a frame change | None in any plan. |
| Blackout 3→4 | Takes the transfer (no ladder). |
| **Lift-shy 2→6** | Goes **via the gallery**: 11 waypoints, 52.1 s (M2 acceptance). A high roll rides. |
| Blackout, every floor pair within 5 floors | 544 of 630 drawn (328 through a gallery). 86 are too long to draw. None on the ladder. |
| Closed doors | A room shut in on both sides is unreachable (from another floor and on the same floor). With one shut door, no walk on that floor ever crosses it; the same-floor trip goes around via the towers (30.3 s). |
| Cache | 50 repeated queries cause no rebuild. A new stairwell causes exactly one rebuild. |
| Follow tracker (60 Hz, 390×560 view) | Walk, turn, a 2 s / 2,300-unit lift ride, walk. Held after 0.38 s; the survivor stays inside the central 30 % every frame after. The largest camera step equals the lift's peak speed (28.7 vs 28.8 units per frame), with no overshoot. Reduced motion: 30 cuts, each of which centres the survivor. |

**Path query time, e55** (graph cached, 4,000 random trips, Node):

| Run | Median | p90 | p99 |
|---|---|---|---|
| In check:full | 46 µs | 71 µs | 113 µs |
| Under load from the other worktrees | 71-85 µs | — | — |

The target was ≤ 0.2 ms typical. The graph has 189 nodes and 124 vertical links (five stand-in transfers).

**Gates.**
- `npm run check:full`: EXIT 0.
- `tsc`: clean.
- `vite build` into the scratchpad: OK (only the usual chunk-size warning).

**Checked in the dev build** (vite on 5179, `?city&slot=navt`, slice, with the wiring line applied locally):
- The in-game router uses the graph with the real provider (1 build, 19 nodes).
- `startFollow('s_4')`, then reassigning the survivor:
  - followed a 2-floor tower-stair walk, then a walk + lift + walk;
  - horizontal offset from centre ≤ 0.3 % of the width;
  - **during the lift ride ≤ 3.7 % of the height** (the hold allows 15 %).
- The follow continued in the room after arrival.
- With synthetic pointer events:
  - a double tap on the walker started it;
  - a drag stopped it, a wheel stopped it, and a tap on empty rock stopped it;
  - a tap on the followed survivor kept it.
- No console errors.

## 6. Not verified / open

- **Reduced motion in the browser:** checked by the Node tracker test only.
- **Real touch on a phone:** the double tap was checked with synthetic pointer events in the desktop dev build.
- **The transfer geometry is a stand-in** until LEVEL-BUILDER's `transfers` land: walkers would cross the gallery band where nothing is drawn as stairs yet.
- **`preview_start world-T` was refused:** the folder already had 5 servers, 3 of them other agents'. I ran `npx vite --port 5179` from lbw-T instead.
- **The Browser pane is shared with the other agents:** a tab I had fronted was navigated to 5178 by someone else mid-test. I re-ran in a fresh tab.
- **e55 blackout:** 86 of 630 trips within 5 floors are still too long to draw (> 75 s) and appear at once, as classic does with the ladder.
