# Stage B: Prototype A, a deep 2.5D side cross-section

**One line:** Fallout Shelter's cut-away, but the cut runs through a living cavern city. Six parallax depth planes, a lightmap with light pools in real darkness, organic paths (ramp, stairs, bridge, terrace), fog of war you tap away, and the existing painted room art set into the rock as lit alcoves.

## 1. What the prototype shows

It is the shared scene. The entrance is on the **right** (Hebrew reading order), and depth runs right to left:

| # | Space | What is there |
|---|-------|---------------|
| 0 | Surface | Sky strip (`backdrops/surface-0.webp`, pinned to the horizon), a burnt crust, a broken hatch leaf propped open, sandbags, rebar and a dead tree. Sky light pours down the ramp as a god-ray. |
| 1 | Entrance ramp | A sloped concrete tunnel with hazard banding, rust streaks, a blinking red emergency lamp and a railing. |
| 2 | Bell Square hub (3 storeys) | Arched vault. Balconies on L1 and L2, a steel truss **bridge** across the void, **three stair flights**, a brass chandelier with a light cone, wall lamps and two catenary string-light runs. A huge arched observation window looks out on the deep city behind (back/far layers). There is also a fountain, benches, planters, doors, and a sealed storeroom behind a half-open blast door (under fog). |
| 3 | Service corridor | Cream/green tile, ceiling pipes, three fluorescent tubes (one browns out), and a short ramp down into the district. |
| 4 | Miners' Quarter | An organic cavern with 5 dwellings: quarters, workshop, canteen, medbay and greenhouse. They are the **existing painted room webps**, framed as concrete alcoves, with their `meta.json` lamps turned into light pools. There is an upper terrace on steel columns reached by a **stair**, a fire barrel with flames and sparks, a market stall, a street lamp, a laundry line, a water tank, string lights and stalactites. Through the open cavern back you see stepped houses with lit windows, a metro viaduct with a passing train, and far cliffs with slow lifts climbing them. |
| 5 | Dark edge | A blocked tunnel: rubble choke, a broken beam, planks and caution tape. A cold blue light glows beyond. It starts half-fogged, so you see a hint and tap to uncover it. |
| + | Secrets under fog | A glowing cave below the district (bioluminescent fungi, crystals, a pool), an old cellar near the surface, and the hub storeroom. Each shows its name only once uncovered. |

Also in the scene:
- **9 survivors**, 2 of them carrying lanterns that move with them as lights. They walk a node graph, take stairs, ramps and the bridge, and idle at points of interest (the fire, doorways, the bridge). Movement is always continuous, never a teleport.
- **Camera**:
  - Drag to pan, with fling.
  - Wheel zooms around the cursor. Pinch zooms around the fingers. Range is 0.32–2.4.
  - Tapping fog reveals it (a soft brush grows over 0.9 s).
  - The HUD has "Reveal all" and "Restore fog".
  - At zoom ≈ 0.35 the whole city reads as a map: islands of light in a black earth.
- **RTL DOM HUD**: a `pointer-events:none` layer with an `auto` panel, the same pattern as the game. A tap released over the HUD is not treated as a world tap (`elementFromPoint` check).

### Depth layers (back → front)

| Layer | Parallax p | Content | Lighting |
|-------|-----------:|---------|----------|
| sky | 0.15 horizontal; horizon pinned vertically | gradient + surface painting | self-lit |
| far | 0.40 | colossal cavern pillars, terraced distant districts, ~140 window lights, lifts, haze bands | baked fog (0.72) + own additive glows |
| back | 0.68 | cavern wall ribs, 6 stepped house clusters backlit by warm halos, metro viaduct + moving train, surface ruins skyline | baked fog (0.48) + own glows |
| mid | 0.88 | galleries/pipes behind the hub window, shanties and scaffolds behind the district, crystal spires behind the cave | **lightmap** |
| play | 1.00 | painted rock cut-face (strata, pebbles, roots, fossils, cracks, AO at every cut), back walls, structures, dwellings, people | **lightmap** |
| fore | 1.32 | ragged black rock lip, outcrops, heavy sagging cables, end pipes; fades out below zoom 0.85 | silhouette + rim |

Layer scale is `zoom^p`, so far planes zoom less as well as scroll less. That is what sells the depth when you pinch.

### Render pipeline (per frame)

