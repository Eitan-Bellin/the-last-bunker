# A2: Performance baseline before "The City Below" (world redesign)

QA-PERF, 2026-10-15. Branch `world-redesign` (worktree `C:\Users\eitan\Desktop\last-bunker-world`, HEAD 71e7b1a). No source file was changed.

Machine: Windows 11, 8 logical cores, Intel UHD Graphics (ANGLE D3D11), Chrome 152. All millisecond figures are from this laptop. Use them as
"same machine, before vs after" figures, not as phone predictions. The counts (draw calls, objects, textures, bundle KB) do not depend on the machine
and are the ones to gate on.

## 0. How each number was taken (summary)

| Source | What | Why |
|---|---|---|
| **H: headless Chrome, production build** (main numbers) | `npx vite build --outDir <scratch>/dist-world`, served gzipped by `tools/perf/lib.mjs serve()`, new temp Chrome profile per run (deleted afterwards), `?debug` for `__engine/__renderer/__perf2` | Reproducible. rAF runs at 60 Hz. It cannot touch any real save. Scripts are in Appendix A and B |
| **P: built-in browser pane, dev server** (`preview_start world`, port 5176, `?slot=wperf&debug`) | Same probes run by hand | Requested cross-check. **Caveat:** the pane was *hidden* the whole session, so rAF ran at ~30 Hz (0 Hz before the first screenshot) and the viewport fell back to 1024x768 whenever emulation was cleared. Dev build (unminified, HMR). Treat P as indicative only |
| **G: existing gate** `node tools/perf/run.mjs --dist <scratch>/dist-world` | Its fixture scenarios (f8/f24/f24w, 360x740 @2.75, touch) | It already holds the budgets in `tools/perf/budget.json` |

Scenarios:
* **fresh**: a brand-new game (3 floors, 3 people, 1 room). In H the intro overlays are left up and the sim is unpaused the same way `run.mjs` does it.
* **e55**: `store/sim/saves-v6/e55-seed1.json` (newest save folder; 20 floors, 190 survivors, 46 buildings, era 3). This is the largest sample save.
  It was loaded with `__engine.importState(__engine.saveManager.exportSave(obj))` and then the page was reloaded. **Verified: this works in both dev and prod.**
  (`e30-seed1` = 14 floors/110 people and `e10-seed1` = 8/65 are mid-game alternatives; they were not measured.)
* **desktop**: 1280x800 at DPR 1. **phone**: 375x812 at DPR 2 with touch emulation, the same as the pane's `mobile` preset (canvas 750x1624; the game picks `TOUCH_PROFILE`).
* **Quality**: forced with `__renderer.postfx.setQuality('high'|'medium')` (localStorage `lastbunker_gfx`; in P it was reset to Auto afterwards).
  QUALITY_PROFILE desktop: High = res 3 / 3.4 MP / **MSAA** / 4 bloom passes / grain / fps [60,60,30]; Medium = res 2 / 1.8 MP / no MSAA / 2 passes / fps [60,30,15].
  TOUCH_PROFILE (phone): High = res 2.25, no MSAA, 3 passes, fps [45,30,10]; Medium = res 2, no MSAA, 2 passes, fps [30,20,5].

## 1. Bundle (production build)

`npx vite build --outDir C:/Users/eitan/AppData/Local/Temp/claude/.../scratchpad/dist-world` (build 3.0 s, 987 modules). The gzip figures use `zlib.gzipSync` default level, the same as `run.mjs bundleStats()`.

| Part | Files | Raw | Gzip |
|---|---|---|---|
| JS, all chunks (`assets/*.js`) | 14 | 2,225 KB | **705 KB** (budget `jsGzKB` 625: **+13% over**) |
| JS, first load (index + pixi + ArtLibrary + runtime) | 4 | ~2,010 KB | **617 KB** (budget `initialJsGzKB` 560: **+10% over**) |
| of which `index-*.js` (game) | 1 | 1,313 KB | 428 KB (Vite warns: chunk > 1,200 KB) |
| of which `pixi-*.js` | 1 | 557 KB | 161 KB |
| of which `ArtLibrary-*.js` | 1 | 137 KB | 47 KB |
| lazy: he / en strings, book, synth, perf, share, tour | 7 | 263 KB | 86 KB |
| CSS | 3 | 123 KB | 25 KB |
| Art `art/**/*.webp` | 182 | **8,157 KB** | (already compressed) |
| Art json (meta, balance) | 4 | 163 KB | 38 KB |
| Splash png | 11 | 834 KB | |
| Icons and other root files | ~11 | 1,063 KB | |
| **Whole dist** | | **12.27 MB** | |

Art by folder: rooms 2,291 KB, people 1,983 KB (man/elder/woman/child sheets are 320 to 460 KB each, the largest files), kit 1,772 KB, ruins 512 KB,
backdrops 463 KB, biomes 270 KB, districts 252 KB, halls 207 KB, story 199 KB, portraits 143 KB, ui 63 KB.
A cold first visit transfers about **905 KB** in 20 requests before the first world frame (about 680 KB JS + about 140 KB art). The other art loads lazily.

