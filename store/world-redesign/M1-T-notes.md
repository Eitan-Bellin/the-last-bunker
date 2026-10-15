# M1 — tech-artist notes (branch `world/m1-T`, from `world-redesign` @ 0ef16fb, 2026-10-15)

Everything here is behind the city flag except the context-loss fix (both stacks) and the camera tuning made live (identical values in classic).

## 1. City flag (`src/world/flag.ts`)

| Input | Result |
|---|---|
| `?city`, `?city=1`, any value but `0` | city, and `lastbunker_city = '1'` is remembered |
| `?city=0` | classic, and `lastbunker_city = '0'` is remembered |
| no param | the remembered value, else `DEFAULT_CITY` |

- `export const DEFAULT_CITY = false;` flipping the default is one line.
- Every `localStorage` access is in try/catch (the getter itself throws in a sandboxed frame). A blocked store falls through to the default.
- `CITY` is now a **live binding** (`export let`). `disableCityForSession(reason)` switches it off for the session.
- Readers must test it at call time. The six camera tuning constants in `CameraController.ts` were module constants computed from `CITY`; they are now tiny functions (same values in classic).
- `walkers.ts` still sizes its pool from `CITY` in the constructor; after a fallback it keeps a few spare slots (harmless).
- Tests: `project-test` checks 9 resolution cases (the query beats the store, `?city=0` beats a remembered '1', junk is ignored) and that the kill switch restores the classic frames on every floor.

## 2. Robust boot

- `BunkerRenderer.mountCity` loads `cityHost` + `cityWiring` through `loadCityChunks()`: the two dynamic imports, raced against a 12 s timeout.
- On failure:
  - `logCrash('city-chunk', err, { fallback: 'classic' })`, once;
  - `disableCityForSession()` + `useClassicProjection()` (new in `project.ts`);
  - `init` builds the classic layer stack (`if (!this.cityHost)`).
  - The remembered choice is kept, so the next visit (online) tries the city again.
- Checked on the production build in headless Chrome with `Network.setBlockedURLs` on both chunks:
  - the game boots classic (`cityHost` null, rooms drawn);
  - the crash log holds one `city-chunk: Failed to fetch dynamically imported module …` entry;
  - the same build without blocking boots the city.
- **Service worker:** nothing to change.
  - The `stampServiceWorker` plugin fills `PRECACHE` with every file in `dist/assets`, and `asset-manifest.json` lists every js/css chunk. Both contain `cityHost-*.js` and `cityWiring-*.js` (checked in the build).
  - Every build gets a new `BUILD` id, so `sw.js` changes bytes and the update flow runs. No manual `CACHE` bump is needed.

## 3. "New" pins and pocket finds

**Pins** (`src/world/render/pins.ts`, tokens `PINS` in `tokensRender.ts`):
- A revealed area id (`revealedAreaIds`) that is not in `state.city.seen` gets a pin: a small diamond with a pulsing ring and an additive glow.
- The pins sit in their own render group above the fog, below the fore plane and the labels. They are hidden under the far map (zoom < `CAMERA.zoom.far`) like the labels. The marker keeps 9–16 px on screen.
- Anchors:
  - an area's label point;
  - else its polygon's box centre;
  - `s:<n>` uses the stratum's hub (or band).
  - Ids with no anchor get no pin (and stay unseen).
- `CityHost.syncPins` runs at most 2× a second, on a cheap key (layout sig, floors, building count, seen and found counts). The id list is rebuilt only when the key moves.
- Visibility is one point-in-rect per pin, 5× a second, against the view inset by 8 %. After 1 s in view, `CitySystem.markSeen(...)` is called and the pin fades out.
- The renderer reaches the game's system through `activeCitySystem()` (new export in `CitySystem.ts`: the last one constructed). This avoids touching `app.ts`.

**Pocket finds**:
- `BunkerRenderer.onCanvasTap` (city only, not under the map) first asks `CityHost.tapPocket(x, y)`. If `areaAt` is a pocket that is not revealed and `CitySystem.find` accepts it, three things happen:
  - a fog reveal brush (`PINS.findRevealR`);
  - a glow flash;
  - `uiSound('reveal')`, the existing SFX hook.
- No DOM; economy-neutral (`find` writes only `state.city`).
- **Bug fixed on the way:** the renderer's cheap layout key did not include `state.city.found`, so a found pocket never opened. The key now mixes in the found count.

**Checked in the dev build (slice)**:
- Removing `f:1`/`f:2` from `seen` showed two pins. They were marked seen about 1 s after the camera framed them.
- A real click on the west pocket's lit crack found `p:1:wellRoom`, and the pocket opened.
- **Level-builder note:** a find (any new layout sig) remounts the whole shell, and for one frame the stand-in tiles show. Remounting only the pocket would avoid it.

## 4. Perf: GPU memory

