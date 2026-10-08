# Plan 4, wave 3: bundle size and draw calls (Perf agent)

Measured in the agent container (shared 4 CPUs, Chromium 1194 with SwiftShader, `CI=1`), phone profile 360x740 at DPR 2.75, Medium.
KB below are gzip KB of 1024 bytes, as `tools/perf` reports them. **Read the caveat in section 4 before using the scenario numbers.**

## 1. Bundle (`npm run build`, `node tools/perf/run.mjs --only none --chunks`)

| chunk | before (start of wave 3) | after | loaded |
|---|---|---|---|
| `index` (game code, data) | 460.8 | 398.9 | first load |
| `pixi` | 175.8 | 156.4 | first load |
| `rolldown-runtime` | 0.4 | 0.4 | first load |
| `he` (Hebrew strings) | in index | 24.3 | first load if Hebrew, else when idle |
| `en` (English strings) | in index | 22.1 | first load if English, else when idle |
| `book` (Bunker Book text) | in index | 9.3 | first open of the Book, or idle |
| `synth` (sound recipes: effects, music themes, era beds) | in index | 6.7 | first touch (audio start), or idle |
| `perf` (`?debug` probe) | 3.3 | 3.3 | only with `?debug` |
| `saveWorker` | 1.5 | 1.5 | save worker |
| renderer stubs (2 x 0.1) | n/a | 0.2 | never |
| **all JS (`global.jsGzKB`)** | **642** | **623** (-19) | |
| **first load (`global.initialJsGzKB`)** | **637** | **556** (with the player's language) | |

First load: 556 KB including the player's one language (24 or 22 KB); before: 637 KB. So **-81 KB (-13%) on the
critical path**, -19 KB in total. The pre-plan-4 figure of 521 KB was a total; the wave-3 build is 102 KB above it in total and 35 KB above it on the first
load. The 520 target is not reachable without removing features: plan 4 added about 120 KB of rooms, art and layout code. See section 6 for what is left.

### What was done

1. **Pixi WebGL only** (`vite.config.ts`, plugin `pixi-webgl-only`, production builds only). Pixi's `autoDetectRenderer` loads the WebGL, WebGPU and Canvas renderers through three dynamic
   imports, and because all of pixi is forced into one chunk, the two unused renderers were shipped (66 KB minified). They now resolve to a stub that throws when chosen. The game
   already needed WebGL (GLSL filters; `postfx.ts`: WebGPU "not used today"), and a device without WebGL gets the same "could not start" screen. -20 KB.
2. **String tables as chunks** (`src/i18n/locales.ts`, `I18nManager.provide()/storedLocale()/isLoaded()`, `main.ts`). `main.ts` awaits the player's language before `new GameApp()`, and fetches the
   other one when the page is idle (so a missing key still falls back to English, and the language switch, which reloads the page, works offline). The build defines `__LAZY_LOCALES__`; the dev server and
   the Node bundles of `tools/sim` do not, and keep both tables linked in, so `i18n.t` is synchronous there and **the simulation output is unchanged**. If the chosen language cannot be fetched
   (offline, never cached) the game starts in the other one (`loadStoredLocale` picks whichever table exists) instead of showing raw keys. -47 KB from `index`.
3. **Bunker Book** (`HelpPanel`): `data/book` is loaded with `lazyChunk()` on first open (normally already fetched when idle). -9 KB.
4. **Sound recipes** (`audio/synth.ts` re-exports `sfx`, `music`, `beds`; `bedKeys.ts` holds `BedKey`/`ERA_BEDS` so the engine knows them before the fetch). `AudioEngine.start()` still creates the `AudioContext`
   synchronously inside the touch (iOS), requests the chunk in the same call, and queues the first sounds when it has arrived; render jobs wait for it. If it cannot be fetched the game is silent until the next start.
   `ambience.ts` stays eager (the renderer imports `AMBIENCE_FOR` from it; moving that table would have been a merge-conflict hotspot). -7 KB.
5. **`src/utils/lazy.ts`**: `lazyChunk(() => import(..))`, `whenIdle`, `prefetchLazyChunks` (called after `GameApp.start()`: one lazy chunk per idle moment).
6. `src/dev/*` was already only behind dynamic imports (`?debug`/DEV): nothing to do.

Tried and dropped: `build.target` es2022 (-2 KB only, not worth losing older Safari); stubbing Pixi's bitmap text (16 KB min) and accessibility (8 KB min) systems (small, and the second one is a
behaviour change); lazy `story.ts` (19 KB gz) and the UI panels (the engine and `app.ts` use them synchronously, and other agents are editing those files).

## 2. Offline / PWA

- `public/sw.js` cache is now `lastbunker-v4` and, at install, caches every file in `asset-manifest.json`, which the build writes (`assetManifest` plugin in `vite.config.ts`; it lists all scripts and styles,
  leaves out the `?debug` probe and the stubs). So the lazy chunks are cached whatever the player has opened. Best effort: a missing manifest or a failing file never blocks the install. The old v3 cache is deleted on activate.
- Verified in headless Chromium against `dist` served by `tools/perf/lib.mjs`: first visit online; service worker active and controlling; cache holds `en`, `he`, `book`, `synth`, `index`, `pixi`, css;
  network switched off; reload starts the game (English); `lastbunker_lang` set to the other language and reloaded offline: starts in Hebrew, 0 console errors, 0 failed requests.
- The Book opens (36 entries, 4 groups, no errors); audio unlocks with a click, `synth` is fetched, `sfx` renders and `ready=true`.
- The Pages workflow is unchanged (tsc, smoke, lint, build, perf with `continue-on-error`, upload `dist`); `asset-manifest.json` is just one more file in `dist`.

## 3. Draw calls and objects