## 2. Load time (H, production build, median of 3 runs, range in brackets)

Marks: `fcp` = first-contentful-paint (this is the splash). **`fwf` = first rendered world frame**, i.e. the first `GameApp.frame()`, which adds `.gone` to
`#splash`; a MutationObserver installed at document start records `performance.now()`. **`tti`** = the end of the last long task (>50 ms) before the first quiet window of 2 s
after fwf (Lighthouse-style, from a buffered `longtask` PerformanceObserver). "cold" = first visit (empty cache, no service worker). "warm" = second visit (HTTP cache and SW warm).

| Scenario | DCL ms | FCP ms | **First world frame ms** | **TTI ms** | Long tasks before TTI (count / total ms / longest) | JS heap at TTI |
|---|---|---|---|---|---|---|
| desktop High, fresh, cold (n=6*) | 1,300 to 2,300 | 1,376 | **5,900** (4,005 to 7,820) | **9,978** (7,506 to 13,639) | 13 / 6,112 / 1,781 | 67 MB |
| desktop High, fresh, warm | 1,080 | 1,112 | **2,361** (2,031 to 5,233) | 7,758 | 13 / 3,184 / 849 | 115 MB |
| desktop High, **e55**, warm | 1,933 | 1,908 | **3,827** (3,050 to 5,621) | 7,942 | 16 / 4,475 / 1,309 | 270 MB |
| desktop Medium, fresh, cold | 2,076 | 2,136 | **6,017** (5,220 to 6,111) | 9,543 | 13 / 4,320 / 1,516 | 73 MB |
| desktop Medium, fresh, warm | 920 | 784 | **2,536** | 6,129 | 11 / 2,342 / 535 | 112 MB |
| desktop Medium, **e55**, warm | 1,609 | 1,640 | **3,425** (2,439 to 5,381) | 7,017 | 12 / 3,972 / 1,290 | 311 MB |
| phone Medium, fresh, cold | 1,983 | 1,724 | **6,945** (6,543 to 7,079) | 10,826 | 11 / 4,942 / 1,519 | 66 MB |
| phone Medium, fresh, warm | 757 | 780 | **2,362** | 4,913 | 11 / 2,191 / 644 | 90 MB |
| phone Medium, **e55**, warm | 752 | 740 | **2,741** | 6,769 | 12 / 4,315 / 1,435 | 316 MB |
| phone Medium, CPU x4, fresh, cold | 3,725 | 2,364 | **10,743** (9,887 to 13,722) | **20,443** | 20 / 16,819 / **4,804** | 65 MB |
| phone Medium, CPU x4, fresh, warm | 1,448 | 848 | **9,032** (6,470 to 18,522) | 17,882 | 18 / 15,288 / 4,772 | 103 MB |
| phone Medium, CPU x4, **e55**, warm | 3,217 | 3,160 | **27,287** (21,243 to 37,874) | **44,960** | 13 / 39,312 / **20,491** | 283 MB |

\* The "e55 cold" runs are also fresh cold loads, because the save is imported after the first visit. They match the fresh-cold rows, so cold numbers are effectively n=6.

Notes:
* The e55 warm load includes the **time-away catch-up**. The save's timestamp is February 2026, so the game simulates the (capped) absence before the first frame.
  At CPU x4 this becomes a single **20 s long task**. It is a real cost for a player coming back after a long break, but it is not a pure "load" cost. A regression gate should use the fresh rows.
* Variance is large: one cold desktop-medium run took 31.9 s to the first frame (outlier, dropped by the median). Gate on the median of at least 3 runs, with about 25% tolerance.
* P (dev server, pane, e55, 1024x768): DCL 960 ms, load 989 ms, 250 requests (unbundled modules). The splash was removed by about 3.4 s, so the first world frame was 2.7 s or less. The dev server is not representative; use H.

## 3. Frame time (H, production build, 10 s windows)

Definitions (from `__perf2()`, `src/dev/perf.ts`):
* **fps / target**: pictures per wall second actually drawn, against the governor's target (`GameEngine.pictureInterval`).
* **CPU frame** med/p95: `BunkerRenderer.render()` = scene update + Pixi submit (the GPU runs asynchronously, but the submit blocks when the GPU is behind).
* **busy %**: picture time plus sim tick time per wall second (a heat proxy). **tick**: average ms per simulation tick.
* **Raw render cost**: 60 back-to-back `__renderer.render(state)` followed by `gl.finish()`, timed one by one. This is the *ungoverned* cost of one full picture with the GPU flushed. "Pixi only" is `app.renderer.render(stage) + gl.finish()`.
* **Idle**: camera at the overview (`devCamera(BUILDING_W/2, floorTop(1), 1)`), last interaction set 2 min in the past (governor idle rate).
  **Sweep**: every 16 ms, `devCamera(x,y,z)` along x = 616·(0.5+0.45·sin 4πu), y from floorTop(0) to floorTop(floors-1) and back, zoom 0.7 to 2.3 (3 cycles), plus `notifyInteraction()` and `noteCameraMotion()` (governor motion rate, target 60).