1. `lightRoot` → `lightRT` at **half resolution**. It is cleared to the ambient colour, then gets an additive depth ramp (warm near the surface, black deep down), zone fills, ~60 point lights (`(1-r)^2.2` falloff texture) and the room lamps from `meta.json`.
2. `litRoot` (mid + play + lightmap sprite) → `playRT`.
   - The lightmap is applied with a patched `multiply` blend: rgb = src·dst, a = dst. The alpha is **kept**.
   - Because alpha is kept, the open caverns stay transparent and the far/back planes show through un-darkened.
   - Plain Pixi `multiply` makes the whole texture opaque. That was the one real gotcha.
3. Stage draws, in order: sky, far, back, the `playRT` sprite, additive glow (lamp cores, cones, god-ray, flames, sparks, dust, labels), fog of war, foreground, then vignette + grain.

Fog of war is a 425×153 RT (8 world units per texel) drawn bilinear-upscaled, which gives soft organic edges for free. Reveals render a soft brush with `erase`. One jittered copy makes the edge breathe.
- Pixi ignores `blendMode` on the *root* container of a `renderer.render()` call. Always wrap the object in a parent container.

All tunables (colours, light intensities and falloff, camera speeds and limits, layer p and fog, fog density, detail density, people) are in one `T` object in `proto/a/tokens.ts`.

## 2. How to open it

- Run the dev server `world` (port 5176), then open **http://localhost:5176/store/world-redesign/proto/a/index.html**.
- `?phone=1` or `?phone=0` forces the phone or desktop tier.
- Debug handle: `__protoA.goto(x, y, zoom)`, `__protoA.fog.revealAll()`, `__protoA.objects()`, `__protoA.bootMs`.
- Good framings:

| View | Call |
|------|------|
| Start (whole city) | the default camera |
| District | `goto(900, 800, 1.3)` |
| Hub + entrance | `goto(2600, 560, 0.95)` |
| Cave (call `fog.reveal(1290, 1300, 330)` first) | `goto(1300, 1150, 1)` |
| Map | `goto(1700, 800, 0.35)` |

Files are all in `store/world-redesign/proto/a/`:

| File | What it holds |
|------|---------------|
| `tokens.ts` | every tunable |
| `scene.ts` | the scene as data: cavities, walk graph, dwellings, lights, labels |
| `play.ts` | rock painting, back walls, structures, dwellings |
| `layers.ts` | sky, far, back, mid, fore and screen fx |
| `lighting.ts` | lightmap and glow |
| `fog.ts` | fog of war |
| `people.ts` | survivors |
| `camera.ts` | camera |
| `main.ts` | boot, frame loop, HUD |

Total ≈ 2,500 lines.

## 3. Performance (measured, with heavy caveats)

**Measurement conditions were bad and the numbers are not representative.**
- The Browser pane was hidden for the whole session, so Chrome throttles rAF: with the ticker stopped, idle rAF intervals were 500–600 ms.
- The host CPU was at **100 %**, and two sibling WebGL prototypes (B and C) were rendering in the same browser and GPU process.
- The GPU is an Intel UHD (integrated), via ANGLE/D3D11.

I therefore also measured CPU frame cost directly, and render cost with a forced GPU sync (`readPixels`) against an empty-stage baseline in the same loop.

| Metric | Desktop 1600×900, DPR 1 | Mobile preset 375×812 |
|---|---|---|
| rAF sampler, 5 s (hidden-pane throttled) | avg **55.7 ms**, p95 **83.2 ms** (one earlier run: avg 35.8) | not obtainable: the tab stalled (see below) |
| CPU per frame (`ticker.update`, no GPU sync) | median **1.7–2.2 ms**, p95 4.0–4.6 ms | n/a |
| Full frame with GPU sync vs empty stage | median **24.2 ms** vs 13.8 ms baseline, so about **10 ms of real render work**; a later run under heavier load gave 34.7 vs 29.4 | n/a |
| Display objects (stage + off-stage lit/light roots) | **821–827** | ≈ 700 (detail 0.6) |
| Render targets per frame | 3: lightmap at 0.5×, playRT at 1×, fog RT only on reveal | lightmap at 0.35× |
| Boot | 2.5–4.4 s (rock cut-face bake ≈ 1.5 s on the main thread) | build steps ≈ 2 s; but the first GPU present after `app.init` stalled the main thread for 25–70 s in mobile emulation (the same texture code timed alone in mobile emulation: 104 ms), so this is the shared GPU process, not the prototype |

**What the numbers say:**
- CPU is cheap: everything is static Graphics plus about 300 animated sprites.
- The cost is **fill rate and overdraw**:
  - sky, far, back and the playRT each cover the full screen;
  - the fog has 2 full-screen sprites;
  - the vignette, the grain, and hundreds of additive glow quads add more.
