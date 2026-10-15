# C1 — level-builder notes: the city layout, the shell, the slice

*Branch `world/c1-L` (from `world-redesign` @ `7cbb372`, tag `world-c0`). 2026-10-15.*

Shots (shell lab, 1600x900, DPR 1, High, real CityRenderer: lightmap, fog, planes):
- `shots/C1-L-overview.png`: the slice at zoom 0.75. The hub, the living rooms, the six dark edges, the dig face under "known" fog, dark earth below.
- `shots/C1-L-hub.png`: Bell Square at zoom 1.75. Vault wall with the observation window, chandelier, balconies, stairs, bridge, plaza, vestibules.
- `shots/C1-L-edge-dig.png`: `slice-dig` at zoom 1.15. The dig face at 40 % with its work lamp, and the east edges with the cold tease.

## 1. Files

| File | What |
|---|---|
| `src/world/model/cityLayout.ts` | `buildCityLayout(state)`, `cityLayoutSig(state)`, `cityProgress(state)`, `edgeBlock`, `laneY`, `floorLineY`, `storeyBottom`, `stratumSeamY`, `pocketBox`, `edgeAt`, `zonePlateAt`. Pure, Node-safe, deterministic. Returns exactly `src/world/render/layoutTypes.ts` `CityLayout`. |
| `src/world/model/outline.ts` | Noise, ragged outlines, arches, blobs, point-in-polygon (pure). |
| `src/world/render/shell/*` | The shell. `index.ts` holds `buildShell`. Pieces: `rock`, `hub`, `vestibule`, `cavern`, `edges`, `digFront`, `pockets`, plus shared `kit`, `props` and `types`. |
| `src/world/render/shell/mountShell.ts` | A minimal mount into a `CityRenderer`, used by the lab. |
| `src/dev/cityScenario.ts` | The DEV scenarios `slice` and `slice-dig` (`buildSliceState` and `runCityScenario`). |
| `src/main.ts` | 4 lines in `boot()`, inside an `import.meta.env.DEV` block: `?scenario=` runs the scenario before the `GameApp` exists. |
| `src/world/tokens.ts` | The `CITY` block only. `CITY.hub` has `windowHalfW`, `windowMullion` and `plazaSlab`. `CITY.layout` is new: the cut's numbers. |
| City switches | `src/rendering/{world,structure,frontChunks,signage,wingSigns,decals}.ts`; see section 4. |
| `tools/sim/city-layout-test.{ts,mjs}` | Layout checks, in `check:full`. |
| `tools/world/shell-lab.{html,ts}` | The lab (section 6). |

## 2. The layout (architecture 1.3 to 1.5)

**Hubs.** Each reached underground stratum gets one hub, over its dug floors.
- `rect`: hubL..hubR, from `vaultRise` above the stratum's top floor down to the slab under its last dug floor.
- `vault`: a segmental arch polyline from the west wall to the east wall.
- `balconies`: one per storey on each side, at `laneY(f)` (routes.ts `laneY`). West runs `hubL + wallW .. 0`, east runs `SHAFT_W .. hubR - wallW`. The bottom storey's balconies are drawn as the plaza floor.
- `stairs`: one column per side when the hub has 2 or more storeys. `x` is the column CENTRE: `hubL + wallW + stairInset + stairW/2`, which is -24 west and 82 east. The column runs lane to lane, with flights of `FLIGHT_RUN`/`FLIGHT_RISE` zig-zagging `TOWER_AMP` each way, so routes can use it like a `voids.ts` tower.
- `bridge`: on stratum floor `CITY.hub.bridgeFloor` (floor 1 in the slice), x -6..64, across the spine.

**Cavities** (ids are stable):

