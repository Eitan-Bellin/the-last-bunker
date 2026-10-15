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
