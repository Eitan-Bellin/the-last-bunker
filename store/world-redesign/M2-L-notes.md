# M2 — level-builder notes: distinct strata frames, the gallery transfers, the Service Network

*Branch `world/m2-L` (from `world-redesign` @ `c692979`, tag `world-m1`). 2026-10-15. The user was asleep; every decision below was taken without asking.*

## 0. CONTRACT FOR NAV (written first; stable)

### 0.1 Frames (D5 lifted)

Every underground stratum now has its own `StratumFrame` (tokens `CITY.frames[s]`, read through `src/world/project.ts` as before:
`frameOf(floor)`, `frameOfStratum(s)`, `slotX(floor, slot)`). Still affine per STRATUM (D4): inside a stratum halls, stair columns, vent
stacks and door openings are vertical. Across a stratum seam (a service gallery) x jumps.

| s | kit | hubL | hubR | vestW | vestE | tunnel | west rooms end | east rooms start | reads as |
|---|---|---|---|---|---|---|---|---|---|
| 0 | surface | 0 | 58 | 6 | 6 | 18 | -6 | 64 | classic (forced) |
| 1 | Bell Square | -84 | 142 | 36 | 36 | 18 | -120 | 178 | the civic plaza, wide and symmetric |
| 2 | Service Network | -64 | 122 | 66 | 66 | 30 | -130 | 188 | narrow pump hall, long service corridors |
| 3 | Old Metro | -158 | 216 | 30 | 30 | 22 | -188 | 246 | the wide station hall |
| 4 | Mines | -72 | 196 | 52 | 20 | 40 | -124 | 216 | lopsided hewn chamber, east-heavy |
| 5 | Deep Caves | -136 | 150 | 24 | 58 | 34 | -160 | 208 | a natural cavern, west-heavy |
| 6 | Core | -96 | 154 | 44 | 44 | 26 | -140 | 198 | the compact forge |

Constraints kept (tested in `tools/sim/project-test.ts` / `city-layout-test.ts`): every hub holds the spine (`hubL <= -64`, `hubR >= 122`,
room for a stair column of `CITY.hub.wallW + stairInset + stairW` = 62 and its landing on the balcony each side); stratum 0 is classic.
Hub stair columns: `x = hubL + 40` (west) / `hubR - 40` (east), unchanged formula (`nav/hubStairs.ts hubStairX` stays right).

### 0.2 Gallery transfers — `src/world/model/transfers.ts`

```ts
import { galleryTransfers, transferRun, transferColumnX, type GalleryTransfer, type TransferRun } from 'src/world/model/transfers';
// also: buildCityLayout(state).transfers  (same list; CityModel = CityLayout & { transfers: GalleryTransfer[] })

interface TransferEnd { s: StratumId; floor: number; column: number /* stair column centre */; x: number /* column + TOWER_AMP */; y: number /* laneY(floor) */ }
interface TransferRun {
  id: string;            // `t:<g>:<side>`
  g: number; side: 'w' | 'e';
  upper: TransferEnd;    // ENTRY: stratum s, floor 4g+3 (its last floor), the hub stair column's RIGHT landing on that floor's lane
  lower: TransferEnd;    // EXIT:  stratum s+1, floor 4g+4 (its first floor), the hub stair column's RIGHT landing on that lane
  deckY: number;         // the gallery catwalk line: galleryTop(g) + CITY.transfer.deckDy (27 = gallery.ts CATWALK_Y)
  upperFlights: number;  // even, >= 2: lane -> deck (airy: 2 flights of 29)
  lowerFlights: number;  // even, >= 2: deck -> lane (airy: 4 flights of 30)
  run: { x0: number; x1: number; y: number };  // the level walk on the catwalk, upper.x -> lower.x (the jog; either direction)
  path: number[];        // flat x,y polyline, entry first, exit last, every corner listed
  length: number;        // path length, world units
}
interface GalleryTransfer { g: number; upper: StratumId; lower: StratumId; y0: number; y1: number /* the band */; deckY: number; runs: [west, east] }

galleryTransfers(currentFloors): GalleryTransfer[]   // city only ([] in classic); gallery g listed once floor 4g+4 is dug
```