| Id | Back | What |
|---|---|---|
| `c:hub:<s>` | `hub` | The hub, with the vault line. |
| `c:vest:<f>:w\|e` | `tile` | The two vestibules of every dug storey. |
| `c:strip:<f>:e\|w` | `concrete` | Each floor's room strip. The ceiling sits `stripHead` above the rooms and is pushed out up to `stripRag` by 2-octave noise; the far end is ragged as well. |
| `c:gal:<g>` | `concrete` | Dug galleries. |
| `c:edge:<f>:<side>` | `rock` | The blocked tunnel stub, `edgeLen` past each floor end. With a district on the floor, it sits past the district cavern. |
| `c:dig:<n>` | `rock` | The pit under the hub at the next floor. |
| `c:tun:<kind>` + `c:dist:<kind>` | `rock` (glimpsed) / `none` (dug) | A district tunnel and its cavern blob. The cavern is open (`none`) once dug. |
| `c:p:<s>:<name>` | `rock` | Only once a pocket is FOUND. Before that it is cracks in the rock. |

**Areas.**
- `surface`.
- `f:<f>`: every floor up to the end of the stratum after the deepest one reached (`CITY.layout.strataAhead`).
  - Dug floors cover their strip.
  - The dig face and the undug floors span the whole width, so the unknown deep is one dark earth and not a dark column.
  - The top floor of a hub carries the vault bump.
