# M2 — tech-artist notes (branch `world/m2-T`, from `world-redesign` @ c692979, 2026-10-15)

Two deliverables: the far-zoom strata map (city mode) and the idle-draw profile of the M1 open item. Classic (`?city=0`) is unchanged.

## 1. The strata map (`src/world/render/strataMap.ts`, tokens `MAP` in `tokensRender.ts`)

A schematic cross-section "atlas" of the city, shown below `CAMERA.zoom.far` (0.42) instead of the scene. Fog-aware: only what discovery has revealed is drawn.

| Element | How it reads |
|---|---|
| Strata | Bands from `layout.strata`, one ink colour each (`MAP.ink`). Reached: tinted band and a seam line. The next one: dark with a diagonal hatch and a "?" name. Deeper: darkness, no name. |
| Names | One pill per reached band (plus the surface and the "?" of the next one): numeral badge + name, from `data/strata.ts` in the current language. Counter-scaled to `MAP.labelPx`, sticky to the view edge (left in LTR, right in RTL, below the HUD). Hebrew has no letterSpacing; the numeral and the name are separate Text objects (bidi-safe). No new i18n strings. |
| Spine and hubs | The lift shaft as a line down to the deepest storey, dashed into the dig. Each reached stratum's hub is a station node on it. |
| Storeys | Dug storeys as lit strips, rooms as windows in their trade colour (`CATEGORY`, shared with the classic map and roomClarity); ruins outlined. Galleries as dashed orange lines; wing edges as dashed stubs. |
| Districts, pockets | Revealed: their polygon, filled. Glimpsed: a "?" marker. Digging: outline plus a progress ring. Hidden: nothing. |
| Live (12 Hz) | The floor dig as a pulsing front with a progress bar; wing and district digs; construction ticks; crises flashing red; survivors as dots in their rooms (density; idle people on the first hub); the "new discovery" pins (the scene's pins are hidden under the map). |

- **Projection.** Everything comes from the layout and `project.ts` (`buildingRect`, `slotX`, `layout.areas / hubs / strata / cavities`); there are no fixed offsets, so the per-stratum frames of M2 move the map with them.
- **Tap.** Under the map a tap takes the camera there (`BunkerRenderer.onCanvasTap` → `focusAt` → `cam.focusTo`): a place (room strip, district, pocket, "?" marker, pin, the dig) at `MAP.focusPlace*` zoom, a reached band at `MAP.focusBand` (its overview). Below what is known it goes to the dig front. The map container is interactive while it shows, so a tap on a lit window zooms instead of opening the room under it. Checked: a tap at the screen centre at zoom 0.36 glided to (912, 988) at 0.85, LOD back to mid.
- **Crossfade.** CityRenderer used to drop the lightmap, fog, glow and planes as soon as the zoom passed 0.42, so the world flattened before the map had faded in. It now follows the host's `mapCovers` (the map's alpha > 0.985): the scene keeps drawing under the map during the fade. The lab (no map) keeps the zoom rule.
- **"+N" popups** are blocked while the city map covers (`setPopupBlocker`), so they no longer float over the atlas.

### Toggle cost (budget < 8 ms in a single frame)

The map is built ahead of the switch: when the zoom drops below `far x MAP.prewarm` (0.61), `CityHost.buildMap` runs once (2.3–3.5 ms at e55), then `warm()` does one step of first-render work per frame (each static piece, each label, the markers, the dots) into a 1x1 render texture: 0.2–4 ms per step. Without the warm-up the first picture of the map cost about 10–18 ms (tessellation and text textures). If the zoom arrives before the warm-up is done, the map waits those few frames before fading in.

Measured on the production build (desktop 1280x800, e55, Medium; a pinch-like zoom 0.75 → 0.34 → 0.75 over 1.2 s each way, 3 runs):

| | City (M2) | Classic (same build) |
|---|---|---|
| `updateLod` worst frame (build or warm step or cover flip) | **0.8–3.2 ms** | 5–19.5 ms (classic builds its map in the switch frame) |
| Map's first full picture after warm-up | 0.5–1.2 ms | — |
| First world picture when the map uncovers (zoom in) | about +10 ms draw over the next frames | about +10 ms (same) |

The last row is the world coming back (rooms un-culled, lit group, fog and planes on again): it is the same in classic and is not map work. Everything the map toggle itself does stays under 8 ms.

## 2. Idle draw profile (M1 open item: e55 city idle draw about 2x classic)

**Profile** (CDP `Profiler`, unminified production build, e55 desktop Medium, idle overview, 6 s; `m2-prof.mjs`): the city's extra draw time was almost all in one place:

| Draw-side cost, 6 s | Classic | City (before) |
|---|---|---|
| `FilterSystem.push → _calculateFilterArea → getFastGlobalBounds` | 0 | **329 ms** (24 % of draw) |
| rest of `executeInstructions` | 372 ms | 417 ms |
| `_updateRenderGroups` | 637 ms | 581 ms |