Walk semantics (the same zig-zag as the hub columns, `nav/hubStairs.ts`): the walker arrives at the upper column's right landing
(`column + TOWER_AMP`, = where a hub stair hop down ends), takes `upperFlights` flights (first one down to the LEFT, alternating) to the
deck, walks level along the catwalk to `lower.x`, takes `lowerFlights` flights (first one to the left) and stands on the lower column's
right landing on the lower stratum's first lane, where a hub stair hop down starts. With only one storey dug below, `lower` is on that
storey's balcony (the column is not drawn yet; the landing still lies on the balcony deck: west `hubL + 59 <= -5`, east `hubR - 21`).
Path corners are exactly: entry, `upperFlights` flight ends, (the run end if the jog is non-zero), `lowerFlights` flight ends (last = exit).

Cost suggestion for the graph: `length / stairSpeed` (the flights are 38 u runs like hub flights; the level run is a corridor walk).

Drawn by `src/world/render/shell/transfers.ts` from `layout.transfers` (flights, catwalk landings, stair well through the plaza slab);
cut into the rock by `c:xfer:<g>:<side>` cavities, so nothing else (pockets, districts) may meet them (city-layout-test).

## 1. What was built

| Deliverable | Where | What |
|---|---|---|
| 1. Distinct frames | `tokens.ts` `CITY.frames` (table 0.1), `model/cityLayout.ts`, `model/transfers.ts` | Six underground frames: Bell Square widened to a 226-wide plaza (the hatch moved with its stair column, `CITY.entrance.hatchX0/X1` 88..126), the Service Network's narrow 186 pump hall with 96 / 110 long service corridors, the Old Metro's 394-wide station hall, the Mines lopsided east (long west drift, 18 east), the Caves leaning west, the Core compact. East rooms start at 178 / 232 / 256 / 222 / 210 / 230: the city steps in and out at every seam instead of standing as one column. Halls, columns and doors stay vertical inside a stratum (D4). |
| 1. Transfers | `model/transfers.ts`, `CityModel.transfers`, cavities `c:xfer:<g>:<side>:{u,run,l}`, `shell/transfers.ts` | Contract in section 0.2. Drawn as walked: a stair well through the upper plaza (hazard lip), the upper flights to the catwalk, the landing deck and a service pipe bundle across the wider of the two hubs, the lower flights into the lower hub's top storey, stringers, landings and handrails, a cage lamp over each column. `rendering/gallery.ts` (city only) leaves that "landing hall" of the band to the shell (its east span starts at the wider hub's inner east wall, the west one ends at its inner west wall; classic spans unchanged) and keeps its steam vents out of it. |
| 1. Infra jogs | `rendering/infra.ts` `addJog` | Where a stairwell or vent stack (one item over several floors, or items stacked in one slot) runs on past a seam, it jogs through the gallery band: the vent as a duct with an elbow each end and flanges, the stairwell as a caged walkway with a hazard-edged deck. Drawing only; city only; no jog where frames agree or with galleries off. |
| 2. Service Network kit | `shell/service.ts` (new), wired from `districts.ts`, `vestibule.ts`, `pocketInside.ts` | **Old Vault** (floor 5): board-formed crown over a riveted steel lining, banks of safe-deposit boxes (some hanging open), the great round door swung open on its hinge arms with its bolts out and a glint of the treasury shelves inside, a stone floor with dust drifts, a trolley of boxes, a cage lamp whose cone shows dust motes; no dripstone (it is built). **Geothermal** (floor 6): heat-cracked rock lit orange from below, the magma seam under a grated catwalk on posts, two lagged pipes along the roof back toward the bunker on hangers, the wellhead (casing, valve wheel, two gauges, one in the red, a relief vent steaming), a finned heat exchanger by the tunnel, steam vents with plumes along the floor. Glimpsed / digging hints: the vault door's steel edge; steam and an orange seam line. **Service corridors**: a colour-coded pipe gallery (lagged steam, yellow gas, green water main, flanges, stencilled flow arrows toward the rooms), two drops into the floor with valve wheels, a gauge panel (one needle high), a junction box with its green LED, a leaking flange breathing steam. **Pockets**: the pump gallery's two pump sets (motor, flywheel, risers, gauge), the valve vault's manifold wall (two rows of wheels, brass and red, a gauge per row), the crawlway's ribbed duct with a dropped torch. `districtReach` oldVault 78, geothermal 84. All vector, colours in `PROPS.kit.service` / `PROPS.district.vault|geo`; world art unchanged (0 KB). |

## 2. Gates