Exact GL draw calls of one `render()` with parts of the scene hidden in turn (`drawElements`/`drawArrays` counted in the page; f24 fixture, close camera):

| part hidden | calls it costs |
|---|---|
| `fxLayer` (before the fix) | **252** of 563 |
| shaft | 97 |
| underground (rock, strata) | 65 |
| bays | 48 |
| labels | 41 |
| utilities (front 13, galleries 6, infra 4, signage 2, pipes 2, atmosphere 2) | 29 |
| rooms | 19 |

- **fx layer (fixed).** `burstAt` (dust cloud when a ruin is cleared) added its 26 motes alternately plain/additive, and every blend change breaks a batch: one call per mote. Plain ones are now added first,
  additive ones after: 2 calls per cloud. In real play a cloud lives 1-2 s; in this container (about 0.2 pictures/s and dt capped at 0.1 s per picture) the fixture's 14 clouds stay on screen for minutes, which is why
  `fx` looked like 365 objects and ~250 calls in every earlier scenario. It means the "draw calls 30-50% over budget" noted in `baseline-wave0.md` was mostly this artefact plus the walker layer.
- **Walkers.** An empty walker layer costs 0 calls (measured: layer visible vs hidden with nobody walking, 122 vs 122). Active walkers cost about 1.75 calls each (+7 for 4, so ~+20 at the cap of 12): their
  figures use two body atlases plus per-person face textures (and, while the atlas is not loaded, vector `Graphics`, one call each). Turning the layer's `isRenderGroup` off changed nothing
  (121 vs 121 with one walker), so the render group is not the cost, and deferring its creation would save nothing. Left as is; lowering `MAX_WALKERS` would be a visible change.
- **Overlay churn (waves 1-2).** A heap-sampling profile of the f24 scene mapped back to `src/` (40 s window, 9 pictures) shows no wave-1/2 overlay (wing signs, galleries, strata, surface row, floor identity, openings, walkers)
  among the allocators of a steady picture: the top ones are Pixi `Graphics` triangulation (`buildContextBatches`), `frontChunks`/`buildUtilities` rebuilds while chunks stream in, the save compression
  (`lz-string`), and `ResourceSystem.update/computeCaps` (`Object.entries/values` per tick, in the simulation: not touched, the sim must stay identical). `wingSigns.set` runs twice a second with ~50 short strings: negligible.

## 4. Scenario numbers (before -> after, same container, `--only f8-overview-medium,f24-close-medium,f24w-walk-close-medium`, one run each)

| scenario | draw calls (budget) | objects drawn | GPU texture MB | bundle |
|---|---|---|---|---|
| f8-overview-medium | 619 -> **406** (420) | 4,009 -> 3,871 | 175 -> 198 | 642 -> 623 |
| f24-close-medium | 548 -> **324** (440) | 2,838 -> 2,723 | 193 -> 168 | |
| f24w-walk-close-medium (pending) | 611 -> **398** (450) | 2,684 -> 2,795 | 193 -> 150 | |

Draw calls and objects are the only figures here that mean something. The container was shared with several other agents' audits and simulations: the "after" run drew 0-0.1 pictures per second (a picture took 11-31 s),
so `structureChangedPct` (a share over 1-3 pictures: 100%, 60%, 67%), allocation per picture (6.8-12 MB) and milliseconds are meaningless in both runs and were over budget in both
(the baseline already was). GPU MB varies by 15-20% between runs of the same build here. One console error per run in both builds: the GL context is lost under SwiftShader load (`[crashGuard] gl-context-lost`).

## 5. Verification

`npx tsc --noEmit -p .` and `-p tsconfig.tools.json`, `smoke`, `lint` (1279 keys per language), `placement-test`, `infra-test`, `routes-test`, `rooms-test`, `openings-test`, `migrate-test store/sim/saves-v6` (6 saves),
`npm run build`: all green. `node tools/sim/run.mjs --mode casual --days 7 --seeds 1-3`: JSON of the build at the start of wave 3 against the final build, 0 differences outside timings (same code fingerprint `e4a610217fde`).

## 6. Open issues and next steps

- Total JS is 623 KB against the old 520: the limits in `tools/perf/budget.json` are now the wave-3 measurements (`jsGzKB` 625 total, `initialJsGzKB` 560 first load) with the reason in `global._note`; the gate is still +10%.
  Every wave-3 room/art/story addition lands on top: re-measure after the merge. Remaining big items: `data/story.ts` 19 KB gz (chapters mix trigger code and both languages' text), UI panels (~40 KB gz in `ui/components`), `icons.ts` 12 KB, Pixi text-bitmap and accessibility (~7 KB gz, would need stubs).
  The other language's text is inline in `data/*.ts` (title/text per locale), so a real saving needs those tables split per language like the string tables.
- Draw calls still above the plan's targets (150): shaft (97 calls from floor-high tiling bands, rails, galleries; baking its static back into two or three `cacheAsTexture` slices would remove ~80, but a 24-floor shaft at DPR 2.75 exceeds 4096 px of height, so this needs a device check [V]), underground (65), bays (48).
  Small and safe: merge the shaft's per-gallery `Graphics` and halo sprites into one `Graphics` plus one sprite run (~10 calls).
- The service worker cache keeps old hashed files forever (same cache name per version); bumping `CACHE` clears it. A prune of `assets/` entries missing from the new manifest on activate would be tidier.
- [V] on a real iPhone: audio unlock on the first tap with the `synth` chunk (context is created in the gesture, sounds start when the chunk arrives; the chunk is normally fetched earlier, when idle), language switch offline, the Book offline, first-load time on a slow connection (-81 KB gz).
- The Canvas/WebGPU renderers are gone from production builds: a browser without WebGL shows the startup error, as before for Canvas; only a WebGPU-only browser lost a (never tested) fallback.