### 3a. Desktop 1280x800, DPR 1 (render resolution 1)

| Save / quality | Idle fps (target) | Idle CPU frame med / p95 ms | Idle busy % | Sweep fps (target 60) | Sweep CPU frame med / p95 ms | **Raw full frame avg / med / p95 ms** | Raw Pixi-only med ms | Sim tick ms |
|---|---|---|---|---|---|---|---|---|
| fresh High | **16.1 (30)** | 9.3 / 63.2 | 44.9 | **10.6** | 60.0 / 168.0 | **57.1 / 56.8 / 76.0** | 53.0 | 0.55 |
| fresh Medium | 15.0 (15) | 5.5 / 8.0 | 9.1 | 37.7 | 5.0 / 47.5 | 8.7 / 4.8 / 30.7 | 20.5 | 0.65 |
| e55 High | **13.2 (30)** | 23.7 / 34.7 | 40.7 | 28.3 | 9.2 / 35.6 | **48.5 / 59.7 / 78.3** | 80.2 | **7.6** |
| e55 Medium | 15.0 (15) | 16.6 / 24.3 | 30.7 | 44.5 | 7.2 / 20.5 | 20.9 / 13.2 / 64.9 | 22.3 | 5.6 |

### 3b. Phone-like 375x812, DPR 2, touch (render resolution 2, canvas 750x1624)

| Save / quality | Idle fps (target) | Idle CPU frame med / p95 ms | Idle busy % | Sweep fps (target 60) | Sweep CPU frame med / p95 ms | **Raw full frame avg / med / p95 ms** | Raw Pixi-only med ms | Sim tick ms |
|---|---|---|---|---|---|---|---|---|
| fresh High | 9.9 (10) | 6.0 / 13.6 | 7.4 | 36.3 | 12.7 / 55.6 | 7.8 / 4.1 / 30.1 | 19.3 | 0.68 |
| fresh Medium | 5.0 (5) | 3.8 / 5.5 | **2.3** | 35.3 | 7.8 / 51.4 | 6.6 / 3.3 / 27.4 | 17.1 | 0.42 |
| e55 High | 9.8 (10) | 16.1 / 36.2 | 24.5 | 41.9 | 8.0 / 30.8 | 20.8 / 22.7 / 28.6 | 23.9 | 6.7 |
| e55 Medium | 5.0 (5) | 12.0 / 16.3 | **10.7** | 41.4 | 7.6 / 35.4 | 15.9 / 13.0 / 26.2 | 22.5 | 4.6 |

### 3c. First pan over the whole bunker (art loads lazily, textures upload)

| | fps | CPU frame p95 ms | Long tasks (count / total ms / max ms) |
|---|---|---|---|
| fresh desktop (High) | 15.2 | 172.8 | 29 / 4,630 / 235 |
| e55 desktop (High) | 24.0 | 43.3 | 14 / 1,511 / 341 |
| fresh phone (Medium) | 41.4 | 35.6 | 7 / 481 / 108 |
| e55 phone (Medium) | 30.1 | 68.1 | 23 / 1,990 / 244 |

In P (dev server), the first deep pans produced single long tasks of **5.2 to 8.7 s** (desktop High, phone High and Medium). That is the dev server transforming and decoding art on first use. The production build (H) did not show it (max 341 ms), so it is a dev-only effect, but remember it when timing on the dev server.

Readings:
* **Desktop High is GPU-bound on this iGPU**: with MSAA, 4 bloom passes and grain at 1280x800, a flushed frame costs about 57 to 60 ms (about 17 fps).
  The governor wants 30 fps when idle and 60 fps in motion, and it gets 13 to 16 fps idle and 11 to 28 fps while panning. Medium costs 5 to 13 ms per flushed frame.
  On phone High (no MSAA, 3 passes) the cost is close to Medium, so **MSAA is the main High-quality cost**.
* The **governor works**: idle Medium holds exactly 15 fps (desktop) or 5 fps (phone), with 2 to 11% busy.
* The **late game costs CPU, not only GPU**: sim ticks are 5 to 7.6 ms (0.4 to 0.7 ms fresh), and the scene update is 3 to 7.5 ms per picture (1 to 1.6 ms fresh).
  Both grow with people and floors and come before any new world content.
* P (pane, dev, rAF capped at about 30 Hz by the hidden pane) agreed on direction: e55 desktop 1024x768 High raw 67 ms vs Medium 17 ms; fresh High 44 ms vs Medium 11 ms (5.1 ms median).

## 4. Memory, textures, scene tree