The lit group's LightmapFilter had no `filterArea` in the default 'global' UV mode, so every frame Pixi measured the bounds of the whole lit group: every room, walker and shell piece, about 3.5 ms per picture at e55. PostFX pins its own filter area, which is why classic never paid this.

**Fix** (`CityRenderer.update`): the filter area is pinned to the view in both UV modes. In 'global' mode the shader derives screen UV from the output frame, so any frame that covers the view is correct (checked in the shots and the slice). Snapshots still switch to 'area' mode as before.

Other candidates checked and left: the light pass and the fog are already skipped or dirty-flagged where it matters (CityRenderer update is about 0.7 ms per frame at e55); the walkers render group rebuilds every frame in both modes (133 objects, cheap).

**Before / after** (production build, headless Chrome on the UHD 630, Medium, overview zoom, 10 s idle, 3 runs each, interleaved in one session: `m2-ab.mjs`). "Idle draw" is `__perf2` drawMsMed (the `app.render()` wall time); "CPU p10" renders 120 frames back to back with `gl.finish()` after each and takes the 10th percentile of the draw call alone (load-noise-free CPU cost).

| Medium | Idle draw med, classic | City before (c692979) | **City M2** | M2 / classic | CPU p10, classic → before → M2 |
|---|---|---|---|---|---|
| e55 desktop | 5.0 (4.4 on the base build) | 8.4 | **5.7** | **1.14–1.30x** (was 1.7–1.9x) | 3.9–4.6 → 7.8–12.4 → 5.6–8.3 |
| fresh desktop | 2.5 (2.6) | 3.4 | **2.7** | 1.04–1.08x | 1.0–1.3 → 2.0–2.5 → 1.6–2.3 |
| e55 phone (375x812@2) | 5.2 (5.2) | 8.1 | **6.0** | 1.15x | 5.3–6.3 → 9.7–11.3 → 5.8–11.4 |
| fresh phone | 2.6 (2.4) | 3.1 | **2.8** | 1.08–1.17x | 1.4–2.5 → 2.6–4.1 → 2.0–2.4 |

Draw calls are unchanged (e55 desktop: classic 626–629, city 608–614; e55 phone: classic 641–642, city 567–572; fresh 207–208 both). **Target ≤ 1.3x classic idle draw at Medium: met** in all four scenarios. The fresh-desktop CPU p10 is still 1.6x, but at 1.6 ms against 1.0 ms.

## 3. Gates

- `npm run check:full`: green.
- `npx tsc --noEmit`: clean.
- `vite build`: passes; the map is in the lazy `cityHost` chunk.
- Classic compare (a scratch copy of `tools/compare/run.mjs` that pins `lastbunker_city = '0'`, since city is the default here), saves-v6 e30 and c, 390x844@2x, 17 shots: base vs head 2.55 % mean / 9.28 % max; base vs base2 (noise floor) 2.29 % / 7.87 %. Same top shots in both (walkers in motion): classic unchanged.

## 4. Shots

- `shots/M2-map-fresh.png`: fresh game, desktop 1280x800, English, zoom 0.34. The surface and Upper Shelter named; the next stratum hatched with "?"; the two glimpsed pockets of stratum 1 as "?"; the dig front under B3; two "new" pins.
- `shots/M2-map-e55.png`: e55 (20 floors, 190 people), desktop, Hebrew, zoom 0.32. Labels on the right (RTL); five strata named; districts and pockets as shapes or "?"; survivor dots.
- `shots/M2-map-phone.png`: e55, 375x812@2, English, zoom 0.32 (the UI hidden for the shot).

## Files

- New: `src/world/render/strataMap.ts`.
- `src/world/render/cityHost.ts`: `mapKey`, `buildMap`, layout generation counter.
- `src/world/render/CityRenderer.ts`: filter area pinned in both UV modes; `mapCovers` from the host.
- `src/rendering/BunkerRenderer.ts`: city map path in `updateLod` (prewarm, warm-up, fade hold, sticky-label `frame`), tap → camera, popup blocker under the map. The classic map path is the old code, untouched.
- `src/rendering/cityMap.ts`: `CityMap` gets optional `frame`, `focusAt`, `warm`, `destroy`; `MapView`, `MapFocus` types. `buildCityMap` (classic) unchanged.
- `src/world/tokensRender.ts`: `MAP` block.

## Open items

- The world's first picture when the map uncovers costs about +10 ms (classic too). Spreading the room un-cull over a few frames would smooth it.
- The postfx gamma lift (player brightness) greys the map's paper; a map-only grade would need the map outside worldContainer's filter.
- Pocket "?" markers are many at e55 (two or three per reached stratum). If they read as noise, show only the ones in the strata nearest the camera.
