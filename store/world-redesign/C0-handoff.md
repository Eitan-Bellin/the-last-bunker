# C0 hand-off — level-builder, "The City Below"

*Branch `world-redesign`, tag `world-c0`. Spec: `C-world-architecture.md` sections 1.1, 1.2, 1.5, 2, 3, 6.2/C0. 2026-10-15.*

## What changed

| Commit | Content |
|---|---|
| `feat(world)` | `src/world/{types,flag,project}.ts`, `src/data/strata.ts`, `CITY` block in `src/world/tokens.ts` |
| `refactor(render)` | S1-S3 codemod: every x conversion in `src/rendering/*`, `src/dev/camShots.ts` and the route/opening tests goes through `project.ts` with a floor |
| `feat(save)` | save v8: `src/core/state/city.ts`, `GameState.city`, `migrateLayout` seam, `whatsnew:v8`, `src/systems/CitySystem.ts` |
| `fix(world)` | `tokens.ts`: an adult survivor is 48 u tall, not 56 (the game's real value; `CAMERA` comment and `adultHeight`) |
| `test(sim)` | `tools/sim/project-test.{ts,mjs}`, v8 assertions in `tools/sim/migrate.ts`, lint (city checks, x ratchet, floor-0 warning), `store/sim/saves-v7/`, `check:full` |

## API summary

**`src/world/project.ts`** (Node-safe; the only x ↔ (floor, slot) code)

- `PROJECTION` is a live binding: `'classic'` by default, `'city'` with `?city`.
- `__setProjectionForTests(kind, frames?)` switches it in tests.
- Frame lookup: `frameOf(floor)`, `frameOfStratum(s)`, `CLASSIC_FRAME`.
- Slot conversions:
  - `slotX(floor, slot)`
  - `slotAtX(floor, x)` returns null inside the hub or a vestibule. Always find y first (`floorAtY`), then call this.
- Edges of the room rows:
  - `roomsEastX(f)` is the old `ROOMS_X`.
  - `roomsWestX(f)` is the old `-SHAFT_GAP`.
- Spans and rects:
  - `slotSpanX(f, slot, n)` and `roomRect(f, slot, slots, floors)`.
  - `buildingX(b)`, `buildingW(b)`, `buildingRect(b)` (districts included).
  - `districtXAt(f, slotAt)`.
- Strips: `stripX(f, ext)` gives the x0/x1 of a floor strip; when there is no west wing, x0 is `hubL`. `stripBounds(exts)` covers several floors.
- Global extents (world edges, casing, camera, city map): `westmostSlotX(slot)` and `eastmostSlotX(slot)`, taken over every stratum's frame.
- Whole-structure rects: `spineRect(floors?)` and `hubRect(s)`.

**Frames** (`CITY.frames` in `tokens.ts`)

| Frame | Used for | hubL | hubR | vestW | vestE | tunnel |
|---|---|---|---|---|---|---|
| Classic | stratum 0 (the surface row is always classic) | 0 | 58 | 6 | 6 | 18 |
| Underground (one shared frame, D5) | strata 1-6 | -64 | 122 | 36 | 36 | 18 |

- In the underground frame, east rooms start at x 154 and west rooms end at -100.
- `CITY.hub` holds the atrium geometry: `wallW` 10, `stairW` 44, `stairInset` 8, `balconyDepth`/`balconyRail` 14, `vaultRise` 56, `bridgeFloor` 1, `bridgeH` 8, `vestLampEvery` 24. Each side of the spine leaves 64 u for wall + stair column.

**`src/world/flag.ts`**

- `CITY` is true when `?city` is present and not `city=0`.
- `cityFromSearch(search)`.

**`src/data/strata.ts`** (pure)

- `STRATA[0..6]`, each with:
  - he/en names;
  - `KitId`: surface / shelter / works / metro / mines / caves / core.
- Floor ranges: floors `[4(s-1), 4(s-1)+3]`, and the surface is `[-1,-1]`.
- Helpers: `stratumOf`, `strataReached`, `isStratumTop`, `allPockets`, `pocketById`, `pocketStratum`, `FLOORS_PER_STRATUM`.
- Pockets:
  - 2-3 per stratum 1-6, with ids `p:<s>:<name>`.
  - East pockets start at slot ≥ 30. West pockets end at slot ≤ -14.
  - `p:2:crawlway` sits inside the gallery band under floor 7. For side `'below'`, `dy` is measured from `galleryTop`.
- Note: tokens.ts names stratum 2 `service`, while `KitId` uses `works`, as the brief asks.

**Save v8**

- `state.city = { v: 1, seen: string[], found: string[] }`. Both lists are sorted and unique.
- `revealedAreaIds(state)` is derived. It covers:
  - `surface`;
  - `s:<s>` for strata reached;
  - `f:<floor>` for dug floors;
  - `g:<i>` for dug galleries;
  - `d:<kind>` for built districts;
  - found pockets.
- Edges (`e:<f>:<side>`) are never "revealed".
- `seedCity(merged)` marks everything revealed as seen, plus `surface`, `s:0`, `s:1`. `found` starts empty.
- `normalizeCity` keeps unknown `p:` ids, so they survive a round trip.
- `migrateState`:
  - `merged.layout = migrateLayout(saved.layout)`. This is the seam; the layout is still `v:1`.
  - `whatsnew:v8` is added once when `saved.version < 8`.
  - `merged.city = saved.city ? normalizeCity(...) : seedCity(merged)`.
- A new game gets `createCity()`, which is empty.

**`CitySystem`** (`engine.citySystem`)

- Methods: `markSeen(...ids)`, `find(pocketId)` (only once its stratum is reached), `canFind`, `unseen()`, `city()`.
- Events: `city:seen`, `city:found`.
- It has no tick, is not in `GameEngine.tick`, and the bot never calls it.

## Remaining legacy call sites (UX session, S4)

Lint counts these 5; `LEGACY_X_BASELINE = 5` in `tools/sim/lint.ts`.

| File | Line(s) | Legacy use |
|---|---|---|
| `src/ui/ceremony.ts` | 5 | imports `buildingX`, `slotX` |
| `src/ui/ceremony.ts` | 266 | `buildingX` |
| `src/ui/ceremony.ts` | 360 | `slotX(-ext.w)` / `slotX(ext.e)` / `slotX(0)` |
| `src/ui/ceremony.ts` | 393 | gate `slotX(0)` |
| `src/ui/controllers/world.ts` | 19 | import |
| `src/ui/controllers/world.ts` | 224 | `slotX(p.x)`; should become `slotX(p.floor, p.x)` |
| `src/ui/share.ts` | 5 | `buildingX` import |
| `src/ui/share.ts` | 78-84 | bounds from `SHAFT_W` / `buildingX` |
| `src/ui/tour.ts` | 4 | import |
| `src/ui/tour.ts` | 188-189 | `slotX(...)`; should become `slotX(f, ...)` |

`geom.ts` keeps the deprecated `slotX(slot)`, `slotAtX(x)`, `buildingX`, `districtXAt`, `DISTRICT_X`, `ROOMS_X`, `SHAFT_GAP` until S5.

After S4, lower the ratchet to 0. In S5, delete them.

## Rails added

- **Lint (`npm run check`)**:
  - `cityChecks`:
    - the strata follow the galleries;
    - the deepest floor is the core;
    - the floor ranges in tokens and data agree;
    - pockets lie beyond the furthest reach (`WING_CAP_*` + `DISTRICT_SLOTS` + 2), or inside a gallery band;
    - frames are sound, and stratum 0 is classic;
    - the hub's stair column fits;
    - `createInitialState().city` equals `createCity()`.
  - X-conversion ratchet: legacy geom imports plus `ROOMS_X`/`SHAFT_GAP` maths outside `geom.ts`/`project.ts`. It fails above the baseline and prints a note below it.
  - Warning on `slotX(0, …)` and similar without `// floor-0: <reason>` on the line. It covers src and tools/sim, and is clean today.
- **`tools/sim/project-test.mjs`**: runs on saves-v6 and saves-v7 under three frame sets: classic, city, and a skewed set (each stratum shifted 37 u more, with odd vestibules and tunnels). It checks:
  - classic matches the legacy `geom` maths exactly;
  - `slotAtX` round-trips and is null in the hub;
  - touching rooms share an edge (except across the spine);
  - no rooms, districts or ruins overlap;
  - halls are aligned;
  - nothing sits in the hub;
  - districts sit past their floor;
  - doorways sit on room edges;
  - `walkBlocked` agrees with `isPassable` (synthetic shut doors are added).
  - A mutation test confirmed it catches a wrong floor in `openings.ts` and in `routes.walkBlocked`.
- **`tools/sim/migrate.ts`** v8 checks:
  - `city` is well-formed;
  - every revealed id is seen;
  - `seen` contains surface, s:0, s:1 and every f:k; `found` is empty;
  - layout and room/ruin positions are byte-identical;
  - migration is idempotent;
  - `found` survives a round trip;
  - `whatsnew:v8` appears exactly once.
- `check:full` now also runs `migrate-test` on saves-v7 and `project-test`.
- `daily-test` now expects `SAVE_VERSION` 8.

## Test results

All gates ran in a clean detached worktree at `bda6fe5`, which includes the orchestrator's `f168b30` (art kit) and `1689225` (render core). Those two commits do not touch `src/core`, `src/systems`, `src/data` or `src/rendering`, so the parity and compare runs made at `bd4fdcf` still hold. The render-core files pass the x ratchet (0 legacy uses) and tsc.

- **`npm run check:full`**: green.
- **Type checks**: `npx tsc --noEmit` and `tsc -p tsconfig.tools.json` are clean.
- **Build**: `npx vite build --outDir <scratchpad>/dist-c0` succeeds (only the usual chunk-size warning).
- **Economy parity**: `tools/sim/run.mjs --mode greedy --hours 6 --seeds 1-3`, HEAD vs e506ae2.
  - Every result leaf is identical (0 differing values; only the wall-clock `runMs` was excluded).
- **Classic look**: `tools/compare/run.mjs` on saves-v6 `e30-seed1` and `c-seed1` at 390x844@2x (17 shots).

  | Pair | Mean diff | Max diff |
  |---|---|---|
  | e506ae2 vs e506ae2 (noise floor) | 2.28 % | 6.58 % |
  | e506ae2 vs C0 | 2.23 % | 6.07 % |

  - The red-on-grey diff images show only animated people and pop-up blobs. No structure, room or shell edge moved.
- **Sample saves (`store/sim/saves-v7`)**: dumped from e506ae2 with `run.mjs --dump-save`, the same recipe as saves-v6:
  - `c` = casual 4 days, seeds 1-3;
  - `e10`/`e30`/`e55` = engaged 10/30/55 days, seed 1.
  - e10 and e30 have real wings (west too), doors and infra.

## What the next agents must know

- **Everyone**:
  - Never compute an x from `SLOT_W` by hand. Call `project.ts` with the floor in scope.
  - For the surface row, use floor -1.
  - For global bounds, use `westmostSlotX`/`eastmostSlotX`/`stripBounds`.
- **`?city` today** moves rooms, bays, doors, walkers, signage, pipes, decals, chunks and ghost onto the city frame.
  - The shell (`world.ts` casing and tunnels, `structure.ts` casing, `gallery.ts` spans, `shaft.ts`, `surface2` portal, `voids.ts` annex `ANNEX_X = -22`) is still the classic tower drawn at classic-frame offsets. Expect gaps in the hub until C1 adds the city shell.
  - The classic-only spots are marked `[world:C0]` or keep literal `0`/`-6` as the classic hub edge.
- **tech-artist**:
  - The city switches in `BunkerRenderer` / `world.ts` / `frontChunks` / `structure` are yours or level-builder C1's.
  - `frontChunks` columns are now slot-based per floor (`cxOfX(f, x)`). Column 0 is the whole hub-plus-vestibules strip, and a 3-floor chunk group takes the x union of its first and last floor.
  - Kept for classic parity: `BunkerRenderer` incidents' floor rect is `slotX(f, -w)` with width `(w + e) * SLOT_W`. It does not include the hub, as before. Fix it in city mode.
- **camera-nav**:
  - `CameraController` was not touched: `coreX`, sectors and `SHAFT_W`.
  - The renderer's `span.l`/`span.r`, `extentL`/`extentWingR`, `worldLeft` and the city map now use the west-most/east-most frame, so camera bounds widen automatically in city mode.
  - `routes.ts`: `LANDING_X`/`LADDER_X` are on the spine and unchanged. Stair columns use `slotX(lo, …)`. `towerColumnX` now walks void slots, with annex = slot -1 at `ANNEX_X`.
  - Hub stairs need to feed `stairColumnX`/`towerColumnX` (spec D10).
- **life-systems**: `walkers.exitFor` uses `slotX(floor, …)`. Person lanes are room-local and unaffected.
- **level-builder C1**:
  - `CITY.hub` tokens are ready for `cityLayout.ts`.
  - Use `hubRect(s)`, `spineRect()`, and `revealedAreaIds` / `state.city` for fog and "new" pins.
  - `whatsnew:v8` is flagged but has no UI consumer yet (UX session / M1).
- **asset-pipeline**: no asset or registry changes in C0.
- **Determinism**: Node and the sim always run classic (`location.search` is empty). Tests switch with `__setProjectionForTests` and must reset to `'classic'` in a `finally`.
- **Others' files**: the orchestrator committed the art kit and render core (`src/world/render/*`, `src/world/tokens{Assets,Render}.ts`, `tools/world/*`) during C0. C0 did not touch them. `.gitignore` now also tracks `store/sim/saves-v7/`.