| Scenario | JS heap (MB) | GPU textures (MB est. / count) | Art library (ArtLibrary.textures) | Stage nodes total | Visible | **Drawn renderables** | Draw calls / picture | Render groups | Filters active | Masks | Overdraw (screen-areas) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fresh desktop High | 48 to 74 | 158 / 448 | | 2,339 | 1,909 | 1,639 | 207 | 46 | 1 (CompositeFilter) | 8 | 13.9 |
| fresh desktop Medium | 46 to 51 | 169 / 369 | | 2,318 | 1,671 | 1,402 | 203 | 46 | 1 | 8 | 13.9 |
| e55 desktop High | 351 to 377 | 217 / 837 | | 12,108 | 5,669 | 4,582 | 505 | 60 | 5 (Composite + 4 Displacement = heat haze) | 9 | 15.3 |
| e55 desktop Medium | 373 to 393 | 227 / 669 | | 12,129 | 5,611 | 4,528 | 491 | 60 | 1 | 9 | 15.2 |
| fresh phone High | 70 to 79 | **383** / 424 | | 2,336 | 1,863 | 1,611 | 194 | 46 | 1 | 8 | 12.3 |
| fresh phone Medium | 66 to 73 | **383** / 424 | | 2,327 | 1,622 | 1,373 | 191 | 46 | 1 | 8 | 12.3 |
| e55 phone High | 390 to 427 | **429** / 859 | | 12,333 | 5,541 | 4,540 | 501 | 57 | 6 (Composite + 5 Displacement) | 9 | 15.6 |
| e55 phone Medium | 436 to 458 | **429** / 873 | (P: 101 textures, 18.2 MPx, about 69 MB RGBA) | 12,317 | 5,478 | 4,484 | 486 | 57 | 1 | 9 | 15.6 |

Object types (P, dev build, readable class names), e55 desktop Medium: **Sprite 6,560, Container 2,594, Graphics 2,084, TilingSprite 575, Text 334**, MeshSimple 21,
NineSliceSprite 1 (12,169 nodes). Fresh: Sprite 1,564, Container 327, Graphics 228, TilingSprite 179, Text 20, MeshSimple 3.
Overdraw by layer (P, e55 phone, overview): underground 6.6, frontRow 2.7, room 2.7, surface 1.8, world 1.0, sites 0.4, atmosphere 0.3.
Render resolution: desktop 1.0 (DPR 1), phone 2.0 at both qualities (Medium's res cap 2 = DPR; High touch cap 2.25 > DPR).

Readings:
* **JS heap of the late save is 5 to 6 times a fresh game** (about 300 to 460 MB vs 50 to 80 MB) and keeps rising during a session (377 to 458 MB over the run).
  This is the largest memory risk for phones and should be investigated before the redesign adds content.
* **GPU texture memory on the phone is 383 to 429 MB** (estimated from `renderer.texture.managedTextures`; render targets at DPR 2 plus art). The gate budget is 280 MB and the plan target is 120 MB.
  Desktop is 158 to 282 MB.
* A fresh game already draws about 1,400 to 1,600 objects in about 200 draw calls. The late game draws about 4,500 objects in about 500 calls (the plan targets are 1,500 and 150).

## 5. Existing gate (G): `node tools/perf/run.mjs --dist <scratch>/dist-world` (360x740 @2.75, touch, fixture bunkers)

| Scenario | Calls (limit) | Objects drawn (limit) | Rebuild % (limit 5) | Alloc KB/frame (limit) | Texture MB (limit) | fps | Frame med/p95 ms | Busy % |
|---|---|---|---|---|---|---|---|---|
| f8-overview-medium | 363 (420) | 3,688 (3,800) | 0 | 295 (520) | 234 (260) | 28.8 | 8.1 / 15 | 28.1 |
| f24-overview-medium | 512 (730) | 4,972 (7,100) | 0 | 501 (600) | 208 (280) | 22 | 22.8 / 56.1 | 67.6 |
| f24-close-medium | 362 (440) | 2,968 (4,400) | 0.1 | 342 (430) | 197 (280) | 24.2 | 10.2 / 42.5 | 47.2 |
| f24-far-medium | **747 (220)** | **7,130 (800)** | 0.2 | 579 (2,000) | 257 (290) | 19.8 | 39.6 / 59.1 | 82.5 |
| f24-close-low | 351 (420) | 2,585 (4,000) | 0.2 | 357 (430) | 194 (280) | 19.3 | 7.6 / 21.3 | 26.2 |
| f24-close-high | 358 (450) | 2,947 (4,450) | **6.7** | **3,708 (430)** | **287 (280)** | **1** | 12.5 / 47 | 5.8 |
| f24-idle-medium | 509 (720) | 4,983 (7,100) | 0 | 1,121 (1,300) | 207 (280) | 5.1 | 10.2 / 14.5 | 9.1 |
| f24w-overview-medium (pending) | 548 | 4,657 | 0 | 403 | 206 | 29.7 | 9.7 / 18.7 | 38.4 |
| f24w-close-medium (pending) | 413 | 2,881 | 0.3 | 333 | 199 | 30.2 | 5.7 / 9.2 | 23.8 |
| f24w-walk-close-medium (pending) | 412 | 2,879 | 0.4 | 352 | 182 | 27.4 | 7.7 / 22.1 | 35.3 |
| f24w-far-medium (pending) | 948 | 9,437 | 0 | 787 | 226 | 12.7 | 61.3 / 91.7 | 86.6 |

Every scenario reported `errors 1`; the runner does not print the text. The `audio-start` scenario did not finish within about 25 minutes (its loop runs PowerShell `procMem`
every 500 ms), so the runner was stopped and `offline-24h` was not reached. The gate was **not green before the redesign**: f24-far-medium goes over its limits by a wide margin,
f24-close-high goes over on rebuild %, alloc and texture MB (and ran at 1 fps), and the bundle goes over both JS budgets (section 1). Note it so these are not blamed on the redesign.

## 6. Console errors and warnings

| Where | Message | Count |
|---|---|---|
| P (dev) | `PixiJS Warning: [BindGroup] a 'textureSource' was destroyed while still bound to a shader` (and the same for `'textureSampler'`) | 3 pairs (after the save import and the reloads) |
| P (dev) and H (e55 phone) | `[crashGuard] error: ResizeObserver loop completed with undelivered notifications.` | 1 each |
| P (dev) | In-game notice "The game closed in the middle of saving..." after a reload during an autosave. This was caused by the test (test slot only) | 1 |
| H fresh desktop, e55 desktop, fresh phone | none | 0 |
| Vite dev server log | no errors | 0 |

## 7. Regression gate proposal (what to re-run after each world-redesign wave)

1. `npx vite build --outDir <scratch>/dist-world`, then `node bundle.mjs <dist>` (Appendix C). Gate: initial JS gzip 617 KB +5%, art total 8.2 MB, and report each new art folder.
2. `node frames.mjs <dist> <repo> out.json` (Appendix B, about 6 min). Gate on the **counts**: e55 drawn renderables 4,500 to 4,750 and draw calls 490 to 505 (+10%), stage nodes about 12.1k (+10%),
   GPU texture MB (desktop 230, phone 430, +5%), fresh drawn 1,400 to 1,650, filters active (Medium 1, High 1 + one per heat-haze room in view).
   Report but do not gate: idle busy % (Medium: desktop fresh 9 / e55 31, phone fresh 2.3 / e55 10.7), raw full frame median ms, sim tick ms (e55 4.6 to 7.6).
3. `node load.mjs <dist> <repo> 3` (Appendix A, about 12 min). Report the median **first world frame** and **TTI** of the fresh rows (desktop Medium warm 2.5 s / 6.1 s, phone Medium warm 2.4 s / 4.9 s,
   phone CPU x4 cold 10.7 s / 20.4 s). Flag anything more than 25% worse.
4. Optional: `node tools/perf/run.mjs --dist <dist>` for the fixture scenarios, using section 5 as the before values (stop it at `audio-start` if it hangs).

Pane cross-check (P), if needed: `preview_start world`, navigate `http://localhost:5176/?slot=wperf&debug`, **make the pane visible** (rAF stops when it is hidden),
`resize_window` 1280x800 or `mobile`, load the save as described in section 0, reload, then paste the `__A2` helper from Appendix B (`PAGE` string; on the dev server
`await import('/src/rendering/layout.ts')` supplies `BUILDING_W` / `floorTop`). Because `javascript_tool` times out after 45 s, start `__A2.run()`
in the background and poll `window.__A2out`.

## 8. Housekeeping and safety

* The player's save was never touched. H used throwaway Chrome profiles (prod builds ignore `?slot`, so in H the save sits in that temp profile's `lastbunker_auto`, which is deleted).
  P used only `?slot=wperf` (IndexedDB key `lastbunker_auto_wperf`), which now holds the imported e55 save.