- `g:<i>`.
- `e:<f>:<side>`.
- `d:<kind>`: built, digging, and on offer (`availableDistricts`, at the floor's east end).
- `p:<s>:<name>`: for the strata reached plus one.

**States** follow `revealedAreaIds`:

| Area | State |
|---|---|
| `f:n` | `glimpsed`, or `digging` with progress |
| Other undug storeys | `hidden` |
| Edges | always `glimpsed`, or `digging` |
| Districts | `glimpsed` / `digging` / `revealed` |
| Pockets | `revealed` if found, `glimpsed` if their stratum is reached, else `hidden` |

**Edge sites.**
- `block` is `act` / `stability` / `district` from `wingBlock`, or `digging` while a wing step runs, or `ready` for everything else (`null`, `cost`, `busy`, `locked`).
- `x` is the choke face, at `edgeChoke` of the stub. `y` is the floor line.

**Signature.** `sig` = `cityLayoutSig(state)`. It changes with the projection, floors, extents, edge looks, districts and their state, a running floor dig, and found pockets. It does NOT change with dig progress: that goes through `cityProgress(state)`.

## 3. The shell contract (for the tech-artist's BunkerRenderer wiring)

```ts
import { buildCityLayout, cityLayoutSig, cityProgress } from '../world/model/cityLayout';
import { buildShell, type ShellParts } from '../world/render/shell';

// rebuildStructure(), city mode: when cityLayoutSig(state) changed (and on a quality-tier change)
const layout = buildCityLayout(state);
this.city.setLayout(layout);
this.shell?.destroy(); for (const id of this.shellLightIds) this.city.removeLight(id);
this.shell = buildShell(layout, state, tier /* 'high'|'medium'|'low'|'lite' */, { era: this.surfaceEra });
this.undergroundHolder.addChild(this.shell.back);     // behind bays and rooms
this.shellFront.addChild(this.shell.front);           // after shaftHolder, before utilitiesHolder and walkers.layer
this.shellLightIds = this.shell.lights.map(l => this.city.addLight(l));

// every frame (before city.update): the world rect in view, for the rock chunks
this.shell.update({ x: v.x0, y: v.y0, w: v.x1 - v.x0, h: v.y1 - v.y0 }, performance.now());

// on dig:start / dig progress / wing:start / district progress (cheap; e.g. twice a second)
for (const p of cityProgress(state)) { this.city.setAreaState(p.id, p.state, p.progress); this.shell.setProgress(p.id, p.progress); }
```

- **`back`** must go into the play layer BELOW the rooms (in `undergroundHolder`). Keep it in a holder that `rebuildStructure` does not clear behind your back: `undergroundHolder.removeChildren()` destroys it. Either re-add it after that line, or give it its own holder right after `undergroundHolder`.
- **`front`** goes above the shaft and under the walkers.
- **No shell part is interactive.** The tap targets stay where they are: wing signs, the dig sign, the district sign.
- **The rock chunks** are `cacheAsTexture` caches at `DETAIL.rockRes`.
  - There are 512 u chunks, and at most 2 are built per `update`.
  - They park after 12 s out of view.
  - The rock needs no renderer handle.
- **Rebuild the shell on a tier change**, because the rock bake resolution and the scatter density depend on the tier. `mountShell.setQuality` does this.
- **Lights** are `LightInput`s (`LightDef = LightInput`), with `area` set:
  - room-side lamps use `f:<f>`;
  - edge lights use `e:<f>:<side>`;
  - district lights use `d:<kind>`;
  - pocket teases use `p:...` with `kind: 'tease'`.

  The kinds: chandelier, barrel and tubes are `shell`; wall lamps, the street lamp and string bulbs are `civic`, so they follow the era and the night.

  For the slice:

  | Where | Lights |
  |---|---|
  | Hub | 1 chandelier, 6 wall lamps, 1 fire barrel |
  | Vestibules | 6 tubes, 1 of them failing |
  | Edges | 3 lanterns (the east ends), 6 teases |
  | Dig face | 1 lantern |
  | Pockets | 5 teases (2 glimpsed in stratum 1, 3 hidden in stratum 2) |

  String lights come from era 2.
- **`mountShell(city, layout, state, { quality, back, front })`** is a ready-made version of the wiring above. It reads the view from the holder's transform, and also has `syncProgress(state)`, `rebuild`, `setQuality` and `destroy`.

## 4. Classic shell switched off in city mode (`CITY` from `src/world/flag.ts`)

| File | City-mode change |
|---|---|
| `world.ts` `buildUnderground` | Returns a root holding only an empty container at index 0, which BunkerRenderer's `parallaxRock` reads. There is no rock, no bay backs, no district tunnels and no plaques. |
| `structure.ts` `buildCasing` | Empty container. |
| `frontChunks.ts` | No column 0 (the hub and vestibules), no stair annex, no roof slab under the topsoil. Columns ≥1 and ≤-1 (the corridor decks, piers, slabs and pipes in front of the rooms) stay, and they meet the vestibule decks. |
| `signage.ts` | Zone plates hang on the hub wall over the doorway to the east vestibule (`zonePlateAt`), clear of the chandelier, the wall lamps and the tube. |
| `wingSigns.ts` | A floor with no west wing has its sign at the end of the west vestibule (`roomsWestX - 7`), not inside the hub. |
| `decals.ts` | Slab decals start at the rooms, not across the hub's band. |

- **Not touched:**
  - `gallery.ts`: its bands start at the spine, under the hub, and the shell gives them a concrete back;
  - `infra.ts`, `airyArt.ts`, `atmosphere.ts` and `surfaceRow.ts`: they draw nothing in the hub (`surfaceRow` is stratum 0, always classic).
- **`shaft.ts`, `surface2` and BunkerRenderer** are the tech-artist's. Until `spineOnly` lands, the classic shaft draws over the hub's centre.

**Classic is unchanged.** `tools/compare/run.mjs` was run on saves-v7 `e30-seed1` and `c-seed1` at 390x844@2x (19 shots), with the baseline at `7cbb372`:

| Pair | Mean diff | Max diff |
|---|---|---|
| base vs base2 (noise floor) | 2.43 % | 10.0 % |
| base vs this branch | 1.66 % | 5.4 % |

The diff images show only people, lamp glows, the lift car and pop-ups. No structure edge moved.

## 5. The slice scenario

- **URLs:**
  - `?city&slot=city-slice&scenario=slice`
  - `?city&slot=city-slice&scenario=slice-dig`
- **What it does:** builds the state on a throw-away `GameEngine` with the engine's own APIs, writes the `?slot=` save, and reloads without `scenario`. That is a real save → load round trip. It refuses to run without `?slot`.
- **The engine calls:**
  - `setupNewGame`;
  - `buildingSystem.placeBuilding` for the restored ruins, as `RestorationSystem.complete` does;
  - `populationSystem.createSurvivor`/`addSurvivor`/`assignSurvivorToBuilding`;
  - `buildingSystem.dig` + `digSystem.assign` for the dig;
  - `seedCity` for `state.city`.
- **State:**
  - Act I, era 0, v8, 3 floors;
  - quarters 0:0;
  - restored canteen 0:6, medbay 0:10, waterPump 1:0, farm 1:2, generator 2:0, workshop 2:5;
  - ruins kept: collapsed 0:3, debris 1:5, flooded 2:2;
  - floor 2 slots 7-11 empty;
  - 8 adults on rooms;
  - `e:2:e` blocked by the Act.
  - `slice-dig` adds the floor-3 dig at 40 % with 2 crew.
- **Skipped on purpose:** intro, Act I tutorial, gesture tips and three early achievements, so no pop-ups cover the slice.
- `city-layout-test` builds both states in Node and checks them.

## 6. Gates

- `npm run check:full`: green. It now includes `city-layout-test`, which runs 12 sample saves and both slice states. The test checks:
  - determinism;
  - well-formed polygons inside the bounds;
  - discovery agrees with `revealedAreaIds`;
  - every room, ruin and empty slot is inside the cut;
  - balconies sit on the lane;
  - stairs stay in their columns, clear of the spine;
  - edges sit past the floor ends;
  - built districts are open;
  - progress never moves the signature.

  A mutation check (strip one slot short) fails it as it should.
- `npx tsc --noEmit` and `tsc -p tsconfig.tools.json` are clean. The vite build is OK.
- **The lab:** `http://localhost:5177/tools/world/shell-lab.html?city`
  - options: `&scenario=slice-dig`, `&save=e30-seed1` (any saves-v7 name), `&tier=`, `&era=`, `&x=&y=&z=`, `&nofog`, `&nolight`;
  - `__lab.shot(name)` writes `store/world-redesign/shots/C1-L-<name>.png`.

## 7. Decisions and assumptions (the user asked for no questions)

- **`LightDef`** is not a type in `lighting.ts`. The shell exports `LightDef = LightInput`, which is what `CityRenderer.addLight` takes.
- **The chandelier** is a `shell` light, not `civic`. Remnant lights only 25 % of civic lamps, and the hub's key light must not go out in the slice. Wall lamps stay `civic`.
- **The hub-vault tile** is scaled to one storey (144 u), with a bay centred on the spine. Every storey's arch recess stands behind the lift.
- **The observation window** fills the top storey and the vault. It is an inverse stencil mask on the wall, which is one mask per hub.
- **Undug storeys and unknown galleries** span the whole width as fog areas, so the unknown deep reads as one dark earth.
- **Pockets** are not cut until found. Before that they are lit cracks with a tease light.
- **West edges in Act I** are all `act`, since the west cap is 0. So a column of sealed ends never repeats, they take three looks:

  | Edges | Look |
  |---|---|
  | East | "Sealed by order": tape, a plate, a lantern by a pick |
  | West, odd floors | Timber collapse with planks |
  | West, even floors | A bricked-up passage with a cold gap |
- **`ready` edges** alternate a sprayed X with a chalk arrow.
- **The rock tile** is multiplied by `0x9a948e`. The lightmap's section fill and the stratum ambient light it back up, and the city reads as islands in dark earth.
- **Zone plates** sit at `hubR + 4`, `floorTop + 36`. The east wall lamps moved to 30 u from the wall to make room.
- **One `if (CITY)` per classic file.** No classic code path was reorganised.

## 8. Open items

- The ramp from the hatch (style guide beat 2) is not built. It needs the surface (`surface2`) and the spine top. Tech-artist or M1.
- `routes.ts` hub stairs (D10) are camera-nav's. The geometry is ready in `HubGeom.stairs`: the x is the column centre and the flights run lane to lane.
- Strata 2-6 use the generic kit:
  - stratum tints on the vault tile;
  - key lights `fluoroTube`/`sodium`/`floodlight`/`crystal`/`magma` under the vault.

  Hero props per stratum come with M2-M4.
- The district cavern of stacked districts (one district each on floors 1, 2 and 3) merges into one column. That reads as a cliff of caverns, which is fine. Stalactites never hang over any district room.
- The life-systems' dig crew and lanterns are not in the lab, which uses capsule walkers.
