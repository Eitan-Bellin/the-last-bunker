# A1 — Code scout: "World redesign: The City Below"

*Read-only scan of `C:\Users\eitan\Desktop\last-bunker-world` (branch `world-redesign`, HEAD e506ae2). No game file changed. 2026-10-15.*
*Paths are relative to the repo root; `file:line` points at the current tree.*

---

## 0. Executive summary (decision-relevant)

1. **The save never stores a world coordinate.** Everything spatial is logical: `(floor, slot)` for rooms/ruins/doors/infra, `layout.ext[floor] = {w, e}` for side wings, `currentFloors`, `layout.surfaceOpen`. Survivors have **no** position at all (only `assignedBuildingId`). A new "city" look can be a *new projection* of the same logical grid without touching the save, as long as the logical grid survives.
2. **Y is already abstracted; X is not.** `src/rendering/geom.ts` owns `floorTop/floorAtY/floorIndexAt/floorFrac` (lint gate `tools/sim/lint.ts:303-318` fails any `/ FLOOR_H` outside geom.ts). Variable floor heights already exist (service galleries). But `slotX(slot)` has **no floor argument** (`geom.ts:131`) and is called 124x in 24 files; `SHAFT_W` 86x in 14 files; `ROOM_H` 277x in 28 files; `floorTop(` 125x in 24 files. Giving each stratum its own horizontal offset/curvature means `slotX(slot) -> slotX(slot, floor)` everywhere: the biggest mechanical refactor.
3. **The single shaft at x=0 is baked into game logic in three places**, not only rendering: `systems/doors.ts:61-80` (`doorsToShaft`, `isSealedOff`, `isShutOff` measure from slot 0 / -1), used by `PopulationSystem.ts:402` (assignment), `InfraSystem.ts:264` (breach speed), `:291` (epidemic weights). Plus `placementRank.ts:29` `liftDistance` (UI chip only). Everything else that assumes one shaft is rendering (routes, walkers, shaft, signage, camera, cityMap, surface entrance).
4. **Adjacency is game logic.** `touching()` (`data/buildingDefs.ts:197`) = same floor + shared edge on the slot line. It drives the compound bonus (+10%/neighbour), SYNERGIES, `place.adjacentTo`, fire spread (`IncidentSystem.ts:203-204`). An organic city that changes adjacency changes economy numbers; keeping "same floor, contiguous slots" keeps them.
5. **Depth rules are by floor index**, not by y: zones (`zones.ts`), district floors (`districts.ts`), galleries (`GALLERY_ABOVE_FLOORS`), `stabilityCut(f)` (wings), fire code floor >= 8, collapse floor >= 5, raids on floor 0. Mapping the 7 strata onto floor-index ranges keeps all of them valid.
6. **City-like building blocks already exist**: 5-band geology (`strata.ts`, by world y), floor identity (`floorIdentity.ts`), service galleries (`gallery.ts`), cluster voids + stair towers (`voids.ts`), front corridor deck (`circulation.ts`), alcove parallax (`roomDepth.ts`), rock parallax (`BunkerRenderer.ts:1256`), chunked lazy structure (`frontChunks.ts`), districts as caverns beyond the east wall, wing digs, walkers with stairs/lift/ladder routes. A redesign can keep the room/people/lighting stack and replace the "casing + shaft + uniform slab" shell.
7. **Saves**: `SAVE_VERSION = 7` (`GameState.ts:596`), one merge-with-defaults migration `migrateState` (`GameState.ts:598`), raw pre-migration copy kept once per old version under `lastbunker_auto_v<N>` (`SaveManager.ts:190,206`). Adding v8 is cheap and well-trodden (section 4).

---

## 1. Engine & render system

### 1.1 Stack
- `pixi.js ^8.22.0` (package.json), Vite 8, TypeScript ~6.0, `idb-keyval`, `lz-string`, `howler`. WebGL only (wave 3 dropped the WebGPU/Canvas renderers: `tools/perf/budget.json` global note). One `Application` owned by `BunkerRenderer` (`BunkerRenderer.ts:72`).
- `app.init` (`BunkerRenderer.ts:459-476`): `antialias:false`, `autoStart:false` (Pixi ticker NOT used), `resolution: targetResolution(startQuality())`, `autoDensity`, `powerPreference` by quality, `gcMaxUnusedTime` 30 s (15 s lite).
- WebGL context loss handled (`watchContext`, `:1130-1146`) -> `ArtLibrary.reset()` + `recoverGraphics()`.

### 1.2 Render loop and picture governor
- `GameEngine.loop` (`core/GameEngine.ts:933-978`) is the only `requestAnimationFrame`. Fixed sim ticks at 10 Hz (`TICK_RATE`, `:50`); then `onRender` only when `timestamp - lastRenderAt >= pictureInterval() - 4` (the governor, doc at `:55-59`).
- Rates come from the quality profile `fps: [touching, watching, idle]` + `motion` in `postfx.ts`: `QUALITY_PROFILE` (desktop high 60/60/30) and `TOUCH_PROFILE` (touch medium 30/20/5, low 24/12/4; motion 60/30). `app.ts:476-493` (`frame`) feeds `engine.frameRates`, `engine.motionFps`, `noteCameraMotion()` while `renderer.cameraMoving`, `engine.fxBusy = renderer.fxActive || popups in view`, then `renderer.render(state, dt, alpha)`, then HUD/UI.
- `BunkerRenderer.render` (`:1293`) = `updateScene` + `draw()` = `app.render()` (`:1309`).
- `updateScene` order (`:1321-1416`): quality -> late art -> trim/sweep art (2 s / 5 s) -> `hashLayout(state)` (`perfFx.ts:34`) -> `updateSpan` -> `rebuildStructure` if floors/gloom/structureSig changed -> camera step -> ghost -> label scale -> `updateView` (VIEW rect + depthCam + rock parallax) -> `frontChunks.update` -> `updateLod` -> `roomViews.render` -> ruins -> `renderUtilities` (signature-gated) -> wing signs -> `renderPeople` -> surface animate (skipped when `VIEW.y0 > 20`) -> shaft/utilities/front/galleries/infra/decals animate -> atmosphere -> `roomViews.cull()` -> per-room animate -> incidents/disasters -> bursts/floaters/grade/bubbles -> dust -> `postfx.update`.