* `preview_start world` first opened `http://localhost:5176/` **without** `?slot` for about a second before the redirect to the slot URL. That origin (dev port 5176) is not where the player plays,
  but a new-game autosave there cannot be ruled out. Recommendation: give the `world` launch config a `url` with `?slot=`.
* `lastbunker_gfx` on localhost:5176 was set back to Auto. The pane viewport was reset to desktop. The dev server was stopped. The perf runner and its headless Chrome were stopped.
* Screenshots (the pane saves JPEG, so `.jpg`): `store/world-redesign/shots/baseline-fresh-desktop.jpg` (new game, first floors and the gate-house),
  `baseline-late-desktop.jpg` (e55 at overview, 1024x768), `baseline-late-mobile.jpg` (e55 at 375x812 with the tip card and notices).

## Appendix A: load.mjs (load time; save it anywhere outside the repo and run `node load.mjs <dist> <repoRoot> 3`)

```js
// Load-time baseline (world-redesign A2). Headless Chrome, brand-new temp profile per run (never the player's save),
// production build served gzipped by tools/perf/lib.mjs serve().
//   node load.mjs <dist> <repoRoot> [runs=3]
// First world frame = the first GameApp.frame(), which adds class "gone" to #splash (a MutationObserver installed at document start marks it).
// TTI = the end of the last long task (>50 ms) before the first 2 s window with no long task, after the first world frame (Lighthouse-style).
import fs from 'node:fs';
import path from 'node:path';
const [dist, repo, runsArg] = process.argv.slice(2);
const { launch, serve, sleep, waitFor } = await import('file:///' + path.join(repo, 'tools/perf/lib.mjs').split(path.sep).join('/'));
const runs = +(runsArg || 3);

const INIT = q => `
try{${q ? `localStorage.setItem('lastbunker_gfx','${q}');` : ''}localStorage.setItem('lastbunker_lang','en');}catch(e){}
window.__lt=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([e.startTime,e.duration])}).observe({type:'longtask',buffered:true})}catch(e){}
new MutationObserver((m,o)=>{const s=document.getElementById('splash');if(s&&s.classList.contains('gone')&&!window.__fwf){window.__fwf=performance.now();o.disconnect();}})
  .observe(document,{subtree:true,attributes:true,attributeFilter:['class']});`;

const COLLECT = `(()=>{const n=performance.getEntriesByType('navigation')[0];const fcp=performance.getEntriesByName('first-contentful-paint')[0];
const fwf=window.__fwf;const lt=window.__lt.slice().sort((a,b)=>a[0]-b[0]);let tti=fwf,i=0;
for(const [s,d] of lt){ if(s+d<=tti) continue; if(s-tti>=2000) break; tti=Math.max(tti,s+d);}
const res=performance.getEntriesByType('resource');const kb=a=>Math.round(a.reduce((x,r)=>x+(r.transferSize||0),0)/1024);
const ltBefore=lt.filter(([s])=>s<tti);
return {dcl:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd),fcp:fcp?Math.round(fcp.startTime):null,fwf:Math.round(fwf),tti:Math.round(tti),
 longTasks:ltBefore.length,longTaskMs:Math.round(ltBefore.reduce((a,[s,d])=>a+d,0)),longestTask:Math.round(Math.max(0,...ltBefore.map(x=>x[1]))),
 requests:res.length,transferKB:kb(res)+Math.round((n.transferSize||0)/1024),jsKB:kb(res.filter(r=>/\\.js/.test(r.name))),artKB:kb(res.filter(r=>/\\/art\\//.test(r.name))),
 heapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,
 floors:__engine.stateManager.state.currentFloors,people:__engine.stateManager.state.survivors.length,quality:__renderer.postfx?.quality,res:__renderer.app.renderer.resolution,
 screen:__renderer.app.screen.width+'x'+__renderer.app.screen.height}})()`;

const VIEWS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, touch: false },
  phone: { width: 360, height: 740, deviceScaleFactor: 2.75, mobile: true, touch: true },
};

async function one(port, sc, save) {
  const c = await launch([`--window-size=${VIEWS[sc.view].width},${VIEWS[sc.view].height}`]);
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
    const v = VIEWS[sc.view];
    await c.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: v.mobile });
    if (v.touch) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT(sc.quality) });
    if (sc.throttle > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: sc.throttle });
    const url = `http://127.0.0.1:${port}/?debug`;
    const out = {};
    const go = async () => {
      await c.send('Page.navigate', { url });
      if (!await waitFor(c, '!!window.__fwf && !!window.__engine', 240, 250)) throw new Error('no first world frame');
      await sleep(4000 * Math.max(1, sc.throttle / 2)); // let TTI settle
      return c.evalJs(COLLECT);
    };
    out.cold = await go(); // fresh profile: empty HTTP cache, no service worker, new game
    if (save) {
      const ok = await c.evalJs(`__engine.importState(__engine.saveManager.exportSave(${JSON.stringify(save)}))`);
      if (!ok) throw new Error('import failed');
      await sleep(1500);
    }
    out.warm = await go(); // second visit: HTTP cache + service worker warm; with a save, the developed bunker loads (incl. time-away catch-up)
    return out;
  } finally { c.close(); }
}