The texture dump (`managedTextures` grouped by owner) on desktop Medium:
- The world-kit paintings are small: 1–2.7 MB each, about 15 MB in all.
- The difference is **render textures**: 160 RTs in the city against 30 in classic at e55. 86 of them were 512² rock chunk caches.
- Cause: Pixi's `cacheAsTexture` takes its texture from `TexturePool` and gives it **back to the pool** when the chunk is parked. The pool never frees anything, so every chunk ever built (and every 512² cache from the High tier before a switch to Medium) stayed on the GPU.
- Fix (`chunks.ts`): a parked chunk's caches are destroyed (`freeCaches`) instead of returned. Same picture; a chunk that comes back is baked again, as before.
- City e55 desktop texture total, same probe: 378 → 333 MB.

### Perf table (also in C-render-notes.md, section M1)

**Method.**
- Production build (`vite build` into the scratchpad), headless Chrome on the iGPU (UHD 630, ANGLE D3D11).
- `ct-frames7.mjs`: A2's `frames.mjs` at the same absolute zoom (overview 0.8 on desktop, 0.62 on phone). Classic and city were measured in the same run on build `M1-final`.
- Desktop is 1280x800 @1; phone is 375x812 @2 with touch.
- e55 = `saves-v7/e55-seed1` (20 floors, 190 people).
- GPU MB is Pixi's managed-texture estimate:
  - "sweep": after a 10 s camera sweep at that tier (the column of the earlier tables);
  - "idle": at the overview after settling.

| Medium | Draw calls, classic → city | GPU MB sweep, classic → city | GPU MB idle, classic → city | Raw frame med ms, classic → city | Idle CPU draw med ms, classic → city |
|---|---|---|---|---|---|
| fresh desktop | 203 → **201** | 165 → **165 (±0)** | 97 → 100 | 3.1 → 6.3 | 2.3 → 3.3 |
| e55 desktop | 628 → **601** | 231 → 264 (+33) | 182 → 207 (+25) | 14.5 → 19.8 | 5.5 → 13.4 |
| fresh phone | 205 → **200** | 346 → **383** | 85 → 121 | 2.9 → 5.1 | 2.2 → 3.1 |
| e55 phone | 648 → **560** | 371 → 402 | 187 → 215 | 17.7 → 17.8 | 6.6 → 11.3 |

| High | Draw calls, classic → city | GPU MB sweep, classic → city | GPU MB idle, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|---|
| fresh desktop | 207 → 242 | 169 → 173 | 166 → 157 | 5.2 → 30.3 |
| e55 desktop | 643 → 674 | 250 → 313 | 251 → 280 | 42.4 → 44.9 |
| fresh phone | 208 → 223 | 347 → 386 | 85 → 122 | 2.8 → 6.6 |
| e55 phone | 664 → 605 | 386 → 424 | 187 → 224 | 19.0 → 19.7 |

**What changed in memory (desktop Medium, city).**

| | Before M1 (C2 / Round 1) | M1 |
|---|---|---|
| fresh, vs classic | +39 MB | **±0 MB** |
| e55, vs classic | +115 MB | +33 MB sweep / +25 MB idle |

- **Chunk caches freed on park and on remount** (`chunks.ts` `freeCaches`, `CityHost.mountShell`). Pixi's `cacheAsTexture` returned each cache to `TexturePool`, which never frees.
- **The pool is emptied on a quality or density change** (`postfx.ts`). The High tier's 2x filter buffers (4096x2048, 32 MB each) stayed for the rest of the session. This also lowers classic: e55 desktop went from 256–290 to 231.