- A per-layer toggle test ranked fog > far ≈ back ≈ fore ≈ glow > playRT. That run was noisy.

**Expected cost on a mid-range Android phone (Adreno 610 / Mali-G57 class), estimated rather than measured:**
- 30 fps is safe and 60 fps is plausible at DPR ≤ 1.25, with a 0.35× lightmap, the fore layer off and the grain off.
- Above DPR 1.5, or with the full-resolution playRT, it will drop below 60.

**Mitigations already designed in:**
- phone tier (DPR 1.25, lightmap at 0.35×, detail 0.6, no grain);
- foreground hidden when zoomed out;
- one fog halo instead of two.

**Next steps if A is chosen:**
- Render far and back into one cached RT that refreshes only when the camera moves more than N px. Their content is nearly static.
- Use `perfFx.bandize` and hide off-screen glows.
- Render the playRT at 0.75× on the low tier.
- Move the rock bake to an OffscreenCanvas worker, or pre-bake it to webp per district.

## 4. Evaluation: adopting A in the real game

### Keep (works as-is, or only gets a new parent container)

- **`CameraController.ts`**: pan, fling, pinch, wheel, rubber-band, tours, sheet insets.
  - The prototype camera is a subset of it.
  - Parallax only needs `apply(layer, p)`: `scale = zoom^p`, `pos = screen/2 − cam·p·scale`.
  - Extend `camBounds` to the new world rectangle.
- **`paintedRoom.ts` + `roomDepth.ts`**: the painted rooms read *very* well as alcoves cut into rock.
  - `meta.json` lights already provide the light-pool data. The prototype uses them directly.
  - `roomDepth`'s per-room back-wall slide is a small parallax of its own and stays compatible.
- **`people3d.ts`**: the 3D body atlases replace the prototype's capsule figures 1:1, and are much better.
- **`postfx.ts`**: bloom, grade and vignette sit on top of the new stack unchanged. Drop the prototype's own vignette and grain.
  - The touch-throttle profiles (45/30/10 fps) and the `PerformanceMonitor` are exactly what A needs on phones.
- **`perfFx.ts`**: `VIEW` culling, `bandize`, Dust and FlowBeads.
- **`atmosphere.ts`**: drips, sparks and steam stay as they are.
- **`strata.ts`**: the band tiles become the material for the painted cut-face. Its feature atlas still works.
- **`cityMap.ts`**: re-projected onto district centroids, it becomes the zoomed-out map.

### Adapt

- **`geom.ts` / `layout.ts`**: the coordinate module stays the single source of truth, but its model changes from (floor, slot) to **districts, then spaces, then slots**.
  - Each district gets an anchor, a cavity polygon and local slot rows (terraces at arbitrary y).
  - Saves keep (floor, slot) through a mapping table: district = f(floor band), and the row/slot inside the district.
  - This is the riskiest part, because saves are sacred.
- **`BunkerRenderer.ts`**: its render-group list becomes the 6-layer stack, plus the two off-stage roots (light and lit).
  - `parallaxRock` generalises to the per-layer `p`.
  - `targetAt` must hit-test polygons and terraces instead of floor rectangles.