const saveFile = path.join(repo, 'store/sim/saves-v6/e55-seed1.json');
const late = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
const SCEN = [
  { name: 'desktop-high', view: 'desktop', quality: 'high', throttle: 1 },
  { name: 'desktop-medium', view: 'desktop', quality: 'medium', throttle: 1 },
  { name: 'phone-medium', view: 'phone', quality: 'medium', throttle: 1 },
  { name: 'phone-medium-cpu4', view: 'phone', quality: 'medium', throttle: 4 },
];
const srv = await serve(dist);
const results = {};
for (const sc of SCEN) {
  for (const withSave of [false, true]) {
    const key = `${sc.name}${withSave ? '+e55' : ''}`;
    results[key] = [];
    for (let r = 0; r < runs; r++) {
      try { results[key].push(await one(srv.port, sc, withSave ? late : null)); } catch (e) { results[key].push({ error: String(e) }); }
      process.stdout.write('.');
    }
    console.log('\n' + key, JSON.stringify(results[key]));
  }
}
srv.close();
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'load-results.json'), JSON.stringify(results, null, 1));
```

## Appendix B: frames.mjs (frame time, scene tree, memory; `node frames.mjs <dist> <repoRoot> out.json`)

```js
// Frame-time / scene baseline (world-redesign A2). Headless Chrome, brand-new temp profile per scenario, production build (?debug exposes
// __engine/__renderer/__perf2). Never touches a real save: the temp profile is deleted after each run.
//   node frames.mjs <dist> <repoRoot> [out.json]
import fs from 'node:fs';
import path from 'node:path';
const [dist, repo, outArg] = process.argv.slice(2);
const { launch, serve, sleep, waitFor } = await import('file:///' + path.join(repo, 'tools/perf/lib.mjs').split(path.sep).join('/'));