### 1.3 World container / layer tree (z-order, back to front)
`app.stage` -> `worldContainer` (filters = `[grade]`, then the PostFX composite). Children (`BunkerRenderer.ts:484-492`, plus inserts):

| # | Layer | Content / owner | Notes |
|---|---|---|---|
| 1 | `surfaceHolder` | sky panorama + surface (`world.ts buildSurface` or `surface2.ts`) | hidden below ground |
| 2-6 | `projectSites.layer/smokeLayer/glowLayer/crew/signLayer` | project lots east of the bunker | |
| 7 | `undergroundHolder` | `buildUnderground` (`world.ts:162`): `rockLayers` (strata; child 0, parallaxed), casing (`structure.ts buildCasing`), district tunnels, plaques | rebuilt on `structureSig` |
| 7b | `surface2.soil` | inserted after underground (`surface2.ts:375`) | |
| 8 | `bayHolder` | `buildBays(grid)` empty slots | |
| 9 | `slotLayer` | placement pad | |
| 10 | `highlightLayer` | placement highlight | |
| 11 | `roomLayer` | one root per room (`RoomViews`), `sortableChildren`; each root has a `people` child | culled |
| 12 | `shaftHolder` | `buildShaft2` (`shaft.ts`) / flat `buildShaft` (`world.ts:433`) | |
| 12b | `surface2.front` | inserted after shaft (`surface2.ts:376`) | portal over shaft top |
| 13 | `utilitiesHolder` | groups `front`, `galleries`, `signage`, `decals`, `atmosphere`, `infra`, `pipes` | rebuilt on `LAYOUT.util` |
| 14 | `walkers.layer` | people in transit | |
| 15 | `dust.container` | motes | |
| 16 | `digHolder` | next-floor dig sign | |
| 17 | `wingSigns.container` | wing dig signs | |
| 18 | `districtSignHolder` | district tunnel sign | |
| 19 | `fxLayer` | bursts, Zzz, drop ring (z 9000), carried person (z 9999) | |
| 20 | `incidents.fx`, `disasterFx.fx` | crisis FX | |
| 20b | `cityMap.container` | inserted below `labelLayer` at far zoom (`:1440`) | |
| 21 | `labelLayer` | room tags, bubbles | |
| 22 | `incidents.badges` | | |
| 23 | `ghost.layer` | placement ghost | |

Each layer is its own **render group** (`setupRenderGroups`, `:527-540`); one ~13 k-object group used to rebuild every picture (55% of render time).

### 1.4 Post-FX chain (`rendering/postfx.ts`)
One composite filter on `worldContainer`: quarter-res bloom extract (soft knee, Karis average) + Kawase passes (`passes`: high 4 (touch 3), medium 2, low 0) -> era grade matrix -> filmic shoulder + split tone -> underground night grade (`structure.ts:79 nightLight`) -> per-era vignette -> film grain (high) -> brightness gamma lift (`LIFT`, `ERA_LIFT`). `PerformanceMonitor` steps quality down automatically; touch capped at medium. There is no per-light pass: lighting = baked tints + additive glow sprites + lamp-pool tint on people.

### 1.5 Culling, LOD, quality
- **VIEW rect** (`perfFx.VIEW`, set in `updateView` `:1234`): world camera rect + 80 margin, shared by all effects.
- **Rooms**: `RoomViews.cull()` (`RoomViews.ts:609`); culled rooms neither animate nor update their people (`BunkerRenderer.ts:978`); paintings unused 20 s are released (`sweepArt`, `:1164`).
- **Structure**: `frontChunks.ts` 4-slot x 3-floor chunks built lazily near the camera (max 3 per picture), parked after 8 s (`frontChunks.ts:40-44`). Strata bands switch off off-screen via `onRender`.
- **Surface** hidden when `VIEW.y0 > 20` (`:1353`).
- **LOD** (`updateLod`, `:1428`): far < `FAR_ZOOM` 0.42 (x1.07 hysteresis) -> city map; once it covers (alpha > 0.985) bays/utilities hide. close > 1.2 (1.1 back) -> name tags.
- **Quality**: `GFX` table per level (`gfxFeatures.ts:59-64`) + `?gx=` overrides (`wings, galleries, strata, walkers, surfaceRow, floorId, openings, bulkheads, branches, airy`); low steps animation every other frame (`lowSkip` `:1369`), no decals/dust, fewer particles. Lite mode (crash guard) forces low.
- **Perf gate**: `tools/perf/run.mjs --check` vs `tools/perf/budget.json` (draw calls 420-730, renderables 3.8-7.1 k, GPU textures <= 290 MB, all at 24 floors / 60 people; `f24w-*` wide scenarios `pending`). Plan targets: 120-150 draw calls.

---

## 2. How the bunker is represented

