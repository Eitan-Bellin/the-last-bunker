# Airy bunker: shared agent brief (2026-10-09)

Goal from the user (Hebrew, paraphrased): "the bunker structure feels dense, unclear, one boring lump; make it more spacious and clear, and more 3D with corridors and stairs." Full plan: `C:\Users\eitan\.claude\plans\modular-napping-cook.md` (sections P0, P0b "מרווח ובהירות", P2b). This brief covers **P0 + P0b only**.

## Ground rules
- Branch `feat/airy-bunker` (already checked out in the main checkout). **Do not push, do not touch `main`, do not delete saves.** Commit only your own files (`git add <your files>`; the other agent edits at the same time). Commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Everything new sits behind the feature flag `airy` (add it to `src/rendering/gfxFeatures.ts`; **Agent A owns that file and adds the flag first, within your first few minutes; Agent B read it from `GFX.airy` once it exists**; default ON, `?gx=-airy` turns it off for before/after pairs). With the flag off the game must look exactly as before.
- Any new Pixi filter needs `resolution: 'inherit'`. Keep the frame cost ~3 ms (use `window.__perf()` if available in dev, see `src/dev/camShots.ts`). Touch-phone budget matters.
- i18n: any new string goes into BOTH `src/i18n/he.json` and `en.json` (`node tools/sim/lint.mjs` checks parity, DAG, storage). Run `npx tsc --noEmit -p tsconfig.json` and `-p tsconfig.tools.json` before committing.
- Code style: match the surrounding comments/naming (many comments are tagged `[plan4:...]`; tag yours `[airy:A1]`, `[airy:B2]`...).
- Use few screenshots, scale 0.5, one tab each. Dev server is already running at http://localhost:5173 (do NOT start another). Use your own save slot: `?slot=airyA` / `?slot=airyB` plus `&debug`.

## Test recipe (a developed 8-floor, 41-room bunker in one call)
1. `navigate` your tab to `http://localhost:5173/?slot=airyA&debug` (fresh slot; a difficulty dialog appears: pick Warden or ignore).
2. In `javascript_tool`:
```js
const lz = await import('/node_modules/.vite/deps/lz-string.js');
const t = await (await fetch('/store/sim/saves-v4/era3-seed1.json')).text();
await window.__engine.importState((lz.compressToBase64 || lz.default.compressToBase64)(t));
window.__forceNight = 0;   // hold daylight for shots
```
(State: `window.__engine.stateManager.state`. v4 save gets migrated; it lands in Act IV with 8 floors.) Use `resize_window` 430x900 for phone framing, and `__cam(id)` / `__compare(tag)` / `__shotAt` from `src/dev/camShots.ts` for fixed views. Background tabs pause requestAnimationFrame: front your tab before shooting. Never use the user's main slot.
3. Before/after: shoot the same camera with `?gx=-airy` (before) and default (after), into `store/compare/airy-<A|B>/`.

## Facts
- Geometry lives in `src/rendering/geom.ts` (SLOT_W 46, ROOM_H 100, SLAB 16, FLOOR_H 116, SHAFT_W 58, galleries every 4 floors). Rooms touch each other; the structure frame (columns, between rooms of *different* kind only) is drawn by `frontChunks.ts` (~lines 640-720) and `structure.ts`; `paintedRoom.ts:~933` draws the frame where two different rooms meet. Adjacent same-kind rooms are merged compounds (tiled painting).
- LOD: far (< 0.42) = `cityMap.ts`; labels via `LabelScale.ts` (full >= 0.7, chip 0.45-0.7, hidden < 0.45); `BunkerRenderer.updateLod` (~line 1401). Floor tints: `floorIdentity.ts` (deliberately near-white); art exposure balancing: `ArtLibrary.balanceFor` (`src/art/ArtLibrary.ts` ~46-59). Category colours already used by the far map: `VOTE`/`CATEGORY` in `cityMap.ts`.
- Camera: `CameraController.ts` (`fitZoom`, `sectorZoom` = 7 slots on phones, MIN_ZOOM 0.35).
- Existing 3D-ish pieces to reuse: stairwells (`infra.ts`, `infraArt.ts` `stairsTexture`), walk routes with stairs legs (`routes.ts`), door openings and corridor stubs (`openings.ts`), room depth inset (`DEPTH_X/TOP/BOTTOM`).
- Existing saves must keep loading and slot coordinates must NOT change (rooms/people positions are saved in slots): geometry changes may only be visual or move the vertical pitch consistently via `geom.ts`.

## Agent A: "air" (geometry + structure), owns `geom.ts`, `gfxFeatures.ts`, `frontChunks.ts`, `structure.ts`, `world.ts`, `decals.ts`, `infra.ts`, `CameraController.ts`
1. Add flag `airy` first (commit immediately so Agent B can import it).
2. **Gaps between rooms** (`ROOM_INSET` ~6-8 units per side): rooms get a concrete pillar / pipe / lamp / dark back wall between them instead of touching, without moving the slot grid (`slotX` unchanged). Decide how merged same-kind compounds behave (a thin pillar every room, or every 2-3 slots, so it reads as clusters not a wall).
3. **Taller, breathing floors**: SLAB 16 -> ~28 (keep every `floorTop`/`floorAtY` consumer consistent: grep every use, `tools/sim/lint.ts:314` forbids reverse `/ FLOOR_H` lookups) plus a visible walkway ledge along each floor's front. Galleries every 2-3 floors instead of 4 (`GALLERY_EVERY`), check `galleryTop` etc.
4. **Clusters not one wall**: 2-3 room blocks separated by a bulkhead/pier with a visible rock window, using the existing stepped casing (`structure.ts buildCasing`).
5. **Camera framing**: default view shows a few floors, not the whole 8-24; adapt `fitZoom`/`sectorZoom` so it does not cram. Keep double-tap framing working.
6. Check PlacementController, share.ts, cityMap.ts, decals, infra, people walk heights still line up (people stand on `WALK_Y`; elevator travel `floorAfterTravel`).

## Agent B: "clarity", owns `LabelScale.ts`, `RoomViews.ts`, `paintedRoom.ts`, `floorIdentity.ts`, `src/art/ArtLibrary.ts`, `shaft.ts`, `signage.ts`, `BunkerRenderer.ts` (only `updateLod` and label/tint plumbing; Agent A does not touch it), `people.ts`
1. **Mid-zoom simplification** (0.45-0.9): desaturate/dim room paintings, hide name tags / stars / glow cones / dust, draw a strong category colour strip + one icon per room (reuse `VOTE`/`CATEGORY` from `cityMap.ts`; export them if needed).
2. **Real zone colour**: raise `floorIdentity.ts` tint strength; make `ArtLibrary.balanceFor` stop erasing category differences; coloured ceiling band per room category.
3. **Shaft as spine**: brighter/wider-looking shaft, readable landing plate with the zone name at every floor (`shaft.ts`, `signage.ts`).
4. **Focus/dim mode**: selected room (and rooms needing attention) stay bright, others dim (`selectedId` exists).
5. **Calm the noise**: cap per-room labels, lower glow on bright tiers, no doubled structure+painting lamps (`store/gfx-audit/rooms.md` quick wins 2 and 5), fewer people-over-art overlaps (name tags only for the selected/close).
6. Coordinate: never edit Agent A's files; if you need a geometry constant ask in your report.

## Deliverable
Commits on the branch, a short report (what changed, flag names, before/after shot paths, perf number, open issues). Do not write a long document.