// floorTop(f) and BUILDING_W from src/rendering/layout.ts (read on the dev server, 2026-10-15)
const FLOOR_TOP = [70, 214, 358, 502, 680, 824, 968, 1112, 1290, 1434, 1578, 1722, 1900, 2044, 2188, 2332, 2510, 2654, 2798, 2942, 3120, 3264, 3408, 3552, 3696, 3840];
const BUILDING_W = 616;

const PAGE = `
window.__A2 = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  pick: r => ({ fps: r.fps, target: r.target, frames: r.frames, updMed: r.updateMsMed, updP95: r.updateMsP95, drawMed: r.drawMsMed, drawP95: r.drawMsP95,
    frameMed: r.frameMsMed, frameP95: r.frameMsP95, intMed: r.intervalMed, intP95: r.intervalP95, busy: r.busyPct, tick: r.tickMsAvg, calls: r.drawCalls,
    drawn: r.renderablesDrawn, total: r.renderablesTotal, groups: r.renderGroups, rebuild: r.structureChangedPct, texMB: r.gpuTextureMB, tex: r.gpuTextures,
    heap: r.jsHeapMB, lt: r.longTasks, ltMs: r.longTaskMs, ltMax: r.longTaskMax, q: r.quality, res: r.res }),
  tree() { const app = __renderer.app; const byType = {}; let total = 0, visible = 0, drawn = 0, filterCount = 0, masks = 0, rg = 0; const filterTypes = {};
    const walk = (o, vis) => { total++; const v = vis && o.visible && o.renderable !== false; if (v) visible++; const t = o.constructor?.name || '?'; byType[t] = (byType[t] || 0) + 1;
      if (v && o.renderPipeId && o.renderPipeId !== 'container') drawn++; const f = o.filters; if (f && v) for (const x of [].concat(f)) { filterCount++; const nm = x.constructor?.name; filterTypes[nm] = (filterTypes[nm] || 0) + 1; }
      if (o.mask && v) masks++; if (o.isRenderGroup) rg++; for (const c of o.children || []) walk(c, v); };
    walk(app.stage, true); return { total, visible, drawn, filterCount, filterTypes, masks, rg, byType: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ':' + v).join(' ') }; },
  overview() { __renderer.devCamera(${BUILDING_W} / 2, ${FLOOR_TOP[1]}, 1); },
  async idle(sec) { __A2.overview(); __engine.lastInteraction = Date.now() - 120000; await __A2.sleep(1000); __perf2.reset(); await __A2.sleep(sec * 1000); return __A2.pick(__perf2()); },
  async sweep(sec) { const FT = ${JSON.stringify(FLOOR_TOP)}; const fl = __engine.stateManager.state.currentFloors; const y0 = FT[0], y1 = FT[Math.max(1, Math.min(FT.length - 1, fl - 1))];
    __perf2.reset(); const t0 = performance.now();
    while (performance.now() - t0 < sec * 1000) { const u = (performance.now() - t0) / (sec * 1000);
      __renderer.devCamera(${BUILDING_W} * (0.5 + 0.45 * Math.sin(u * Math.PI * 4)), y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(u * Math.PI * 2)), 0.7 + 1.6 * (0.5 - 0.5 * Math.cos(u * Math.PI * 6)));
      __engine.notifyInteraction(); __engine.noteCameraMotion(); await __A2.sleep(16); }
    return __A2.pick(__perf2()); },
  raw(n = 60) { __A2.overview(); const app = __renderer.app, gl = app.renderer.gl, st = __engine.stateManager.state;
    for (let i = 0; i < 5; i++) __renderer.render(st, 1 / 60, 1); gl.finish();
    const full = []; for (let i = 0; i < n; i++) { const t = performance.now(); __renderer.render(st, 1 / 60, 1); gl.finish(); full.push(performance.now() - t); }
    const pix = []; for (let i = 0; i < n; i++) { const t = performance.now(); app.renderer.render(app.stage); gl.finish(); pix.push(performance.now() - t); }
    const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * p))].toFixed(2); }; const avg = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
    return { fullAvg: avg(full), fullMed: q(full, .5), fullP95: q(full, .95), pixiAvg: avg(pix), pixiMed: q(pix, .5), pixiP95: q(pix, .95) }; },
  env() { const a = __renderer.app; const g = a.renderer.gl; const e = g.getExtension('WEBGL_debug_renderer_info');
    return { css: innerWidth + 'x' + innerHeight, dpr: devicePixelRatio, canvasPx: a.canvas.width + 'x' + a.canvas.height, res: a.renderer.resolution, quality: __renderer.postfx?.quality,
      floors: __engine.stateManager.state.currentFloors, people: __engine.stateManager.state.survivors.length, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), gpu: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?' }; },
};
true`;

