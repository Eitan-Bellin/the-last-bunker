# C — World architecture: "The City Below" (Perspective A)

*World Architect, read-only design pass over branch world-redesign @ e506ae2, 2026-10-15. Saved by the orchestrator, lightly condensed.*

## 0. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The logical grid stays the source of truth. Rooms keep `(floor, slot)`; adjacency is still same floor plus contiguous slots; doors stay on boundaries. The city is a new **projection** of that grid plus a dressing layer. | No economy number moves. `touching()`, compound, SYNERGIES, fire and `placeBlock` stay byte-identical. |
| D2 | The shaft stays the logical spine, x `0..SHAFT_W` (58). Each stratum gets a **hub atrium** around it, and rooms start after hub + vestibule. | `doors.ts:61-80` semantics, `LANDING_X`/`LADDER_X`, `coreX()`, the lift tickets and the single `LiftApi` all keep working. |
| D3 | 7 strata = the surface row + 6 groups of 4 floors split at the existing service galleries: stratum s≥1 = floors `4(s-1)..4(s-1)+3`. | Galleries already sit after floors 3/7/11/15/19, `crossesGallery` keeps halls inside a stratum, `FIRE_CODE_FLOOR`=8 opens stratum 3, and `stabilityCut` bites at floor 12 = stratum 4. |
| D4 | The horizontal offset is **per stratum**, not per floor: `slotX(floor, slot)` depends on floor only via `stratumOf(floor)`. | Halls, stair and vent columns, and door openings stay vertical within a stratum. |
| D5 | Through C and M1 all underground strata use the same frame. Distinct frames arrive in M2 with the nav graph (gallery jogs). | Removes route and infra jog risk early. |
| D6 | Discovery is a new top-level `state.city` slice (v1). `SAVE_VERSION` goes 7 → 8. `layout` is unchanged (still `v:1`). | Presentation-only state; zero economy effect. |
| D7 | Fog/discovery is **derived** from logic (dug floors, wing steps, built districts are revealed by definition). The save holds only `seen` (acknowledged → "new" pins) and `found` (cosmetic pockets). | Old saves come up fully discovered; there is one source of truth. |
| D8 | The city renders inside `worldContainer`. Parallax planes are counter-transformed children. The lit set (rock, rooms, structure, people) sits in one `litGroup` carrying a `LightmapFilter`. | `postfx.ts` stays untouched; `NumberPopup` and the facades keep working. |
| D9 | A URL flag `?city` (module-load, like `GFX.airy`) selects projection and renderer. Classic stays default until the end of M1, then flips. | Classic stays pixel-identical (compare tool, zero diff). |
| D10 | In C, walker routing extends `routes.ts` with hub stair columns (the existing tower-hop machinery). A full Dijkstra nav graph lands in M2. | Smallest change that makes the slice walk on hub stairs. |

## 1. City model

### 1.1 Strata → floors (`src/data/strata.ts`, new, Node-safe)

| id | key | floors | Rules already here | Logic districts | Act |
|---|---|---|---|---|---|
| 0 | surface | -1 (surface row) | surface, SURFACE_EXT | — | always |
| 1 | shelter (upper shelter + Bell Square hub) | 0-3 | zones living 0 / agri 1 / eng 2; raids at floor 0 | cave(1) lake(2) metro(3) | I |
| 2 | works (service network) | 4-7 | collapse ≥5 | oldVault(5) geothermal(6) | I ends on 4 |
| 3 | cisterns / old metro | 8-11 | FIRE_CODE 8 | — | II-III |
| 4 | mines | 12-15 | stabilityCut ≥12 | — | IV |
| 5 | caves | 16-19 | | — | V-VI |
| 6 | core | 20-23 | | — | VI-VII |