### 2.1 Data model (logic side)
- `BuildingInstance.position: { x, y, floor }` (`GameState.ts:30-34, 89-103`). `x` = **slot index** (east of shaft >= 0, west wing < 0), `y` always 0 (unused), `floor` = level index (0 = B1, -1 = surface row).
- Width `roomSlots(type)` (`buildingDefs.ts:187`): `def.slots` (1-5) else 2/3 from `size`; halls 3; districts `DISTRICT_SLOTS = 4`.
- Height `roomFloors(type)` = 2 for halls (`atrium`, `reactorHall`), else 1 (`buildingDefs.ts:133`). A hall at f spans f and f+1; may not straddle a gallery (`zones.ts:217 crossesGallery`).
- `currentFloors` (new game 3, `MAX_FLOORS = 24` `zones.ts:160`, Act `floorCap` 5/8/11/14/17/20/24 in `data/acts.ts:56-135`).
- `LayoutState` (`GameState.ts:417-427`, save v7): `v:1`, `ext: Record<floorStr,{w,e}>` (missing = `{w:0, e:12}`), `doors: Record<'floor:boundary', 'open'|'closed'|'sealed'>`, `infra: {id, kind, floor, x, floors?, level?}[]`, `surfaceOpen`.
- `floorExtent(state, f)` (`GameState.ts:440`): floor -1 = fixed surface row `{w:11, e:-3}` (slots -11..-4), never saved.
- Ruins `{floor, x, w, kind, restoresTo, ...}` (`GameState.ts:390-408`); start layout `data/ruins.ts:48`.
- Districts = `BuildingInstance` of kind `cave|lake|metro|geothermal|oldVault` at `position.x = floorExtent(f).e` (`BuildingSystem.ts:226`), one per floor, floors fixed in `data/districts.ts:34-82` (cave idx1, lake 2, metro 3, oldVault 5, geothermal 6). East wing growth shifts the district x by `WING_STEP` (`BuildingSystem.ts:466-469`).
- Digs: `longGame.dig` / `dig2` `{floor, paid, progress, total, crew, kind?: 'floor'|'wing', side?}` (`state/longGame.ts:31-41`); crew = `assignedBuildingId 'p_dig' | 'p_dig2'` (`DigSystem.ts:13-15`).
- Wings (`data/wings.ts`): `WING_STEP = 2`; caps per Act east `[12,14,16,18,20,20,22]`, west `[0,2,4,6,8,10,10]`; `stabilityCut(f) = 2*max(0, floor((f-8)/4))`.
- Placement truth table `BuildingSystem.placeBlock` (`BuildingSystem.ts:171-207`): surface rules, floor range, copies, gallery straddle, zone (`allowedFloors`), `-ext.w <= x && x+w <= ext.e` on every spanned floor, ruins, overlap, infra column, `adjacentTo`.

### 2.2 Geometry (render side, `rendering/geom.ts`; `layout.ts` re-exports it)
| Constant | Value | Meaning |
|---|---|---|
| `SLOT_W` | 46 | world units per slot |
| `ROOM_H` | 100 | room height |
| `SLAB` | 44 with `airy` (16 classic) | corridor deck 30 + beam 7 + soffit 7 |
| `FLOOR_H` | 144 (airy) | floor pitch |
| `SHAFT_W` / `SHAFT_GAP` | 58 / 6 | shaft occupies x 0..58 |
| `ROOMS_X` | 64 | left edge of slot 0 |
| `BASE_EAST` | 12 | default slots east -> `BUILDING_W = 616` |
| `TOPSOIL` | 70 | y of floor 0 ceiling (ground y = 0, up negative) |
| `GALLERY_H` / every / max | 34 / 4 / 5 | service band after floors 3,7,11,15,19 |
| `SURFACE_TOP` | -100 | floor -1 row |
| `DISTRICT_GAP` | 18 | tunnel between floor end and cavern |
| `CORR_DECK/BEAM/RAIL/LANE` | 30/7/14/13 | front corridor (airy2) |
| `FLIGHT_RUN/RISE`, `TOWER_AMP` | 38/36, 19 | stair-tower flights |
| `DEPTH_X/TOP/BOTTOM` | 12/9/16 | alcove inset |

Functions: `floorTop(f) = 70 + 144f + 34*galleriesBefore(f)` (`:65`); `floorAtY / floorIndexAt / floorFrac / floorAfterTravel` (`:95-128`); `slotX(s) = s>=0 ? 64+46s : -6+46s` (`:131`); `slotAtX` (null over the shaft, `:136`); `districtXAt(slot) = slotX(slot)+18` (`:175`); `buildingX(b)`, `buildingH(type)` (`:180-188`); `WALK_Y = 93`.
Depths (airy + galleries): floor 0 y=70, 4 -> 680, 8 -> 1290, 12 -> 1900, 16 -> 2510, 20 -> 3120, 23 -> 3552.

### 2.3 Shaft / elevator
- Logic: `elevator` is a BuildingType (`GameState.ts:52`, buildings.json:487); its completion bumps `currentFloors` (`BuildingSystem.ts:76-77`, legacy path); excluded from moves/incidents. Modern floor digs: `DigSystem` + `BuildingSystem.dig/finishDig` (`:417, :455`).
- Render: `shaft.ts buildShaft2(floors, era, onArrive, westFloors, zoneColors)` (`:124`): x 0..58 from `TOP=-46` to the bottom floor, landing gates per floor, a second landing door where the floor has a west wing, lit spine (airy:B3). Returns `ShaftAnimated = Animated & { lift: LiftApi }` (`:62`): a ticket queue for up to 4 riders, consumed by walkers (`walkers.setLift`, `BunkerRenderer.ts:643`). Flat fallback `world.ts:433`.