const VIEWS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, touch: false },
  phone: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true, touch: true },
};

async function scenario(port, view, save) {
  const v = VIEWS[view];
  const c = await launch([`--window-size=${v.width},${v.height}`]);
  const logs = [];
  try {
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: v.mobile });
    if (v.touch) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('lastbunker_lang','en')}catch(e){}" });
    const url = `http://127.0.0.1:${port}/?debug`;
    const ready = '!!(window.__engine && window.__renderer && window.__perf2)';
    await c.send('Page.navigate', { url });
    if (!await waitFor(c, ready)) throw new Error('no start');
    await sleep(2500);
    if (save) {
      if (!await c.evalJs(`__engine.importState(__engine.saveManager.exportSave(${JSON.stringify(save)}))`)) throw new Error('import failed');
      await sleep(1500);
      c.events.length = 0;
      await c.send('Page.navigate', { url });
      if (!await waitFor(c, ready)) throw new Error('no start 2');
      await sleep(4000);
    }
    await c.evalJs(PAGE);
    await c.evalJs('setInterval(() => { __engine.paused = false; }, 200); true', false); // as tools/perf/run.mjs: intro / welcome overlays pause the sim
    const out = { env: await c.evalJs('__A2.env()') };
    // First pan over the whole bunker: lazy art loads and texture uploads happen here (the cost a player pays once per session)
    out.firstSweep = await c.evalJs('__A2.sweep(6)');
    for (const q of ['high', 'medium']) {
      await c.evalJs(`__renderer.postfx.setQuality('${q}'); true`);
      await sleep(2500);
      const idle = await c.evalJs('__A2.idle(10)');
      const raw = await c.evalJs('__A2.raw(60)');
      const tree = await c.evalJs('__A2.overview(), __A2.tree()');
      const sweep = await c.evalJs('__A2.sweep(10)');
      const od = await c.evalJs('(__A2.overview(), __perf2.overdraw().factor)');
      out[q] = { env: await c.evalJs('__A2.env()'), idle, sweep, raw, tree, overdraw: od };
    }
    out.console = c.events.filter(e => e.method === 'Runtime.consoleAPICalled' && /warn|error/.test(e.params.type)).map(e => e.params.type + ': ' + (e.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160))
      .concat(c.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => 'exception: ' + (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || '').slice(0, 160)));
    return out;
  } finally { c.close(); }
}

const late = JSON.parse(fs.readFileSync(path.join(repo, 'store/sim/saves-v6/e55-seed1.json'), 'utf8'));
const srv = await serve(dist);
const res = {};
for (const view of ['desktop', 'phone']) for (const [name, save] of [['fresh', null], ['e55', late]]) {
  const key = `${name}-${view}`;
  try { res[key] = await scenario(srv.port, view, save); } catch (e) { res[key] = { error: String(e) }; }
  console.log(key, JSON.stringify(res[key]));
}
srv.close();
if (outArg) fs.writeFileSync(outArg, JSON.stringify(res, null, 1));
```

## Appendix C: bundle.mjs (bundle sizes; `node bundle.mjs <dist>`)

```js
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const dist = process.argv[2]; const t = {};
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else {
  const rel = path.relative(dist, p).split(path.sep).join('/'); const ext = path.extname(f).slice(1);
  const cat = rel.startsWith('art/') ? 'art(' + ext + ')' : rel.startsWith('splash/') ? 'splash(' + ext + ')' : rel.startsWith('assets/') ? 'assets-' + ext : 'root-' + ext;
  const b = fs.readFileSync(p); t[cat] ??= { n: 0, raw: 0, gz: 0 }; t[cat].n++; t[cat].raw += b.length; if (/^(js|css|html|json|svg|webmanifest)$/.test(ext)) t[cat].gz += zlib.gzipSync(b).length; } } };
walk(dist); let R = 0;
for (const [k, v] of Object.entries(t)) { R += v.raw; console.log(k.padEnd(16), String(v.n).padStart(4), (v.raw / 1024).toFixed(0).padStart(7) + ' KB raw', v.gz ? (v.gz / 1024).toFixed(0) + ' KB gz' : ''); }
console.log('TOTAL', (R / 1048576).toFixed(2) + ' MB');
const art = fs.readdirSync(path.join(dist, 'art'), { recursive: true }).filter(f => /\.(webp|png)$/.test(f)).map(f => [f, fs.statSync(path.join(dist, 'art', f)).size]).sort((a, b) => b[1] - a[1]);
console.log('art files', art.length, 'largest:', art.slice(0, 8).map(([f, s]) => f + ' ' + (s / 1024).toFixed(0) + 'KB').join('; '));
const byDir = {}; for (const [f, s] of art) { const d = f.split(/[\\/]/)[0]; byDir[d] = (byDir[d] ?? 0) + s; }
console.log('art by dir (KB):', Object.entries(byDir).sort((a, b) => b[1] - a[1]).map(([d, s]) => d + ' ' + (s / 1024).toFixed(0)).join(', '));
```