**What is left at e55 desktop (+25 to +33 MB), by owner (texture dump):**
- the world-kit paintings, about 15 MB with mipmaps (art is the level-builder's: `worldKit` `autoGenerateMipmaps`);
- the lit group's filter texture, a pooled 2048x1024 (8 MB) nested inside the composite's;
- rock caches at Medium, 15 x 256², about 4 MB;
- the plane cache, light, fog and glow textures, about 4 MB.

**Budgets.**
- **Desktop ≤ classic + 20 MB:** met for a fresh game. Not met at e55 (+25 idle / +33 sweep). The remaining owners are the art mipmaps and the nested filter texture, above.
- **Phone vs the Round-1 table:**
  - fresh city is 383 MB against Round 1's 411: met;
  - e55 city is 402 MB against Round 1's 372: not met in absolute terms. Round 1's classic was 389 MB and is 371 MB now, so the sessions differ.
  - Idle (no sweep pool noise): +28 MB e55, +36 MB fresh.
- The sweep number moves by about ±20 MB between runs with the pooled filter sizes the sweep happened to need. The idle column is the steadier one.

**Rock caches at High** use `DETAIL.rockRes` 0.6: (512 + 2 × overlap) × 0.6 ≈ 315 px, which the pool rounds up to 512². That is 2.6x the pixels needed: 62 caches = 62 MB at e55 High. A `rockRes` of 0.49 or less would keep them at 256² (`tokens.ts` is the level-builder's; proposal for M2).

**forceBatch on a CPU-throttled phone** (`m1-batch2.mjs`):
- Setup: 375x812@2, Medium, 4x CPU throttle. A/B toggled at runtime with `context.onUpdate()`, two pairs each, idle overview 10 s plus an 8 s pan.

| | Idle draw ms, batch → auto | Pan draw ms, batch → auto | Idle calls, batch → auto |
|---|---|---|---|
| fresh | 25.1 / 24.6 → 24.5 / 22.4 | 21.3 / 25.2 → 21.4 / 25.2 | 204 / 177 → 222 / 186 |
| e55 | 85.9 / 116.7 → 73.7 / 89.3 | 153.2 / 104.6 → 92.6 / 95.0 | 534 / 688 → 574 / 587 |

- Fresh: the forced batching saves 9–18 calls at no CPU cost.
- e55: it costs 12–27 ms (about 20 %) more draw CPU per picture, with no steady call gain.
- So it is now applied only up to `SHELL_RENDER.forceBatchMaxFloors` = 8 floors.
- **Open:** the e55 idle CPU draw is still about 2x classic in the matrix (13.4 vs 5.5 ms desktop). It needs a profile in M2. Suspects: the lit group's draw list, the shell culling flips.

**Machine note.** Other worktrees were building during this session. The frame-time columns are noisier than in Round 1; the draw calls and GPU MB are not affected.


## 5. Context loss (both stacks)

Repro: `WEBGL_lose_context.loseContext()` then `restoreContext()`. Before the fix, classic and city both threw `alphaMode of null` in the batcher on every frame. Four causes, all fixed:
1. **`ArtLibrary.reset()` unloads asynchronously** (`void Assets.unload`), and the renderer asks for the kit right after. The new loads raced the unloads: Assets handed back textures that were about to be destroyed, or the load failed (every `kit/*` ended in `failed`, so the painted surface, shaft and kit never came back). `load()` now awaits a pending unload of the same URL (`unloading` map).
2. **`paintedRoom` haze crops** (`subTextures`) were cached per painting key forever. After a reload they pointed at the destroyed source of the old painting (canteen, generator: `addressModeU of null`). The cache now checks `sub.source === texture.source`. The same bug could hit after the memory sweep released a painting.
3. **Holders rebuilt from a signature** (dig sign, wing signs, district sign, drop ring) were not reset by `recoverGraphics`, so they kept dead textures. Their signatures are now cleared.
4. **Safety net:** `dropDeadTextures(stage)` blanks any sprite whose texture or source is destroyed, clears any Graphics that fills with one, and marks every render group's structure changed. It runs in `recoverGraphics` and on the next 3 pictures.

Result (headless Chrome with GPU, slice, 1280×800, classic and city): 0 render errors after the restore, 0 binds of destroyed sources, and the picture matches the pre-loss shot once the art has reloaded.

## 6. Gates

- `npm run check:full`: green (smoke, lint, glossary, migrations v6/v7 to v8 on 12 saves, project-test with the new flag cases, city-layout, placement, infra, routes, rooms, openings, daily, foreman).
- `npx tsc --noEmit`: clean.
- `vite build` (into the scratchpad): passes. `cityHost-*.js` and `cityWiring-*.js` are in `sw.js` PRECACHE and `asset-manifest.json`; `cityScenario` is not in the bundle.
- **Classic compare** (`tools/compare/run.mjs`, saves-v6 e30 + c, 390x844@2x, 17 shots), with baseline 0ef16fb as a `git archive` copy:
  - base vs head: 1.85 % mean, 6.30 % max;
  - base vs a second head capture: **1.46 % mean, 4.74 % max**;
  - head vs head2 (noise floor): 1.18 % mean, 4.73 % max;
  - classic is unchanged.
  - A second base capture differed from every other set by about 33 % (a different bunker moment in all 17 shots) and is left out.
- **Offline boot:** checked as in section 2.
- **Context loss:** checked as in section 5.

## Open items
- **Level-builder:** a pocket find remounts the whole shell, so stand-ins flash for one frame (remount the pocket only).
- `walkers.ts` pool size is fixed at construction from `CITY` (harmless after a fallback).
- **Pins:** an id with no anchor (e.g. a stratum without a hub or band in the layout) never clears. None exist today.
- **Pool clear warnings:** `TexturePool.clear(true)` on a quality change makes Pixi warn once per bound filter texture: "[BindGroup] a 'textureSource' was destroyed while still bound". Pixi nulls the slot and the next picture rebinds, so it is harmless.
- **Desktop e55 memory** is still +25 MB idle / +33 MB sweep against classic (target +20). What is left:
  - the world-kit art mipmaps (level-builder);
  - the nested lit-filter texture (8 MB). Replacing the filter with a multiply-blended light sprite would remove it; that needs an art check.
- **High rock caches:** `DETAIL.rockRes` 0.6 rounds to 512² in the pool. 0.49 or less keeps 256² (level-builder, `tokens.ts`).
- **e55 idle CPU draw** is about 2x classic in the matrix. Profile it in M2.