- `npm run check:full`: green (project-test, city-layout-test, routes-test and the rest).
- `npx tsc --noEmit`: clean. `vite build` into the scratchpad: OK. World art: no new files (`public/art/world` untouched).
- **project-test** now also asserts with the REAL frames: no two neighbouring strata share a frame, every hub side holds wall + stair column + landing on the balcony, vestibules / tunnels ≥ 6 (plus the existing classic / city / skew checks: touching rooms share edges, no overlaps, slotAtX round-trip, doorways on edges, walkBlocked agrees with doors).
- **city-layout-test** over all saves-v6/v7, both slice states, e55@24 and widest caps (1515 areas / rooms / runs): no overlaps with the real frames; per transfer: one per dug seam, west then east, entry = foot of the upper hub's stair column on its last lane, exit = head of the lower column (or on the balcony), right landings, even flight counts, every flight spans 2 × TOWER_AMP, nothing climbs, the corner count, the length, `layout.transfers` equals `galleryTransfers(n)`, the deck inside the band, and the whole walk sampled every 4 u lies inside the cut. e55@24: 5 transfers and every seam jogs. The `c:xfer` cavities join the "cuts into another floor's room" and the pocket checks.
- **Classic unchanged** (C0-handoff method, `tools/compare/run.mjs` on saves-v6 `e30-seed1` + `c-seed1`, 390x844@2x, 17 shots; city is the default now, so the capture forced `&city=0` through a temporary copy of the script, deleted after). Baseline `c692979` captured twice: noise floor base vs base2 **2.65 % mean / 9.7 % max**; base2 vs this branch **2.69 % / 8.4 %** (base vs branch 3.08 % / 11.3 %, the same cam shots that lead the noise). Classic code paths: `gallery.ts` spans and vents and `infra.ts` jogs are behind `CITY`; the classic span formulas are byte-equivalent.
- **Perf** (production builds in the scratchpad, `ct-frames7.mjs`, headless Chrome on the iGPU, e55, Medium, city; HEAD and `c692979` alternated, two runs each). Budget = M1 table + 10 %:

  | e55, Medium | Draw calls (budget) | GPU MB sweep (budget) | GPU MB idle |
  |---|---|---|---|
  | desktop, this branch, runs 1 / 2 | **618 / 616** (≤ 661) | **249 / 281** (≤ 290) | 211 / 210 |
  | desktop, `c692979` same session | 611 / 610 | 265 / 265 | 210 / 210 |
  | phone, this branch, runs 1 / 2 | **556 / 559** (≤ 616) | **279 / 341** (≤ 442) | 207 / 218 |
  | phone, `c692979` same session | 567 / 571 | 408 / 331 | 209 / 209 |

  Within budget: +6 draw calls on desktop (transfer runs, jogs, the service kit), -12 on phone; no new textures. Idle CPU draw medians 15-19 ms desktop on both builds (noisy iGPU).
- Shots (High 1600x900, e55 dug on to 24 floors, the three stratum-2 pockets found): `shots/M2-frames-overview.png` (strata 2-5 stepping in and out), `M2-stratum2.png` (the narrow pump hall, long service corridors, both districts), `M2-oldvault.png`, `M2-geothermal.png`, `M2-transfer.png` (Service Network -> Old Metro: the well, the flights, the jog along the catwalk, the vent-stack jog).

## 3. Decisions and assumptions

- **Hub sides never go under 64** (wall + stair column + landing on the balcony). So "narrow" is the service hall at that minimum, and Bell Square was widened to 226 to read as the grand plaza; the hatch moved east with its stair column (+20).
- **Frames vary hub width AND vestibule length per side** (the only free parameters of an affine frame). The service network's long corridors (96 / 110) carry its pipe gallery; the mines' and caves' lopsided vestibules are their "irregular" silhouette.
- **The transfer lives in the gallery band's hub section**: the classic gallery band (utilities layer, above the shell) would have covered the flights, so in city mode `gallery.ts` stops at the wider hub's inner walls and the shell draws that section (a landing deck, the service pipes, the wells and flights). Outside the hubs the band is unchanged.
- **Path shape**: the upper drop is 2 flights (58 u at airy SLAB), the lower 4 (120 u), both even so a walker enters and leaves on the right landing like every hub column. Flights are scaled sprites (rise 29-30 instead of 36).
- **Infra jogs** also join separate single-floor items stacked in one slot across a seam (the saves only have single-floor items).
- The **crawlway** pocket sits inside gallery band 1, so the classic gallery drawing (utilities, above the shell) still covers its inside when found; unchanged from M1, noted for the tech-artist / M3.
- During the perf run I force-killed every `chrome.exe` once (to stop a mis-set compare run): any other agent's headless Chrome running at that moment was interrupted too.