### 2.4 Two-floor halls, districts, "airy"
- Halls: one room view, height `2*100 + 44`; utilities skip the ceiling under a hall (`world.ts:512`); frontChunks `hallSpans`; painted at 560x876.
- Districts: 4-slot, 1-floor cavern east of the casing, drawn tunnel + rock hollow (`world.ts:237-256`); paintings 960x484 (`registry.ts:512`); geothermal/oldVault composed in code.
- `GFX.airy` (default on): 44 slab with a front corridor deck people walk on (`circulation.ts`, `routes.ts:73 laneY`); piers by tier (`airyArt.ts:30 piersOfFloor`); cluster voids every 3-5 slots with a stair tower (`voids.ts`), stair annex west of the shaft (`ANNEX_X = -22`); rooms as deep alcoves with a parallax back-wall mesh (`roomDepth.ts`, `depthCam`); rock parallax +-14 u (`BunkerRenderer.ts:1256-1266`).

### 2.5 Assumptions a non-grid city would break
**Game logic (needs orchestrator approval to change):**
1. `systems/doors.ts:61-80` shaft at boundary 0; sealed/shut-off measured toward it -> `PopulationSystem.ts:402`, `InfraSystem.ts:264` (breach), `:291` (epidemic).
2. `buildingDefs.ts:197-200` `touching` = same floor, contiguous slots -> compound (`:203`), synergy (`:249-292`), `placeBlock` adjacency (`BuildingSystem.ts:205`), fire spread (`IncidentSystem.ts:203`), `placementRank.placeEffects`.
3. Floor-index rules: `zones.ts:133-223` (zone floors 0/1/2, deep >= 3), `GALLERY_ABOVE_FLOORS` (`zones.ts:214`, lint-checked against geom), district floors, `wings.ts:38` stabilityCut, `InfraSystem.ts:31` FIRE_CODE_FLOOR = 8, `:34` STAIRWELL_RANGE (floors), `IncidentSystem.ts:98,147` floor 0 (top-floor breach), `:312` collapse floor >= 5.
4. Extent `{w, e}` per floor = one contiguous strip through the shaft (`GameState.ts:440`, `placeBlock` bounds). Two separate halls on one floor, or rooms off the strip, cannot be expressed.
5. District = "east end of the floor" (`BuildingSystem.ts:226`, `wings.ts:139` 'district' block, `finishWing` shift).
6. Surface row slots -11..-4 fixed (`GameState.ts:436-437`).
7. `placementRank.ts:29 liftDistance` (only a UI chip, `ui/controllers/world.ts:180`).

**Rendering (free to change):**
8. `geom.slotX` has no floor parameter (`geom.ts:131`); shaft gap hard-wired; `slotAtX` null over the shaft.
9. `world.ts`: entrance block above the shaft (`:119-141`), casing/slabs as per-floor rectangles (`:259-307`), district tunnels from the east wall (`:237-256`), mains start at the shaft (`:527-541`), dig sign spans `ROOMS_X..ROOMS_X+ROOMS_W` (`:581-639`), world edges `WORLD_LEFT=-260`, `SURFACE_EAST=1500` (`:13-28`).
10. `shaft.ts` one shaft through all floors; `walkers.setLift` takes a single `LiftApi`.
11. `routes.ts`: `LANDING_X = SHAFT_W/2`, `LADDER_X = 14` (`:65-66`); `walkBlocked` splits at the shaft (`:107-118`); `hop` knows only lift / stairwell / tower / ladder (`:203-257`); surface row reached by ladder via floor 0.
12. `structure.ts:82-86` casing walls `WALL_W_OUT=-30`, `WALL_E_OUT=BUILDING_W+14`; `occupancy.ts` Grid rows per floor indexed `slot+w` (shaft not a cell); `frontChunks.ts:224-225` special chunk at cx=0; `voids.ts` annex beside the shaft; `gallery.ts` bands span the widest floor, shaft passes through.
13. `signage.ts` zone plates on the shaft landing; `cityMap.ts:26,40-82` (shaft line, per-floor bands, rooms via buildingX/floorTop).
14. `CameraController`: `coreX()` (phone default centred on shaft), `panToSector('west'|'core'|'east')` (`:562`), bounds from `floorSpan/extentL/R` (`:700-708`), `SECTOR_SLOTS`.
15. `RoomViews.ts:316` `root.position.set(buildingX(b), floorTop(floor))`; label at `floorTop - SLAB/2` (`:358`); people lane `DEPTH_X+10 .. width-DEPTH_X-10` (`:362`).
16. `PlacementController.ts:56-90` pad per floor/slot via `slotAtX/floorAtY`; `PlacementGhost`; `ui/controllers/world.ts:223-224` snaps the ghost with `slotX/floorTop`.
17. `perfFx.hashLayout` key `(floor+8)*128+(x+32)` (`perfFx.ts:38`).

---

## 3. How survivors move