```ts
export type StratumId = 0|1|2|3|4|5|6;
export type KitId = 'surface'|'shelter'|'works'|'cisterns'|'mines'|'caves'|'core';
export interface PocketDef { id: string /* 'p:<s>:<name>' stable */; anchorFloor: number; side: 'w'|'e'|'below';
  dxSlots: number; dy: number; w: number; h: number; name: Record<'he'|'en', string>; }
export interface StratumDef { id: StratumId; key: KitId; floors: readonly [number, number]; name: Record<'he'|'en', string>; pockets: readonly PocketDef[]; }
export const STRATA: readonly StratumDef[]; export const FLOORS_PER_STRATUM = 4;
export function stratumOf(floor: number): StratumId;          // -1→0; f→1+floor(f/4), cap 6
export function strataReached(currentFloors: number): StratumId[];
export function isStratumTop(floor: number): boolean;          // f>=0 && f%4===0
```
Lint: every stratum boundary b−1 is in `GALLERY_ABOVE_FLOORS`; `stratumOf(MAX_FLOORS-1)===6`; pockets lie beyond max logical reach (`WING_CAP_*` + `DISTRICT_SLOTS` + margin) or inside a gallery band.

### 1.2 Projection (`src/world/project.ts`, new, Node-safe)

```ts
// src/world/types.ts
export interface Rect { x: number; y: number; w: number; h: number }
export interface StratumFrame { s: StratumId; hubL: number; hubR: number; vestW: number; vestE: number; tunnel: number }
// src/world/project.ts
export type ProjectionKind = 'classic'|'city';
export const PROJECTION: ProjectionKind;   // from src/world/flag.ts
export function __setProjectionForTests(k: ProjectionKind): void;
export function frameOf(floor: number): StratumFrame;
export function slotX(floor: number, slot: number): number;
export function slotAtX(floor: number, x: number): number | null;   // null inside the hub/vestibule
export function slotSpanX(floor: number, slot: number, slots: number): { x0: number; x1: number };
export function roomRect(floor: number, slot: number, slots?: number, floors?: number): Rect;
export function buildingX(b): number; export function buildingRect(b): Rect;
export function districtXAt(floor: number, slotAt: number): number;
export function stripX(floor: number, ext: { w: number; e: number }): { x0: number; x1: number };
export function spineRect(): Rect; export function hubRect(s: StratumId): Rect;
```
Formula (affine per stratum): `slotX(f,s) = s>=0 ? F.hubR+F.vestE+s*SLOT_W : F.hubL-F.vestW+s*SLOT_W`. The classic frame `{hubL:0, hubR:58, vestW:6, vestE:6, tunnel:18}` reproduces `geom.ts:131` exactly. City frames come from tokens `T.city.frames[s]`. Stratum 0 is always classic. Y is untouched: inverse lookups always do y first, then `slotAtX(floor, x)`.

### 1.3 Hubs, vestibules, circulation (`src/world/model/cityLayout.ts`, pure)

```ts
export interface HubGeom { s: StratumId; floors: number[]; rect: Rect; vault: number[];
  balconies: { floor: number; side: 'w'|'e'; x0: number; x1: number; y: number }[];
  stairs: { side: 'w'|'e'; x: number; top: number; bottom: number }[];
  bridge?: { floor: number; x0: number; x1: number; y: number }; }
export type AreaKind = 'surface'|'storey'|'edge'|'district'|'gallery'|'pocket';
export type AreaState = 'hidden'|'glimpsed'|'digging'|'revealed';
export interface CityArea { id: string; kind: AreaKind; s: StratumId; poly: number[]; state: AreaState; progress?: number; label?: { x: number; y: number; key: string } }
export interface EdgeSite { id: string; floor: number; side: 'w'|'e'; x: number; y: number; block: 'act'|'stability'|'district'|'ready'|'digging'; progress: number }
export interface Cavity { id: string; s: StratumId; poly: number[]; back: 'hub'|'tile'|'rock'|'concrete'|'none' }
export interface CityLayout { sig: string; frames: StratumFrame[]; hubs: HubGeom[]; cavities: Cavity[]; areas: CityArea[]; edges: EdgeSite[]; bounds: Rect; strata: { s: StratumId; y0: number; y1: number }[] }
export function cityLayoutSig(state: GameState): string;
export function buildCityLayout(state: GameState): CityLayout;
```
Circulation is added around the spine and stays cosmetic for logic:
- **Lift:** unchanged.
- **Hub stairs:** one flight column per side per stratum. They feed `routes.ts` like the `voids.ts` stair towers.
- **Balconies:** on `laneY(f)`, so a walker goes front-corridor lane → vestibule → balcony → lift landing.
- **Later (M2):** the gallery transfer and ramps/bridges become real nav edges in `src/world/nav/graph.ts` (Dijkstra emitting the existing `Route`).

