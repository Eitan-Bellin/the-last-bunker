# Graphics overhaul — shared brief for the parallel agents

Project: `C:\Users\eitan\Desktop\משחק לשרוד` — "The Last Bunker", TypeScript + Vite + PixiJS v8, side cross-section bunker idle game.
Full plan (read it): https://claude.ai/artifact/7xyn75cA2RLCrdKuuC4Zce (use the Artifact tool, action "read").

## Where things stand
- G0, G1, G2 (era states R/F/L), G5 (painting balance), G6 (painted people) are done. G4 (depth fog) partly, G8 (label policy + steel tags) partly.
- Everything new is behind the switch `gfx2` (`?gfx2` turns it on, `?gfx1` off; stored in localStorage `lastbunker_gfx2`). Old look must keep working.
- Renderer: `src/rendering/BunkerRenderer.ts` (field `readonly gfx2`, `surfaceEra` = era id 0..3, `gloom`), structure kit in `src/rendering/structure.ts`
  (`occupancy`, `buildBays`, `buildCasing`, `buildFrontStructure`, `depthGains(y)`, `kitState(era)` → 'R' | 'F' | 'L', `WorldLamp`),
  world pieces in `src/rendering/world.ts` (`buildSurface`, `buildUnderground`, `buildShaft`, `buildUtilities`, `buildDigSign`),
  rooms `src/rendering/paintedRoom.ts`, people `src/rendering/people.ts`, post FX `src/rendering/postfx.ts`, layout constants `src/rendering/layout.ts`
  (SLOT_W 46, ROOM_H 100, SLAB 16, SHAFT_W 58, ROOMS_X 64, 12 slots/floor, TOPSOIL 70, floorTop(f)).
- Art: `ArtLibrary.get(key)` (`src/art/ArtLibrary.ts`) loads `public/art/<key>.webp` for keys registered in `src/art/registry.ts` (`ART`, `KIT`).
  Kit pipeline: raw images in `art-src/kit/`, jobs in `tools/kit.ts` (modes tile/stripH/stripV/paint/sprite (white bg keyed out)/decal (white bg, multiply)/glow (black bg, add), grid sheets, era recipes), run `/tools/kit.html?auto` (or `&only=<name>`).
  Dev server endpoints: `POST /__art/save/<path>` writes into public/art, `POST /__store/save/<path>` into public/ or store/, `/__art/raw/<path>` reads art-src.
- Art bible (must follow): painterly, muted post-apocalyptic palette, lamp light only from visible sources, no flat-filled surface larger than 8×8 world units,
  no perfect straight line longer than 200 units without a break, one scale (room 100 units = 3.1 m, adult 1.75 m ≈ 56 units), wear decreases with era
  (0 wrecked → 1 patched → 2 lived-in → 3 city), soft edges (contact shadows, overlaps), saturation reserved for alerts/fire/screens.

## Image sources
- Canva MCP `generate-image` with style reference media `MAHW6HZgYnA` — has a long quota cooldown; only the Signage agent generates with Canva.
  To get a file: add a page sized to the image in design `DAHW6BoWU88` (read-design open_transaction → edit-design add_page + insert_fill → commit),
  export-design png for that page, `curl` the URL into `art-src/kit/`.
- Moda MCP (`moda_bootstrap` first, then `load_skill("moda-core")`): create a canvas, a neutral shape, `canvas_edit_image` kind "generate"
  (and "remove_background"), export. Use it for the Surface agent's images.
- Procedural painting in a tools page (canvas 2D) — preferred where it works (decals, signs, simple props), deterministic and free.

## Testing
- Never touch the user's real save (`lastbunker_auto`). Use the test save `?slot=gfx&gfx2` (a developed era-3 bunker).
  To see other eras, copy the slot into a new slot of your own (IndexedDB `keyval-store` / store `keyval`, key `lastbunker_auto_<slot>`) and set `era` in its state, or call `window.__engine.stateManager.applyDelta({ path: 'era', value: N })` then `window.__renderer.setEra(...)` is called by the app on era change.
- Dev helpers in the page: `__compare(tag)` shoots 6 fixed views into `store/compare/<tag>/`, `__shotAt(x, y, zoomRel, name, tag)`, `__perf()`, `__cam(id)`.
  They pump the renderer by hand, so they work in a background tab (requestAnimationFrame sleeps there, and `img.decode()` never resolves there — use onload).
- Set a phone viewport (430×932) on your tab with the browser tool `resize_window` before shooting so shots compare with `store/compare/before/`.
- Open your own browser tab (`tabs_create`), don't use or close other tabs.
- Type-check: `npx tsc --noEmit -p .` (game) and `npx tsc --noEmit -p tsconfig.tools.json` (tools). Other agents edit other files at the same time:
  if an error is in a file you don't own, wait a minute and retry; never "fix" someone else's file.
- Shell: write patch scripts as .cjs files in the scratchpad (heredocs with backticks break). Re-read a file right before editing it (others may have changed it); keep edits small and local.

## Ownership (do not edit files owned by another agent; BunkerRenderer.ts is shared — only small, clearly marked hook edits)
- Elevator & shaft: new `src/rendering/shaft.ts`; the shaft hook in BunkerRenderer (`rebuildStructure` → shaft).
- Surface & entrance: new `src/rendering/surface2.ts`; `buildSurface` call site in BunkerRenderer (`refreshSurface`).
- Wear & atmosphere: new `src/rendering/decals.ts`, `src/rendering/atmosphere.ts`, new `tools/decals.ts` + `tools/decals.html`; hook in `renderUtilities` (painted branch) and render loop.
- Lighting & depth: `src/rendering/structure.ts`, `src/rendering/postfx.ts`, `src/rendering/paintedRoom.ts` (flicker sharing only).
- Signage & in-world UI: new `src/rendering/signage.ts`; `buildUnderground` stencil/plaque part of `world.ts`, `drawLabel` / district sign / dig sign in BunkerRenderer.
- Registry (`src/art/registry.ts` KIT list) and `tools/kit.ts` jobs: append-only edits, one line per asset, re-read first.

## Report back
Files changed, how it is hooked in, what was verified (shots saved to `store/compare/<your-tag>/`), anything unfinished.