- **State**: survivors have no stored position. Room = `assignedBuildingId` (room id, ruin id, `p_<project>` lot, `p_dig`/`p_dig2`), plus `isOnMission`, `child`. Idle people are spread round-robin over quarters (`BunkerRenderer.ts:939`).
- **View-side behaviour** lives in `Person` (`people.ts:200`, 1381 lines): in-room wander on a room-local `Lane {x0,x1}`, work spots (`workSpots.ts`, per painting `[x, face, activity, depth]`), crowds (`crowdFor`, `settleCrowds`), rest/sleep/eat/sit on the painted set (`roomSet.ts`), depth on the floor face, tags, mood, ambient tint from room lamps (`BunkerRenderer.ts:962-971`). `renderPeople` (`:890-991`) picks each person's room every frame (job, meals at 7/12/19, night bed). This is the coupling the tech-direction audit flagged (`store/gfx-audit/tech-direction.md` section 2: extract a `PersonSim`).
- **Walkers** (`walkers.ts`, cosmetic by decision D4): when a person's room changes, `intercept` (`walkers.ts:138`) plans a `Route` (`routes.ts:280 route()`) and moves the figure on `walkers.layer`. Legs `LEG_WALK / LEG_LIFT / LEG_STAIRS / LEG_LADDER`; front corridor lane under airy; lift via the shaft ticket queue; stairs via built `stairwell` infra, evacuation rooms, or airy stair towers (`routes.ts:121-176`); doors via `isPassable` (`BunkerRenderer.ts:888-891`). Budget `MAX_WALKERS = 12`, no walks below zoom 0.7 or off screen (`walkers.ts:17-19`), `MAX_TRIP_S = 60`, speeds walk 30 / stairs 22 / ladder 15 u/s. Evacuation from burning or collapsing rooms (`walkers.evacuate`, `BunkerRenderer.ts:957`). Preallocated, zero allocation per frame.
- **Elevator use**: walkers only (cosmetic). With `GFX.walkers` the lift serves tickets instead of random trips (`shaft.ts:688`). `onElevator` callback plays a sound (`app.ts:1023`).
- **Animation** (`people3d.ts`): pre-rendered 3D bodies (SDF raymarch in `tools/people3d.ts` + `people3d-rig.ts`), orthographic camera turned ~18 deg toward the viewer (side view only, facing by mirroring). Atlases `public/art/people/{man,woman,child,elder}.webp` (1536 x 1036..1960, 330-470 KB), set poses `*-set.webp` (65-90 KB), `attach.webp`; `people.json` (123 KB): 20 anims (idle, look, sad, hunch, walk, limp, walkCarry, carry, water, hammer, wrench, stir, type, inspect, lift, tend, dig, punch, run, dangle), 8-16 frames at 4-12 fps. Each frame = 4 greyscale layers tinted per outfit + hair/hat/glasses sprites at a head anchor. Flag `?people3d` / `?people2d` (localStorage `lastbunker_people3d`); vector limb rig fallback in `people.ts`.
- **Counts / cost**: population cap up to 190 by Act VI-VII (`acts.ts popCap`); perf budgets measured at 60 people. Each visible person = several sprites (+ wall shadow, fade copies on high). People in culled rooms do not update.

---

## 4. How the structure is saved

- **Format**: `JSON.stringify(GameState)` -> LZ `compressToUTF16` (in `core/saveWorker.ts`) -> IndexedDB via `idb-keyval` default store. Export/import = `compressToBase64`. Autosave every 30 s (`GameEngine.ts:53`).
- **Version**: `SAVE_VERSION = 7` (`GameState.ts:596`). v7 added `layout`; v6 chronicle + standing orders; v5 longGame; v4 ruins; < 3 triggers `repackAll` (`GameEngine.ts:470`).
- **Layout fields**: `currentFloors`; `buildings[].position {floor, x, y=0}` + `type` (size from defs); `layout.ext[floor] = {w,e}`; `layout.doors['floor:boundary']`; `layout.infra[] {kind 'bulkhead'|'stairwell'|'ventStack', floor, x, floors?, level?}`; `layout.surfaceOpen`; `ruins[] {floor, x, w}`; `longGame.dig/dig2 {floor, kind, side}`; districts as buildings; `lateGame.projects` (surface lots; positions derived in `projectSites.ts`); `incidents[].buildingId`, `danger.disabled` by room id; `longGame.foreman.sealed` = door keys `floor:x`. No pixel coordinates anywhere.
- **Migration chain**: one function `migrateState(saved)` (`GameState.ts:598-647`) = shallow merge over `createInitialState()` + per-slice defaults; `migrateLongGame` (`state/longGame.ts:164`) for the long-game slice. Called only from `GameEngine.adoptState` (`GameEngine.ts:463-470`). Note `merged.layout = {...createLayout(), ...saved.layout, v: 1}` (`:608`) **forces `v:1`**: a layout v2 must change that line.
- **Adding v8**: bump `SAVE_VERSION`; add an `if ((saved.version ?? 1) < 8)` block in `migrateState` (additive fields only, e.g. a new `layout.city` slice or `layout.v = 2`); keep `layout.ext` and room positions as they are so the data stays valid; extend `tools/sim/migrate.ts` / `migrate-test.mjs` (samples `store/sim/saves-v6/*.json`: c-seed1..3, e10/e30/e55-seed1) and the layout checks in `tools/sim/lint.ts:127-138`. `SaveManager.loadSafe` automatically keeps the raw v7 save once as `lastbunker_auto_v7` (`SaveManager.ts:190, 206-213`).
- **IndexedDB keys** (`SaveManager.ts:16-27`): `lastbunker_auto` (main; DEV `?slot=x` -> `lastbunker_auto_x`), `<auto>_bak` (session start), `<auto>_roll` (every 30 min), `<auto>_prev` (before new game/import/Genesis/restore), `<auto>_corrupt`, `<auto>_corrupt_<kind>`, `<auto>_v<N>` (pre-migration originals), `lastbunker_slot<suffix>_<n>` (manual slots). `?slot=` only in DEV builds (`slotSuffix`, `:9-13`).
- **localStorage** (not the save): `lastbunker_gfx`, `_bright`, `_gfx2`, `_people3d`, `_a11y`, `_textsize`, `_lang`, `_sound`, `_vol`, `_crashlog`, `_hb`, `_deaths`, `_lite`; session `lastbunker_reloads`.

---

## 5. How assets load