### 1.4 Districts beyond the grid
- **Logic districts:** the 5 district buildings stay at `position.x = ext.e`. They render as caverns at `districtXAt(floor, x)` via a tunnel. Area `d:<kind>` is:
  - **hidden:** not available;
  - **glimpsed:** in `availableDistricts`; rubble-choked mouth with the signature light beyond;
  - **digging:** `isConstructing`;
  - **revealed:** built.
- **Dressing districts:** far/back parallax planes per stratum reached. Lit windows scale with population. Never interactive.
- **Pockets:** cosmetic secrets outside max reach. Glimpsed once their stratum is reached; a tap finds them (`city.found`). No reward by default (P1).

### 1.5 Discovery state (`src/core/state/city.ts`)

| Area id | Derived state |
|---|---|
| `surface` | revealed |
| `f:<floor>` | `revealed` if floor < currentFloors.<br>`digging(p)` if a floor dig targets it.<br>`glimpsed` if floor === currentFloors.<br>`hidden` otherwise. |
| `g:<i>` | revealed if floor 4i+3 < currentFloors |
| `e:<floor>:<side>` | `glimpsed` (block from `wingBlock`).<br>`digging` while a wing step is being dug.<br>When the step finishes, the strip widens and the edge moves out. |
| `d:<kind>` | see 1.4 |
| `p:<s>:<name>` | `revealed` if in city.found.<br>`glimpsed` if its stratum is reached.<br>`hidden` otherwise. |

```ts
export interface CityState { v: 1; seen: string[]; found: string[] }   // sorted, unique
export function createCity(): CityState;
export function revealedAreaIds(state): string[];
export function seedCity(state: GameState): CityState;   // seen = revealed ∪ ['surface','s:0','s:1'], found = []
export function normalizeCity(c: unknown): CityState;
```

## 2. Migration v7 → v8
- **GameState:**
  - Add `city: CityState`.
  - `SAVE_VERSION = 8`.
  - `createInitialState()` sets `city: createCity()`.
- **`migrateState`:**
  - Line 608 becomes the seam `merged.layout = migrateLayout(saved.layout)`, with the same behaviour (still `v:1`).
  - At the end: `merged.city = saved.city ? normalizeCity(saved.city) : seedCity(merged)`.
  - Add storyFlag `whatsnew:v8` once, when `saved.version < 8`.
  - `seedCity` must run on `merged`, not on `saved`.
- **The old bunker becomes the first areas.** Floors 0-3 become stratum 1 around the hub, and deeper floors go to strata 2-6 through the projection. Positions are never rewritten. The whole bunker is seen, so there are no "new" pins on first load.
- **Idempotent:** `normalizeCity` is pure, and seeding runs only when `city` is absent. A v8 save opened in a v7 build keeps `city` through the spread.
- **Tests:**
  - Dump v7 samples into `store/sim/saves-v7/` with the current build before bumping.
  - `migrate-test` runs on saves-v6 and saves-v7 and asserts:
    - version 8;
    - `city` is well-formed;
    - every revealed id is in `seen`, and `seen` contains surface, s:0, s:1 and f:0..n-1; `found` is empty;
    - layout and building/ruin positions are byte-identical;
    - idempotent;
    - round trip keeps `found`;
    - `whatsnew:v8` is added exactly once.
  - Lint: `createInitialState().city` equals `createCity()`.
  - **Economy parity gate:** `tools/sim/run.mjs`, 3 seeds × 6 h, branch vs e506ae2. Results must be identical except `version` and `city`.