- **`world.ts`**:
  - split `buildUnderground` into far/back/mid/play builders;
  - `buildSurface` becomes the sky plus the play surface strip;
  - `buildShaft` becomes optional (the old lift can stay as one district's spine).
- **`walkers.ts`**: keep the slot pool and the state machine.
- **`routes.ts`**: `route()` is replaced by Dijkstra over a node graph (walk, stairs, ramp, ladder, lift edges), about 40 lines in the prototype. WALK, STAIRS and LADDER legs map directly, and LIFT stays a leg kind.
- **`structure.ts`**: keep `lightOf` / `nightLight` / `depthGains`. `depthGains` becomes the ambient ramp in the lightmap.

### Rewrite / new

- **Lightmap pipeline**: light RT, multiply-keep-alpha onto the lit RT, additive glow layer. New, about 200 lines. It replaces scattered per-room additive glows with one consistent darkness model.
- **Cut-face rock bake**: a canvas or shader bake with AO and strata per district, cached as webp.
- **Fog of war**: an RT plus reveal, saved as a bit-grid (about 2 KB per district), gating labels and pins.
- **District kits**:
  - structure and back-wall styles per stratum: hub concrete+brass, service tiles, metro, mine timber, cave rock, core;
  - far and back content per stratum.
  - `structure.ts` casing and bays are rewritten, because floors stop being straight slabs.
- **HUD hit-testing**: the existing `pointer-events:none` + `auto` panels pattern works. The prototype adds the `elementFromPoint` tap guard, as the game already does.
  - Remaining risk: world labels near the RTL HUD panels. Use the HUD-inset-aware camera framing that already exists.

### Effort (agent-days, one competent agent, includes self-test)

| Milestone | Days |
|---|---:|
| M0. Layer stack in `BunkerRenderer` + camera `apply(p)` + sky pin | 2 |
| M1. Lightmap pipeline + `meta.json` pools + postfx coexistence + quality tiers | 3 |
| M2. District/space model in `geom.ts` + **save migration** (floor/slot → district/slot) + tests | 6 |
| M3. Path graph + routes rewrite (stairs, ramps, bridges, lift legs) + walker integration | 3 |
| M4. Cut-face rock bake (worker / pre-baked webp) reusing `strata.ts` | 2 |
| M5. Fog of war (RT, reveal, persistence, label/pin gating, reveal-as-reward hooks) | 2 |
| M6. District identity kits for 7 strata (structures, back walls, far/back content, signature lights) | 10 |
| M7. Phone performance (cached far+back RT, bandize, glow culling, low-tier playRT 0.75×) | 3 |
| M8. Hit-testing (polygon `targetAt`, `HitSlop`), placement ghost on terraces, RTL overlay checks | 2 |
| M9. Tuning pass + QA on a real mid Android | 3 |
| **Total** | **≈ 36** |

### Risks

1. **Mid-range Android performance** (medium–high).
   - A is fill-rate bound: around 8 full-screen layers plus 3 RTs. CPU is not the issue.
   - Fixes: cache far+back into one RT, lower the lightmap and playRT resolution on low tier, use `TOUCH_PROFILE` throttling.
   - Must be measured on a real device before committing; this session could not.
2. **Art consistency** (medium).
   - Painted rooms (rendered, warm, detailed) next to procedural vector structure can look like two styles.
   - The darkness model hides much of it: everything outside the pools sinks to near-black.
   - Close-ups of stairs and railings still read as "vector".
   - Mitigation: a small painted kit for stairs, railings and slabs (`public/art/kit` already has bays, columns and pipes), plus painted far plates per stratum.
3. **Painted room art reuse** (low).
   - All 45 room webps drop in unchanged, and meta lights work as-is.
   - Rooms are fixed-aspect rectangles, so organic districts need a rectangular "slot row" inside the organic cavity. That is how the prototype works, and it looks natural (terraces).
4. **Readability for an idle game** (medium).
   - Strong darkness is atmospheric, but idle players need to see state at a glance.
   - Keep room fill light (`roomAmbient`), name plates and badges above fog/glow.
   - Keep the city-map LOD for zoom < 0.42.
   - The prototype's labels already sit above the lightmap.
   - Dense districts at phone zoom (≈ 0.42 to show a whole district) make figures tiny. Use `people3d` with LOD.
5. **RTL UI overlay hit-testing** (low).
   - Same DOM-over-canvas pattern as today.
   - Taps are resolved in world space by `elementFromPoint` + `toWorld`.
   - Parallax planes are never hit-tested; only the play plane is.
6. **Save compatibility** (high, but contained in M2): the floor/slot → district mapping must be lossless and covered by tests.
7. **Boot time** (low–medium).
   - Procedural bakes on the main thread cost 1.5–3 s.
   - Pre-bake per-district rock to webp at build time with `tools/`, which already has an art pipeline.

### Scores (1–10, higher is better; for effort, higher means **less** effort)

| Criterion | Score | Why |
|---|---:|---|
| Wow | **8** | Light pools in true darkness, real depth through the cavern openings (train, lifts, distant windows), and a premium feel when pinching. Not as spatial as a full 3D camera. |
| Readability | **7** | Still a side view, so rooms, floors and people read like today. Darkness needs disciplined fill light and badges. |
| Explorability | **7** | Fog of war plus hidden pockets and lights glimpsed beyond rubble works well. Depth is visual only: you can't walk "into" a layer. |
| Reuse of existing art | **8** | Painted rooms, `meta.json` lights, sky backdrops, the strata tiles and people3d all slot in. The structure kit needs new painted pieces. |
| Phone perf | **6** | CPU is trivial. Fill rate needs the caching and tiering listed above; unverified on a device. |
| Effort | **6** | About 36 agent-days, mostly the district model, save migration and per-stratum art. The renderer core is evolutionary, not a rewrite. |

**Verdict:** A is the lowest-risk path to "a huge living underground city". It keeps the game's side-view grammar, camera, rooms and people, and adds depth, light and discovery around them. Adopt it if B and C do not clearly beat it on wow, given their larger rewrite cost.