- **ArtLibrary** (`src/art/ArtLibrary.ts`, 322 lines): `Assets.load` per key from `public/art/<key>.webp` (`:110-113`); `meta.json` (lamp spots + fx spots per painting) and `balance.json` (exposure/white balance, from `tools/lum.ts`); `onLoaded` arrivals batched by the renderer (`applyLoadedArt`, `BunkerRenderer.ts:1201`); `trimBitmaps` drops decoded copies after GPU upload; `release` unloads room/hall/district/ruin art unused 20 s; `lightsFor(entry)` feeds world lamps. Procedural textures (`coneTexture`, `glowTexture`, `moteTexture`) also live here.
- **Registry** (`src/art/registry.ts`, 614 lines): `PAINTED_TYPES` = 15 room types x 3 tiers (`:474`); all other rooms composed in code (`roomComposer.ts` + `roomSpecs*.ts`, baked to canvas textures under the same `rooms/<type>-<tier>` keys); districts (3 painted, 2 composed + `DISTRICT_ART_ALIAS`); halls (2); ruins (12); portraits (14); biomes (6); `KIT` (`:534-554`: wall/slab/column/pipes x F/R/L wear states, bays, lift car, 9 wall props, 3 portals, wheel, topsoil L/R, 9 surface props, 14 project buildings, ~25 decals). Out sizes: rooms 720x522 / 480x522, halls 560x876, districts 960x484.
- **public/art (du)**: 8.6 MB total — rooms 2.4 M (45 files), people 2.2 M (11), kit 1.9 M (80), ruins 544 K (12), backdrops 468 K (`rock`, `surface-0..3`), biomes 280 K, districts 264 K, halls 212 K, story 204 K, portraits 176 K, ui 64 K, meta.json 16 K, balance.json 4 K. Plus `public/splash` 864 K.
- **Pipelines** (`tools/*.html` + `.ts`, run on the dev server): `art.html` (Canva exports -> crop, exposure balance, WebP, lamp detection -> meta.json), `kit.html` (seamless tiles/strips from `art-src/kit/`), `people3d.html` (SDF raymarch to layered atlases), `decals.html` (procedural decals to webp), `roomfx.html`, `roomset.html`, `lum.html`, `sheets.ts` (3x3 Canva sheet slicing), `icons.html`, `bake-kit-soft.py`, `bake-tier2.py`. `art-src/` is not in this checkout.
- **Procedural vs painted**: painted = 15 room types, 2 halls, 3 districts, ruins, backdrops, kit textures, portraits, surface props, project buildings. Procedural = strata bands + feature atlas, composed rooms/districts, corridor deck/rail/beam (`circulation.ts`), piers/ledge (`airyArt.ts`), alcove faces (`roomDepth.ts`), floor identity overlays, gallery grates, infra (doors, stairs, vents), signage, atmosphere particles, city map, flat fallbacks in `world.ts`.

---

## 6. Keep / adapt / replace for an underground-city look

| Module / asset | Rating | Why |
|---|---|---|
| `paintedRoom.ts`, `roomComposer.ts`, `roomSpecs*.ts`, `roomParts.ts`, `roomSet.ts`, `workSpots.ts`, `lightStrip.ts`, `roomClarity.ts` | **keep** | a room is a self-contained rect with lamps/fx; position-agnostic |
| room/hall/district/ruin paintings, portraits, decals, wall props | **keep** | |
| `people.ts` / `people3d.ts` + atlases | **keep** (later extract PersonSim) | side view only; right for a cross-section city |
| `roomDepth.ts` (alcove + parallax) | **keep** | already a per-room depth layer |
| `postfx.ts`, `gfxFeatures.ts`, quality ladder, governor | **keep** (adapt night grade for light pools) | |
| `incidentFx.ts`, `atmosphere.ts`, `decals.ts`, `infra.ts` | **adapt** | consume room rects / lamps; reposition only |
| `strata.ts` (5 bands by world y, procedural, culled) | **adapt** | extend 5 bands -> 7 strata; already keyed by depth, not floor |
| `floorIdentity.ts`, `signage.ts` zones | **adapt** | becomes district identity per stratum |
| `gallery.ts` (service bands) | **adapt** | natural "service network" layer |
| `voids.ts` + stair towers, `circulation.ts`, `airyArt.ts` piers | **adapt** | seed of organic verticality (towers, catwalks, voids) |
| `frontChunks.ts` (chunk manager + signatures) | **adapt** | chunk keys (slot/4, floor/3) fine; contents assume slab strips |
| `routes.ts`, `walkers.ts` | **adapt** | planner = lift/stairs/ladder over one shaft; needs a nav graph for ramps/bridges/atriums |
| `CameraController.ts` | **adapt** | inertia/springs/tours reusable; bounds, sectors, coreX are tower-specific |
| `cityMap.ts` | **adapt / replace** | tower schematic; candidate for a fog-of-war district map |
| `occupancy.ts`, `openings.ts`, `PlacementController.ts`, `PlacementGhost.ts`, `wingSigns.ts` | **adapt** | grid-per-floor; fine while the logical grid stays |
| `geom.ts` | **adapt (central)** | the place to introduce the city projection |
| `world.ts` buildUnderground/casing/slabs/dig sign/utilities, `structure.ts` casing + bays, `shaft.ts`, `surface2.ts` portal mounting | **replace / heavily adapt** | they *are* the tower shell |

Tied to the tower layout: `world.ts`, `shaft.ts`, `structure.ts` (casing, `WALL_*`), `gallery.ts`, `voids.ts` annex, `signage.ts` landing plates, `routes.ts` (LANDING_X/LADDER_X), `cityMap.ts`, `CameraController` sectors, `surface2.ts` portal over the shaft, `projectSites.ts` (east surface lots), `ui/share.ts`, `ui/tour.ts`, `ui/ceremony.ts`, `ui/components/DepthRuler.ts`.