## 3. slotX refactor (~124 calls / 27 files)
- `src/world/project.ts` owns every x conversion. `geom.ts` keeps y plus the deprecated classic `slotX(slot)`, `slotAtX(x)`, `buildingX`, `districtXAt` until S5.
- **Rails:**
  - A lint ratchet `LEGACY_X_BASELINE` (count of legacy imports and ROOMS_X/SHAFT_GAP x-maths) that only goes down.
  - `tools/compare/run.mjs` classic zero pixel diff after S1-S3.
  - New `tools/sim/project-test` with a deliberately skewed frame (37 u per stratum), over all sample saves. It asserts:
    - touching rooms share an edge;
    - no rect overlap;
    - halls are aligned;
    - `slotAtX` round-trips;
    - `slotAtX` is null in the hub;
    - doorways sit on edges;
    - `walkBlocked` agrees with `isPassable`.
  - A lint warning on `slotX(0,` without a `// floor-0:` reason.
- **Stages:**
  - **S0:** API files.
  - **S1:** routes, openings, walkers, voids, PlacementController, tests.
  - **S2:** world, frontChunks, structure, gallery, infra, signage, decals, surfaceRow, airyArt, atmosphere, wingSigns.
  - **S3:** BunkerRenderer, RoomViews, PlacementGhost, cityMap, camShots.
  - **S4:** UI files, owned by the UX session; see 3.4.
  - **S5:** remove the deprecated API; ratchet = 0.
- **Floor argument rule:** use the floor in scope; floor −1 for the surface row; global extents use `stripX` or `layout.bounds`; never invent a 0.

### 3.4 UI lines for the UX session

| File | Line(s) | Change |
|---|---|---|
| `src/ui/ceremony.ts` | 5 | `buildingX`, `slotX`, `buildingRect` imported from `../world/project` |
| `src/ui/ceremony.ts` | 266 | `buildingRect(b)` |
| `src/ui/ceremony.ts` | 360 | `slotX(spec.floor, …)` ×3 |
| `src/ui/ceremony.ts` | 393 | gate x = spine centre |
| `src/ui/components/DepthRuler.ts` | — | y only, no change (optional stratum ticks in M1) |
| `src/ui/controllers/world.ts` | 19 | import `slotX` from project |
| `src/ui/controllers/world.ts` | 224 | `slotX(p.floor, p.x)` |
| `src/ui/share.ts` | 5 | import `buildingX`, `spineRect` from project |
| `src/ui/share.ts` | 78 | bounds from `spineRect`/hub, or `renderer.cityBounds()` |
| `src/ui/tour.ts` | 4 | import from project |
| `src/ui/tour.ts` | 188-189 | `slotX(f, …)` |

## 4. Discovery and dig (economy unchanged)
The renderer and `CitySystem` only **read** the dig state:
- `longGame.dig`/`dig2`, `currentFloors`, `layout.ext`, `layout.doors`, ruins, district buildings;
- `wingBlock()`, `availableDistricts()`;
- events `dig:start`, `dig:done`, `floor:dug`, `wing:start`, `wing:dug`.

`DigSystem`, `BuildingSystem.dig*` and `data/wings.ts` are **not edited**.

| Logic | City visual |
|---|---|
| Floor dig | Dig face under the bottom storey; rubble wall `1 − progress/total`; crew at work; dust; a work lamp. |
| f % 4 === 0 | Breakthrough: the new stratum's hub vault, the gallery and its far/back plates fade in. |
| Wing step | Edge site = blocked tunnel; rubble clears with progress; the edge moves out 2 slots. |
| wingBlock 'act' | Collapsed tunnel, caution tape, "sealed by order" plate, cold light beyond. |
| 'stability' | Cracked rock, timber props, drips. |
| ready | Marked dig site (spray X, tools, lamp); tapping keeps `onWingDig`. |
| Sealed door | Welded blast door, room fill dropped to the token level, red emergency lamp. |
| Shut door | Closed bulkhead, amber lamp. |
| Ruin | Rubble alcove that clears with restoration. |
| Pocket | Glow through cracks; a tap → `CitySystem.find`. |

`src/systems/CitySystem.ts`: `markSeen(areaId)` and `find(pocketId)`. It writes only `state.city`, emits `city:found`/`city:seen`, and the sim bot never calls it.

## 5. Rendering architecture

`worldContainer` keeps its PostFX filter and camera transform. Inside it, back to front:

