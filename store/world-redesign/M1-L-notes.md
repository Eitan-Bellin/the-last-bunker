# M1 — level-builder notes: the entrance, stratum 1 caverns, a city of distinct strata

*Branch `world/m1-L` (from `world-redesign` @ `0ef16fb`). 2026-10-15. The user was asleep; every decision below was taken without asking.*

Shots (High, 1600x900, real game, headless Chrome on the iGPU):
- `shots/M1-entrance.png`: the hatch, the shaft and the companionway into Bell Square.
- `shots/M1-cave.png`, `M1-lake.png`, `M1-metro.png`: the three stratum-1 district caverns (e55).
- `shots/M1-strata-overview.png`: the six hubs side by side (e55 dug on to 24 floors), each its own place.
- `shots/M1-e55-deep.png`: e55 at the Old Metro / Mines seam.
- `shots/M1-phone.png`: 375x812@2, Medium, the entrance and Bell Square at the phone's home zoom.

## 1. What was built

| Deliverable | Where | What |
|---|---|---|
| 1. Entrance beat | `model/cityLayout.ts` `entranceGeom()`, cavity `c:hatch`; `shell/entrance.ts` | A blast hatch in the ground east of the spine, its leaf propped open (hinge block, locking dogs, prop bar), banked sandbags, a barrel fire and a red beacon on the coaming. The shaft is cut through the soil into the vault crown, lined with board-formed concrete, hazard bands and an old ladder. The sky spills down it (a `civic` light, so it dims at night, plus a soft additive ray). From the hatch landing four flights zig-zag down the east hub stair column (they continue the column's zig-zag) to floor 0's east balcony, with a hazard-yellow handrail, two cage lamps making overlapping pools and the red threshold lamp at the bottom (style guide beat 2). |
| 2. Stratum 1 kit | `shell/districts.ts`, `shell/cavern.ts`, `shell/pocketInside.ts` | **Cave**: a tall dripstone hall (stalactites, stalagmites on the ledge, moss on lip and roof, a rope of five lanterns, a drip pool). **Lake**: the ledge is open black water with lamp reflections and ripples, a stone quay under the room, a plank jetty on posts carrying the walk, a lamp post, a moored rowboat with a lantern. **Metro**: a tiled tunnel vault with teal frieze and ribs, the room on a platform with the yellow edge, track trench with sleepers and rails, a dead coach with lit windows (a stall), the enamel plate, a clock, two sodium lamps and a teal signal. States: glimpsed and digging show one hint past the rubble (water, rails, dripstone); revealed shows the whole. Stratum-1 pockets (and every other) get named interiors: the well room's stone well and windlass, the chapel's candles in an arched niche, pipes and valves, tile and platform edge, a token booth, flooded water, a canary cage, a magma vent, the sealed lab's door and screens. |
| 3. Strata 2-6 | `tokens.ts` `CITY.kits`, `shell/hub.ts`, `shell/hubKits.ts`, `shell/vestibule.ts`, `shell/edges.ts`, `shell/transfers.ts` | Every reached stratum keeps its hub, now in its own language. **Service** (2): green glazed tile, the painted pipe rack under every ceiling, a lagged main with red valve wheels and gauges, a big wall fan behind the spine, steel gantries with a lattice under the decks, a pump manifold with steam, the failing tube. **Metro** (3): dirty cream tile, teal frieze and dado, cast-iron columns with capitals, a dead tunnel mouth with rails into the dark and a teal signal, the enamel plate and the clock, sodium globes, turnstiles, the platform edge. **Mines** (4): hewn rock with copper veins and gold flecks, a ragged roof, timber sets, a timber headframe with its winch wheel over the spine and a work flood, timber decks with rope rails, carbide lanterns, an ore cart on rails, blasting crates. **Caves** (5): no built walls, a ragged natural roof with stalactites, a crack in the back wall onto the far dark, flowstone, glowing fungus shelves, stilt platforms with rope, crystal clusters (cyan and violet) as the key light, a tarp camp with a lantern. **Core** (6): basalt, blued heat shields, the brass vault ring door behind the spine, geothermal risers, a magma seam under the plaza grating that lights the hall from below, embers, a brazier. Vestibules follow (tile / metro tile + sodium / timbered drift + lantern / rock + fungus / basalt + shield) and so do the edge tunnel mouths (timber / concrete portal with hazard bars / tiled portal / natural with dripstone / steel frame); rubble takes the stratum's rock and a sealed end's tease its own colour. **Transfers**: where a service gallery crosses the hub, a hazard-edged landing, an enamel plate in the next stratum's ink, a signal row in the next stratum's key colour along the whole band, and one signature prop of the next stratum at each end (valve wheel, metro tile, timber prop, crystal, ember crack). |
| 4. Edges, doors, infra | `shell/edges.ts`, `shell/doors.ts`, `rendering/infra.ts` | Edge looks per `wingBlock` on every dug floor (unchanged logic, kit framing). Doors: infra.ts already draws the bulkhead on the city projection (leaf, straps, SEALED sign); in the city a shut one's lamp is now amber (`statusTint('warn')`) and a sealed one's red, and the shell adds each one's light to the lightmap (amber / red, steady: no hard flash). Infra columns (stairwells, vent stacks) use `slotX(floor, …)` and draw correctly in the city (checked in the e55 shots). |
| 5. Fore plane | `shell/fore.ts`, `CITY.fore` | Silhouettes (the fore atlas, tinted near-black) only in the side rock past the city's outermost edges and districts (outcrops, hanging pipe pairs) and along reached seams outside the rooms (a pipe pair, a sagging cable). Every frame each one's projected box (where p 1.32 puts it now) is tested against the keep-clear boxes (every storey not hidden, hubs, edges and their signs, districts, the dig face, the hatch; padded 18 u) and it drops out at once while it overlaps one, easing back in after. High only (DETAIL: Medium and Low have no fore layer). |

## 2. Model changes (all pure, `src/world/model/cityLayout.ts`)

- `entranceGeom()`: hatch box, stair column, flights (top y, odd/even). Exported for routes.
- `vaultLine(…, s)`: `CITY.kits[s].vaultRag` pushes the mines' and caves' roofs outward (never into a storey; the springers stay on the walls).
- District caverns reach further east per kind (`CITY.layout.districtReach`: lake 64, metro 92, cave 24) and the cave rises 10 more; a district with a floor or a district over it is a low hall with a ragged roof and a rock shelf above (stacked caverns no longer cut into the room above).
- **Overhangs**: a two-storey room that hangs into another floor's band widens that floor's strip and pushes its dark edge out (found by the new test: the e30/e55 atrium on 9 was half under the floor-10 edge's rubble). Overhangs are in the signature.
- Shut / sealed doors are in the signature (their lamps are in the shell).
- Pockets: `oldChapel` moved from slot 30 to 34 (at the last Act's widest caps the lake's edge reached it); `crawlway` is 13 tall, not 26 (it met floor 8's strip ceiling). Ids unchanged.

## 3. Route hook (not wired: `routes.ts` is camera-nav's)

`entranceGeom()` gives the surface → hub walk: from the hatch (`hatch.x0..x1`, ground y 0) down to the landing at `stair.top`, then each flight in `flights` (top y; `odd` = runs down to the right, as hub stairs do) to `stair.bottom` = `laneY(0)`, onto floor 0's east balcony. It continues the east hub stair column (`HubGeom.stairs` side 'e'), so a surface arrival can join the existing tower-hop route at the column top. Today arrivals still come by the lift; the visual is there.

## 4. Gates

- `npm run check:full`: green (includes the extended `city-layout-test`).
- `npx tsc --noEmit`: clean. `vite build --outDir <scratchpad>/dist-m1`: OK; `cityScenario` not in the bundle; world art unchanged at 672 KB (no new paintings: the kits are tinted tiles and vector).
- `city-layout-test` now also checks, over all saves-v6/v7, both slice states, **e55 dug on to 24 floors** and **e55 at the last Act's widest wing caps**: no two rooms overlap; no room stands in a hub; no district cavern, district tunnel, edge tunnel or the hatch cuts into another floor's room; every reached stratum has its hub over exactly its dug floors; the entrance (hatch cut, flights fill the column from the landing to floor 0's lane, the last flight meets the column); pockets meet no other cavity; a sealed door changes the signature. 1451 areas/rooms checked.
- **Classic unchanged** (C0-handoff method: `tools/compare/run.mjs`, saves-v6 `e30-seed1` + `c-seed1`, 390x844@2x, 17 shots; baseline `0ef16fb` captured twice): noise floor base vs base2 **2.54 % mean / 9.9 % max**; base2 vs this branch **2.68 % / 10.4 %** (base vs this branch 3.16 % / 10.6 %, the e30 cam11/cam2 shots that also lead the noise floor). Classic code paths are untouched by construction: the only classic-file edit (`infra.ts`) is behind `CITY`.
- **Perf** (production build in the scratchpad, `ct-frames7.mjs` = A2 `frames.mjs` at the Round-1 absolute zoom, headless Chrome on the iGPU, e55, Medium). Budget = Round-1 city row + 10 %:

  | e55, Medium | Draw calls (budget) | GPU tex MB (budget) |
  |---|---|---|
  | desktop, run 1 | **586** (≤ 637) | **346** (≤ 396) |
  | desktop, run 2 | 582 | 281 |
  | desktop, `0ef16fb` same session as run 2 | 578 | 328 |
  | phone, run 1 | **539** (≤ 592) | **301** (≤ 409) |
  | phone, run 2 | 542 | 266 |
  | phone, `0ef16fb` same session as run 2 | 536 | 426 |

  Both within budget: +4 to +7 draw calls against the stage-C build in the same session, and no new textures (GPU MB moves with the session's lazy art loading, as Round 1 noted). Idle CPU draw at Medium, desktop: 18.4 ms against 20.5 ms for `0ef16fb` in the same session (this machine ran slower today than in Round 1 for classic too: classic e55 raw frame 27 ms vs 17 ms then). Fresh game, Medium: desktop 201 calls / phone 198 (Round 1: 197 / 194). High e55: 651-657 calls desktop, 581-583 phone (fore plane on).

## 5. Decisions and assumptions

- **The hatch is IN the vault, not a ramp through the soil.** The soil over floor 0 is 64 u and over the vault crown 14 u: no room for a sloped tunnel people could walk. So the way down is a hatch shaft into the crown and a companionway of flights down the east stair column, which is also the shape routes already know (a tower of flights). The surface portal art (surface2) is the tech-artist's and stays; the hatch stands east of it.
- **No new paintings.** The kits are the existing world-kit tiles tinted per stratum (corridor tile, rock, deck, railing, back-pipes, timber, stair flights, lamps) plus vector parts with the shared outline and gradients. World art stays 672 KB, GPU memory unchanged by art.
- **Fore content is in the shell, mounted into the renderer's fore plane by its label** (`plane:fore`), because `backdrop.ts` and the seams are the tech-artist's. Proposal for the tech-artist: a `ShellParts.fore` seam in `cityWiring` instead of the label lookup; `BACKDROP.fore.enabled` stays false (that lip is the one that drifted over rooms).
- **Stacked districts** (cave 1, lake 2, metro 3) are three halls, not one cliff: only the top one (cave) gets the tall roof; the lake and the metro are low halls with a rock shelf between them.
- **Mid-plane shanties** show through the lake's open cavern back as lit outlines (backdrop.ts, tech-artist). Left as is; noted.
- Hub key lights per stratum: chandelier / tube row (one failing) / sodium globes / headframe flood / crystals / magma from below. Wall lamps: sconce / cage / sodium on columns / hung lanterns / fungus / cage.
- String lights (Colony era on) only in the shelter, metro and mines hubs (not in the service hall, the caves or the core).