---

## 7. Camera (`rendering/CameraController.ts`, 987 lines)

- Zoom: `MIN_ZOOM 0.35`, `MAX_ZOOM 3` (soft rubber band past both, `softZoom` `:713`), `FAR_ZOOM 0.42`, `VIEW_TOP -140`.
- Default zoom: phone (< 700 px) `sectorZoom` = 6 slots across under airy, clamped 0.9..1.8, centred on the shaft (`coreX`); desktop `fitZoom` = building width (cap 1.6). `overviewZoom` fits the widest floor (`floorSpan`). Double tap toggles x1.8 / base; `toggleOverview`.
- Feel: glide friction 4.2/s, edge spring 13, focus spring 7.5 (critically damped), zoom spring 14 (`:40-45`), release velocity from 8 pointer samples, shake (trauma^2 x noise), punch (+3% zoom kick), reduced motion respected.
- Follow / focus: `focusTo(x,y,z)`, `focusOn`, `focusFloor`, `keepInSight(id)` (above sheets), `keepRectInSight`, `panToSector('west'|'core'|'east')`, `scrubY` (depth ruler), `tourPath(points)` (story tours), `setView/getView`. No continuous follow of a moving person.
- Bounds (`camBounds`, `:700-708`): x from `min(0, span.l, extentL) - 46` to `extentR + 46`; y from `min(VIEW_TOP, projectTop) - 60` to `contentBottom = floorTop(floors+1) + 20` (+ sheet inset).
- Carry support: dragging a person/ghost near an edge scrolls the world (`carryBottomExtra`).
- LOD thresholds live in the renderer: far < 0.42, close > 1.2; walkers off below 0.7; alcove parallax only at zoom >= 0.45 and not on low (`BunkerRenderer.ts:1247`).
- `cityMap.ts` (127 lines): one schematic (dark panel, per-floor bands, gallery lines, shaft line, rooms coloured by `CATEGORY`, lit windows animated at 12 fps); fades in below 0.42, then bays/utilities hide.

---

## 8. Already city-like pieces to build on

- **Strata** (`strata.ts:31 BAND_TOP = [0, 290, 1030, 1850, 2600]`): soil/clay, gravel + water table, granite (old foundations, rail section), basalt + ore + crystals, bedrock with geothermal glow; procedural 512 tiles + feature atlas, 60 px transitions, per-band culling, ~5-7 MB textures. By today's geometry: floors 0-1 soil, 2-6 gravel, 7-11 granite, 12-16 basalt, 17-23 bedrock. The 7 redesign strata map onto floor ranges, e.g. 0 surface = floor -1; 1 upper shelter = 0-4 (Act I cap 5); 2 service network = 5-7 + galleries; 3 old metro = 8-11 (metro district today is floor index 3, would move or be re-themed); 4 mines = 12-16; 5 deep caves = 17-20; 6 core = 21-23.
- **Districts** (`data/districts.ts`): data-driven caverns with gates (flag / Act / research), the natural "named places".
- **Wings** (`data/wings.ts`): sideways growth with Act caps and depth narrowing; already a stepped silhouette, wide in the middle.
- **Galleries** (`gallery.ts`): non-room bands between floors with catwalks and lamps.
- **Voids + stair towers + annex** (`voids.ts`, `routes.ts:156 towerColumnX`): vertical breaks, walkable towers.
- **Front corridor** (`circulation.ts`, `routes.ts:73 laneY`): people walk on a deck between rooms.
- **Floor identity** (`floorIdentity.ts`): per-floor kind / tint / lamp colour / number tag.
- **Infra in the save** (`layout.infra`, `infra.ts`, `InfraSystem.ts`): bulkheads, stairwells, vent stacks; precedent for saving city connectors (ramps, bridges) the same way.
- **Perf scaffolding**: chunk manager with signatures, render group per layer, VIEW culling, lazy art.
- **Lighting data**: world lamps from painted light spots (`worldLamps`, `BunkerRenderer.ts:1102`), `roomFlicker`, `crisisLight`, `nightLight`, `depthGains`; enough to drive "light pools in darkness" with an additive/multiply light layer.
- **Surface row** (floor -1) and project lots: precedent for a non-shaft row with its own extent.
- **No fog-of-war** in the bunker today (only `explorationMap` hexes for surface expeditions, `ExplorationHex.revealed`). Unbuilt space is drawn as excavated bays or dig signs.

---

## 9. Risks & coupling

### 9.1 UI reading renderer geometry directly
- `ui/ceremony.ts:5,266,352-393`: `buildingX/floorTop/slotX/SLOT_W`; gate at `slotX(0)+SLOT_W, floorTop(0)+30`; wing ends.
- `ui/components/DepthRuler.ts:4,96,159,188,200-208`: `floorAtY`, `floorTop`, `ROOM_H`, gallery detection; assumes a vertical stack.
- `ui/controllers/world.ts:19,223-224`: ghost snapping centres via `slotX/floorTop/buildingH`.
- `ui/share.ts:5,78-84`: screenshot bounds via `SHAFT_W/buildingX/floorTop`.
- `ui/tour.ts:4,139,178-193`: tour points from `floorTop/slotX/BASE_EAST`, `ROW_X0/X1`.
- `ui/components/NumberPopup.ts` draws into `renderer.worldContainer`.
- Facade members used by app/UI (count of call sites): `postfx` 12, `focusOn` 7, `shake` 6, `roomRect` 6, `roomCenter` 6, `setSelected` 5, `camera` 5, `worldContainer` 4, `focusFloor` 4, `floatIcons` 4, then ~50 more used once or twice (`on*` callbacks, ghost API, bubbles, `personPos`, `slotCenter`, `ruinCenter`, `setDigSign`, `setDistrictSign`, `onElevator`, `onWingDig`, `floorSpan`, `zoomLevel`). `roomCenter` (`:606`) and `slotCenter` (`:610`) compute from geom, not from the views.