1. `farPlane` (p 0.40)
2. `backPlane` (p 0.68)
3. surface + projectSites (sky parallax comes in M4)
4. **`litGroup`** with `LightmapFilter`, containing:
   - `midPlane` (0.88)
   - `undergroundHolder`: city rock chunks with cavities cut + hub vaults / vestibule / cavern backs (classic `buildUnderground`/`buildCasing` only when classic)
   - `bayHolder`
   - `roomLayer` (unchanged)
   - `shaftHolder` (`spineOnly`: car, rails, landing gates on balconies)
   - `shellFront` (balconies, rails, stairs, bridge, edge rubble, dig face)
   - `utilitiesHolder`
   - `walkers.layer` (lamp-pool tint off in city mode)
5. `slotLayer`, `highlightLayer` (above litGroup, never darkened)
6. `glowLayer` (additive)
7. dust / fx / incidents
8. dig, district sign and wing signs (tap targets kept)
9. `fogLayer`
10. `forePlane` (p 1.32; hidden below zoom 0.85 and on low)
11. cityMap, labels, badges, ghost

**Lightmap.** An off-stage `lightRoot` renders to `lightRT` (scale 0.5, 0.35 on low) each frame before `app.render()`, and is skipped while the map covers. Contents: ambient, depth ramp, zone fills, and point lights culled to the view (room lamps from `ArtLibrary.lightsFor`, shell lights, lanterns, crisisLight). The `LightmapFilter` samples it in screen UV: `c.rgb * light.rgb * gain`, alpha kept. Fallback: a world-matrix uniform.

**Parallax.** For a plane with factor p: `k = z^(p-1)`, `scale = k`, `position = (cx(1-pk), cy(1-pk))`. `CameraController.parallaxInfo() → {cx, cy, z}`.

### Modules (`src/world/render/`)

| File | Contents |
|---|---|
| `CityRenderer.ts` | `mount`, `setLayout`, `update`, `renderLightmap`, `addLight`/`removeLight`, `areaAt`, `bounds`, `destroy` |
| `layers.ts` | planes, parallax, far/back cache RT |
| `backdrop.ts` | far/back/mid content per stratum |
| `lighting.ts`, `LightmapFilter.ts` | lightmap, glow, culling, flicker |
| `fog.ts` | fog RT from area polygons, reveal brush |
| `chunks.ts` | generic ChunkManager: 512² chunks, ≤ 2 builds per frame |
| `shell/*` | rock, hub, vestibule, cavern, edges, digFront, pockets, kit per stratum (level-builder) |

**LOD:** below 0.42 the map covers (lightmap, fog and glow stop); 0.42-0.85 no fore plane and no cones; above 1.2 name tags. The cityMap rewrite is in M2.

**Quality tiers:**

| Tier | lightScale | far/back | fore | cones | litRes | fog halos |
|---|---|---|---|---|---|---|
| high | 0.5 | live | on | on | 1 | 2 |
| medium | 0.5 | cached RT | on | on | 1 | 1 |
| low | 0.35 | one shared cache | off | off | 0.75 | 1 |
| lite | none, flat tint | — | — | — | — | static |

## 6. Vertical slice (real code behind `?city`)
**Scenario `slice`.** `src/dev/cityScenario.ts` (DEV only), opened with `?city&slot=city-slice&scenario=slice`. It builds the state with engine APIs, saves, then reloads (a real round trip).
- **State:** v8, Act 1, currentFloors 3.
- **Hub:** stratum 1 hub, a 3-storey atrium around the spine, with balconies and stairs. Floor 3 is the glimpsed dig face.
- **Vestibule:** the east vestibule as a tiled corridor with fluorescent tubes.
- **Living district:**
  - quarters 0:0 built;
  - restored from START_LAYOUT ruins (built L1): canteen 0:6, medbay 0:10, waterPump 1:0, farm 1:2, generator 2:0, workshop 2:5;
  - ruins kept: collapsed 0:3, debris 1:5, flooded 2:2;
  - floor 2 slots 7-11 left empty;
  - 8 survivors.
- **Dark edge:** `e:2:e` with wingBlock 'act': blocked tunnel, tape, cold light, half fog.
- **Variant `slice-dig`:** floor dig on 3 at 40%, with 2 crew.

### Ownership and order

