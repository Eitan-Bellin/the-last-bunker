# Stage C review (round 1)

Reviewer verdict: **BLOCK**. One blocker; fixing it makes this APPROVE WITH FIXES.

## What holds
- `tsc` and `check:full` pass. The migrations v6→v8 and v7→v8 pass on all 12 saves. project-test, city-layout, routes, rooms, openings, daily and foreman all pass.
- Production bundle: `cityScenario` is not in it.
- No `console.log` or `debugger` statements.
- Nothing under `src/ui`, `src/styles` or `src/i18n` was touched.
- Game logic is unchanged: `CitySystem` writes only `state.city` and has no tick.
- Classic formulas are identical, and every city path sits behind `CITY` or `PROJECTION`.
- The migration is idempotent and the layout is untouched.
- Filters use resolution `'inherit'`, and render textures are destroyed.

## Findings

| Sev | Where | Issue | Fix |
|---|---|---|---|
| BLOCKER | `src/dev/cityScenario.ts:103` | The guard only checks that the slot is non-empty. `SaveManager.slotSuffix()` falls back to the main key when the slot fails `/^[a-z0-9_-]{1,20}$/i`, so the scenario could overwrite `lastbunker_auto`. | Use the same validation (export `hasSlot()`). |
| MAJOR | `src/world/render/shell/*` | About 35 hard-coded colours and sizes. | Move them to tokens. |
| MINOR | `walkers.ts` 631/639/652, `people.ts` 942 | Literal rim colours and offset. | Move to `LIFE` tokens. |
| MINOR | `postfx.ts:18` | `CITY_NIGHT_GRADE` is outside the tokens. | Move to `tokensRender`. |
| MINOR | `BunkerRenderer.ts:1820` | `destroy()` doesn't tear down the city host or the light sink. | Tear both down. |
| MINOR | `BunkerRenderer.ts:14` | City code is in the main chunk. | Load it dynamically when `CITY`. |
| MINOR | `AudioEngine.ts` 709/719 | City beds are never released (up to about 33 MB). | Release when idle, or render mono. |
| MINOR | `routes.ts` 135/142 | `stairColumnX` uses the frame of `lo`. | Assert the same stratum. |
| MINOR | `fog.ts:297`, `layers.ts` | Small allocations on every redraw. | Hoist them. |
| MINOR | `walkers.ts` 906/975 | Dead parameter; `Map` allocation; the cap can be exceeded. | Clean up. |
| MINOR | `perfFx.ts:14` | A `const` sits between imports. | Move it. |
| MINOR | `routes-test.ts` 173/188/221 | `slotX(0,` literals without a reason comment. | Add the comments. |

Note: `?city` also works in production builds. This is intended until M1.

## Round 1 fixes (fixer, 2026-10-15)

| Sev | Finding | Fix | Commit |
|---|---|---|---|
| BLOCKER | `cityScenario` slot guard | `SaveManager` exports `hasValidSlot()`, the same dev-build and `/^[a-z0-9_-]{1,20}$/i` test the save keys use. The scenario refuses without it. | `5c82d90` |
| MAJOR | ~35 literals in `shell/*` | About 45 values moved, with the same values, so the same pixels: a new `PROPS` block in `tokens.ts`; `CITY.hub.vaultPitch`, `vaultTileW`, `deckH` and `railH`; `CITY.layout.cavernSlabPad` and `edgeFloorDepth`; `ROCK_RENDER` in `tokensRender.ts`. No hex colour other than black or white is left in `shell/*`. | `ae76e84` |
| MINOR | Rim colours and offset in `walkers` / `people` | The rim uses `LIGHT.presets.headlamp` and `lantern` colours, the offset is `LIFE.selfLight.dy`, and the carried prop uses `LIFE.lantern.prop`. | `8fe9e63` |
| MINOR | `CITY_NIGHT_GRADE` in `postfx` | Moved to `tokensRender.ts`. | `ea0ef3b` |
| MINOR | `destroy()` leaves the city behind | `destroy()` clears the light sink and destroys the `CityHost` before the app. | `378009f` |
| MINOR | City code in the main chunk | `CityHost` and `installCityWorld` are dynamic imports in `mountCity`, awaited in `init`. They build as two chunks of about 17 KB gzip each. | `378009f` |
| MINOR | City beds never released | A bed or crowd loop that stays silent for `AUDIO.bedReleaseAfter` (30 s) is stopped and dropped, and rendered again when wanted. | `e14012d` |
| MINOR | `stairColumnX` uses `lo`'s frame | Returns NaN when `lo` and `hi` do not share a frame. That never happens in classic. | `2bffb5f` |
| MINOR | Allocations per redraw in `fog` / `layers` | The clear colour and the bake list are hoisted. | `dc3a150` |
| MINOR | `walkers`: dead parameter, `Map`, cap | `retarget` loses its `state` parameter. The view `Map` is reused. A redirect that would exceed `MAX_WALKERS` lets the old placement apply. | `03656fc` |
| MINOR | `perfFx`: `const` between imports | Imports come first. | `ea0ef3b` |
| MINOR | `routes-test` `slotX(0,` literals | Each has a `// floor-0:` reason, and lint has no floor-0 warnings left. | `2bffb5f` |

**Also in this round**
- **Idle people** (`70861c7`):
  - No idle spot within `LIFE.idle.edgeClear` (24 u) of an edge tunnel. The slice's loiterer used to stand at the west tunnel mouth.
  - Corridor weight 2 → 1.
- **slice-dig** (`70861c7`, test `4bd2f76`):
  - The dig now starts at 10 %, so the crew works at the face from about 53 % on.
  - Before, the dig ended a few seconds after the crew arrived.
- **Draw calls** (`a47ecd3`, `43b6744`):
  - The shell's large Graphics now batch, and the shell holders are their own render groups.
  - Fresh game at Medium: −7 draw calls against classic on desktop and −11 on phone; it was +16 / +12. The table is in `C-render-notes.md`, "Round 1 fixes".

**Gates**
- `npm run check:full`: green.
- `npx tsc --noEmit`: clean.
- `vite build` to the scratchpad: passes, and `cityScenario` is not in the bundle.
- Lint: no floor-0 warnings.
- Classic compare: 1.45 % mean / 4.04 % max, against a noise floor of 1.84 % / 4.52 %.