### 9.2 Logic importing rendering
- `systems/*`, `data/*`, `core/*` import no Pixi. `data/buildingDefs.ts` / `zones.ts` mirror geom constants (`GALLERY_ABOVE_FLOORS`, lint-checked).
- Node tests import `rendering/geom`, `routes`, `occupancy`, `openings`, `gfxFeatures` (Node-safe by design).

### 9.3 Tests that pin layout behaviour
- `npm run check` = `tsc --noEmit` + `tools/sim/smoke.mjs` (one simulated day) + `lint.mjs` (building schema; wings rules `lint.ts:145-215`; placement equivalence of `findFreeSpot` (`:295`); layout defaults `:127-138`; district lists agree; **legacy-geometry gate** `:303-318`: no `/ FLOOR_H`, `(y - TOPSOIL)/`, `/(ROOM_H+SLAB)` outside geom.ts, `SLOTS_PER_FLOOR` warning) + `glossary-lint.mjs`.
- `npm run check:full` adds: `migrate-test.mjs store/sim/saves-v6` (nothing lost, v7 defaults), `placement-test` (bestSpot / relocate), `infra-test` (doors contract; shut doors vs fire, epidemic, raid, assignment, power; fire code; vents; layout round trip; SYNERGIES), `routes-test` (same floor, lift, stairs, ladder, doors, wings both sides of the shaft, surface row, trip cap, airy lane), `rooms-test`, `openings-test` (doors exactly where two different rooms meet, corridor stubs at wing ends), `daily-test`, `foreman-test` (sealOnAlarm uses door keys `floor:x`).
- Outside npm scripts: perf gate `tools/perf/run.mjs --check`, visual compare `tools/compare/run.mjs`, `src/dev/camShots.ts`, `storeShots.ts`, a11y tools.

### 9.4 Other risks
- `GFX.airy` / `GFX.galleries` change geometry at module load (`SLAB`, `galleriesBefore`); consumers must read geom, never cache numbers.
- `layout.v` forced to 1 in migration (`GameState.ts:608`).
- District `position.x` mutates when the east wing grows (`BuildingSystem.ts:466-469`); a new district placement model must migrate it.
- Person behaviour inside the view (`people.ts`, `renderPeople`): new room shapes or lanes touch work spots and crowds.
- Population up to 190 vs perf budgets measured at 60.
- `routes.ts` / walkers are cosmetic by design (D4): keep it that way, or pathing becomes save-relevant.

---

## 10. How hard is it to break "one shaft + stacked floors"?

- **Cheap (rendering-only, save untouched)**: re-skin the shell (rock caverns instead of casing, light pools, strata 5 -> 7, district identity, fog over undug space), extra vertical connectors drawn on existing boundaries (towers, ramps as walker legs), non-uniform floor heights (via `floorTop`, already supported), parallax layers behind/in front. Most of this is in `world.ts`, `structure.ts`, `frontChunks.ts`, `shaft.ts`, `strata.ts`, `gallery.ts`, `voids.ts`, `routes.ts`.
- **Medium (projection change)**: per-floor horizontal offset or per-stratum x mapping -> `slotX(slot, floor)` across ~24 files (124 calls), `slotAtX(x, floor)`, `buildingX`, plus UI files in 9.1 and tests; logical save unchanged.
- **Expensive (logic + save v8)**: several separate settlements per floor, more than one lift, rooms off the per-floor strip, non-slot adjacency. Touches `doors.ts` shaft distance, `touching`/synergy/compound/fire, `placeBlock`, `floorExtent`, wings, districts, `migrateState`, and every test in 9.3. Requires orchestrator approval (economy and save format).

---

## 11. Key files (absolute paths)

- `C:\Users\eitan\Desktop\last-bunker-world\src\rendering\geom.ts` — all floor/slot geometry
- `C:\Users\eitan\Desktop\last-bunker-world\src\rendering\BunkerRenderer.ts` — facade, layer tree, update loop
- `C:\Users\eitan\Desktop\last-bunker-world\src\rendering\world.ts` — surface, underground, flat shaft, utilities, dig sign
- `C:\Users\eitan\Desktop\last-bunker-world\src\rendering\shaft.ts`, `structure.ts`, `frontChunks.ts`, `gallery.ts`, `voids.ts`, `circulation.ts`, `strata.ts`, `floorIdentity.ts`, `roomDepth.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\src\rendering\routes.ts`, `walkers.ts`, `people.ts`, `people3d.ts`, `workSpots.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\src\rendering\CameraController.ts`, `cityMap.ts`, `postfx.ts`, `gfxFeatures.ts`, `perfFx.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\src\core\GameState.ts`, `SaveManager.ts`, `GameEngine.ts`, `state\longGame.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\src\systems\BuildingSystem.ts`, `doors.ts`, `InfraSystem.ts`, `IncidentSystem.ts`, `placementRank.ts`, `DigSystem.ts`, `PopulationSystem.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\src\data\buildingDefs.ts`, `zones.ts`, `districts.ts`, `wings.ts`, `acts.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\src\art\registry.ts`, `ArtLibrary.ts`
- `C:\Users\eitan\Desktop\last-bunker-world\tools\sim\lint.ts`, `migrate.ts`, `routes-test.ts`, `openings-test.ts`, `infra-test.ts`, `placement-test.ts`; `tools\perf\budget.json`