1. **C0 — level-builder alone:**
   - API files: `types.ts`, `project.ts`, `flag.ts`, `data/strata.ts`.
   - Codemod S1-S3.
   - v8 (`GameState`, `core/state/city.ts`, `CitySystem`).
   - Tests and lint.
   - Gates: check:full + project-test + compare zero diff. Tag `c0-done`.
2. **C1 — in parallel, separate files:**
   - level-builder: `cityLayout`, shell/*, scenario, city switches in world/frontChunks/structure/…
   - tech-artist: `src/world/render/*`, BunkerRenderer integration, shaft `spineOnly`, postfx city grade.
   - asset-pipeline: `tools/world/*`, `public/art/world/**`, `src/art/worldKit.ts` (procedural fallbacks), registry WORLD_KIT block.
   - camera-nav: CameraController (city bounds, `parallaxInfo`, framing), routes hub stairs, voids annex off, `src/world/nav/hubStairs.ts`.
   - life-systems: walkers/people city lighting, `src/world/life/{idleSpots,lanterns,digCrew}.ts`.
3. **C2 — integration:** merge in the order L, T, C, Li, A, then acceptance.

**Acceptance:**
1. The slice shows every beat and survives a reload; 5 shots `C-{overview,hub,corridor,district,edge}.png`.
2. Interactions work:
   - place a room at 2:7;
   - tap a room to open its sheet;
   - a survivor reassigned 0→2 walks via stairs or the lift;
   - closing a bulkhead blocks the walk;
   - tapping the edge opens the wing card.
3. `slice-dig` shows the dig face and crew.
4. Without `?city`: compare zero diff, check:full green, parity identical.
5. Perf scenario `city-slice`: high ≤ 300 draw calls and p95 < 20 ms on desktop; low ≤ 220.

## 7. Milestones

**M1 — strata 0-1 + hub + migration, flag on**
- Deliverables:
  - v8 shipped;
  - S4 (UX session) + S5;
  - full stratum 1 kit (cave/lake/metro pockets);
  - generic fallback kit for strata 2-6;
  - infra and sealed-door visuals;
  - wing edges on all floors;
  - `CitySystem` "new" pins;
  - whatsnew card;
  - `?city=0` kill switch.
- Acceptance:
  - check:full, parity, classic zero diff;
  - perf for city-f8/f24 within today's f24 budget;
  - a real mid-range Android at low ≥ 30 fps;
  - every sample save loads with no overlapping rects.

**M2 — stratum 2 + city map + follow-survivor**
- Deliverables:
  - distinct per-stratum frames;
  - nav graph (Dijkstra, ramps, bridges, gallery transfer);
  - Works kit;
  - fog-aware cityMap;
  - `CameraController.follow()` + a follow chip (UX).
- Acceptance:
  - a 2→6 trip goes via the gallery;
  - follow keeps the person in the central 30%;
  - map toggle < 8 ms.

**M3 — strata 3-4 + discovery/dig**
- Deliverables:
  - Cisterns and Mines kits;
  - dig faces for all depths;
  - breakthroughs;
  - pockets persisted;
  - edge visuals per block reason;
  - district tunnel states.
- Acceptance: parity identical.

**M4 — strata 5-6 + polish**
- Deliverables: Caves and Core kits, fore content, sky parallax, pre-baked rock, lite path, tier tuning.
- Acceptance:
  - all perf budgets;
  - cold boot ≤ today + 300 ms;
  - context-loss rebuild;
  - reduced motion = no parallax.

## 8. Proposals (need user approval; the default is the fallback)
- **P1 pocket rewards.** Lore or 50 scrap. Default: cosmetic only.
- **P2 align Act floor caps to strata** (4/8/12/…). Default: unchanged.
- **P3 pockets as build sites.** Changes adjacency and placement. Default: dressing only.

## 9. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Codemod argument swaps | medium | zero diff + skew test + ratchet |
| Nested-filter UV | medium | world-matrix fallback |
| Phone fill rate | high | cached planes, tiers, device gate in M1 |
| Conflicts in tokens.ts | medium | split token files per owner |
| airy/galleries flags change SLAB | low | project reads geom at call time |
